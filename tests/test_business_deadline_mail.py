import unittest
from datetime import datetime
from types import SimpleNamespace
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from src.backend_patches import guarantee_delivery as gd, reminder_routing as rr, tender_guarantee as tg


class BusinessDeadlineMailTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine('sqlite://')
        self.db = SimpleNamespace(session=Session(self.engine))
        tg.ensure_schema(self.db)
        self.db.session.commit()
        self.now = datetime(2026, 10, 17, 9)
        self.group = dict(id='legal',name='期限组',enabled=True,recipients=['test@example.test'],
                          event_types=['business_deadline','deadline_review'],subject_prefix='',
                          content_fields={'project_name':True,'deadline_title':True,'deadline_at':True,
                                          'deadline_status':True,'deadline_basis':True,'review_reason':True})
        self.event = dict(event_type='business_deadline',event_key='deadline:1:2026-10-17',
                          project_id=1,project_name='模拟项目',deadline_title='质疑答复截止',
                          deadline_at='2026-10-19',deadline_status='待办理',deadline_basis='参考规则')

    def tearDown(self):
        self.db.session.close()
        self.engine.dispose()

    def test_new_types_are_opt_in_and_fields_are_categorized(self):
        legacy = rr.normalize_recipient_groups(dict(reminder_enabled=True,reminder_recipients=['a@example.test'],reminder_content={'project_name':True}))
        self.assertNotIn('business_deadline',legacy[0]['event_types'])
        group = rr.validate_recipient_groups([self.group])[0]
        self.assertEqual(group['event_types'],['business_deadline','deadline_review'])
        routed=rr.route_reminder_event(self.event,[group])
        self.assertEqual(len(routed),1)
        self.assertIn('deadline_at',routed[0]['content_fields'])
        self.assertNotIn('review_reason',routed[0]['content_fields'])

    def test_review_displays_original_date_and_escapes_text(self):
        event=dict(self.event,event_type='deadline_review',review_reason='<img src=x onerror=alert(1)>')
        group=rr.validate_recipient_groups([self.group])[0]
        routed=rr.route_reminder_event(event,[group])[0]
        message=rr.render_recipient_message(event,routed,'sender@example.test')
        self.assertIn('期限变更复核',str(message['Subject']))
        html=message.get_body(preferencelist=('html',)).get_content()
        self.assertIn('2026-10-19',html)
        self.assertNotIn('<img src=x',html)
        self.assertIn('&lt;img',html)

    def test_runtime_counts_are_separate_from_guarantee_mail(self):
        group=rr.validate_recipient_groups([self.group])[0]
        gd.enqueue(self.db,[self.event],[group],self.now);self.db.session.commit()
        status=gd.runtime_status(self.db)
        self.assertEqual(status['business_deadline']['pending_count'],1)
        self.assertEqual(status['deposit_refund']['pending_count'],0)

    def test_completed_obligation_cancels_unsent_queue_record(self):
        group=rr.validate_recipient_groups([self.group])[0]
        gd.enqueue(self.db,[self.event],[group],self.now)
        self.db.session.commit()
        self.assertEqual(gd.claim(self.db,[],[group],self.now),[])
        status=tg._execute(self.db,'SELECT status FROM tender_mail').scalar()
        self.assertEqual(status,'cancelled')

    def test_only_selected_recipient_gets_one_delivery_after_retry(self):
        group=rr.validate_recipient_groups([self.group])[0]
        groups=[group,dict(group,id='other')]
        gd.enqueue(self.db,[self.event],groups,self.now)
        self.db.session.commit()
        self.assertEqual(tg._execute(self.db,'SELECT count(*) FROM tender_mail').scalar(),1)
        due=gd.claim(self.db,[self.event],groups,self.now)
        self.assertEqual(len(due),1)
        gd.mark_result(self.db,due[0]['delivery_key'],{'status':'sent'},self.now)
        self.db.session.commit()
        gd.enqueue(self.db,[self.event],groups,self.now)
        self.db.session.commit()
        self.assertEqual(gd.claim(self.db,[self.event],groups,self.now),[])

if __name__ == '__main__': unittest.main()
