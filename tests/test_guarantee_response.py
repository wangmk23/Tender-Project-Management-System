"""Query budgets use isolated ORM data, never production databases."""
import json
import unittest
from types import SimpleNamespace as NS
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from src.backend_patches import tender_guarantee as tg

class GuaranteeResponseTests(unittest.TestCase):
    def setUp(self):
        self.app=Flask(__name__);self.app.config['SQLALCHEMY_DATABASE_URI']='sqlite://'
        self.db=SQLAlchemy(self.app);db=self.db
        class Project(db.Model):
            id=db.Column(db.Integer,primary_key=True);number='PERF';name='Synthetic';no_deposit=False
            registrations=[];lots=[];bid_results=[];stages=[]
        self.Project=Project
        self.context=self.app.app_context();self.context.push();db.create_all();tg.ensure_schema(db)
        tg._execute(db,'CREATE TABLE stages(project_id INTEGER,stage_key TEXT,completed_at TEXT,modules_json TEXT)')
        for pid in range(1,41):
            db.session.add(Project(id=pid))
        db.session.commit()
        Project.stages=[NS(stage_key=f'node-{i}',completed=True,skipped=False,completed_date='2026-10-01') for i in range(14)]
        for pid in range(1,41):
            tg._execute(db,'INSERT INTO tender_policies VALUES(:pid,:payload)',dict(pid=pid,payload=json.dumps({'strict_results':False})))
            for i in range(14):tg._execute(db,'INSERT INTO stages VALUES(:pid,:key,:at,:modules)',dict(pid=pid,key=f'node-{i}',at='2026-10-01T10:00',modules='[]'))
        db.session.commit();self.sql=[]
        event.listen(db.engine,'before_cursor_execute',lambda c,cu,sql,p,ctx,many:self.sql.append(sql))

    def tearDown(self):
        self.db.session.remove();self.context.pop()

    def test_stage_metadata_is_loaded_once_not_per_completed_stage(self):
        p=self.db.session.get(self.Project,1);self.sql.clear();tg.project_context(self.db,p)
        self.assertLessEqual(sum(sql.upper().startswith('PRAGMA') for sql in self.sql),2)
        self.assertLessEqual(len(self.sql),12)

    def test_changing_document_amount_preserves_payment_and_refund_records(self):
        p=self.db.session.get(self.Project,1)
        data=tg.validate({'records':[dict(registration_id=1,deposit_status='paid',deposit_amount='100',refunded_amount='20')],'rules':[]},[dict(id=1,company_name='Synthetic',lot_id=None)],[])
        tg._execute(self.db,'INSERT INTO tender_ledgers VALUES(1,1,:data,:roster,:items)',dict(data=json.dumps(data),roster='',items='[]'))
        self.db.session.commit();tg.set_document_amount(self.db,p,'30000',actor='test');self.db.session.commit()
        self.assertEqual(tg._load(self.db,1)[1]['records'],data['records'])

    def test_calendar_without_cash_has_constant_ledger_query_count(self):
        projects=self.Project.query.all();self.sql.clear();self.assertEqual(tg.calendar_events(self.db,projects,2026,10),[])
        self.assertLessEqual(len(self.sql),2)

    def test_initial_document_amount_does_not_create_a_payment_or_overwrite_it(self):
        p=self.db.session.get(self.Project,1)
        tg.set_document_amount(self.db,p,'30000',None,actor='test')
        self.db.session.commit();value=tg.get_payload(self.db,p)
        self.assertEqual(value['data']['amounts'],[{'lot_id':None,'amount':'30000.00'}])
        self.assertEqual(value['items'],[])
        tg.set_document_amount(self.db,p,'20000',None,actor='test')
        self.db.session.commit();self.assertEqual(tg.get_payload(self.db,p)['summary']['balance'],'0.00')
