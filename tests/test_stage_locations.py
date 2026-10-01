import sqlite3
import types
import unittest
from datetime import date, datetime
from flask import Flask, request, jsonify
from src.backend_patches import stage_templates, app_replacements


class StageLocationTests(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        self.addCleanup(self.connection.close)
        self.connection.executescript("CREATE TABLE stages(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT); INSERT INTO stages VALUES(1,7,'opening'),(2,7,'evaluation'),(3,8,'opening');")
        self.app = Flask(__name__)
        self.stage = types.SimpleNamespace(id=1, completed=False, skipped=False, completed_date=None, planned_datetime=None, notes='原备注')
        self.project = types.SimpleNamespace(id=7, number='P7', is_terminated=False, stage_checklist_items=[], get_stage=lambda key: self.stage if key in ('opening','evaluation') else None, to_dict=lambda: {'stages':[{'key':'opening'}, {'key':'evaluation'}]})
        query = types.SimpleNamespace(options=lambda *a: query, filter_by=lambda **k: query, first_or_404=lambda: self.project)
        env = dict(app_replacements.__dict__, Project=types.SimpleNamespace(query=query, stages=None), joinedload=lambda x:x, db=types.SimpleNamespace(session=self.connection), text=lambda x:x, request=request, jsonify=jsonify, date=date, datetime=datetime, STAGES=[], log_operation=lambda *a:None)
        self.handler = types.FunctionType(app_replacements.api_update_stage.__code__, env)

    def save(self, key='opening', **data):
        with self.app.test_request_context(json=data):
            return self.app.make_response(self.handler(7,key))

    def test_save_reopen_clear_and_project_isolation(self):
        self.assertEqual(self.save(opening_location='  一楼开标室  ').status_code,200)
        self.assertEqual(self.save('evaluation', evaluation_location='二楼评标室').status_code,200)
        payload=stage_templates.enrich_stage_locations(self.connection,lambda x:x,7,self.project.to_dict())
        self.assertEqual(payload['stages'][0]['opening_location'],'一楼开标室')
        self.assertEqual(payload['stages'][1]['evaluation_location'],'二楼评标室')
        self.assertEqual(payload['stages'][0]['evaluation_location'],'')
        self.assertEqual(self.connection.execute('SELECT opening_location FROM stages WHERE project_id=8').fetchone()[0],'')
        self.save(notes='更新备注')
        self.assertEqual(self.save(opening_location='').json['stages'][0]['opening_location'],'')
        self.assertEqual(self.stage.notes,'更新备注')

    def test_publication_link_save_reopen_clear_and_isolation(self):
        url='https://example.com/result?id=7'
        self.assertEqual(self.save(publication_url=url).json['stages'][0]['publication_url'],url)
        self.save(notes='保留链接')
        payload=stage_templates.enrich_stage_locations(self.connection,lambda x:x,7,self.project.to_dict())
        self.assertEqual(payload['stages'][0]['publication_url'],url)
        self.assertEqual(payload['stages'][1]['publication_url'],'')
        self.assertEqual(self.connection.execute('SELECT publication_url FROM stages WHERE project_id=8').fetchone()[0],'')
        self.assertEqual(self.save(publication_url='').json['stages'][0]['publication_url'],'')

    def test_publication_link_validation_precedes_mutations(self):
        for value in (None,[],123,'x'*2001,'javascript:alert(1)','https://','https://bad host','https://['):
            with self.subTest(value=str(value)[:20]):
                self.assertEqual(self.save(publication_url=value,notes='不能保存').status_code,400)
                self.assertEqual(self.stage.notes,'原备注')

    def test_invalid_locations_do_not_update_state(self):
        for value in (None,[],123,'x'*501):
            with self.subTest(value=str(value)[:20]):
                self.assertEqual(self.save(opening_location=value,notes='不能保存').status_code,400)
                self.assertEqual(self.stage.notes,'原备注')

    def test_closed_missing_and_checklist_blocked(self):
        self.project.is_terminated=True
        self.assertEqual(self.save(opening_location='地点').status_code,400)
        self.project.is_terminated=False
        self.assertEqual(self.save('missing',opening_location='地点').status_code,404)
        self.project.stage_checklist_items=[types.SimpleNamespace(stage_key='opening',required=True,completed=False,title='检查文件')]
        self.assertEqual(self.save(completed=True,opening_location='地点').status_code,409)
        self.assertFalse(self.stage.completed)

    def test_legacy_schema_migration_is_idempotent(self):
        for _ in range(2):stage_templates.ensure_v5_snapshot_schema(self.connection,lambda x:x)
        self.assertEqual(self.connection.execute('SELECT COUNT(*) FROM stages').fetchone()[0],3)

    def test_skip_and_completion_semantics_remain(self):
        self.assertEqual(self.save(skipped=True).status_code,200)
        self.assertTrue(self.stage.completed)
        self.assertEqual(self.stage.completed_date,date.today())
        self.save(skipped=False,completed=False)
        self.assertFalse(self.stage.completed)
        self.assertIsNone(self.stage.completed_date)


if __name__ == '__main__':
    unittest.main()
