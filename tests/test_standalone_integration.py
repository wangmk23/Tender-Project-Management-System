"""Exercise the assembled source application, not only its registry."""
import tempfile
import unittest
from pathlib import Path
from werkzeug.security import generate_password_hash
from src.project_manager.standalone_app import create_app


class StandaloneIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.app = create_app(data_dir=Path(self.tmp.name), public_unrestricted=True)
        self.ctx = self.app.extensions['runtime_context']
        self.db = self.ctx['db']
        with self.app.app_context():
            user = self.ctx['User'](username='tester', password_hash=generate_password_hash('testing-password'), is_active=True, is_admin=True)
            self.db.session.add(user)
            self.db.session.commit()
        self.client = self.app.test_client()
        self.assertEqual(self.client.post('/login', data={'username':'tester','password':'testing-password'}).status_code, 302)

    def tearDown(self):
        with self.app.app_context():
            self.db.session.remove()
            self.db.engine.dispose()
        self.tmp.cleanup()

    def test_authenticated_workspace_renders_and_supplies_csrf(self):
        response = self.client.get('/')
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'window.CSRF_TOKEN', response.data)
        with self.client.session_transaction() as session:
            self.assertTrue(session.get('csrf_token'))

    def test_empty_project_list_works_in_package_import_mode(self):
        response = self.client.get('/api/projects')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), [])

    def test_missing_csrf_is_rejected_before_business_validation(self):
        response = self.client.post('/api/projects', json={})
        self.assertIn(response.status_code, (400, 403))
        self.assertIn('刷新', response.get_json()['error'])

    def test_security_headers_and_cookie_policy(self):
        response = self.client.get('/login')
        self.assertEqual(response.headers.get('X-Content-Type-Options'), 'nosniff')
        self.assertEqual(self.app.config.get('SESSION_COOKIE_SAMESITE'), 'Lax')

    def test_business_modules_are_reachable(self):
        routes = {r.rule for r in self.app.url_map.iter_rules()}
        for path in ('/api/procurement-methods', '/api/settings/backup', '/api/import/projects', '/api/import/templates'):
            with self.subTest(path=path):
                self.assertIn(path, routes)

    def test_project_create_read_and_registration(self):
        self.client.get('/')
        with self.client.session_transaction() as session:
            headers = {'X-CSRFToken': session['csrf_token']}
        response = self.client.post('/api/projects', json={
            'number':'TEST-001', 'name':'隔离验收项目', 'purchaser':'测试单位',
            'method':'公开招标', 'year':2026, 'budget':'100000'}, headers=headers)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        project = response.get_json()
        self.assertTrue(project['stages'])
        self.assertTrue(project['stages'][0]['key'])
        pid = project['id']
        response = self.client.get(f'/api/projects/{pid}')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        response = self.client.get('/api/projects')
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(len(response.get_json()), 1)
        response = self.client.post(f'/api/projects/{pid}/registrations', json={
            'company_name':'虚构供应商', 'registration_method':'线上报名'}, headers=headers)
        self.assertEqual(response.status_code, 201, response.get_data(as_text=True))
        for path in (f'/api/projects/{pid}/registrations', f'/api/projects/{pid}/tender-guarantee',
                     f'/api/projects/{pid}/deadlines', '/api/stats', '/api/calendar', '/api/settings'):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200, response.get_data(as_text=True))

    def test_license_gate_blocks_business_reads(self):
        self.ctx.set_symbol('LICENSE_REQUIRED', True)
        self.ctx.set_symbol('current_license_status', lambda **kwargs: dict(mode='blocked',status='missing',message='需要授权',device_code='test'))
        self.assertEqual(self.client.get('/api/projects').status_code, 423)


class FirstUseTests(unittest.TestCase):
    def test_setup_requires_local_csrf_then_persists_account_and_session_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            app = create_app(data_dir=Path(tmp), public_unrestricted=True)
            client = app.test_client()
            try:
                self.assertEqual(client.get('/login').location, '/setup')
                self.assertEqual(client.get('/setup', environ_overrides={'REMOTE_ADDR':'192.0.2.1'}).status_code, 403)
                self.assertEqual(client.post('/setup', data={'username':'admin','password':'test-password-123'}).status_code, 400)
                self.assertEqual(client.get('/setup').status_code, 200)
                with client.session_transaction() as session:
                    token = session['setup_token']
                response = client.post('/setup', data={'username':'admin','password':'test-password-123','token':token})
                self.assertEqual(response.status_code, 302, response.get_data(as_text=True))
                self.assertEqual(client.post('/login', data={'username':'admin','password':'test-password-123'}).status_code, 302)
                self.assertEqual(client.get('/api/me').status_code, 200)
                self.assertNotIn(b'password_hash', client.get('/api/me').data)
                second = create_app(data_dir=Path(tmp), public_unrestricted=True)
                try:
                    self.assertEqual(app.secret_key, second.secret_key)
                    self.assertIn('/api/import/projects', {r.rule for r in second.url_map.iter_rules()})
                    self.assertEqual(second.test_client().get('/setup').location, '/login')
                finally:
                    with second.app_context():
                        second.extensions['runtime_context']['db'].session.remove()
                        second.extensions['runtime_context']['db'].engine.dispose()
            finally:
                with app.app_context():
                    app.extensions['runtime_context']['db'].session.remove()
                    app.extensions['runtime_context']['db'].engine.dispose()


if __name__ == '__main__':
    unittest.main()
