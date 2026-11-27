"""Stage 4A tests: Shadow-mode bytecode parity & dual-track fallback for auth, session, CSRF, and user routes."""
from __future__ import annotations

import copy
import json
import marshal
import os
from pathlib import Path
import secrets
import sqlite3
import tempfile
import threading
import types
import unittest
from unittest.mock import patch

from werkzeug.security import check_password_hash, generate_password_hash

from src.backend_patches import (
    auth_decorators,
    business_input_validation,
    data_safety,
    runtime_context,
)
from tools import build_candidate, compile_module_patches


BASELINE_EXE = Path(os.environ.get("PM_TEST_LEGACY_BASELINE_EXE", ""))


def _load_core_4a_code_objects() -> dict[str, types.CodeType]:
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


CORE_CODES = _load_core_4a_code_objects()


class FakeUser:
    def __init__(
        self,
        uid: int,
        username: str,
        password: str = "ValidPass123",
        *,
        is_admin: bool = False,
        is_active: bool = True,
        display_name: str = "",
    ) -> None:
        self.id = uid
        self.username = username
        self.password_hash = generate_password_hash(password)
        self.is_admin = is_admin
        self.is_active = is_active
        self.display_name = display_name or username

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "display_name": self.display_name,
            "is_admin": self.is_admin,
            "is_active": self.is_active,
        }


class FakeUserQuery:
    def __init__(self, users: list[FakeUser]) -> None:
        self._users = list(users)

    def get(self, uid: int) -> FakeUser | None:
        for u in self._users:
            if u.id == int(uid):
                return u
        return None

    def filter_by(self, **kwargs) -> FakeUserQuery:
        matched = [
            u
            for u in self._users
            if all(getattr(u, k) == v for k, v in kwargs.items())
        ]
        return FakeUserQuery(matched)

    def first(self) -> FakeUser | None:
        return self._users[0] if self._users else None

    def count(self) -> int:
        return len(self._users)

    def order_by(self, *_args) -> FakeUserQuery:
        return FakeUserQuery(sorted(self._users, key=lambda u: u.id))

    def all(self) -> list[FakeUser]:
        return list(self._users)


class SQLiteBackedUserSession:
    """Backs FakeUser mutations into a real SQLite table for database_fingerprint parity."""

    def __init__(self, conn: sqlite3.Connection, users: list[FakeUser]) -> None:
        self.conn = conn
        self.users = users
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS users ("
            "id INTEGER PRIMARY KEY, "
            "username VARCHAR(80) NOT NULL UNIQUE, "
            "password_hash VARCHAR(256) NOT NULL, "
            "display_name VARCHAR(100), "
            "is_admin BOOLEAN, "
            "is_active BOOLEAN)"
        )
        for u in self.users:
            self.conn.execute(
                "INSERT OR REPLACE INTO users (id, username, password_hash, display_name, is_admin, is_active) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (u.id, u.username, u.password_hash, u.display_name, int(u.is_admin), int(u.is_active)),
            )
        self.conn.commit()

    def get(self, _model, uid: int) -> FakeUser | None:
        for u in self.users:
            if u.id == int(uid):
                return u
        return None

    def commit(self) -> None:
        for u in self.users:
            self.conn.execute(
                "UPDATE users SET username=?, password_hash=?, display_name=?, is_admin=?, is_active=? WHERE id=?",
                (u.username, u.password_hash, u.display_name, int(u.is_admin), int(u.is_active), u.id),
            )
        self.conn.commit()


class Stage4AAuthAndUsersTests(unittest.TestCase):
    def setUp(self) -> None:
        if not CORE_CODES:
            self.skipTest("baseline v5.8.40 EXE is not available for shadow comparison")
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def _make_shadow_env(
        self,
        sub_dir: Path,
        *,
        users: list[FakeUser] | None = None,
        session_data: dict | None = None,
        request_obj: object | None = None,
        license_info: dict | None = None,
        license_required: bool = True,
        settings: dict | None = None,
        fixed_time: float = 1700000000.0,
        fixed_token: str = "fixed-csrf-token-value-1234567890",
    ):
        sub_dir.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(str(sub_dir / "shadow.db"))
        user_list = copy.deepcopy(users) if users is not None else [
            FakeUser(1, "admin", "AdminPass123", is_admin=True, is_active=True),
            FakeUser(2, "alice", "AlicePass123", is_admin=False, is_active=True),
            FakeUser(3, "disabled_bob", "BobPass123", is_admin=False, is_active=False),
        ]
        db_session = SQLiteBackedUserSession(conn, user_list)
        user_model = type("User", (), {"id": "id", "query": FakeUserQuery(user_list)})
        req = request_obj or types.SimpleNamespace(
            method="GET",
            path="/",
            endpoint="index",
            remote_addr="192.168.1.25",
            headers={},
            form={},
            get_json=lambda silent=True: {},
        )
        sess = dict(session_data or {})
        lic_payload = dict(
            license_info
            or {
                "status": "valid",
                "mode": "full",
                "message": "已激活",
                "device_code": "DEV-001",
                "organization": "测试单位",
                "expires_at": "2099-12-31",
                "license_id": "LIC-001",
                "issued_at": "2026-01-01",
                "extra_internal": "hidden",
            }
        )
        fake_secrets = types.SimpleNamespace(
            token_urlsafe=lambda _n=32: fixed_token,
            compare_digest=secrets.compare_digest,
        )
        fake_time = types.SimpleNamespace(time=lambda: fixed_time)

        env: dict = {
            "__builtins__": __builtins__,
            "json": json,
            "os": os,
            "time": fake_time,
            "secrets": fake_secrets,
            "DATA_DIR": sub_dir,
            "LOGIN_GUARD_PATH": sub_dir / "login_guard.json",
            "_LOGIN_GUARD_LOCK": threading.Lock(),
            "_MAX_LOGIN_ATTEMPTS": 5,
            "_LOGIN_LOCKOUT_SEC": 900,
            "LICENSE_REQUIRED": license_required,
            "current_license_status": lambda update_state=True: dict(lic_payload),
            "load_app_settings": lambda: dict(settings or {}),
            "User": user_model,
            "db": types.SimpleNamespace(session=db_session),
            "session": sess,
            "request": req,
            "jsonify": lambda v: v,
            "redirect": lambda url: ("REDIRECT", url),
            "render_template": lambda tpl, **kw: ("TEMPLATE", tpl, kw),
            "check_password_hash": check_password_hash,
            "generate_password_hash": lambda pwd: f"deterministic_hash:{pwd}",
            "METHODS": auth_decorators._DEFAULT_METHODS,
        }
        # Bind core helper functions into env so core functions calling each other work seamlessly
        for helper_name in (
            "_login_guard_key",
            "_load_login_guard",
            "_save_login_guard",
            "_check_login_rate_limit",
            "_record_login_failure",
            "_clear_login_attempts",
            "_active_admin_count",
            "_validate_username",
            "get_csrf_token",
        ):
            env[helper_name] = types.FunctionType(CORE_CODES[helper_name], env)
        return env, conn

    def _bind_core_fn(self, name: str, env: dict):
        code = CORE_CODES[name]
        if name in {"api_reset_password", "api_change_password"}:
            validator = business_input_validation.validate_business_input.__code__
            code = compile_module_patches.validated_business_handler(code, validator, name)
        return types.FunctionType(code, env)

    def test_shadow_parity_validate_username_and_active_admin_count(self) -> None:
        core_env, c_conn = self._make_shadow_env(self.root / "core_u")
        open_env, o_conn = self._make_shadow_env(self.root / "open_u")
        try:
            ctx = runtime_context.AppContextRegistry(open_env)
            core_validate = self._bind_core_fn("_validate_username", core_env)
            for sample in ("", "a", "a" * 33, "bad user!", "中文账号", "valid_user-01.test", "ab"):
                self.assertEqual(
                    core_validate(sample),
                    auth_decorators._validate_username(ctx, sample),
                    f"mismatch on {sample!r}",
                )
            core_count = self._bind_core_fn("_active_admin_count", core_env)
            self.assertEqual(core_count(), auth_decorators._active_admin_count(ctx))
        finally:
            c_conn.close()
            o_conn.close()

    def test_shadow_parity_login_rate_limit_and_lockout_lifecycle(self) -> None:
        core_env, c_conn = self._make_shadow_env(self.root / "core_rl", fixed_time=1000.0)
        open_env, o_conn = self._make_shadow_env(self.root / "open_rl", fixed_time=1000.0)
        try:
            # Remove core helpers from open_env so open implementation uses its own helpers
            for k in ("_login_guard_key", "_load_login_guard", "_save_login_guard", "_check_login_rate_limit", "_record_login_failure", "_clear_login_attempts"):
                open_env.pop(k, None)
            ctx = runtime_context.AppContextRegistry(open_env)

            for attempt in range(5):
                t_val = 1000.0 + attempt * 10
                core_env["time"] = types.SimpleNamespace(time=lambda v=t_val: v)
                open_env["time"] = types.SimpleNamespace(time=lambda v=t_val: v)
                c_rem = core_env["_record_login_failure"]("Alice")
                o_rem = auth_decorators._record_login_failure(ctx, "Alice")
                self.assertEqual(c_rem, o_rem)

            core_env["time"] = types.SimpleNamespace(time=lambda: 1050.0)
            open_env["time"] = types.SimpleNamespace(time=lambda: 1050.0)
            self.assertEqual(
                core_env["_check_login_rate_limit"]("alice"),
                auth_decorators._check_login_rate_limit(ctx, "alice"),
            )
            self.assertEqual(
                json.loads((self.root / "core_rl" / "login_guard.json").read_text("utf-8")),
                json.loads((self.root / "open_rl" / "login_guard.json").read_text("utf-8")),
            )

            core_env["_clear_login_attempts"]("ALICE")
            auth_decorators._clear_login_attempts(ctx, "ALICE")
            self.assertEqual(
                core_env["_check_login_rate_limit"]("alice"),
                auth_decorators._check_login_rate_limit(ctx, "alice"),
            )
        finally:
            c_conn.close()
            o_conn.close()

    def test_shadow_parity_csrf_protection_and_context_processors(self) -> None:
        scenarios = [
            ("GET", "/api/projects", "api_projects", {}, {}),
            ("POST", "/api/csrf-refresh", "api_csrf_refresh", {}, {}),
            ("POST", "/api/projects", "api_create_project", {}, {}),
            ("POST", "/api/projects", "api_create_project", {"csrf_token": "tok1"}, {"X-CSRFToken": "wrong"}),
            ("DELETE", "/api/projects/1", "api_delete_project", {"csrf_token": "tok1"}, {"X-CSRFToken": "tok1"}),
        ]
        for idx, (method, path, endpoint, sess, headers) in enumerate(scenarios):
            req = types.SimpleNamespace(method=method, path=path, endpoint=endpoint, headers=headers)
            core_env, c_conn = self._make_shadow_env(self.root / f"c_csrf_{idx}", session_data=sess, request_obj=req)
            open_env, o_conn = self._make_shadow_env(self.root / f"o_csrf_{idx}", session_data=sess, request_obj=req)
            try:
                open_env.pop("get_csrf_token", None)
                ctx = runtime_context.AppContextRegistry(open_env)
                c_res = self._bind_core_fn("protect_api_writes", core_env)()
                o_res = auth_decorators.protect_api_writes(ctx)
                self.assertEqual(c_res, o_res)

                c_brand = self._bind_core_fn("inject_brand_settings", core_env)()
                o_brand = auth_decorators.inject_brand_settings(ctx)
                self.assertEqual(o_brand, {"login_subtitle": "招标项目管理"})

                core_env["session"]["user_id"] = 1
                open_env["session"]["user_id"] = 1
                c_user = self._bind_core_fn("inject_user", core_env)()
                o_user = auth_decorators.inject_user(ctx)
                self.assertEqual(c_user, o_user)

                c_ref = self._bind_core_fn("api_csrf_refresh", core_env)()
                o_ref = auth_decorators.api_csrf_refresh(ctx)
                self.assertEqual(c_ref, o_ref)
            finally:
                c_conn.close()
                o_conn.close()

    def test_shadow_parity_license_enforcement_and_status_routes(self) -> None:
        modes = [
            ("full", "GET", "/", "index"),
            ("blocked", "GET", "/", "index"),
            ("blocked", "GET", "/api/projects", "api_projects"),
            ("blocked", "GET", "/activation", "activation"),
            ("read_only", "GET", "/api/projects", "api_projects"),
            ("read_only", "POST", "/api/projects", "api_create_project"),
            ("read_only", "POST", "/login", "login"),
        ]
        for idx, (mode, method, path, endpoint) in enumerate(modes):
            req = types.SimpleNamespace(method=method, path=path, endpoint=endpoint, headers={})
            lic = {
                "status": mode,
                "mode": mode,
                "message": f"状态:{mode}",
                "device_code": "DEV-XYZ",
                "organization": "Org",
                "expires_at": "2027-01-01",
                "license_id": "L-1",
                "issued_at": "2026-01-01",
            }
            core_env, c_conn = self._make_shadow_env(self.root / f"c_lic_{idx}", request_obj=req, license_info=lic)
            open_env, o_conn = self._make_shadow_env(self.root / f"o_lic_{idx}", request_obj=req, license_info=lic)
            try:
                ctx = runtime_context.AppContextRegistry(open_env)
                self.assertEqual(
                    self._bind_core_fn("enforce_product_license", core_env)(),
                    auth_decorators.enforce_product_license(ctx),
                )
                self.assertEqual(
                    self._bind_core_fn("activation", core_env)(),
                    auth_decorators.activation(ctx),
                )
                self.assertEqual(
                    self._bind_core_fn("api_license_status", core_env)(),
                    auth_decorators.api_license_status(ctx),
                )
            finally:
                c_conn.close()
                o_conn.close()

    def test_shadow_parity_login_logout_and_index_routes(self) -> None:
        login_cases = [
            ("GET", {}),
            ("POST", {"username": "admin", "password": "WrongPassword"}),
            ("POST", {"username": "disabled_bob", "password": "BobPass123"}),
            ("POST", {"username": "admin", "password": "AdminPass123"}),
        ]
        for idx, (method, form) in enumerate(login_cases):
            req_c = types.SimpleNamespace(method=method, path="/login", endpoint="login", remote_addr="10.0.0.1", form=dict(form))
            req_o = types.SimpleNamespace(method=method, path="/login", endpoint="login", remote_addr="10.0.0.1", form=dict(form))
            core_env, c_conn = self._make_shadow_env(self.root / f"c_login_{idx}", request_obj=req_c)
            open_env, o_conn = self._make_shadow_env(self.root / f"o_login_{idx}", request_obj=req_o)
            try:
                for k in ("_login_guard_key", "_load_login_guard", "_save_login_guard", "_check_login_rate_limit", "_record_login_failure", "_clear_login_attempts"):
                    open_env.pop(k, None)
                ctx = runtime_context.AppContextRegistry(open_env)
                self.assertEqual(
                    self._bind_core_fn("login", core_env)(),
                    auth_decorators.login(ctx),
                )
                self.assertEqual(core_env["session"], open_env["session"])
                self.assertEqual(
                    self._bind_core_fn("index", core_env)(),
                    auth_decorators.index(ctx),
                )
                self.assertEqual(
                    self._bind_core_fn("logout", core_env)(),
                    auth_decorators.logout(ctx),
                )
                self.assertEqual(core_env["session"], open_env["session"])
            finally:
                c_conn.close()
                o_conn.close()

    def test_shadow_parity_user_endpoints_and_database_fingerprint(self) -> None:
        # Test api_me, api_list_users, api_reset_password, api_change_password + DB fingerprint
        shared_users = [
            FakeUser(1, "admin", "AdminPass123", is_admin=True, is_active=True),
            FakeUser(2, "alice", "AlicePass123", is_admin=False, is_active=True),
            FakeUser(3, "disabled_bob", "BobPass123", is_admin=False, is_active=False),
        ]
        core_env, c_conn = self._make_shadow_env(self.root / "c_users", users=shared_users, session_data={"user_id": 2})
        open_env, o_conn = self._make_shadow_env(self.root / "o_users", users=shared_users, session_data={"user_id": 2})
        try:
            ctx = runtime_context.AppContextRegistry(open_env)
            self.assertEqual(
                self._bind_core_fn("api_me", core_env)(),
                auth_decorators.api_me(ctx),
            )
            self.assertEqual(
                self._bind_core_fn("api_list_users", core_env)(),
                auth_decorators.api_list_users(ctx),
            )

            # 1. Reset password error & success cases
            for payload in (
                {"password": 123},
                {"password": "short"},
                {"password": "NewStrongPass888"},
            ):
                core_env["request"] = types.SimpleNamespace(method="POST", get_json=lambda silent=True, p=payload: dict(p))
                open_env["request"] = types.SimpleNamespace(method="POST", get_json=lambda silent=True, p=payload: dict(p))
                c_out = self._bind_core_fn("api_reset_password", core_env)(2)
                o_out = auth_decorators.api_reset_password(ctx, 2)
                self.assertEqual(c_out, o_out)
                self.assertEqual(
                    data_safety.database_fingerprint(c_conn),
                    data_safety.database_fingerprint(o_conn),
                )

            # 2. Change password error & success cases
            # Reset user 2 back to known werkzeug password hash on both sides
            known_hash = generate_password_hash("CurrentPass123")
            core_env["db"].session.get(None, 2).password_hash = known_hash
            open_env["db"].session.get(None, 2).password_hash = known_hash
            core_env["db"].session.commit()
            open_env["db"].session.commit()

            for payload in (
                {"old_password": 123, "new_password": "ValidNewPassword9"},
                {"old_password": "WrongOld", "new_password": "ValidNewPassword9"},
                {"old_password": "CurrentPass123", "new_password": "short"},
                {"old_password": "CurrentPass123", "new_password": "ValidNewPassword9"},
            ):
                core_env["request"] = types.SimpleNamespace(method="POST", get_json=lambda silent=True, p=payload: dict(p))
                open_env["request"] = types.SimpleNamespace(method="POST", get_json=lambda silent=True, p=payload: dict(p))
                c_out = self._bind_core_fn("api_change_password", core_env)()
                o_out = auth_decorators.api_change_password(ctx)
                self.assertEqual(c_out, o_out)
                self.assertEqual(
                    data_safety.database_fingerprint(c_conn),
                    data_safety.database_fingerprint(o_conn),
                )
        finally:
            c_conn.close()
            o_conn.close()

    def test_dual_track_registration_and_legacy_fallback_switch(self) -> None:
        env, conn = self._make_shadow_env(self.root / "dual_track", session_data={"user_id": 1})
        try:
            legacy_calls: list[str] = []
            fake_app = types.SimpleNamespace(
                view_functions={
                    "api_me": lambda: (legacy_calls.append("api_me") or {"source": "legacy_core"}),
                    "login": lambda: (legacy_calls.append("login") or "legacy_login"),
                },
                before_request_funcs={None: []},
                template_context_processors={None: []},
                extensions={},
            )
            env["app"] = fake_app
            env["login_required"] = lambda fn: fn
            env["admin_required"] = lambda fn: fn
            ctx = runtime_context.register_runtime_context(env, app=fake_app, db=env["db"])
            info = auth_decorators.register(ctx, fake_app)
            self.assertEqual(info["signature"], "stage-4a-auth-users-v1")

            # Default: open-source route handles api_me
            with patch.dict(os.environ, {"PM_USE_LEGACY_CORE_ROUTES": ""}, clear=False):
                me_payload = fake_app.view_functions["api_me"]()
                self.assertEqual(me_payload["username"], "admin")
                self.assertEqual(legacy_calls, [])

            # Per-endpoint fallback: PM_USE_LEGACY_CORE_ROUTES=api_me
            with patch.dict(os.environ, {"PM_USE_LEGACY_CORE_ROUTES": "api_me"}, clear=False):
                me_payload = fake_app.view_functions["api_me"]()
                self.assertEqual(me_payload, {"source": "legacy_core"})
                self.assertEqual(legacy_calls, ["api_me"])

            # Global fallback: PM_USE_LEGACY_CORE_ROUTES=1
            with patch.dict(os.environ, {"PM_USE_LEGACY_CORE_ROUTES": "1"}, clear=False):
                login_out = fake_app.view_functions["login"]()
                self.assertEqual(login_out, "legacy_login")
                self.assertEqual(legacy_calls, ["api_me", "login"])
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
