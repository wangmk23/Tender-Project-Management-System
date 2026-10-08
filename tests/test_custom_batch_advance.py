"""Batch advancement uses actual active project stages and an atomic commit."""

import json
import types
import unittest
from datetime import date
from unittest.mock import patch

from flask import Flask, jsonify, request
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from sqlalchemy.orm import joinedload

from src.backend_patches import app_replacements, stage_templates


class CustomBatchAdvanceTests(unittest.TestCase):
    def setUp(self):
        self.app=Flask(__name__)
        self.app.config['SQLALCHEMY_DATABASE_URI']='sqlite://'
        self.db=SQLAlchemy(self.app)
        db=self.db
        class Project(db.Model):
            __tablename__='projects'
            id=db.Column(db.Integer,primary_key=True)
            number=db.Column(db.String)
            is_terminated=db.Column(db.Boolean,default=False)
            stages=db.relationship('Stage',backref='project')
            stage_checklist_items=db.relationship('Checklist',backref='project')
            def get_stage(self,key):return next((item for item in self.stages if item.stage_key==key),None)
        class Stage(db.Model):
            __tablename__='stages'
            id=db.Column(db.Integer,primary_key=True)
            project_id=db.Column(db.Integer,db.ForeignKey('projects.id'))
            stage_key=db.Column(db.String)
            completed=db.Column(db.Boolean,default=False)
            skipped=db.Column(db.Boolean,default=False)
            completed_date=db.Column(db.Date)
        class Checklist(db.Model):
            id=db.Column(db.Integer,primary_key=True)
            project_id=db.Column(db.Integer,db.ForeignKey('projects.id'))
            stage_key=db.Column(db.String)
            title=db.Column(db.String)
            required=db.Column(db.Boolean,default=True)
            completed=db.Column(db.Boolean,default=False)
        self.Project,self.Stage,self.Checklist=Project,Stage,Checklist
        self.logs=[]
        env=dict(app_replacements.__dict__,db=db,Project=Project,request=request,jsonify=jsonify,
                 text=text,joinedload=joinedload,STAGES=[{'key':'bid_opening','name':'固定开标'}],
                 log_operation=lambda *args:self.logs.append(args))
        self.handler=types.FunctionType(app_replacements.api_batch_advance_stage.__code__,env)
        self.app.add_url_rule('/api/batch/advance-stage','batch',self.handler,methods=['POST'])
        with self.app.app_context():
            db.create_all()
            for identity in range(1,8):
                project=Project(id=identity,number=f'P{identity}',is_terminated=identity==4)
                if identity!=7:
                    project.stages.append(Stage(stage_key='custom_review',completed=identity==2,skipped=identity==3))
                if identity==5:
                    project.stage_checklist_items.append(Checklist(stage_key='custom_review',title='必检项'))
                db.session.add(project)
            db.session.commit()
            stage_templates.ensure_v5_snapshot_schema(db.session,text)
            db.session.execute(text("UPDATE stages SET stage_name='自定义审核',template_removed=CASE WHEN project_id=6 THEN 1 ELSE 0 END"))
            db.session.commit()
        self.client=self.app.test_client()

    def post(self,**data):
        return self.client.post('/api/batch/advance-stage',json={'stage_key':'custom_review','project_ids':[1],**data})

    def state(self,pid=1):
        with self.app.app_context():
            stage=self.Stage.query.filter_by(project_id=pid).one()
            return stage.completed,stage.completed_date

    def test_custom_stage_uses_snapshot_label_and_duplicate_ids_advance_once(self):
        response=self.post(project_ids=[1,'1'],completed_date='2026-10-08')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['advanced_count'],1)
        self.assertIn('自定义审核',response.json['message'])
        self.assertEqual(self.state(),(True,date(2026,10,8)))
        self.assertEqual(json.loads(self.logs[0][4])['projects'],['P1'])
        self.assertEqual(self.post().json['advanced_count'],0)
        self.assertEqual(self.state(),(True,date(2026,10,8)))

    def test_completed_skipped_terminated_checklist_removed_missing_matrix(self):
        response=self.post(project_ids=[1,2,3,4,5,6,7,999])
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['advanced_count'],1)
        self.assertEqual(len(response.json['skipped']),4)
        self.assertEqual(len(response.json['errors']),3)
        self.assertIn('模板移除',response.json['errors'][0])
        self.assertFalse(self.state(6)[0])
        self.assertFalse(self.state(5)[0])

    def test_invalid_dates_and_member_ids_reject_before_mutation(self):
        for payload in ({'completed_date':'2026-02-30'},{'completed_date':[]},
                        {'project_ids':[1,True]},{'project_ids':[1,'bad']},
                        {'project_ids':[1,1.5]},{'project_ids':[1,-1]}):
            with self.subTest(payload=payload):
                self.assertEqual(self.post(**payload).status_code,400)
                self.assertEqual(self.state(),(False,None))
        self.assertEqual(self.logs,[])
        self.assertEqual(self.post(completed_date='').json['advanced_count'],1)
        self.assertEqual(self.state(),(True,date.today()))

    def test_commit_failure_rolls_back_all_projects_and_reports_zero(self):
        with self.app.app_context():
            self.db.session.add(self.Project(id=8,number='P8',stages=[self.Stage(stage_key='custom_review')]))
            self.db.session.commit()
        with patch.object(self.db.session,'commit',side_effect=RuntimeError('synthetic commit failure')):
            response=self.post(project_ids=[1,8])
        self.assertEqual(response.status_code,500)
        self.assertEqual(response.json['advanced_count'],0)
        self.assertFalse(response.json['success'])
        self.assertEqual(self.state(1),(False,None))
        self.assertEqual(self.state(8),(False,None))
        self.assertEqual(self.logs,[])

    def test_log_failure_keeps_committed_success_truth(self):
        self.handler.__globals__['log_operation']=lambda *args:(_ for _ in ()).throw(RuntimeError('synthetic log failure'))
        response=self.post()
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.json['advanced_count'],1)
        self.assertEqual(self.state(),(True,date.today()))


if __name__=='__main__':
    unittest.main()
