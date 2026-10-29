"""Hash-pinned public EXE installation, synthetic upgrade and offline restore checks.

Native windows, display scaling and a real working computer require manual acceptance.
No production directories or signing keys are needed by this CLI.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import sys
import tempfile
from unittest.mock import patch
import zipfile

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port

VERSION = 'v5.8.53'
FIXTURE_FILES = ('license.dat', 'license_public_key.pem', '.license_state.bin')
MANUAL_PENDING = [
    {'id': 'native-window', 'status': 'pending', 'reason': '原生窗口启动、最小化、托盘、退出须人工操作；本工具仅 --headless。'},
    {'id': 'display-scaling', 'status': 'pending', 'reason': '100/125/150/200% Windows 缩放及多屏须人工检查。'},
    {'id': 'working-computer', 'status': 'pending', 'reason': '未触碰实际在用电脑或原数据库；仅合成历史数据。'},
]


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def pinned_asset(path, sha256):
    path = Path(path).resolve()
    actual = digest(path)
    if actual != sha256.lower():
        raise ValueError(f'SHA256 mismatch for {path.name}: expected {sha256}, got {actual}')
    return {'path': str(path), 'sha256': actual, 'bytes': path.stat().st_size}


def business_facts(value):
    """v53 adds computed views and edit tokens; compare all persisted facts."""
    omitted = {'record_version', 'record_version_base', 'business_deadline_summary', 'business_deadline_alerts'}
    if isinstance(value, dict):
        return {k: business_facts(v) for k, v in value.items() if k not in omitted}
    if isinstance(value, list):
        return [business_facts(v) for v in value]
    return value


@contextmanager
def initial_password_and_enforced_license():
    original = subprocess.Popen

    def spawn(args, **kwargs):
        environment = kwargs['env']
        environment.pop('PROJECT_MGR_ADMIN_PASSWORD', None)
        environment['PROJECT_MGR_LICENSE_REQUIRED'] = '1'
        return original(args, **kwargs)

    with patch.object(subprocess, 'Popen', side_effect=spawn):
        yield


def client_for(candidate, temporary, label, fixtures):
    client = PackagedClient(Path(candidate), temporary, label, unused_port())
    client.password = '123456'
    for filename in FIXTURE_FILES:
        source = fixtures / filename
        if source.is_file():
            shutil.copy2(source, client.data_root / filename)
    # Keep even the application's scheduled output inside this owned test tree.
    settings = {'backup_folder': str(client.data_root / 'backups'), 'reminder_enabled': False,
                'reminder_recipient_groups': [], 'event_reminder_create_enabled': False,
                'event_reminder_complete_enabled': False, 'supplier_shortage_email_enabled': False,
                'smtp_host': '', 'smtp_username': '', 'smtp_password': '', 'email_recipients': []}
    (client.data_root / 'app_settings.json').write_text(json.dumps(settings), 'utf-8')
    return client


def port_closed(client):
    with socket.socket() as probe:
        probe.settimeout(1)
        return probe.connect_ex(('127.0.0.1', client.port)) != 0


def snapshot(data_root, archive):
    """Stopped-process file backup, including generated encryption keys and files."""
    hashes = {}
    with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
        for source in sorted(data_root.rglob('*')):
            relative = source.relative_to(data_root)
            if source.is_file() and 'backups' not in relative.parts:
                output.write(source, relative.as_posix())
                hashes[relative.as_posix()] = digest(source)
    return hashes


def restore_snapshot(archive, data_root, hashes):
    with zipfile.ZipFile(archive) as source:
        if set(source.namelist()) != set(hashes):
            raise ValueError('Backup inventory mismatch')
        for name in source.namelist():
            target = (data_root / name).resolve()
            if not target.is_relative_to(data_root.resolve()):
                raise ValueError('Backup path escapes owned data directory')
            source.extract(name, data_root)
    if any(digest(data_root / name) != value for name, value in hashes.items()):
        raise ValueError('Restored file hash mismatch')


def verify(candidate, sha256, license_fixtures, baseline, baseline_sha256, output,
           expected_version=VERSION, baseline_version='v5.8.52'):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    report_path = output / 'installation.json'
    report = {'schema_version': 1, 'version': expected_version, 'baseline_version': baseline_version, 'status': 'failed', 'checks': [],
              'tested_at': datetime.now(timezone.utc).isoformat(), 'manual_pending': MANUAL_PENDING,
              'native_desktop_verified': False, 'synthetic_data_only': True,
              'production_data_accessed': False, 'running_program_restarted': False,
              'release_private_keys_accessed': False,
              'backup_restore_method': 'stopped-process full data-directory ZIP, restored to a separate owned directory'}

    def check(name, condition=True):
        report['checks'].append({'name': name, 'status': 'passed' if condition else 'failed'})
        if not condition:
            raise AssertionError(name)
        print('PASS: ' + name, flush=True)

    try:
        report['candidate'] = pinned_asset(candidate, sha256)
        report['baseline'] = pinned_asset(baseline, baseline_sha256)
        fixtures = Path(license_fixtures).resolve()
        for name in FIXTURE_FILES[:2]:
            if not (fixtures / name).is_file():
                raise FileNotFoundError('Public synthetic fixture requires ' + name)
        report['license_fixture_sha256'] = {name: digest(fixtures / name) for name in FIXTURE_FILES if (fixtures / name).is_file()}
        check('candidate and baseline executable SHA256 pinned before launch')
        # TemporaryDirectory is outside source/Git, never an existing runtime directory.
        with tempfile.TemporaryDirectory(prefix='pm-install-owned-') as folder:
            temporary = Path(folder)
            clients = []
            with patch.dict(os.environ, {'PM_TEST_LICENSE_DIR': str(fixtures)}), initial_password_and_enforced_license():
                try:
                    fresh = client_for(candidate, temporary, '首次部署中文路径', fixtures)
                    clients.append(fresh)
                    check('first deployment starts with no existing database', not (fresh.data_root / 'bidding.db').exists())
                    fresh.start()
                    check('initial admin/123456 login without password environment override')
                    check('running system-info and health report ' + expected_version,
                          fresh.request('GET', '/api/system-info')['version'] == expected_version and fresh.request('GET', '/health')['version'] == expected_version)
                    check('first-run public license is valid with license enforcement enabled', fresh.request('GET', '/api/license/status')['status'] == 'valid')
                    check('first-run project database is empty', fresh.request('GET', '/api/projects') == [])
                    fresh.request('POST', '/api/me/change-password', {'old_password': '123456', 'new_password': 'Synthetic-install-Pass-2026!'})
                    fresh.password = 'Synthetic-install-Pass-2026!'
                    fresh.stop()
                    check('owned headless process closes and releases HTTP port', port_closed(fresh))
                    fresh.start()
                    check('changed administrator password survives close and restart', fresh.request('GET', '/api/projects') == [])
                    fresh.stop()

                    upgraded = client_for(baseline, temporary, '合成历史数据升级', fixtures)
                    clients.append(upgraded)
                    upgraded.start()
                    check('baseline actually runs ' + baseline_version, upgraded.request('GET', '/health')['version'] == baseline_version)
                    skipped = upgraded.request('POST', '/api/projects', {'number': 'SYN-52-001', 'name': '合成无需保证金历史项目', 'method': '公开招标', 'budget': '按实际结算', 'no_deposit': True})
                    closed = upgraded.request('POST', '/api/projects', {'number': 'SYN-52-002', 'name': '合成已关闭历史项目', 'method': '公开招标', 'budget': '上限另定'})
                    upgraded.request('PUT', f'/api/projects/{closed["id"]}', {'is_terminated': True, 'terminated_type': 'terminated', 'terminated_reason': '合成历史终止'})
                    attachment_bytes = '合成附件，不含真实业务数据。'.encode('utf-8')
                    response = upgraded.session.post(upgraded.base_url + f'/api/projects/{skipped["id"]}/attachments',
                        files={'files': ('synthetic.txt', attachment_bytes, 'text/plain')},
                        data={'description': '合成历史附件'}, headers={'X-CSRFToken': upgraded.csrf_token}, timeout=20)
                    response.raise_for_status()
                    attachment = upgraded.request('GET', f'/api/projects/{skipped["id"]}/attachments')[0]
                    ids = [skipped['id'], closed['id']]
                    before = {pid: upgraded.get_project(pid) for pid in ids}
                    check('synthetic baseline includes skipped stages, closed project and attachment',
                          any(s.get('skipped') for s in before[skipped['id']]['stages']) and before[closed['id']]['is_terminated'])
                    upgraded.stop()
                    shutil.copy2(candidate, upgraded.executable)
                    check('replacement executable matches published candidate SHA256', digest(upgraded.executable) == sha256.lower())
                    upgraded.start()
                    after = {pid: upgraded.get_project(pid) for pid in ids}
                    check('upgraded process actually runs ' + expected_version, upgraded.request('GET', '/health')['version'] == expected_version)
                    check('upgrade preserves all project and stage business facts', business_facts(before) == business_facts(after))
                    check('historical closed-project timeline remains unchanged', before[closed['id']]['project_timeline'] == after[closed['id']]['project_timeline'])
                    check('historical projects gain edit tokens', all(len(row.get('record_version', '')) == 64 for row in after.values()))
                    def download(client):
                        result = client.session.get(client.base_url + f'/api/attachments/{attachment["id"]}/download', timeout=15)
                        result.raise_for_status()
                        return result.content
                    check('historical encrypted attachment remains readable after upgrade', download(upgraded) == attachment_bytes)
                    upgraded.restart()
                    check('upgraded database survives another close and restart', business_facts(after) == business_facts({pid: upgraded.get_project(pid) for pid in ids}))
                    upgraded.stop()
                    archive = temporary / 'synthetic-offline-backup.zip'
                    hashes = snapshot(upgraded.data_root, archive)
                    report['backup'] = {'sha256': digest(archive), 'file_count': len(hashes), 'created_while_stopped': port_closed(upgraded)}
                    check('offline backup contains database, generated keys and uploaded files',
                          report['backup']['created_while_stopped'] and 'bidding.db' in hashes and len(hashes) >= 5)
                    restored = client_for(candidate, temporary, '备份恢复中文路径', fixtures)
                    clients.append(restored)
                    restore_snapshot(archive, restored.data_root, hashes)
                    check('separate restored directory matches every backup file SHA256')
                    # Rebase only the synthetic backup output path after exact restore verification.
                    settings_path = restored.data_root / 'app_settings.json'
                    settings = json.loads(settings_path.read_text('utf-8'))
                    settings['backup_folder'] = str(restored.data_root / 'backups')
                    settings_path.write_text(json.dumps(settings, ensure_ascii=False), 'utf-8')
                    restored.start()
                    check('restored database and business facts load on published ' + expected_version,
                          restored.request('GET', '/health')['version'] == expected_version and business_facts(after) == business_facts({pid: restored.get_project(pid) for pid in ids}))
                    check('restored encryption keys decrypt historical attachment', download(restored) == attachment_bytes)
                    check('restored license remains valid', restored.request('GET', '/api/license/status')['status'] == 'valid')
                    restored.stop()
                    check('all owned test process ports closed', all(port_closed(client) for client in clients))
                finally:
                    for client in clients:
                        client.stop()
                        log = client.root / 'startup.log'
                        if log.is_file():
                            shutil.copy2(log, output / (client.root.name + '-startup.log'))
        report['status'] = 'automated_passed_manual_pending'
    except Exception as error:
        report['error'] = f'{type(error).__name__}: {error}'
    finally:
        report['passed'] = sum(row['status'] == 'passed' for row in report['checks'])
        report['total'] = len(report['checks'])
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('candidate', 'sha256', 'license-fixtures', 'baseline', 'baseline-sha256', 'output'):
        parser.add_argument('--' + name, required=True)
    parser.add_argument('--expected-version', default=VERSION)
    parser.add_argument('--baseline-version', default='v5.8.52')
    args = parser.parse_args()
    result = verify(args.candidate, args.sha256, args.license_fixtures, args.baseline, args.baseline_sha256, args.output,
                    args.expected_version, args.baseline_version)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(1 if result['status'] == 'failed' else 0)
