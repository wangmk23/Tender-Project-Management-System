"""Security and behavior contracts for the host-side project folder service."""
import functools
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

from flask import Flask, jsonify, session

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "local_project_folders", ROOT / "src/backend_patches/local_project_folders.py")
module = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(module)


class FolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.parent = self.root / "项目资料"
        self.parent.mkdir()
        self.record = SimpleNamespace(id=1, number="GDHD-2026-068", name="东莞热电安保")
        self.admin = SimpleNamespace(id=1, is_admin=True, is_active=True)
        self.user = SimpleNamespace(id=2, is_admin=False, is_active=True)

        class DB:
            pass

        self.db = DB()
        self.db.session = SimpleNamespace(get=self.get_record)
        self.app = Flask(__name__)
        self.app.secret_key = "folder-tests"
        self.app.config["IS_DESKTOP"] = True

        def login_required(fn):
            @functools.wraps(fn)
            def wrapped(*args, **kwargs):
                if not session.get("user_id"):
                    return jsonify(error="请先登录"), 401
                return fn(*args, **kwargs)
            return wrapped

        self.open_calls = []
        module.register(self.app, self.db, Project=type("Project", (), {}),
                        User=type("User", (), {}), DATA_DIR=self.root,
                        login_required=login_required,
                        opener=lambda path: self.open_calls.append(path))
        self.client = self.app.test_client()
        with self.client.session_transaction() as state:
            state["user_id"] = 1
            state["csrf_token"] = "valid-csrf"

    def get_record(self, model, identifier):
        if model.__name__ == "Project":
            return self.record if identifier == 1 else None
        if model.__name__ == "User":
            return self.admin if identifier == 1 else self.user if identifier == 2 else None
        return None

    def write(self, method, url, body, *, remote="127.0.0.1", csrf="valid-csrf"):
        return self.client.open(url, method=method, json=body,
                                headers={"X-CSRFToken": csrf},
                                environ_overrides={"REMOTE_ADDR": remote})

    def test_create_scan_and_open(self):
        base = "/api/projects/1/local-folder"
        result = self.write("POST", base + "/create", {"parent_path": str(self.parent)})
        self.assertEqual(result.status_code, 200, result.get_json())
        target = Path(result.get_json()["path"])
        self.assertEqual(len([p for p in target.iterdir() if p.is_dir()]), 9)
        (target / "02_采购需求与原始资料" / "图纸.dwg").write_bytes(b"fake-dwg")
        scan = self.client.get(base + "/scan").get_json()
        self.assertEqual(scan["files"], 1)
        self.assertEqual(scan["bytes"], 8)
        self.assertIn("图纸.dwg", [item["name"] for item in scan["examples"]])
        self.assertEqual(self.write("POST", base + "/open", {}).status_code, 200)
        self.assertEqual(self.open_calls, [str(target)])

    def test_link_existing_folder_never_changes_contents(self):
        base = "/api/projects/1/local-folder"
        folder = self.parent / "已存在项目"
        folder.mkdir()
        file = folder / "招标文件.docx"
        file.write_bytes(b"important-data")
        result = self.write("PUT", base, {"path": str(folder)})
        self.assertEqual(result.status_code, 200, result.get_json())
        self.assertEqual(file.read_bytes(), b"important-data")
        result = self.write("PUT", base, {"path": ""})
        self.assertEqual(result.status_code, 200)
        self.assertEqual(file.read_bytes(), b"important-data")

    def test_no_remote_write_even_with_admin_and_valid_csrf(self):
        url = "/api/projects/1/local-folder"
        folder = self.parent / "远程不允许"
        folder.mkdir()
        self.assertEqual(self.write("PUT", url, {"path": str(folder)},
                                    remote="192.168.1.5").status_code, 403)
        self.assertFalse(self.client.get(url).get_json()["linked"])

    def test_csrf_and_active_admin_are_required(self):
        url = "/api/projects/1/local-folder"
        self.assertEqual(self.write("PUT", url, {"path": str(self.parent)},
                                    csrf="invalid").status_code, 400)
        with self.client.session_transaction() as state:
            state["user_id"] = 2
        self.assertEqual(self.write("PUT", url, {"path": str(self.parent)}).status_code, 403)

    def test_paths_must_be_absolute_and_links_cannot_escape(self):
        url = "/api/projects/1/local-folder"
        self.assertEqual(self.write("PUT", url, {"path": "../relative"}).status_code, 400)
        self.assertEqual(self.write("PUT", url, {"path": str(self.root)}).status_code, 200)
        outside = self.root / "outside"
        outside.mkdir()
        shortcut = self.root / "shortcut"
        try:
            shortcut.symlink_to(outside, target_is_directory=True)
        except (NotImplementedError, PermissionError, OSError):
            return
        self.assertEqual(self.write("PUT", url, {"path": str(shortcut)}).status_code, 400)

    def test_existing_target_and_corrupt_index_fail_closed(self):
        target = self.parent / "GDHD-2026-068_东莞热电安保"
        target.mkdir()
        result = self.write("POST", "/api/projects/1/local-folder/create",
                            {"parent_path": str(self.parent)})
        self.assertEqual(result.status_code, 409)
        self.assertFalse((target / module.STAGES[0]).exists())
        (self.root / "local_project_folders.json").write_text("{broken", encoding="utf-8")
        self.assertEqual(self.client.get("/api/projects/1/local-folder").status_code, 500)
        self.assertEqual(self.write("PUT", "/api/projects/1/local-folder",
                                    {"path": str(self.parent)}).status_code, 500)
        self.assertEqual((self.root / "local_project_folders.json").read_text(), "{broken")


if __name__ == "__main__":
    unittest.main()
