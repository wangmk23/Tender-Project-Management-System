from __future__ import annotations

import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path

from src.backend_patches import device_admission as subject
from src.backend_patches import device_keyring


class MutableClock:
    def __init__(self, value: datetime):
        self.value = value

    def __call__(self) -> datetime:
        return self.value


class DeviceAdmissionTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp_dir.cleanup)
        self.root = Path(self.temp_dir.name)
        self.database_path = self.root / "bidding.db"
        self.clock = MutableClock(datetime(2026, 9, 7, 9, 0, tzinfo=timezone.utc))
        self.tokens = iter((
            "device-token-first",
            "device-token-second",
            "device-token-third",
        ))
        self.old_protect = subject._PROTECT_SECRET
        self.old_unprotect = subject._UNPROTECT_SECRET
        subject._PROTECT_SECRET = lambda raw: b"protected:" + raw
        subject._UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.addCleanup(self.restore_hooks)
        self.service = subject.DeviceAdmissionService(
            self.database_path,
            self.root,
            clock=self.clock,
            token_factory=lambda: next(self.tokens),
        )

    def restore_hooks(self):
        subject._PROTECT_SECRET = self.old_protect
        subject._UNPROTECT_SECRET = self.old_unprotect

    def connect(self):
        connection = sqlite3.connect(self.database_path)
        connection.row_factory = sqlite3.Row
        return connection

    def submit(self, lookup="lookup-one-secret-value", ip="192.168.101.33"):
        return self.service.submit_request(ip, lookup, "张三", "张三手机", "项目访问")

    def test_schema_is_idempotent_and_never_stores_raw_credentials(self):
        self.service.ensure_schema()
        self.service.ensure_schema()
        request_row = self.submit()

        with closing(self.connect()) as connection:
            tables = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                )
            }
            indexes = {
                row[0]
                for row in connection.execute(
                    "SELECT name FROM sqlite_master WHERE type='index'"
                )
            }
            values = " ".join(
                str(value)
                for table in (
                    "device_access_requests",
                    "approved_devices",
                    "device_access_audit",
                )
                for row in connection.execute(f"SELECT * FROM {table}")
                for value in row
            )

        self.assertTrue({
            "device_access_requests", "approved_devices", "device_access_audit"
        }.issubset(tables))
        self.assertIn("ix_device_requests_status_created", indexes)
        self.assertEqual(request_row["status"], "pending")
        self.assertNotIn("lookup-one-secret-value", values)
        self.assertTrue((self.root / "device_admission_key.dpapi").is_file())

    def test_pending_request_is_reused_and_fields_are_validated(self):
        first = self.submit()
        second = self.service.submit_request(
            "192.168.101.44", "lookup-one-secret-value", "李四", "另一名称", "另一事由"
        )
        self.assertEqual(second["id"], first["id"])
        self.assertEqual(second["applicant"], "张三")
        self.assertEqual(second["last_ip"], "192.168.101.44")

        invalid = (
            ("", "设备", "事由"),
            ("姓" * 21, "设备", "事由"),
            ("姓名", "", "事由"),
            ("姓名", "设" * 41, "事由"),
            ("姓名", "设备", "事" * 201),
        )
        for index, fields in enumerate(invalid):
            with self.subTest(fields=fields), self.assertRaises(subject.ValidationError):
                self.service.submit_request(
                    "192.168.101.45", f"lookup-invalid-{index}", *fields
                )

    def test_observed_browser_is_hashed_and_activity_writes_are_throttled(self):
        token = self.service.issue_observer_token()
        self.assertTrue(self.service.verify_observer_token(token))
        self.assertFalse(self.service.verify_observer_token(token + "x"))
        first = self.service.observe_device(
            token, "192.168.101.50", "Mozilla/5.0 (Windows NT 10.0) Chrome/120"
        )
        self.clock.value += timedelta(seconds=30)
        throttled = self.service.observe_device(
            token, "192.168.101.50", "Mozilla/5.0 (Windows NT 10.0) Chrome/120"
        )
        self.assertEqual(throttled["last_seen_at"], first["last_seen_at"])
        self.assertEqual(throttled["activity_count"], 1)

        identified = self.service.observe_device(
            token, "192.168.101.50", "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
            user_id=7, username="管理员",
        )
        self.assertEqual(identified["last_user_id"], 7)
        self.assertEqual(identified["last_username"], "管理员")
        self.clock.value += timedelta(minutes=1, seconds=1)
        active = self.service.observe_device(
            token, "192.168.101.50", "Mozilla/5.0 (Windows NT 10.0) Chrome/120",
            user_id=7, username="管理员",
        )
        self.assertEqual(active["activity_count"], 2)
        with closing(self.connect()) as connection:
            stored = " ".join(str(value) for value in connection.execute(
                "SELECT * FROM observed_devices"
            ).fetchone())
        self.assertNotIn(token, stored)

    def test_admission_setting_is_database_backed_and_defaults_off(self):
        self.assertFalse(self.service.admission_enabled())
        self.service.set_admission_enabled(True, actor_user_id=7)
        reopened = subject.DeviceAdmissionService(
            self.database_path, self.root, clock=self.clock
        )
        self.assertTrue(reopened.admission_enabled())
        reopened.set_admission_enabled(False, actor_user_id=7)
        self.assertFalse(self.service.admission_enabled())

    def test_concurrent_observation_is_atomic_and_counts_one_activity_window(self):
        token = self.service.issue_observer_token()
        def observe(_):
            return self.service.observe_device(
                token, "192.168.101.60", "Mozilla/5.0 Chrome/120"
            )
        with ThreadPoolExecutor(max_workers=12) as pool:
            rows = list(pool.map(observe, range(12)))
        self.assertEqual(len(rows), 12)
        stored = self.service.list_observed_devices()
        self.assertEqual(len(stored), 1)
        self.assertEqual(stored[0]["activity_count"], 1)

    def test_cold_key_initialization_is_safe_under_concurrent_first_clients(self):
        cold_root = self.root / "cold-start"
        cold = subject.DeviceAdmissionService(
            cold_root / "bidding.db", cold_root, clock=self.clock
        )
        with ThreadPoolExecutor(max_workers=12) as pool:
            tokens = list(pool.map(lambda _: cold.issue_observer_token(), range(12)))
        self.assertEqual(len(tokens), 12)
        self.assertTrue(all(cold.verify_observer_token(token) for token in tokens))
        self.assertEqual(len(set(tokens)), 12)

    def test_new_observer_rows_are_rate_limited_per_source_address(self):
        for _ in range(subject._OBSERVER_NEW_PER_IP_LIMIT):
            self.service.observe_device(
                self.service.issue_observer_token(), "192.168.101.70", "Mozilla/5.0"
            )
        with self.assertRaises(subject.RateLimitError):
            self.service.observe_device(
                self.service.issue_observer_token(), "192.168.101.70", "Mozilla/5.0"
            )
        self.assertLessEqual(
            self.service.count_observed_devices(), subject._OBSERVER_GLOBAL_LIMIT
        )

    def test_approval_exchange_authorization_disable_and_revoke(self):
        request_row = self.submit()
        approved = self.service.approve(request_row["id"], 7, "张三的手机")
        self.assertEqual(approved["status"], "approved")
        self.assertEqual(approved["approved_label"], "张三的手机")

        status, raw_token = self.service.exchange_approved_request(
            "192.168.101.33", "lookup-one-secret-value"
        )
        self.assertEqual(status["status"], "approved")
        self.assertEqual(raw_token, "device-token-first")
        device_id = status["approved_device_id"]

        repeated, repeated_token = self.service.exchange_approved_request(
            "192.168.101.33", "lookup-one-secret-value"
        )
        self.assertIsNone(repeated_token)
        self.assertEqual(repeated["approved_device_id"], device_id)

        device = self.service.authorize_device("192.168.101.34", raw_token)
        self.assertEqual(device["id"], device_id)
        self.assertEqual(device["last_ip"], "192.168.101.34")

        self.service.set_device_enabled(device_id, False, 7)
        self.assertIsNone(self.service.authorize_device("192.168.101.34", raw_token))
        self.service.set_device_enabled(device_id, True, 7)
        self.assertIsNotNone(self.service.authorize_device("192.168.101.34", raw_token))
        self.service.revoke_device(device_id, 7)
        self.assertIsNone(self.service.authorize_device("192.168.101.34", raw_token))
        with self.assertRaises(subject.ConflictError):
            self.service.set_device_enabled(device_id, True, 7)

        with closing(self.connect()) as connection:
            dump = " ".join(str(value) for row in connection.execute(
                "SELECT * FROM approved_devices"
            ) for value in row)
        self.assertNotIn(raw_token, dump)

    def test_rejection_cooldown_and_submission_rate_limit(self):
        request_row = self.submit()
        rejected = self.service.reject(request_row["id"], 7, "设备信息不完整")
        self.assertEqual(rejected["status"], "rejected")
        with self.assertRaises(subject.RateLimitError):
            self.service.submit_request(
                "192.168.101.33", "lookup-one-secret-value", "张三", "张三手机", "再次申请"
            )

        self.clock.value += timedelta(hours=24, seconds=1)
        retried = self.service.submit_request(
            "192.168.101.33", "lookup-retry-secret-value", "张三", "张三手机", "再次申请"
        )
        self.assertNotEqual(retried["id"], request_row["id"])

        for index in range(3):
            self.service.submit_request(
                "192.168.101.77", f"rate-secret-value-{index}", "王五", f"设备{index}", ""
            )
        with self.assertRaises(subject.RateLimitError):
            self.service.submit_request(
                "192.168.101.77", "rate-secret-value-3", "王五", "设备3", ""
            )

        with closing(self.connect()) as connection:
            rate_limit_events = connection.execute(
                "SELECT COUNT(*) FROM device_access_audit "
                "WHERE event_type='request.rate_limited' AND source_ip=?",
                ("192.168.101.77",),
            ).fetchone()[0]
        self.assertEqual(rate_limit_events, 1)

    def test_request_status_and_admin_lists_return_current_records(self):
        request_row = self.submit()
        status = self.service.request_status(
            "192.168.101.99", "lookup-one-secret-value"
        )
        self.assertEqual(status["id"], request_row["id"])
        self.assertEqual(status["last_ip"], "192.168.101.99")
        self.assertEqual([row["id"] for row in self.service.list_requests()], [request_row["id"]])
        self.assertEqual(self.service.list_requests("approved"), [])
        with self.assertRaises(subject.ValidationError):
            self.service.list_requests("unknown")
        with self.assertRaises(subject.NotFoundError):
            self.service.request_status("192.168.101.99", "missing-lookup-secret")

        self.service.approve(request_row["id"], 7, "张三的手机")
        exchange, _ = self.service.exchange_approved_request(
            "192.168.101.99", "lookup-one-secret-value"
        )
        devices = self.service.list_devices()
        self.assertEqual(len(devices), 1)
        self.assertEqual(devices[0]["id"], exchange["approved_device_id"])

    def test_device_expires_after_exactly_365_days_without_sliding_renewal(self):
        request_row = self.submit()
        self.service.approve(request_row["id"], 7, "张三的手机")
        status, raw_token = self.service.exchange_approved_request(
            "192.168.101.33", "lookup-one-secret-value"
        )
        approved_at = datetime.fromisoformat(status["approved_at"])
        expires_at = datetime.fromisoformat(status["expires_at"])
        self.assertEqual(expires_at - approved_at, timedelta(days=365))

        self.clock.value = expires_at
        self.assertIsNotNone(self.service.authorize_device("192.168.101.33", raw_token))
        self.clock.value = expires_at + timedelta(microseconds=1)
        self.assertIsNone(self.service.authorize_device("192.168.101.33", raw_token))

    def test_only_one_conditional_approval_succeeds_and_audit_is_sanitized(self):
        request_row = self.submit()
        self.service.approve(request_row["id"], 7, "批准设备")
        with self.assertRaises(subject.ConflictError):
            self.service.approve(request_row["id"], 8, "重复批准")

        with closing(self.connect()) as connection:
            audit_rows = list(connection.execute(
                "SELECT event_type,detail_json FROM device_access_audit ORDER BY id"
            ))
        details = json.dumps([dict(row) for row in audit_rows], ensure_ascii=False)
        self.assertIn("request.approved", details)
        self.assertNotIn("lookup-one-secret-value", details)
        self.assertNotIn("device-token", details)

    def test_legacy_secret_authorizes_after_primary_rotation(self):
        request_row = self.submit()
        self.service.approve(request_row["id"], 7, "旧手机")
        _, old_token = self.service.exchange_approved_request(
            "192.168.101.33", "lookup-one-secret-value"
        )
        old_secret = self.service.secret

        ring = device_keyring.DeviceKeyring(
            self.database_path, None, b"m" * 32, clock=self.clock
        )
        ring.enroll(old_secret, source="local_dpapi", primary=True)
        ring.enroll(b"n" * 32, source="migration_code", primary=True)
        migrated_root = self.root / "migrated"
        migrated = subject.DeviceAdmissionService(
            self.database_path,
            migrated_root,
            master_key=b"m" * 32,
            keyring=ring,
            clock=self.clock,
            token_factory=lambda: "migrated-device-token",
        )

        self.assertEqual(migrated.primary_secret, b"n" * 32)
        self.assertEqual(
            migrated.request_status(
                "192.168.101.33", "lookup-one-secret-value"
            )["id"],
            request_row["id"],
        )
        self.assertIsNotNone(
            migrated.authorize_device("192.168.101.33", old_token)
        )

        migrated.submit_request(
            "192.168.101.44", "new-lookup-secret-value", "李四", "新手机", ""
        )
        new_request = migrated.list_requests("pending")[0]
        migrated.approve(new_request["id"], 7, "新手机")
        _, new_token = migrated.exchange_approved_request(
            "192.168.101.44", "new-lookup-secret-value"
        )
        expected = subject.credential_hash(b"n" * 32, "device", new_token)
        with closing(self.connect()) as connection:
            stored = connection.execute(
                "SELECT token_hash FROM approved_devices WHERE label='新手机'"
            ).fetchone()[0]
        self.assertEqual(stored, expected)

    def test_revoked_legacy_device_stays_blocked_after_rotation(self):
        request_row = self.submit()
        self.service.approve(request_row["id"], 7, "旧手机")
        status, old_token = self.service.exchange_approved_request(
            "192.168.101.33", "lookup-one-secret-value"
        )
        old_secret = self.service.secret
        self.service.revoke_device(status["approved_device_id"], 7)
        ring = device_keyring.DeviceKeyring(self.database_path, None, b"m" * 32)
        ring.enroll(old_secret, source="local_dpapi", primary=True)
        ring.enroll(b"n" * 32, source="migration_code", primary=True)
        migrated = subject.DeviceAdmissionService(
            self.database_path,
            self.root / "rotated",
            master_key=b"m" * 32,
            keyring=ring,
            clock=self.clock,
        )
        self.assertIsNone(migrated.authorize_device("192.168.101.33", old_token))

    def test_unreadable_dpapi_recovers_from_keyring_before_rebinding(self):
        migrated_root = self.root / "foreign-host"
        migrated_root.mkdir()
        key_path = migrated_root / "device_admission_key.dpapi"
        key_path.write_bytes(b"foreign-dpapi-wrapper")
        ring = device_keyring.DeviceKeyring(self.database_path, None, b"m" * 32)
        ring.enroll(b"r" * 32, source="migration_code", primary=True)
        previous_unprotect = subject._UNPROTECT_SECRET
        subject._UNPROTECT_SECRET = lambda raw: (
            (_ for _ in ()).throw(OSError("different Windows user"))
            if raw == b"foreign-dpapi-wrapper"
            else raw.removeprefix(b"protected:")
        )
        try:
            migrated = subject.DeviceAdmissionService(
                self.database_path,
                migrated_root,
                master_key=b"m" * 32,
                keyring=ring,
                clock=self.clock,
            )
            self.assertEqual(migrated.primary_secret, b"r" * 32)
            self.assertEqual(key_path.read_bytes(), b"protected:" + b"r" * 32)
        finally:
            subject._UNPROTECT_SECRET = previous_unprotect

    def test_automatic_enrollment_rebind_and_unavailable_key_are_audited(self):
        ring = device_keyring.DeviceKeyring(self.database_path, None, b"m" * 32)
        first_root = self.root / "audit-first"
        first = subject.DeviceAdmissionService(
            self.database_path,
            first_root,
            master_key=b"m" * 32,
            keyring=ring,
            clock=self.clock,
        )
        first.primary_secret
        legacy = ring.enroll(b"l" * 32, source="migration_code", primary=False)
        with closing(self.connect()) as connection, connection:
            connection.execute(
                "UPDATE device_admission_keys SET ciphertext=? WHERE key_id=?",
                (b"broken", legacy["key_id"]),
            )

        second = subject.DeviceAdmissionService(
            self.database_path,
            self.root / "audit-second",
            master_key=b"m" * 32,
            keyring=ring,
            clock=self.clock,
        )
        second.verification_secrets
        with closing(self.connect()) as connection:
            rows = connection.execute(
                "SELECT event_type,detail_json FROM device_access_audit "
                "WHERE event_type LIKE 'device.keyring.%' ORDER BY id"
            ).fetchall()
        self.assertEqual(
            [row[0] for row in rows],
            [
                "device.keyring.enrolled",
                "device.keyring.rebound",
                "device.keyring.unavailable",
            ],
        )
        rendered = json.dumps([tuple(row) for row in rows], ensure_ascii=False)
        self.assertIn("KEYRING_RECORD_AUTH_FAILED", rendered)
        self.assertNotIn(legacy["key_id"], rendered)


if __name__ == "__main__":
    unittest.main()
