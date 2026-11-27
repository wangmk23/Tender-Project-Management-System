"""Scalable project listing, cold-archive year windowing, pagination, and SQLite indexes.

project-listing-v1
"""
from __future__ import annotations

from datetime import date, datetime, timedelta
import re
from typing import Any

from flask import jsonify, request
from sqlalchemy import bindparam, text


PROJECT_LISTING_SIGNATURE = "project-listing-v1"
DEFAULT_ACTIVE_YEARS_WINDOW = 2
_NATURAL_NUM_RE = re.compile(r"(\d+)")


class _DescKey:
    __slots__ = ("value",)

    def __init__(self, value: Any):
        self.value = value

    def __lt__(self, other: "_DescKey") -> bool:
        return other.value < self.value

    def __eq__(self, other: object) -> bool:
        return isinstance(other, _DescKey) and self.value == other.value


def normalize_sort_key(value: Any) -> str:
    raw = str(value or "").strip().lower()
    mapping = {
        "active_first": "active_first",
        "number_asc": "number_asc",
        "asc": "number_asc",
        "number_desc": "number_desc",
        "desc": "number_desc",
        "progress_asc": "progress_asc",
        "progress_desc": "progress_desc",
        "next_plan": "next_plan",
    }
    return mapping.get(raw, "")


def natural_number_key(value: Any) -> tuple:
    text_val = str(value or "").strip()
    parts = _NATURAL_NUM_RE.split(text_val.lower())
    return tuple((0, int(p), len(p)) if p.isdigit() else (1, p, 0) for p in parts if p != "")


def project_sort_tuple(
    sort_key: str,
    *,
    pid: int,
    number: Any,
    year: Any = "",
    is_terminated: bool = False,
    progress: float = 0.0,
    next_plan: str = "",
) -> tuple:
    num_str = str(number or "").strip()
    has_digit = any(ch.isdigit() for ch in num_str)
    nat = natural_number_key(num_str)
    plan = str(next_plan or "").strip()
    if sort_key == "active_first":
        rank = 2 if is_terminated else (1 if float(progress or 0) >= 100 else 0)
        if rank == 0:
            return (0, 0 if plan else 1, plan, _DescKey(nat), int(pid))
        return (rank, 0, "", _DescKey(nat), int(pid))
    if sort_key == "next_plan":
        return (0 if plan else 1, plan, nat, int(pid))
    if sort_key == "progress_asc":
        return (float(progress or 0), nat, int(pid))
    if sort_key == "progress_desc":
        return (-float(progress or 0), nat, int(pid))
    if sort_key == "number_desc":
        return (0 if has_digit else 1, _DescKey(nat) if has_digit else nat, int(pid))
    if sort_key == "number_asc":
        return (0 if has_digit else 1, nat, int(pid))
    return (_DescKey(str(year or "")), str(number or ""), int(pid))


def _project_next_plan_str(project: Any) -> str:
    plans = []
    for st in getattr(project, "stages", ()) or ():
        if getattr(st, "completed", False) or getattr(st, "skipped", False) or getattr(st, "template_removed", False):
            continue
        dt = getattr(st, "planned_datetime", None)
        if dt is None:
            continue
        plans.append(dt.isoformat() if hasattr(dt, "isoformat") else str(dt).replace(" ", "T"))
    return min(plans) if plans else ""


def paginate_project_ids_sorted(
    session: Any,
    sql_text: Any,
    rows: list[tuple[int, Any, Any, Any, Any]],
    *,
    sort_key: str,
    status_param: str,
    scope_id_set: set[int] | None,
    page: int,
    page_size: int,
    today: date,
) -> tuple[list[int], int]:
    """Filter and stably sort lightweight project tuples across all pages before hydrating a single page."""
    normalized_sort = normalize_sort_key(sort_key)
    status_norm = str(status_param or "").strip().lower()
    need_stage_stats = (
        normalized_sort in ("active_first", "progress_asc", "progress_desc", "next_plan")
        or status_norm in ("active", "done", "overdue", "soon")
    )

    stage_stats: dict[int, tuple[int, str, int, int]] = {}
    if need_stage_stats and rows and callable(getattr(session, "execute", None)):
        try:
            import schema_models
        except ModuleNotFoundError:
            from src.backend_patches import schema_models
        cols = schema_models.table_columns(session, "stages", sql_text)
        rem_cond = "COALESCE(s.template_removed, 0) = 0" if "template_removed" in cols else "1=1"
        today_str = today.isoformat()
        soon_end_str = (today + timedelta(days=7)).isoformat()
        stat_rows = session.execute(
            sql_text(
                "SELECT s.project_id, "
                f"SUM(CASE WHEN {rem_cond} THEN 1 ELSE 0 END) AS active_cnt, "
                f"SUM(CASE WHEN {rem_cond} AND (COALESCE(s.completed, 0) = 1 OR COALESCE(s.skipped, 0) = 1) THEN 1 ELSE 0 END) AS done_cnt, "
                f"MIN(CASE WHEN {rem_cond} AND COALESCE(s.completed, 0) = 0 AND COALESCE(s.skipped, 0) = 0 "
                "AND s.planned_datetime IS NOT NULL THEN REPLACE(s.planned_datetime, ' ', 'T') END) AS next_plan, "
                f"SUM(CASE WHEN {rem_cond} AND COALESCE(s.completed, 0) = 0 AND COALESCE(s.skipped, 0) = 0 "
                "AND s.planned_datetime IS NOT NULL AND substr(s.planned_datetime, 1, 10) < :today THEN 1 ELSE 0 END) AS overdue_cnt, "
                f"SUM(CASE WHEN {rem_cond} AND COALESCE(s.completed, 0) = 0 AND COALESCE(s.skipped, 0) = 0 "
                "AND s.planned_datetime IS NOT NULL AND substr(s.planned_datetime, 1, 10) >= :today "
                "AND substr(s.planned_datetime, 1, 10) <= :soon_end THEN 1 ELSE 0 END) AS soon_cnt "
                "FROM stages s GROUP BY s.project_id"
            ),
            {"today": today_str, "soon_end": soon_end_str},
        ).fetchall()
        for r in stat_rows:
            pid = int(r[0])
            active_cnt = int(r[1] or 0)
            done_cnt = int(r[2] or 0)
            prog = round(100 * done_cnt / active_cnt) if active_cnt > 0 else 0
            stage_stats[pid] = (prog, str(r[3] or ""), int(r[4] or 0), int(r[5] or 0))

    candidates: list[tuple[int, Any, Any, bool, int, str]] = []
    for row in rows:
        pid = int(row[0])
        if scope_id_set is not None and pid not in scope_id_set:
            continue
        number = row[1]
        year = row[2]
        is_term = bool(row[3])
        term_type = str(row[4] or "")
        prog, next_plan, overdue_cnt, soon_cnt = stage_stats.get(pid, (0, "", 0, 0))
        if status_norm and status_norm != "all":
            if status_norm == "terminated" and not is_term:
                continue
            elif status_norm == "liubiao" and not (is_term and term_type == "liubiao"):
                continue
            elif status_norm == "feibiao" and not (is_term and term_type == "feibiao"):
                continue
            elif status_norm == "active" and (is_term or prog >= 100):
                continue
            elif status_norm == "done" and (is_term or prog < 100):
                continue
            elif status_norm == "overdue" and (is_term or prog >= 100 or overdue_cnt <= 0):
                continue
            elif status_norm == "soon" and (is_term or prog >= 100 or soon_cnt <= 0):
                continue
        candidates.append((pid, number, year, is_term, prog, next_plan))

    candidates.sort(
        key=lambda item: project_sort_tuple(
            normalized_sort,
            pid=item[0],
            number=item[1],
            year=item[2],
            is_terminated=item[3],
            progress=item[4],
            next_plan=item[5],
        )
    )
    total = len(candidates)
    start = (page - 1) * page_size
    page_ids = [item[0] for item in candidates[start:start + page_size]]
    return page_ids, total

_PERF_INDEX_SQL = (
    "CREATE INDEX IF NOT EXISTS ix_projects_year_number ON projects (year, number)",
    "CREATE INDEX IF NOT EXISTS ix_stages_project_plan ON stages (project_id, completed, skipped, planned_datetime)",
    "CREATE INDEX IF NOT EXISTS ix_lots_project_id ON project_lots (project_id)",
    "CREATE INDEX IF NOT EXISTS ix_regs_project_id ON supplier_registrations (project_id)",
)


def ensure_performance_indexes(db: Any) -> None:
    """Create additive-only read indexes once on startup; never blocks read paths."""
    if db is None or not hasattr(db, "session"):
        return
    try:
        tables = {
            str(r[0])
            for r in db.session.execute(
                text("SELECT name FROM sqlite_master WHERE type='table'")
            ).fetchall()
        }
        if not {"projects", "stages", "project_lots", "supplier_registrations"} <= tables:
            return
        existing = {
            str(r[0])
            for r in db.session.execute(
                text("SELECT name FROM sqlite_master WHERE type='index'")
            ).fetchall()
        }
        created = False
        for stmt in _PERF_INDEX_SQL:
            idx_name = stmt.split("IF NOT EXISTS ", 1)[1].split(" ON ", 1)[0].strip()
            if idx_name not in existing:
                db.session.execute(text(stmt))
                created = True
        if created:
            db.session.commit()
    except Exception:
        try:
            db.session.rollback()
        except Exception:
            pass


def normalize_active_years_window(value: Any, default: int = DEFAULT_ACTIVE_YEARS_WINDOW) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return default
    try:
        n = int(value)
    except (TypeError, ValueError):
        return default
    return max(0, min(10, n))


def resolve_cold_archive_window(settings: Any, today: date | None = None) -> tuple[int, int | None]:
    """Return (active_years_window, cutoff_year). cutoff_year=None means cold archive disabled."""
    raw = settings.get("cold_archive_active_years") if isinstance(settings, dict) else None
    window = normalize_active_years_window(raw, DEFAULT_ACTIVE_YEARS_WINDOW)
    if window <= 0:
        return 0, None
    current_year = (today or date.today()).year
    cutoff_year = current_year - (window - 1)
    return window, cutoff_year


def _parse_year_int(value: Any) -> int | None:
    if value is None:
        return None
    s = str(value).strip()
    if len(s) == 4 and s.isdigit():
        return int(s)
    return None


def _effective_project_progress(project: Any) -> float:
    stages = list(getattr(project, "stages", ()) or ())
    active = [s for s in stages if not getattr(s, "template_removed", False)]
    if active:
        done = sum(1 for s in active if bool(getattr(s, "completed", False) or getattr(s, "skipped", False)))
        return float(round(100 * done / len(active)))
    try:
        return float(getattr(project, "progress", 0) or 0)
    except (TypeError, ValueError):
        return 0.0


def is_project_cold_archived(project: Any, cutoff_year: int | None) -> bool:
    """In-progress projects are NEVER cold-archived regardless of year."""
    if cutoff_year is None:
        return False
    y = _parse_year_int(getattr(project, "year", None))
    if y is None or y >= cutoff_year:
        return False
    if bool(getattr(project, "is_terminated", False)):
        return True
    return _effective_project_progress(project) >= 100


def _deleted_project_ids(db: Any) -> set[int]:
    try:
        try:
            from . import recycle_bin
        except ImportError:
            import recycle_bin
        return recycle_bin.deleted_ids(db, "project")
    except Exception:
        return set()


def compute_years_summary(db: Any, settings: Any, today: date | None = None) -> dict[str, Any]:
    """Single-pass SQL aggregation for year counts and hot/cold archive split."""
    window, cutoff_year = resolve_cold_archive_window(settings, today=today)
    deleted_pids = _deleted_project_ids(db)

    # Compute per-project completion using SQL aggregate over active (non-removed) stages
    try:
        import schema_models
    except ModuleNotFoundError:
        from src.backend_patches import schema_models
    cols = schema_models.table_columns(db.session, "stages", text)
    removed_cond = "COALESCE(s.template_removed, 0) = 0" if "template_removed" in cols else "1=1"
    rows = db.session.execute(
        text(
            "SELECT p.id, p.year, COALESCE(p.is_terminated, 0) AS is_terminated, "
            f"SUM(CASE WHEN {removed_cond} THEN 1 ELSE 0 END) AS active_stages, "
            f"SUM(CASE WHEN {removed_cond} AND (COALESCE(s.completed, 0) = 1 OR COALESCE(s.skipped, 0) = 1) THEN 1 ELSE 0 END) AS done_stages "
            "FROM projects p "
            "LEFT JOIN stages s ON s.project_id = p.id "
            "GROUP BY p.id, p.year, p.is_terminated"
        )
    ).fetchall()

    by_year: dict[str, dict[str, Any]] = {}
    total_count = 0
    active_scope_count = 0
    cold_archived_count = 0

    for row in rows:
        pid = int(row[0])
        if pid in deleted_pids:
            continue
        year_str = str(row[1] or "").strip() or "未设置"
        is_term = bool(row[2])
        active_st = int(row[3] or 0)
        done_st = int(row[4] or 0)
        is_completed = (not is_term) and (active_st > 0 and done_st >= active_st)
        is_in_progress = (not is_term) and (not is_completed)

        year_int = _parse_year_int(year_str)
        is_cold_row = (
            cutoff_year is not None
            and year_int is not None
            and year_int < cutoff_year
            and (is_term or is_completed)
        )

        total_count += 1
        if is_cold_row:
            cold_archived_count += 1
        else:
            active_scope_count += 1

        bucket = by_year.setdefault(
            year_str,
            {
                "year": year_str,
                "total": 0,
                "in_progress": 0,
                "completed": 0,
                "terminated": 0,
                "cold_count": 0,
                "is_cold_year": (
                    cutoff_year is not None and year_int is not None and year_int < cutoff_year
                ),
            },
        )
        bucket["total"] += 1
        if is_term:
            bucket["terminated"] += 1
        elif is_completed:
            bucket["completed"] += 1
        else:
            bucket["in_progress"] += 1
        if is_cold_row:
            bucket["cold_count"] += 1

    years_sorted = sorted(
        by_year.values(),
        key=lambda item: (
            0 if _parse_year_int(item["year"]) is not None else 1,
            -(_parse_year_int(item["year"]) or 0),
            item["year"],
        ),
    )

    return {
        "active_years_window": window,
        "cutoff_year": cutoff_year,
        "total_count": total_count,
        "active_scope_count": active_scope_count,
        "cold_archived_count": cold_archived_count,
        "years": years_sorted,
    }


def filter_and_paginate_projects(
    projects: list[Any],
    args: Any,
    settings: Any,
    *,
    today: date | None = None,
) -> tuple[list[Any], dict[str, Any]]:
    """Apply year/cold-archive, search query, status, method, and pagination before heavy serialization."""
    today = today or date.today()
    window, cutoff_year = resolve_cold_archive_window(settings, today=today)

    year_param = str(args.get("year") or "").strip().lower() if args else ""
    q = str(args.get("q") or "").strip().lower() if args else ""
    status_filter = str(args.get("status") or "").strip().lower() if args else ""
    method_filter = str(args.get("method") or "").strip() if args else ""
    paginated = str(args.get("paginated") or "").strip().lower() in ("1", "true", "yes") if args else False

    filtered = list(projects)

    # Year / cold-archive scope
    if year_param == "active":
        filtered = [p for p in filtered if not is_project_cold_archived(p, cutoff_year)]
    elif year_param == "archived":
        filtered = [p for p in filtered if is_project_cold_archived(p, cutoff_year)]
    elif year_param and year_param != "all":
        filtered = [p for p in filtered if str(getattr(p, "year", "") or "").strip() == year_param]

    # Method filter
    if method_filter:
        filtered = [p for p in filtered if str(getattr(p, "method", "") or "").strip() == method_filter]

    # Status filter
    if status_filter and status_filter != "all":
        def _matches_status(p: Any) -> bool:
            is_term = bool(getattr(p, "is_terminated", False))
            term_type = str(getattr(p, "terminated_type", "") or "")
            prog = _effective_project_progress(p)
            if status_filter == "active":
                return (not is_term) and prog < 100
            if status_filter == "done":
                return (not is_term) and prog >= 100
            if status_filter == "terminated":
                return is_term
            if status_filter == "liubiao":
                return is_term and term_type == "liubiao"
            if status_filter == "feibiao":
                return is_term and term_type == "feibiao"
            if status_filter in ("overdue", "soon"):
                if is_term or prog >= 100:
                    return False
                for st in getattr(p, "stages", ()) or ():
                    if getattr(st, "completed", False) or getattr(st, "skipped", False) or getattr(st, "template_removed", False):
                        continue
                    dt = getattr(st, "planned_datetime", None)
                    if dt is None:
                        continue
                    d = dt.date() if isinstance(dt, datetime) else dt
                    diff = (d - today).days
                    if status_filter == "overdue" and diff < 0:
                        return True
                    if status_filter == "soon" and 0 <= diff <= 7:
                        return True
                return False
            return True

        filtered = [p for p in filtered if _matches_status(p)]

    # Keyword query filter
    if q:
        def _matches_q(p: Any) -> bool:
            haystack = " ".join(
                str(getattr(p, f, "") or "")
                for f in ("number", "name", "purchaser", "method", "prepare_owner", "review_owner", "year")
            ).lower()
            return q in haystack

        filtered = [p for p in filtered if _matches_q(p)]

    sort_key = normalize_sort_key(args.get("sort") if args else "")
    if sort_key:
        filtered.sort(
            key=lambda p: project_sort_tuple(
                sort_key,
                pid=int(getattr(p, "id", 0) or 0),
                number=getattr(p, "number", ""),
                year=getattr(p, "year", ""),
                is_terminated=bool(getattr(p, "is_terminated", False)),
                progress=float(getattr(p, "progress", 0) or 0),
                next_plan=_project_next_plan_str(p) if sort_key in ("active_first", "next_plan") else "",
            )
        )

    total = len(filtered)
    page = 1
    page_size = total or 100
    if paginated:
        try:
            page = max(1, int(args.get("page") or 1))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = min(500, max(1, int(args.get("page_size") or 100)))
        except (TypeError, ValueError):
            page_size = 100
        start = (page - 1) * page_size
        page_items = filtered[start:start + page_size]
    else:
        page_items = filtered

    meta = {
        "paginated": paginated,
        "total": total,
        "page": page,
        "page_size": page_size,
        "has_more": (page * page_size) < total if paginated else False,
        "year_scope": year_param or "all",
        "sort": sort_key or "default",
        "active_years_window": window,
        "cutoff_year": cutoff_year,
    }
    return page_items, meta


def _parse_iso_deadline(value: Any) -> tuple[date | None, datetime | None]:
    raw = str(value or "").strip()
    if not raw or len(raw) < 10:
        return None, None
    try:
        d = date.fromisoformat(raw[:10])
    except ValueError:
        return None, None
    if len(raw) <= 10:
        return d, datetime(d.year, d.month, d.day, 23, 59, 59, 999000)
    try:
        dt = datetime.fromisoformat(raw.replace(" ", "T")[:19])
        return d, dt
    except ValueError:
        return d, None


def project_challenge_states(db: Any, project_ids, *, tables=None) -> dict[int, str]:
    """Return the highest active complaint state per project, excluding recycled records."""
    ids = set(project_ids)
    if not ids:
        return {}
    if tables is None:
        tables = set(db.session.execute(text(
            "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('complaints', 'recycle_bin_items')"
        )).scalars())
    if "complaints" not in tables:
        return {}
    sql = """
        SELECT c.project_id, MAX(CASE
            WHEN c.complaint_type='投诉' OR c.status='已转投诉' THEN 2
            WHEN c.complaint_type='质疑' THEN 1 ELSE 0 END)
        FROM complaints c
        WHERE COALESCE(c.status, '') NOT IN
            ('已解决', '已办结', '已完结', '已结案', '已撤销', 'closed', 'resolved', '已处理')
    """
    if "recycle_bin_items" in tables:
        sql += """ AND NOT EXISTS (
            SELECT 1 FROM recycle_bin_items r WHERE r.entity_type='complaint'
            AND r.entity_id=c.id AND r.project_id=c.project_id AND r.status IN ('deleted','purging')
        )"""
    # Normal pages contain at most 500 IDs. Avoid SQLite's bind limit for a full overview.
    if len(ids) <= 500:
        sql += " AND c.project_id IN :ids"
    query = text(sql + " GROUP BY c.project_id")
    if len(ids) <= 500:
        query = query.bindparams(bindparam("ids", expanding=True, value=sorted(ids)))
    return {pid: ("投诉中" if rank == 2 else "质疑中") for pid, rank in db.session.execute(query)
            if rank and pid in ids}


def compute_dashboard_summary(
    db: Any,
    settings: Any,
    *,
    ctx: Any = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Pure-SQL compact aggregation for the default Command Center dashboard (<100ms, <50KB on 3000 projects)."""
    import json as _json
    current = now or datetime.now()
    today = current.date()
    deleted_pids = _deleted_project_ids(db)

    try:
        import schema_models
    except ModuleNotFoundError:
        from src.backend_patches import schema_models
    stage_cols = schema_models.table_columns(db.session, "stages", text)
    tables = {
        str(r[0])
        for r in db.session.execute(text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    }

    # Build stage definition lookups from ctx.STAGES & stage_templates
    legacy_stages = (ctx.get("STAGES", []) if hasattr(ctx, "get") else []) or []
    stage_name_by_key = {str(s.get("key") or ""): str(s.get("name") or s.get("key") or "") for s in legacy_stages if isinstance(s, dict)}
    opening_stage_by_method: dict[str, str] = {}
    if isinstance(settings, dict) and isinstance(settings.get("stage_templates"), dict):
        for mname, rows in settings["stage_templates"].items():
            if not isinstance(rows, list):
                continue
            for st in rows:
                if isinstance(st, dict) and "bid_opening" in (st.get("modules") or ()):
                    opening_stage_by_method[str(mname)] = str(st.get("id") or st.get("key") or "")
                    break

    # 1. Projects scalar query
    p_cols = schema_models.table_columns(db.session, "projects", text)
    prep_col = "COALESCE(prepare_owner, '')" if "prepare_owner" in p_cols else "''"
    rev_col = "COALESCE(review_owner, '')" if "review_owner" in p_cols else "''"
    term_type_col = "COALESCE(terminated_type, '')" if "terminated_type" in p_cols else "''"
    proj_rows = db.session.execute(
        text(
            "SELECT id, COALESCE(number, ''), COALESCE(name, ''), COALESCE(purchaser, ''), "
            "COALESCE(method, ''), COALESCE(year, ''), COALESCE(is_terminated, 0), "
            f"{term_type_col}, {prep_col}, {rev_col} FROM projects"
        )
    ).fetchall()
    projects_by_id: dict[int, dict[str, Any]] = {}
    for r in proj_rows:
        pid = int(r[0])
        if pid in deleted_pids:
            continue
        projects_by_id[pid] = {
            "id": pid,
            "number": str(r[1] or ""),
            "name": str(r[2] or ""),
            "purchaser": str(r[3] or ""),
            "method": str(r[4] or ""),
            "year": str(r[5] or ""),
            "is_terminated": bool(r[6]),
            "terminated_type": str(r[7] or ""),
            "prepare_owner": str(r[8] or ""),
            "review_owner": str(r[9] or ""),
            "challenge_state": "",
            "method_label": str(r[4] or "") or "未设置",
        }

    # Optional custom procurement snapshot labels
    if "project_procurement_snapshots" in tables and projects_by_id:
        try:
            snap_rows = db.session.execute(
                text("SELECT project_id, snapshot_json FROM project_procurement_snapshots")
            ).fetchall()
            for r in snap_rows:
                pid = int(r[0])
                proj = projects_by_id.get(pid)
                if proj is None or not r[1]:
                    continue
                try:
                    snap = _json.loads(r[1])
                except Exception:
                    continue
                if isinstance(snap, dict):
                    mname = str(snap.get("method_name") or "").strip()
                    if mname:
                        proj["method_label"] = mname
                        proj["procurement"] = {
                            "method_id": snap.get("method_id") or "",
                            "method_name": mname,
                            "builtin_kind": snap.get("builtin_kind") or proj["method"],
                        }
        except Exception:
            pass

    for pid, state in project_challenge_states(db, projects_by_id, tables=tables).items():
        projects_by_id[pid]["challenge_state"] = state

    # 3. Single-pass non-removed stages query
    rem_where = "WHERE COALESCE(template_removed, 0) = 0" if "template_removed" in stage_cols else ""
    sname_expr = "COALESCE(stage_name, '')" if "stage_name" in stage_cols else "''"
    mod_expr = "COALESCE(modules_json, '')" if "modules_json" in stage_cols else "''"
    pos_expr = "COALESCE(stage_position, id)" if "stage_position" in stage_cols else "id"
    resp_expr = "COALESCE(responsible_person, '')" if "responsible_person" in stage_cols else "''"
    stage_rows = db.session.execute(
        text(
            f"SELECT project_id, stage_key, {sname_expr}, {mod_expr}, "
            f"COALESCE(completed, 0), COALESCE(skipped, 0), planned_datetime, {resp_expr}, {pos_expr}, id "
            f"FROM stages {rem_where} ORDER BY project_id ASC, {pos_expr} ASC, id ASC"
        )
    ).fetchall()

    stage_acc: dict[int, list[Any]] = {}
    # [active_cnt, done_cnt, first_pending_key, first_pending_name, has_unopened_bid, pending_planned_rows]
    for r in stage_rows:
        pid = int(r[0])
        proj = projects_by_id.get(pid)
        if proj is None:
            continue
        acc = stage_acc.get(pid)
        if acc is None:
            acc = [0, 0, "", "", False, []]
            stage_acc[pid] = acc
        skey = str(r[1] or "")
        sname = str(r[2] or "") or stage_name_by_key.get(skey, skey)
        mod_raw = str(r[3] or "")
        is_done = bool(r[4]) or bool(r[5])
        acc[0] += 1
        if is_done:
            acc[1] += 1
            continue
        if not acc[2]:
            acc[2] = skey
            acc[3] = sname
        # Check unopened bid_opening stage
        if not acc[4]:
            opening_id = opening_stage_by_method.get(proj["method"], "")
            if (opening_id and skey == opening_id) or skey == "bid_opening" or ('"bid_opening"' in mod_raw):
                acc[4] = True
        if r[6]:
            acc[5].append((skey, sname, str(r[6]), str(r[7] or "")))

    total_all = len(projects_by_id)
    non_term_total = 0
    active_count = 0
    completed_count = 0
    unopened_count = 0
    liubiao_count = 0
    feibiao_count = 0
    methods_counts: dict[str, int] = {}
    active_method_counts: dict[str, int] = {}
    stage_counts: dict[str, int] = {}
    actions_all: list[dict[str, Any]] = []
    key_nodes_all: list[dict[str, Any]] = []
    overdue_project_ids: set[int] = set()
    active_preview_by_method: dict[str, list[dict[str, Any]]] = {}
    urgency_order = {"overdue": 0, "today": 1, "soon": 2, "later": 3}

    for proj in sorted(projects_by_id.values(), key=lambda p: (p["number"], p["id"])):
        pid = proj["id"]
        mlabel = proj["method_label"]
        methods_counts[mlabel] = methods_counts.get(mlabel, 0) + 1
        acc = stage_acc.get(pid)
        active_st = acc[0] if acc else 0
        done_st = acc[1] if acc else 0
        progress = round(100 * done_st / active_st) if active_st > 0 else 0
        proj["progress"] = progress
        proj["current_stage_key"] = (acc[2] if acc else "") if (not proj["is_terminated"] and progress < 100) else ""
        proj["current_stage_name"] = (acc[3] if acc and acc[3] else ("已完成" if progress >= 100 else "未初始化流程"))

        if proj["is_terminated"]:
            if proj["terminated_type"] == "liubiao":
                liubiao_count += 1
            elif proj["terminated_type"] == "feibiao":
                feibiao_count += 1
            continue

        non_term_total += 1
        if active_st > 0 and done_st >= active_st:
            completed_count += 1
            continue

        active_count += 1
        active_method_counts[mlabel] = active_method_counts.get(mlabel, 0) + 1
        cur_sk = proj["current_stage_key"] or "unassigned"
        stage_counts[cur_sk] = stage_counts.get(cur_sk, 0) + 1
        if acc and acc[4]:
            unopened_count += 1

        bucket = active_preview_by_method.setdefault(mlabel, [])
        if len(bucket) < 12:
            bucket.append({
                "id": pid,
                "number": proj["number"],
                "name": proj["name"],
                "purchaser": proj["purchaser"],
                "method": proj["method"],
                "year": proj["year"],
                "progress": progress,
                "is_terminated": False,
                "current_stage_key": proj["current_stage_key"],
                "current_stage_name": proj["current_stage_name"],
                **({"procurement": proj["procurement"]} if "procurement" in proj else {}),
            })

        if acc and acc[5]:
            for skey, sname, raw_plan, resp in acc[5]:
                plan_date, deadline_dt = _parse_iso_deadline(raw_plan)
                if plan_date is None or deadline_dt is None:
                    continue
                days = (plan_date - today).days
                overdue_by_time = (days == 0 and deadline_dt < current)
                if overdue_by_time or days < 0:
                    urgency = "overdue"
                    overdue_project_ids.add(pid)
                elif days == 0:
                    urgency = "today"
                elif days <= 7:
                    urgency = "soon"
                else:
                    urgency = "later"
                owner = resp or (proj["prepare_owner"] if skey == "doc_prepare" else (proj["review_owner"] if skey == "doc_review" else ""))
                planned_iso = raw_plan.replace(" ", "T")
                deadline_ms = int(deadline_dt.timestamp() * 1000)
                actions_all.append({
                    "projectId": pid,
                    "projectNumber": proj["number"],
                    "projectName": proj["name"],
                    "stageKey": skey,
                    "stageName": sname,
                    "responsiblePerson": owner,
                    "plannedAt": planned_iso,
                    "deadlineAt": deadline_ms,
                    "days": days,
                    "urgency": urgency,
                })
                delta_ms = int((deadline_dt - current).total_seconds() * 1000)
                if delta_ms >= 0:
                    key_nodes_all.append({
                        "projectId": pid,
                        "projectName": proj["name"],
                        "projectNumber": proj["number"],
                        "stageKey": skey,
                        "stageName": sname,
                        "plannedAt": planned_iso,
                        "delta": delta_ms,
                    })

    actions_all.sort(key=lambda a: (a["days"], urgency_order.get(a["urgency"], 3), a["deadlineAt"], a["projectNumber"]))
    key_nodes_all.sort(key=lambda n: (n["delta"], n["projectNumber"]))

    overdue_list = [a for a in actions_all if a["urgency"] == "overdue"]
    today_list = [a for a in actions_all if a["urgency"] == "today"]
    soon_list = [a for a in actions_all if a["urgency"] in ("today", "soon")]
    overdue_actions = len(overdue_list)
    due_soon_actions = len(soon_list)
    task_buckets = {
        "all": {"count": len(actions_all), "items": actions_all[:6]},
        "overdue": {"count": overdue_actions, "items": overdue_list[:6]},
        "today": {"count": len(today_list), "items": today_list[:6]},
        "soon": {"count": due_soon_actions, "items": soon_list[:6]},
    }

    risk_projects = []
    for proj in sorted(projects_by_id.values(), key=lambda p: (p["number"], p["id"])):
        if proj["id"] in overdue_project_ids or proj["challenge_state"] in ("质疑中", "投诉中"):
            risk_projects.append({
                "id": proj["id"],
                "number": proj["number"],
                "name": proj["name"],
                "challenge_state": proj["challenge_state"],
            })
            if len(risk_projects) >= 20:
                break

    active_preview: list[dict[str, Any]] = []
    for rows in active_preview_by_method.values():
        active_preview.extend(rows)

    # 4. Confirmed business deadline overview — reuse business_deadlines.overview_summaries directly
    # so minute-precision vs date-only time_status matches per-project summaries 100%.
    deadline_overview: dict[str, Any] = {
        "total": 0, "overdue": 0, "dueSoon": 0, "review": 0, "alerts": 0, "items": [], "unavailable": False,
    }
    if "business_deadline_items" in tables and projects_by_id:
        try:
            try:
                from . import business_deadlines
            except ImportError:
                import business_deadlines
            dl_rows = db.session.execute(
                text("SELECT id, project_id, state, payload FROM business_deadline_items WHERE state='confirmed'")
            ).fetchall()
            parsed_dl_items = []
            for r in dl_rows:
                pid = int(r[1])
                if pid not in projects_by_id:
                    continue
                try:
                    payload = _json.loads(r[3]) if r[3] else {}
                except Exception:
                    continue
                if not isinstance(payload, dict):
                    continue
                parsed_dl_items.append({
                    **payload,
                    "id": str(r[0]),
                    "project_id": pid,
                    "state": str(r[2] or payload.get("state") or "confirmed"),
                })
            by_pid = business_deadlines.overview_summaries(parsed_dl_items, now=current)
            dl_items = []
            for pid, group in by_pid.items():
                proj = projects_by_id.get(int(pid))
                if proj is None:
                    continue
                g_sum = group.get("summary") or {}
                for field in ("total", "overdue", "dueSoon", "review", "alerts"):
                    deadline_overview[field] += int(g_sum.get(field) or 0)
                for item in group.get("items") or ():
                    dl_items.append({
                        **item,
                        "projectId": int(pid),
                        "projectName": proj["name"],
                    })
            dl_items.sort(key=lambda it: (0 if it.get("time_status") == "overdue" else 1, str(it.get("confirmed_deadline") or "")))
            deadline_overview["items"] = dl_items[:20]
        except Exception:
            deadline_overview["unavailable"] = True

    return {
        "aggregated": True,
        "stats": {
            "total": non_term_total,
            "completed": completed_count,
            "in_progress": active_count,
            "liubiao": liubiao_count,
            "feibiao": feibiao_count,
        },
        "metrics": {
            "total": total_all,
            "active": active_count,
            "unopened": unopened_count,
            "dueSoon": due_soon_actions,
            "overdue": overdue_actions,
            "completed": completed_count,
        },
        "actions_total": len(actions_all),
        "actions": actions_all[:120],
        "task_buckets": task_buckets,
        "key_nodes": key_nodes_all[:60],
        "active_projects": active_preview[:40],
        "active_method_counts": active_method_counts,
        "insights": {
            "methods": methods_counts,
            "stageCounts": stage_counts,
            "riskProjects": risk_projects,
        },
        "deadline_overview": deadline_overview,
    }


def register(app: Any, db: Any, ctx: Any) -> bool:
    if app.extensions.get("project_listing"):
        return True
    runtime = ctx if hasattr(ctx, "get") else dict(ctx or {})
    login_required = runtime.get("login_required") or (lambda f: f)
    load_app_settings = runtime.get("load_app_settings", lambda: {})

    with app.app_context():
        ensure_performance_indexes(db)

    @login_required
    def api_projects_years_summary():
        settings = load_app_settings() if callable(load_app_settings) else {}
        return jsonify(compute_years_summary(db, settings))

    @login_required
    def api_projects_dashboard_summary():
        settings = load_app_settings() if callable(load_app_settings) else {}
        return jsonify(compute_dashboard_summary(db, settings, ctx=runtime))

    app.add_url_rule(
        "/api/projects/years-summary",
        "api_projects_years_summary",
        api_projects_years_summary,
        methods=["GET"],
    )
    app.add_url_rule(
        "/api/projects/dashboard-summary",
        "api_projects_dashboard_summary",
        api_projects_dashboard_summary,
        methods=["GET"],
    )
    app.extensions["project_listing"] = {"signature": PROJECT_LISTING_SIGNATURE}
    return True
