"""Stage 4C tests: Shadow-mode bytecode parity & dual-track fallback for attachment lifecycle & encryption bridge."""
from __future__ import annotations

from datetime import datetime
import hashlib
import json
import marshal
import os
from pathlib import Path
import shutil
import sqlite3
import tempfile
import types
import unittest
from unittest.mock import patch
from urllib.parse import quote
import uuid

from src.backend_patches import (
    attachment_lifecycle_routes,
    data_safety,
    runtime_context,
)
from tools import build_candidate, compile_module_patches


BASELINE_EXE = Path(os.environ.get("PM_TEST_LEGACY_BASELINE_EXE", ""))


def _load_core_4c_code_objects() -> dict[str, types.CodeType]:
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


CORE_CODES = _load_core_4c_code_objects()


class FakeUploadedFile:
    def __init__(self, filename: str, content: bytes) -> None:
        self.filename = filename
        self._content = content

    def save(self, dst: str | Path) -> None:
        Path(dst).write_bytes(self._content)


class FakeMultiDict(dict):
    def get(self, key: str, default=None, type=None):  # noqa: A002
        val = super().get(key, default)
        if val is None or type is None:
            return val
        try:
            return type(val)
        except (TypeError, ValueError):
            return default


class FakeFilesDict(dict):
    def getlist(self, key: str):
        return list(self.get(key, []))


class FakeRequest:
    def __init__(
        self,
        *,
        args: dict | None = None,
        form: dict | None = None,
        files: dict | None = None,
        json_data: dict | None = None,
    ) -> None:
        self.args = FakeMultiDict(args or {})
        self.form = FakeMultiDict(form or {})
        self.files = FakeFilesDict(files or {})
        self._json = json_data

    def get_json(self, silent: bool = False):
        return self._json


class FakeResponse:
    def __init__(self, body, mimetype: str = "application/octet-stream", direct_passthrough: bool = False) -> None:
        self.body = b"".join(body) if not isinstance(body, (bytes, bytearray)) else bytes(body)
        self.mimetype = mimetype
        self.direct_passthrough = direct_passthrough
        self.content_length = None
        self.headers: dict[str, str] = {}

    def to_tuple(self):
        return (self.body, self.mimetype, self.direct_passthrough, self.content_length, dict(self.headers))


def _build_shadow_attachment_env(root_dir: Path, db_path: Path, *, encryption_enabled: bool = True):
    upload_dir = root_dir / "uploads"
    export_dir = root_dir / "exports"
    upload_dir.mkdir(parents=True, exist_ok=True)
    export_dir.mkdir(parents=True, exist_ok=True)

    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS attachments ("
        "id INTEGER PRIMARY KEY, "
        "project_id INTEGER NOT NULL, "
        "registration_id INTEGER, "
        "complaint_id INTEGER, "
        "clarification_id INTEGER, "
        "filename TEXT NOT NULL, "
        "stored_name TEXT NOT NULL, "
        "file_path TEXT NOT NULL, "
        "file_size INTEGER, "
        "mime_type TEXT, "
        "sha256 TEXT, "
        "uploaded_by INTEGER, "
        "description TEXT)"
    )
    conn.commit()

    attachments: list[object] = []

    class FakeColumn:
        def desc(self):
            return "desc"

    class FakeAttachment:
        uploaded_at = FakeColumn()

        def __init__(self, **kwargs) -> None:
            self.id = kwargs.get("id")
            self.project_id = kwargs.get("project_id")
            self.registration_id = kwargs.get("registration_id")
            self.complaint_id = kwargs.get("complaint_id")
            self.clarification_id = kwargs.get("clarification_id")
            self.filename = kwargs.get("filename", "")
            self.stored_name = kwargs.get("stored_name", "")
            self.file_path = kwargs.get("file_path", "")
            self.file_size = kwargs.get("file_size", 0)
            self.mime_type = kwargs.get("mime_type", "")
            self.sha256 = kwargs.get("sha256", "")
            self.uploaded_by = kwargs.get("uploaded_by", 0)
            self.description = kwargs.get("description", "")

        @property
        def extension(self) -> str:
            return Path(self.filename).suffix.lower().lstrip(".")

        def to_dict(self) -> dict:
            return {
                "id": self.id,
                "project_id": self.project_id,
                "registration_id": self.registration_id,
                "complaint_id": self.complaint_id,
                "clarification_id": self.clarification_id,
                "filename": self.filename,
                "stored_name": self.stored_name,
                "file_path": self.file_path,
                "file_size": self.file_size,
                "mime_type": self.mime_type,
                "sha256": self.sha256,
                "uploaded_by": self.uploaded_by,
                "description": self.description,
            }

    class FakeQuery:
        def __init__(self, items: list[FakeAttachment]) -> None:
            self._items = list(items)

        def filter_by(self, **kwargs) -> FakeQuery:
            return FakeQuery(
                [it for it in self._items if all(getattr(it, k, None) == v for k, v in kwargs.items())]
            )

        def order_by(self, *_args) -> FakeQuery:
            return FakeQuery(list(reversed(self._items)))

        def all(self) -> list[FakeAttachment]:
            return list(self._items)

        def first(self):
            return self._items[0] if self._items else None

    class _QueryDesc:
        def __get__(self, obj, owner):
            return FakeQuery(attachments)

    FakeAttachment.query = _QueryDesc()

    class FakeProject:
        def __init__(self) -> None:
            self.id = 1
            self.number = "PRJ-2026-001"

    p1 = FakeProject()

    class FakeSession:
        def add(self, att: FakeAttachment) -> None:
            if att.id is None:
                att.id = len(attachments) + 1
            if att not in attachments:
                attachments.append(att)

        def flush(self) -> None:
            for idx, att in enumerate(attachments, start=1):
                if att.id is None:
                    att.id = idx

        def commit(self) -> None:
            self.flush()
            conn.execute("DELETE FROM attachments")
            for att in attachments:
                conn.execute(
                    "INSERT INTO attachments ("
                    "id, project_id, registration_id, complaint_id, clarification_id, "
                    "filename, stored_name, file_path, file_size, mime_type, sha256, uploaded_by, description"
                    ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        att.id,
                        att.project_id,
                        att.registration_id,
                        att.complaint_id,
                        att.clarification_id,
                        att.filename,
                        att.stored_name,
                        att.file_path,
                        att.file_size,
                        att.mime_type,
                        att.sha256,
                        att.uploaded_by,
                        att.description,
                    ),
                )
            conn.commit()

    class FakeDB:
        session = FakeSession()

        @staticmethod
        def get_or_404(model_cls, pk: int):
            if model_cls is FakeProject and int(pk) == 1:
                return p1
            if model_cls is FakeAttachment:
                for a in attachments:
                    if a.id == int(pk):
                        return a
            raise LookupError(f"404: {model_cls}:{pk}")

    magic_prefix = b"PMENC1:"

    def fake_encrypt_file(path: str | Path, key: bytes) -> None:
        raw = Path(path).read_bytes()
        Path(path).write_bytes(magic_prefix + raw)

    def fake_is_encrypted_file(path: str | Path) -> bool:
        data = Path(path).read_bytes()
        return data.startswith(magic_prefix)

    def fake_iter_decrypted_file(path: str | Path, key: bytes):
        data = Path(path).read_bytes()
        if data.startswith(magic_prefix):
            yield data[len(magic_prefix) :]
        else:
            yield data

    def fake_encrypted_file_size(path: str | Path) -> int:
        data = Path(path).read_bytes()
        return len(data) - len(magic_prefix) if data.startswith(magic_prefix) else len(data)

    def fake_decrypt_file_to(src: str | Path, dst: str | Path, key: bytes) -> None:
        data = Path(src).read_bytes()
        plain = data[len(magic_prefix) :] if data.startswith(magic_prefix) else data
        Path(dst).write_bytes(plain)

    class FakeLogger:
        def warning(self, msg: str) -> None:
            pass

    class FakeApp:
        logger = FakeLogger()

    fixed_uuid = uuid.UUID("12345678-1234-5678-1234-567812345678")

    class FakeUUIDModule:
        @staticmethod
        def uuid4():
            return fixed_uuid

    fixed_now = datetime(2026, 11, 16, 15, 30, 0)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    env = {
        "app": FakeApp(),
        "db": FakeDB(),
        "Project": FakeProject,
        "SupplierRegistration": FakeAttachment,
        "Complaint": FakeAttachment,
        "Attachment": FakeAttachment,
        "UPLOAD_FOLDER": upload_dir,
        "ALLOWED_EXTENSIONS": {"pdf", "png", "docx", "txt"},
        "PREVIEW_EXTENSIONS": {"pdf", "png"},
        "MAX_FILE_SIZE": 1024 * 1024 * 1024,
        "DATA_ENCRYPTION_ENABLED": encryption_enabled,
        "ATTACHMENT_KEY": b"0" * 32,
        "encrypt_file": fake_encrypt_file,
        "is_encrypted_file": fake_is_encrypted_file,
        "iter_decrypted_file": fake_iter_decrypted_file,
        "encrypted_file_size": fake_encrypted_file_size,
        "decrypt_file_to": fake_decrypt_file_to,
        "send_file": lambda path, as_attachment=False, download_name=None, mimetype=None: (
            Path(path).read_bytes(),
            as_attachment,
            download_name,
            mimetype,
        ),
        "Response": FakeResponse,
        "stream_with_context": lambda gen: gen,
        "get_export_dir": lambda: export_dir,
        "request": FakeRequest(),
        "session": {"user_id": 1},
        "jsonify": lambda payload: payload,
        "abort": lambda code, description=None: (_ for _ in ()).throw(LookupError(f"HTTP {code}: {description}")),
        "log_operation": lambda *_a, **_kw: None,
        "Path": Path,
        "uuid": FakeUUIDModule,
        "hashlib": hashlib,
        "os": os,
        "shutil": shutil,
        "datetime": FixedDatetime,
    }
    env["allowed_file"] = lambda fn: attachment_lifecycle_routes.allowed_file(env, fn)
    env["generate_stored_filename"] = lambda fn: attachment_lifecycle_routes.generate_stored_filename(env, fn)
    env["sanitize_display_filename"] = lambda fn: attachment_lifecycle_routes.sanitize_display_filename(env, fn)
    env["get_upload_path"] = lambda pid: attachment_lifecycle_routes.get_upload_path(env, pid)
    env["_validate_file_path"] = lambda fp, rp: attachment_lifecycle_routes._validate_file_path(env, fp, rp)
    env["_delete_attachment_file"] = lambda att: attachment_lifecycle_routes._delete_attachment_file(env, att)
    env["_sha256_file"] = lambda p: attachment_lifecycle_routes._sha256_file(env, p)
    env["_encrypt_uploaded_file"] = lambda p: attachment_lifecycle_routes._encrypt_uploaded_file(env, p)
    env["_attachment_response"] = lambda p, att, as_download=False: attachment_lifecycle_routes._attachment_response(
        env, p, att, as_download=as_download
    )
    return env, conn


class Stage4CAttachmentRoutesParityTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run_core(self, env: dict, func_name: str, *args, **kwargs):
        fn = types.FunctionType(CORE_CODES[func_name], env)
        return fn(*args, **kwargs)

    @unittest.skipUnless(CORE_CODES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_helpers_and_path_traversal_guard(self) -> None:
        env_core, conn_core = _build_shadow_attachment_env(
            self.tmp_path / "core_h", self.tmp_path / "core_h.db"
        )
        env_open, conn_open = _build_shadow_attachment_env(
            self.tmp_path / "open_h", self.tmp_path / "open_h.db"
        )
        try:
            for sample in ("招标文件.pdf", "evil.exe", " ..危险..文件名..pdf ", ""):
                self.assertEqual(
                    self._run_core(env_core, "allowed_file", sample),
                    attachment_lifecycle_routes.allowed_file(env_open, sample),
                )
                self.assertEqual(
                    self._run_core(env_core, "sanitize_display_filename", sample),
                    attachment_lifecycle_routes.sanitize_display_filename(env_open, sample),
                )

            # Path traversal must be rejected identically with HTTP 400
            outside_core = self.tmp_path / "outside.txt"
            with self.assertRaises(LookupError) as ctx_core:
                self._run_core(env_core, "_validate_file_path", outside_core, "../outside.txt")
            with self.assertRaises(LookupError) as ctx_open:
                attachment_lifecycle_routes._validate_file_path(env_open, outside_core, "../outside.txt")
            self.assertEqual(str(ctx_core.exception), str(ctx_open.exception))
        finally:
            conn_core.close()
            conn_open.close()

    @unittest.skipUnless(CORE_CODES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_upload_list_download_view_save_and_update(self) -> None:
        env_core, conn_core = _build_shadow_attachment_env(
            self.tmp_path / "core_u", self.tmp_path / "core_u.db", encryption_enabled=True
        )
        env_open, conn_open = _build_shadow_attachment_env(
            self.tmp_path / "open_u", self.tmp_path / "open_u.db", encryption_enabled=True
        )
        try:
            fixed_uuid = uuid.UUID("12345678-1234-5678-1234-567812345678")
            with patch("uuid.uuid4", return_value=fixed_uuid):
                f_core = FakeUploadedFile("采购需求说明.pdf", b"%PDF-1.7 sample content")
                f_open = FakeUploadedFile("采购需求说明.pdf", b"%PDF-1.7 sample content")
                bad_core = FakeUploadedFile("script.bat", b"echo 1")
                bad_open = FakeUploadedFile("script.bat", b"echo 1")

                env_core["request"] = FakeRequest(
                    form={"description": "招标文件定稿"},
                    files={"files": [f_core, bad_core]},
                )
                env_open["request"] = FakeRequest(
                    form={"description": "招标文件定稿"},
                    files={"files": [f_open, bad_open]},
                )

                up_core = self._run_core(env_core, "api_upload_attachment", 1)
                up_open = attachment_lifecycle_routes.api_upload_attachment(env_open, 1)
                self.assertEqual(up_core, up_open)

            # List attachments parity
            env_core["request"] = FakeRequest(args={})
            env_open["request"] = FakeRequest(args={})
            self.assertEqual(
                self._run_core(env_core, "api_list_attachments", 1),
                attachment_lifecycle_routes.api_list_attachments(env_open, 1),
            )

            # Encrypted streaming download parity
            dl_core = self._run_core(env_core, "api_download_attachment", 1)
            dl_open = attachment_lifecycle_routes.api_download_attachment(env_open, 1)
            self.assertEqual(dl_core.to_tuple(), dl_open.to_tuple())
            self.assertEqual(dl_open.body, b"%PDF-1.7 sample content")

            # Encrypted inline view parity
            vw_core = self._run_core(env_core, "api_view_attachment", 1)
            vw_open = attachment_lifecycle_routes.api_view_attachment(env_open, 1)
            self.assertEqual(vw_core.to_tuple(), vw_open.to_tuple())

            # Save attachment local parity (decrypts to export_dir)
            sv_core = self._run_core(env_core, "api_save_attachment_local", 1)
            sv_open = attachment_lifecycle_routes.api_save_attachment_local(env_open, 1)
            self.assertEqual(sv_core["filename"], sv_open["filename"])
            self.assertEqual(Path(sv_core["path"]).read_bytes(), b"%PDF-1.7 sample content")
            self.assertEqual(Path(sv_open["path"]).read_bytes(), b"%PDF-1.7 sample content")

            # Update attachment filename (extension preservation) & description parity
            upd_req = FakeRequest(json_data={"filename": "更名后的采购需求.exe", "description": "新备注"})
            env_core["request"] = upd_req
            env_open["request"] = upd_req
            self.assertEqual(
                self._run_core(env_core, "api_update_attachment", 1),
                attachment_lifecycle_routes.api_update_attachment(env_open, 1),
            )

            self.assertEqual(
                data_safety.database_fingerprint(conn_core),
                data_safety.database_fingerprint(conn_open),
            )
        finally:
            conn_core.close()
            conn_open.close()

    def test_dual_track_fallback_switch_for_stage_4c(self) -> None:
        env, conn = _build_shadow_attachment_env(
            self.tmp_path / "dual_4c", self.tmp_path / "dual_4c.db"
        )
        try:
            class FakeFlaskApp:
                def __init__(self) -> None:
                    self.view_functions = {
                        "api_list_attachments": lambda pid: ({"legacy": True, "pid": pid}, 200)
                    }
                    self.extensions = {}

            fake_app = FakeFlaskApp()
            env["app"] = fake_app
            env["login_required"] = lambda f: f
            ctx = runtime_context.register_runtime_context(env, app=fake_app, db=env["db"])
            info = attachment_lifecycle_routes.register(ctx, fake_app)
            self.assertEqual(info["signature"], "attachment-lifecycle-routes-v1")
            self.assertIn("api_list_attachments", info["installed_views"])

            # Default open-source route active
            self.assertEqual(fake_app.view_functions["api_list_attachments"](1), [])

            # Legacy fallback active when PM_USE_LEGACY_CORE_ROUTES=all
            with patch.dict(os.environ, {"PM_USE_LEGACY_CORE_ROUTES": "all"}):
                self.assertEqual(
                    fake_app.view_functions["api_list_attachments"](1),
                    ({"legacy": True, "pid": 1}, 200),
                )
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
