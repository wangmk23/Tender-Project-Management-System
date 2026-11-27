"""Supplier result uploads through the assembled Flask app and isolated file storage."""
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from threading import Barrier
from unittest.mock import patch

from werkzeug.security import generate_password_hash

from src.backend_patches import procurement_api, special_result_files
from src.project_manager.standalone_app import create_app


class SpecialResultFilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = create_app(data_dir=Path(self.tmp.name), public_unrestricted=True)
        self.ctx = self.app.extensions['runtime_context']
        self.db = self.ctx['db']
        self.addCleanup(self.close_db)
        if 'special_result_attachments' not in self.app.view_functions:
            special_result_files.register(self.app, self.db, dict(self.ctx), procurement_api.authorize)
        with self.app.app_context():
            user = self.ctx['User'](username='tester', password_hash=generate_password_hash('testing-pw'),
                                    is_active=True, is_admin=True)
            self.db.session.add(user)
            self.db.session.commit()
        self.client = self.app.test_client()
        self.client.post('/login', data={'username': 'tester', 'password': 'testing-pw'})
        self.headers = {'X-CSRFToken': self.client.post('/api/csrf-refresh').json['csrf_token']}
        response = self.client.post('/api/projects', headers=self.headers, json={
            'number': 'PRICE-FILES', 'name': '报价文件测试', 'method': '公开招标',
            'purchaser': '测试采购人', 'year': 2026})
        self.assertEqual(response.status_code, 201, response.json)
        self.pid = response.json['id']
        self.rids = []
        for name in ['甲供应商', '乙供应商']:
            response = self.client.post(f'/api/projects/{self.pid}/registrations', headers=self.headers,
                                        json={'company_name': name, 'registration_method': '线上报名'})
            self.assertEqual(response.status_code, 201, response.json)
            self.rids.append(response.json['id'])
        # The business module tests exercise saved_entry. Supply its answer for two
        # package scopes so attachment isolation can be exercised independently.
        def member(db, models, project, lot, rid):
            return {'registration_id': rid} if (project.id == self.pid and lot in (None, 1)
                                                and rid in self.rids) else None
        self.membership = self.enterContext(patch.object(special_result_files, '_saved_entry', side_effect=member))
        self.folder = Path(self.ctx['UPLOAD_FOLDER']) / str(self.pid)

    def close_db(self):
        with self.app.app_context():
            self.db.session.remove()
            self.db.engine.dispose()

    def url(self, rid, lot=''):
        return f'/api/projects/{self.pid}/special-results/registrations/{rid}/attachments?lot_id={lot}'

    def upload(self, rid, files, lot=''):
        response = self.client.post(self.url(rid, lot), headers=self.headers, data={
            'files': [(BytesIO(data), filename) for filename, data in files]})
        response.request.environ['wsgi.input'].close()
        return response

    def test_encrypted_upload_download_retries_and_supplier_isolation(self):
        self.ctx.set_symbol('DATA_ENCRYPTION_ENABLED', True)
        a, b = self.rids
        files = [('报价.txt', b'A-price-120')]
        first = self.upload(a, files + files)
        self.assertEqual(first.status_code, 200, first.json)
        items = first.json['attachments']
        self.assertEqual(len(items), 1)
        self.assertEqual(self.upload(a, files).json['attachments'], items)
        self.assertEqual(self.client.get(self.url(b)).json['attachments'], [])
        self.assertEqual(self.client.get(self.url(a, 1)).json['attachments'], [])
        other = self.upload(b, files).json['attachments'][0]
        lot = self.upload(a, files, 1).json['attachments'][0]
        self.assertEqual(len({items[0]['id'], other['id'], lot['id']}), 3)
        self.assertEqual(len(list(self.folder.iterdir())), 3)
        for path in self.folder.iterdir():
            self.assertTrue(self.ctx['is_encrypted_file'](path))
        with self.client.get(f"/api/attachments/{items[0]['id']}/download") as download:
            self.assertEqual(download.status_code, 200)
            self.assertEqual(download.data, files[0][1])

    def test_simultaneous_uploads_keep_one_row_and_one_file(self):
        url = self.url(self.rids[0])
        cookie = self.client.get_cookie(self.app.config['SESSION_COOKIE_NAME'])
        writers = Barrier(2)
        encrypt = self.ctx['_encrypt_uploaded_file']

        def synchronize(path):
            encrypt(path)
            writers.wait(timeout=10)

        def post(_):
            client = self.app.test_client()
            client.set_cookie(cookie.key, cookie.value)
            response = client.post(url, headers=self.headers, data={'files': (BytesIO(b'120'), '报价.txt')})
            self.assertEqual(response.status_code, 200, response.json)
            return response.json['attachments']

        self.ctx.set_symbol('_encrypt_uploaded_file', synchronize)
        with ThreadPoolExecutor(max_workers=2) as pool:
            first, second = pool.map(post, range(2))
        self.assertEqual(first, second)
        self.assertEqual(len(first), 1)
        self.assertEqual(len(list(self.folder.iterdir())), 1)

    def test_batch_validation_membership_and_rollback(self):
        a, _ = self.rids
        files = [('报价.txt', b'valid'), ('报价.pdf', b'invalid')]
        self.assertEqual(self.upload(a, files).status_code, 400)
        self.assertEqual(self.upload(4242, files[:1]).status_code, 404)
        self.assertEqual(self.upload(a, files[:1], 2).status_code, 404)
        self.assertEqual(self.client.get(self.url(a, 'bad')).status_code, 400)
        self.membership.side_effect = [True, None]
        self.assertEqual(self.upload(a, files[:1]).status_code, 409)
        self.assertEqual(list(self.folder.iterdir()), [])
        with self.app.app_context():
            self.assertEqual(self.ctx['Attachment'].query.count(), 0)

    def test_soft_deleted_file_is_hidden_and_can_be_reuploaded(self):
        a = self.rids[0]
        files = [('报价.txt', b'price')]
        item = self.upload(a, files).json['attachments'][0]
        removed = self.client.delete(f"/api/attachments/{item['id']}", headers=self.headers, json={})
        self.assertEqual(removed.status_code, 200, removed.json)
        self.assertEqual(self.client.get(self.url(a)).json['attachments'], [])
        replacement = self.upload(a, files).json['attachments']
        self.assertEqual(len(replacement), 1)
        self.assertNotEqual(replacement[0]['id'], item['id'])

    def test_csrf_and_configured_upload_limit(self):
        a = self.rids[0]
        self.assertIn(self.client.post(self.url(a)).status_code, (400, 403))
        limit = self.client.patch('/api/settings/upload-limit', headers=self.headers, json={'max_file_size_mb': 1})
        self.assertEqual(limit.status_code, 200, limit.json)
        self.assertEqual(self.upload(a, [('报价.txt', b'x' * (1048576 + 1))]).status_code, 413)
        self.assertEqual(self.client.get(self.url(a)).json['attachments'], [])
