"""Pure recipient-group routing and SMTP delivery helpers."""

from __future__ import annotations

import hashlib
import html
import inspect
import json
import math
import re
import smtplib
import ssl
import uuid
from email.message import EmailMessage


EVENT_TYPES = (
    "daily_stage",
    "project_create",
    "project_complete",
    "supplier_shortage",
    "deposit_refund",
    "deposit_review",
    "business_deadline",
    "deadline_review",
)
FIELD_ALLOWLISTS = {
    "business_deadline": frozenset({'project_number','project_name','purchaser','method','year','lot_identity','stage_name','deadline_title','deadline_at','deadline_status','deadline_basis'}),
    "deadline_review": frozenset({'project_number','project_name','purchaser','method','year','lot_identity','stage_name','deadline_title','deadline_at','deadline_status','deadline_basis','review_reason'}),
    "deposit_refund": frozenset({'project_number','project_name','purchaser','method','year','lot_identity','supplier_name','deposit_balance','refund_deadline','refund_status','review_at'}),
    "deposit_review": frozenset({'project_number','project_name','purchaser','method','year','lot_identity','supplier_name','deposit_balance','refund_deadline','refund_status','review_at'}),
    "daily_stage": frozenset(
        {
            "project_number",
            "project_name",
            "purchaser",
            "method",
            "year",
            "stage_name",
            "planned_at",
            "registration_count",
        }
    ),
    "project_create": frozenset(
        {
            "project_number",
            "project_name",
            "purchaser",
            "method",
            "year",
            "event_at",
            "progress",
        }
    ),
    "project_complete": frozenset(
        {
            "project_number",
            "project_name",
            "purchaser",
            "method",
            "year",
            "event_at",
            "progress",
        }
    ),
    "supplier_shortage": frozenset(
        {
            "project_number",
            "project_name",
            "purchaser",
            "method",
            "year",
            "lot_identity",
            "supplier_count",
            "supplier_minimum",
            "supplier_missing",
            "registration_deadline",
        }
    ),
}
SAFE_ERROR_CODES = frozenset(
    {
        "SMTP_AUTH_FAILED",
        "SMTP_TLS_FAILED",
        "SMTP_CONNECTION_FAILED",
        "SMTP_SEND_FAILED",
        "STATE_INVALID",
        "STATE_WRITE_FAILED",
        "CONFIG_INVALID",
    }
)

FIELD_LABELS = {
    "deadline_title": "期限事项", "deadline_at": "已确认截止时间", "deadline_status": "事项状态",
    "deadline_basis": "计算依据", "review_reason": "复核原因",
    "supplier_name": "待处理供应商", "deposit_balance": "待退保证金（元）", "refund_deadline": "退还截止",
    "refund_status": "处理状态", "review_at": "复核日期",
    "project_number": "项目编号",
    "project_name": "项目名称",
    "purchaser": "采购人",
    "method": "采购方式",
    "year": "年度",
    "stage_name": "阶段名称",
    "planned_at": "计划时间",
    "registration_count": "报名家数",
    "event_at": "事件时间",
    "progress": "当前进度",
    "lot_identity": "采购包",
    "supplier_count": "当前供应商数",
    "supplier_minimum": "最低要求数",
    "supplier_missing": "缺少数量",
    "registration_deadline": "报名截止时间",
}
EVENT_LABELS = {
    "business_deadline": "业务期限提醒", "deadline_review": "期限变更复核",
    "deposit_refund": "保证金退还提醒", "deposit_review": "保证金处理待核实",
    "daily_stage": "每日阶段提醒",
    "project_create": "项目新建提醒",
    "project_complete": "项目完成提醒",
    "supplier_shortage": "供应商不足预警",
}
_EMAIL_RE = re.compile(r"^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$")


class RecipientGroupValidationError(ValueError):
    def __init__(self, message: str, code: str = "CONFIG_INVALID"):
        super().__init__(message)
        self.code = code


def _normalized_email(value: object) -> str:
    email = str(value or "").strip().lower()
    if "\r" in email or "\n" in email or not _EMAIL_RE.fullmatch(email):
        raise RecipientGroupValidationError("邮箱格式不正确")
    return email


def _legacy_group(settings: dict) -> dict:
    event_types = []
    if bool(settings.get("reminder_enabled")):
        event_types.append("daily_stage")
    if bool(settings.get("event_reminder_create_enabled", settings.get("project_created_email_enabled"))):
        event_types.append("project_create")
    if bool(settings.get("event_reminder_complete_enabled", settings.get("project_completed_email_enabled"))):
        event_types.append("project_complete")
    if bool(settings.get("supplier_shortage_email_enabled", settings.get("reminder_enabled"))):
        event_types.append("supplier_shortage")
    content = dict(settings.get("reminder_content") or {})
    return {
        "id": "legacy-default",
        "name": "默认组",
        "enabled": bool(event_types),
        "order": 0,
        "recipients": list(settings.get("reminder_recipients") or []),
        "event_types": event_types,
        "content_fields": content,
        "subject_prefix": "",
    }


def normalize_recipient_groups(settings: dict) -> list[dict]:
    """Return validated groups, synthesizing legacy settings without mutation."""

    if not isinstance(settings, dict):
        raise RecipientGroupValidationError("设置格式不正确")
    groups = settings.get("reminder_recipient_groups")
    if groups is None:
        groups = [_legacy_group(settings)]
    return validate_recipient_groups(groups)


def validate_recipient_groups(groups: object) -> list[dict]:
    if not isinstance(groups, list):
        raise RecipientGroupValidationError("收件组必须为列表")
    if len(groups) > 20:
        raise RecipientGroupValidationError("最多允许 20 个收件组")

    prepared = []
    for original_index, raw in enumerate(groups):
        if not isinstance(raw, dict):
            raise RecipientGroupValidationError("收件组格式不正确")
        name = str(raw.get("name") or "").strip()
        if not 1 <= len(name) <= 40:
            raise RecipientGroupValidationError("组名长度必须为 1 至 40 个字符")
        prefix = str(raw.get("subject_prefix") or "").strip()
        if "\r" in prefix or "\n" in prefix:
            raise RecipientGroupValidationError("主题前缀不能包含换行")
        if len(prefix) > 30:
            raise RecipientGroupValidationError("主题前缀最多 30 个字符")

        raw_recipients = raw.get("recipients", [])
        if not isinstance(raw_recipients, list):
            raise RecipientGroupValidationError("收件邮箱必须为列表")
        if len(raw_recipients) > 20:
            raise RecipientGroupValidationError("每组最多允许 20 个邮箱")
        recipients = []
        seen = set()
        for value in raw_recipients:
            email = _normalized_email(value)
            if email not in seen:
                seen.add(email)
                recipients.append(email)

        raw_types = raw.get("event_types", [])
        if not isinstance(raw_types, list) or any(value not in EVENT_TYPES for value in raw_types):
            raise RecipientGroupValidationError("提醒类型不正确")
        event_types = [value for value in EVENT_TYPES if value in raw_types]

        raw_fields = raw.get("content_fields", {})
        if not isinstance(raw_fields, dict) or any(type(value) is not bool for value in raw_fields.values()):
            raise RecipientGroupValidationError("内容字段格式不正确")
        known_fields = frozenset().union(*FIELD_ALLOWLISTS.values())
        if any(key not in known_fields for key in raw_fields):
            raise RecipientGroupValidationError("内容字段不在允许范围内")
        content_fields = {key: True for key in sorted(raw_fields) if raw_fields[key]}

        enabled = raw.get("enabled", True)
        if type(enabled) is not bool:
            raise RecipientGroupValidationError("启用状态不正确")
        applicable = set().union(*(FIELD_ALLOWLISTS[value] for value in event_types)) if event_types else set()
        if enabled and not recipients:
            raise RecipientGroupValidationError("启用的收件组至少填写一个邮箱")
        if enabled and not event_types:
            raise RecipientGroupValidationError("启用的收件组至少选择一种提醒类型")
        if enabled and not applicable.intersection(content_fields):
            raise RecipientGroupValidationError("启用的收件组至少选择一个适用内容字段")

        group_id = str(raw.get("id") or "").strip() or uuid.uuid4().hex
        if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", group_id):
            raise RecipientGroupValidationError("收件组 ID 不正确")
        order = raw.get("order", original_index)
        if type(order) is not int or order < 0:
            raise RecipientGroupValidationError("收件组顺序不正确")
        prepared.append(
            (
                order,
                original_index,
                {
                    "id": group_id,
                    "name": name,
                    "enabled": enabled,
                    "order": 0,
                    "recipients": recipients,
                    "event_types": event_types,
                    "content_fields": content_fields,
                    "subject_prefix": prefix,
                },
            )
        )

    prepared.sort(key=lambda item: (item[0], item[1]))
    normalized = []
    unique_emails = set()
    ids = set()
    for order, (_, _, group) in enumerate(prepared):
        if group["id"] in ids:
            raise RecipientGroupValidationError("收件组 ID 不能重复")
        ids.add(group["id"])
        group["order"] = order
        normalized.append(group)
        unique_emails.update(group["recipients"])
    if len(unique_emails) > 50:
        raise RecipientGroupValidationError("最多允许 50 个唯一邮箱")
    return normalized


def rules_fingerprint(event_type: str, fields: list[str], prefix: str, group_ids: list[str]) -> str:
    payload = json.dumps(
        {
            "event_type": event_type,
            "fields": sorted(fields),
            "prefix": prefix,
            "group_ids": list(group_ids),
        },
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def route_reminder_event(event: dict, groups: list[dict]) -> list[dict]:
    event_type = str(event.get("event_type") or "")
    if event_type not in EVENT_TYPES:
        raise RecipientGroupValidationError("事件类型不正确")
    normalized = validate_recipient_groups(groups)
    merged = {}
    for group in normalized:
        if not group["enabled"] or event_type not in group["event_types"]:
            continue
        fields = sorted(
            key
            for key, selected in group["content_fields"].items()
            if selected and key in FIELD_ALLOWLISTS[event_type]
        )
        if not fields:
            continue
        for recipient in group["recipients"]:
            current = merged.setdefault(
                recipient,
                {
                    "recipient": recipient,
                    "event_type": event_type,
                    "content_fields": set(),
                    "subject_prefix": group["subject_prefix"],
                    "group_ids": [],
                },
            )
            current["content_fields"].update(fields)
            current["group_ids"].append(group["id"])

    deliveries = []
    for recipient in sorted(merged):
        current = merged[recipient]
        fields = sorted(current["content_fields"])
        delivery = {
            "recipient": recipient,
            "event_type": event_type,
            "content_fields": fields,
            "subject_prefix": current["subject_prefix"],
            "group_ids": current["group_ids"],
        }
        delivery["rules_fingerprint"] = rules_fingerprint(
            event_type, fields, delivery["subject_prefix"], delivery["group_ids"]
        )
        deliveries.append(delivery)
    return deliveries


def _safe_header(value: object) -> str:
    text = str(value or "").strip()
    if "\r" in text or "\n" in text:
        raise ValueError("邮件头不能包含换行")
    return text


def delivery_matches_current_rules(event: dict, delivery: dict, groups: list[dict]) -> bool:
    """Pause persisted snapshots unless their recipient and content rules still apply."""
    if not isinstance(event, dict) or not isinstance(delivery, dict):
        return False
    if event.get("event_type") not in EVENT_TYPES:
        return False
    fields = ("recipient", "event_type", "content_fields", "subject_prefix",
              "group_ids", "rules_fingerprint")
    return any(
        all(current.get(field) == delivery.get(field) for field in fields)
        for current in route_reminder_event(event, groups)
    )


def _render_email_html(event_type: str, fields: list[str], event: dict) -> str:
    """Inline, table-based layout; only selected fields enter the document."""
    color, tint = {
        'supplier_shortage': ('#995b10', '#fff6e7'),
        'project_complete': ('#16704a', '#ecf8f1'),
    }.get(event_type, ('#285f9f', '#eef5ff'))
    values = {key: html.escape('未填写' if event.get(key) is None or event.get(key) == ''
                              else str(event[key])) for key in fields}
    label = html.escape(EVENT_LABELS[event_type])
    title = values.pop('project_name', '')
    heading = (f'<h2 style="margin:14px 0 0;font-size:19px;line-height:1.6;font-weight:600;'
               f'color:#172b42;overflow-wrap:anywhere;">{title}</h2>') if title else ''
    metrics = []
    for key in ('supplier_count', 'supplier_minimum', 'supplier_missing', 'registration_count'):
        if key in values:
            metrics.append(f'<td style="padding:14px 10px;background:{tint};vertical-align:top;">'
                           f'<div style="font-size:12px;line-height:1.5;color:#526174;">{FIELD_LABELS[key]}</div>'
                           f'<div style="margin-top:5px;font-size:26px;line-height:1.3;font-weight:600;'
                           f'color:{color};overflow-wrap:anywhere;">{values.pop(key)}</div></td>')
    summary = ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
               'style="table-layout:fixed;margin:20px 0 6px;border-spacing:0;"><tr>'
               + ''.join(metrics) + '</tr></table>') if metrics else ''
    rows = []
    order = ('registration_deadline', 'planned_at', 'event_at', 'stage_name', 'project_number',
             'purchaser', 'method', 'lot_identity', 'year', 'progress')
    for key in dict.fromkeys((*order, *fields)):
        if key not in values:
            continue
        important = key in ('registration_deadline', 'planned_at')
        rows.append('<tr><th align="left" width="112" style="width:112px;white-space:nowrap;'
                    'padding:13px 12px 13px 0;vertical-align:top;border-bottom:1px solid #e8edf3;'
                    f'font-size:14px;line-height:1.7;font-weight:400;color:#59697c;">{FIELD_LABELS[key]}</th>'
                    '<td style="padding:13px 0;vertical-align:top;border-bottom:1px solid #e8edf3;'
                    'font-size:14px;line-height:1.7;overflow-wrap:anywhere;word-break:break-word;'
                    f'font-weight:{600 if important else 400};color:{color if important else "#172b42"};">'
                    f'{values[key]}</td></tr>')
    details = ('<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
               'style="table-layout:fixed;border-collapse:collapse;margin-top:10px;">'
               + ''.join(rows) + '</table>') if rows else ''
    return ('<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1">'
            '<meta name="format-detection" content="telephone=no,date=no,address=no,email=no">'
            f'<title>{label}</title></head><body style="margin:0;padding:0;background:#f3f5f8;'
            'font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',\'Microsoft YaHei\',Arial,sans-serif;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>'
            '<td align="center" style="padding:20px 12px;">'
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="width:100%;max-width:640px;background:#fff;border:1px solid #e1e7ef;border-radius:10px;">'
            f'<tr><td style="padding:22px 20px 0;border-top:4px solid {color};">'
            '<div style="font-size:12px;line-height:1.5;color:#69798a;">项目管理系统</div>'
            f'<h1 style="margin:8px 0 0;font-size:18px;line-height:1.5;color:{color};font-weight:600;">'
            f'{label}</h1>{heading}{summary}</td></tr>'
            f'<tr><td style="padding:0 20px 22px;">{details}</td></tr></table>'
            '<div style="margin-top:14px;font-size:11px;line-height:1.6;color:#718096;">'
            '系统自动提醒</div></td></tr></table></body></html>')


def render_recipient_message(event: dict, delivery: dict, sender: str) -> EmailMessage:
    event_type = str(event.get("event_type") or "")
    if event_type not in EVENT_TYPES or delivery.get("event_type") != event_type:
        raise ValueError("提醒事件类型不匹配")
    sender = _safe_header(sender)
    recipient = _safe_header(delivery.get("recipient"))
    prefix = _safe_header(delivery.get("subject_prefix"))
    if not sender or not recipient:
        raise ValueError("发件人与收件人不能为空")
    fields = [
        key
        for key in delivery.get("content_fields", [])
        if key in FIELD_ALLOWLISTS[event_type]
    ]
    label = EVENT_LABELS[event_type]
    subject = f"[{prefix}] {label}" if prefix else label
    lines = []
    for key in fields:
        value = event.get(key)
        display = "未填写" if value is None or value == "" else str(value)
        lines.append(f"{FIELD_LABELS[key]}：{display}")

    message = EmailMessage()
    message["From"] = sender
    message["To"] = recipient
    message["Subject"] = subject
    message.set_content("\n".join(lines) + "\n")
    message.add_alternative(
        _render_email_html(event_type, fields, event),
        subtype="html",
    )
    return message


def _failed_results(messages, code):
    return [
        {
            "delivery_key": delivery_key,
            "recipient": str(message.get("To") or ""),
            "status": "failed",
            "error_code": code,
        }
        for delivery_key, message in messages
    ]


def _close_smtp(smtp):
    if smtp is None:
        return
    try:
        if hasattr(smtp, "quit"):
            smtp.quit()
        elif hasattr(smtp, "__exit__"):
            smtp.__exit__(None, None, None)
    except Exception:
        pass
    finally:
        # QUIT can itself fail on a disconnected or timed-out connection.
        try:
            if hasattr(smtp, "close"):
                smtp.close()
        except Exception:
            pass


def _smtp_error_code(error, stage):
    if isinstance(error, ssl.SSLError):
        return "SMTP_TLS_FAILED"
    if isinstance(error, smtplib.SMTPAuthenticationError):
        return "SMTP_AUTH_FAILED"
    if isinstance(error, (smtplib.SMTPConnectError, smtplib.SMTPServerDisconnected,
                          smtplib.SMTPHeloError)):
        return "SMTP_CONNECTION_FAILED"
    if isinstance(error, smtplib.SMTPNotSupportedError):
        return "SMTP_TLS_FAILED" if stage == "tls" else "SMTP_AUTH_FAILED"
    # SMTPException inherits OSError; classify protocol refusals before socket errors.
    if isinstance(error, smtplib.SMTPException):
        return "SMTP_TLS_FAILED" if stage == "tls" else "SMTP_SEND_FAILED"
    if isinstance(error, OSError):
        return "SMTP_CONNECTION_FAILED"
    return "SMTP_TLS_FAILED" if stage == "tls" else "SMTP_SEND_FAILED"


def send_delivery_batch(
    messages: list[tuple[str, EmailMessage]],
    smtp_settings: dict,
    secret: str,
    smtp_factory=None,
) -> list[dict]:
    if not messages:
        return []
    try:
        host = str(smtp_settings.get("host") or "").strip()
        port = int(smtp_settings.get("port") or 0)
        security = str(smtp_settings.get("security") or "ssl").strip().lower()
        username = str(smtp_settings.get("username") or "").strip()
        timeout = float(smtp_settings.get("timeout", 20))
        if (not host or any(char.isspace() for char in host)
                or not 1 <= port <= 65535 or security not in {"ssl", "starttls"}
                or not math.isfinite(timeout) or timeout <= 0):
            raise ValueError("invalid SMTP transport")
    except (AttributeError, TypeError, ValueError, OverflowError):
        return _failed_results(messages, "CONFIG_INVALID")
    context = ssl.create_default_context()
    factory = smtp_factory or (smtplib.SMTP_SSL if security == "ssl" else smtplib.SMTP)
    kwargs = {"timeout": timeout}
    if security == "ssl":
        kwargs["context"] = context

    smtp = None
    stage = "connect"
    try:
        # Use the constructor's host argument: smtplib stores it in _host for
        # certificate verification/SNI. connect(host, port) alone does not set it.
        no_argument_factory = False
        try:
            signature = inspect.signature(factory)
        except (TypeError, ValueError):
            signature = None
        if signature is not None:
            try:
                signature.bind(host, port, **kwargs)
            except TypeError:
                signature.bind()
                no_argument_factory = True
        if no_argument_factory:
            smtp = factory()
            # Preserve the historic disconnected test/client factory contract.
            if isinstance(smtp, smtplib.SMTP):
                smtp._host = host
                smtp.timeout = timeout
                if isinstance(smtp, smtplib.SMTP_SSL):
                    smtp.context = context
            greeting = smtp.connect(host, port)
            if isinstance(greeting, tuple) and greeting[0] != 220:
                raise smtplib.SMTPConnectError(*greeting)
        else:
            smtp = factory(host, port, **kwargs)
        if security == "starttls":
            stage = "tls"
            if hasattr(smtp, "ehlo_or_helo_if_needed"):
                smtp.ehlo_or_helo_if_needed()
            smtp.starttls(context=context)
            # RFC 3207 requires a fresh greeting after the TLS negotiation.
            if hasattr(smtp, "ehlo_or_helo_if_needed"):
                smtp.ehlo_or_helo_if_needed()
        stage = "auth"
        smtp.login(username, secret)
    except Exception as error:
        _close_smtp(smtp)
        return _failed_results(messages, _smtp_error_code(error, stage))

    results = []
    try:
        for delivery_key, message in messages:
            recipient = str(message.get("To") or "")
            try:
                refused = smtp.send_message(message)
                if isinstance(refused, dict) and refused:
                    raise smtplib.SMTPRecipientsRefused(refused)
            except Exception as error:
                results.append(
                    {
                        "delivery_key": delivery_key,
                        "recipient": recipient,
                        "status": "failed",
                        "error_code": _smtp_error_code(error, "send"),
                    }
                )
            else:
                results.append(
                    {
                        "delivery_key": delivery_key,
                        "recipient": recipient,
                        "status": "sent",
                        "error_code": None,
                    }
                )
    finally:
        _close_smtp(smtp)
    return results
