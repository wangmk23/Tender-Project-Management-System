"""Adapt existing headless product checks to the acceptance JSON contract."""
import argparse
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from unittest.mock import patch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('suite', choices=('sqlcipher', 'public-runtime', 'issuers', 'installation'))
    parser.add_argument('--product-root', required=True, type=Path)
    parser.add_argument('--verification-root', type=Path, default=Path(__file__).resolve().parents[1],
                        help='Independent verification checkout containing new packaged verifiers')
    parser.add_argument('--candidate', required=True, type=Path)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--source', type=Path)
    parser.add_argument('--source-sha256')
    parser.add_argument('--issuer', type=Path)
    parser.add_argument('--issuer-sha256')
    parser.add_argument('--bound', type=Path)
    parser.add_argument('--bound-sha256')
    parser.add_argument('--baseline', type=Path)
    parser.add_argument('--baseline-sha256')
    parser.add_argument('--expected-version', default='v5.8.53')
    parser.add_argument('--baseline-version', default='v5.8.52')
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args()
    verification_root = args.verification_root.resolve()
    sys.path.insert(0, str(args.product_root.resolve()) if args.suite in ('sqlcipher', 'public-runtime') else str(verification_root))
    import hashlib
    def sha256_file(path):
        return hashlib.sha256(Path(path).read_bytes()).hexdigest()
    result = {'status': 'failed', 'scope': 'headless packaged acceptance', 'checks': [], 'failures': 0,
              'verification_root': str(verification_root)}
    try:
        if sha256_file(args.candidate) != args.sha256:
            raise ValueError('candidate SHA-256 mismatch')
        if args.suite == 'sqlcipher':
            from tools.benchmark_system import run_candidate_sqlcipher_smoke
            result['details'] = run_candidate_sqlcipher_smoke(
                source_exe=args.source, source_sha256=args.source_sha256,
                python312=Path(sys.executable), candidate_exe=args.candidate,
                candidate_sha256=args.sha256, project_count=40, attachment_metadata_count=120)
            result['failures'] = result['details']['failures']
            result['checks'] = [
                {'name': key, 'ok': result['details'].get(key) is True}
                for key in ('encrypted_header', 'stdlib_sqlite_rejected')]
            result['checks'].append({'name': 'connector', 'ok': result['details']['connector_module'] == 'sqlcipher3._sqlite3'})
        elif args.suite == 'public-runtime':
            from tools.verify_public_release import verify
            details = verify(args.candidate)
            # This existing verifier is explicitly headless. Preserve that
            # limitation as a scope statement, not a pending manual pass.
            details.pop('native_desktop_verified', None)
            result['details'] = details
            result['checks'] = [{'name': item, 'ok': True} for item in details['checks']]
        elif args.suite == 'issuers':
            from tools.verify_authorization_release import verify
            with tempfile.TemporaryDirectory(prefix='public-ci-issuer-assets-') as temporary:
                home = Path(temporary)
                assets = {}
                for name, source, expected in (('license-issuer.exe', args.issuer, args.issuer_sha256),
                                                ('license-bound.exe', args.bound, args.bound_sha256)):
                    if sha256_file(source) != expected:
                        raise ValueError('issuer SHA-256 mismatch: ' + name)
                    shutil.copy2(source, home / name)
                    assets[name] = expected
                manifest = home / 'public-hashes.json'
                manifest.write_text(json.dumps({'assets': assets}), 'utf-8')
                result['details'] = verify(home, manifest)
                result['checks'] = [{'name': item, 'ok': True} for item in result['details']['checks']]
        else:
            from tools.verify_installation_release import verify
            sys.path.insert(0, str(verification_root / 'authorization'))
            import license_issuer
            with tempfile.TemporaryDirectory(prefix='public-ci-install-fixture-') as temporary:
                fixture = Path(temporary) / 'fixture'
                fixture.mkdir()
                with patch.dict(os.environ, PROCUREMENT_ISSUER_HOME=str(Path(temporary) / 'signer')):
                    license_issuer.initialize_keys('Disposable-install-password', fixture)
                    license_issuer.issue(target_dir=fixture, organization='Synthetic CI installation', expires=None,
                                         password='Disposable-install-password')
                details = verify(args.candidate, args.sha256, fixture, args.baseline, args.baseline_sha256, args.output.parent,
                                 args.expected_version, args.baseline_version)
                result['checks'] = [{'name': item['name'], 'ok': item['status'] == 'passed'} for item in details['checks']]
                result['failures'] = int(details['status'] != 'automated_passed_manual_pending')
                result['native_manual_scope'] = [row['reason'] for row in details['manual_pending']]
                result['raw_report'] = str(args.output.parent / 'installation.json')
        if sha256_file(args.candidate) != args.sha256:
            raise ValueError('candidate changed during verification')
        if not result['failures'] and result['checks'] and all(check['ok'] for check in result['checks']):
            result['status'] = 'passed'
    except Exception as error:
        result.update(failures=result['failures'] + 1, error=f'{type(error).__name__}: {error}')
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    return 0 if result['status'] == 'passed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
