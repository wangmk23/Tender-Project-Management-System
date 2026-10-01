"""Lot-level supplier shortage rules, state, audit, and retender helpers."""

from __future__ import annotations

import sqlite3
import json
import uuid
import hashlib
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace


DEFAULT_MINIMUMS = {
    "公开招标": 3,
    "竞争性磋商": 3,
    "竞争性谈判": 3,
    "邀请招标": 3,
    "网上竞价": 3,
    "单一来源": 1,
    "遴选": 3,
    "直选": 1,
}


class ValidationError(ValueError):
    """A stable client-facing supplier risk validation error."""


def normalize_minimums(value) -> dict[str, int]:
    if not isinstance(value, dict) or set(value) != set(DEFAULT_MINIMUMS):
        raise ValidationError("采购方式供应商数量规则不完整")
    normalized = {}
    for method in DEFAULT_MINIMUMS:
        minimum = value[method]
        if isinstance(minimum, bool) or not isinstance(minimum, int) or not 1 <= minimum <= 99:
            raise ValidationError(f"{method}最低供应商数量必须为1至99的整数")
        normalized[method] = minimum
    return normalized


def effective_minimum(settings, project_method, control=None) -> tuple[int, str]:
    override = getattr(control, "minimum_supplier_override", None) if control else None
    if override is not None:
        if isinstance(override, bool) or not isinstance(override, int) or not 1 <= override <= 99:
            raise ValidationError("包级最低供应商数量必须为1至99的整数")
        if not str(getattr(control, "override_basis", "") or "").strip():
            raise ValidationError("包级规则必须填写调整依据")
        return override, "lot"
    configured = (settings or {}).get("supplier_minimums", DEFAULT_MINIMUMS)
    minimums = normalize_minimums(configured)
    if project_method not in minimums:
        return 3, "fallback"
    return minimums[project_method], "method"


def _schema_sql(connection) -> None:
    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS lot_procurement_controls (
            lot_id INTEGER PRIMARY KEY,
            status TEXT NOT NULL DEFAULT 'active',
            procurement_method TEXT,
            minimum_supplier_override INTEGER,
            override_basis TEXT,
            terminated_source TEXT,
            terminated_reason TEXT,
            terminated_at TEXT,
            required_count_snapshot INTEGER,
            actual_count_snapshot INTEGER,
            response_count_snapshot INTEGER,
            deadline_snapshot TEXT,
            root_lot_id INTEGER,
            previous_lot_id INTEGER,
            round_number INTEGER NOT NULL DEFAULT 1,
            updated_at TEXT,
            FOREIGN KEY(lot_id) REFERENCES project_lots(id) ON DELETE CASCADE,
            FOREIGN KEY(root_lot_id) REFERENCES project_lots(id),
            FOREIGN KEY(previous_lot_id) REFERENCES project_lots(id)
        );
        CREATE TABLE IF NOT EXISTS lot_supplier_events (
            id INTEGER PRIMARY KEY,
            event_key TEXT NOT NULL UNIQUE,
            project_id INTEGER NOT NULL,
            lot_id INTEGER,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            mail_status TEXT NOT NULL DEFAULT 'none',
            mail_attempts INTEGER NOT NULL DEFAULT 0,
            mail_last_error TEXT,
            sent_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
            FOREIGN KEY(lot_id) REFERENCES project_lots(id) ON DELETE CASCADE
        );
        CREATE TABLE IF NOT EXISTS lot_supplier_mail_deliveries (
            delivery_key TEXT PRIMARY KEY,
            event_id INTEGER NOT NULL,
            event_key TEXT NOT NULL,
            recipient TEXT NOT NULL,
            rules_fingerprint TEXT NOT NULL,
            event_json TEXT NOT NULL,
            delivery_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending',
            attempts INTEGER NOT NULL DEFAULT 0,
            last_attempt_at TEXT,
            next_attempt_at TEXT,
            error_code TEXT,
            sent_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY(event_id) REFERENCES lot_supplier_events(id) ON DELETE CASCADE,
            UNIQUE(event_key, recipient, rules_fingerprint)
        );
        """
    )


def ensure_schema(database, *, commit=False) -> None:
    """Apply additive state tables without committing a caller-owned transaction."""
    if not isinstance(database, (str, Path)):
        session = database.session
        try:
            _execute(session, """
                CREATE TABLE IF NOT EXISTS lot_procurement_controls (
                    lot_id INTEGER PRIMARY KEY, status TEXT NOT NULL DEFAULT 'active',
                    procurement_method TEXT, minimum_supplier_override INTEGER,
                    override_basis TEXT, terminated_source TEXT, terminated_reason TEXT,
                    terminated_at TEXT, required_count_snapshot INTEGER,
                    actual_count_snapshot INTEGER, response_count_snapshot INTEGER,
                    deadline_snapshot TEXT, root_lot_id INTEGER, previous_lot_id INTEGER,
                    round_number INTEGER NOT NULL DEFAULT 1, updated_at TEXT,
                    FOREIGN KEY(lot_id) REFERENCES project_lots(id) ON DELETE CASCADE
                )
            """)
            _execute(session, """
                CREATE TABLE IF NOT EXISTS lot_supplier_events (
                    id INTEGER PRIMARY KEY, event_key TEXT NOT NULL UNIQUE,
                    project_id INTEGER NOT NULL, lot_id INTEGER, event_type TEXT NOT NULL,
                    payload_json TEXT NOT NULL, mail_status TEXT NOT NULL DEFAULT 'none',
                    mail_attempts INTEGER NOT NULL DEFAULT 0, mail_last_error TEXT,
                    sent_at TEXT, created_at TEXT NOT NULL,
                    FOREIGN KEY(project_id) REFERENCES projects(id) ON DELETE CASCADE,
                    FOREIGN KEY(lot_id) REFERENCES project_lots(id) ON DELETE CASCADE
                )
            """)
            _execute(session, """
                CREATE TABLE IF NOT EXISTS lot_supplier_mail_deliveries (
                    delivery_key TEXT PRIMARY KEY, event_id INTEGER NOT NULL,
                    event_key TEXT NOT NULL, recipient TEXT NOT NULL,
                    rules_fingerprint TEXT NOT NULL, event_json TEXT NOT NULL,
                    delivery_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
                    attempts INTEGER NOT NULL DEFAULT 0, last_attempt_at TEXT,
                    next_attempt_at TEXT, error_code TEXT, sent_at TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(event_id) REFERENCES lot_supplier_events(id) ON DELETE CASCADE,
                    UNIQUE(event_key, recipient, rules_fingerprint)
                )
            """)
            if commit:
                session.commit()
        except Exception:
            if commit:
                session.rollback()
            raise
        return
    connection = sqlite3.connect(str(database))
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("BEGIN IMMEDIATE")
        _schema_sql(connection)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def _execute(session, statement: str, parameters=None):
    if getattr(session, "_lot_risk_raw_sql", False):
        return session.execute(statement, parameters or {})
    from sqlalchemy import text
    return session.execute(text(statement), parameters or {})


def _row_mapping(row):
    if row is None:
        return None
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    keys = (
        "lot_id", "status", "procurement_method", "minimum_supplier_override",
        "override_basis", "terminated_source", "terminated_reason", "terminated_at",
        "required_count_snapshot", "actual_count_snapshot", "response_count_snapshot",
        "deadline_snapshot", "root_lot_id", "previous_lot_id", "round_number", "updated_at",
    )
    return dict(zip(keys, row))


def _load_control(database, lot_id):
    if database is None or lot_id is None:
        return None
    row = _execute(
        database.session,
        "SELECT lot_id,status,procurement_method,minimum_supplier_override,override_basis,"
        "terminated_source,terminated_reason,terminated_at,required_count_snapshot,"
        "actual_count_snapshot,response_count_snapshot,deadline_snapshot,root_lot_id,"
        "previous_lot_id,round_number,updated_at FROM lot_procurement_controls WHERE lot_id=:lot_id",
        {"lot_id": lot_id},
    ).fetchone()
    mapping = _row_mapping(row)
    return SimpleNamespace(**mapping) if mapping else None


def _insert_event(database, event_key, project_id, lot_id, event_type, payload, now, mail_status="none"):
    result = _execute(
        database.session,
        "INSERT OR IGNORE INTO lot_supplier_events "
        "(event_key,project_id,lot_id,event_type,payload_json,mail_status,created_at) "
        "VALUES (:event_key,:project_id,:lot_id,:event_type,:payload_json,:mail_status,:created_at)",
        {
            "event_key": event_key,
            "project_id": project_id,
            "lot_id": lot_id,
            "event_type": event_type,
            "payload_json": json.dumps(payload, ensure_ascii=False, sort_keys=True),
            "mail_status": mail_status,
            "created_at": now.isoformat(timespec="seconds"),
        },
    )
    return getattr(result, "rowcount", 0) == 1


def _set_control(database, lot_id, now, **values):
    _execute(
        database.session,
        "INSERT OR IGNORE INTO lot_procurement_controls(lot_id,status,round_number,updated_at) "
        "VALUES (:lot_id,'active',1,:updated_at)",
        {"lot_id": lot_id, "updated_at": now.isoformat(timespec="seconds")},
    )
    allowed = {
        "status", "procurement_method", "minimum_supplier_override", "override_basis",
        "terminated_source", "terminated_reason", "terminated_at", "required_count_snapshot",
        "actual_count_snapshot", "response_count_snapshot", "deadline_snapshot", "root_lot_id",
        "previous_lot_id", "round_number",
    }
    assignments = []
    params = {"lot_id": lot_id, "updated_at": now.isoformat(timespec="seconds")}
    for key, value in values.items():
        if key not in allowed:
            raise ValueError(f"unsupported control field: {key}")
        assignments.append(f"{key}=:{key}")
        params[key] = value
    assignments.append("updated_at=:updated_at")
    _execute(
        database.session,
        f"UPDATE lot_procurement_controls SET {','.join(assignments)} WHERE lot_id=:lot_id",
        params,
    )


def _deadline(project, database=None):
    # V5's packaged ORM predates snapshot columns; read persisted metadata rather
    # than applying today's settings to an existing project's immutable stages.
    snapshots = {}
    if database is not None and getattr(project, 'id', None) is not None:
        columns = {row[1] for row in _execute(database.session, 'PRAGMA table_info(stages)')}
        if {'project_id', 'stage_key', 'modules_json', 'template_removed'} <= columns:
            snapshots = {
                row[0]: (row[1], bool(row[2]))
                for row in _execute(database.session,
                    'SELECT stage_key,modules_json,template_removed FROM stages WHERE project_id=:pid',
                    {'pid': project.id})
            }
    for stage in list(getattr(project, "stages", None) or []):
        key = getattr(stage, "stage_key", None) or getattr(stage, "key", None)
        modules, removed = snapshots.get(key, (
            getattr(stage, 'modules', getattr(stage, 'modules_json', None)),
            bool(getattr(stage, 'template_removed', False)),
        ))
        if removed or getattr(stage, 'skipped', False):
            continue
        if isinstance(modules, str):
            try:
                modules = json.loads(modules)
            except (ValueError, TypeError):
                continue  # Invalid explicit metadata must not trigger automation.
        if (modules is None and key != 'registration_end') or (modules is not None and (not isinstance(modules, list) or 'registration' not in modules)):
            continue
        value = (
            getattr(stage, "planned_datetime", None)
            or getattr(stage, "planned_at", None)
            or getattr(stage, "planned_date", None)
        )
        if isinstance(value, datetime):
            return value
        if value:
            return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    return None


def _control(lot, database=None):
    attached = getattr(lot, "supplier_control", None) or getattr(lot, "procurement_control", None)
    return attached or _load_control(database, getattr(lot, "id", None))


def build_project_snapshot(database, project, now, settings) -> dict:
    if database is not None:
        ensure_schema(database)
    deadline = _deadline(project, database)
    lots = list(getattr(project, "lots", None) or [])
    registrations = list(getattr(project, "registrations", None) or [])
    result = {
        "deadline": deadline.isoformat() if deadline else None,
        "days_remaining": (deadline.date() - now.date()).days if deadline else None,
        "warning_count": 0,
        "flowed_count": 0,
        "total_count": len(lots) if lots else 1,
        "blocked_reason": None,
        "unassigned_registration_ids": [],
        "items": [],
    }
    if getattr(project, "is_terminated", False):
        return result
    if len(lots) > 1 and any(getattr(registration, "lot_id", None) is None for registration in registrations):
        result["blocked_reason"] = "存在未关联采购包的报名记录"
        result["unassigned_registration_ids"] = [
            getattr(registration, "id", None)
            for registration in registrations
            if getattr(registration, "lot_id", None) is None
        ]
        return result

    warning_window = bool(
        deadline
        and (deadline.date() - now.date()).days in (0, 1)
        and now <= deadline
    )
    candidates = lots or [None]
    items = []
    for lot in candidates:
        lot_id = getattr(lot, "id", None) if lot else None
        control = _control(lot, database) if lot else None
        method = getattr(control, "procurement_method", None) or getattr(project, "method", "")
        required, source = effective_minimum(settings, method, control)
        count = sum(1 for registration in registrations if getattr(registration, "lot_id", None) == lot_id)
        stored_status = getattr(control, "status", "active") if control else "active"
        missing = max(0, required - count)
        status = "liubiao" if stored_status == "liubiao" else "warning" if warning_window and missing else "active"
        if status == "warning":
            result["warning_count"] += 1
        if status == "liubiao":
            result["flowed_count"] += 1
        items.append({
            "lot_id": lot_id,
            "lot_number": str(getattr(lot, "lot_number", "") or "") if lot else "",
            "lot_name": str(getattr(lot, "lot_name", "") or "未命名包") if lot else "项目整体",
            "status": status,
            "registration_count": count,
            "required_count": required,
            "missing_count": missing,
            "method": method,
            "rule_source": source,
            "minimum_supplier_override": getattr(control, "minimum_supplier_override", None) if control else None,
            "override_basis": getattr(control, "override_basis", None) if control else None,
            "terminated_source": getattr(control, "terminated_source", None) if control else None,
            "terminated_reason": getattr(control, "terminated_reason", None) if control else None,
            "terminated_at": getattr(control, "terminated_at", None) if control else None,
            "round_number": int(getattr(control, "round_number", 1) or 1) if control else 1,
        })
    result["items"] = sorted(items, key=lambda item: (item["status"] != "warning", item["lot_number"], item["lot_id"] or 0))
    return result


def enrich_project_payload(database, payload, project, now, settings) -> dict:
    enriched = dict(payload)
    enriched["lot_supplier_state"] = build_project_snapshot(
        database, project, now, settings
    )
    return enriched


def queue_due_warning_events(database, project, now, settings) -> list[dict]:
    ensure_schema(database)
    reminder_time = str((settings or {}).get("reminder_time") or "09:00")
    if now.strftime("%H:%M") != reminder_time:
        return []
    snapshot = build_project_snapshot(database, project, now, settings)
    if snapshot["blocked_reason"] or not snapshot["deadline"]:
        return []
    deadline = datetime.fromisoformat(snapshot["deadline"])
    days = (deadline.date() - now.date()).days
    if days not in (0, 1) or now >= deadline:
        return []
    risks = [item for item in snapshot["items"] if item["missing_count"] > 0 and item["status"] == "warning"]
    if not risks:
        return []
    kind = "day_before_warning" if days == 1 else "same_day_warning"
    recipients = sorted({str(value).strip().casefold() for value in (settings or {}).get("reminder_recipients", []) if str(value).strip()})
    recipient_hash = hashlib.sha256("\n".join(recipients).encode("utf-8")).hexdigest()[:16]
    event_key = f"{kind}|{project.id}|{snapshot['deadline']}|{recipient_hash}"
    subject_prefix = "【流标预警】" if days == 1 else "【今日截止】"
    subject = f"{subject_prefix}{getattr(project, 'name', '') or '-'}：{len(risks)}个包报名供应商不足"
    lines = []
    for item in risks:
        lot_label = "项目整体" if item["lot_id"] is None else f"{item['lot_number']} {item['lot_name'] or '未命名包'}".strip()
        lines.append(
            f"{lot_label}：已报名{item['registration_count']}家，最低要求{item['required_count']}家，还差{item['missing_count']}家"
        )
    lines.append(f"报名截止：{deadline.strftime('%Y-%m-%d %H:%M')}")
    payload = {
        "subject": subject,
        "body": "\n".join(lines),
        "recipients": recipients,
        "deadline": snapshot["deadline"],
        "items": risks,
        "project_number": str(getattr(project, "number", "") or ""),
        "project_name": str(getattr(project, "name", "") or ""),
        "purchaser": str(getattr(project, "purchaser", "") or ""),
        "method": str(getattr(project, "method", "") or ""),
        "year": getattr(project, "year", "") or "",
    }
    if not _insert_event(database, event_key, project.id, None, kind, payload, now, "pending"):
        return []
    row = _execute(database.session, "SELECT id FROM lot_supplier_events WHERE event_key=:event_key", {"event_key": event_key}).fetchone()
    return [{"id": row[0], **payload}]


def pending_mail_events(database, limit=50) -> list[dict]:
    ensure_schema(database)
    rows = _execute(
        database.session,
        "SELECT id,event_type,payload_json,mail_attempts FROM lot_supplier_events "
        "WHERE mail_status='pending' AND mail_attempts<3 ORDER BY id LIMIT :limit",
        {"limit": int(limit)},
    )
    result = []
    for row in rows:
        payload = json.loads(row[2])
        result.append({"id": row[0], "event_type": row[1], "mail_attempts": row[3], **payload})
    return result


def claim_mail_deliveries(database, parent_event, event, deliveries, now) -> list[dict]:
    """Atomically create per-recipient claims for one supplier parent event."""
    ensure_schema(database)
    event_id = int(parent_event["id"])
    event_key = str(event.get("event_key") or "")
    if not event_key or event.get("event_type") != "supplier_shortage":
        raise ValidationError("供应商邮件事件格式不正确")
    created = []
    for delivery in deliveries:
        recipient = str(delivery.get("recipient") or "").strip().casefold()
        fingerprint = str(delivery.get("rules_fingerprint") or "")
        if not recipient or len(fingerprint) != 64:
            raise ValidationError("供应商邮件投递规则不正确")
        delivery_key = hashlib.sha256(
            (event_key + "\0" + recipient + "\0" + fingerprint).encode("utf-8")
        ).hexdigest()
        result = _execute(
            database.session,
            "INSERT OR IGNORE INTO lot_supplier_mail_deliveries "
            "(delivery_key,event_id,event_key,recipient,rules_fingerprint,event_json,"
            "delivery_json,status,attempts,next_attempt_at,created_at) VALUES "
            "(:delivery_key,:event_id,:event_key,:recipient,:rules_fingerprint,"
            ":event_json,:delivery_json,'pending',0,:next_attempt_at,:created_at)",
            {
                "delivery_key": delivery_key,
                "event_id": event_id,
                "event_key": event_key,
                "recipient": recipient,
                "rules_fingerprint": fingerprint,
                "event_json": json.dumps(event, ensure_ascii=False, sort_keys=True),
                "delivery_json": json.dumps(delivery, ensure_ascii=False, sort_keys=True),
                "next_attempt_at": now.isoformat(timespec="seconds"),
                "created_at": now.isoformat(timespec="seconds"),
            },
        )
        if getattr(result, "rowcount", 0) == 1:
            created.append(
                {
                    "delivery_key": delivery_key,
                    "event_id": event_id,
                    "event_key": event_key,
                    "recipient": recipient,
                    "event": dict(event),
                    "delivery": dict(delivery),
                    "status": "pending",
                    "attempts": 0,
                }
            )
    return created


def pending_mail_deliveries(database, now, limit=50) -> list[dict]:
    ensure_schema(database)
    rows = _execute(
        database.session,
        "SELECT delivery_key,event_id,event_key,recipient,event_json,delivery_json,"
        "status,attempts,last_attempt_at,next_attempt_at,error_code,created_at "
        "FROM lot_supplier_mail_deliveries WHERE status='pending' AND attempts<3 "
        "AND (next_attempt_at IS NULL OR next_attempt_at<=:now) "
        "ORDER BY created_at,delivery_key LIMIT :limit",
        {"now": now.isoformat(timespec="seconds"), "limit": int(limit)},
    )
    return [
        {
            "delivery_key": row[0],
            "event_id": row[1],
            "event_key": row[2],
            "recipient": row[3],
            "event": json.loads(row[4]),
            "delivery": json.loads(row[5]),
            "status": row[6],
            "attempts": row[7],
            "last_attempt_at": row[8],
            "next_attempt_at": row[9],
            "error_code": row[10],
            "created_at": row[11],
        }
        for row in rows
    ]


def mark_mail_delivery_result(database, delivery_key, result, now) -> None:
    allowed = {
        "SMTP_AUTH_FAILED",
        "SMTP_TLS_FAILED",
        "SMTP_CONNECTION_FAILED",
        "SMTP_SEND_FAILED",
    }
    row = _execute(
        database.session,
        "SELECT event_id,attempts FROM lot_supplier_mail_deliveries "
        "WHERE delivery_key=:delivery_key",
        {"delivery_key": delivery_key},
    ).fetchone()
    if row is None:
        raise ValidationError("供应商邮件投递不存在")
    event_id, attempts = int(row[0]), int(row[1]) + 1
    if result.get("status") == "sent":
        _execute(
            database.session,
            "UPDATE lot_supplier_mail_deliveries SET status='sent',attempts=:attempts,"
            "last_attempt_at=:now,next_attempt_at=NULL,error_code=NULL,sent_at=:now "
            "WHERE delivery_key=:delivery_key AND status='pending'",
            {
                "attempts": attempts,
                "now": now.isoformat(timespec="seconds"),
                "delivery_key": delivery_key,
            },
        )
    else:
        error_code = result.get("error_code")
        safe = error_code if error_code in allowed else "SMTP_SEND_FAILED"
        terminal = safe == "SMTP_AUTH_FAILED" or attempts >= 3
        _execute(
            database.session,
            "UPDATE lot_supplier_mail_deliveries SET status=:status,attempts=:attempts,"
            "last_attempt_at=:now,next_attempt_at=:next_attempt,error_code=:error "
            "WHERE delivery_key=:delivery_key AND status='pending'",
            {
                "status": "failed" if terminal else "pending",
                "attempts": 3 if safe == "SMTP_AUTH_FAILED" else attempts,
                "now": now.isoformat(timespec="seconds"),
                "next_attempt": None
                if terminal
                else (now + timedelta(minutes=15)).isoformat(timespec="seconds"),
                "error": safe,
                "delivery_key": delivery_key,
            },
        )

    counts = _execute(
        database.session,
        "SELECT COUNT(*),SUM(CASE WHEN status='sent' THEN 1 ELSE 0 END),"
        "MAX(attempts),MAX(error_code) FROM lot_supplier_mail_deliveries "
        "WHERE event_id=:event_id",
        {"event_id": event_id},
    ).fetchone()
    total, sent_count = int(counts[0] or 0), int(counts[1] or 0)
    if total and sent_count == total:
        _execute(
            database.session,
            "UPDATE lot_supplier_events SET mail_status='sent',sent_at=:sent_at,"
            "mail_last_error=NULL WHERE id=:id",
            {"id": event_id, "sent_at": now.isoformat(timespec="seconds")},
        )
    else:
        _execute(
            database.session,
            "UPDATE lot_supplier_events SET mail_status='pending',mail_attempts=:attempts,"
            "mail_last_error=:error WHERE id=:id",
            {"id": event_id, "attempts": int(counts[2] or 0), "error": counts[3]},
        )


def mark_mail_failed(database, event_id, error_code):
    allowed = {"SMTP_AUTH_FAILED", "SMTP_TLS_FAILED", "SMTP_CONNECTION_FAILED", "SMTP_SEND_FAILED"}
    safe = error_code if error_code in allowed else "SMTP_SEND_FAILED"
    _execute(
        database.session,
        "UPDATE lot_supplier_events SET mail_attempts=mail_attempts+1,mail_last_error=:error "
        "WHERE id=:id AND mail_status='pending'",
        {"id": event_id, "error": safe},
    )


def mark_mail_sent(database, event_id, sent_at):
    _execute(
        database.session,
        "UPDATE lot_supplier_events SET mail_status='sent',sent_at=:sent_at,mail_last_error=NULL "
        "WHERE id=:id AND mail_status='pending'",
        {"id": event_id, "sent_at": sent_at.isoformat(timespec="seconds")},
    )


def apply_registration_cutoff(database, project, now, settings, actor="system") -> list[dict]:
    ensure_schema(database)
    snapshot = build_project_snapshot(database, project, now, settings)
    if snapshot["blocked_reason"] or not snapshot["deadline"] or now < datetime.fromisoformat(snapshot["deadline"]):
        return []
    changed = []
    for item in snapshot["items"]:
        if item["missing_count"] <= 0 or item["status"] == "liubiao":
            continue
        event_key = f"registration_cutoff|{project.id}|{item['lot_id'] or 'project'}|{snapshot['deadline']}"
        payload = {**item, "actor": actor, "deadline": snapshot["deadline"]}
        if not _insert_event(database, event_key, project.id, item["lot_id"], "registration_shortage_auto", payload, now):
            continue
        if item["lot_id"] is None:
            project.is_terminated = True
            project.terminated_type = "liubiao"
            project.terminated_reason = (
                f"报名供应商不足：实际{item['registration_count']}家，要求{item['required_count']}家"
            )
            changed.append(item)
            continue
        _set_control(
            database, item["lot_id"], now,
            status="liubiao", terminated_source="registration_shortage_auto",
            terminated_reason=f"报名供应商不足：实际{item['registration_count']}家，要求{item['required_count']}家",
            terminated_at=now.isoformat(timespec="seconds"),
            required_count_snapshot=item["required_count"], actual_count_snapshot=item["registration_count"],
            response_count_snapshot=None, deadline_snapshot=snapshot["deadline"],
        )
        changed.append(item)
    _roll_up_project(database, project)
    if changed:
        recipients = sorted({
            str(value).strip().casefold()
            for value in (settings or {}).get("reminder_recipients", [])
            if str(value).strip()
        })
        all_flowed = bool(getattr(project, "is_terminated", False))
        project_name = getattr(project, "name", "") or "-"
        subject = (
            f"【项目流标】{project_name}：全部采购包报名供应商不足"
            if all_flowed
            else f"【自动流标结果】{project_name}：{len(changed)}个采购包已自动流标"
        )
        lines = []
        for item in changed:
            lot_label = (
                "项目整体"
                if item["lot_id"] is None
                else f"{item['lot_number']} {item['lot_name'] or '未命名包'}".strip()
            )
            lines.append(
                f"{lot_label}：已报名{item['registration_count']}家，最低要求{item['required_count']}家，已自动流标"
            )
        if not all_flowed:
            lines.append("其他采购包继续采购。")
        result_payload = {
            "subject": subject,
            "body": "\n".join(lines),
            "recipients": recipients,
            "deadline": snapshot["deadline"],
            "items": changed,
        }
        _insert_event(
            database,
            f"registration_cutoff_result|{project.id}|{snapshot['deadline']}",
            project.id,
            None,
            "registration_cutoff_result",
            result_payload,
            now,
            "pending",
        )
    return changed


def _roll_up_project(database, project):
    lots = list(getattr(project, "lots", None) or [])
    if not lots:
        return
    states = []
    for lot in lots:
        control = _load_control(database, lot.id)
        states.append(getattr(control, "status", "active") if control else "active")
    if states and all(state == "liubiao" for state in states):
        project.is_terminated = True
        project.terminated_type = "liubiao"
        project.terminated_reason = "全部采购包已流标"


def manual_liubiao(database, project, lot, response_count, reason, actor_id) -> dict:
    ensure_schema(database)
    if isinstance(response_count, bool) or not isinstance(response_count, int) or response_count < 0:
        raise ValidationError("实际响应家数必须为大于等于0的整数")
    reason = str(reason or "").strip()
    if not reason:
        raise ValidationError("请填写流标原因")
    now = datetime.now()
    _set_control(
        database, lot.id, now,
        status="liubiao", terminated_source="response_shortage_manual",
        terminated_reason=reason, terminated_at=now.isoformat(timespec="seconds"),
        required_count_snapshot=None, actual_count_snapshot=None,
        response_count_snapshot=response_count, deadline_snapshot=None,
    )
    payload = {"lot_id": lot.id, "response_count": response_count, "reason": reason, "actor_id": actor_id}
    _insert_event(database, f"manual_liubiao|{project.id}|{lot.id}|{uuid.uuid4().hex}", project.id, lot.id, "response_shortage_manual", payload, now)
    _roll_up_project(database, project)
    return {"lot_id": lot.id, "status": "liubiao", "source": "response_shortage_manual"}


def restore_lot(database, project, lot, reason, actor_id) -> dict:
    ensure_schema(database)
    reason = str(reason or "").strip()
    if not reason:
        raise ValidationError("请填写恢复原因")
    now = datetime.now()
    _set_control(
        database, lot.id, now,
        status="active", terminated_source=None, terminated_reason=None, terminated_at=None,
        required_count_snapshot=None, actual_count_snapshot=None,
        response_count_snapshot=None, deadline_snapshot=None,
    )
    payload = {"lot_id": lot.id, "reason": reason, "actor_id": actor_id}
    _insert_event(database, f"restore|{project.id}|{lot.id}|{uuid.uuid4().hex}", project.id, lot.id, "lot_restored", payload, now)
    return {"lot_id": lot.id, "status": "active"}


def save_lot_rule(database, project, lot, minimum, basis, actor_id) -> dict:
    ensure_schema(database)
    if minimum is not None:
        if isinstance(minimum, bool) or not isinstance(minimum, int) or not 1 <= minimum <= 99:
            raise ValidationError("包级最低供应商数量必须为1至99的整数")
        basis = str(basis or "").strip()
        if not basis:
            raise ValidationError("包级规则必须填写调整依据")
    else:
        basis = None
    now = datetime.now()
    _set_control(
        database, lot.id, now,
        minimum_supplier_override=minimum, override_basis=basis,
    )
    payload = {"minimum": minimum, "basis": basis, "actor_id": actor_id}
    _insert_event(database, f"lot_rule|{project.id}|{lot.id}|{uuid.uuid4().hex}", project.id, lot.id, "lot_rule_updated", payload, now)
    return {"lot_id": lot.id, "minimum_supplier_override": minimum, "override_basis": basis}


def create_reprocurement(database, project, source_lot, payload, actor_id) -> dict:
    ensure_schema(database)
    method = str(payload.get("procurement_method") or "").strip()
    if method not in DEFAULT_MINIMUMS:
        raise ValidationError("采购方式不受支持")
    now = datetime.now()
    source_control = _load_control(database, source_lot.id)
    if not source_control or source_control.status != "liubiao":
        raise ValidationError("只有已流标采购包可以重新采购")
    cursor = _execute(
        database.session,
        "INSERT INTO project_lots(project_id,lot_number,lot_name,budget,notes) "
        "VALUES (:project_id,:lot_number,:lot_name,:budget,:notes)",
        {
            "project_id": project.id,
            "lot_number": str(payload.get("lot_number") or source_lot.lot_number).strip(),
            "lot_name": str(payload.get("lot_name") or source_lot.lot_name).strip(),
            "budget": payload.get("budget", source_lot.budget),
            "notes": str(payload.get("notes") or "").strip(),
        },
    )
    new_id = int(getattr(cursor, "lastrowid", 0))
    root_id = source_control.root_lot_id or source_lot.id
    round_number = int(source_control.round_number or 1) + 1
    _set_control(
        database, new_id, now,
        status="active", procurement_method=method, root_lot_id=root_id,
        previous_lot_id=source_lot.id, round_number=round_number,
    )
    created = {
        "id": new_id, "project_id": project.id,
        "lot_number": str(payload.get("lot_number") or source_lot.lot_number).strip(),
        "lot_name": str(payload.get("lot_name") or source_lot.lot_name).strip(),
        "budget": payload.get("budget", source_lot.budget), "notes": str(payload.get("notes") or "").strip(),
        "procurement_method": method, "round_number": round_number,
    }
    _insert_event(database, f"reprocurement|{project.id}|{new_id}", project.id, new_id, "reprocurement_created", {**created, "actor_id": actor_id, "source_lot_id": source_lot.id}, now)
    return created
