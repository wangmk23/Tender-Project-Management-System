"""Stage 5 tests: Desktop host service, upload_limit_settings, open_data_security, and public_licensing parity."""
from __future__ import annotations

import io
import json
import marshal
import os
from pathlib import Path
import secrets
import tempfile
import types
import unittest
from unittest.mock import patch

from src.backend_patches import (
    desktop_host_service,
    open_data_security,
    public_licensing,
    upload_limit_settings,
)
from tools import build_candidate, compile_module_patches


BASELINE_EXE = Path(os.environ.get("PM_TEST_LEGACY_BASELINE_EXE", ""))


def _load_baseline_modules() -> dict[str, types.CodeType]:
    if not BASELINE_EXE.is_file():
        return {}
    reader = build_candidate.CArchiveReader(BASELINE_EXE)
    pyz_raw = reader.extract("PYZ.pyz")
    toc, _ = compile_module_patches._read_pyz(pyz_raw)
    out: dict[str, types.CodeType] = {}
    for mod_name in ("upload_limit_settings", "data_security", "licensing"):
        root = marshal.loads(compile_module_patches._pyz_entry(pyz_raw, toc, mod_name))
        out[mod_name] = root
    return out


BASELINE_MODULES = _load_baseline_modules()


class Stage5DesktopAndSecurityTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_upload_limit_settings_validation_and_stream_size(self) -> None:
        self.assertEqual(upload_limit_settings.normalize_upload_limit_mb(512), 512)
        with self.assertRaises(ValueError):
            upload_limit_settings.normalize_upload_limit_mb(True)
        with self.assertRaises(ValueError):
            upload_limit_settings.normalize_upload_limit_mb(0)
        with self.assertRaises(ValueError):
            upload_limit_settings.normalize_upload_limit_mb(4096)

        class FakeStorage:
            def __init__(self, data: bytes) -> None:
                self.stream = io.BytesIO(data)
                self.content_length = None

        st = FakeStorage(b"hello world")
        self.assertEqual(upload_limit_settings._file_storage_size(st), 11)
        self.assertEqual(st.stream.tell(), 0)

    @unittest.skipUnless(BASELINE_MODULES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_open_data_security_encrypt_and_decrypt(self) -> None:
        # Execute baseline data_security in isolated namespace with public_licensing mapped as licensing
        import sys
        core_ns: dict = {}
        with patch.dict(sys.modules, {"licensing": public_licensing, "sqlcipher3": types.SimpleNamespace()}):
            exec(BASELINE_MODULES["data_security"], core_ns)

        master_key = secrets.token_bytes(32)
        self.assertEqual(
            core_ns["attachment_key"](master_key),
            open_data_security.attachment_key(master_key),
        )
        att_key = open_data_security.attachment_key(master_key)

        sample_file = self.tmp_path / "sample.pdf"
        sample_bytes = b"%PDF-1.7 open-source vs compiled compatibility test payload " * 300
        sample_file.write_bytes(sample_bytes)

        # Encrypt with open_data_security, decrypt with compiled core_ns!
        self.assertTrue(open_data_security.encrypt_file(sample_file, att_key))
        self.assertTrue(core_ns["is_encrypted_file"](sample_file))
        self.assertEqual(core_ns["encrypted_file_size"](sample_file), len(sample_bytes))
        decrypted_by_core = b"".join(core_ns["iter_decrypted_file"](sample_file, att_key))
        self.assertEqual(decrypted_by_core, sample_bytes)

        # Encrypt with compiled core_ns, decrypt with open_data_security!
        sample_file2 = self.tmp_path / "sample2.pdf"
        sample_file2.write_bytes(sample_bytes)
        self.assertTrue(core_ns["encrypt_file"](sample_file2, att_key))
        self.assertTrue(open_data_security.is_encrypted_file(sample_file2))
        self.assertEqual(open_data_security.encrypted_file_size(sample_file2), len(sample_bytes))
        decrypted_by_open = b"".join(open_data_security.iter_decrypted_file(sample_file2, att_key))
        self.assertEqual(decrypted_by_open, sample_bytes)

    @unittest.skipUnless(BASELINE_MODULES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_public_licensing_dpapi_and_canonical_payload(self) -> None:
        core_lic: dict = {}
        exec(BASELINE_MODULES["licensing"], core_lic)

        payload = {"product": "hd-project-manager", "organization": "测试机构", "issued_at": "2026-11-16"}
        self.assertEqual(
            core_lic["canonical_payload"](payload),
            public_licensing.canonical_payload(payload),
        )

        secret_blob = b"stage-5-dpapi-roundtrip-check"
        protected = public_licensing._dpapi_protect(secret_blob)
        self.assertEqual(core_lic["_dpapi_unprotect"](protected), secret_blob)

        # Verify missing license returns identical structure
        res_core = core_lic["verify_license"](self.tmp_path, self.tmp_path, update_state=False)
        res_open = public_licensing.verify_license(self.tmp_path, self.tmp_path, update_state=False)
        self.assertEqual(res_core["status"], res_open["status"])
        self.assertEqual(res_core["mode"], res_open["mode"])
        self.assertEqual(res_core["device_code"], res_open["device_code"])
        self.assertEqual(res_core["machine_hash"], res_open["machine_hash"])

    def test_desktop_host_service_port_and_lan_info(self) -> None:
        class FakeAppObj:
            config: dict = {}

        class FakeServerApp:
            DATA_DIR = self.tmp_path
            app = FakeAppObj()

        with patch.dict(os.environ, {"PROJECT_MGR_PORT": "5188"}):
            self.assertEqual(desktop_host_service._find_port(), 5188)

        local_url, lan_url, info_path = desktop_host_service._write_lan_info(
            5188,
            server_app=FakeServerApp,
            lan_ip_fn=lambda: "192.168.1.88",
        )
        self.assertEqual(local_url, "http://127.0.0.1:5188")
        self.assertEqual(lan_url, "http://192.168.1.88:5188")
        self.assertTrue(info_path.is_file())
        self.assertIn("192.168.1.88:5188", info_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
