"""Structured consortium storage helpers for the frozen application patch."""

from __future__ import annotations

import sqlite3
import re
import threading
import weakref
from pathlib import Path


BIDDER_TYPES = {"standalone", "consortium"}
MAX_MEMBERS = 20
MAX_NAME_LENGTH = 200
MEMBER_FIELDS = {
    'company_address': (1000, '成员单位地址'),
    'legal_representative': (200, '成员法定代表人'),
    'bid_manager': (200, '成员联系人'),
    'manager_phone': (100, '成员电话'),
    'manager_email': (254, '成员邮箱'),
    'notes': (5000, '成员备注'),
}
_SCHEMA_LOCK = threading.RLock()
_READY_DATABASES = weakref.WeakSet()


class ValidationError(ValueError):
    """A stable client-facing registration validation failure."""


def _trimmed_name(value) -> str:
    return str(value or "").strip()


def _member_details(member):
    result = {}
    for field, (limit, label) in MEMBER_FIELDS.items():
        if field not in member:
            continue  # Older clients omit detail fields; an explicit blank clears.
        raw = member[field]
        if raw is not None and not isinstance(raw, str):
            raise ValidationError(f'{label}格式无效')
        value = (raw or '').strip()
        if len(value) > limit:
            raise ValidationError(f'{label}不能超过{limit}个字符')
        if field == 'manager_email' and value and not re.fullmatch(r'[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+', value):
            raise ValidationError('成员邮箱格式不正确')
        result[field] = value
    return result


def validate_payload(data: dict, *, current_type: str = "standalone") -> dict:
    if not isinstance(data, dict):
        raise ValidationError("报名登记数据无效")
    bidder_type = data.get("bidder_type", current_type or "standalone")
    if bidder_type not in BIDDER_TYPES:
        raise ValidationError("投标主体类型无效")

    lead = _trimmed_name(data.get("company_name"))
    if not lead:
        raise ValidationError("请填写公司名称")
    if len(lead) > MAX_NAME_LENGTH:
        raise ValidationError("公司名称不能超过200个字符")

    if bidder_type == "standalone":
        return {
            "bidder_type": bidder_type,
            "company_name": lead,
            "consortium_members": [],
        }

    members = data.get("consortium_members", [])
    if not isinstance(members, list):
        raise ValidationError("联合体成员数据无效")
    if not members:
        raise ValidationError("联合体至少需要一个成员单位")
    if len(members) > MAX_MEMBERS:
        raise ValidationError("联合体成员不能超过20个")

    normalized = []
    seen = set()
    lead_key = lead.casefold()
    for member in members:
        if not isinstance(member, dict):
            raise ValidationError("联合体成员数据无效")
        name = _trimmed_name(member.get("company_name"))
        if not name:
            raise ValidationError("成员单位名称不能为空")
        if len(name) > MAX_NAME_LENGTH:
            raise ValidationError("成员单位名称不能超过200个字符")
        key = name.casefold()
        if key == lead_key:
            raise ValidationError("成员单位不能与牵头单位相同")
        if key in seen:
            raise ValidationError("成员单位名称不能重复")
        seen.add(key)
        normalized.append({"company_name": name, **_member_details(member)})

    return {
        "bidder_type": bidder_type,
        "company_name": lead,
        "consortium_members": normalized,
    }


def _create_member_table(connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS registration_consortium_members (
            id INTEGER PRIMARY KEY,
            registration_id INTEGER NOT NULL,
            company_name VARCHAR(200) NOT NULL,
            sort_order INTEGER NOT NULL,
            FOREIGN KEY(registration_id) REFERENCES supplier_registrations(id) ON DELETE CASCADE,
            UNIQUE(registration_id, sort_order)
        )
        """
    )


def _execute(session, statement: str, parameters=None):
    if getattr(session, "_consortium_raw_sql", False):
        return session.execute(statement, parameters or {})
    from sqlalchemy import text

    return session.execute(text(statement), parameters or {})


def _ensure_member_columns(execute):
    columns = {row[1] for row in execute('PRAGMA table_info(registration_consortium_members)')}
    for field in MEMBER_FIELDS:
        if field not in columns:
            execute(f"ALTER TABLE registration_consortium_members ADD COLUMN {field} TEXT NOT NULL DEFAULT ''")


def _ensure_session_schema(database) -> None:
    session = database.session
    rows = _execute(session, "PRAGMA table_info(supplier_registrations)")
    columns = {row[1] for row in rows}
    if "bidder_type" not in columns:
        _execute(
            session,
            "ALTER TABLE supplier_registrations "
            "ADD COLUMN bidder_type VARCHAR(20) NOT NULL DEFAULT 'standalone'",
        )
    _execute(
        session,
        """
        CREATE TABLE IF NOT EXISTS registration_consortium_members (
            id INTEGER PRIMARY KEY,
            registration_id INTEGER NOT NULL,
            company_name VARCHAR(200) NOT NULL,
            sort_order INTEGER NOT NULL,
            FOREIGN KEY(registration_id) REFERENCES supplier_registrations(id) ON DELETE CASCADE,
            UNIQUE(registration_id, sort_order)
        )
        """,
    )
    _ensure_member_columns(lambda sql: _execute(session, sql))
    session.commit()


def ensure_schema(database, *, _create_members=None) -> None:
    """Apply the additive consortium schema atomically and idempotently."""

    if not isinstance(database, (str, Path)):
        session = database.session
        with _SCHEMA_LOCK:
            try:
                if session in _READY_DATABASES:
                    return
            except TypeError:
                pass
            try:
                _ensure_session_schema(database)
            except Exception:
                database.session.rollback()
                raise
            try:
                _READY_DATABASES.add(session)
            except TypeError:
                pass
        return

    connection = sqlite3.connect(str(database))
    create_members = _create_members or _create_member_table
    try:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.execute("BEGIN IMMEDIATE")
        columns = {
            row[1]
            for row in connection.execute(
                "PRAGMA table_info(supplier_registrations)"
            )
        }
        if "bidder_type" not in columns:
            connection.execute(
                "ALTER TABLE supplier_registrations "
                "ADD COLUMN bidder_type VARCHAR(20) NOT NULL DEFAULT 'standalone'"
            )
        create_members(connection)
        _ensure_member_columns(connection.execute)
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def replace_members(
    database,
    registration_id: int,
    bidder_type: str,
    members: list[dict],
) -> None:
    """Replace all ordered members inside the caller-owned transaction."""

    ensure_schema(database)
    if bidder_type not in BIDDER_TYPES:
        raise ValidationError("投标主体类型无效")
    session = database.session
    prior = {}
    if bidder_type == 'consortium':
        for row in _execute(session, 'SELECT company_name,' + ','.join(MEMBER_FIELDS) +
                            ' FROM registration_consortium_members WHERE registration_id=:id', {'id': registration_id}):
            prior[_trimmed_name(row[0]).casefold()] = dict(zip(MEMBER_FIELDS, row[1:]))
    _execute(
        session,
        "UPDATE supplier_registrations SET bidder_type=:bidder_type WHERE id=:id",
        {"bidder_type": bidder_type, "id": registration_id},
    )
    _execute(
        session,
        "DELETE FROM registration_consortium_members WHERE registration_id=:id",
        {"id": registration_id},
    )
    if bidder_type == "standalone":
        return
    for sort_order, member in enumerate(members):
        details = {field: prior.get(_trimmed_name(member['company_name']).casefold(), {}).get(field, '') for field in MEMBER_FIELDS}
        details.update(_member_details(member))
        _execute(
            session,
            "INSERT INTO registration_consortium_members "
            "(registration_id, company_name, sort_order," + ','.join(MEMBER_FIELDS) + ") "
            "VALUES (:registration_id, :company_name, :sort_order," + ','.join(':' + field for field in MEMBER_FIELDS) + ")",
            {
                "registration_id": registration_id,
                "company_name": member["company_name"],
                "sort_order": sort_order,
                **details,
            },
        )


def enrich_registration(database, payload: dict) -> dict:
    """Add ordered member profiles; old name-only rows retain their API shape."""

    ensure_schema(database)
    enriched = dict(payload)
    registration_id = enriched.get("id")
    row = _execute(
        database.session,
        "SELECT bidder_type FROM supplier_registrations WHERE id=:id",
        {"id": registration_id},
    ).fetchone()
    bidder_type = row[0] if row and row[0] in BIDDER_TYPES else "standalone"
    members = []
    if bidder_type == "consortium":
        rows = _execute(
            database.session,
            "SELECT company_name," + ','.join(MEMBER_FIELDS) + " FROM registration_consortium_members "
            "WHERE registration_id=:id ORDER BY sort_order, id",
            {"id": registration_id},
        )
        members = [{"company_name": row[0], **{field: value for field, value in zip(MEMBER_FIELDS, row[1:]) if value}} for row in rows]
    enriched["bidder_type"] = bidder_type
    enriched["consortium_members"] = members
    return enriched


def delete_members(database, registration_id: int) -> None:
    ensure_schema(database)
    _execute(
        database.session,
        "DELETE FROM registration_consortium_members WHERE registration_id=:id",
        {"id": registration_id},
    )


registration_write_lock = threading.RLock()


def supplier_identity(company_name, lot_id=None):
    import unicodedata
    name = ''.join(unicodedata.normalize('NFKC', str(company_name or '')).split()).casefold()
    return (int(lot_id) if lot_id else None, name)


def find_existing_registration(database, model, project_id, company_name, lot_id=None, exclude_id=None):
    identity = supplier_identity(company_name, lot_id)
    for row in database.session.query(model).filter_by(project_id=project_id).all():
        if row.id != exclude_id and supplier_identity(row.company_name, row.lot_id) == identity:
            return row
    return None
