import unittest
from flask import jsonify
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
