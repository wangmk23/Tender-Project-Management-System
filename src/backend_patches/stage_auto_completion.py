"""Automatic stage completion engine and transactional audit exporter.

stage-auto-completion-v1
"""
from __future__ import annotations

from datetime import datetime as _default_datetime
from typing import Any

try:
    from sqlalchemy.orm import joinedload as _default_joinedload
except Exception:  # pragma: no cover
    def _default_joinedload(*args: Any, **kwargs: Any) -> Any:
        return None

STAGE_AUTO_COMPLETION_SIGNATURE = "stage-auto-completion-v1"


def _auto_advance_stages(ctx: Any = None):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context

    if ctx is None:
        ctx = runtime_context.current_context(depth=1)
    else:
        ctx = runtime_context.get_runtime_context(ctx)
    datetime = ctx.get("datetime", _default_datetime)
    joinedload = ctx.get("joinedload", _default_joinedload)
    load_app_settings = ctx.get("load_app_settings")
    SETTINGS_PATH = ctx.get("SETTINGS_PATH")
    Project = ctx.get("Project")
    app = ctx.get("app")
    db = ctx.get("db")
    import json
    import os
    if __package__:
        from . import lot_supplier_risk
    else:
        import lot_supplier_risk
    from datetime import timedelta
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates

    now_hook = ctx.get("_AUTO_COMPLETION_NOW")
    now = now_hook() if now_hook else datetime.now()
    state_path = SETTINGS_PATH.with_name("stage_auto_completion_state.json")
    audit_path = SETTINGS_PATH.with_name("stage_auto_completion_log.jsonl")

    def write_atomic(path, value):
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(value, encoding="utf-8")
        os.replace(temporary, path)

    def ensure_audit_table(cursor):
        cursor.execute(
            "CREATE TABLE IF NOT EXISTS stage_auto_completion_audit ("
            "sequence INTEGER PRIMARY KEY AUTOINCREMENT, "
            "event_id TEXT NOT NULL UNIQUE, "
            "transaction_id TEXT NOT NULL, "
            "project_id INTEGER NOT NULL, "
            "stage_key TEXT NOT NULL, "
            "payload_json TEXT NOT NULL, "
            "created_at TEXT NOT NULL)"
        )

    def export_committed_audit():
        connection = None
        temporary = audit_path.with_suffix(audit_path.suffix + ".tmp")
        try:
            connection = db.engine.raw_connection()
            cursor = connection.cursor()
            ensure_audit_table(cursor)
            connection.commit()
            rows = cursor.execute(
                "SELECT payload_json FROM stage_auto_completion_audit "
                "ORDER BY sequence"
            ).fetchall()
            with temporary.open("w", encoding="utf-8", newline="\n") as stream:
                for row in rows:
                    record = json.loads(row[0])
                    stream.write(
                        json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n"
                    )
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, audit_path)
        except Exception as exc:
            temporary.unlink(missing_ok=True)
            print(f"Auto-completion audit export error: {exc}")
        finally:
            if connection is not None:
                connection.close()

    if not state_path.is_file():
        enabled_at = now.replace(second=0, microsecond=0) + timedelta(minutes=1)
        state = {
            "version": 1,
            "enabled_at": enabled_at.isoformat(timespec="seconds"),
            "initialized_at": now.isoformat(timespec="seconds"),
        }
        try:
            write_atomic(
                state_path,
                json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            )
        except (OSError, UnicodeError) as exc:
            print(f"Auto-completion state initialization error: {exc}")
        return

    try:
        state = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(state, dict) or state.get("version") != 1:
            raise ValueError("invalid auto-completion state")
        enabled_at = datetime.fromisoformat(str(state.get("enabled_at") or ""))
    except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError) as exc:
        print(f"Auto-completion state error: {exc}")
        return

    def normalize(value):
        if isinstance(value, datetime):
            parsed = value
        elif hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
            parsed = datetime(value.year, value.month, value.day)
        else:
            raw = str(value or "").strip().replace("Z", "+00:00")
            if not raw:
                return None
            try:
                parsed = datetime.fromisoformat(raw)
            except ValueError:
                return None
        if getattr(parsed, "tzinfo", None) is not None:
            parsed = parsed.astimezone().replace(tzinfo=None)
        return parsed

    enabled_at = normalize(enabled_at)
    local_now = normalize(now)
    if enabled_at is None or local_now is None:
        print("Auto-completion state error: invalid scheduling timestamp")
        return

    settings = load_app_settings()
    legacy_auto_keys = [
        key
        for key in stage_workflow.normalize_stage_order(
            settings.get("stage_order"), ctx.get("STAGES", [])
        )
        if key in stage_templates.LEGACY_AUTO_COMPLETION_STAGE_KEYS
    ]
    changed = []
    previous_values = []
    with app.app_context():
        lot_supplier_risk.ensure_schema(db, commit=True)
        export_committed_audit()
        if ctx.get('_PROCUREMENT_CATALOG_ENABLED'):
            if __package__:
                from . import procurement_catalog
            else:
                import procurement_catalog
            procurement_catalog._lock(db)
            db.session.expire_all()
        projects = Project.query.options(
            joinedload(Project.stages),
            joinedload(Project.lots),
            joinedload(Project.registrations),
        ).filter_by(
            is_terminated=False
        ).all()
        session_connection = db.session.connection()
        explicit_policies = stage_templates.auto_completion_policies(
            session_connection,
            ctx.get("text", lambda value: value),
        )
        for project in projects:
            if getattr(project, "is_terminated", False):
                continue
            project_id = int(getattr(project, "id"))
            policy = explicit_policies.get(project_id)
            if policy is None:
                auto_keys = legacy_auto_keys
                registration_keys = {"registration_end"}
            else:
                auto_keys = [
                    str(getattr(stage, "stage_key", ""))
                    for stage in list(getattr(project, "stages", ()) or ())
                    if "auto_completion" in policy.get(
                        str(getattr(stage, "stage_key", "")), set()
                    )
                ]
                registration_keys = {
                    stage_key
                    for stage_key, modules in policy.items()
                    if "registration" in modules
                }
            for stage_key in auto_keys:
                stage = project.get_stage(stage_key)
                if stage is None:
                    continue
                if getattr(stage, "completed", False) or getattr(stage, "skipped", False):
                    continue
                planned = normalize(getattr(stage, "planned_datetime", None))
                if planned is None or planned < enabled_at or planned > local_now:
                    continue
                if ctx.get('_PROCUREMENT_CATALOG_ENABLED'):
                    if __package__:
                        from . import supplier_quantity
                    else:
                        import supplier_quantity
                    if supplier_quantity.validate_stage_advance(db, project, stage_key):
                        continue
                if ctx.get('_TENDER_GUARANTEE_ENABLED'):
                    if __package__:
                        from . import tender_guarantee
                    else:
                        import tender_guarantee
                    if tender_guarantee.publication_completion_error(db,project,stage_key,SETTINGS_PATH.parent/'holiday_calendar'):
                        continue
                if stage_key in registration_keys:
                    try:
                        lot_supplier_risk.apply_registration_cutoff(
                            db, project, local_now, load_app_settings()
                        )
                    except Exception as exc:
                        db.session.rollback()
                        print(f"Lot supplier cutoff error: {exc}")
                        if ctx.get('_PROCUREMENT_CATALOG_ENABLED'):
                            return
                        continue
                previous_values.append(
                    (
                        stage,
                        getattr(stage, "completed", False),
                        getattr(stage, "completed_date", None),
                    )
                )
                stage.completed = True
                stage.completed_date = local_now.date()
                changed.append(
                    {
                        "action": "auto_complete_stage",
                        "completed_date": local_now.date().isoformat(),
                        "executed_at": local_now.isoformat(timespec="seconds"),
                        "planned_at": planned.isoformat(timespec="seconds"),
                        "project_id": getattr(project, "id", None),
                        "stage_key": stage_key,
                    }
                )

        if not changed:
            if ctx.get('_PROCUREMENT_CATALOG_ENABLED'):
                db.session.rollback()
            return

        def rollback_changes():
            db.session.rollback()
            for stage, completed, completed_date in previous_values:
                stage.completed = completed
                stage.completed_date = completed_date

        try:
            session_connection = db.session.connection()
            for record in changed:
                stage_templates.persist_stage_completed_at(
                    session_connection, ctx.get("text", lambda value: value),
                    record["project_id"], record["stage_key"],
                    local_now.replace(second=0, microsecond=0),
                )
            driver_connection = getattr(
                session_connection, "connection", session_connection
            )
            audit_cursor = driver_connection.cursor()
            ensure_audit_table(audit_cursor)
            transaction_id = "auto_completion|" + local_now.isoformat(
                timespec="seconds"
            )
            for record in changed:
                payload = json.dumps(record, ensure_ascii=False, sort_keys=True)
                event_id = "|".join(
                    (
                        str(record["project_id"]),
                        record["stage_key"],
                        record["planned_at"],
                    )
                )
                audit_cursor.execute(
                    "INSERT OR IGNORE INTO stage_auto_completion_audit "
                    "(event_id, transaction_id, project_id, stage_key, payload_json, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?)",
                    (
                        event_id,
                        transaction_id,
                        record["project_id"],
                        record["stage_key"],
                        payload,
                        record["executed_at"],
                    ),
                )
            db.session.commit()
        except (Exception, KeyboardInterrupt) as exc:
            rollback_changes()
            print(f"Auto-completion commit error: {exc}")
            return

        export_committed_audit()


auto_advance_stages = _auto_advance_stages
