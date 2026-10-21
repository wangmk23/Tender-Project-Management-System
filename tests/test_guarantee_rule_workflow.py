import copy
import unittest
from datetime import datetime
from types import SimpleNamespace as NS
from unittest.mock import patch
from src.backend_patches import tender_guarantee as tg


def fixture(scope='nonwinner', enabled=True):
    regs=[dict(id=1,company_name='模拟供应商',lot_id=None)]
    record=dict(registration_id=1,participation='submitted',validity='valid',deposit_status='paid',
                deposit_amount='4000',refunded_amount='0',handling='rule',reason='',handling_reason='',
                review_at='',manual_start_at='',manual_deadline='',manual_basis='')
    rule=dict(id='existing',lot_id=None,scope=scope,enabled=enabled,start_stage_key='anchor',
              manual_start_at='',days=5,day_kind='calendar',cutoff='17:00',remind_days=1)
    return regs,dict(records=[record],rules=[rule],confirmed=True)


class GuaranteeRuleWorkflowTests(unittest.TestCase):
    def test_new_disabled_duplicate_scope_is_rejected_but_old_records_remain_editable(self):
        regs,data=fixture(enabled=False)
        prior=tg.validate(data,regs,[])
        data['rules'].append(dict(data['rules'][0],id='duplicate'))
        with self.assertRaisesRegex(ValueError,'已有|重复|已存在'):tg.validate(data,regs,[],prior)
        legacy=copy.deepcopy(prior);legacy['rules']=copy.deepcopy(data['rules'])
        updated=tg.validate(data,regs,[],legacy)
        self.assertEqual(len(updated['rules']),2)
        updated['records'][0]['refunded_amount']='4000'
        self.assertEqual(tg.validate(updated,regs,[],legacy)['records'][0]['refunded_amount'],'4000.00')
        updated['rules'].append(dict(updated['rules'][0],id='third'))
        with self.assertRaises(ValueError):tg.validate(updated,regs,[],legacy)

    def test_winner_waiting_reason_distinguishes_disabled_rule_from_participation(self):
        regs,data=fixture('winner',False)
        item=tg.derive_items(tg.validate(data,regs,[]),regs,[],[dict(lot_id=None,winning_supplier='模拟供应商')])[0]
        self.assertEqual(item['scope'],'winner')
        self.assertEqual(item['issue_code'],'rule_disabled')
        self.assertIn('中标供应商',item['status_detail'])
        self.assertEqual(item['next_action'],'rule')

    def test_only_missing_result_directs_to_result_stage_instead_of_rechecking_participation(self):
        regs,data=fixture()
        item=tg.derive_items(tg.validate(data,regs,[]),regs,[],None)[0]
        self.assertEqual(item['next_action'],'result')
        self.assertIn('结果公示阶段',item['status_detail'])

    def test_plan_generates_estimate_without_confirming_a_real_deadline(self):
        regs,data=fixture()
        stage=dict(key='anchor',name='结果公示',completed=False,skipped=False,planned_at='2026-10-01T09:00')
        item=tg.derive_items(tg.validate(data,regs,[]),regs,[stage],[],datetime(2026,10,20))[0]
        self.assertEqual(item['deadline'],'')
        self.assertEqual(item['estimated_deadline'],'2026-10-06T17:00')
        self.assertEqual(item['estimated_start_at'],'2026-10-01')
        self.assertEqual(item['status'],'estimated')
        self.assertFalse(item['overdue'])
        self.assertEqual(item['next_action'],'stage')
        self.assertIn('计划',item['status_detail'])

    def test_actual_completion_takes_precedence_and_existing_deadlines_require_review(self):
        regs,data=fixture()
        stage=dict(key='anchor',completed=True,skipped=False,planned_at='2026-10-01T09:00',completed_at='2026-10-08T10:00')
        item=tg.derive_items(tg.validate(data,regs,[]),regs,[stage],[],datetime(2026,10,9))[0]
        self.assertEqual(item['deadline'],'2026-10-13T17:00')
        self.assertEqual(item['estimated_deadline'],'')
        changed=dict(stage,completed_at='2026-10-09T10:00')
        recalculated=tg.derive_items(tg.validate(data,regs,[]),regs,[changed],[],previous=[item])[0]
        self.assertTrue(recalculated['needs_recheck'])
        self.assertEqual(recalculated['deadline'],item['deadline'])
        self.assertEqual(recalculated['proposed_deadline'],'2026-10-14T17:00')
        self.assertEqual(recalculated['next_action'],'recalculate')

    def test_missing_or_skipped_stage_explains_why_there_is_no_calendar_date(self):
        regs,data=fixture()
        for stages,code in [([], 'stage_missing'),([dict(key='anchor',completed=False,skipped=True,planned_at='2026-10-01')],'stage_skipped'),([dict(key='anchor',completed=False,skipped=False)],'stage_date_missing')]:
            item=tg.derive_items(tg.validate(data,regs,[]),regs,stages,[])[0]
            self.assertEqual(item['issue_code'],code)
            self.assertFalse(item['deadline'])
            self.assertFalse(item['estimated_deadline'])

    def test_plan_estimate_is_calendar_review_item_not_refund_mail(self):
        regs,data=fixture()
        item=tg.derive_items(tg.validate(data,regs,[]),regs,[dict(key='anchor',completed=False,planned_at='2026-10-01')],[],datetime(2026,10,20))[0]
        payload=dict(items=[item]);project=NS(id=1,name='模拟项目',number='T-1',lots=[])
        with patch.object(tg,'_execute',return_value=NS(all=lambda:[(1,)])),patch.object(tg,'get_payload',return_value=payload),patch.object(tg,'_load',return_value=(1,data,'',[item])):
            events=tg.calendar_events(NS(),[project],2026,10)
            self.assertEqual(len(events),1)
            self.assertEqual(events[0]['date_str'],'2026-10-06')
            self.assertTrue(events[0]['estimated'])
            self.assertEqual(events[0]['guarantee_action'],'review')
            self.assertIn('预计',events[0]['stage_name'])
            self.assertEqual(tg.reminder_events(NS(),[project],datetime(2026,10,20)),[])

    def test_api_reads_planned_datetime_and_calendar_follows_changes(self):
        from tests.test_tender_guarantee import TenderGuaranteeApiTests
        case=TenderGuaranteeApiTests(methodName='runTest');case.setUp();self.addCleanup(case.doCleanups)
        case.Project.stages=[NS(stage_key='result_announced',completed=True,skipped=False,completed_date=datetime(2026,10,1)),
                             NS(stage_key='anchor',completed=False,skipped=False,completed_date=None,planned_datetime=datetime(2026,10,8,9))]
        _,data=fixture();data['records'][0]['supplier_name_snapshot']='甲'
        saved=case.save(data)
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(saved.json['items'][0]['estimated_deadline'],'2026-10-13T17:00')
        with case.app.app_context():
            project=case.db.session.get(case.Project,1)
            events=tg.calendar_events(case.db,[project],2026,10)
            self.assertEqual(events[0]['date_str'],'2026-10-13')
            case.Project.stages[1].planned_datetime=datetime(2026,10,9,9)
            self.assertEqual(tg.calendar_events(case.db,[project],2026,10)[0]['date_str'],'2026-10-14')

    def test_first_payment_preserves_inherited_legacy_duplicates_without_allowing_new_ones(self):
        import json
        from tests.test_tender_guarantee import TenderGuaranteeApiTests
        case=TenderGuaranteeApiTests(methodName='runTest');case.setUp();self.addCleanup(case.doCleanups)
        _,data=fixture(enabled=False)
        inherited=[data['rules'][0],dict(data['rules'][0],id='legacy-other')]
        with case.app.app_context():
            project=case.db.session.get(case.Project,1)
            policy=tg.policy_for(case.db,project);policy['default_rules']=inherited
            tg._execute(case.db,'UPDATE tender_policies SET payload=:payload WHERE project_id=1',dict(payload=json.dumps(policy)))
            case.db.session.commit()
        value=case.client.get('/api/projects/1/tender-guarantee').json
        self.assertEqual(len(value['data']['rules']),2)
        value['data']['records']=data['records']
        value['data']['confirmed']=True
        response=case.save(value['data'])
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['summary']['balance'],'4000.00')
        # A fresh project with the same inherited defaults may not add a third ID.
        with case.app.app_context():
            tg._execute(case.db,'DELETE FROM tender_ledgers WHERE project_id=1');case.db.session.commit()
        value['data']['rules'].append(dict(data['rules'][0],id='new-duplicate'))
        self.assertEqual(case.save(value['data']).status_code,400)


if __name__=='__main__':unittest.main()
