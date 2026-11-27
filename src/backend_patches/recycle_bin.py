"""Logical soft-delete recycle bin with deferred physical cleanup and full query isolation.

recycle-bin-v1
"""
from __future__ import annotations

from datetime import datetime, timedelta
import json
import re
from typing import Any

from flask import jsonify, request, session
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
import sqlite3


RECYCLE_BIN_SIGNATURE = "recycle-bin-v1"
DEFAULT_RETENTION_DAYS = 30
MIN_RETENTION_DAYS = 0
MAX_RETENTION_DAYS = 365
VALID_ENTITY_TYPES = ("project", "attachment", "complaint", "clarification")
_DELETED_NUMBER_PREFIX = "__deleted__"

_SCHEMA_SQL = (
    """
    CREATE TABLE IF NOT EXISTS recycle_bin_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity_type TEXT NOT NULL,
        entity_id INTEGER NOT NULL,
        project_id INTEGER NOT NULL,
        display_title TEXT NOT NULL DEFAULT '',
        snapshot_json TEXT NOT NULL DEFAULT '{}',
        deleted_by INTEGER,
        deleted_by_name TEXT NOT NULL DEFAULT '',
        delete_reason TEXT NOT NULL DEFAULT '',
        deleted_at TEXT NOT NULL,
        purge_after TEXT,
        status TEXT NOT NULL DEFAULT 'deleted',
        restored_at TEXT,
        restored_by INTEGER,
        purged_at TEXT,
        purged_by INTEGER
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_recycle_bin_active ON recycle_bin_items (status, entity_type, entity_id)",
    "CREATE INDEX IF NOT EXISTS idx_recycle_bin_project ON recycle_bin_items (status, project_id)",
    "CREATE INDEX IF NOT EXISTS idx_recycle_bin_purge ON recycle_bin_items (status, purge_after)",
)

_PROJECT_ROUTE_RE = re.compile(r"^/api/projects/(\d+)(?:/|$)")
_ATTACHMENT_ROUTE_RE = re.compile(r"^/api/attachments/(\d+)(?:/|$)")
_COMPLAINT_ROUTE_RE = re.compile(r"^/api/projects/(\d+)/complaints/(\d+)(?:/|$)")
_COMPLAINT_ATT_ROUTE_RE = re.compile(r"^/api/complaints/(\d+)/attachment$")
_CLARIFICATION_ROUTE_RE = re.compile(r"^/api/projects/(\d+)/clarifications/(\d+)(?:/|$)")
_LAST_AUTO_PURGE_AT: dict[str, datetime] = {}


def _normalize_ctx(ctx: Any) -> Any:
    """Accept dict, AppContextRegistry, module (legacy server_app), or SimpleNamespace."""
    if ctx is None:
        return {}
    if hasattr(ctx, "get") and callable(ctx.get):
        return ctx
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    return runtime_context.get_runtime_context(ctx)


def _session_from(db_or_session: Any):
    if db_or_session is None:
        return None
    if hasattr(db_or_session, "session"):
        return db_or_session.session
    return db_or_session


def _has_table(db_or_session: Any) -> bool:
    sess = _session_from(db_or_session)
    if sess is None or not callable(getattr(sess, "execute", None)):
        return False
    try:
        row = sess.execute(
            text("SELECT 1 FROM sqlite_master WHERE type='table' AND name='recycle_bin_items'")
        ).first()
        return row is not None
    except Exception:
        return False


def ensure_schema(db_or_session: Any, *, allow_create: bool = True) -> bool:
    """Create recycle_bin_items lazily on write paths; read paths never take a write lock."""
    sess = _session_from(db_or_session)
    if sess is None or not callable(getattr(sess, "execute", None)):
        return False
    if _has_table(sess):
        return True
    if not allow_create:
        return False
    for stmt in _SCHEMA_SQL:
        sess.execute(text(stmt))
    return True


def is_enabled(ctx_or_app: Any) -> bool:
    """Return True when running inside a registered app with SQL execution support."""
    if ctx_or_app is None:
        return False
    app = ctx_or_app.get("app") if hasattr(ctx_or_app, "get") else getattr(ctx_or_app, "app", ctx_or_app)
    if app is None:
        return False
    ext = getattr(app, "extensions", None)
    if not isinstance(ext, dict) or "recycle_bin" not in ext:
        return False
    db = ctx_or_app.get("db") if hasattr(ctx_or_app, "get") else ext["recycle_bin"].get("db")
    sess = _session_from(db)
    return sess is not None and callable(getattr(sess, "execute", None))


def normalize_retention_days(value: Any, default: int = DEFAULT_RETENTION_DAYS) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        raise ValueError("回收站保留天数必须为整数")
    try:
        days = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("回收站保留天数必须为整数") from exc
    if days < MIN_RETENTION_DAYS or days > MAX_RETENTION_DAYS:
        raise ValueError(f"回收站保留天数须在 {MIN_RETENTION_DAYS} 至 {MAX_RETENTION_DAYS} 天之间（0 表示不自动清理）")
    return days


def retention_days_from_settings(settings: Any) -> int:
    if not isinstance(settings, dict):
        return DEFAULT_RETENTION_DAYS
    try:
        return normalize_retention_days(settings.get("recycle_bin_retention_days"), DEFAULT_RETENTION_DAYS)
    except ValueError:
        return DEFAULT_RETENTION_DAYS


def deleted_ids(
    db_or_session: Any,
    entity_type: str,
    *,
    project_id: int | None = None,
) -> set[int]:
    """Return active soft-deleted (or currently purging) entity IDs without acquiring any SQLite write lock."""
    if not _has_table(db_or_session):
        return set()
    sess = _session_from(db_or_session)
    sql = "SELECT entity_id FROM recycle_bin_items WHERE status IN ('deleted','purging') AND entity_type=:etype"
    params: dict[str, Any] = {"etype": entity_type}
    if project_id is not None:
        sql += " AND project_id=:pid"
        params["pid"] = int(project_id)
    try:
        rows = sess.execute(text(sql), params).fetchall()
        return {int(row[0]) for row in rows if row[0] is not None}
    except Exception:
        return set()


def is_deleted(db_or_session: Any, entity_type: str, entity_id: int) -> bool:
    if not _has_table(db_or_session):
        return False
    sess = _session_from(db_or_session)
    try:
        row = sess.execute(
            text(
                "SELECT 1 FROM recycle_bin_items "
                "WHERE status IN ('deleted','purging') AND entity_type=:etype AND entity_id=:eid LIMIT 1"
            ),
            {"etype": entity_type, "eid": int(entity_id)},
        ).first()
        return row is not None
    except Exception:
        return False


def deleted_child_ids(db_or_session: Any, project_id: int) -> dict[str, set[int]]:
    """Fetch soft-deleted attachment, complaint, and clarification IDs for one project in a single SQL query."""
    empty = {"attachment": set(), "complaint": set(), "clarification": set()}
    if not _has_table(db_or_session):
        return empty
    sess = _session_from(db_or_session)
    try:
        rows = sess.execute(
            text(
                "SELECT entity_type, entity_id FROM recycle_bin_items "
                "WHERE status IN ('deleted','purging') AND project_id=:pid "
                "AND entity_type IN ('attachment','complaint','clarification')"
            ),
            {"pid": int(project_id)},
        ).fetchall()
        for etype, eid in rows:
            key = str(etype)
            if key in empty and eid is not None:
                empty[key].add(int(eid))
    except Exception:
        pass
    return empty


def hidden_attachment_ids(db_or_session: Any, *, project_id: int | None = None) -> set[int]:
    """Return all attachment IDs hidden by soft-deleted attachments, projects, complaints, or clarifications."""
    if not _has_table(db_or_session):
        return set()
    sess = _session_from(db_or_session)
    hidden: set[int] = set()
    try:
        if project_id is not None:
            pid = int(project_id)
            if is_deleted(sess, "project", pid):
                rows = sess.execute(
                    text("SELECT id FROM attachments WHERE project_id=:pid"),
                    {"pid": pid},
                ).fetchall()
                return {int(r[0]) for r in rows if r[0] is not None}
            child = deleted_child_ids(sess, pid)
            hidden.update(child["attachment"])
            del_comps = child["complaint"]
            del_clars = child["clarification"]
            if del_comps or del_clars:
                rows = sess.execute(
                    text(
                        "SELECT a.id, a.complaint_id, a.clarification_id, ce.complaint_id AS event_complaint_id "
                        "FROM attachments a "
                        "LEFT JOIN complaint_events ce ON ce.id = a.complaint_event_id "
                        "WHERE a.project_id=:pid"
                    ),
                    {"pid": pid},
                ).fetchall()
                for aid, cid, clid, ecid in rows:
                    if (cid is not None and int(cid) in del_comps) or (ecid is not None and int(ecid) in del_comps):
                        hidden.add(int(aid))
                    elif clid is not None and int(clid) in del_clars:
                        hidden.add(int(aid))
            return hidden

        # Global scope across all projects
        rb_rows = sess.execute(
            text(
                "SELECT entity_type, entity_id FROM recycle_bin_items "
                "WHERE status IN ('deleted','purging')"
            )
        ).fetchall()
        del_projects: set[int] = set()
        del_comps: set[int] = set()
        del_clars: set[int] = set()
        for etype, eid in rb_rows:
            if eid is None:
                continue
            et = str(etype)
            val = int(eid)
            if et == "attachment":
                hidden.add(val)
            elif et == "project":
                del_projects.add(val)
            elif et == "complaint":
                del_comps.add(val)
            elif et == "clarification":
                del_clars.add(val)
        if del_projects or del_comps or del_clars:
            rows = sess.execute(
                text(
                    "SELECT a.id, a.project_id, a.complaint_id, a.clarification_id, ce.complaint_id AS event_complaint_id "
                    "FROM attachments a "
                    "LEFT JOIN complaint_events ce ON ce.id = a.complaint_event_id"
                )
            ).fetchall()
            for aid, apid, cid, clid, ecid in rows:
                if (apid is not None and int(apid) in del_projects) or (
                    cid is not None and int(cid) in del_comps
                ) or (
                    ecid is not None and int(ecid) in del_comps
                ) or (
                    clid is not None and int(clid) in del_clars
                ):
                    hidden.add(int(aid))
    except Exception:
        pass
    return hidden


def is_attachment_visible(db_or_session: Any, attachment: Any) -> bool:
    """Single source of truth for whether an attachment can be listed, previewed, exported, or downloaded."""
    if attachment is None:
        return False
    if not _has_table(db_or_session):
        return True
    sess = _session_from(db_or_session)
    aid = getattr(attachment, "id", None)
    pid = getattr(attachment, "project_id", None)
    if aid is not None and is_deleted(sess, "attachment", int(aid)):
        return False
    if pid is not None and is_deleted(sess, "project", int(pid)):
        return False
    cid = getattr(attachment, "complaint_id", None)
    if cid is not None and is_deleted(sess, "complaint", int(cid)):
        return False
    clid = getattr(attachment, "clarification_id", None)
    if clid is not None and is_deleted(sess, "clarification", int(clid)):
        return False
    ceid = getattr(attachment, "complaint_event_id", None)
    if ceid is not None:
        try:
            row = sess.execute(
                text("SELECT complaint_id FROM complaint_events WHERE id=:eid"),
                {"eid": int(ceid)},
            ).first()
            if row and row[0] is not None and is_deleted(sess, "complaint", int(row[0])):
                return False
        except Exception:
            pass
    return True


def can_permanent_delete(ctx: Any, entity_type: str) -> bool:
    """Enforce identical permanent-delete authorization across recycle bin and ?permanent=1 routes."""
    runtime = _normalize_ctx(ctx)
    app = runtime.get("app")
    db = runtime.get("db")
    User = runtime.get("User")
    is_admin, perms = _actor_permissions(app, db, User)
    if is_admin:
        return True
    if entity_type == "project":
        return bool(perms.get("delete_projects"))
    if entity_type == "attachment":
        return bool(perms.get("manage_attachments"))
    # Complaints and clarifications permanent deletion is strictly admin-only
    return False


def filter_active_projects(db_or_session: Any, projects: list[Any], *, ctx: Any = None) -> list[Any]:
    if not projects:
        return list(projects)
    if ctx is not None and not is_enabled(ctx):
        return list(projects)
    excluded = deleted_ids(db_or_session, "project")
    if not excluded:
        return list(projects)
    return [p for p in projects if getattr(p, "id", None) not in excluded]


def _current_actor(ctx: Any) -> tuple[int | None, str]:
    uid = session.get("user_id") if session else None
    username = str(session.get("username") or "") if session else ""
    if uid is not None:
        try:
            uid = int(uid)
        except (TypeError, ValueError):
            uid = None
    if uid is not None and not username:
        User = ctx.get("User")
        db = ctx.get("db")
        if User is not None and db is not None:
            try:
                user = db.session.get(User, uid)
                if user is not None:
                    username = str(getattr(user, "display_name", "") or getattr(user, "username", "") or "")
            except Exception:
                pass
    return uid, username


def _now_iso(now: datetime | None = None) -> tuple[datetime, str]:
    dt = now or datetime.now()
    return dt, dt.isoformat(timespec="seconds")


def _compute_purge_after(now: datetime, settings: Any) -> str | None:
    days = retention_days_from_settings(settings)
    if days <= 0:
        return None
    return (now + timedelta(days=days)).isoformat(timespec="seconds")


def _extract_delete_reason(request_obj: Any) -> str:
    if request_obj is None:
        return ""
    try:
        data = request_obj.get_json(silent=True) or {}
    except Exception:
        data = {}
    if isinstance(data, dict):
        reason = data.get("reason") or data.get("delete_reason") or ""
        return str(reason).strip()[:500]
    return ""


def _build_tombstone_number(project_id: int, original_number: str, now: datetime) -> str:
    stamp = now.strftime("%Y%m%d%H%M%S%f")
    base = str(original_number or "").strip()
    return f"{_DELETED_NUMBER_PREFIX}{project_id}__{stamp}__{base}"[:180]


def _insert_recycle_row(
    db: Any,
    *,
    entity_type: str,
    entity_id: int,
    project_id: int,
    display_title: str,
    snapshot: dict[str, Any],
    deleted_by: int | None,
    deleted_by_name: str,
    delete_reason: str,
    deleted_at: str,
    purge_after: str | None,
) -> int:
    ensure_schema(db, allow_create=True)
    result = db.session.execute(
        text(
            "INSERT INTO recycle_bin_items ("
            "entity_type, entity_id, project_id, display_title, snapshot_json, "
            "deleted_by, deleted_by_name, delete_reason, deleted_at, purge_after, status"
            ") VALUES ("
            ":entity_type, :entity_id, :project_id, :display_title, :snapshot_json, "
            ":deleted_by, :deleted_by_name, :delete_reason, :deleted_at, :purge_after, 'deleted'"
            ")"
        ),
        {
            "entity_type": entity_type,
            "entity_id": int(entity_id),
            "project_id": int(project_id),
            "display_title": str(display_title or "")[:300],
            "snapshot_json": json.dumps(snapshot, ensure_ascii=False),
            "deleted_by": deleted_by,
            "deleted_by_name": str(deleted_by_name or "")[:120],
            "delete_reason": str(delete_reason or "")[:500],
            "deleted_at": deleted_at,
            "purge_after": purge_after,
        },
    )
    row_id = getattr(result, "lastrowid", None)
    if row_id is None:
        row_id = db.session.execute(text("SELECT last_insert_rowid()")).scalar()
    return int(row_id or 0)


def soft_delete_project(ctx: Any, project: Any, *, reason: str = "", now: datetime | None = None) -> dict[str, Any]:
    db = ctx.get("db")
    load_app_settings = ctx.get("load_app_settings", lambda: {})
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    dt, deleted_at = _now_iso(now)
    settings = load_app_settings() if callable(load_app_settings) else {}
    purge_after = _compute_purge_after(dt, settings)
    uid, uname = _current_actor(ctx)

    original_number = str(getattr(project, "number", "") or "")
    attachments = list(project.attachments.all()) if hasattr(project.attachments, "all") else list(project.attachments or [])
    deleted_att_ids = deleted_ids(db, "attachment", project_id=project.id)
    active_attachments = [a for a in attachments if getattr(a, "id", None) not in deleted_att_ids]
    total_bytes = sum(int(getattr(a, "file_size", 0) or 0) for a in active_attachments)

    tombstone_number = _build_tombstone_number(project.id, original_number, dt)
    snapshot = {
        "original_number": original_number,
        "tombstone_number": tombstone_number,
        "name": str(getattr(project, "name", "") or ""),
        "purchaser": str(getattr(project, "purchaser", "") or ""),
        "year": str(getattr(project, "year", "") or ""),
        "method": str(getattr(project, "method", "") or ""),
        "budget": getattr(project, "budget", None),
        "attachment_count": len(active_attachments),
        "attachment_bytes": total_bytes,
    }
    display_title = f"{original_number} · {snapshot['name']}" if original_number else snapshot["name"]

    project.number = tombstone_number
    recycle_id = _insert_recycle_row(
        db,
        entity_type="project",
        entity_id=project.id,
        project_id=project.id,
        display_title=display_title,
        snapshot=snapshot,
        deleted_by=uid,
        deleted_by_name=uname,
        delete_reason=reason,
        deleted_at=deleted_at,
        purge_after=purge_after,
    )
    db.session.commit()
    try:
        log_operation("project.soft_delete", "project", project.id, f"移入回收站：{display_title}")
    except Exception:
        pass
    return {
        "ok": True,
        "soft_deleted": True,
        "recycle_id": recycle_id,
        "purge_after": purge_after,
        "message": f"项目「{snapshot['name'] or original_number}」已移入回收站",
    }


def soft_delete_attachment(ctx: Any, attachment: Any, *, reason: str = "", now: datetime | None = None) -> dict[str, Any]:
    db = ctx.get("db")
    Project = ctx.get("Project")
    load_app_settings = ctx.get("load_app_settings", lambda: {})
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    dt, deleted_at = _now_iso(now)
    settings = load_app_settings() if callable(load_app_settings) else {}
    purge_after = _compute_purge_after(dt, settings)
    uid, uname = _current_actor(ctx)

    project = db.session.get(Project, attachment.project_id) if Project is not None else None
    snapshot = {
        "filename": str(getattr(attachment, "filename", "") or ""),
        "file_path": str(getattr(attachment, "file_path", "") or ""),
        "file_size": int(getattr(attachment, "file_size", 0) or 0),
        "mime_type": str(getattr(attachment, "mime_type", "") or ""),
        "description": str(getattr(attachment, "description", "") or ""),
        "project_id": int(attachment.project_id),
        "project_number": str(getattr(project, "number", "") or "") if project is not None else "",
        "project_name": str(getattr(project, "name", "") or "") if project is not None else "",
        "registration_id": getattr(attachment, "registration_id", None),
        "complaint_id": getattr(attachment, "complaint_id", None),
        "complaint_event_id": getattr(attachment, "complaint_event_id", None),
        "clarification_id": getattr(attachment, "clarification_id", None),
    }
    recycle_id = _insert_recycle_row(
        db,
        entity_type="attachment",
        entity_id=attachment.id,
        project_id=attachment.project_id,
        display_title=snapshot["filename"] or f"附件 #{attachment.id}",
        snapshot=snapshot,
        deleted_by=uid,
        deleted_by_name=uname,
        delete_reason=reason,
        deleted_at=deleted_at,
        purge_after=purge_after,
    )
    db.session.commit()
    try:
        log_operation("delete_attachment", "project", attachment.project_id, f"附件移入回收站：{snapshot['filename']}")
    except Exception:
        pass
    return {
        "ok": True,
        "soft_deleted": True,
        "recycle_id": recycle_id,
        "purge_after": purge_after,
        "message": f"{snapshot['filename']} 已移入回收站",
    }


def soft_delete_complaint(ctx: Any, complaint: Any, *, reason: str = "", now: datetime | None = None) -> dict[str, Any]:
    db = ctx.get("db")
    Project = ctx.get("Project")
    load_app_settings = ctx.get("load_app_settings", lambda: {})
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    dt, deleted_at = _now_iso(now)
    settings = load_app_settings() if callable(load_app_settings) else {}
    purge_after = _compute_purge_after(dt, settings)
    uid, uname = _current_actor(ctx)

    project = db.session.get(Project, complaint.project_id) if Project is not None else None
    challenger = str(getattr(complaint, "challenger", "") or getattr(complaint, "company_name", "") or "")
    ctype = str(getattr(complaint, "complaint_type", "") or "质疑/投诉")
    submit_date = getattr(complaint, "submit_date", None)
    snapshot = {
        "complaint_type": ctype,
        "challenger": challenger,
        "status": str(getattr(complaint, "status", "") or ""),
        "submit_date": submit_date.isoformat() if hasattr(submit_date, "isoformat") else str(submit_date or ""),
        "project_id": int(complaint.project_id),
        "project_number": str(getattr(project, "number", "") or "") if project is not None else "",
        "project_name": str(getattr(project, "name", "") or "") if project is not None else "",
        "attachment_count": len(list(getattr(complaint, "attachments", None) or [])),
    }
    title = f"{ctype} · {challenger}" if challenger else f"{ctype} #{complaint.id}"
    recycle_id = _insert_recycle_row(
        db,
        entity_type="complaint",
        entity_id=complaint.id,
        project_id=complaint.project_id,
        display_title=title,
        snapshot=snapshot,
        deleted_by=uid,
        deleted_by_name=uname,
        delete_reason=reason,
        deleted_at=deleted_at,
        purge_after=purge_after,
    )
    db.session.commit()
    try:
        log_operation("complaint.soft_delete", "project", complaint.project_id, f"质疑投诉移入回收站：{title}")
    except Exception:
        pass
    return {
        "ok": True,
        "soft_deleted": True,
        "recycle_id": recycle_id,
        "purge_after": purge_after,
        "message": f"「{title}」已移入回收站",
    }


def soft_delete_clarification(
    ctx: Any,
    item: Any,
    *,
    fallback: Any = None,
    recalculate_fn: Any = None,
    reason: str = "",
    now: datetime | None = None,
) -> dict[str, Any]:
    db = ctx.get("db")
    Project = ctx.get("Project")
    load_app_settings = ctx.get("load_app_settings", lambda: {})
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    dt, deleted_at = _now_iso(now)
    settings = load_app_settings() if callable(load_app_settings) else {}
    purge_after = _compute_purge_after(dt, settings)
    uid, uname = _current_actor(ctx)

    project = getattr(item, "project", None) or (db.session.get(Project, item.project_id) if Project is not None else None)
    ctype = str(getattr(item, "clarification_type", "") or "澄清/更正")
    title_text = str(getattr(item, "title", "") or "")
    pub = getattr(item, "publish_date", None)
    orig = getattr(item, "original_deadline", None)
    new_dl = getattr(item, "new_deadline", None)
    snapshot = {
        "clarification_type": ctype,
        "title": title_text,
        "publish_date": pub.isoformat() if hasattr(pub, "isoformat") else str(pub or ""),
        "affects_deadline": bool(getattr(item, "affects_deadline", False)),
        "original_deadline": orig.isoformat() if hasattr(orig, "isoformat") else str(orig or ""),
        "new_deadline": new_dl.isoformat() if hasattr(new_dl, "isoformat") else str(new_dl or ""),
        "project_id": int(item.project_id),
        "project_number": str(getattr(project, "number", "") or "") if project is not None else "",
        "project_name": str(getattr(project, "name", "") or "") if project is not None else "",
        "attachment_count": len(list(getattr(item, "attachments", None) or [])),
    }
    title = f"{ctype} · {title_text}" if title_text else f"{ctype} #{item.id}"
    recycle_id = _insert_recycle_row(
        db,
        entity_type="clarification",
        entity_id=item.id,
        project_id=item.project_id,
        display_title=title,
        snapshot=snapshot,
        deleted_by=uid,
        deleted_by_name=uname,
        delete_reason=reason,
        deleted_at=deleted_at,
        purge_after=purge_after,
    )
    db.session.flush()
    if callable(recalculate_fn) and project is not None:
        recalculate_fn(project, fallback)
    db.session.commit()
    try:
        log_operation("clarification.soft_delete", "project", item.project_id, f"澄清更正移入回收站：{title}")
    except Exception:
        pass
    return {
        "ok": True,
        "soft_deleted": True,
        "recycle_id": recycle_id,
        "purge_after": purge_after,
        "message": f"「{title}」已移入回收站",
    }


def _parse_snapshot(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return dict(raw)
    try:
        parsed = json.loads(raw or "{}")
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _days_remaining(purge_after: str | None, now: datetime) -> int | None:
    if not purge_after:
        return None
    try:
        target = datetime.fromisoformat(purge_after)
    except ValueError:
        return None
    delta = target - now
    if delta.total_seconds() <= 0:
        return 0
    return int((delta.total_seconds() + 86399) // 86400)


def _actor_permissions(app: Any, db: Any, User: Any) -> tuple[bool, dict[str, bool]]:
    uid = session.get("user_id") if session else None
    if uid is None:
        return False, {}
    user = db.session.get(User, uid) if User is not None else None
    if user is None or not getattr(user, "is_active", False):
        return False, {}
    if getattr(user, "is_admin", False):
        return True, {
            "create_projects": True,
            "edit_projects": True,
            "delete_projects": True,
            "manage_attachments": True,
            "export_data": True,
        }
    try:
        try:
            import account_permissions
        except ModuleNotFoundError:
            from src.backend_patches import account_permissions
        policy = account_permissions.account_for(db, user)
        return False, dict(policy.get("permissions") or {})
    except Exception:
        return False, {}


def _can_manage_entity(entity_type: str, is_admin: bool, perms: dict[str, bool]) -> bool:
    if is_admin:
        return True
    if entity_type == "project":
        return bool(perms.get("delete_projects"))
    if entity_type == "attachment":
        return bool(perms.get("manage_attachments"))
    if entity_type in ("complaint", "clarification"):
        return bool(perms.get("edit_projects"))
    return False


def _serialize_row(row: Any, *, deleted_project_ids: set[int], now: datetime, is_admin: bool, perms: dict[str, bool]) -> dict[str, Any]:
    snap = _parse_snapshot(row["snapshot_json"])
    etype = str(row["entity_type"])
    pid = int(row["project_id"])
    can_manage = _can_manage_entity(etype, is_admin, perms)
    return {
        "id": int(row["id"]),
        "entity_type": etype,
        "entity_id": int(row["entity_id"]),
        "project_id": pid,
        "display_title": str(row["display_title"] or ""),
        "snapshot": snap,
        "deleted_by": row["deleted_by"],
        "deleted_by_name": str(row["deleted_by_name"] or ""),
        "delete_reason": str(row["delete_reason"] or ""),
        "deleted_at": str(row["deleted_at"] or ""),
        "purge_after": row["purge_after"],
        "days_remaining": _days_remaining(row["purge_after"], now),
        "status": str(row["status"] or "deleted"),
        "parent_project_deleted": (etype != "project") and (pid in deleted_project_ids),
        "can_restore": can_manage,
        "can_purge": is_admin or (etype == "project" and bool(perms.get("delete_projects"))) or (etype == "attachment" and bool(perms.get("manage_attachments"))),
    }


def close_out_hard_deleted_entities(
    db_or_session: Any,
    *,
    entity_type: str,
    entity_id: int,
    project_id: int | None = None,
    child_attachment_ids: Any = (),
    actor_uid: int | None = None,
    now_iso: str | None = None,
    exclude_recycle_id: int | None = None,
) -> None:
    """Close out recycle_bin_items for a hard-deleted entity and its cascade-deleted descendants in the same transaction."""
    sess = _session_from(db_or_session)
    if sess is None or not _has_table(sess):
        return
    _, default_ts = _now_iso()
    ts = now_iso or default_ts
    excl_sql = " AND id != :excl_id" if exclude_recycle_id is not None else ""
    base_params: dict[str, Any] = {"ts": ts, "uid": actor_uid}
    if exclude_recycle_id is not None:
        base_params["excl_id"] = int(exclude_recycle_id)

    eid = int(entity_id)
    if entity_type == "project":
        sess.execute(
            text(
                "UPDATE recycle_bin_items "
                "SET status='purged', purged_at=COALESCE(purged_at, :ts), purged_by=COALESCE(purged_by, :uid) "
                "WHERE status IN ('deleted', 'purging') "
                "AND (project_id=:pid OR (entity_type='project' AND entity_id=:pid))"
                f"{excl_sql}"
            ),
            {**base_params, "pid": eid},
        )
    elif entity_type in ("attachment", "complaint", "clarification"):
        sess.execute(
            text(
                "UPDATE recycle_bin_items "
                "SET status='purged', purged_at=COALESCE(purged_at, :ts), purged_by=COALESCE(purged_by, :uid) "
                "WHERE status IN ('deleted', 'purging') AND entity_type=:etype AND entity_id=:eid"
                f"{excl_sql}"
            ),
            {**base_params, "etype": entity_type, "eid": eid},
        )

    att_ids = sorted({int(aid) for aid in (child_attachment_ids or ()) if aid is not None})
    for aid in att_ids:
        sess.execute(
            text(
                "UPDATE recycle_bin_items "
                "SET status='purged', purged_at=COALESCE(purged_at, :ts), purged_by=COALESCE(purged_by, :uid) "
                "WHERE status IN ('deleted', 'purging') AND entity_type='attachment' AND entity_id=:aid"
                f"{excl_sql}"
            ),
            {**base_params, "aid": aid},
        )


def _entity_matches_recycle_snapshot(
    entity_type: str,
    entity: Any,
    *,
    entity_id: int,
    project_id: int,
    snapshot: dict[str, Any] | None = None,
    deleted_at: str = "",
    db: Any = None,
    recycle_id: int | None = None,
) -> bool:
    """Bind recycle rows to their exact deletion batch; conservatively skip legacy rows when ambiguous."""
    snap = snapshot if isinstance(snapshot, dict) else {}
    if entity_type == "project":
        number = str(getattr(entity, "number", "") or "")
        prefix = f"{_DELETED_NUMBER_PREFIX}{int(entity_id)}__"
        if not number.startswith(prefix):
            return False
        snap_tombstone = str(snap.get("tombstone_number") or "")
        if snap_tombstone:
            return number == snap_tombstone
        # Legacy row without tombstone_number: require exact original_number + exact deleted_at second stamp
        # + zero competing active project recycle entries; conservatively skip if any check is ambiguous.
        rest = number[len(prefix):]
        if "__" not in rest or "original_number" not in snap:
            return False
        stamp_part, _orig_part = rest.split("__", 1)
        orig_expected = str(snap.get("original_number") or "").strip()
        expected_number = f"{prefix}{stamp_part}__{orig_expected}"[:180]
        if number != expected_number:
            return False
        del_digits = re.sub(r"\D", "", str(deleted_at or ""))[:14]
        if len(del_digits) != 14 or len(stamp_part) < 14 or stamp_part[:14] != del_digits:
            return False
        sess = _session_from(db)
        if sess is not None and recycle_id is not None and _has_table(sess):
            other = sess.execute(
                text(
                    "SELECT 1 FROM recycle_bin_items "
                    "WHERE entity_type='project' AND entity_id=:eid AND id!=:rid "
                    "AND status IN ('deleted', 'purging') LIMIT 1"
                ),
                {"eid": int(entity_id), "rid": int(recycle_id)},
            ).first()
            if other is not None:
                return False
        return True
    if entity_type == "attachment":
        if int(getattr(entity, "project_id", -1) or -1) != int(project_id):
            return False
        snap_path = str(snap.get("file_path") or "")
        snap_name = str(snap.get("filename") or "")
        if not snap_path and not snap_name:
            return False
        if snap_path and str(getattr(entity, "file_path", "") or "") != snap_path:
            return False
        if snap_name and str(getattr(entity, "filename", "") or "") != snap_name:
            return False
        if not snap_path:
            sess = _session_from(db)
            if sess is not None and recycle_id is not None and _has_table(sess):
                other = sess.execute(
                    text(
                        "SELECT 1 FROM recycle_bin_items "
                        "WHERE entity_type='attachment' AND entity_id=:eid AND id!=:rid "
                        "AND status IN ('deleted', 'purging') LIMIT 1"
                    ),
                    {"eid": int(entity_id), "rid": int(recycle_id)},
                ).first()
                if other is not None:
                    return False
        return True
    if entity_type == "complaint":
        if int(getattr(entity, "project_id", -1) or -1) != int(project_id):
            return False
        snap_challenger = str(snap.get("challenger") or "")
        snap_ctype = str(snap.get("complaint_type") or "")
        if not snap_challenger and not snap_ctype:
            return False
        cur_challenger = str(getattr(entity, "challenger", "") or getattr(entity, "company_name", "") or "")
        if snap_challenger and cur_challenger != snap_challenger:
            return False
        if snap_ctype and str(getattr(entity, "complaint_type", "") or "") != snap_ctype:
            return False
        return True
    if entity_type == "clarification":
        if int(getattr(entity, "project_id", -1) or -1) != int(project_id):
            return False
        snap_title = str(snap.get("title") or "")
        snap_ctype = str(snap.get("clarification_type") or "")
        if not snap_title and not snap_ctype:
            return False
        if snap_title and str(getattr(entity, "title", "") or "") != snap_title:
            return False
        if snap_ctype and str(getattr(entity, "clarification_type", "") or "") != snap_ctype:
            return False
        return True
    return False


def _inspect_entity_for_recycle(
    ctx: Any,
    entity_type: str,
    entity_id: int,
    project_id: int,
    snapshot: dict[str, Any] | None = None,
    *,
    deleted_at: str = "",
    recycle_id: int | None = None,
) -> tuple[str, Any]:
    """Return ('missing', None) | ('mismatch', entity) | ('matched', entity) to distinguish absent vs ID-reused rows."""
    db = ctx.get("db")
    model_map = {
        "project": ctx.get("Project"),
        "attachment": ctx.get("Attachment"),
        "complaint": ctx.get("Complaint"),
        "clarification": ctx.get("AnnouncementClarification"),
    }
    model_cls = model_map.get(entity_type)
    if model_cls is None:
        return "missing", None
    entity = db.session.get(model_cls, entity_id)
    if entity is None:
        return "missing", None
    if not _entity_matches_recycle_snapshot(
        entity_type,
        entity,
        entity_id=entity_id,
        project_id=project_id,
        snapshot=snapshot,
        deleted_at=deleted_at,
        db=db,
        recycle_id=recycle_id,
    ):
        return "mismatch", entity
    return "matched", entity


def _hard_delete_entity(
    ctx: Any,
    entity_type: str,
    entity_id: int,
    project_id: int,
    *,
    snapshot: dict[str, Any] | None = None,
    deleted_at: str = "",
    recycle_id: int | None = None,
    actor_uid: int | None = None,
    now_iso: str | None = None,
    commit: bool = True,
    deferred_cleanups: list | None = None,
) -> str:
    """Physically delete the DB row; verify snapshot identity and return 'deleted' | 'missing' | 'mismatch'."""
    try:
        import project_crud_routes
    except ModuleNotFoundError:
        from src.backend_patches import project_crud_routes
    app = ctx.get("app")
    status, entity = _inspect_entity_for_recycle(
        ctx,
        entity_type,
        entity_id,
        project_id,
        snapshot=snapshot,
        deleted_at=deleted_at,
        recycle_id=recycle_id,
    )
    if status == "missing":
        return "missing"
    if status == "mismatch":
        if app is not None and getattr(app, "logger", None):
            app.logger.warning(
                f"跳过疑似主键复用的回收站清理: entity_type={entity_type}, recycle_id={recycle_id}, entity_id={entity_id}"
            )
        return "mismatch"
    extra_kw = {
        "commit": commit,
        "deferred_cleanups": deferred_cleanups,
        "exclude_recycle_id": recycle_id,
        "actor_uid": actor_uid,
        "now_iso": now_iso,
    }
    if entity_type == "project":
        project_crud_routes.hard_delete_project_record(ctx, entity, **extra_kw)
        return "deleted"
    if entity_type == "attachment":
        project_crud_routes.hard_delete_attachment_record(ctx, entity, **extra_kw)
        return "deleted"
    if entity_type == "complaint":
        project_crud_routes.hard_delete_complaint_record(ctx, entity, **extra_kw)
        return "deleted"
    if entity_type == "clarification":
        project_crud_routes.hard_delete_clarification_record(ctx, entity, **extra_kw)
        return "deleted"
    return "missing"


def _atomic_purge_item(
    runtime: Any,
    item_id: int,
    *,
    actor_uid: int | None = None,
    now_iso: str | None = None,
    require_expired_before: str | None = None,
) -> tuple[bool, str, dict[str, Any] | None]:
    """Claim, delete business entity, and mark purged in a single atomic DB transaction; delete files only after commit."""
    db = runtime.get("db")
    _, ts = _now_iso()
    ts = now_iso or ts
    cleanups: list = []
    try:
        claim_sql = "UPDATE recycle_bin_items SET status='purging' WHERE id=:id AND status='deleted'"
        claim_params: dict[str, Any] = {"id": int(item_id)}
        if require_expired_before is not None:
            claim_sql += " AND purge_after IS NOT NULL AND purge_after <= :exp"
            claim_params["exp"] = require_expired_before
        claimed = db.session.execute(text(claim_sql), claim_params)
        if getattr(claimed, "rowcount", 0) != 1:
            db.session.rollback()
            return False, "not_deleted", None

        row = db.session.execute(
            text(
                "SELECT id, entity_type, entity_id, project_id, display_title, snapshot_json, deleted_at "
                "FROM recycle_bin_items WHERE id=:id AND status='purging'"
            ),
            {"id": int(item_id)},
        ).mappings().first()
        if row is None:
            db.session.rollback()
            return False, "not_deleted", None

        etype = str(row["entity_type"])
        eid = int(row["entity_id"])
        pid = int(row["project_id"])
        snap = _parse_snapshot(row["snapshot_json"])
        outcome = _hard_delete_entity(
            runtime,
            etype,
            eid,
            pid,
            snapshot=snap,
            deleted_at=str(row["deleted_at"] or ""),
            recycle_id=int(item_id),
            actor_uid=actor_uid,
            now_iso=ts,
            commit=False,
            deferred_cleanups=cleanups,
        )

        db.session.execute(
            text(
                "UPDATE recycle_bin_items SET status='purged', purged_at=:ts, purged_by=:uid "
                "WHERE id=:id AND status='purging'"
            ),
            {"ts": ts, "uid": actor_uid, "id": int(item_id)},
        )
        # Only cascade-close child recycle items and project notifications when the recycled project
        # was legitimately deleted or is genuinely missing. If the ID now belongs to a different live
        # project ('mismatch'), forbid ALL side effects on that live project, its children, and notifications!
        if etype == "project" and outcome in ("deleted", "missing"):
            close_out_hard_deleted_entities(
                db,
                entity_type="project",
                entity_id=eid,
                project_id=eid,
                actor_uid=actor_uid,
                now_iso=ts,
                exclude_recycle_id=int(item_id),
            )
            try:
                if __package__:
                    from . import notification_channels
                else:
                    import notification_channels
                notification_channels.cleanup_deleted_project_notifications(db, eid)
            except Exception:
                pass
        db.session.commit()
    except Exception:
        db.session.rollback()
        raise

    for cleanup in cleanups:
        try:
            cleanup()
        except Exception:
            pass
    return True, "purged", dict(row)


def purge_expired_items(ctx: Any, *, now: datetime | None = None, force: bool = False) -> dict[str, Any]:
    """Physically purge recycle bin rows whose purge_after <= now, safely handling concurrent restores."""
    runtime = _normalize_ctx(ctx)
    db = runtime.get("db")
    if not _has_table(db):
        return {"purged": 0, "skipped": True}
    dt, now_iso = _now_iso(now)
    key = str(runtime.get("DB_PATH") or runtime.get("DATA_DIR") or id(db))
    if not force:
        last = _LAST_AUTO_PURGE_AT.get(key)
        if last is not None and (dt - last).total_seconds() < 3600:
            return {"purged": 0, "skipped": True}
    _LAST_AUTO_PURGE_AT[key] = dt

    rows = db.session.execute(
        text(
            "SELECT id FROM recycle_bin_items "
            "WHERE status='deleted' AND purge_after IS NOT NULL AND purge_after <= :now_iso "
            "ORDER BY CASE entity_type WHEN 'project' THEN 1 ELSE 0 END, id ASC"
        ),
        {"now_iso": now_iso},
    ).fetchall()
    purged = 0
    errors = 0
    for (rid,) in rows:
        try:
            ok, _reason, _meta = _atomic_purge_item(
                runtime,
                int(rid),
                actor_uid=None,
                now_iso=now_iso,
                require_expired_before=now_iso,
            )
            if ok:
                purged += 1
        except Exception:
            errors += 1
    return {"purged": purged, "errors": errors, "skipped": False}


def register(app: Any, db: Any, ctx: Any) -> bool:
    if app.extensions.get("recycle_bin"):
        return True
    runtime = _normalize_ctx(ctx)
    User = runtime.get("User")
    Project = runtime.get("Project")
    Attachment = runtime.get("Attachment")
    Complaint = runtime.get("Complaint")
    AnnouncementClarification = runtime.get("AnnouncementClarification")
    login_required = runtime.get("login_required") or (lambda f: f)
    load_app_settings = runtime.get("load_app_settings", lambda: {})
    log_operation = runtime.get("log_operation", lambda *a, **kw: None)

    app.extensions["recycle_bin"] = {
        "signature": RECYCLE_BIN_SIGNATURE,
        "db": db,
    }

    @app.before_request
    def _block_soft_deleted_resources():
        path = request.path or ""
        if not path.startswith("/api/") or path.startswith("/api/recycle-bin"):
            return None
        if not _has_table(db):
            return None
        m = _PROJECT_ROUTE_RE.match(path)
        if m:
            pid = int(m.group(1))
            if is_deleted(db, "project", pid):
                return jsonify({"error": "该项目已移入回收站，如需查看请先从回收站恢复", "code": "in_recycle_bin"}), 404
            cm = _COMPLAINT_ROUTE_RE.match(path)
            if cm and is_deleted(db, "complaint", int(cm.group(2))):
                return jsonify({"error": "该质疑/投诉记录已移入回收站", "code": "in_recycle_bin"}), 404
            clm = _CLARIFICATION_ROUTE_RE.match(path)
            if clm and is_deleted(db, "clarification", int(clm.group(2))):
                return jsonify({"error": "该澄清/更正记录已移入回收站", "code": "in_recycle_bin"}), 404
            return None
        am = _ATTACHMENT_ROUTE_RE.match(path)
        if am:
            aid = int(am.group(1))
            if is_deleted(db, "attachment", aid):
                return jsonify({"error": "该附件已移入回收站", "code": "in_recycle_bin"}), 404
            if Attachment is not None:
                att = db.session.get(Attachment, aid)
                if att is not None and not is_attachment_visible(db, att):
                    return jsonify({"error": "该附件所属记录已移入回收站", "code": "in_recycle_bin"}), 404
            return None
        cam = _COMPLAINT_ATT_ROUTE_RE.match(path)
        if cam:
            cid = int(cam.group(1))
            if is_deleted(db, "complaint", cid):
                return jsonify({"error": "该质疑/投诉记录已移入回收站", "code": "in_recycle_bin"}), 404
            if Complaint is not None:
                comp = db.session.get(Complaint, cid)
                if comp is not None and is_deleted(db, "project", comp.project_id):
                    return jsonify({"error": "所属项目已移入回收站", "code": "in_recycle_bin"}), 404
        return None

    @login_required
    def api_recycle_bin_summary():
        settings = load_app_settings() if callable(load_app_settings) else {}
        retention_days = retention_days_from_settings(settings)
        counts = {k: 0 for k in ("all", *VALID_ENTITY_TYPES)}
        if _has_table(db):
            rows = db.session.execute(
                text(
                    "SELECT entity_type, COUNT(*) AS c FROM recycle_bin_items "
                    "WHERE status='deleted' GROUP BY entity_type"
                )
            ).mappings().all()
            total = 0
            for row in rows:
                et = str(row["entity_type"])
                cnt = int(row["c"] or 0)
                if et in counts:
                    counts[et] = cnt
                total += cnt
            counts["all"] = total
        return jsonify({"count": counts["all"], "counts": counts, "retention_days": retention_days})

    @login_required
    def api_list_recycle_bin():
        settings = load_app_settings() if callable(load_app_settings) else {}
        retention_days = retention_days_from_settings(settings)
        is_admin, perms = _actor_permissions(app, db, User)
        etype = (request.args.get("type") or "all").strip().lower()
        q = (request.args.get("q") or "").strip().lower()
        try:
            page = max(1, int(request.args.get("page") or 1))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = min(200, max(1, int(request.args.get("page_size") or 50)))
        except (TypeError, ValueError):
            page_size = 50

        counts = {k: 0 for k in ("all", *VALID_ENTITY_TYPES)}
        if not _has_table(db):
            return jsonify({
                "items": [],
                "total": 0,
                "page": page,
                "page_size": page_size,
                "counts": counts,
                "retention_days": retention_days,
                "can_empty": is_admin,
            })

        count_rows = db.session.execute(
            text(
                "SELECT entity_type, COUNT(*) AS c FROM recycle_bin_items "
                "WHERE status='deleted' GROUP BY entity_type"
            )
        ).mappings().all()
        for row in count_rows:
            et = str(row["entity_type"])
            cnt = int(row["c"] or 0)
            if et in counts:
                counts[et] = cnt
            counts["all"] += cnt

        where = ["status='deleted'"]
        params: dict[str, Any] = {}
        if etype in VALID_ENTITY_TYPES:
            where.append("entity_type=:etype")
            params["etype"] = etype
        if q:
            where.append("(LOWER(display_title) LIKE :q OR LOWER(snapshot_json) LIKE :q OR LOWER(deleted_by_name) LIKE :q OR LOWER(delete_reason) LIKE :q)")
            params["q"] = f"%{q}%"

        where_sql = " AND ".join(where)
        total = int(db.session.execute(text(f"SELECT COUNT(*) FROM recycle_bin_items WHERE {where_sql}"), params).scalar() or 0)
        offset = (page - 1) * page_size
        params["limit"] = page_size
        params["offset"] = offset
        rows = db.session.execute(
            text(
                f"SELECT * FROM recycle_bin_items WHERE {where_sql} "
                "ORDER BY deleted_at DESC, id DESC LIMIT :limit OFFSET :offset"
            ),
            params,
        ).mappings().all()
        deleted_pids = deleted_ids(db, "project")
        now = datetime.now()
        items = [
            _serialize_row(row, deleted_project_ids=deleted_pids, now=now, is_admin=is_admin, perms=perms)
            for row in rows
        ]
        return jsonify({
            "items": items,
            "total": total,
            "page": page,
            "page_size": page_size,
            "counts": counts,
            "retention_days": retention_days,
            "can_empty": is_admin,
        })

    @login_required
    def api_restore_recycle_item(item_id: int):
        if not _has_table(db):
            return jsonify({"error": "回收站记录不存在"}), 404
        row = db.session.execute(
            text("SELECT * FROM recycle_bin_items WHERE id=:id AND status='deleted'"),
            {"id": int(item_id)},
        ).mappings().first()
        if row is None:
            return jsonify({"error": "回收站记录不存在或已处理"}), 404

        etype = str(row["entity_type"])
        eid = int(row["entity_id"])
        pid = int(row["project_id"])
        is_admin, perms = _actor_permissions(app, db, User)
        if not _can_manage_entity(etype, is_admin, perms):
            return jsonify({"error": "当前账号没有还原此记录的权限"}), 403

        snap = _parse_snapshot(row["snapshot_json"])
        uid, _ = _current_actor(runtime)
        _, now_iso = _now_iso()
        data = request.get_json(silent=True) or {}

        row_deleted_at = str(row["deleted_at"] or "")
        if etype == "project":
            entity_status, project = _inspect_entity_for_recycle(
                runtime, "project", eid, pid, snapshot=snap, deleted_at=row_deleted_at, recycle_id=int(item_id)
            )
            if entity_status == "missing":
                return jsonify({"error": "原项目数据已不存在，无法恢复", "code": "entity_missing"}), 404
            if entity_status == "mismatch":
                return jsonify({
                    "error": "原项目记录已不存在（当前主键已归属其他新项目），已拒绝恢复以避免覆盖现存项目",
                    "code": "entity_mismatch",
                }), 409
            original_number = str(snap.get("original_number") or "").strip()
            requested_number = str(data.get("new_number") or "").strip()
            target_number = requested_number or original_number
            if not target_number:
                return jsonify({"error": "项目编号不能为空"}), 400
            conflict = Project.query.filter(Project.number == target_number, Project.id != project.id).first()
            if conflict is not None:
                return jsonify({
                    "error": f"项目编号「{target_number}」已被现有项目占用，请指定新编号后再恢复",
                    "code": "number_conflict",
                    "original_number": original_number,
                }), 409
            project.number = target_number
            claimed = db.session.execute(
                text(
                    "UPDATE recycle_bin_items SET status='restored', restored_at=:ts, restored_by=:uid "
                    "WHERE id=:id AND status='deleted'"
                ),
                {"ts": now_iso, "uid": uid, "id": int(item_id)},
            )
            if getattr(claimed, "rowcount", 0) != 1:
                db.session.rollback()
                return jsonify({"error": "回收站记录不存在或已处理"}), 404
            try:
                db.session.commit()
            except (IntegrityError, sqlite3.IntegrityError):
                db.session.rollback()
                return jsonify({
                    "error": f"项目编号「{target_number}」已被现有项目占用，请指定新编号后再恢复",
                    "code": "number_conflict",
                    "original_number": original_number,
                }), 409
            try:
                log_operation("project.restore_recycle", "project", project.id, f"从回收站恢复项目：{target_number} · {project.name}")
            except Exception:
                pass
            return jsonify({
                "ok": True,
                "entity_type": "project",
                "entity_id": project.id,
                "project_id": project.id,
                "number": target_number,
                "message": f"项目「{project.name or target_number}」已恢复",
            })

        # Verify target entity identity before checking/modifying anything (prevents ID-reuse hijacking)
        entity_status, target = _inspect_entity_for_recycle(
            runtime, etype, eid, pid, snapshot=snap, deleted_at=row_deleted_at, recycle_id=int(item_id)
        )
        if entity_status == "missing":
            return jsonify({"error": "原数据已不存在，无法恢复", "code": "entity_missing"}), 404
        if entity_status == "mismatch":
            return jsonify({
                "error": "原记录已不存在（当前主键已归属其他新记录），已拒绝恢复以避免影响现存数据",
                "code": "entity_mismatch",
            }), 409

        # Child resources require parent project to be active
        parent = db.session.get(Project, pid)
        if parent is None or (
            is_deleted(db, "project", pid)
            and str(getattr(parent, "number", "") or "").startswith(f"{_DELETED_NUMBER_PREFIX}{pid}__")
        ):
            return jsonify({
                "error": "所属项目仍在回收站中，请先恢复所属项目",
                "code": "parent_deleted",
                "project_id": pid,
            }), 409

        claimed = db.session.execute(
            text(
                "UPDATE recycle_bin_items SET status='restored', restored_at=:ts, restored_by=:uid "
                "WHERE id=:id AND status='deleted'"
            ),
            {"ts": now_iso, "uid": uid, "id": int(item_id)},
        )
        if getattr(claimed, "rowcount", 0) != 1:
            db.session.rollback()
            return jsonify({"error": "回收站记录不存在或已处理"}), 404
        if etype == "clarification":
            try:
                import project_crud_routes
            except ModuleNotFoundError:
                from src.backend_patches import project_crud_routes
            db.session.flush()
            project_crud_routes.recalculate_clarification_deadline(runtime, parent)
        db.session.commit()
        try:
            log_operation(f"{etype}.restore_recycle", "project", pid, f"从回收站恢复：{row['display_title']}")
        except Exception:
            pass
        return jsonify({
            "ok": True,
            "entity_type": etype,
            "entity_id": eid,
            "project_id": pid,
            "message": f"「{row['display_title']}」已恢复",
        })

    @login_required
    def api_purge_recycle_item(item_id: int):
        if not _has_table(db):
            return jsonify({"error": "回收站记录不存在"}), 404
        row = db.session.execute(
            text("SELECT * FROM recycle_bin_items WHERE id=:id AND status='deleted'"),
            {"id": int(item_id)},
        ).mappings().first()
        if row is None:
            return jsonify({"error": "回收站记录不存在或已处理"}), 404

        etype = str(row["entity_type"])
        pid = int(row["project_id"])
        if not can_permanent_delete(runtime, etype):
            return jsonify({"error": "当前账号没有彻底删除此记录的权限"}), 403

        uid, _ = _current_actor(runtime)
        _, now_iso = _now_iso()
        ok, _reason, purged_meta = _atomic_purge_item(
            runtime,
            int(item_id),
            actor_uid=uid,
            now_iso=now_iso,
        )
        if not ok:
            return jsonify({"error": "回收站记录不存在或已处理"}), 404
        title = str((purged_meta or row)["display_title"] or "")
        try:
            log_operation(f"{etype}.purge", "project", pid, f"彻底删除：{title}")
        except Exception:
            pass
        return jsonify({"ok": True, "message": f"「{title}」已彻底删除"})

    @login_required
    def api_purge_expired_recycle_bin():
        is_admin, _ = _actor_permissions(app, db, User)
        if not is_admin:
            return jsonify({"error": "仅管理员可执行到期清理"}), 403
        result = purge_expired_items(runtime, force=True)
        return jsonify({"ok": True, **result})

    @login_required
    def api_empty_recycle_bin():
        is_admin, _ = _actor_permissions(app, db, User)
        if not is_admin:
            return jsonify({"error": "仅管理员可清空回收站"}), 403
        if not _has_table(db):
            return jsonify({"ok": True, "purged": 0})
        uid, _ = _current_actor(runtime)
        _, now_iso = _now_iso()
        rows = db.session.execute(
            text(
                "SELECT id FROM recycle_bin_items "
                "WHERE status='deleted' "
                "ORDER BY CASE entity_type WHEN 'project' THEN 1 ELSE 0 END, id ASC"
            )
        ).fetchall()
        purged = 0
        for (rid,) in rows:
            try:
                ok, _reason, _meta = _atomic_purge_item(
                    runtime,
                    int(rid),
                    actor_uid=uid,
                    now_iso=now_iso,
                )
                if ok:
                    purged += 1
            except Exception:
                pass
        try:
            log_operation("recycle_bin.empty", "system", 0, f"清空回收站：彻底删除 {purged} 条记录")
        except Exception:
            pass
        return jsonify({"ok": True, "purged": purged, "message": f"已彻底清理 {purged} 条回收站记录"})

    app.add_url_rule("/api/recycle-bin/summary", "api_recycle_bin_summary", api_recycle_bin_summary, methods=["GET"])
    app.add_url_rule("/api/recycle-bin", "api_list_recycle_bin", api_list_recycle_bin, methods=["GET"])
    app.add_url_rule("/api/recycle-bin/<int:item_id>/restore", "api_restore_recycle_item", api_restore_recycle_item, methods=["POST"])
    app.add_url_rule("/api/recycle-bin/<int:item_id>", "api_purge_recycle_item", api_purge_recycle_item, methods=["DELETE"])
    app.add_url_rule("/api/recycle-bin/purge-expired", "api_purge_expired_recycle_bin", api_purge_expired_recycle_bin, methods=["POST"])
    app.add_url_rule("/api/recycle-bin/empty", "api_empty_recycle_bin", api_empty_recycle_bin, methods=["POST"])
    return True
