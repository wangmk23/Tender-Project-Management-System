"""Date-based refund review boundaries, including saved v5.8.60 anchors."""
import copy
import unittest
from datetime import datetime

from src.backend_patches import tender_guarantee as tg


class GuaranteeDeadlineRecheckTests(unittest.TestCase):
    def setUp(self):
        self.registrations = [dict(id=1, company_name='甲', lot_id=None)]
        raw = dict(confirmed=True, records=[dict(
            registration_id=1, participation='submitted', validity='valid',
            deposit_status='paid', deposit_amount='100', refunded_amount='0', handling='rule')],
            rules=[dict(id='r', lot_id=None, scope='nonwinner', enabled=True,
                        start_stage_key='anchor', manual_start_at='', days=5,
                        day_kind='calendar', cutoff='17:00', remind_days=1)])
        self.data = tg.validate(raw, self.registrations, [])
        self.stages = [dict(key='anchor', completed=True, skipped=False,
                            completed_at='2026-10-01T09:00')]
        self.now = datetime(2026, 10, 2, 12)

    def derive(self, previous=None, **kwargs):
        return tg.derive_items(self.data, self.registrations, self.stages, [], self.now,
                               previous=previous, **kwargs)[0]

    def legacy_item(self):
        # Frozen v60 result from the independently captured 2026-11-04 audit.
        # Do not regenerate this anchor using the current implementation.
        return dict(id='registration:1', registration_id=1, lot_id=None,
                    supplier_name='甲', scope='nonwinner', balance='100.00',
                    deadline='2026-10-06T17:00', proposed_deadline='', status='pending',
                    review_at='', basis='2026-10-01起算', needs_recheck=False, overdue=False,
                    rule_id='r', anchor='9260b24c2fb4cc94a76265258e85464213a86c7d69fff7eb58b0e383657bb89a',
                    estimated_deadline='', estimated_start_at='', start_stage_key='anchor',
                    remind_days=1, start_at='2026-10-01', issue_code='',
                    status_detail='2026-10-01起算', next_action='')

    def assert_unchanged_deadline(self, item):
        self.assertEqual(item['deadline'], '2026-10-06T17:00')
        self.assertEqual(item['proposed_deadline'], '')
        self.assertFalse(item['needs_recheck'])
        self.assertEqual(item['status'], 'pending')

    def test_reminder_change_keeps_date_approval_and_updates_reminder(self):
        before = self.derive()
        self.data['rules'][0]['remind_days'] = 2
        after = self.derive([before])
        self.assert_unchanged_deadline(after)
        self.assertEqual(after['remind_days'], 2)
        self.assertEqual(after['anchor'], before['anchor'])

    def test_same_day_actual_time_correction_keeps_date_approval(self):
        before = self.derive()
        self.stages[0]['completed_at'] = '2026-10-01T10:00'
        after = self.derive([before])
        self.assert_unchanged_deadline(after)
        self.assertEqual(after['anchor'], before['anchor'])

    def test_unchanged_v60_saved_item_survives_upgrade_and_subsequent_reads(self):
        prior = self.legacy_item()
        original = copy.deepcopy(prior)
        after = self.derive([prior])
        self.assert_unchanged_deadline(after)
        self.assertEqual(prior, original)
        self.stages[0]['completed_at'] = '2026-10-01T10:00'
        self.assert_unchanged_deadline(self.derive([after]))

    def test_reminder_change_during_upgrade_uses_saved_v60_reminder_evidence(self):
        self.data['rules'][0]['remind_days'] = 2
        after = self.derive([self.legacy_item()])
        self.assert_unchanged_deadline(after)
        self.assertEqual(after['remind_days'], 2)

    def test_unverifiable_legacy_time_change_keeps_review_even_when_date_matches(self):
        self.stages[0]['completed_at'] = '2026-10-01T10:00'
        after = self.derive([self.legacy_item()])
        self.assertTrue(after['needs_recheck'])
        self.assertEqual(after['status'], 'review')

    def test_actual_day_change_keeps_saved_deadline_until_explicit_acceptance(self):
        before = self.derive()
        self.stages[0]['completed_at'] = '2026-10-02T09:00'
        after = self.derive([before])
        self.assertTrue(after['needs_recheck'])
        self.assertEqual(after['deadline'], '2026-10-06T17:00')
        self.assertEqual(after['proposed_deadline'], '2026-10-07T17:00')
        self.assertEqual(after['anchor'], before['anchor'])
        accepted = self.derive([after], accept_recalculation=True)
        self.assertEqual(accepted['deadline'], '2026-10-07T17:00')
        self.assertFalse(accepted['needs_recheck'])

    def test_rule_change_with_same_calculated_deadline_still_requires_review(self):
        for saved in ('current', 'v60'):
            with self.subTest(saved=saved):
                self.setUp()
                prior = self.derive() if saved == 'current' else self.legacy_item()
                # This is a different start stage despite an identical actual day.
                self.data['rules'][0]['start_stage_key'] = 'other'
                self.stages.append(dict(self.stages[0], key='other'))
                after = self.derive([prior])
                self.assertTrue(after['needs_recheck'])
                self.assertEqual(after['proposed_deadline'], '2026-10-06T17:00')
                self.assertEqual(after['status'], 'review')

    def test_day_counting_rule_change_still_reviews_when_this_date_happens_to_match(self):
        self.data['rules'][0].update(days=1)
        self.stages[0]['completed_at'] = '2026-10-08T09:00'
        prior = self.derive()
        self.data['rules'][0]['day_kind'] = 'workday'
        after = self.derive([prior])
        self.assertTrue(after['needs_recheck'])
        self.assertEqual(after['deadline'], '2026-10-09T17:00')
        self.assertEqual(after['proposed_deadline'], '2026-10-09T17:00')

    def test_existing_recheck_is_never_accepted_by_matching_inputs_or_reminder_edit(self):
        for saved in ('current', 'v60'):
            with self.subTest(saved=saved):
                self.setUp()
                prior = self.derive() if saved == 'current' else self.legacy_item()
                prior.update(needs_recheck=True, status='review', proposed_deadline=prior['deadline'])
                self.data['rules'][0]['remind_days'] = 2
                after = self.derive([prior])
                self.assertTrue(after['needs_recheck'])
                self.assertEqual(after['deadline'], '2026-10-06T17:00')
                self.assertEqual(after['status'], 'review')

    def test_existing_recheck_without_approved_deadline_requires_explicit_acceptance(self):
        prior = self.legacy_item()
        prior.update(deadline='', status='review', needs_recheck=True)
        after = self.derive([prior])
        self.assertTrue(after['needs_recheck'])
        self.assertEqual(after['status'], 'review')
        self.assertEqual(after['deadline'], '')
        self.assertEqual(after['proposed_deadline'], '2026-10-06T17:00')
        accepted = self.derive([after], accept_recalculation=True)
        self.assertFalse(accepted['needs_recheck'])
        self.assertEqual(accepted['deadline'], '2026-10-06T17:00')

    def test_balance_or_reminder_update_cannot_resume_review_or_hold(self):
        for handling in ('review', 'hold'):
            for saved in ('current', 'v60'):
                with self.subTest(handling=handling, saved=saved):
                    self.setUp()
                    prior = self.derive() if saved == 'current' else self.legacy_item()
                    self.data['records'][0].update(handling=handling,
                        handling_reason='等待核实退还依据', review_at='2026-10-20', refunded_amount='30.00')
                    prior.update(status=handling, needs_recheck=True)
                    self.data['rules'][0]['remind_days'] = 2
                    after = self.derive([prior])
                    self.assertEqual(after['status'], handling)
                    self.assertTrue(after['needs_recheck'])
                    self.assertEqual(after['deadline'], '2026-10-06T17:00')
                    self.assertEqual(after['balance'], '70.00')

    def test_outcome_change_cannot_reuse_nonwinner_approval(self):
        prior = self.derive()
        self.data['rules'].append(dict(self.data['rules'][0], id='winner', scope='winner'))
        after = tg.derive_items(self.data, self.registrations, self.stages,
            [dict(lot_id=None, winning_supplier='甲')], self.now, previous=[prior])[0]
        self.assertEqual(after['scope'], 'winner')
        self.assertTrue(after['needs_recheck'])

    def test_paid_identity_change_still_preserves_original_cash_owner_and_review(self):
        prior = self.derive()
        self.registrations[0].update(company_name='另一主体', lot_id=2)
        after = self.derive([prior], accept_recalculation=True)
        self.assertEqual(after['supplier_name'], '甲')
        self.assertIsNone(after['lot_id'])
        self.assertEqual(after['balance'], '100.00')
        self.assertTrue(after['needs_recheck'])
        self.assertEqual(after['issue_code'], 'cash_identity_changed')

    def test_calendar_change_that_moves_deadline_still_requires_review(self):
        from src.backend_patches import holiday_calendar as hc
        self.data['rules'][0].update(days=1, day_kind='workday')
        self.stages[0]['completed_at'] = '2026-10-08T09:00'
        prior = self.derive()
        self.assertEqual(prior['deadline'], '2026-10-09T17:00')
        candidate = hc.validate_data(hc._builtin())
        candidate['holidays'].append(dict(date='2026-10-09', name='隔离测试休息日'))
        after = self.derive([prior], cache_dir={2026: candidate})
        self.assertTrue(after['needs_recheck'])
        self.assertEqual(after['deadline'], '2026-10-09T17:00')
        self.assertEqual(after['proposed_deadline'], '2026-10-10T17:00')

    def test_api_upgrade_persists_safe_anchor_without_rewriting_cash_or_historical_audit(self):
        import json
        from types import SimpleNamespace as NS
        from tests.test_tender_guarantee import TenderGuaranteeApiTests
        case = TenderGuaranteeApiTests(methodName='runTest')
        case.setUp()
        self.addCleanup(case.doCleanups)
        case.Project.stages = [
            NS(stage_key='result_announced', completed=True, skipped=False, completed_date=None),
            NS(stage_key='anchor', completed=True, skipped=False, completed_date=None)]
        stored_data = json.dumps(self.data, ensure_ascii=False)
        stored_history = json.dumps(dict(data=self.data, items=[self.legacy_item()]), ensure_ascii=False)
        with case.app.app_context():
            tg._execute(case.db, 'CREATE TABLE stages(project_id INTEGER, stage_key TEXT, completed_at TEXT)')
            tg._execute(case.db, 'INSERT INTO stages VALUES(1,:key,:at)',
                        dict(key='anchor', at='2026-10-01T09:00'))
            tg._execute(case.db, 'INSERT INTO tender_ledgers VALUES(1,7,:data,:roster,:items)',
                        dict(data=stored_data, roster=tg.roster_fingerprint(self.registrations),
                             items=json.dumps([self.legacy_item()], ensure_ascii=False)))
            tg._execute(case.db, 'INSERT INTO tender_history VALUES(1,1,7,:data,:actor,:at,:reason)',
                        dict(data=stored_history, actor='原经办', at='2026-10-02T10:00:00', reason='原核对依据'))
            case.db.session.commit()
        first = case.client.get('/api/projects/1/tender-guarantee')
        self.assertEqual(first.status_code, 200)
        self.assertFalse(first.json['items'][0]['needs_recheck'])
        self.assertEqual(first.json['items'][0]['deadline'], '2026-10-06T17:00')
        with case.app.app_context():
            revision, payload, _, items = tg._load(case.db, 1)
            self.assertEqual(revision, 7)
            self.assertEqual(payload, self.data)
            self.assertNotEqual(items[0]['anchor'], self.legacy_item()['anchor'])
            history = tg._execute(case.db, 'SELECT payload,actor,recorded_at,reason FROM tender_history').one()
            self.assertEqual(tuple(history), (stored_history, '原经办', '2026-10-02T10:00:00', '原核对依据'))
            tg._execute(case.db, 'UPDATE stages SET completed_at=:at', dict(at='2026-10-01T10:00'))
            case.db.session.commit()
        # The persisted migration also protects the next request, not only a
        # second in-memory derivation.
        second = case.client.get('/api/projects/1/tender-guarantee')
        self.assertFalse(second.json['items'][0]['needs_recheck'])
        self.assertEqual(second.json['items'][0]['deadline'], '2026-10-06T17:00')
        self.assertEqual(second.json['items'][0]['balance'], '100.00')


if __name__ == '__main__':
    unittest.main()
