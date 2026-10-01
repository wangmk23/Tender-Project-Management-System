"""Exercise the public EXE with a new identity and blank isolated data."""
from pathlib import Path
import argparse
import json
import os
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'authorization'))
import license_issuer
from tests.test_stage_template_packaged_e2e import PackagedClient, METHODS, unused_port


def verify(candidate):
    checks = []
    original_spawn = subprocess.Popen
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        with patch.dict(os.environ, {'PM_TEST_LICENSE_DIR': str(temp / 'empty-fixtures'), 'PROCUREMENT_ISSUER_HOME': str(temp / 'keys')}):
            client = PackagedClient(Path(candidate).resolve(), temp, 'public', unused_port())
            client.password = '123456'
            license_issuer.initialize_keys('temporary-verification-password', client.data_root)
            license_issuer.issue(target_dir=client.data_root, organization='示例单位', expires=None, password='temporary-verification-password')
            log = (temp / 'startup.log').open('wb')
            def spawn(args, **kwargs):
                kwargs['env'].pop('PROJECT_MGR_ADMIN_PASSWORD', None)
                kwargs['env'].pop('PROJECT_MGR_LICENSE_REQUIRED', None)
                kwargs['stdout'] = kwargs['stderr'] = log
                return original_spawn([args[0], '--headless'], **kwargs)
            try:
                with patch.object(subprocess, 'Popen', side_effect=spawn):
                    client.start()
                    checks.append('initial admin/123456 login with password override unset')
                    assert client.request('GET', '/api/projects') == []
                    checks.append('initial project database empty')
                    assert client.request('GET', '/api/license/status')['status'] == 'valid'
                    checks.append('self-generated license accepted')
                    settings = client.request('GET', '/api/settings')
                    assert settings['login_subtitle'] == '采购项目管理系统'
                    checks.append('neutral system settings load')
                    for method in METHODS:
                        created = client.create_project(method, str(METHODS.index(method)))
                        detail = client.get_project(created['id'])
                        assert detail['method'] == method and detail['stages']
                        checks.append('create project and stages: ' + method)
                    changed = client.request('POST', '/api/me/change-password', {'old_password': '123456', 'new_password': 'Verification-new-password'})
                    assert changed['ok']
                    client.password = 'Verification-new-password'
                    client.restart()
                    assert len(client.request('GET', '/api/projects')) == len(METHODS)
                    checks.append('changed administrator password and projects survive restart')
            except Exception:
                log.flush()
                print((temp / 'startup.log').read_text('utf-8', errors='replace')[-5000:], file=sys.stderr)
                raise
            finally:
                client.stop()
                log.close()
    return {'checks': checks, 'count': len(checks), 'production_data_accessed': False, 'native_desktop_verified': False}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    result = verify(args.candidate)
    Path(args.report).write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps(result, ensure_ascii=False, indent=2))
