"""Authentication, session, CSRF, login rate-limit guard, and user management routes (Stage 4A).

auth-decorators-v1
"""
from __future__ import annotations

from collections.abc import Mapping
from functools import wraps
import json
import os
from pathlib import Path
import secrets
import threading
import time
from typing import Any

from werkzeug.security import (
    check_password_hash as _default_check_password_hash,
    generate_password_hash as _default_generate_password_hash,
)

AUTH_DECORATORS_SIGNATURE = "auth-decorators-v1"
STAGE_4A_SIGNATURE = "stage-4a-auth-users-v1"

_DEFAULT_MAX_LOGIN_ATTEMPTS = 5
_DEFAULT_LOGIN_LOCKOUT_SEC = 900
_DEFAULT_LOGIN_GUARD_LOCK = threading.Lock()
_DEFAULT_METHODS = (
    "公开招标",
    "竞争性磋商",
    "竞争性谈判",
    "邀请招标",
    "网上竞价",
    "单一来源",
    "遴选",
    "直选",
)

STAGE_4A_ROUTE_ENDPOINTS: tuple[str, ...] = (
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
)

STAGE_4A_HELPER_NAMES: tuple[str, ...] = (
    "_login_guard_key",
    "_load_login_guard",
    "_save_login_guard",
    "_check_login_rate_limit",
    "_record_login_failure",
    "_clear_login_attempts",
    "_active_admin_count",
    "_validate_username",
    "get_csrf_token",
    "protect_api_writes",
    "enforce_product_license",
    "inject_brand_settings",
    "inject_user",
)


def _ctx(ctx: Any = None, *, depth: int = 2):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    if ctx is None:
        return runtime_context.current_context(depth=depth)
    return runtime_context.get_runtime_context(ctx)


def should_use_legacy_route(name: str, env: Mapping[str, str] | None = None) -> bool:
    """Return True when PM_USE_LEGACY_CORE_ROUTES instructs falling back to core bytecode."""
    source = env if env is not None else os.environ
    raw = str(source.get("PM_USE_LEGACY_CORE_ROUTES", "") or "").strip()
    if not raw:
        return False
    lowered = raw.lower()
    if lowered in {"1", "true", "yes", "all", "*"}:
        return True
    tokens = {item.strip() for item in raw.split(",") if item.strip()}
    return name in tokens


def _resolve_login_guard_path(ctx: Any) -> Path:
    explicit = ctx.get("LOGIN_GUARD_PATH")
    if explicit is not None:
        return Path(explicit)
    data_dir = ctx.get("DATA_DIR")
    if data_dir is not None:
        return Path(data_dir) / "login_guard.json"
    settings_path = ctx.get("SETTINGS_PATH")
    if settings_path is not None:
        return Path(settings_path).with_name("login_guard.json")
    return Path("login_guard.json")


def _call_host_hook(ctx: Any, hook_name: str, default_fn: Any, *args: Any):
    candidate = ctx.get(hook_name)
    if callable(candidate) and not getattr(candidate, "_is_stage_4a_bound", False):
        return candidate(*args)
    return default_fn(ctx, *args)


# ---------------------------------------------------------------------------
# 1. Authentication & Audit Decorators
# ---------------------------------------------------------------------------

def admin_required(ctx: Any, f: Any = None):
    """Recheck current account state for administrator-only routes."""
    if f is None and callable(ctx):
        f = ctx
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx, depth=2)

    @wraps(f)
    def decorated(*args: Any, **kwargs: Any):
        User = ctx.get("User")
        db = ctx.get("db")
        jsonify = ctx.get("jsonify", lambda v: v)
        redirect = ctx.get("redirect", lambda u: u)
        request = ctx.get("request")
        session = ctx.get("session", {})
        user_id = session.get("user_id")
        if not user_id:
            if request.path.startswith("/api/"):
                return jsonify({"error": "请先登录"}), 401
            return redirect("/login")
        user = db.session.get(User, user_id)
        if not user or not user.is_active:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"error": "账号已停用，请重新登录"}), 401
            return redirect("/login")
        session["username"] = user.username
        session["is_admin"] = bool(user.is_admin)
        if not user.is_admin:
            try:
                import account_permissions
            except ModuleNotFoundError:
                from src.backend_patches import account_permissions
            if not account_permissions.admin_capability_allowed(db, User, user, request):
                return jsonify({"error": "需要管理员权限", "code": "PERMISSION_DENIED"}), 403
        return f(*args, **kwargs)

    return decorated


def login_required(ctx: Any, f: Any = None):
    """Verify active login session and record project activity audit trail."""
    if f is None and callable(ctx):
        f = ctx
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx, depth=2)

    @wraps(f)
    def decorated(*args: Any, **kwargs: Any):
        Attachment = ctx.get("Attachment")
        OperationLog = ctx.get("OperationLog")
        Project = ctx.get("Project")
        User = ctx.get("User")
        app = ctx.get("app")
        db = ctx.get("db")
        jsonify = ctx.get("jsonify", lambda v: v)
        redirect = ctx.get("redirect", lambda u: u)
        request = ctx.get("request")
        session = ctx.get("session", {})
        user_id = session.get("user_id")
        if not user_id:
            if request.path.startswith("/api/"):
                return jsonify({"error": "请先登录"}), 401
            return redirect("/login")
        user = db.session.get(User, user_id)
        if not user or not user.is_active:
            session.clear()
            if request.path.startswith("/api/"):
                return jsonify({"error": "账号已停用，请重新登录"}), 401
            return redirect("/login")
        session["username"] = user.username
        session["is_admin"] = bool(user.is_admin)

        try:
            import project_activity
        except ModuleNotFoundError:
            from src.backend_patches import project_activity

        method = str(getattr(request, "method", "GET") or "GET").upper()
        path = str(getattr(request, "path", "") or "")
        payload = request.get_json(silent=True) or {}
        descriptor = project_activity.classify_project_write(method, path, payload)

        def project_snapshot(project_id: int):
            project = db.session.get(Project, project_id)
            if project is not None:
                if hasattr(project, "to_dict"):
                    return dict(project.to_dict())
                return {
                    "id": getattr(project, "id", project_id),
                    "number": getattr(project, "number", ""),
                    "name": getattr(project, "name", ""),
                }
            return None

        try:
            project_ids = []
            if descriptor is not None and descriptor.project_id is not None:
                project_ids = [descriptor.project_id]
            elif descriptor is not None and descriptor.action == "stage.batch_advance":
                project_ids = [
                    int(value)
                    for value in payload.get("project_ids", [])
                    if str(value).isdigit()
                ]
            elif descriptor is not None and descriptor.target_type == "attachment":
                attachment_id = descriptor.target_id
                attachment = (
                    db.session.get(Attachment, int(attachment_id))
                    if attachment_id is not None and str(attachment_id).isdigit()
                    else None
                )
                if attachment is not None and getattr(attachment, "project_id", None):
                    project_ids = [int(attachment.project_id)]

            if descriptor is None:
                captures = []
            elif project_ids:
                captures = [
                    project_activity.capture_before_write(
                        project_activity.descriptor_for_project(descriptor, project_id),
                        payload,
                        project_snapshot(project_id),
                    )
                    for project_id in dict.fromkeys(project_ids)
                ]
            else:
                captures = [project_activity.capture_before_write(descriptor, payload, None)]
        except Exception:
            if app is not None and hasattr(app, "logger"):
                app.logger.exception("project activity capture failed")
            captures = []

        response = f(*args, **kwargs)
        if not captures:
            return response
        status = getattr(response, "status_code", None)
        if status is None and isinstance(response, tuple) and len(response) > 1:
            status = response[1] if isinstance(response[1], int) else None
        status = int(status or 200)
        if status < 200 or status >= 400:
            return response

        raw_payload = response[0] if isinstance(response, tuple) else response
        if isinstance(raw_payload, dict):
            response_payload = raw_payload
        elif hasattr(raw_payload, "get_json"):
            response_payload = raw_payload.get_json(silent=True) or {}
        else:
            response_payload = {}
        for capture in captures:
            resolved_project_id = capture.descriptor.project_id or response_payload.get("id")
            try:
                project_after = (
                    project_snapshot(resolved_project_id)
                    if resolved_project_id is not None
                    else None
                )
                project_activity.record_activity(
                    db,
                    OperationLog,
                    actor={"id": user.id, "username": user.username},
                    request_meta={"ip_address": getattr(request, "remote_addr", "")},
                    capture=capture,
                    response_payload=response_payload,
                    project_snapshot=project_after,
                )
            except Exception:
                if app is not None and hasattr(app, "logger"):
                    app.logger.exception("project activity audit failed")
        return response

    return decorated


# ---------------------------------------------------------------------------
# 2. Login Brute-Force Guard Helpers
# ---------------------------------------------------------------------------

def _login_guard_key(ctx_or_username: Any, username: str | None = None) -> str:
    if username is None and isinstance(ctx_or_username, str):
        username = ctx_or_username
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_username, depth=2)
        username = str(username or "")
    request = ctx.get("request")
    ip = (getattr(request, "remote_addr", None) if request is not None else None) or "unknown"
    return f"{username.casefold()}|{ip}"


def _load_login_guard(ctx: Any = None) -> dict[str, Any]:
    ctx = _ctx(ctx, depth=2)
    guard_path = _resolve_login_guard_path(ctx)
    try:
        data = json.loads(guard_path.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            return data
        return {}
    except (OSError, ValueError):
        return {}


def _save_login_guard(ctx_or_data: Any, data: dict[str, Any] | None = None) -> None:
    if data is None and isinstance(ctx_or_data, dict) and not hasattr(ctx_or_data, "signature"):
        data = ctx_or_data
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_data, depth=2)
        data = dict(data or {})
    guard_path = _resolve_login_guard_path(ctx)
    temp = guard_path.with_suffix(".tmp")
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, guard_path)


def _check_login_rate_limit(ctx_or_username: Any, username: str | None = None) -> tuple[bool, int]:
    """检查登录频率限制，返回 (allowed, wait_seconds)"""
    if username is None and isinstance(ctx_or_username, str):
        username = ctx_or_username
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_username, depth=2)
        username = str(username or "")
    time_mod = ctx.get("time", time)
    now = time_mod.time()
    lock = ctx.get("_LOGIN_GUARD_LOCK", _DEFAULT_LOGIN_GUARD_LOCK)
    lockout_sec = ctx.get("_LOGIN_LOCKOUT_SEC", _DEFAULT_LOGIN_LOCKOUT_SEC)
    max_attempts = ctx.get("_MAX_LOGIN_ATTEMPTS", _DEFAULT_MAX_LOGIN_ATTEMPTS)
    with lock:
        guard = _call_host_hook(ctx, "_load_login_guard", _load_login_guard)
        key = _call_host_hook(ctx, "_login_guard_key", _login_guard_key, username)
        attempts = [float(t) for t in guard.get(key, []) if now - float(t) < lockout_sec]
        guard[key] = attempts
        _call_host_hook(ctx, "_save_login_guard", _save_login_guard, guard)
    if len(attempts) >= max_attempts:
        oldest = attempts[0]
        wait = int(lockout_sec - (now - oldest)) + 1
        return (False, wait)
    return (True, 0)


def _record_login_failure(ctx_or_username: Any, username: str | None = None) -> int:
    """记录一次登录失败"""
    if username is None and isinstance(ctx_or_username, str):
        username = ctx_or_username
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_username, depth=2)
        username = str(username or "")
    time_mod = ctx.get("time", time)
    lock = ctx.get("_LOGIN_GUARD_LOCK", _DEFAULT_LOGIN_GUARD_LOCK)
    max_attempts = ctx.get("_MAX_LOGIN_ATTEMPTS", _DEFAULT_MAX_LOGIN_ATTEMPTS)
    with lock:
        guard = _call_host_hook(ctx, "_load_login_guard", _load_login_guard)
        key = _call_host_hook(ctx, "_login_guard_key", _login_guard_key, username)
        guard.setdefault(key, []).append(time_mod.time())
        _call_host_hook(ctx, "_save_login_guard", _save_login_guard, guard)
        return max(0, max_attempts - len(guard[key]))


def _clear_login_attempts(ctx_or_username: Any, username: str | None = None) -> None:
    """登录成功后清除失败记录"""
    if username is None and isinstance(ctx_or_username, str):
        username = ctx_or_username
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_username, depth=2)
        username = str(username or "")
    lock = ctx.get("_LOGIN_GUARD_LOCK", _DEFAULT_LOGIN_GUARD_LOCK)
    with lock:
        guard = _call_host_hook(ctx, "_load_login_guard", _load_login_guard)
        key = _call_host_hook(ctx, "_login_guard_key", _login_guard_key, username)
        guard.pop(key, None)
        _call_host_hook(ctx, "_save_login_guard", _save_login_guard, guard)


# ---------------------------------------------------------------------------
# 3. Account Helpers, CSRF, License Gate & Context Processors
# ---------------------------------------------------------------------------

def _active_admin_count(ctx: Any = None) -> int:
    ctx = _ctx(ctx, depth=2)
    User = ctx.get("User")
    return User.query.filter_by(is_admin=True, is_active=True).count()


def _validate_username(ctx_or_username: Any = None, username: str | None = None) -> str:
    if username is None and not isinstance(ctx_or_username, Mapping) and not hasattr(ctx_or_username, "signature"):
        username = "" if ctx_or_username is None else str(ctx_or_username)
    else:
        username = "" if username is None else str(username)
    if not username:
        return "账号不能为空"
    if len(username) < 2 or len(username) > 32:
        return "账号长度需为 2-32 位"
    allowed = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._-")
    if any(ch not in allowed for ch in username):
        return "账号只能包含字母、数字、点、下划线或短横线"
    return ""


def get_csrf_token(ctx: Any = None) -> str:
    ctx = _ctx(ctx, depth=2)
    session = ctx.get("session", {})
    secrets_mod = ctx.get("secrets", secrets)
    token = session.get("csrf_token")
    if not token:
        token = secrets_mod.token_urlsafe(32)
        session["csrf_token"] = token
    return token


def protect_api_writes(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    request = ctx.get("request")
    session = ctx.get("session", {})
    jsonify = ctx.get("jsonify", lambda v: v)
    secrets_mod = ctx.get("secrets", secrets)
    if request.path.startswith("/api/") and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if request.endpoint == "api_csrf_refresh":
            return None
        token = session.get("csrf_token")
        header_token = request.headers.get("X-CSRFToken", "")
        if not token or not secrets_mod.compare_digest(token, header_token):
            return jsonify({"error": "请求已过期，请刷新页面后重试"}), 400
    return None


def enforce_product_license(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    if not ctx.get("LICENSE_REQUIRED", True):
        return None
    request = ctx.get("request")
    jsonify = ctx.get("jsonify", lambda v: v)
    redirect = ctx.get("redirect", lambda u: u)
    current_license_status = ctx.get("current_license_status")
    endpoint = request.endpoint or ""
    if endpoint == "static" or endpoint in frozenset({"api_license_status", "activation", "health"}):
        return None
    status = current_license_status()
    if status["mode"] == "blocked":
        if request.path.startswith("/api/"):
            return (
                jsonify(
                    {
                        "error": status["message"],
                        "license_status": status["status"],
                        "device_code": status["device_code"],
                    }
                ),
                423,
            )
        return redirect("/activation")
    if status["mode"] == "read_only" and request.method in ("POST", "PUT", "PATCH", "DELETE"):
        if endpoint not in frozenset({"api_csrf_refresh", "login"}):
            return (
                jsonify(
                    {
                        "error": status["message"],
                        "license_status": status["status"],
                    }
                ),
                423,
            )
    return None


def inject_brand_settings(ctx: Any = None) -> dict[str, Any]:
    ctx = _ctx(ctx, depth=2)
    load_app_settings = ctx.get("load_app_settings", lambda: {})
    return {"login_subtitle": load_app_settings().get("login_subtitle") or "招标项目管理"}


def inject_user(ctx: Any = None) -> dict[str, Any]:
    ctx = _ctx(ctx, depth=2)
    session = ctx.get("session", {})
    db = ctx.get("db")
    User = ctx.get("User")
    user = db.session.get(User, session.get("user_id")) if session.get("user_id") else None
    token = _call_host_hook(ctx, "get_csrf_token", get_csrf_token)
    return dict(
        current_user_id=user.id if user and user.is_active else 0,
        current_username=user.username if user and user.is_active else "",
        current_is_admin=bool(user and user.is_active and user.is_admin),
        csrf_token=token,
    )


# ---------------------------------------------------------------------------
# 4. Page, Auth, License, CSRF & User Management Routes
# ---------------------------------------------------------------------------

def index(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    render_template = ctx.get("render_template")
    return render_template("workspace.html")


def login(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    request = ctx.get("request")
    render_template = ctx.get("render_template")
    redirect = ctx.get("redirect", lambda u: u)
    session = ctx.get("session", {})
    User = ctx.get("User")
    check_password_hash = ctx.get("check_password_hash", _default_check_password_hash)
    if request.method == "POST":
        username = request.form.get("username", "").strip()
        password = request.form.get("password", "")
        allowed, wait_sec = _call_host_hook(
            ctx, "_check_login_rate_limit", _check_login_rate_limit, username
        )
        if not allowed:
            return render_template(
                "login.html", error=f"登录失败次数过多，请等待 {wait_sec} 秒后重试"
            )
        user = User.query.filter_by(username=username).first()
        if user and check_password_hash(user.password_hash, password):
            if not user.is_active:
                return render_template("login.html", error="该账号已被禁用，请联系管理员")
            _call_host_hook(ctx, "_clear_login_attempts", _clear_login_attempts, username)
            session["user_id"] = user.id
            session["username"] = user.username
            session["is_admin"] = user.is_admin
            return redirect("/")
        remaining = _call_host_hook(
            ctx, "_record_login_failure", _record_login_failure, username
        )
        return render_template(
            "login.html", error=f"用户名或密码错误（剩余 {remaining} 次尝试机会）"
        )
    return render_template("login.html", error="")


def logout(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    session = ctx.get("session", {})
    redirect = ctx.get("redirect", lambda u: u)
    session.clear()
    return redirect("/login")


def activation(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    render_template = ctx.get("render_template")
    current_license_status = ctx.get("current_license_status")
    return render_template(
        "activation.html", license_info=current_license_status(update_state=False)
    )


def api_license_status(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    current_license_status = ctx.get("current_license_status")
    jsonify = ctx.get("jsonify", lambda v: v)
    info = current_license_status(update_state=False)
    keys = (
        "status",
        "mode",
        "message",
        "device_code",
        "organization",
        "expires_at",
        "license_id",
        "issued_at",
    )
    return jsonify({key: info.get(key) for key in keys})


def api_csrf_refresh(ctx: Any = None):
    """刷新 CSRF Token（用于长时间上传后 token 过期的情况）"""
    ctx = _ctx(ctx, depth=2)
    secrets_mod = ctx.get("secrets", secrets)
    session = ctx.get("session", {})
    jsonify = ctx.get("jsonify", lambda v: v)
    new_token = secrets_mod.token_urlsafe(32)
    session["csrf_token"] = new_token
    return jsonify({"csrf_token": new_token})


def api_me(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    User = ctx.get("User")
    session = ctx.get("session", {})
    jsonify = ctx.get("jsonify", lambda v: v)
    user = User.query.get(session["user_id"])
    if not user:
        return jsonify({"error": "用户不存在"}), 404
    return jsonify(user.to_dict())


def api_list_users(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    User = ctx.get("User")
    jsonify = ctx.get("jsonify", lambda v: v)
    users = User.query.order_by(User.id).all()
    return jsonify([u.to_dict() for u in users])


def _validate_account_payload(ctx: Any, endpoint: str, payload: Any) -> str | None:
    try:
        import business_input_validation
    except ModuleNotFoundError:
        from src.backend_patches import business_input_validation
    methods = ctx.get("METHODS", _DEFAULT_METHODS)
    return business_input_validation.validate_business_input(endpoint, payload, methods)


def api_reset_password(ctx_or_uid: Any, uid: int | None = None):
    if uid is None and isinstance(ctx_or_uid, int):
        uid = ctx_or_uid
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_uid, depth=2)
        uid = int(uid)
    User = ctx.get("User")
    db = ctx.get("db")
    request = ctx.get("request")
    jsonify = ctx.get("jsonify", lambda v: v)
    generate_password_hash = ctx.get("generate_password_hash", _default_generate_password_hash)
    if getattr(request, "method", "POST") != "DELETE":
        payload = request.get_json(silent=True)
        error = _validate_account_payload(ctx, "api_reset_password", payload)
        if error:
            return jsonify({"error": error}), 400
    user = User.query.get(uid)
    if not user:
        return jsonify({"error": "用户不存在"}), 404
    data = request.get_json(silent=True) or {}
    new_pwd = data.get("password") or ""
    if not new_pwd or len(new_pwd) < 8:
        return jsonify({"error": "密码至少 8 位"}), 400
    user.password_hash = generate_password_hash(new_pwd)
    db.session.commit()
    return jsonify({"ok": True})


def api_change_password(ctx: Any = None):
    ctx = _ctx(ctx, depth=2)
    User = ctx.get("User")
    db = ctx.get("db")
    session = ctx.get("session", {})
    request = ctx.get("request")
    jsonify = ctx.get("jsonify", lambda v: v)
    check_password_hash = ctx.get("check_password_hash", _default_check_password_hash)
    generate_password_hash = ctx.get("generate_password_hash", _default_generate_password_hash)
    if getattr(request, "method", "POST") != "DELETE":
        payload = request.get_json(silent=True)
        error = _validate_account_payload(ctx, "api_change_password", payload)
        if error:
            return jsonify({"error": error}), 400
    user = User.query.get(session["user_id"])
    if not user:
        return jsonify({"error": "用户不存在"}), 404
    data = request.get_json(silent=True) or {}
    old_pwd = data.get("old_password", "")
    new_pwd = data.get("new_password", "")
    if not check_password_hash(user.password_hash, old_pwd):
        return jsonify({"error": "原密码不正确"}), 400
    if not new_pwd or len(new_pwd) < 8:
        return jsonify({"error": "新密码至少 8 位"}), 400
    user.password_hash = generate_password_hash(new_pwd)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 5. Dual-Track Runtime Registration & Legacy Fallback Switch
# ---------------------------------------------------------------------------

def register(host_or_ctx: Any, app: Any = None) -> dict[str, Any]:
    """Install Stage 4A open-source auth/session/user handlers with legacy fallback."""
    ctx = _ctx(host_or_ctx, depth=2)
    flask_app = app or ctx.get("app")
    host = ctx.host_module

    legacy_helpers: dict[str, Any] = {}
    legacy_views: dict[str, Any] = {}

    if host is not None:
        for name in STAGE_4A_HELPER_NAMES:
            existing = ctx.get(name)
            if existing is not None:
                legacy_helpers[name] = existing

    if flask_app is not None and hasattr(flask_app, "view_functions"):
        for endpoint in STAGE_4A_ROUTE_ENDPOINTS:
            if endpoint in flask_app.view_functions:
                legacy_views[endpoint] = flask_app.view_functions[endpoint]

    def _bind_helper(name: str, open_fn: Any):
        def _bound(*args: Any, **kwargs: Any):
            if should_use_legacy_route(name) and name in legacy_helpers:
                return legacy_helpers[name](*args, **kwargs)
            return open_fn(ctx, *args, **kwargs)

        _bound.__name__ = name
        _bound._is_stage_4a_bound = True
        return _bound

    bound_helpers = {
        "_login_guard_key": _bind_helper("_login_guard_key", _login_guard_key),
        "_load_login_guard": _bind_helper("_load_login_guard", _load_login_guard),
        "_save_login_guard": _bind_helper("_save_login_guard", _save_login_guard),
        "_check_login_rate_limit": _bind_helper("_check_login_rate_limit", _check_login_rate_limit),
        "_record_login_failure": _bind_helper("_record_login_failure", _record_login_failure),
        "_clear_login_attempts": _bind_helper("_clear_login_attempts", _clear_login_attempts),
        "_active_admin_count": _bind_helper("_active_admin_count", _active_admin_count),
        "_validate_username": _bind_helper("_validate_username", _validate_username),
        "get_csrf_token": _bind_helper("get_csrf_token", get_csrf_token),
        "protect_api_writes": _bind_helper("protect_api_writes", protect_api_writes),
        "enforce_product_license": _bind_helper("enforce_product_license", enforce_product_license),
        "inject_brand_settings": _bind_helper("inject_brand_settings", inject_brand_settings),
        "inject_user": _bind_helper("inject_user", inject_user),
    }

    for name, fn in bound_helpers.items():
        ctx.set_symbol(name, fn, write_host=True)

    open_route_map: dict[str, tuple[Any, str | None]] = {
        "index": (lambda: index(ctx), "login"),
        "login": (lambda: login(ctx), None),
        "logout": (lambda: logout(ctx), None),
        "activation": (lambda: activation(ctx), None),
        "api_license_status": (lambda: api_license_status(ctx), None),
        "api_csrf_refresh": (lambda: api_csrf_refresh(ctx), "login"),
        "api_me": (lambda: api_me(ctx), "login"),
        "api_list_users": (lambda: api_list_users(ctx), "admin"),
        "api_reset_password": (lambda uid: api_reset_password(ctx, uid), "admin"),
        "api_change_password": (lambda: api_change_password(ctx), "login"),
    }

    installed_views: dict[str, Any] = {}
    if flask_app is not None and hasattr(flask_app, "view_functions"):
        login_dec = ctx.get("login_required") or (lambda f: login_required(ctx, f))
        admin_dec = ctx.get("admin_required") or (lambda f: admin_required(ctx, f))

        for endpoint, (raw_open_fn, guard_kind) in open_route_map.items():
            raw_open_fn.__name__ = endpoint
            if guard_kind == "login":
                open_view = login_dec(raw_open_fn)
            elif guard_kind == "admin":
                open_view = admin_dec(raw_open_fn)
            else:
                open_view = raw_open_fn

            def _make_dual_view(ep: str, open_handler: Any):
                def _dual_view(*args: Any, **kwargs: Any):
                    if should_use_legacy_route(ep) and ep in legacy_views:
                        return legacy_views[ep](*args, **kwargs)
                    return open_handler(*args, **kwargs)

                _dual_view.__name__ = ep
                _dual_view._is_stage_4a_bound = True
                return _dual_view

            dual_handler = _make_dual_view(endpoint, open_view)
            flask_app.view_functions[endpoint] = dual_handler
            ctx.set_symbol(endpoint, dual_handler, write_host=True)
            installed_views[endpoint] = dual_handler

        # Replace before_request & context_processor hooks in place if present
        before_funcs = getattr(flask_app, "before_request_funcs", None)
        if isinstance(before_funcs, dict):
            for scope_list in before_funcs.values():
                if isinstance(scope_list, list):
                    for idx, fn in enumerate(scope_list):
                        fn_name = getattr(fn, "__name__", "")
                        if fn_name in {"enforce_product_license", "protect_api_writes"}:
                            scope_list[idx] = bound_helpers[fn_name]

        ctx_procs = getattr(flask_app, "template_context_processors", None)
        if isinstance(ctx_procs, dict):
            for scope_list in ctx_procs.values():
                if isinstance(scope_list, list):
                    for idx, fn in enumerate(scope_list):
                        fn_name = getattr(fn, "__name__", "")
                        if fn_name in {"inject_brand_settings", "inject_user"}:
                            scope_list[idx] = bound_helpers[fn_name]

    registry_info = {
        "signature": STAGE_4A_SIGNATURE,
        "legacy_helpers": legacy_helpers,
        "legacy_views": legacy_views,
        "installed_views": list(installed_views.keys()),
        "installed_helpers": list(bound_helpers.keys()),
    }
    if flask_app is not None and hasattr(flask_app, "extensions"):
        flask_app.extensions["stage_4a_auth"] = registry_info
    return registry_info
