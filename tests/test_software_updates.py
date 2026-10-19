import functools
import importlib.util
import json
import marshal
from pathlib import Path
import unittest
from unittest.mock import patch

from flask import Flask, jsonify, session

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location('software_updates', ROOT/'src/backend_patches/software_updates.py')
updates = importlib.util.module_from_spec(SPEC); SPEC.loader.exec_module(updates)
CONFIG = {'enabled': True, 'owner': 'example', 'repository': 'manager'}


class SoftwareUpdatesTests(unittest.TestCase):
    def client(self, config=CONFIG, opener=lambda _url: True):
        app = Flask(__name__); app.secret_key = 'isolated-test-only'
        def login_required(fn):
            @functools.wraps(fn)
            def wrapped(*args, **kwargs):
                if not session.get('user_id'): return jsonify(error='请先登录'), 401
                return fn(*args, **kwargs)
            return wrapped
        updates.register(app, login_required, config=config, browser_opener=opener)
        updates.register(app, login_required, config=config, browser_opener=opener)
        client = app.test_client()
        with client.session_transaction() as s: s['user_id'] = 1
        return client

    def test_config_is_read_only_and_contains_no_credentials(self):
        client = self.client(dict(CONFIG, token='must-not-be-returned'))
        data = client.get('/api/software-updates/source').get_json()
        self.assertTrue(data['configured']); self.assertEqual(data['owner'], 'example')
        self.assertNotIn('token',data); self.assertNotIn('must-not-be-returned',json.dumps(data))

    def test_missing_disabled_and_invalid_configuration(self):
        for config in [{},{'enabled':False},dict(CONFIG,owner='../bad'),dict(CONFIG,repository='https://evil.invalid'),dict(CONFIG,repository='..')]:
            result=self.client(config).get('/api/software-updates/source').get_json()
            self.assertEqual(result,{'configured':False,'message':'尚未配置更新源'})

    def test_authentication_is_required(self):
        client=self.client()
        with client.session_transaction() as s:s.clear()
        self.assertEqual(client.get('/api/software-updates/source').status_code,401)
        self.assertEqual(client.get('/api/software-updates/current-changelog').status_code,401)
        self.assertEqual(client.post('/api/software-updates/open-release',json={'tag':'v1.0.0'}).status_code,401)

    def test_local_release_opens_only_the_configured_github_page(self):
        calls=[];client=self.client(opener=lambda url:calls.append(url) or True)
        result=client.post('/api/software-updates/open-release',json={'tag':'v5.8.42-public','url':'file:///C:/secret'})
        self.assertEqual(result.status_code,200)
        self.assertEqual(calls,['https://github.com/example/manager/releases/tag/v5.8.42-public'])

    def test_remote_browser_cannot_open_the_server_desktop(self):
        calls=[];client=self.client(opener=lambda url:calls.append(url) or True)
        result=client.post('/api/software-updates/open-release',json={'tag':'v1.0.0'},environ_overrides={'REMOTE_ADDR':'192.168.1.10'})
        self.assertEqual(result.status_code,403);self.assertEqual(calls,[])

    def test_bad_input_missing_source_and_browser_failure(self):
        for payload in [None,[],{}, {'tag':''},{'tag':'bad\nversion'},{'tag':'a'*129}]:
            self.assertEqual(self.client().post('/api/software-updates/open-release',json=payload).status_code,400)
        self.assertEqual(self.client({}).post('/api/software-updates/open-release',json={'tag':'v1.0.0'}).status_code,400)
        result=self.client(opener=lambda _url:False).post('/api/software-updates/open-release',json={'tag':'v1.0.0'})
        self.assertEqual(result.status_code,503);self.assertIn('默认浏览器',result.get_json()['error'])

    def test_tag_cannot_inject_an_external_scheme_or_query(self):
        source=updates.update_source(CONFIG)
        url=updates.release_page(source,'javascript:alert(1)?x=1&y=2')
        self.assertTrue(url.startswith('https://github.com/example/manager/releases/tag/'))
        self.assertNotIn('?',url);self.assertNotIn('&',url)

    def test_package_config_is_embedded_and_frozen_runtime_does_not_read_a_developer_path(self):
        from tools.compile_module_patches import compile_software_updates
        code=marshal.loads(compile_software_updates(ROOT/'src/backend_patches/software_updates.py'))
        namespace={'__file__':'X:/not-a-source-tree/software_updates.py'}
        exec(code,namespace)
        package=json.loads((ROOT/'package.json').read_text(encoding='utf-8'))
        self.assertEqual(namespace['update_source']()['repository'],package['softwareUpdates']['repository'])
        expected=(ROOT/f"docs/releases/notes/v{package['version']}-public.md").read_text('utf-8').strip()
        with patch.object(updates.sys,'frozen',True,create=True):
            notes=namespace['current_changelog']()
            self.assertEqual(notes['version'],'v'+package['version'])
            self.assertEqual(notes['body'],expected)
        with patch.object(updates.sys,'frozen',True,create=True),patch.object(updates,'BUNDLED_UPDATE_CONFIG',None):
            self.assertEqual(updates.update_source(),{'configured':False,'message':'尚未配置更新源'})

    def test_local_notes_independent_of_update_source_and_frozen_developer_paths(self):
        package=json.loads((ROOT/'package.json').read_text('utf-8'))
        notes=self.client({}).get('/api/software-updates/current-changelog').get_json()
        self.assertTrue(notes['available']);self.assertEqual(notes['version'],'v'+package['version'])
        with patch.object(updates.sys,'frozen',True,create=True),patch.object(updates,'BUNDLED_CURRENT_CHANGELOG',None):
            self.assertEqual(updates.current_changelog(),{'available':False,'message':'当前版本更新日志暂不可用'})


if __name__=='__main__':unittest.main()
