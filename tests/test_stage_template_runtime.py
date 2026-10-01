import sqlite3
import types
import unittest
from datetime import datetime

from src.backend_patches import stage_templates as subject


METHODS = subject.PROCUREMENT_METHODS
LEGACY_STAGES = (
    {"key": "plan", "name": "计划接收", "icon": "📥", "group": "准备", "order": 0},
    {"key": "bid_opening", "name": "开标", "icon": "🎯", "group": "执行", "order": 1},
)


def template(stage_id, name, icon="🔹", modules=None):
    return {
        "id": stage_id,
        "name": name,
        "icon": icon,
        "modules": list(modules or ["common", "checklist"]),
    }


def all_method_templates(overrides=None):
    values = {
        method: [template(f"stage-{index}", f"{method}专属阶段")]
        for index, method in enumerate(METHODS)
    }
    values.update(overrides or {})
    return values


class Checklist:
    def __init__(self, stage_key, title, sort_order=0):
        self.stage_key = stage_key
        self.title = title
        self.sort_order = sort_order
        self.id = sort_order + 1

    def to_dict(self):
        return {"id": self.id, "title": self.title, "sort_order": self.sort_order}


class StageTemplateRuntimeTests(unittest.TestCase):
    def test_only_new_auctions_are_enrolled_and_legacy_sync_preserves_completion(self):
        connection = sqlite3.connect(':memory:')
        self.addCleanup(connection.close)
        connection.row_factory = sqlite3.Row
        sql = lambda value: value
        connection.executescript("CREATE TABLE projects(id INTEGER PRIMARY KEY, method TEXT);"
            "CREATE TABLE stages(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,completed INTEGER DEFAULT 0,notes TEXT);"
            "INSERT INTO projects VALUES(1,'网上竞价'),(2,'网上竞价');"
            "INSERT INTO stages VALUES(1,1,'online_quotation',1,'原有资料');"
            "INSERT INTO stages VALUES(2,1,'archived',1,'已归档');")
        self.assertFalse(subject.online_bidding_enabled(connection, sql, 1))
        subject.initialize_online_bidding_scope(connection, sql, 2, '网上竞价')
        connection.commit()
        before = [tuple(r) for r in connection.execute('SELECT * FROM stages WHERE project_id=1')]
        result = subject.sync_v5_stage_template(connection, sql, '网上竞价', subject.online_bidding_template())
        self.assertEqual(result['projects_skipped_legacy'], 1)
        self.assertEqual(result['projects_updated'], 1)
        self.assertEqual(result['stages_added'], 9)
        self.assertEqual([tuple(r)[:5] for r in connection.execute('SELECT * FROM stages WHERE project_id=1')], before)
        for pid, enabled in [(1,False),(2,True)]:
            project = types.SimpleNamespace(id=pid,method='网上竞价',stages=[],stage_checklist_items=[])
            payload = subject.serialize_v5_project_payload(connection,sql,project,{}, {}, METHODS, LEGACY_STAGES)
            self.assertEqual(payload['online_bidding_enabled'],enabled)
            response = subject.enrich_stage_locations(connection,sql,pid,{'method':'网上竞价','stages':[]})
            self.assertEqual(response['online_bidding_enabled'],enabled)
        connection.execute('DELETE FROM projects WHERE id=2')
        connection.execute("INSERT INTO projects VALUES(2,'网上竞价')")
        self.assertFalse(subject.online_bidding_enabled(connection,sql,2), 'reused IDs must not enroll imported history')

    def test_serializer_exposes_created_and_derived_completion_timestamps_for_charts(self):
        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.row_factory = sqlite3.Row
        connection.executescript(
            "CREATE TABLE stages("
            "id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,completed INTEGER DEFAULT 0,"
            "completed_date TEXT,planned_datetime TEXT,skipped INTEGER DEFAULT 0,"
            "notes TEXT DEFAULT '',responsible_person TEXT DEFAULT ''"
            ");"
            "INSERT INTO stages(id,project_id,stage_key,completed,completed_date) "
            "VALUES(1,21,'plan',1,'2026-08-01T10:00:00');"
            "INSERT INTO stages(id,project_id,stage_key,completed,completed_date) "
            "VALUES(2,21,'bid_opening',1,'2026-09-03T15:30:00');"
        )
        project = types.SimpleNamespace(
            id=21,
            method="公开招标",
            created_at=datetime(2026, 7, 16, 9, 20),
            stages=[
                types.SimpleNamespace(
                    stage_key="plan", completed=True,
                    completed_date="2026-08-01T10:00:00", skipped=False,
                ),
                types.SimpleNamespace(
                    stage_key="bid_opening", completed=True,
                    completed_date="2026-09-03T15:30:00", skipped=False,
                ),
            ],
            stage_checklist_items=[],
        )

        result = subject.serialize_v5_project_payload(
            connection,
            lambda value: value,
            project,
            {"id": 21, "method": "公开招标", "stages": []},
            {},
            METHODS,
            LEGACY_STAGES,
        )

        self.assertEqual(result["created_at"], "2026-07-16T09:20:00")
        self.assertEqual(result["completed_at"], "2026-09-03T15:30:00")

    def test_legacy_rows_without_snapshot_metadata_ignore_new_saved_template(self):
        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.row_factory = sqlite3.Row
        connection.executescript(
            "CREATE TABLE stages("
            "id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,completed INTEGER DEFAULT 0,"
            "completed_date TEXT,planned_datetime TEXT,skipped INTEGER DEFAULT 0,"
            "notes TEXT DEFAULT '',responsible_person TEXT DEFAULT ''"
            ");"
            "INSERT INTO stages(id,project_id,stage_key) VALUES(1,12,'plan');"
        )
        project = types.SimpleNamespace(
            id=12,
            method="公开招标",
            stages=[types.SimpleNamespace(stage_key="plan", completed=False, skipped=False)],
            stage_checklist_items=[],
        )
        settings = {
            "stage_templates": all_method_templates({
                "公开招标": [template("plan", "模板已改名", "⚠️", ["common", "archive"])]
            })
        }
        payload = {
            "id": 12,
            "method": "公开招标",
            "stages": [{"key": "plan", "name": "计划接收", "icon": "📥"}],
        }

        result = subject.serialize_v5_project_payload(
            connection, lambda value: value, project, payload, settings, METHODS, LEGACY_STAGES
        )

        self.assertEqual(result["stages"][0]["name"], "计划接收")
        self.assertEqual(result["stages"][0]["icon"], "📥")
        self.assertNotIn("archive", result["stages"][0]["modules"])

    def test_serializer_outputs_real_custom_rows_and_removes_fixed_phantoms(self):
        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.row_factory = sqlite3.Row
        connection.executescript(
            "CREATE TABLE stages("
            "id INTEGER PRIMARY KEY AUTOINCREMENT,project_id INTEGER,stage_key TEXT,"
            "completed INTEGER DEFAULT 0,completed_date TEXT,planned_datetime TEXT,"
            "skipped INTEGER DEFAULT 0,notes TEXT DEFAULT '',responsible_person TEXT DEFAULT ''"
            ");"
            "INSERT INTO stages(project_id,stage_key,completed,completed_date,notes,responsible_person) "
            "VALUES(9,'custom-award',0,NULL,'保留备注','张三');"
            "INSERT INTO stages(project_id,stage_key,completed,completed_date,notes,responsible_person) "
            "VALUES(9,'custom-open',1,'2026-08-31','完成记录','李四');"
        )
        subject.ensure_v5_snapshot_schema(connection, lambda value: value)
        connection.execute(
            "UPDATE stages SET stage_name='自定义公示',stage_icon='🏆',"
            "modules_json='[\"common\",\"result_publication\"]',stage_position=0 "
            "WHERE stage_key='custom-award'"
        )
        connection.execute(
            "UPDATE stages SET stage_name='自定义开标',stage_icon='🎯',"
            "modules_json='[\"common\",\"bid_opening\"]',stage_position=1 "
            "WHERE stage_key='custom-open'"
        )
        project = types.SimpleNamespace(
            id=9,
            method="公开招标",
            stages=[
                types.SimpleNamespace(
                    stage_key="custom-award", completed=False, completed_date=None,
                    planned_datetime=None, skipped=False, notes="保留备注", responsible_person="张三",
                ),
                types.SimpleNamespace(
                    stage_key="custom-open", completed=True, completed_date="2026-08-31",
                    planned_datetime="2026-08-30T09:00:00", skipped=False,
                    notes="完成记录", responsible_person="李四",
                ),
            ],
            stage_checklist_items=[Checklist("custom-award", "核对公示", 2)],
        )
        settings = {
            "stage_templates": all_method_templates({
                "公开招标": [
                    template("custom-award", "自定义公示", "🏆", ["common", "result_publication"]),
                    template("custom-open", "自定义开标", "🎯", ["common", "bid_opening"]),
                ]
            })
        }
        legacy_payload = {
            "id": 9,
            "method": "公开招标",
            "progress": 0,
            "stages": [
                {"key": "plan", "name": "计划接收", "completed": False},
                {"key": "bid_opening", "name": "开标", "completed": False},
            ],
        }

        result = subject.serialize_v5_project_payload(
            connection,
            lambda value: value,
            project,
            legacy_payload,
            settings,
            METHODS,
            LEGACY_STAGES,
        )

        self.assertEqual([row["key"] for row in result["stages"]], ["custom-award", "custom-open"])
        self.assertEqual(result["stages"][0]["name"], "自定义公示")
        self.assertEqual(result["stages"][0]["icon"], "🏆")
        self.assertEqual(result["stages"][0]["modules"], ["common", "result_publication"])
        self.assertEqual(result["stages"][0]["notes"], "保留备注")
        self.assertEqual(result["stages"][0]["responsible_person"], "张三")
        self.assertEqual(result["stages"][0]["checklist"][0]["title"], "核对公示")
        self.assertEqual(result["stages"][1]["completed_date"], "2026-08-31")
        self.assertEqual(result["stages"][1]["planned_at"], "2026-08-30T09:00:00")
        self.assertEqual(result["current_stage_key"], "custom-award")
        self.assertIsNone(result["next_stage_key"])
        self.assertEqual(result["progress"], 50)

    def test_every_procurement_method_selects_only_its_saved_template(self):
        settings = {"stage_templates": all_method_templates()}

        for index, method in enumerate(METHODS):
            with self.subTest(method=method):
                rows = subject.template_for_method(settings, method, METHODS, LEGACY_STAGES)
                self.assertEqual(rows, [template(f"stage-{index}", f"{method}专属阶段")])


if __name__ == "__main__":
    unittest.main()
