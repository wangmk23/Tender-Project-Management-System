"""Statistics, calendar, operation logs, system info, health, and DB/desktop helpers (Stage 4D).

stats-calendar-log-routes-v1
"""
from __future__ import annotations

import calendar as _default_cal_mod
from collections.abc import Mapping
from datetime import date as _default_date
import json
import os
from pathlib import Path
import re
import socket
import sqlite3
import sys
from typing import Any

try:
    import runtime_context
except ModuleNotFoundError:  # pragma: no cover - source tree fallback
    from src.backend_patches import runtime_context


def _resolve_default_backend_version() -> str:
    """Resolve current backend version from package.json with frozen fallback."""
    if not getattr(sys, "frozen", False):
        try:
            pkg_path = Path(__file__).resolve().parents[2] / "package.json"
            if pkg_path.is_file():
                ver = json.loads(pkg_path.read_text(encoding="utf-8")).get("version", "")
                if isinstance(ver, str) and re.fullmatch(r"\d+\.\d+\.\d+", ver):
                    return f"v{ver}"
        except (OSError, ValueError, TypeError):
            pass
    return "v5.10.6"


STATS_CALENDAR_LOG_ROUTES_SIGNATURE = "stats-calendar-log-routes-v1"
LEGACY_ROUTE_ENV = "PM_USE_LEGACY_CORE_ROUTES"
DEFAULT_BACKEND_VERSION = _resolve_default_backend_version()

STAGE_4D_HELPER_NAMES: tuple[str, ...] = (
    "get_stats_data",
    "project_has_overdue_func",
    "log_operation",
    "_drive_letter",
    "get_desktop_dir",
    "load_app_settings",
    "_configure_sqlite",
    "backup_database_on_start",
)

STAGE_4D_ROUTE_ENDPOINTS: tuple[str, ...] = (
    "api_stats",
    "api_calendar",
    "api_export_years",
    "api_logs",
    "api_system_info",
    "health",
    "api_open_export_folder",
)

STAGE_4D_MANAGED_SYMBOLS: tuple[str, ...] = (
    *STAGE_4D_HELPER_NAMES,
    *STAGE_4D_ROUTE_ENDPOINTS,
)


def _ctx(explicit: Any = None, *, depth: int = 2) -> runtime_context.AppContextRegistry:
    if explicit is None:
        return runtime_context.current_context(depth=depth)
    return runtime_context.get_runtime_context(explicit)


def _is_ctx_like(value: Any) -> bool:
    return isinstance(value, Mapping) or hasattr(value, "signature")


def should_use_legacy_route(route_name: str, env: Mapping[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    raw = str(source.get(LEGACY_ROUTE_ENV) or "").strip()
    if not raw:
        return False
    tokens = {item.strip() for item in raw.split(",") if item.strip()}
    if {"1", "true", "TRUE", "all", "ALL", "*"} & tokens:
        return True
    return route_name in tokens


# ---------------------------------------------------------------------------
# 1. Statistics & Calendar Routes and Helpers
# ---------------------------------------------------------------------------

def _exclude_deleted_projects(ctx: Any, projects: list[Any]) -> list[Any]:
    if not projects:
        return list(projects)
    db = ctx.get("db")
    if db is None:
        return list(projects)
    try:
        try:
            from . import recycle_bin
        except ImportError:
            import recycle_bin
        return recycle_bin.filter_active_projects(db, projects)
    except Exception:
        return list(projects)


def api_stats(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    Project = ctx.get("Project")
    joinedload = ctx.get("joinedload")
    STAGES = ctx.get("STAGES", [])
    jsonify = ctx.get("jsonify", lambda v: v)

    q = Project.query
    if callable(joinedload) and hasattr(q, "options") and hasattr(Project, "stages"):
        q = q.options(joinedload(Project.stages))
    projects = _exclude_deleted_projects(ctx, q.filter_by(is_terminated=False).all())
    total = len(projects)
    completed = sum(1 for p in projects if p.progress >= 100)
    in_progress = total - completed

    terminated_projects = _exclude_deleted_projects(ctx, Project.query.filter_by(is_terminated=True).all())
    liubiao = sum(1 for p in terminated_projects if (p.terminated_type or "") == "liubiao")
    feibiao = sum(1 for p in terminated_projects if (p.terminated_type or "") == "feibiao")

    stage_counts: list[dict[str, Any]] = []
    for sd in STAGES:
        count = 0
        for p in projects:
            if p.progress < 100 and p.current_stage_key == sd["key"]:
                count += 1
        stage_counts.append(
            {
                "key": sd["key"],
                "name": sd["name"],
                "icon": sd["icon"],
                "group": sd["group"],
                "count": count,
            }
        )
    return jsonify(
        {
            "total": total,
            "completed": completed,
            "in_progress": in_progress,
            "liubiao": liubiao,
            "feibiao": feibiao,
            "stage_counts": stage_counts,
        }
    )


def get_stats_data(ctx: Any = None) -> dict[str, Any]:
    """获取统计数据（复用 api_stats 的逻辑）"""
    ctx = _ctx(ctx, depth=2)
    Project = ctx.get("Project")
    joinedload = ctx.get("joinedload")
    STAGES = ctx.get("STAGES", [])

    q = Project.query
    if callable(joinedload) and hasattr(q, "options") and hasattr(Project, "stages"):
        q = q.options(joinedload(Project.stages))
    projects = _exclude_deleted_projects(ctx, q.filter_by(is_terminated=False).all())
    total = len(projects)
    completed = sum(1 for p in projects if p.progress >= 100)
    in_progress = total - completed

    terminated_projects = _exclude_deleted_projects(ctx, Project.query.filter_by(is_terminated=True).all())
    liubiao = sum(1 for p in terminated_projects if (p.terminated_type or "") == "liubiao")
    feibiao = sum(1 for p in terminated_projects if (p.terminated_type or "") == "feibiao")

    stage_counts: list[dict[str, Any]] = []
    for sd in STAGES:
        count = 0
        for p in projects:
            if p.progress < 100 and p.current_stage_key == sd["key"]:
                count += 1
        stage_counts.append(
            {
                "key": sd["key"],
                "name": sd["name"],
                "icon": sd["icon"],
                "count": count,
            }
        )
    return {
        "total": total,
        "completed": completed,
        "in_progress": in_progress,
        "liubiao": liubiao,
        "feibiao": feibiao,
        "stage_counts": stage_counts,
    }


def project_has_overdue_func(ctx_or_p: Any, p: Any = None) -> bool:
    """辅助函数：判断项目是否有逾期"""
    if p is None and not _is_ctx_like(ctx_or_p):
        p = ctx_or_p
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_p, depth=2)
    dt_date = ctx.get("date", _default_date)
    today = dt_date.today()
    for s in p.stages or []:
        if s.completed or s.skipped or not s.planned_datetime:
            continue
        if s.planned_datetime.date() < today:
            return True
    return False


def api_calendar(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    request = ctx.get("request")
    date_cls = ctx.get("date", _default_date)
    cal_mod = ctx.get("cal_mod", _default_cal_mod)
    jsonify = ctx.get("jsonify", lambda v: v)
    Project = ctx.get("Project")
    joinedload = ctx.get("joinedload")
    STAGES = ctx.get("STAGES", [])

    year = request.args.get("year", date_cls.today().year, type=int)
    month = request.args.get("month", date_cls.today().month, type=int)
    try:
        month_days = cal_mod.monthrange(year, month)[1]
        first_weekday = cal_mod.monthrange(year, month)[0]
    except Exception:
        return jsonify({"cells": [], "year": year, "month": month})

    events_by_day: dict[str, list[dict[str, Any]]] = {}
    q = Project.query
    if callable(joinedload) and hasattr(q, "options") and hasattr(Project, "stages"):
        q = q.options(joinedload(Project.stages))
    projects = _exclude_deleted_projects(ctx, q.filter_by(is_terminated=False).all())

    for p in projects:
        for s in p.stages:
            if s.planned_datetime and s.planned_datetime.year == year and s.planned_datetime.month == month:
                sk = s.stage_key
                icon = "📌"
                for sdef in STAGES:
                    if sdef["key"] == sk:
                        icon = sdef["icon"]
                        break
                day_str = s.planned_datetime.strftime("%Y-%m-%d")
                if day_str not in events_by_day:
                    events_by_day[day_str] = []
                events_by_day[day_str].append(
                    {
                        "project_name": p.name,
                        "project_number": p.number,
                        "project_id": p.id,
                        "stage_key": sk,
                        "icon": icon,
                        "planned_time": s.planned_datetime.strftime("%H:%M") if s.planned_datetime else None,
                        "planned_at": s.planned_datetime.isoformat() if s.planned_datetime else None,
                        "completed": s.completed,
                        "skipped": s.skipped,
                        "stage_name": next((sd["name"] for sd in STAGES if sd["key"] == sk), sk),
                    }
                )

    cells: list[dict[str, Any]] = []
    first_weekday_offset = (first_weekday + 1) % 7
    for _ in range(first_weekday_offset):
        cells.append({"empty": True})
    for d in range(1, month_days + 1):
        ds = date_cls(year, month, d).isoformat()
        cells.append(
            {
                "empty": False,
                "day": d,
                "date_str": ds,
                "events": events_by_day.get(ds, []),
            }
        )

    month_names = [
        "一月",
        "二月",
        "三月",
        "四月",
        "五月",
        "六月",
        "七月",
        "八月",
        "九月",
        "十月",
        "十一月",
        "十二月",
    ]
    return jsonify(
        {
            "cells": cells,
            "year": year,
            "month": month,
            "month_name": month_names[month - 1],
            "weekday_names": ["日", "一", "二", "三", "四", "五", "六"],
        }
    )


def api_export_years(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    db = ctx.get("db")
    Project = ctx.get("Project")
    jsonify = ctx.get("jsonify", lambda v: v)
    q = db.session.query(Project.year).filter(Project.year.isnot(None))
    try:
        try:
            from . import recycle_bin
        except ImportError:
            import recycle_bin
        del_pids = recycle_bin.deleted_ids(db, "project")
        if del_pids:
            q = q.filter(~Project.id.in_(del_pids))
    except Exception:
        pass
    rows = q.distinct().order_by(Project.year.desc()).all()
    years = [y for (y,) in rows if y]
    return jsonify({"years": years})


# ---------------------------------------------------------------------------
# 2. Operation Logs & System Info / Health Routes
# ---------------------------------------------------------------------------

def api_logs(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    request = ctx.get("request")
    OperationLog = ctx.get("OperationLog")
    jsonify = ctx.get("jsonify", lambda v: v)

    page = request.args.get("page", 1, type=int)
    per_page = min(request.args.get("per_page", 50, type=int), 200)
    action_filter = request.args.get("action", "")

    query = OperationLog.query.order_by(OperationLog.created_at.desc())
    if action_filter:
        query = query.filter_by(action_type=action_filter)
    pagination = query.paginate(page=page, per_page=per_page, error_out=False)
    return jsonify(
        {
            "items": [
                {
                    "id": log.id,
                    "username": log.username,
                    "action_type": log.action_type,
                    "target_type": log.target_type,
                    "target_id": log.target_id,
                    "description": log.description,
                    "created_at": log.created_at.isoformat() if log.created_at else "",
                    "ip_address": log.ip_address,
                }
                for log in pagination.items
            ],
            "total": pagination.total,
            "pages": pagination.pages,
            "current_page": page,
        }
    )


def log_operation(
    ctx_or_action: Any,
    action_or_target_type: str = "",
    target_type_or_id: Any = 0,
    target_id_or_desc: Any = "",
    desc_or_detail: str = "",
    detail_json: str = "",
) -> None:
    """记录操作日志"""
    if not _is_ctx_like(ctx_or_action):
        action_type = str(ctx_or_action)
        target_type = str(action_or_target_type or "")
        target_id = int(target_type_or_id or 0)
        description = str(target_id_or_desc or "")
        detail = str(desc_or_detail or "")
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_action, depth=2)
        action_type = str(action_or_target_type)
        target_type = str(target_type_or_id or "")
        target_id = int(target_id_or_desc or 0)
        description = str(desc_or_detail or "")
        detail = str(detail_json or "")
    try:
        OperationLog = ctx.get("OperationLog")
        has_req = ctx.get("has_request_context", lambda: False)
        session = ctx.get("session", {})
        request = ctx.get("request")
        db = ctx.get("db")
        in_req = bool(has_req()) if callable(has_req) else False
        log = OperationLog(
            user_id=session.get("user_id", 0) if in_req else 0,
            username=session.get("username", "system") if in_req else "system",
            action_type=action_type,
            target_type=target_type or "",
            target_id=target_id,
            description=description,
            detail_json=detail or "",
            ip_address=(request.remote_addr or "") if in_req and request is not None else "",
        )
        db.session.add(log)
        db.session.commit()
    except Exception as e:
        print(f"Log error: {e}")


def api_system_info(ctx: Any = None, *, version_override: str | None = None):
    ctx = _ctx(ctx, depth=2)
    request = ctx.get("request")
    app = ctx.get("app")
    session = ctx.get("session", {})
    jsonify = ctx.get("jsonify", lambda v: v)
    version = version_override or ctx.get("BACKEND_VERSION") or DEFAULT_BACKEND_VERSION

    host = request.host_url.rstrip("/")
    lan_ip = app.config.get("LAN_IP")
    if not lan_ip:
        try:
            with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
                s.connect(("8.8.8.8", 80))
                lan_ip = s.getsockname()[0]
        except OSError:
            lan_ip = request.host.split(":", 1)[0]

    lan_port = app.config.get("LAN_PORT")
    if not lan_port:
        host_part = request.host.rsplit(":", 1)
        lan_port = host_part[1] if len(host_part) == 2 and host_part[1].isdigit() else "5001"
    lan_url = app.config.get("LAN_URL") or f"http://{lan_ip}:{lan_port}"

    try:
        get_backup_dir = ctx.get("get_backup_dir")
        backup_dir = Path(get_backup_dir())
        backup_files = sorted(
            backup_dir.glob("项目管理系统备份_*.pmbak"),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
    except RuntimeError:
        backup_dir = Path("")
        backup_files = []

    max_file_size = ctx.get("MAX_FILE_SIZE", 1024 * 1024 * 1024)
    public_info: dict[str, Any] = {
        "app_name": "项目管理系统",
        "version": version,
        "is_desktop": bool(app.config.get("IS_DESKTOP")),
        "current_url": host,
        "lan_ip": lan_ip,
        "lan_port": str(lan_port),
        "lan_url": lan_url,
        "max_file_size_mb": int(max_file_size / 1024 / 1024),
    }
    if not session.get("is_admin"):
        return jsonify(public_info)

    current_license_status = ctx.get("current_license_status")
    license_info = current_license_status(update_state=False) if callable(current_license_status) else {}
    data_enc = bool(ctx.get("DATA_ENCRYPTION_ENABLED"))
    recovery_key_path = ctx.get("RECOVERY_KEY_PATH")
    data_dir = Path(ctx.get("DATA_DIR", ""))
    get_export_dir = ctx.get("get_export_dir")

    public_info.update(
        {
            "base_dir": str(ctx.get("BASE_DIR", "")),
            "data_dir": str(data_dir),
            "database_path": str(ctx.get("DB_PATH", "")),
            "upload_folder": str(ctx.get("UPLOAD_FOLDER", "")),
            "backup_folder": str(backup_dir),
            "latest_backup": str(backup_files[0]) if backup_files else "",
            "export_folder": str(get_export_dir()) if callable(get_export_dir) else "",
            "data_encryption": data_enc,
            "database_encryption": "SQLCipher AES-256" if data_enc else "未启用",
            "attachment_encryption": "AES-256-GCM" if data_enc else "未启用",
            "backup_schedule": "每天 13:00，最多保留 3 份",
            "recovery_key_ready": bool(recovery_key_path or (data_dir / "data_key.dpapi").exists()),
            "allowed_extensions": sorted(ctx.get("ALLOWED_EXTENSIONS", set())),
            "license": {
                key: license_info.get(key)
                for key in (
                    "status",
                    "mode",
                    "message",
                    "device_code",
                    "organization",
                    "expires_at",
                    "license_id",
                )
            },
        }
    )
    return jsonify(public_info)


def health(ctx: Any = None, *, version_override: str | None = None):
    ctx = _ctx(ctx, depth=2)
    jsonify = ctx.get("jsonify", lambda v: v)
    version = version_override or ctx.get("BACKEND_VERSION") or DEFAULT_BACKEND_VERSION
    return jsonify({"ok": True, "version": version})


def api_open_export_folder(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    get_export_dir = ctx.get("get_export_dir")
    jsonify = ctx.get("jsonify", lambda v: v)
    folder = get_export_dir()
    try:
        if os.name == "nt":
            os.startfile(str(folder))
        return jsonify({"message": "已打开导出目录", "folder": str(folder)})
    except Exception as e:
        return jsonify({"error": f"打开导出目录失败：{e}", "folder": str(folder)}), 500


# ---------------------------------------------------------------------------
# 3. Desktop Path, Settings & SQLite Startup Helpers
# ---------------------------------------------------------------------------

def _drive_letter(ctx_or_path: Any, path: str | Path | None = None) -> str:
    if path is None and not _is_ctx_like(ctx_or_path):
        path = ctx_or_path
    return Path(path).resolve().drive.upper()


def get_desktop_dir(ctx: Any = None) -> Path:
    """获取当前 Windows 用户桌面目录；失败时回退到用户目录下的 Desktop。"""
    if os.name == "nt":
        try:
            import ctypes
            from ctypes import wintypes

            class GUID(ctypes.Structure):
                _fields_ = [
                    ("Data1", wintypes.DWORD),
                    ("Data2", wintypes.WORD),
                    ("Data3", wintypes.WORD),
                    ("Data4", ctypes.c_ubyte * 8),
                ]

            folder_id_desktop = GUID(
                3032468538,
                56108,
                16972,
                (ctypes.c_ubyte * 8)(176, 41, 127, 233, 154, 135, 198, 65),
            )
            path_ptr = wintypes.LPWSTR()
            ctypes.windll.shell32.SHGetKnownFolderPath(
                ctypes.byref(folder_id_desktop), 0, None, ctypes.byref(path_ptr)
            )
            try:
                return Path(path_ptr.value)
            finally:
                ctypes.windll.ole32.CoTaskMemFree(path_ptr)
        except Exception:
            pass
    desktop = Path.home() / "Desktop"
    if desktop.exists():
        return desktop
    return Path.home()


def load_app_settings(ctx: Any = None) -> dict[str, Any]:
    ctx = _ctx(ctx, depth=2)
    desk_fn = ctx.get("get_desktop_dir") or get_desktop_dir
    settings_path = ctx.get("SETTINGS_PATH")
    defaults: dict[str, Any] = {
        "export_folder": str(Path(desk_fn()) / "项目管理系统导出"),
        "login_subtitle": "招标项目管理",
        "backup_time": "13:00",
        "backup_retention": 3,
        "backup_folder": "",
        "last_backup_date": "",
    }
    if settings_path is not None and Path(settings_path).exists():
        try:
            data = json.loads(Path(settings_path).read_text(encoding="utf-8"))
            if isinstance(data, dict):
                defaults.update({k: v for k, v in data.items() if v not in (None, "")})
        except Exception as e:
            print(f"读取设置失败: {e}")
    return defaults


def _configure_sqlite(
    ctx_or_conn: Any,
    conn_or_record: Any = None,
    connection_record: Any = None,
) -> None:
    if connection_record is None and not _is_ctx_like(ctx_or_conn):
        dbapi_connection = ctx_or_conn
    else:
        dbapi_connection = conn_or_record
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.execute("PRAGMA busy_timeout=30000")
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.close()


def backup_database_on_start(ctx_or_retention: Any = None, retention: int = 3) -> Path | None:
    """Create one consistent SQLite backup per day and keep recent copies."""
    if not _is_ctx_like(ctx_or_retention):
        if isinstance(ctx_or_retention, int):
            retention = ctx_or_retention
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_retention, depth=2)
    db_path = Path(ctx.get("DB_PATH"))
    if not db_path.exists() or db_path.stat().st_size == 0:
        return None
    data_dir = Path(ctx.get("DATA_DIR"))
    date_cls = ctx.get("date", _default_date)
    backup_dir = data_dir / "backups"
    backup_dir.mkdir(exist_ok=True)
    target = backup_dir / f"bidding_{date_cls.today().isoformat()}.db"
    if not target.exists():
        source_conn = sqlite3.connect(str(db_path), timeout=30)
        target_conn = sqlite3.connect(str(target), timeout=30)
        try:
            source_conn.backup(target_conn)
        finally:
            target_conn.close()
            source_conn.close()
    backups = sorted(
        backup_dir.glob("bidding_*.db"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    for old_backup in backups[max(1, retention) :]:
        try:
            old_backup.unlink()
        except OSError:
            continue
    return target


# ---------------------------------------------------------------------------
# 4. Dual-Track Runtime Registration
# ---------------------------------------------------------------------------

def register(host_or_ctx: Any, app: Any = None) -> dict[str, Any]:
    """Install Stage 4D open-source stats, calendar, logs, system_info, health, and DB helpers."""
    ctx = _ctx(host_or_ctx, depth=2)
    flask_app = app or ctx.get("app")
    host = ctx.host_module

    legacy_helpers: dict[str, Any] = {}
    legacy_views: dict[str, Any] = {}

    if host is not None:
        for name in STAGE_4D_HELPER_NAMES:
            existing = ctx.get(name)
            if existing is not None:
                legacy_helpers[name] = existing

    if flask_app is not None and hasattr(flask_app, "view_functions"):
        for endpoint in STAGE_4D_ROUTE_ENDPOINTS:
            if endpoint in flask_app.view_functions:
                legacy_views[endpoint] = flask_app.view_functions[endpoint]

    helper_map = {
        "get_stats_data": lambda: get_stats_data(ctx),
        "project_has_overdue_func": lambda p: project_has_overdue_func(ctx, p),
        "log_operation": lambda action_type, target_type="", target_id=0, description="", detail_json="": log_operation(
            ctx, action_type, target_type, target_id, description, detail_json
        ),
        "_drive_letter": lambda path: _drive_letter(ctx, path),
        "get_desktop_dir": lambda: get_desktop_dir(ctx),
        "load_app_settings": lambda: load_app_settings(ctx),
        "_configure_sqlite": lambda dbapi_connection, connection_record=None: _configure_sqlite(
            ctx, dbapi_connection, connection_record
        ),
        "backup_database_on_start": lambda retention=3: backup_database_on_start(ctx, retention),
    }

    for name, open_fn in helper_map.items():
        def _make_helper(h_name: str, h_fn: Any):
            def _bound(*args: Any, **kwargs: Any):
                if should_use_legacy_route(h_name) and h_name in legacy_helpers:
                    return legacy_helpers[h_name](*args, **kwargs)
                return h_fn(*args, **kwargs)

            _bound.__name__ = h_name
            _bound._is_stage_4d_bound = True
            return _bound

        ctx.set_symbol(name, _make_helper(name, open_fn), write_host=True)

    unauthenticated_endpoints = {"health"}
    route_map = {
        "api_stats": lambda: api_stats(ctx),
        "api_calendar": lambda: api_calendar(ctx),
        "api_export_years": lambda: api_export_years(ctx),
        "api_logs": lambda: api_logs(ctx),
        "api_system_info": lambda: api_system_info(ctx),
        "health": lambda: health(ctx),
        "api_open_export_folder": lambda: api_open_export_folder(ctx),
    }

    installed_views: list[str] = []
    if flask_app is not None and hasattr(flask_app, "view_functions"):
        login_dec = ctx.get("login_required") or (lambda f: f)
        for endpoint, raw_fn in route_map.items():
            raw_fn.__name__ = endpoint
            guarded = raw_fn if endpoint in unauthenticated_endpoints else login_dec(raw_fn)

            def _make_dual(ep: str, open_handler: Any):
                def _dual(*args: Any, **kwargs: Any):
                    if should_use_legacy_route(ep) and ep in legacy_views:
                        return legacy_views[ep](*args, **kwargs)
                    return open_handler(*args, **kwargs)

                _dual.__name__ = ep
                _dual._is_stage_4d_bound = True
                return _dual

            dual_fn = _make_dual(endpoint, guarded)
            flask_app.view_functions[endpoint] = dual_fn
            ctx.set_symbol(endpoint, dual_fn, write_host=True)
            installed_views.append(endpoint)

    info = {
        "signature": STATS_CALENDAR_LOG_ROUTES_SIGNATURE,
        "installed_helpers": list(helper_map.keys()),
        "installed_views": installed_views,
    }
    if flask_app is not None and hasattr(flask_app, "extensions"):
        flask_app.extensions["stage_4d_stats_calendar_logs"] = info
    return info
