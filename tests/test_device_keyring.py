from __future__ import annotations

import base64
import json
import sqlite3
import tempfile
import unittest
from contextlib import closing
from pathlib import Path

from src.backend_patches import device_keyring as subject


def connect_plain(path, _master_key, _read_only=False):
    return sqlite3.connect(str(path))


class DeviceKeyringTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.database = Path(self.temporary.name) / "keyring.db"
        self.master_key = b"m" * 32

    def tearDown(self):
        self.temporary.cleanup()

    def ring(self, master_key=None, limit=8):
        return subject.DeviceKeyring(
            self.database,
            connect_plain,
            self.master_key if master_key is None else master_key,
            limit=limit,
        )

    def test_enroll_round_trip_rotation_and_deduplication(self):
        ring = self.ring()
        first = ring.enroll(b"a" * 32, source="local_dpapi", primary=True)
        duplicate = ring.enroll(b"a" * 32, source="local_dpapi", primary=True)
        legacy = ring.enroll(b"b" * 32, source="migration_code", primary=False)

        self.assertEqual(first["key_id"], duplicate["key_id"])
        self.assertNotEqual(first["key_id"], legacy["key_id"])
        self.assertEqual(ring.primary_key(), b"a" * 32)
        self.assertEqual(ring.verification_keys(), [b"a" * 32, b"b" * 32])
        self.assertEqual(ring.status()["key_count"], 2)

        ring.enroll(b"b" * 32, source="migration_code", primary=True)
        self.assertEqual(ring.primary_key(), b"b" * 32)
        self.assertEqual(ring.verification_keys(), [b"b" * 32, b"a" * 32])

    def test_ciphertext_tampering_and_wrong_master_key_fail_closed(self):
        ring = self.ring()
        ring.enroll(b"a" * 32, source="local_dpapi", primary=True)
        with closing(sqlite3.connect(str(self.database))) as connection, connection:
            row = connection.execute(
                "SELECT id,ciphertext FROM device_admission_keys"
            ).fetchone()
            damaged = bytearray(row[1])
            damaged[-1] ^= 1
            connection.execute(
                "UPDATE device_admission_keys SET ciphertext=? WHERE id=?",
                (bytes(damaged), row[0]),
            )
        with self.assertRaises(subject.KeyringError):
            ring.verification_keys()
        with self.assertRaises(subject.KeyringError):
            self.ring(master_key=b"n" * 32).verification_keys()

    def test_corrupt_legacy_is_reported_without_blocking_valid_primary(self):
        ring = self.ring()
        ring.enroll(b"a" * 32, source="local_dpapi", primary=True)
        legacy = ring.enroll(b"b" * 32, source="migration_code", primary=False)
        with closing(sqlite3.connect(str(self.database))) as connection, connection:
            connection.execute(
                "UPDATE device_admission_keys SET ciphertext=? WHERE key_id=?",
                (b"broken", legacy["key_id"]),
            )

        entries, unavailable = ring.verification_entries_with_failures()
        self.assertEqual([secret for _, secret in entries], [b"a" * 32])
        self.assertEqual(
            unavailable,
            [{
                "error_code": "KEYRING_RECORD_AUTH_FAILED",
                "key_id_prefix": legacy["key_id"][:12],
            }],
        )

    def test_migration_code_is_authenticated_and_bound_to_master_key(self):
        code = subject.export_migration_code(b"a" * 32, self.master_key)
        self.assertNotIn(base64.urlsafe_b64encode(b"a" * 32).decode("ascii"), code)
        self.assertEqual(
            subject.import_migration_code(code, self.master_key), b"a" * 32
        )
        with self.assertRaises(subject.MigrationCodeError):
            subject.import_migration_code(code, b"n" * 32)

        raw = bytearray(base64.urlsafe_b64decode(code + "=" * (-len(code) % 4)))
        raw[-1] ^= 1
        tampered = base64.urlsafe_b64encode(bytes(raw)).decode("ascii").rstrip("=")
        with self.assertRaises(subject.MigrationCodeError):
            subject.import_migration_code(tampered, self.master_key)

    def test_invalid_material_and_key_limit_are_rejected(self):
        for size in (0, 31, 33):
            with self.subTest(device_key_size=size):
                with self.assertRaises(subject.KeyringError):
                    self.ring().enroll(b"x" * size, source="local_dpapi", primary=True)
        with self.assertRaises(subject.KeyringError):
            self.ring(master_key=b"m" * 31)
        with self.assertRaises(subject.MigrationCodeError):
            subject.import_migration_code("x" * 9000, self.master_key)
        with self.assertRaises(subject.MigrationCodeError):
            subject.import_migration_code("%%%not-base64%%%", self.master_key)

        ring = self.ring(limit=2)
        ring.enroll(b"a" * 32, source="local_dpapi", primary=True)
        ring.enroll(b"b" * 32, source="migration_code", primary=False)
        with self.assertRaises(subject.KeyringError):
            ring.enroll(b"c" * 32, source="migration_code", primary=False)

    def test_unknown_database_state_is_rejected(self):
        ring = self.ring()
        ring.enroll(b"a" * 32, source="local_dpapi", primary=True)
        with closing(sqlite3.connect(str(self.database))) as connection, connection:
            connection.execute(
                "UPDATE device_admission_keys SET state='unexpected'"
            )
        with self.assertRaises(subject.KeyringError):
            ring.verification_keys()


if __name__ == "__main__":
    unittest.main()
