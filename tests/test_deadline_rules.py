import copy
import unittest
from src.backend_patches import deadline_rules as dr


class DeadlineRuleTests(unittest.TestCase):
    def rule(self, key):
        return next(r for r in dr.catalog('government_procurement', '公开招标') + dr.catalog('bidding', '公开招标') if r['id'] == key)

    def test_catalog_never_infers_regime_from_method(self):
        self.assertEqual(dr.catalog('', '公开招标'), [])
        self.assertEqual(dr.catalog('enterprise', '公开招标'), [])
        self.assertNotIn('gov_nonbid_announcement', [r['id'] for r in dr.catalog('government_procurement', '询价')])
        self.assertIn('gov_nonbid_announcement', [r['id'] for r in dr.catalog('government_procurement', '竞争性磋商')])

    def test_five_workdays_counts_makeup_and_skips_holidays(self):
        r = dr.calculate(self.rule('gov_announcement'), '2026-09-30')
        self.assertEqual(r['deadline'], '2026-10-13')
        self.assertTrue(r['valid'])
        self.assertEqual(r['dependencies'][0]['year'], 2026)
        self.assertTrue(next(s for s in r['steps'] if s['date'] == '2026-10-10')['counted'])

    def test_one_and_two_workdays_and_time_precision(self):
        self.assertEqual(dr.calculate(self.rule('gov_result_period'), '2026-10-09')['deadline'], '2026-10-10')
        self.assertEqual(dr.calculate(self.rule('gov_result_publish'), '2026-10-09T10:20')['deadline'], '2026-10-12')
        custom = dict(id='custom:test', name='制度', days=2, day_kind='calendar', kind='maximum', include_start=False, end_policy='none', precision='minute', basis='企业制度', cutoff='16:30')
        self.assertEqual(dr.calculate(custom, '2026-10-09T08:10')['deadline'], '2026-10-11T16:30')

    def test_natural_days_do_not_skip_holiday_or_require_calendar_year(self):
        r=dr.calculate(self.rule('bid_candidate_period'), '2027-10-01T09:00')
        self.assertEqual(r['raw_deadline'][:10], '2027-10-04')
        self.assertEqual(r['dependencies'], [])
        self.assertTrue(r['requires_review'])

    def test_missing_year_returns_specific_warning_and_no_guess(self):
        r=dr.calculate(self.rule('gov_announcement'), '2026-12-31')
        self.assertFalse(r['valid'])
        self.assertEqual(r['missing_years'], [2027])
        self.assertEqual(r['deadline'], '')

    def test_clearance_validates_both_actual_timestamps_backwards(self):
        rule=self.rule('gov_clarification_notice')
        r=dr.calculate(rule, '2026-10-01T10:00', end_at='2026-10-16T10:00')
        self.assertTrue(r['valid'])
        self.assertTrue(r['interval_satisfied'])
        self.assertEqual(r['deadline'], '2026-10-01T10:00')
        self.assertFalse(dr.calculate(rule, '2026-10-01T10:01', end_at='2026-10-16T10:00')['interval_satisfied'])
        self.assertFalse(dr.calculate(rule,'2026-10-01')['valid'])
        self.assertTrue(dr.calculate(rule,'2026-10-01',end_at='2026-10-16')['requires_review'])

    def test_statutory_end_policy_never_uses_schedule_rest_as_proof(self):
        rule=dict(self.rule('gov_clarification_notice'), kind='maximum', days=3)
        r=dr.calculate(rule, '2026-10-01T10:00')
        self.assertEqual(r['deadline'][:10], '2026-10-04')
        self.assertTrue(r['requires_review'])
        self.assertIn('末日', ' '.join(r['warnings']))

    def test_missing_invalid_dates_and_parameters(self):
        for value in ('', 'not-a-date', '2026-02-30', '2026-10-01T25:00'):
            self.assertFalse(dr.calculate(self.rule('gov_announcement'), value)['valid'])
        for delta in ({'days':True},{'days':366},{'day_kind':'expression'},{'end_policy':'execute'}):
            rule=dict(id='custom:test',name='制度',days=2,day_kind='calendar',kind='maximum',include_start=False,end_policy='none',basis='内部制度',**{})
            rule.update(delta)
            with self.assertRaises(ValueError): dr.validate_custom(rule)

    def test_timezone_normalizes_to_business_day(self):
        r=dr.calculate(self.rule('gov_result_period'),'2026-10-08T18:30:00+00:00')
        self.assertEqual(r['deadline'], '2026-10-10')

if __name__ == '__main__': unittest.main()
