import json
import os
import smtplib
import sys
import tempfile
import types
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import Mock, patch

from tests.test_app_replacements import FakeRequest, load_replacements
from src.backend_patches import reminder_routing as reminder_routing_module


class FakeSMTP:
    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.context = context
        self.started_tls = False
        self.logged_in = None
        self.messages = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def starttls(self, context=None):
        self.started_tls = True

    def login(self, username, password):
        self.logged_in = (username, password)

    def send_message(self, message):
        self.messages.append(message)


class ReminderSettingsTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.settings = {
            "export_folder": str(self.root / "exports"),
            "login_subtitle": "实验环境",
        }
        self.request = FakeRequest()
        self.module = load_replacements()
        self.module.session = {"is_admin": True}
        self.module.request = self.request
        self.module.jsonify = lambda value: value
        self.module.app = types.SimpleNamespace(
            config={"IS_DESKTOP": True},
            logger=types.SimpleNamespace(
                warning=Mock(),
                exception=Mock(),
            ),
        )
        self.module.load_app_settings = lambda: dict(self.settings)
        self.module.get_export_dir = lambda: self.root / "exports"
        self.module.get_desktop_dir = lambda: self.root / "Desktop"
        self.module.DATA_DIR = self.root
        self.module.SETTINGS_PATH = self.root / "app_settings.json"
        self.module.Path = Path
        self.module.log_operation = Mock()
        self.smtp_instances = []

        def save_app_settings(updates):
            self.settings.update(updates)
            return dict(self.settings)

        def smtp_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            self.smtp_instances.append(smtp)
            return smtp

        self.module.save_app_settings = save_app_settings
        self.module._REMINDER_PROTECT_SECRET = lambda raw: b"protected:" + raw
        self.module._REMINDER_UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.module._REMINDER_SMTP_FACTORY = smtp_factory

        self.previous_winreg = sys.modules.get("winreg")
        self.previous_reminder_routing = sys.modules.get("reminder_routing")
        fake_winreg = types.ModuleType("winreg")
        fake_winreg.HKEY_CURRENT_USER = object()
        fake_winreg.KEY_READ = 1
        fake_winreg.OpenKey = Mock(side_effect=FileNotFoundError())
        sys.modules["winreg"] = fake_winreg
        sys.modules["reminder_routing"] = reminder_routing_module

    def tearDown(self):
        if self.previous_winreg is None:
            sys.modules.pop("winreg", None)
        else:
            sys.modules["winreg"] = self.previous_winreg
        if self.previous_reminder_routing is None:
            sys.modules.pop("reminder_routing", None)
        else:
            sys.modules["reminder_routing"] = self.previous_reminder_routing
        self.temporary.cleanup()

    def recipient_groups(self):
        return [
            {
                "id": "daily-team",
                "name": "日常跟进",
                "enabled": True,
                "order": 0,
                "recipients": ["Manager@Example.test"],
                "event_types": ["daily_stage", "project_create"],
                "content_fields": {
                    "project_number": True,
                    "project_name": True,
                    "stage_name": True,
                },
                "subject_prefix": "跟进",
            },
            {
                "id": "risk-team",
                "name": "风险预警",
                "enabled": True,
                "order": 1,
                "recipients": ["risk@example.test"],
                "event_types": ["project_complete", "supplier_shortage"],
                "content_fields": {
                    "project_name": True,
                    "supplier_missing": True,
                },
                "subject_prefix": "风险",
            },
        ]

    def test_get_settings_synthesizes_legacy_group_without_writing_settings(self):
        self.settings.update(self.valid_payload())
        self.settings.pop("smtp_password")
        self.assertFalse(self.module.SETTINGS_PATH.exists())

        response = self.module.api_get_settings()

        self.assertFalse(self.module.SETTINGS_PATH.exists())
        self.assertEqual(response["reminder_recipient_groups"][0]["name"], "默认组")
        self.assertEqual(
            response["reminder_recipient_groups"][0]["recipients"],
            ["ops@example.test"],
        )

    def test_get_settings_returns_four_safe_runtime_statuses(self):
        (self.root / "reminder_send_log.json").write_text(
            json.dumps(
                {
                    "last_check_at": "2026-08-14T09:00:00",
                    "last_success_at": None,
                    "last_error": "smtp.example.test private response",
                    "pending_count": 2,
                }
            ),
            encoding="utf-8",
        )

        response = self.module.api_get_settings()

        self.assertEqual(
            set(response["reminder_runtime_status"]),
            {"daily_stage", "project_create", "project_complete", "supplier_shortage"},
        )
        daily = response["reminder_runtime_status"]["daily_stage"]
        self.assertEqual(daily["last_check_at"], "2026-08-14T09:00:00")
        self.assertIsNone(daily["error_code"])
        self.assertNotIn("smtp.example.test", repr(response["reminder_runtime_status"]))

    def test_unreadable_startup_registry_does_not_block_other_settings(self):
        self.request.remote_addr = '127.0.0.1'
        sys.modules['winreg'].OpenKey.side_effect = PermissionError('denied')
        response = self.module.api_get_settings()
        self.assertIsInstance(response, dict)
        self.assertIsNone(response['startup_enabled'])
        self.assertIn('startup_error', response)
        self.assertIn('stage_templates', response)

    def test_invalid_reminder_status_shapes_do_not_break_settings(self):
        for value in [[], None, {'last_error':[]}, {'last_error':{'private':'value'}}]:
            with self.subTest(value=value):
                (self.root/'reminder_send_log.json').write_text(json.dumps(value),encoding='utf-8')
                (self.root/'daily_stage_delivery_state.json').write_text(json.dumps({'error_code':[]}),encoding='utf-8')
                response = self.module.api_get_settings()
                self.assertIsInstance(response,dict)
                self.assertIsNone(response['reminder_status']['last_error'])
                self.assertIsNone(response['reminder_runtime_status']['daily_stage']['error_code'])

    def test_runtime_status_rejects_untrusted_timestamp_and_error_text(self):
        (self.root / "reminder_send_log.json").write_text(
            json.dumps(
                {
                    "last_check_at": r"C:\\secret\\mail.txt account@example.test",
                    "last_success_at": "Traceback: smtp.example.test",
                    "error_code": "smtp.example.test rejected account@example.test",
                    "pending_count": 1,
                }
            ),
            encoding="utf-8",
        )

        response = self.module.api_get_settings()
        daily = response["reminder_runtime_status"]["daily_stage"]

        self.assertIsNone(daily["last_check_at"])
        self.assertIsNone(daily["last_success_at"])
        self.assertIsNone(daily["error_code"])
        self.assertNotIn("smtp.example.test", repr(response["reminder_runtime_status"]))
        self.assertNotIn("account@example.test", repr(response["reminder_runtime_status"]))

    def test_daily_runtime_status_prefers_current_delivery_state_over_legacy_log(self):
        (self.root / "reminder_send_log.json").write_text(
            json.dumps({
                "last_check_at": "2026-08-25T17:21:18",
                "last_success_at": "2026-08-25T17:21:18",
                "last_error": None,
                "pending_count": 0,
            }),
            encoding="utf-8",
        )
        (self.root / "daily_stage_delivery_state.json").write_text(
            json.dumps({
                "version": 1,
                "deliveries": {},
                "last_check_at": "2026-09-02T10:22:43",
                "last_success_at": None,
                "last_error": "SMTP_SEND_FAILED",
                "pending_count": 0,
            }),
            encoding="utf-8",
        )

        response = self.module.api_get_settings()

        daily = response["reminder_runtime_status"]["daily_stage"]
        self.assertEqual(daily["last_check_at"], "2026-09-02T10:22:43")
        self.assertEqual(daily["error_code"], "SMTP_SEND_FAILED")

    def test_group_save_persists_normalized_groups_and_legacy_union(self):
        payload = self.valid_payload()
        payload["reminder_recipient_groups"] = self.recipient_groups()
        self.request.json = payload

        response = self.module.api_update_settings()

        self.assertEqual(response["message"], "邮件提醒设置已保存")
        self.assertEqual(
            self.settings["reminder_recipients"],
            ["manager@example.test", "risk@example.test"],
        )
        self.assertEqual(
            [group["order"] for group in self.settings["reminder_recipient_groups"]],
            [0, 1],
        )
        self.assertTrue(self.settings["reminder_enabled"])
        self.assertTrue(self.settings["event_reminder_create_enabled"])
        self.assertTrue(self.settings["event_reminder_complete_enabled"])
        self.assertTrue(self.settings["supplier_shortage_email_enabled"])
        self.assertTrue(self.settings["reminder_content"]["supplier_missing"])

    def test_group_preview_uses_selected_group_without_sending(self):
        self.settings.update(self.valid_payload())
        self.settings.pop("smtp_password")
        self.settings["reminder_recipient_groups"] = self.recipient_groups()
        self.request.json = {
            "reminder_action": "preview_group",
            "reminder_group_id": "risk-team",
            "reminder_event_type": "supplier_shortage",
        }

        response = self.module.api_update_settings()

        self.assertEqual(response["preview"]["recipient_count"], 1)
        self.assertIn("[风险]", response["preview"]["subject"])
        self.assertIn("缺少数量", response["preview"]["body"])
        self.assertEqual(self.smtp_instances, [])

    def test_group_test_send_is_rate_limited_for_sixty_seconds(self):
        self.settings.update(self.valid_payload())
        self.settings.pop("smtp_password")
        self.settings["reminder_recipient_groups"] = self.recipient_groups()
        (self.root / "reminder_credentials.dpapi").write_bytes(b"protected:secret")
        self.request.json = {
            "reminder_action": "send_group_test",
            "reminder_group_id": "daily-team",
        }

        first = self.module.api_update_settings()
        second, status = self.module.api_update_settings()

        self.assertEqual(first["message"], "测试邮件已发送")
        self.assertEqual(status, 429)
        self.assertEqual(second["error_code"], "TEST_EMAIL_RATE_LIMITED")
        self.assertEqual(len(self.smtp_instances), 1)

    def test_invalid_group_test_does_not_consume_send_cooldown(self):
        self.settings.update(self.valid_payload())
        self.settings.pop("smtp_password")
        self.settings["reminder_recipient_groups"] = self.recipient_groups()
        (self.root / "reminder_credentials.dpapi").write_bytes(b"protected:secret")
        self.request.json = {
            "reminder_action": "send_group_test",
            "reminder_group_id": "missing-group",
        }
        invalid, invalid_status = self.module.api_update_settings()
        self.request.json["reminder_group_id"] = "daily-team"

        valid = self.module.api_update_settings()

        self.assertEqual(invalid_status, 400)
        self.assertIn("不存在", invalid["error"])
        self.assertEqual(valid["message"], "测试邮件已发送")

    def test_remote_request_cannot_preview_recipient_group(self):
        self.request.remote_addr = "203.0.113.5"
        self.request.json = {
            "reminder_action": "preview_group",
            "reminder_group_id": "daily-team",
        }

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 403)
        self.assertIn("本机", response["error"])

    def valid_payload(self):
        return {
            "reminder_enabled": True,
            "reminder_time": "09:00",
            "reminder_subject": "采购提醒：{date} 共 {count} 条",
            "reminder_advance_days": 2,
            "reminder_weekdays": [0, 1, 2, 3, 4],
            "smtp_host": "smtp.example.test",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "sender@example.test",
            "smtp_sender": "sender@example.test",
            "smtp_password": "secret-password",
            "reminder_recipients": ["ops@example.test", "OPS@example.test"],
            "reminder_stage_keys": ["registration_end", "bid_opening"],
            "reminder_content": {
                "project_number": True,
                "project_name": True,
                "purchaser": False,
                "stage_name": True,
                "planned_at": True,
                "registration_count": True,
            },
        }

    def install_file_backed_settings(self):
        def serialized():
            return (
                json.dumps(
                    self.settings,
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                )
                + "\n"
            ).encode("utf-8")

        self.module.SETTINGS_PATH.write_bytes(serialized())

        def save_app_settings(updates):
            self.settings.update(updates)
            self.module.SETTINGS_PATH.write_bytes(serialized())
            return dict(self.settings)

        self.module.save_app_settings = save_app_settings
        return serialized

    def test_all_weekdays_and_six_content_fields_survive_save(self):
        payload = self.valid_payload() | {"reminder_weekdays": list(range(7))}
        self.request.json = payload
        response = self.module.api_update_settings()
        self.assertIsInstance(response, dict)
        self.assertEqual(self.settings["reminder_weekdays"], list(range(7)))
        for key in payload["reminder_content"]:
            self.assertEqual(self.settings["reminder_content"][key], payload["reminder_content"][key])

    def test_main_content_updates_persisted_default_group(self):
        self.settings.update(self.valid_payload())
        self.settings["reminder_recipient_groups"] = [{
            "id": "legacy-default", "name": "默认组", "enabled": True, "order": 0,
            "recipients": ["ops@example.test"], "event_types": ["daily_stage"],
            "content_fields": {"project_number": True}, "subject_prefix": "",
        }]
        self.request.json = {"reminder_content": {"stage_name": True, "planned_at": True, "registration_count": True}}
        response = self.module.api_update_settings()
        self.assertIsInstance(response, dict)
        group = self.settings["reminder_recipient_groups"][0]
        self.assertTrue(group["content_fields"]["planned_at"])
        self.assertTrue(group["content_fields"]["registration_count"])

    def test_main_save_does_not_copy_other_group_recipients_into_default(self):
        self.settings.update(self.valid_payload())
        self.settings["reminder_recipients"] = ["ops@example.test", "private@example.test"]
        self.settings["reminder_recipient_groups"] = [
            {"id": "legacy-default", "name": "默认组", "enabled": True, "order": 0, "recipients": ["ops@example.test"], "event_types": ["daily_stage"], "content_fields": {"project_number": True}, "subject_prefix": ""},
            {"id": "private", "name": "专用组", "enabled": True, "order": 1, "recipients": ["private@example.test"], "event_types": ["daily_stage"], "content_fields": {"project_name": True}, "subject_prefix": ""},
        ]
        self.request.json = {"reminder_recipients": ["ops@example.test", "private@example.test"], "reminder_content": {"project_number": True, "planned_at": True}}
        self.module.api_update_settings()
        self.assertEqual(self.settings["reminder_recipient_groups"][0]["recipients"], ["ops@example.test"])

    def test_selected_group_preview_does_not_merge_other_group_fields(self):
        self.settings.update(self.valid_payload())
        groups = self.recipient_groups()
        groups[1]["recipients"] = groups[0]["recipients"]
        groups[1]["event_types"] = ["daily_stage"]
        groups[1]["content_fields"] = {"planned_at": True}
        groups[1]["subject_prefix"] = "第二组"
        self.request.json = {"reminder_action": "preview_group", "reminder_recipient_groups": groups, "reminder_group_id": groups[1]["id"], "reminder_event_type": "daily_stage"}
        response = self.module.api_update_settings()
        self.assertNotIn("项目编号", response["preview"]["body"])
        self.assertIn("第二组", response["preview"]["subject"])

    def test_empty_default_subscription_fields_rejected_without_corrupting_groups(self):
        self.settings.update(self.valid_payload())
        self.settings["reminder_recipient_groups"] = [{"id": "legacy-default", "name": "默认组", "enabled": True, "order": 0, "recipients": ["ops@example.test"], "event_types": ["daily_stage"], "content_fields": {"project_number": True}, "subject_prefix": ""}]
        before = json.loads(json.dumps(self.settings))
        self.request.json = {"reminder_content": {key: False for key in self.valid_payload()["reminder_content"]}}
        response, status = self.module.api_update_settings()
        self.assertEqual(status, 400)
        self.assertEqual(self.settings, before)

    def test_each_selected_group_event_requires_an_applicable_field(self):
        self.settings.update(self.valid_payload())
        group = self.recipient_groups()[0] | {"event_types": ["daily_stage", "project_create"], "content_fields": {"stage_name": True}}
        self.request.json = {"reminder_recipient_groups": [group]}
        response, status = self.module.api_update_settings()
        self.assertEqual(status, 400)
        self.assertIn("项目新建", response["error"])

    def test_enabling_project_events_with_only_daily_fields_reports_configuration_error(self):
        self.request.json = self.valid_payload() | {"event_reminder_create_enabled": True, "reminder_content": {"stage_name": True}}
        response, status = self.module.api_update_settings()
        self.assertEqual(status, 400)
        self.assertIn("内容字段", response["error"])

    def test_partial_test_refusal_does_not_report_success_or_save(self):
        before = dict(self.settings)
        smtp = FakeSMTP('smtp.example.test',465)
        smtp.send_message = Mock(return_value={'ops@example.test':(550,b'server response must not leak')})
        self.module._REMINDER_SMTP_FACTORY = lambda *args, **kwargs: smtp
        self.request.json = self.valid_payload() | {"reminder_action":"send_test"}
        response, status = self.module.api_update_settings()
        self.assertEqual(status,502)
        self.assertNotIn('server response must not leak',response['error'])
        self.assertEqual(self.settings,before)

    def test_preview_does_not_persist_draft_settings_or_password(self):
        self.settings.update(self.valid_payload())
        before = dict(self.settings)
        self.request.json = self.valid_payload() | {"reminder_action": "preview", "reminder_subject": "草稿 {date}"}
        response = self.module.api_update_settings()
        self.assertIsInstance(response, dict)
        self.assertEqual(self.settings, before)
        self.assertFalse((self.root / "reminder_credentials.dpapi").exists())

    def test_preview_honors_hidden_stage_and_opening_time_fields(self):
        self.request.json = self.valid_payload() | {
            "reminder_action": "preview",
            "reminder_content": {"project_number": True, "stage_name": False, "planned_at": False},
        }
        response = self.module.api_update_settings()
        body = response["preview"]["body"]
        self.assertNotIn("报名截止", body)
        self.assertNotIn("开标", body)
        self.assertNotIn("计划时间", body)

    def test_configured_competitive_stage_keys_can_be_saved(self):
        self.module.STAGES = [{"key": "plan_received", "name": "接收项目"}, {"key": "archived", "name": "归档"}]
        self.request.json = {"reminder_stage_keys": ["plan_received", "online_quotation"]}
        response = self.module.api_update_settings()
        self.assertIsInstance(response, dict)
        self.assertEqual(self.settings["reminder_stage_keys"], ["plan_received", "online_quotation"])

    def test_competitive_only_preview_uses_competitive_stage_name(self):
        self.module.STAGES = [{"key": "plan_received", "name": "接收项目"}, {"key": "archived", "name": "归档"}]
        self.request.json = {"reminder_action": "preview", "reminder_stage_keys": ["online_quotation"]}
        response = self.module.api_update_settings()
        self.assertIn("一次报价竞价", response["preview"]["body"])
        self.assertNotIn("报名截止", response["preview"]["body"])

    def test_get_settings_redacts_smtp_password(self):
        self.settings.update(self.valid_payload())
        self.settings.pop("smtp_password")
        (self.root / "reminder_credentials.dpapi").write_bytes(b"protected:secret")

        response = self.module.api_get_settings()

        self.assertNotIn("smtp_password", response)
        self.assertTrue(response["smtp_password_configured"])
        self.assertEqual(response["reminder_time"], "09:00")

    def test_valid_settings_are_normalized_and_password_is_separate(self):
        self.request.json = self.valid_payload()

        response = self.module.api_update_settings()

        self.assertEqual(response["message"], "邮件提醒设置已保存")
        self.assertEqual(self.settings["reminder_recipients"], ["ops@example.test"])
        self.assertNotIn("smtp_password", self.settings)
        self.assertEqual(
            (self.root / "reminder_credentials.dpapi").read_bytes(),
            b"protected:secret-password",
        )

    def test_invalid_recipient_is_rejected_without_saving(self):
        self.request.json = self.valid_payload() | {"reminder_recipients": ["invalid"]}

        response, status = self.module.api_update_settings()
        self.assertEqual(status, 400)
        self.assertIn("error", response)
        self.assertNotIn("reminder_enabled", self.settings)

    def test_remote_request_cannot_change_reminder_settings(self):
        self.request.remote_addr = "192.168.1.9"
        self.request.json = self.valid_payload()

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 403)
        self.assertIn("error", response)
        self.assertNotIn("reminder_enabled", self.settings)

    def test_test_email_uses_saved_password_and_contains_no_project_data(self):
        payload = self.valid_payload()
        self.request.json = payload
        self.module.api_update_settings()
        self.request.json = {**payload, "smtp_password": "", "reminder_action": "send_test"}

        response = self.module.api_update_settings()

        self.assertEqual(response["message"], "测试邮件已发送")
        smtp = self.smtp_instances[-1]
        self.assertEqual(smtp.logged_in, ("sender@example.test", "secret-password"))
        self.assertEqual(len(smtp.messages), 1)
        rendered = smtp.messages[0].as_string().lower()
        self.assertNotIn("project", rendered)
        self.assertNotIn("项目编号", rendered)

    def test_successful_test_requeues_only_nonexpired_failed_stage_reminders(self):
        payload = self.valid_payload()
        self.request.json = payload
        self.module.api_update_settings()
        today = datetime.now().date()
        future = datetime.combine(today + timedelta(days=1), datetime.min.time())
        expired = datetime.combine(today - timedelta(days=1), datetime.min.time())
        state_path = self.root / "daily_stage_delivery_state.json"
        state_path.write_text(
            json.dumps({
                "version": 1,
                "deliveries": {
                    "a" * 64: {
                        "status": "failed",
                        "attempts": 3,
                        "error_code": "SMTP_SEND_FAILED",
                        "next_attempt_at": None,
                        "sent_at": None,
                        "event": {
                            "event_type": "daily_stage",
                            "planned_at": future.strftime("%Y-%m-%d %H:%M"),
                        },
                    },
                    "b" * 64: {
                        "status": "failed",
                        "attempts": 3,
                        "error_code": "SMTP_SEND_FAILED",
                        "next_attempt_at": None,
                        "sent_at": None,
                        "event": {
                            "event_type": "daily_stage",
                            "planned_at": expired.strftime("%Y-%m-%d %H:%M"),
                        },
                    },
                },
                "last_check_at": datetime.now().isoformat(timespec="seconds"),
                "last_success_at": None,
                "last_error": "SMTP_SEND_FAILED",
                "pending_count": 0,
            }),
            encoding="utf-8",
        )
        self.request.json = {**payload, "smtp_password": "", "reminder_action": "send_test"}

        response = self.module.api_update_settings()

        state = json.loads(state_path.read_text(encoding="utf-8"))
        active = state["deliveries"]["a" * 64]
        old = state["deliveries"]["b" * 64]
        self.assertEqual(response["requeued_failed_reminders"], 1)
        self.assertEqual(active["status"], "pending")
        self.assertEqual(active["attempts"], 0)
        self.assertIsNone(active["error_code"])
        self.assertIsNotNone(active["next_attempt_at"])
        self.assertEqual(old["status"], "failed")
        self.assertEqual(old["attempts"], 3)

    def test_successful_test_does_not_fail_when_delivery_state_is_invalid(self):
        payload = self.valid_payload()
        self.request.json = payload
        self.module.api_update_settings()
        state_path = self.root / "daily_stage_delivery_state.json"
        state_path.write_text("not-json", encoding="utf-8")
        self.request.json = {**payload, "smtp_password": "", "reminder_action": "send_test"}

        response = self.module.api_update_settings()

        self.assertEqual(response["message"], "测试邮件已发送")
        self.assertEqual(response["requeued_failed_reminders"], 0)
        self.assertEqual(state_path.read_text(encoding="utf-8"), "not-json")
        self.module.app.logger.exception.assert_called_with(
            "requeue failed stage reminders failed"
        )

    def test_outlook_password_test_is_rejected_before_credential_or_network_work(self):
        payload = self.valid_payload() | {
            "smtp_host": "smtp-mail.outlook.com",
            "smtp_port": 587,
            "smtp_security": "starttls",
            "smtp_username": "sender@outlook.com",
            "smtp_sender": "sender@outlook.com",
            "reminder_action": "send_test",
        }
        self.request.json = payload

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertIn("OAuth2", response["error"])
        self.assertFalse((self.root / "reminder_credentials.dpapi").exists())
        self.assertEqual(self.smtp_instances, [])

    def test_outlook_hostname_is_normalized_before_oauth_fail_closed_check(self):
        payload = self.valid_payload() | {
            "smtp_host": "SMTP.Office365.Com.",
            "smtp_port": 587,
            "smtp_security": "starttls",
            "reminder_action": "send_test",
        }
        self.request.json = payload

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertIn("OAuth2", response["error"])
        self.assertFalse((self.root / "reminder_credentials.dpapi").exists())
        self.assertEqual(self.smtp_instances, [])

    def test_smtp_authentication_failure_returns_actionable_json_error(self):
        payload = self.valid_payload()
        self.request.json = payload
        self.module.api_update_settings()

        def failing_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            smtp.login = Mock(side_effect=smtplib.SMTPAuthenticationError(535, b"denied"))
            return smtp

        self.module._REMINDER_SMTP_FACTORY = failing_factory
        self.request.json = {**payload, "smtp_password": "", "reminder_action": "send_test"}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 502)
        self.assertIn("SMTP 身份验证失败", response["error"])
        self.assertNotIn("denied", response["error"])

    def test_failed_test_with_new_password_preserves_old_settings_and_credential(self):
        old_credential = b"protected:old-test-credential"
        credential_path = self.root / "reminder_credentials.dpapi"
        credential_path.write_bytes(old_credential)
        self.settings.update(self.valid_payload() | {"reminder_subject": "原有主题 {date} {count}"})
        self.settings.pop("smtp_password", None)

        def failing_factory(host, port, **kwargs):
            smtp = FakeSMTP(host, port, **kwargs)
            smtp.login = Mock(
                side_effect=smtplib.SMTPAuthenticationError(535, b"rejected")
            )
            return smtp

        self.module._REMINDER_SMTP_FACTORY = failing_factory
        self.request.json = self.valid_payload() | {
            "reminder_subject": "不应保存 {date} {count}",
            "smtp_password": "replacement-test-credential",
            "reminder_action": "send_test",
        }

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 502)
        self.assertIn("SMTP 身份验证失败", response["error"])
        self.assertEqual(credential_path.read_bytes(), old_credential)
        self.assertEqual(self.settings["reminder_subject"], "原有主题 {date} {count}")

    def test_credential_replace_failure_rolls_back_settings_and_keeps_old_credential(self):
        credential_path = self.root / "reminder_credentials.dpapi"
        old_credential = b"protected:old-replace-credential"
        credential_path.write_bytes(old_credential)
        self.settings.update(
            self.valid_payload()
            | {"reminder_subject": "原有配置 {date} {count}"}
        )
        self.settings.pop("smtp_password", None)
        serialized = self.install_file_backed_settings()
        settings_before = dict(self.settings)
        settings_bytes_before = serialized()
        self.request.json = self.valid_payload() | {
            "reminder_subject": "不应落盘 {date} {count}",
            "smtp_password": "replacement-for-failed-commit",
        }

        real_replace = os.replace

        def fail_credential_replace(source, destination):
            if Path(destination) == credential_path:
                raise OSError("synthetic replace failure")
            return real_replace(source, destination)

        with patch("os.replace", side_effect=fail_credential_replace):
            response, status = self.module.api_update_settings()

        self.assertEqual(status, 500)
        self.assertEqual(response["error"], "无法安全保存 SMTP 密码")
        self.assertEqual(self.settings, settings_before)
        self.assertEqual(self.module.SETTINGS_PATH.read_bytes(), settings_bytes_before)
        self.assertEqual(credential_path.read_bytes(), old_credential)

    def test_credential_temp_write_failure_rolls_back_settings_and_keeps_old_credential(self):
        credential_path = self.root / "reminder_credentials.dpapi"
        old_credential = b"protected:old-write-credential"
        credential_path.write_bytes(old_credential)
        self.settings.update(
            self.valid_payload()
            | {"reminder_subject": "写入前配置 {date} {count}"}
        )
        self.settings.pop("smtp_password", None)
        serialized = self.install_file_backed_settings()
        settings_before = dict(self.settings)
        settings_bytes_before = serialized()
        self.request.json = self.valid_payload() | {
            "reminder_subject": "写入失败不应落盘 {date} {count}",
            "smtp_password": "replacement-for-failed-write",
        }

        real_write_bytes = Path.write_bytes

        def fail_credential_temp_write(path, value):
            if Path(path).name == "reminder_credentials.dpapi.tmp":
                raise OSError("synthetic credential write failure")
            return real_write_bytes(path, value)

        with patch.object(Path, "write_bytes", new=fail_credential_temp_write):
            response, status = self.module.api_update_settings()

        self.assertEqual(status, 500)
        self.assertEqual(response["error"], "无法安全保存 SMTP 密码")
        self.assertEqual(self.settings, settings_before)
        self.assertEqual(self.module.SETTINGS_PATH.read_bytes(), settings_bytes_before)
        self.assertEqual(credential_path.read_bytes(), old_credential)

    def test_settings_save_failure_never_commits_new_credential(self):
        credential_path = self.root / "reminder_credentials.dpapi"
        old_credential = b"protected:old-settings-credential"
        credential_path.write_bytes(old_credential)
        self.settings.update(self.valid_payload())
        self.settings.pop("smtp_password", None)
        serialized = self.install_file_backed_settings()
        settings_before = dict(self.settings)
        settings_bytes_before = serialized()

        save_attempts = 0

        def partially_failing_save(updates):
            nonlocal save_attempts
            save_attempts += 1
            if save_attempts == 1:
                self.settings.update(updates)
                self.module.SETTINGS_PATH.write_text(
                    json.dumps(self.settings, ensure_ascii=False, sort_keys=True),
                    encoding="utf-8",
                )
                raise OSError("synthetic settings save failure")
            self.settings.clear()
            self.settings.update(updates)
            self.module.SETTINGS_PATH.write_bytes(serialized())
            return dict(self.settings)

        self.module.save_app_settings = partially_failing_save
        self.request.json = self.valid_payload() | {
            "smtp_password": "replacement-after-settings-failure"
        }

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 500)
        self.assertEqual(response["error"], "保存系统设置失败")
        self.assertEqual(self.settings, settings_before)
        self.assertEqual(self.module.SETTINGS_PATH.read_bytes(), settings_bytes_before)
        self.assertEqual(credential_path.read_bytes(), old_credential)

    def test_interrupted_credential_transaction_recovers_old_file_before_read(self):
        old_settings = self.valid_payload() | {
            "reminder_subject": "事务前配置 {date} {count}"
        }
        new_settings = old_settings | {
            "reminder_subject": "中断后的新配置 {date} {count}"
        }
        self.settings.clear()
        self.settings.update(new_settings)
        old_bytes = (
            json.dumps(old_settings, ensure_ascii=False, sort_keys=True) + "\n"
        ).encode("utf-8")
        self.module.SETTINGS_PATH.write_text(
            json.dumps(new_settings, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        rollback_path = self.root / "app_settings.json.reminder-rollback"
        rollback_path.write_bytes(old_bytes)
        pending_path = self.root / "reminder_credentials.dpapi.tmp"
        pending_path.write_bytes(b"protected:new-secret")
        marker_path = self.root / "reminder_settings_transaction.json"
        marker_path.write_text(
            json.dumps({"version": 1, "mode": "set", "settings_existed": True}),
            encoding="utf-8",
        )
        credential_path = self.root / "reminder_credentials.dpapi"
        credential_path.write_bytes(b"protected:old-secret")

        def load_file_settings():
            loaded = json.loads(self.module.SETTINGS_PATH.read_text(encoding="utf-8"))
            self.settings.clear()
            self.settings.update(loaded)
            return dict(loaded)

        self.module.load_app_settings = load_file_settings

        response = self.module.api_get_settings()

        self.assertEqual(response["reminder_subject"], old_settings["reminder_subject"])
        self.assertEqual(self.settings, old_settings)
        self.assertEqual(self.module.SETTINGS_PATH.read_bytes(), old_bytes)
        self.assertEqual(credential_path.read_bytes(), b"protected:old-secret")
        self.assertFalse(marker_path.exists())
        self.assertFalse(rollback_path.exists())
        self.assertFalse(pending_path.exists())

    def test_non_reminder_update_recovers_pending_transaction_before_saving(self):
        old_settings = self.valid_payload() | {
            "login_subtitle": "事务前副标题",
            "reminder_subject": "事务前配置 {date} {count}",
        }
        interrupted_settings = old_settings | {
            "reminder_subject": "尚未提交配置 {date} {count}"
        }
        old_bytes = (
            json.dumps(old_settings, ensure_ascii=False, sort_keys=True) + "\n"
        ).encode("utf-8")
        self.module.SETTINGS_PATH.write_text(
            json.dumps(interrupted_settings, ensure_ascii=False, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        rollback_path = self.root / "app_settings.json.reminder-rollback"
        rollback_path.write_bytes(old_bytes)
        pending_path = self.root / "reminder_credentials.dpapi.tmp"
        pending_path.write_bytes(b"protected:new-secret")
        marker_path = self.root / "reminder_settings_transaction.json"
        marker_path.write_text(
            json.dumps({"version": 1, "mode": "set", "settings_existed": True}),
            encoding="utf-8",
        )
        credential_path = self.root / "reminder_credentials.dpapi"
        credential_path.write_bytes(b"protected:old-secret")

        def load_file_settings():
            loaded = json.loads(self.module.SETTINGS_PATH.read_text(encoding="utf-8"))
            self.settings.clear()
            self.settings.update(loaded)
            return dict(loaded)

        def save_file_settings(updates):
            saved = load_file_settings()
            saved.update(updates)
            self.settings.clear()
            self.settings.update(saved)
            self.module.SETTINGS_PATH.write_text(
                json.dumps(saved, ensure_ascii=False, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            return dict(saved)

        self.module.load_app_settings = load_file_settings
        self.module.save_app_settings = save_file_settings
        self.request.json = {"login_subtitle": "accepted but retained"}

        update_response = self.module.api_update_settings()
        read_response = self.module.api_get_settings()

        self.assertEqual(
            update_response["settings"]["login_subtitle"], "accepted but retained"
        )
        self.assertEqual(read_response["login_subtitle"], "accepted but retained")
        self.assertEqual(
            read_response["reminder_subject"], old_settings["reminder_subject"]
        )
        self.assertEqual(credential_path.read_bytes(), b"protected:old-secret")
        self.assertFalse(marker_path.exists())
        self.assertFalse(rollback_path.exists())
        self.assertFalse(pending_path.exists())

    def test_non_reminder_update_fails_closed_when_recovery_is_invalid(self):
        settings_before = dict(self.settings)
        marker_path = self.root / "reminder_settings_transaction.json"
        marker_path.write_text("not-json", encoding="utf-8")
        self.request.json = {"login_subtitle": "must not be accepted"}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 500)
        self.assertIn("恢复失败", response["error"])
        self.assertEqual(self.settings, settings_before)
        self.assertEqual(marker_path.read_text(encoding="utf-8"), "not-json")

    @unittest.skipUnless(sys.platform == "win32", "Windows DPAPI is only available on Windows")
    def test_windows_dpapi_round_trip_uses_no_plaintext_credential(self):
        del self.module._REMINDER_PROTECT_SECRET
        del self.module._REMINDER_UNPROTECT_SECRET
        payload = self.valid_payload()
        self.request.json = payload

        saved = self.module.api_update_settings()
        protected = (self.root / "reminder_credentials.dpapi").read_bytes()
        self.assertNotIn(b"secret-password", protected)

        self.request.json = {**payload, "smtp_password": "", "reminder_action": "send_test"}
        sent = self.module.api_update_settings()

        self.assertEqual(saved["message"], "邮件提醒设置已保存")
        self.assertEqual(sent["message"], "测试邮件已发送")
        self.assertEqual(
            self.smtp_instances[-1].logged_in,
            ("sender@example.test", "secret-password"),
        )

    def test_custom_subject_is_saved_and_applied_to_test_email(self):
        payload = self.valid_payload()
        self.request.json = payload
        self.module.api_update_settings()

        self.assertEqual(self.settings["reminder_subject"], "采购提醒：{date} 共 {count} 条")

        self.request.json = {**payload, "smtp_password": "", "reminder_action": "send_test"}
        self.module.api_update_settings()

        subject = self.smtp_instances[-1].messages[0]["Subject"]
        self.assertIn("采购提醒", subject)

    def test_empty_subject_is_rejected(self):
        self.request.json = self.valid_payload() | {"reminder_subject": ""}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertIn("error", response)

    def test_advance_days_out_of_range_is_rejected(self):
        self.request.json = self.valid_payload() | {"reminder_advance_days": 50}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertIn("error", response)

    def test_empty_weekdays_is_rejected(self):
        self.request.json = self.valid_payload() | {"reminder_weekdays": []}

        response, status = self.module.api_update_settings()

        self.assertEqual(status, 400)
        self.assertIn("error", response)

    def test_preview_action_returns_subject_and_body_without_sending(self):
        payload = self.valid_payload()
        self.request.json = payload
        self.module.api_update_settings()

        self.request.json = {**payload, "smtp_password": "", "reminder_action": "preview"}
        response = self.module.api_update_settings()

        self.assertEqual(response["message"], "邮件预览已生成")
        self.assertIn("采购提醒", response["preview"]["subject"])
        body = response["preview"]["body"]
        self.assertEqual(body.splitlines()[0], "以下流程节点即将到期，请及时跟进：")
        self.assertNotIn("共有", body.splitlines()[0])
        self.assertIn("项目编号", body)
        self.assertEqual(self.smtp_instances, [])

    def test_preview_excludes_unchecked_content_fields(self):
        payload = self.valid_payload() | {
            "reminder_content": {
                "project_number": True,
                "project_name": False,
                "purchaser": False,
                "stage_name": True,
                "planned_at": False,
                "registration_count": False,
            }
        }
        self.request.json = payload
        self.module.api_update_settings()

        self.request.json = {**payload, "smtp_password": "", "reminder_action": "preview"}
        response = self.module.api_update_settings()

        body = response["preview"]["body"]
        self.assertIn("项目编号", body)
        self.assertNotIn("项目名称", body)
        self.assertNotIn("采购人", body)


if __name__ == "__main__":
    unittest.main()
