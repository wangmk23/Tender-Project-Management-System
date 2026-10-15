import copy
import unittest
from src.backend_patches import tender_guarantee as tg


class PaymentComplianceTests(unittest.TestCase):
    def setUp(self):
        self.regs = [{'id': 1, 'lot_id': 2, 'company_name': '模拟供应商'}]
        self.data = {'confirmed': True, 'amounts': [{'lot_id': None, 'amount': '10000.00'}],
                     'records': [{'registration_id': 1, 'participation': 'submitted', 'validity': 'valid',
                                  'reason': '', 'deposit_status': 'paid', 'deposit_amount': '5000.00',
                                  'refunded_amount': '0.00'}]}

    def test_new_underpayment_defaults_absent_without_erasing_cash(self):
        tg.apply_payment_compliance(self.data, self.regs, {}, enabled=True)
        row = self.data['records'][0]
        self.assertEqual(row['participation'], 'absent')
        self.assertEqual(row['validity'], 'pending')
        self.assertIn('不足额', row['reason'])
        self.assertEqual(row['deposit_amount'], '5000.00')
        self.assertFalse(self.data['confirmed'])

    def test_lot_amount_overrides_project_and_exact_payment_needs_explicit_validity(self):
        self.data['amounts'].append({'lot_id': 2, 'amount': '5000.00'})
        self.data['records'][0].update(participation='pending', validity='pending')
        expected = copy.deepcopy(self.data)
        tg.apply_payment_compliance(self.data, self.regs, {}, enabled=True)
        self.assertEqual(self.data, expected)

    def test_refund_or_rule_edit_does_not_rewrite_existing_participation(self):
        previous = copy.deepcopy(self.data)
        self.data['records'][0]['refunded_amount'] = '5000.00'
        tg.apply_payment_compliance(self.data, self.regs, previous, enabled=True)
        self.assertEqual(self.data['records'][0]['participation'], 'submitted')
        self.assertEqual(self.data['records'][0]['refunded_amount'], '5000.00')

    def test_new_attempt_to_confirm_underpaid_supplier_is_blocked(self):
        previous = copy.deepcopy(self.data)
        previous['records'][0].update(participation='absent', validity='pending', reason='保证金不足额')
        tg.apply_payment_compliance(self.data, self.regs, previous, enabled=True)
        self.assertEqual(self.data['records'][0]['participation'], 'absent')

    def test_historical_and_no_deposit_projects_keep_values(self):
        original = copy.deepcopy(self.data)
        tg.apply_payment_compliance(self.data, self.regs, {}, enabled=False)
        self.assertEqual(self.data, original)

    def test_amount_change_blocks_future_eligibility_without_rewriting_saved_participation(self):
        self.assertEqual(tg.eligible_ids(self.data, self.regs, 2), [])
        self.assertEqual(self.data['records'][0]['participation'], 'submitted')
        self.assertEqual(tg.eligible_ids(self.data, self.regs, 2, no_deposit=True), [1])


if __name__ == '__main__':
    unittest.main()
