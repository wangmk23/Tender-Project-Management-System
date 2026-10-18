import json
import unittest
from datetime import datetime
from types import SimpleNamespace as NS
from sqlalchemy import text
from tests.procurement_fixtures import CatalogDatabase,STAGES
from src.backend_patches import procurement_catalog as c,stage_templates as st,tender_guarantee as tg
from src.backend_patches import supplier_quantity as q


class SupplierQuantityTests(unittest.TestCase):
    def setUp(self):
        self.db=CatalogDatabase();c.migrate_legacy(self.db,{},STAGES);tg.ensure_schema(self.db);q.ensure_schema(self.db)
        self.rows=[dict(id=key,name=key,modules=['common',module]) for key,module in [('reg','registration'),('open','bid_opening'),('eval','evaluation')]]
        st.replace_v5_project_stage_snapshot(self.db.session,text,1,self.rows)
        self.project=NS(id=1,method='公开招标',no_deposit=True,lots=[],is_terminated=False,
            registrations=[NS(id=n,company_name=f'供应商{n}',lot_id=None) for n in range(1,5)])
        self.data=dict(confirmed=True,records=[dict(registration_id=n,participation='submitted' if n<3 else 'absent',validity='valid' if n==1 else 'invalid' if n==2 else 'pending') for n in range(1,5)])
        self.store();self.db.session.commit()

    def tearDown(self):self.db.close()
    def store(self):
        fingerprint=tg.roster_fingerprint(tg._registrations(self.project))
        self.db.session.execute(text('INSERT INTO tender_ledgers VALUES(1,1,:data,:roster,\'[]\') ON CONFLICT(project_id) DO UPDATE SET payload=excluded.payload,roster=excluded.roster,revision=revision+1'),dict(data=json.dumps(self.data),roster=fingerprint))
    def check(self,key='eval'):return q.evaluate_quantity(self.db,self.project,key)

    def test_counts_registration_submission_and_validity_separately(self):
        self.assertEqual([self.check(key)['actual_count'] for key in ['reg','open','eval']],[4,2,1])
        self.assertEqual(self.check()['required_count'],3)
        self.assertEqual(self.check()['status'],'shortage')

    def test_pending_roster_not_misreported_as_zero(self):
        self.data['confirmed']=False;self.store()
        state=self.check();self.assertEqual(state['status'],'pending');self.assertIsNone(state['actual_count'])
        self.assertEqual(self.check('reg')['actual_count'],4)

    def test_absent_has_no_validity_requirement_but_submitted_pending_blocks(self):
        self.assertEqual(self.check()['status'],'shortage')
        self.data['records'][0]['validity']='pending';self.store()
        self.assertEqual(self.check()['status'],'pending')
        self.assertEqual(self.check('open')['actual_count'],2)

    def test_unfixed_rule_does_not_generate_shortage(self):
        snap=c.project_snapshot(self.db,1);snap['quantity_rule']=dict(mode='unfixed',minimum=None)
        self.db.session.execute(text('UPDATE project_procurement_snapshots SET snapshot_json=:j WHERE project_id=1'),{'j':json.dumps(snap)})
        state=self.check();self.assertEqual(state['status'],'unfixed');self.assertIsNone(state['missing_count'])
        self.assertIsNone(q.validate_stage_advance(self.db,self.project,'eval'))

    def test_reason_fingerprint_and_idempotency_are_enforced(self):
        state=self.check()
        for change in [dict(reason=''),dict(fingerprint='stale')]:
            body=dict(stage_key='eval',lot_id=None,fingerprint=state['fingerprint'],reason='采购文件约定，人工确认继续');body.update(change)
            with self.assertRaises(c.CatalogError):q.confirm_quantity(self.db,self.project,body,'admin')
        body=dict(stage_key='eval',lot_id=None,fingerprint=state['fingerprint'],reason='人工确认继续')
        q.confirm_quantity(self.db,self.project,body,'admin');q.confirm_quantity(self.db,self.project,body,'admin')
        self.assertEqual(self.check()['status'],'confirmed')
        self.assertEqual(self.db.session.execute(text('SELECT COUNT(*) FROM supplier_quantity_decisions')).scalar(),1)
        self.assertIsNone(q.validate_stage_advance(self.db,self.project,'eval'))

    def test_roster_and_project_rule_changes_invalidate_confirmation(self):
        state=self.check();q.confirm_quantity(self.db,self.project,dict(stage_key='eval',fingerprint=state['fingerprint'],reason='确认'),'admin')
        self.data['records'][0]['validity']='invalid';self.store()
        self.assertEqual(self.check()['status'],'shortage')
        self.project.registrations.append(NS(id=5,company_name='新供应商',lot_id=None))
        self.assertEqual(self.check()['status'],'pending')

    def test_exception_selection_is_explicit_audited_and_affects_next_phase(self):
        snap=c.project_snapshot(self.db,1);snap['exceptions']=[dict(id='ex1',title='文件约定',description='核对文件约定',enabled=True,quantity_rule=dict(mode='fixed',minimum=1))]
        self.db.session.execute(text('UPDATE project_procurement_snapshots SET snapshot_json=:j WHERE project_id=1'),{'j':json.dumps(snap)})
        state=self.check('open')
        q.confirm_quantity(self.db,self.project,dict(stage_key='open',fingerprint=state['fingerprint'],exception_id='ex1',reason='已核对文件条款'),'a')
        self.assertEqual(self.check('eval')['required_count'],1)
        self.assertEqual(self.check('eval')['rule_source'],'exception')

    def test_wrong_lot_and_unknown_stage_are_rejected(self):
        with self.assertRaises(c.CatalogError):q.evaluate_quantity(self.db,self.project,'eval',99)
        with self.assertRaises(c.CatalogError):q.evaluate_quantity(self.db,self.project,'missing')

    def test_method_change_invalidates_only_inherited_exception_scopes_retains_audit(self):
        a=c.save_method(self.db,dict(name='方式A',regime='enterprise',exceptions=[dict(title='文件约定',description='核对文件',enabled=True,quantity_rule=dict(mode='fixed',minimum=1))]),c.load_catalog(self.db)['revision'],'admin')
        c.bind_project(self.db,self.project,a)
        state=self.check('open')
        q.confirm_quantity(self.db,self.project,dict(stage_key='open',fingerprint=state['fingerprint'],exception_id=a['exceptions'][0]['id'],reason='A方式例外'),'admin')
        for lid in [11,12]:self.db.session.execute(text('INSERT INTO project_lots VALUES(:l,1,:n)'),dict(l=lid,n=str(lid)))
        self.db.session.execute(text('INSERT INTO lot_procurement_snapshots VALUES(12,:m,:j)'),dict(m=a['id'],j=json.dumps(c._snapshot(a))))
        for lid in [11,12]:self.db.session.execute(text("INSERT INTO procurement_quantity_overrides VALUES(1,:l,:r,'包例外',:ex,1)"),dict(l=lid,r=json.dumps(dict(mode='fixed',minimum=1)),ex=a['exceptions'][0]['id']))
        b=c.save_method(self.db,dict(name='方式B',regime='enterprise',quantity_rule=dict(mode='fixed',minimum=5)),c.load_catalog(self.db)['revision'],'admin')
        c.bind_project(self.db,self.project,b)
        self.assertEqual(self.check()['required_count'],5)
        self.assertEqual(self.check()['status'],'shortage')
        self.assertEqual([r[0] for r in self.db.session.execute(text('SELECT lot_id FROM procurement_quantity_overrides ORDER BY lot_id'))],[12])
        self.assertEqual(self.db.session.execute(text('SELECT COUNT(*) FROM supplier_quantity_decisions')).scalar(),1)

    def test_cutoff_never_automatically_changes_project_outcome(self):
        from src.backend_patches import lot_supplier_risk as risk
        self.project.registrations=self.project.registrations[:1]
        self.project.stages=[NS(stage_key='reg',planned_datetime=datetime(2026,1,1),completed=False)]
        result=risk.apply_registration_cutoff(self.db,self.project,datetime(2026,1,2),{'supplier_minimums':risk.DEFAULT_MINIMUMS})
        self.assertEqual(result,[]);self.assertFalse(self.project.is_terminated)
        self.assertEqual(self.db.session.execute(text("SELECT COUNT(*) FROM lot_supplier_events WHERE event_type='registration_shortage_auto'")).scalar(),0)

    def test_manual_and_automatic_gate_returns_explainable_problem(self):
        problem=q.validate_stage_advance(self.db,self.project,'eval',actor=None)
        self.assertEqual(problem['code'],'SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED')
        self.assertEqual(problem['items'][0]['actual_count'],1)
        self.assertFalse(self.project.is_terminated)

    def test_closed_lots_do_not_block_remaining_lot_quantity_checks(self):
        from src.backend_patches import lot_supplier_risk as risk
        risk.ensure_schema(self.db)
        for lid in [11,12]:self.db.session.execute(text('INSERT INTO project_lots VALUES(:l,1,:n)'),dict(l=lid,n=str(lid)))
        self.project.lots=[NS(id=11,lot_name='已人工流标'),NS(id=12,lot_name='继续办理')]
        for r in self.project.registrations:r.lot_id=12
        self.store()
        self.db.session.execute(text("INSERT INTO lot_procurement_controls(lot_id,status) VALUES(11,'liubiao')"))
        self.assertEqual([r['lot_id'] for r in q.stage_quantities(self.db,self.project,'eval')],[12])

    def test_updated_project_rule_invalidates_old_decision(self):
        state=self.check();q.confirm_quantity(self.db,self.project,dict(stage_key='eval',fingerprint=state['fingerprint'],reason='确认'),'a')
        snap=c.project_snapshot(self.db,1);snap['quantity_rule']['minimum']=2
        self.db.session.execute(text('UPDATE project_procurement_snapshots SET snapshot_json=:j WHERE project_id=1'),dict(j=json.dumps(snap)))
        self.assertEqual(self.check()['status'],'shortage')

    def test_confirmed_registration_warning_is_not_queued_after_cutoff(self):
        from src.backend_patches import lot_supplier_risk as risk
        self.project.registrations=self.project.registrations[:1]
        self.project.stages=[NS(stage_key='reg',planned_datetime=datetime(2026,1,1),completed=False)]
        state=self.check('reg');q.confirm_quantity(self.db,self.project,dict(stage_key='reg',fingerprint=state['fingerprint'],reason='人工核对继续'),'a')
        risk.apply_registration_cutoff(self.db,self.project,datetime(2026,1,2),{'supplier_minimums':risk.DEFAULT_MINIMUMS})
        self.assertEqual(risk.pending_mail_events(self.db),[])
