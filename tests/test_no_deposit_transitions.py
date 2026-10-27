import json
import unittest
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from src.backend_patches import no_deposit_workflow

class NoDepositTransitionTests(unittest.TestCase):
    def setUp(self):
        self.app=Flask(__name__);self.app.config['SQLALCHEMY_DATABASE_URI']='sqlite://'
        self.db=SQLAlchemy(self.app);self.ctx=self.app.app_context();self.ctx.push()
        self.db.session.execute(text('CREATE TABLE stages(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,completed INTEGER,skipped INTEGER,completed_date TEXT,completed_at TEXT,notes TEXT,modules_json TEXT)'))
        for i, state in enumerate([(0,0,None,None),(1,0,'2026-10-01','2026-10-01T09:30'),(1,1,'2026-10-02',None)],1):
            self.db.session.execute(text('INSERT INTO stages VALUES(:id,1,:key,:completed,:skipped,:date,:at,\'原备注\',:modules)'),dict(id=i,key=str(i),completed=state[0],skipped=state[1],date=state[2],at=state[3],modules=json.dumps(['deposit_refund'])))
        self.db.session.commit()
    def tearDown(self): self.db.session.remove();self.ctx.pop()
    def row(self,key):return dict(self.db.session.execute(text('SELECT * FROM stages WHERE stage_key=:key'),{'key':key}).mappings().one())
    def test_roundtrip_restores_only_proven_automatic_skips(self):
        before={key:self.row(key) for key in ['1','2','3']}
        enabled=no_deposit_workflow.apply(self.db,1,True);self.db.session.commit()
        self.assertEqual(enabled['auto_skipped'],['1'])
        disabled=no_deposit_workflow.apply(self.db,1,False);self.db.session.commit()
        self.assertEqual(disabled['restored'],['1'])
        self.assertEqual({key:self.row(key) for key in before},before)
    def test_a_manually_edited_automatic_stage_is_preserved(self):
        no_deposit_workflow.apply(self.db,1,True)
        self.db.session.execute(text("UPDATE stages SET notes='人工核对后调整' WHERE stage_key='1'"));self.db.session.commit()
        result=no_deposit_workflow.apply(self.db,1,False);self.db.session.commit()
        self.assertEqual(result['restored'],[]);self.assertEqual(result['preserved'],['1']);self.assertEqual(self.row('1')['completed'],1)
    def test_historical_skips_without_provenance_are_not_reversed(self):
        before=self.row('3');result=no_deposit_workflow.apply(self.db,1,False)
        self.assertEqual(result['restored'],[]);self.assertEqual(self.row('3'),before)
