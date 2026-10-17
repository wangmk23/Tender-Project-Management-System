import copy, unittest
from datetime import datetime
from types import SimpleNamespace as NS
from unittest.mock import patch
from src.backend_patches import calendar_service as cs, holiday_calendar as hc, tender_guarantee as tg, business_deadlines as bd

class CalendarDeadlineImpactTests(unittest.TestCase):
    def test_import_preview_combines_cash_and_other_deadlines_without_mutation(self):
        regs=[dict(id=1,company_name='模拟供应商',lot_id=None)]
        record=dict(registration_id=1,participation='submitted',validity='valid',reason='',deposit_status='paid',deposit_amount='100',refunded_amount='0',handling='rule',handling_reason='',review_at='',manual_start_at='',manual_deadline='',manual_basis='')
        rule=dict(id='refund',lot_id=None,scope='nonwinner',enabled=True,start_stage_key='',manual_start_at='2026-09-30',days=1,day_kind='workday',cutoff='',remind_days=1)
        data=tg.validate(dict(records=[record],rules=[rule],confirmed=True),regs,[])
        old=tg.derive_items(data,regs,[],[],datetime(2026,9,30))
        self.assertEqual(old[0]['deadline'],'2026-10-08')
        original=copy.deepcopy(old)
        candidate=copy.deepcopy(hc.get_calendar(2026))
        candidate['holidays'].append(dict(date='2026-10-08',name='模拟调整'))
        project=NS(id=1,name='模拟项目',number='P-1',no_deposit=False)
        with patch.object(bd,'_now',return_value=datetime(2026,10,17)),patch.object(bd,'impact_items',return_value=[dict(kind='business_deadline',title='公告期',old_deadline='2026-10-08',new_deadline='2026-10-09')]),patch.object(tg,'guarantee_projects',return_value=[project]),patch.object(tg,'_load',return_value=(1,data,'',old)),patch.object(tg,'project_context',return_value=(regs,[],[])):
            result=cs.preview_impacts(NS(),object,2026,candidate,None)
        self.assertEqual(len(result),2)
        cash=next(x for x in result if x['kind']=='deposit_refund')
        self.assertEqual(cash['old_deadline'],'2026-10-08')
        self.assertEqual(cash['new_deadline'],'2026-10-09')
        self.assertTrue(cash['overdue'])
        self.assertEqual(old,original)

    def test_unrelated_year_does_not_attribute_pending_source_change_to_calendar(self):
        regs=[dict(id=1,company_name='模拟供应商',lot_id=None)]
        record=dict(registration_id=1,participation='submitted',validity='valid',deposit_status='paid',deposit_amount='100',refunded_amount='0',handling='rule')
        rule=dict(id='refund',lot_id=None,scope='nonwinner',enabled=True,start_stage_key='',manual_start_at='2026-09-30',days=1,day_kind='workday',cutoff='',remind_days=1)
        data=tg.validate(dict(records=[record],rules=[rule],confirmed=True),regs,[])
        old=tg.derive_items(data,regs,[],[],datetime(2026,9,30))
        data['rules'][0]['manual_start_at']='2026-10-08'
        project=NS(id=1,name='模拟项目',number='P-1',no_deposit=False)
        snapshot=dict(year=2027,version=1,confirmed=True,holidays=[dict(date='2027-01-01',name='元旦')],workdays=[])
        with patch.object(bd,'_now',return_value=datetime(2026,10,17)),patch.object(bd,'impact_items',return_value=[]),patch.object(tg,'guarantee_projects',return_value=[project]),patch.object(tg,'_load',return_value=(1,data,'',old)),patch.object(tg,'project_context',return_value=(regs,[],[])):
            self.assertEqual(cs.preview_impacts(NS(),object,2027,snapshot,None),[])

if __name__=='__main__':unittest.main()
