"""Compile targeted Python 3.12 code-object replacements into PyInstaller data."""

from __future__ import annotations

import argparse
import importlib.util
import marshal
import os
import struct
import sys
import tempfile
import types
import zlib
from pathlib import Path


PYZ_MAGIC = b"PYZ\0"
PYZ_HEADER_LENGTH = 12
API_EXPORT_XLSX_MARKERS = ("ProjectList_", "[Content_Types].xml")
REMINDER_SCHEDULER_MARKERS = (
    "smtplib",
    "reminder_send_log.json",
    "registration_end",
    "bid_opening",
    "CryptUnprotectData",
)
PROJECT_EVENT_MARKERS = (
    "project_events_state.json",
    "pending_events",
    "create|",
    "complete|",
)
AUTO_COMPLETION_MARKERS = (
    "stage_auto_completion_state.json",
    "stage_auto_completion_log.jsonl",
    "stage_auto_completion_audit",
    "auto_complete_stage",
    "auto_completion",
    "auto_completion_policies",
)
BACKEND_VERSION_TARGETS = ("api_system_info", "health")
BACKEND_VERSION_SOURCE = "v5.8.5"
BACKEND_VERSION_SOURCES = ("v5.8.16", "v5.8.15", "v5.8.5", "v5.8.8", "v5.8.12", "v5.8.13", "v5.8.14")
BACKEND_VERSION_TARGET = "v5.8.17"
ATTACHMENT_LIMIT_SOURCE_BYTES = 200 * 1024 * 1024
ATTACHMENT_LIMIT_TARGET_BYTES = 1024 * 1024 * 1024
ATTACHMENT_LIMIT_SOURCE_LABEL = "200MB限制"
ATTACHMENT_LIMIT_TARGET_LABEL = "1GB限制"
REGISTRATION_SERIALIZER_MARKERS = {
    "registration_method",
    "attachments",
    "company_name",
}
CONSORTIUM_MARKERS = (
    "bidder_type",
    "consortium_members",
    "registration_consortium_members",
)
# 受控补丁模块签名：已存在于正式 EXE（>= v5.8.8 时携带旧版补丁）的模块必须
# 至少包含一个本签名才允许走替换路径；不包含任何签名的同名条目视为未知来源
# 碰撞，必须拒绝（防供应链注入/误覆盖）。签名取自各模块从首次引入即稳定的
# 模块 docstring，旧版与新版均包含。
CONTROLLED_MODULE_SIGNATURES = {
    "online_bidding": "external-online-bidding-v1",
    "data_safety": "Verified, additive-only SQLite migrations for the packaged application.",
    "consortium_registration": "Structured consortium storage helpers for the frozen application patch.",
    "project_activity": "Project-scoped activity classification, sanitization, persistence, and reads.",
    "signed_attachments": "signed-attachments-v1",
    "lot_supplier_risk": "Lot-level supplier shortage rules, state, audit, and retender helpers.",
    "reminder_routing": "Pure recipient-group routing and SMTP delivery helpers.",
    "stage_workflow": "stage-workflow-order-v1",
    "stage_templates": "procurement-stage-templates-v1",
    "device_admission": "Browser-token device admission for the frozen V5 application.",
    "device_keyring": "Portable encrypted keyring for V5 device admission migration.",
    "device_access_page": "Minimal anonymous device-access request page for the frozen V5 application.",
    "http_security": "HTTP response and access-log hardening for the frozen V5 application.",
    "data_recovery": "Local-only recovery-key binding for the frozen V5 application.",
}


def require_python312(version=None) -> None:
    current = tuple(version or sys.version_info[:2])
    if current != (3, 12):
        raise RuntimeError(
            f"module patches require Python 3.12, current={current[0]}.{current[1]}"
        )


def replacement_code(source_path: Path, function_name: str):
    namespace = {}
    source = Path(source_path).read_text(encoding="utf-8")
    exec(compile(source, str(source_path), "exec"), namespace)
    value = namespace.get(function_name)
    if not isinstance(value, types.FunctionType):
        raise KeyError(f"replacement function not found: {function_name}")
    return value.__code__


def compile_source_module(source_path: Path) -> bytes:
    source_path = Path(source_path)
    source = source_path.read_text(encoding="utf-8")
    return marshal.dumps(compile(source, str(source_path), "exec"))


def replace_code(root, replacements):
    counts = {name: 0 for name in replacements}

    def visit(code):
        constants = []
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                value = visit(value)
                if value.co_name in replacements:
                    counts[value.co_name] += 1
                    value = replacements[value.co_name]
            constants.append(value)
        return code.replace(co_consts=tuple(constants))

    patched = visit(root)
    missing = [name for name, count in counts.items() if count == 0]
    duplicate = [name for name, count in counts.items() if count > 1]
    if missing:
        raise KeyError(f"missing code objects: {missing}")
    if duplicate:
        raise ValueError(f"duplicate code objects: {duplicate}")
    return patched


def _named_code_objects(root, name: str) -> list[types.CodeType]:
    matches = []

    def visit(code):
        if code.co_name == name:
            matches.append(code)
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                visit(value)

    visit(root)
    return matches


def preserve_upload_limit_login_wrapper(original, replacement):
    """Keep the formal login decorator wrapper that installs upload-limit routes."""
    if "install_upload_limit_settings" in _code_markers(original):
        return original
    return replacement


def replace_registration_serializer(root, replacement):
    matches = [
        code
        for code in _named_code_objects(root, "to_dict")
        if REGISTRATION_SERIALIZER_MARKERS <= set(code.co_names)
    ]
    if len(matches) != 1:
        raise ValueError(
            "registration serializer target count must be one, "
            f"found {len(matches)}"
        )
    target = matches[0]
    replacement = replacement.replace(
        co_name=target.co_name,
        co_qualname=target.co_qualname,
    )
    replaced = 0

    def visit(code):
        nonlocal replaced
        constants = []
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                if value is target:
                    value = replacement
                    replaced += 1
                else:
                    value = visit(value)
            constants.append(value)
        return code.replace(co_consts=tuple(constants))

    result = visit(root)
    if replaced != 1:
        raise ValueError(f"registration serializer replacement count is {replaced}")
    return result


def replace_exact_version_targets(root):
    replacements = {}
    for name in BACKEND_VERSION_TARGETS:
        matches = _named_code_objects(root, name)
        if len(matches) != 1:
            raise ValueError(
                f"backend version target {name!r} count must be one, found {len(matches)}"
            )
        code = matches[0]
        source_count = sum(value in BACKEND_VERSION_SOURCES and value != BACKEND_VERSION_TARGET for value in code.co_consts)
        target_count = sum(value == BACKEND_VERSION_TARGET for value in code.co_consts)
        if source_count == 0 and target_count == 1:
            continue
        if source_count != 1 or target_count:
            raise ValueError(
                f"backend version target {name!r} has unexpected constants: "
                f"source_count={source_count}, target_count={target_count}"
            )
        replacements[name] = code.replace(
            co_consts=tuple(
                BACKEND_VERSION_TARGET if value in BACKEND_VERSION_SOURCES else value
                for value in code.co_consts
            )
        )
    return replace_code(root, replacements)


def replace_attachment_upload_limit(root):
    """Raise the packaged backend upload ceiling from 200 MB to 1 GB."""

    counts = {
        "source_bytes": 0,
        "target_bytes": 0,
        "source_labels": 0,
        "target_labels": 0,
    }

    def visit(code):
        constants = []
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                value = visit(value)
            elif value == ATTACHMENT_LIMIT_SOURCE_BYTES:
                counts["source_bytes"] += 1
                value = ATTACHMENT_LIMIT_TARGET_BYTES
            elif value == ATTACHMENT_LIMIT_TARGET_BYTES:
                counts["target_bytes"] += 1
            elif isinstance(value, str):
                counts["source_labels"] += value.count(ATTACHMENT_LIMIT_SOURCE_LABEL)
                counts["target_labels"] += value.count(ATTACHMENT_LIMIT_TARGET_LABEL)
                value = value.replace(
                    ATTACHMENT_LIMIT_SOURCE_LABEL,
                    ATTACHMENT_LIMIT_TARGET_LABEL,
                )
            constants.append(value)
        return code.replace(co_consts=tuple(constants))

    patched = visit(root)
    if not (
        (counts["source_bytes"] == 1 and counts["target_bytes"] == 0)
        or (counts["source_bytes"] == 0 and counts["target_bytes"] == 1)
    ):
        raise ValueError(f"unexpected attachment byte-limit constants: {counts}")
    if counts["source_labels"] and counts["target_labels"]:
        raise ValueError(f"mixed attachment limit labels: {counts}")
    return patched


def verify_attachment_upload_limit(root) -> None:
    byte_values = []
    labels = []

    def visit(code):
        for value in code.co_consts:
            if isinstance(value, types.CodeType):
                visit(value)
            elif isinstance(value, int):
                if value in {ATTACHMENT_LIMIT_SOURCE_BYTES, ATTACHMENT_LIMIT_TARGET_BYTES}:
                    byte_values.append(value)
            elif isinstance(value, str):
                if ATTACHMENT_LIMIT_SOURCE_LABEL in value:
                    labels.append(ATTACHMENT_LIMIT_SOURCE_LABEL)
                if ATTACHMENT_LIMIT_TARGET_LABEL in value:
                    labels.append(ATTACHMENT_LIMIT_TARGET_LABEL)

    visit(root)
    if byte_values != [ATTACHMENT_LIMIT_TARGET_BYTES]:
        raise ValueError(f"attachment upload byte limit verification failed: {byte_values}")
    if ATTACHMENT_LIMIT_SOURCE_LABEL in labels:
        raise ValueError(f"attachment upload label verification failed: {labels}")


def stage_with_missing_scheduler_jobs(stage_code, event_code):
    template = compile(
        "def _auto_advance_stages():\n"
        "    def _event_placeholder(now=None):\n"
        "        return None\n"
        "    def _stage_impl():\n"
        "        return None\n"
        "    with app.app_context():\n"
        "        try:\n"
        "            _event_placeholder()\n"
        "        except Exception as _job_error:\n"
        "            print(f'Scheduler project-event error: {_job_error}')\n"
        "    return _stage_impl()\n",
        "<integrated-missing-scheduler-jobs>",
        "exec",
    )
    wrapper = _named_code_objects(template, "_auto_advance_stages")[0]
    stage_impl = stage_code.replace(
        co_name="_stage_impl",
        co_qualname="_stage_impl",
    )
    return replace_code(
        wrapper,
        {
            "_event_placeholder": event_code,
            "_stage_impl": stage_impl,
        },
    )


def reminder_with_legacy_scheduler_signature(implementation_code):
    template = compile(
        "def run_scheduled_backup_if_due(now=None):\n"
        "    def _scheduled_backup_impl(now=None, job='backup'):\n"
        "        return None\n"
        "    _backup_result = None\n"
        "    try:\n"
        "        _backup_result = _scheduled_backup_impl(now=now, job='backup')\n"
        "    except Exception as _backup_error:\n"
        "        print(f'Scheduler backup error: {_backup_error}')\n"
        "    try:\n"
        "        _scheduled_backup_impl(now=now, job='digest')\n"
        "    except Exception as _digest_error:\n"
        "        print(f'Scheduler digest error: {_digest_error}')\n"
        "    return _backup_result\n",
        "<legacy-reminder-scheduler-signature>",
        "exec",
    )
    wrapper = _named_code_objects(template, "run_scheduled_backup_if_due")[0]
    implementation = implementation_code.replace(
        co_name="_scheduled_backup_impl",
        co_qualname="_scheduled_backup_impl",
    )
    return replace_code(wrapper, {"_scheduled_backup_impl": implementation})


def _read_pyz(raw: bytes):
    if len(raw) < PYZ_HEADER_LENGTH or raw[:4] != PYZ_MAGIC:
        raise ValueError("invalid PYZ magic")
    toc_offset = struct.unpack("!i", raw[8:12])[0]
    if not PYZ_HEADER_LENGTH <= toc_offset <= len(raw):
        raise ValueError("invalid PYZ TOC offset")
    toc = list(marshal.loads(raw[toc_offset:]))
    if not toc:
        raise ValueError("empty PYZ TOC")
    seen_names = set()
    duplicate_names = []
    for name, _ in toc:
        if name in seen_names and name not in duplicate_names:
            duplicate_names.append(name)
        seen_names.add(name)
    if duplicate_names:
        raise ValueError(f"duplicate PYZ TOC names: {sorted(duplicate_names)!r}")
    for name, entry in toc:
        if len(entry) != 3:
            raise ValueError(f"invalid PYZ entry: {name!r}")
        _, offset, length = entry
        if offset < PYZ_HEADER_LENGTH or length < 0 or offset + length > toc_offset:
            raise ValueError(f"invalid PYZ payload bounds: {name!r}")
    return toc, toc_offset


def _pyz_entry(raw: bytes, toc, name: str) -> bytes:
    entries = dict(toc)
    if name not in entries:
        raise KeyError(f"missing PYZ entry: {name}")
    _, offset, length = entries[name]
    return zlib.decompress(raw[offset : offset + length])


def _rebuild_pyz(
    raw: bytes,
    replacement_name: str,
    replacement_raw: bytes,
    additions: dict[str, bytes] | None = None,
) -> bytes:
    toc, _ = _read_pyz(raw)
    entries = dict(toc)
    if replacement_name not in entries:
        raise KeyError(f"missing PYZ entry: {replacement_name}")
    additions = dict(additions or {})
    collisions = sorted(set(entries) & set(additions))
    if collisions:
        raise ValueError(f"PYZ addition already exists: {collisions!r}")

    data_start = min(entry[1] for _, entry in toc)
    output = bytearray(raw[:data_start])
    new_toc = []
    for name, (typecode, offset, length) in toc:
        if name == replacement_name:
            compressed = zlib.compress(replacement_raw, level=9)
        else:
            compressed = raw[offset : offset + length]
        new_toc.append((name, (typecode, len(output), len(compressed))))
        output.extend(compressed)

    for name, addition_raw in additions.items():
        compressed = zlib.compress(addition_raw, level=9)
        new_toc.append((name, (0, len(output), len(compressed))))
        output.extend(compressed)

    toc_offset = len(output)
    output.extend(marshal.dumps(new_toc))
    output[8:12] = struct.pack("!i", toc_offset)
    return bytes(output)


def _rebuild_pyz_upsert(
    raw: bytes,
    replacements: dict[str, bytes],
    additions: dict[str, bytes] | None = None,
) -> bytes:
    """Rebuild a PYZ replacing *replacements* (must already exist) and adding
    *additions* (must not exist yet). Unlike ``_rebuild_pyz`` this supports
    replacing multiple existing entries in one pass, which is required when
    the source EXE already carries patched modules (>= v5.8.8 builds)."""
    toc, _ = _read_pyz(raw)
    entries = dict(toc)
    replacements = dict(replacements or {})
    additions = dict(additions or {})
    missing_replacements = sorted(set(replacements) - set(entries))
    if missing_replacements:
        raise KeyError(f"missing PYZ replacement entries: {missing_replacements!r}")
    collision_additions = sorted(set(entries) & set(additions))
    if collision_additions:
        raise ValueError(
            f"PYZ addition already exists: {collision_additions!r}"
        )
    overlap = sorted(set(replacements) & set(additions))
    if overlap:
        raise ValueError(f"PYZ replacement/addition overlap: {overlap!r}")

    data_start = min(entry[1] for _, entry in toc)
    output = bytearray(raw[:data_start])
    new_toc = []
    for name, (typecode, offset, length) in toc:
        if name in replacements:
            compressed = zlib.compress(replacements[name], level=9)
        else:
            compressed = raw[offset : offset + length]
        new_toc.append((name, (typecode, len(output), len(compressed))))
        output.extend(compressed)

    for name, addition_raw in additions.items():
        compressed = zlib.compress(addition_raw, level=9)
        new_toc.append((name, (0, len(output), len(compressed))))
        output.extend(compressed)

    toc_offset = len(output)
    output.extend(marshal.dumps(new_toc))
    output[8:12] = struct.pack("!i", toc_offset)
    return bytes(output)


def _write_atomic(path: Path, value: bytes) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, dir=path.parent) as stream:
            temporary = Path(stream.name)
            stream.write(value)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        temporary = None
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def compile_patches(
    *,
    desktop_input: Path,
    pyz_input: Path,
    app_replacements: Path,
    desktop_replacements: Path,
    purchaser_module: Path,
    data_safety_module: Path,
    consortium_module: Path,
    project_activity_module: Path,
    data_import_module: Path,
    signed_attachments_module: Path,
    device_admission_module: Path,
    device_keyring_module: Path,
    device_access_page_module: Path,
    http_security_module: Path,
    data_recovery_module: Path,
    data_security_replacements: Path,
    desktop_output: Path,
    pyz_output: Path,
    lot_supplier_risk_module: Path | None = None,
    reminder_routing_module: Path | None = None,
    stage_workflow_module: Path | None = None,
    stage_templates_module: Path | None = None,
    skip_version_bump: bool = False,
) -> None:
    require_python312()

    pyz_raw = Path(pyz_input).read_bytes()
    pyz_toc, _ = _read_pyz(pyz_raw)
    app_root = marshal.loads(_pyz_entry(pyz_raw, pyz_toc, "app"))
    data_security_root = marshal.loads(
        _pyz_entry(pyz_raw, pyz_toc, "data_security")
    )
    data_security_root = replace_code(
        data_security_root,
        {
            "load_or_create_master_key": replacement_code(
                data_security_replacements, "load_or_create_master_key"
            )
        },
    )
    event_code = replacement_code(
        app_replacements, "run_project_event_reminders_if_due"
    )
    event_count = len(
        _named_code_objects(app_root, "run_project_event_reminders_if_due")
    )
    if event_count > 1:
        raise ValueError(
            "project event target count must be zero or one, "
            f"found {event_count}"
        )

    desktop_root = marshal.loads(Path(desktop_input).read_bytes())
    desktop_root = replace_code(
        desktop_root,
        {
            "main": replacement_code(desktop_replacements, "main"),
            "_scheduler_loop": replacement_code(
                desktop_replacements, "_scheduler_loop"
            ),
        },
    )

    purchaser_count = sum(
        name == "purchaser_classification" for name, _ in pyz_toc
    )
    if purchaser_count > 1:
        raise ValueError(
            "controlled purchaser replacement requires exactly one existing "
            f"PYZ entry, found {purchaser_count}"
        )
    original_stages = _named_code_objects(app_root, "_auto_advance_stages")
    if len(original_stages) != 1:
        raise ValueError(
            "auto-completion target count must be one, "
            f"found {len(original_stages)}"
        )
    event_nested_in_stage = bool(
        _named_code_objects(
            original_stages[0], "run_project_event_reminders_if_due"
        )
    )
    stage_code = replacement_code(app_replacements, "_auto_advance_stages")
    if event_count == 0 or event_nested_in_stage:
        stage_code = stage_with_missing_scheduler_jobs(stage_code, event_code)
    original_reminder = _named_code_objects(app_root, "run_scheduled_backup_if_due")
    if len(original_reminder) != 1:
        raise ValueError(
            "reminder scheduler target count must be one, "
            f"found {len(original_reminder)}"
        )
    reminder_code = replacement_code(
        app_replacements, "run_scheduled_backup_if_due"
    )
    reminder_shapes = (original_reminder[0].co_argcount, reminder_code.co_argcount)
    if reminder_shapes == (1, 2):
        reminder_code = reminder_with_legacy_scheduler_signature(reminder_code)
    elif reminder_shapes[0] != reminder_shapes[1]:
        raise ValueError(
            "unsupported reminder scheduler positional signature change: "
            f"source={reminder_shapes[0]}, replacement={reminder_shapes[1]}"
        )
    original_login_required = _named_code_objects(app_root, "login_required")
    if len(original_login_required) != 1:
        raise ValueError(
            "login_required target count must be one, "
            f"found {len(original_login_required)}"
        )
    login_required_code = preserve_upload_limit_login_wrapper(
        original_login_required[0],
        replacement_code(app_replacements, "login_required"),
    )
    app_replacement_codes = {
            "login_required": login_required_code,
            "api_get_settings": replacement_code(
                app_replacements, "api_get_settings"
            ),
            "api_update_settings": replacement_code(
                app_replacements, "api_update_settings"
            ),
            "api_export": replacement_code(app_replacements, "api_export"),
            "run_scheduled_backup_if_due": reminder_code,
            "_auto_advance_stages": stage_code,
            "api_get_registrations": replacement_code(
                app_replacements, "api_get_registrations"
            ),
            "api_create_registration": replacement_code(
                app_replacements, "api_create_registration"
            ),
            "api_update_registration": replacement_code(
                app_replacements, "api_update_registration"
            ),
            "api_delete_registration": replacement_code(
                app_replacements, "api_delete_registration"
            ),
        }
    for optional_name in (
        "get_export_dir",
        "save_app_settings",
        "api_projects",
        "api_project",
        "api_update_stage",
        "api_create_project",
        "api_create_lot",
        "api_update_lot",
        "api_delete_lot",
    ):
        targets = _named_code_objects(app_root, optional_name)
        if len(targets) > 1:
            raise ValueError(
                f"optional lot supplier target {optional_name} must be unique, found {len(targets)}"
            )
        if targets:
            app_replacement_codes[optional_name] = replacement_code(
                app_replacements, optional_name
            )
    if event_count == 1 and not event_nested_in_stage:
        app_replacement_codes["run_project_event_reminders_if_due"] = event_code
    app_root = replace_code(app_root, app_replacement_codes)
    app_root = replace_registration_serializer(
        app_root,
        replacement_code(app_replacements, "supplier_registration_to_dict"),
    )
    app_root = replace_attachment_upload_limit(app_root)
    if not skip_version_bump:
        app_root = replace_exact_version_targets(app_root)

    purchaser_raw = compile_source_module(purchaser_module)
    data_safety_raw = compile_source_module(data_safety_module)
    consortium_raw = compile_source_module(consortium_module)
    project_activity_raw = compile_source_module(project_activity_module)
    data_import_raw = compile_source_module(data_import_module)
    signed_attachments_raw = compile_source_module(signed_attachments_module)
    device_admission_raw = compile_source_module(device_admission_module)
    device_keyring_raw = compile_source_module(device_keyring_module)
    device_access_page_raw = compile_source_module(device_access_page_module)
    http_security_raw = compile_source_module(http_security_module)
    data_recovery_raw = compile_source_module(data_recovery_module)
    lot_supplier_risk_raw = compile_source_module(
        lot_supplier_risk_module
        or Path(__file__).resolve().parents[1] / "src" / "backend_patches" / "lot_supplier_risk.py"
    )
    reminder_routing_raw = compile_source_module(
        reminder_routing_module
        or Path(__file__).resolve().parents[1] / "src" / "backend_patches" / "reminder_routing.py"
    )
    stage_workflow_raw = compile_source_module(
        stage_workflow_module
        or Path(__file__).resolve().parents[1] / "src" / "backend_patches" / "stage_workflow.py"
    )
    stage_templates_raw = compile_source_module(
        stage_templates_module
        or Path(__file__).resolve().parents[1] / "src" / "backend_patches" / "stage_templates.py"
    )
    existing_entries = dict(pyz_toc)
    module_replacements = {
        "online_bidding": compile_source_module(Path(__file__).resolve().parents[1] / "src" / "backend_patches" / "online_bidding.py"),
        "data_safety": data_safety_raw,
        "consortium_registration": consortium_raw,
        "project_activity": project_activity_raw,
        "data_import": data_import_raw,
        "signed_attachments": signed_attachments_raw,
        "lot_supplier_risk": lot_supplier_risk_raw,
        "reminder_routing": reminder_routing_raw,
        "stage_workflow": stage_workflow_raw,
        "stage_templates": stage_templates_raw,
        "device_admission": device_admission_raw,
        "device_keyring": device_keyring_raw,
        "device_access_page": device_access_page_raw,
        "http_security": http_security_raw,
        "data_recovery": data_recovery_raw,
    }
    # 已存在的模块只有携带受控补丁签名才允许替换（正式 EXE >= v5.8.8 时携带
    # 旧版补丁模块）；未知来源的同名条目必须拒绝，保持碰撞防护契约。
    uncontrolled_collisions = []
    for name, signature in CONTROLLED_MODULE_SIGNATURES.items():
        if name in existing_entries and not _is_controlled_module(
            marshal.loads(_pyz_entry(pyz_raw, pyz_toc, name)), signature
        ):
            uncontrolled_collisions.append(name)
    if uncontrolled_collisions:
        raise ValueError(
            "uncontrolled PYZ module already exists: "
            f"{sorted(uncontrolled_collisions)!r}"
        )
    additions = {
        name: raw
        for name, raw in module_replacements.items()
        if name not in existing_entries
    }
    replacements = {
        name: raw
        for name, raw in module_replacements.items()
        if name in existing_entries
    }
    if "smtplib" not in existing_entries:
        smtp_spec = importlib.util.find_spec("smtplib")
        if smtp_spec is None or not smtp_spec.origin:
            raise RuntimeError("Python 3.12 standard-library smtplib source is unavailable")
        smtp_path = Path(smtp_spec.origin)
        smtp_source = smtp_path.read_text(encoding="utf-8")
        additions["smtplib"] = marshal.dumps(
            compile(smtp_source, str(smtp_path), "exec")
        )
    if purchaser_count == 1:
        pyz_raw = _rebuild_pyz(
            pyz_raw,
            "purchaser_classification",
            purchaser_raw,
        )
    else:
        additions["purchaser_classification"] = purchaser_raw
    patched_pyz = _rebuild_pyz_upsert(
        pyz_raw,
        replacements={
            "app": marshal.dumps(app_root),
            "data_security": marshal.dumps(data_security_root),
            **replacements,
        },
        additions=additions,
    )

    _write_atomic(Path(desktop_output), marshal.dumps(desktop_root))
    _write_atomic(
        Path(pyz_output),
        patched_pyz,
    )


def _code_markers(root) -> set[str]:
    markers = set()

    def visit(value):
        if isinstance(value, str):
            markers.add(value)
        elif isinstance(value, (tuple, list, set, frozenset)):
            for item in value:
                visit(item)
        elif isinstance(value, types.CodeType):
            markers.update(value.co_names)
            for item in value.co_consts:
                visit(item)

    visit(root)
    return markers


def _missing_code_markers(root, expected) -> list[str]:
    values = _code_markers(root)
    return [
        marker
        for marker in expected
        if not any(marker in value for value in values)
    ]


def _is_controlled_module(root, signature: str) -> bool:
    """True when *root* carries a stable controlled-patch signature.

    Used to distinguish an already-packaged controlled patch module (which may
    be replaced) from an unknown same-name module (which must be rejected to
    keep the collision guard intact)."""
    return any(signature in value for value in _code_markers(root))


def verify_patches(
    desktop_path: Path,
    pyz_path: Path,
    *,
    app_markers=(
        "startup_enabled",
        "ProjectManagementSystemDesktop",
        "purchaser_board_view",
        "purchaser_board_action",
        "purchaser_classification",
        "project_activity_view",
        "project activity audit failed",
    ),
    desktop_markers=("--startup-minimized", "hidden"),
) -> None:
    require_python312()
    desktop_root = marshal.loads(Path(desktop_path).read_bytes())
    pyz_raw = Path(pyz_path).read_bytes()
    toc, _ = _read_pyz(pyz_raw)
    toc_names = [name for name, _ in toc]
    purchaser_count = toc_names.count("purchaser_classification")
    data_safety_count = toc_names.count("data_safety")
    consortium_count = toc_names.count("consortium_registration")
    project_activity_count = toc_names.count("project_activity")
    data_import_count = toc_names.count("data_import")
    signed_attachments_count = toc_names.count("signed_attachments")
    lot_supplier_risk_count = toc_names.count("lot_supplier_risk")
    reminder_routing_count = toc_names.count("reminder_routing")
    stage_templates_count = toc_names.count("stage_templates")
    stage_workflow_count = toc_names.count("stage_workflow")
    device_admission_count = toc_names.count("device_admission")
    device_keyring_count = toc_names.count("device_keyring")
    device_access_page_count = toc_names.count("device_access_page")
    http_security_count = toc_names.count("http_security")
    data_recovery_count = toc_names.count("data_recovery")
    data_security_count = toc_names.count("data_security")
    customer_count = toc_names.count("customer_management")
    if (
        purchaser_count != 1
        or data_safety_count != 1
        or consortium_count != 1
        or project_activity_count != 1
        or data_import_count != 1
        or signed_attachments_count != 1
        or lot_supplier_risk_count != 1
        or reminder_routing_count != 1
        or stage_templates_count != 1
        or stage_workflow_count != 1
        or device_admission_count != 1
        or device_keyring_count != 1
        or device_access_page_count != 1
        or http_security_count != 1
        or data_recovery_count != 1
        or data_security_count != 1
        or customer_count
    ):
        raise ValueError(
            "module patch verification failed: "
            f"purchaser_classification_count={purchaser_count}, "
            f"data_safety_count={data_safety_count}, "
            f"consortium_count={consortium_count}, "
            f"project_activity_count={project_activity_count}, "
            f"data_import_count={data_import_count}, "
            f"signed_attachments_count={signed_attachments_count}, "
            f"lot_supplier_risk_count={lot_supplier_risk_count}, "
            f"reminder_routing_count={reminder_routing_count}, "
            f"stage_templates_count={stage_templates_count}, "
            f"stage_workflow_count={stage_workflow_count}, "
            f"device_admission_count={device_admission_count}, "
            f"device_keyring_count={device_keyring_count}, "
            f"device_access_page_count={device_access_page_count}, "
            f"http_security_count={http_security_count}, "
            f"data_recovery_count={data_recovery_count}, "
            f"data_security_count={data_security_count}, "
            f"customer_module={bool(customer_count)}"
        )
    for module_name in (
        "device_admission", "device_keyring", "device_access_page", "http_security", "data_recovery"
    ):
        module_root = marshal.loads(_pyz_entry(pyz_raw, toc, module_name))
        if not _is_controlled_module(
            module_root, CONTROLLED_MODULE_SIGNATURES[module_name]
        ):
            raise ValueError(
                "module patch verification failed: "
                f"controlled_signature={module_name!r}"
            )
    app_root = marshal.loads(_pyz_entry(pyz_raw, toc, "app"))
    data_security_root = marshal.loads(_pyz_entry(pyz_raw, toc, "data_security"))
    master_key_loaders = _named_code_objects(
        data_security_root, "load_or_create_master_key"
    )
    if (
        len(master_key_loaders) != 1
        or "v5-interactive-recovery-v1" not in _code_markers(master_key_loaders[0])
    ):
        raise ValueError(
            "module patch verification failed: interactive_data_recovery"
        )
    verify_attachment_upload_limit(app_root)
    app_values = _code_markers(app_root)
    desktop_values = _code_markers(desktop_root)
    registration_serializers = [
        code
        for code in _named_code_objects(app_root, "to_dict")
        if all(marker in _code_markers(code) for marker in CONSORTIUM_MARKERS)
    ]
    if len(registration_serializers) != 1:
        raise ValueError(
            "module patch verification failed: "
            f"consortium_serializer_count={len(registration_serializers)}"
        )
    for route_name in (
        "api_get_registrations",
        "api_create_registration",
        "api_update_registration",
        "api_delete_registration",
    ):
        if len(_named_code_objects(app_root, route_name)) != 1:
            raise ValueError(
                "module patch verification failed: "
                f"registration_route={route_name!r}"
            )
    api_exports = _named_code_objects(app_root, "api_export")
    if len(api_exports) != 1:
        raise ValueError(
            "module patch verification failed: "
            f"api_export_count={len(api_exports)}"
        )
    api_export = api_exports[0]
    api_export_values = _code_markers(api_export)
    missing_export = _missing_code_markers(api_export, API_EXPORT_XLSX_MARKERS)
    has_openpyxl = "openpyxl" in api_export_values
    if missing_export or has_openpyxl:
        raise ValueError(
            "module patch verification failed: "
            f"api_export_markers={missing_export}, "
            f"api_export_openpyxl={has_openpyxl}"
        )
    reminder_schedulers = _named_code_objects(
        app_root, "run_scheduled_backup_if_due"
    )
    if len(reminder_schedulers) != 1:
        raise ValueError(
            "module patch verification failed: "
            f"reminder_scheduler_count={len(reminder_schedulers)}"
        )
    reminder_values = _code_markers(reminder_schedulers[0])
    missing_reminder = _missing_code_markers(
        reminder_schedulers[0], REMINDER_SCHEDULER_MARKERS
    )
    if missing_reminder:
        raise ValueError(
            "module patch verification failed: "
            f"reminder_scheduler_markers={missing_reminder}"
        )
    event_functions = _named_code_objects(
        app_root, "run_project_event_reminders_if_due"
    ) + _named_code_objects(desktop_root, "run_project_event_reminders_if_due")
    if len(event_functions) != 1:
        raise ValueError(
            "module patch verification failed: "
            f"project_event_count={len(event_functions)}"
        )
    event_values = _code_markers(event_functions[0])
    missing_events = _missing_code_markers(event_functions[0], PROJECT_EVENT_MARKERS)
    if missing_events:
        raise ValueError(
            "module patch verification failed: "
            f"project_event_markers={missing_events}"
        )
    auto_completion_functions = _named_code_objects(app_root, "_auto_advance_stages")
    if len(auto_completion_functions) != 1:
        raise ValueError(
            "module patch verification failed: "
            f"auto_completion_count={len(auto_completion_functions)}"
        )
    auto_completion_values = _code_markers(auto_completion_functions[0])
    missing_auto_completion = _missing_code_markers(
        auto_completion_functions[0], AUTO_COMPLETION_MARKERS
    )
    if missing_auto_completion:
        raise ValueError(
            "module patch verification failed: "
            f"auto_completion_markers={missing_auto_completion}"
        )
    for name in BACKEND_VERSION_TARGETS:
        version_functions = _named_code_objects(app_root, name)
        if len(version_functions) != 1:
            raise ValueError(
                "module patch verification failed: "
                f"backend_version_target={name!r}, count={len(version_functions)}"
            )
        version_values = _code_markers(version_functions[0])
        if (
            BACKEND_VERSION_TARGET not in version_values
            or any(value in version_values for value in BACKEND_VERSION_SOURCES if value != BACKEND_VERSION_TARGET)
        ):
            raise ValueError(
                "module patch verification failed: "
                f"backend_version_target={name!r}, values={sorted(version_values)!r}"
            )
    missing_app = [value for value in app_markers if value not in app_values]
    missing_desktop = [value for value in desktop_markers if value not in desktop_values]
    if missing_app or missing_desktop:
        raise ValueError(
            f"module patch verification failed: app={missing_app}, desktop={missing_desktop}"
        )


def _parser():
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    compile_parser = subparsers.add_parser("compile")
    compile_parser.add_argument("--desktop-input", type=Path, required=True)
    compile_parser.add_argument("--pyz-input", type=Path, required=True)
    compile_parser.add_argument("--app-replacements", type=Path, required=True)
    compile_parser.add_argument("--desktop-replacements", type=Path, required=True)
    compile_parser.add_argument("--purchaser-module", type=Path, required=True)
    compile_parser.add_argument("--data-safety-module", type=Path, required=True)
    compile_parser.add_argument("--consortium-module", type=Path, required=True)
    compile_parser.add_argument("--project-activity-module", type=Path, required=True)
    compile_parser.add_argument("--data-import-module", type=Path, required=True)
    compile_parser.add_argument("--signed-attachments-module", type=Path, required=True)
    compile_parser.add_argument("--device-admission-module", type=Path, required=True)
    compile_parser.add_argument("--device-keyring-module", type=Path, required=True)
    compile_parser.add_argument("--device-access-page-module", type=Path, required=True)
    compile_parser.add_argument("--http-security-module", type=Path, required=True)
    compile_parser.add_argument("--data-recovery-module", type=Path, required=True)
    compile_parser.add_argument("--data-security-replacements", type=Path, required=True)
    compile_parser.add_argument("--lot-supplier-risk-module", type=Path, required=True)
    compile_parser.add_argument("--reminder-routing-module", type=Path, required=True)
    compile_parser.add_argument("--stage-workflow-module", type=Path)
    compile_parser.add_argument("--stage-templates-module", type=Path)
    compile_parser.add_argument("--desktop-output", type=Path, required=True)
    compile_parser.add_argument("--pyz-output", type=Path, required=True)
    compile_parser.add_argument(
        "--skip-version-bump",
        action="store_true",
        help="skip the supported-source -> v5.8.12 backend version constant bump",
    )
    verify_parser = subparsers.add_parser("verify")
    verify_parser.add_argument("--desktop", type=Path, required=True)
    verify_parser.add_argument("--pyz", type=Path, required=True)
    return parser


def main() -> None:
    arguments = _parser().parse_args()
    if arguments.command == "compile":
        compile_patches(
            desktop_input=arguments.desktop_input,
            pyz_input=arguments.pyz_input,
            app_replacements=arguments.app_replacements,
            desktop_replacements=arguments.desktop_replacements,
            purchaser_module=arguments.purchaser_module,
            data_safety_module=arguments.data_safety_module,
            consortium_module=arguments.consortium_module,
            project_activity_module=arguments.project_activity_module,
            data_import_module=arguments.data_import_module,
            signed_attachments_module=arguments.signed_attachments_module,
            device_admission_module=arguments.device_admission_module,
            device_keyring_module=arguments.device_keyring_module,
            device_access_page_module=arguments.device_access_page_module,
            http_security_module=arguments.http_security_module,
            data_recovery_module=arguments.data_recovery_module,
            data_security_replacements=arguments.data_security_replacements,
            lot_supplier_risk_module=arguments.lot_supplier_risk_module,
            reminder_routing_module=arguments.reminder_routing_module,
            stage_workflow_module=arguments.stage_workflow_module,
            stage_templates_module=arguments.stage_templates_module,
            desktop_output=arguments.desktop_output,
            pyz_output=arguments.pyz_output,
            skip_version_bump=arguments.skip_version_bump,
        )
        print("module patches compiled")
    else:
        verify_patches(arguments.desktop, arguments.pyz)
        print("module patches verified")


if __name__ == "__main__":
    main()
