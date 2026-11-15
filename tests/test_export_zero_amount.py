import io
import unittest
import zipfile
from decimal import Decimal
from xml.etree import ElementTree

from tests import test_export_replacement as helpers


class ExportZeroAmountTests(unittest.TestCase):
    def setUp(self):
        self.case=helpers.ExportReplacementTests(methodName='runTest')
        self.case.setUp()
        self.addCleanup(self.case.tearDown)

    def exported(self, amount, discount='', whole_project=False):
        bid=self.case.project.bid_results[0]
        bid.winning_amount=amount;bid.discount_rate=discount
        if whole_project:
            bid.lot_id=None;self.case.project.lots=[];self.case.project.bid_results=[bid]
        self.case.module.request.args={'download':'1','year':'2026'}
        response=self.case.module.api_export()
        with zipfile.ZipFile(io.BytesIO(helpers.response_bytes(response))) as z:
            sheet=ElementTree.fromstring(z.read('xl/worksheets/sheet1.xml'))
        return helpers.row_values(sheet,5).get('Q','')

    def test_numeric_and_decimal_zero_are_exported_without_discount_substitution(self):
        for amount in (0,0.0,Decimal('0.00'),'0','0.00'):
            for discount in ('','95%'):
                with self.subTest(amount=repr(amount),discount=discount):
                    self.assertEqual(self.exported(amount,discount),str(amount))

    def test_whole_project_zero_is_exported(self):
        self.assertEqual(self.exported(0,'95%',whole_project=True),'0')

    def test_only_missing_amount_uses_discount(self):
        for amount in (None,''):
            with self.subTest(amount=amount):
                self.assertEqual(self.exported(amount,'95%'),'95%')
        self.assertEqual(self.exported(None,''),'')

    def test_positive_amount_keeps_existing_combined_column_contract(self):
        self.assertEqual(self.exported(123.45,'95%'),'123.45')


if __name__=='__main__':unittest.main()
