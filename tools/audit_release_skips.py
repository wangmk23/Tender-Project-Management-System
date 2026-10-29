"""Run product unittest discovery with an explicit, fail-closed skip policy.

The host symlink permission and optional host SQLCipher are the only optional
skips. Missing frozen inputs, platform features and unknown skips are required.
No signing material is read from the checkout or from an existing deployment.
"""
from __future__ import annotations

import argparse
import contextlib
import importlib
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import subprocess
import tempfile
import time
import unittest

PRODUCT_COMMIT = '00a1f6c6b6d2282ea5ef37d51255ca092f93b52b'


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def git_value(root, *arguments):
    return subprocess.run(['git', '-C', str(root), *arguments], check=True,
                          capture_output=True, text=True, encoding='utf-8').stdout.strip()


def verify_source_identity(product, harness, paths=None):
    """Permit new verification tests while requiring the original business bytes."""
    if paths is None:
        paths = git_value(product, 'ls-files', '--', 'source', 'src', 'authorization',
                          'requirements-public.txt', 'requirements-public-test.txt',
                          'package.json', 'package-lock.json', 'tools/build_candidate.py',
                          'tools/compile_module_patches.py', 'tools/patch_carchive.py',
                          'tools/benchmark_system.py', 'tools/run_test_suite.ps1').splitlines()
    hashes = {}
    for relative in paths:
        original, tested = product / relative, harness / relative
        if not original.is_file() or not tested.is_file() or digest(original) != digest(tested):
            raise ValueError('product source differs from immutable checkout: ' + relative)
        hashes[relative] = digest(original)
    if not hashes:
        raise ValueError('no product source files compared')
    return {'compared_files': len(hashes), 'sha256': hashlib.sha256(
        json.dumps(hashes, sort_keys=True, separators=(',', ':')).encode()).hexdigest()}


def classify_skip(identity, reason):
    optional = {
        ('test_build_input.BuildInputTests.test_symlink_input_is_rejected',
         'symlink creation is not permitted'): 'host symlink privilege',
        ('test_data_recovery.RecoveryRouteTests.test_exported_file_recovers_a_real_encrypted_database_after_machine_change',
         'requires optional host SQLCipher integration dependency'): 'optional host SQLCipher; packaged SQLCipher remains required',
    }
    dependency = optional.get((identity, reason))
    if dependency:
        return {'classification': 'optional', 'dependency': dependency,
                'coverage': 'sqlcipher suite' if 'SQLCipher' in dependency else 'source symlink rejection contract'}
    if 'source' in reason or 'baseline' in reason:
        dependency = 'PM_SOURCE_EXE + PM_SOURCE_EXE_SHA256 + PYTHON312'
    elif 'candidate' in reason:
        dependency = 'PM_TEST_CANDIDATE_EXE + PM_TEST_CANDIDATE_SHA256; disposable public license and public key'
    else:
        dependency = 'required platform/dependency or unclassified skip'
    return {'classification': 'required', 'dependency': dependency,
            'coverage': 'unittest required mode must execute this test; no substitute waiver'}


class AuditedResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.outcomes = []

    def addSuccess(self, test):
        super().addSuccess(test)
        self.outcomes.append({'id': test.id(), 'outcome': 'passed'})

    def addSkip(self, test, reason):
        super().addSkip(test, reason)
        self.outcomes.append({'id': test.id(), 'outcome': 'skipped', 'reason': reason,
                              **classify_skip(test.id(), reason)})

    def addError(self, test, error):
        super().addError(test, error)
        self.outcomes.append({'id': test.id(), 'outcome': 'error', 'error': self._exc_info_to_string(error, test)})

    def addFailure(self, test, error):
        super().addFailure(test, error)
        self.outcomes.append({'id': test.id(), 'outcome': 'failed', 'error': self._exc_info_to_string(error, test)})


@contextlib.contextmanager
def disposable_public_fixture(product_root, enabled):
    if not enabled:
        yield
        return
    with tempfile.TemporaryDirectory(prefix='public-acceptance-keys-') as temporary:
        previous = {key: os.environ.get(key) for key in ('PROCUREMENT_ISSUER_HOME', 'PM_TEST_LICENSE_DIR')}
        try:
            fixture = Path(temporary) / 'public-fixture'
            fixture.mkdir()
            os.environ['PROCUREMENT_ISSUER_HOME'] = str(Path(temporary) / 'signer')
            sys.path.insert(0, str(product_root / 'authorization'))
            issuer = importlib.import_module('license_issuer')
            issuer.initialize_keys('Disposable-public-test-password', fixture)
            issuer.issue(target_dir=fixture, organization='Synthetic CI acceptance', expires=None,
                         password='Disposable-public-test-password')
            os.environ['PM_TEST_LICENSE_DIR'] = str(fixture)
            # Historical helper copied only the license, assuming a private key
            # embedded in the EXE. Adapt its constructor to the public product's
            # documented external public-key contract without altering product.
            helpers = [importlib.import_module(name) for name in
                       ('test_stage_template_packaged_e2e', 'tests.test_stage_template_packaged_e2e')]
            originals = [(helper.PackagedClient, helper.PackagedClient.__init__) for helper in helpers]
            def constructor(original):
                def initialize(client, *args, **kwargs):
                    import shutil
                    original(client, *args, **kwargs)
                    shutil.copy2(fixture / 'license_public_key.pem', client.data_root / 'license_public_key.pem')
                return initialize
            for client_class, original in originals:
                client_class.__init__ = constructor(original)
            try:
                yield
            finally:
                for client_class, original in originals:
                    client_class.__init__ = original
        finally:
            for key, value in previous.items():
                if value is None:
                    os.environ.pop(key, None)
                else:
                    os.environ[key] = value


@contextlib.contextmanager
def packaged_sqlcipher(enabled):
    if not enabled:
        yield
        return
    from tools.benchmark_system import _load_candidate_sqlcipher, sha256_file
    candidate = Path(os.environ['PM_TEST_CANDIDATE_EXE'])
    if sha256_file(candidate) != os.environ['PM_TEST_CANDIDATE_SHA256']:
        raise ValueError('candidate SHA-256 mismatch before SQLCipher extraction')
    # Python cannot unload the imported extension before process exit. Windows
    # may retain these few DLLs until exit; no private fixture enters this path.
    with tempfile.TemporaryDirectory(prefix='public-audit-sqlcipher-', ignore_cleanup_errors=True) as temporary:
        runtime = _load_candidate_sqlcipher(candidate, Path(temporary))
        try:
            yield
        finally:
            runtime['dll_handle'].close()


def parse_verbose_log(path):
    text = Path(path).read_text('utf-8-sig')
    rows = []
    for line in text.splitlines():
        match = re.match(r'(.+?) \(([^)]+)\) \.\.\. skipped ([\'"].*)', line)
        if not match:
            continue
        name, identity, quoted = match.groups()
        if name == 'setUpClass':
            identity = f'setUpClass ({identity})'
        reason = quoted[1:-1]
        rows.append({'id': identity, 'outcome': 'skipped', 'reason': reason, **classify_skip(identity, reason)})
    summary = re.search(r'Ran (\d+) tests? in ([\d.]+)s', text)
    return {'tests_run': int(summary[1]) if summary else 0,
            'duration_seconds': float(summary[2]) if summary else None,
            'skipped': rows, 'required_skips': sum(x['classification'] == 'required' for x in rows),
            'optional_skips': sum(x['classification'] == 'optional' for x in rows),
            'source_log': str(Path(path).resolve()), 'status': 'observed',
            'complete_release_acceptance': False}


def baseline_coverage(outcomes, baseline):
    coverage = []
    for original in baseline['skipped']:
        identity = original['id']
        if identity.startswith('setUpClass ('):
            prefix = identity[len('setUpClass ('):-1] + '.'
            observed = [row for row in outcomes if row['id'].startswith(prefix) or row['id'] == identity]
        else:
            observed = [row for row in outcomes if row['id'] == identity]
        status = 'passed' if observed and all(row['outcome'] == 'passed' for row in observed) else 'failed'
        if original['classification'] == 'optional' and observed and all(
                row['outcome'] == 'passed' or (row['outcome'] == 'skipped' and
                classify_skip(row['id'], row['reason'])['classification'] == 'optional') for row in observed):
            status = 'optional_covered'
        coverage.append({'baseline_id': identity, 'original_reason': original['reason'],
                         'classification': original['classification'], 'coverage_status': status,
                         'executed_tests': [{key: row[key] for key in ('id', 'outcome', 'reason', 'classification')
                                             if key in row} for row in observed]})
    return coverage


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--product-root', type=Path)
    parser.add_argument('--product-commit', default=PRODUCT_COMMIT)
    parser.add_argument('--test-harness-root', type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument('--test-harness-commit', help='Pinned reviewed test checkout; defaults to public v53 harness or the selected product commit')
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--from-log', type=Path)
    parser.add_argument('--mode', choices=('observe', 'required'), default='required')
    parser.add_argument('--prepare-public-fixture', action='store_true')
    parser.add_argument('--packaged-sqlcipher', action='store_true')
    parser.add_argument('--test-id', action='append', help='Targeted diagnostic test id; omitted for the full release gate')
    args = parser.parse_args(argv)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.from_log:
        report = parse_verbose_log(args.from_log)
        args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        return 0 if args.mode == 'observe' or not report['required_skips'] else 1
    if args.product_root is None:
        parser.error('--product-root is required for execution')
    product = args.product_root.resolve(strict=True)
    root = args.test_harness_root.resolve(strict=True)
    if git_value(product, 'rev-parse', 'HEAD') != args.product_commit:
        raise ValueError('product checkout must remain at immutable product commit')
    if git_value(product, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('immutable product checkout has tracked modifications')
    source_identity = verify_source_identity(product, root)
    harness_commit = git_value(root, 'rev-parse', 'HEAD')
    harness_dirty = git_value(root, 'status', '--porcelain', '--untracked-files=no')
    expected_harness = args.test_harness_commit or (
        '3e40617236e8ec892c3e60fb85f34dcc7eabc979' if args.product_commit == PRODUCT_COMMIT else args.product_commit)
    if harness_commit != expected_harness:
        raise ValueError('test harness commit differs from the pinned manifest')
    if harness_dirty:
        raise ValueError('test harness has tracked modifications')
    harness_files = {str(path.relative_to(root)): digest(path)
                     for path in (root / 'tests').rglob('*')
                     if path.is_file() and path.suffix in ('.py', '.js', '.json')}
    os.chdir(root)
    sys.path.insert(0, str(root))
    sys.path.insert(0, str(root / 'tests'))
    started = time.monotonic()
    with packaged_sqlcipher(args.packaged_sqlcipher), disposable_public_fixture(root, args.prepare_public_fixture):
        suite = (unittest.defaultTestLoader.loadTestsFromNames(args.test_id) if args.test_id else
                 unittest.defaultTestLoader.discover(str(root / 'tests'), pattern='test_*.py'))
        result = unittest.TextTestRunner(verbosity=2, resultclass=AuditedResult).run(suite)
    skipped = [entry for entry in result.outcomes if entry['outcome'] == 'skipped']
    required = sum(entry['classification'] == 'required' for entry in skipped)
    baseline_path = Path(__file__).with_name('release_validation_skip_baseline.json')
    baseline = json.loads(baseline_path.read_text('utf-8'))
    coverage = baseline_coverage(result.outcomes, baseline)
    uncovered = sum(row['coverage_status'] == 'failed' for row in coverage) if not args.test_id else 0
    after_files = {str(path.relative_to(root)): digest(path)
                   for path in (root / 'tests').rglob('*')
                   if path.is_file() and path.suffix in ('.py', '.js', '.json')}
    harness_changed = after_files != harness_files
    verify_source_identity(product, root)
    passed = (result.wasSuccessful() and not harness_changed and
              (args.mode == 'observe' or (required == 0 and uncovered == 0)))
    report = {'status': 'passed' if passed else 'failed', 'mode': args.mode,
              'complete_release_acceptance': False, 'tests_run': result.testsRun,
              'failures': len(result.failures) + len(result.errors), 'required_skips': required,
              'optional_skips': len(skipped) - required, 'skipped': skipped,
              'baseline_skips_sha256': digest(baseline_path), 'baseline_skip_count': len(coverage),
              'baseline_skip_audit': coverage, 'uncovered_baseline_skips': uncovered,
              'duration_seconds': time.monotonic() - started, 'outcomes': result.outcomes,
              'product_root': str(product), 'product_commit': args.product_commit,
              'test_harness_root': str(root), 'test_harness_commit': harness_commit,
              'test_harness_dirty': harness_dirty, 'test_harness_changed_during_run': harness_changed,
              'test_harness_sha256': hashlib.sha256(json.dumps(harness_files, sort_keys=True,
                  separators=(',', ':')).encode()).hexdigest(),
              'test_harness_files': harness_files, 'product_source_identity': source_identity,
              'selected_test_ids': args.test_id or [], 'python': sys.version, 'command': sys.argv}
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    return 0 if passed else 1


if __name__ == '__main__':
    raise SystemExit(main())
