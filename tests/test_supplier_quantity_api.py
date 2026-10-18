import unittest
from flask import jsonify
from sqlalchemy import text
import sqlite3
import json
from contextlib import closing
from tests import test_procurement_method_api as fixtures


class SupplierQuantityApiTests(unittest.TestCase):
    setUp=fixtures.ProcurementMethodApiTests.setUp
    tearDown=fixtures.ProcurementMethodApiTests.tearDown
    login=fixtures.ProcurementMethodApiTests.login
    catalog=fixtures.ProcurementMethodApiTests.catalog
    add=fixtures.ProcurementMethodApiTests.add
    create=fixtures.ProcurementMethodApiTests.create

    def stage_project(self):
        m=self.add(quantity_rule=dict(mode='fixed',minimum=3),template_mode='independent',stages=[dict(id='reg',name='报名',modules=['common','registration','auto_completion'])])
        return self.create(m).json['id']

    def attempt_concurrent_rule_change(self,pid):
        with closing(sqlite3.connect(self.db.engine.url.database,timeout=0)) as other:
            raw=other.execute('SELECT snapshot_json FROM project_procurement_snapshots WHERE project_id=?',(pid,)).fetchone()[0]
            snap=json.loads(raw);snap['quantity_rule']=dict(mode='fixed',minimum=3)
            try:
                other.execute('UPDATE project_procurement_snapshots SET snapshot_json=? WHERE project_id=?',(json.dumps(snap),pid));other.commit()
            except sqlite3.OperationalError as error:
                self.assertIn('locked',str(error));return True
            return False

    def test_single_and_batch_hold_write_lock_between_quantity_check_and_completion(self):
        from flask import request
        blocked=[]
        def complete(pid=None,key=None):
            ids=[pid] if pid else request.json['project_ids']
            for project_id in ids:
                blocked.append(self.attempt_concurrent_rule_change(project_id))
                self.db.session.execute(text('UPDATE stages SET completed=1 WHERE project_id=:p'),dict(p=project_id))
            self.db.session.commit();return jsonify(saved=True)
        self.app.add_url_rule('/api/projects/<int:pid>/stages/<key>','atomic_single',complete,methods=['PUT'])
        self.app.add_url_rule('/api/batch/advance-stage','atomic_batch',complete,methods=['POST'])
        m=self.add(template_mode='independent',stages=[dict(id='reg',name='报名',modules=['common','registration'])])
        for n,batch in enumerate([False,True]):
            pid=self.create(m,number=f'ATOMIC-{n}').json['id']
            r=self.client.post('/api/batch/advance-stage',json=dict(project_ids=[pid],stage_key='reg'),headers=self.headers) if batch else self.client.put(f'/api/projects/{pid}/stages/reg',json=dict(completed=True),headers=self.headers)
            self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(blocked,[True,True])

    def test_automatic_completion_locks_before_loading_and_validating_project(self):
        import sys
        from pathlib import Path
        from datetime import datetime
        from types import SimpleNamespace as NS
        from unittest.mock import patch
        from sqlalchemy.orm import joinedload
        from tests.test_app_replacements import load_replacements
        from src.backend_patches import supplier_quantity as quantity,procurement_catalog as catalog
        m=self.add(template_mode='independent',stages=[dict(id='reg',name='报名',modules=['common','registration','auto_completion'])])
        pid=self.create(m).json['id'];p=self.db.session.get(self.Project,pid)
        stage=p.stages[0];stage.planned_at=datetime(2026,10,18,12,0)
        type(stage).planned_datetime=property(lambda s:s.planned_at)
        self.Project.get_stage=lambda project,key:next((s for s in project.stages if s.stage_key==key),None)
        self.db.session.commit()
        module=load_replacements();module.app=self.app;module.db=self.db;module.Project=self.Project
        module.joinedload=lambda _:joinedload(self.Project.stages)
        module.datetime=datetime;module.text=text;module.STAGES=[];module._PROCUREMENT_CATALOG_ENABLED=True
        module.SETTINGS_PATH=Path(self.tmp.name)/'settings.json';module.load_app_settings=lambda:{}
        module._AUTO_COMPLETION_NOW=lambda:datetime(2026,10,18,13,0)
        module.SETTINGS_PATH.with_name('stage_auto_completion_state.json').write_text(json.dumps(dict(version=1,enabled_at='2026-10-18T11:00:00')))
        blocked=[];original=quantity.validate_stage_advance
        def validate(db,project,key,**kwargs):
            blocked.append(self.attempt_concurrent_rule_change(project.id))
            return original(db,project,key,**kwargs)
        with patch.dict(sys.modules,{'lot_supplier_risk':NS(ensure_schema=lambda *a,**k:None,apply_registration_cutoff=lambda *a,**k:[]),'supplier_quantity':quantity,'procurement_catalog':catalog}),patch.object(quantity,'validate_stage_advance',validate):
            module._auto_advance_stages()
        self.assertEqual(blocked,[True])
        self.assertTrue(self.db.session.get(self.Project,pid).stages[0].completed)

    def test_confirm_requires_auth_csrf_reason_and_current_fingerprint(self):
        pid=self.stage_project();url=f'/api/projects/{pid}/supplier-quantity'
        r=self.client.get(url+'?stage_key=reg');self.assertEqual(r.status_code,200,r.json)
        item=r.json['items'][0]
        body=dict(stage_key='reg',fingerprint=item['fingerprint'],reason='确认继续')
        self.assertEqual(self.client.post(url+'/confirm',json=body).status_code,403)
        self.assertEqual(self.client.post(url+'/confirm',json={**body,'reason':''},headers=self.headers).status_code,400)
        self.assertEqual(self.client.post(url+'/confirm',json={**body,'fingerprint':'old'},headers=self.headers).status_code,409)
        self.assertEqual(self.client.post(url+'/confirm',json=body,headers=self.headers).status_code,200)
        self.assertEqual(self.client.get(url+'?stage_key=reg').json['items'][0]['status'],'confirmed')

    def test_direct_completion_force_and_skip_do_not_bypass_quantity_gate(self):
        self.app.add_url_rule('/api/projects/<int:pid>/stages/<key>','complete_for_test',lambda pid,key:jsonify(saved=True),methods=['PUT'])
        pid=self.stage_project()
        for body in [dict(completed=True),dict(completed=True,force_complete=True),dict(skipped=True)]:
            r=self.client.put(f'/api/projects/{pid}/stages/reg',json=body,headers=self.headers)
            self.assertEqual(r.status_code,409,r.json)
            self.assertEqual(r.json['code'],'SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED')
        self.assertEqual(self.client.put(f'/api/projects/{pid}/stages/reg',json=dict(notes='普通资料保存'),headers=self.headers).status_code,200)

    def test_batch_does_not_bypass_and_does_not_partially_advance(self):
        self.app.add_url_rule('/api/batch/advance-stage','batch_for_test',lambda:jsonify(success=['must not reach']),methods=['POST'])
        pid=self.stage_project()
        r=self.client.post('/api/batch/advance-stage',json=dict(stage_key='reg',project_ids=[pid]),headers=self.headers)
        self.assertEqual(r.status_code,409,r.json)
        self.assertEqual(r.json['projects'][0]['project_id'],pid)
