import unittest
from decimal import Decimal

from src.backend_patches import business_input_validation as business


class BidResultSerializationTests(unittest.TestCase):
    def model(self):
        class BidResult:
            calls=0
            def __init__(self,amount):self.winning_amount=amount
            def to_dict(self):
                self.calls+=1
                return dict(id=7,winning_amount=float(self.winning_amount) if self.winning_amount else None,
                            winning_supplier='模拟供应商',extra_field='preserved')
        return BidResult

    def test_zero_is_returned_as_a_number_and_other_fields_are_preserved(self):
        Model=self.model()
        business.install_bid_result_serialization(Model)
        for amount in (0,0.0,Decimal('0.00')):
            with self.subTest(amount=repr(amount)):
                row=Model(amount);value=row.to_dict()
                self.assertEqual(value,dict(id=7,winning_amount=0.0,winning_supplier='模拟供应商',extra_field='preserved'))
                self.assertIsInstance(value['winning_amount'],float)
                self.assertEqual(row.calls,1)

    def test_null_and_positive_values_keep_existing_contract(self):
        Model=self.model();business.install_bid_result_serialization(Model)
        self.assertIsNone(Model(None).to_dict()['winning_amount'])
        self.assertEqual(Model(Decimal('123.45')).to_dict()['winning_amount'],123.45)

    def test_repeated_install_does_not_stack_wrappers(self):
        Model=self.model();business.install_bid_result_serialization(Model);first=Model.to_dict
        business.install_bid_result_serialization(Model)
        self.assertIs(Model.to_dict,first)
        row=Model(0);row.to_dict();self.assertEqual(row.calls,1)


if __name__=='__main__':unittest.main()
