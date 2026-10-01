import sys
import sqlite3
import tempfile
import types
import unittest
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path
from unittest import mock

from src.backend_patches import app_replacements as subject
from src.backend_patches import lot_supplier_risk
from src.backend_patches import stage_templates
from tests.test_app_replacements import FakeRequest, FakeWinreg, load_replacements


STAGES = [
    {"key": "plan", "name": "计划接收"},
    {"key": "review", "name": "文件审核"},
    {"key": "award", "name": "结果公示"},
]


class StageOrderSettingsApiTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.settings = {}
        self.saved = []
        self.module = load_replacements()
        self.module.STAGES = STAGES
        self.module.METHODS = ["公开招标", "竞争性磋商"]
        self.module.session = {"is_admin": True}
        self.module.request = FakeRequest()
        self.module.jsonify = lambda value: value
        self.module.app = types.SimpleNamespace(
            config={"IS_DESKTOP": True},
            logger=types.SimpleNamespace(
                warning=mock.Mock(),
                exception=mock.Mock(),
            ),
        )
        self.module.load_app_settings = lambda: dict(self.settings)
        self.module.save_app_settings = self.save_settings
        self.module.get_export_dir = lambda: self.root / "exports"
        self.module.get_desktop_dir = lambda: self.root / "Desktop"
        self.module.DATA_DIR = self.root
        self.module.SETTINGS_PATH = self.root / "app_settings.json"
        self.module.Path = Path
        self.module.log_operation = mock.Mock()
        self.previous_winreg = sys.modules.get("winreg")
        sys.modules["winreg"] = FakeWinreg({})

    def tearDown(self):
        if self.previous_winreg is None:
            sys.modules.pop("winreg", None)
        else:
            sys.modules["winreg"] = self.previous_winreg
        self.temporary.cleanup()

    def save_settings(self, updates):
        self.saved.append(dict(updates))
        self.settings.update(updates)
        return dict(self.settings)

    def test_get_legacy_settings_returns_default_stage_order(self):
        response = self.module.api_get_settings()
        self.assertEqual(response.get("stage_order"), ["plan", "review", "award"])
        self.assertEqual(self.saved, [])

    def test_get_settings_exposes_method_templates_and_module_catalog(self):
        response = self.module.api_get_settings()
        self.assertEqual(set(response["stage_templates"]), {"公开招标", "竞争性磋商"})
        self.assertEqual(response["stage_templates"]["公开招标"][0]["id"], "plan")
        self.assertEqual(response["stage_module_catalog"][0]["id"], "common")

    def test_admin_can_save_complete_stage_templates(self):
        templates = {
            "公开招标": [{"id": "notice", "name": "公告", "icon": "📢", "modules": ["common"]}],
            "竞争性磋商": [{"id": "talk", "name": "磋商", "icon": "🤝", "modules": ["common"]}],
        }
        self.module.request.json = {"stage_templates": templates}
        response = self.module.api_update_settings()
        self.assertEqual(response["settings"]["stage_templates"], templates)
        self.assertEqual(self.saved, [{
            "stage_templates": templates,
            "stage_auto_completion_policy_version": 1,
        }])

    def test_admin_can_sync_one_saved_method_template_additively(self):
        templates = {
            "公开招标": [{"id": "notice", "name": "公告", "icon": "📢", "modules": ["common"]}],
            "竞争性磋商": [{"id": "talk", "name": "磋商", "icon": "🤝", "modules": ["common"]}],
        }
        self.settings["stage_templates"] = templates
        connection = sqlite3.connect(":memory:")
        connection.row_factory = sqlite3.Row
        connection.executescript(
            "CREATE TABLE projects(id INTEGER PRIMARY KEY, method TEXT);"
            "CREATE TABLE stages(id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER, stage_key TEXT);"
            "INSERT INTO projects(id,method) VALUES(1,'公开招标');"
            "INSERT INTO stages(project_id,stage_key) VALUES(1,'old');"
        )
        self.module.db = types.SimpleNamespace(
            engine=types.SimpleNamespace(begin=lambda: nullcontext(connection))
        )
        self.module.text = lambda value: value
        self.module.request.json = {"stage_template_sync_method": "公开招标"}

        response = self.module.api_update_settings()

        self.assertIn("同步", response["message"])
        rows = connection.execute(
            "SELECT stage_key,template_removed FROM stages WHERE project_id=1 ORDER BY id"
        ).fetchall()
        self.assertEqual([(row[0], row[1]) for row in rows], [("old", 1), ("notice", 0)])

    def test_get_invalid_disk_order_falls_back_and_logs_warning(self):
        self.settings["stage_order"] = ["award"]
        response = self.module.api_get_settings()
        self.assertEqual(response.get("stage_order"), ["plan", "review", "award"])
        self.module.app.logger.warning.assert_called_once_with(
            "invalid stage_order; using defaults"
        )

    def test_admin_can_save_an_exact_stage_permutation(self):
        self.module.request.json = {
            "stage_order": ["award", "plan", "review"]
        }
        response = self.module.api_update_settings()
        self.assertEqual(
            response.get("settings", {}).get("stage_order"),
            ["award", "plan", "review"],
        )
        self.assertEqual(
            self.saved,
            [{"stage_order": ["award", "plan", "review"]}],
        )

    def test_non_admin_cannot_save_stage_order(self):
        self.module.session = {"is_admin": False}
        self.module.request.json = {
            "stage_order": ["award", "plan", "review"]
        }
        result = self.module.api_update_settings()
        self.assertIsInstance(result, tuple)
        response, status = result
        self.assertEqual(status, 403)
        self.assertEqual(response["error"], "只有管理员可以修改阶段顺序")
        self.assertEqual(self.saved, [])

    def test_invalid_orders_do_not_overwrite_settings(self):
        invalid_values = (
            None,
            "award,plan,review",
            ["award", "plan"],
            ["award", "plan", "plan"],
            ["award", "plan", "unknown"],
        )
        for value in invalid_values:
            with self.subTest(value=value):
                self.module.request.json = {"stage_order": value}
                result = self.module.api_update_settings()
                self.assertIsInstance(result, tuple)
                response, status = result
                self.assertEqual(status, 400)
                self.assertEqual(
                    response["error"],
                    "阶段顺序必须包含全部阶段且不得重复",
                )
                self.assertEqual(self.saved, [])


class StageOrderProjectPayloadTests(unittest.TestCase):
    class Query:
        def __init__(self, rows):
            self.rows = rows

        def options(self, *args):
            return self

        def order_by(self, *args):
            return self

        def filter_by(self, **values):
            return self

        def all(self):
            return list(self.rows)

        def first_or_404(self):
            return self.rows[0]

    def setUp(self):
        self.subject_sentinel = object()
        self.subject_previous = {
            name: getattr(subject, name, self.subject_sentinel)
            for name in (
                "STAGES", "Project", "selectinload", "joinedload", "datetime",
                "db", "text", "jsonify", "load_app_settings",
            )
        }
        self.project = types.SimpleNamespace(
            id=7,
            created_at=datetime(2026, 9, 7, 12, 30),
            completed_at=None,
            to_summary_dict=self.payload,
            to_dict=self.payload,
            ensure_workflow_defaults=mock.Mock(),
        )
        subject.STAGES = STAGES
        subject.Project = types.SimpleNamespace(
            query=self.Query([self.project]),
            stages=object(),
            stage_checklist_items=object(),
            lots=object(),
            registrations=object(),
            year=types.SimpleNamespace(desc=lambda: object()),
            number=object(),
        )
        subject.selectinload = lambda value: value
        subject.joinedload = lambda value: value
        subject.datetime = datetime
        subject.db = types.SimpleNamespace(
            session=types.SimpleNamespace(commit=mock.Mock())
        )
        subject.text = lambda value: value
        subject.jsonify = lambda value: value
        subject.load_app_settings = lambda: {
            "stage_order": ["review", "award", "plan"]
        }
        self.previous_risk = sys.modules.get("lot_supplier_risk")
        self.previous_stage_templates = sys.modules.get("stage_templates")
        sys.modules["lot_supplier_risk"] = lot_supplier_risk
        sys.modules["stage_templates"] = stage_templates
        self.enrich = mock.patch.object(
            lot_supplier_risk,
            "enrich_project_payload",
            side_effect=lambda database, payload, project, now, settings: payload,
        )
        self.enrich.start()
        self.serializer = mock.patch.object(
            stage_templates,
            "serialize_v5_project_payload",
            side_effect=lambda connection, sql_text, project, payload, settings, methods, stages: (
                stage_templates.enrich_v5_project_payload(
                    None, None, payload, settings, methods, stages
                )
            ),
        )
        self.serialize = self.serializer.start()
        # These payload-order tests use a stub session; location persistence has
        # its own database tests and must not execute SQL through this stub.
        self.locations = mock.patch.object(
            stage_templates, 'enrich_stage_locations',
            side_effect=lambda connection, sql_text, pid, payload: payload,
        )
        self.locations.start()
        self.addCleanup(self.locations.stop)

    def tearDown(self):
        self.serializer.stop()
        self.enrich.stop()
        for name, value in self.subject_previous.items():
            if value is self.subject_sentinel:
                try:
                    delattr(subject, name)
                except AttributeError:
                    pass
            else:
                setattr(subject, name, value)
        if self.previous_risk is None:
            sys.modules.pop("lot_supplier_risk", None)
        else:
            sys.modules["lot_supplier_risk"] = self.previous_risk
        if self.previous_stage_templates is None:
            sys.modules.pop("stage_templates", None)
        else:
            sys.modules["stage_templates"] = self.previous_stage_templates

    @staticmethod
    def payload():
        return {
            "id": 7,
            "stages": [
                {"key": "plan", "completed": False, "skipped": False},
                {"key": "review", "completed": True, "skipped": False},
                {"key": "award", "completed": False, "skipped": False},
            ],
        }

    def assert_ordered_payload(self, payload):
        self.assertEqual(
            [row["key"] for row in payload["stages"]],
            ["review", "award", "plan"],
        )
        self.assertEqual(payload["current_stage_key"], "award")
        self.assertEqual(payload["next_stage_key"], "plan")

    def test_project_list_uses_configured_workflow_order(self):
        response = subject.api_projects()
        self.assert_ordered_payload(response[0])
        self.assertEqual(response[0]["created_at"], "2026-09-07T12:30:00")

    def test_project_detail_uses_configured_workflow_order(self):
        response = subject.api_project(7)
        self.assert_ordered_payload(response)
        self.project.ensure_workflow_defaults.assert_called_once_with()
        subject.db.session.commit.assert_called_once_with()

    def test_project_list_uses_method_template_names_icons_and_order(self):
        subject.load_app_settings = lambda: {
            "stage_templates": {
                "公开招标": [
                    {"id": "award", "name": "自定义公示", "icon": "🏆", "modules": ["common"]},
                    {"id": "plan", "name": "自定义计划", "icon": "📌", "modules": ["common"]},
                ],
                "竞争性磋商": [{"id": "review", "name": "磋商", "icon": "🤝", "modules": ["common"]}],
            }
        }
        original_payload = self.project.to_summary_dict
        self.project.to_summary_dict = lambda: {**original_payload(), "method": "公开招标"}
        subject.METHODS = ["公开招标", "竞争性磋商"]

        response = subject.api_projects()

        self.assertEqual([row["key"] for row in response[0]["stages"][:2]], ["award", "plan"])
        self.assertEqual(response[0]["stages"][0]["name"], "自定义公示")
        self.assertEqual(response[0]["stages"][0]["icon"], "🏆")
        args = self.serialize.call_args.args
        self.assertIs(args[0], subject.db.session)
        self.assertIs(args[2], self.project)

    def test_project_detail_uses_snapshot_serializer_for_saved_templates(self):
        subject.load_app_settings = lambda: {
            "stage_templates": {
                "公开招标": [{"id": "award", "name": "公示", "icon": "🏆", "modules": ["common"]}],
                "竞争性磋商": [{"id": "review", "name": "磋商", "icon": "🤝", "modules": ["common"]}],
            }
        }
        subject.METHODS = ["公开招标", "竞争性磋商"]
        self.project.method = "公开招标"

        subject.api_project(7)

        args = self.serialize.call_args.args
        self.assertIs(args[0], subject.db.session)
        self.assertIs(args[2], self.project)
        self.assertEqual(args[3]["id"], 7)


if __name__ == "__main__":
    unittest.main()
