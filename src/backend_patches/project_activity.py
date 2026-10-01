"""Project-scoped activity classification, sanitization, persistence, and reads."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import re
from typing import Any


_WRITE_METHODS = {"POST", "PUT", "PATCH", "DELETE"}
_ACTION_PATTERN = re.compile(r"^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$")
_SENSITIVE_PARTS = ("password", "token", "secret", "cookie", "csrf", "license")
_MAX_TEXT_LENGTH = 500
_DIFF_FIELDS = (
    "number",
    "name",
    "purchaser",
    "procurement_method",
    "budget",
    "agent",
    "owner",
    "status",
    "progress",
    "planned_at",
    "completed",
    "is_terminated",
    "terminated_type",
    "terminated_reason",
    "no_deposit",
    "procurement_archive_sent",
    "company_name",
    "bidder_type",
    "registration_method",
    "title",
    "filename",
    "notes",
)


@dataclass(frozen=True)
class ActivityDescriptor:
    action: str
    label: str
    project_id: int | None
    target_type: str
    target_id: str | None = None


@dataclass(frozen=True)
class ActivityCapture:
    descriptor: ActivityDescriptor
    payload: Any
    project_before: dict[str, Any] | None


_LABELS = {
    "project.create": "新增项目",
    "project.update": "修改项目",
    "project.delete": "删除项目",
    "project.terminate": "终止项目",
    "project.restore": "恢复项目",
    "stage.complete": "完成阶段",
    "stage.undo": "撤销阶段完成",
    "stage.schedule": "修改阶段计划",
    "stage.update": "修改阶段",
    "stage.batch_advance": "批量推进阶段",
    "attachment.upload": "上传附件",
    "attachment.update": "修改附件",
    "attachment.delete": "删除附件",
    "archive.bulk_update": "批量核验归档资料",
}

_NESTED_RESOURCES = {
    "stage-checklist": ("checklist", "检查项"),
    "lots": ("lot", "标段"),
    "bid-results": ("bid_result", "中标结果"),
    "registrations": ("registration", "报名登记"),
    "notice-deliveries": ("notice_delivery", "通知书记录"),
    "service-fee-invoices": ("service_fee_invoice", "服务费发票"),
    "clarifications": ("clarification", "澄清更正"),
    "complaints": ("complaint", "质疑投诉"),
    "archive-catalog": ("archive", "归档资料"),
    "archive-deliveries": ("archive_delivery", "存档寄送"),
}

_VERB_LABELS = {"create": "新增", "update": "修改", "delete": "删除"}


def _descriptor(action, project_id, target_type, target_id=None, label=None):
    return ActivityDescriptor(
        action=action,
        label=label or _LABELS.get(action, action),
        project_id=project_id,
        target_type=target_type,
        target_id=None if target_id is None else str(target_id),
    )


def classify_project_write(method, path, payload):
    """Return a stable activity descriptor for an auditable business write."""
    method = str(method or "").upper()
    path = str(path or "").split("?", 1)[0].rstrip("/") or "/"
    payload = payload if isinstance(payload, dict) else {}
    if method not in _WRITE_METHODS:
        return None

    if path == "/api/batch/advance-stage" and method == "POST":
        return _descriptor("stage.batch_advance", None, "stage")

    direct_attachment = re.fullmatch(r"/api/attachments/(\d+)", path)
    if direct_attachment and method in {"PUT", "PATCH", "DELETE"}:
        action = "attachment.delete" if method == "DELETE" else "attachment.update"
        return _descriptor(action, None, "attachment", direct_attachment.group(1))

    if path == "/api/projects" and method == "POST":
        return _descriptor("project.create", None, "project")

    project_match = re.fullmatch(r"/api/projects/(\d+)(?:/(.*))?", path)
    if not project_match:
        return None
    project_id = int(project_match.group(1))
    remainder = project_match.group(2)

    if not remainder:
        if method == "DELETE":
            return _descriptor("project.delete", project_id, "project", project_id)
        if method in {"PUT", "PATCH"}:
            if payload.get("is_terminated") is True:
                action = "project.terminate"
            elif payload.get("is_terminated") is False:
                action = "project.restore"
            else:
                action = "project.update"
            return _descriptor(action, project_id, "project", project_id)
        return None

    if remainder == "attachments" and method == "POST":
        return _descriptor("attachment.upload", project_id, "attachment")

    stage_match = re.fullmatch(r"stages/([^/]+)", remainder)
    if stage_match and method in {"PUT", "PATCH"}:
        if payload.get("completed") is True:
            action = "stage.complete"
        elif payload.get("completed") is False:
            action = "stage.undo"
        elif "planned_at" in payload:
            action = "stage.schedule"
        else:
            action = "stage.update"
        return _descriptor(action, project_id, "stage", stage_match.group(1))

    if remainder == "archive-catalog/bulk" and method in {"PUT", "PATCH"}:
        return _descriptor("archive.bulk_update", project_id, "archive")

    parts = remainder.split("/")
    resource = parts[0]
    resource_info = _NESTED_RESOURCES.get(resource)
    if not resource_info:
        return None
    action_prefix, resource_label = resource_info
    if method == "POST":
        verb = "create"
    elif method in {"PUT", "PATCH"}:
        verb = "update"
    elif method == "DELETE":
        verb = "delete"
    else:
        return None
    target_id = parts[1] if len(parts) > 1 and parts[1].isdigit() else None
    action = f"{action_prefix}.{verb}"
    label = f"{_VERB_LABELS[verb]}{resource_label}"
    return _descriptor(action, project_id, action_prefix, target_id, label)


def _is_sensitive_key(key):
    normalized = str(key or "").lower()
    return any(part in normalized for part in _SENSITIVE_PARTS) or normalized in {
        "api_key",
        "encryption_key",
        "master_key",
    }


def sanitize_value(value, *, key=""):
    """Return a JSON-safe, bounded copy with sensitive fields removed."""
    if _is_sensitive_key(key):
        return None
    if isinstance(value, dict):
        return {
            str(item_key): sanitize_value(item_value, key=item_key)
            for item_key, item_value in value.items()
            if not _is_sensitive_key(item_key)
        }
    if isinstance(value, (list, tuple, set)):
        return [sanitize_value(item) for item in value]
    if isinstance(value, (bytes, bytearray, memoryview)):
        return "[binary omitted]"
    if isinstance(value, str) and len(value) > _MAX_TEXT_LENGTH:
        return value[: _MAX_TEXT_LENGTH - 1] + "…"
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    return sanitize_value(str(value))


def diff_fields(before, after):
    before = before if isinstance(before, dict) else {}
    after = after if isinstance(after, dict) else {}
    changes = []
    for field in _DIFF_FIELDS:
        if field not in after or before.get(field) == after.get(field):
            continue
        changes.append(
            {
                "field": field,
                "before": sanitize_value(before.get(field), key=field),
                "after": sanitize_value(after.get(field), key=field),
            }
        )
    return changes


def _project_snapshot(value, fallback_id=None):
    if not isinstance(value, dict):
        return None
    if "id" not in value and not value.get("number") and not value.get("name"):
        return None
    project_id = value.get("id", fallback_id)
    number = value.get("number")
    name = value.get("name")
    if project_id is None and not number and not name:
        return None
    return {
        "id": int(project_id) if project_id not in (None, "") else None,
        "number": sanitize_value(number or ""),
        "name": sanitize_value(name or ""),
    }


def capture_before_write(descriptor, payload, project_snapshot):
    if descriptor is None:
        return None
    return ActivityCapture(
        descriptor=descriptor,
        payload=sanitize_value(payload if payload is not None else {}),
        project_before=_project_snapshot(project_snapshot, descriptor.project_id),
    )


def descriptor_for_project(descriptor, project_id):
    """Bind a batch or indirectly addressed descriptor to one project."""
    return ActivityDescriptor(
        action=descriptor.action,
        label=descriptor.label,
        project_id=int(project_id),
        target_type=descriptor.target_type,
        target_id=descriptor.target_id,
    )


def build_activity_detail(capture, response_payload, project_snapshot):
    descriptor = capture.descriptor
    after_source = project_snapshot if isinstance(project_snapshot, dict) else response_payload
    project_after = _project_snapshot(after_source, descriptor.project_id)
    project = project_after or capture.project_before or {
        "id": descriptor.project_id,
        "number": "",
        "name": "",
    }
    after_values = {}
    if isinstance(capture.project_before, dict):
        after_values.update(capture.project_before)
    if isinstance(capture.payload, dict):
        after_values.update(capture.payload)
    if isinstance(after_source, dict):
        after_values.update(after_source)
    return {
        "schema": 1,
        "action": descriptor.action,
        "label": descriptor.label,
        "project": project,
        "target": {"type": descriptor.target_type, "id": descriptor.target_id},
        "changes": diff_fields(capture.project_before, after_values),
    }


def record_activity(
    db,
    OperationLog,
    *,
    actor,
    request_meta,
    capture,
    response_payload=None,
    project_snapshot=None,
):
    detail = build_activity_detail(capture, response_payload, project_snapshot)
    project_id = detail["project"].get("id")
    row = OperationLog(
        user_id=actor.get("id"),
        username=str(actor.get("username") or ""),
        action_type=capture.descriptor.action,
        target_type="project_activity",
        target_id=str(project_id) if project_id is not None else None,
        description=capture.descriptor.label,
        detail_json=json.dumps(detail, ensure_ascii=False, separators=(",", ":")),
        ip_address=str(request_meta.get("ip_address") or ""),
    )
    try:
        db.session.add(row)
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise
    return row


def _positive_int(value, name, *, minimum=1, maximum=None, allow_none=True):
    if value in (None, "") and allow_none:
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError) as error:
        raise ValueError(f"{name} must be an integer") from error
    if parsed < minimum or (maximum is not None and parsed > maximum):
        raise ValueError(f"{name} is out of range")
    return parsed


def _created_at_value(value):
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value or "")


def read_activity(
    db,
    OperationLog,
    User,
    *,
    viewer,
    limit=30,
    before_id=None,
    user_id=None,
    project_id=None,
    action=None,
):
    viewer_id = None
    viewer_is_admin = False
    if isinstance(viewer, dict):
        viewer_id = viewer.get("id")
        viewer_is_admin = bool(viewer.get("is_admin"))
    limit = _positive_int(limit, "limit", maximum=100, allow_none=False)
    before_id = _positive_int(before_id, "before_id")
    user_id = _positive_int(user_id, "user_id")
    project_id = _positive_int(project_id, "project_id")
    if action in (None, ""):
        action = None
    elif not _ACTION_PATTERN.fullmatch(str(action)):
        raise ValueError("action is invalid")
    else:
        action = str(action)

    query = db.session.query(OperationLog).filter(
        OperationLog.target_type == "project_activity"
    )
    # 非管理员强制只看自己产生的记录，跨主体过滤参数一律忽略
    if not viewer_is_admin:
        if viewer_id is not None:
            query = query.filter(OperationLog.user_id == viewer_id)
        user_id = None
        project_id = None
    if before_id is not None:
        query = query.filter(OperationLog.id < before_id)
    if user_id is not None:
        query = query.filter(OperationLog.user_id == user_id)
    if project_id is not None:
        query = query.filter(OperationLog.target_id == str(project_id))
    if action is not None:
        query = query.filter(OperationLog.action_type == action)
    rows = query.order_by(OperationLog.id.desc()).limit(limit + 1).all()
    has_more = len(rows) > limit
    rows = rows[:limit]

    actor_ids = sorted({row.user_id for row in rows if row.user_id is not None})
    users = (
        db.session.query(User).filter(User.id.in_(actor_ids)).all()
        if actor_ids
        else []
    )
    users_by_id = {user.id: user for user in users}
    items = []
    for row in rows:
        try:
            detail = json.loads(row.detail_json or "{}")
        except (TypeError, ValueError):
            detail = {}
        user = users_by_id.get(row.user_id)
        username = str(getattr(user, "username", "") or row.username or "")
        display_name = str(getattr(user, "display_name", "") or "").strip()
        actor_label = (
            f"{display_name} ({username})"
            if display_name and display_name != username
            else username
        )
        items.append(
            {
                "id": row.id,
                "user_id": row.user_id,
                "username": username,
                "actor_label": actor_label,
                "action": row.action_type,
                "label": detail.get("label") or row.description,
                "project": detail.get("project") or {},
                "target": detail.get("target") or {},
                "changes": detail.get("changes") or [],
                "created_at": _created_at_value(row.created_at),
            }
        )
    return {
        "items": items,
        "next_cursor": rows[-1].id if has_more and rows else None,
        "filters": {
            "user_id": None if not viewer_is_admin else user_id,
            "project_id": None if not viewer_is_admin else project_id,
            "action": action,
        },
    }


def capture_request(method, path, payload, project_snapshot=None):
    """Convenience entry point used by the Flask integration wrapper."""
    descriptor = classify_project_write(method, path, payload)
    return capture_before_write(descriptor, payload, project_snapshot)
