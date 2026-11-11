import unittest
from sqlalchemy import text
from tests import test_procurement_method_api as f

class ElectronicTenderTests(unittest.TestCase):
    def setUp(self):
        f.ProcurementMethodApiTests.setUp(self)
        from flask import jsonify
        self.app.add_url_rule('/api/projects/<int:pid>/registrations','test_electronic_registration_guard',lambda pid:jsonify(saved=True),methods=['POST'])
    tearDown=f.ProcurementMethodApiTests.tearDown
    login=f.ProcurementMethodApiTests.login
    catalog=f.ProcurementMethodApiTests.catalog
    create=f.ProcurementMethodApiTests.create

    def project(self,electronic=True,number='E-1'):
        m=next(m for m in self.catalog()['methods'] if m['name']=='公开招标')
        rows=[dict(id='reg',name='报名截止',modules=['common','registration']),dict(id='open',name='开标',modules=['common','bid_opening']),dict(id='eval',name='评标',modules=['common','evaluation'])]
        r=self.client.patch('/api/procurement-methods/'+m['id'],json=dict(revision=m['revision'],template_mode='independent',stages=rows),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        m=r.json['method'];r=self.create(m,number=number,electronic_tender=electronic)
        self.assertEqual(r.status_code,201,r.json);pid=r.json['id']
        self.db.session.execute(text("UPDATE stages SET planned_at='2000-01-01 10:00:00' WHERE project_id=:p AND stage_key='reg'"),dict(p=pid));self.db.session.commit()
        return pid,r.json

    def state(self,pid):return self.client.get(f'/api/projects/{pid}/electronic-tender').json
    def save(self,pid,count,confirm=False,revision=None):
        s=self.state(pid)
        return self.client.put(f'/api/projects/{pid}/electronic-tender/registration',json=dict(revision=s['revision'] if revision is None else revision,record_version=s['record_version'],counts=[dict(lot_id=None,count=count)],confirm_shortage=confirm),headers=self.headers)

    def test_creation_inherits_public_flow_without_adding_supplier_rows(self):
        pid,p=self.project();self.assertTrue(p['procurement']['electronic_tender']);self.assertEqual([x['key'] for x in p['stages']],['reg','open','eval'])
        self.assertEqual(self.state(pid)['counts'],[]);self.assertEqual(self.db.session.get(self.Project,pid).registrations,[])

    def test_before_cutoff_and_missing_cutoff_reject_count_writes(self):
        pid,_=self.project()
        for cutoff in ['2999-01-01 10:00:00',None]:
            self.db.session.execute(text('UPDATE stages SET planned_at=:v WHERE project_id=:p'),dict(v=cutoff,p=pid));self.db.session.commit()
            r=self.save(pid,3);self.assertEqual(r.status_code,409,r.json);self.assertEqual(self.state(pid)['counts'],[])

    def test_three_completes_registration_without_names_and_replay_conflicts(self):
        pid,_=self.project();r=self.save(pid,3);self.assertEqual(r.status_code,200,r.json)
        self.assertTrue(self.state(pid)['registration_confirmed']);self.assertFalse(self.db.session.get(self.Project,pid).is_terminated)
        self.assertTrue(next(s for s in self.db.session.get(self.Project,pid).stages if s.stage_key=='reg').completed)
        self.assertEqual(self.save(pid,5,revision=0).status_code,409)

    def test_zero_one_two_require_flow_failure_confirmation_and_preserve_records(self):
        pid,_=self.project()
        for count in [0,1,2]:
            r=self.save(pid,count);self.assertEqual(r.status_code,409,r.json)
            self.assertFalse(self.db.session.get(self.Project,pid).is_terminated)
        r=self.save(pid,2,True);self.assertEqual(r.status_code,200,r.json)
        p=self.db.session.get(self.Project,pid);self.assertTrue(p.is_terminated);self.assertEqual(p.terminated_type,'liubiao');self.assertIn('2',p.terminated_reason)

    def test_invalid_count_and_ordinary_project_do_not_use_electronic_flow(self):
        pid,_=self.project()
        for count in [None,True,-1,2.5,'3']:
            self.assertEqual(self.save(pid,count).status_code,400)
        normal,_=self.project(False,'N-1');self.assertEqual(self.save(normal,3).status_code,409)

    def test_registered_quantity_uses_saved_count_but_opening_still_requires_names(self):
        from src.backend_patches import supplier_quantity as q
        pid,_=self.project();p=self.db.session.get(self.Project,pid)
        self.assertIsNone(q.evaluate_quantity(self.db,p,'reg')['actual_count'])
        self.assertEqual(self.save(pid,5).status_code,200)
        self.assertEqual(q.evaluate_quantity(self.db,p,'reg')['actual_count'],5)
        self.assertEqual(q.evaluate_quantity(self.db,p,'open')['status'],'pending')

    def test_csrf_denial_and_stale_project_token_are_not_written(self):
        pid,_=self.project();s=self.state(pid)
        r=self.client.put(f'/api/projects/{pid}/electronic-tender/registration',json=dict(revision=0,counts=[dict(lot_id=None,count=3)]));self.assertEqual(r.status_code,403)
        r=self.client.put(f'/api/projects/{pid}/electronic-tender/registration',json=dict(revision=0,record_version='stale',counts=[dict(lot_id=None,count=3)]),headers=self.headers)
        self.assertEqual(r.status_code,409);self.assertEqual(self.state(pid)['counts'],[])

    def test_required_registration_checklist_is_not_bypassed(self):
        from types import SimpleNamespace as NS
        pid,_=self.project();p=self.db.session.get(self.Project,pid)
        p.stage_checklist_items=[NS(stage_key='reg',required=True,completed=False,title='必须核对的事项')]
        r=self.save(pid,3);self.assertEqual(r.status_code,409,r.json);self.assertEqual(self.state(pid)['counts'],[])

    def test_quotes_use_real_project_supplier_ids_and_preserve_blank_zero_and_amounts(self):
        from types import SimpleNamespace as NS
        pid,_=self.project();self.assertEqual(self.save(pid,3).status_code,200)
        p=self.db.session.get(self.Project,pid);p.registrations=[NS(id=9,company_name='解密甲',lot_id=None),NS(id=10,company_name='解密乙',lot_id=None)]
        def write(items):
            state=self.state(pid)
            return self.client.put(f'/api/projects/{pid}/electronic-tender/quotes',json=dict(revision=state['revision'],record_version=state['record_version'],quotes=items),headers=self.headers)
        r=write([dict(registration_id=9,amount='0'),dict(registration_id=10,amount='1234.56')]);self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(r.json['quotes'],{'9':'0.00','10':'1234.56'})
        for items in [[dict(registration_id=999,amount='1')],[dict(registration_id=9,amount='NaN')],[dict(registration_id=9,amount='1.001')],[dict(registration_id=9,amount='-1')],[dict(registration_id=9,amount='1'),dict(registration_id=9,amount='2')]]:
            self.assertEqual(write(items).status_code,400)
        self.assertEqual(self.state(pid)['quotes'],{'9':'0.00','10':'1234.56'})

    def test_cutoff_change_invalidates_count_confirmation_and_preserves_old_observation(self):
        pid,_=self.project();self.assertEqual(self.save(pid,5).status_code,200)
        self.db.session.execute(text("UPDATE stages SET planned_at='2999-01-01 10:00:00' WHERE project_id=:p AND stage_key='reg'"),dict(p=pid));self.db.session.commit()
        state=self.state(pid);self.assertFalse(state['registration_confirmed']);self.assertEqual(state['counts'][0]['count'],5)

    def test_multi_lot_only_short_lot_flows_and_other_lot_can_continue(self):
        from types import SimpleNamespace as NS
        pid,_=self.project();p=self.db.session.get(self.Project,pid)
        self.db.session.execute(text("INSERT INTO project_lots(id,project_id,lot_number) VALUES(31,:p,'包1'),(32,:p,'包2')"),dict(p=pid));self.db.session.commit()
        p.lots=[NS(id=31,lot_number='包1'),NS(id=32,lot_number='包2')]
        state=self.state(pid)
        r=self.client.put(f'/api/projects/{pid}/electronic-tender/registration',json=dict(revision=0,record_version=state['record_version'],counts=[dict(lot_id=31,count=2),dict(lot_id=32,count=3)],confirm_shortage=True),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json);self.assertFalse(p.is_terminated)
        statuses=dict(self.db.session.execute(text('SELECT lot_id,status FROM lot_procurement_controls')).all())
        self.assertEqual(statuses[31],'liubiao');self.assertNotEqual(statuses.get(32),'liubiao')

    def test_original_supplier_form_string_lot_id_remains_accepted_for_eligible_package(self):
        from types import SimpleNamespace as NS
        pid,_=self.project();p=self.db.session.get(self.Project,pid)
        self.db.session.execute(text("INSERT INTO project_lots(id,project_id,lot_number) VALUES(31,:p,'包1')"),dict(p=pid));self.db.session.commit();p.lots=[NS(id=31,lot_number='包1')]
        state=self.state(pid)
        r=self.client.put(f'/api/projects/{pid}/electronic-tender/registration',json=dict(revision=0,record_version=state['record_version'],counts=[dict(lot_id=31,count=3)]),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        r=self.client.post(f'/api/projects/{pid}/registrations',json=dict(company_name='解密公司',lot_id='31'),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)

    def test_closed_package_history_does_not_block_other_package_opening_quotes(self):
        from types import SimpleNamespace as NS
        from unittest.mock import patch
        from src.backend_patches import electronic_tender as electronic, tender_guarantee
        pid,_=self.project();p=self.db.session.get(self.Project,pid)
        self.db.session.execute(text("INSERT INTO project_lots(id,project_id,lot_number) VALUES(31,:p,'包1'),(32,:p,'包2')"),dict(p=pid));self.db.session.commit()
        p.lots=[NS(id=31,lot_number='包1'),NS(id=32,lot_number='包2')]
        p.registrations=[NS(id=9,company_name='包1解密公司',lot_id=31),NS(id=10,company_name='包2解密公司',lot_id=32)]
        e=self.state(pid)
        r=self.client.put(f'/api/projects/{pid}/electronic-tender/registration',json=dict(revision=e['revision'],record_version=e['record_version'],counts=[dict(lot_id=31,count=3),dict(lot_id=32,count=3)]),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        e=self.state(pid)
        r=self.client.put(f'/api/projects/{pid}/electronic-tender/quotes',json=dict(revision=e['revision'],record_version=e['record_version'],quotes=[dict(registration_id=9,amount='500'),dict(registration_id=10,amount='600')]),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        from src.backend_patches import lot_supplier_risk
        lot_supplier_risk.ensure_schema(self.db)
        self.db.session.execute(text("INSERT INTO lot_procurement_controls(lot_id,status) VALUES(31,'liubiao')"));self.db.session.commit()
        # A closed lot may retain an unquoted submitted supplier as historical evidence.
        self.db.session.execute(text("UPDATE electronic_tender_ledgers SET quotes_json='{"+'"10":"600.00"'+"}' WHERE project_id=:p"),dict(p=pid));self.db.session.commit()
        with patch.object(tender_guarantee,'_load',return_value=(None,dict(records=[dict(registration_id=9,participation='submitted'),dict(registration_id=10,participation='submitted')]),None,None)):
            self.assertIsNone(electronic.completion_problem(self.db,p,'open'))
        self.assertEqual(self.state(pid)['closed_lot_ids'],[31])

    def test_existing_public_project_can_switch_to_electronic_without_replacing_history(self):
        from types import SimpleNamespace as NS
        pid,payload=self.project(False)
        p=self.db.session.get(self.Project,pid);p.notes='保留旧备注';p.registrations=[NS(id=91,lot_id=None,company_name='原供应商')]
        self.db.session.execute(text("UPDATE stages SET completed=1,notes='原阶段记录' WHERE project_id=:p AND stage_key='open'"),dict(p=pid));self.db.session.commit()
        before=[dict(s) for s in self.db.session.execute(text('SELECT * FROM stages WHERE project_id=:p'),dict(p=pid)).mappings()]
        response=self.client.put(f'/api/projects/{pid}',json=dict(procurement_method_id=payload['procurement']['method_id'],electronic_tender=True,record_version=self.state(pid)['record_version']),headers=self.headers)
        self.assertEqual(response.status_code,200,response.json);self.assertTrue(response.json['procurement']['electronic_tender'])
        self.assertEqual(response.json['method'],'公开招标-电子标')
        self.assertEqual(before,[dict(s) for s in self.db.session.execute(text('SELECT * FROM stages WHERE project_id=:p'),dict(p=pid)).mappings()])
        self.assertEqual(p.notes,'保留旧备注');self.assertEqual(p.registrations[0].company_name,'原供应商');self.assertEqual(self.state(pid)['counts'],[])

    def test_changing_back_and_reenabling_preserves_existing_counts_and_quotes(self):
        from types import SimpleNamespace as NS
        pid,payload=self.project();self.assertEqual(self.save(pid,3).status_code,200)
        p=self.db.session.get(self.Project,pid);p.registrations=[NS(id=91,lot_id=None,company_name='原供应商')]
        s=self.state(pid)
        response=self.client.put(f'/api/projects/{pid}/electronic-tender/quotes',json=dict(revision=s['revision'],record_version=s['record_version'],quotes=[dict(registration_id=91,amount='567.00')]),headers=self.headers);self.assertEqual(response.status_code,200,response.json)
        s=self.state(pid)
        for value in [True,False,True]:
            response=self.client.put(f'/api/projects/{pid}',json=dict(procurement_method_id=payload['procurement']['method_id'],electronic_tender=value,record_version=self.state(pid)['record_version']),headers=self.headers)
            self.assertEqual(response.status_code,200,response.json);self.assertEqual(bool(response.json['procurement'].get('electronic_tender')),value)
            stored=self.db.session.execute(text('SELECT revision,counts_json,quotes_json FROM electronic_tender_ledgers WHERE project_id=:p'),dict(p=pid)).first()
            self.assertEqual(stored[0],s['revision']);self.assertIn('567.00',stored[2]);self.assertIn('3',stored[1])

    def test_existing_project_mode_input_is_strict_boolean(self):
        pid,payload=self.project(False)
        for value in ['true',1,None]:
            response=self.client.put(f'/api/projects/{pid}',json=dict(procurement_method_id=payload['procurement']['method_id'],electronic_tender=value,record_version=self.state(pid)['record_version']),headers=self.headers)
            self.assertEqual(response.status_code,400,response.json)

    def test_electronic_correction_rejects_nonpublic_method_without_writing_other_fields(self):
        method=next(m for m in self.catalog()['methods'] if m['name']!='公开招标')
        result=self.create(method,number='OTHER');self.assertEqual(result.status_code,201,result.json);pid=result.json['id']
        response=self.client.put(f'/api/projects/{pid}',json=dict(procurement_method_id=method['id'],electronic_tender=True,notes='不应保存',record_version=self.state(pid)['record_version']),headers=self.headers)
        self.assertEqual(response.status_code,400,response.json);self.assertFalse(self.state(pid)['enabled']);self.assertEqual(self.db.session.get(self.Project,pid).notes,'')

    def test_stale_project_mode_correction_is_rejected_without_overwriting_latest_fields(self):
        pid,payload=self.project(False);old=self.state(pid)['record_version'];p=self.db.session.get(self.Project,pid);p.notes='其他窗口的新备注';self.db.session.commit()
        response=self.client.put(f'/api/projects/{pid}',json=dict(procurement_method_id=payload['procurement']['method_id'],electronic_tender=True,notes='旧草稿',record_version=old),headers=self.headers)
        self.assertEqual(response.status_code,409,response.json);self.assertFalse(self.state(pid)['enabled']);self.assertEqual(p.notes,'其他窗口的新备注')
