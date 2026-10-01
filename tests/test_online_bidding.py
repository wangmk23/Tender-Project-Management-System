import copy
import unittest
from unittest.mock import patch
from datetime import datetime

from src.backend_patches import online_bidding as subject


class OnlineBiddingTests(unittest.TestCase):
    def setUp(self):
        clock = patch.object(subject, 'now_local', return_value=datetime(2026, 9, 21))
        clock.start()
        self.addCleanup(clock.stop)
        self.registrations = [dict(id=1, company_name='甲', lot_id=None), dict(id=2, company_name='乙', lot_id=None)]
        self.data = dict(start_at='2026-09-20T09:00', end_at='2026-09-20T12:00',
                         registration_end='2026-09-19T18:00', roster_locked=True,
                         records=[dict(registration_id=1, review='approved', amount='10.01', quoted_at='2026-09-20T09:01'),
                                  dict(registration_id=2, review='approved', amount='20', quoted_at='2026-09-20T09:02')])

    def test_deadline_does_not_confirm_external_results(self):
        data = subject.validate(self.data, self.registrations)
        result = subject.summarize(data, datetime(2026, 9, 21))
        self.assertEqual(result['status'], '待核对平台结果')
        self.assertFalse(result['verified'])

    def test_unique_lowest_and_tie(self):
        self.data.update(verified=True, ended_at='2026-09-20T09:02', end_reason='all_quoted', evidence='平台导出报价表')
        result = subject.summarize(subject.validate(self.data, self.registrations))
        self.assertEqual(result['lots'][0]['winner'], '甲')
        self.data['records'][1]['amount'] = '10.01'
        result = subject.summarize(subject.validate(self.data, self.registrations))
        self.assertEqual(result['lots'][0]['status'], '最低价并列，待处理')
        self.assertIsNone(result['lots'][0]['winner'])

    def test_invalid_price_and_unapproved_quote(self):
        for amount in ['NaN', 'Infinity', '-1', '0', '1.001']:
            data = copy.deepcopy(self.data)
            data['records'][0]['amount'] = amount
            with self.assertRaises(ValueError):
                subject.validate(data, self.registrations)
        self.data['records'][0]['review'] = 'pending'
        with self.assertRaises(ValueError):
            subject.validate(self.data, self.registrations)

    def test_duplicate_and_cross_project_registration_rejected(self):
        self.data['records'].append(self.data['records'][0])
        with self.assertRaises(ValueError):
            subject.validate(self.data, self.registrations)
        self.data['records'] = [dict(registration_id=99, review='approved')]
        with self.assertRaises(ValueError):
            subject.validate(self.data, self.registrations)

    def test_empty_roster_cannot_end_early(self):
        self.data.update(records=[], verified=True, end_reason='all_quoted', ended_at='2026-09-20T10:00', evidence='平台记录')
        with self.assertRaises(ValueError):
            subject.validate(self.data, [])

    def test_missing_quote_is_not_zero_and_lots_are_separate(self):
        self.data['records'][1].update(amount='', quoted_at='')
        self.data.update(verified=True, end_reason='deadline', ended_at='2026-09-20T12:00', evidence='平台记录')
        self.registrations[0]['lot_id'] = 10
        self.registrations[1]['lot_id'] = 20
        result = subject.summarize(subject.validate(self.data, self.registrations))
        self.assertEqual(len(result['lots']), 2)
        self.assertEqual(result['lots'][1]['status'], '无有效报价，待处理')

    def test_quote_window_and_post_deadline_entry(self):
        self.data['records'][0]['quoted_at'] = '2026-09-20T12:00'
        with self.assertRaises(ValueError):
            subject.validate(self.data, self.registrations)
        self.data['records'][0]['quoted_at'] = '2026-09-20T09:00'
        self.assertEqual(subject.validate(self.data, self.registrations)['records'][0]['amount'], '10.01')

    def test_notice_requires_fee_and_publication_requires_verified_result(self):
        for values in [dict(notice_delivered=True), dict(publication_done=True)]:
            with self.assertRaises(ValueError):
                subject.validate(dict(self.data, **values), self.registrations)

    def test_empty_lot_is_not_omitted_from_result(self):
        self.data.update(verified=True, ended_at='2026-09-20T12:00', end_reason='deadline', evidence='平台导出')
        self.registrations[0]['lot_id'] = 10
        self.registrations[1]['lot_id'] = 10
        data = subject.validate(self.data, self.registrations, lot_ids=[10, 20])
        self.assertEqual(subject.summarize(data)['lots'][1]['status'], '无有效报价，待处理')

    def test_platform_tie_resolution_keeps_original_amounts(self):
        self.data['records'][1]['amount'] = '10.01'
        self.data.update(verified=True, ended_at='2026-09-20T09:02', end_reason='all_quoted', evidence='平台导出', resolutions=[dict(lot_id=None,registration_id=2,note='平台按项目文件确定乙成交，凭证001')])
        data = subject.validate(self.data, self.registrations)
        self.assertEqual(subject.summarize(data)['lots'][0]['winner'], '乙')
        self.assertEqual([r['amount'] for r in data['records']], ['10.01','10.01'])
        self.data['resolutions'][0]['note'] = ''
        with self.assertRaises(ValueError):
            subject.validate(self.data, self.registrations)

    def test_canonical_result_must_match_verified_winner(self):
        self.data.update(verified=True, ended_at='2026-09-20T09:02', end_reason='all_quoted', evidence='平台导出')
        data = subject.validate(self.data, self.registrations)
        self.assertTrue(subject.result_error(data,[dict(lot_id=None,winning_supplier='乙',winning_amount=20)]))
        self.assertEqual(subject.result_error(data,[dict(lot_id=None,winning_supplier='甲',winning_amount='10.01')]),'')

    def test_roster_changes_invalidate_result(self):
        data = subject.validate(self.data, self.registrations)
        self.registrations[0]['company_name'] = '更名主体'
        self.assertTrue(subject.roster_stale(data,self.registrations,[]))

    def test_existing_notice_must_match_corrected_winner(self):
        self.data.update(verified=True, ended_at='2026-09-20T09:02', end_reason='all_quoted', evidence='平台导出')
        data = subject.validate(self.data, self.registrations)
        self.assertTrue(subject.notice_error(data,[dict(lot_id=None,supplier_name='乙')]))
        self.assertTrue(subject.notice_error(data,[]))
        self.assertEqual(subject.notice_error(data,[dict(lot_id=None,supplier_name='甲')]),'')


class OnlineBiddingApiTests(unittest.TestCase):
    def setUp(self):
        from flask import Flask, session, jsonify
        from flask_sqlalchemy import SQLAlchemy
        from functools import wraps
        self.app = Flask(__name__)
        self.app.config.update(SECRET_KEY='test', SQLALCHEMY_DATABASE_URI='sqlite://')
        self.db = SQLAlchemy(self.app)
        db = self.db

        class Project(db.Model):
            id = db.Column(db.Integer, primary_key=True)
            method = db.Column(db.String, default='网上竞价')
            is_terminated = db.Column(db.Boolean, default=False)
            registrations = []
            lots = []
            stages = []

        self.Project = Project
        def authenticated(fn):
            @wraps(fn)
            def inner(*args, **kwargs):
                if not session.get('user_id'):
                    return jsonify(error='login'), 401
                return fn(*args, **kwargs)
            return inner
        subject.register(self.app, db, {'Project': Project, 'login_required': authenticated})
        self.app.add_url_rule('/api/projects/<int:pid>/stages/<key>', 'stage', lambda pid, key: jsonify(ok=True), methods=['PUT'])
        self.app.add_url_rule('/api/batch/advance-stage', 'batch', lambda: jsonify(ok=True), methods=['POST'])
        self.app.add_url_rule('/api/projects/<int:pid>/notice-deliveries', 'notice', lambda pid: jsonify(ok=True), methods=['POST'])
        self.app.add_url_rule('/api/projects/<int:pid>/bid-results', 'bid', lambda pid: jsonify(ok=True), methods=['POST'])
        with self.app.app_context():
            db.create_all()
            db.session.add(Project(id=1))
            db.session.add(Project(id=2, method='公开招标'))
            db.session.commit()
        self.client = self.app.test_client()
        self.headers = {'X-CSRFToken': 'test-token'}

    def login(self):
        with self.client.session_transaction() as sess:
            sess.update(user_id=1, username='经办人', csrf_token='test-token')

    def enroll(self):
        from sqlalchemy import text
        from src.backend_patches.stage_templates import initialize_online_bidding_scope
        with self.app.app_context():
            initialize_online_bidding_scope(self.db.session, text, 1, '网上竞价')
            self.db.session.commit()

    def test_legacy_synced_completed_project_does_not_require_new_fields(self):
        from types import SimpleNamespace
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key=key, completed=True)
                               for key in ('online_quotation', 'result_announced', 'archived')]
        for key in ('online_quotation', 'result_announced', 'archived'):
            response = self.client.put('/api/projects/1/stages/'+key, json={'completed':True}, headers=self.headers)
            self.assertEqual(response.status_code, 200, response.json)
        for endpoint in ('bid-results', 'notice-deliveries'):
            self.assertEqual(self.client.post('/api/projects/1/'+endpoint, json={}, headers=self.headers).status_code, 200)
        self.assertEqual(self.client.post('/api/batch/advance-stage', json={'project_ids':[1]}, headers=self.headers).status_code, 200)
        saved = self.client.put('/api/projects/1/online-bidding', json={'revision':0, 'data':{'received':True}}, headers=self.headers)
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertTrue(all(s.completed for s in self.Project.stages))

    def test_auth_csrf_and_method_isolation(self):
        self.assertEqual(self.client.get('/api/projects/1/online-bidding').status_code, 401)
        self.login()
        self.assertEqual(self.client.put('/api/projects/1/online-bidding', json={'revision':0, 'data':{}}).status_code, 403)
        self.assertEqual(self.client.get('/api/projects/2/online-bidding').status_code, 400)

    def test_revision_and_full_history_survive_round_trip(self):
        self.login()
        path = '/api/projects/1/online-bidding'
        first = self.client.put(path, json={'revision':0, 'data':{'received':True}}, headers=self.headers)
        self.assertEqual(first.status_code, 200, first.json)
        self.assertEqual(first.json['revision'], 1)
        stale = self.client.put(path, json={'revision':0, 'data':{}}, headers=self.headers)
        self.assertEqual(stale.status_code, 409)
        no_reason = self.client.put(path, json={'revision':1, 'data':{}}, headers=self.headers)
        self.assertEqual(no_reason.status_code, 400)
        second = self.client.put(path, json={'revision':1, 'reason':'更正接收状态', 'data':{}}, headers=self.headers)
        self.assertEqual(second.status_code, 200)
        result = self.client.get(path).json
        self.assertEqual(result['history'][1]['payload']['received'], True)
        self.assertEqual(result['history'][0]['actor'], '经办人')

    def test_new_workflow_cannot_skip_or_batch_bypass(self):
        self.enroll()
        from types import SimpleNamespace
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key='online_quotation')]
        stage = self.client.put('/api/projects/1/stages/online_quotation', json={'completed':True}, headers=self.headers)
        self.assertEqual(stage.status_code, 400)
        batch = self.client.post('/api/batch/advance-stage', json={'project_ids':[1]}, headers=self.headers)
        self.assertEqual(batch.status_code, 400)

    def test_stale_registration_and_wrong_notice_rejected(self):
        self.enroll()
        from types import SimpleNamespace
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key='online_quotation')]
        registration = SimpleNamespace(id=1,company_name='甲',lot_id=None)
        self.Project.registrations = [registration]
        data = dict(start_at='2026-09-01T09:00',end_at='2026-09-01T12:00',registration_end='2026-08-31T18:00',roster_locked=True,verified=True,ended_at='2026-09-01T10:00',end_reason='all_quoted',evidence='平台记录',records=[dict(registration_id=1,review='approved',amount='10',quoted_at='2026-09-01T10:00')])
        saved = self.client.put('/api/projects/1/online-bidding', json={'revision':0,'data':data}, headers=self.headers)
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(self.client.post('/api/projects/1/notice-deliveries',json={'supplier_name':'甲'},headers=self.headers).status_code,400)
        self.assertEqual(self.client.post('/api/projects/1/bid-results',json={'winning_supplier':'乙','winning_amount':10},headers=self.headers).status_code,400)
        registration.company_name='乙'
        stage = self.client.put('/api/projects/1/stages/online_quotation',json={'completed':True},headers=self.headers)
        self.assertEqual(stage.status_code,400)
        self.assertIn('变更',stage.json['error'])

    def test_old_completed_project_can_add_ledger_without_reopening_history(self):
        from types import SimpleNamespace
        self.login()
        self.Project.stages = [SimpleNamespace(stage_key='result_announced',completed=True)]
        result = self.client.put('/api/projects/1/online-bidding',json={'revision':0,'data':{'received':True}},headers=self.headers)
        self.assertEqual(result.status_code,200,result.json)

    def test_original_receipt_document_agreement_need_no_duplicate_confirmation(self):
        self.enroll()
        from types import SimpleNamespace
        self.login()
        self.Project.stages=[SimpleNamespace(stage_key='online_quotation')]
        for key in ('plan_received','online_documents','agreement_signed'):
            response=self.client.put('/api/projects/1/stages/'+key,json={'completed':True},headers=self.headers)
            self.assertEqual(response.status_code,200,(key,response.json))

    def test_publication_does_not_require_later_quotation_fields(self):
        data=subject.validate(dict(announcement_done=True,platform='平台',announcement_url='https://example.com',registration_end='2026-09-01T18:00'),[])
        self.assertTrue(data['announcement_done'])

    def test_new_default_only_attaches_quote_module_to_quote_stage(self):
        from src.backend_patches import stage_templates
        rows=stage_templates.online_bidding_template()
        self.assertEqual([r['id'] for r in rows if 'online_bidding' in r['modules']],['online_quotation'])
        old=[dict(r,modules=list(dict.fromkeys(r['modules']+['online_bidding']))) for r in rows]
        templates={method:old for method in stage_templates.PROCUREMENT_METHODS}
        normalized=stage_templates.normalize_stage_templates(templates,stage_templates.PROCUREMENT_METHODS,[],strict=True)
        self.assertEqual([r['id'] for r in normalized['网上竞价'] if 'online_bidding' in r['modules']],['online_quotation'])
        self.assertFalse(any('auto_completion' in r['modules'] for r in normalized['网上竞价']))


if __name__ == '__main__':
    unittest.main()
