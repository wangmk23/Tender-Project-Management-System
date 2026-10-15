import copy
import unittest
from datetime import datetime
from src.backend_patches import tender_guarantee as tg


class TenderGuaranteeTests(unittest.TestCase):
    def setUp(self):
        self.regs=[dict(id=1,company_name='甲',lot_id=None),dict(id=2,company_name='乙',lot_id=10)]
        self.record=dict(registration_id=1,participation='submitted',validity='valid',reason='',
                         deposit_status='paid',deposit_amount='100',refunded_amount='0',handling='rule',
                         handling_reason='',review_at='',manual_start_at='',manual_deadline='',manual_basis='')
        self.data=dict(records=[self.record],rules=[],confirmed=True)

    def test_registration_never_implies_validity(self):
        data=tg.validate(dict(records=[],rules=[],confirmed=False),self.regs,[10])
        self.assertEqual(tg.eligible_ids(data,self.regs,None),[])
        data=tg.validate(self.data,self.regs,[10])
        self.assertEqual(tg.eligible_ids(data,self.regs,None),[1])
        self.assertEqual(tg.eligible_ids(data,self.regs,10),[])

    def test_unconfirmed_result_is_not_a_nonwinner(self):
        item=tg.derive_items(tg.validate(self.data,self.regs,[10]),self.regs,[],None)[0]
        self.assertEqual(item['scope'],'unconfirmed')
        self.assertFalse(item['deadline'])

    def test_paid_unverified_participant_never_uses_invalid_bid_rules(self):
        self.record.update(participation='pending',validity='pending')
        self.data['rules']=[dict(id='exception',lot_id=None,scope='exception',enabled=True,start_stage_key='',manual_start_at='2026-10-01',days=5,day_kind='calendar',cutoff='',remind_days=1)]
        item=tg.derive_items(tg.validate(self.data,self.regs,[10]),self.regs,[],[])[0]
        self.assertEqual(item['scope'],'unconfirmed')
        self.assertFalse(item['deadline'])

    def test_document_amount_is_independent_of_actual_payment(self):
        self.data['amounts']=[dict(lot_id=None,amount='30000')]
        value=tg.validate(self.data,self.regs,[10])
        self.assertEqual(value['amounts'][0]['amount'],'30000.00')
        self.assertEqual(value['records'][0]['deposit_amount'],'100.00')
        self.data['amounts']=[dict(lot_id=99,amount='30000')]
        with self.assertRaises(ValueError):tg.validate(self.data,self.regs,[10])

    def test_invalid_paid_still_has_balance(self):
        self.record.update(validity='invalid',reason='资格不符合',handling='review')
        data=tg.validate(self.data,self.regs,[10])
        self.assertEqual(tg.eligible_ids(data,self.regs,None),[])
        items=tg.derive_items(data,self.regs,[],[],datetime(2026,10,14))
        self.assertEqual(items[0]['balance'],'100.00')
        self.assertEqual(items[0]['status'],'review')

    def test_refund_bounds_and_unknown_cash(self):
        self.record['refunded_amount']='101'
        with self.assertRaises(ValueError): tg.validate(self.data,self.regs,[10])
        self.record.update(deposit_status='unknown',deposit_amount='100',refunded_amount='0')
        with self.assertRaises(ValueError): tg.validate(self.data,self.regs,[10])

    def test_valid_requires_received_documents_and_reasons(self):
        self.record['participation']='absent'
        with self.assertRaises(ValueError): tg.validate(self.data,self.regs,[10])
        self.record.update(validity='invalid',reason='')
        with self.assertRaises(ValueError): tg.validate(self.data,self.regs,[10])

    def test_workday_trigger_and_partial_refund(self):
        self.data['rules']=[dict(id='r1',lot_id=None,scope='nonwinner',enabled=True,start_stage_key='notice',manual_start_at='',days=5,day_kind='workday',cutoff='',remind_days=1)]
        self.record['refunded_amount']='30'
        data=tg.validate(self.data,self.regs,[10])
        stages=[dict(key='notice',completed=True,skipped=False,completed_date='2026-10-01')]
        item=tg.derive_items(data,self.regs,stages,[],datetime(2026,10,14))[0]
        self.assertEqual(item['deadline'],'2026-10-13')
        self.assertEqual(item['balance'],'70.00')
        self.assertEqual(item['status'],'overdue')

    def test_hold_retains_existing_deadline(self):
        self.record.update(handling='hold',handling_reason='核实退还依据',review_at='2026-10-20')
        data=tg.validate(self.data,self.regs,[10])
        old=[dict(id='registration:1',registration_id=1,deadline='2026-10-13',anchor='old',rule_id='r1')]
        item=tg.derive_items(data,self.regs,[],[],datetime(2026,10,14),previous=old)[0]
        self.assertEqual(item['deadline'],'2026-10-13')
        self.assertTrue(item['overdue'])
        self.assertEqual(item['status'],'hold')

    def test_changed_anchor_requires_review_not_silent_movement(self):
        self.record.update(manual_start_at='2026-10-01',manual_deadline='2026-10-13',manual_basis='采购文件确认')
        data=tg.validate(self.data,self.regs,[10])
        old=tg.derive_items(data,self.regs,[],[],datetime(2026,10,14))
        self.record['manual_deadline']='2026-10-20'
        fresh=tg.derive_items(tg.validate(self.data,self.regs,[10]),self.regs,[],[],datetime(2026,10,14),previous=old)
        self.assertEqual(fresh[0]['deadline'],'2026-10-13')
        self.assertTrue(fresh[0]['needs_recheck'])
        self.assertEqual(fresh[0]['proposed_deadline'],'2026-10-20')

    def test_duplicate_and_wrong_lot_or_registration_rejected(self):
        self.data['records'].append(copy.deepcopy(self.record))
        with self.assertRaises(ValueError): tg.validate(self.data,self.regs,[10])

    def test_consortium_members_are_part_of_roster_identity(self):
        a=[dict(id=1,company_name='牵头',lot_id=None,bidder_type='consortium',consortium_members=[{'company_name':'成员甲'}])]
        b=copy.deepcopy(a);b[0]['consortium_members']=[{'company_name':'成员乙'}]
        self.assertNotEqual(tg.roster_fingerprint(a),tg.roster_fingerprint(b))

    def test_missing_registration_does_not_erase_cash_snapshot(self):
        data=tg.validate(self.data,self.regs,[10])
        items=tg.derive_items(data,[],[],[],datetime(2026,10,14))
        self.assertEqual(items[0]['supplier_name'],'甲')
        self.assertEqual(items[0]['balance'],'100.00')

    def test_paid_identity_never_moves_with_registration_edit(self):
        data=tg.validate(self.data,self.regs,[10]);old=tg.derive_items(data,self.regs,[],[],datetime(2026,10,14))
        changed=[dict(id=1,company_name='另一家',lot_id=10)]
        data['stale']=True
        item=tg.derive_items(data,changed,[],[],datetime(2026,10,14),previous=old)[0]
        self.assertEqual(item['supplier_name'],'甲');self.assertIsNone(item['lot_id'])
        self.assertTrue(item['needs_recheck'])

    def test_orphaned_lot_rules_do_not_block_recording_actual_refund(self):
        regs=[dict(id=1,company_name='甲',lot_id=10)]
        raw=copy.deepcopy(self.data)
        raw['rules']=[dict(id='old',lot_id=10,scope='nonwinner',enabled=True,start_stage_key='removed',manual_start_at='',days=5,day_kind='calendar',cutoff='',remind_days=1)]
        previous=tg.validate(raw,regs,[10]);raw['records'][0]['refunded_amount']='100'
        updated=tg.validate(raw,[],[],previous)
        self.assertEqual(updated['records'][0]['refunded_amount'],'100.00')
        self.assertEqual(tg.derive_items(updated,[],[],[],datetime(2026,10,14))[0]['status'],'returned')


class TenderGuaranteeApiTests(unittest.TestCase):
    def setUp(self):
        from flask import Flask,jsonify
        from flask_sqlalchemy import SQLAlchemy
        from types import SimpleNamespace as NS
        self.app=Flask(__name__); self.app.config.update(SECRET_KEY='isolated',SQLALCHEMY_DATABASE_URI='sqlite://')
        self.db=SQLAlchemy(self.app); db=self.db
        class Project(db.Model):
            id=db.Column(db.Integer,primary_key=True)
            number=db.Column(db.String,default='TEST')
            name=db.Column(db.String,default='模拟项目')
            no_deposit=db.Column(db.Boolean,default=False)
            is_terminated=db.Column(db.Boolean,default=False)
            registrations=[];lots=[];stages=[];bid_results=[]
        self.Project=Project
        with self.app.app_context():
            db.create_all();db.session.add_all([Project(id=1),Project(id=2)]);db.session.commit()
        Project.registrations=[NS(id=1,company_name='甲',lot_id=None),NS(id=2,company_name='乙',lot_id=10)]
        Project.lots=[NS(id=10,lot_number='包1',lot_name='测试包')]
        Project.stages=[NS(stage_key='result_announced',completed=False,skipped=False,completed_date=None)]
        # Capture a historical finished publication policy separately.
        with self.app.app_context():
            tg.ensure_schema(db);p=db.session.get(Project,2)
            Project.stages[0].completed=True;tg.policy_for(db,p);db.session.commit();Project.stages[0].completed=False
        tg.register(self.app,db,{'Project':Project})
        self.app.add_url_rule('/api/projects/<int:pid>/bid-results','result',lambda pid:jsonify(ok=True),methods=['POST'])
        self.app.add_url_rule('/api/projects/<int:pid>/notice-deliveries','notice',lambda pid:jsonify(ok=True),methods=['POST'])
        self.client=self.app.test_client();self.headers={'X-CSRFToken':'token'}
        with self.client.session_transaction() as sess:sess.update(user_id=1,csrf_token='token',username='测试经办')
        self.record=dict(registration_id=1,participation='submitted',validity='valid',deposit_status='unpaid',handling='review')

    def save(self,data,revision=0,**extra):
        return self.client.put('/api/projects/1/tender-guarantee',json=dict(revision=revision,data=data,**extra),headers=self.headers)

    def test_new_results_require_confirmed_valid_same_lot_and_legacy_kept(self):
        self.assertEqual(self.client.post('/api/projects/1/bid-results',json={'winning_supplier':'甲'}).status_code,400)
        self.assertEqual(self.client.post('/api/projects/2/bid-results',json={'winning_supplier':'历史甲'}).status_code,200)
        saved=self.save(dict(records=[self.record],rules=[],confirmed=True))
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(self.client.post('/api/projects/1/bid-results',json={'winning_supplier':'甲'}).status_code,200)
        self.assertEqual(self.client.post('/api/projects/1/bid-results',json={'winning_supplier':'甲','lot_id':10}).status_code,400)

    def test_underpayment_api_keeps_cash_defaults_absent_and_cannot_publish(self):
        data=dict(records=[dict(self.record,deposit_status='paid',deposit_amount='5000')],
                  rules=[],amounts=[dict(lot_id=None,amount='10000')],confirmed=True)
        saved=self.save(data)
        self.assertEqual(saved.status_code,200,saved.json)
        row=saved.json['data']['records'][0]
        self.assertEqual(row['deposit_amount'],'5000.00')
        self.assertEqual(row['participation'],'absent')
        self.assertFalse(saved.json['data']['confirmed'])
        self.assertEqual(self.client.post('/api/projects/1/bid-results',json={'winning_supplier':'甲'}).status_code,400)

    def test_new_required_amount_blocks_new_result_without_changing_prior_participation(self):
        data=dict(records=[dict(self.record,deposit_status='paid',deposit_amount='100')],
                  rules=[],amounts=[dict(lot_id=None,amount='100')],confirmed=True)
        saved=self.save(data)
        self.assertEqual(saved.json['summary']['valid'],1)
        data=saved.json['data'];data['amounts'][0]['amount']='200'
        changed=self.save(data,1)
        self.assertEqual(changed.status_code,200,changed.json)
        self.assertEqual(changed.json['data']['records'][0]['participation'],'submitted')
        self.assertEqual(changed.json['summary']['valid'],0)
        self.assertEqual(self.client.post('/api/projects/1/bid-results',json={'winning_supplier':'甲'}).status_code,400)

    def test_csrf_revision_and_audit(self):
        data=dict(records=[],rules=[],confirmed=False)
        denied=self.client.put('/api/projects/1/tender-guarantee',json=dict(revision=0,data=data))
        self.assertEqual(denied.status_code,403)
        self.assertEqual(self.save(data).status_code,200)
        self.assertEqual(self.save(data).status_code,409)
        self.assertEqual(self.save(data,1).status_code,400)
        self.assertEqual(self.save(data,1,reason='重新核实').status_code,200)
        with self.app.app_context():
            self.assertEqual(tg._execute(self.db,'SELECT count(*) FROM tender_history').scalar(),2)

    def test_ordinary_refund_records_automatic_audit_but_special_change_requires_reason(self):
        data=dict(records=[dict(self.record,deposit_status='paid',deposit_amount='100')],rules=[],confirmed=False)
        self.assertEqual(self.save(data).status_code,200)
        data['records'][0]['refunded_amount']='30'
        response=self.save(data,1)
        self.assertEqual(response.status_code,200,response.json)
        with self.app.app_context():
            self.assertIn('退款',tg._execute(self.db,'SELECT reason FROM tender_history ORDER BY id DESC').scalar())
        data['records'][0].update(manual_start_at='2026-10-01',manual_deadline='2026-10-20',manual_basis='书面通知')
        self.assertEqual(self.save(data,2).status_code,400)

    def test_roster_changes_disable_eligibility_without_mutating_records(self):
        saved=self.save(dict(records=[self.record],rules=[],confirmed=True))
        self.assertEqual(saved.status_code,200)
        self.Project.registrations[0].company_name='甲更正'
        value=self.client.get('/api/projects/1/tender-guarantee').json
        self.assertTrue(value['data']['stale']);self.assertEqual(value['summary']['valid'],0)
        self.assertEqual(value['data']['records'][0]['registration_id'],1)

    def test_paid_balance_cannot_be_silently_reclassified(self):
        paid=dict(self.record,deposit_status='paid',deposit_amount='100')
        self.assertEqual(self.save(dict(records=[paid],rules=[],confirmed=False)).status_code,200)
        unpaid=dict(self.record,deposit_status='unpaid',deposit_amount='0')
        self.assertEqual(self.save(dict(records=[unpaid],rules=[],confirmed=False),1,reason='更正记录').status_code,400)

    def test_rule_edit_does_not_implicitly_reconfirm_changed_roster(self):
        self.assertEqual(self.save(dict(records=[self.record],rules=[],confirmed=True)).status_code,200)
        self.Project.registrations[0].company_name='甲已更正'
        updated=self.save(dict(records=[self.record],rules=[],confirmed=True),1,reason='核对期限')
        self.assertEqual(updated.status_code,200,updated.json)
        self.assertFalse(updated.json['data']['confirmed'])

    def test_notice_requires_valid_announced_winner(self):
        self.save(dict(records=[self.record],rules=[],confirmed=True))
        bad=self.client.post('/api/projects/1/notice-deliveries',json={'supplier_name':'甲'})
        self.assertEqual(bad.status_code,400)
        from types import SimpleNamespace as NS
        self.Project.bid_results=[NS(id=1,lot_id=None,winning_supplier='甲')]
        good=self.client.post('/api/projects/1/notice-deliveries',json={'supplier_name':'甲'})
        self.assertEqual(good.status_code,200)


if __name__=='__main__': unittest.main()
