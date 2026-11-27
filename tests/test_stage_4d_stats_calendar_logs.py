"""Stage 4D tests: Shadow-mode bytecode parity & dual-track fallback for stats, calendar, logs, system_info, health, and DB helpers."""
from __future__ import annotations

import calendar as cal_mod
from datetime import date, datetime
import json
import marshal
import os
from pathlib import Path
import socket
import sqlite3
import tempfile
import types
import unittest
from unittest.mock import patch

from src.backend_patches import (
    data_safety,
    runtime_context,
    stats_calendar_log_routes,
)
from tools import build_candidate, compile_module_patches


BASELINE_EXE = Path(os.environ.get("PM_TEST_LEGACY_BASELINE_EXE", ""))


def _load_core_4d_code_objects() -> dict[str, types.CodeType]:
    if not BASELINE_EXE.is_file():
        return {}
    reader = build_candidate.CArchiveReader(BASELINE_EXE)
    pyz_raw = reader.extract("PYZ.pyz")
    toc, _ = compile_module_patches._read_pyz(pyz_raw)
    app_root = marshal.loads(compile_module_patches._pyz_entry(pyz_raw, toc, "app"))
    code_map: dict[str, types.CodeType] = {}
    for const in app_root.co_consts:
        if isinstance(const, types.CodeType):
            code_map[const.co_name] = const
    return code_map


CORE_CODES = _load_core_4d_code_objects()


class FakeMultiDict(dict):
    def get(self, key: str, default=None, type=None):  # noqa: A002
        val = super().get(key, default)
        if val is None or type is None:
            return val
        try:
            return type(val)
        except (TypeError, ValueError):
            return default


class FakeStage:
    def __init__(
        self,
        stage_key: str,
        planned_datetime: datetime | None = None,
        *,
        completed: bool = False,
        skipped: bool = False,
    ) -> None:
        self.stage_key = stage_key
        self.planned_datetime = planned_datetime
        self.completed = completed
        self.skipped = skipped

    def __repr__(self) -> str:
        return f"<FakeStage {self.stage_key}>"


class FakeProject:
    stages = "stages_rel"

    class _YearCol:
        def isnot(self, _v):
            return "isnot"

        def desc(self):
            return "desc"

    year = _YearCol()

    def __init__(
        self,
        pid: int,
        name: str,
        number: str,
        *,
        progress: int = 50,
        current_stage_key: str = "announcement",
        is_terminated: bool = False,
        terminated_type: str = "",
        year_val: int = 2026,
        stages_list: list[FakeStage] | None = None,
    ) -> None:
        self.id = pid
        self.name = name
        self.number = number
        self.progress = progress
        self.current_stage_key = current_stage_key
        self.is_terminated = is_terminated
        self.terminated_type = terminated_type
        self.year_val = year_val
        self.stages = stages_list or []


def _build_shadow_4d_env(root_dir: Path, db_path: Path):
    data_dir = root_dir / "data"
    upload_dir = root_dir / "uploads"
    export_dir = root_dir / "exports"
    backup_dir = root_dir / "backups"
    for d in (data_dir, upload_dir, export_dir, backup_dir):
        d.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS operation_logs ("
        "id INTEGER PRIMARY KEY AUTOINCREMENT, "
        "user_id INTEGER, "
        "username TEXT, "
        "action_type TEXT, "
        "target_type TEXT, "
        "target_id INTEGER, "
        "description TEXT, "
        "detail_json TEXT, "
        "ip_address TEXT)"
    )
    conn.commit()

    projects = [
        FakeProject(
            1,
            "信息化建设项目",
            "PRJ-2026-001",
            progress=40,
            current_stage_key="announcement",
            is_terminated=False,
            year_val=2026,
            stages_list=[
                FakeStage("announcement", datetime(2026, 11, 18, 9, 30), completed=False, skipped=False),
                FakeStage("bid_opening", datetime(2026, 11, 10, 14, 30), completed=False, skipped=False),
            ],
        ),
        FakeProject(
            2,
            "已归档设备采购",
            "PRJ-2025-009",
            progress=100,
            current_stage_key="archived",
            is_terminated=False,
            year_val=2025,
            stages_list=[],
        ),
        FakeProject(
            3,
            "流标项目A",
            "PRJ-2026-003",
            progress=20,
            current_stage_key="registration",
            is_terminated=True,
            terminated_type="liubiao",
            year_val=2026,
        ),
        FakeProject(
            4,
            "废标项目B",
            "PRJ-2026-004",
            progress=60,
            current_stage_key="bid_opening",
            is_terminated=True,
            terminated_type="feibiao",
            year_val=2026,
        ),
    ]

    class FakeProjectQuery:
        def __init__(self, items: list[FakeProject]) -> None:
            self._items = list(items)

        def options(self, *_args) -> FakeProjectQuery:
            return self

        def filter_by(self, **kwargs) -> FakeProjectQuery:
            return FakeProjectQuery(
                [p for p in self._items if all(getattr(p, k, None) == v for k, v in kwargs.items())]
            )

        def all(self) -> list[FakeProject]:
            return list(self._items)

    class _ProjQueryDesc:
        def __get__(self, obj, owner):
            return FakeProjectQuery(projects)

    FakeProject.query = _ProjQueryDesc()

    logs: list[object] = []

    class FakeLogCol:
        def desc(self):
            return "desc"

    class FakeOperationLog:
        created_at = FakeLogCol()

        def __init__(self, **kwargs) -> None:
            self.id = kwargs.get("id")
            self.user_id = kwargs.get("user_id", 0)
            self.username = kwargs.get("username", "system")
            self.action_type = kwargs.get("action_type", "")
            self.target_type = kwargs.get("target_type", "")
            self.target_id = kwargs.get("target_id", 0)
            self.description = kwargs.get("description", "")
            self.detail_json = kwargs.get("detail_json", "")
            self.ip_address = kwargs.get("ip_address", "")
            self.created_at = kwargs.get("created_at", datetime(2026, 11, 16, 10, 0, 0))

    class FakePagination:
        def __init__(self, items, total, pages) -> None:
            self.items = items
            self.total = total
            self.pages = pages

    class FakeLogQuery:
        def __init__(self, items) -> None:
            self._items = list(items)

        def order_by(self, *_args) -> FakeLogQuery:
            return FakeLogQuery(list(reversed(self._items)))

        def filter_by(self, **kwargs) -> FakeLogQuery:
            return FakeLogQuery(
                [it for it in self._items if all(getattr(it, k, None) == v for k, v in kwargs.items())]
            )

        def paginate(self, *, page: int = 1, per_page: int = 50, error_out: bool = False) -> FakePagination:
            start = (page - 1) * per_page
            sliced = self._items[start : start + per_page]
            pages = max(1, (len(self._items) + per_page - 1) // per_page)
            return FakePagination(sliced, len(self._items), pages)

    class _LogQueryDesc:
        def __get__(self, obj, owner):
            return FakeLogQuery(logs)

    FakeOperationLog.query = _LogQueryDesc()

    class FakeSession:
        def add(self, obj: FakeOperationLog) -> None:
            obj.id = len(logs) + 1
            logs.append(obj)

        def commit(self) -> None:
            conn.execute("DELETE FROM operation_logs")
            for lg in logs:
                conn.execute(
                    "INSERT INTO operation_logs ("
                    "id, user_id, username, action_type, target_type, target_id, description, detail_json, ip_address"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        lg.id,
                        lg.user_id,
                        lg.username,
                        lg.action_type,
                        lg.target_type,
                        lg.target_id,
                        lg.description,
                        lg.detail_json,
                        lg.ip_address,
                    ),
                )
            conn.commit()

        def query(self, _col):
            class _YearQ:
                def filter(self, *_a):
                    return self

                def distinct(self):
                    return self

                def order_by(self, *_a):
                    return self

                def all(self):
                    years = sorted({p.year_val for p in projects}, reverse=True)
                    return [(y,) for y in years]

            return _YearQ()

    class FakeDB:
        session = FakeSession()

    class FakeApp:
        config = {"LAN_IP": "192.168.1.100", "LAN_PORT": "5001", "IS_DESKTOP": True}

    class FakeRequest:
        def __init__(self, args: dict | None = None) -> None:
            self.args = FakeMultiDict(args or {})
            self.host_url = "http://127.0.0.1:5001/"
            self.host = "127.0.0.1:5001"
            self.remote_addr = "127.0.0.1"

    fixed_today = date(2026, 11, 16)

    class FixedDate(date):
        @classmethod
        def today(cls):
            return fixed_today

    stages_def = [
        {"key": "announcement", "name": "采购公告", "icon": "📢", "group": "执行阶段"},
        {"key": "registration", "name": "供应商报名", "icon": "📝", "group": "执行阶段"},
        {"key": "bid_opening", "name": "开标评标", "icon": "⚖️", "group": "执行阶段"},
        {"key": "archived", "name": "项目归档", "icon": "📦", "group": "归档阶段"},
    ]

    env = {
        "app": FakeApp(),
        "db": FakeDB(),
        "Project": FakeProject,
        "OperationLog": FakeOperationLog,
        "joinedload": lambda x: x,
        "STAGES": stages_def,
        "request": FakeRequest(),
        "session": {"user_id": 1, "username": "admin", "is_admin": True},
        "has_request_context": lambda: True,
        "jsonify": lambda payload: payload,
        "date": FixedDate,
        "cal_mod": cal_mod,
        "socket": socket,
        "sqlite3": sqlite3,
        "json": json,
        "os": os,
        "Path": Path,
        "BASE_DIR": root_dir,
        "DATA_DIR": data_dir,
        "DB_PATH": db_path,
        "UPLOAD_FOLDER": upload_dir,
        "SETTINGS_PATH": data_dir / "settings.json",
        "RECOVERY_KEY_PATH": None,
        "DATA_ENCRYPTION_ENABLED": True,
        "MAX_FILE_SIZE": 1024 * 1024 * 1024,
        "ALLOWED_EXTENSIONS": {"pdf", "docx", "xlsx"},
        "get_backup_dir": lambda: backup_dir,
        "get_export_dir": lambda: export_dir,
        "get_desktop_dir": lambda: root_dir / "Desktop",
        "current_license_status": lambda update_state=False: {
            "status": "valid",
            "mode": "commercial",
            "message": "已激活",
            "device_code": "DEV-001",
            "organization": "测试招标公司",
            "expires_at": "2099-12-31",
            "license_id": "LIC-001",
        },
    }
    return env, conn


class Stage4DStatsCalendarLogsParityTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run_core(self, env: dict, func_name: str, *args, **kwargs):
        import builtins
        env.setdefault("__builtins__", builtins.__dict__)
        fn = types.FunctionType(CORE_CODES[func_name], env)
        return fn(*args, **kwargs)

    @unittest.skipUnless(CORE_CODES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_stats_calendar_and_export_years(self) -> None:
        env_core, conn_core = _build_shadow_4d_env(self.tmp_path / "core_s", self.tmp_path / "core_s.db")
        env_open, conn_open = _build_shadow_4d_env(self.tmp_path / "open_s", self.tmp_path / "open_s.db")
        try:
            self.assertEqual(
                self._run_core(env_core, "api_stats"),
                stats_calendar_log_routes.api_stats(env_open),
            )
            self.assertEqual(
                self._run_core(env_core, "get_stats_data"),
                stats_calendar_log_routes.get_stats_data(env_open),
            )
            self.assertEqual(
                self._run_core(env_core, "api_export_years"),
                stats_calendar_log_routes.api_export_years(env_open),
            )

            env_core["request"].args = FakeMultiDict({"year": "2026", "month": "11"})
            env_open["request"].args = FakeMultiDict({"year": "2026", "month": "11"})
            self.assertEqual(
                self._run_core(env_core, "api_calendar"),
                stats_calendar_log_routes.api_calendar(env_open),
            )
        finally:
            conn_core.close()
            conn_open.close()

    @unittest.skipUnless(CORE_CODES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_operation_logs_system_info_and_db_helpers(self) -> None:
        env_core, conn_core = _build_shadow_4d_env(self.tmp_path / "core_l", self.tmp_path / "core_l.db")
        env_open, conn_open = _build_shadow_4d_env(self.tmp_path / "open_l", self.tmp_path / "open_l.db")
        try:
            self._run_core(env_core, "log_operation", "create_project", "project", 1, "新建项目", '{"ok":true}')
            stats_calendar_log_routes.log_operation(
                env_open, "create_project", "project", 1, "新建项目", '{"ok":true}'
            )

            self.assertEqual(
                self._run_core(env_core, "api_logs"),
                stats_calendar_log_routes.api_logs(env_open),
            )
            self.assertEqual(
                data_safety.database_fingerprint(conn_core),
                data_safety.database_fingerprint(conn_open),
            )

            # System info & health parity (baseline bytecode uses v5.8.40 before version bump)
            info_core = self._run_core(env_core, "api_system_info")
            info_open = stats_calendar_log_routes.api_system_info(env_open, version_override="v5.8.40")
            for key in ("app_name", "version", "is_desktop", "lan_ip", "lan_port", "lan_url", "max_file_size_mb", "license"):
                self.assertEqual(info_core[key], info_open[key])

            self.assertEqual(
                self._run_core(env_core, "health"),
                stats_calendar_log_routes.health(env_open, version_override="v5.8.40"),
            )

            # backup_database_on_start parity
            bak_core = self._run_core(env_core, "backup_database_on_start", 2)
            bak_open = stats_calendar_log_routes.backup_database_on_start(env_open, 2)
            self.assertIsNotNone(bak_core)
            self.assertIsNotNone(bak_open)
            self.assertEqual(bak_core.name, bak_open.name)
        finally:
            conn_core.close()
            conn_open.close()

    def test_dual_track_fallback_switch_for_stage_4d(self) -> None:
        env, conn = _build_shadow_4d_env(self.tmp_path / "dual_4d", self.tmp_path / "dual_4d.db")
        try:
            class FakeFlaskApp:
                def __init__(self) -> None:
                    self.view_functions = {
                        "health": lambda: {"ok": True, "version": "legacy-v5"}
                    }
                    self.extensions = {}
                    self.config = {"IS_DESKTOP": True}

            fake_app = FakeFlaskApp()
            env["app"] = fake_app
            env["login_required"] = lambda f: f
            ctx = runtime_context.register_runtime_context(env, app=fake_app, db=env["db"])
            info = stats_calendar_log_routes.register(ctx, fake_app)
            self.assertEqual(info["signature"], "stats-calendar-log-routes-v1")
            self.assertIn("health", info["installed_views"])

            pkg_ver = "v" + json.loads(
                (Path(__file__).resolve().parents[1] / "package.json").read_text(encoding="utf-8")
            )["version"]
            self.assertEqual(fake_app.view_functions["health"](), {"ok": True, "version": pkg_ver})

            with patch.dict(os.environ, {"PM_USE_LEGACY_CORE_ROUTES": "health"}):
                self.assertEqual(
                    fake_app.view_functions["health"](),
                    {"ok": True, "version": "legacy-v5"},
                )
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
