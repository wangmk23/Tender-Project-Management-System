"""Scheduled backup and daily reminder digest service.

scheduled-digest-backup-v1
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime as _default_datetime
from typing import Any

try:
    from sqlalchemy.orm import joinedload as _default_joinedload
except Exception:  # pragma: no cover
    def _default_joinedload(*args: Any, **kwargs: Any) -> Any:
        return None

SCHEDULED_DIGEST_BACKUP_SIGNATURE = "scheduled-digest-backup-v1"


def _resolve_context(ctx_or_now: Any = None, now: Any = None):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context

    if ctx_or_now is not None and not isinstance(ctx_or_now, Mapping) and hasattr(ctx_or_now, "year") and now is None:
        now = ctx_or_now
        ctx_or_now = None
    if ctx_or_now is None:
        ctx = runtime_context.current_context(depth=2)
    else:
        ctx = runtime_context.get_runtime_context(ctx_or_now)
    return ctx, now


def run_scheduled_backup_if_due(ctx_or_now: Any = None, now: Any = None, job: str = "backup"):
    ctx, now = _resolve_context(ctx_or_now, now)
    datetime = ctx.get("datetime", _default_datetime)
    joinedload = ctx.get("joinedload", _default_joinedload)
    load_app_settings = ctx.get("load_app_settings")
    SETTINGS_PATH = ctx.get("SETTINGS_PATH")
    Project = ctx.get("Project")
    app = ctx.get("app")
    db = ctx.get("db")
    create_full_backup = ctx.get("create_full_backup")
    import ctypes
    import ctypes.wintypes
    import hashlib
    import json
    import os
    import smtplib
    import ssl
    from datetime import timedelta
    from email.message import EmailMessage
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow

    now = now or datetime.now()
    backup = None
    if job not in {"backup", "digest"}:
        raise ValueError(f"unknown scheduled job: {job}")
    if job == "digest":
        credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
        pending_path = credential_path.with_suffix(credential_path.suffix + ".tmp")
        credential_rollback_path = credential_path.with_suffix(
            credential_path.suffix + ".rollback"
        )
        settings_rollback_path = SETTINGS_PATH.with_name(
            SETTINGS_PATH.name + ".reminder-rollback"
        )
        transaction_path = SETTINGS_PATH.with_name(
            "reminder_settings_transaction.json"
        )
        if transaction_path.is_file():
            settings_recovery = SETTINGS_PATH.with_name(
                SETTINGS_PATH.name + ".reminder-recovery"
            )
            credential_recovery = credential_path.with_suffix(
                credential_path.suffix + ".recovery"
            )
            try:
                transaction = json.loads(
                    transaction_path.read_text(encoding="utf-8")
                )
                if transaction.get("version") != 1:
                    raise ValueError("unsupported reminder settings transaction")
                if pending_path.is_file():
                    if transaction.get("settings_existed"):
                        settings_recovery.write_bytes(
                            settings_rollback_path.read_bytes()
                        )
                        os.replace(settings_recovery, SETTINGS_PATH)
                    else:
                        SETTINGS_PATH.unlink(missing_ok=True)
                    if transaction.get("mode") == "clear":
                        if transaction.get("credential_existed"):
                            credential_recovery.write_bytes(
                                credential_rollback_path.read_bytes()
                            )
                            os.replace(credential_recovery, credential_path)
                        else:
                            credential_path.unlink(missing_ok=True)
                    pending_path.unlink(missing_ok=True)
                settings_rollback_path.unlink(missing_ok=True)
                credential_rollback_path.unlink(missing_ok=True)
                transaction_path.unlink()
            except Exception:
                settings_recovery.unlink(missing_ok=True)
                credential_recovery.unlink(missing_ok=True)
                return backup
    settings = load_app_settings()
    ordered_stages = stage_workflow.ordered_stage_definitions(
        ctx.get("STAGES", []), settings
    )
    stage_names = {
        stage.get("key"): stage.get("name")
        for stage in ordered_stages
        if isinstance(stage, dict)
    }
    stage_rank = {
        stage.get("key"): index
        for index, stage in enumerate(ordered_stages)
        if isinstance(stage, dict)
    }

    def ordered_project_stages(project):
        rows = list(getattr(project, "stages", None) or [])
        return sorted(
            rows,
            key=lambda stage: stage_rank.get(
                getattr(stage, "stage_key", None) or getattr(stage, "key", None),
                len(stage_rank),
            ),
        )
    try:
        backup_hour, backup_minute = (
            int(part)
            for part in str(settings.get("backup_time") or "13:00").split(":", 1)
        )
    except (TypeError, ValueError):
        backup_hour, backup_minute = 13, 0
    if job == "backup":
        if (
            (now.hour, now.minute) >= (backup_hour, backup_minute)
            and settings.get("last_backup_date") != now.date().isoformat()
        ):
            backup = create_full_backup()
        return backup

    try:
        import lot_supplier_risk
    except ModuleNotFoundError:
        from src.backend_patches import lot_supplier_risk

    if not settings.get("reminder_enabled"):
        return backup
    try:
        reminder_hour, reminder_minute = (
            int(part)
            for part in str(settings.get("reminder_time") or "09:00").split(":", 1)
        )
    except (TypeError, ValueError):
        reminder_hour, reminder_minute = 9, 0
    if (now.hour, now.minute) < (reminder_hour, reminder_minute):
        return backup

    weekdays = settings.get("reminder_weekdays")
    if settings.get('reminder_use_national_workdays'):
        try:
            import holiday_calendar
        except ModuleNotFoundError:
            from src.backend_patches import holiday_calendar
        info=holiday_calendar.day_info(now.date(),cache_dir=SETTINGS_PATH.parent/'holiday_calendar')
        if not info['confirmed'] or info['status']!='workday':
            return backup
    elif weekdays and isinstance(weekdays, list) and now.weekday() not in weekdays:
        return backup

    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    templates = stage_templates.normalize_stage_templates(
        settings.get("stage_templates"),
        ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
        ctx.get("STAGES", []),
        stage_order=settings.get("stage_order"),
    )
    template_names = {
        method: {str(stage["id"]): str(stage["name"]) for stage in definitions}
        for method, definitions in templates.items()
    }
    default_stage_keys = set(stage_names)
    for names in template_names.values():
        default_stage_keys.update(names)

    # These snapshot columns need not be mapped by the historical Stage ORM.
    # Read existing metadata only; the scheduler never creates or migrates it.
    stage_snapshots = {}
    stage_session = getattr(ctx.get("db"), "session", None)
    sql_text = ctx.get("text")
    if callable(getattr(stage_session, "execute", None)) and callable(sql_text):
        try:
            result = stage_session.execute(sql_text(
                "SELECT project_id,stage_key,stage_name,template_removed FROM stages"
            ))
            rows = result.mappings().all() if hasattr(result, "mappings") else result.fetchall()
            for row in rows:
                if hasattr(row, "_mapping"):
                    row = dict(row._mapping)
                elif hasattr(row, "keys"):
                    row = dict(row)
                elif not isinstance(row, dict):
                    row = dict(zip(("project_id", "stage_key", "stage_name", "template_removed"), row))
                stage_snapshots[(str(row["project_id"]), str(row["stage_key"]))] = row
        except Exception:
            # Older schemas without snapshot columns retain their existing names.
            stage_snapshots = {}

    try:
        import reminder_routing
    except ModuleNotFoundError:
        from src.backend_patches import reminder_routing
    for definition in reminder_routing.reminder_stage_definitions(
        settings, ctx.get("STAGES", []), ctx.get("METHODS"),
        database=getattr(ctx.get("app"), "extensions", {}).get("procurement_catalog", {}).get("db"),
        snapshots=list(stage_snapshots.values()),
    ):
        default_stage_keys.add(definition["key"])
        stage_names.setdefault(definition["key"], definition["name"])

    def electronic_registration_private(project):
        catalog=getattr(ctx.get('app'),'extensions',{}).get('procurement_catalog',{})
        database=catalog.get('db') if isinstance(catalog,dict) else None
        if database is None:
            return getattr(project,'method','')=='公开招标-电子标'
        if __package__:from . import electronic_tender
        else:import electronic_tender
        return electronic_tender.enabled(database,project.id)

    def reminder_stage_metadata(project, stage):
        key = str(getattr(stage, "stage_key", None) or getattr(stage, "key", None) or "")
        snapshot = stage_snapshots.get((str(getattr(project, "id", "")), key))
        removed = (
            bool(snapshot.get("template_removed")) if snapshot is not None
            else bool(getattr(stage, "template_removed", False))
        )
        name = (
            (snapshot.get("stage_name") if snapshot is not None else None)
            or getattr(stage, "stage_name", None)
            or getattr(stage, "name", None)
            or stage_names.get(key)
            or template_names.get(str(getattr(project, "method", "") or ""), {}).get(key)
            or key
        )
        return str(name), removed

    advance_days = 0
    try:
        advance_days = int(settings.get("reminder_advance_days") or 0)
        if not 0 <= advance_days <= 30:
            advance_days = 0
    except (TypeError, ValueError):
        advance_days = 0

    state_path = SETTINGS_PATH.with_name("reminder_send_log.json")
    credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")

    def empty_state():
        return {
            "sent": {},
            "attempts": {},
            "last_check_at": None,
            "last_success_at": None,
            "last_error": None,
            "sent_today": 0,
        }

    def load_state():
        if not state_path.is_file():
            return empty_state()
        value = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or not isinstance(value.get("sent"), dict) or not isinstance(value.get("attempts"), dict):
            raise ValueError("invalid reminder state")
        return value

    def save_state(value):
        temporary = state_path.with_suffix(state_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        os.replace(temporary, state_path)

    def planned_value(stage):
        return (
            getattr(stage, "planned_datetime", None)
            or getattr(stage, "planned_at", None)
            or getattr(stage, "planned_date", None)
        )

    def parse_planned(value):
        if isinstance(value, datetime):
            return value
        if hasattr(value, "year") and hasattr(value, "month") and hasattr(value, "day"):
            return datetime(value.year, value.month, value.day)
        raw = str(value or "").strip().replace("Z", "+00:00")
        if not raw:
            return None
        try:
            return datetime.fromisoformat(raw)
        except ValueError:
            try:
                return datetime.strptime(raw[:10], "%Y-%m-%d")
            except ValueError:
                return None

    def unprotect_secret(raw):
        hook = ctx.get("_REMINDER_UNPROTECT_SECRET")
        if hook:
            return hook(raw)
        if os.name != "nt":
            raise RuntimeError("SMTP 密码解密仅支持 Windows")

        class DataBlob(ctypes.Structure):
            _fields_ = [("size", ctypes.wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]

        source_buffer = ctypes.create_string_buffer(raw)
        source = DataBlob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char)))
        target = DataBlob()
        success = ctypes.windll.crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)
        )
        if not success:
            raise ctypes.WinError()
        try:
            return ctypes.string_at(target.data, target.size)
        finally:
            ctypes.windll.kernel32.LocalFree(target.data)

    if "reminder_recipient_groups" in settings:
        try:
            import reminder_routing
        except ModuleNotFoundError:
            from src.backend_patches import reminder_routing

        delivery_state_path = SETTINGS_PATH.with_name(
            "daily_stage_delivery_state.json"
        )

        def empty_delivery_state():
            return {
                "version": 1,
                "deliveries": {},
                "last_check_at": None,
                "last_success_at": None,
                "last_error": None,
                "pending_count": 0,
            }

        def load_delivery_state():
            if not delivery_state_path.is_file():
                return empty_delivery_state()
            value = json.loads(delivery_state_path.read_text(encoding="utf-8"))
            if not isinstance(value, dict) or set(value) != set(empty_delivery_state()):
                raise ValueError("invalid daily stage delivery state")
            if value.get("version") != 1 or not isinstance(value.get("deliveries"), dict):
                raise ValueError("invalid daily stage delivery state")
            if value.get("last_error") is not None and value.get("last_error") not in reminder_routing.SAFE_ERROR_CODES:
                raise ValueError("invalid daily stage delivery state")
            for delivery_key, record in value["deliveries"].items():
                if (
                    not isinstance(delivery_key, str)
                    or len(delivery_key) != 64
                    or not isinstance(record, dict)
                    or record.get("status") not in {"pending", "sending", "sent", "failed"}
                    or type(record.get("attempts")) is not int
                    or not 0 <= record["attempts"] <= 3
                ):
                    raise ValueError("invalid daily stage delivery state")
            return value

        def save_delivery_state(value):
            temporary = delivery_state_path.with_suffix(
                delivery_state_path.suffix + ".tmp"
            )
            temporary.write_text(
                json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, delivery_state_path)

        try:
            groups = reminder_routing.normalize_recipient_groups(settings)
            delivery_state = load_delivery_state()
        except (ValueError, OSError, UnicodeError, json.JSONDecodeError):
            return {
                "ok": False,
                "job": "daily_stage",
                "error_code": "STATE_INVALID",
                "pending_count": 0,
                "checked_at": now.isoformat(timespec="seconds"),
            }

        projects = Project.query.options(
            joinedload(Project.stages),
            joinedload(Project.registrations),
            joinedload(Project.lots),
        ).all()
        try:
            try:
                from . import recycle_bin
            except ImportError:
                import recycle_bin
            projects = recycle_bin.filter_active_projects(db, projects, ctx=ctx)
        except Exception:
            pass
        supplier_due = []
        supplier_error = None
        supplier_enabled = settings.get("supplier_shortage_email_enabled", True) and any(
            group["enabled"] and "supplier_shortage" in group["event_types"]
            for group in groups
        )
        if supplier_enabled:
            try:
                lot_supplier_risk.ensure_schema(db)
                for project in projects:
                    if not getattr(project, "is_terminated", False):
                        lot_supplier_risk.queue_due_warning_events(
                            db, project, now, settings
                        )
                db.session.commit()
                for parent in lot_supplier_risk.pending_mail_events(db):
                    deadline = str(parent.get("deadline") or "")
                    try:
                        deadline_text = datetime.fromisoformat(deadline).strftime(
                            "%Y-%m-%d %H:%M"
                        )
                    except (TypeError, ValueError):
                        deadline_text = deadline
                    for index, item in enumerate(parent.get("items") or []):
                        lot_identity = (
                            "项目整体"
                            if item.get("lot_id") is None
                            else f"{item.get('lot_number') or ''} {item.get('lot_name') or '未命名包'}".strip()
                        )
                        event = {
                            "event_type": "supplier_shortage",
                            "event_key": f"supplier_shortage:{parent['id']}:{item.get('lot_id') or 'project'}:{index}",
                            "project_number": parent.get("project_number") or "",
                            "project_name": parent.get("project_name") or "",
                            "purchaser": parent.get("purchaser") or "",
                            "method": parent.get("method") or item.get("method") or "",
                            "year": parent.get("year") or "",
                            "lot_identity": lot_identity,
                            "supplier_count": item.get("registration_count"),
                            "supplier_minimum": item.get("required_count"),
                            "supplier_missing": item.get("missing_count"),
                            "registration_deadline": deadline_text,
                        }
                        deliveries = reminder_routing.route_reminder_event(event, groups)
                        lot_supplier_risk.claim_mail_deliveries(
                            db, parent, event, deliveries, now
                        )
                db.session.commit()
                supplier_due = [
                    record for record in lot_supplier_risk.pending_mail_deliveries(db, now)
                    if reminder_routing.delivery_matches_current_rules(
                        record.get("event"), record.get("delivery"), groups
                    )
                ]
            except Exception:
                db.session.rollback()
                supplier_error = "STATE_WRITE_FAILED"
                supplier_due = []
        enabled_stages = set(settings.get("reminder_stage_keys") or default_stage_keys)
        checked_at = now.isoformat(timespec="seconds")
        existing_event_keys = {
            record.get("event_key")
            for record in delivery_state["deliveries"].values()
            if isinstance(record, dict)
        }
        events = []
        eligible_event_keys = set()
        for project in projects:
            if getattr(project, "is_terminated", False):
                continue
            for stage in ordered_project_stages(project):
                stage_key = getattr(stage, "stage_key", None) or getattr(stage, "key", None)
                if stage_key not in enabled_stages:
                    continue
                stage_name, template_removed = reminder_stage_metadata(project, stage)
                if (
                    getattr(stage, "completed", False)
                    or getattr(stage, "is_completed", False)
                    or getattr(stage, "skipped", False)
                    or template_removed
                ):
                    continue
                planned = parse_planned(planned_value(stage))
                if planned is None:
                    continue
                target_date = now.date()
                if advance_days > 0:
                    deadline = target_date + timedelta(days=advance_days)
                    if not target_date <= planned.date() <= deadline:
                        continue
                elif planned.date() != target_date:
                    continue
                event_key = ":".join(
                    (
                        "daily_stage",
                        now.date().isoformat(),
                        str(getattr(project, "id", "")),
                        str(stage_key),
                        planned.isoformat(),
                    )
                )
                eligible_event_keys.add(event_key)
                if event_key in existing_event_keys:
                    continue
                event = {
                    "event_type": "daily_stage",
                    "project_id": project.id,
                    "stage_key": stage_key,
                    "event_key": event_key,
                    "project_number": getattr(project, "number", "") or "",
                    "project_name": getattr(project, "name", "") or "",
                    "purchaser": getattr(project, "purchaser", "") or "",
                    "method": getattr(project, "method", "") or "",
                    "year": getattr(project, "year", "") or "",
                    "stage_name": stage_name,
                    "planned_at": planned.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": len(
                        list(getattr(project, "registrations", None) or [])
                    ),
                }
                if electronic_registration_private(project):
                    event.pop('registration_count',None)
                events.append(event)

        covered_by_event = {}
        fresh_event_keys = {event['event_key'] for event in events}
        coverage_events = events + [record['event'] for record in delivery_state['deliveries'].values() if record.get('status') == 'pending' and isinstance(record.get('event'),dict)]
        for event in coverage_events:
            covered_recipients = set()
            if event.get('event_type') == 'daily_stage' and event.get('project_id') and getattr(ctx.get('app'),'_business_deadlines_registered',False):
                try:
                    try:
                        import business_deadlines
                    except ModuleNotFoundError:
                        from src.backend_patches import business_deadlines
                    linked_project = db.session.get(Project, event['project_id'])
                    if linked_project is not None:
                        covered_recipients = business_deadlines.covered_stage_recipients(
                            db, linked_project, event.get('stage_key',''), event.get('planned_at',''),
                            groups, now, SETTINGS_PATH.parent/'holiday_calendar')
                except Exception:
                    app.logger.warning('业务期限与阶段提醒合并暂不可用，保留阶段提醒')
            covered_by_event[event['event_key']] = covered_recipients
            if event['event_key'] not in fresh_event_keys:
                continue
            for delivery in reminder_routing.route_reminder_event(event, groups):
                if delivery.get('recipient') in covered_recipients:
                    continue
                delivery_key = hashlib.sha256(
                    (
                        event["event_key"]
                        + "\0"
                        + delivery["recipient"]
                        + "\0"
                        + delivery["rules_fingerprint"]
                    ).encode("utf-8")
                ).hexdigest()
                delivery_state["deliveries"].setdefault(
                    delivery_key,
                    {
                        "event_key": event["event_key"],
                        "event": event,
                        "delivery": delivery,
                        "status": "pending",
                        "attempts": 0,
                        "last_attempt_at": None,
                        "next_attempt_at": checked_at,
                        "error_code": None,
                        "sent_at": None,
                    },
                )

        for record in delivery_state["deliveries"].values():
            if record["status"] == "sending":
                record["status"] = "failed"
                record["attempts"] = 3
                record["error_code"] = "SMTP_SEND_FAILED"

        due = []
        for delivery_key, record in delivery_state["deliveries"].items():
            if record.get('status') == 'pending' and record.get('delivery',{}).get('recipient') in covered_by_event.get(record.get('event_key'),set()):
                record['status'] = 'cancelled'
                continue
            next_attempt = record.get("next_attempt_at")
            try:
                next_at = datetime.fromisoformat(next_attempt) if next_attempt else None
            except (TypeError, ValueError):
                return {
                    "ok": False,
                    "job": "daily_stage",
                    "error_code": "STATE_INVALID",
                    "pending_count": 0,
                    "checked_at": checked_at,
                }
            if (
                record["status"] == "pending"
                and record["attempts"] < 3
                and (next_at is None or next_at <= now)
                and record.get("event_key") in eligible_event_keys
                and reminder_routing.delivery_matches_current_rules(
                    record.get("event"), record.get("delivery"), groups
                )
            ):
                record["status"] = "sending"
                record["last_attempt_at"] = checked_at
                due.append((delivery_key, record))

        delivery_state["last_check_at"] = checked_at
        delivery_state["pending_count"] = sum(
            record["status"] == "pending"
            for record in delivery_state["deliveries"].values()
        )
        try:
            save_delivery_state(delivery_state)
        except (OSError, UnicodeError):
            return {
                "ok": False,
                "job": "daily_stage",
                "error_code": "STATE_WRITE_FAILED",
                "pending_count": delivery_state["pending_count"],
                "checked_at": checked_at,
            }
        if not due and not supplier_due:
            return {
                "ok": supplier_error is None,
                "job": "daily_stage",
                "error_code": supplier_error or delivery_state["last_error"],
                "pending_count": delivery_state["pending_count"],
                "checked_at": checked_at,
            }

        try:
            if not credential_path.is_file():
                raise OSError("SMTP credential is missing")
            secret = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
            daily_messages = [
                (
                    delivery_key,
                    reminder_routing.render_recipient_message(
                        record["event"],
                        record["delivery"],
                        str(settings.get("smtp_sender") or ""),
                    ),
                )
                for delivery_key, record in due
            ]
            supplier_messages = [
                (
                    record["delivery_key"],
                    reminder_routing.render_recipient_message(
                        record["event"],
                        record["delivery"],
                        str(settings.get("smtp_sender") or ""),
                    ),
                )
                for record in supplier_due
            ]
            messages = daily_messages + supplier_messages
            results = reminder_routing.send_delivery_batch(
                messages,
                {
                    "host": settings.get("smtp_host"),
                    "port": settings.get("smtp_port"),
                    "security": settings.get("smtp_security"),
                    "username": settings.get("smtp_username"),
                },
                secret,
                smtp_factory=ctx.get("_REMINDER_SMTP_FACTORY"),
            )
        except Exception:
            results = [
                {
                    "delivery_key": delivery_key,
                    "recipient": record["delivery"]["recipient"],
                    "status": "failed",
                    "error_code": "SMTP_SEND_FAILED",
                }
                for delivery_key, record in due
            ] + [
                {
                    "delivery_key": record["delivery_key"],
                    "recipient": record["recipient"],
                    "status": "failed",
                    "error_code": "SMTP_SEND_FAILED",
                }
                for record in supplier_due
            ]

        daily_error = None
        supplier_result_error = supplier_error
        daily_keys = {delivery_key for delivery_key, _ in due}
        supplier_keys = {record["delivery_key"] for record in supplier_due}
        for result in results:
            if result["delivery_key"] not in daily_keys:
                continue
            record = delivery_state["deliveries"][result["delivery_key"]]
            record["attempts"] += 1
            if result["status"] == "sent":
                record["status"] = "sent"
                record["sent_at"] = checked_at
                record["next_attempt_at"] = None
                record["error_code"] = None
            else:
                error_code = result["error_code"]
                daily_error = daily_error or error_code
                record["error_code"] = error_code
                terminal = error_code == "SMTP_AUTH_FAILED" or record["attempts"] >= 3
                record["status"] = "failed" if terminal else "pending"
                record["next_attempt_at"] = (
                    None
                    if terminal
                    else (now + timedelta(minutes=15)).isoformat(timespec="seconds")
                )
        try:
            for result in results:
                if result["delivery_key"] in supplier_keys:
                    lot_supplier_risk.mark_mail_delivery_result(
                        db, result["delivery_key"], result, now
                    )
                    if result["status"] != "sent":
                        supplier_result_error = (
                            supplier_result_error or result["error_code"]
                        )
            if supplier_keys:
                db.session.commit()
        except Exception:
            db.session.rollback()
            supplier_result_error = supplier_result_error or "STATE_WRITE_FAILED"

        supplier_status_path = SETTINGS_PATH.with_name(
            "supplier_reminder_status.json"
        )
        supplier_status_temporary = supplier_status_path.with_suffix(
            supplier_status_path.suffix + ".tmp"
        )
        try:
            remaining_supplier = lot_supplier_risk.pending_mail_deliveries(db, now)
            supplier_status_temporary.write_text(
                json.dumps(
                    {
                        "last_check_at": checked_at,
                        "last_success_at": checked_at
                        if supplier_keys and not any(
                            result["status"] != "sent"
                            for result in results
                            if result["delivery_key"] in supplier_keys
                        )
                        else None,
                        "error_code": supplier_result_error
                        if supplier_result_error in reminder_routing.SAFE_ERROR_CODES
                        else None,
                        "pending_count": len(remaining_supplier),
                    },
                    ensure_ascii=False,
                    indent=2,
                    sort_keys=True,
                ) + "\n",
                encoding="utf-8",
            )
            os.replace(supplier_status_temporary, supplier_status_path)
        except Exception:
            supplier_status_temporary.unlink(missing_ok=True)
        delivery_state["last_error"] = daily_error
        if daily_error is None and daily_keys:
            delivery_state["last_success_at"] = checked_at
        delivery_state["pending_count"] = sum(
            record["status"] == "pending"
            for record in delivery_state["deliveries"].values()
        )
        try:
            save_delivery_state(delivery_state)
        except (OSError, UnicodeError):
            return {
                "ok": False,
                "job": "daily_stage",
                "error_code": "STATE_WRITE_FAILED",
                "pending_count": delivery_state["pending_count"],
                "checked_at": checked_at,
            }
        return {
            "ok": daily_error is None and supplier_result_error is None,
            "job": "daily_stage",
            "error_code": daily_error or supplier_result_error,
            "pending_count": delivery_state["pending_count"],
            "checked_at": checked_at,
        }

    try:
        state = load_state()
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return backup

    enabled_stages = set(settings.get("reminder_stage_keys") or default_stage_keys)
    recipients = sorted(
        {str(value).strip() for value in settings.get("reminder_recipients", []) if str(value).strip()},
        key=str.casefold,
    )
    projects = Project.query.options(
        joinedload(Project.stages),
        joinedload(Project.registrations),
        joinedload(Project.lots),
    ).all()
    try:
        try:
            from . import recycle_bin
        except ImportError:
            import recycle_bin
        projects = recycle_bin.filter_active_projects(db, projects, ctx=ctx)
    except Exception:
        pass
    try:
        lot_supplier_risk.ensure_schema(db)
        for project in projects:
            if not getattr(project, "is_terminated", False):
                lot_supplier_risk.queue_due_warning_events(
                    db, project, now, settings
                )
        db.session.commit()
        lot_mail = lot_supplier_risk.pending_mail_events(db)
    except Exception:
        db.session.rollback()
        lot_mail = []

    if lot_mail:
        try:
            if not credential_path.is_file():
                raise RuntimeError("SMTP password is not configured")
            lot_password = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
            lot_factory = ctx.get("_REMINDER_SMTP_FACTORY")
            lot_host = str(settings.get("smtp_host") or "")
            lot_port = int(settings.get("smtp_port") or 465)
            lot_security = str(settings.get("smtp_security") or "ssl")
            if lot_security == "ssl":
                lot_connection = (lot_factory or smtplib.SMTP_SSL)(
                    lot_host, lot_port, timeout=15, context=ssl.create_default_context()
                )
            else:
                lot_connection = (lot_factory or smtplib.SMTP)(lot_host, lot_port, timeout=15)
            with lot_connection as smtp:
                if lot_security == "starttls":
                    smtp.starttls(context=ssl.create_default_context())
                lot_username = str(settings.get("smtp_username") or "")
                if lot_username:
                    smtp.login(lot_username, lot_password)
                for event in lot_mail:
                    lot_message = EmailMessage()
                    lot_message["Subject"] = event["subject"]
                    lot_message["From"] = str(settings.get("smtp_sender") or "")
                    lot_message["To"] = ", ".join(event.get("recipients") or recipients)
                    lot_message.set_content(event["body"])
                    smtp.send_message(lot_message)
                    lot_supplier_risk.mark_mail_sent(db, event["id"], now)
                    db.session.commit()
        except smtplib.SMTPAuthenticationError:
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_AUTH_FAILED")
            db.session.commit()
        except ssl.SSLError:
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_TLS_FAILED")
            db.session.commit()
        except (TimeoutError, OSError):
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_CONNECTION_FAILED")
            db.session.commit()
        except Exception:
            for event in lot_mail:
                lot_supplier_risk.mark_mail_failed(db, event["id"], "SMTP_SEND_FAILED")
            db.session.commit()
    items = []
    for project in projects:
        if getattr(project, "is_terminated", False):
            continue
        for stage in ordered_project_stages(project):
            key = getattr(stage, "stage_key", None) or getattr(stage, "key", None)
            if key not in enabled_stages:
                continue
            stage_name, template_removed = reminder_stage_metadata(project, stage)
            if template_removed or getattr(stage, "completed", False) or getattr(stage, "is_completed", False) or getattr(stage, "skipped", False):
                continue
            planned = parse_planned(planned_value(stage))
            if planned is None:
                continue
            target_date = now.date()
            if advance_days > 0:
                deadline = target_date + timedelta(days=advance_days)
                if not (target_date <= planned.date() <= deadline):
                    continue
            elif planned.date() != target_date:
                continue
            planned_text = planned.strftime("%Y-%m-%d %H:%M") if planned.time() != datetime.min.time() else planned.strftime("%Y-%m-%d")
            dedupe_key = "|".join(
                [
                    now.date().isoformat(),
                    str(getattr(project, "id", "")),
                    str(key),
                    planned.isoformat(),
                    ",".join(recipients),
                ]
            )
            if dedupe_key in state["sent"]:
                continue
            items.append(
                {
                    "dedupe_key": dedupe_key,
                    "project": project,
                    "stage_key": key,
                    "stage_name": stage_name,
                    "planned": planned,
                    "planned_text": planned_text,
                }
            )

    state["last_check_at"] = now.isoformat(timespec="seconds")
    if not items:
        state["sent_today"] = sum(
            1 for key in state["sent"] if key.startswith(now.date().isoformat() + "|")
        )
        save_state(state)
        return backup

    retry_configuration = {
        "smtp_host": str(settings.get("smtp_host") or "").strip().rstrip(".").casefold(),
        "smtp_port": int(settings.get("smtp_port") or 465),
        "smtp_security": str(settings.get("smtp_security") or "ssl").casefold(),
        "smtp_username": str(settings.get("smtp_username") or "").strip().casefold(),
        "smtp_sender": str(settings.get("smtp_sender") or "").strip().casefold(),
        "recipients": recipients,
        "reminder_time": str(settings.get("reminder_time") or "09:00"),
        "advance_days": advance_days,
        "weekdays": settings.get("reminder_weekdays") or [],
    }
    configuration_hash = hashlib.sha256(
        json.dumps(
            retry_configuration,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()
    attempt_key = f"{now.date().isoformat()}|{configuration_hash}"
    attempt = state["attempts"].get(attempt_key, {"count": 0, "last_attempt_at": None})
    if int(attempt.get("count", 0)) >= 3:
        return backup
    last_attempt = attempt.get("last_attempt_at")
    if last_attempt:
        try:
            if now - datetime.fromisoformat(last_attempt) < timedelta(minutes=15):
                return backup
        except (TypeError, ValueError):
            pass

    attempt = {
        "count": int(attempt.get("count", 0)) + 1,
        "last_attempt_at": now.isoformat(timespec="seconds"),
    }
    state["attempts"][attempt_key] = attempt

    content = settings.get("reminder_content") or {}
    lines = ["以下流程节点即将到期，请及时跟进：", ""]
    for index, item in enumerate(items, 1):
        project = item["project"]
        lines.append(f"{index}. {item['stage_name']}" if content.get("stage_name", True) else f"{index}.")
        if content.get("project_number", True):
            lines.append(f"项目编号：{getattr(project, 'number', '') or '-'}")
        if content.get("project_name", True):
            lines.append(f"项目名称：{getattr(project, 'name', '') or '-'}")
        if content.get("purchaser", True):
            lines.append(f"采购人：{getattr(project, 'purchaser', '') or '-'}")
        if item["stage_key"] == "bid_opening" and content.get("planned_at", True):
            lines.append(f"开标时间：{item['planned'].strftime('%Y-%m-%d %H:%M')}")
        elif content.get("planned_at", True):
            lines.append(f"计划时间：{item['planned_text']}")
        if item["stage_key"] == "registration_end" and content.get("registration_count", True) and not electronic_registration_private(project):
            count = len(list(getattr(project, "registrations", None) or []))
            lines.append(f"{count} 家供应商已报名")
        lines.append("")

    message = EmailMessage()
    subject_template = settings.get("reminder_subject") or "采购执行提醒：{date} 共 {count} 个节点"
    try:
        subject = subject_template.format(date=now.date().isoformat(), count=len(items))
    except (KeyError, IndexError):
        subject = subject_template
    message["Subject"] = subject
    message["From"] = str(settings.get("smtp_sender") or "")
    message["To"] = ", ".join(recipients)
    message.set_content("\n".join(lines))

    host = str(settings.get("smtp_host") or "")
    normalized_host = host.strip().rstrip(".").casefold()
    if normalized_host in {"smtp-mail.outlook.com", "smtp.office365.com"}:
        state["last_error"] = "SMTP_OAUTH_REQUIRED: Outlook 需要 OAuth2"
        save_state(state)
        return backup

    try:
        if not credential_path.is_file():
            raise RuntimeError("SMTP 密码尚未配置")
        password = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
        factory = ctx.get("_REMINDER_SMTP_FACTORY")
        port = int(settings.get("smtp_port") or 465)
        security = str(settings.get("smtp_security") or "ssl")
        if security == "ssl":
            constructor = factory or smtplib.SMTP_SSL
            connection = constructor(host, port, timeout=15, context=ssl.create_default_context())
        else:
            constructor = factory or smtplib.SMTP
            connection = constructor(host, port, timeout=15)
        with connection as smtp:
            if security == "starttls":
                smtp.starttls(context=ssl.create_default_context())
            username = str(settings.get("smtp_username") or "")
            if username:
                smtp.login(username, password)
            smtp.send_message(message)
    except smtplib.SMTPAuthenticationError:
        state["last_error"] = "SMTP_AUTH_FAILED: SMTP 身份验证失败"
        save_state(state)
        return backup
    except ssl.SSLError:
        state["last_error"] = "SMTP_TLS_FAILED: SMTP TLS 协商失败"
        save_state(state)
        return backup
    except (TimeoutError, OSError):
        state["last_error"] = "SMTP_CONNECTION_FAILED: 无法连接 SMTP 服务器"
        save_state(state)
        return backup
    except smtplib.SMTPException:
        state["last_error"] = "SMTP_SEND_FAILED: SMTP 服务器拒绝发送"
        save_state(state)
        return backup
    except Exception:
        state["last_error"] = "SMTP_SEND_FAILED: 邮件发送失败"
        save_state(state)
        return backup

    sent_at = now.isoformat(timespec="seconds")
    for item in items:
        state["sent"][item["dedupe_key"]] = sent_at
    state["last_success_at"] = sent_at
    state["last_error"] = None
    state["sent_today"] = sum(
        1 for key in state["sent"] if key.startswith(now.date().isoformat() + "|")
    )
    save_state(state)
    return backup
