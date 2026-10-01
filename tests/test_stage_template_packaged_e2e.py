from __future__ import annotations

import html
import hashlib
import json
import os
import re
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
from html.parser import HTMLParser
from pathlib import Path

import requests
import psutil


ROOT = Path(__file__).resolve().parents[1]
PRODUCTION_ROOT = Path(os.environ.get("PM_TEST_LICENSE_DIR", "test-fixtures"))
METHODS = (
    "公开招标",
    "竞争性磋商",
    "竞争性谈判",
    "邀请招标",
    "网上竞价",
    "单一来源",
    "遴选",
    "直选",
)


class CsrfInputParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.token = ""
        self.meta_token = ""

    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if tag.casefold() == "input" and values.get("name") == "csrf_token":
            self.token = values.get("value") or ""
        if tag.casefold() == "meta" and values.get("name") == "csrf-token":
            self.meta_token = values.get("content") or ""


def unique_templates(prefix: str = "M") -> dict[str, list[dict]]:
    return {
        method: [
            {
                "id": f"{prefix}-{index}-start",
                "name": f"{method}专属开始",
                "icon": "🧭",
                "modules": ["common", "checklist", "auto_completion"],
            },
            {
                "id": f"{prefix}-{index}-finish",
                "name": f"{method}专属结束",
                "icon": "🏁",
                "modules": ["common", "archive"],
            },
        ]
        for index, method in enumerate(METHODS)
    }


def unused_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as listener:
        listener.bind(("127.0.0.1", 0))
        return int(listener.getsockname()[1])


class PackagedClient:
    def __init__(self, candidate: Path, root: Path, label: str, port: int):
        self.root = root / label
        self.data_root = self.root / "data"
        self.executable = self.root / "candidate.exe"
        self.port = port
        self.base_url = f"http://127.0.0.1:{port}"
        self.password = f"Packaged-{label}-Pass-2026!"
        self.process: subprocess.Popen | None = None
        self.session = requests.Session()
        self.session.trust_env = False
        self.csrf_token = ""
        self.root.mkdir(parents=True)
        self.data_root.mkdir()
        shutil.copy2(candidate, self.executable)
        for filename in ("license.dat", ".license_state.bin"):
            fixture_dir = os.environ.get("PM_TEST_LICENSE_DIR")
            source = Path(fixture_dir) / filename if fixture_dir else self.root / "missing-license-fixture" / filename
            if source.is_file():
                shutil.copy2(source, self.data_root / filename)

    def start(self) -> None:
        if self.process is not None:
            raise RuntimeError("candidate is already running")
        environment = os.environ.copy()
        environment.update(
            {
                "PROJECT_MGR_DATA_DIR": str(self.data_root),
                "PROJECT_MGR_DB_PATH": str(self.data_root / "bidding.db"),
                "PROJECT_MGR_PORT": str(self.port),
                "PROJECT_MGR_ADMIN_PASSWORD": self.password,
                "PROJECT_MGR_ALLOW_PARALLEL_TEST": "1",
            }
        )
        self.process = subprocess.Popen(
            [str(self.executable), "--startup-minimized"],
            cwd=str(self.root),
            env=environment,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=subprocess.CREATE_NEW_PROCESS_GROUP,
        )
        deadline = time.monotonic() + 45
        last_error: Exception | None = None
        while time.monotonic() < deadline:
            if self.process.poll() is not None:
                raise RuntimeError(f"candidate exited during startup: {self.process.returncode}")
            try:
                response = self.session.get(f"{self.base_url}/login", timeout=1)
                if response.status_code == 200:
                    self._login(response.text)
                    return
            except requests.RequestException as exc:
                last_error = exc
            time.sleep(0.2)
        raise RuntimeError(f"candidate did not become ready on {self.port}: {last_error}")

    def _login(self, login_html: str) -> None:
        parser = CsrfInputParser()
        parser.feed(login_html)
        login_data = {
            "username": "admin",
            "password": self.password,
        }
        if parser.token:
            login_data["csrf_token"] = html.unescape(parser.token)
        response = self.session.post(
            f"{self.base_url}/login",
            data=login_data,
            timeout=5,
        )
        response.raise_for_status()
        workspace_parser = CsrfInputParser()
        workspace_parser.feed(response.text)
        script_token = re.search(
            r'window\.CSRF_TOKEN\s*=\s*["\']([^"\']+)["\']', response.text
        )
        workspace_token = workspace_parser.meta_token or (
            script_token.group(1) if script_token else ""
        )
        if not workspace_token:
            compact = re.sub(r"\s+", " ", response.text[-600:])
            raise RuntimeError(
                "administrator login failed or workspace CSRF token is missing: "
                f"url={response.url} history={[item.status_code for item in response.history]} "
                f"tail={compact}"
            )
        self.csrf_token = html.unescape(workspace_token)

    def stop(self) -> None:
        process = self.process
        self.process = None
        self.session.close()
        self.session = requests.Session()
        self.session.trust_env = False
        self.csrf_token = ""
        if process is None:
            return
        expected = self.executable.resolve()
        owned = []
        for candidate_process in psutil.process_iter(["exe"]):
            try:
                executable = candidate_process.info.get("exe")
                if executable and Path(executable).resolve() == expected:
                    owned.append(candidate_process)
            except (OSError, psutil.Error):
                continue
        for owned_process in owned:
            try:
                owned_process.terminate()
            except psutil.Error:
                pass
        _, alive = psutil.wait_procs(owned, timeout=8)
        for owned_process in alive:
            try:
                owned_process.kill()
            except psutil.Error:
                pass
        psutil.wait_procs(alive, timeout=5)
        if process.poll() is None:
            process.wait(timeout=5)
        deadline = time.monotonic() + 10
        probe = self.executable.with_suffix(".release-probe.exe")
        while time.monotonic() < deadline:
            try:
                os.replace(self.executable, probe)
                os.replace(probe, self.executable)
                break
            except PermissionError:
                time.sleep(0.1)

    def restart(self) -> None:
        self.stop()
        self.start()

    def request(self, method: str, path: str, payload=None):
        headers = {"X-CSRFToken": self.csrf_token} if method != "GET" else {}
        response = self.session.request(
            method,
            f"{self.base_url}{path}",
            json=payload,
            headers=headers,
            timeout=10,
        )
        if response.status_code >= 400:
            raise AssertionError(f"{method} {path}: {response.status_code} {response.text[:500]}")
        return response.json()

    def patch_settings(self, payload: dict):
        return self.request("PATCH", "/api/settings", payload)

    def create_project(self, method: str, suffix: str):
        return self.request(
            "POST",
            "/api/projects",
            {
                "number": f"E2E-{suffix}",
                "name": f"打包验收-{method}-{suffix}",
                "method": method,
                "purchaser": "隔离测试采购人",
                "year": 2026,
            },
        )

    def get_project(self, project_id: int):
        return self.request("GET", f"/api/projects/{project_id}")

    def update_stage(self, project_id: int, stage_key: str, completed: bool):
        return self.request(
            "PUT",
            f"/api/projects/{project_id}/stages/{stage_key}",
            {"completed": completed},
        )


@unittest.skipUnless(
    os.environ.get("PM_TEST_CANDIDATE_EXE") and os.environ.get("PM_TEST_CANDIDATE_SHA256"),
    "packaged tests require an explicit hash-pinned candidate",
)
class PackagedStageTemplateTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.candidate = Path(os.environ["PM_TEST_CANDIDATE_EXE"])
        if not cls.candidate.is_file():
            raise FileNotFoundError(f"packaged candidate is required: {cls.candidate}")
        expected_sha256 = os.environ["PM_TEST_CANDIDATE_SHA256"].casefold()
        digest = hashlib.sha256(cls.candidate.read_bytes()).hexdigest()
        if digest != expected_sha256:
            raise RuntimeError(
                f"packaged candidate SHA-256 mismatch: expected={expected_sha256}, actual={digest}"
            )
        cls.temporary = tempfile.TemporaryDirectory(
            prefix="v5-stage-template-e2e-", ignore_cleanup_errors=True
        )
        cls.root = Path(cls.temporary.name).resolve()
        if PRODUCTION_ROOT.resolve() in cls.root.parents or cls.root == PRODUCTION_ROOT.resolve():
            raise RuntimeError("packaged test root must be outside the production data root")

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_packaged_candidate_applies_every_method_template(self):
        client = PackagedClient(self.candidate, self.root, "matrix", unused_port())
        try:
            client.start()
            initial_settings = client.request("GET", "/api/settings")
            self.assertIn(
                {"id": "auto_completion", "name": "到时自动完成", "singleton": False},
                initial_settings["stage_module_catalog"],
            )
            default_templates = initial_settings["stage_templates"]
            client.patch_settings({"stage_templates": default_templates})
            existing = client.create_project("公开招标", "existing-before-template")
            existing_before = client.get_project(existing["id"])
            existing_snapshot = [
                (stage["key"], stage["name"], stage["icon"], stage["modules"])
                for stage in existing_before["stages"]
            ]
            templates = unique_templates("M")
            client.patch_settings({"stage_templates": templates})
            client.restart()
            existing_after = client.get_project(existing["id"])
            self.assertEqual(
                [
                    (stage["key"], stage["name"], stage["icon"], stage["modules"])
                    for stage in existing_after["stages"]
                ],
                existing_snapshot,
                "saving a template must not rewrite an existing project",
            )
            for index, method in enumerate(METHODS):
                project = client.create_project(method, str(index))
                detail = client.get_project(project["id"])
                expected = [f"M-{index}-start", f"M-{index}-finish"]
                self.assertEqual([stage["key"] for stage in detail["stages"]], expected, method)
                self.assertEqual(detail["stages"][0]["name"], f"{method}专属开始")
                self.assertEqual(
                    [(stage["icon"], stage["modules"]) for stage in detail["stages"]],
                    [
                        ("🧭", ["common", "checklist", "auto_completion"]),
                        ("🏁", ["common", "archive"]),
                    ],
                    method,
                )
                listed = next(
                    row for row in client.request("GET", "/api/projects")
                    if row["id"] == project["id"]
                )
                self.assertEqual(
                    [
                        (stage["key"], stage["name"], stage["icon"], stage["modules"])
                        for stage in listed["stages"]
                    ],
                    [
                        (stage["key"], stage["name"], stage["icon"], stage["modules"])
                        for stage in detail["stages"]
                    ],
                    method,
                )
                client.update_stage(project["id"], expected[0], True)
                self.assertEqual(client.get_project(project["id"])["current_stage_key"], expected[1])
                client.update_stage(project["id"], expected[0], False)
                self.assertEqual(client.get_project(project["id"])["current_stage_key"], expected[0])

            sync_result = client.patch_settings({"stage_template_sync_method": "公开招标"})
            self.assertEqual(sync_result["sync_summary"]["failures"], 0)
            synced = client.get_project(existing["id"])
            active = [stage for stage in synced["stages"] if not stage["template_removed"]]
            removed = [stage for stage in synced["stages"] if stage["template_removed"]]
            self.assertEqual([stage["key"] for stage in active], ["M-0-start", "M-0-finish"])
            self.assertEqual(len(removed), len(existing_snapshot))
        finally:
            client.stop()

    def test_copied_exe_uses_independent_local_settings(self):
        first = PackagedClient(self.candidate, self.root, "machine-a", unused_port())
        second = PackagedClient(self.candidate, self.root, "machine-b", unused_port())
        try:
            first.start()
            first.patch_settings({"stage_templates": unique_templates("A")})
            first_project = first.create_project("公开招标", "A")
            self.assertTrue(first_project["stages"][0]["key"].startswith("A-"))
            first.stop()

            second.start()
            second.patch_settings({"stage_templates": unique_templates("B")})
            second_project = second.create_project("公开招标", "B")
            self.assertTrue(second_project["stages"][0]["key"].startswith("B-"))
            second.stop()

            first.start()
            settings = first.request("GET", "/api/settings")
            self.assertTrue(settings["stage_templates"]["公开招标"][0]["id"].startswith("A-"))
            persisted = first.get_project(first_project["id"])
            self.assertTrue(persisted["stages"][0]["key"].startswith("A-"))
        finally:
            first.stop()
            second.stop()

    def test_packaged_candidate_reads_current_daily_stage_runtime_status(self):
        client = PackagedClient(self.candidate, self.root, "mail-status", unused_port())
        legacy = {
            "last_check_at": "2026-08-25T17:21:18",
            "last_success_at": "2026-08-25T17:21:18",
            "last_error": None,
            "pending_count": 0,
        }
        current = {
            "version": 1,
            "deliveries": {},
            "last_check_at": "2026-09-02T10:22:43",
            "last_success_at": None,
            "last_error": "SMTP_SEND_FAILED",
            "pending_count": 0,
        }
        (client.data_root / "reminder_send_log.json").write_text(
            json.dumps(legacy), encoding="utf-8"
        )
        (client.data_root / "daily_stage_delivery_state.json").write_text(
            json.dumps(current), encoding="utf-8"
        )
        try:
            client.start()
            status = client.request("GET", "/api/settings")["reminder_runtime_status"]["daily_stage"]
            self.assertEqual(status["last_check_at"], "2026-09-02T10:22:43")
            self.assertEqual(status["error_code"], "SMTP_SEND_FAILED")
        finally:
            client.stop()


if __name__ == "__main__":
    unittest.main()
