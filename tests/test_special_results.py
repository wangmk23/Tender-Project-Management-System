import unittest
from types import SimpleNamespace as NS
from sqlalchemy import text
from tests import test_procurement_method_api as f


class SpecialResultsApiTests(unittest.TestCase):
    tearDown = f.ProcurementMethodApiTests.tearDown
    login = f.ProcurementMethodApiTests.login
    catalog = f.ProcurementMethodApiTests.catalog
    create = f.ProcurementMethodApiTests.create

    def setUp(self):
        f.ProcurementMethodApiTests.setUp(self)
        from src.backend_patches import procurement_api as api, special_results, tender_guarantee
        db = self.db

        class BidResult(db.Model):
            __tablename__ = 'bid_results'
            id = db.Column(db.Integer, primary_key=True)
            project_id = db.Column(db.Integer)
            lot_id = db.Column(db.Integer)
            winning_supplier = db.Column(db.String)
            winning_amount = db.Column(db.Numeric(15,2))
            discount_rate = db.Column(db.String)
            is_shortlisted = db.Column(db.Boolean)
            notes = db.Column(db.String)

        self.Result = self.models['BidResult'] = BidResult
        if 'procurement_catalog' in self.app.extensions:
            self.app.extensions['procurement_catalog']['BidResult'] = BidResult
        db.create_all()
        tender_guarantee.ensure_schema(db)
        special_results.register(self.app, self.db, self.models, api.authorize)
        special_results.register(self.app, self.db, self.models, api.authorize)  # idempotent
        self.sr = special_results
        m = next(m for m in self.catalog()['methods'] if m['name'] == '公开招标')
        r = self.create(m, number='SR-1')
        self.assertEqual(r.status_code, 201, r.json)
        self.pid = r.json['id']
        # Project is a per-test model class; requests load it in their own session.
        p = self.Project
        p.lots = []
        self.db.session.execute(text("INSERT OR REPLACE INTO tender_policies VALUES(:p,:policy)"),
            dict(p=self.pid,policy='{"strict_results":false}'))
        self.db.session.commit()
        p.registrations = [NS(id=11, company_name='甲公司', lot_id=None), NS(id=12, company_name='乙公司', lot_id=None),
                           NS(id=13, company_name='丙公司', lot_id=3), NS(id=14, company_name='丁公司', lot_id=3)]

    def url(self):
        return f'/api/projects/{self.pid}/special-results'

    def get(self, lot_id=None):
        r = self.client.get(self.url() + '?format=scenario' + (f'&lot_id={lot_id}' if lot_id else ''))
        self.assertEqual(r.status_code, 200, r.json)
        return r.json

    def put(self, **body):
        return self.client.put(self.url(), json=body, headers=self.headers)

    def two_suppliers_twelve_items(self):
        items = [dict(id=f'new:{i}', name=f'银行卡{i}', category='goods', unit='元/张') for i in range(12)]
        return self.put(revision=0, scenario='enterprise_multi', items=items, entries=[
            dict(registration_id=11, role='winner', prices={'new:0': dict(amount='1.25'), 'new:1': dict(amount='0')}),
            dict(registration_id=12, role='winner', prices={'new:0': dict(amount='1.30')})])

    def test_empty_state_for_ordinary_project(self):
        s = self.get()
        self.assertFalse(s['enabled'])
        self.assertEqual((s['revision'], s['items'], s['entries']), (0, [], []))
        self.assertIn('enterprise_multi', s['scenarios'])

    def test_one_save_registers_two_suppliers_and_twelve_items(self):
        r = self.two_suppliers_twelve_items()
        self.assertEqual(r.status_code, 200, r.json)
        s = self.get()
        self.assertEqual((s['revision'], len(s['items']), s['summary']['count']), (1, 12, 2))
        self.assertEqual(s['summary']['names'], ['甲公司', '乙公司'])
        i0, i1, i2 = (s['items'][k]['id'] for k in range(3))
        a, b = s['entries']
        self.assertEqual(a['prices'][i0]['amount'], '1.25')
        self.assertEqual(a['prices'][i1]['amount'], '0')     # explicit zero
        self.assertNotIn(i2, a['prices'])                     # not entered
        self.assertEqual(b['prices'][i0]['amount'], '1.3')
        self.assertIsNone(s['items'][0]['quantity'])

    def test_replay_and_failed_validation_do_not_change_saved_data(self):
        self.assertEqual(self.two_suppliers_twelve_items().status_code, 200)
        before = self.get()
        r = self.two_suppliers_twelve_items()
        self.assertEqual(r.status_code, 409)
        self.assertEqual(r.json['code'], 'REVISION_CONFLICT')
        self.assertEqual(r.json['current']['revision'], 1)
        bad = [dict(registration_id=11, role='winner'), dict(registration_id=13, role='winner')]
        r = self.put(revision=1, scenario='enterprise_multi', items=before['items'], entries=bad)
        self.assertEqual(r.status_code, 400, r.json)
        for amount in ['-1', '1.00001', 'NaN', 'abc', True]:
            r = self.put(revision=1, scenario='enterprise_multi', items=before['items'],
                         entries=[dict(registration_id=11, role='winner', prices={before['items'][0]['id']: dict(amount=amount)})])
            self.assertEqual(r.status_code, 400, (amount, r.json))
        self.assertEqual(self.get(), before)
        count = self.db.session.execute(text('SELECT COUNT(*) FROM special_result_entries')).scalar()
        self.assertEqual(count, 2)

    def test_service_billing_tax_and_note_round_trip(self):
        items = [dict(id='new:m', name='运维服务', category='service', unit='元/月'),
                 dict(id='new:o', name='部署', category='service', unit='元/项')]
        r = self.put(revision=0, scenario='enterprise_multi', items=items, entries=[dict(
            registration_id=11, role='winner', prices={
                'new:m': dict(amount='3000', amount_ex_tax='2830.19', tax_rate='6', billing='按月', note='含驻场'),
                'new:o': dict(amount='0', billing='一次性', note='免费')})])
        self.assertEqual(r.status_code, 200, r.json)
        s = self.get()
        m, o = (s['entries'][0]['prices'][i['id']] for i in s['items'])
        self.assertEqual((m['amount'], m['amount_ex_tax'], m['tax_rate'], m['billing'], m['note']),
                         ('3000', '2830.19', '6', '按月', '含驻场'))
        self.assertEqual((o['amount'], o['billing']), ('0', '一次性'))

    def test_government_and_framework_role_rules(self):
        two = [dict(registration_id=11, role='winner'), dict(registration_id=12, role='winner')]
        r = self.put(revision=0, scenario='gov_goods_service', items=[], entries=two)
        self.assertEqual((r.status_code, r.json['code']), (400, 'SINGLE_WINNER'))
        ok = [dict(registration_id=11, role='winner'), dict(registration_id=12, role='candidate')]
        self.assertEqual(self.put(revision=0, scenario='gov_goods_service', items=[], entries=ok).status_code, 200)
        r = self.put(revision=1, scenario='framework_stage1', items=[], entries=two)
        self.assertEqual((r.status_code, r.json['code']), (400, 'INVALID_ROLE'))
        stage1 = [dict(registration_id=11, role='shortlisted'), dict(registration_id=12, role='shortlisted')]
        r = self.put(revision=1, scenario='framework_stage1', items=[], entries=stage1)
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(r.json['summary']['count'], 2)

    def test_removing_priced_item_requires_confirmation(self):
        self.assertEqual(self.two_suppliers_twelve_items().status_code, 200)
        s = self.get()
        body = dict(revision=1, scenario='enterprise_multi', items=s['items'][1:],
                    entries=[dict(registration_id=11, role='winner'), dict(registration_id=12, role='winner')])
        r = self.put(**body)
        self.assertEqual((r.status_code, r.json['code'], r.json['items']), (409, 'CONFIRM_REMOVE_ITEMS', ['银行卡0']))
        self.assertEqual(self.get()['revision'], 1)
        r = self.put(**body, confirm_remove_items=True)
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(len(r.json['items']), 11)

    def test_lots_are_isolated_and_saved_entry_checks_scope(self):
        self.Project.lots = [NS(id=3)]
        r = self.client.put(self.url(), json=dict(lot_id=3, revision=0, scenario='gov_goods_service', items=[],
                                                  entries=[dict(registration_id=13, role='winner')]), headers=self.headers)
        self.assertEqual(r.status_code, 200, r.json)
        self.assertEqual(self.get(3)['summary']['names'], ['丙公司'])
        self.assertFalse(self.get()['enabled'])
        p = self.db.session.get(self.Project, self.pid)
        self.assertTrue(self.sr.saved_entry(self.db, self.models, p, 3, 13))
        self.assertFalse(self.sr.saved_entry(self.db, self.models, p, 3, 14))
        self.assertFalse(self.sr.saved_entry(self.db, self.models, p, None, 13))
        self.assertEqual(self.client.get(self.url() + '?lot_id=99').status_code, 404)
        self.assertEqual(self.client.get(self.url() + '?lot_id=x').status_code, 400)

    def test_auth_csrf_and_closed_project(self):
        r = self.client.put(self.url(), json=dict(revision=0, scenario='enterprise_multi', items=[], entries=[]))
        self.assertEqual(r.status_code, 403)
        p = self.db.session.get(self.Project, self.pid)
        p.is_terminated = True
        self.db.session.commit()
        r = self.put(revision=0, scenario='enterprise_multi', items=[], entries=[])
        self.assertEqual(r.status_code, 409, r.json)
        with self.client.session_transaction() as s:
            s.clear()
        self.assertEqual(self.client.get(self.url()).status_code, 401)


class SpecialResultsAssembledAppTests(unittest.TestCase):
    """End-to-end verification on create_app: candidate exclusion, same-name files, and cross-module guards."""

    def setUp(self):
        import tempfile
        from pathlib import Path
        from werkzeug.security import generate_password_hash
        from src.project_manager.standalone_app import create_app

        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = create_app(data_dir=Path(self.tmp.name), public_unrestricted=True)
        self.ctx = self.app.extensions['runtime_context']
        self.db = self.ctx['db']
        self.addCleanup(self._close_db)
        with self.app.app_context():
            user = self.ctx['User'](username='admin_sr', password_hash=generate_password_hash('pw-123456'),
                                    is_active=True, is_admin=True)
            self.db.session.add(user)
            self.db.session.commit()
        self.client = self.app.test_client()
        self.client.post('/login', data={'username': 'admin_sr', 'password': 'pw-123456'})
        self.headers = {'X-CSRFToken': self.client.post('/api/csrf-refresh').json['csrf_token']}

    def _close_db(self):
        with self.app.app_context():
            self.db.session.remove()
            self.db.engine.dispose()

    def _seed_project_with_eligible_suppliers(self, number='ASM-1', with_lot=False):
        r = self.client.post('/api/projects', headers=self.headers, json={
            'number': number, 'name': '集成验证项目', 'method': '公开招标', 'purchaser': '测试银行', 'year': 2026})
        self.assertEqual(r.status_code, 201, r.json)
        pid = r.json['id']
        lot_id = None
        if with_lot:
            lr = self.client.post(f'/api/projects/{pid}/lots', headers=self.headers,
                                  json={'lot_number': '包1', 'lot_name': '空白卡包'})
            self.assertEqual(lr.status_code, 201, lr.json)
            lot_id = lr.json['id']
        rids = []
        for name in ('供应商甲', '供应商乙', '供应商丙'):
            rr = self.client.post(f'/api/projects/{pid}/registrations', headers=self.headers,
                                  json={'company_name': name, 'lot_id': lot_id, 'registration_method': '线上报名'})
            self.assertEqual(rr.status_code, 201, rr.json)
            rids.append(rr.json['id'])
        tg = self.client.get(f'/api/projects/{pid}/tender-guarantee').json
        tg['data'].update(confirmed=True, records=[
            dict(registration_id=rid, participation='submitted', validity='valid', deposit_status='paid',
                 deposit_amount='100', refunded_amount='0', handling='rule') for rid in rids])
        tr = self.client.put(f'/api/projects/{pid}/tender-guarantee', headers=self.headers,
                             json=dict(revision=tg['revision'], data=tg['data'], confirm_roster=True, reason='核验通过'))
        self.assertEqual(tr.status_code, 200, tr.json)
        return pid, lot_id, rids

    def test_multiple_named_price_lines_per_item_and_supplier(self):
        pid, _, rids = self._seed_project_with_eligible_suppliers('ASM-PRICE-LINES', with_lot=False)
        url = f'/api/projects/{pid}/special-results'
        item = dict(id='cards', name='银行卡空白卡采购项目', kind='goods', unit='张')
        entries = [
            dict(registration_id=rid, role='shortlisted', prices=[
                dict(item_id='cards', kind='unit', line_no=i+1, detail_name=f'卡类 {i+1}',
                     value=f'{idx+1}.{i:02d}') for i in range(12)])
            for idx, rid in enumerate(rids[:2])
        ]
        payload = dict(revision=0, mode='multi', items=[item], entries=entries)
        entries[0]['prices'][1]['line_no'] = 1
        conflict = self.client.put(url, headers=self.headers, json=payload)
        self.assertEqual(conflict.json['code'], 'INVALID_PRICE')
        entries[0]['prices'][1]['line_no'] = 2
        saved = self.client.put(url, headers=self.headers, json=payload)
        self.assertEqual(saved.status_code, 200, saved.json)
        current = self.client.get(url).json
        self.assertEqual(current['items'], saved.json['items'])
        for idx, entry in enumerate(current['entries']):
            self.assertEqual([(p['line_no'], p['detail_name']) for p in entry['prices']],
                             [(i+1, f'卡类 {i+1}') for i in range(12)])
            self.assertEqual(entry['prices'][11]['value'], f'{idx+1}.11')
        legacy = self.client.get(url + '?format=scenario').json
        self.assertEqual(len(legacy['entries'][0]['price_lines']), 12)
        for entry in legacy['entries']:
            entry.pop('price_lines')
        legacy.pop('mode')
        blocked = self.client.put(url, headers=self.headers, json=legacy)
        self.assertEqual(blocked.json['code'], 'PRICE_LINES_REQUIRED')
        self.assertEqual(self.client.get(url).json['entries'], current['entries'])

    def test_candidates_never_counted_as_winners_and_same_name_files_stay_distinct(self):
        from io import BytesIO
        pid, lot_id, rids = self._seed_project_with_eligible_suppliers('ASM-CAND', with_lot=True)
        url = f'/api/projects/{pid}/special-results?lot_id={lot_id}'
        # 1) Pure candidate ranking creates zero formal BidResult rows
        r = self.client.put(url, headers=self.headers, json=dict(
            revision=0, mode='candidates', items=[],
            entries=[dict(registration_id=rids[0], role='candidate', rank=1, prices=[]),
                     dict(registration_id=rids[1], role='candidate', rank=2, prices=[])]))
        self.assertEqual(r.status_code, 200, r.json)
        proj = self.client.get(f'/api/projects/{pid}').json
        self.assertEqual(proj['bid_results'], [])
        self.assertEqual(proj['special_results'], [dict(lot_id=lot_id, mode='candidates', revision=1)])

        # 2) Dual shortlisted/winner with same-name price files + one candidate
        r2 = self.client.put(url, headers=self.headers, json=dict(
            revision=1, mode='multi',
            items=[dict(id='item-1', name='IC借记卡', kind='goods', spec='国密', unit='元/张', quantity='')],
            entries=[
                dict(registration_id=rids[0], role='shortlisted', rank=1,
                     prices=[dict(item_id='item-1', kind='unit', value='1.68')]),
                dict(registration_id=rids[1], role='shortlisted', rank=2,
                     prices=[dict(item_id='item-1', kind='unit', value='1.72')]),
                dict(registration_id=rids[2], role='candidate', rank=3, prices=[]),
            ]))
        self.assertEqual(r2.status_code, 200, r2.json)
        proj2 = self.client.get(f'/api/projects/{pid}').json
        self.assertEqual(len(proj2['bid_results']), 2)
        self.assertEqual({b['winning_supplier'] for b in proj2['bid_results']}, {'供应商甲', '供应商乙'})
        self.assertTrue(all(b.get('special_result_mode') == 'multi' for b in proj2['bid_results']))

        # Ordinary bid-results write in the same lot is blocked with 409
        blocked = self.client.post(f'/api/projects/{pid}/bid-results', headers=self.headers,
                                   json={'lot_id': lot_id, 'winning_supplier': '供应商丙', 'winning_amount': '100'})
        self.assertEqual(blocked.status_code, 409, blocked.json)

        # Referenced registration & lot cannot be renamed or deleted
        self.assertEqual(self.client.delete(f'/api/projects/{pid}/registrations/{rids[0]}', headers=self.headers).status_code, 409)
        self.assertEqual(self.client.put(f'/api/projects/{pid}/registrations/{rids[0]}', headers=self.headers,
                                         json={'company_name': '改名公司', 'lot_id': lot_id}).status_code, 409)
        self.assertEqual(self.client.delete(f'/api/projects/{pid}/lots/{lot_id}', headers=self.headers).status_code, 409)

        # Two suppliers upload identical filename '报价明细表.txt' with distinct bytes
        payloads = {rids[0]: b'SUPPLIER-A-1.68-ORIGINAL', rids[1]: b'SUPPLIER-B-1.72-ORIGINAL'}
        aids = {}
        for rid, content in payloads.items():
            up = self.client.post(
                f'/api/projects/{pid}/special-results/registrations/{rid}/attachments?lot_id={lot_id}',
                headers=self.headers, data={'files': (BytesIO(content), '报价明细表.txt')})
            up.request.environ['wsgi.input'].close()
            self.assertEqual(up.status_code, 200, up.json)
            self.assertEqual(len(up.json['attachments']), 1)
            aids[rid] = up.json['attachments'][0]['id']
        self.assertNotEqual(aids[rids[0]], aids[rids[1]])
        for rid, expected in payloads.items():
            with self.client.get(f'/api/attachments/{aids[rid]}/download') as dl:
                self.assertEqual(dl.status_code, 200)
                self.assertEqual(dl.data, expected)


if __name__ == '__main__':
    unittest.main()
