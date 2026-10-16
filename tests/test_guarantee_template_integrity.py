"""Cross-feature integrity for default refund anchors and stage-template edits."""
import copy
import threading
import unittest
from types import SimpleNamespace as NS
from unittest.mock import patch
from src.backend_patches import tender_guarantee as tg, stage_templates
from tests import test_reminder_settings as settings_tests


class GuaranteeTemplateIntegrityTests(unittest.TestCase):
    def setUp(self):
        self.harness = settings_tests.ReminderSettingsTests()
        self.harness.setUp()
        self.addCleanup(self.harness.tearDown)
        self.module = self.harness.module
        self.module.METHODS = list(stage_templates.PROCUREMENT_METHODS)
        self.module.STAGES = [{'key': 'anchor', 'name': '原起算阶段', 'icon': 'x'}]
        self.templates = {m: [{'id': 'anchor', 'name': '原起算阶段', 'icon': 'x', 'modules': ['common']}]
                          for m in stage_templates.PROCUREMENT_METHODS}
        self.rule = dict(id='refund_default', lot_id=None, scope='nonwinner', enabled=True,
                         start_stage_key='anchor', manual_start_at='', days=5,
                         day_kind='calendar', cutoff='', remind_days=1)
        self.harness.settings.update(stage_templates=copy.deepcopy(self.templates),
                                     guarantee_default_rules={'公开招标': [copy.deepcopy(self.rule)]})

    def save_templates(self, templates):
        self.harness.request.json = {'stage_templates': templates}
        return self.module.api_update_settings()

    def replacement(self, method='公开招标'):
        result = copy.deepcopy(self.templates)
        result[method] = [dict(id='replacement', name='新阶段', icon='x', modules=['common'])]
        return result

    def test_enabled_default_anchor_removal_is_rejected_before_settings_write(self):
        before = copy.deepcopy(self.harness.settings)
        response = self.save_templates(self.replacement())
        self.assertIsInstance(response, tuple, response)
        payload, status = response
        self.assertEqual(status, 400)
        self.assertIn('公开招标', payload['error'])
        self.assertIn('默认退还规则', payload['error'])
        self.assertIn('修改或停用', payload['error'])
        self.assertEqual(self.harness.settings, before)

    def test_disabled_default_does_not_block_template_change(self):
        self.harness.settings['guarantee_default_rules']['公开招标'][0]['enabled'] = False
        response = self.save_templates(self.replacement())
        self.assertIsInstance(response, dict, response)
        self.assertEqual(self.harness.settings['stage_templates']['公开招标'][0]['id'], 'replacement')
        self.assertFalse(self.harness.settings['guarantee_default_rules']['公开招标'][0]['enabled'])

    def test_other_method_edit_and_label_change_preserve_rules_and_snapshots(self):
        old = copy.deepcopy(self.harness.settings['guarantee_default_rules'])
        proposed = self.replacement('竞争性磋商')
        proposed['公开招标'][0]['name'] = '仅修改名称'
        self.assertIsInstance(self.save_templates(proposed), dict)
        self.assertEqual(self.harness.settings['guarantee_default_rules'], old)

    def test_existing_bad_default_in_unchanged_method_does_not_block_other_method(self):
        self.harness.settings['guarantee_default_rules']['公开招标'][0]['start_stage_key'] = 'old-missing'
        response = self.save_templates(self.replacement('竞争性磋商'))
        self.assertIsInstance(response, dict, response)
        self.assertEqual(self.harness.settings['guarantee_default_rules']['公开招标'][0]['start_stage_key'], 'old-missing')

    def test_project_snapshot_can_disable_a_preexisting_invalid_rule_without_losing_cash(self):
        from flask import Flask
        from flask_sqlalchemy import SQLAlchemy
        app = Flask(__name__)
        app.config.update(SECRET_KEY='isolated-integrity', SQLALCHEMY_DATABASE_URI='sqlite://')
        db = SQLAlchemy(app)
        class Project(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            name = '隔离修复'; number = 'FIX'; method = '公开招标'; no_deposit = False
            lots = []; registrations = []; bid_results = []; stages = []
        with app.app_context():
            db.create_all()
            project = Project(id=1)
            project.stages = [NS(stage_key='replacement', completed=False, skipped=False)]
            project.registrations = [NS(id=1, company_name='已缴供应商', lot_id=None)]
            db.session.add(project); db.session.commit()
            settings = {'stage_templates': self.replacement(), 'guarantee_default_rules': {'公开招标': [self.rule]}}
            tg.register(app, db, {'Project': Project, 'load_app_settings': lambda: settings})
            tg._execute(db, 'DELETE FROM tender_policies WHERE project_id=1')
            db.session.commit()
            client = app.test_client()
            with client.session_transaction() as session:
                session['user_id'] = 1; session['csrf_token'] = 'test-csrf'
            ledger = client.get('/api/projects/1/tender-guarantee').get_json()
            data = copy.deepcopy(ledger['data'])
            data['records'] = [dict(registration_id=1, deposit_status='paid', deposit_amount='100', refunded_amount='20')]
            response = client.put('/api/projects/1/tender-guarantee', json=dict(revision=0, data=data), headers={'X-CSRFToken': 'test-csrf'})
            self.assertEqual(response.status_code, 400)
            self.assertIn('本项目', response.get_json()['error'])
            self.assertIn('设置退还规则', response.get_json()['error'])
            self.assertEqual(tg._load(db, 1)[0], 0)
            settings['guarantee_default_rules']['公开招标'][0]['enabled'] = False
            old_project = client.get('/api/projects/1/tender-guarantee').get_json()
            self.assertTrue(old_project['data']['rules'][0]['enabled'])
            data['rules'][0]['enabled'] = False
            fixed = client.put('/api/projects/1/tender-guarantee', json=dict(revision=0, data=data), headers={'X-CSRFToken': 'test-csrf'})
            self.assertEqual(fixed.status_code, 200, fixed.get_json())
            self.assertEqual(fixed.get_json()['summary']['balance'], '80.00')
            self.assertEqual(fixed.get_json()['data']['records'][0]['deposit_amount'], '100.00')

    def concurrent_default_updates(self, *, second_is_template=False):
        """Pause the first settings read; let the competing writer try the lock.

        The nonblocking probe only controls ordering. Assertions below concern
        persisted rules and HTTP results, not a particular locking implementation.
        """
        from flask import Flask
        from flask_sqlalchemy import SQLAlchemy
        app = Flask(__name__)
        app.config.update(SECRET_KEY='isolated-race', SQLALCHEMY_DATABASE_URI='sqlite://')
        db = SQLAlchemy(app)
        class Project(db.Model):
            id = db.Column(db.Integer, primary_key=True)
        class User(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            is_admin = True
            is_active = True
        first_read = threading.Event()
        resume_first = threading.Event()
        second_done = threading.Event()
        decision = threading.Event()
        results = {}
        errors = []

        class ObservedLock:
            def __init__(self):
                self.lock = threading.RLock()
                self.second_acquired = None

            def __enter__(self):
                if threading.current_thread().name == 'settings-second' and self.second_acquired is None:
                    self.second_acquired = self.lock.acquire(blocking=False)
                    decision.set()
                    if not self.second_acquired:
                        self.lock.acquire()
                else:
                    self.lock.acquire()
                return self

            def __exit__(self, *args):
                self.lock.release()

        shared_lock = ObservedLock()
        self.harness.settings['guarantee_default_rules'] = {}

        def load_settings():
            value = copy.deepcopy(self.harness.settings)
            if threading.current_thread().name == 'settings-first':
                first_read.set()
                if not resume_first.wait(5):
                    raise AssertionError('first settings reader was not released')
            return value

        def save_settings(updates):
            with stage_templates.settings_write_lock:
                self.harness.settings.update(copy.deepcopy(updates))

        def request_defaults(method):
            with app.test_client() as client:
                with client.session_transaction() as session:
                    session['user_id'] = 1
                    session['csrf_token'] = 'test-csrf'
                response = client.put('/api/tender-guarantee/defaults',
                                      json={'method': method, 'rules': [self.rule]},
                                      headers={'X-CSRFToken': 'test-csrf'})
                return response.status_code

        def first():
            try:
                results['first'] = request_defaults('公开招标')
            except BaseException as error:
                errors.append(error)

        def second():
            try:
                if second_is_template:
                    response = self.save_templates(self.replacement())
                    results['second'] = response[1] if isinstance(response, tuple) else 200
                else:
                    results['second'] = request_defaults('竞争性磋商')
            except BaseException as error:
                errors.append(error)
            finally:
                second_done.set()

        with app.app_context():
            db.create_all()
            db.session.add(User(id=1))
            db.session.commit()
        with patch.dict('sys.modules', {'stage_templates': stage_templates}), \
             patch.object(stage_templates, 'settings_write_lock', shared_lock):
            tg.register(app, db, {'Project': Project, 'User': User,
                                 'load_app_settings': load_settings, 'save_app_settings': save_settings})
            workers = [threading.Thread(target=first, name='settings-first'),
                       threading.Thread(target=second, name='settings-second')]
            try:
                workers[0].start()
                self.assertTrue(first_read.wait(5), 'first reader did not reach the controlled interleave')
                workers[1].start()
                self.assertTrue(decision.wait(5), 'second writer did not attempt the shared lock')
                if shared_lock.second_acquired:
                    self.assertTrue(second_done.wait(5), 'unlocked competing writer did not finish')
            finally:
                resume_first.set()
                for worker in workers:
                    if worker.ident is not None:
                        worker.join(5)
                self.assertFalse(any(worker.is_alive() for worker in workers), 'settings writer deadlocked')
        self.assertEqual(errors, [])
        return results

    def test_concurrent_default_enable_and_template_removal_cannot_both_succeed(self):
        results = self.concurrent_default_updates(second_is_template=True)
        self.assertEqual(results, {'first': 200, 'second': 400})
        rules = self.harness.settings['guarantee_default_rules']['公开招标']
        keys = {row['id'] for row in self.harness.settings['stage_templates']['公开招标']}
        self.assertTrue(all(not rule['enabled'] or rule['start_stage_key'] in keys for rule in rules))

    def test_concurrent_defaults_for_different_methods_preserve_both_writes(self):
        self.assertEqual(self.concurrent_default_updates(), {'first': 200, 'second': 200})
        self.assertEqual(set(self.harness.settings['guarantee_default_rules']), {'公开招标', '竞争性磋商'})


if __name__ == '__main__':
    unittest.main()
