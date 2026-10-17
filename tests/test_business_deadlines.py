import copy
import tempfile
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace as NS
from src.backend_patches import business_deadlines as bd


class BusinessDeadlinesTests(unittest.TestCase):
    def setUp(self):
        from flask import Flask,jsonify
        from flask_sqlalchemy import SQLAlchemy
        self.tmp=tempfile.TemporaryDirectory()
        self.app=Flask(__name__)
        self.app.config.update(SECRET_KEY='test',SQLALCHEMY_DATABASE_URI='sqlite://')
        self.db=SQLAlchemy(self.app);db=self.db
        class Project(db.Model):
            __tablename__='projects'
            id=db.Column(db.Integer,primary_key=True)
            number=db.Column(db.String,default='TEST');name=db.Column(db.String,default='测试项目')
            method=db.Column(db.String,default='公开招标')
            complaints=[];announcement_clarifications=[];lots=[]
            stages=db.relationship('Stage',backref='project')
        class User(db.Model):
            id=db.Column(db.Integer,primary_key=True)
            is_active=db.Column(db.Boolean,default=True);is_admin=db.Column(db.Boolean,default=False)
        class Stage(db.Model):
            __tablename__='stages'
            id=db.Column(db.Integer,primary_key=True)
            project_id=db.Column(db.Integer,db.ForeignKey('projects.id'));stage_key=db.Column(db.String)
            planned_datetime=db.Column(db.DateTime);planned_date=db.Column(db.Date)
        self.Project=Project;self.User=User
        self.Stage=Stage;self.global_settings={}
        Project.complaints=[NS(id=11,submit_date='2026-10-09',complaint_type='质疑',lot_id=10)]
        Project.announcement_clarifications=[NS(id=21,publish_date='2026-10-09',lot_id=10,title='澄清')]
        Project.lots=[NS(id=10,lot_number='包1',lot_name='测试'),NS(id=20,lot_number='包2',lot_name='测试2')]
        with self.app.app_context():
            db.create_all();db.session.add_all([Project(id=1),Project(id=2),User(id=1),User(id=2),Stage(id=1,project_id=1,stage_key='announcement',planned_datetime=datetime(2026,1,1,9,0))]);db.session.commit()
        bd.register(self.app,db,dict(Project=Project,User=User,DATA_DIR=self.tmp.name,can_access_project=lambda user,p:p.id==1,load_app_settings=lambda:self.global_settings,save_app_settings=lambda v:self.global_settings.update(v)))
        self.app.add_url_rule('/api/projects/<int:pid>/complaints/<int:cid>','legacy_edit',lambda pid,cid:jsonify(ok=True),methods=['PUT','DELETE'])
        def new_project():
            self.db.session.add(Project(id=3));self.db.session.commit();return jsonify(id=3)
        self.app.add_url_rule('/api/projects','create_project',new_project,methods=['POST'])
        self.c=self.app.test_client();self.headers={'X-CSRFToken':'test-csrf'}
        with self.c.session_transaction() as s:s.update(user_id=1,csrf_token='test-csrf')

    def tearDown(self):self.tmp.cleanup()
    def put(self,enabled=True,revision=0,regime='government_procurement'):
        return self.c.put('/api/projects/1/deadline-settings',json=dict(enabled=enabled,revision=revision,regime=regime,custom_rules=[]),headers=self.headers)
    def preview(self,**extra):
        body=dict(rule_id='gov_question_reply',stage_key='announcement',lot_id=10,source_type='complaint',source_id=11)
        body.update(extra)
        return self.c.post('/api/projects/1/deadlines/preview',json=body,headers=self.headers)
    def confirm(self,token):return self.c.post('/api/projects/1/deadlines/confirm',json=dict(token=token),headers=self.headers)
    def create(self,**extra):
        p=self.preview(**extra);self.assertEqual(p.status_code,200,p.json)
        c=self.confirm(p.json['token']);self.assertEqual(c.status_code,200,c.json)
        return c.json['item']
    def items(self):return self.c.get('/api/projects/1/deadlines').json['items']

    def test_legacy_projects_disabled_unselected_without_backfill(self):
        r=self.c.get('/api/projects/1/deadlines')
        self.assertEqual(r.json['settings'],dict(revision=0,enabled=False,regime='',custom_rules=[]))
        self.assertEqual(r.json['items'],[])
        self.assertEqual(self.preview().status_code,400)
        self.assertEqual(self.c.get('/api/deadline-rules?project_id=1').json['rules'],[])

    def test_auth_active_csrf_access_and_settings_cas(self):
        self.assertEqual(self.c.put('/api/projects/1/deadline-settings',json={}).status_code,403)
        self.assertEqual(self.c.get('/api/projects/2/deadlines').status_code,403)
        self.assertEqual(self.put().status_code,200)
        self.assertEqual(self.put().status_code,409)
        with self.app.app_context():self.db.session.get(self.User,1).is_active=False;self.db.session.commit()
        self.assertEqual(self.c.get('/api/projects/1/deadlines').status_code,401)

    def test_preview_is_read_only_confirm_uses_server_payload_and_replay_rejected(self):
        self.put();r=self.preview();self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(self.items(),[])
        c=self.c.post('/api/projects/1/deadlines/confirm',json=dict(token=r.json['token'],deadline='2099-01-01'),headers=self.headers)
        self.assertEqual(c.status_code,200,c.json)
        self.assertEqual(c.json['item']['confirmed_deadline'],'2026-10-19')
        self.assertEqual(self.confirm(r.json['token']).status_code,404)

    def test_preview_owner_expiry_source_and_settings_revision(self):
        self.put();p=self.preview().json
        other=self.app.test_client()
        with other.session_transaction() as s:s.update(user_id=2,csrf_token='test-csrf')
        self.assertEqual(other.post('/api/projects/1/deadlines/confirm',json={'token':p['token']},headers=self.headers).status_code,404)
        self.Project.complaints[0].submit_date='2026-10-10'
        self.assertEqual(self.confirm(p['token']).status_code,409)
        p=self.preview().json;self.put(revision=1)
        self.assertEqual(self.confirm(p['token']).status_code,409)
        p=self.preview().json
        with self.app.app_context():
            bd._execute(self.db,'UPDATE business_deadline_previews SET created_at=:at',dict(at=(datetime.now()-timedelta(minutes=31)).isoformat()))
            self.db.session.commit()
        self.assertEqual(self.confirm(p['token']).status_code,410)

    def test_actual_sources_not_stage_plans_and_notification_not_publication(self):
        self.put()
        self.assertEqual(self.preview(source_type='stage',source_id='announcement').status_code,400)
        r=self.preview(rule_id='gov_clarification_notice',source_type='clarification',source_id=21,end_at='2026-11-01T09:00')
        self.assertEqual(r.status_code,400)
        r=self.preview(rule_id='gov_clarification_notice',source_type='clarification_notification',source_id=21,start_at='2026-10-09T09:00',end_at='2026-11-01T09:00')
        self.assertEqual(r.status_code,200,r.json)
        self.assertTrue(r.json['calculation']['requires_review'])
        self.Project.complaints[0].submit_date=''
        self.assertEqual(self.preview().status_code,400)
        self.assertEqual(self.preview(start_at='2026-10-09').status_code,200)

    def test_source_date_cannot_be_overridden_and_wrong_lot_rejected(self):
        self.put()
        self.assertEqual(self.preview(start_at='2026-10-12').status_code,409)
        self.assertEqual(self.preview(lot_id=20).status_code,400)
        self.assertEqual(self.preview(lot_id=999).status_code,400)

    def test_separate_records_and_lots_and_confirmed_value_frozen(self):
        self.put();a=self.create()
        b=self.create(source_type='manual',source_id='event-two',start_at='2026-10-12',lot_id=20)
        self.assertNotEqual(a['id'],b['id'])
        self.Project.complaints[0].submit_date='2026-10-12'
        rows=self.items();changed=next(i for i in rows if i['id']==a['id'])
        self.assertEqual(changed['confirmed_deadline'],a['confirmed_deadline'])
        self.assertTrue(changed['needs_review'])
        self.assertEqual(changed['proposed_deadline'],'2026-10-21')
        self.assertFalse(next(i for i in rows if i['id']==b['id'])['needs_review'])

    def test_source_delete_keep_and_accept_reviews_have_audit_and_cas(self):
        self.put();a=self.create();self.Project.complaints[0].submit_date='2026-10-12'
        a=self.items()[0];url=f"/api/projects/1/deadlines/{a['id']}/review"
        self.assertEqual(self.c.post(url,json=dict(revision=a['revision'],action='keep',reason=''),headers=self.headers).status_code,400)
        kept=self.c.post(url,json=dict(revision=a['revision'],action='keep',reason='核对原签收单'),headers=self.headers)
        self.assertEqual(kept.status_code,200,kept.json)
        self.assertFalse(self.items()[0]['needs_review'])
        self.assertEqual(self.c.post(url,json=dict(revision=a['revision'],action='keep',reason='旧版本'),headers=self.headers).status_code,409)
        self.Project.complaints=[];deleted=self.items()[0]
        self.assertTrue(deleted['needs_review']);self.assertEqual(deleted['confirmed_deadline'],a['confirmed_deadline'])
        self.assertEqual(self.c.post(url,json=dict(revision=deleted['revision'],action='accept',reason=''),headers=self.headers).status_code,400)
        with self.app.app_context():self.assertGreaterEqual(bd._execute(self.db,'SELECT count(*) FROM business_deadline_audit').scalar(),3)

    def test_accept_new_suggestion_and_explicit_status_separate_from_time(self):
        self.put();a=self.create();self.Project.complaints[0].submit_date='2026-10-12';a=self.items()[0]
        url=f"/api/projects/1/deadlines/{a['id']}"
        accepted=self.c.post(url+'/review',json=dict(revision=a['revision'],action='accept',reason=''),headers=self.headers)
        self.assertEqual(accepted.status_code,200,accepted.json)
        item=accepted.json['item'];self.assertEqual(item['confirmed_deadline'],'2026-10-21')
        done=self.c.post(url+'/status',json=dict(revision=item['revision'],status='completed',reason='已答复'),headers=self.headers)
        self.assertEqual(done.status_code,200,done.json)
        self.assertEqual(done.json['item']['state'],'completed')
        with self.app.app_context():self.assertEqual(bd.reminder_events(self.db,self.Project,datetime(2026,10,22)),[])

    def test_calendar_reminder_review_keeps_old_deadline_and_impact_is_read_only(self):
        from src.backend_patches import holiday_calendar as hc
        self.put();a=self.create()
        with self.app.app_context():
            events=bd.calendar_events(self.db,self.Project,2026,10)
            self.assertEqual(events[0]['deadline_item_id'],a['id'])
            snapshot=copy.deepcopy(hc.get_calendar(2026));snapshot['holidays'].append(dict(date='2026-10-19',name='测试安排'));snapshot['local_revision']=2
            impacts=bd.impact_items(self.db,self.Project,2026,snapshot)
            self.assertEqual(impacts[0]['proposed_deadline'],'2026-10-20')
            self.assertEqual(impacts[0]['confirmed_deadline'],'2026-10-19')
        self.assertFalse(self.items()[0]['needs_review'])
        self.Project.complaints[0].submit_date='2026-10-12';self.items()
        with self.app.app_context():
            events=bd.reminder_events(self.db,self.Project,datetime(2026,10,19))
            self.assertEqual({e['event_type'] for e in events},{'business_deadline','deadline_review'})
            self.assertTrue(all(e['deadline_at']=='2026-10-19' for e in events))

    def test_unverified_rules_stay_pending_until_explicit_review_reason(self):
        self.put(regime='bidding')
        a=self.create(rule_id='bid_candidate_period',source_type='manual',source_id='candidate',start_at='2026-10-01T09:00')
        self.assertEqual(a['state'],'pending');self.assertEqual(a['confirmed_deadline'],'')
        url=f"/api/projects/1/deadlines/{a['id']}/review"
        self.assertEqual(self.c.post(url,json=dict(revision=a['revision'],action='accept',reason=''),headers=self.headers).status_code,400)
        accepted=self.c.post(url,json=dict(revision=a['revision'],action='accept',reason='已核对招标文件及本项目公示口径'),headers=self.headers)
        self.assertEqual(accepted.status_code,200,accepted.json)

    def test_custom_roundtrip_and_explicit_stage_sync_only(self):
        custom=dict(id='custom:rule',name='制度约定',days=3,day_kind='calendar',kind='maximum',include_start=False,end_policy='none',basis='内部制度')
        saved=self.c.put('/api/projects/1/deadline-settings',json=dict(revision=0,enabled=True,regime='enterprise',custom_rules=[custom]),headers=self.headers)
        self.assertEqual(saved.status_code,200,saved.json)
        self.assertEqual(self.c.put('/api/projects/1/deadline-settings',json=saved.json,headers=self.headers).status_code,200)
        a=self.create(rule_id='custom:rule',source_type='manual',source_id='one',start_at='2026-10-09T09:00')
        with self.app.app_context():self.assertEqual(self.db.session.get(self.Stage,1).planned_datetime,datetime(2026,1,1,9,0))
        b=self.create(rule_id='custom:rule',source_type='manual',source_id='two',start_at='2026-10-09T09:00',cutoff='14:00',sync_stage_plan=True)
        with self.app.app_context():
            self.assertEqual(self.db.session.get(self.Stage,1).planned_datetime,datetime.fromisoformat(b['confirmed_deadline']))
            linked=[i for i in bd.list_items(self.db,self.db.session.get(self.Project,1)) if i.get('sync_stage_plan')]
            self.assertEqual([i['id'] for i in linked],[b['id']])

    def test_admin_default_only_future_new_project_gets_snapshot(self):
        body=dict(revision=0,enabled=True,regime='government_procurement',custom_rules=[],save_as_default=True)
        self.assertEqual(self.c.put('/api/projects/1/deadline-settings',json=body,headers=self.headers).status_code,403)
        with self.app.app_context():self.db.session.get(self.User,1).is_admin=True;self.db.session.commit()
        self.assertEqual(self.c.put('/api/projects/1/deadline-settings',json=body,headers=self.headers).status_code,200)
        with self.app.app_context():self.assertEqual(bd.settings_for(self.db,2)['regime'],'')
        self.c.post('/api/projects',json={},headers=self.headers)
        with self.app.app_context():
            self.assertEqual(bd.settings_for(self.db,3)['regime'],'government_procurement')
            self.assertEqual(bd._rows(self.db,3),[])

    def test_source_cleared_does_not_fall_back_to_previously_copied_date(self):
        self.put();a=self.create(start_at='2026-10-09')
        self.Project.complaints[0].submit_date=''
        item=self.items()[0]
        self.assertTrue(item['needs_review'])
        self.assertEqual(item['confirmed_deadline'],a['confirmed_deadline'])
        self.assertEqual(item['proposed_deadline'],'')
        self.assertFalse(item['calculation']['valid'])

    def test_explicit_dedup_requires_same_time_link_and_subscribed_recipient(self):
        self.put();a=self.create(source_type='manual',source_id='linked',start_at='2026-10-09',cutoff='14:00',sync_stage_plan=True)
        groups=[dict(id='test',name='期限组',enabled=True,order=0,recipients=['a@example.com'],event_types=['business_deadline'],content_fields={'deadline_title':True,'deadline_at':True})]
        with self.app.app_context():
            p=self.db.session.get(self.Project,1)
            self.assertEqual(bd.covered_stage_recipients(self.db,p,'announcement',a['confirmed_deadline'],groups,datetime(2026,10,19)),{'a@example.com'})
            self.assertEqual(bd.covered_stage_recipients(self.db,p,'announcement','2026-10-19T15:00',groups,datetime(2026,10,19)),set())
            self.assertEqual(bd.covered_stage_recipients(self.db,p,'other',a['confirmed_deadline'],groups,datetime(2026,10,19)),set())
            groups[0]['event_types']=['daily_stage'];groups[0]['content_fields']={'planned_at':True}
            self.assertEqual(bd.covered_stage_recipients(self.db,p,'announcement',a['confirmed_deadline'],groups,datetime(2026,10,19)),set())

    def test_source_moved_lot_requires_correct_association_not_blind_acceptance(self):
        self.put();a=self.create();self.Project.complaints[0].lot_id=20
        item=self.items()[0]
        self.assertTrue(item['needs_review']);self.assertFalse(item['calculation']['valid'])
        self.assertEqual(item['confirmed_deadline'],a['confirmed_deadline'])

    def test_source_changed_from_package_to_whole_project_requires_remapping(self):
        self.put();a=self.create();self.Project.complaints[0].lot_id=None
        item=self.items()[0]
        self.assertTrue(item['needs_review']);self.assertFalse(item['calculation']['valid'])
        self.assertEqual(item['confirmed_deadline'],a['confirmed_deadline'])
        response=self.c.post(f"/api/projects/1/deadlines/{item['id']}/review",json=dict(revision=item['revision'],action='accept',reason=''),headers=self.headers)
        self.assertEqual(response.status_code,400)

    def test_malformed_parameters_return_field_errors_and_never_500(self):
        self.put()
        for value in (dict(regime=[]),dict(custom_rules=[dict(name='规则',days=2,day_kind={})]),dict(save_as_default='yes')):
            body=dict(revision=1,enabled=True,regime='government_procurement',custom_rules=[]);body.update(value)
            response=self.c.put('/api/projects/1/deadline-settings',json=body,headers=self.headers)
            self.assertEqual(response.status_code,400,response.json)
        for value in (dict(cutoff=[]),dict(id={'bad':'id'}),dict(sync_stage_plan='true')):
            self.assertEqual(self.preview(**value).status_code,400)

    def test_changed_regime_cannot_accept_now_inapplicable_legal_rule(self):
        self.put();a=self.create();self.put(revision=1,regime='enterprise')
        item=self.items()[0]
        self.assertTrue(item['needs_review']);self.assertFalse(item['calculation']['valid'])
        self.assertEqual(item['confirmed_deadline'],a['confirmed_deadline'])
        url=f"/api/projects/1/deadlines/{item['id']}/review"
        self.assertEqual(self.c.post(url,json=dict(revision=item['revision'],action='accept',reason='确认'),headers=self.headers).status_code,400)

    def test_controlled_rule_revision_change_preserves_confirmed_snapshot(self):
        from unittest.mock import patch
        from src.backend_patches import deadline_rules as dr
        self.put();a=self.create()
        updated=copy.deepcopy(dr.CARDS)
        for r in updated:
            if r['id']=='gov_question_reply':r.update(version=2,days=8)
        with patch.object(dr,'CARDS',updated):
            item=self.items()[0]
            self.assertTrue(item['needs_review'])
            self.assertEqual(item['confirmed_deadline'],a['confirmed_deadline'])
            self.assertEqual(item['proposed_deadline'],'2026-10-20')

    def test_import_impact_flags_expired_proposal_without_changing_confirmed_date(self):
        from unittest.mock import patch
        from src.backend_patches import holiday_calendar as hc
        self.put();item=self.create()
        snapshot=copy.deepcopy(hc.get_calendar(2026));snapshot['holidays'].append(dict(date='2026-10-19',name='模拟放假'))
        with self.app.app_context(),patch.object(bd,'_now',return_value=datetime(2026,11,1)):
            result=bd.impact_items(self.db,self.Project,2026,snapshot,self.tmp.name)
            self.assertTrue(result[0]['overdue'])
            self.assertEqual(result[0]['confirmed_deadline'],item['confirmed_deadline'])

    def test_rules_require_matching_actual_event_semantics(self):
        self.put()
        self.assertEqual(self.preview(source_type='clarification',source_id=21).status_code,400)
        self.assertEqual(self.preview(rule_id='gov_announcement').status_code,400)
        self.assertEqual(self.preview(rule_id='gov_result_publish').status_code,400)
        self.assertEqual(self.preview(source_type='manual',start_at='2026-10-09').status_code,200)

    def test_converted_complaint_is_not_question_reply_fact(self):
        self.put();a=self.create();self.Project.complaints[0].complaint_type='投诉'
        item=self.items()[0]
        self.assertTrue(item['needs_review']);self.assertFalse(item['calculation']['valid'])
        self.assertEqual(item['confirmed_deadline'],a['confirmed_deadline'])

if __name__=='__main__':unittest.main()
