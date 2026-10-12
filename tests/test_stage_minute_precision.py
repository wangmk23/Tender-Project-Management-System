"""Minute-precision stage regressions against isolated SQLite transactions."""

import types
import unittest
import sys
from datetime import date, datetime
from unittest.mock import patch

from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from sqlalchemy.orm import joinedload

from src.backend_patches import app_replacements, business_input_validation, stage_templates
from tests.test_custom_batch_advance import CustomBatchAdvanceTests
from tests.test_stage_auto_completion import StageAutoCompletionTests


class StageMinutePrecisionTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite://'
        self.db = SQLAlchemy(self.app)
        db = self.db

        class Project(db.Model):
            __tablename__ = 'projects'
            id = db.Column(db.Integer, primary_key=True)
            number = db.Column(db.String)
            method = db.Column(db.String, default='公开招标')
            is_terminated = db.Column(db.Boolean, default=False)
            stages = db.relationship('Stage', backref='project')
            stage_checklist_items = []

            def get_stage(self, key):
                return next((item for item in self.stages if item.stage_key == key), None)

            def to_dict(self):
                return {'id': self.id, 'method': self.method, 'stages': [
                    {'key': item.stage_key, 'completed': item.completed,
                     'completed_date': item.completed_date.isoformat() if item.completed_date else None,
                     'planned_at': item.planned_datetime.isoformat() if item.planned_datetime else None}
                    for item in self.stages
                ]}

        class Stage(db.Model):
            __tablename__ = 'stages'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            stage_key = db.Column(db.String)
            completed = db.Column(db.Boolean, default=False)
            skipped = db.Column(db.Boolean, default=False)
            completed_date = db.Column(db.Date)
            planned_datetime = db.Column(db.DateTime)
            notes = db.Column(db.String, default='原备注')
            responsible_person = db.Column(db.String)

        self.Project, self.Stage = Project, Stage
        self.logs = []
        env = dict(app_replacements.__dict__, db=db, Project=Project, request=request,
                   jsonify=jsonify, text=text, joinedload=joinedload, date=date, datetime=datetime,
                   STAGES=[], load_app_settings=lambda: {}, log_operation=lambda *args: self.logs.append(args))
        self.handler = types.FunctionType(app_replacements.api_update_stage.__code__, env)
        self.app.add_url_rule('/api/projects/<int:pid>/stages/<stage_key>', 'stage', self.handler, methods=['PUT'])
        with self.app.app_context():
            db.create_all()
            db.session.add(Project(id=1, number='虚构-1', stages=[Stage(stage_key='custom_review')]))
            db.session.add(Project(id=2, number='虚构-2', stages=[Stage(stage_key='custom_review')]))
            db.session.commit()
            stage_templates.ensure_v5_snapshot_schema(db.session, text)
            db.session.commit()
        self.client = self.app.test_client()

    def save(self, **data):
        return self.client.put('/api/projects/1/stages/custom_review', json=data)

    def state(self, pid=1):
        with self.app.app_context():
            stage = self.Stage.query.filter_by(project_id=pid).one()
            columns = {row[1] for row in self.db.session.execute(text('PRAGMA table_info(stages)'))}
            stamp = self.db.session.execute(text('SELECT completed_at FROM stages WHERE project_id=:pid'),
                                            {'pid': pid}).scalar() if 'completed_at' in columns else None
            return stage.completed, stage.completed_date, stage.planned_datetime, stage.notes, stamp

    def test_custom_stage_persists_and_serializes_completion_minute_and_plan(self):
        response = self.save(completed=True, completed_date='2026-10-12',
                             completed_at='2026-10-12T14:37', planned_at='2026-10-13T09:28')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.state(), (True, date(2026, 10, 12), datetime(2026, 10, 13, 9, 28),
                                       '原备注', '2026-10-12T14:37'))
        self.assertEqual(response.json['stages'][0]['completed_at'], '2026-10-12T14:37')
        with self.app.app_context():
            project = self.db.session.get(self.Project, 1)
            payload = stage_templates.serialize_v5_project_payload(self.db.session, text, project,
                project.to_dict(), {}, ['公开招标'], [])
            self.assertEqual(payload['stages'][0]['completed_at'], '2026-10-12T14:37')
        self.assertIsNone(self.state(2)[-1])

    def test_completion_timestamp_alone_derives_legacy_date(self):
        self.assertEqual(self.save(completed=True, completed_at='2026-10-12T15:08:00').status_code, 200)
        self.assertEqual(self.state()[:2], (True, date(2026, 10, 12)))
        self.assertEqual(self.state()[-1], '2026-10-12T15:08')

    def test_custom_stage_update_response_uses_snapshot_when_core_omits_custom_rows(self):
        self.Project.to_dict = lambda project: {'id':project.id, 'method':project.method,
            'stages':[{'key':'legacy','name':'内置阶段','completed':False}]}
        self.handler.__globals__['load_app_settings'] = lambda: {'stage_templates':{'公开招标':[
            {'id':'custom_review','name':'自定义审核','icon':'•','modules':['common']}]}}
        with self.app.app_context():
            self.db.session.execute(text("UPDATE stages SET stage_name='自定义审核',modules_json='[\"common\"]',stage_position=0 WHERE project_id=1"))
            self.db.session.commit()
        response = self.save(completed=True, completed_at='2026-10-12T14:37',
                             planned_at='2026-10-13T09:28', notes='自定义阶段备注')
        self.assertEqual(response.status_code,200)
        self.assertEqual([stage['key'] for stage in response.json['stages']],['custom_review'])
        saved=response.json['stages'][0]
        self.assertTrue(saved['completed'])
        self.assertEqual(saved['name'],'自定义审核')
        self.assertEqual(saved['completed_date'],'2026-10-12')
        self.assertEqual(saved['completed_at'],'2026-10-12T14:37')
        self.assertEqual(saved['planned_at'],'2026-10-13T09:28:00')
        self.assertEqual(saved['notes'],'自定义阶段备注')

    def test_invalid_or_conflicting_minute_inputs_do_not_mutate_any_fields(self):
        for data in ({'completed_at': '2026-02-30T09:05'}, {'completed_at': '2026-10-12'},
                     {'completed_at': '2026-10-12T25:10'}, {'completed_at': '2026-10-12T09:00:30'},
                     {'completed_at': '2026-10-12T09:00+08:00'}, {'completed_at': []},
                     {'completed_at': '2026-10-12T09:00', 'completed_date': '2026-10-11'},
                     {'planned_at': '2026-10-12T09:00+08:00'}, {'planned_at': '2026-10-12T09:00:61'}):
            with self.subTest(data=data):
                response = self.save(completed=True, notes='不得保存', **data)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.state(), (False, None, None, '原备注', None))
        self.assertEqual(self.logs, [])

    def test_legacy_completion_remains_date_only_when_editing_notes(self):
        self.save(completed=True, completed_date='2026-10-10')
        response = self.save(completed=True, completed_date='2026-10-10', notes='仅改备注')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.state()[-1], None)
        self.assertEqual(self.state()[:2], (True, date(2026, 10, 10)))

    def test_legacy_planned_datetime_with_seconds_remains_supported(self):
        response = self.save(planned_at='2026-10-12T09:28:02.123')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.state()[2], datetime(2026, 10, 12, 9, 28, 2, 123000))

    def test_old_client_date_edit_clears_precise_stamp_including_same_day(self):
        self.save(completed=True, completed_at='2026-10-12T14:37')
        self.save(notes='保留时分')
        self.assertEqual(self.state()[-1], '2026-10-12T14:37')
        self.save(completed_date='2026-10-12')
        self.assertIsNone(self.state()[-1])

    def test_legacy_list_summary_exposes_optional_completion_minute(self):
        self.save(completed=True, completed_at='2026-10-12T14:37')
        self.Project.to_summary_dict = self.Project.to_dict
        query = types.SimpleNamespace(options=lambda *args: query, order_by=lambda *args: query,
                                      all=lambda: self.Project.query.all())
        model = types.SimpleNamespace(query=query, stages=None, lots=None, registrations=None,
            year=types.SimpleNamespace(desc=lambda: None), number=None)
        env = dict(self.handler.__globals__, Project=model, selectinload=lambda value: value,
                   load_app_settings=lambda: {}, METHODS=['公开招标'])
        handler = types.FunctionType(app_replacements.api_projects.__code__, env)
        risk = types.SimpleNamespace(enrich_project_payload=lambda database, payload, *args: payload)
        with self.app.test_request_context(), patch.dict(sys.modules, {'lot_supplier_risk': risk}):
            payload = handler().json
        self.assertEqual(payload[0]['stages'][0]['completed_at'], '2026-10-12T14:37')
        self.assertIsNone(payload[1]['stages'][0]['completed_at'])

    def test_undo_clears_completion_date_and_minute(self):
        self.save(completed=True, completed_at='2026-10-12T14:37')
        response = self.save(completed=False)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.state()[:2], (False, None))
        self.assertIsNone(self.state()[-1])

    def test_new_completion_and_skip_without_explicit_date_record_actual_minute(self):
        for payload in ({'completed': True}, {'skipped': True}):
            self.save(completed=False, skipped=False)
            response = self.save(**payload)
            self.assertEqual(response.status_code, 200)
            stamp = self.state()[-1]
            self.assertIsNotNone(stamp)
            actual = datetime.fromisoformat(stamp)
            self.assertLess(abs((datetime.now() - actual).total_seconds()), 65)
            self.assertEqual(self.state()[1], actual.date())

    def test_save_failure_rolls_back_completion_raw_minute_and_notes(self):
        with patch.object(self.db.session, 'commit', side_effect=RuntimeError('synthetic failure')):
            response = self.save(completed=True, completed_at='2026-10-12T14:37', notes='不得保存')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.state(), (False, None, None, '原备注', None))
        self.assertEqual(self.logs, [])

    def test_business_wrapper_rejects_same_invalid_completion_timestamps(self):
        for endpoint in ('api_update_stage', 'api_batch_advance_stage'):
            self.assertIsNone(business_input_validation.validate_business_input(endpoint,
                {'completed_at': '2026-10-12T14:37'}, []))
            for value in ('2026-10-12', '2026-10-12T14:37:01', '2026-10-12T14:37Z'):
                self.assertIsNotNone(business_input_validation.validate_business_input(endpoint,
                    {'completed_at': value}, []))


class BatchMinutePrecisionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = CustomBatchAdvanceTests()
        self.fixture.setUp()

    def stamp(self, pid=1):
        with self.fixture.app.app_context():
            columns = {row[1] for row in self.fixture.db.session.execute(text('PRAGMA table_info(stages)'))}
            if 'completed_at' not in columns:
                return None
            return self.fixture.db.session.execute(text('SELECT completed_at FROM stages WHERE project_id=:pid'),
                                                   {'pid': pid}).scalar()

    def test_batch_precise_timestamp_matches_date_and_cannot_cross_projects(self):
        response = self.fixture.post(completed_at='2026-10-12T14:37')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.fixture.state(), (True, date(2026, 10, 12)))
        self.assertEqual(self.stamp(), '2026-10-12T14:37')
        self.assertIsNone(self.stamp(2))

    def test_batch_invalid_time_and_mismatch_reject_before_mutation(self):
        for data in ({'completed_at': '2026-10-12T24:00'},
                     {'completed_at': '2026-10-12T14:37', 'completed_date': '2026-10-11'}):
            self.assertEqual(self.fixture.post(**data).status_code, 400)
            self.assertEqual(self.fixture.state(), (False, None))
            self.assertIsNone(self.stamp())

    def test_batch_failure_rolls_back_raw_timestamp_with_orm(self):
        with patch.object(self.fixture.db.session, 'commit', side_effect=RuntimeError('synthetic failure')):
            response = self.fixture.post(completed_at='2026-10-12T14:37')
        self.assertEqual(response.status_code, 500)
        self.assertEqual(self.fixture.state(), (False, None))
        self.assertIsNone(self.stamp())


class AutomaticMinutePrecisionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = StageAutoCompletionTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.tearDown)

    def test_auto_completion_persists_execution_minute_in_same_transaction(self):
        fixture = self.fixture
        fixture.activate()
        stage = fixture.stage('custom_auto', datetime(2026, 7, 21, 9, 0))
        fixture.projects.append(fixture.project(17, [stage]))
        fixture.configure_snapshot(17, [('custom_auto', ['common', 'auto_completion', '_auto_completion_policy_v1'])])
        fixture.set_now(datetime(2026, 7, 21, 9, 15, 45))
        fixture.module._auto_advance_stages()
        columns = {row['name'] for row in fixture.session.database.execute('PRAGMA table_info(stages)')}
        stamp = fixture.session.database.execute('SELECT completed_at FROM stages WHERE project_id=17').fetchone()[0] if 'completed_at' in columns else None
        self.assertEqual(stamp, '2026-07-21T09:15')

    def test_auto_completion_failure_rolls_back_optional_minute_column(self):
        fixture = self.fixture
        fixture.activate()
        stage = fixture.stage('custom_auto', datetime(2026, 7, 21, 9, 0))
        fixture.projects.append(fixture.project(17, [stage]))
        fixture.configure_snapshot(17, [('custom_auto', ['common', 'auto_completion', '_auto_completion_policy_v1'])])
        fixture.set_now(datetime(2026, 7, 21, 9, 15, 45))
        fixture.session.commit.side_effect = OSError('synthetic completion failure')
        fixture.module._auto_advance_stages()
        self.assertFalse(stage.completed)
        self.assertIsNone(stage.completed_date)
        stamp = fixture.session.database.execute('SELECT completed_at FROM stages WHERE project_id=17').fetchone()[0]
        self.assertIsNone(stamp)
        self.assertEqual(fixture.session.database_audit(), [])


if __name__ == '__main__':
    unittest.main()
