import copy
import types
import unittest
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path

from src.backend_patches.business_input_validation import validate_business_input


class BusinessInputValidationTests(unittest.TestCase):
    def validate(self, endpoint, payload):
        return validate_business_input(endpoint, payload, ['公开招标', '网上竞价'])

    def test_function_runs_with_only_builtins_for_compiled_embedding(self):
        isolated = types.FunctionType(validate_business_input.__code__, {})
        self.assertIsNone(isolated('api_create_service_fee_invoice', {'amount':'2.50','invoice_date':'2026-10-08'}, []))

    def test_payload_must_be_an_object(self):
        for payload in (None, [], '', 123, True):
            self.assertIsNotNone(self.validate('api_create_complaint', payload))

    def test_every_date_route_rejects_bad_dates_and_accepts_clear(self):
        routes = {
            'api_create_notice_delivery': ('pickup_date',), 'api_update_notice_delivery': ('pickup_date',),
            'api_create_archive_delivery': ('sent_date',), 'api_update_archive_delivery': ('sent_date',),
            'api_create_service_fee_invoice': ('invoice_date',), 'api_update_service_fee_invoice': ('invoice_date',),
            'api_create_complaint': ('submit_date','reply_date','reply_deadline'),
            'api_update_complaint': ('submit_date','reply_date','reply_deadline'),
            'api_create_complaint_event': ('deadline',), 'api_update_delete_complaint_event': ('deadline',),
            'api_create_clarification': ('publish_date',), 'api_update_delete_clarification': ('publish_date',),
            'api_update_stage': ('completed_date',), 'api_batch_advance_stage': ('completed_date',),
        }
        for endpoint, fields in routes.items():
            for field in fields:
                for value in ('2026-02-30',[],{},123,True):
                    with self.subTest(endpoint=endpoint,field=field,value=value):
                        self.assertIsNotNone(self.validate(endpoint,{field:value}))
                for value in (None,'','2026-10-08','20261008'):
                    self.assertIsNone(self.validate(endpoint,{field:value}))

    def test_datetime_precision_remains_supported(self):
        routes={'api_update_stage':('planned_at',),'api_create_complaint_event':('event_time',),
                'api_update_delete_complaint_event':('event_time',),'api_create_clarification':('original_deadline','new_deadline'),
                'api_update_delete_clarification':('original_deadline','new_deadline')}
        for endpoint,fields in routes.items():
            for field in fields:
                for value in ('2026-10-08T09:30','2026-10-08T09:30:02.123',None,''):
                    self.assertIsNone(self.validate(endpoint,{field:value}))
                self.assertIsNotNone(self.validate(endpoint,{field:'2026-13-08T09:30'}))

    def test_money_rejects_nonfinite_negative_wrong_types_and_float_overflow(self):
        for endpoint,field in [('api_create_bid_result','winning_amount'),('api_update_bid_result','winning_amount'),
                               ('api_create_service_fee_invoice','amount'),('api_update_service_fee_invoice','amount'),
                               ('api_create_lot','budget'),('api_update_lot','budget')]:
            for value in ('NaN','Infinity','-Infinity','1e309',float('nan'),float('inf'),-1,'-0.01',True,[],{},'bad'):
                with self.subTest(endpoint=endpoint,value=value):
                    self.assertIsNotNone(self.validate(endpoint,{field:value}))
            for value in (0,'0','12.345','2.5e3',Decimal('1.25'),None):
                self.assertIsNone(self.validate(endpoint,{field:value}))
            payload={field:''}
            self.assertIsNone(self.validate(endpoint,payload))
            self.assertIsNone(payload[field])

    def test_boolean_flags_reject_truthy_text(self):
        routes={'api_update_project':('no_deposit','is_terminated','procurement_archive_sent'),
                'api_create_project':('no_deposit',),'api_create_bid_result':('is_shortlisted',),
                'api_update_bid_result':('is_shortlisted',),'api_create_stage_checklist_item':('required',),
                'api_update_delete_stage_checklist_item':('required','completed'),
                'api_create_clarification':('affects_deadline',),'api_update_delete_clarification':('affects_deadline',),
                'api_update_stage':('completed','skipped','force_complete'),
                'api_bulk_update_archive_catalog':('applicable','has_original','has_scan','transferred'),
                'api_update_delete_archive_catalog_item':('applicable','has_original','has_scan','transferred')}
        for endpoint,fields in routes.items():
            for field in fields:
                for value in ('false',1,0,None,[],{}):
                    if endpoint == 'api_bulk_update_archive_catalog' and value is None:
                        self.assertIsNone(self.validate(endpoint,{field:value}))
                        continue
                    self.assertIsNotNone(self.validate(endpoint,{field:value}))
                for value in (True,False):
                    self.assertIsNone(self.validate(endpoint,{field:value}))

    def test_project_budget_retains_text_with_units_and_pending_notes(self):
        for endpoint in ('api_create_project', 'api_update_project'):
            for value in ('100万元', '预算待确认', '1,000元', '', None, 100):
                payload = {'budget': value}
                self.assertIsNone(self.validate(endpoint, payload))
                self.assertEqual(payload['budget'], value)
            for value in (True, [], {}):
                self.assertIsNotNone(self.validate(endpoint, {'budget': value}))

    def test_project_identity_method_and_year(self):
        for field in ('number','name'):
            for value in (' ',None,[],123):
                self.assertIsNotNone(self.validate('api_update_project',{field:value}))
        for value in ('unsupported',None,[]):
            self.assertIsNotNone(self.validate('api_update_project',{'method':value}))
        for value in (True,2026.5,'2026.0',0,10000,'9'*5000):
            self.assertIsNotNone(self.validate('api_update_project',{'year':value}))
        payload={'year':'2026','method':'公开招标'}
        self.assertIsNone(self.validate('api_update_project',payload))
        self.assertEqual(payload['year'],2026)
        for value in (None,''):
            payload={'year':value}
            self.assertIsNone(self.validate('api_create_project',payload))
            self.assertNotIn('year',payload)

    def test_archive_copies_accept_integer_clear_and_reject_bad_counts(self):
        for endpoint in ('api_bulk_update_archive_catalog','api_update_delete_archive_catalog_item'):
            for value in (-1,True,1.5,'1.5','bad','9'*5000,9223372036854775808):
                self.assertIsNotNone(self.validate(endpoint,{'agency_copies':value}))
            for value,expected in (('3',3),(0,0),('',0),(None,0)):
                payload={'agency_copies':value}
                self.assertIsNone(self.validate(endpoint,payload))
                self.assertEqual(payload['agency_copies'], value if endpoint == 'api_bulk_update_archive_catalog' and value in ('', None) else expected)

    def test_nested_complaint_rows_are_validated_before_any_normalization(self):
        for endpoint in ('api_create_complaint','api_update_complaint'):
            for payload in ({'targets':None},{'targets':{}},{'issues':[None]}, {'targets':[{}]*1001},
                            {'targets':[{'response_deadline':'2026-02-30'}]},
                            {'targets':[{'needs_statement':'false'}]}, {'issues':[{'affects_result':1}]}):
                original=copy.deepcopy(payload)
                self.assertIsNotNone(self.validate(endpoint,payload))
                self.assertEqual(payload,original)
            self.assertIsNone(self.validate(endpoint,{'targets':[{'response_deadline':'2026-10-08','needs_statement':False}],
                                                     'issues':[{'affects_result':True}]}))

    def test_rejected_payload_does_not_partially_normalize_other_fields(self):
        payload={'amount':'','invoice_date':'2026-02-30'}
        self.assertIsNotNone(self.validate('api_create_service_fee_invoice',payload))
        self.assertEqual(payload,{'amount':'','invoice_date':'2026-02-30'})

    def test_preserved_handler_shim_cannot_erase_dates_or_store_invalid_amount(self):
        stored={'invoice_date':date(2026,9,30),'amount':'12.00','notes':'原备注'}
        calls=[]
        def original(payload):
            calls.append(True)
            try: stored['invoice_date']=date.fromisoformat(payload['invoice_date'])
            except Exception: stored['invoice_date']=None
            stored['amount']=payload['amount']
            stored['notes']=payload.get('notes','')
        def wrapped(payload):
            error=self.validate('api_create_service_fee_invoice',payload)
            if error:return 400
            original(payload)
            return 201
        for payload in ({'invoice_date':'2026-02-30','amount':'12','notes':'不应保存'},
                        {'invoice_date':'2026-10-08','amount':'NaN'},
                        {'invoice_date':'2026-10-08','amount':'bad'}):
            self.assertEqual(wrapped(payload),400)
        self.assertEqual(calls,[])
        self.assertEqual(stored['invoice_date'],date(2026,9,30))
        self.assertEqual(stored['notes'],'原备注')
        self.assertEqual(wrapped({'invoice_date':'2026-10-08','amount':'2.5e3'}),201)
        self.assertEqual(stored['amount'],'2.5e3')


class FrozenBusinessInputValidationTests(unittest.TestCase):
    """Run preserved baseline functions, never the executable or its startup."""

    @classmethod
    def setUpClass(cls):
        baseline = Path(__file__).resolve().parents[1] / '_build' / 'mail-release' / 'procurement-project-manager.exe'
        if not baseline.is_file():
            raise unittest.SkipTest('isolated frozen baseline is unavailable')
        from PyInstaller.archive.readers import CArchiveReader
        root = CArchiveReader(str(baseline)).open_embedded_archive('PYZ.pyz').extract('app')
        cls.original_code = next(value for value in root.co_consts
                                 if isinstance(value, types.CodeType) and value.co_name == 'api_create_service_fee_invoice')

    def setUp(self):
        from flask import Flask, request, jsonify
        from flask_sqlalchemy import SQLAlchemy
        self.app=Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI']='sqlite://'
        self.db=SQLAlchemy(self.app)
        db=self.db
        class Project(db.Model):
            id=db.Column(db.Integer,primary_key=True)
            is_terminated=db.Column(db.Boolean,default=False)
        class Invoice(db.Model):
            id=db.Column(db.Integer,primary_key=True)
            project_id=db.Column(db.Integer)
            lot_id=db.Column(db.Integer)
            invoice_number=db.Column(db.String)
            invoice_date=db.Column(db.Date)
            amount=db.Column(db.Numeric(15,2))
            notes=db.Column(db.String)
            def to_dict(self):return {'id':self.id,'invoice_date':str(self.invoice_date),'amount':str(self.amount)}
        self.Invoice=Invoice
        env=dict(db=db,Project=Project,ServiceFeeInvoice=Invoice,request=request,jsonify=jsonify,
                 date=date,_normalize_project_lot_id=lambda value,pid:value)
        self.original=types.FunctionType(self.original_code,env)
        with self.app.app_context():
            db.create_all()
            db.session.add(Project(id=7))
            db.session.commit()

    def call(self,payload,guarded):
        with self.app.test_request_context(json=payload):
            from flask import request
            cached=request.get_json()
            if guarded and validate_business_input('api_create_service_fee_invoice',cached,[]):
                return 400
            return self.app.make_response(self.original(7)).status_code

    def test_original_invalid_date_is_committed_as_null_but_guarded_rejects(self):
        payload={'invoice_date':'2026-02-30','amount':'12'}
        self.assertEqual(self.call(payload,False),201)
        with self.app.app_context():
            self.assertIsNone(self.Invoice.query.one().invoice_date)
        self.assertEqual(self.call(payload,True),400)
        with self.app.app_context():
            self.assertEqual(self.Invoice.query.count(),1)

    def test_original_nonfinite_amounts_corrupt_numeric_value_but_guarded_rejects(self):
        for value in ('NaN','Infinity'):
            payload={'invoice_date':'2026-10-08','amount':value}
            self.assertEqual(self.call(payload,False),201)
            self.assertEqual(self.call(payload,True),400)
        with self.app.app_context():
            values=self.db.session.execute(self.db.text('SELECT amount FROM invoice ORDER BY id')).all()
            self.assertIsNone(values[0][0])
            self.assertEqual(values[1][0],float('inf'))

    def test_guarded_valid_decimal_date_and_optional_clear_reach_original(self):
        self.assertEqual(self.call({'invoice_date':'2026-10-08','amount':'2.5e3'},True),201)
        self.assertEqual(self.call({'invoice_date':'','amount':''},True),201)
        with self.app.app_context():
            rows=self.Invoice.query.order_by(self.Invoice.id).all()
            self.assertEqual(rows[0].amount,Decimal('2500.00'))
            self.assertEqual(rows[0].invoice_date,date(2026,10,8))
            self.assertIsNone(rows[1].amount)
            self.assertIsNone(rows[1].invoice_date)

    def test_original_malformed_amount_raises_database_error_but_guarded_rejects(self):
        from sqlalchemy.exc import StatementError
        payload={'invoice_date':'2026-10-08','amount':'not-a-number'}
        with self.assertRaises(StatementError):
            self.call(payload,False)
        self.assertEqual(self.call(payload,True),400)
        with self.app.app_context():
            self.assertEqual(self.Invoice.query.count(),0)


if __name__ == '__main__':
    unittest.main()
