"""Pure-source Flask application & desktop runtime assembler (Stage 6).

Assembles the full Project Management System backend directly from open-source
modules (`src/backend_patches/*` + `src/project_manager/*`) without requiring
any legacy compiled executable or marshal bytecode patching.
"""
from __future__ import annotations

from datetime import date, datetime
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import sys
from typing import Any

from flask import (
    Flask,
    Response,
    abort,
    has_request_context,
    jsonify,
    make_response,
    redirect,
    render_template,
    render_template_string,
    request,
    send_file,
    session,
    stream_with_context,
)
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import event
from sqlalchemy.orm import joinedload

try:
    from src.backend_patches import (
        attachment_lifecycle_routes,
        auth_decorators,
        business_input_validation,
        business_registry_routes,
        desktop_host_service,
        open_data_security,
        project_crud_routes,
        project_event_reminders,
        project_xlsx_export,
        public_licensing,
        registration_routes,
        runtime_context,
        scheduled_digest_backup,
        schema_models,
        stage_auto_completion,
        stage_templates,
        stats_calendar_log_routes,
        system_settings_service,
    )
except ModuleNotFoundError:  # pragma: no cover - packaged import fallback
    import attachment_lifecycle_routes  # type: ignore[no-redef]
    import auth_decorators  # type: ignore[no-redef]
    import business_input_validation  # type: ignore[no-redef]
    import business_registry_routes  # type: ignore[no-redef]
    import desktop_host_service  # type: ignore[no-redef]
    import open_data_security  # type: ignore[no-redef]
    import project_crud_routes  # type: ignore[no-redef]
    import project_event_reminders  # type: ignore[no-redef]
    import project_xlsx_export  # type: ignore[no-redef]
    import public_licensing  # type: ignore[no-redef]
    import registration_routes  # type: ignore[no-redef]
    import runtime_context  # type: ignore[no-redef]
    import scheduled_digest_backup  # type: ignore[no-redef]
    import schema_models  # type: ignore[no-redef]
    import stage_auto_completion  # type: ignore[no-redef]
    import stage_templates  # type: ignore[no-redef]
    import stats_calendar_log_routes  # type: ignore[no-redef]
    import system_settings_service  # type: ignore[no-redef]


def _resolve_app_version() -> str:
    """Resolve app version from package.json when unfrozen, defaulting to current release."""
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


STANDALONE_APP_SIGNATURE = "standalone-pure-source-app-v1"
APP_VERSION = _resolve_app_version()
DEFAULT_STAGES = [{'key': 'plan_received', 'name': '计划接收', 'icon': '📥', 'group': '前期', 'order': 1}, {'key': 'doc_prepare', 'name': '文件编制', 'icon': '📝', 'group': '前期', 'order': 2}, {'key': 'doc_review', 'name': '文件审核', 'icon': '🔍', 'group': '前期', 'order': 3}, {'key': 'doc_finalized', 'name': '文件定稿', 'icon': '✅', 'group': '前期', 'order': 4}, {'key': 'agreement_signed', 'name': '委托协议签定', 'icon': '📋', 'group': '前期', 'order': 5}, {'key': 'announcement', 'name': '公告发布', 'icon': '📢', 'group': '中期', 'order': 6}, {'key': 'registration_end', 'name': '报名截止', 'icon': '⏰', 'group': '中期', 'order': 7}, {'key': 'bid_opening', 'name': '开标', 'icon': '🎯', 'group': '中期', 'order': 8}, {'key': 'evaluation', 'name': '评标', 'icon': '📊', 'group': '中期', 'order': 9}, {'key': 'result_announced', 'name': '结果公示', 'icon': '📣', 'group': '后期', 'order': 10}, {'key': 'winning_notice', 'name': '中标通知书', 'icon': '🏆', 'group': '后期', 'order': 11}, {'key': 'service_fee', 'name': '服务费到账', 'icon': '💰', 'group': '后期', 'order': 12}, {'key': 'deposit_refund', 'name': '保证金退还', 'icon': '💳', 'group': '后期', 'order': 13}, {'key': 'archived', 'name': '资料整理归档', 'icon': '📦', 'group': '收尾', 'order': 14}]
ALLOWED_EXTENSIONS = {
    "pdf",
    "doc",
    "docx",
    "xls",
    "xlsx",
    "ppt",
    "pptx",
    "png",
    "jpg",
    "jpeg",
    "gif",
    "txt",
    "zip",
    "rar",
    "csv",
}
PREVIEW_EXTENSIONS = {"pdf", "png", "jpg", "jpeg", "gif"}


def _default_to_dict(instance: Any) -> dict[str, Any]:
    out: dict[str, Any] = {}
    table = getattr(instance, "__table__", None)
    if table is not None:
        for col in table.columns:
            val = getattr(instance, col.name, None)
            if isinstance(val, (date, datetime)):
                out[col.name] = val.isoformat()
            else:
                out[col.name] = val
    return out


def _attach_orm_helpers(db: SQLAlchemy) -> dict[str, type[Any]]:
    from src.project_manager.source_models import build_models
    return build_models(db)


def _resolve_paths(
    data_dir: str | Path | None = None,
    resource_dir: str | Path | None = None,
) -> tuple[Path, Path, Path]:
    base_dir = Path(getattr(sys, "_MEIPASS", Path(__file__).resolve().parents[2]))
    resolved_res = Path(resource_dir) if resource_dir else base_dir
    if not (resolved_res / "templates").exists():
        if (base_dir / "src" / "templates").exists():
            resolved_res = base_dir / "src"
        elif (base_dir / "source" / "frontend").exists():
            resolved_res = base_dir / "source" / "frontend"
    resolved_data = Path(data_dir) if data_dir else (Path(__file__).resolve().parents[2] / "data")
    resolved_data.mkdir(parents=True, exist_ok=True)
    return base_dir, resolved_res, resolved_data


def _resolve_web_folders(base_dir: Path, resolved_res: Path) -> tuple[str | None, str | None]:
    template_candidates = (
        resolved_res / "templates",
        base_dir / "templates",
        base_dir / "src" / "templates",
    )
    static_candidates = (
        resolved_res / "static",
        base_dir / "static",
        base_dir / "src" / "project_manager" / "static",
        base_dir / "src" / "static",
    )
    template_dir = next((str(p) for p in template_candidates if p.exists()), None)
    static_dir = next((str(p) for p in static_candidates if p.exists()), None)
    return template_dir, static_dir


def _register_url_rules(app: Flask, ctx: runtime_context.AppContextRegistry) -> None:
    """Bind URL rules for all standalone Stage 3~4 endpoints."""
    route_table: list[tuple[str, str, tuple[str, ...]]] = [
        ("/", "index", ("GET",)),
        ("/login", "login", ("GET", "POST")),
        ("/logout", "logout", ("GET", "POST")),
        ("/activation", "activation", ("GET", "POST")),
        ("/health", "health", ("GET",)),
        ("/api/license/status", "api_license_status", ("GET",)),
        ("/api/csrf-refresh", "api_csrf_refresh", ("POST",)),
        ("/api/me", "api_me", ("GET",)),
        ("/api/me/change-password", "api_change_password", ("POST",)),
        ("/api/users", "api_list_users", ("GET",)),
        ("/api/users/<int:uid>/reset-password", "api_reset_password", ("POST",)),
        ("/api/settings", "api_get_settings", ("GET",)),
        ("/api/settings", "api_update_settings", ("PATCH",)),
        ("/api/settings/open-export-folder", "api_open_export_folder", ("POST",)),
        ("/api/system-info", "api_system_info", ("GET",)),
        ("/api/stats", "api_stats", ("GET",)),
        ("/api/calendar", "api_calendar", ("GET",)),
        ("/api/export", "api_export", ("GET",)),
        ("/api/export-years", "api_export_years", ("GET",)),
        ("/api/logs", "api_logs", ("GET",)),
        ("/api/projects", "api_projects", ("GET",)),
        ("/api/projects", "api_create_project", ("POST",)),
        ("/api/projects/<int:pid>", "api_project", ("GET",)),
        ("/api/projects/<int:pid>", "api_update_project", ("PUT",)),
        ("/api/projects/<int:pid>", "api_delete_project", ("DELETE",)),
        ("/api/projects/<int:pid>/stages/<stage_key>", "api_update_stage", ("PUT",)),
        ("/api/batch/advance-stage", "api_batch_advance_stage", ("POST",)),
        ("/api/projects/<int:pid>/lots", "api_get_lots", ("GET",)),
        ("/api/projects/<int:pid>/lots", "api_create_lot", ("POST",)),
        ("/api/projects/<int:pid>/lots/<int:lid>", "api_update_lot", ("PUT",)),
        ("/api/projects/<int:pid>/lots/<int:lid>", "api_delete_lot", ("DELETE",)),
        ("/api/projects/<int:pid>/registrations", "api_get_registrations", ("GET",)),
        ("/api/projects/<int:pid>/registrations", "api_create_registration", ("POST",)),
        ("/api/projects/<int:pid>/registrations/<int:rid>", "api_update_registration", ("PUT",)),
        ("/api/projects/<int:pid>/registrations/<int:rid>", "api_delete_registration", ("DELETE",)),
        ("/api/projects/<int:pid>/bid-results", "api_get_bid_results", ("GET",)),
        ("/api/projects/<int:pid>/bid-results", "api_create_bid_result", ("POST",)),
        ("/api/projects/<int:pid>/bid-results/<int:bid>", "api_update_bid_result", ("PUT",)),
        ("/api/projects/<int:pid>/bid-results/<int:bid>", "api_delete_bid_result", ("DELETE",)),
        ("/api/projects/<int:pid>/notice-deliveries", "api_get_notice_deliveries", ("GET",)),
        ("/api/projects/<int:pid>/notice-deliveries", "api_create_notice_delivery", ("POST",)),
        ("/api/projects/<int:pid>/notice-deliveries/<int:nid>", "api_update_notice_delivery", ("PUT",)),
        ("/api/projects/<int:pid>/notice-deliveries/<int:nid>", "api_delete_notice_delivery", ("DELETE",)),
        ("/api/projects/<int:pid>/archive-deliveries", "api_get_archive_deliveries", ("GET",)),
        ("/api/projects/<int:pid>/archive-deliveries", "api_create_archive_delivery", ("POST",)),
        ("/api/projects/<int:pid>/archive-deliveries/<int:aid>", "api_update_archive_delivery", ("PUT",)),
        ("/api/projects/<int:pid>/archive-deliveries/<int:aid>", "api_delete_archive_delivery", ("DELETE",)),
        ("/api/projects/<int:pid>/service-fee-invoices", "api_get_service_fee_invoices", ("GET",)),
        ("/api/projects/<int:pid>/service-fee-invoices", "api_create_service_fee_invoice", ("POST",)),
        ("/api/projects/<int:pid>/service-fee-invoices/<int:iid>", "api_update_service_fee_invoice", ("PUT",)),
        ("/api/projects/<int:pid>/service-fee-invoices/<int:iid>", "api_delete_service_fee_invoice", ("DELETE",)),
        ("/api/projects/<int:pid>/complaints", "api_get_complaints", ("GET",)),
        ("/api/projects/<int:pid>/complaints", "api_create_complaint", ("POST",)),
        ("/api/projects/<int:pid>/complaints/<int:cid>", "api_update_complaint", ("PUT",)),
        ("/api/projects/<int:pid>/complaints/<int:cid>", "api_delete_complaint", ("DELETE",)),
        ("/api/projects/<int:pid>/complaints/<int:cid>/set-status", "api_set_complaint_status", ("POST",)),
        ("/api/projects/<int:pid>/complaints/<int:cid>/events", "api_create_complaint_event", ("POST",)),
        ("/api/projects/<int:pid>/complaints/<int:cid>/events/<int:eid>", "api_update_delete_complaint_event", ("PUT", "DELETE")),
        ("/api/projects/<int:pid>/complaints/<int:cid>/attachments", "api_upload_complaint_attachments", ("POST",)),
        ("/api/projects/<int:pid>/complaints/<int:cid>/events/<int:eid>/attachments", "api_upload_complaint_event_attachments", ("POST",)),
        ("/api/complaints/<int:cid>/attachment", "api_download_complaint_attachment", ("GET",)),
        ("/api/projects/<int:pid>/clarifications", "api_create_clarification", ("POST",)),
        ("/api/projects/<int:pid>/clarifications/<int:item_id>", "api_update_delete_clarification", ("PUT", "DELETE")),
        ("/api/projects/<int:pid>/clarifications/<int:item_id>/attachments", "api_upload_clarification_attachments", ("POST",)),
        ("/api/projects/<int:pid>/stage-checklist", "api_create_stage_checklist_item", ("POST",)),
        ("/api/projects/<int:pid>/stage-checklist/<int:item_id>", "api_update_delete_stage_checklist_item", ("PUT", "DELETE")),
        ("/api/projects/<int:pid>/archive-catalog", "api_create_archive_catalog_item", ("POST",)),
        ("/api/projects/<int:pid>/archive-catalog/bulk", "api_bulk_update_archive_catalog", ("PUT",)),
        ("/api/projects/<int:pid>/archive-catalog/<int:item_id>", "api_update_delete_archive_catalog_item", ("PUT", "DELETE")),
        ("/api/projects/<int:pid>/attachments", "api_list_attachments", ("GET",)),
        ("/api/projects/<int:pid>/attachments", "api_upload_attachment", ("POST",)),
        ("/api/attachments/<int:aid>/download", "api_download_attachment", ("GET",)),
        ("/api/attachments/<int:aid>/save-local", "api_save_attachment_local", ("POST",)),
        ("/api/attachments/<int:aid>/view", "api_view_attachment", ("GET",)),
        ("/api/attachments/<int:aid>", "api_update_attachment", ("PUT",)),
        ("/api/attachments/<int:aid>", "api_delete_attachment", ("DELETE",)),
    ]
    for rule, endpoint, methods in route_table:
        view_fn = app.view_functions.get(endpoint) or ctx.get(endpoint)
        if view_fn is None:
            continue
        app.add_url_rule(rule, endpoint=endpoint, view_func=view_fn, methods=methods)


def create_app(
    *,
    data_dir: str | Path | None = None,
    resource_dir: str | Path | None = None,
    db_path: str | Path | None = None,
    public_unrestricted: bool | None = None,
) -> Flask:
    """Construct a pure-source Flask app with all Stage 1~5 modules registered."""
    base_dir, resolved_res, resolved_data = _resolve_paths(data_dir, resource_dir)
    resolved_db = Path(db_path) if db_path else (resolved_data / "bidding.db")
    upload_folder = resolved_data / "uploads"
    upload_folder.mkdir(parents=True, exist_ok=True)

    template_folder, static_folder = _resolve_web_folders(base_dir, resolved_res)

    app = Flask(
        __name__,
        template_folder=template_folder,
        static_folder=static_folder,
    )
    from src.project_manager.source_services import local_secret
    app.config["SECRET_KEY"] = os.environ.get("PM_SECRET_KEY") or local_secret(resolved_data, "session_key.dpapi").hex()
    master_key = local_secret(resolved_data, "data_key.dpapi")
    app.config["SQLALCHEMY_DATABASE_URI"] = f"sqlite:///{resolved_db.as_posix()}"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    app.config["MAX_CONTENT_LENGTH"] = (1024 + 16) * 1024 * 1024

    app.config["SESSION_COOKIE_SAMESITE"] = "Lax"
    app.config["SESSION_COOKIE_HTTPONLY"] = True
    db = SQLAlchemy(app)
    with app.app_context():
        models = _attach_orm_helpers(db)
        event.listen(db.engine, "connect", stats_calendar_log_routes._configure_sqlite)
        db.create_all()

    if public_unrestricted is None:
        public_unrestricted = os.environ.get("PM_PUBLIC_EDITION_UNRESTRICTED", "1") == "1"

    def _license_status(update_state: bool = False) -> dict[str, Any]:
        return public_licensing.verify_license(
            resolved_data, resolved_res, update_state=update_state,
            unrestricted=bool(public_unrestricted))

    # Public source storage is SQLite. Bind it explicitly instead of resolving
    # the compatibility SQLCipher connector through the security module.
    def connect_source_database(path, key=None, check_same_thread=True):
        return sqlite3.connect(str(path), timeout=30, check_same_thread=check_same_thread)

    host_namespace: dict[str, Any] = {
        "app": app,
        "db": db,
        **models,
        "request": request,
        "session": session,
        "jsonify": jsonify,
        "redirect": redirect,
        "make_response": make_response,
        "render_template": render_template,
        "render_template_string": render_template_string,
        "send_file": send_file,
        "Response": Response,
        "stream_with_context": stream_with_context,
        "abort": abort,
        "has_request_context": has_request_context,
        "joinedload": joinedload,
        "BASE_DIR": base_dir,
        "RESOURCE_DIR": resolved_res,
        "DATA_DIR": resolved_data,
        "DB_PATH": resolved_db,
        "SETTINGS_PATH": resolved_data / "app_settings.json",
        "UPLOAD_FOLDER": upload_folder,
        "LOGIN_GUARD_PATH": resolved_data / "login_guard.json",
        "ALLOWED_EXTENSIONS": set(ALLOWED_EXTENSIONS),
        "PREVIEW_EXTENSIONS": set(PREVIEW_EXTENSIONS),
        "MAX_FILE_SIZE": 1024 * 1024 * 1024,
        "BACKEND_VERSION": APP_VERSION,
        "DATA_ENCRYPTION_ENABLED": False,
        "connect_encrypted": connect_source_database,
        "ATTACHMENT_KEY": open_data_security.attachment_key(master_key),
        "MASTER_KEY": master_key,
        "iter_decrypted_file": open_data_security.iter_decrypted_file,
        "LICENSE_REQUIRED": not public_unrestricted,
        "METHODS": list(stage_templates.PROCUREMENT_METHODS),
        "STAGES": DEFAULT_STAGES,
        "current_license_status": _license_status,
        "validate_business_input": business_input_validation.validate_business_input,
        "get_export_dir": lambda: system_settings_service.get_export_dir(host_namespace),
        "get_backup_dir": lambda: resolved_data / "backups",
        "save_app_settings": lambda settings: system_settings_service.save_app_settings(host_namespace, settings),
    }

    ctx = runtime_context.register_runtime_context(
        host_namespace,
        app=app,
        db=db,
        data_security=open_data_security,
        licensing=public_licensing,
        extra=host_namespace,
    )
    ctx.set_symbol("login_required", lambda f: auth_decorators.login_required(ctx, f), write_host=True)
    ctx.set_symbol("admin_required", lambda f: auth_decorators.admin_required(ctx, f), write_host=True)
    schema_models.register(app, db, host_namespace)
    auth_decorators.register(ctx, app)
    stats_calendar_log_routes.register(ctx, app)
    attachment_lifecycle_routes.register(ctx, app)
    business_registry_routes.register(ctx, app)

    # Bind Stage 3B/3C routes directly into Flask view_functions before URL rule registration
    login_dec = ctx.get("login_required") or (lambda f: f)
    admin_dec = ctx.get("admin_required") or login_dec
    app.view_functions.setdefault("api_get_settings", login_dec(lambda: system_settings_service.api_get_settings(ctx)))
    app.view_functions.setdefault("api_update_settings", admin_dec(lambda: system_settings_service.api_update_settings(ctx)))
    app.view_functions.setdefault("api_export", login_dec(lambda: project_xlsx_export.api_export(ctx)))
    app.view_functions.setdefault("api_projects", login_dec(lambda: project_crud_routes.api_projects(ctx)))
    app.view_functions.setdefault("api_create_project", login_dec(lambda: project_crud_routes.api_create_project(ctx)))
    app.view_functions.setdefault("api_project", login_dec(lambda pid: project_crud_routes.api_project(ctx, pid)))
    app.view_functions.setdefault("api_update_project", login_dec(lambda pid: project_crud_routes.api_update_project(ctx, pid)))
    app.view_functions.setdefault("api_delete_project", admin_dec(lambda pid: project_crud_routes.api_delete_project(ctx, pid)))
    app.view_functions.setdefault("api_update_stage", login_dec(lambda pid, stage_key: project_crud_routes.api_update_stage(ctx, pid, stage_key)))
    app.view_functions.setdefault("api_batch_advance_stage", login_dec(lambda: project_crud_routes.api_batch_advance_stage(ctx)))
    app.view_functions.setdefault("api_get_lots", login_dec(lambda pid: project_crud_routes.api_get_lots(ctx, pid)))
    app.view_functions.setdefault("api_create_lot", login_dec(lambda pid: project_crud_routes.api_create_lot(ctx, pid)))
    app.view_functions.setdefault("api_update_lot", login_dec(lambda pid, lid: project_crud_routes.api_update_lot(ctx, pid, lid)))
    app.view_functions.setdefault("api_delete_lot", login_dec(lambda pid, lid: project_crud_routes.api_delete_lot(ctx, pid, lid)))
    app.view_functions.setdefault("api_delete_attachment", login_dec(lambda aid: project_crud_routes.api_delete_attachment(ctx, aid)))
    app.view_functions.setdefault("api_delete_complaint", login_dec(lambda pid, cid: project_crud_routes.api_delete_complaint(ctx, pid, cid)))
    app.view_functions.setdefault("api_get_registrations", login_dec(lambda pid: registration_routes.api_get_registrations(ctx, pid)))
    app.view_functions.setdefault("api_create_registration", login_dec(lambda pid: registration_routes.api_create_registration(ctx, pid)))
    app.view_functions.setdefault("api_update_registration", login_dec(lambda pid, rid: registration_routes.api_update_registration(ctx, pid, rid)))
    app.view_functions.setdefault("api_delete_registration", login_dec(lambda pid, rid: registration_routes.api_delete_registration(ctx, pid, rid)))

    for name in ("api_update_delete_complaint_event", "api_update_delete_clarification", "api_create_stage_checklist_item"):
        def bind(fn):
            return login_dec(lambda **kwargs: fn(ctx, **kwargs))
        app.view_functions[name] = bind(getattr(project_crud_routes, name))
    _register_url_rules(app, ctx)
    for name in ("enforce_product_license", "protect_api_writes"):
        app.before_request(ctx[name])
    for name in ("inject_brand_settings", "inject_user"):
        app.context_processor(ctx[name])
    import logging
    from werkzeug.serving import WSGIRequestHandler
    from src.backend_patches import http_security
    http_security.install_http_security(app, request_handler_class=WSGIRequestHandler,
        access_loggers=[logging.getLogger("werkzeug")])
    from src.project_manager.source_modules import register_modules
    register_modules(app, db, ctx)
    from src.project_manager.source_services import register_services
    register_services(app, db, ctx)

    app.extensions["standalone_pure_source"] = {
        "signature": STANDALONE_APP_SIGNATURE,
        "version": APP_VERSION,
        "pure_source": True,
        "route_count": len(list(app.url_map.iter_rules())),
    }
    return app


def run_desktop(argv: list[str] | None = None) -> int:
    from src.project_manager.desktop_runtime import run
    return run(create_app, argv)


if __name__ == "__main__":
    raise SystemExit(run_desktop())
