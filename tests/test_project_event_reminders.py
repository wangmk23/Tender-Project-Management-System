"""Tests for project event (create/complete) email reminders."""
import json
import os
import smtplib
import tempfile
import types
import unittest
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock, patch

from tests.test_app_replacements import FakeRequest, load_replacements
from tests.test_reminder_settings import FakeSMTP


class FakeQuery:
    def __init__(self, projects):
        self.projects = projects

    def options(self, *args):
        return self

    def all(self):
        return list(self.projects)


def make_stage(key, completed=False, skipped=False):
    return types.SimpleNamespace(
        stage_key=key,
        name=key,
        completed=completed,
        is_completed=completed,
        skipped=skipped,
    )


def make_project(
    pid,
    number,
    name,
    stages=None,
    terminated=False,
    progress=0,
    created_at=None,
):
    return types.SimpleNamespace(
        id=pid,
        number=number,
        name=name,
        purchaser="实验采购人",
        year=2026,
        method="公开招标",
        is_terminated=terminated,
        progress=progress,
        stages=stages or [],
        created_at=created_at or datetime(2026, 7, 21, 14, 0, 30),
    )


class ProjectEventReminderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.settings = {
            "backup_time": "13:00",
            "last_backup_date": "2026-07-21",
            "reminder_enabled": False,
            "reminder_time": "09:00",
            "smtp_host": "smtp.example.test",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "sender@example.test",
            "smtp_sender": "sender@example.test",
            "reminder_recipients": ["ops@example.test"],
            "event_reminder_create_enabled": False,
            "event_reminder_complete_enabled": False,
        }
        self.module = load_replacements()
        self.module.SETTINGS_PATH = self.root / "app_settings.json"
        self.module.Path = Path
        self.module.datetime = datetime
        self.module.joinedload = lambda value: value
        self.module.create_full_backup = Mock(return_value=None)
        self.module._REMINDER_UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.smtp_instances = []

        def smtp_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            self.smtp_instances.append(smtp)
            return smtp

        self.module._REMINDER_SMTP_FACTORY = smtp_factory
        self.module.load_app_settings = lambda: dict(self.settings)
        (self.root / "reminder_credentials.dpapi").write_bytes(b"protected:secret")
        self.projects = []
        self.module.Project = types.SimpleNamespace(
            query=FakeQuery(self.projects),
            stages="stages",
        )

    def tearDown(self):
        self.temporary.cleanup()

    def state(self):
        path = self.root / "project_events_state.json"
        if not path.is_file():
            return None
        return json.loads(path.read_text(encoding="utf-8"))

    def run_scheduler(self, when=None):
        return self.module.run_project_event_reminders_if_due(
            when or datetime(2026, 7, 21, 14, 0)
        )

    def configure_recipient_groups(self, recipients=None):
        self.settings.update(
            {
                "event_reminder_create_enabled": True,
                "event_reminder_complete_enabled": True,
                "reminder_recipients": recipients or ["create@example.test"],
                "reminder_recipient_groups": [
                    {
                        "id": "project-events",
                        "name": "项目事件",
                        "enabled": True,
                        "order": 0,
                        "recipients": recipients or ["create@example.test"],
                        "event_types": ["project_create", "project_complete"],
                        "content_fields": {
                            "project_number": True,
                            "project_name": True,
                            "event_at": True,
                            "progress": True,
                        },
                        "subject_prefix": "项目",
                    }
                ],
            }
        )

    def install_v0_fixture(self):
        fixture = Path(__file__).with_name("fixtures") / "project_events_state_v0.json"
        (self.root / "project_events_state.json").write_bytes(fixture.read_bytes())

    def test_grouped_pending_retry_pauses_when_master_or_subscription_changes(self):
        for change in ("master", "disabled", "deleted", "recipient", "fields", "event"):
            with self.subTest(change=change):
                (self.root / "project_events_state.json").unlink(missing_ok=True)
                self.configure_recipient_groups()
                self.projects[:] = [make_project(1, "CG-001", "基线项目")]
                self.run_scheduler(datetime(2026, 8, 14, 10, 0))
                self.projects.append(make_project(2, "CG-002", "新建项目"))

                class FailingSMTP(FakeSMTP):
                    def send_message(inner_self, message):
                        raise smtplib.SMTPRecipientsRefused({str(message["To"]): (451, b"temporary")})

                self.module._REMINDER_SMTP_FACTORY = FailingSMTP
                self.run_scheduler(datetime(2026, 8, 14, 10, 1))
                self.assertEqual({r["attempts"] for r in self.state()["pending_deliveries"].values()}, {1})
                import copy
                original_groups = copy.deepcopy(self.settings["reminder_recipient_groups"])
                group = self.settings["reminder_recipient_groups"][0]
                if change == "master":
                    self.settings["event_reminder_create_enabled"] = False
                elif change == "disabled":
                    group["enabled"] = False
                elif change == "deleted":
                    self.settings["reminder_recipient_groups"] = []
                elif change == "recipient":
                    group["recipients"] = ["replacement@example.test"]
                elif change == "fields":
                    group["content_fields"].pop("project_name")
                else:
                    group["event_types"] = ["project_complete"]
                attempts = Mock(return_value=FakeSMTP("smtp.example.test", 465))
                self.module._REMINDER_SMTP_FACTORY = attempts
                self.run_scheduler(datetime(2026, 8, 14, 10, 16))
                attempts.assert_not_called()
                self.assertEqual({r["attempts"] for r in self.state()["pending_deliveries"].values()}, {1})
                self.assertEqual({r["status"] for r in self.state()["pending_deliveries"].values()}, {"pending"})
                self.settings["event_reminder_create_enabled"] = True
                self.settings["reminder_recipient_groups"] = original_groups
                self.run_scheduler(datetime(2026, 8, 14, 10, 17))
                attempts.assert_called_once()
                self.assertEqual({r["status"] for r in self.state()["pending_deliveries"].values()}, {"sent"})

    def test_stale_unversioned_state_migrates_to_v3_without_historical_send(self):
        self.configure_recipient_groups()
        self.projects[:] = [
            make_project(1, "CG-001", "历史项目"),
            make_project(2, "CG-002", "历史完成", progress=100),
        ]
        self.install_v0_fixture()

        result = self.run_scheduler(datetime(2026, 8, 14, 10, 0))

        state = self.state()
        self.assertEqual(result["code"], "STALE_STATE_REBASE")
        self.assertEqual(state["version"], 3)
        self.assertEqual(state["known_project_ids"], ["1", "2"])
        self.assertEqual(state["completed_project_ids"], ["2"])
        self.assertEqual(state["pending_deliveries"], {})
        self.assertEqual(self.smtp_instances, [])
        self.assertEqual(state["last_error"], "STALE_STATE_REBASE")

    def test_production_unversioned_sent_event_map_migrates_without_historical_send(self):
        self.configure_recipient_groups()
        self.projects[:] = [
            make_project(1, "CG-001", "历史项目"),
            make_project(2, "CG-002", "历史完成", progress=100),
        ]
        production_state = {
            "completed_project_ids": ["2"],
            "initialized": True,
            "known_project_ids": ["1", "2"],
            "last_check_at": "2026-07-28T18:07:10",
            "last_error": None,
            "last_success_at": "2026-07-28T18:07:10",
            "sent_events": {
                "create|1": "2026-07-28T17:52:08",
                "complete|2": "2026-07-28T18:07:10",
            },
        }
        (self.root / "project_events_state.json").write_text(
            json.dumps(production_state, ensure_ascii=False), encoding="utf-8"
        )

        result = self.run_scheduler(datetime(2026, 8, 14, 10, 0))

        state = self.state()
        self.assertEqual(result["code"], "STALE_STATE_REBASE")
        self.assertEqual(state["version"], 3)
        self.assertEqual(state["pending_deliveries"], {})
        self.assertEqual(self.smtp_instances, [])

    def test_unversioned_state_rejects_duplicate_event_keys_without_rewrite(self):
        self.configure_recipient_groups()
        self.projects[:] = [make_project(1, "CG-001", "历史项目")]
        self.install_v0_fixture()
        path = self.root / "project_events_state.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        value["sent_events"] = ["project_create:1", "project_create:1"]
        raw = json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n"
        path.write_text(raw, encoding="utf-8")

        result = self.run_scheduler(datetime(2026, 8, 14, 10, 0))

        self.assertEqual(result["error_code"], "STATE_INVALID")
        self.assertEqual(path.read_text(encoding="utf-8"), raw)
        self.assertEqual(self.smtp_instances, [])

    def test_new_project_after_v0_migration_routes_once(self):
        self.configure_recipient_groups()
        self.projects[:] = [
            make_project(1, "CG-001", "历史项目"),
            make_project(2, "CG-002", "历史完成", progress=100),
        ]
        self.install_v0_fixture()
        self.run_scheduler(datetime(2026, 8, 14, 10, 0))
        self.projects.append(
            make_project(
                3,
                "CG-003",
                "迁移后新项目",
                created_at=datetime(2026, 8, 14, 10, 0, 30),
            )
        )

        self.run_scheduler(datetime(2026, 8, 14, 10, 1))
        self.run_scheduler(datetime(2026, 8, 14, 10, 2))

        messages = [message for smtp in self.smtp_instances for message in smtp.messages]
        self.assertEqual(len(messages), 1)
        self.assertEqual(messages[0]["To"], "create@example.test")
        self.assertIn("项目新建提醒", messages[0]["Subject"])
        self.assertIn("create|3", self.state()["sent_events"])

    def test_partial_recipient_failure_retries_only_failed_after_fifteen_minutes(self):
        self.configure_recipient_groups(["a@example.test", "b@example.test"])
        self.projects[:] = [make_project(1, "CG-001", "基线项目")]
        self.run_scheduler(datetime(2026, 8, 14, 10, 0))
        self.projects.append(
            make_project(
                2,
                "CG-002",
                "部分重试项目",
                created_at=datetime(2026, 8, 14, 10, 0, 30),
            )
        )
        sent_recipients = []
        failures = {"b@example.test"}

        class SelectiveSMTP(FakeSMTP):
            def send_message(self, message):
                recipient = message["To"]
                sent_recipients.append(recipient)
                if recipient in failures:
                    raise smtplib.SMTPRecipientsRefused(
                        {recipient: (451, b"synthetic temporary failure")}
                    )
                self.messages.append(message)

        self.module._REMINDER_SMTP_FACTORY = SelectiveSMTP
        self.run_scheduler(datetime(2026, 8, 14, 10, 1))
        self.run_scheduler(datetime(2026, 8, 14, 10, 10))
        failures.clear()
        self.run_scheduler(datetime(2026, 8, 14, 10, 16))

        self.assertEqual(sent_recipients.count("a@example.test"), 1)
        self.assertEqual(sent_recipients.count("b@example.test"), 2)
        self.assertIn("create|2", self.state()["sent_events"])
        records = list(self.state()["pending_deliveries"].values())
        self.assertEqual({record["status"] for record in records}, {"sent"})

    def test_first_scan_records_state_without_sending(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [
            make_project(1, "CG-001", "已有项目"),
            make_project(2, "CG-002", "另一个项目"),
        ]

        self.run_scheduler()

        self.assertEqual(self.smtp_instances, [])
        state = self.state()
        self.assertIsNotNone(state)
        self.assertEqual(sorted(state["known_project_ids"]), ["1", "2"])

    def test_stale_state_rebaselines_without_historical_email(self):
        self.settings["event_reminder_create_enabled"] = True
        self.settings["event_reminder_complete_enabled"] = True
        self.projects[:] = [
            make_project(1, "CG-001", "历史进行中", created_at=datetime(2026, 7, 20, 9, 0)),
            make_project(2, "CG-002", "停机期间新增", progress=100, created_at=datetime(2026, 7, 21, 15, 0)),
        ]
        stale = {
            "version": 2,
            "initialized": True,
            "known_project_ids": ["1"],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {},
            "last_check_at": "2026-07-21T14:00:00",
            "last_success_at": "2026-07-21T14:00:00",
            "last_error": None,
        }
        (self.root / "project_events_state.json").write_text(
            json.dumps(stale, ensure_ascii=False), encoding="utf-8"
        )

        self.run_scheduler(datetime(2026, 7, 23, 14, 1))

        self.assertEqual(self.smtp_instances, [])
        state = self.state()
        self.assertEqual(state["known_project_ids"], ["1", "2"])
        self.assertEqual(state["completed_project_ids"], ["2"])
        self.assertEqual(state["recovered_stale_at"], "2026-07-23T14:01:00")
        self.assertEqual(state["last_check_at"], "2026-07-23T14:01:00")
        self.assertIn("STALE_STATE_REBASE", state["last_error"])

    def test_events_after_stale_recovery_send_once(self):
        self.settings["event_reminder_create_enabled"] = True
        self.settings["event_reminder_complete_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "基线项目", created_at=datetime(2026, 7, 20, 9, 0))]
        stale = {
            "version": 2,
            "initialized": True,
            "known_project_ids": ["1"],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {},
            "last_check_at": "2026-07-21T14:00:00",
            "last_success_at": "2026-07-21T14:00:00",
            "last_error": None,
        }
        (self.root / "project_events_state.json").write_text(json.dumps(stale), encoding="utf-8")
        self.run_scheduler(datetime(2026, 7, 23, 14, 1))

        self.projects[0].progress = 100
        self.projects.append(make_project(2, "CG-002", "恢复后新建", created_at=datetime(2026, 7, 23, 14, 1, 30)))
        self.run_scheduler(datetime(2026, 7, 23, 14, 2))
        self.run_scheduler(datetime(2026, 7, 23, 14, 3))

        self.assertEqual(len(self.smtp_instances), 1)
        self.assertEqual(len(self.smtp_instances[0].messages), 2)
        state = self.state()
        self.assertIn("create|2", state["sent_events"])
        self.assertIn("complete|1", state["sent_events"])

    def test_new_project_triggers_create_email(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        # 添加新项目
        self.projects.append(make_project(2, "CG-002", "新建项目"))
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(len(self.smtp_instances), 1)
        message = self.smtp_instances[0].messages[0]
        self.assertIn("项目新建提醒", message["Subject"])
        self.assertIn("新建项目", message["Subject"])
        body = message.get_body(preferencelist=("plain",)).get_content()
        self.assertIn("CG-002", body)
        self.assertIn("新建项目", body)

    def test_first_project_after_empty_baseline_triggers_create_email(self):
        self.settings["event_reminder_create_enabled"] = True
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects.append(make_project(1, "CG-001", "首个项目"))
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(len(self.smtp_instances), 1)
        self.assertIn("create|1", self.state()["sent_events"])

    def test_project_at_one_hundred_percent_triggers_complete_email(self):
        self.settings["event_reminder_complete_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "进行中项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects[0].progress = 100
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(len(self.smtp_instances), 1)
        message = self.smtp_instances[0].messages[0]
        self.assertIn("项目完成提醒", message["Subject"])
        self.assertIn("进行中项目", message["Subject"])

    def test_archived_stage_alone_does_not_complete_project_below_one_hundred_percent(self):
        self.settings["event_reminder_complete_enabled"] = True
        stages = [make_stage("archived", completed=True)]
        self.projects[:] = [make_project(1, "CG-001", "基线项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))
        self.projects.append(
            make_project(2, "CG-002", "尚未完成", stages=stages, progress=93)
        )

        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(self.smtp_instances, [])

    def test_terminated_project_at_one_hundred_percent_is_not_completion_event(self):
        self.settings["event_reminder_complete_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "基线项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))
        self.projects.append(
            make_project(2, "CG-002", "终止项目", terminated=True, progress=100)
        )

        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(self.smtp_instances, [])

    def test_event_not_sent_twice(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects.append(make_project(2, "CG-002", "新建项目"))
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))
        self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        self.assertEqual(len(self.smtp_instances), 1)

    def test_disabled_create_does_not_send(self):
        self.settings["event_reminder_create_enabled"] = False
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects.append(make_project(2, "CG-002", "新建项目"))
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(self.smtp_instances, [])

    def test_missing_smtp_config_skips_silently(self):
        self.settings["event_reminder_create_enabled"] = True
        self.settings["smtp_host"] = ""
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects.append(make_project(2, "CG-002", "新建项目"))
        # 不应抛异常，也不应发送邮件
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(self.smtp_instances, [])

    def test_missing_recipients_skips_silently(self):
        self.settings["event_reminder_create_enabled"] = True
        self.settings["reminder_recipients"] = []
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects.append(make_project(2, "CG-002", "新建项目"))
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(self.smtp_instances, [])

    def test_send_failure_is_retried_on_next_scan(self):
        def failing_factory(host, port, **kwargs):
            raise OSError("synthetic transport failure")

        self.settings["event_reminder_create_enabled"] = True
        self.module._REMINDER_SMTP_FACTORY = failing_factory
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects.append(make_project(2, "CG-002", "新建项目"))
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        state = self.state()
        self.assertIn("SMTP_CONNECTION_FAILED", state["last_error"])
        self.assertNotIn("2", state["known_project_ids"])

        retry_instances = []

        def retry_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            retry_instances.append(smtp)
            return smtp

        self.module._REMINDER_SMTP_FACTORY = retry_factory
        self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        state = self.state()
        self.assertEqual(len(retry_instances), 1)
        self.assertIn("2", state["known_project_ids"])
        self.assertIn("create|2", state["sent_events"])
        self.assertIsNone(state["last_error"])

    def test_confirmed_send_message_rejection_is_retried(self):
        class RejectingSMTP(FakeSMTP):
            def send_message(self, message):
                raise smtplib.SMTPDataError(451, b"temporary rejection")

        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))
        self.projects.append(make_project(2, "CG-002", "待重试项目"))
        self.module._REMINDER_SMTP_FACTORY = RejectingSMTP

        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        failed_state = self.state()
        self.assertNotIn("2", failed_state["known_project_ids"])
        self.assertNotIn("create|2", failed_state["sent_events"])
        self.assertEqual(
            failed_state["pending_events"]["create|2"]["status"], "claimed"
        )

        retry_instances = []

        def retry_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            retry_instances.append(smtp)
            return smtp

        self.module._REMINDER_SMTP_FACTORY = retry_factory
        self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        self.assertEqual(len(retry_instances), 1)
        self.assertEqual(len(retry_instances[0].messages), 1)
        self.assertIn("create|2", self.state()["sent_events"])

    def assert_pre_data_failure_is_retried(self, failure):
        class RejectingSMTP(FakeSMTP):
            def send_message(self, message):
                raise failure

        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "initial")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))
        self.projects.append(make_project(2, "CG-002", "retry"))
        self.module._REMINDER_SMTP_FACTORY = RejectingSMTP

        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        failed_state = self.state()
        self.assertNotIn("create|2", failed_state["sent_events"])
        self.assertEqual(
            failed_state["pending_events"]["create|2"]["status"], "claimed"
        )

        retry_instances = []

        def retry_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            retry_instances.append(smtp)
            return smtp

        self.module._REMINDER_SMTP_FACTORY = retry_factory
        self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        self.assertEqual(len(retry_instances), 1)
        self.assertEqual(len(retry_instances[0].messages), 1)
        self.assertIn("create|2", self.state()["sent_events"])

    def test_smtp_helo_failure_before_data_is_retried(self):
        self.assert_pre_data_failure_is_retried(
            smtplib.SMTPHeloError(501, b"HELO rejected")
        )

    def test_smtp_not_supported_before_data_is_retried(self):
        self.assert_pre_data_failure_is_retried(
            smtplib.SMTPNotSupportedError("SMTPUTF8 unavailable")
        )

    def test_network_disconnect_during_send_remains_ambiguous(self):
        class DisconnectingSMTP(FakeSMTP):
            def send_message(self, message):
                raise smtplib.SMTPServerDisconnected("connection lost")

        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "initial")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))
        self.projects.append(make_project(2, "CG-002", "ambiguous"))
        self.module._REMINDER_SMTP_FACTORY = DisconnectingSMTP

        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        pending = self.state()["pending_events"]
        self.assertEqual(pending["create|2"]["status"], "sending")
        retry_instances = []
        self.module._REMINDER_SMTP_FACTORY = lambda *args, **kwargs: retry_instances.append(
            FakeSMTP(*args, **kwargs)
        ) or retry_instances[-1]

        self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        self.assertEqual(retry_instances, [])
        self.assertIn("create|2", self.state()["sent_events"])

    def test_ambiguous_first_send_keeps_later_claims_retryable(self):
        class DisconnectingSMTP(FakeSMTP):
            def send_message(self, message):
                raise smtplib.SMTPServerDisconnected("connection lost")

        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "initial")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))
        self.projects.extend(
            [
                make_project(2, "CG-002", "ambiguous"),
                make_project(3, "CG-003", "definitely not attempted"),
            ]
        )
        self.module._REMINDER_SMTP_FACTORY = DisconnectingSMTP

        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        pending = self.state()["pending_events"]
        self.assertEqual(pending["create|2"]["status"], "sending")
        self.assertIn("create|3", pending)
        self.assertEqual(pending["create|3"]["status"], "claimed")

        retry_instances = []

        def retry_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            retry_instances.append(smtp)
            return smtp

        self.module._REMINDER_SMTP_FACTORY = retry_factory
        self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        self.assertEqual(len(retry_instances), 1)
        self.assertEqual(len(retry_instances[0].messages), 1)
        state = self.state()
        self.assertIn("create|2", state["sent_events"])
        self.assertIn("create|3", state["sent_events"])

    def test_restart_retries_claimed_but_suppresses_ambiguous_sending(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "初始项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.projects.append(make_project(2, "CG-002", "已声明未发送"))
        claimed_state = self.state()
        claimed_state["pending_events"] = {
            "create|2": {
                "status": "claimed",
                "claimed_at": "2026-07-21T14:01:00",
            }
        }
        claimed_state["last_check_at"] = "2026-07-21T14:01:00"
        (self.root / "project_events_state.json").write_text(
            json.dumps(claimed_state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        self.assertEqual(len(self.smtp_instances), 1)
        self.assertIn("create|2", self.state()["sent_events"])

        self.projects.append(make_project(3, "CG-003", "发送结果不明"))
        ambiguous_state = self.state()
        ambiguous_state["pending_events"] = {
            "create|3": {
                "status": "sending",
                "claimed_at": "2026-07-21T14:03:00",
            }
        }
        ambiguous_state["last_check_at"] = "2026-07-21T14:03:00"
        (self.root / "project_events_state.json").write_text(
            json.dumps(ambiguous_state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        self.smtp_instances.clear()

        self.run_scheduler(datetime(2026, 7, 21, 14, 4))

        self.assertEqual(self.smtp_instances, [])
        final_state = self.state()
        self.assertIn("create|3", final_state["sent_events"])
        self.assertEqual(final_state["pending_events"], {})

    def test_corrupt_state_fails_closed_without_sending(self):
        self.settings["event_reminder_create_enabled"] = True
        (self.root / "project_events_state.json").write_text(
            "not-json", encoding="utf-8"
        )
        self.projects.append(make_project(1, "CG-001", "不可发送"))

        self.run_scheduler()

        self.assertEqual(self.smtp_instances, [])
        self.assertEqual(
            (self.root / "project_events_state.json").read_text(encoding="utf-8"),
            "not-json",
        )

    def test_structurally_corrupt_state_fails_closed_without_rewrite(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects.append(make_project(1, "CG-001", "历史项目"))
        valid = {
            "version": 1,
            "initialized": True,
            "known_project_ids": [],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {},
            "last_check_at": "2026-07-21T13:59:00",
            "last_success_at": None,
            "last_error": None,
        }
        corruptions = {
            "initialized": {**valid, "initialized": "not-a-boolean"},
            "known ids": {**valid, "known_project_ids": [1]},
            "sent event": {**valid, "sent_events": {"bad-key": "time"}},
            "pending event": {
                **valid,
                "pending_events": {"create|1": "missing-phase"},
            },
            "completion outside known baseline": {
                **valid,
                "completed_project_ids": ["999"],
            },
            "event both pending and sent": {
                **valid,
                "sent_events": {"create|1": "2026-07-21T13:58:00"},
                "pending_events": {
                    "create|1": {
                        "status": "claimed",
                        "claimed_at": "2026-07-21T13:59:00",
                    }
                },
            },
        }
        state_path = self.root / "project_events_state.json"
        for label, value in corruptions.items():
            with self.subTest(label=label):
                raw = json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n"
                state_path.write_text(raw, encoding="utf-8")
                self.smtp_instances.clear()

                self.run_scheduler()

                self.assertEqual(self.smtp_instances, [])
                self.assertEqual(state_path.read_text(encoding="utf-8"), raw)

    def test_generator_impossible_state_fails_closed_without_rewrite(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [
            make_project(
                1,
                "CG-001",
                "historical",
                created_at=datetime(2026, 7, 21, 13, 0),
            )
        ]
        valid = {
            "version": 1,
            "initialized": True,
            "known_project_ids": ["1"],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {},
            "last_check_at": "2026-07-21T13:59:00",
            "last_success_at": "2026-07-21T13:59:00",
            "last_error": None,
        }
        corruptions = {
            "initialized without last check": {**valid, "last_check_at": None},
            "uninitialized with generated baseline": {**valid, "initialized": False},
            "noncanonical project id": {**valid, "known_project_ids": ["01"]},
            "noncanonical event key": {
                **valid,
                "sent_events": {"create|1|2": "2026-07-21T13:58:00"},
            },
            "invalid event timestamp": {
                **valid,
                "sent_events": {"create|1": "not-an-iso-timestamp"},
            },
            "success after last check": {
                **valid,
                "last_success_at": "2026-07-21T14:00:00",
            },
        }
        state_path = self.root / "project_events_state.json"
        for label, value in corruptions.items():
            with self.subTest(label=label):
                raw = json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n"
                state_path.write_text(raw, encoding="utf-8")
                self.smtp_instances.clear()

                self.run_scheduler(datetime(2026, 7, 21, 14, 0))

                self.assertEqual(self.smtp_instances, [])
                self.assertEqual(state_path.read_text(encoding="utf-8"), raw)

    def test_historical_unknown_project_fails_database_relation_without_rewrite(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [
            make_project(
                1,
                "CG-001",
                "historical",
                created_at=datetime(2026, 7, 21, 13, 0),
            )
        ]
        legacy = {
            "version": 1,
            "initialized": True,
            "known_project_ids": [],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {},
            "last_check_at": "2026-07-21T13:59:00",
            "last_success_at": None,
            "last_error": None,
        }
        raw = json.dumps(legacy, ensure_ascii=False, sort_keys=True) + "\n"
        state_path = self.root / "project_events_state.json"
        state_path.write_text(raw, encoding="utf-8")

        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.assertEqual(self.smtp_instances, [])
        self.assertEqual(state_path.read_text(encoding="utf-8"), raw)

    def test_noncanonical_database_project_id_fails_without_creating_state(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project("01", "CG-001", "invalid id")]

        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.assertEqual(self.smtp_instances, [])
        self.assertFalse((self.root / "project_events_state.json").exists())

    def test_legacy_pending_string_upgrades_to_v2_and_continues_scanning(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [
            make_project(
                1,
                "CG-001",
                "legacy pending",
                created_at=datetime(2026, 7, 21, 13, 0),
            ),
            make_project(
                2,
                "CG-002",
                "new after legacy check",
                created_at=datetime(2026, 7, 21, 14, 0, 30),
            ),
        ]
        legacy = {
            "version": 1,
            "initialized": True,
            "known_project_ids": ["1"],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {"create|1": "2026-07-21T13:59:00"},
            "last_check_at": "2026-07-21T13:59:00",
            "last_success_at": None,
            "last_error": None,
        }
        (self.root / "project_events_state.json").write_text(
            json.dumps(legacy, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )

        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        state = self.state()
        self.assertEqual(state["version"], 2)
        self.assertEqual(state["pending_events"], {})
        self.assertIn("create|1", state["sent_events"])
        self.assertIn("create|2", state["sent_events"])
        self.assertEqual(len(self.smtp_instances), 1)
        self.assertEqual(len(self.smtp_instances[0].messages), 1)

    def write_v1_dict_crash_state(self, status):
        state = {
            "version": 1,
            "initialized": True,
            "known_project_ids": ["1"],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {
                "create|2": {
                    "status": status,
                    "claimed_at": "2026-07-21T14:01:00",
                }
            },
            "last_check_at": "2026-07-21T14:01:00",
            "last_success_at": None,
            "last_error": None,
        }
        path = self.root / "project_events_state.json"
        path.write_text(
            json.dumps(state, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        return path

    def assert_v1_dict_crash_state_upgrades_and_future_events_continue(
        self, status, expected_first_send_count
    ):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [
            make_project(
                1,
                "CG-001",
                "baseline",
                created_at=datetime(2026, 7, 21, 13, 0),
            ),
            make_project(
                2,
                "CG-002",
                "crash event",
                created_at=datetime(2026, 7, 21, 14, 0, 30),
            ),
        ]
        state_path = self.write_v1_dict_crash_state(status)
        migration_writes = []
        original_replace = os.replace

        def capture_migration(source, destination):
            if Path(destination) == state_path:
                migration_writes.append(
                    json.loads(Path(source).read_text(encoding="utf-8"))
                )
            return original_replace(source, destination)

        with patch("os.replace", side_effect=capture_migration):
            self.run_scheduler(datetime(2026, 7, 21, 14, 2))

        self.assertTrue(migration_writes, "v1 migration was not atomically persisted")
        migrated = migration_writes[0]
        self.assertEqual(migrated["version"], 2)
        if status == "claimed":
            self.assertEqual(
                migrated["pending_events"]["create|2"],
                {
                    "status": "claimed",
                    "claimed_at": "2026-07-21T14:01:00",
                },
            )
            self.assertNotIn("create|2", migrated["sent_events"])
        else:
            self.assertEqual(migrated["pending_events"], {})
            self.assertEqual(
                migrated["sent_events"]["create|2"], "2026-07-21T14:01:00"
            )
        self.assertEqual(len(self.smtp_instances), expected_first_send_count)

        self.run_scheduler(datetime(2026, 7, 21, 14, 3))

        self.assertEqual(len(self.smtp_instances), expected_first_send_count)
        state = self.state()
        self.assertEqual(state["version"], 2)
        self.assertEqual(state["pending_events"], {})
        self.assertIn("create|2", state["sent_events"])

        self.projects.append(
            make_project(
                3,
                "CG-003",
                "future project",
                created_at=datetime(2026, 7, 21, 14, 3, 30),
            )
        )
        self.run_scheduler(datetime(2026, 7, 21, 14, 4))

        self.assertEqual(len(self.smtp_instances), expected_first_send_count + 1)
        self.assertIn("create|3", self.state()["sent_events"])

    def test_v1_claimed_dict_upgrades_retries_once_and_future_events_continue(self):
        self.assert_v1_dict_crash_state_upgrades_and_future_events_continue(
            "claimed", 1
        )

    def test_v1_sending_dict_upgrades_as_sent_and_future_events_continue(self):
        self.assert_v1_dict_crash_state_upgrades_and_future_events_continue(
            "sending", 0
        )

    def test_invalid_v1_pending_dict_fails_closed_without_rewrite(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "baseline")]
        state_path = self.write_v1_dict_crash_state("claimed")
        baseline = json.loads(state_path.read_text(encoding="utf-8"))
        corruptions = {
            "unknown field": {
                "status": "claimed",
                "claimed_at": "2026-07-21T14:01:00",
                "unexpected": True,
            },
            "unknown status": {
                "status": "queued",
                "claimed_at": "2026-07-21T14:01:00",
            },
            "non-string status": {
                "status": ["claimed"],
                "claimed_at": "2026-07-21T14:01:00",
            },
            "invalid timestamp": {
                "status": "claimed",
                "claimed_at": "not-an-iso-timestamp",
            },
        }
        for label, claim in corruptions.items():
            with self.subTest(label=label):
                value = {
                    **baseline,
                    "pending_events": {"create|2": claim},
                }
                raw = json.dumps(value, ensure_ascii=False, sort_keys=True) + "\n"
                state_path.write_text(raw, encoding="utf-8")
                self.smtp_instances.clear()

                try:
                    self.run_scheduler(datetime(2026, 7, 21, 14, 2))
                except Exception as exc:
                    self.fail(f"invalid v1 pending state escaped: {exc}")

                self.assertEqual(self.smtp_instances, [])
                self.assertEqual(state_path.read_text(encoding="utf-8"), raw)

    def test_state_claim_must_persist_before_email_is_sent(self):
        self.settings["event_reminder_create_enabled"] = True
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))
        self.projects.append(make_project(1, "CG-001", "待持久化事件"))

        with patch("os.replace", side_effect=OSError("synthetic state failure")):
            self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(self.smtp_instances, [])

    def test_transient_windows_replace_failure_is_retried(self):
        self.settings["event_reminder_create_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "baseline")]
        original_replace = os.replace
        attempts = []

        def fail_once(source, destination):
            attempts.append((source, destination))
            if len(attempts) == 1:
                raise PermissionError(13, "synthetic Windows file contention")
            return original_replace(source, destination)

        with patch("os.replace", side_effect=fail_once):
            self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        self.assertGreaterEqual(len(attempts), 2)
        self.assertEqual(self.state()["known_project_ids"], ["1"])

    def test_both_create_and_complete_send_separate_emails(self):
        self.settings["event_reminder_create_enabled"] = True
        self.settings["event_reminder_complete_enabled"] = True
        self.projects[:] = [make_project(1, "CG-001", "进行中项目")]
        self.run_scheduler(datetime(2026, 7, 21, 14, 0))

        # 同时新增项目并完成现有项目
        self.projects.append(make_project(2, "CG-002", "新建项目"))
        self.projects[0].progress = 100
        self.run_scheduler(datetime(2026, 7, 21, 14, 1))

        self.assertEqual(len(self.smtp_instances), 1)
        self.assertEqual(len(self.smtp_instances[0].messages), 2)


class ProjectEventSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.settings = {
            "export_folder": str(self.root / "exports"),
            "login_subtitle": "实验环境",
            "smtp_host": "smtp.example.test",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "sender@example.test",
            "smtp_sender": "sender@example.test",
            "reminder_recipients": ["ops@example.test"],
        }
        self.request = FakeRequest()
        self.module = load_replacements()
        self.module.session = {"is_admin": True}
        self.module.request = self.request
        self.module.jsonify = lambda value: value
        self.module.app = types.SimpleNamespace(config={"IS_DESKTOP": True})
        self.module.load_app_settings = lambda: dict(self.settings)
        self.module.get_export_dir = lambda: self.root / "exports"
        self.module.get_desktop_dir = lambda: self.root / "Desktop"
        self.module.DATA_DIR = self.root
        self.module.SETTINGS_PATH = self.root / "app_settings.json"
        self.module.Path = Path
        self.module.log_operation = Mock()

        def save_app_settings(updates):
            self.settings.update(updates)
            return dict(self.settings)

        self.module.save_app_settings = save_app_settings
        self.module._REMINDER_PROTECT_SECRET = lambda raw: b"protected:" + raw
        self.module._REMINDER_UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.module._REMINDER_SMTP_FACTORY = lambda *a, **k: None

        import sys
        self.previous_winreg = sys.modules.get("winreg")
        fake_winreg = types.ModuleType("winreg")
        fake_winreg.HKEY_CURRENT_USER = object()
        fake_winreg.KEY_READ = 1
        fake_winreg.OpenKey = Mock(side_effect=FileNotFoundError())
        sys.modules["winreg"] = fake_winreg

    def tearDown(self):
        import sys
        if self.previous_winreg is None:
            sys.modules.pop("winreg", None)
        else:
            sys.modules["winreg"] = self.previous_winreg
        self.temporary.cleanup()

    def test_event_reminder_create_enabled_persists(self):
        self.request.json = {"event_reminder_create_enabled": True}

        response = self.module.api_update_settings()

        self.assertTrue(self.settings["event_reminder_create_enabled"])

    def test_event_reminder_complete_enabled_persists(self):
        self.request.json = {"event_reminder_complete_enabled": True}

        self.module.api_update_settings()

        self.assertTrue(self.settings["event_reminder_complete_enabled"])

    def test_non_boolean_create_value_rejected(self):
        self.request.json = {"event_reminder_create_enabled": "yes"}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertNotIn("event_reminder_create_enabled", self.settings)

    def test_non_boolean_complete_value_rejected(self):
        self.request.json = {"event_reminder_complete_enabled": 1}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)

    def test_enabling_event_reminder_requires_smtp_host(self):
        self.settings["smtp_host"] = ""
        self.request.json = {"event_reminder_create_enabled": True}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertIn("error", response)

    def test_enabling_event_reminder_requires_sender(self):
        self.settings["smtp_sender"] = ""
        self.request.json = {"event_reminder_complete_enabled": True}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)

    def test_enabling_event_reminder_requires_recipients(self):
        self.settings["reminder_recipients"] = []
        self.request.json = {
            "event_reminder_create_enabled": True,
            "reminder_recipients": [],
        }

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)

    def test_get_settings_returns_event_reminder_defaults(self):
        response = self.module.api_get_settings()

        self.assertIn("event_reminder_create_enabled", response)
        self.assertIn("event_reminder_complete_enabled", response)
        self.assertIs(response["event_reminder_create_enabled"], False)
        self.assertIs(response["event_reminder_complete_enabled"], False)


if __name__ == "__main__":
    unittest.main()
