import importlib
import json
import sqlite3
import unittest


METHODS = ("公开招标", "竞争性磋商")
STAGES = (
    {"key": "plan", "name": "计划接收", "icon": "📥"},
    {"key": "bid_opening", "name": "开标", "icon": "🎯"},
)


def load_stage_templates():
    try:
        return importlib.import_module("src.backend_patches.stage_templates")
    except ImportError as error:
        raise AssertionError("stage template recovery module is unavailable") from error


class StageTemplateRecoveryTests(unittest.TestCase):
    def test_standalone_bid_results_can_be_configured_after_quote_deadline(self):
        subject = load_stage_templates()
        catalog = {row['id']: row for row in subject.module_catalog_payload()}
        self.assertIn('bid_results', catalog)
        self.assertIn('中标', catalog['bid_results']['name'])
        raw = {'网上竞价': [
            {'id': 'quote', 'name': '报价截止', 'modules': ['common']},
            {'id': 'result', 'name': '中标结果', 'modules': ['bid_results']},
            {'id': 'notice', 'name': '领取通知书', 'modules': ['winning_notice']},
        ]}
        normalized = subject.normalize_stage_templates(raw, ['网上竞价'], STAGES, strict=True)
        self.assertEqual(normalized['网上竞价'][1]['modules'], ['common', 'bid_results'])
        self.assertEqual(normalized['网上竞价'][2]['modules'], ['common', 'winning_notice'])

    def test_default_templates_are_independent_and_follow_stage_order(self):
        subject = load_stage_templates()

        result = subject.default_stage_templates(
            METHODS,
            STAGES,
            stage_order=["bid_opening", "plan"],
        )

        self.assertEqual([row["id"] for row in result["公开招标"]], ["bid_opening", "plan"])
        self.assertEqual(
            result["公开招标"][0]["modules"],
            ["common", "checklist", "bid_opening", "auto_completion"],
        )
        result["公开招标"][0]["name"] = "已修改"
        self.assertEqual(result["竞争性磋商"][0]["name"], "开标")

    def test_strict_normalization_rejects_missing_methods_and_duplicate_ids(self):
        subject = load_stage_templates()
        invalid_values = (
            {"公开招标": [{"id": "one", "name": "阶段", "modules": ["common"]}]},
            {
                "公开招标": [
                    {"id": "same", "name": "阶段一", "modules": ["common"]},
                    {"id": "same", "name": "阶段二", "modules": ["common"]},
                ],
                "竞争性磋商": [{"id": "talk", "name": "磋商", "modules": ["common"]}],
            },
        )

        for value in invalid_values:
            with self.subTest(value=value):
                with self.assertRaises(subject.StageTemplateValidationError):
                    subject.normalize_stage_templates(
                        value,
                        METHODS,
                        STAGES,
                        strict=True,
                    )

    def test_strict_normalization_rejects_unsafe_ids_names_and_icons(self):
        subject = load_stage_templates()

        def templates(row):
            return {
                "公开招标": [row],
                "竞争性磋商": [
                    {"id": "safe-stage", "name": "安全阶段", "icon": "📌", "modules": ["common"]}
                ],
            }

        invalid_rows = (
            {"id": "bad/route", "name": "阶段", "icon": "📌", "modules": ["common"]},
            {"id": "bad'quote", "name": "阶段", "icon": "📌", "modules": ["common"]},
            {"id": "safe", "name": "<img src=x onerror=alert(1)>", "icon": "📌", "modules": ["common"]},
            {"id": "safe", "name": "阶段", "icon": "\" onerror=alert(1)", "modules": ["common"]},
        )
        for row in invalid_rows:
            with self.subTest(row=row), self.assertRaises(subject.StageTemplateValidationError):
                subject.normalize_stage_templates(
                    templates(row), METHODS, STAGES, strict=True
                )

    def test_singleton_business_module_cannot_appear_twice_in_one_method(self):
        subject = load_stage_templates()
        raw = {
            "公开招标": [
                {"id": "open-1", "name": "开标一", "modules": ["common", "bid_opening"]},
                {"id": "open-2", "name": "开标二", "modules": ["common", "bid_opening"]},
            ],
            "竞争性磋商": [
                {"id": "talk", "name": "磋商", "modules": ["common"]},
            ],
        }

        with self.assertRaisesRegex(subject.StageTemplateValidationError, "只能配置一次"):
            subject.normalize_stage_templates(raw, METHODS, STAGES, strict=True)

    def test_module_catalog_is_frontend_safe_and_stably_ordered(self):
        subject = load_stage_templates()

        result = subject.module_catalog_payload()

        self.assertEqual(result[0], {"id": "common", "name": "通用阶段信息", "singleton": False})
        self.assertIn(
            {"id": "bid_opening", "name": "开标与响应处理", "singleton": True},
            result,
        )
        self.assertIn(
            {"id": "auto_completion", "name": "到时自动完成", "singleton": False},
            result,
        )

    def test_snapshot_schema_and_additive_sync_preserve_historical_stage(self):
        subject = load_stage_templates()
        connection = sqlite3.connect(":memory:")
        self.addCleanup(connection.close)
        connection.row_factory = sqlite3.Row
        connection.executescript(
            "CREATE TABLE projects(id INTEGER PRIMARY KEY, method TEXT);"
            "CREATE TABLE stages(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, stage_key TEXT, completed INTEGER DEFAULT 0, completed_date TEXT, planned_datetime TEXT, skipped INTEGER DEFAULT 0, notes TEXT DEFAULT '', responsible_person TEXT DEFAULT '');"
            "CREATE TABLE stage_checklist_items(id INTEGER PRIMARY KEY, project_id INTEGER, stage_key TEXT, title TEXT, completed INTEGER DEFAULT 0);"
            "INSERT INTO projects(id,method) VALUES(1,'公开招标'),(2,'竞争性磋商');"
            "INSERT INTO stages(project_id,stage_key,completed,completed_date,planned_datetime,skipped,notes,responsible_person) VALUES(1,'old',1,'2026-08-01','2026-07-31T09:00:00',0,'历史记录','历史负责人');"
            "INSERT INTO stage_checklist_items(id,project_id,stage_key,title,completed) VALUES(8,1,'old','历史清单',1);"
        )
        template = [
            {"id": "notice", "name": "公告", "icon": "📢", "modules": ["common", "clarification"]},
            {"id": "open", "name": "开标", "icon": "🎯", "modules": ["common", "bid_opening"]},
        ]

        summary = subject.sync_v5_stage_template(connection, lambda value: value, "公开招标", template)

        rows = connection.execute(
            "SELECT stage_key,stage_name,stage_icon,modules_json,template_removed,stage_position,notes FROM stages WHERE project_id=1 ORDER BY id"
        ).fetchall()
        self.assertEqual(summary["projects_updated"], 1)
        self.assertEqual(rows[0]["stage_key"], "old")
        self.assertEqual(rows[0]["template_removed"], 1)
        self.assertEqual(rows[0]["notes"], "历史记录")
        preserved = connection.execute(
            "SELECT completed,completed_date,planned_datetime,skipped,responsible_person FROM stages WHERE project_id=1 AND stage_key='old'"
        ).fetchone()
        self.assertEqual(tuple(preserved), (1, "2026-08-01", "2026-07-31T09:00:00", 0, "历史负责人"))
        checklist = connection.execute(
            "SELECT title,completed FROM stage_checklist_items WHERE project_id=1 AND stage_key='old'"
        ).fetchone()
        self.assertEqual(tuple(checklist), ("历史清单", 1))
        self.assertEqual([row["stage_key"] for row in rows[1:]], ["notice", "open"])
        self.assertEqual(rows[2]["stage_position"], 1)
        self.assertEqual(
            json.loads(rows[2]["modules_json"]),
            ["common", "bid_opening", "_auto_completion_policy_v1"],
        )


if __name__ == "__main__":
    unittest.main()
