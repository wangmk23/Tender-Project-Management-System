"""HTTP contract for quantity reuse, suggestions and existing access gates."""
import json
import unittest

from flask import jsonify
from sqlalchemy import text

from tests import test_procurement_method_api as fixtures
from src.backend_patches import tender_guarantee as tg


class SupplierQuantityReuseApiTests(unittest.TestCase):
    setUp = fixtures.ProcurementMethodApiTests.setUp
    tearDown = fixtures.ProcurementMethodApiTests.tearDown
    login = fixtures.ProcurementMethodApiTests.login
    catalog = fixtures.ProcurementMethodApiTests.catalog
    add = fixtures.ProcurementMethodApiTests.add
    create = fixtures.ProcurementMethodApiTests.create

    def create_quantity_project(self):
        method = self.add(quantity_rule=dict(mode='fixed', minimum=3), template_mode='independent',
            stages=[dict(id=key, name=key, modules=['common', module]) for key, module in
                [('open', 'bid_opening'), ('eval', 'evaluation'), ('publish', 'result_publication')]])
        pid = self.create(method, no_deposit=True).json['id']
        self.db.session.execute(text("""INSERT INTO tender_ledgers VALUES(:p,1,:j,:roster,'[]')"""),
            dict(p=pid, j=json.dumps(dict(confirmed=True, records=[], amounts=[])),
                roster=tg.roster_fingerprint([])))
        self.db.session.commit()
        return pid, f'/api/projects/{pid}/supplier-quantity'

    def confirm(self, url, key):
        state = self.client.get(url + '?stage_key=' + key).json['items'][0]
        return self.client.post(url + '/confirm', json=dict(stage_key=key, lot_id=None,
            fingerprint=state['fingerprint'], reason='核对采购文件后继续'), headers=self.headers)

    def test_http_reused_decision_exposes_source_and_does_not_duplicate_ledger(self):
        _, url = self.create_quantity_project()
        saved = self.confirm(url, 'eval')
        self.assertEqual(saved.status_code, 200, saved.json)
        state = self.client.get(url + '?stage_key=publish').json['items'][0]
        self.assertEqual(state['status'], 'confirmed')
        self.assertTrue(state['decision_reused'])
        self.assertEqual(state['decision']['source_stage_key'], 'eval')
        self.assertEqual(state['decision']['phase'], 'valid')
        self.assertEqual(state['decision']['reason'], '核对采购文件后继续')
        self.assertEqual(state['decision']['actor'], '1')
        self.assertTrue(state['decision']['created_at'])
        self.assertIsNone(state['suggested_decision'])
        self.assertEqual(self.db.session.execute(text('SELECT COUNT(*) FROM supplier_quantity_decisions')).scalar(), 1)

    def test_http_suggestion_cannot_advance_until_explicit_current_phase_confirm(self):
        self.app.add_url_rule('/api/projects/<int:pid>/stages/<key>', 'complete_reuse_api_test',
            lambda pid, key: jsonify(saved=True), methods=['PUT'])
        pid, url = self.create_quantity_project()
        self.assertEqual(self.confirm(url, 'open').status_code, 200)
        state = self.client.get(url + '?stage_key=eval').json['items'][0]
        self.assertEqual(state['status'], 'shortage')
        self.assertIsNone(state['decision'])
        self.assertEqual(state['suggested_decision']['phase'], 'submitted')
        response = self.client.put(f'/api/projects/{pid}/stages/eval',
            json=dict(completed=True), headers=self.headers)
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json['code'], 'SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED')
        self.assertEqual(self.confirm(url, 'eval').status_code, 200)
        self.assertEqual(self.client.put(f'/api/projects/{pid}/stages/eval',
            json=dict(completed=True), headers=self.headers).status_code, 200)

    def test_existing_csrf_access_and_pending_gates_apply_to_reused_decisions(self):
        pid, url = self.create_quantity_project()
        self.confirm(url, 'eval')
        state = self.client.get(url + '?stage_key=publish').json['items'][0]
        body = dict(stage_key='publish', fingerprint=state['fingerprint'], reason='重新核对')
        self.assertEqual(self.client.post(url + '/confirm', json=body).status_code, 403)
        self.app.extensions['deadline_project_access'] = lambda user, project: False
        self.assertEqual(self.client.get(url + '?stage_key=publish').status_code, 403)
        self.assertEqual(self.client.post(url + '/confirm', json=body, headers=self.headers).status_code, 403)
        self.app.extensions.pop('deadline_project_access')
        self.db.session.execute(text('UPDATE tender_ledgers SET payload=:j WHERE project_id=:p'),
            dict(p=pid, j=json.dumps(dict(confirmed=False, records=[], amounts=[]))))
        self.db.session.commit()
        pending = self.client.get(url + '?stage_key=publish').json['items'][0]
        self.assertEqual(pending['status'], 'pending')
        self.assertIsNone(pending['decision'])
        self.assertFalse(pending['decision_reused'])
        self.assertIsNone(pending['suggested_decision'])
        response = self.client.post(url + '/confirm', json=body, headers=self.headers)
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json['code'], 'ROSTER_PENDING')


if __name__ == '__main__':
    unittest.main()
