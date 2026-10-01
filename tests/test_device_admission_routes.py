from __future__ import annotations

import re
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask, jsonify, make_response, redirect, render_template_string, request, session

from src.backend_patches import device_admission as subject
from src.backend_patches import device_access_page
from src.backend_patches import device_keyring


REMOTE = {"REMOTE_ADDR": "192.168.101.33"}
LOOPBACK = {"REMOTE_ADDR": "127.0.0.1"}


class FakeUser:
    def __init__(self, user_id, *, is_admin, is_active=True):
        self.id = user_id
        self.is_admin = is_admin
        self.is_active = is_active
        self.username = f"user-{user_id}"


class FakeSession:
    def __init__(self, users):
        self.users = users

    def get(self, model, user_id):
        return self.users.get(int(user_id))


class FakeDb:
    def __init__(self, users):
        self.session = FakeSession(users)


class DeviceAdmissionRouteTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.old_protect = subject._PROTECT_SECRET
        self.old_unprotect = subject._UNPROTECT_SECRET
        subject._PROTECT_SECRET = lambda raw: b"protected:" + raw
        subject._UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.addCleanup(self.restore_hooks)

        self.users = {
            1: FakeUser(1, is_admin=True),
            2: FakeUser(2, is_admin=False),
            3: FakeUser(3, is_admin=False),
        }
        self.app = Flask(__name__)
        self.app.secret_key = "route-test-secret"
        self.app.config.update(TESTING=True, DATABASE_PATH=str(self.root / "bidding.db"))

        @self.app.before_request
        def existing_login_gate():
            public = request.endpoint in {"login", "signed_download"} or str(
                request.endpoint or ""
            ).startswith("device_access_")
            if not public and not session.get("user_id"):
                return redirect("/login")

        @self.app.get("/login")
        def login():
            return "login"

        @self.app.get("/")
        def home():
            return "workspace"

        @self.app.get("/api/projects")
        def projects():
            return jsonify({"projects": []})

        @self.app.get("/api/public/attachments/<int:attachment_id>", endpoint="signed_download")
        def signed_download(attachment_id):
            return f"signed:{attachment_id}", 206

        self.runtime = {
            "DATA_DIR": self.root,
            "DB_PATH": self.root / "bidding.db",
            "MASTER_KEY": b"m" * 32,
            "User": FakeUser,
            "session": session,
            "request": request,
            "jsonify": jsonify,
            "redirect": redirect,
            "make_response": make_response,
            "render_template_string": render_template_string,
            "signed_attachment_endpoints": {"signed_download"},
        }
        self.service = subject.register(self.app, FakeDb(self.users), self.runtime)
        self.service.set_admission_enabled(True, actor_user_id=1)
        self.client = self.app.test_client()

    def restore_hooks(self):
        subject._PROTECT_SECRET = self.old_protect
        subject._UNPROTECT_SECRET = self.old_unprotect

    def test_anonymous_renderer_escapes_dynamic_content(self):
        markup = device_access_page.render_request_page(
            {"status": "new", "message": "<script>alert(1)</script>"},
            'token" autofocus onfocus="alert(2)',
        )
        self.assertNotIn("<script>alert(1)</script>", markup)
        self.assertNotIn('value="token" autofocus', markup)
        self.assertIn("&lt;script&gt;alert(1)&lt;/script&gt;", markup)

    def _request_form(self, *, applicant="张三", device_label="张三手机", reason="项目访问"):
        page = self.client.get("/request-access", environ_base=REMOTE)
        token = re.search(r'name="csrf_token" value="([^"]+)"', page.get_data(as_text=True)).group(1)
        response = self.client.post(
            "/request-access",
            data={
                "csrf_token": token,
                "applicant": applicant,
                "device_label": device_label,
                "reason": reason,
            },
            environ_base=REMOTE,
        )
        return response

    def _login(self, user_id, *, admin_claim=None, csrf="admin-csrf"):
        user = self.users[user_id]
        with self.client.session_transaction() as flask_session:
            flask_session["user_id"] = user_id
            flask_session["is_admin"] = user.is_admin if admin_claim is None else admin_claim
            flask_session["csrf_token"] = csrf

    def _authorize_remote_browser(self):
        self._request_form()
        request_id = self.service.list_requests()[0]["id"]
        self.service.approve(request_id, 1, "张三手机")
        status = self.client.get("/api/device-access/status", environ_base=REMOTE)
        self.assertEqual(status.get_json()["status"], "approved")

    def test_gate_is_first_and_handles_remote_loopback_and_signed_download(self):
        self.assertIs(self.app.before_request_funcs[None][0], self.app.extensions["device_admission_gate"])
        page = self.client.get("/", environ_base=REMOTE)
        self.assertEqual(page.status_code, 302)
        self.assertIn("/request-access", page.location)

        api = self.client.get("/api/projects", environ_base=REMOTE)
        self.assertEqual(api.status_code, 403)
        self.assertEqual(api.get_json()["code"], "device_not_approved")

        signed = self.client.get(
            "/api/public/attachments/1?expires=1&sig=x", environ_base=REMOTE
        )
        self.assertEqual(signed.status_code, 206)
        self.assertEqual(
            self.client.get("/static/app.js", environ_base=REMOTE).status_code, 302
        )
        self.assertEqual(self.client.get("/login", environ_base=LOOPBACK).status_code, 200)

    def test_admission_defaults_off_and_records_remote_browser_without_approving_it(self):
        self.service.set_admission_enabled(False, actor_user_id=1)
        page = self.client.get("/login", environ_base={**REMOTE, "HTTP_USER_AGENT": "Mozilla/5.0 (Linux; Android 14) Chrome/120 Mobile"})
        self.assertEqual(page.status_code, 200)
        self.assertIn("device_observer_id=", page.headers.get("Set-Cookie", ""))

        self._login(1)
        observed = self.client.get("/api/device-access/observed-devices", environ_base=LOOPBACK)
        self.assertEqual(observed.status_code, 200)
        rows = observed.get_json()["devices"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["last_ip"], REMOTE["REMOTE_ADDR"])
        self.assertIn("Android", rows[0]["client_label"])
        self.assertNotIn("observer_hash", rows[0])
        self.assertEqual(self.service.list_devices(), [])

    def test_open_mode_records_logged_in_account_and_toggle_restores_approval_gate(self):
        self.service.set_admission_enabled(False, actor_user_id=1)
        self.client.get("/login", environ_base=REMOTE)
        self._login(1)
        self.assertEqual(self.client.get("/", environ_base=REMOTE).status_code, 200)
        observed = self.client.get("/api/device-access/observed-devices", environ_base=LOOPBACK).get_json()["devices"]
        self.assertEqual(observed[0]["last_user_id"], 1)
        self.assertEqual(observed[0]["last_username"], "user-1")

        changed = self.client.patch(
            "/api/device-access/config",
            json={"enabled": True},
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(changed.status_code, 200)
        self.assertTrue(changed.get_json()["admission_enabled"])
        fresh = self.app.test_client()
        blocked = fresh.get("/", environ_base=REMOTE)
        self.assertEqual(blocked.status_code, 302)
        self.assertIn("/request-access", blocked.location)

    def test_config_write_requires_database_admin_and_csrf(self):
        self.service.set_admission_enabled(False, actor_user_id=1)
        self._login(2)
        denied = self.client.patch(
            "/api/device-access/config", json={"enabled": True},
            headers={"X-CSRFToken": "admin-csrf"}, environ_base=LOOPBACK,
        )
        self.assertEqual(denied.status_code, 403)
        self._login(1)
        missing = self.client.patch(
            "/api/device-access/config", json={"enabled": True}, environ_base=LOOPBACK,
        )
        self.assertEqual(missing.status_code, 403)

    def test_anonymous_page_submission_status_exchange_and_device_cookie(self):
        page = self.client.get("/request-access", environ_base=REMOTE)
        body = page.get_data(as_text=True)
        self.assertEqual(page.status_code, 200)
        self.assertIn("申请访问", body)
        self.assertNotIn("/static/app.js", body)
        self.assertIn("HttpOnly", page.headers.get("Set-Cookie", ""))
        self.assertIn("SameSite=Strict", page.headers.get("Set-Cookie", ""))

        bad = self.client.post(
            "/request-access",
            data={"csrf_token": "wrong", "applicant": "张三", "device_label": "手机"},
            environ_base=REMOTE,
        )
        self.assertEqual(bad.status_code, 403)

        submitted = self._request_form()
        self.assertEqual(submitted.status_code, 200)
        self.assertEqual(self.service.list_requests()[0]["status"], "pending")
        self.assertEqual(
            self.client.get("/api/device-access/status", environ_base=REMOTE).get_json()["status"],
            "pending",
        )

        request_id = self.service.list_requests()[0]["id"]
        self.service.approve(request_id, 1, "张三手机")
        approved = self.client.get("/api/device-access/status", environ_base=REMOTE)
        self.assertEqual(approved.get_json()["status"], "approved")
        cookies = approved.headers.getlist("Set-Cookie")
        self.assertTrue(any("device_access_token=" in value and "Max-Age=31536000" in value for value in cookies))
        self.assertTrue(any("device_access_lookup=;" in value for value in cookies))
        self.assertEqual(approved.headers["Cache-Control"], "no-store")

        self._login(2)
        workspace = self.client.get("/api/projects", environ_base=REMOTE)
        self.assertEqual(workspace.status_code, 200)

    def test_admin_reads_require_current_database_admin(self):
        self.assertEqual(self.client.get("/api/device-access/summary", environ_base=LOOPBACK).status_code, 401)
        self._login(2)
        self.assertEqual(self.client.get("/api/device-access/summary", environ_base=LOOPBACK).status_code, 403)
        self._login(3, admin_claim=True)
        self.assertEqual(self.client.get("/api/device-access/summary", environ_base=LOOPBACK).status_code, 403)
        self._login(1)
        summary = self.client.get("/api/device-access/summary", environ_base=LOOPBACK)
        self.assertEqual(summary.status_code, 200)
        self.assertEqual(summary.get_json()["pending"], 0)

    def test_admin_writes_require_csrf_and_support_full_lifecycle(self):
        self._request_form()
        request_id = self.service.list_requests()[0]["id"]
        self._login(1)
        missing_csrf = self.client.post(
            f"/api/device-access/requests/{request_id}/approve",
            json={"label": "批准设备"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(missing_csrf.status_code, 403)

        approved = self.client.post(
            f"/api/device-access/requests/{request_id}/approve",
            json={"label": "批准设备"},
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(approved.status_code, 200)
        self.client.get("/api/device-access/status", environ_base=REMOTE)
        devices = self.client.get("/api/device-access/devices", environ_base=LOOPBACK).get_json()["devices"]
        device_id = devices[0]["id"]

        for action, expected_enabled in (("disable", 0), ("enable", 1)):
            changed = self.client.post(
                f"/api/device-access/devices/{device_id}/{action}",
                headers={"X-CSRFToken": "admin-csrf"},
                environ_base=LOOPBACK,
            )
            self.assertEqual(changed.status_code, 200)
            self.assertEqual(changed.get_json()["device"]["enabled"], expected_enabled)

        revoked = self.client.delete(
            f"/api/device-access/devices/{device_id}",
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(revoked.status_code, 200)
        cannot_enable = self.client.post(
            f"/api/device-access/devices/{device_id}/enable",
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(cannot_enable.status_code, 409)

    def test_every_admin_write_rechecks_user_and_csrf(self):
        writes = (
            ("post", "/api/device-access/requests/999/approve", {"label": "设备"}),
            ("post", "/api/device-access/requests/999/reject", {"reason": "不批准"}),
            ("post", "/api/device-access/devices/999/disable", None),
            ("post", "/api/device-access/devices/999/enable", None),
            ("delete", "/api/device-access/devices/999", None),
            ("post", "/api/device-access/keyring/export", None),
            ("post", "/api/device-access/keyring/import", {"migration_code": "invalid"}),
            ("patch", "/api/device-access/config", {"enabled": True}),
        )
        for method, path, payload in writes:
            with self.client.session_transaction() as flask_session:
                flask_session.clear()
            with self.subTest(path=path, identity="anonymous"):
                response = getattr(self.client, method)(path, json=payload, environ_base=LOOPBACK)
                self.assertEqual(response.status_code, 401)
            self._login(2)
            with self.subTest(path=path, identity="member"):
                response = getattr(self.client, method)(
                    path, json=payload, headers={"X-CSRFToken": "admin-csrf"}, environ_base=LOOPBACK
                )
                self.assertEqual(response.status_code, 403)
            self._login(3, admin_claim=True)
            with self.subTest(path=path, identity="stale-admin-session"):
                response = getattr(self.client, method)(
                    path, json=payload, headers={"X-CSRFToken": "admin-csrf"}, environ_base=LOOPBACK
                )
                self.assertEqual(response.status_code, 403)
            self._login(1)
            with self.subTest(path=path, identity="missing-csrf"):
                response = getattr(self.client, method)(path, json=payload, environ_base=LOOPBACK)
                self.assertEqual(response.status_code, 403)

    def test_reject_requires_reason_and_updates_admin_lists(self):
        self._request_form(applicant="李四", device_label="李四电脑")
        request_id = self.service.list_requests()[0]["id"]
        self._login(1)
        missing = self.client.post(
            f"/api/device-access/requests/{request_id}/reject",
            json={},
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(missing.status_code, 400)
        rejected = self.client.post(
            f"/api/device-access/requests/{request_id}/reject",
            json={"reason": "设备信息不完整"},
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(rejected.status_code, 200)
        rows = self.client.get(
            "/api/device-access/requests?status=rejected", environ_base=LOOPBACK
        ).get_json()["requests"]
        self.assertEqual(rows[0]["status"], "rejected")

    def test_loopback_admin_can_import_migration_code_idempotently(self):
        self._login(1)
        before = self.client.get(
            "/api/device-access/keyring/status", environ_base=LOOPBACK
        )
        self.assertEqual(before.status_code, 200)
        self.assertTrue(before.get_json()["ready"])

        code = device_keyring.export_migration_code(b"z" * 32, b"m" * 32)
        for _ in range(2):
            response = self.client.post(
                "/api/device-access/keyring/import",
                json={"migration_code": code},
                headers={"X-CSRFToken": "admin-csrf"},
                environ_base=LOOPBACK,
            )
            self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.client.get(
                "/api/device-access/keyring/status", environ_base=LOOPBACK
            ).get_json()["legacy_count"],
            1,
        )

    def test_import_audit_failure_rolls_back_keyring_enrollment(self):
        self._login(1)
        self.client.get("/api/device-access/keyring/status", environ_base=LOOPBACK)
        before = self.service.keyring.status()["key_count"]
        code = device_keyring.export_migration_code(b"y" * 32, b"m" * 32)
        with patch.object(
            self.service, "_audit", side_effect=RuntimeError("audit failed")
        ), self.assertRaises(RuntimeError):
            self.client.post(
                "/api/device-access/keyring/import",
                json={"migration_code": code},
                headers={"X-CSRFToken": "admin-csrf"},
                environ_base=LOOPBACK,
            )
        self.assertEqual(self.service.keyring.status()["key_count"], before)

    def test_migration_routes_require_loopback_admin_and_csrf(self):
        self._login(1)
        self.assertEqual(
            self.client.get(
                "/api/device-access/keyring/status", environ_base=REMOTE
            ).status_code,
            403,
        )
        self.assertEqual(
            self.client.post(
                "/api/device-access/keyring/export", environ_base=LOOPBACK
            ).status_code,
            403,
        )
        self._login(2)
        self.assertEqual(
            self.client.get(
                "/api/device-access/keyring/status", environ_base=LOOPBACK
            ).status_code,
            403,
        )

    def test_export_code_round_trips_and_bad_import_preserves_keyring(self):
        self._login(1)
        exported = self.client.post(
            "/api/device-access/keyring/export",
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(exported.status_code, 200)
        code = exported.get_json()["migration_code"]
        self.assertEqual(
            device_keyring.import_migration_code(code, b"m" * 32),
            self.service.primary_secret,
        )
        before = self.service.keyring.status()
        failed = self.client.post(
            "/api/device-access/keyring/import",
            json={"migration_code": code[:-1] + "x"},
            headers={"X-CSRFToken": "admin-csrf"},
            environ_base=LOOPBACK,
        )
        self.assertEqual(failed.status_code, 400)
        self.assertEqual(
            self.service.keyring.status()["key_count"], before["key_count"]
        )

    def test_export_rejects_oversized_dpapi_backup_upload(self):
        import io

        self._login(1)
        response = self.client.post(
            "/api/device-access/keyring/export",
            data={
                "key_file": (
                    io.BytesIO(b"x" * 4097),
                    "device_admission_key.dpapi",
                )
            },
            headers={"X-CSRFToken": "admin-csrf"},
            content_type="multipart/form-data",
            environ_base=LOOPBACK,
        )
        self.assertEqual(response.status_code, 400)


if __name__ == "__main__":
    unittest.main()
