"""Checklist creation follows the project's active saved stage snapshot."""

import sqlite3
import types
import unittest

from flask import Flask, jsonify, request
from src.backend_patches import app_replacements, stage_templates


class CustomStageChecklistTests(unittest.TestCase):
    def setUp(self):
        self.connection = sqlite3.connect(':memory:')
        self.connection.row_factory = sqlite3.Row
        self.addCleanup(self.connection.close)
        self.connection.execute('CREATE TABLE stages (id INTEGER PRIMARY KEY, project_id INTEGER, stage_key TEXT)')
        self.connection.executemany('INSERT INTO stages VALUES(?,?,?)', [(1,7,'custom_review'),(2,7,'opening'),(3,8,'other_project')])
        stage_templates.ensure_v5_snapshot_schema(self.connection, lambda value: value)
        self.added = []
        self.commits = []
        self.stage = types.SimpleNamespace(stage_key='custom_review')
        self.project = types.SimpleNamespace(id=7, stage_checklist_items=[
            types.SimpleNamespace(stage_key='custom_review', sort_order=5),
            types.SimpleNamespace(stage_key='opening', sort_order=20),
        ], get_stage=lambda key: self.stage if key == 'custom_review' else None)

        class Item:
            def __init__(self, **values): self.__dict__.update(values)
            def to_dict(self): return dict(self.__dict__)

        session = types.SimpleNamespace(execute=self.connection.execute, add=self.added.append, commit=lambda:self.commits.append(True))
        env = dict(app_replacements.__dict__, db=types.SimpleNamespace(session=session,get_or_404=lambda *args:self.project),
                   Project=object(), text=lambda value:value, request=request,jsonify=jsonify, StageChecklistItem=Item)
        handler = getattr(app_replacements, 'api_create_stage_checklist_item', None)
        self.assertIsNotNone(handler, 'custom-stage checklist replacement must exist')
        self.handler = types.FunctionType(handler.__code__, env)
        self.app = Flask(__name__)

    def save(self, **payload):
        with self.app.test_request_context(json=payload):
            return self.app.make_response(self.handler(7))

    def test_existing_custom_stage_accepts_checklist_and_keeps_stage_order(self):
        response = self.save(stage_key='custom_review', title='  自定义检查项  ')
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response.json['title'], '自定义检查项')
        self.assertEqual(response.json['sort_order'], 6)
        self.assertTrue(response.json['required'])
        self.assertTrue(response.json['is_custom'])
        self.assertEqual(len(self.added),1)
        self.assertEqual(len(self.commits),1)

    def test_unknown_cross_project_and_missing_stage_rejected_without_writes(self):
        for key in ('unknown','other_project','opening',None):
            with self.subTest(key=key):
                self.assertEqual(self.save(stage_key=key,title='检查项').status_code,400)
        self.assertEqual(self.added,[])
        self.assertEqual(self.commits,[])

    def test_removed_snapshot_stage_rejected_even_if_legacy_model_has_no_flag(self):
        self.connection.execute('UPDATE stages SET template_removed=1 WHERE project_id=7 AND stage_key="custom_review"')
        self.assertEqual(self.save(stage_key='custom_review',title='检查项').status_code,400)
        self.assertEqual(self.added,[])
        self.assertEqual(self.commits,[])

    def test_title_required_optional_requirement_and_length_preserved(self):
        self.assertEqual(self.save(stage_key='custom_review',title='   ').status_code,400)
        response=self.save(stage_key='custom_review',title='甲'*300,required=False)
        self.assertEqual(response.status_code,201)
        self.assertEqual(len(response.json['title']),250)
        self.assertFalse(response.json['required'])


if __name__ == '__main__':
    unittest.main()
