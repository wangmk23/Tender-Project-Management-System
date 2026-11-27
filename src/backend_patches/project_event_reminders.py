"""Project event (create/complete) email reminders service.

project-event-reminders-v1
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

PROJECT_EVENT_REMINDERS_SIGNATURE = "project-event-reminders-v1"


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


def run_project_event_reminders_if_due(ctx_or_now: Any = None, now: Any = None):
    ctx, now = _resolve_context(ctx_or_now, now)
    datetime = ctx.get("datetime", _default_datetime)
    joinedload = ctx.get("joinedload", _default_joinedload)
    load_app_settings = ctx.get("load_app_settings")
    SETTINGS_PATH = ctx.get("SETTINGS_PATH")
    Project = ctx.get("Project")
    import ctypes
    import ctypes.wintypes
    import json
    import os
    import smtplib
    import ssl
    import time
    import hashlib
    from datetime import timedelta
    from email.message import EmailMessage
    try:
        import reminder_routing
    except ModuleNotFoundError:
        from src.backend_patches import reminder_routing

    now = now or datetime.now()
    settings = load_app_settings()
    create_enabled = bool(settings.get("event_reminder_create_enabled"))
    complete_enabled = bool(settings.get("event_reminder_complete_enabled"))
    if not create_enabled and not complete_enabled:
        return None

    host = str(settings.get("smtp_host") or "").strip()
    sender = str(settings.get("smtp_sender") or "").strip()
    recipients = sorted(
        {
            str(value).strip()
            for value in settings.get("reminder_recipients", [])
            if str(value).strip()
        },
        key=str.casefold,
    )
    credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
    state_path = SETTINGS_PATH.with_name("project_events_state.json")
    if not host or not sender or not recipients or not credential_path.is_file():
        return None

    raw_state = None
    if state_path.is_file():
        try:
            raw_state = json.loads(state_path.read_text(encoding="utf-8"))
        except (OSError, UnicodeError, json.JSONDecodeError):
            return None
    use_v3 = (
        "reminder_recipient_groups" in settings
        or isinstance(raw_state, dict)
        and ("version" not in raw_state or raw_state.get("version") == 3)
    )

    if use_v3:
        def v3_empty_state():
            return {
                "version": 3,
                "initialized": False,
                "known_project_ids": [],
                "completed_project_ids": [],
                "sent_events": {},
                "pending_deliveries": {},
                "last_check_at": None,
                "last_success_at": None,
                "last_error": None,
                "recovered_stale_at": None,
            }

        def v3_parse_timestamp(value, allow_none=False):
            if value is None and allow_none:
                return None
            if not isinstance(value, str) or not value:
                raise ValueError("invalid project events state")
            parsed = datetime.fromisoformat(value)
            if parsed.microsecond:
                raise ValueError("invalid project events state")
            if parsed.tzinfo is not None:
                parsed = parsed.astimezone().replace(tzinfo=None)
            return parsed

        def v3_valid_ids(values, integer_ids=False):
            if not isinstance(values, list):
                return False
            normalized = []
            for value in values:
                if integer_ids:
                    if type(value) is int and value > 0:
                        text = str(value)
                    elif (
                        isinstance(value, str)
                        and value.isascii()
                        and value.isdigit()
                        and not value.startswith("0")
                    ):
                        text = value
                    else:
                        return False
                else:
                    if (
                        not isinstance(value, str)
                        or not value.isascii()
                        or not value.isdigit()
                        or value.startswith("0")
                    ):
                        return False
                    text = value
                normalized.append(text)
            return len(normalized) == len(set(normalized))

        def v3_load_state():
            if raw_state is None:
                return v3_empty_state(), "new"
            if not isinstance(raw_state, dict):
                raise ValueError("invalid project events state")
            v0_keys = {
                "initialized",
                "known_project_ids",
                "completed_project_ids",
                "sent_events",
                "last_check_at",
                "last_success_at",
                "last_error",
            }
            if "version" not in raw_state:
                if set(raw_state) != v0_keys:
                    raise ValueError("invalid project events state")
                if type(raw_state["initialized"]) is not bool:
                    raise ValueError("invalid project events state")
                if not v3_valid_ids(raw_state["known_project_ids"], integer_ids=True):
                    raise ValueError("invalid project events state")
                if not v3_valid_ids(raw_state["completed_project_ids"], integer_ids=True):
                    raise ValueError("invalid project events state")
                known = [str(value) for value in raw_state["known_project_ids"]]
                completed = [str(value) for value in raw_state["completed_project_ids"]]
                if not set(completed) <= set(known):
                    raise ValueError("invalid project events state")
                old_sent = raw_state["sent_events"]
                def valid_v0_event_key(key):
                    return isinstance(key, str) and (
                        key.startswith("project_create:")
                        or key.startswith("project_complete:")
                        or key.startswith("create|")
                        or key.startswith("complete|")
                    )

                if isinstance(old_sent, list):
                    if (
                        any(not valid_v0_event_key(key) for key in old_sent)
                        or len(old_sent) != len(set(old_sent))
                    ):
                        raise ValueError("invalid project events state")
                    migrated_sent = None
                elif isinstance(old_sent, dict):
                    if any(
                        not valid_v0_event_key(key) or not isinstance(value, str)
                        for key, value in old_sent.items()
                    ):
                        raise ValueError("invalid project events state")
                    migrated_sent = dict(old_sent)
                else:
                    raise ValueError("invalid project events state")
                last_check = v3_parse_timestamp(raw_state["last_check_at"])
                last_success = v3_parse_timestamp(
                    raw_state["last_success_at"], allow_none=True
                )
                if migrated_sent is not None and any(
                    v3_parse_timestamp(value) > last_check
                    for value in migrated_sent.values()
                ):
                    raise ValueError("invalid project events state")
                if last_success is not None and last_success > last_check:
                    raise ValueError("invalid project events state")
                if raw_state["last_error"] is not None and not isinstance(
                    raw_state["last_error"], str
                ):
                    raise ValueError("invalid project events state")
                migrated = v3_empty_state()
                migrated.update(
                    {
                        "initialized": raw_state["initialized"],
                        "known_project_ids": known,
                        "completed_project_ids": completed,
                        "sent_events": migrated_sent if migrated_sent is not None else {
                            key: raw_state["last_success_at"] or raw_state["last_check_at"]
                            for key in old_sent
                        },
                        "last_check_at": raw_state["last_check_at"],
                        "last_success_at": raw_state["last_success_at"],
                    }
                )
                return migrated, "v0"
            if raw_state.get("version") in {1, 2}:
                return v3_empty_state(), "legacy_versioned"
            expected = set(v3_empty_state())
            if raw_state.get("version") != 3 or set(raw_state) != expected:
                raise ValueError("invalid project events state")
            if type(raw_state["initialized"]) is not bool:
                raise ValueError("invalid project events state")
            if not v3_valid_ids(raw_state["known_project_ids"]):
                raise ValueError("invalid project events state")
            if not v3_valid_ids(raw_state["completed_project_ids"]):
                raise ValueError("invalid project events state")
            if not set(raw_state["completed_project_ids"]) <= set(
                raw_state["known_project_ids"]
            ):
                raise ValueError("invalid project events state")
            if not isinstance(raw_state["sent_events"], dict):
                raise ValueError("invalid project events state")
            if not isinstance(raw_state["pending_deliveries"], dict):
                raise ValueError("invalid project events state")
            last_check = v3_parse_timestamp(raw_state["last_check_at"], allow_none=True)
            last_success = v3_parse_timestamp(
                raw_state["last_success_at"], allow_none=True
            )
            recovered = v3_parse_timestamp(
                raw_state["recovered_stale_at"], allow_none=True
            )
            if raw_state["initialized"] and last_check is None:
                raise ValueError("invalid project events state")
            if last_success is not None and last_check is not None and last_success > last_check:
                raise ValueError("invalid project events state")
            if recovered is not None and last_check is not None and recovered > last_check:
                raise ValueError("invalid project events state")
            allowed_errors = set(reminder_routing.SAFE_ERROR_CODES) | {"STALE_STATE_REBASE"}
            if raw_state["last_error"] is not None and raw_state["last_error"] not in allowed_errors:
                raise ValueError("invalid project events state")
            required_delivery = {
                "event_key", "event_type", "recipient", "rules_fingerprint",
                "event", "delivery", "status", "attempts", "last_attempt_at",
                "next_attempt_at", "error_code", "created_at", "sent_at",
            }
            for delivery_key, record in raw_state["pending_deliveries"].items():
                if (
                    not isinstance(delivery_key, str)
                    or len(delivery_key) != 64
                    or not isinstance(record, dict)
                    or set(record) != required_delivery
                    or record["status"] not in {"pending", "sending", "sent", "failed"}
                    or type(record["attempts"]) is not int
                    or not 0 <= record["attempts"] <= 3
                    or record["error_code"] is not None
                    and record["error_code"] not in reminder_routing.SAFE_ERROR_CODES
                ):
                    raise ValueError("invalid project events state")
                v3_parse_timestamp(record["created_at"])
                v3_parse_timestamp(record["last_attempt_at"], allow_none=True)
                v3_parse_timestamp(record["next_attempt_at"], allow_none=True)
                v3_parse_timestamp(record["sent_at"], allow_none=True)
            return raw_state, "v3"

        def v3_save_state(value):
            temporary = state_path.with_suffix(state_path.suffix + ".tmp")
            temporary.write_text(
                json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            for attempt in range(5):
                try:
                    os.replace(temporary, state_path)
                    return
                except PermissionError:
                    if attempt == 4:
                        raise
                    time.sleep(0.02 * (attempt + 1))

        def v3_unprotect_secret(raw):
            hook = ctx.get("_REMINDER_UNPROTECT_SECRET")
            if hook:
                return hook(raw)
            if os.name != "nt":
                raise RuntimeError("SMTP 密码解密仅支持 Windows")
            class DataBlob(ctypes.Structure):
                _fields_ = [
                    ("size", ctypes.wintypes.DWORD),
                    ("data", ctypes.POINTER(ctypes.c_char)),
                ]
            source_buffer = ctypes.create_string_buffer(raw)
            source = DataBlob(
                len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char))
            )
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

        try:
            groups = reminder_routing.normalize_recipient_groups(settings)
            state, state_origin = v3_load_state()
        except (ValueError, reminder_routing.RecipientGroupValidationError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_INVALID"}

        projects = Project.query.options(joinedload(Project.stages)).all()
        try:
            try:
                from . import recycle_bin
            except ImportError:
                import recycle_bin
            projects = recycle_bin.filter_active_projects(db, projects)
        except Exception:
            pass
        current_ids = set()
        current_completed = set()
        projects_by_id = {}
        for project in projects:
            project_id = str(getattr(project, "id", ""))
            if (
                not project_id.isascii()
                or not project_id.isdigit()
                or project_id.startswith("0")
                or project_id in projects_by_id
            ):
                return {"ok": False, "job": "project_events", "error_code": "STATE_INVALID"}
            current_ids.add(project_id)
            projects_by_id[project_id] = project
            try:
                completed = (
                    not bool(getattr(project, "is_terminated", False))
                    and float(getattr(project, "progress", 0) or 0) >= 100
                )
            except (TypeError, ValueError):
                completed = False
            if completed:
                current_completed.add(project_id)

        checked_at = now.isoformat(timespec="seconds")
        previous_check = v3_parse_timestamp(state["last_check_at"], allow_none=True)
        if state_origin in {"new", "legacy_versioned"}:
            state = v3_empty_state()
            state.update(
                {
                    "initialized": True,
                    "known_project_ids": sorted(current_ids),
                    "completed_project_ids": sorted(current_completed),
                    "last_check_at": checked_at,
                    "last_success_at": checked_at,
                }
            )
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {"ok": True, "job": "project_events", "error_code": None, "pending_count": 0, "checked_at": checked_at}

        if state_origin == "v0":
            stale = previous_check is not None and now - previous_check > timedelta(hours=24)
            if stale:
                state["known_project_ids"] = sorted(current_ids)
                state["completed_project_ids"] = sorted(current_completed)
                state["last_error"] = "STALE_STATE_REBASE"
                state["recovered_stale_at"] = checked_at
            state["last_check_at"] = checked_at
            state["last_success_at"] = checked_at
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {
                "ok": True,
                "job": "project_events",
                "code": "STALE_STATE_REBASE" if stale else "STATE_MIGRATED",
                "error_code": state["last_error"],
                "pending_count": 0,
                "checked_at": checked_at,
            }

        if previous_check is not None and now - previous_check > timedelta(hours=24):
            state["known_project_ids"] = sorted(current_ids)
            state["completed_project_ids"] = sorted(current_completed)
            state["last_check_at"] = checked_at
            state["last_success_at"] = checked_at
            state["last_error"] = "STALE_STATE_REBASE"
            state["recovered_stale_at"] = checked_at
            state["pending_deliveries"] = {}
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {"ok": True, "job": "project_events", "code": "STALE_STATE_REBASE", "error_code": "STALE_STATE_REBASE", "pending_count": 0, "checked_at": checked_at}

        for record in state["pending_deliveries"].values():
            if record["status"] == "sending":
                record["status"] = "failed"
                record["attempts"] = 3
                record["error_code"] = "SMTP_SEND_FAILED"

        def project_event(event_key, event_type, project):
            return {
                "event_key": event_key,
                "event_type": event_type,
                "project_number": getattr(project, "number", "") or "",
                "project_name": getattr(project, "name", "") or "",
                "purchaser": getattr(project, "purchaser", "") or "",
                "method": getattr(project, "method", "") or "",
                "year": getattr(project, "year", "") or "",
                "event_at": checked_at,
                "progress": getattr(project, "progress", 0) or 0,
            }

        known_ids = set(state["known_project_ids"])
        completed_ids = set(state["completed_project_ids"])
        new_events = []
        if create_enabled:
            for project_id in sorted(current_ids - known_ids):
                key = f"create|{project_id}"
                if key not in state["sent_events"]:
                    new_events.append(project_event(key, "project_create", projects_by_id[project_id]))
        if complete_enabled:
            for project_id in sorted(current_completed - completed_ids):
                key = f"complete|{project_id}"
                if key not in state["sent_events"]:
                    new_events.append(project_event(key, "project_complete", projects_by_id[project_id]))

        for event in new_events:
            for delivery in reminder_routing.route_reminder_event(event, groups):
                delivery_key = hashlib.sha256(
                    (
                        event["event_key"]
                        + "\0"
                        + delivery["recipient"]
                        + "\0"
                        + delivery["rules_fingerprint"]
                    ).encode("utf-8")
                ).hexdigest()
                state["pending_deliveries"].setdefault(
                    delivery_key,
                    {
                        "event_key": event["event_key"],
                        "event_type": event["event_type"],
                        "recipient": delivery["recipient"],
                        "rules_fingerprint": delivery["rules_fingerprint"],
                        "event": event,
                        "delivery": delivery,
                        "status": "pending",
                        "attempts": 0,
                        "last_attempt_at": None,
                        "next_attempt_at": checked_at,
                        "error_code": None,
                        "created_at": checked_at,
                        "sent_at": None,
                    },
                )

        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        state["last_check_at"] = checked_at
        try:
            v3_save_state(state)
        except (OSError, UnicodeError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}

        due = []
        for delivery_key, record in state["pending_deliveries"].items():
            next_attempt = v3_parse_timestamp(record["next_attempt_at"], allow_none=True)
            event_enabled = (
                create_enabled if record["event_type"] == "project_create"
                else complete_enabled if record["event_type"] == "project_complete"
                else False
            )
            if (
                record["status"] == "pending"
                and record["attempts"] < 3
                and (next_attempt is None or next_attempt <= now)
                and event_enabled
                and reminder_routing.delivery_matches_current_rules(
                    record["event"], record["delivery"], groups
                )
            ):
                record["status"] = "sending"
                record["last_attempt_at"] = checked_at
                due.append((delivery_key, record))
        if not due:
            pending_count = sum(
                record["status"] == "pending"
                for record in state["pending_deliveries"].values()
            )
            try:
                v3_save_state(state)
            except (OSError, UnicodeError):
                return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
            return {"ok": True, "job": "project_events", "error_code": state["last_error"], "pending_count": pending_count, "checked_at": checked_at}

        try:
            v3_save_state(state)
        except (OSError, UnicodeError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
        try:
            secret = v3_unprotect_secret(credential_path.read_bytes()).decode("utf-8")
            messages = [
                (
                    delivery_key,
                    reminder_routing.render_recipient_message(
                        record["event"], record["delivery"], sender
                    ),
                )
                for delivery_key, record in due
            ]
            results = reminder_routing.send_delivery_batch(
                messages,
                {
                    "host": host,
                    "port": int(settings.get("smtp_port") or 465),
                    "security": str(settings.get("smtp_security") or "ssl"),
                    "username": str(settings.get("smtp_username") or ""),
                },
                secret,
                smtp_factory=ctx.get("_REMINDER_SMTP_FACTORY"),
            )
        except Exception:
            results = [
                {
                    "delivery_key": delivery_key,
                    "recipient": record["recipient"],
                    "status": "failed",
                    "error_code": "SMTP_SEND_FAILED",
                }
                for delivery_key, record in due
            ]

        first_error = None
        for result in results:
            record = state["pending_deliveries"][result["delivery_key"]]
            record["attempts"] += 1
            if result["status"] == "sent":
                record["status"] = "sent"
                record["sent_at"] = checked_at
                record["next_attempt_at"] = None
                record["error_code"] = None
            else:
                error_code = result["error_code"]
                first_error = first_error or error_code
                record["error_code"] = error_code
                terminal = error_code == "SMTP_AUTH_FAILED" or record["attempts"] >= 3
                record["status"] = "failed" if terminal else "pending"
                record["next_attempt_at"] = (
                    None
                    if terminal
                    else (now + timedelta(minutes=15)).isoformat(timespec="seconds")
                )

        event_keys = {record["event_key"] for _, record in due}
        for event_key in event_keys:
            records = [
                record
                for record in state["pending_deliveries"].values()
                if record["event_key"] == event_key
            ]
            if records and all(record["status"] == "sent" for record in records):
                state["sent_events"][event_key] = checked_at
        state["last_error"] = first_error
        if first_error is None:
            state["last_success_at"] = checked_at
        try:
            v3_save_state(state)
        except (OSError, UnicodeError):
            return {"ok": False, "job": "project_events", "error_code": "STATE_WRITE_FAILED"}
        pending_count = sum(
            record["status"] == "pending"
            for record in state["pending_deliveries"].values()
        )
        return {"ok": first_error is None, "job": "project_events", "error_code": first_error, "pending_count": pending_count, "checked_at": checked_at}

    def empty_state():
        return {
            "version": 2,
            "initialized": False,
            "known_project_ids": [],
            "completed_project_ids": [],
            "sent_events": {},
            "pending_events": {},
            "last_check_at": None,
            "last_success_at": None,
            "last_error": None,
            "recovered_stale_at": None,
        }

    def load_state():
        if not state_path.is_file():
            return empty_state(), False
        value = json.loads(state_path.read_text(encoding="utf-8"))
        if not isinstance(value, dict):
            raise ValueError("invalid project events state")
        full_keys = set(empty_state())
        legacy_keys = full_keys - {"recovered_stale_at"}
        value_keys = frozenset(value)
        if value_keys not in {frozenset(full_keys), frozenset(legacy_keys)}:
            raise ValueError("invalid project events state")
        value.setdefault("recovered_stale_at", None)

        def parse_timestamp(timestamp):
            if not isinstance(timestamp, str) or not timestamp:
                raise ValueError("invalid project events state")
            parsed = datetime.fromisoformat(timestamp)
            if (
                parsed.tzinfo is not None
                or parsed.microsecond
                or parsed.isoformat(timespec="seconds") != timestamp
            ):
                raise ValueError("invalid project events state")
            return parsed

        def valid_project_id(project_id):
            return (
                isinstance(project_id, str)
                and project_id.isascii()
                and project_id.isdigit()
                and not project_id.startswith("0")
            )

        def valid_project_ids(values):
            return (
                isinstance(values, list)
                and all(valid_project_id(item) for item in values)
                and len(values) == len(set(values))
            )

        def valid_event_key(event_key):
            if not isinstance(event_key, str):
                return False
            parts = event_key.split("|")
            return (
                len(parts) == 2
                and parts[0] in {"create", "complete"}
                and valid_project_id(parts[1])
            )

        if type(value["version"]) is not int or value["version"] not in {1, 2}:
            raise ValueError("invalid project events state")
        legacy = value["version"] == 1
        if type(value["initialized"]) is not bool:
            raise ValueError("invalid project events state")
        for key in ("known_project_ids", "completed_project_ids"):
            if not valid_project_ids(value[key]):
                raise ValueError("invalid project events state")
        if not isinstance(value["sent_events"], dict) or any(
            not valid_event_key(event_key)
            or not isinstance(sent_at, str)
            or not sent_at
            for event_key, sent_at in value["sent_events"].items()
        ):
            raise ValueError("invalid project events state")
        sent_times = {
            event_key: parse_timestamp(sent_at)
            for event_key, sent_at in value["sent_events"].items()
        }
        if not isinstance(value["pending_events"], dict):
            raise ValueError("invalid project events state")
        pending_times = {}
        legacy_pending = {}
        if legacy:
            for event_key, claim in value["pending_events"].items():
                if not valid_event_key(event_key):
                    raise ValueError("invalid project events state")
                if isinstance(claim, str):
                    status = "sending"
                    claimed_at = claim
                elif (
                    isinstance(claim, dict)
                    and set(claim) == {"status", "claimed_at"}
                    and isinstance(claim["status"], str)
                    and claim["status"] in {"claimed", "sending"}
                ):
                    status = claim["status"]
                    claimed_at = claim["claimed_at"]
                else:
                    raise ValueError("invalid project events state")
                pending_times[event_key] = parse_timestamp(claimed_at)
                legacy_pending[event_key] = (status, claimed_at)
        else:
            for event_key, claim in value["pending_events"].items():
                if (
                    not valid_event_key(event_key)
                    or not isinstance(claim, dict)
                    or set(claim) != {"status", "claimed_at"}
                    or not isinstance(claim["status"], str)
                    or claim["status"] not in {"claimed", "sending"}
                ):
                    raise ValueError("invalid project events state")
                pending_times[event_key] = parse_timestamp(claim["claimed_at"])
        if not set(value["completed_project_ids"]) <= set(value["known_project_ids"]):
            raise ValueError("invalid project events state")
        if set(value["sent_events"]) & set(value["pending_events"]):
            raise ValueError("invalid project events state")
        if value["last_error"] is not None and not isinstance(value["last_error"], str):
            raise ValueError("invalid project events state")

        last_check = (
            parse_timestamp(value["last_check_at"])
            if value["last_check_at"] is not None
            else None
        )
        last_success = (
            parse_timestamp(value["last_success_at"])
            if value["last_success_at"] is not None
            else None
        )
        recovered_stale = (
            parse_timestamp(value["recovered_stale_at"])
            if value["recovered_stale_at"] is not None
            else None
        )
        if value["initialized"]:
            if last_check is None:
                raise ValueError("invalid project events state")
        elif any(
            (
                value["known_project_ids"],
                value["completed_project_ids"],
                value["sent_events"],
                value["pending_events"],
                value["last_check_at"],
                value["last_success_at"],
                value["last_error"],
                value["recovered_stale_at"],
            )
        ):
            raise ValueError("invalid project events state")
        if last_success is not None and last_success > last_check:
            raise ValueError("invalid project events state")
        if recovered_stale is not None and recovered_stale > last_check:
            raise ValueError("invalid project events state")
        if last_check is not None and any(
            timestamp > last_check
            for timestamp in list(sent_times.values()) + list(pending_times.values())
        ):
            raise ValueError("invalid project events state")

        if legacy:
            migrated_pending = {}
            for event_key, (status, claimed_at) in legacy_pending.items():
                if status == "sending":
                    value["sent_events"].setdefault(event_key, claimed_at)
                else:
                    migrated_pending[event_key] = {
                        "status": "claimed",
                        "claimed_at": claimed_at,
                    }
            value["pending_events"] = migrated_pending
            value["version"] = 2
        return value, legacy

    def save_state(value):
        temporary = state_path.with_suffix(state_path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        for attempt in range(5):
            try:
                os.replace(temporary, state_path)
                return
            except PermissionError:
                if attempt == 4:
                    raise
                # Windows Defender/indexers can briefly retain the destination
                # after a read. Keep the atomic replace and retry for at most
                # 300 ms instead of weakening the durable-send guarantee.
                time.sleep(0.02 * (attempt + 1))

    def unprotect_secret(raw):
        hook = ctx.get("_REMINDER_UNPROTECT_SECRET")
        if hook:
            return hook(raw)
        if os.name != "nt":
            raise RuntimeError("SMTP 密码解密仅支持 Windows")

        class DataBlob(ctypes.Structure):
            _fields_ = [
                ("size", ctypes.wintypes.DWORD),
                ("data", ctypes.POINTER(ctypes.c_char)),
            ]

        source_buffer = ctypes.create_string_buffer(raw)
        source = DataBlob(
            len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char))
        )
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

    def build_message(event_type, project):
        message = EmailMessage()
        name = getattr(project, "name", "") or "-"
        if event_type == "create":
            message["Subject"] = f"项目新建提醒：{name}"
            headline = "新项目已创建，请及时跟进。"
            time_label = "创建时间"
        else:
            message["Subject"] = f"项目完成提醒：{name}"
            headline = "项目已完成全部流程节点。"
            time_label = "完成时间"
        message["From"] = sender
        message["To"] = ", ".join(recipients)
        message.set_content(
            "\n".join(
                [
                    headline,
                    "",
                    f"项目编号：{getattr(project, 'number', '') or '-'}",
                    f"项目名称：{name}",
                    f"采购人：{getattr(project, 'purchaser', '') or '-'}",
                    f"年度：{getattr(project, 'year', '') or '-'}",
                    f"采购方式：{getattr(project, 'method', '') or '-'}",
                    "",
                    f"{time_label}：{now.strftime('%Y-%m-%d %H:%M')}",
                ]
            )
        )
        return message

    try:
        state, migrated = load_state()
    except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
        return None

    projects = Project.query.options(joinedload(Project.stages)).all()
    try:
        try:
            from . import recycle_bin
        except ImportError:
            import recycle_bin
        projects = recycle_bin.filter_active_projects(db, projects)
    except Exception:
        pass
    current_ids = set()
    current_completed = set()
    projects_by_id = {}
    for project in projects:
        project_id = str(getattr(project, "id", ""))
        if (
            not project_id.isascii()
            or not project_id.isdigit()
            or project_id.startswith("0")
            or project_id in projects_by_id
        ):
            return None
        current_ids.add(project_id)
        projects_by_id[project_id] = project
        try:
            completed = (
                not bool(getattr(project, "is_terminated", False))
                and float(getattr(project, "progress", 0) or 0) >= 100
            )
        except (TypeError, ValueError):
            completed = False
        if completed:
            current_completed.add(project_id)

    previous_check = (
        datetime.fromisoformat(state["last_check_at"])
        if state["last_check_at"] is not None
        else None
    )
    checked_at = now.isoformat(timespec="seconds")
    if (
        state["initialized"]
        and previous_check is not None
        and now - previous_check > timedelta(hours=24)
    ):
        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        state["pending_events"] = {}
        state["last_check_at"] = checked_at
        state["last_success_at"] = checked_at
        state["last_error"] = "STALE_STATE_REBASE: 已跳过停机期间的历史项目事件"
        state["recovered_stale_at"] = checked_at
        try:
            save_state(state)
        except (OSError, UnicodeError):
            return None
        return None
    if state["initialized"]:
        known_ids_for_validation = set(state["known_project_ids"])
        existing_event_ids = {
            event_key.split("|", 1)[1]
            for event_key in set(state["sent_events"]) | set(state["pending_events"])
        }
        for project_id in current_ids - known_ids_for_validation - existing_event_ids:
            created_at = getattr(projects_by_id[project_id], "created_at", None)
            if isinstance(created_at, datetime):
                created = created_at
            else:
                try:
                    created = datetime.fromisoformat(str(created_at or ""))
                except (TypeError, ValueError):
                    return None
            if created.tzinfo is not None:
                created = created.astimezone().replace(tzinfo=None)
            if created <= previous_check:
                return None

    if migrated:
        try:
            save_state(state)
        except (OSError, UnicodeError):
            return None

    if not state.get("initialized"):
        state["initialized"] = True
        state["last_check_at"] = checked_at
        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        try:
            save_state(state)
        except (OSError, UnicodeError):
            pass
        return None

    # Only the persisted `sending` phase is ambiguous after a restart. A plain
    # claim proves SMTP was never called and is released for a normal retry.
    if state["pending_events"]:
        for event_key, claim in state["pending_events"].items():
            if claim["status"] == "sending":
                state["sent_events"].setdefault(event_key, claim["claimed_at"])
        state["pending_events"] = {}
        try:
            save_state(state)
        except (OSError, UnicodeError):
            return None

    state["last_check_at"] = checked_at

    known_ids = {str(value) for value in state["known_project_ids"]}
    completed_ids = {str(value) for value in state["completed_project_ids"]}
    pending = []
    if create_enabled:
        for project_id in sorted(current_ids - known_ids):
            event_key = f"create|{project_id}"
            if event_key not in state["sent_events"]:
                pending.append((event_key, "create", projects_by_id[project_id]))
    if complete_enabled:
        for project_id in sorted(current_completed - completed_ids):
            event_key = f"complete|{project_id}"
            if event_key not in state["sent_events"]:
                pending.append((event_key, "complete", projects_by_id[project_id]))

    if not pending:
        state["known_project_ids"] = sorted(current_ids)
        state["completed_project_ids"] = sorted(current_completed)
        try:
            save_state(state)
        except (OSError, UnicodeError):
            pass
        return None

    previous_known = list(state["known_project_ids"])
    previous_completed = list(state["completed_project_ids"])
    for event_key, _, _ in pending:
        state["pending_events"][event_key] = {
            "status": "claimed",
            "claimed_at": checked_at,
        }
    try:
        save_state(state)
    except (OSError, UnicodeError):
        return None

    connection_ready = False
    send_started = False
    try:
        password = unprotect_secret(credential_path.read_bytes()).decode("utf-8")
        factory = ctx.get("_REMINDER_SMTP_FACTORY")
        port = int(settings.get("smtp_port") or 465)
        security = str(settings.get("smtp_security") or "ssl")
        if security == "ssl":
            constructor = factory or smtplib.SMTP_SSL
            connection = constructor(
                host, port, timeout=15, context=ssl.create_default_context()
            )
        else:
            constructor = factory or smtplib.SMTP
            connection = constructor(host, port, timeout=15)
        with connection as smtp:
            if security == "starttls":
                smtp.starttls(context=ssl.create_default_context())
            username = str(settings.get("smtp_username") or "")
            if username:
                smtp.login(username, password)
            connection_ready = True
            for event_key, event_type, project in pending:
                send_started = False
                message = build_message(event_type, project)
                message.as_bytes()
                state["pending_events"][event_key]["status"] = "sending"
                try:
                    save_state(state)
                except (OSError, UnicodeError):
                    return None
                send_started = True
                smtp.send_message(message)
                state["sent_events"][event_key] = checked_at
                state["pending_events"].pop(event_key, None)
                try:
                    save_state(state)
                except (OSError, UnicodeError):
                    # The durable claim remains. A later scan will fail closed
                    # instead of sending a message that may already be accepted.
                    return None
    except Exception as exc:
        if isinstance(exc, smtplib.SMTPAuthenticationError):
            state["last_error"] = "SMTP_AUTH_FAILED: SMTP 身份验证失败"
        elif isinstance(exc, ssl.SSLError):
            state["last_error"] = "SMTP_TLS_FAILED: SMTP TLS 协商失败"
        elif isinstance(exc, (TimeoutError, OSError)):
            state["last_error"] = "SMTP_CONNECTION_FAILED: 无法连接 SMTP 服务器"
        elif isinstance(exc, smtplib.SMTPException):
            state["last_error"] = "SMTP_SEND_FAILED: SMTP 服务器拒绝发送"
        else:
            state["last_error"] = "SMTP_SEND_FAILED: 邮件发送失败"
        state["known_project_ids"] = previous_known
        state["completed_project_ids"] = previous_completed
        confirmed_rejection = isinstance(
            exc,
            (
                smtplib.SMTPDataError,
                smtplib.SMTPRecipientsRefused,
                smtplib.SMTPSenderRefused,
                smtplib.SMTPHeloError,
                smtplib.SMTPNotSupportedError,
            ),
        )
        definitely_not_sent = (
            not connection_ready or not send_started or confirmed_rejection
        )
        if definitely_not_sent:
            for claim in state["pending_events"].values():
                if claim["status"] == "sending":
                    claim["status"] = "claimed"
        # For an ambiguous active send, retain its `sending` claim and every
        # later `claimed` event. Restart recovery suppresses only the ambiguous
        # message and retries events for which SMTP was never called.
        try:
            save_state(state)
        except (OSError, UnicodeError):
            pass
        return None

    state["known_project_ids"] = sorted(current_ids)
    state["completed_project_ids"] = sorted(current_completed)
    state["last_success_at"] = checked_at
    state["last_error"] = None
    try:
        save_state(state)
    except (OSError, UnicodeError):
        pass
    return None
