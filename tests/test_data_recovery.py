from __future__ import annotations

import base64
import json
import tempfile
import types
import unittest
from pathlib import Path

from flask import Flask

from src.backend_patches import data_recovery


class RecoveryMaterialTests(unittest.TestCase):
    def setUp(self):
        self.key = bytes(range(32))
        self.encoded = base64.urlsafe_b64encode(self.key).decode("ascii")

    def test_raw_key_and_legacy_json_decode_to_the_same_master_key(self):
        legacy = json.dumps({"format": 1, "key_base64": self.encoded})
        self.assertEqual(data_recovery.parse_recovery_material(self.encoded), self.key)
        self.assertEqual(data_recovery.parse_recovery_material(legacy), self.key)

    def test_invalid_or_oversized_material_is_rejected_without_echoing_secret(self):
        for value in ("", "not-base64", "A" * 9000):
            with self.subTest(value_length=len(value)):
                with self.assertRaises(data_recovery.RecoveryValidationError) as raised:
                    data_recovery.parse_recovery_material(value)
                if value:
                    self.assertNotIn(value, str(raised.exception))

    def test_binding_requires_the_current_master_key_and_atomically_rewraps_it(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "data_key.dpapi"
            target.write_bytes(b"old-wrapper")

            with self.assertRaisesRegex(
                data_recovery.RecoveryValidationError, "不匹配"
            ):
                data_recovery.bind_recovery_material(
                    root,
                    base64.urlsafe_b64encode(b"x" * 32).decode("ascii"),
                    expected_key=self.key,
                    protect=lambda raw: b"new-wrapper",
                )
            self.assertEqual(target.read_bytes(), b"old-wrapper")

            result = data_recovery.bind_recovery_material(
                root,
                self.encoded,
                expected_key=self.key,
                protect=lambda raw: b"new-wrapper" if raw == self.key else b"wrong",
            )
            self.assertEqual(result, {"bound": True})
            self.assertEqual(target.read_bytes(), b"new-wrapper")
            self.assertFalse(target.with_suffix(".dpapi.recovery-binding").exists())


class RecoveryRouteTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.key = bytes(range(32))
        self.encoded = base64.urlsafe_b64encode(self.key).decode("ascii")
        self.user = types.SimpleNamespace(id=7, is_admin=True, active=True)
        self.database = types.SimpleNamespace(
            session=types.SimpleNamespace(get=lambda model, user_id: self.user)
        )
        self.app = Flask(__name__)
        self.app.secret_key = "test-only"
        self.chosen_folder = None
        data_recovery.register(
            self.app,
            {
                "DATA_DIR": self.root,
                "MASTER_KEY": self.key,
                "db": self.database,
                "User": object,
                "protect_key": lambda raw: b"wrapped:" + raw,
                "get_export_dir": lambda: self.root / "exports",
                "choose_export_folder": lambda: self.chosen_folder,
            },
        )
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session["user_id"] = 7

    def tearDown(self):
        self.temporary.cleanup()

    def test_admin_can_bind_from_loopback_and_response_never_contains_key(self):
        response = self.client.post(
            "/api/data-recovery/bind", json={"recovery_key": self.encoded}
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json(), {"bound": True})
        self.assertNotIn(self.encoded, response.get_data(as_text=True))
        self.assertEqual(
            (self.root / "data_key.dpapi").read_bytes(), b"wrapped:" + self.key
        )

    def test_folder_selection_cancel_and_remote_restriction(self):
        response = self.client.post("/api/settings/choose-export-folder", json={})
        self.assertEqual(response.get_json(), {"path":None})
        self.chosen_folder = (str(self.root / "chosen"),)
        response = self.client.post("/api/settings/choose-export-folder", json={})
        self.assertEqual(response.get_json(), {"path":str(self.root / "chosen")})
        self.assertFalse((self.root / "chosen").exists())
        response = self.client.post("/api/settings/choose-export-folder", json={}, environ_base={"REMOTE_ADDR":"192.168.1.1"})
        self.assertEqual(response.status_code,403)

    def test_save_reports_only_existing_file_path_without_exposing_key(self):
        response = self.client.post("/api/data-recovery/save", json={})
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        target = Path(result["path"])
        self.assertTrue(result["saved"])
        self.assertEqual(target.parent, (self.root / "exports").resolve())
        self.assertEqual(data_recovery.parse_recovery_material(target.read_text(encoding="utf-8")), self.key)
        self.assertNotIn(self.encoded, response.get_data(as_text=True))
        second = self.client.post("/api/data-recovery/save", json={}).get_json()
        self.assertNotEqual(second["path"], result["path"])
        self.assertTrue(target.exists())

    def test_save_denies_remote_and_reports_unwritable_directory(self):
        response = self.client.post("/api/data-recovery/save", environ_base={"REMOTE_ADDR": "192.168.1.2"})
        self.assertEqual(response.status_code, 403)
        (self.root / "exports").write_text("not a directory")
        response = self.client.post("/api/data-recovery/save", json={})
        self.assertEqual(response.status_code, 500)
        self.assertNotIn(self.encoded, response.get_data(as_text=True))

    def test_export_preserves_current_key_and_can_bind_on_new_machine(self):
        response = self.client.post("/api/data-recovery/export", json={})
        self.assertEqual(response.status_code, 200)
        self.assertIn("no-store", response.headers["Cache-Control"])
        material = response.get_json()
        self.assertEqual(data_recovery.parse_recovery_material(json.dumps(material)), self.key)
        with tempfile.TemporaryDirectory() as destination:
            data_recovery.bind_recovery_material(destination, json.dumps(material),
                expected_key=self.key, protect=lambda raw: b"new-machine:" + raw)
            self.assertEqual((Path(destination) / "data_key.dpapi").read_bytes(), b"new-machine:" + self.key)
        self.assertFalse((self.root / "data_key.dpapi").exists())

    def test_exported_file_recovers_a_real_encrypted_database_after_machine_change(self):
        import sqlcipher3
        from unittest import mock
        from src.backend_patches import data_security_replacements as loader

        def connect(path, key, readonly=False):
            connection = sqlcipher3.connect(str(path))
            connection.execute('PRAGMA key = "x\'' + key.hex() + '\'"')
            return connection

        database_path = self.root / "bidding.db"
        connection = connect(database_path, self.key)
        connection.execute("CREATE TABLE migration_check (name TEXT)")
        connection.execute("INSERT INTO migration_check VALUES ('project-and-attachment-reference')")
        connection.commit()
        connection.close()
        (self.root / "data_key.dpapi").write_bytes(b"old-machine-wrapper")
        material = self.client.post("/api/data-recovery/export", json={}).get_json()
        with mock.patch.multiple(loader, KEY_FILE="data_key.dpapi",
            _dpapi_unprotect=mock.Mock(side_effect=OSError("different Windows account")),
            _dpapi_protect=lambda raw: b"new-machine-wrapper:" + raw,
            _usb_recovery_dir=lambda: None, RECOVERY_PREFIX="recovery-",
            connect_encrypted=connect, create=True), mock.patch.dict(__import__('sys').modules, {"data_recovery": data_recovery}), mock.patch.object(data_recovery, "prompt_for_recovery_material", return_value=json.dumps(material)):
            restored, _ = loader.load_or_create_master_key(self.root, existing_encrypted=True)
        self.assertEqual(restored, self.key)
        connection = connect(database_path, restored)
        self.assertEqual(connection.execute("SELECT name FROM migration_check").fetchone()[0], "project-and-attachment-reference")
        connection.close()
        self.assertEqual((self.root / "data_key.dpapi").read_bytes(), b"new-machine-wrapper:" + self.key)

    def test_export_denies_remote_inactive_non_admin_and_anonymous(self):
        for address in ["192.168.1.50", "::ffff:192.168.1.50"]:
            self.assertEqual(self.client.post("/api/data-recovery/export", environ_base={"REMOTE_ADDR": address}).status_code, 403)
        self.user.active = False
        self.assertEqual(self.client.post("/api/data-recovery/export").status_code, 403)
        self.user.active = True
        self.user.is_admin = False
        self.assertEqual(self.client.post("/api/data-recovery/export").status_code, 403)
        self.user.is_admin = True
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.client.post("/api/data-recovery/export").status_code, 403)
        self.assertEqual(self.client.get("/api/data-recovery/export").status_code, 405)

    def test_remote_and_non_admin_requests_fail_closed(self):
        remote = self.client.post(
            "/api/data-recovery/bind",
            json={"recovery_key": self.encoded},
            environ_base={"REMOTE_ADDR": "192.168.101.50"},
        )
        self.assertEqual(remote.status_code, 403)
        self.user.is_admin = False
        local_non_admin = self.client.post(
            "/api/data-recovery/bind", json={"recovery_key": self.encoded}
        )
        self.assertEqual(local_non_admin.status_code, 403)
        self.assertFalse((self.root / "data_key.dpapi").exists())


if __name__ == "__main__":
    unittest.main()
