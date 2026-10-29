"""Validate immutable public release inputs and run independent acceptance suites.

Only explicitly listed public assets enter the input directory. The report is
written on preflight failures as well as suite failures. Suite stdout/stderr are
evidence; neither an exit code nor a self-reported success is sufficient alone.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
import time
import urllib.request

PRODUCT_COMMIT = '00a1f6c6b6d2282ea5ef37d51255ca092f93b52b'
PRODUCT_TAG = 'v5.8.53-public'
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
MANDATORY_SUITES = {'unittest', 'sqlcipher', 'public-runtime', 'browser', 'license-states', 'issuers', 'installation'}


def sha256_file(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', 'utf-8')


def preserve_process_output(output, identifier, stdout, stderr):
    """TimeoutExpired may carry bytes even when subprocess text=True."""
    for suffix, value in (('stdout', stdout), ('stderr', stderr)):
        if isinstance(value, bytes):
            value = value.decode('utf-8', errors='replace')
        (output / f'{identifier}.{suffix}.txt').write_text(value or '', encoding='utf-8')


def verify_inputs(manifest, inputs):
    expected = {asset['filename'] for asset in manifest['assets'].values()}
    if inputs.is_dir():
        unexpected = sorted(path.name for path in inputs.iterdir() if path.name not in expected)
        if unexpected:
            raise ValueError('unexpected input (public assets only): ' + ', '.join(unexpected))
    verified = {}
    for identifier, asset in manifest['assets'].items():
        path = inputs / asset['filename']
        if not path.is_file() or path.is_symlink():
            raise ValueError('missing required input: ' + identifier)
        actual = sha256_file(path)
        if actual != asset['sha256']:
            raise ValueError(f'SHA-256 mismatch: {identifier}: {actual}')
        verified[identifier] = {'path': str(path.resolve()), 'sha256': actual,
                                'bytes': path.stat().st_size, 'url': asset.get('url')}
    return verified


def validate_suite_plan(suites):
    identifiers = [suite.get('id') for suite in suites]
    if len(set(identifiers)) != len(identifiers):
        raise ValueError('duplicate suite identifiers')
    if not MANDATORY_SUITES.issubset(identifiers):
        raise ValueError('missing mandatory suites: ' + ', '.join(sorted(MANDATORY_SUITES - set(identifiers))))
    for suite in suites:
        if not suite.get('command') or not suite.get('report'):
            raise ValueError('suite requires a command and JSON report: ' + str(suite.get('id')))


def validate_suite_result(exit_code, report):
    from tools.audit_release_skips import classify_skip
    def approved_optional(entry):
        return (isinstance(entry, dict) and entry.get('classification') == 'optional' and
                classify_skip(entry.get('id'), entry.get('reason', ''))['classification'] == 'optional')
    issues = []
    if exit_code != 0:
        issues.append(f'process exit code {exit_code}')
    if not isinstance(report, dict):
        return False, [*issues, 'missing JSON object report']
    status = report.get('status')
    if status not in ('passed', 'pass', 'ok', 'success', 'verified'):
        issues.append('JSON must explicitly report a passing status')
    if report.get('mode') == 'observe' or report.get('selected_test_ids'):
        issues.append('diagnostic/observe execution cannot satisfy a mandatory suite')
    if report.get('completed') is False:
        issues.append('suite did not complete')
    if report.get('test_harness_changed_during_run'):
        issues.append('test harness changed during execution')
    def inspect(value, path=''):
        if isinstance(value, dict):
            skipped_entry = value.get('status') == 'skipped' or value.get('outcome') == 'skipped'
            if skipped_entry and not approved_optional(value):
                issues.append('unapproved skipped check: ' + path)
            for key, child in value.items():
                location = path + '.' + key
                normalized = key.lower()
                if normalized in ('failures', 'failed', 'errors', 'required_skips', 'failed_checks', 'uncovered_baseline_skips') and child:
                    issues.append('nonzero failures: ' + location)
                if normalized in ('manual_pending', 'pending', 'requires_manual_validation') and child:
                    issues.append('pending acceptance: ' + location)
                if normalized in ('ok', 'passed', 'success') and child is False:
                    issues.append('failed check: ' + location)
                if normalized == 'status' and child in ('failed', 'error', 'pending', 'manual_pending'):
                    issues.append('nonpassing check status: ' + location)
                inspect(child, location)
        elif isinstance(value, list):
            for index, child in enumerate(value):
                if child is False:
                    issues.append('failed check: ' + path)
                inspect(child, path + f'[{index}]')
    inspect(report)
    skipped = report.get('skipped', [])
    if skipped and (not isinstance(skipped, list) or any(
            not approved_optional(entry) for entry in skipped)):
        issues.append('unapproved skipped checks')
    checks = report.get('checks')
    if not (checks or report.get('tests_run') or report.get('checks_passed') or report.get('passed_checks')):
        issues.append('empty check evidence')
    if isinstance(checks, list) and 'total' in report and report['total'] != len(checks):
        issues.append('reported total differs from actual checks')
    return not issues, issues


def git_value(root, *arguments):
    return subprocess.run(['git', '-C', str(root), *arguments], check=True,
                          capture_output=True, text=True, encoding='utf-8').stdout.strip()


def environment_report():
    versions = {}
    for name in ('PyInstaller', 'cryptography', 'Pillow', 'Flask', 'SQLAlchemy', 'requests', 'psutil', 'playwright', 'pywin32'):
        try:
            versions[name] = importlib.metadata.version(name)
        except importlib.metadata.PackageNotFoundError:
            versions[name] = None
    return {'python': sys.version, 'executable': sys.executable, 'platform': platform.platform(),
            'machine': platform.machine(), 'dependencies': versions}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', type=Path, default=ROOT / 'tools/release_validation_manifest.json')
    parser.add_argument('--suites', type=Path, default=ROOT / 'tools/release_validation_suites.json')
    parser.add_argument('--product-root', required=True, type=Path)
    parser.add_argument('--inputs-dir', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--download', action='store_true')
    parser.add_argument('--build-runtime-url', help='Optional public release URL override; expected SHA-256 is unchanged')
    parser.add_argument('--preflight-only', action='store_true')
    args = parser.parse_args(argv)
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    report = {'schema_version': 1, 'status': 'failed', 'complete_release_acceptance': False,
              'automated_acceptance_passed': False, 'native_desktop_verified': False,
              'manual_pending': ['Native Windows desktop acceptance requires a human; headless/browser checks do not supply this evidence.'],
              'started_at': datetime.now(timezone.utc).isoformat(), 'command': sys.argv,
              'environment': environment_report(), 'inputs': {}, 'suites': [], 'errors': []}
    try:
        manifest = json.loads(args.manifest.read_text('utf-8'))
        if manifest.get('product_commit') != PRODUCT_COMMIT or manifest.get('product_tag') != PRODUCT_TAG:
            raise ValueError('immutable product commit/tag mismatch')
        if args.build_runtime_url:
            if not args.build_runtime_url.startswith('https://github.com/wangmk23/Tender-Project-Management-System/releases/download/'):
                raise ValueError('baseline override must be a public release URL')
            manifest['assets']['build_runtime']['url'] = args.build_runtime_url
        if platform.system() != 'Windows' or sys.version_info[:2] != (3, 12):
            raise ValueError('Windows and Python 3.12 are mandatory')
        product = args.product_root.resolve(strict=True)
        product_commit = git_value(product, 'rev-parse', 'HEAD')
        tag_commit = git_value(product, 'rev-parse', PRODUCT_TAG + '^{commit}')
        if product_commit != PRODUCT_COMMIT or tag_commit != PRODUCT_COMMIT:
            raise ValueError('product checkout must match immutable commit and tag')
        if git_value(product, 'status', '--porcelain', '--untracked-files=no'):
            raise ValueError('product checkout has tracked modifications')
        report.update(product_commit=product_commit, product_tag=PRODUCT_TAG,
                      verification_commit=git_value(ROOT, 'rev-parse', 'HEAD'),
                      manifest_sha256=sha256_file(args.manifest), suite_config_sha256=sha256_file(args.suites))
        provenance = (ROOT / 'docs/releases/v5.8.53-build-evidence.json',
                      args.manifest.resolve(), ROOT / 'docs/releases/v5.8.53-public.json',
                      ROOT / 'tools/release_validation_skip_baseline.json')
        report['provenance'] = {}
        for path in provenance:
            if not path.is_file():
                raise ValueError('missing required build provenance: ' + str(path))
            destination = output / 'provenance' / path.name
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(path.read_bytes())
            report['provenance'][path.name] = {'sha256': sha256_file(path), 'report_copy': str(destination)}
        inputs = args.inputs_dir.resolve()
        if args.download:
            inputs.mkdir(parents=True, exist_ok=True)
            for asset in manifest['assets'].values():
                url = asset['url']
                if not url.startswith('https://github.com/wangmk23/Tender-Project-Management-System/releases/download/'):
                    raise ValueError('asset URL must be an approved public release URL')
                target = inputs / asset['filename']
                if not target.exists():
                    urllib.request.urlretrieve(url, target)
        report['inputs'] = verify_inputs(manifest, inputs)
        suites = json.loads(args.suites.read_text('utf-8'))['suites']
        validate_suite_plan(suites)
        if args.preflight_only:
            report['status'] = 'preflight_passed'
        else:
            substitutions = {'python': sys.executable, 'verification': str(ROOT), 'product': str(product),
                             'output': str(output), **{key: value['path'] for key, value in report['inputs'].items()},
                             **{key + '_sha256': value['sha256'] for key, value in report['inputs'].items()}}
            environment = dict(os.environ, PM_SOURCE_EXE=substitutions['build_runtime'],
                               PM_SOURCE_EXE_SHA256=substitutions['build_runtime_sha256'],
                               PM_TEST_CANDIDATE_EXE=substitutions['system'],
                               PM_TEST_CANDIDATE_SHA256=substitutions['system_sha256'],
                               PYTHON312=sys.executable, PYTHONUTF8='1', PYTHONIOENCODING='utf-8')
            for key in ('PM_TEST_LICENSE_DIR', 'PROCUREMENT_ISSUER_HOME', 'PROCUREMENT_ISSUER_PASSWORD', 'PYTHONPATH'):
                environment.pop(key, None)
            for suite in suites:
                command = [argument.format_map(substitutions) for argument in suite['command']]
                json_path = Path(suite['report'].format_map(substitutions))
                if not json_path.is_relative_to(output):
                    raise ValueError('suite report must be inside output directory')
                if json_path.exists():
                    raise ValueError('stale suite report exists; use a fresh output directory: ' + str(json_path))
                started = time.monotonic()
                entry = {'id': suite['id'], 'command': command, 'cwd': str(product), 'report': str(json_path)}
                try:
                    completed = subprocess.run(command, cwd=product, env=environment, capture_output=True,
                                               text=True, encoding='utf-8', errors='replace',
                                               timeout=suite.get('timeout_seconds', 1800),
                                               creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                    preserve_process_output(output, suite['id'], completed.stdout, completed.stderr)
                    result = json.loads(json_path.read_text('utf-8-sig')) if json_path.is_file() else None
                    passed, issues = validate_suite_result(completed.returncode, result)
                    entry.update(exit_code=completed.returncode, status='passed' if passed else 'failed',
                                 issues=issues, skipped=result.get('skipped', []) if result else [])
                except subprocess.TimeoutExpired as error:
                    preserve_process_output(output, suite['id'], error.stdout, error.stderr)
                    entry.update(status='failed', issues=[str(error)], timed_out=True)
                except Exception as error:
                    entry.update(status='failed', issues=[str(error)])
                entry['duration_seconds'] = time.monotonic() - started
                report['suites'].append(entry)
                write_json(output / 'release-validation.json', report)
            # Mutating or substituting any frozen asset during a verifier fails.
            verify_inputs(manifest, inputs)
            if all(entry['status'] == 'passed' for entry in report['suites']):
                report['status'] = 'automated_passed_manual_pending'
                report['automated_acceptance_passed'] = True
    except Exception as error:
        report['errors'].append(f'{type(error).__name__}: {error}')
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        write_json(output / 'release-validation.json', report)
    print(json.dumps({'status': report['status'], 'report': str(output / 'release-validation.json')}, ensure_ascii=False))
    return 0 if report['status'] in ('automated_passed_manual_pending', 'preflight_passed') else 1


if __name__ == '__main__':
    raise SystemExit(main())
