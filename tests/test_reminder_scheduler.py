import json
import copy
import sqlite3
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock

from tests.test_app_replacements import load_replacements
from tests.test_reminder_settings import FakeSMTP


class FakeQuery:
    def __init__(self, projects):
        self.projects = projects

    def options(self, *args):
        return self

    def all(self):
        return list(self.projects)


class ReminderSchedulerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.module = load_replacements()
        self.module.SETTINGS_PATH = self.root / "app_settings.json"
        self.module.Path = Path
        self.module.datetime = datetime
        self.module.joinedload = lambda value: value
        self.module.create_full_backup = Mock(return_value=self.root / "backups" / "daily.zip")
        self.module._REMINDER_UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.smtp_instances = []

        def smtp_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            self.smtp_instances.append(smtp)
            return smtp

        self.module._REMINDER_SMTP_FACTORY = smtp_factory
        self.previous_risk_alias = sys.modules.get("lot_supplier_risk")
        sys.modules["lot_supplier_risk"] = types.SimpleNamespace(
            ensure_schema=lambda database: None,
            queue_due_warning_events=lambda *args, **kwargs: [],
            pending_mail_events=lambda database: [],
            mark_mail_sent=lambda *args, **kwargs: None,
            mark_mail_failed=lambda *args, **kwargs: None,
        )
        self.module.db = types.SimpleNamespace(
            session=types.SimpleNamespace(commit=lambda: None, rollback=lambda: None)
        )
        self.settings = {
            "backup_time": "13:00",
            "last_backup_date": "2026-07-20",
            "reminder_enabled": True,
            "reminder_time": "09:00",
            "smtp_host": "smtp.example.test",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "sender@example.test",
            "smtp_sender": "sender@example.test",
            "reminder_recipients": ["ops@example.test"],
            "reminder_stage_keys": ["registration_end", "bid_opening", "doc_review"],
            "reminder_content": {
                "project_number": True,
                "project_name": True,
                "purchaser": True,
                "stage_name": True,
                "planned_at": True,
                "registration_count": True,
            },
        }
        self.module.load_app_settings = lambda: dict(self.settings)
        (self.root / "reminder_credentials.dpapi").write_bytes(b"protected:secret")
        self.projects = [
            self.project(
                1,
                "CG-001",
                "园区设备更新",
                [
                    self.stage("registration_end", "报名截止", "2026-07-20T09:00:00"),
                    self.stage("bid_opening", "开标", "2026-07-20T14:30:00"),
                ],
                registrations=3,
            )
        ]
        self.module.Project = types.SimpleNamespace(
            query=FakeQuery(self.projects),
            stages="stages",
            registrations="registrations",
            lots="lots",
        )

    def tearDown(self):
        if self.previous_risk_alias is None:
            sys.modules.pop("lot_supplier_risk", None)
        else:
            sys.modules["lot_supplier_risk"] = self.previous_risk_alias
        self.temporary.cleanup()

    @staticmethod
    def stage(key, name, planned, completed=False, skipped=False):
        return types.SimpleNamespace(
            stage_key=key,
            name=name,
            planned_datetime=planned,
            completed=completed,
            skipped=skipped,
        )

    @staticmethod
    def project(project_id, number, name, stages, registrations=0, terminated=False):
        return types.SimpleNamespace(
            id=project_id,
            number=number,
            name=name,
            purchaser="实验采购人",
            is_terminated=terminated,
            stages=stages,
            registrations=[object() for _ in range(registrations)],
            lots=[],
        )

    def state(self):
        return json.loads((self.root / "reminder_send_log.json").read_text(encoding="utf-8"))

    def run_digest(self, now):
        return self.module.run_scheduled_backup_if_due(now, job="digest")

    def configure_recipient_groups(self):
        self.settings["reminder_recipients"] = [
            "manager@example.test",
            "clerk@example.test",
        ]
        self.settings["reminder_recipient_groups"] = [
            {
                "id": "manager",
                "name": "负责人",
                "enabled": True,
                "order": 0,
                "recipients": ["manager@example.test"],
                "event_types": ["daily_stage"],
                "content_fields": {
                    "project_name": True,
                    "stage_name": True,
                    "registration_count": True,
                },
                "subject_prefix": "负责人",
            },
            {
                "id": "clerk",
                "name": "经办人",
                "enabled": True,
                "order": 1,
                "recipients": ["clerk@example.test"],
                "event_types": ["daily_stage"],
                "content_fields": {
                    "project_number": True,
                    "stage_name": True,
                },
                "subject_prefix": "经办",
            },
        ]

    def daily_delivery_state(self):
        return json.loads(
            (self.root / "daily_stage_delivery_state.json").read_text(
                encoding="utf-8"
            )
        )

    def test_daily_pending_retry_pauses_for_changed_subscription_or_ineligible_stage(self):
        for change in ("disabled", "deleted", "recipient", "fields", "completed", "removed",
                       "terminated", "deadline", "expired_day", "master"):
            with self.subTest(change=change):
                (self.root / "daily_stage_delivery_state.json").unlink(missing_ok=True)
                self.configure_recipient_groups()
                self.settings["reminder_enabled"] = True
                self.projects[:] = [self.project(1, "CG-001", "项目", [
                    self.stage("registration_end", "报名截止", "2026-07-20T09:00:00")])]

                class FailingSMTP(FakeSMTP):
                    def send_message(inner_self, message):
                        raise __import__("smtplib").SMTPRecipientsRefused({str(message["To"]): (451, b"temporary")})

                self.module._REMINDER_SMTP_FACTORY = FailingSMTP
                self.run_digest(datetime(2026, 7, 20, 9, 0))
                self.assertEqual({r["attempts"] for r in self.daily_delivery_state()["deliveries"].values()}, {1})
                if change == "disabled":
                    for group in self.settings["reminder_recipient_groups"]:
                        group["enabled"] = False
                elif change == "deleted":
                    self.settings["reminder_recipient_groups"] = []
                elif change == "recipient":
                    for group in self.settings["reminder_recipient_groups"]:
                        group["recipients"] = ["replacement@example.test"]
                elif change == "fields":
                    for group in self.settings["reminder_recipient_groups"]:
                        group["content_fields"] = {"stage_name": True}
                elif change == "completed":
                    self.projects[0].stages[0].completed = True
                elif change == "removed":
                    self.projects.clear()
                elif change == "terminated":
                    self.projects[0].is_terminated = True
                elif change == "deadline":
                    self.projects[0].stages[0].planned_datetime = "2026-07-21T09:00:00"
                elif change == "master":
                    self.settings["reminder_enabled"] = False
                attempts = Mock(return_value=FakeSMTP("smtp.example.test", 465))
                self.module._REMINDER_SMTP_FACTORY = attempts
                self.run_digest(datetime(2026, 7, 21 if change == "expired_day" else 20, 9, 16))
                attempts.assert_not_called()
                self.assertEqual({r["attempts"] for r in self.daily_delivery_state()["deliveries"].values()}, {1})
                self.assertEqual({r["status"] for r in self.daily_delivery_state()["deliveries"].values()}, {"pending"})

    def test_supplier_pending_respects_master_and_current_rules_with_legacy_missing_flag(self):
        from src.backend_patches import reminder_routing

        self.projects.clear()
        self.configure_recipient_groups()
        group = self.settings["reminder_recipient_groups"][0]
        self.settings["reminder_recipient_groups"] = [group]
        group["event_types"] = ["supplier_shortage"]
        group["content_fields"] = {"project_name": True, "supplier_missing": True}
        event = {"event_type": "supplier_shortage", "event_key": "supplier:1", "project_name": "项目", "supplier_missing": 1}
        delivery = reminder_routing.route_reminder_event(event, [group])[0]
        record = {"delivery_key": "k1", "event": event, "delivery": delivery, "recipient": delivery["recipient"]}
        risk = sys.modules["lot_supplier_risk"]
        risk.pending_mail_deliveries = Mock(return_value=[record])
        risk.claim_mail_deliveries = Mock(return_value=[])
        risk.mark_mail_delivery_result = Mock()
        original = copy.deepcopy(group)
        for change in ("master", "recipient", "fields", "disabled", "deleted", "missing_flag"):
            with self.subTest(change=change):
                self.settings["reminder_recipient_groups"] = [copy.deepcopy(original)]
                self.settings.pop("supplier_shortage_email_enabled", None)
                current = self.settings["reminder_recipient_groups"][0]
                if change == "master":
                    self.settings["supplier_shortage_email_enabled"] = False
                elif change == "recipient":
                    current["recipients"] = ["replacement@example.test"]
                elif change == "fields":
                    current["content_fields"].pop("project_name")
                elif change == "disabled":
                    current["enabled"] = False
                elif change == "deleted":
                    self.settings["reminder_recipient_groups"] = []
                attempts = Mock(return_value=FakeSMTP("smtp.example.test", 465))
                self.module._REMINDER_SMTP_FACTORY = attempts
                self.run_digest(datetime(2026, 7, 20, 9, 16))
                if change == "missing_flag":
                    attempts.assert_called_once()
                else:
                    attempts.assert_not_called()

    def test_grouped_daily_stage_uses_distinct_fields_and_one_smtp_session(self):
        self.configure_recipient_groups()

        result = self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertTrue(result["ok"])
        self.assertEqual(len(self.smtp_instances), 1)
        messages = {
            message["To"]: message.get_body(preferencelist=("plain",)).get_content()
            for message in self.smtp_instances[0].messages
        }
        self.assertEqual(set(messages), {"manager@example.test", "clerk@example.test"})
        self.assertIn("报名家数", messages["manager@example.test"])
        self.assertNotIn("报名家数", messages["clerk@example.test"])
        self.assertIn("项目编号", messages["clerk@example.test"])
        self.assertNotIn("项目编号", messages["manager@example.test"])

    def test_daily_snapshot_names_and_removed_flags_override_unmodeled_orm_fields(self):
        for grouped in (False, True):
            with self.subTest(grouped=grouped), sqlite3.connect(":memory:") as connection:
                self.smtp_instances.clear()
                (self.root / "reminder_send_log.json").unlink(missing_ok=True)
                (self.root / "daily_stage_delivery_state.json").unlink(missing_ok=True)
                self.settings.pop("reminder_recipient_groups", None)
                if grouped:
                    self.configure_recipient_groups()
                self.settings["reminder_stage_keys"] = ["online_quotation", "registration_end"]
                self.module.STAGES = [{"key": "registration_end", "name": "全局报名旧名称"}]
                self.projects[:] = [self.project(1, "CG-001", "项目", [
                    types.SimpleNamespace(stage_key="online_quotation", planned_datetime="2026-07-20T09:00:00",
                                          stage_name="ORM旧名称", template_removed=False),
                    types.SimpleNamespace(stage_key="registration_end", planned_datetime="2026-07-20T09:00:00",
                                          template_removed=False),
                ])]
                self.projects[0].method = "网上竞价"
                connection.execute("CREATE TABLE stages(project_id,stage_key,stage_name,template_removed)")
                connection.executemany("INSERT INTO stages VALUES(?,?,?,?)", [
                    (1, "online_quotation", "一次报价竞价（项目快照）", 0),
                    (1, "registration_end", "已删除的报名阶段", 1),
                ])
                execute = Mock(side_effect=connection.execute)
                self.module.db.session.execute = execute
                self.module.text = lambda statement: statement
                self.run_digest(datetime(2026, 7, 20, 9, 0))
                bodies = [message.get_body(preferencelist=("plain",)).get_content()
                          for smtp in self.smtp_instances for message in smtp.messages]
                self.assertTrue(bodies)
                self.assertTrue(all("一次报价竞价（项目快照）" in body for body in bodies))
                self.assertFalse(any("online_quotation" in body or "已删除的报名阶段" in body
                                     or "全局报名旧名称" in body or "ORM旧名称" in body for body in bodies))
                self.assertEqual(execute.call_count, 1)
                self.assertTrue(str(execute.call_args.args[0]).lstrip().upper().startswith("SELECT "))

    def test_daily_template_fallback_includes_custom_ids_and_keeps_old_global_names(self):
        from src.backend_patches import stage_templates
        for grouped in (False, True):
            with self.subTest(grouped=grouped):
                self.smtp_instances.clear()
                (self.root / "reminder_send_log.json").unlink(missing_ok=True)
                (self.root / "daily_stage_delivery_state.json").unlink(missing_ok=True)
                self.settings.pop("reminder_recipient_groups", None)
                if grouped:
                    self.configure_recipient_groups()
                self.settings.pop("reminder_stage_keys", None)
                self.module.STAGES = [{"key": "registration_end", "name": "全局报名旧名称"}]
                self.module.METHODS = ["网上竞价"]
                self.settings["stage_templates"] = {"网上竞价": stage_templates.online_bidding_template()}
                self.projects[:] = [self.project(1, "CG-001", "项目", [
                    types.SimpleNamespace(stage_key="online_quotation", planned_datetime="2026-07-20T09:00:00"),
                    types.SimpleNamespace(stage_key="registration_end", planned_datetime="2026-07-20T09:00:00"),
                ])]
                self.projects[0].method = "网上竞价"
                self.run_digest(datetime(2026, 7, 20, 9, 0))
                body = "\n".join(message.get_body(preferencelist=("plain",)).get_content()
                                 for smtp in self.smtp_instances for message in smtp.messages)
                self.assertIn("一次报价竞价", body)
                self.assertIn("全局报名旧名称", body)
                self.assertNotIn("online_quotation", body)

    def test_grouped_daily_stage_retries_only_failed_recipient_after_fifteen_minutes(self):
        self.configure_recipient_groups()
        sent_recipients = []
        failures = {"clerk@example.test"}

        class SelectiveSMTP(FakeSMTP):
            def send_message(self, message):
                recipient = message["To"]
                sent_recipients.append(recipient)
                if recipient in failures:
                    raise __import__("smtplib").SMTPRecipientsRefused(
                        {recipient: (451, b"temporary")}
                    )
                self.messages.append(message)

        self.module._REMINDER_SMTP_FACTORY = SelectiveSMTP
        self.run_digest(datetime(2026, 7, 20, 9, 0))
        first_manager_count = sent_recipients.count("manager@example.test")
        first_clerk_count = sent_recipients.count("clerk@example.test")
        self.run_digest(datetime(2026, 7, 20, 9, 10))
        self.assertEqual(
            sent_recipients.count("manager@example.test"), first_manager_count
        )
        self.assertEqual(
            sent_recipients.count("clerk@example.test"), first_clerk_count
        )
        failures.clear()
        self.run_digest(datetime(2026, 7, 20, 9, 16))

        self.assertEqual(first_manager_count, 2)
        self.assertEqual(first_clerk_count, 2)
        self.assertEqual(sent_recipients.count("manager@example.test"), 2)
        self.assertEqual(sent_recipients.count("clerk@example.test"), 4)
        records = self.daily_delivery_state()["deliveries"].values()
        self.assertEqual({record["status"] for record in records}, {"sent"})

    def test_sends_one_digest_with_registration_count_and_opening_time(self):
        result = self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertIsNone(result)
        self.assertEqual(len(self.smtp_instances), 1)
        body = self.smtp_instances[0].messages[0].get_body(preferencelist=("plain",)).get_content()
        self.assertEqual(body.splitlines()[0], "以下流程节点即将到期，请及时跟进：")
        self.assertNotIn("共有", body.splitlines()[0])
        self.assertIn("报名截止", body)
        self.assertIn("3 家供应商已报名", body)
        self.assertIn("开标时间：2026-07-20 14:30", body)

    def test_digest_lists_due_stages_in_configured_workflow_order(self):
        self.module.STAGES = [
            {"key": "registration_end", "name": "报名截止"},
            {"key": "bid_opening", "name": "开标"},
            {"key": "doc_review", "name": "文件审核"},
        ]
        self.settings["stage_order"] = [
            "bid_opening",
            "registration_end",
            "doc_review",
        ]

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        body = self.smtp_instances[0].messages[0].get_body(
            preferencelist=("plain",)
        ).get_content()
        self.assertLess(body.index("开标"), body.index("报名截止"))

    def test_successful_digest_is_not_sent_again(self):
        self.run_digest(datetime(2026, 7, 20, 9, 0))
        self.run_digest(datetime(2026, 7, 20, 9, 1))

        self.assertEqual(len(self.smtp_instances), 1)
        self.assertEqual(len(self.state()["sent"]), 2)

    def test_late_start_sends_after_nine(self):
        self.run_digest(datetime(2026, 7, 20, 13, 5))

        self.assertEqual(len(self.smtp_instances), 1)

    def test_before_nine_does_not_send(self):
        self.run_digest(datetime(2026, 7, 20, 8, 59))

        self.assertEqual(self.smtp_instances, [])

    def test_completed_skipped_and_terminated_stages_are_excluded(self):
        self.projects[:] = [
            self.project(1, "A", "完成", [self.stage("doc_review", "审核", "2026-07-20", completed=True)]),
            self.project(2, "B", "跳过", [self.stage("doc_review", "审核", "2026-07-20", skipped=True)]),
            self.project(3, "C", "终止", [self.stage("doc_review", "审核", "2026-07-20")], terminated=True),
        ]

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertEqual(self.smtp_instances, [])

    def test_failed_send_retries_after_fifteen_minutes_and_caps_at_three(self):
        def failing_factory(host, port, **kwargs):
            raise OSError("synthetic transport failure")

        self.module._REMINDER_SMTP_FACTORY = failing_factory
        start = datetime(2026, 7, 20, 9, 0)
        for offset in (0, 5, 15, 30, 45):
            self.run_digest(start + timedelta(minutes=offset))

        state = self.state()
        attempts = next(iter(state["attempts"].values()))
        self.assertEqual(attempts["count"], 3)
        self.assertEqual(state["sent"], {})
        self.assertEqual(
            state["last_error"],
            "SMTP_CONNECTION_FAILED: 无法连接 SMTP 服务器",
        )

    def test_corrupt_state_fails_closed(self):
        (self.root / "reminder_send_log.json").write_text("not-json", encoding="utf-8")

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertEqual(self.smtp_instances, [])
        self.assertEqual((self.root / "reminder_send_log.json").read_text(encoding="utf-8"), "not-json")

    def test_unrecoverable_settings_transaction_stops_digest(self):
        marker = self.root / "reminder_settings_transaction.json"
        marker.write_text("not-json", encoding="utf-8")

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertEqual(self.smtp_instances, [])
        self.assertEqual(marker.read_text(encoding="utf-8"), "not-json")

    def test_existing_backup_schedule_is_preserved(self):
        self.settings["reminder_enabled"] = False
        self.settings["last_backup_date"] = "2026-07-19"

        result = self.module.run_scheduled_backup_if_due(
            datetime(2026, 7, 20, 13, 0), job="backup"
        )

        self.assertEqual(result, self.root / "backups" / "daily.zip")
        self.module.create_full_backup.assert_called_once_with()

    def test_backup_failure_does_not_suppress_real_digest_job(self):
        self.settings["last_backup_date"] = "2026-07-19"
        self.module.create_full_backup.side_effect = RuntimeError("backup failed")
        now = datetime(2026, 7, 20, 13, 0)

        with self.assertRaisesRegex(RuntimeError, "backup failed"):
            self.module.run_scheduled_backup_if_due(now, job="backup")
        self.run_digest(now)

        self.assertEqual(len(self.smtp_instances), 1)

    def test_advance_days_includes_stages_within_window(self):
        self.settings["reminder_advance_days"] = 3
        self.projects[:] = [self.project(10, "ADV-001", "提前提醒", [self.stage("registration_end", "报名截止", "2026-07-22T09:00:00")], registrations=2)]

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertEqual(len(self.smtp_instances), 1)
        body = self.smtp_instances[0].messages[0].get_body(preferencelist=("plain",)).get_content()
        self.assertIn("提前提醒", body)

    def test_advance_days_zero_excludes_future_stages(self):
        self.settings["reminder_advance_days"] = 0
        self.projects[:] = [self.project(11, "FUT-001", "未来项目", [self.stage("registration_end", "报名截止", "2026-07-22T09:00:00")], registrations=1)]

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertEqual(self.smtp_instances, [])

    def test_weekday_filter_skips_non_listed_days(self):
        self.settings["reminder_weekdays"] = [0]
        self.projects[:] = [self.project(12, "WD-001", "工作日提醒", [self.stage("registration_end", "报名截止", "2026-07-25T09:00:00")], registrations=1)]

        self.run_digest(datetime(2026, 7, 25, 9, 0))

        self.assertEqual(self.smtp_instances, [])

    def test_sunday_is_sendable_with_all_seven_days_selected(self):
        self.settings["reminder_weekdays"] = list(range(7))
        self.projects[:] = [self.project(12, "SUN-001", "周日项目", [self.stage("registration_end", "报名截止", "2026-07-26T09:00:00")], registrations=1)]
        self.run_digest(datetime(2026, 7, 26, 9, 0))
        self.assertEqual(len(self.smtp_instances), 1)

    def test_digest_hides_unselected_stage_and_opening_time(self):
        self.settings["reminder_content"] = {"project_number": True, "stage_name": False, "planned_at": False, "registration_count": False}
        self.run_digest(datetime(2026, 7, 20, 9, 0))
        body = self.smtp_instances[0].messages[0].get_body(preferencelist=("plain",)).get_content()
        self.assertNotIn("报名截止", body)
        self.assertNotIn("开标", body)
        self.assertNotIn("09:00", body)
        self.assertNotIn("14:30", body)

    def test_custom_subject_template_is_used(self):
        self.settings["reminder_subject"] = "【采购预警】{date} 有 {count} 个待办"
        self.projects[:] = [self.project(13, "SUBJ-001", "主题测试", [self.stage("registration_end", "报名截止", "2026-07-20T09:00:00")], registrations=1)]

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertEqual(len(self.smtp_instances), 1)
        subject = self.smtp_instances[0].messages[0]["Subject"]
        self.assertIn("【采购预警】", subject)
        self.assertIn("2026-07-20", subject)
        self.assertIn("1 个待办", subject)

    def test_authentication_error_state_is_fixed_and_contains_no_server_response(self):
        response_marker = "server-response-must-not-persist"

        def failing_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            smtp.login = Mock(
                side_effect=__import__("smtplib").SMTPAuthenticationError(
                    535, response_marker.encode("ascii")
                )
            )
            return smtp

        self.module._REMINDER_SMTP_FACTORY = failing_factory

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        state = self.state()
        self.assertEqual(
            state["last_error"],
            "SMTP_AUTH_FAILED: SMTP 身份验证失败",
        )
        self.assertNotIn(response_marker, json.dumps(state, ensure_ascii=False))

    def test_outlook_hostname_is_rechecked_before_scheduled_send(self):
        self.settings["smtp_host"] = "SMTP.Office365.Com."

        self.run_digest(datetime(2026, 7, 20, 9, 0))

        self.assertEqual(self.smtp_instances, [])
        self.assertEqual(
            self.state()["last_error"],
            "SMTP_OAUTH_REQUIRED: Outlook 需要 OAuth2",
        )

    def test_retry_cap_is_stable_when_due_item_set_changes(self):
        attempts = []

        def failing_factory(host, port, **kwargs):
            attempts.append((host, port))
            raise OSError("changing-set failure")

        self.module._REMINDER_SMTP_FACTORY = failing_factory
        start = datetime(2026, 7, 20, 9, 0)
        self.run_digest(start)
        self.run_digest(start + timedelta(minutes=15))
        self.projects.append(
            self.project(
                2,
                "CG-002",
                "新增待办",
                [self.stage("doc_review", "文件审核", "2026-07-20T16:00:00")],
            )
        )
        self.run_digest(start + timedelta(minutes=30))
        self.run_digest(start + timedelta(minutes=45))

        self.assertEqual(len(attempts), 3)
        state = self.state()
        self.assertEqual(len(state["attempts"]), 1)
        self.assertEqual(next(iter(state["attempts"].values()))["count"], 3)


if __name__ == "__main__":
    unittest.main()
