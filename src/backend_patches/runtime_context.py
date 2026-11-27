"""Explicit runtime context registry replacing implicit globals() and ad-hoc model dicts.

runtime-context-v1
"""
from __future__ import annotations

from collections.abc import Iterator, Mapping
from typing import Any

RUNTIME_CONTEXT_SIGNATURE = "runtime-context-v1"

CORE_MODEL_NAMES: tuple[str, ...] = (
    "AnnouncementClarification",
    "ArchiveCatalogItem",
    "ArchiveDelivery",
    "Attachment",
    "BidResult",
    "Complaint",
    "ComplaintEvent",
    "ComplaintIssue",
    "ComplaintTarget",
    "NoticeDelivery",
    "OperationLog",
    "Project",
    "ProjectLot",
    "ServiceFeeInvoice",
    "Stage",
    "StageChecklistItem",
    "SupplierRegistration",
    "User",
)

CORE_SYMBOL_NAMES: tuple[str, ...] = (
    "app",
    "db",
    *CORE_MODEL_NAMES,
    "DATA_DIR",
    "DB_PATH",
    "SETTINGS_PATH",
    "UPLOAD_FOLDER",
    "RESOURCE_DIR",
    "MASTER_KEY",
    "ATTACHMENT_KEY",
    "ALLOWED_EXTENSIONS",
    "STAGES",
    "METHODS",
    "load_app_settings",
    "save_app_settings",
    "get_export_dir",
    "get_backup_dir",
    "get_desktop_dir",
    "log_operation",
    "login_required",
    "admin_required",
    "connect_encrypted",
    "_attachment_response",
    "_validate_username",
    "_active_admin_count",
    "_login_guard_key",
    "_load_login_guard",
    "_save_login_guard",
    "_check_login_rate_limit",
    "_record_login_failure",
    "_clear_login_attempts",
    "LOGIN_GUARD_PATH",
    "_MAX_LOGIN_ATTEMPTS",
    "_LOGIN_LOCKOUT_SEC",
    "_LOGIN_GUARD_LOCK",
    "LICENSE_REQUIRED",
    "current_license_status",
    "get_csrf_token",
    "protect_api_writes",
    "enforce_product_license",
    "inject_brand_settings",
    "inject_user",
    "index",
    "login",
    "logout",
    "activation",
    "api_license_status",
    "api_csrf_refresh",
    "api_me",
    "api_list_users",
    "api_reset_password",
    "api_change_password",
    "_ensure_project_resource",
    "_normalize_project_lot_id",
    "_validate_file_path",
    "_delete_attachment_file",
    "_cleanup_project_files",
    "_parse_optional_date",
    "_parse_optional_datetime",
    "_apply_clarification_data",
    "_sync_archive_checklist",
    "run_scheduled_backup_if_due",
    "run_project_event_reminders_if_due",
    "_auto_advance_stages",
    "_REMINDER_SMTP_FACTORY",
    "_REMINDER_UNPROTECT_SECRET",
    "_PROCUREMENT_CATALOG_ENABLED",
    "_TENDER_GUARANTEE_ENABLED",
    "_AUTO_COMPLETION_NOW",
)

_MISSING = object()
_ACTIVE_CONTEXT: AppContextRegistry | None = None


def _read_from_source(source: Any, name: str) -> Any:
    if source is None:
        return _MISSING
    if isinstance(source, Mapping):
        return source.get(name, _MISSING)
    return getattr(source, name, _MISSING)


class AppContextRegistry(Mapping[str, Any]):
    """Unified typed/mapping runtime context with live read-through to the host module."""

    def __init__(
        self,
        host_module: Any = None,
        *,
        app: Any = None,
        db: Any = None,
        data_security: Any = None,
        licensing: Any = None,
        desktop_bridge: dict[str, Any] | None = None,
        extra: Mapping[str, Any] | None = None,
    ) -> None:
        object.__setattr__(self, "_host_module", host_module)
        object.__setattr__(self, "_app", app)
        object.__setattr__(self, "_db", db)
        object.__setattr__(self, "_data_security", data_security)
        object.__setattr__(self, "_licensing", licensing)
        object.__setattr__(self, "_desktop_bridge", dict(desktop_bridge or {}))
        object.__setattr__(self, "_overrides", dict(extra or {}))

    @property
    def signature(self) -> str:
        return RUNTIME_CONTEXT_SIGNATURE

    @property
    def host_module(self) -> Any:
        return self._host_module

    @property
    def data_security(self) -> Any:
        return self._data_security

    @property
    def licensing(self) -> Any:
        return self._licensing

    @property
    def desktop_bridge(self) -> dict[str, Any]:
        return self._desktop_bridge

    def resolve(
        self,
        name: str,
        default: Any = None,
        *,
        caller_globals: Mapping[str, Any] | None = None,
    ) -> Any:
        if name == "app" and self._app is not None:
            return self._app
        if name == "db" and self._db is not None:
            return self._db
        if name == "data_security" and self._data_security is not None:
            return self._data_security
        if name == "licensing" and self._licensing is not None:
            return self._licensing
        if name in self._desktop_bridge:
            return self._desktop_bridge[name]
        # Read-through from host_module first so runtime monkeypatches take effect immediately
        host_val = _read_from_source(self._host_module, name)
        if host_val is not _MISSING:
            return host_val
        if name in self._overrides:
            return self._overrides[name]
        if caller_globals is not None and name in caller_globals:
            return caller_globals[name]
        if self._data_security is not None:
            sec_val = _read_from_source(self._data_security, name)
            if sec_val is not _MISSING:
                return sec_val
        return default

    def set_symbol(self, name: str, value: Any, *, write_host: bool = True) -> None:
        self._overrides[name] = value
        if write_host and self._host_module is not None:
            if isinstance(self._host_module, dict):
                self._host_module[name] = value
            else:
                try:
                    setattr(self._host_module, name, value)
                except Exception:
                    pass

    def __getattr__(self, name: str) -> Any:
        if name.startswith("__") and name.endswith("__"):
            raise AttributeError(name)
        val = self.resolve(name, _MISSING)
        if val is _MISSING:
            raise AttributeError(f"runtime context has no symbol {name!r}")
        return val

    def __setattr__(self, name: str, value: Any) -> None:
        if name in {
            "_host_module",
            "_app",
            "_db",
            "_data_security",
            "_licensing",
            "_desktop_bridge",
            "_overrides",
        }:
            object.__setattr__(self, name, value)
        else:
            self.set_symbol(name, value, write_host=True)

    def __getitem__(self, key: str) -> Any:
        val = self.resolve(key, _MISSING)
        if val is _MISSING:
            raise KeyError(key)
        return val

    def get(self, key: str, default: Any = None) -> Any:
        val = self.resolve(key, _MISSING)
        return default if val is _MISSING else val

    def __contains__(self, key: object) -> bool:
        if not isinstance(key, str):
            return False
        return self.resolve(key, _MISSING) is not _MISSING

    def __iter__(self) -> Iterator[str]:
        seen: set[str] = set()
        for name in CORE_SYMBOL_NAMES:
            if self.resolve(name, _MISSING) is not _MISSING:
                seen.add(name)
                yield name
        for name in (*self._overrides.keys(), *self._desktop_bridge.keys()):
            if name not in seen and self.resolve(name, _MISSING) is not _MISSING:
                seen.add(name)
                yield name

    def __len__(self) -> int:
        return sum(1 for _ in self.__iter__())

    def as_models_dict(self, *names: str, **extra: Any) -> dict[str, Any]:
        """Build a compatibility dictionary for legacy register(app, db, models) callers."""
        target_names = names or CORE_SYMBOL_NAMES
        out: dict[str, Any] = {}
        for name in target_names:
            val = self.resolve(name, _MISSING)
            if val is not _MISSING:
                out[name] = val
        out.update(extra)
        return out


def register_runtime_context(
    host_module: Any,
    *,
    app: Any = None,
    db: Any = None,
    data_security: Any = None,
    licensing: Any = None,
    desktop_bridge: dict[str, Any] | None = None,
    extra: Mapping[str, Any] | None = None,
) -> AppContextRegistry:
    """Create and attach an AppContextRegistry to the Flask app and host module."""
    global _ACTIVE_CONTEXT
    resolved_app = app or _read_from_source(host_module, "app")
    if resolved_app is _MISSING:
        resolved_app = None
    resolved_db = db or _read_from_source(host_module, "db")
    if resolved_db is _MISSING:
        resolved_db = None

    ctx = AppContextRegistry(
        host_module,
        app=resolved_app,
        db=resolved_db,
        data_security=data_security,
        licensing=licensing,
        desktop_bridge=desktop_bridge,
        extra=extra,
    )
    if resolved_app is not None and hasattr(resolved_app, "extensions"):
        resolved_app.extensions["runtime_context"] = ctx
        if isinstance(desktop_bridge, Mapping) and desktop_bridge:
            existing_bridge = resolved_app.extensions.get("desktop_bridge")
            merged_bridge = dict(existing_bridge) if isinstance(existing_bridge, Mapping) else {}
            merged_bridge.update(desktop_bridge)
            resolved_app.extensions["desktop_bridge"] = merged_bridge
    if host_module is not None and not isinstance(host_module, dict):
        try:
            setattr(host_module, "_RUNTIME_CONTEXT", ctx)
        except Exception:
            pass
    _ACTIVE_CONTEXT = ctx
    return ctx


def get_runtime_context(
    app_or_host: Any = None,
    *,
    caller_globals: Mapping[str, Any] | None = None,
) -> AppContextRegistry:
    """Retrieve the active AppContextRegistry or construct a read-through wrapper."""
    if isinstance(app_or_host, AppContextRegistry):
        return app_or_host
    if app_or_host is not None:
        ext = getattr(app_or_host, "extensions", None)
        if isinstance(ext, dict) and isinstance(ext.get("runtime_context"), AppContextRegistry):
            return ext["runtime_context"]
        attached = getattr(app_or_host, "_RUNTIME_CONTEXT", None)
        if isinstance(attached, AppContextRegistry):
            return attached
        return AppContextRegistry(app_or_host, extra=caller_globals)
    if caller_globals is not None:
        if isinstance(caller_globals, AppContextRegistry):
            return caller_globals
        attached_ctx = caller_globals.get("_RUNTIME_CONTEXT")
        if isinstance(attached_ctx, AppContextRegistry):
            return attached_ctx
        if _ACTIVE_CONTEXT is not None:
            active_host = _ACTIVE_CONTEXT.host_module
            if active_host is caller_globals or getattr(active_host, "__dict__", None) is caller_globals:
                return _ACTIVE_CONTEXT
        return AppContextRegistry(caller_globals)
    if _ACTIVE_CONTEXT is not None:
        return _ACTIVE_CONTEXT
    return AppContextRegistry(caller_globals)


def current_context(app_or_host: Any = None, *, depth: int = 1) -> AppContextRegistry:
    """Return the AppContextRegistry bound to the caller's execution frame or host."""
    if isinstance(app_or_host, AppContextRegistry):
        return app_or_host
    caller_globals: Mapping[str, Any] | None = None
    if app_or_host is None:
        try:
            import sys

            caller_globals = sys._getframe(depth).f_globals
        except Exception:
            caller_globals = None
    return get_runtime_context(app_or_host, caller_globals=caller_globals)


def resolve_host_symbol(
    name: str,
    default: Any = None,
    caller_globals: Mapping[str, Any] | None = None,
    app_or_host: Any = None,
) -> Any:
    """Drop-in replacement for globals().get(name, default) with context priority."""
    if caller_globals is None and app_or_host is None:
        try:
            import sys

            caller_globals = sys._getframe(1).f_globals
        except Exception:
            caller_globals = None
    if caller_globals is not None and name in caller_globals:
        return caller_globals[name]
    ctx = get_runtime_context(app_or_host, caller_globals=caller_globals)
    return ctx.resolve(name, default, caller_globals=caller_globals)
