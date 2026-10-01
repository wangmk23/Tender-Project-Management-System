from __future__ import annotations

import hashlib
import html
import os
import shutil
import socket
import tempfile
import unittest
from html.parser import HTMLParser
from pathlib import Path

import requests
import sqlcipher3
import win32crypt

from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port


class CsrfParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.value = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag.casefold() == "input" and values.get("name") == "csrf_token":
            self.value = values.get("value") or ""


def lan_ip() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect(("8.8.8.8", 80))
        value = str(probe.getsockname()[0])
    finally:
        probe.close()
    if value.startswith("127."):
        raise RuntimeError("LAN address discovery returned loopback")
    return value


@unittest.skipUnless(
    os.environ.get("PM_TEST_CANDIDATE_EXE") and os.environ.get("PM_TEST_CANDIDATE_SHA256"),
    "packaged device admission test requires an explicit hash-pinned candidate",
)
class PackagedDeviceAdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = Path(os.environ["PM_TEST_CANDIDATE_EXE"]).resolve()
        digest = hashlib.sha256(cls.candidate.read_bytes()).hexdigest()
        expected = os.environ["PM_TEST_CANDIDATE_SHA256"].casefold()
        if digest != expected:
            raise RuntimeError(
                f"packaged candidate SHA-256 mismatch: expected={expected}, actual={digest}"
            )
        cls.temporary = tempfile.TemporaryDirectory(
            prefix="v5-device-admission-e2e-", ignore_cleanup_errors=True
        )
        cls.root = Path(cls.temporary.name)
        cls.host = lan_ip()

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_packaged_request_approval_restart_and_independent_data(self):
        first = PackagedClient(self.candidate, self.root, "first", unused_port())
        second = PackagedClient(self.candidate, self.root, "second", unused_port())
        remote = requests.Session()
        remote.trust_env = False
        try:
            first.start()
            remote_base = f"http://{self.host}:{first.port}"
            open_login = remote.get(f"{remote_base}/login", allow_redirects=False, timeout=5)
            self.assertEqual(open_login.status_code, 200)
            self.assertIn("device_observer_id", remote.cookies)
            observed = first.request("GET", "/api/device-access/observed-devices")
            self.assertEqual(len(observed["devices"]), 1)
            first.request("PATCH", "/api/device-access/config", {"enabled": True})
            blocked = remote.get(f"{remote_base}/", allow_redirects=False, timeout=5)
            self.assertEqual(blocked.status_code, 302)
            self.assertEqual(blocked.headers["Location"], "/request-access")

            api_blocked = remote.get(
                f"{remote_base}/api/projects", allow_redirects=False, timeout=5
            )
            self.assertEqual(api_blocked.status_code, 403)
            self.assertEqual(api_blocked.json()["code"], "device_not_approved")

            request_page = remote.get(f"{remote_base}/request-access", timeout=5)
            parser = CsrfParser()
            parser.feed(request_page.text)
            self.assertTrue(parser.value)
            self.assertNotIn("/static/app.js", request_page.text)
            self.assertEqual(request_page.headers["Cache-Control"], "no-store")
            self.assertEqual(request_page.headers["X-Frame-Options"], "DENY")
            self.assertEqual(request_page.headers["Server"], "ProjectManagementSystem")

            submitted = remote.post(
                f"{remote_base}/request-access",
                data={
                    "csrf_token": html.unescape(parser.value),
                    "applicant": "打包测试员",
                    "device_label": "隔离测试浏览器",
                    "reason": "验证设备准入",
                },
                timeout=5,
            )
            self.assertEqual(submitted.status_code, 200)

            pending = first.request("GET", "/api/device-access/requests?status=pending")
            self.assertEqual(len(pending["requests"]), 1)
            request_id = pending["requests"][0]["id"]
            first.request(
                "POST",
                f"/api/device-access/requests/{request_id}/approve",
                {"label": "隔离测试浏览器"},
            )

            approved = remote.get(f"{remote_base}/api/device-access/status", timeout=5)
            self.assertEqual(approved.json()["status"], "approved")
            self.assertIn("device_access_token", remote.cookies)
            login = remote.get(f"{remote_base}/login", allow_redirects=False, timeout=5)
            self.assertEqual(login.status_code, 200)

            first.restart()
            remote_base = f"http://{self.host}:{first.port}"
            after_restart = remote.get(
                f"{remote_base}/login", allow_redirects=False, timeout=5
            )
            self.assertEqual(after_restart.status_code, 200)

            first.stop()
            second.start()
            second.request("PATCH", "/api/device-access/config", {"enabled": True})
            second_base = f"http://{self.host}:{second.port}"
            isolated = remote.get(
                f"{second_base}/login", allow_redirects=False, timeout=5
            )
            self.assertEqual(isolated.status_code, 302)
            self.assertEqual(isolated.headers["Location"], "/request-access")
            summary = second.request("GET", "/api/device-access/summary")
            self.assertEqual(summary["pending"], 0)
            self.assertEqual(summary["devices"], 0)
            self.assertNotEqual(
                (first.data_root / "device_admission_key.dpapi").read_bytes(),
                (second.data_root / "device_admission_key.dpapi").read_bytes(),
            )
        finally:
            remote.close()
            first.stop()
            second.stop()

    def test_packaged_migration_preserves_old_browser_and_revocation(self):
        first = PackagedClient(self.candidate, self.root, "migration-old", unused_port())
        second = PackagedClient(self.candidate, self.root, "migration-new", unused_port())
        second.password = first.password
        remote = requests.Session()
        remote.trust_env = False
        fresh = requests.Session()
        fresh.trust_env = False
        try:
            first.start()
            first.request("PATCH", "/api/device-access/config", {"enabled": True})
            first_remote_base = f"http://{self.host}:{first.port}"
            request_page = remote.get(f"{first_remote_base}/request-access", timeout=5)
            parser = CsrfParser()
            parser.feed(request_page.text)
            submitted = remote.post(
                f"{first_remote_base}/request-access",
                data={
                    "csrf_token": html.unescape(parser.value),
                    "applicant": "迁移测试员",
                    "device_label": "原浏览器",
                    "reason": "验证跨电脑授权迁移",
                },
                timeout=5,
            )
            self.assertEqual(submitted.status_code, 200)
            pending = first.request("GET", "/api/device-access/requests?status=pending")
            request_id = pending["requests"][0]["id"]
            first.request(
                "POST",
                f"/api/device-access/requests/{request_id}/approve",
                {"label": "原浏览器"},
            )
            approved = remote.get(
                f"{first_remote_base}/api/device-access/status", timeout=5
            )
            self.assertEqual(approved.json()["status"], "approved")
            self.assertIn("device_access_token", remote.cookies)

            migration = first.request(
                "POST", "/api/device-access/keyring/export", {}
            )
            migration_code = migration["migration_code"]
            self.assertTrue(migration_code)
            first.stop()

            # The harness terminates the frozen process, so recent committed
            # rows may still live in SQLite's WAL.  A host migration copies the
            # complete database set, not only the main file.
            for source in first.data_root.glob("bidding.db*"):
                shutil.copy2(source, second.data_root / source.name)
            shutil.copy2(
                first.data_root / "data_key.dpapi",
                second.data_root / "data_key.dpapi",
            )
            master_key = win32crypt.CryptUnprotectData(
                (second.data_root / "data_key.dpapi").read_bytes(),
                None,
                None,
                None,
                0,
            )[1]
            with sqlcipher3.connect(str(second.data_root / "bidding.db")) as connection:
                connection.execute(f"PRAGMA key = \"x'{master_key.hex()}'\"")
                connection.execute("DELETE FROM device_admission_keys")
            self.assertFalse(
                (second.data_root / "device_admission_key.dpapi").exists()
            )

            second.start()
            second.request("PATCH", "/api/device-access/config", {"enabled": True})
            before_import = second.request(
                "GET", "/api/device-access/keyring/status"
            )
            self.assertEqual(before_import["key_count"], 1)
            blocked_old_browser = remote.get(
                f"http://{self.host}:{second.port}/login",
                allow_redirects=False,
                timeout=5,
            )
            self.assertEqual(blocked_old_browser.status_code, 302)
            self.assertEqual(
                blocked_old_browser.headers["Location"], "/request-access"
            )
            imported = second.request(
                "POST",
                "/api/device-access/keyring/import",
                {"migration_code": migration_code},
            )
            self.assertTrue(imported["imported"])
            self.assertEqual(imported["status"]["key_count"], 2)
            second_remote_base = f"http://{self.host}:{second.port}"
            old_browser = remote.get(
                f"{second_remote_base}/login", allow_redirects=False, timeout=5
            )
            self.assertEqual(old_browser.status_code, 200)

            unseen_browser = fresh.get(
                f"{second_remote_base}/login", allow_redirects=False, timeout=5
            )
            self.assertEqual(unseen_browser.status_code, 302)
            self.assertEqual(unseen_browser.headers["Location"], "/request-access")

            devices = second.request("GET", "/api/device-access/devices")
            self.assertEqual(len(devices["devices"]), 1)
            second.request(
                "DELETE",
                f"/api/device-access/devices/{devices['devices'][0]['id']}",
                {},
            )
            revoked = remote.get(
                f"{second_remote_base}/login", allow_redirects=False, timeout=5
            )
            self.assertEqual(revoked.status_code, 302)
            self.assertEqual(revoked.headers["Location"], "/request-access")
        finally:
            remote.close()
            fresh.close()
            first.stop()
            second.stop()


if __name__ == "__main__":
    unittest.main()
