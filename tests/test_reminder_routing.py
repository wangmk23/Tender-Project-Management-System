import copy
import smtplib
import unittest

try:
    from src.backend_patches import reminder_routing as subject
except ImportError:
    subject = None


def valid_group(**overrides):
    group = {
        "id": "group-a",
        "name": "项目组",
        "enabled": True,
        "order": 0,
        "recipients": ["ops@example.com"],
        "event_types": ["project_create"],
        "content_fields": {"project_number": True},
        "subject_prefix": "",
    }
    group.update(overrides)
    return group


def full_event(event_type, **extra):
    event = {
        "event_type": event_type,
        "event_key": f"{event_type}:42",
        "project_number": "GD-042",
        "project_name": "示例采购项目",
        "purchaser": "采购单位",
        "method": "公开招标",
        "year": 2026,
        "stage_name": "文件编制",
        "planned_at": "2026-08-15 09:00",
        "registration_count": 2,
        "event_at": "2026-08-14 10:00",
        "progress": 20,
        "lot_identity": "包1 软件服务",
        "supplier_count": 2,
        "supplier_minimum": 3,
        "supplier_missing": 1,
        "registration_deadline": "2026-08-15 17:00",
    }
    event.update(extra)
    return event


def delivery_for(event_type, recipient="ops@example.com", content_fields=None):
    fields = content_fields or ["project_number"]
    return {
        "recipient": recipient,
        "event_type": event_type,
        "content_fields": fields,
        "subject_prefix": "内部",
        "group_ids": ["group-a"],
        "rules_fingerprint": "f" * 64,
    }


class RecordingSMTP:
    def __init__(self, fail_recipients=(), auth_failure=False):
        self.fail_recipients = set(fail_recipients)
        self.auth_failure = auth_failure
        self.connection_calls = 0
        self.login_calls = 0
        self.starttls_calls = 0
        self.sent = []

    def connect(self, host, port, timeout=None):
        self.connection_calls += 1
        self.host = host
        self.port = port
        self.timeout = timeout
        return 220, b"ready"

    def starttls(self, context=None):
        self.starttls_calls += 1

    def login(self, username, password):
        self.login_calls += 1
        if self.auth_failure:
            raise smtplib.SMTPAuthenticationError(535, b"secret server response")

    def send_message(self, message):
        recipient = message["To"]
        self.sent.append(recipient)
        if recipient in self.fail_recipients:
            raise smtplib.SMTPRecipientsRefused({recipient: (550, b"private response")})

    def quit(self):
        return 221, b"bye"


class PreconnectedSMTP:
    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.timeout = timeout
        self.context = context
        self.login_calls = 0
        self.messages = []

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, traceback):
        return False

    def login(self, username, password):
        self.login_calls += 1

    def send_message(self, message):
        self.messages.append(message)


def message_to(recipient):
    return subject.render_recipient_message(
        full_event("project_create"),
        delivery_for("project_create", recipient),
        "sender@example.com",
    )


class ReminderRoutingTests(unittest.TestCase):
    def test_default_smtp_clients_use_real_connect_signature_and_configured_timeout(self):
        from unittest.mock import patch

        for security, port in (("ssl", 465), ("starttls", 587)):
            with self.subTest(security=security), \
                 patch.object(smtplib.SMTP, "connect", autospec=True, return_value=(220, b"ready")) as connect, \
                 patch.object(smtplib.SMTP, "login", autospec=True), \
                 patch.object(smtplib.SMTP, "starttls", autospec=True), \
                 patch.object(smtplib.SMTP, "send_message", autospec=True), \
                 patch.object(smtplib.SMTP, "quit", autospec=True):
                results = subject.send_delivery_batch(
                    [("k1", message_to("a@example.com"))],
                    {"host": "smtp.example.com", "port": port, "security": security,
                     "username": "sender@example.com", "timeout": 7},
                    "opaque-secret",
                )
                self.assertEqual(results[0]["status"], "sent")
                client = connect.call_args.args[0]
                self.assertEqual(client.timeout, 7)
                connect.assert_called_once_with(client, "smtp.example.com", port)

    def setUp(self):
        self.assertIsNotNone(subject, "reminder_routing module must exist")

    def test_legacy_settings_synthesize_default_group_without_mutation(self):
        settings = {
            "reminder_enabled": True,
            "reminder_recipients": [" OPS@Example.com ", "ops@example.com"],
            "reminder_content": {"project_number": True, "project_name": True},
            "project_created_email_enabled": True,
            "project_completed_email_enabled": True,
            "supplier_shortage_email_enabled": True,
        }
        original = copy.deepcopy(settings)
        groups = subject.normalize_recipient_groups(settings)
        self.assertEqual(settings, original)
        self.assertEqual(groups[0]["name"], "默认组")
        self.assertEqual(groups[0]["recipients"], ["ops@example.com"])
        self.assertEqual(groups[0]["event_types"], list(subject.EVENT_TYPES))

    def test_validation_rejects_unapproved_content_field(self):
        group = valid_group(content_fields={"supplier_name": True})
        with self.assertRaises(subject.RecipientGroupValidationError) as caught:
            subject.validate_recipient_groups([group])
        self.assertEqual(caught.exception.code, "CONFIG_INVALID")

    def test_validation_enforces_group_limits(self):
        cases = [
            ([valid_group(**{"id": f"g-{index}"}) for index in range(21)], "最多允许 20 个收件组"),
            ([valid_group(recipients=[f"u{index}@example.com" for index in range(21)])], "每组最多允许 20 个邮箱"),
            ([valid_group(name=" ")], "组名长度必须为 1 至 40 个字符"),
            ([valid_group(subject_prefix="x" * 31)], "主题前缀最多 30 个字符"),
            ([valid_group(recipients=["bad\n@example.com"])], "邮箱格式不正确"),
            ([valid_group(event_types=[])], "启用的收件组至少选择一种提醒类型"),
        ]
        for groups, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(subject.RecipientGroupValidationError, message):
                    subject.validate_recipient_groups(groups)

    def test_duplicate_email_is_merged_once_with_union_and_first_prefix(self):
        groups = [
            valid_group(id="g1", order=0, recipients=["a@example.com"], content_fields={"project_number": True}, subject_prefix="甲"),
            valid_group(id="g2", order=1, recipients=["A@example.com"], content_fields={"project_name": True}, subject_prefix="乙"),
        ]
        deliveries = subject.route_reminder_event(
            {"event_type": "project_create", "event_key": "project_create:7"}, groups
        )
        self.assertEqual(len(deliveries), 1)
        self.assertEqual(deliveries[0]["recipient"], "a@example.com")
        self.assertEqual(deliveries[0]["content_fields"], ["project_name", "project_number"])
        self.assertEqual(deliveries[0]["subject_prefix"], "甲")
        self.assertEqual(deliveries[0]["group_ids"], ["g1", "g2"])
        self.assertEqual(len(deliveries[0]["rules_fingerprint"]), 64)

    def test_renderer_emits_only_selected_allowlisted_fields(self):
        for event_type in subject.EVENT_TYPES:
            with self.subTest(event_type=event_type):
                selected_field = sorted(subject.FIELD_ALLOWLISTS[event_type])[0]
                event = full_event(event_type, secret="must-not-appear", absolute_path="C:/private/file")
                message = subject.render_recipient_message(
                    event, delivery_for(event_type, content_fields=[selected_field]), "sender@example.com"
                )
                rendered = message.as_string()
                self.assertNotIn("must-not-appear", rendered)
                self.assertNotIn("C:/private/file", rendered)
                self.assertEqual(message["To"], "ops@example.com")
                self.assertEqual(message["From"], "sender@example.com")
                self.assertEqual(message.get_body(preferencelist=("plain",)).get_content().count("："), 1)

    def test_renderer_rejects_header_injection(self):
        delivery = delivery_for("project_create") | {"subject_prefix": "安全\r\nBcc: bad@example.com"}
        with self.assertRaisesRegex(ValueError, "邮件头"):
            subject.render_recipient_message(full_event("project_create"), delivery, "sender@example.com")

    def test_batch_logs_in_once_and_reports_each_recipient(self):
        smtp = RecordingSMTP(fail_recipients={"bad@example.com"})
        results = subject.send_delivery_batch(
            [("k1", message_to("ok@example.com")), ("k2", message_to("bad@example.com"))],
            {"host": "smtp.example.com", "port": 587, "security": "starttls", "username": "sender@example.com"},
            "opaque-secret",
            smtp_factory=lambda: smtp,
        )
        self.assertEqual(smtp.connection_calls, 1)
        self.assertEqual(smtp.starttls_calls, 1)
        self.assertEqual(smtp.login_calls, 1)
        self.assertEqual(results, [
            {"delivery_key": "k1", "recipient": "ok@example.com", "status": "sent", "error_code": None},
            {"delivery_key": "k2", "recipient": "bad@example.com", "status": "failed", "error_code": "SMTP_SEND_FAILED"},
        ])

    def test_auth_failure_is_safe_and_marks_every_message_failed(self):
        smtp = RecordingSMTP(auth_failure=True)
        results = subject.send_delivery_batch(
            [("k1", message_to("a@example.com")), ("k2", message_to("b@example.com"))],
            {"host": "smtp.example.com", "port": 465, "security": "ssl", "username": "sender@example.com"},
            "opaque-secret",
            smtp_factory=lambda: smtp,
        )
        self.assertEqual(smtp.login_calls, 1)
        self.assertEqual(smtp.sent, [])
        self.assertEqual([item["error_code"] for item in results], ["SMTP_AUTH_FAILED", "SMTP_AUTH_FAILED"])
        self.assertNotIn("secret server response", repr(results))

    def test_batch_accepts_existing_preconnected_smtp_factory_contract(self):
        instances = []

        def factory(host, port, **kwargs):
            smtp = PreconnectedSMTP(host, port, **kwargs)
            instances.append(smtp)
            return smtp

        results = subject.send_delivery_batch(
            [("k1", message_to("a@example.com"))],
            {"host": "smtp.example.com", "port": 465, "security": "ssl", "username": "sender@example.com"},
            "opaque-secret",
            smtp_factory=factory,
        )

        self.assertEqual(results[0]["status"], "sent")
        self.assertEqual(len(instances), 1)
        self.assertEqual(instances[0].host, "smtp.example.com")
        self.assertEqual(instances[0].login_calls, 1)
        self.assertEqual(len(instances[0].messages), 1)


if __name__ == "__main__":
    unittest.main()
