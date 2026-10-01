"""Isolated regressions for the 2026-10-01 backend review."""
import io
import json
import unittest
import zipfile
import tempfile
from pathlib import Path
from unittest.mock import patch
from types import SimpleNamespace

from tests.test_online_bidding import OnlineBiddingApiTests
from tests.test_data_import import workbook_from_rows
from src.backend_patches import data_import, stage_templates
from src.backend_patches import app_replacements


class ReviewedBiddingApiTests(OnlineBiddingApiTests):
    def test_multiple_custom_modules_require_all_responsibilities(self):
        self.enroll()
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key='combined', modules_json=json.dumps(['online_bidding', 'service_fee']))]
        self.Project.registrations = [SimpleNamespace(id=1, company_name='甲', lot_id=None)]
        data = dict(start_at='2026-09-01T09:00', end_at='2026-09-01T12:00', registration_end='2026-08-31T18:00', roster_locked=True, verified=True, ended_at='2026-09-01T10:00', end_reason='all_quoted', evidence='平台记录', records=[dict(registration_id=1, review='approved', amount='10', quoted_at='2026-09-01T10:00')])
        saved = self.client.put('/api/projects/1/online-bidding', json={'revision': 0, 'data': data}, headers=self.headers)
        self.assertEqual(saved.status_code, 200, saved.json)
        response = self.client.put('/api/projects/1/stages/combined', json={'completed': True}, headers=self.headers)
        self.assertEqual(response.status_code, 400, response.json)
        self.assertIn('到账', response.json['error'])

    def test_custom_quote_uses_sql_snapshot_when_original_model_has_no_module_attribute(self):
        from sqlalchemy import text
        self.enroll()
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key='custom_quote')]
        with self.app.app_context():
            self.db.session.execute(text('CREATE TABLE stages (id INTEGER PRIMARY KEY, project_id INTEGER, stage_key TEXT)'))
            stage_templates.replace_v5_project_stage_snapshot(self.db.session, text, 1, [dict(id='custom_quote', name='自定义报价', modules=['common', 'online_bidding'])])
            self.db.session.commit()
        response = self.client.put('/api/projects/1/stages/custom_quote', json={'completed': True}, headers=self.headers)
        self.assertEqual(response.status_code, 400, response.json)

    def test_custom_quote_module_enforces_stage_result_and_batch_guards(self):
        self.enroll()
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key='custom_quote', modules_json=json.dumps(['common', 'online_bidding']))]
        response = self.client.put('/api/projects/1/stages/custom_quote', json={'completed': True}, headers=self.headers)
        self.assertEqual(response.status_code, 400, response.json)
        self.assertEqual(self.client.post('/api/projects/1/bid-results', json={}, headers=self.headers).status_code, 400)
        self.assertEqual(self.client.post('/api/batch/advance-stage', json={'project_ids': [1]}, headers=self.headers).status_code, 400)

    def test_first_tie_resolution_can_be_added_but_cannot_be_corrected_while_verified(self):
        self.enroll()
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key='online_quotation', completed=True)]
        self.Project.registrations = [SimpleNamespace(id=i, company_name=name, lot_id=None) for i, name in [(1, '甲'), (2, '乙')]]
        data = dict(start_at='2026-09-01T09:00', end_at='2026-09-01T12:00', registration_end='2026-08-31T18:00', roster_locked=True, verified=True, ended_at='2026-09-01T10:00', end_reason='all_quoted', evidence='平台记录', records=[dict(registration_id=i, review='approved', amount='10', quoted_at='2026-09-01T10:00') for i in [1, 2]])
        path = '/api/projects/1/online-bidding'
        first = self.client.put(path, json={'revision': 0, 'data': data}, headers=self.headers)
        self.assertEqual(first.status_code, 200, first.json)
        data['resolutions'] = [dict(lot_id=None, registration_id=2, note='平台同价处理凭证001')]
        resolved = self.client.put(path, json={'revision': 1, 'data': data, 'reason': '首次登记平台同价处理'}, headers=self.headers)
        self.assertEqual(resolved.status_code, 200, resolved.json)
        self.assertEqual(resolved.json['summary']['lots'][0]['winner'], '乙')
        data['resolutions'][0]['registration_id'] = 1
        corrected = self.client.put(path, json={'revision': 2, 'data': data, 'reason': '更正成交方'}, headers=self.headers)
        self.assertEqual(corrected.status_code, 400, corrected.json)
        history = self.client.get(path).json['history']
        self.assertEqual(len(history), 2)
        self.assertEqual(history[1]['payload']['resolutions'], [])
        data['resolutions'][0]['registration_id'] = 2
        self.Project.bid_results = [SimpleNamespace(lot_id=None, winning_supplier='乙', winning_amount='10.00')]
        data.update(publication_done=True, publication_url='https://example.com/result', publication_date='2026-09-02T10:00')
        published = self.client.put(path, json={'revision': 2, 'data': data, 'reason': '登记公示'}, headers=self.headers)
        self.assertEqual(published.status_code, 200, published.json)
        self.assertEqual(self.client.put('/api/projects/1/stages/result_announced', json={'completed': True}, headers=self.headers).status_code, 200)


class ReviewedImportTests(unittest.TestCase):
    def setUp(self):
        import sys
        templates_context = patch.dict(sys.modules, {'stage_templates': stage_templates})
        templates_context.start()
        self.addCleanup(templates_context.stop)
        from flask import Flask
        from flask_sqlalchemy import SQLAlchemy
        self.app = Flask(__name__)
        self.app.config.update(SECRET_KEY='isolated', SQLALCHEMY_DATABASE_URI='sqlite://')
        self.db = SQLAlchemy(self.app)
        db = self.db
        class Project(db.Model):
            __tablename__ = 'projects'
            id = db.Column(db.Integer, primary_key=True)
            number = db.Column(db.String)
            name = db.Column(db.String)
            method = db.Column(db.String)
            purchaser = db.Column(db.String)
            prepare_owner = db.Column(db.String)
            review_owner = db.Column(db.String)
            budget = db.Column(db.Float)
            year = db.Column(db.Integer)
            no_deposit = db.Column(db.Boolean)
            notes = db.Column(db.String)
            checklist_items = db.relationship('Checklist', cascade='all, delete-orphan')
            def ensure_workflow_defaults(self):
                if not self.checklist_items:
                    self.checklist_items.append(Checklist(title='默认清单'))
        class Checklist(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            title = db.Column(db.String)
        class Stage(db.Model):
            __tablename__ = 'stages'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer)
            stage_key = db.Column(db.String)
            completed = db.Column(db.Boolean, server_default='0')
            skipped = db.Column(db.Boolean, server_default='0')
            completed_date = db.Column(db.String)
        self.Project, self.Stage, self.Checklist = Project, Stage, Checklist
        self.templates = {m: [dict(id='custom_quote' if m == '网上竞价' else 'first', name=m+'开始', modules=['common', 'online_bidding'] if m == '网上竞价' else ['common'], icon='•')] for m in stage_templates.PROCUREMENT_METHODS}
        data_import._build_import_routes(self.app, db, dict(Project=Project, ProjectLot=None, SupplierRegistration=None, load_app_settings=lambda: {'stage_templates': self.templates}, METHODS=stage_templates.PROCUREMENT_METHODS, STAGES=[]))
        with self.app.app_context():
            db.create_all()
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session['user_id'] = 1

    def upload(self, raw):
        return self.client.post('/api/import/projects', data={'file': (io.BytesIO(raw), 'import.xlsx')})

    def test_import_initializes_each_method_snapshot_without_enrolling_history(self):
        from sqlalchemy import text
        rows = [[str(i), method, method] for i, method in enumerate(stage_templates.PROCUREMENT_METHODS)]
        raw = workbook_from_rows('项目', ['项目编号', '项目名称', '采购方式'], rows)
        response = self.upload(raw)
        self.assertEqual(response.json['success'], len(rows), response.json)
        with self.app.app_context():
            self.assertEqual(self.Stage.query.count(), len(rows))
            self.assertEqual(self.Checklist.query.count(), len(rows))
            for project in self.Project.query.all():
                stages = self.db.session.execute(text('SELECT stage_key,modules_json FROM stages WHERE project_id=:id'), {'id': project.id}).all()
                self.assertEqual(stages[0][0], self.templates[project.method][0]['id'])
                self.assertIn('common', json.loads(stages[0][1]))
                self.assertFalse(stage_templates.online_bidding_enabled(self.db.session, text, project.id))

    def test_invalid_xlsx_returns_format_error(self):
        raw = io.BytesIO()
        with zipfile.ZipFile(raw, 'w') as archive:
            archive.writestr('other.txt', 'not a workbook')
        response = self.upload(raw.getvalue())
        self.assertEqual(response.status_code, 400)
        self.assertIn('格式', response.json['error'])

    def test_nonfinite_budget_is_rejected_with_row_and_column(self):
        for value in ['NaN', 'Infinity', '1e309', '1e308万']:
            with self.subTest(value=value):
                raw = workbook_from_rows('项目', ['项目编号', '项目名称', '预算金额'], [[value, '测试', value]])
                response = self.upload(raw)
                self.assertEqual(response.json['success'], 0, response.json)
                self.assertEqual(response.json['errors'][0]['column'], '预算金额')
                self.assertEqual(response.json['errors'][0]['row'], 6)

    def test_snapshot_failure_rolls_back_project_and_allows_next_row(self):
        original = stage_templates.initialize_project_workflow
        def initialize(*args, **kwargs):
            result = original(*args, **kwargs)
            if args[2].number == 'bad':
                raise ValueError('snapshot failure')
            return result
        raw = workbook_from_rows('项目', ['项目编号', '项目名称', '采购方式'], [['bad', '失败', '公开招标'], ['good', '成功', '公开招标']])
        with patch.object(stage_templates, 'initialize_project_workflow', side_effect=initialize):
            response = self.upload(raw)
        self.assertEqual(response.json.get('success'), 1, response.json)
        with self.app.app_context():
            self.assertEqual([p.number for p in self.Project.query.all()], ['good'])
            self.assertEqual(self.Stage.query.count(), 1)
            self.assertEqual(self.Checklist.query.count(), 1)


class ReviewedSettingsTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name) / 'settings.json'
        self.path.write_text(json.dumps({'stage_templates': {'kept': True}, 'backup_time': '18:00'}), encoding='utf-8')
        self.context = patch.multiple(app_replacements, SETTINGS_PATH=self.path,
            load_app_settings=lambda: json.loads(self.path.read_text(encoding='utf-8')), create=True)
        self.context.start()
        self.addCleanup(self.context.stop)

    def test_replace_failure_keeps_original_settings_and_cleans_temporary(self):
        before = self.path.read_bytes()
        with patch('os.replace', side_effect=OSError('injected failure')):
            with self.assertRaises(OSError):
                app_replacements.save_app_settings({'backup_time': '19:00'})
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob('*.tmp')), [])

    def test_flush_failure_keeps_original_file(self):
        before = self.path.read_bytes()
        with patch('os.fsync', side_effect=OSError('injected flush failure')):
            with self.assertRaises(OSError):
                app_replacements.save_app_settings({'backup_time': '19:00'})
        self.assertEqual(self.path.read_bytes(), before)
        self.assertEqual(list(self.path.parent.glob('*.tmp')), [])

    def test_replacement_runs_with_only_original_app_globals(self):
        import types
        namespace = {'SETTINGS_PATH': self.path, 'load_app_settings': lambda: json.loads(self.path.read_text(encoding='utf-8'))}
        save = types.FunctionType(app_replacements.save_app_settings.__code__, namespace)
        result = save({'login_subtitle': '采购登记'})
        self.assertEqual(result['login_subtitle'], '采购登记')
        self.assertEqual(json.loads(self.path.read_text(encoding='utf-8'))['backup_time'], '18:00')


    def test_concurrent_partial_updates_preserve_every_key(self):
        from concurrent.futures import ThreadPoolExecutor
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(lambda i: app_replacements.save_app_settings({str(i): i}), range(20)))
        saved = json.loads(self.path.read_text(encoding='utf-8'))
        self.assertTrue(saved['stage_templates']['kept'])
        self.assertEqual([saved[str(i)] for i in range(20)], list(range(20)))

    def test_corrupt_file_is_preserved_and_recovery_error_is_explicit(self):
        self.path.write_bytes(b'{"broken":')
        with self.assertRaisesRegex(ValueError, '恢复'):
            app_replacements.save_app_settings({'backup_time': '19:00'})
        self.assertEqual(self.path.read_bytes(), b'{"broken":')


class ReviewedSerializationTests(unittest.TestCase):
    def test_empty_workflow_is_uninitialized_and_completed_history_stays_completed(self):
        project = SimpleNamespace(id=1, method='公开招标', stages=[], stage_checklist_items=[])
        result = stage_templates.serialize_v5_project_payload(None, None, project, {}, {}, stage_templates.PROCUREMENT_METHODS, [])
        self.assertEqual(result['progress'], 0)
        self.assertEqual(result['current_stage_name'], '未初始化流程')
        project.stages = [SimpleNamespace(stage_key='archived', completed=True)]
        result = stage_templates.serialize_v5_project_payload(None, None, project, {}, {}, stage_templates.PROCUREMENT_METHODS, [])
        self.assertEqual(result['progress'], 100)
        self.assertEqual(result['current_stage_name'], '已完成')


if __name__ == '__main__':
    unittest.main()
