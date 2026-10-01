"""Deterministic read-only performance and data-safety benchmark.

The default command builds a synthetic SQLite database in a temporary directory.
It never opens the pinned release executable and never discovers business data.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import marshal
import os
import re
import shutil
import sqlite3
import statistics
import subprocess
import sys
import tempfile
import time
import types
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import closing
from pathlib import Path
from pathlib import PureWindowsPath

from PyInstaller.archive.readers import CArchiveReader

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from src.backend_patches import data_safety as _data_safety


def _can_open_for_delete(path: Path) -> bool:
    """Return whether Windows currently permits deletion of *path*."""

    if os.name != "nt":
        return True
    import ctypes

    delete_access = 0x00010000
    share_read_write_delete = 0x00000001 | 0x00000002 | 0x00000004
    open_existing = 3
    file_attribute_normal = 0x00000080
    invalid_handle = ctypes.c_void_p(-1).value
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    create_file = kernel32.CreateFileW
    create_file.argtypes = (
        ctypes.c_wchar_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
        ctypes.c_uint32,
        ctypes.c_uint32,
        ctypes.c_void_p,
    )
    create_file.restype = ctypes.c_void_p
    handle = create_file(
        str(path),
        delete_access,
        share_read_write_delete,
        None,
        open_existing,
        file_attribute_normal,
        None,
    )
    if handle == invalid_handle:
        return False
    kernel32.CloseHandle(handle)
    return True


def _wait_for_file_release(
    path: Path,
    *,
    timeout_seconds: float = 5.0,
    poll_interval_seconds: float = 0.05,
) -> None:
    """Wait until a newly executed Windows candidate can be deleted."""

    _wait_for_paths_release(
        (path,),
        timeout_seconds=timeout_seconds,
        poll_interval_seconds=poll_interval_seconds,
    )


def _wait_for_paths_release(
    paths,
    *,
    timeout_seconds: float = 5.0,
    poll_interval_seconds: float = 0.05,
) -> None:
    """Wait until Windows permits deletion of every candidate runtime file."""

    targets = tuple(Path(path) for path in paths)
    deadline = time.monotonic() + timeout_seconds
    while True:
        locked = tuple(path for path in targets if not _can_open_for_delete(path))
        if not locked:
            return
        if time.monotonic() >= deadline:
            raise TimeoutError(
                "timed out waiting for candidate runtime release: "
                + ", ".join(str(path) for path in locked)
            )
        time.sleep(poll_interval_seconds)

sys.modules.setdefault("data_safety", _data_safety)

from src.backend_patches.data_safety import database_fingerprint
from src.backend_patches.purchaser_classification import (
    PRESET_CATEGORIES,
    SCHEMA_VERSION,
    _build_purchaser_board,
    _category,
    read_purchaser_board,
)
from tools.build_candidate import build_candidate, sha256_file
from tools.compile_module_patches import _pyz_entry, _read_pyz


REGRESSION_LIMIT = 1.20
DEFAULT_PROJECTS = 1_000
DEFAULT_ATTACHMENTS = 30_000
DEFAULT_CLIENTS = 20
DEFAULT_SAMPLES = 5
CHART_PROJECTS = 1_000
CHART_STAGES_PER_PROJECT = 14
CHART_WARMUPS = 10
CHART_SAMPLES = 50
CHART_MEDIAN_LIMIT_MS = 20.0
CHART_P95_LIMIT_MS = 50.0
ROOT = Path(__file__).resolve().parents[1]
SQLCIPHER_RUNTIME_ENTRIES = (
    "sqlcipher3\\_sqlite3.cp312-win_amd64.pyd",
    "sqlite3.dll",
    "libcrypto-3.dll",
    "libssl-3.dll",
)


def _validate_positive(name, value):
    value = int(value)
    if value <= 0:
        raise ValueError(f"{name} must be positive")
    return value


def _create_fixture(database_path, project_count, attachment_metadata_count):
    """Create a deterministic synthetic fixture at a caller-owned temporary path."""
    path = Path(database_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(str(path))) as connection:
        connection.execute("PRAGMA foreign_keys=ON")
        connection.executescript(
            """
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                number TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                purchaser TEXT NOT NULL,
                status TEXT NOT NULL,
                year INTEGER NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE attachments (
                id INTEGER PRIMARY KEY,
                project_id INTEGER NOT NULL REFERENCES projects(id),
                filename TEXT NOT NULL,
                size INTEGER NOT NULL,
                created_at TEXT NOT NULL
            );
            CREATE TABLE purchaser_schema_meta (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE purchaser_categories (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL UNIQUE,
                color TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                is_active INTEGER NOT NULL DEFAULT 1,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE purchaser_category_assignments (
                purchaser_key TEXT PRIMARY KEY,
                category_id INTEGER NOT NULL REFERENCES purchaser_categories(id),
                updated_at TEXT NOT NULL,
                updated_by TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE purchaser_classification_audit (
                id INTEGER PRIMARY KEY,
                action TEXT NOT NULL,
                purchaser_key TEXT NOT NULL,
                old_category_id INTEGER,
                old_category_name TEXT,
                new_category_id INTEGER,
                new_category_name TEXT,
                actor TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL
            );
            CREATE TABLE __safe_migration_versions (
                namespace TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                applied_at TEXT NOT NULL
            );
            CREATE INDEX idx_projects_purchaser_created
                ON projects(purchaser, created_at, id);
            CREATE INDEX idx_projects_updated_id
                ON projects(updated_at DESC, id DESC);
            CREATE INDEX idx_attachments_project_id_id
                ON attachments(project_id, id);
            CREATE INDEX idx_purchaser_assignments_category
                ON purchaser_category_assignments(category_id, purchaser_key);
            CREATE INDEX idx_purchaser_classification_audit_unit
                ON purchaser_classification_audit(purchaser_key, id);
            """
        )
        purchaser_suffixes = ("学校", "医院", "管理局", "银行", "有限公司")
        projects = []
        for project_id in range(1, project_count + 1):
            unit = (project_id - 1) % 100
            suffix = purchaser_suffixes[unit % len(purchaser_suffixes)]
            timestamp = f"2026-{(project_id % 12) + 1:02d}-{(project_id % 28) + 1:02d} 08:00:00"
            purchaser = f"采购单位 {unit:03d} {suffix}"
            if project_id == 1:
                purchaser = "   "
            elif project_id == 2:
                purchaser = " 采购单位 010 学校 "
            elif project_id == 3:
                purchaser = "未分类单位"
            projects.append(
                (
                    project_id,
                    f"SIM-{project_id:05d}",
                    f"合成项目 {project_id:05d}",
                    purchaser,
                    "active" if project_id % 4 else "completed",
                    2024 + project_id % 3,
                    timestamp,
                    timestamp,
                )
            )
        connection.executemany(
            "INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?, ?, ?)", projects
        )

        batch = []
        for attachment_id in range(1, attachment_metadata_count + 1):
            project_id = ((attachment_id - 1) % project_count) + 1
            batch.append(
                (
                    attachment_id,
                    project_id,
                    f"attachment-{attachment_id:06d}.pdf",
                    1_024 + attachment_id % 1_000_000,
                    f"2026-{(attachment_id % 12) + 1:02d}-01 09:00:00",
                )
            )
            if len(batch) == 2_000:
                connection.executemany(
                    "INSERT INTO attachments VALUES (?, ?, ?, ?, ?)", batch
                )
                batch.clear()
        if batch:
            connection.executemany(
                "INSERT INTO attachments VALUES (?, ?, ?, ?, ?)", batch
            )

        fixture_time = "2026-01-01 00:00:00"
        category_rows = [
            (
                category_id,
                preset["name"],
                preset["color"],
                preset["sort_order"],
                1,
                fixture_time,
                fixture_time,
            )
            for category_id, preset in enumerate(PRESET_CATEGORIES, start=1)
        ]
        category_rows.append(
            (99, "停用分类", "#6B7280", 99, 0, fixture_time, fixture_time)
        )
        connection.executemany(
            "INSERT INTO purchaser_categories VALUES (?, ?, ?, ?, ?, ?, ?)",
            category_rows,
        )
        category_ids = {row[1]: row[0] for row in category_rows}
        assignments = (
            ("采购单位 005 学校", category_ids["企业"], fixture_time, "benchmark-admin"),
            ("采购单位 006 医院", category_ids["停用分类"], fixture_time, "benchmark-admin"),
        )
        connection.executemany(
            "INSERT INTO purchaser_category_assignments VALUES (?, ?, ?, ?)",
            assignments,
        )
        connection.executemany(
            "INSERT INTO purchaser_classification_audit "
            "(action, purchaser_key, new_category_id, new_category_name, actor, created_at) "
            "VALUES ('move_purchaser', ?, ?, ?, ?, ?)",
            (
                ("采购单位 005 学校", category_ids["企业"], "企业", "benchmark-admin", fixture_time),
                ("采购单位 006 医院", category_ids["停用分类"], "停用分类", "benchmark-admin", fixture_time),
            ),
        )
        connection.execute(
            "INSERT INTO purchaser_schema_meta VALUES ('schema_version', ?)",
            (SCHEMA_VERSION,),
        )
        connection.execute(
            "INSERT INTO __safe_migration_versions VALUES "
            "('purchaser_classification', ?, ?)",
            (SCHEMA_VERSION, fixture_time),
        )
        connection.commit()


def _read_only_uri(database_path):
    return Path(database_path).resolve().as_uri() + "?mode=ro"


def _read_connection(database_path):
    connection = sqlite3.connect(
        _read_only_uri(database_path), uri=True, timeout=10, check_same_thread=False
    )
    connection.execute("PRAGMA query_only=ON")
    connection.execute("PRAGMA foreign_keys=ON")
    connection.row_factory = sqlite3.Row
    return connection


def _compact_fingerprint(connection):
    fingerprint = database_fingerprint(
        connection,
        protected_tables=(
            "projects",
            "attachments",
            "purchaser_schema_meta",
            "purchaser_categories",
            "purchaser_category_assignments",
            "purchaser_classification_audit",
            "__safe_migration_versions",
        ),
    )
    return {
        "integrity_check": fingerprint["integrity_check"],
        "foreign_key_check": fingerprint["foreign_key_check"],
        "schema_sha256": fingerprint["schema_sha256"],
        "content_sha256": fingerprint["content_sha256"],
        "tables": {
            name: {
                "count": table["count"],
                "rows_sha256": table["rows_sha256"],
            }
            for name, table in fingerprint["tables"].items()
        },
    }


def _percentile(sorted_values, fraction):
    index = max(0, min(len(sorted_values) - 1, int(len(sorted_values) * fraction + 0.999999) - 1))
    return sorted_values[index]


def _measure_pair(contract_operation, optimized_operation, samples):
    """Measure paired operations with alternating order to reduce scheduler bias."""
    expected_contract = contract_operation()
    expected_optimized = optimized_operation()
    contract_timings = []
    optimized_timings = []

    def take(operation, expected, timings):
        started = time.perf_counter_ns()
        result = operation()
        timings.append((time.perf_counter_ns() - started) / 1_000_000)
        if result != expected:
            raise RuntimeError("paired benchmark query returned inconsistent results")

    for index in range(samples):
        if index % 2:
            take(optimized_operation, expected_optimized, optimized_timings)
            take(contract_operation, expected_contract, contract_timings)
        else:
            take(contract_operation, expected_contract, contract_timings)
            take(optimized_operation, expected_optimized, optimized_timings)
    contract_timings.sort()
    optimized_timings.sort()
    contract = {
        "timings": contract_timings,
        "median_ms": statistics.median(contract_timings),
        "p95_ms": _percentile(contract_timings, 0.95),
        "result": expected_contract,
    }
    optimized = {
        "timings": optimized_timings,
        "median_ms": statistics.median(optimized_timings),
        "p95_ms": _percentile(optimized_timings, 0.95),
        "result": expected_optimized,
    }
    return contract, optimized


def _shared_purchaser_board(database_path):
    """Read the application's complete board through its public backend contract."""
    return read_purchaser_board(
        database_path,
        Path(database_path).parent / "unused-purchaser-backups",
        False,
    )


def _optimized_units(connection):
    rows = connection.execute(
        """
        SELECT purchaser, COUNT(*) AS project_count,
               MAX(NULLIF(TRIM(created_at), '')) AS recent_created_at,
               GROUP_CONCAT(id) AS project_ids
        FROM projects INDEXED BY idx_projects_purchaser_created
        WHERE purchaser <> ''
        GROUP BY purchaser
        ORDER BY purchaser
        """
    ).fetchall()
    grouped = {}
    for row in rows:
        name = str(row["purchaser"] or "").strip()
        if not name:
            continue
        unit = grouped.setdefault(
            name,
            {
                "name": name,
                "project_count": 0,
                "recent_created_at": "",
                "project_ids": [],
            },
        )
        unit["project_count"] += int(row["project_count"])
        unit["project_ids"].extend(
            int(value)
            for value in str(row["project_ids"] or "").split(",")
            if value
        )
        created_at = str(row["recent_created_at"] or "").strip()
        if created_at > unit["recent_created_at"]:
            unit["recent_created_at"] = created_at
    payload = {}
    for name in sorted(grouped):
        unit = grouped[name]
        unit["project_ids"].sort()
        recent_created_at = unit.pop("recent_created_at")
        if recent_created_at:
            unit["recent_project"] = recent_created_at
        else:
            year_row = connection.execute(
                "SELECT MAX(CAST(year AS TEXT)) FROM projects "
                "WHERE TRIM(COALESCE(purchaser, ''))=?",
                (name,),
            ).fetchone()
            unit["recent_project"] = str(year_row[0] or "")
        payload[name] = unit
    return payload


def _optimized_purchaser_board(connection):
    """Use optimized aggregation with the exact shared board business contract."""
    all_categories = [
        _category(row)
        for row in connection.execute(
            "SELECT * FROM purchaser_categories ORDER BY sort_order, name, id"
        ).fetchall()
    ]
    assignments = {
        row["purchaser_key"]: row["category_id"]
        for row in connection.execute(
            "SELECT purchaser_key, category_id FROM purchaser_category_assignments"
        )
    }
    return _build_purchaser_board(
        all_categories, assignments, _optimized_units(connection), False
    )


PROJECT_SUMMARY_COLUMNS = (
    "id", "number", "name", "purchaser", "status", "year", "created_at", "updated_at",
)
ATTACHMENT_COLUMNS = ("id", "project_id", "filename", "size", "created_at")


def _rows_payload(rows, columns):
    return tuple({column: row[column] for column in columns} for row in rows)


def _shared_project_summary(connection):
    rows = connection.execute(
        "SELECT id, number, name, purchaser, status, year, created_at, updated_at "
        "FROM projects ORDER BY updated_at DESC, id DESC"
    ).fetchall()
    return _rows_payload(rows[:100], PROJECT_SUMMARY_COLUMNS)


def _optimized_project_summary(connection):
    return _rows_payload(
        connection.execute(
            "SELECT id, number, name, purchaser, status, year, created_at, updated_at "
            "FROM projects "
            "ORDER BY updated_at DESC, id DESC LIMIT 100"
        ).fetchall(),
        PROJECT_SUMMARY_COLUMNS,
    )


def _shared_attachment_page(connection, project_id):
    rows = connection.execute(
        "SELECT id, project_id, filename, size, created_at FROM attachments ORDER BY id"
    ).fetchall()
    selected = [row for row in rows if int(row["project_id"]) == project_id][:30]
    return _rows_payload(selected, ATTACHMENT_COLUMNS)


def _optimized_attachment_page(connection, project_id):
    return _rows_payload(
        connection.execute(
            "SELECT id, project_id, filename, size, created_at FROM attachments "
            "WHERE project_id=? ORDER BY id LIMIT 30 OFFSET 0",
            (project_id,),
        ).fetchall(),
        ATTACHMENT_COLUMNS,
    )


def regression_failure(name, shared_contract_ms, optimized_ms):
    """Return a gate message when optimized median exceeds the shared contract by 20%."""
    if optimized_ms > shared_contract_ms * REGRESSION_LIMIT:
        ratio = optimized_ms / max(shared_contract_ms, 1e-12)
        return (
            f"{name} regressed by more than 20%: "
            f"optimized={optimized_ms:.6f}ms shared_contract={shared_contract_ms:.6f}ms "
            f"ratio={ratio:.3f}"
        )
    return None


def _payload_sha256(payload):
    rendered = json.dumps(
        payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")
    ).encode("utf-8")
    return hashlib.sha256(rendered).hexdigest()


def _query_scenario(name, contract_operation, optimized_operation, samples):
    # Same-process measurements make the comparison hardware-tolerant. The
    # reference is explicitly a shared business contract, not a performance guarantee.
    contract, optimized = _measure_pair(
        contract_operation, optimized_operation, samples
    )
    ratio = optimized["median_ms"] / max(contract["median_ms"], 1e-12)
    return {
        "name": name,
        "samples": samples,
        "shared_contract_median_ms": round(contract["median_ms"], 6),
        "shared_contract_p95_ms": round(contract["p95_ms"], 6),
        "shared_contract_payload_sha256": _payload_sha256(contract["result"]),
        "optimized_median_ms": round(optimized["median_ms"], 6),
        "optimized_p95_ms": round(optimized["p95_ms"], 6),
        "optimized_payload_sha256": _payload_sha256(optimized["result"]),
        "regression_ratio": round(ratio, 6),
        "results_equivalent": contract["result"] == optimized["result"],
        "_contract_raw": contract,
        "_optimized_raw": optimized,
    }


def _concurrent_read(database_path, client_id, project_count):
    started = time.perf_counter_ns()
    with closing(_read_connection(database_path)) as connection:
        project_id = (client_id % project_count) + 1
        project = connection.execute(
            "SELECT id, number, name, purchaser FROM projects WHERE id=?", (project_id,)
        ).fetchone()
        attachments = connection.execute(
            "SELECT id, filename, size FROM attachments "
            "WHERE project_id=? ORDER BY id LIMIT 30",
            (project_id,),
        ).fetchall()
        if project is None or int(project[0]) != project_id:
            raise RuntimeError(f"client {client_id} could not read project {project_id}")
        if len(attachments) > 30:
            raise RuntimeError(f"client {client_id} exceeded attachment page size")
    return (time.perf_counter_ns() - started) / 1_000_000


def _concurrent_scenario(database_path, clients, project_count):
    timings = []
    messages = []
    with ThreadPoolExecutor(max_workers=clients) as executor:
        futures = [
            executor.submit(_concurrent_read, database_path, client_id, project_count)
            for client_id in range(clients)
        ]
        for future in as_completed(futures):
            try:
                timings.append(future.result())
            except Exception as exc:  # The report must retain every failed read.
                messages.append(f"{type(exc).__name__}: {exc}")
    timings.sort()
    return {
        "clients": clients,
        "successful_reads": len(timings),
        "failed_reads": len(messages),
        "median_ms": round(statistics.median(timings), 6) if timings else None,
        "p95_ms": round(_percentile(timings, 0.95), 6) if timings else None,
        "failure_messages": messages,
        "_timings_raw": timings,
    }


def _chart_aggregation_gate():
    node = shutil.which("node")
    failures = []
    median_ms = None
    p95_ms = None
    if node is None:
        failures.append("node executable is unavailable for chart aggregation gate")
    else:
        completed = subprocess.run(
            [
                node,
                str(ROOT / "tests" / "test_chart_board_performance.js"),
                "--chart-board-benchmark-child",
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, "CHART_BOARD_BENCHMARK_CHILD": "1"},
        )
        output = "\n".join(
            part.strip() for part in (completed.stdout, completed.stderr) if part.strip()
        )
        match = re.search(
            r"median=([0-9]+(?:\.[0-9]+)?)ms\s+p95=([0-9]+(?:\.[0-9]+)?)ms",
            output,
        )
        if match:
            median_ms = float(match.group(1))
            p95_ms = float(match.group(2))
        if completed.returncode != 0:
            failures.append(
                "chart aggregation benchmark failed: "
                f"exit={completed.returncode}, output={output or '<empty>'}"
            )
        elif match is None:
            failures.append(
                "chart aggregation benchmark did not emit parseable median/P95"
            )
    passed = (
        not failures
        and median_ms is not None
        and p95_ms is not None
        and median_ms < CHART_MEDIAN_LIMIT_MS
        and p95_ms < CHART_P95_LIMIT_MS
    )
    if not failures and not passed:
        failures.append(
            "chart aggregation threshold exceeded: "
            f"median={median_ms}, p95={p95_ms}"
        )
    return {
        "project_count": CHART_PROJECTS,
        "stages_per_project": CHART_STAGES_PER_PROJECT,
        "warmup_count": CHART_WARMUPS,
        "sample_count": CHART_SAMPLES,
        "median_limit_ms": CHART_MEDIAN_LIMIT_MS,
        "p95_limit_ms": CHART_P95_LIMIT_MS,
        "median_ms": median_ms,
        "p95_ms": p95_ms,
        "passed": passed,
        "failure_messages": failures,
    }


def _run_on_fixture(database_path, project_count, attachment_metadata_count, clients, samples):
    failures = []
    regression_enforced = (
        project_count >= DEFAULT_PROJECTS
        and attachment_metadata_count >= DEFAULT_ATTACHMENTS
    )
    attachment_project_id = max(1, project_count // 2)
    with closing(_read_connection(database_path)) as connection:
        before = _compact_fingerprint(connection)
        actual_projects = connection.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        actual_attachments = connection.execute("SELECT COUNT(*) FROM attachments").fetchone()[0]
        if actual_projects != project_count:
            failures.append(f"project fixture count {actual_projects} != {project_count}")
        if actual_attachments != attachment_metadata_count:
            failures.append(
                f"attachment fixture count {actual_attachments} != {attachment_metadata_count}"
            )

        scenarios = {
            "purchaser_board": _query_scenario(
                "purchaser_board",
                lambda: _shared_purchaser_board(database_path),
                lambda: _optimized_purchaser_board(connection),
                samples,
            ),
            "project_summary": _query_scenario(
                "project_summary",
                lambda: _shared_project_summary(connection),
                lambda: _optimized_project_summary(connection),
                samples,
            ),
            "attachment_metadata_paging": _query_scenario(
                "attachment_metadata_paging",
                lambda: _shared_attachment_page(connection, attachment_project_id),
                lambda: _optimized_attachment_page(connection, attachment_project_id),
                samples,
            ),
        }

    concurrent = _concurrent_scenario(database_path, clients, project_count)
    scenarios["concurrent_reads"] = concurrent
    failures.extend(concurrent["failure_messages"])

    with closing(_read_connection(database_path)) as connection:
        after = _compact_fingerprint(connection)
    if before != after:
        failures.append("database fingerprint changed during read-only benchmark")

    chart_aggregation = _chart_aggregation_gate()
    failures.extend(chart_aggregation["failure_messages"])

    all_timings = []
    for name, scenario in scenarios.items():
        if name == "concurrent_reads":
            all_timings.extend(scenario.pop("_timings_raw"))
            continue
        contract = scenario.pop("_contract_raw")
        optimized = scenario.pop("_optimized_raw")
        scenario["regression_enforced"] = regression_enforced
        all_timings.extend(optimized["timings"])
        if not scenario["results_equivalent"]:
            failures.append(f"{name} optimized result differs from shared contract")
        failure = regression_failure(
            name, contract["median_ms"], optimized["median_ms"]
        )
        if failure and regression_enforced:
            failures.append(failure)

    all_timings.sort()
    return {
        "project_count": int(actual_projects),
        "attachment_metadata_count": int(actual_attachments),
        "clients": clients,
        "median_ms": round(statistics.median(all_timings), 6),
        "p95_ms": round(_percentile(all_timings, 0.95), 6),
        "failures": len(failures),
        "failure_messages": failures,
        "fingerprint_unchanged": before == after,
        "fingerprint_before": before,
        "fingerprint_after": after,
        "regression_limit": REGRESSION_LIMIT,
        "regression_enforced": regression_enforced,
        "chart_aggregation": chart_aggregation,
        "scenarios": scenarios,
    }


def run_benchmark(
    project_count=DEFAULT_PROJECTS,
    attachment_metadata_count=DEFAULT_ATTACHMENTS,
    clients=DEFAULT_CLIENTS,
    samples=DEFAULT_SAMPLES,
):
    """Build an isolated fixture, run read gates, and return JSON-ready results."""
    project_count = _validate_positive("project_count", project_count)
    attachment_metadata_count = _validate_positive(
        "attachment_metadata_count", attachment_metadata_count
    )
    clients = _validate_positive("clients", clients)
    samples = _validate_positive("samples", samples)
    if attachment_metadata_count < project_count:
        raise ValueError("attachment_metadata_count must be at least project_count")
    with tempfile.TemporaryDirectory(prefix="pm-system-benchmark-") as temporary:
        database_path = Path(temporary) / "synthetic-projects.db"
        _create_fixture(database_path, project_count, attachment_metadata_count)
        return _run_on_fixture(
            database_path,
            project_count,
            attachment_metadata_count,
            clients,
            samples,
        )


def _code_object(root, name):
    matches = []

    def visit(value):
        if not isinstance(value, types.CodeType):
            return
        if value.co_name == name:
            matches.append(value)
        for item in value.co_consts:
            visit(item)

    visit(root)
    if len(matches) != 1:
        raise RuntimeError(
            f"candidate code object {name!r} count must be one, found {len(matches)}"
        )
    return matches[0]


def _load_candidate_sqlcipher(candidate_path, runtime_dir):
    """Load only connector bytes and exact connection code extracted from candidate."""
    candidate_path = Path(candidate_path)
    runtime_dir = Path(runtime_dir)
    runtime_dir.mkdir(parents=True, exist_ok=True)
    archive = CArchiveReader(str(candidate_path))
    extracted = {}
    for entry in SQLCIPHER_RUNTIME_ENTRIES:
        if entry not in archive.toc:
            raise RuntimeError(f"candidate SQLCipher runtime entry missing: {entry}")
        destination = runtime_dir / PureWindowsPath(entry).name
        destination.write_bytes(archive.extract(entry))
        extracted[entry] = destination

    dll_handle = os.add_dll_directory(str(runtime_dir))
    package = types.ModuleType("sqlcipher3")
    package.__path__ = [str(runtime_dir)]
    sys.modules["sqlcipher3"] = package
    extension_path = extracted[SQLCIPHER_RUNTIME_ENTRIES[0]]
    spec = importlib.util.spec_from_file_location(
        "sqlcipher3._sqlite3", extension_path
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("candidate SQLCipher extension has no import loader")
    extension = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = extension
    spec.loader.exec_module(extension)
    package.connect = extension.connect
    package.dbapi2 = extension
    sys.modules["sqlcipher3.dbapi2"] = extension

    pyz_raw = archive.extract("PYZ.pyz")
    pyz_toc, _ = _read_pyz(pyz_raw)
    data_security_root = marshal.loads(
        _pyz_entry(pyz_raw, pyz_toc, "data_security")
    )
    sql_key_code = _code_object(data_security_root, "_sql_key")
    connect_code = _code_object(data_security_root, "connect_encrypted")
    function_globals = {
        "__builtins__": __builtins__,
        "sqlcipher3": package,
    }
    sql_key = types.FunctionType(sql_key_code, function_globals, "_sql_key")
    function_globals["_sql_key"] = sql_key
    connect_encrypted = types.FunctionType(
        connect_code,
        function_globals,
        "connect_encrypted",
        (False,),
    )
    return {
        "connect_encrypted": connect_encrypted,
        "extension": extension,
        "dll_handle": dll_handle,
        "connect_code_sha256": hashlib.sha256(
            marshal.dumps(connect_code)
        ).hexdigest(),
        "extension_sha256": sha256_file(extension_path),
    }


def _stdlib_sqlite_rejects(database_path):
    connection = sqlite3.connect(str(database_path))
    try:
        connection.execute("SELECT COUNT(*) FROM projects").fetchone()
    except sqlite3.DatabaseError:
        return True
    finally:
        connection.close()
    return False


def _run_candidate_sqlcipher_probe(
    candidate_path,
    runtime_dir,
    fixture_path,
    key_hex,
    project_count,
    attachment_metadata_count,
):
    runtime = _load_candidate_sqlcipher(candidate_path, runtime_dir)
    connect_encrypted = runtime["connect_encrypted"]
    extension = runtime["extension"]
    key = bytes.fromhex(key_hex)
    seed_path = Path(runtime_dir) / "plain-seed.db"
    _create_fixture(seed_path, project_count, attachment_metadata_count)
    with closing(sqlite3.connect(str(seed_path))) as seed:
        seed_sql = "\n".join(seed.iterdump())

    with closing(connect_encrypted(Path(fixture_path), key, False)) as writer:
        writer.execute("PRAGMA foreign_keys=OFF")
        writer.executescript(seed_sql)
        writer.execute("PRAGMA foreign_keys=ON")
        writer.commit()
        cipher_row = writer.execute("PRAGMA cipher_version").fetchone()
        cipher_version = str(cipher_row[0]) if cipher_row else ""

    encrypted_header = (
        Path(fixture_path).read_bytes()[:16] != b"SQLite format 3\x00"
    )
    stdlib_rejected = _stdlib_sqlite_rejects(fixture_path)
    failures = []
    with closing(connect_encrypted(Path(fixture_path), key, False)) as reader:
        reader.row_factory = extension.Row
        reader.execute("PRAGMA query_only=ON")
        before = _compact_fingerprint(reader)
        actual_projects = int(
            reader.execute("SELECT COUNT(*) FROM projects").fetchone()[0]
        )
        actual_attachments = int(
            reader.execute("SELECT COUNT(*) FROM attachments").fetchone()[0]
        )
        read_purchaser_board(
            fixture_path,
            Path(runtime_dir) / "unused-purchaser-backups",
            False,
            encrypted_connect=connect_encrypted,
            master_key=key,
        )
        _shared_project_summary(reader)
        _shared_attachment_page(reader, max(1, project_count // 2))
        write_error = ""
        try:
            reader.execute(
                "INSERT INTO projects "
                "(id, number, name, purchaser, status, year, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (-1, "FORBIDDEN", "forbidden", "forbidden", "active", 2026, "", ""),
            )
            reader.rollback()
            write_blocked = False
        except Exception as exc:
            write_blocked = True
            write_error = f"{type(exc).__name__}: {exc}"
            reader.rollback()
        after = _compact_fingerprint(reader)

    if not cipher_version:
        failures.append("candidate connector did not report PRAGMA cipher_version")
    if not encrypted_header:
        failures.append("candidate fixture has a plaintext SQLite header")
    if not stdlib_rejected:
        failures.append("stdlib sqlite unexpectedly read the encrypted fixture")
    if not write_blocked:
        failures.append("query_only candidate connection accepted a write")
    if before != after:
        failures.append("encrypted fixture fingerprint changed during read-only smoke")
    if actual_projects != project_count:
        failures.append(f"encrypted project count {actual_projects} != {project_count}")
    if actual_attachments != attachment_metadata_count:
        failures.append(
            "encrypted attachment count "
            f"{actual_attachments} != {attachment_metadata_count}"
        )
    return {
        "candidate_sha256": sha256_file(Path(candidate_path)),
        "connector_module": "sqlcipher3._sqlite3",
        "connector_source": "candidate:PYZ.pyz/data_security.connect_encrypted",
        "connector_code_sha256": runtime["connect_code_sha256"],
        "connector_extension_sha256": runtime["extension_sha256"],
        "cipher_name": "SQLCipher packaged extension",
        "cipher_version": cipher_version,
        "encrypted_header": encrypted_header,
        "stdlib_sqlite_rejected": stdlib_rejected,
        "write_blocked": write_blocked,
        "write_error": write_error,
        "fingerprint_unchanged": before == after,
        "fingerprint_before": before,
        "fingerprint_after": after,
        "project_count": actual_projects,
        "attachment_metadata_count": actual_attachments,
        "failures": len(failures),
        "failure_messages": failures,
    }


def run_candidate_sqlcipher_smoke(
    *,
    source_exe,
    source_sha256,
    python312,
    candidate_exe=None,
    candidate_sha256=None,
    project_count=40,
    attachment_metadata_count=120,
):
    """Probe an explicit hash-pinned candidate, or build an isolated one."""
    source_exe = Path(source_exe).resolve(strict=True)
    python312 = Path(python312).resolve(strict=True)
    source_hash_before = sha256_file(source_exe)
    if source_hash_before != str(source_sha256).lower():
        raise RuntimeError("candidate SQLCipher smoke source SHA-256 mismatch")
    if bool(candidate_exe) != bool(candidate_sha256):
        raise ValueError("candidate EXE and SHA-256 must be supplied together")
    explicit_candidate = Path(candidate_exe).resolve(strict=True) if candidate_exe else None
    if explicit_candidate and sha256_file(explicit_candidate) != str(candidate_sha256).lower():
        raise RuntimeError("candidate SQLCipher smoke candidate SHA-256 mismatch")
    previous_python = os.environ.get("PYTHON312")
    try:
        os.environ["PYTHON312"] = str(python312)
        with tempfile.TemporaryDirectory(prefix="pm-candidate-sqlcipher-") as temporary:
            root = Path(temporary)
            candidate = explicit_candidate or root / "candidate-sqlcipher-smoke.exe"
            integrity = root / "candidate-integrity.json"
            runtime_dir = root / "runtime"
            fixture = root / "encrypted-fixture.db"
            if explicit_candidate is None:
                build_candidate(
                    candidate,
                    integrity,
                    source=source_exe,
                    expected_source_sha256=source_sha256,
                )
            command = [
                str(python312),
                str(Path(__file__).resolve()),
                "--sqlcipher-probe",
                str(candidate),
                "--runtime-dir",
                str(runtime_dir),
                "--fixture",
                str(fixture),
                "--key-hex",
                "72a125dfe2d9195477a8367b612540a6e148f4251753b30955580f92ce00f188",
                "--projects",
                str(project_count),
                "--attachments",
                str(attachment_metadata_count),
            ]
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
                env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            )
            probe_stderr = (completed.stderr or "").strip()
            if not completed.stdout.strip():
                raise RuntimeError(
                    "candidate SQLCipher probe produced no JSON: "
                    f"exit={completed.returncode}, stderr={probe_stderr}"
                )
            report = json.loads(completed.stdout)
            if completed.returncode != (0 if report.get("failures") == 0 else 1):
                raise RuntimeError(
                    "candidate SQLCipher probe exit/report mismatch: "
                    f"exit={completed.returncode}, report={report!r}, "
                    f"stderr={probe_stderr}"
                )
            if explicit_candidate and (sha256_file(candidate) != str(candidate_sha256).lower()
                                       or report.get("candidate_sha256") != str(candidate_sha256).lower()):
                raise RuntimeError("candidate SQLCipher smoke candidate SHA-256 mismatch after probe")
            release_targets = (
                candidate,
                *(path for path in runtime_dir.rglob("*") if path.is_file()),
            )
            _wait_for_paths_release(release_targets)
    finally:
        if previous_python is None:
            os.environ.pop("PYTHON312", None)
        else:
            os.environ["PYTHON312"] = previous_python
    source_hash_after = sha256_file(source_exe)
    if source_hash_after != source_hash_before:
        raise RuntimeError("source EXE changed during candidate SQLCipher smoke")
    report["source_sha256_before"] = source_hash_before
    report["source_sha256_after"] = source_hash_after
    return report


def _parser():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--projects", type=int, default=DEFAULT_PROJECTS)
    parser.add_argument("--attachments", type=int, default=DEFAULT_ATTACHMENTS)
    parser.add_argument("--clients", type=int, default=DEFAULT_CLIENTS)
    parser.add_argument("--samples", type=int, default=DEFAULT_SAMPLES)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--candidate-sqlcipher-smoke", action="store_true")
    parser.add_argument("--candidate-exe", type=Path)
    parser.add_argument("--candidate-sha256")
    parser.add_argument("--source-exe", type=Path)
    parser.add_argument("--source-sha256")
    parser.add_argument("--python312", type=Path)
    parser.add_argument("--sqlcipher-probe", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--runtime-dir", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--fixture", type=Path, help=argparse.SUPPRESS)
    parser.add_argument("--key-hex", help=argparse.SUPPRESS)
    return parser


def main(argv=None):
    arguments = _parser().parse_args(argv)
    if arguments.sqlcipher_probe:
        required = (arguments.runtime_dir, arguments.fixture, arguments.key_hex)
        if any(value is None for value in required):
            raise SystemExit(
                "--sqlcipher-probe requires --runtime-dir, --fixture and --key-hex"
            )
        report = _run_candidate_sqlcipher_probe(
            arguments.sqlcipher_probe,
            arguments.runtime_dir,
            arguments.fixture,
            arguments.key_hex,
            arguments.projects,
            arguments.attachments,
        )
    elif arguments.candidate_sqlcipher_smoke:
        required = (
            arguments.source_exe,
            arguments.source_sha256,
            arguments.python312,
        )
        if any(value is None for value in required):
            raise SystemExit(
                "--candidate-sqlcipher-smoke requires --source-exe, "
                "--source-sha256 and --python312"
            )
        report = run_candidate_sqlcipher_smoke(
            source_exe=arguments.source_exe,
            source_sha256=arguments.source_sha256,
            python312=arguments.python312,
            candidate_exe=arguments.candidate_exe,
            candidate_sha256=arguments.candidate_sha256,
            project_count=arguments.projects,
            attachment_metadata_count=arguments.attachments,
        )
    else:
        report = run_benchmark(
            project_count=arguments.projects,
            attachment_metadata_count=arguments.attachments,
            clients=arguments.clients,
            samples=arguments.samples,
        )
    rendered = json.dumps(report, ensure_ascii=False, sort_keys=True, indent=2) + "\n"
    if arguments.output:
        arguments.output.parent.mkdir(parents=True, exist_ok=True)
        arguments.output.write_text(rendered, encoding="utf-8", newline="\n")
    print(rendered, end="")
    return 0 if report["failures"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
