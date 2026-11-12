import copy
import unittest
from datetime import datetime
from types import SimpleNamespace as NS
from unittest.mock import patch

from src.backend_patches import tender_guarantee as tg
from tests.test_guarantee_rule_workflow import fixture


class GuaranteeReviewCalendarTests(unittest.TestCase):
    def item(self, handling='rule', previous=None, deadline='2026-11-23T18:00'):
        regs, data = fixture()
        data['records'][0].update(
            handling=handling, handling_reason='模拟复核说明', review_at='2026-11-09',
            manual_start_at='2026-11-09', manual_deadline=deadline,
            manual_basis='模拟经核对的退还期限')
        return tg.derive_items(tg.validate(data, regs, []), regs, [], [],
                               datetime(2026, 11, 11, 12), previous=previous)[0]

    def events(self, item, now=datetime(2026, 11, 11, 12)):
        project = NS(id=1, name='模拟复核项目', number='T-REVIEW', lots=[])
        with patch.object(tg, '_execute', return_value=NS(all=lambda: [(1,)])), \
                patch.object(tg, 'get_payload', return_value=dict(items=[item])), \
                patch.object(tg, '_load', return_value=(2, {}, '', [item])):
            return (tg.calendar_events(NS(), [project], 2026, 11),
                    tg.reminder_events(NS(), [project], now))

    def test_resolved_review_is_completed_but_unpaid_refund_remains_pending(self):
        item = self.item()
        before = copy.deepcopy(item)
        self.assertEqual(item['status'], 'pending')
        self.assertFalse(item['needs_recheck'])
        events, reminders = self.events(item)
        review = next(e for e in events if e['guarantee_action'] == 'review')
        refund = next(e for e in events if e['guarantee_action'] == 'refund')
        self.assertTrue(review['completed'])
        self.assertEqual(review['date_str'], '2026-11-09')
        self.assertFalse(refund['completed'])
        self.assertEqual(refund['planned_at'], '2026-11-23T18:00')
        self.assertEqual(refund['balance'], '4000.00')
        self.assertEqual(item, before)
        self.assertEqual(reminders, [])

    def test_old_review_date_does_not_replace_real_refund_reminder(self):
        item = self.item()
        _, reminders = self.events(item, datetime(2026, 11, 23, 12))
        self.assertEqual([e['event_type'] for e in reminders], ['deposit_refund'])

    def test_active_review_and_hold_still_need_review(self):
        for handling in ('review', 'hold'):
            with self.subTest(handling=handling):
                item = self.item(handling)
                events, reminders = self.events(item)
                review = next(e for e in events if e['guarantee_action'] == 'review')
                self.assertFalse(review['completed'])
                self.assertEqual([e['event_type'] for e in reminders], ['deposit_review'])

    def test_new_deadline_change_requires_review_even_after_previous_review(self):
        prior = self.item()
        item = self.item(previous=[prior], deadline='2026-11-24T18:00')
        self.assertTrue(item['needs_recheck'])
        events, reminders = self.events(item)
        self.assertFalse(next(e for e in events if e['guarantee_action'] == 'review')['completed'])
        self.assertEqual([e['event_type'] for e in reminders], ['deposit_review'])

    def test_returned_balance_does_not_create_calendar_or_reminder_entries(self):
        item = dict(self.item(), status='returned', balance='0.00')
        self.assertEqual(self.events(item), ([], []))

    def test_future_hold_review_remains_pending_without_early_review_mail(self):
        item = dict(self.item('hold'), review_at='2026-11-19')
        events, reminders = self.events(item)
        self.assertFalse(next(e for e in events if e['guarantee_action'] == 'review')['completed'])
        self.assertEqual(reminders, [])

    def test_normal_refund_without_historical_review_does_not_invent_one(self):
        item = dict(self.item(), review_at='')
        events, reminders = self.events(item)
        self.assertEqual([e['guarantee_action'] for e in events], ['refund'])
        self.assertFalse(events[0]['completed'])
        self.assertEqual(reminders, [])


if __name__ == '__main__':
    unittest.main()
