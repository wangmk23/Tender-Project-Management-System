"""procurement-stage-templates-v1: validated stage template definitions."""

from __future__ import annotations

import copy
import json
import re
import threading
from collections.abc import Callable, Iterable, Mapping
from typing import Any

settings_write_lock = threading.RLock()


PROCUREMENT_METHODS = (
    "公开招标",
    "竞争性磋商",
    "竞争性谈判",
    "邀请招标",
    "网上竞价",
    "单一来源",
    "遴选",
    "直选",
)

MODULE_CATALOG = {
    "common": {"name": "通用阶段信息", "singleton": False},
    "checklist": {"name": "检查清单", "singleton": False},
    "responsible_person": {"name": "负责人", "singleton": False},
    "clarification": {"name": "澄清答疑", "singleton": False},
    "registration": {"name": "供应商报名", "singleton": True},
    "bid_opening": {"name": "开标与响应处理", "singleton": True},
    "evaluation": {"name": "评标记录", "singleton": True},
    "bid_results": {"name": "中标/成交结果", "singleton": True},
    "result_publication": {"name": "结果公示与质疑投诉（含中标/成交结果）", "singleton": True},
    "winning_notice": {"name": "中标或成交通知书", "singleton": False},
    "service_fee": {"name": "服务费管理", "singleton": False},
    "deposit_refund": {"name": "保证金退还", "singleton": False},
    "archive": {"name": "资料整理归档", "singleton": False},
    "auto_completion": {"name": "到时自动完成", "singleton": False},
    "online_bidding": {"name": "竞价报价与结果核对", "singleton": False},
}


def online_bidding_template():
    definitions = [
        ('plan_received', '接收项目', '📥', []),
        ('online_documents', '文件编制与确认', '📝', ['responsible_person']),
        ('agreement_signed', '签订委托协议', '📋', []),
        ('announcement', '平台发布', '📢', ['clarification']),
        ('registration_end', '报名与审核', '👥', ['registration']),
        ('online_quotation', '一次报价竞价', '⏳', []),
        ('result_announced', '成交结果公示', '🏆', ['result_publication']),
        ('online_fee_notice', '服务费与成交通知书', '💰', ['service_fee', 'winning_notice']),
        ('archived', '资料归档', '📦', ['archive']),
    ]
    return [dict(id=key, name=name, icon=icon, modules=['common', 'checklist', *modules, *(['online_bidding'] if key == 'online_quotation' else [])])
            for key, name, icon, modules in definitions]

AUTO_COMPLETION_POLICY_MARKER = "_auto_completion_policy_v1"
LEGACY_AUTO_COMPLETION_STAGE_KEYS = frozenset(
    {"registration_end", "bid_opening", "evaluation"}
)
LEGACY_AUTO_COMPLETION_MODULES = frozenset(
    {"registration", "bid_opening", "evaluation"}
)

CORE_SINGLETON_MODULES = frozenset(
    module_id
    for module_id, metadata in MODULE_CATALOG.items()
    if metadata["singleton"]
)

SAFE_STAGE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$")
UNSAFE_STAGE_TEXT = re.compile(r"[\x00-\x1f\x7f<>\"']")

_LEGACY_MODULES = {
    "doc_prepare": "responsible_person",
    "doc_review": "responsible_person",
    "announcement": "clarification",
    "registration_end": "registration",
    "bid_opening": "bid_opening",
    "evaluation": "evaluation",
    "result_announced": "result_publication",
    "winning_notice": "winning_notice",
    "service_fee": "service_fee",
    "deposit_refund": "deposit_refund",
    "archived": "archive",
}


class StageTemplateValidationError(ValueError):
    """Raised when an administrator submits an invalid stage template."""


def legacy_modules_for_stage(stage_key: str) -> list[str]:
    modules = ["common", "checklist"]
    business_module = _LEGACY_MODULES.get(str(stage_key))
    if business_module:
        modules.append(business_module)
    if str(stage_key) in LEGACY_AUTO_COMPLETION_STAGE_KEYS:
        modules.append("auto_completion")
    return modules


def _legacy_order(
    stages: Iterable[Mapping[str, Any]],
    stage_order: Iterable[str] | None = None,
) -> list[str]:
    definitions = list(stages)
    defaults = [str(stage["key"]) for stage in definitions]
    proposed = list(stage_order or [])
    if len(proposed) == len(defaults) and len(set(proposed)) == len(proposed) and set(proposed) == set(defaults):
        return proposed
    return defaults


def default_stage_templates(
    methods: Iterable[str],
    stages: Iterable[Mapping[str, Any]],
    stage_order: Iterable[str] | None = None,
) -> dict[str, list[dict[str, Any]]]:
    definitions = list(stages)
    by_key = {str(stage["key"]): stage for stage in definitions}
    ordered = _legacy_order(definitions, stage_order)
    result: dict[str, list[dict[str, Any]]] = {}
    for method in methods:
        if str(method) == '网上竞价' and 'plan_received' in by_key and 'archived' in by_key:
            result[str(method)] = online_bidding_template()
            continue
        result[str(method)] = [
            {
                "id": key,
                "name": str(by_key[key].get("name") or key),
                "icon": str(by_key[key].get("icon") or "•"),
                "modules": legacy_modules_for_stage(key),
            }
            for key in ordered
        ]
    return result


def _validate_and_normalize(
    raw: Any,
    methods: Iterable[str],
    *,
    migrate_legacy_auto_completion: bool,
) -> dict[str, list[dict[str, Any]]]:
    method_names = [str(method) for method in methods]
    if not isinstance(raw, Mapping):
        raise StageTemplateValidationError("阶段模板格式不正确")
    if set(raw) != set(method_names):
        raise StageTemplateValidationError("阶段模板必须包含全部采购方式")

    result: dict[str, list[dict[str, Any]]] = {}
    for method in method_names:
        rows = raw.get(method)
        if not isinstance(rows, list):
            raise StageTemplateValidationError("阶段模板格式不正确")
        if not rows:
            raise StageTemplateValidationError("每种采购方式至少保留一个阶段")
        normalized_rows: list[dict[str, Any]] = []
        seen_ids: set[str] = set()
        singleton_owners: dict[str, str] = {}
        for row in rows:
            if not isinstance(row, Mapping):
                raise StageTemplateValidationError("阶段模板格式不正确")
            stage_id = str(row.get("id") or "").strip()
            if not SAFE_STAGE_ID.fullmatch(stage_id):
                raise StageTemplateValidationError("阶段标识只能包含字母、数字、短横线和下划线，且不得超过80个字符")
            if stage_id in seen_ids:
                raise StageTemplateValidationError("阶段标识不得重复")
            seen_ids.add(stage_id)
            name = str(row.get("name") or "").strip()
            if not name:
                raise StageTemplateValidationError("阶段名称不能为空")
            if len(name) > 60:
                raise StageTemplateValidationError("阶段名称不得超过60个字符")
            if UNSAFE_STAGE_TEXT.search(name):
                raise StageTemplateValidationError("阶段名称包含不安全字符")
            icon = str(row.get("icon") or "•").strip() or "•"
            if len(icon) > 16:
                raise StageTemplateValidationError("阶段图标不得超过16个字符")
            if UNSAFE_STAGE_TEXT.search(icon):
                raise StageTemplateValidationError("阶段图标包含不安全字符")
            modules = row.get("modules")
            if not isinstance(modules, list) or not all(isinstance(value, str) for value in modules):
                raise StageTemplateValidationError("阶段模块格式不正确")
            normalized_modules = ["common"]
            for module_id in modules:
                # Previous release attached the whole ledger to every standard
                # stage. Its data stays intact; only the redundant module is removed.
                if module_id == 'online_bidding' and stage_id in {'plan_received', 'online_documents', 'agreement_signed', 'announcement', 'registration_end', 'result_announced', 'online_fee_notice', 'archived'}:
                    continue
                if module_id not in MODULE_CATALOG:
                    raise StageTemplateValidationError(f"未知阶段模块: {module_id}")
                if module_id != "common" and module_id not in normalized_modules:
                    normalized_modules.append(module_id)
                if module_id in CORE_SINGLETON_MODULES:
                    previous = singleton_owners.get(module_id)
                    if previous is not None:
                        module_name = MODULE_CATALOG[module_id]["name"]
                        raise StageTemplateValidationError(
                            f"核心模块“{module_name}”只能配置一次（{previous}、{name}）"
                        )
                    singleton_owners[module_id] = name
            if (
                migrate_legacy_auto_completion
                and "online_bidding" not in modules
                and LEGACY_AUTO_COMPLETION_MODULES.intersection(normalized_modules)
                and "auto_completion" not in normalized_modules
            ):
                normalized_modules.append("auto_completion")
            normalized_rows.append(
                {"id": stage_id, "name": name, "icon": icon, "modules": normalized_modules}
            )
            if 'online_bidding' in normalized_modules and 'auto_completion' in normalized_modules:
                raise StageTemplateValidationError('外部平台竞价登记阶段需人工核对，不能启用到时自动完成')
        result[method] = normalized_rows
    return result


def normalize_stage_templates(
    raw: Any,
    methods: Iterable[str],
    stages: Iterable[Mapping[str, Any]],
    *,
    stage_order: Iterable[str] | None = None,
    strict: bool = False,
    warn: Callable[[str], Any] | None = None,
    migrate_legacy_auto_completion: bool = True,
) -> dict[str, list[dict[str, Any]]]:
    fallback = default_stage_templates(methods, stages, stage_order)
    if raw is None:
        return fallback
    try:
        return _validate_and_normalize(
            raw,
            methods,
            migrate_legacy_auto_completion=migrate_legacy_auto_completion,
        )
    except StageTemplateValidationError:
        if strict:
            raise
        if warn is not None:
            warn("invalid stage_templates; using defaults")
        return fallback


def module_catalog_payload() -> list[dict[str, Any]]:
    return [
        {"id": module_id, "name": metadata["name"], "singleton": metadata["singleton"]}
        for module_id, metadata in MODULE_CATALOG.items()
    ]


def template_for_method(
    settings: Mapping[str, Any] | None,
    method: str,
    methods: Iterable[str],
    stages: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    normalized = normalize_stage_templates(
        (settings or {}).get("stage_templates"),
        methods,
        stages,
        stage_order=(settings or {}).get("stage_order"),
        migrate_legacy_auto_completion=(settings or {}).get(
            "stage_auto_completion_policy_version"
        ) != 1,
    )
    method_name = str(method)
    if method_name not in normalized:
        method_name = next(iter(normalized))
    return copy.deepcopy(normalized[method_name])


def _execute(connection: Any, sql_text: Callable[[str], Any], statement: str, parameters: Mapping[str, Any] | None = None):
    return connection.execute(sql_text(statement), dict(parameters or {}))


def _mapping_rows(result: Any) -> list[dict[str, Any]]:
    if hasattr(result, "mappings"):
        return [dict(row) for row in result.mappings().all()]
    rows = result.fetchall()
    values = []
    for row in rows:
        if hasattr(row, "keys"):
            values.append({key: row[key] for key in row.keys()})
        elif hasattr(row, "_mapping"):
            values.append(dict(row._mapping))
    return values


def ensure_online_bidding_scope(connection, sql_text):
    # Existing projects deliberately remain unenrolled, including synced snapshots.
    _execute(connection, sql_text, "CREATE TABLE IF NOT EXISTS online_bidding_project_scope (project_id INTEGER PRIMARY KEY)")
    if _execute(connection, sql_text, "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'").fetchone() is not None:
        _execute(connection, sql_text, "CREATE TRIGGER IF NOT EXISTS remove_online_bidding_scope AFTER DELETE ON projects BEGIN DELETE FROM online_bidding_project_scope WHERE project_id=OLD.id; END")


def online_bidding_enabled(connection, sql_text, project_id):
    ensure_online_bidding_scope(connection, sql_text)
    return bool(_mapping_rows(_execute(connection, sql_text,
        "SELECT project_id FROM online_bidding_project_scope WHERE project_id=:pid", {"pid": project_id})))


def initialize_online_bidding_scope(connection, sql_text, project_id, method):
    """Called only when creating a project, never by template sync or import."""
    ensure_online_bidding_scope(connection, sql_text)
    _execute(connection, sql_text, "DELETE FROM online_bidding_project_scope WHERE project_id=:pid", {"pid": project_id})
    if method == '网上竞价':
        _execute(connection, sql_text, "INSERT INTO online_bidding_project_scope(project_id) VALUES(:pid)", {"pid": project_id})


def ensure_v5_snapshot_schema(connection: Any, sql_text: Callable[[str], Any]) -> None:
    columns = {
        row["name"]
        for row in _mapping_rows(_execute(connection, sql_text, "PRAGMA table_info(stages)"))
    }
    additions = {
        "stage_name": "TEXT",
        "stage_icon": "TEXT",
        "modules_json": "TEXT",
        "template_removed": "INTEGER NOT NULL DEFAULT 0",
        "stage_position": "INTEGER",
        "opening_location": "TEXT NOT NULL DEFAULT ''",
        "evaluation_location": "TEXT NOT NULL DEFAULT ''",
        "publication_url": "TEXT NOT NULL DEFAULT ''",
    }
    for name, declaration in additions.items():
        if name not in columns:
            _execute(connection, sql_text, f"ALTER TABLE stages ADD COLUMN {name} {declaration}")


def enrich_stage_locations(connection, sql_text, project_id, payload):
    """Include separately persisted venues for both legacy and template stages."""
    ensure_v5_snapshot_schema(connection, sql_text)
    payload['online_bidding_enabled'] = bool(payload.get('method') == '网上竞价'
        and online_bidding_enabled(connection, sql_text, project_id))
    rows = _mapping_rows(_execute(connection, sql_text,
        "SELECT stage_key,opening_location,evaluation_location,publication_url FROM stages WHERE project_id=:pid",
        {"pid": project_id}))
    by_key = {row["stage_key"]: row for row in rows}
    for stage in payload.get("stages", []):
        row = by_key.get(stage.get("key"), {})
        for field in ("opening_location", "evaluation_location", "publication_url"):
            stage[field] = row.get(field) or ""
    return payload


def _stored_snapshot_modules(modules: Iterable[str] | None) -> list[str]:
    values = [str(value) for value in list(modules or ["common"])]
    if "common" not in values:
        values.insert(0, "common")
    if AUTO_COMPLETION_POLICY_MARKER not in values:
        values.append(AUTO_COMPLETION_POLICY_MARKER)
    return values


def auto_completion_policies(connection: Any, sql_text: Callable[[str], Any]) -> dict[int, dict[str, set[str]]]:
    """Return explicit per-project module policies; omit legacy unsynced projects."""
    ensure_v5_snapshot_schema(connection, sql_text)
    rows = _mapping_rows(
        _execute(
            connection,
            sql_text,
            "SELECT project_id,stage_key,modules_json,template_removed FROM stages ORDER BY id",
        )
    )
    configured_projects: set[int] = set()
    active_modules: dict[int, dict[str, set[str]]] = {}
    for row in rows:
        project_id = int(row["project_id"])
        try:
            modules = json.loads(row.get("modules_json") or "[]")
        except (TypeError, ValueError):
            modules = []
        if not isinstance(modules, list):
            modules = []
        normalized = {str(value) for value in modules}
        if AUTO_COMPLETION_POLICY_MARKER in normalized:
            configured_projects.add(project_id)
        if not row.get("template_removed"):
            active_modules.setdefault(project_id, {})[str(row["stage_key"])] = normalized
    return {
        project_id: active_modules.get(project_id, {})
        for project_id in configured_projects
    }


def replace_v5_project_stage_snapshot(
    connection: Any,
    sql_text: Callable[[str], Any],
    project_id: int,
    template: Iterable[Mapping[str, Any]],
) -> None:
    ensure_v5_snapshot_schema(connection, sql_text)
    _execute(connection, sql_text, "DELETE FROM stages WHERE project_id=:project_id", {"project_id": project_id})
    for position, stage in enumerate(template):
        _execute(
            connection,
            sql_text,
            "INSERT INTO stages(project_id,stage_key,stage_name,stage_icon,modules_json,template_removed,stage_position) "
            "VALUES(:project_id,:stage_key,:stage_name,:stage_icon,:modules_json,0,:stage_position)",
            {
                "project_id": project_id,
                "stage_key": stage["id"],
                "stage_name": stage["name"],
                "stage_icon": stage.get("icon") or "•",
                "modules_json": json.dumps(_stored_snapshot_modules(stage.get("modules")), ensure_ascii=False),
                "stage_position": position,
            },
        )


def initialize_project_workflow(connection, sql_text, project, settings, methods, stages, *, enroll_online_bidding=False):
    """Create a method-specific snapshot inside the caller's project transaction."""
    from datetime import date
    initialize_defaults = getattr(project, 'ensure_workflow_defaults', None)
    if callable(initialize_defaults):
        initialize_defaults()
    template = template_for_method(settings, project.method, methods, stages)
    replace_v5_project_stage_snapshot(connection, sql_text, project.id, template)
    if enroll_online_bidding:
        initialize_online_bidding_scope(connection, sql_text, project.id, project.method)
    if project.no_deposit:
        for row in template:
            if 'deposit_refund' in row['modules']:
                _execute(connection, sql_text,
                         'UPDATE stages SET skipped=1,completed=1,completed_date=:today WHERE project_id=:project_id AND stage_key=:stage_key',
                         dict(today=date.today().isoformat(), project_id=project.id, stage_key=row['id']))
    return template


def sync_v5_stage_template(
    connection: Any,
    sql_text: Callable[[str], Any],
    method: str,
    template: Iterable[Mapping[str, Any]],
) -> dict[str, int]:
    ensure_v5_snapshot_schema(connection, sql_text)
    projects = _mapping_rows(
        _execute(connection, sql_text, "SELECT id FROM projects WHERE method=:method ORDER BY id", {"method": method})
    )
    summary = {
        "projects_scanned": len(projects),
        "projects_skipped_legacy": 0,
        "projects_updated": 0,
        "stages_added": 0,
        "stages_updated": 0,
        "stages_retained": 0,
        "failures": 0,
    }
    desired = list(template)
    for project in projects:
        project_id = int(project["id"])
        if method == '网上竞价' and not online_bidding_enabled(connection, sql_text, project_id):
            summary["projects_skipped_legacy"] += 1
            continue
        try:
            existing_rows = _mapping_rows(
                _execute(connection, sql_text, "SELECT id,stage_key FROM stages WHERE project_id=:project_id", {"project_id": project_id})
            )
            existing = {str(row["stage_key"]): row for row in existing_rows}
            desired_ids = {str(stage["id"]) for stage in desired}
            for position, stage in enumerate(desired):
                parameters = {
                    "project_id": project_id,
                    "stage_key": str(stage["id"]),
                    "stage_name": str(stage["name"]),
                    "stage_icon": str(stage.get("icon") or "•"),
                    "modules_json": json.dumps(_stored_snapshot_modules(stage.get("modules")), ensure_ascii=False),
                    "stage_position": position,
                }
                if parameters["stage_key"] in existing:
                    _execute(connection, sql_text, "UPDATE stages SET stage_name=:stage_name,stage_icon=:stage_icon,modules_json=:modules_json,template_removed=0,stage_position=:stage_position WHERE project_id=:project_id AND stage_key=:stage_key", parameters)
                    summary["stages_updated"] += 1
                else:
                    _execute(connection, sql_text, "INSERT INTO stages(project_id,stage_key,stage_name,stage_icon,modules_json,template_removed,stage_position) VALUES(:project_id,:stage_key,:stage_name,:stage_icon,:modules_json,0,:stage_position)", parameters)
                    summary["stages_added"] += 1
            removed = [stage_key for stage_key in existing if stage_key not in desired_ids]
            for stage_key in removed:
                _execute(connection, sql_text, "UPDATE stages SET template_removed=1,stage_position=NULL WHERE project_id=:project_id AND stage_key=:stage_key", {"project_id": project_id, "stage_key": stage_key})
            summary["stages_retained"] += len(removed)
            summary["projects_updated"] += 1
        except Exception:
            summary["failures"] += 1
    return summary


def _isoformat(value: Any) -> str | None:
    if value is None or value == "":
        return None
    formatter = getattr(value, "isoformat", None)
    return formatter() if callable(formatter) else str(value)


def _snapshot_modules(raw: Any, fallback: Iterable[str]) -> list[str]:
    values = raw
    if isinstance(raw, str):
        try:
            values = json.loads(raw)
        except (TypeError, ValueError):
            values = None
    if not isinstance(values, list) or not all(isinstance(value, str) for value in values):
        values = list(fallback)
    normalized = ["common"]
    for module_id in values:
        if module_id in MODULE_CATALOG and module_id not in normalized:
            normalized.append(module_id)
    return normalized


def serialize_v5_project_payload(
    connection: Any,
    sql_text: Callable[[str], Any],
    project: Any,
    payload: Mapping[str, Any],
    settings: Mapping[str, Any] | None,
    methods: Iterable[str],
    stages: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Serialize the real per-project stage snapshot instead of fixed globals."""
    result = copy.deepcopy(dict(payload))
    project_id = int(getattr(project, "id", result.get("id")))
    method = str(getattr(project, "method", result.get("method") or ""))
    result['online_bidding_enabled'] = bool(method == '网上竞价' and connection is not None and sql_text is not None
        and online_bidding_enabled(connection, sql_text, project_id))
    legacy_by_id = {str(row["key"]): row for row in stages}
    payload_by_id = {
        str(row.get("key") or row.get("stage_key") or ""): row
        for row in result.get("stages") or []
    }

    snapshot_rows: list[dict[str, Any]] = []
    if connection is not None and sql_text is not None:
        ensure_v5_snapshot_schema(connection, sql_text)
        snapshot_rows = _mapping_rows(
            _execute(
                connection,
                sql_text,
                "SELECT id,stage_key,stage_name,stage_icon,modules_json,"
                "template_removed,stage_position FROM stages "
                "WHERE project_id=:project_id ORDER BY id",
                {"project_id": project_id},
            )
        )

    state_by_id = {
        str(getattr(row, "stage_key", "")): row
        for row in list(getattr(project, "stages", ()) or ())
    }
    if not snapshot_rows:
        snapshot_rows = [
            {
                "id": getattr(row, "id", position),
                "stage_key": stage_key,
                "stage_name": None,
                "stage_icon": None,
                "modules_json": None,
                "template_removed": 0,
                "stage_position": position,
            }
            for position, (stage_key, row) in enumerate(state_by_id.items())
        ]

    checklist_by_stage: dict[str, list[dict[str, Any]]] = {}
    for item in list(getattr(project, "stage_checklist_items", ()) or ()):
        stage_key = str(getattr(item, "stage_key", ""))
        checklist_by_stage.setdefault(stage_key, []).append(item.to_dict())
    for items in checklist_by_stage.values():
        items.sort(key=lambda item: (item.get("sort_order", 0), item.get("id", 0)))

    def row_rank(row: Mapping[str, Any]) -> tuple[int, int, int]:
        position = row.get("stage_position")
        removed = bool(row.get("template_removed"))
        return (
            int(removed or position is None),
            int(position) if position is not None else 2**31 - 1,
            int(row.get("id") or 0),
        )

    serialized = []
    for snapshot in sorted(snapshot_rows, key=row_rank):
        stage_key = str(snapshot.get("stage_key") or "")
        if not stage_key:
            continue
        # Existing projects are immutable snapshots. Rows created before snapshot
        # metadata existed retain the legacy definition until an explicit sync.
        definition = legacy_by_id.get(stage_key) or {}
        legacy_row = payload_by_id.get(stage_key) or {}
        state = state_by_id.get(stage_key)

        def state_value(name: str, default: Any = None) -> Any:
            if state is not None and hasattr(state, name):
                return getattr(state, name)
            legacy_name = "planned_at" if name == "planned_datetime" else name
            return legacy_row.get(legacy_name, default)

        position = snapshot.get("stage_position")
        modules = _snapshot_modules(
            snapshot.get("modules_json"),
            definition.get("modules") or legacy_modules_for_stage(stage_key),
        )
        serialized.append(
            {
                "key": stage_key,
                "name": str(snapshot.get("stage_name") or definition.get("name") or legacy_row.get("name") or stage_key),
                "icon": str(snapshot.get("stage_icon") or definition.get("icon") or legacy_row.get("icon") or "•"),
                "group": str(definition.get("group") or legacy_row.get("group") or ""),
                "order": int(position) if position is not None else legacy_row.get("order"),
                "modules": modules,
                "template_removed": bool(snapshot.get("template_removed")),
                "completed": bool(state_value("completed", False)),
                "completed_date": _isoformat(state_value("completed_date")),
                "planned_at": _isoformat(state_value("planned_datetime")),
                "skipped": bool(state_value("skipped", False)),
                "notes": str(state_value("notes", "") or ""),
                "responsible_person": str(state_value("responsible_person", "") or ""),
                "checklist": checklist_by_stage.get(stage_key, []),
            }
        )

    result["stages"] = serialized
    active = [row for row in serialized if not row["template_removed"]]
    pending = [row for row in active if not row["completed"] and not row["skipped"]]
    result["current_stage_key"] = pending[0]["key"] if pending else None
    result["current_stage_name"] = pending[0]["name"] if pending else "已完成" if active else "未初始化流程"
    result["next_stage_key"] = pending[1]["key"] if len(pending) > 1 else None
    result["progress"] = round(
        100 * sum(bool(row["completed"]) for row in active) / len(active)
    ) if active else 0
    created_at = _isoformat(getattr(project, "created_at", None)) or _isoformat(
        result.get("created_at") or result.get("createdAt")
    )
    if created_at:
        result["created_at"] = created_at

    completed_at = _isoformat(getattr(project, "completed_at", None)) or _isoformat(
        result.get("completed_at") or result.get("completedAt")
    )
    if not completed_at and result["progress"] >= 100:
        completion_dates = [row["completed_date"] for row in active if row["completed_date"]]
        completed_at = completion_dates[-1] if completion_dates else None
    result["completed_at"] = completed_at
    return result


def enrich_v5_project_payload(
    connection: Any,
    sql_text: Callable[[str], Any],
    payload: Mapping[str, Any],
    settings: Mapping[str, Any] | None,
    methods: Iterable[str],
    stages: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    result = copy.deepcopy(dict(payload))
    template = template_for_method(settings, str(result.get("method") or ""), methods, stages)
    by_id = {str(stage["id"]): stage for stage in template}
    rank = {str(stage["id"]): position for position, stage in enumerate(template)}
    rows = list(result.get("stages") or [])
    for row in rows:
        key = str(row.get("key") or row.get("stage_key") or "")
        definition = by_id.get(key)
        if definition:
            row.setdefault("name", definition["name"])
            row.setdefault("icon", definition.get("icon") or "•")
            row.setdefault("modules", list(definition.get("modules") or ["common"]))
    rows.sort(key=lambda row: rank.get(str(row.get("key") or row.get("stage_key") or ""), len(rank)))
    result["stages"] = rows
    pending = [
        str(row.get("key") or row.get("stage_key") or "")
        for row in rows
        if not row.get("completed") and not row.get("skipped") and not row.get("template_removed")
    ]
    result["current_stage_key"] = pending[0] if pending else None
    result["next_stage_key"] = pending[1] if len(pending) > 1 else None
    return result
