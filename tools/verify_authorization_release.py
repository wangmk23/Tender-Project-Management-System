"""Check public frozen issuers using temporary keys outside the repository."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.build_authorization import build_workspace


def verify(directory, manifest=None):
    directory = Path(directory).resolve()
    if manifest:
        expected = json.loads(Path(manifest).read_text(encoding='utf-8'))['assets']
        for name in ('license-issuer.exe', 'license-bound.exe'):
            actual = hashlib.sha256((directory / name).read_bytes()).hexdigest()
            if actual != expected[name]:
                raise ValueError('Release hash mismatch: ' + name)
    checks = []
    with build_workspace() as temporary:
        temporary = Path(temporary)
        environment = dict(os.environ, PROCUREMENT_ISSUER_HOME=str(temporary / 'keys'),
                           PROCUREMENT_ISSUER_PASSWORD='Ephemeral-release-test-password')
        for name in ('license-issuer.exe', 'license-bound.exe'):
            shutil.copy2(directory / name, temporary / name)

        def run(name, arguments, expected_exit=0):
            log = temporary / 'process.log'
            with log.open('wb') as output:
                for attempt in range(12):
                    try:
                        process = subprocess.Popen([str(temporary / name), *arguments],
                            env=environment, stdout=output, stderr=output,
                            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
                        break
                    except PermissionError as error:
                        if getattr(error, 'winerror', None) != 32 or attempt == 11:
                            raise
                        time.sleep(.5)
                try:
                    exit_code = process.wait(timeout=45)
                except subprocess.TimeoutExpired:
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
                    else:
                        process.kill()
                    process.wait(timeout=10)
                    raise
            if exit_code != expected_exit:
                raise AssertionError(f'{name} {arguments[0]} returned {exit_code}, expected {expected_exit}')
            checks.append(name + ' ' + arguments[0])
            print(checks[-1], flush=True)

        run('license-issuer.exe', ['--init', '--target', str(temporary / 'app')])
        public_key = (temporary / 'keys/license_public_key.pem').read_bytes()
        run('license-issuer.exe', ['--sign', '--target', str(temporary / 'app'), '--org', 'Example', '--days', '365'])
        assert (temporary / 'app/license.dat').is_file()
        run('license-bound.exe', ['--self-test'], 2)
        run('license-bound.exe', ['--init', '--target', str(temporary / 'app')])
        assert (temporary / 'keys/license_public_key.pem').read_bytes() == public_key
        run('license-bound.exe', ['--sign', '--target', str(temporary / 'app'), '--org', 'Example', '--permanent'])
        config = temporary / 'issuer-config.json'
        value = json.loads(config.read_text(encoding='utf-8'))
        value['volume_serial'] = 'FFFFFFFF' if value['volume_serial'] != 'FFFFFFFF' else '00000001'
        config.write_text(json.dumps(value), encoding='utf-8')
        before = (temporary / 'app/license.dat').read_bytes()
        run('license-bound.exe', ['--sign', '--target', str(temporary / 'app'), '--org', 'Example', '--permanent'], 2)
        assert (temporary / 'app/license.dat').read_bytes() == before
    return {'passed': len(checks), 'checks': checks}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--manifest')
    parser.add_argument('--report')
    arguments = parser.parse_args()
    report = verify(arguments.directory, arguments.manifest)
    if arguments.report:
        Path(arguments.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
