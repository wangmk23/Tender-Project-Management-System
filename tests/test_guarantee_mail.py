import unittest
from datetime import datetime
from types import SimpleNamespace
from src.backend_patches import guarantee_delivery as gd, reminder_routing as rr, tender_guarantee as tg

class GuaranteeDeliveryTests(unittest.TestCase):
    def setUp(self):
        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        self.engine=create_engine('sqlite://');self.db=SimpleNamespace(session=Session(self.engine))
        tg.ensure_schema(self.db);self.db.session.commit()
        self.now=datetime(2026,10,14,10)
        self.group=dict(id='g',name='测试组',enabled=True,recipients=['test@example.com'],event_types=['deposit_refund'],subject_prefix='',content_fields={'project_name':True,'deposit_balance':True,'refund_deadline':True})
        self.event=dict(event_type='deposit_refund',event_key='deposit:1:2026-10-14',project_name='模拟项目',deposit_balance='100.00',refund_deadline='2026-10-14')

    def test_restart_dedup_and_failed_retry(self):
        gd.enqueue(self.db,[self.event],[self.group],self.now)
        self.db.session.commit()
        due=gd.claim(self.db,[self.event],[self.group],self.now)
        self.assertEqual(len(due),1)
        key=due[0]['delivery_key']
        gd.mark_result(self.db,key,dict(status='failed',error_code='SMTP_CONNECTION_FAILED'),self.now)
        self.db.session.commit()
        self.assertEqual(gd.claim(self.db,[self.event],[self.group],self.now),[])
        later=datetime(2026,10,14,10,16)
        due=gd.claim(self.db,[self.event],[self.group],later);self.assertEqual(len(due),1)
        gd.mark_result(self.db,key,dict(status='sent'),later);self.db.session.commit()
        gd.enqueue(self.db,[self.event],[self.group],later);self.db.session.commit()
        self.assertEqual(gd.claim(self.db,[self.event],[self.group],later),[])

    def test_returned_item_cancels_pending_delivery(self):
        gd.enqueue(self.db,[self.event],[self.group],self.now);self.db.session.commit()
        self.assertEqual(gd.claim(self.db,[],[self.group],self.now),[])

    def test_render_has_cash_fields_and_no_accounts(self):
        delivery=rr.route_reminder_event(self.event,[self.group])[0]
        message=rr.render_recipient_message(self.event,delivery,'sender@example.com')
        self.assertIn('保证金',str(message['Subject']))
        self.assertIn('100.00',message.get_body(('plain',)).get_content())

    def test_unsent_retry_refreshes_balance_and_recipient_rules(self):
        gd.enqueue(self.db,[self.event],[self.group],self.now);self.db.session.commit()
        updated=dict(self.event,deposit_balance='50.00');group=dict(self.group,subject_prefix='财务')
        gd.enqueue(self.db,[updated],[group],self.now);self.db.session.commit()
        due=gd.claim(self.db,[updated],[group],self.now)
        self.assertEqual(len(due),1)
        self.assertEqual(due[0]['event']['deposit_balance'],'50.00')
        self.assertEqual(due[0]['delivery']['subject_prefix'],'财务')

    def test_per_project_daily_summary_and_master_switch(self):
        from unittest.mock import patch
        a=dict(self.event,project_id=1,event_key='refund:1:a:2026-10-14',supplier_name='甲')
        b=dict(a,event_key='refund:1:b:2026-10-14',supplier_name='乙',deposit_balance='50.00')
        grouped=gd.aggregate_events([a,b]);self.assertEqual(len(grouped),1)
        self.assertEqual(grouped[0]['deposit_balance'],'150.00')
        self.assertEqual(gd.aggregate_events([b])[0]['event_key'],grouped[0]['event_key'])
        server=SimpleNamespace(load_app_settings=lambda:{'reminder_enabled':False,'reminder_recipient_groups':[self.group]})
        with patch.object(tg,'reminder_events',side_effect=AssertionError('disabled master must not enqueue')):
            self.assertIsNone(gd.run(server,self.now))

if __name__=='__main__':unittest.main()
