import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from flask import Flask, jsonify, request, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from src.backend_patches import project_record_versions


class ProjectVersionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = Flask(__name__)
        self.app.config.update(SECRET_KEY='synthetic', SQLALCHEMY_DATABASE_URI='sqlite:///' + str(Path(self.tmp.name) / 'test.db'))
        self.db = SQLAlchemy(self.app)
        with self.app.app_context():
            self.db.session.execute(text('CREATE TABLE projects(id INTEGER PRIMARY KEY,name TEXT,budget TEXT)'))
            self.db.session.execute(text('CREATE TABLE stages(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,notes TEXT,completed INTEGER)'))
            self.db.session.execute(text("INSERT INTO projects VALUES(1,'原名称','按实际结算')"))
            self.db.session.execute(text("INSERT INTO stages VALUES(1,1,'prepare','原备注',0)"))
            self.db.session.commit()

        def authorized(models, **kwargs):
            return (None, None) if session.get('user_id') else (None, (jsonify(error='请先登录'), 401))
        project_record_versions.register(self.app, self.db, {}, authorized)

        def payload():
            value = dict(self.db.session.execute(text('SELECT * FROM projects WHERE id=1')).mappings().one())
            value['stages'] = [dict(row) | {'key': row['stage_key']} for row in self.db.session.execute(text('SELECT * FROM stages WHERE project_id=1')).mappings()]
            return value
        @self.app.get('/api/projects')
        def projects(): return jsonify([payload()])
        @self.app.get('/api/projects/<int:pid>')
        def project(pid): return jsonify(payload())
        @self.app.put('/api/projects/<int:pid>')
        def save_project(pid):
            self.db.session.execute(text('UPDATE projects SET name=:name WHERE id=:pid'), dict(name=request.json['name'], pid=pid))
            self.db.session.commit()
            return jsonify(payload())
        @self.app.put('/api/projects/<int:pid>/stages/<key>')
        def save_stage(pid, key):
            self.db.session.execute(text('UPDATE stages SET notes=:notes WHERE project_id=:pid AND stage_key=:key'), dict(notes=request.json['notes'], pid=pid, key=key))
            self.db.session.commit()
            return jsonify(payload())
        self.client = self.client_for_user()

    def client_for_user(self):
        client = self.app.test_client()
        with client.session_transaction() as state: state.update(user_id=1, is_admin=True)
        return client

    def tearDown(self):
        with self.app.app_context(): self.db.session.remove(); self.db.engine.dispose()
        self.tmp.cleanup()

    def test_stale_project_and_stage_writes_are_rejected_and_tokens_are_refreshed(self):
        original = self.client.get('/api/projects/1').json
        self.assertTrue(original['record_version'])
        saved = self.client.put('/api/projects/1', json=dict(name='第一份修改', record_version=original['record_version']))
        self.assertEqual(saved.status_code, 200)
        self.assertNotEqual(saved.json['record_version'], original['record_version'])
        self.assertEqual(saved.json['record_version_base'], original['record_version'])
        conflict = self.client.put('/api/projects/1', json=dict(name='过期修改', record_version=original['record_version']))
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json['code'], 'RECORD_VERSION_CONFLICT')
        stage_token = original['stages'][0]['record_version']
        self.assertEqual(self.client.put('/api/projects/1/stages/prepare', json=dict(notes='最新备注', record_version=stage_token)).status_code, 200)
        self.assertEqual(self.client.put('/api/projects/1/stages/prepare', json=dict(notes='过期备注', record_version=stage_token)).status_code, 409)
        self.assertEqual(self.client.get('/api/projects/1').json['stages'][0]['notes'], '最新备注')

    def test_simultaneous_writes_with_the_same_snapshot_have_one_winner(self):
        version = self.client.get('/api/projects').json[0]['record_version']
        def write(name): return self.client_for_user().put('/api/projects/1', json=dict(name=name, record_version=version)).status_code
        with ThreadPoolExecutor(max_workers=2) as pool: statuses = list(pool.map(write, ['窗口一', '窗口二']))
        self.assertEqual(sorted(statuses), [200, 409])

    def test_legacy_write_changes_the_snapshot_seen_by_new_clients(self):
        original = self.client.get('/api/projects/1').json
        self.assertEqual(self.client.put('/api/projects/1', json=dict(name='旧客户端修改')).status_code, 200)
        self.assertEqual(self.client.put('/api/projects/1', json=dict(name='过期新客户端', record_version=original['record_version'])).status_code, 409)

    def test_guard_does_not_expose_versions_to_an_unauthenticated_writer(self):
        response = self.app.test_client().put('/api/projects/1', json=dict(name='未登录', record_version='stale'))
        self.assertEqual(response.status_code, 401)
        self.assertNotIn('current_record_version', response.json)


if __name__ == '__main__': unittest.main()
