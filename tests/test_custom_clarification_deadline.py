import sqlite3
import types
import unittest
from datetime import datetime

from src.backend_patches import app_replacements


class CustomClarificationDeadlineTests(unittest.TestCase):
    def setUp(self):
        self.connection=sqlite3.connect(':memory:')
        self.addCleanup(self.connection.close)
        self.connection.execute('CREATE TABLE stages(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,modules_json TEXT,template_removed INTEGER,stage_position INTEGER)')
        self.connection.executemany('INSERT INTO stages VALUES(?,?,?,?,?,?)',[
            (1,7,'custom_opening','["bid_opening"]',0,0),
            (2,7,'bid_opening','["common"]',0,1),
            (3,8,'other_opening','["bid_opening"]',0,0),
        ])
        self.stages={key:types.SimpleNamespace(stage_key=key,planned_datetime=datetime(2026,10,9,9))
                     for key in ('custom_opening','bid_opening','other_opening')}
        self.project=types.SimpleNamespace(id=7,get_stage=lambda key:self.stages.get(key))
        self.active=[types.SimpleNamespace(id=2,created_at=datetime(2026,10,8),new_deadline=datetime(2026,10,10,10))]
        self.queries=[]
        query=types.SimpleNamespace(filter_by=lambda **kw:self.query_for(kw,query),filter=lambda *args:query,all=lambda:self.active)
        model=types.SimpleNamespace(query=query,new_deadline=types.SimpleNamespace(isnot=lambda value:True))
        env=dict(app_replacements.__dict__,db=types.SimpleNamespace(session=self.connection),text=lambda value:value,AnnouncementClarification=model)
        self.handler=types.FunctionType(app_replacements._recalculate_clarification_deadline.__code__,env,
                                        argdefs=app_replacements._recalculate_clarification_deadline.__defaults__)

    def query_for(self,kwargs,query):
        self.queries.append(kwargs)
        return query

    def test_custom_opening_module_receives_deadline_and_other_stages_remain(self):
        self.handler(self.project)
        self.assertEqual(self.stages['custom_opening'].planned_datetime,datetime(2026,10,10,10))
        self.assertEqual(self.stages['bid_opening'].planned_datetime,datetime(2026,10,9,9))
        self.assertEqual(self.stages['other_opening'].planned_datetime,datetime(2026,10,9,9))
        self.assertEqual(self.queries,[{'project_id':7,'affects_deadline':True}])

    def test_removed_snapshot_is_excluded_without_fixed_key_fallback(self):
        self.connection.execute('UPDATE stages SET template_removed=1 WHERE id=1')
        self.handler(self.project)
        self.assertEqual(self.stages['custom_opening'].planned_datetime,datetime(2026,10,9,9))
        self.assertEqual(self.queries,[])

    def test_latest_created_then_id_wins_preserving_original_order_rule(self):
        self.active.extend([
            types.SimpleNamespace(id=8,created_at=datetime(2026,10,8),new_deadline=datetime(2026,10,11,11)),
            types.SimpleNamespace(id=9,created_at=None,new_deadline=datetime(2026,10,12,12)),
        ])
        self.handler(self.project)
        self.assertEqual(self.stages['custom_opening'].planned_datetime,datetime(2026,10,11,11))

    def test_fallback_restores_original_time_after_last_clarification_removed(self):
        self.active=[]
        self.handler(self.project,datetime(2026,10,7,8,30))
        self.assertEqual(self.stages['custom_opening'].planned_datetime,datetime(2026,10,7,8,30))

    def test_legacy_schema_retains_original_fixed_stage_behavior_without_migration(self):
        self.connection.execute('DROP TABLE stages')
        self.connection.execute('CREATE TABLE stages(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT)')
        self.connection.execute('INSERT INTO stages VALUES(1,7,"bid_opening")')
        self.handler(self.project)
        self.assertEqual(self.stages['bid_opening'].planned_datetime,datetime(2026,10,10,10))
        columns=[row[1] for row in self.connection.execute('PRAGMA table_info(stages)')]
        self.assertNotIn('modules_json',columns)

    def test_null_legacy_module_metadata_retains_fixed_stage_behavior(self):
        self.connection.execute('UPDATE stages SET modules_json=NULL WHERE stage_key="bid_opening"')
        self.connection.execute('UPDATE stages SET template_removed=1 WHERE stage_key="custom_opening"')
        self.handler(self.project)
        self.assertEqual(self.stages['bid_opening'].planned_datetime,datetime(2026,10,10,10))


if __name__=='__main__':
    unittest.main()
