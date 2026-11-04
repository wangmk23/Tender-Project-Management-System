"""Atomic confirmation contracts against a real SQLite transaction."""
import copy
import json
import unittest
from functools import wraps
from unittest.mock import patch

from flask import Flask, jsonify, session
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text

from src.backend_patches import online_bidding, project_record_versions, stage_templates, tender_guarantee
from src.backend_patches import procurement_catalog, supplier_quantity


class ConfirmationTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.config.update(SECRET_KEY='isolated-test', TESTING=True, SQLALCHEMY_DATABASE_URI='sqlite://')
        db = self.db = SQLAlchemy(self.app)

        class Project(db.Model):
            __tablename__ = 'projects'
            id = db.Column(db.Integer, primary_key=True)
            number = db.Column(db.String, default='TEST-001')
            name = db.Column(db.String, default='隔离竞价项目')
            method = db.Column(db.String, default='网上竞价')
            no_deposit = db.Column(db.Boolean, default=True)
            is_terminated = db.Column(db.Boolean, default=False)
            registrations = db.relationship('Registration', backref='project')
            stages = db.relationship('Stage', backref='project')
            bid_results = db.relationship('BidResult', backref='project')
            stage_checklist_items = db.relationship('Checklist', backref='project')
            lots = db.relationship('Lot', backref='project')

        class Lot(db.Model):
            __tablename__ = 'project_lots'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            lot_name = db.Column(db.String, default='隔离采购包')

        class Registration(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            company_name = db.Column(db.String)
            lot_id = db.Column(db.Integer, nullable=True)

        class Stage(db.Model):
            __tablename__ = 'stages'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            stage_key = db.Column(db.String)
            completed = db.Column(db.Boolean, default=False)
            skipped = db.Column(db.Boolean, default=False)
            completed_date = db.Column(db.Date)
            completed_at = db.Column(db.String)
            planned_datetime = db.Column(db.DateTime)
            notes = db.Column(db.String, default='')
            modules_json = db.Column(db.String, default='["online_bidding","bid_results"]')
            template_removed = db.Column(db.Boolean, default=False)

        class BidResult(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            lot_id = db.Column(db.Integer)
            winning_supplier = db.Column(db.String)
            winning_amount = db.Column(db.String)
            discount_rate = db.Column(db.String, default='')
            is_shortlisted = db.Column(db.Boolean, default=False)
            notes = db.Column(db.String, default='')

        class Checklist(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer, db.ForeignKey('projects.id'))
            stage_key = db.Column(db.String)
            title = db.Column(db.String)
            required = db.Column(db.Boolean, default=True)
            completed = db.Column(db.Boolean, default=False)

        class OperationLog(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            user_id = db.Column(db.Integer)
            username = db.Column(db.String)
            action_type = db.Column(db.String)
            target_type = db.Column(db.String)
            target_id = db.Column(db.String)
            description = db.Column(db.String)
            detail_json = db.Column(db.String)
            ip_address = db.Column(db.String)

        self.Project, self.Stage, self.Result, self.Lot = Project, Stage, BidResult, Lot
        self.Checklist, self.Log = Checklist, OperationLog

        def authenticated(fn):
            @wraps(fn)
            def inner(*args, **kwargs):
                if not session.get('user_id'):
                    return jsonify(error='login required'), 401
                return fn(*args, **kwargs)
            return inner

        online_bidding.register(self.app, db, dict(Project=Project, BidResult=BidResult,
            OperationLog=OperationLog, login_required=authenticated))
        with self.app.app_context():
            db.create_all()
            db.session.add(Project(id=1))
            db.session.add_all([Registration(id=1, project_id=1, company_name='甲'),
                Registration(id=2, project_id=1, company_name='乙'), Stage(project_id=1, stage_key='online_quotation')])
            db.session.flush()
            stage_templates.initialize_online_bidding_scope(db.session, text, 1, '网上竞价')
            tender_guarantee.ensure_schema(db)
            procurement_catalog.ensure_schema(db)
            supplier_quantity.ensure_schema(db)
            db.session.execute(text('INSERT INTO tender_policies VALUES(1,:p)'),
                {'p':json.dumps(dict(strict_results=True, default_rules=[]))})
            participation = dict(confirmed=True, records=[dict(registration_id=i,participation='submitted',
                validity='valid',deposit_status='unknown',deposit_amount='0',handling='review') for i in (1,2)],rules=[])
            roster=tender_guarantee.roster_fingerprint([dict(id=1,company_name='甲',lot_id=None),dict(id=2,company_name='乙',lot_id=None)])
            db.session.execute(text("INSERT INTO tender_ledgers VALUES(1,1,:p,:r,'[]')"), {'p':json.dumps(participation),'r':roster})
            db.session.commit()
            version = project_record_versions.snapshots(db, [1])[1]['stages']['online_quotation']
        self.client = self.app.test_client()
        with self.client.session_transaction() as sess:
            sess.update(user_id=1, username='测试经办人', csrf_token='test-token')
        self.assertEqual(self.client.get('/api/projects/1/online-bidding').status_code,200)
        self.headers = {'X-CSRFToken':'test-token'}
        self.data = dict(registration_end='2026-09-19T18:00', roster_locked=True,
            start_at='2026-09-20T09:00', end_at='2026-09-20T12:00', ended_at='2026-09-20T12:00',
            end_reason='deadline', evidence='https://example.test/result', records=[
                dict(registration_id=1, company_name='甲',lot_id=None,review='approved', amount='10.01',quoted_at='2026-09-20T09:01:17'),
                dict(registration_id=2, company_name='乙',lot_id=None,review='approved', amount='20.00',quoted_at='2026-09-20T09:02:09')])
        self.body = dict(revision=0,stage_key='online_quotation',stage_record_version=version,
            data=self.data,reason='按平台结果核对',stage_data=dict(notes='保留办理备注',completed_at='2026-09-21T10:00'))

    def post(self, body=None, headers=None):
        return self.client.post('/api/projects/1/online-bidding/confirm', json=self.body if body is None else body,
            headers=self.headers if headers is None else headers)

    def snapshot(self):
        with self.app.app_context():
            stage = self.Stage.query.filter_by(stage_key='online_quotation').one()
            row = self.db.session.execute(text('SELECT revision,payload FROM online_bidding_ledgers')).first()
            return dict(completed=stage.completed, notes=stage.notes,results=self.Result.query.count(),
                logs=self.Log.query.count(), ledger=(row[0],json.loads(row[1])) if row else None)

    def test_confirms_ledger_creates_result_and_completes_stage_together(self):
        response=self.post()
        self.assertEqual(response.status_code,200,response.json)
        state=self.snapshot()
        self.assertTrue(state['completed'])
        self.assertEqual(state['notes'],'保留办理备注')
        self.assertEqual(state['results'],1)
        self.assertEqual(state['logs'],1)
        self.assertTrue(state['ledger'][1]['verified'])
        with self.app.app_context():
            result=self.Result.query.one()
            self.assertEqual((result.winning_supplier,result.winning_amount),('甲','10.01'))
            log=self.Log.query.one()
            self.assertEqual((log.action_type,log.target_type,log.target_id),('stage.complete','project_activity','1'))
            self.assertEqual(json.loads(log.detail_json)['project']['id'],1)
        self.assertIn('online_quotation',self.client.get('/api/projects/1/online-bidding').json['history'][0]['reason'])

    def test_missing_evidence_does_not_partially_save(self):
        self.data['evidence']=''
        self.assertEqual(self.post().status_code,400)
        self.assertEqual(self.snapshot()['results'],0)
        self.assertIsNone(self.snapshot()['ledger'])
        self.assertFalse(self.snapshot()['completed'])

    def test_required_checklist_prevents_all_mutations(self):
        with self.app.app_context():
            self.db.session.add(self.Checklist(project_id=1,stage_key='online_quotation',title='核对原始凭证'))
            self.db.session.commit()
        response=self.post()
        self.assertEqual(response.status_code,409,response.json)
        self.assertIn('核对原始凭证',str(response.json))
        self.assertIsNone(self.snapshot()['ledger'])

    def test_unconfirmed_actual_participation_blocks_winner(self):
        with self.app.app_context():
            self.db.session.execute(text("UPDATE tender_ledgers SET payload=:p"),{'p':json.dumps(dict(confirmed=False,records=[]))})
            self.db.session.commit()
        response=self.post()
        self.assertEqual(response.status_code,409,response.json)
        self.assertEqual(self.snapshot()['results'],0)

    def test_stale_stage_and_ledger_tokens_return_409(self):
        for field,value in [('stage_record_version','old'),('revision',8)]:
            body=copy.deepcopy(self.body);body[field]=value
            self.assertEqual(self.post(body).status_code,409,field)
            self.assertIsNone(self.snapshot()['ledger'])

    def test_missing_version_token_is_not_legacy_confirmation(self):
        del self.body['stage_record_version']
        self.assertEqual(self.post().status_code,400)

    def test_identical_existing_result_is_reused(self):
        with self.app.app_context():
            self.db.session.add(self.Result(project_id=1,lot_id=None,winning_supplier='甲',winning_amount='10.01',notes='原记录'))
            self.db.session.commit()
        self.assertEqual(self.post().status_code,200)
        self.assertEqual(self.snapshot()['results'],1)
        with self.app.app_context():self.assertEqual(self.Result.query.one().notes,'原记录')

    def test_conflicting_result_is_preserved_and_confirmation_rejected(self):
        with self.app.app_context():
            self.db.session.add(self.Result(project_id=1,lot_id=None,winning_supplier='乙',winning_amount='20.00'))
            self.db.session.commit()
        self.assertEqual(self.post().status_code,409)
        self.assertIsNone(self.snapshot()['ledger'])
        with self.app.app_context():self.assertEqual(self.Result.query.one().winning_supplier,'乙')

    def test_tie_or_missing_winner_is_not_automatically_decided(self):
        self.data['records'][1]['amount']='10.01'
        self.assertEqual(self.post().status_code,409)
        self.assertIsNone(self.snapshot()['ledger'])

    def test_exception_after_result_creation_rolls_back_everything(self):
        original=self.db.session.add
        def fail_audit(obj,*args,**kwargs):
            if isinstance(obj,self.Log):raise RuntimeError('audit storage unavailable')
            return original(obj,*args,**kwargs)
        with patch.object(self.db.session,'add',side_effect=fail_audit), self.assertLogs(self.app.logger,level='ERROR'):
            self.assertEqual(self.post().status_code,500)
        self.assertEqual(self.snapshot()['results'],0)
        self.assertFalse(self.snapshot()['completed'])
        self.assertIsNone(self.snapshot()['ledger'])

    def test_replayed_original_submission_is_conflict_not_duplicate(self):
        self.assertEqual(self.post().status_code,200)
        self.assertEqual(self.post().status_code,409)
        self.assertEqual(self.snapshot()['results'],1)

    def test_csrf_and_login_are_required(self):
        self.assertEqual(self.post(headers={}).status_code,403)
        with self.client.session_transaction() as sess:sess.clear()
        self.assertEqual(self.post().status_code,401)

    def test_supplier_rename_cannot_reuse_old_platform_quote(self):
        self.data['records'][0]['company_name']='旧供应商'
        self.assertEqual(self.post().status_code,409)
        self.assertIsNone(self.snapshot()['ledger'])

    def test_confirming_existing_completed_stage_keeps_completion_time(self):
        from datetime import date
        with self.app.app_context():
            stage=self.Stage.query.one()
            stage.completed=True;stage.completed_date=date(2026,9,20);stage.completed_at='2026-09-20T12:00'
            self.db.session.commit()
            self.body['stage_record_version']=project_record_versions.snapshots(self.db,[1])[1]['stages']['online_quotation']
        self.body['stage_data'].pop('completed_at')
        self.assertEqual(self.post().status_code,200)
        with self.app.app_context():
            self.assertEqual(self.Stage.query.one().completed_at,'2026-09-20T12:00')

    def test_archived_stage_cannot_be_confirmed(self):
        with self.app.app_context():
            self.Stage.query.one().template_removed=True;self.db.session.commit()
        self.assertEqual(self.post().status_code,409)
        self.assertEqual(self.snapshot()['results'],0)

    def test_closed_project_cannot_be_confirmed(self):
        with self.app.app_context():
            self.Project.query.one().is_terminated=True;self.db.session.commit()
        self.assertEqual(self.post().status_code,409)

    def test_no_valid_quotes_does_not_complete_stage(self):
        for row in self.data['records']:row.update(amount='',quoted_at='')
        self.assertEqual(self.post().status_code,409)
        self.assertFalse(self.snapshot()['completed'])

    def test_same_price_needs_explicit_platform_tie_resolution(self):
        self.data['records'][1]['amount']='10.01'
        self.data['resolutions']=[dict(lot_id=None,registration_id=2,note='依据平台同价处理凭证002')]
        self.assertEqual(self.post().status_code,200)
        with self.app.app_context():self.assertEqual(self.Result.query.one().winning_supplier,'乙')

    def test_quote_confirmation_does_not_advance_publication(self):
        self.assertEqual(self.post().status_code,200)
        data=self.snapshot()['ledger'][1]
        self.assertFalse(data['publication_done'])
        self.assertFalse(data['notice_delivered'])

    def test_new_route_has_edit_project_capability(self):
        from src.backend_patches.account_permissions import required_capabilities
        self.assertEqual(required_capabilities('POST','/api/projects/1/online-bidding/confirm',{}),('edit_projects',))

    def set_minimum_three(self):
        snapshot=dict(method_id='test-method',method_revision=1,quantity_rule=dict(mode='fixed',minimum=3),exceptions=[])
        self.db.session.execute(text('INSERT INTO project_procurement_snapshots VALUES(1,:m,:j,0)'),
            dict(m='test-method',j=json.dumps(snapshot)))
        self.db.session.commit()

    def test_supplier_shortage_cannot_bypass_existing_manual_confirmation_gate(self):
        with self.app.app_context():self.set_minimum_three()
        response=self.post()
        self.assertEqual(response.status_code,409,response.json)
        self.assertEqual(response.json['code'],'SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED')
        self.assertIsNone(self.snapshot()['ledger'])
        self.assertFalse(self.snapshot()['completed'])

    def test_existing_explicit_quantity_confirmation_is_respected(self):
        with self.app.app_context():
            self.set_minimum_three()
            project=self.Project.query.one()
            state=supplier_quantity.evaluate_quantity(self.db,project,'online_quotation')
            self.assertEqual(state['status'],'shortage')
            supplier_quantity.confirm_quantity(self.db,project,dict(stage_key='online_quotation',
                fingerprint=state['fingerprint'],reason='隔离验收已有人工确认流程'),actor=1)
            self.db.session.commit()
        self.assertEqual(self.post().status_code,200)

    def prepare_two_lots(self):
        with self.app.app_context():
            project=self.Project.query.one()
            self.db.session.add_all([self.Lot(id=i,project_id=1) for i in (11,12)])
            for reg,lid in zip(project.registrations,(11,12)):reg.lot_id=lid
            self.db.session.flush()
            roster=tender_guarantee.roster_fingerprint(tender_guarantee._registrations(project))
            self.db.session.execute(text('UPDATE tender_ledgers SET roster=:r'),dict(r=roster))
            self.db.session.commit()
        self.data['lot_ids']=[11,12]
        for row,lid in zip(self.data['records'],(11,12)):row['lot_id']=lid

    def test_multiple_lots_confirm_each_winner_in_one_transaction(self):
        self.prepare_two_lots()
        self.assertEqual(self.post().status_code,200)
        with self.app.app_context():
            self.assertEqual({(r.lot_id,r.winning_supplier) for r in self.Result.query.all()}, {(11,'甲'),(12,'乙')})

    def test_empty_lot_prevents_partial_confirmation_of_other_lots(self):
        self.prepare_two_lots()
        with self.app.app_context():
            self.db.session.add(self.Lot(id=13,project_id=1));self.db.session.commit()
        self.data['lot_ids'].append(13)
        self.assertEqual(self.post().status_code,409)
        self.assertEqual(self.snapshot()['results'],0)
        self.assertIsNone(self.snapshot()['ledger'])

    def test_later_lot_conflict_rolls_back_new_result_for_first_lot(self):
        self.prepare_two_lots()
        with self.app.app_context():
            self.db.session.add(self.Result(project_id=1,lot_id=12,winning_supplier='保留的旧结果',winning_amount='25.00'))
            self.db.session.commit()
        self.assertEqual(self.post().status_code,409)
        with self.app.app_context():
            self.assertEqual([(r.lot_id,r.winning_supplier) for r in self.Result.query.all()],[(12,'保留的旧结果')])
        self.assertIsNone(self.snapshot()['ledger'])

    def test_activity_records_plan_and_completion_times(self):
        self.body['stage_data']['planned_at']='2026-09-21T08:30'
        self.assertEqual(self.post().status_code,200)
        with self.app.app_context():
            changes={r['field']:r for r in json.loads(self.Log.query.one().detail_json)['changes']}
            self.assertEqual(changes['planned_at']['after'],'2026-09-21T08:30')
            self.assertEqual(changes['completed_at']['after'],'2026-09-21T10:00')

    def reopen_request(self):
        ledger=self.client.get('/api/projects/1/online-bidding').json
        with self.app.app_context():
            version=project_record_versions.snapshots(self.db,[1])[1]['stages']['online_quotation']
        return dict(revision=ledger['revision'],stage_key='online_quotation',stage_record_version=version,reason='更正平台报价时间')

    def reopen(self,body=None):
        return self.client.post('/api/projects/1/online-bidding/reopen',json=body or self.reopen_request(),headers=self.headers)

    def test_reopen_keeps_original_quotes_and_result_and_clears_only_confirmation(self):
        self.assertEqual(self.post().status_code,200)
        original=self.snapshot()
        self.assertEqual(self.reopen().status_code,200)
        state=self.snapshot()
        self.assertFalse(state['completed'])
        self.assertEqual(state['results'],1)
        self.assertEqual(state['ledger'][1],dict(original['ledger'][1],verified=False))
        with self.app.app_context():self.assertIsNone(self.Stage.query.one().completed_at)

    def test_reopen_stale_version_does_not_partially_clear_confirmation(self):
        self.assertEqual(self.post().status_code,200)
        body=self.reopen_request();body['stage_record_version']='old'
        self.assertEqual(self.reopen(body).status_code,409)
        self.assertTrue(self.snapshot()['completed'])
        self.assertTrue(self.snapshot()['ledger'][1]['verified'])

    def test_reopen_rejects_completed_downstream_stage_without_erasing_it(self):
        self.assertEqual(self.post().status_code,200)
        with self.app.app_context():
            self.db.session.add(self.Stage(project_id=1,stage_key='result_announced',completed=True,modules_json='["result_publication"]'))
            self.db.session.commit()
        self.assertEqual(self.reopen().status_code,409)
        self.assertTrue(self.snapshot()['completed'])

    def test_reopen_audit_failure_rolls_back_ledger_and_stage(self):
        self.assertEqual(self.post().status_code,200)
        original=self.db.session.add
        def fail(obj,*args,**kwargs):
            if isinstance(obj,self.Log):raise RuntimeError('test audit outage')
            return original(obj,*args,**kwargs)
        with patch.object(self.db.session,'add',side_effect=fail),self.assertLogs(self.app.logger,level='ERROR'):
            self.assertEqual(self.reopen().status_code,500)
        self.assertTrue(self.snapshot()['completed'])
        self.assertTrue(self.snapshot()['ledger'][1]['verified'])
        self.assertEqual(self.snapshot()['logs'],1)

    def test_reopen_cannot_invalidate_another_completed_quotation_stage(self):
        self.assertEqual(self.post().status_code,200)
        with self.app.app_context():
            self.db.session.add(self.Stage(project_id=1,stage_key='custom_quote',completed=True,modules_json='["online_bidding"]'))
            self.db.session.commit()
        self.assertEqual(self.reopen().status_code,409)
        self.assertTrue(self.snapshot()['ledger'][1]['verified'])

    def test_received_fee_blocks_reopen_even_before_fee_stage_completion(self):
        self.assertEqual(self.post().status_code,200)
        ledger=self.client.get('/api/projects/1/online-bidding').json
        ledger['data'].update(fee_received=True,fee_date='2026-09-21',fee_reference='隔离到账凭证001')
        saved=self.client.put('/api/projects/1/online-bidding',json=dict(revision=ledger['revision'],
            data=ledger['data'],stage_key='online_fee_notice',reason='隔离验收登记实际到账'),headers=self.headers)
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(self.reopen().status_code,409)
        self.assertTrue(self.snapshot()['ledger'][1]['verified'])


if __name__ == '__main__':
    unittest.main()
