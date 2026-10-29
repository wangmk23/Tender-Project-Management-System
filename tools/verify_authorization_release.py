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
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.build_authorization import build_workspace



def startup_diagnostics(process_id, temporary):
    """Inspect only the test process tree, without activating any windows."""
    if os.name != 'nt':
        return {}
    import ctypes
    from ctypes import wintypes
    user = ctypes.windll.user32
    command = f"Get-CimInstance Win32_Process -Filter 'ParentProcessId={int(process_id)}' | Select-Object -ExpandProperty ProcessId"
    result = subprocess.run(['powershell.exe', '-NoProfile', '-NonInteractive', '-Command', command],
        capture_output=True, text=True, creationflags=subprocess.CREATE_NO_WINDOW, timeout=10)
    process_ids = {process_id, *(int(line) for line in result.stdout.splitlines() if line.strip().isdigit())}
    callback_type = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    user.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    messages = []
    @callback_type
    def child(window, _argument):
        value = ctypes.create_unicode_buffer(8192)
        user.GetWindowTextW(window, value, len(value))
        if value.value:
            messages.append(value.value.replace(str(temporary), '<temporary>'))
        return True
    @callback_type
    def top(window, _argument):
        owner = wintypes.DWORD()
        user.GetWindowThreadProcessId(window, ctypes.byref(owner))
        if owner.value in process_ids:
            child(window, 0)
            user.EnumChildWindows(window, child, 0)
        return True
    user.EnumWindows(top, 0)
    return {'window_messages': messages, 'temporary_files': [str(p.relative_to(temporary)) for p in temporary.rglob('*') if p.is_file()]}


def release_assets(directory, manifest=None):
    """Resolve public asset mappings or the original {'assets': {name: hash}}."""
    directory = Path(directory).resolve()
    expected = {}
    mapped = {}
    if manifest:
        payload = json.loads(Path(manifest).read_text(encoding='utf-8-sig'))
        if isinstance(payload, list):
            mapped = {row['github_name']: row for row in payload}
            expected = {name: row['sha256'] for name, row in mapped.items()}
        else:
            expected = payload['assets']
    assets = {}
    for name in ('license-issuer.exe', 'license-bound.exe'):
        path = directory / name
        if not path.is_file() and name in mapped:
            path = directory / mapped[name]['local_name']
            if not path.is_file():
                path = Path(mapped[name]['local_path']).resolve()
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if manifest:
            wanted = expected[name]
            if isinstance(wanted, dict):
                wanted = wanted['sha256']
            if actual != wanted.lower():
                raise ValueError('Release hash mismatch: ' + name)
        assets[name] = {'path': str(path), 'sha256': actual, 'bytes': path.stat().st_size,
                        'manifest_verified': bool(manifest)}
    return assets


def verify(directory, manifest=None):
    assets = release_assets(directory, manifest)
    checks = []
    processes = []
    with build_workspace() as temporary:
        temporary = Path(temporary)
        environment = dict(os.environ, PROCUREMENT_ISSUER_PASSWORD='Ephemeral-release-test-password')
        for name in ('license-issuer.exe', 'license-bound.exe'):
            home = temporary / name.removesuffix('.exe')
            home.mkdir()
            shutil.copy2(assets[name]['path'], home / name)

        def run(name, arguments, expected_exit=0):
            home = temporary / name.removesuffix('.exe')
            environment.update(PROCUREMENT_ISSUER_HOME=str(home / 'keys'),
                               PROCUREMENT_ISSUER_DIAGNOSTIC=str(home / 'startup-diagnostic.json'))
            log = home / 'process.log'
            started = time.monotonic()
            with log.open('wb') as output:
                for attempt in range(12):
                    try:
                        process = subprocess.Popen([str(home / name), *arguments], cwd=home,
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
                    print(json.dumps(startup_diagnostics(process.pid, temporary)), flush=True)
                    if os.name == 'nt':
                        subprocess.run(['taskkill', '/PID', str(process.pid), '/T', '/F'],
                            capture_output=True, creationflags=subprocess.CREATE_NO_WINDOW)
                    else:
                        process.kill()
                    process.wait(timeout=10)
                    raise
            if exit_code != expected_exit:
                diagnostic = home / 'startup-diagnostic.json'
                if diagnostic.is_file():
                    print(diagnostic.read_text(encoding='utf-8'), flush=True)
                print(log.read_text(encoding='utf-8', errors='replace'), flush=True)
                raise AssertionError(f'{name} {arguments[0]} returned {exit_code}, expected {expected_exit}')
            checks.append(name + ' ' + arguments[0])
            processes.append({'asset': name, 'arguments': [str(a).replace(str(temporary), '<temporary>') for a in arguments],
                              'exit_code': exit_code, 'expected_exit': expected_exit,
                              'elapsed_seconds': round(time.monotonic() - started, 3)})
            print(checks[-1], flush=True)

        def check(name, condition):
            if not condition:
                raise AssertionError(name)
            checks.append(name)

        # Each frozen executable must initialize a fresh identity itself.
        for name in assets:
            home = temporary / name.removesuffix('.exe')
            target = home / '中文应用目录'
            run(name, ['--self-test'], 2)
            run(name, ['--init', '--target', str(target)])
            keyfiles = [home / 'keys' / f'license_{kind}_key.pem' for kind in ('private', 'public')]
            original_keys = [p.read_bytes() for p in keyfiles]
            check(name + ' initializes encrypted private key and exports public key',
                  b'ENCRYPTED PRIVATE KEY' in original_keys[0] and target.joinpath('license_public_key.pem').read_bytes() == original_keys[1])
            run(name, ['--sign', '--target', str(target), '--org', 'Synthetic acceptance', '--days', '365'])
            document = json.loads((target / 'license.dat').read_text('utf-8'))
            from cryptography.hazmat.primitives.serialization import load_pem_public_key
            import base64
            canonical = json.dumps(document['payload'], ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
            load_pem_public_key(original_keys[1]).verify(base64.b64decode(document['signature']), canonical)
            check(name + ' issued license signature verifies with its exported public key', True)
            run(name, ['--init', '--resume', '--target', str(home / '继续导出')])
            check(name + ' reuses existing key pair unchanged',
                  original_keys == [p.read_bytes() for p in keyfiles] and (home / '继续导出/license_public_key.pem').read_bytes() == original_keys[1])
            before = (target / 'license.dat').read_bytes()
            run(name, ['--sign', '--target', str(target), '--org', 'Synthetic acceptance', '--permanent'], 0)
            check(name + ' signs again with existing keys',
                  original_keys == [p.read_bytes() for p in keyfiles] and (target / 'license.dat').read_bytes() != before)
            before = (target / 'license.dat').read_bytes()
            environment['PROCUREMENT_ISSUER_PASSWORD'] = 'deliberately-wrong-password'
            run(name, ['--sign', '--target', str(target), '--org', 'Rejected', '--permanent'], 2)
            environment['PROCUREMENT_ISSUER_PASSWORD'] = 'Ephemeral-release-test-password'
            check(name + ' rejected sign preserves existing license', (target / 'license.dat').read_bytes() == before)
            if name == 'license-bound.exe':
                config = home / 'issuer-config.json'
                value = json.loads(config.read_text(encoding='utf-8'))
                value['volume_serial'] = 'FFFFFFFF' if value['volume_serial'] != 'FFFFFFFF' else '00000001'
                config.write_text(json.dumps(value), encoding='utf-8')
                run(name, ['--sign', '--target', str(target), '--org', 'Rejected', '--permanent'], 2)
                check(name + ' wrong disk rejection preserves existing license and keys',
                      (target / 'license.dat').read_bytes() == before and original_keys == [p.read_bytes() for p in keyfiles])
    return {'schema_version': 2, 'status': 'passed', 'tested_at': datetime.now(timezone.utc).isoformat(),
            'passed': len(checks), 'checks': checks, 'processes': processes, 'assets': assets,
            'synthetic_data_only': True, 'production_data_accessed': False, 'release_private_keys_accessed': False,
            'native_desktop_verified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--manifest')
    parser.add_argument('--report')
    arguments = parser.parse_args()
    try:
        report = verify(arguments.directory, arguments.manifest)
    except Exception as error:
        report = {'status': 'failed', 'error': str(error), 'native_desktop_verified': False}
        if arguments.report:
            Path(arguments.report).parent.mkdir(parents=True, exist_ok=True)
            Path(arguments.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
        raise
    if arguments.report:
        Path(arguments.report).parent.mkdir(parents=True, exist_ok=True)
        Path(arguments.report).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps(report, indent=2))
