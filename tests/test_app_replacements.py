import importlib.util
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from src.backend_patches import project_activity as project_activity_module
from src.backend_patches import data_import as data_import_module
from src.backend_patches import signed_attachments as signed_attachments_module


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "src" / "backend_patches" / "app_replacements.py"
RUN_KEY = r"Software\Microsoft\Windows\CurrentVersion\Run"
VALUE_NAME = "ProjectManagementSystemDesktop"


class FakeKey:
    def __init__(self, path):
        self.path = path

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False


class FakeWinreg(types.ModuleType):
    HKEY_CURRENT_USER = object()
    KEY_READ = 1
    KEY_SET_VALUE = 2
    REG_SZ = 1

    def __init__(self, registry):
        super().__init__("winreg")
        self.registry = registry

    def OpenKey(self, root, path, reserved=0, access=0):
        if path not in self.registry:
            raise FileNotFoundError(path)
        return FakeKey(path)

    def CreateKey(self, root, path):
        self.registry.setdefault(path, {})
        return FakeKey(path)

    def QueryValueEx(self, key, name):
        try:
            return self.registry[key.path][name], self.REG_SZ
        except KeyError as exc:
            raise FileNotFoundError(name) from exc

    def SetValueEx(self, key, name, reserved, value_type, value):
        self.registry.setdefault(key.path, {})[name] = value

    def DeleteValue(self, key, name):
        try:
            del self.registry[key.path][name]
        except KeyError as exc:
            raise FileNotFoundError(name) from exc


class FakeRequest:
    def __init__(self):
        self.remote_addr = "127.0.0.1"
        self.json = {}
        self.args = {}
        self.method = "GET"
        self.path = "/api/settings"

    def get_json(self, force=False, silent=False):
        return self.json


class FakeModelQuery:
    def __init__(self, rows):
        self.rows = rows

    def get(self, row_id):
        return self.rows.get(int(row_id))


class FakeAuditSession:
    def __init__(self, user, projects, attachments=None):
        self.user = user
        self.projects = projects
        self.attachments = attachments or {}
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def get(self, model, row_id):
        if model.__name__ == "User":
            return self.user if int(row_id) == self.user.id else None
        if model.__name__ == "Project":
            return self.projects.get(int(row_id))
        if model.__name__ == "Attachment":
            return self.attachments.get(int(row_id))
        return None

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakeAuditLog:
    def __init__(self, **values):
        self.__dict__.update(values)


def load_replacements():
    if not MODULE_PATH.is_file():
        raise AssertionError(f"missing replacement module: {MODULE_PATH}")
    spec = importlib.util.spec_from_file_location("app_replacements_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class AppReplacementTests(unittest.TestCase):
    def test_removed_customer_dispatch_markers_are_absent(self):
        source = MODULE_PATH.read_text(encoding="utf-8")

        self.assertNotIn("customer_management", source)
        self.assertNotIn("customer_view", source)
        self.assertNotIn("customer_action", source)

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.registry = {}
        self.settings = {
            "export_folder": str(self.temp_path / "initial-exports"),
            "login_subtitle": "初始副标题",
        }
        self.request = FakeRequest()
        self.module = load_replacements()
        self.module.session = {"is_admin": True}
        self.module.request = self.request
        self.module.jsonify = lambda value: value
        self.module.app = types.SimpleNamespace(config={"IS_DESKTOP": True})
        self.module.load_app_settings = lambda: dict(self.settings)
        self.module.get_export_dir = lambda: Path(self.settings["export_folder"])
        self.module.get_desktop_dir = lambda: self.temp_path / "Desktop"
        self.module.DATA_DIR = self.temp_path / "data"
        self.module.DB_PATH = self.temp_path / "database" / "custom-bidding.db"
        self.module.MASTER_KEY = b"test-master-key"
        self.module.connect_encrypted = Mock(name="connect_encrypted")
        self.module.SETTINGS_PATH = self.temp_path / "app_settings.json"
        self.module.Path = Path
        self.module.log_operation = Mock()
        self.module.db = Mock(name="db")
        self.module.app.add_url_rule = Mock(name="add_url_rule")

        def save_app_settings(updates):
            self.settings.update(updates)
            return dict(self.settings)

        self.module.save_app_settings = save_app_settings
        self.fake_winreg = FakeWinreg(self.registry)
        self.previous_winreg = sys.modules.get("winreg")
        self.previous_project_activity = sys.modules.get("project_activity")
        self.previous_data_import = sys.modules.get("data_import")
        self.previous_signed_attachments = sys.modules.get("signed_attachments")
        sys.modules["winreg"] = self.fake_winreg
        sys.modules["project_activity"] = project_activity_module
        sys.modules["data_import"] = data_import_module
        sys.modules["signed_attachments"] = signed_attachments_module

    def configure_auth_runtime(self, *, active=True):
        user = types.SimpleNamespace(
            id=7,
            username="zhangsan",
            display_name="张三",
            is_active=active,
            is_admin=False,
        )
        project = types.SimpleNamespace(
            id=34,
            number="PRJ-2026-034",
            name="旧项目名称",
            to_dict=lambda: {
                "id": 34,
                "number": "PRJ-2026-034",
                "name": project.name,
            },
        )
        projects = {34: project}
        audit_session = FakeAuditSession(user, projects)
        self.module.db = types.SimpleNamespace(session=audit_session)
        self.module.User = type("User", (), {})
        self.module.Project = type("Project", (), {})
        self.module.OperationLog = FakeAuditLog
        self.module.Attachment = type("Attachment", (), {})
        self.module.app = types.SimpleNamespace(
            config={"IS_DESKTOP": True},
            logger=types.SimpleNamespace(exception=lambda *args, **kwargs: None),
        )
        self.module.redirect = lambda location: ("redirect", location)
        self.module.session = {"user_id": 7, "username": "stale", "is_admin": True}
        return user, project, projects, audit_session

    def tearDown(self):
        if self.previous_winreg is None:
            sys.modules.pop("winreg", None)
        else:
            sys.modules["winreg"] = self.previous_winreg
        if self.previous_project_activity is None:
            sys.modules.pop("project_activity", None)
        else:
            sys.modules["project_activity"] = self.previous_project_activity
        if self.previous_data_import is None:
            sys.modules.pop("data_import", None)
        else:
            sys.modules["data_import"] = self.previous_data_import
        if self.previous_signed_attachments is None:
            sys.modules.pop("signed_attachments", None)
        else:
            sys.modules["signed_attachments"] = self.previous_signed_attachments
        self.temp_dir.cleanup()

    def test_local_desktop_admin_reads_matching_startup_value_as_enabled(self):
        expected = f'"{Path(sys.executable).resolve()}" --startup-minimized'
        self.registry[RUN_KEY] = {VALUE_NAME: expected}

        response = self.module.api_get_settings()

        self.assertIs(response["startup_enabled"], True)

    def test_settings_request_never_registers_import_routes_late(self):
        with patch.object(data_import_module, "register_routes") as register_routes:
            self.module.api_get_settings()

        register_routes.assert_not_called()

    def test_settings_request_never_registers_signed_route_late(self):
        with patch.object(data_import_module, "register_routes"), patch.object(
            signed_attachments_module, "register_routes"
        ) as register_routes:
            self.module.api_get_settings()

        register_routes.assert_not_called()

    def test_stale_executable_path_reads_as_disabled(self):
        self.registry[RUN_KEY] = {
            VALUE_NAME: '"C:\\Old\\项目管理系统_桌面版.exe" --startup-minimized'
        }

        response = self.module.api_get_settings()

        self.assertIs(response["startup_enabled"], False)

    def test_remote_admin_response_omits_startup_state(self):
        self.request.remote_addr = "192.168.101.8"

        response = self.module.api_get_settings()

        self.assertNotIn("startup_enabled", response)

    def test_non_admin_response_contains_only_desktop_context(self):
        self.module.session["is_admin"] = False

        response = self.module.api_get_settings()

        self.assertEqual(response, {"is_desktop": True})

    def test_project_activity_get_dispatch_precedes_admin_only_settings(self):
        self.module.session = {"user_id": 7, "is_admin": False}
        self.request.args = {
            "project_activity_view": "recent",
            "limit": "30",
            "before_id": "91",
            "user_id": "7",
            "project_id": "34",
            "action": "project.update",
        }
        activity_module = types.ModuleType("project_activity")

        def read_activity(db, operation_log, user, **values):
            return {
                "limit": values["limit"],
                "before_id": values["before_id"],
                "user_id": values["user_id"],
                "project_id": values["project_id"],
                "action": values["action"],
                "viewer": values["viewer"],
            }

        activity_module.read_activity = read_activity
        previous = sys.modules.get("project_activity")
        sys.modules["project_activity"] = activity_module
        self.module.db = object()
        self.module.OperationLog = object()
        self.module.User = object()
        try:
            response = self.module.api_get_settings()
        finally:
            if previous is None:
                sys.modules.pop("project_activity", None)
            else:
                sys.modules["project_activity"] = previous

        self.assertEqual(
            response,
            {
                "limit": "30",
                "before_id": "91",
                "user_id": "7",
                "project_id": "34",
                "action": "project.update",
                "viewer": {"id": 7, "is_admin": False},
            },
        )

    def test_project_activity_get_dispatch_returns_validation_errors(self):
        self.request.args = {"project_activity_view": "recent", "limit": "bad"}
        activity_module = types.ModuleType("project_activity")

        def read_activity(*args, **kwargs):
            raise ValueError("limit must be an integer")

        activity_module.read_activity = read_activity
        previous = sys.modules.get("project_activity")
        sys.modules["project_activity"] = activity_module
        self.module.db = object()
        self.module.OperationLog = object()
        self.module.User = object()
        try:
            response, status = self.module.api_get_settings()
        finally:
            if previous is None:
                sys.modules.pop("project_activity", None)
            else:
                sys.modules["project_activity"] = previous

        self.assertEqual(status, 400)
        self.assertEqual(response, {"error": "limit must be an integer"})

    def test_login_required_preserves_unauthenticated_and_inactive_behavior(self):
        self.request.path = "/api/projects/34"
        self.module.session = {}
        self.module.redirect = lambda location: ("redirect", location)
        self.module.db = types.SimpleNamespace(session=types.SimpleNamespace(get=lambda *args: None))
        self.module.User = type("User", (), {})

        protected = self.module.login_required(lambda: {"ok": True})
        response, status = protected()
        self.assertEqual(status, 401)
        self.assertEqual(response, {"error": "请先登录"})

        self.request.path = "/projects"
        self.assertEqual(protected(), ("redirect", "/login"))

        self.request.path = "/api/projects/34"
        self.configure_auth_runtime(active=False)
        protected = self.module.login_required(lambda: {"ok": True})
        response, status = protected()
        self.assertEqual(status, 401)
        self.assertEqual(response, {"error": "账号已停用，请重新登录"})
        self.assertEqual(self.module.session, {})

    def test_login_required_records_one_successful_project_write(self):
        user, project, projects, audit_session = self.configure_auth_runtime()
        self.request.method = "PUT"
        self.request.path = "/api/projects/34"
        self.request.json = {"name": "新项目名称", "password": "must-not-survive"}

        def update_project():
            project.name = "新项目名称"
            return {
                "id": project.id,
                "number": project.number,
                "name": project.name,
            }

        response = self.module.login_required(update_project)()

        self.assertEqual(response["name"], "新项目名称")
        self.assertEqual(self.module.session["username"], "zhangsan")
        self.assertIs(self.module.session["is_admin"], False)
        self.assertEqual(len(audit_session.added), 1)
        row = audit_session.added[0]
        self.assertEqual(row.action_type, "project.update")
        self.assertEqual(row.target_type, "project_activity")
        self.assertNotIn("password", row.detail_json)
        detail = __import__("json").loads(row.detail_json)
        self.assertEqual(detail["project"]["name"], "新项目名称")
        self.assertEqual(
            detail["changes"],
            [{"field": "name", "before": "旧项目名称", "after": "新项目名称"}],
        )

    def test_login_required_does_not_record_reads_failures_or_exceptions(self):
        _, _, _, audit_session = self.configure_auth_runtime()
        self.request.path = "/api/projects/34"

        self.request.method = "GET"
        self.module.login_required(lambda: {"id": 34})()
        self.request.method = "PUT"
        self.module.login_required(lambda: ({"error": "invalid"}, 400))()
        with self.assertRaisesRegex(RuntimeError, "route failed"):
            self.module.login_required(
                lambda: (_ for _ in ()).throw(RuntimeError("route failed"))
            )()

        self.assertEqual(audit_session.added, [])
        self.assertEqual(audit_session.commits, 0)

    def test_login_required_records_each_project_in_a_batch_stage_write(self):
        _, project, projects, audit_session = self.configure_auth_runtime()
        second_project = types.SimpleNamespace(
            id=35,
            number="PRJ-2026-035",
            name="第二个项目",
            to_dict=lambda: {
                "id": 35,
                "number": "PRJ-2026-035",
                "name": "第二个项目",
            },
        )
        projects[35] = second_project
        self.request.method = "POST"
        self.request.path = "/api/batch/advance-stage"
        self.request.json = {"project_ids": [34, 35], "stage_key": "bid_opening"}

        response = self.module.login_required(lambda: {"updated": 2})()

        self.assertEqual(response, {"updated": 2})
        self.assertEqual(len(audit_session.added), 2)
        self.assertEqual(
            {row.target_id for row in audit_session.added},
            {"34", "35"},
        )
        self.assertTrue(
            all(row.action_type == "stage.batch_advance" for row in audit_session.added)
        )

    def test_login_required_resolves_direct_attachment_write_to_its_project(self):
        _, _, _, audit_session = self.configure_auth_runtime()
        audit_session.attachments[91] = types.SimpleNamespace(id=91, project_id=34)
        self.request.method = "DELETE"
        self.request.path = "/api/attachments/91"

        response = self.module.login_required(lambda: {"success": True})()

        self.assertEqual(response, {"success": True})
        self.assertEqual(len(audit_session.added), 1)
        self.assertEqual(audit_session.added[0].target_id, "34")
        self.assertEqual(audit_session.added[0].action_type, "attachment.delete")

    def test_audit_capture_failure_never_blocks_the_project_write(self):
        _, project, _, audit_session = self.configure_auth_runtime()
        self.request.method = "PUT"
        self.request.path = "/api/projects/34"
        self.request.json = {"name": "仍然保存"}

        def broken_snapshot():
            raise RuntimeError("snapshot failed")

        project.to_dict = broken_snapshot
        response = self.module.login_required(lambda: {"saved": True})()

        self.assertEqual(response, {"saved": True})
        self.assertEqual(audit_session.added, [])

    def test_audit_after_snapshot_failure_never_changes_a_success_response(self):
        _, project, _, audit_session = self.configure_auth_runtime()
        self.request.method = "PUT"
        self.request.path = "/api/projects/34"
        self.request.json = {"name": "已保存"}

        def update_then_break_snapshot():
            project.name = "已保存"
            project.to_dict = lambda: (_ for _ in ()).throw(
                RuntimeError("after snapshot failed")
            )
            return {"saved": True}

        response = self.module.login_required(update_then_break_snapshot)()

        self.assertEqual(response, {"saved": True})
        self.assertEqual(audit_session.added, [])

    def test_purchaser_board_get_dispatch_is_available_to_non_admin(self):
        self.module.session["is_admin"] = False
        self.request.args = {"purchaser_board_view": "bootstrap"}
        purchaser_module = types.ModuleType("purchaser_classification")
        purchaser_module.read_purchaser_board = Mock(
            return_value={"categories": [], "groups": [], "unit_total": 0}
        )
        previous = sys.modules.get("purchaser_classification")
        sys.modules["purchaser_classification"] = purchaser_module
        try:
            response = self.module.api_get_settings()
        finally:
            if previous is None:
                sys.modules.pop("purchaser_classification", None)
            else:
                sys.modules["purchaser_classification"] = previous

        self.assertEqual(response["unit_total"], 0)
        purchaser_module.read_purchaser_board.assert_called_once_with(
            self.module.DB_PATH,
            self.module.DATA_DIR / "backups",
            False,
            self.module.connect_encrypted,
            self.module.MASTER_KEY,
        )

    def test_enable_writes_exact_current_executable_command(self):
        self.request.json = {"startup_enabled": True}

        response = self.module.api_update_settings()

        expected = f'"{Path(sys.executable).resolve()}" --startup-minimized'
        self.assertEqual(self.registry[RUN_KEY][VALUE_NAME], expected)
        self.assertIs(response["startup_enabled"], True)

    def test_disable_is_idempotent(self):
        self.request.json = {"startup_enabled": False}

        first = self.module.api_update_settings()
        second = self.module.api_update_settings()

        self.assertIs(first["startup_enabled"], False)
        self.assertIs(second["startup_enabled"], False)

    def test_remote_request_cannot_change_registry(self):
        self.request.remote_addr = "192.168.101.8"
        self.request.json = {"startup_enabled": True}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 403)
        self.assertEqual(self.registry, {})
        self.assertIn("error", response)

    def test_non_admin_cannot_change_registry(self):
        self.module.session["is_admin"] = False
        self.request.json = {"startup_enabled": True}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 403)
        self.assertEqual(self.registry, {})
        self.assertIn("error", response)

    def test_non_admin_startup_request_cannot_recover_pending_transaction(self):
        settings_bytes = b'{"login_subtitle":"interrupted"}\n'
        rollback_bytes = b'{"login_subtitle":"before transaction"}\n'
        pending_bytes = b"protected:new-secret"
        marker_bytes = (
            b'{"mode":"set","settings_existed":true,"version":1}\n'
        )
        self.module.SETTINGS_PATH.write_bytes(settings_bytes)
        rollback_path = self.temp_path / "app_settings.json.reminder-rollback"
        rollback_path.write_bytes(rollback_bytes)
        pending_path = self.temp_path / "reminder_credentials.dpapi.tmp"
        pending_path.write_bytes(pending_bytes)
        marker_path = self.temp_path / "reminder_settings_transaction.json"
        marker_path.write_bytes(marker_bytes)
        self.module.session["is_admin"] = False
        self.request.json = {"startup_enabled": True}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 403)
        self.assertIn("error", response)
        self.assertEqual(self.registry, {})
        self.assertEqual(self.module.SETTINGS_PATH.read_bytes(), settings_bytes)
        self.assertEqual(rollback_path.read_bytes(), rollback_bytes)
        self.assertEqual(pending_path.read_bytes(), pending_bytes)
        self.assertEqual(marker_path.read_bytes(), marker_bytes)

    def test_non_boolean_value_is_rejected(self):
        self.request.json = {"startup_enabled": "true"}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertEqual(self.registry, {})
        self.assertIn("error", response)

    def test_non_windows_host_cannot_change_registry(self):
        self.request.json = {"startup_enabled": True}

        with patch.object(os, "name", "posix"):
            response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertEqual(self.registry, {})
        self.assertIn("error", response)

    def test_existing_export_and_subtitle_updates_remain_supported(self):
        expected_folder = self.temp_path / "exports"
        self.request.json = {
            "export_folder": str(expected_folder),
            "login_subtitle": "采购项目管理系统",
        }

        response = self.module.api_update_settings()

        self.assertEqual(response["settings"]["login_subtitle"], "采购项目管理系统")
        self.assertEqual(Path(response["export_folder"]), expected_folder)
        self.assertTrue(expected_folder.is_dir())

    def test_purchaser_action_dispatches_and_logs_without_changing_settings(self):
        settings_before = dict(self.settings)
        self.request.json = {
            "purchaser_board_action": "move_purchaser",
            "purchaser_name": "第一中学",
            "category_id": 7,
        }
        purchaser_module = types.ModuleType("purchaser_classification")
        purchaser_module.execute_purchaser_action = Mock(
            return_value=({"purchaser_name": "第一中学", "category_id": 7}, 200)
        )
        previous = sys.modules.get("purchaser_classification")
        sys.modules["purchaser_classification"] = purchaser_module
        try:
            response, status = self.module.api_update_settings()
        finally:
            if previous is None:
                sys.modules.pop("purchaser_classification", None)
            else:
                sys.modules["purchaser_classification"] = previous

        self.assertEqual(status, 200)
        self.assertEqual(response["category_id"], 7)
        self.assertEqual(self.settings, settings_before)
        purchaser_module.execute_purchaser_action.assert_called_once_with(
            self.module.DB_PATH,
            self.module.DATA_DIR / "backups",
            "move_purchaser",
            self.request.json,
            True,
            "",
            self.module.connect_encrypted,
            self.module.MASTER_KEY,
        )
        self.module.log_operation.assert_called_once()

    def test_non_admin_purchaser_action_is_delegated_as_non_admin(self):
        self.module.session["is_admin"] = False
        self.request.json = {
            "purchaser_board_action": "move_purchaser",
            "purchaser_name": "第一中学",
            "category_id": 7,
        }
        purchaser_module = types.ModuleType("purchaser_classification")
        purchaser_module.execute_purchaser_action = Mock(
            return_value=({"error": "仅管理员可执行此操作"}, 403)
        )
        previous = sys.modules.get("purchaser_classification")
        sys.modules["purchaser_classification"] = purchaser_module
        try:
            response, status = self.module.api_update_settings()
        finally:
            if previous is None:
                sys.modules.pop("purchaser_classification", None)
            else:
                sys.modules["purchaser_classification"] = previous

        self.assertEqual(status, 403)
        self.assertIn("error", response)
        purchaser_module.execute_purchaser_action.assert_called_once_with(
            self.module.DB_PATH,
            self.module.DATA_DIR / "backups",
            "move_purchaser",
            self.request.json,
            False,
            "",
            self.module.connect_encrypted,
            self.module.MASTER_KEY,
        )
        self.module.log_operation.assert_not_called()


if __name__ == "__main__":
    unittest.main()
