"""Reuse decisions only for the same scoped facts and effective quantity rule."""
import hashlib
import json
import unittest
from types import SimpleNamespace as NS

from sqlalchemy import text

from tests.procurement_fixtures import CatalogDatabase, STAGES
from src.backend_patches import procurement_catalog as c, stage_templates as st
from src.backend_patches import supplier_quantity as q, tender_guarantee as tg


class SupplierQuantityReuseTests(unittest.TestCase):
    def setUp(self):
        self.db = CatalogDatabase()
        c.migrate_legacy(self.db, {}, STAGES)
        tg.ensure_schema(self.db)
        q.ensure_schema(self.db)
        stages = [('reg', 'registration'), ('open', 'bid_opening'),
                  ('eval', 'evaluation'), ('publish', 'result_publication')]
        st.replace_v5_project_stage_snapshot(self.db.session, text, 1,
            [dict(id=key, name=key, modules=['common', module]) for key, module in stages])
        self.project = NS(id=1, no_deposit=True, lots=[],
            registrations=[NS(id=n, company_name=f'供应商{n}', lot_id=None) for n in (1, 2)])
        self.data = dict(confirmed=True, amounts=[], records=[dict(registration_id=n,
            participation='submitted', validity='valid', deposit_status='paid',
            deposit_amount='100.00') for n in (1, 2)])
        self.store()
        self.db.session.commit()

    def tearDown(self):
        self.db.close()

    def store(self):
        self.db.session.execute(text("""INSERT INTO tender_ledgers VALUES(1,1,:data,:roster,'[]')
            ON CONFLICT(project_id) DO UPDATE SET payload=excluded.payload,
            roster=excluded.roster,revision=revision+1"""), dict(data=json.dumps(self.data),
                roster=tg.roster_fingerprint(tg._registrations(self.project))))

    def check(self, key='eval', lot=None):
        state = q.evaluate_quantity(self.db, self.project, key, lot)
        self.assertIn('decision_reused', state)
        self.assertIn('suggested_decision', state)
        return state

    def confirm(self, key='eval', lot=None):
        return q.confirm_quantity(self.db, self.project, dict(stage_key=key, lot_id=lot,
            fingerprint=self.check(key, lot)['fingerprint'], reason='已核对采购文件，继续办理'), 'operator')

    def snapshot(self, **changes):
        value = c.project_snapshot(self.db, 1)
        value.update(changes)
        self.db.session.execute(text('UPDATE project_procurement_snapshots SET snapshot_json=:j WHERE project_id=1'),
            dict(j=json.dumps(value)))

    def add_lots(self):
        for n in (11, 12):
            self.db.session.execute(text('INSERT INTO project_lots VALUES(:n,1,:name)'), dict(n=n, name=str(n)))
        self.project.lots = [NS(id=n, lot_name=f'包{n}') for n in (11, 12)]
        for r in self.project.registrations:
            r.lot_id = 11
        self.project.registrations.append(NS(id=3, company_name='其他包供应商', lot_id=12))
        self.data['records'].append(dict(registration_id=3, participation='submitted', validity='valid'))
        self.data['amounts'] = [dict(lot_id=11, amount='50.00'), dict(lot_id=12, amount='100.00')]
        self.store()

    def insert_legacy(self, key='eval', lot=None):
        """Independent reproduction of v1's exact, order-sensitive wire snapshot."""
        phase = {'reg': 'registered', 'open': 'submitted', 'eval': 'valid', 'publish': 'valid'}[key]
        scoped_lot = next((l for l in self.project.lots if l.id == lot), None)
        rule = q.quantity_rule_for_scope(self.db, self.project, scoped_lot)
        regs = tg._registrations(self.project)
        facts = dict(registrations=regs)
        if phase != 'registered':
            records = {r['registration_id']: r for r in self.data['records']}
            selected = [records.get(r['id'], {}) for r in regs if r.get('lot_id') == lot]
            facts.update(confirmed=self.data.get('confirmed'), roster=tg.roster_fingerprint(regs),
                amounts=self.data.get('amounts', []), no_deposit=self.project.no_deposit,
                records=[{k: r.get(k) for k in ('registration_id', 'participation', 'validity',
                    'deposit_status', 'deposit_amount', 'bidder_identity_snapshot', 'lot_id_snapshot')}
                    for r in selected])
        raw = dict(project_id=1, lot_id=lot, stage_key=key, phase=phase, rule=rule, facts=facts)
        fingerprint = hashlib.sha256(json.dumps(raw, ensure_ascii=False, sort_keys=True,
            separators=(',', ':')).encode('utf-8')).hexdigest()
        saved = dict(reason='旧版已核对并同意继续', exception_id=None, actual_count=2,
            required_count=3, rule_source='project_snapshot')
        payload = json.dumps(saved, ensure_ascii=False)
        self.db.session.execute(text('''INSERT INTO supplier_quantity_decisions
            (project_id,lot_id,stage_key,fingerprint,payload_json,actor,created_at)
            VALUES(1,:l,:s,:f,:j,'legacy-operator','2026-11-01T01:02:03+00:00')'''),
            dict(l=lot or 0, s=key, f=fingerprint, j=payload))
        return payload

    def test_valid_confirmation_reused_at_publication_with_original_provenance(self):
        saved = self.confirm()
        state = self.check('publish')
        self.assertEqual(state['status'], 'confirmed')
        self.assertTrue(state['decision_reused'])
        self.assertEqual(state['decision']['source_stage_key'], 'eval')
        self.assertEqual(state['decision']['phase'], 'valid')
        self.assertEqual(state['decision']['reason'], '已核对采购文件，继续办理')
        self.assertEqual(state['decision']['actor'], 'operator')
        self.assertEqual(state['decision']['created_at'], saved['decision']['created_at'])
        self.assertIsNone(state['suggested_decision'])
        self.assertIsNone(q.validate_stage_advance(self.db, self.project, 'publish'))
        self.assertEqual(self.db.session.execute(text('SELECT COUNT(*) FROM supplier_quantity_decisions')).scalar(), 1)

    def test_current_phase_confirmation_metadata_is_not_marked_reused(self):
        state = self.confirm()
        self.assertFalse(state['decision_reused'])
        self.assertEqual(state['decision']['source_stage_key'], 'eval')
        self.assertEqual(state['decision']['phase'], 'valid')

    def test_submitted_to_valid_suggests_reason_but_requires_explicit_confirmation(self):
        self.confirm('open')
        state = self.check()
        self.assertEqual(state['status'], 'shortage')
        self.assertIsNone(state['decision'])
        self.assertFalse(state['decision_reused'])
        self.assertEqual(state['suggested_decision']['source_stage_key'], 'open')
        self.assertEqual(state['suggested_decision']['phase'], 'submitted')
        self.assertEqual(state['suggested_decision']['reason'], '已核对采购文件，继续办理')
        self.assertIsNotNone(q.validate_stage_advance(self.db, self.project, 'eval'))
        confirmed = self.confirm()
        self.assertEqual(confirmed['status'], 'confirmed')
        self.assertEqual(confirmed['decision']['source_stage_key'], 'eval')

    def test_newly_determined_validity_keeps_submitted_reason_available(self):
        self.data['records'][0]['validity'] = 'pending'
        self.store()
        self.confirm('open')
        self.data['records'][0]['validity'] = 'invalid'
        self.store()
        state = self.check()
        self.assertEqual(state['actual_count'], 1)
        self.assertEqual(state['status'], 'shortage')
        self.assertIsNotNone(state['suggested_decision'])
        self.assertEqual(state['suggested_decision']['phase'], 'submitted')

    def test_submitted_confirmation_survives_payment_validity_and_amount_only_changes(self):
        before = self.confirm('open')
        self.project.no_deposit = False
        self.data['records'][0].update(deposit_status='unpaid', deposit_amount='0.00', validity='invalid')
        self.data['amounts'] = [dict(lot_id=None, amount='500.00')]
        self.store()
        state = self.check('open')
        self.assertEqual(state['status'], 'confirmed')
        self.assertEqual(state['fingerprint'], before['fingerprint'])

    def test_valid_cash_change_preserving_eligibility_survives(self):
        self.project.no_deposit = False
        self.data['amounts'] = [dict(lot_id=None, amount='50.00')]
        self.store()
        before = self.confirm()
        self.data['records'][0]['deposit_amount'] = '200.00'
        self.data['amounts'][0]['amount'] = '75.00'
        self.store()
        self.assertEqual(self.check('publish')['status'], 'confirmed')
        self.assertEqual(self.check()['fingerprint'], before['fingerprint'])

    def test_other_lot_settings_and_facts_do_not_invalidate_target_scope(self):
        self.add_lots()
        self.project.no_deposit = False
        self.confirm(lot=11)
        self.data['amounts'][1]['amount'] = '999.00'
        self.data['records'][-1]['validity'] = 'invalid'
        self.project.registrations[-1].company_name = '包二更正名称'
        self.store()
        self.assertEqual(self.check('publish', 11)['status'], 'confirmed')
        self.assertEqual(self.check('publish', 12)['status'], 'shortage')

    def test_registration_and_record_order_do_not_invalidate_confirmation(self):
        self.confirm()
        self.project.registrations.reverse()
        self.data['records'].reverse()
        self.store()
        self.assertEqual(self.check('publish')['status'], 'confirmed')

    def test_changed_supplier_identity_same_count_invalidates_and_is_not_suggested(self):
        self.confirm()
        self.confirm('open')
        self.project.registrations[0].company_name = '另一家供应商'
        self.store()
        state = self.check('publish')
        self.assertEqual(state['actual_count'], 2)
        self.assertEqual(state['status'], 'shortage')
        self.assertIsNone(state['decision'])
        self.assertIsNone(state['suggested_decision'])

    def test_changed_counted_ids_same_count_invalidates(self):
        self.project.registrations.append(NS(id=3, company_name='供应商3', lot_id=None))
        self.data['records'].append(dict(registration_id=3, participation='absent', validity='pending'))
        self.store()
        self.confirm()
        self.data['records'][0]['validity'] = 'invalid'
        self.data['records'][2].update(participation='submitted', validity='valid')
        self.store()
        state = self.check('publish')
        self.assertEqual(state['actual_count'], 2)
        self.assertEqual(state['status'], 'shortage')

    def test_valid_same_count_with_different_payment_eligibility_invalidates(self):
        self.project.no_deposit = False
        self.data['amounts'] = [dict(lot_id=None, amount='100.00')]
        self.data['records'][1]['deposit_amount'] = '10.00'
        self.store()
        self.confirm()
        self.data['records'][0]['deposit_amount'] = '10.00'
        self.data['records'][1]['deposit_amount'] = '100.00'
        self.store()
        state = self.check('publish')
        self.assertEqual(state['actual_count'], 1)
        self.assertEqual(state['status'], 'shortage')

    def test_changed_minimum_or_method_prevents_reuse_and_suggestion(self):
        for change in (dict(quantity_rule=dict(mode='fixed', minimum=4)), dict(method_id='different-method'),
                       dict(method_revision=99)):
            with self.subTest(change=change):
                original = c.project_snapshot(self.db, 1)
                self.confirm('open')
                self.confirm()
                self.snapshot(**change)
                state = self.check('publish')
                self.assertEqual(state['status'], 'shortage')
                self.assertIsNone(state.get('decision'))
                self.assertIsNone(state['suggested_decision'])
                self.snapshot(**original)

    def test_explicit_lot_binding_invalidates_even_with_same_method_and_count(self):
        self.add_lots()
        self.confirm(lot=11)
        snapshot = c.project_snapshot(self.db, 1)
        self.db.session.execute(text('INSERT INTO lot_procurement_snapshots VALUES(11,:m,:j)'),
            dict(m=snapshot['method_id'], j=json.dumps(snapshot)))
        self.assertEqual(self.check('publish', 11)['status'], 'shortage')

    def test_global_pending_roster_and_current_validity_block_inherited_confirmation(self):
        self.confirm()
        self.data['confirmed'] = False
        self.store()
        self.assertEqual(self.check('publish')['status'], 'pending')
        self.data['confirmed'] = True
        self.data['records'][0]['validity'] = 'pending'
        self.store()
        self.assertEqual(self.check('publish')['status'], 'pending')
        self.assertIsNotNone(q.validate_stage_advance(self.db, self.project, 'publish'))

    def test_stale_global_roster_blocks_even_when_target_lot_unchanged(self):
        self.add_lots()
        self.confirm(lot=11)
        self.project.registrations[-1].company_name = '待核对的新名称'
        self.assertEqual(self.check('publish', 11)['status'], 'pending')

    def test_stale_fingerprint_rejected_after_identity_change_without_inserting_decision(self):
        previous = self.check()
        self.project.registrations[0].company_name = '更正供应商'
        self.store()
        with self.assertRaises(c.CatalogError) as caught:
            q.confirm_quantity(self.db, self.project, dict(stage_key='eval',
                fingerprint=previous['fingerprint'], reason='旧窗口提交'), 'operator')
        self.assertEqual((caught.exception.code, caught.exception.status), ('QUANTITY_CHANGED', 409))
        self.assertEqual(self.db.session.execute(text('SELECT COUNT(*) FROM supplier_quantity_decisions')).scalar(), 0)

    def test_removed_or_repurposed_source_stage_is_not_reused(self):
        self.confirm()
        self.db.session.execute(text("UPDATE stages SET template_removed=1 WHERE stage_key='eval'"))
        self.assertEqual(self.check('publish')['status'], 'shortage')
        self.db.session.execute(text("UPDATE stages SET template_removed=0,modules_json='[\"common\",\"registration\"]' WHERE stage_key='eval'"))
        self.assertEqual(self.check('publish')['status'], 'shortage')

    def test_v2_payload_records_context_without_stage_key_or_raw_money(self):
        self.confirm()
        row = self.db.session.execute(text('SELECT payload_json FROM supplier_quantity_decisions')).scalar()
        saved = json.loads(row)
        self.assertEqual(saved['version'], 2)
        self.assertEqual(saved['phase'], 'valid')
        self.assertEqual(saved['context']['phase'], 'valid')
        self.assertNotIn('stage_key', saved['context'])
        self.assertNotIn('deposit_amount', json.dumps(saved['context']))

    def test_exact_legacy_decision_reuses_across_same_phase_without_rewriting(self):
        raw = self.insert_legacy()
        state = self.check('publish')
        self.assertEqual(state['status'], 'confirmed')
        self.assertTrue(state['decision_reused'])
        self.assertEqual(state['decision']['reason'], '旧版已核对并同意继续')
        self.assertEqual(state['decision']['actor'], 'legacy-operator')
        self.assertEqual(state['decision']['source_stage_key'], 'eval')
        self.assertEqual(self.db.session.execute(text('SELECT payload_json FROM supplier_quantity_decisions')).scalar(), raw)

    def test_exact_legacy_current_stage_keeps_original_reason_and_metadata(self):
        self.insert_legacy()
        state = self.check()
        self.assertEqual(state['status'], 'confirmed')
        self.assertEqual(state['decision']['reason'], '旧版已核对并同意继续')
        self.assertFalse(state['decision_reused'])
        self.assertEqual(state['decision']['phase'], 'valid')

    def test_exact_legacy_submitted_reason_is_suggestion_only(self):
        raw = self.insert_legacy('open')
        state = self.check()
        self.assertEqual(state['status'], 'shortage')
        self.assertIsNone(state['decision'])
        self.assertEqual(state['suggested_decision']['phase'], 'submitted')
        self.assertEqual(self.db.session.execute(text('SELECT payload_json FROM supplier_quantity_decisions')).scalar(), raw)

    def test_legacy_hash_mismatch_never_approves_or_invents_equivalence(self):
        raw = self.insert_legacy()
        # v1 included cash; count is unchanged but it cannot prove the old rule/facts.
        self.data['records'][0]['deposit_amount'] = '200.00'
        self.store()
        state = self.check('publish')
        self.assertEqual(state['actual_count'], 2)
        self.assertEqual(state['status'], 'shortage')
        self.assertIsNone(state['decision'])
        self.assertIsNone(state['suggested_decision'])
        self.assertEqual(self.db.session.execute(text('SELECT payload_json FROM supplier_quantity_decisions')).scalar(), raw)

    def test_legacy_rule_or_identity_change_rejects_reason_even_with_same_count(self):
        self.insert_legacy('open')
        self.snapshot(method_id='changed-method')
        self.assertIsNone(self.check()['suggested_decision'])


if __name__ == '__main__':
    unittest.main()
