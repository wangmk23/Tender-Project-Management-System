"""Account policies use synthetic SQLite only; optional frozen fixtures are hash pinned."""
import hashlib
import importlib.util
import os
from pathlib import Path
import secrets
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

from flask import Flask, jsonify, request, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from werkzeug.security import generate_password_hash


class AccountPermissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.frozen = {}
        if os.environ.get('PM_SOURCE_EXE'):
            path = Path(os.environ['PM_SOURCE_EXE'])
            if hashlib.sha256(path.read_bytes()).hexdigest() != os.environ.get('PM_SOURCE_EXE_SHA256'):
                raise RuntimeError('hash-pinned frozen fixture mismatch')
            from PyInstaller.archive.readers import CArchiveReader
            code = CArchiveReader(str(path)).open_embedded_archive('PYZ.pyz').extract('app')
            cls.frozen = {c.co_name: c for c in code.co_consts if isinstance(c, types.CodeType)}

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.app = Flask(__name__)
        self.app.config.update(SECRET_KEY='synthetic-only', TESTING=True,
                               SQLALCHEMY_DATABASE_URI='sqlite:///' + self.temp.name + '/test.db')
        self.db = SQLAlchemy(self.app)
        def dispose():
            with self.app.app_context():
                self.db.session.remove()
                self.db.engine.dispose()
        self.addCleanup(dispose)
        db = self.db
        if self.frozen:
            namespace = {'db': db, '__name__': __name__}
            User = types.new_class('User', (db.Model,), exec_body=lambda ns: exec(self.frozen['User'], namespace, ns))
        else:
            class User(db.Model):
                __tablename__ = 'users'
                id = db.Column(db.Integer, primary_key=True)
                username = db.Column(db.String(80), unique=True, nullable=False)
                password_hash = db.Column(db.String(200), nullable=False)
                is_admin = db.Column(db.Boolean, default=False)
                is_active = db.Column(db.Boolean, default=True)
                display_name = db.Column(db.String(80), default='')
                def to_dict(self):
                    return {k: getattr(self, k) for k in ('id', 'username', 'display_name', 'is_admin', 'is_active')}
        self.User = User
        env = dict(request=request, session=session, jsonify=jsonify, secrets=secrets)
        # Use the real frozen CSRF gate when the pinned source is supplied.
        if self.frozen:
            self.app.before_request(types.FunctionType(self.frozen['protect_api_writes'], env))
        else:
            @self.app.before_request
            def csrf():
                if request.method in ('POST', 'PUT', 'PATCH', 'DELETE'):
                    if session.get('csrf_token') != request.headers.get('X-CSRFToken'):
                        return jsonify(error='csrf'), 400
        self.mode = 'full'
        if self.frozen:
            license_env = dict(env, LICENSE_REQUIRED=True,
                               current_license_status=lambda: {'mode': self.mode, 'message': 'synthetic license',
                                                                'status': 'synthetic', 'device_code': 'fake'})
            self.app.before_request(types.FunctionType(self.frozen['enforce_product_license'], license_env))
        else:
            @self.app.before_request
            def license_gate():
                if self.mode == 'blocked' or self.mode == 'read_only' and request.method != 'GET':
                    return jsonify(error='license'), 403
        self.calls = []
        def called(**kwargs):
            self.calls.append(request.path)
            return jsonify(ok=True)
        for path, endpoint, methods in [
            ('/api/users', 'api_create_user', ['POST']),
            ('/api/users/<int:uid>', 'api_update_user', ['PUT']),
            ('/api/users/<int:uid>', 'api_delete_user', ['DELETE']),
            ('/api/users/<int:uid>/reset-password', 'api_reset_password', ['POST']),
            ('/api/projects', 'api_create_project', ['POST']),
            ('/api/projects/<int:pid>', 'api_update_project', ['PUT']),
            ('/api/projects/<int:pid>', 'api_delete_project', ['DELETE']),
            ('/api/projects/<int:pid>/registrations/import', 'api_import_registrations', ['POST']),
            ('/api/projects/<int:pid>/attachments', 'api_upload_attachment', ['POST']),
            ('/api/projects/<int:pid>/complaints/<int:cid>/events/<int:eid>/attachments', 'api_upload_complaint_event_attachments', ['POST']),
            ('/api/projects/<int:pid>/registrations', 'api_get_registrations', ['GET']),
            ('/api/projects/<int:pid>/stages/<stage_key>', 'api_update_stage', ['PUT']),
            ('/api/attachments/<int:aid>', 'api_modify_attachment', ['PUT', 'DELETE']),
            ('/api/attachments/<int:aid>/save-local', 'api_save_attachment_local', ['POST']),
            ('/api/attachments/<int:aid>/download', 'api_download_attachment', ['GET']),
            ('/api/attachments/<int:aid>/view', 'api_view_attachment', ['GET']),
            ('/api/batch/advance-stage', 'api_batch_advance_stage', ['POST']),
            ('/api/import/projects', 'api_import_projects', ['POST']),
            ('/api/import/templates', 'api_import_templates', ['GET']),
            ('/api/export', 'api_export', ['GET']),
            ('/api/settings', 'api_update_settings', ['PATCH']),
            ('/api/settings/backup', 'backup_settings', ['GET', 'PUT']),
            ('/api/settings/backup/choose', 'backup_choose', ['POST']),
            ('/api/settings/backup/open', 'backup_open', ['POST']),
            ('/api/data-recovery/export', 'data_recovery_export', ['POST']),
            ('/api/future-write', 'unknown_write', ['POST']),
        ]:
            self.app.add_url_rule(path, endpoint, called, methods=methods)
        self.app.add_url_rule('/api/system-info', 'api_system_info', lambda: jsonify(version='fixture'))
        self.app.add_url_rule('/api/users', 'api_list_users',
                              lambda: jsonify([u.to_dict() for u in User.query.all()]))
        with self.app.app_context():
            db.create_all()
            db.session.add_all([User(id=i, username=name, password_hash=generate_password_hash('password!'),
                                    is_admin=admin, is_active=True)
                                for i, name, admin in [(1, 'admin', True), (2, 'editor', False), (3, 'other-admin', True)]])
            db.session.commit()
        self.assertIsNotNone(importlib.util.find_spec('src.backend_patches.account_permissions'),
                             'server account permissions module is required')
        from src.backend_patches import account_permissions as permissions
        self.permissions = permissions
        validator = (types.FunctionType(self.frozen['_validate_username'], {}) if self.frozen
                     else lambda value: None if 2 <= len(value) <= 32 else 'invalid username')
        permissions.register(self.app, db, {'User': User, 'validate_username': validator})
        self.client = self.login(1)

    def login(self, uid):
        client = self.app.test_client()
        with client.session_transaction() as state:
            state.update(user_id=uid, is_admin=True, username='stale', csrf_token='synthetic-csrf')
        return client

    def call(self, path, method='GET', payload=None, client=None, csrf=True):
        return (client or self.client).open(path, method=method, json=payload,
                    headers={'X-CSRFToken': 'synthetic-csrf'} if csrf else {})

    def update(self, payload, uid=2):
        return self.call('/api/users/' + str(uid), 'PUT', payload)

    def test_legacy_accounts_keep_existing_capabilities_and_serialize(self):
        value = self.call('/api/account-permissions', client=self.login(2)).json
        self.assertEqual(value['role'], 'editor')
        self.assertEqual(value['permissions'], dict(create_projects=True, edit_projects=True,
                         delete_projects=False, manage_attachments=True, export_data=True))
        self.assertEqual(self.call('/api/system-info', client=self.login(2)).json['account'], value)
        self.assertEqual(self.call('/api/users').json[1]['role'], 'editor')
        admin = self.call('/api/account-permissions').json
        self.assertEqual(admin['role'], 'admin')
        self.assertTrue(all(admin['permissions'].values()))

    def test_viewer_rejects_direct_business_writes_exports_and_unknown_writes(self):
        self.assertEqual(self.update({'role': 'viewer'}).status_code, 200)
        client = self.login(2)
        for method, path in [('POST', '/api/projects'), ('PUT', '/api/projects/7'),
              ('DELETE', '/api/projects/7'), ('POST', '/api/batch/advance-stage'),
              ('POST', '/api/projects/7/attachments'), ('POST', '/api/import/projects'),
              ('POST', '/api/projects/7/registrations/import'), ('GET', '/api/export'),
              ('GET', '/api/import/templates?save=1'), ('POST', '/api/attachments/1/save-local'),
              ('PATCH', '/api/settings'), ('POST', '/api/data-recovery/export'), ('POST', '/api/future-write')]:
            with self.subTest(path=path):
                response = self.call(path, method, {}, client)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(response.json['code'], 'PERMISSION_DENIED')
                self.assertEqual(response.json['account']['role'], 'viewer')
        self.assertEqual(self.calls, [])
        for path in ['/api/attachments/1/view', '/api/attachments/1/download?preview=1']:
            self.assertEqual(self.call(path, client=client).status_code, 200)

    def test_editor_overrides_are_independent_and_revocation_refreshes_live_session(self):
        self.assertEqual(self.update({'permissions': {'edit_projects': False, 'delete_projects': True}}).status_code, 200)
        client = self.login(2)
        for method, path, status in [('POST', '/api/projects', 200), ('PUT', '/api/projects/1', 403),
                ('DELETE', '/api/projects/1', 200), ('POST', '/api/projects/1/attachments', 200),
                ('POST', '/api/projects/1/registrations/import', 403)]:
            self.assertEqual(self.call(path, method, {}, client).status_code, status)
        self.update({'permissions': {'create_projects': False}})
        self.assertEqual(self.call('/api/projects', 'POST', {}, client).status_code, 403)
        with self.app.app_context():
            self.db.session.get(self.User, 2).is_active = False
            self.db.session.commit()
        self.assertEqual(self.call('/api/attachments/1/view', client=client).status_code, 401)

    def test_readonly_can_be_given_export_but_cannot_write_or_administer(self):
        self.assertEqual(self.update({'role': 'viewer', 'permissions': {'export_data': True}}).status_code, 200)
        client = self.login(2)
        self.assertEqual(self.call('/api/export', client=client).status_code, 200)
        self.assertEqual(self.call('/api/projects', 'POST', {}, client).status_code, 403)
        self.assertEqual(self.call('/api/users/2', 'PUT', {'role': 'admin'}, client).status_code, 403)
        self.assertEqual(self.call('/api/settings', 'PATCH', {}, client).status_code, 403)

    def test_export_query_cannot_bypass_business_write_caps(self):
        self.assertEqual(self.update({'role': 'viewer', 'permissions': {'export_data': True}}).status_code, 200)
        client = self.login(2)
        for path, method in [('/api/projects?save=1', 'POST'), ('/api/projects/7?save=1', 'DELETE'),
                             ('/api/projects/7/stages/test?save=1', 'PUT'),
                             ('/api/projects/7/attachments?save=1', 'POST'),
                             ('/api/import/projects?save=1', 'POST')]:
            with self.subTest(path=path):
                self.assertEqual(self.call(path, method, {}, client).status_code, 403)
        self.assertEqual(self.calls, [])

    def test_registration_download_export_and_get_save_require_export_permission(self):
        self.assertEqual(self.update({'permissions': {'export_data': False}}).status_code, 200)
        client = self.login(2)
        for method in ('GET', 'HEAD'):
            for path in ('/api/projects/7/registrations?export=1',
                         '/api/projects/7/registrations?export=1&save=1', '/api/export?save=1'):
                with self.subTest(method=method, path=path):
                    self.assertEqual(self.call(path, method, client=client).status_code, 403)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.call('/api/projects/7/registrations', client=client).status_code, 200)

    def test_ordinary_attachment_download_requires_export_but_preview_remains_readable(self):
        self.assertEqual(self.update({'role':'viewer'}).status_code,200)
        client=self.login(2)
        for method in ('GET','HEAD'):
            self.assertEqual(self.call('/api/attachments/1/download',method,client=client).status_code,403)
            self.assertEqual(self.call('/api/attachments/1/download?preview=1',method,client=client).status_code,200)
        self.assertEqual(self.update({'permissions':{'export_data':True}}).status_code,200)
        self.assertEqual(self.call('/api/attachments/1/download',client=client).status_code,200)

    def test_attachment_permission_is_independent_from_project_edit(self):
        self.assertEqual(self.update({'permissions': {'edit_projects': False}}).status_code, 200)
        client = self.login(2)
        paths = [('/api/projects/7/attachments', 'POST'), ('/api/attachments/1', 'PUT'),
                 ('/api/attachments/1', 'DELETE'),
                 ('/api/projects/7/complaints/2/events/3/attachments', 'POST')]
        for path, method in paths:
            self.assertEqual(self.call(path, method, {}, client).status_code, 200)
        self.assertEqual(self.update({'permissions': {'manage_attachments': False, 'edit_projects': True}}).status_code, 200)
        self.calls.clear()
        for path, method in paths:
            self.assertEqual(self.call(path, method, {}, client).status_code, 403)
        self.assertEqual(self.calls, [])
        self.assertEqual(self.call('/api/attachments/1/view', client=client).status_code, 200)

    def test_all_backup_settings_routes_require_current_admin(self):
        client = self.login(2)
        for path, method in [('/api/settings/backup', 'GET'), ('/api/settings/backup', 'PUT'),
                             ('/api/settings/backup/choose', 'POST'), ('/api/settings/backup/open', 'POST')]:
            self.assertEqual(self.call(path, method, {}, client).status_code, 403)
            self.assertEqual(self.call(path, method, {}).status_code, 200)

    def test_project_get_preserves_uninitialized_legacy_rows_for_readonly_accounts(self):
        from datetime import datetime
        import sys
        from sqlalchemy import event
        from sqlalchemy.orm import selectinload
        from src.backend_patches import app_replacements, lot_supplier_risk, stage_templates
        db = self.db
        class Project(db.Model):
            __tablename__ = 'projects'
            id = db.Column(db.Integer, primary_key=True)
            method = db.Column(db.String, default='公开招标')
            stages = db.relationship('Stage')
            lots = db.relationship('Lot')
            registrations = db.relationship('Registration')
            def ensure_workflow_defaults(self):
                if not self.stages:
                    self.stages.append(Stage(stage_key='legacy'))
            def to_dict(self):
                return {'id': self.id, 'method': self.method,
                        'stages': [{'key': row.stage_key} for row in self.stages]}
        class Stage(db.Model):
            __tablename__ = 'stages'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            stage_key = db.Column(db.String)
        class Lot(db.Model):
            __tablename__ = 'project_lots'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
        class Registration(db.Model):
            __tablename__ = 'supplier_registrations'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
        with self.app.app_context():
            db.create_all()
            db.session.add_all([Project(id=1), Project(id=2), Project(id=3)])
            stage_templates.ensure_v5_snapshot_schema(db.session, text)
            stage_templates.ensure_online_bidding_scope(db.session, text)
            lot_supplier_risk.ensure_schema(db)
            db.session.commit()
        env = dict(app=self.app, db=db, Project=Project, request=request, session=session,
                   selectinload=selectinload, text=text, datetime=datetime, jsonify=jsonify,
                   load_app_settings=lambda: {'stage_templates': {'synthetic': []}})
        handler = types.FunctionType(app_replacements.api_project.__code__, env)
        self.app.add_url_rule('/api/projects/<int:pid>', 'api_project', handler)
        self.assertEqual(self.update({'role': 'viewer'}).status_code, 200)
        client = self.login(2)
        commits = []
        def committed(session):
            commits.append(True)
        event.listen(db.session.session_factory.class_, 'after_commit', committed)
        try:
            with patch.dict(sys.modules, lot_supplier_risk=lot_supplier_risk, account_permissions=self.permissions):
                response = self.call('/api/projects/1', client=client)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.json['stages'], [])
                self.assertEqual(commits, [])
                with self.app.app_context():
                    self.assertEqual(Stage.query.count(), 0)
                self.assertEqual(self.update({'role': 'editor', 'permissions': {'edit_projects': False}}).status_code, 200)
                commits.clear()
                self.assertEqual(self.call('/api/projects/1', client=client).json['stages'], [])
                self.assertEqual(commits, [])
                self.assertEqual(self.update({'permissions': {'edit_projects': True}}).status_code, 200)
                commits.clear()
                self.assertEqual(len(self.call('/api/projects/1', client=client).json['stages']), 1)
                self.assertEqual(commits, [True])
                # Old source-only callers without the extension retain migration behavior.
                extension = self.app.extensions.pop('account_permissions')
                try:
                    with self.app.test_request_context('/api/projects/2'):
                        self.assertEqual(len(handler(2).json['stages']), 1)
                finally:
                    self.app.extensions['account_permissions'] = extension
                with self.app.app_context():
                    self.assertEqual(Stage.query.count(), 2)
        finally:
            event.remove(db.session.session_factory.class_, 'after_commit', committed)

    def test_only_explicit_delete_project_can_pass_existing_admin_decorator(self):
        from src.backend_patches import app_replacements
        import sys
        with patch.dict(sys.modules, account_permissions=self.permissions):
            env = dict(db=self.db, User=self.User, request=request, session=session, jsonify=jsonify)
            guard = types.FunctionType(app_replacements.admin_required.__code__, env)
            for endpoint, path, permission, expected in [('api_delete_project', '/api/projects/1', False, 403),
                    ('api_delete_project', '/api/projects/1', True, 200),
                    ('api_update_settings', '/api/settings', True, 403)]:
                self.update({'permissions': {'delete_projects': permission}})
                with self.app.test_request_context(path, method='DELETE'):
                    request.url_rule = types.SimpleNamespace(endpoint=endpoint)
                    session.update(user_id=2, is_admin=True)
                    self.assertEqual(self.app.make_response(guard(lambda: jsonify(ok=True))()).status_code, expected)

    def test_strict_payloads_never_mutate_user_or_policy(self):
        for payload in [[], {'role': 'owner'}, {'role': None}, {'permissions': []},
                        {'permissions': {'future': True}}, {'is_admin': 'false'}, {'is_active': 1},
                        {'role': 'viewer', 'is_admin': True}, {'role': 'viewer', 'permissions': {'edit_projects': True}},
                        {'display_name': None}, {'password': 123}]:
            self.assertEqual(self.update(payload).status_code, 400, payload)
        for value in ['false', 0, 1, None, [], {}]:
            self.assertEqual(self.update({'permissions': {'edit_projects': value}}).status_code, 400)
        self.assertEqual(self.call('/api/account-permissions', client=self.login(2)).json['role'], 'editor')

    def test_old_client_and_name_only_updates_preserve_custom_policy(self):
        self.update({'role': 'viewer', 'permissions': {'export_data': True}})
        before = self.call('/api/account-permissions', client=self.login(2)).json
        for payload in [{'display_name': '新名字'}, {'is_admin': False}, {'username': 'renamed'}]:
            self.assertEqual(self.update(payload).status_code, 200)
            self.assertEqual(self.call('/api/account-permissions', client=self.login(2)).json, before)

    def test_create_duplicate_delete_and_id_reuse_do_not_inherit_policy(self):
        payload = dict(username='new-user', password='password!', role='viewer')
        response = self.call('/api/users', 'POST', payload)
        self.assertEqual(response.status_code, 201)
        uid = response.json['id']
        self.assertEqual(response.json['role'], 'viewer')
        self.assertEqual(self.call('/api/users', 'POST', dict(payload, role='admin')).status_code, 400)
        self.assertEqual(self.call('/api/users/' + str(uid), 'DELETE').status_code, 200)
        response = self.call('/api/users', 'POST', dict(username='replacement', password='password!'))
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json['id'], uid)
        self.assertEqual(response.json['role'], 'editor')

    def test_policy_persistence_failure_rolls_back_user_create_and_update(self):
        from sqlalchemy import event
        def fail(connection, cursor, statement, parameters, context, executemany):
            if statement.lower().startswith(('insert into account_permissions', 'update account_permissions')):
                raise RuntimeError('synthetic disk failure')
        with self.app.app_context():
            engine = self.db.engine
        event.listen(engine, 'before_cursor_execute', fail)
        try:
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.update({'display_name': 'must rollback', 'role': 'viewer'}).status_code, 500)
                self.assertEqual(self.call('/api/users', 'POST', dict(username='failed-user', password='password!', role='viewer')).status_code, 500)
        finally:
            event.remove(engine, 'before_cursor_execute', fail)
        with self.app.app_context():
            self.assertEqual(self.db.session.get(self.User, 2).display_name, '')
            self.assertIsNone(self.User.query.filter_by(username='failed-user').first())

    def test_failed_update_preserves_the_previous_policy_and_password(self):
        self.assertEqual(self.update({'role': 'viewer', 'permissions': {'export_data': True}}).status_code, 200)
        with self.app.app_context():
            old_hash = self.db.session.get(self.User, 2).password_hash
        from sqlalchemy import event
        def fail(connection, cursor, statement, parameters, context, executemany):
            if statement.lower().startswith('insert into account_permissions'):
                raise RuntimeError('synthetic disk failure')
        with self.app.app_context():
            engine = self.db.engine
        event.listen(engine, 'before_cursor_execute', fail)
        try:
            with self.assertLogs(self.app.logger, level='ERROR'):
                self.assertEqual(self.update({'role': 'admin', 'password': 'new-password!', 'username': 'new-name'}).status_code, 500)
        finally:
            event.remove(engine, 'before_cursor_execute', fail)
        value = self.call('/api/account-permissions', client=self.login(2)).json
        self.assertEqual(value['role'], 'viewer')
        self.assertTrue(value['permissions']['export_data'])
        with self.app.app_context():
            user = self.db.session.get(self.User, 2)
            self.assertEqual(user.username, 'editor')
            self.assertEqual(user.password_hash, old_hash)
            self.assertFalse(user.is_admin)

    def test_corrupt_policy_fails_closed_without_rewriting_legacy_account(self):
        self.assertEqual(self.update({'role': 'viewer'}).status_code, 200)
        for role, value in [('viewer', '{}'), ('viewer', 'not-json'), ('owner', '{}')]:
            with self.app.app_context():
                self.db.session.execute(text('UPDATE account_permissions SET role=:role, permissions=:value WHERE user_id=2'),
                                        {'role': role, 'value': value})
                self.db.session.commit()
            client = self.login(2)
            account = self.call('/api/account-permissions', client=client).json
            self.assertEqual(account['role'], 'viewer')
            self.assertFalse(any(account['permissions'].values()))
            self.assertEqual(self.call('/api/projects', 'POST', {}, client).status_code, 403)
        with self.app.app_context():
            self.assertFalse(self.db.session.get(self.User, 2).is_admin)

    def test_demoted_and_deleted_admin_sessions_lose_authority_immediately(self):
        client = self.login(3)
        self.assertEqual(self.call('/api/users', client=client).status_code, 200)
        self.assertEqual(self.update({'role': 'editor'}, 3).status_code, 200)
        for path, method in [('/api/users', 'GET'), ('/api/users/2/reset-password', 'POST'),
                             ('/api/settings/backup', 'GET')]:
            self.assertEqual(self.call(path, method, {}, client).status_code, 403)
        self.assertEqual(self.call('/api/users/3', 'DELETE').status_code, 200)
        self.assertEqual(self.call('/api/projects', 'POST', {}, client).status_code, 401)
        with client.session_transaction() as state:
            self.assertEqual(dict(state), {})

    def test_self_and_last_active_admin_guards_and_csrf_and_license_survive(self):
        for payload in [{'role': 'editor'}, {'is_admin': False}, {'is_active': False}]:
            self.assertEqual(self.update(payload, 1).status_code, 400)
        self.assertEqual(self.call('/api/users/1', 'DELETE').status_code, 400)
        self.assertEqual(self.update({'is_active': False}, 3).status_code, 200)
        self.assertEqual(self.call('/api/users', 'POST', {}, csrf=False).status_code, 400)
        self.mode = 'blocked'
        self.assertEqual(self.call('/api/account-permissions').status_code, 423 if self.frozen else 403)
        self.mode = 'read_only'
        self.assertEqual(self.update({'display_name': 'blocked'}).status_code, 423 if self.frozen else 403)

    def test_disabled_admin_serialization_and_reactivation_preserve_role(self):
        self.assertEqual(self.update({'is_active': False}, 3).status_code, 200)
        users = self.call('/api/users').json
        self.assertEqual(users[2]['role'], 'admin')
        response = self.update({'is_active': True}, 3)
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json['is_admin'])

    def concurrent_mutual_admin_removal(self, operation):
        barrier = threading.Barrier(2)
        results = []
        def worker(actor, target):
            client = self.login(actor)
            barrier.wait(timeout=10)
            response = self.call('/api/users/' + str(target),
                                 'DELETE' if operation == 'delete' else 'PUT',
                                 {'role': 'editor'} if operation == 'demote' else {'is_active': False}, client)
            results.append(response.status_code)
        threads = [threading.Thread(target=worker, args=args) for args in [(1, 3), (3, 1)]]
        for thread in threads: thread.start()
        for thread in threads: thread.join(timeout=20)
        self.assertEqual(len(results), 2)
        self.assertEqual(sorted(results), [200, 401 if operation in ('delete', 'disable') else 403])
        with self.app.app_context():
            self.assertEqual(self.User.query.filter_by(is_admin=True, is_active=True).count(), 1)

    def test_concurrent_mutual_demotion_cannot_remove_all_active_admins(self):
        self.concurrent_mutual_admin_removal('demote')

    def test_concurrent_mutual_disabling_cannot_remove_all_active_admins(self):
        self.concurrent_mutual_admin_removal('disable')

    def test_concurrent_mutual_deletion_cannot_remove_all_active_admins(self):
        self.concurrent_mutual_admin_removal('delete')


if __name__ == '__main__':
    unittest.main()
