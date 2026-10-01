"""stage-workflow-order-v1: validated global stage order helpers."""

from __future__ import annotations

import copy
from collections.abc import Callable, Iterable, Mapping
from typing import Any


class StageOrderValidationError(ValueError):
    """Raised when an administrator submits an invalid stage permutation."""


def default_stage_keys(stage_definitions: Iterable[Mapping[str, Any]]) -> list[str]:
    """Return the immutable business keys in their packaged default order."""

    return [str(stage["key"]) for stage in stage_definitions]


def normalize_stage_order(
    raw: Any,
    stage_definitions: Iterable[Mapping[str, Any]],
    *,
    strict: bool = False,
    warn: Callable[[str], Any] | None = None,
) -> list[str]:
    """Validate a full permutation or fall back atomically to the default."""

    default = default_stage_keys(stage_definitions)
    valid = (
        isinstance(raw, list)
        and all(isinstance(value, str) for value in raw)
        and len(raw) == len(default)
        and len(set(raw)) == len(raw)
        and set(raw) == set(default)
    )
    if valid:
        return list(raw)
    if strict:
        raise StageOrderValidationError("阶段顺序必须包含全部阶段且不得重复")
    if raw is not None and warn is not None:
        warn("invalid stage_order; using defaults")
    return default


def ordered_stage_definitions(
    stage_definitions: Iterable[Mapping[str, Any]],
    settings: Mapping[str, Any] | None,
) -> list[Mapping[str, Any]]:
    """Return stage metadata in the validated configured order."""

    definitions = list(stage_definitions)
    by_key = {str(stage["key"]): stage for stage in definitions}
    order = normalize_stage_order(
        (settings or {}).get("stage_order"),
        definitions,
    )
    return [by_key[key] for key in order]


def _payload_stage_key(row: Mapping[str, Any]) -> str:
    return str(row.get("key") or row.get("stage_key") or "")


def apply_project_payload(
    payload: Mapping[str, Any],
    settings: Mapping[str, Any] | None,
    stage_definitions: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Sort a project payload and derive its configured current/next stages."""

    result = copy.deepcopy(dict(payload))
    definitions = list(stage_definitions)
    order = normalize_stage_order(
        (settings or {}).get("stage_order"),
        definitions,
    )
    rank = {key: index for index, key in enumerate(order)}
    rows = list(result.get("stages") or [])
    rows.sort(key=lambda row: rank.get(_payload_stage_key(row), len(rank)))
    result["stages"] = rows

    pending_keys = [
        _payload_stage_key(row)
        for row in rows
        if _payload_stage_key(row) in rank
        and not bool(row.get("completed"))
        and not bool(row.get("skipped"))
    ]
    result["current_stage_key"] = pending_keys[0] if pending_keys else None
    result["next_stage_key"] = pending_keys[1] if len(pending_keys) > 1 else None
    return result
