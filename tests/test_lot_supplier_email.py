import sqlite3
import sys
import tempfile
import unittest
import inspect
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

from src.backend_patches import lot_supplier_risk as subject
from src.backend_patches import app_replacements
from tests.test_app_replacements import load_replacements
from tests.test_reminder_settings import FakeSMTP


class RawSession:
    _lot_risk_raw_sql = True

    def __init__(self, connection):
        self.connection = connection

    def execute(self, statement, parameters=None):
        return self.connection.execute(statement, parameters or {})

    def commit(self):
        self.connection.commit()

    def rollback(self):
        self.connection.rollback()


class LotSupplierEmailTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.connection = sqlite3.connect(Path(self.temp.name) / "mail.db")
        self.connection.executescript(
            "CREATE TABLE projects(id INTEGER PRIMARY KEY);"
            "CREATE TABLE project_lots(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, lot_number TEXT, lot_name TEXT, budget NUMERIC, notes TEXT);"
            "CREATE TABLE supplier_registrations(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, lot_id INTEGER);"
            "INSERT INTO projects VALUES(7);"
            "INSERT INTO project_lots VALUES(11,7,'01包','办公设备采购',100,'');"
            "INSERT INTO project_lots VALUES(12,7,'03包','信息系统维护服务',100,'');"
            "INSERT INTO supplier_registrations VALUES(1,7,11);"
            "INSERT INTO supplier_registrations VALUES(2,7,11);"
        )
        self.connection.commit()
        self.db = SimpleNamespace(session=RawSession(self.connection))
        subject.ensure_schema(self.db)
        self.project = SimpleNamespace(
            id=7, number="CG-007", name="示例项目", purchaser="示例采购人",
            year=2026, method="公开招标", is_terminated=False,
            lots=[
                SimpleNamespace(id=11, lot_number="01包", lot_name="办公设备采购", supplier_control=None),
                SimpleNamespace(id=12, lot_number="03包", lot_name="信息系统维护服务", supplier_control=None),
            ],
            registrations=[SimpleNamespace(id=1, lot_id=11), SimpleNamespace(id=2, lot_id=11)],
            stages=[SimpleNamespace(stage_key="registration_end", planned_datetime=datetime(2026, 8, 5, 17, 0))],
        )
        self.settings = {
            "supplier_minimums": subject.DEFAULT_MINIMUMS,
            "reminder_time": "09:00",
            "reminder_recipients": ["ops@example.test"],
        }

    def tearDown(self):
        self.connection.close()
        self.temp.cleanup()

    def test_day_before_warning_is_combined_named_and_deduplicated(self):
        now = datetime(2026, 8, 4, 9, 0)
        first = subject.queue_due_warning_events(self.db, self.project, now, self.settings)
        second = subject.queue_due_warning_events(self.db, self.project, now, self.settings)
        self.db.session.commit()
        self.assertEqual(len(first), 1)
        self.assertEqual(second, [])
        self.assertEqual(first[0]["subject"], "【流标预警】示例项目：2个包报名供应商不足")
        self.assertIn("01包 办公设备采购：已报名2家，最低要求3家，还差1家", first[0]["body"])
        self.assertIn("03包 信息系统维护服务：已报名0家，最低要求3家，还差3家", first[0]["body"])

    def test_same_day_after_cutoff_queues_no_stale_warning(self):
        self.assertEqual(
            subject.queue_due_warning_events(
                self.db, self.project, datetime(2026, 8, 5, 18, 0), self.settings
            ),
            [],
        )

    def test_pending_delivery_state_is_durable_and_sanitized(self):
        subject.queue_due_warning_events(
            self.db, self.project, datetime(2026, 8, 4, 9, 0), self.settings
        )
        pending = subject.pending_mail_events(self.db)
        self.assertEqual(len(pending), 1)
        subject.mark_mail_failed(self.db, pending[0]["id"], "SMTP_CONNECTION_FAILED")
        failed = subject.pending_mail_events(self.db)[0]
        self.assertEqual(failed["mail_attempts"], 1)
        subject.mark_mail_sent(self.db, failed["id"], datetime(2026, 8, 4, 9, 1))
        self.db.session.commit()
        self.assertEqual(subject.pending_mail_events(self.db), [])

    def test_recipient_delivery_claims_are_idempotent_and_retry_independently(self):
        parent = subject.queue_due_warning_events(
            self.db, self.project, datetime(2026, 8, 4, 9, 0), self.settings
        )[0]
        event = {
            "event_key": f"supplier_shortage:{parent['id']}:11",
            "event_type": "supplier_shortage",
            "project_number": "CG-007",
            "project_name": "示例项目",
            "lot_identity": "01包 办公设备采购",
            "supplier_count": 2,
            "supplier_minimum": 3,
            "supplier_missing": 1,
            "registration_deadline": "2026-08-05 17:00",
        }
        deliveries = [
            {
                "recipient": recipient,
                "event_type": "supplier_shortage",
                "content_fields": ["project_name", "supplier_missing"],
                "subject_prefix": "预警",
                "group_ids": ["risk"],
                "rules_fingerprint": fingerprint,
            }
            for recipient, fingerprint in (
                ("a@example.test", "a" * 64),
                ("b@example.test", "b" * 64),
            )
        ]
        now = datetime(2026, 8, 4, 9, 0)

        first = subject.claim_mail_deliveries(
            self.db, parent, event, deliveries, now
        )
        second = subject.claim_mail_deliveries(
            self.db, parent, event, deliveries, now
        )

        self.assertEqual(len(first), 2)
        self.assertEqual(second, [])
        due = subject.pending_mail_deliveries(self.db, now)
        self.assertEqual({item["recipient"] for item in due}, {"a@example.test", "b@example.test"})
        by_recipient = {item["recipient"]: item for item in due}
        subject.mark_mail_delivery_result(
            self.db,
            by_recipient["a@example.test"]["delivery_key"],
            {"status": "sent", "error_code": None},
            now,
        )
        subject.mark_mail_delivery_result(
            self.db,
            by_recipient["b@example.test"]["delivery_key"],
            {"status": "failed", "error_code": "SMTP_CONNECTION_FAILED"},
            now,
        )
        self.db.session.commit()

        self.assertEqual(subject.pending_mail_deliveries(self.db, now), [])
        retry = subject.pending_mail_deliveries(
            self.db, datetime(2026, 8, 4, 9, 15)
        )
        self.assertEqual([item["recipient"] for item in retry], ["b@example.test"])

    def test_parent_supplier_event_is_sent_only_after_every_delivery_succeeds(self):
        parent = subject.queue_due_warning_events(
            self.db, self.project, datetime(2026, 8, 4, 9, 0), self.settings
        )[0]
        event = {
            "event_key": f"supplier_shortage:{parent['id']}:project",
            "event_type": "supplier_shortage",
            "project_name": "示例项目",
            "supplier_missing": 1,
        }
        deliveries = [
            {
                "recipient": "ops@example.test",
                "event_type": "supplier_shortage",
                "content_fields": ["project_name", "supplier_missing"],
                "subject_prefix": "预警",
                "group_ids": ["risk"],
                "rules_fingerprint": "c" * 64,
            }
        ]
        now = datetime(2026, 8, 4, 9, 0)
        claim = subject.claim_mail_deliveries(
            self.db, parent, event, deliveries, now
        )[0]

        subject.mark_mail_delivery_result(
            self.db,
            claim["delivery_key"],
            {"status": "sent", "error_code": None},
            now,
        )
        self.db.session.commit()

        self.assertEqual(subject.pending_mail_events(self.db), [])

    def test_grouped_digest_routes_supplier_warning_and_marks_delivery_sent(self):
        module = load_replacements()
        module.SETTINGS_PATH = Path(self.temp.name) / "app_settings.json"
        module.Path = Path
        module.datetime = datetime
        module.joinedload = lambda value: value
        module.create_full_backup = lambda: None
        module._REMINDER_UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        module.db = self.db

        class Query:
            def options(inner_self, *args):
                return inner_self

            def all(inner_self):
                return [self.project]

        module.Project = SimpleNamespace(
            query=Query(), stages="stages", registrations="registrations", lots="lots"
        )
        settings = {
            **self.settings,
            "backup_time": "13:00",
            "last_backup_date": "2026-08-04",
            "reminder_enabled": True,
            "smtp_host": "smtp.example.test",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "sender@example.test",
            "smtp_sender": "sender@example.test",
            "reminder_stage_keys": [],
            "reminder_recipient_groups": [
                {
                    "id": "risk",
                    "name": "风险预警",
                    "enabled": True,
                    "order": 0,
                    "recipients": ["risk@example.test"],
                    "event_types": ["supplier_shortage"],
                    "content_fields": {
                        "project_name": True,
                        "lot_identity": True,
                        "supplier_count": True,
                        "supplier_minimum": True,
                        "supplier_missing": True,
                    },
                    "subject_prefix": "预警",
                }
            ],
        }
        module.load_app_settings = lambda: dict(settings)
        (Path(self.temp.name) / "reminder_credentials.dpapi").write_bytes(
            b"protected:secret"
        )
        smtp_instances = []

        def smtp_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            smtp_instances.append(smtp)
            return smtp

        module._REMINDER_SMTP_FACTORY = smtp_factory
        previous = sys.modules.get("lot_supplier_risk")
        sys.modules["lot_supplier_risk"] = subject
        try:
            result = module.run_scheduled_backup_if_due(
                datetime(2026, 8, 4, 9, 0), job="digest"
            )
        finally:
            if previous is None:
                sys.modules.pop("lot_supplier_risk", None)
            else:
                sys.modules["lot_supplier_risk"] = previous

        self.assertTrue(result["ok"])
        messages = [message for smtp in smtp_instances for message in smtp.messages]
        self.assertEqual(len(messages), 2)
        self.assertEqual({message["To"] for message in messages}, {"risk@example.test"})
        self.assertTrue(all("供应商不足预警" in message["Subject"] for message in messages))
        rows = self.connection.execute(
            "SELECT status FROM lot_supplier_mail_deliveries"
        ).fetchall()
        self.assertEqual({row[0] for row in rows}, {"sent"})
        self.assertEqual(subject.pending_mail_events(self.db), [])

    def test_cutoff_queues_one_combined_result_mail_after_lot_audits(self):
        changed = subject.apply_registration_cutoff(
            self.db, self.project, datetime(2026, 8, 5, 17, 0), self.settings
        )
        pending = subject.pending_mail_events(self.db)
        self.assertEqual(len(changed), 2)
        self.assertEqual(len(pending), 1)
        self.assertEqual(
            pending[0]["subject"],
            "【项目流标】示例项目：全部采购包报名供应商不足",
        )
        self.assertIn("01包 办公设备采购：已报名2家，最低要求3家", pending[0]["body"])
        self.assertIn("03包 信息系统维护服务：已报名0家，最低要求3家", pending[0]["body"])
        self.assertEqual(pending[0]["recipients"], ["ops@example.test"])

    def test_manual_response_shortage_does_not_queue_automatic_mail(self):
        subject.manual_liubiao(
            self.db,
            self.project,
            self.project.lots[0],
            response_count=2,
            reason="投标响应供应商不足三家",
            actor_id=9,
        )
        self.assertEqual(subject.pending_mail_events(self.db), [])

    def test_digest_scheduler_integrates_warning_queue_and_delivery(self):
        source = inspect.getsource(app_replacements.run_scheduled_backup_if_due)
        self.assertIn("queue_due_warning_events", source)
        self.assertIn("pending_mail_events", source)
        self.assertIn("mark_mail_sent", source)
        self.assertIn("mark_mail_failed", source)


if __name__ == "__main__":
    unittest.main()
