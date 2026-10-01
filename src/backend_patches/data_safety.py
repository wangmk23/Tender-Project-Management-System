"""Verified, additive-only SQLite migrations for the packaged application."""

from __future__ import annotations

import hashlib
import json
import os
import re
import sqlite3
import struct
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path


_VERSION_TABLE = "__safe_migration_versions"
_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)
_LINE_COMMENT = re.compile(r"--[^\r\n]*")
_DESTRUCTIVE = re.compile(r"\b(?:DELETE|DROP|TRUNCATE|REPLACE|VACUUM|RENAME)\b", re.I)
_ADDITIVE = (
    re.compile(r"^CREATE\s+(?:TEMP(?:ORARY)?\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?", re.I),
    re.compile(r"^ALTER\s+TABLE\s+.+?\s+ADD(?:\s+COLUMN)?\s+", re.I | re.DOTALL),
    re.compile(r"^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?", re.I),
    re.compile(r"^CREATE\s+(?:TEMP(?:ORARY)?\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?", re.I),
)


def _connect(database_path, encrypted_connect=None, master_key=None):
    path = Path(database_path)
    if encrypted_connect is None:
        connection = sqlite3.connect(str(path), timeout=10)
    else:
        connection = encrypted_connect(path, master_key, False)
    connection.execute("PRAGMA foreign_keys=ON")
    return connection


def _quote_identifier(value):
    value = str(value)
    if not value or "\x00" in value:
        raise ValueError("invalid SQL identifier")
    return '"' + value.replace('"', '""') + '"'


def _json_value(value):
    if isinstance(value, bytes):
        return {"bytes_hex": value.hex()}
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _row_values(row):
    return [_json_value(value) for value in tuple(row)]


def _digest_record(digest, tag, payload):
    tag = tag.encode("ascii") if isinstance(tag, str) else bytes(tag)
    payload = bytes(payload)
    digest.update(struct.pack(">I", len(tag)))
    digest.update(tag)
    digest.update(struct.pack(">Q", len(payload)))
    digest.update(payload)


def _canonical_value(value):
    if value is None:
        return b"N", b""
    if isinstance(value, bool):
        return b"I", b"1" if value else b"0"
    if isinstance(value, int):
        return b"I", str(value).encode("ascii")
    if isinstance(value, float):
        return b"F", struct.pack(">d", value)
    if isinstance(value, str):
        return b"T", value.encode("utf-8", errors="surrogatepass")
    if isinstance(value, (bytes, bytearray, memoryview)):
        return b"B", bytes(value)
    raise TypeError(f"unsupported SQLite value type: {type(value).__name__}")


def _schema_objects(connection, table_names):
    if table_names is None:
        return connection.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master "
            "WHERE type IN ('table', 'index', 'view', 'trigger') "
            "AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
        ).fetchall()
    names = set(table_names)
    return [
        row
        for row in connection.execute(
            "SELECT type, name, tbl_name, sql FROM sqlite_master "
            "WHERE type IN ('table', 'index', 'view', 'trigger') "
            "AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
        )
        if str(row[2]) in names or (str(row[0]) == "table" and str(row[1]) in names)
    ]


def _schema_digest(schema_objects):
    digest = hashlib.sha256()
    for row in schema_objects:
        for value in row:
            tag, payload = _canonical_value(value)
            _digest_record(digest, tag, payload)
    return digest.hexdigest()


def _row_order_clause(column_names):
    terms = []
    for column in column_names:
        quoted = _quote_identifier(column)
        terms.extend((f"typeof({quoted})", f"hex({quoted})"))
    return ", ".join(terms)


def _stream_rows_digest(connection, quoted_table, column_names):
    digest = hashlib.sha256()
    selected = ", ".join(_quote_identifier(column) for column in column_names)
    cursor = connection.execute(
        f"SELECT {selected} FROM {quoted_table} ORDER BY {_row_order_clause(column_names)}"
    )
    count = 0
    while True:
        rows = cursor.fetchmany(512)
        if not rows:
            break
        for row in rows:
            _digest_record(digest, "ROW", struct.pack(">I", len(row)))
            for value in row:
                tag, payload = _canonical_value(value)
                _digest_record(digest, tag, payload)
            count += 1
    return count, digest.hexdigest()


def _table_names(connection, protected_tables):
    if protected_tables is None:
        rows = connection.execute(
            "SELECT name FROM sqlite_master "
            "WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        return [str(row[0]) for row in rows]
    return sorted({str(name) for name in protected_tables})


def database_fingerprint(connection, protected_tables=None):
    """Return a deterministic, JSON-serializable schema and full-row summary."""
    integrity_rows = connection.execute("PRAGMA integrity_check").fetchall()
    integrity = "ok" if [row[0] for row in integrity_rows] == ["ok"] else [row[0] for row in integrity_rows]
    foreign_key_rows = connection.execute("PRAGMA foreign_key_check").fetchall()
    table_names = _table_names(connection, protected_tables)
    schema_objects = _schema_objects(connection, None if protected_tables is None else table_names)
    tables = {}
    content_digest = hashlib.sha256()
    schema_sha256 = _schema_digest(schema_objects)
    _digest_record(content_digest, "SCHEMA", bytes.fromhex(schema_sha256))
    for table in table_names:
        exists = connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not exists:
            missing_digest = hashlib.sha256(b"missing table").hexdigest()
            tables[table] = {
                "missing": True,
                "count": 0,
                "column_order": [],
                "primary_key_columns": [],
                "primary_keys": [],
                "rows_sha256": missing_digest,
            }
            _digest_record(content_digest, "TABLE", table.encode("utf-8"))
            _digest_record(content_digest, "ROWS", bytes.fromhex(missing_digest))
            continue
        quoted = _quote_identifier(table)
        columns = connection.execute(f"PRAGMA table_xinfo({quoted})").fetchall()
        column_order = [str(row[1]) for row in sorted(columns, key=lambda row: int(row[0]))]
        primary_key_columns = [
            str(row[1]) for row in sorted(columns, key=lambda row: int(row[5])) if int(row[5])
        ]
        if primary_key_columns:
            selected = ", ".join(_quote_identifier(column) for column in primary_key_columns)
            order_by = ", ".join(_quote_identifier(column) for column in primary_key_columns)
            primary_keys = connection.execute(
                f"SELECT {selected} FROM {quoted} ORDER BY {order_by}"
            ).fetchall()
            key_summary = [
                _json_value(row[0]) if len(primary_key_columns) == 1 else _row_values(row)
                for row in primary_keys
            ]
        else:
            key_summary = []
        count, rows_sha256 = _stream_rows_digest(connection, quoted, column_order)
        tables[table] = {
            "count": count,
            "column_order": column_order,
            "primary_key_columns": primary_key_columns,
            "primary_keys": key_summary,
            "rows_sha256": rows_sha256,
        }
        _digest_record(content_digest, "TABLE", table.encode("utf-8"))
        _digest_record(content_digest, "ROWS", bytes.fromhex(rows_sha256))
    return {
        "integrity_check": integrity,
        "foreign_key_check": [_row_values(row) for row in foreign_key_rows],
        "schema_sha256": schema_sha256,
        "content_sha256": content_digest.hexdigest(),
        "tables": tables,
    }


def _verify_database(connection):
    fingerprint = database_fingerprint(connection)
    if fingerprint["integrity_check"] != "ok":
        raise RuntimeError("database integrity check failed")
    if fingerprint["foreign_key_check"]:
        raise RuntimeError("database foreign key check failed")
    return fingerprint


def _sha256(path):
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _validate_label(label):
    if not _IDENTIFIER.fullmatch(str(label)):
        raise ValueError("backup label must be a safe identifier")
    return str(label)


def _write_manifest(path, manifest):
    temporary = path.with_name(path.name + ".tmp")
    try:
        with temporary.open("w", encoding="utf-8", newline="\n") as handle:
            json.dump(manifest, handle, ensure_ascii=False, sort_keys=True, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    finally:
        if temporary.exists():
            temporary.unlink()


def create_verified_backup(
    database_path,
    backup_dir,
    encrypted_connect=None,
    master_key=None,
    label="migration",
):
    """Back up through the configured connector and verify its database contents."""
    source_path = Path(database_path)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    backup_dir = Path(backup_dir)
    backup_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S_%f")
    destination = backup_dir / f"{_validate_label(label)}_{stamp}.db"

    with closing(_connect(source_path, encrypted_connect, master_key)) as source:
        source_fingerprint = _verify_database(source)
        with closing(_connect(destination, encrypted_connect, master_key)) as target:
            source.backup(target)
            backup_fingerprint = _verify_database(target)
    if source_fingerprint != backup_fingerprint:
        raise RuntimeError("verified backup fingerprint mismatch")

    manifest = {
        "path": str(destination),
        "sha256": _sha256(destination),
        "size": destination.stat().st_size,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "source_fingerprint": source_fingerprint,
        "backup_fingerprint": backup_fingerprint,
    }
    _write_manifest(destination.with_suffix(destination.suffix + ".json"), manifest)
    return manifest


def _without_comments(statement):
    return _LINE_COMMENT.sub(" ", _BLOCK_COMMENT.sub(" ", statement)).strip()


def _validate_additive_statement(statement):
    if not isinstance(statement, str) or not statement.strip():
        raise ValueError("migration statement must be non-empty SQL")
    normalized = _without_comments(statement).rstrip(";").strip()
    if not normalized or _DESTRUCTIVE.search(normalized):
        raise ValueError("migration contains a destructive statement")
    if not any(pattern.match(normalized) for pattern in _ADDITIVE):
        raise ValueError("migration statement is not additive SQL")
    if ";" in normalized:
        raise ValueError("migration statement must contain exactly one statement")
    return normalized


def _current_version(connection, namespace):
    exists = connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?", (_VERSION_TABLE,)
    ).fetchone()
    if not exists:
        return None
    row = connection.execute(
        f"SELECT value FROM {_quote_identifier(_VERSION_TABLE)} WHERE namespace=?", (namespace,)
    ).fetchone()
    return row[0] if row else None


def run_additive_migration(
    database_path,
    backup_dir,
    namespace,
    target_version,
    statements,
    encrypted_connect=None,
    master_key=None,
):
    """Apply a validated schema-only migration with a verified pre-change backup."""
    source_path = Path(database_path)
    if not source_path.is_file():
        raise FileNotFoundError(source_path)
    namespace = str(namespace)
    if not _IDENTIFIER.fullmatch(namespace):
        raise ValueError("migration namespace must be a safe identifier")
    target_version = str(target_version)
    normalized_statements = [_validate_additive_statement(statement) for statement in statements]
    if not normalized_statements:
        raise ValueError("migration must contain at least one statement")

    with closing(_connect(source_path, encrypted_connect, master_key)) as connection:
        if _current_version(connection, namespace) == target_version:
            return {"applied": False, "namespace": namespace, "version": target_version, "backup": None}

    backup = create_verified_backup(
        source_path,
        backup_dir,
        encrypted_connect=encrypted_connect,
        master_key=master_key,
        label=f"{namespace}_pre_migration",
    )
    with closing(_connect(source_path, encrypted_connect, master_key)) as connection:
        try:
            connection.execute("BEGIN IMMEDIATE")
            locked_fingerprint = _verify_database(connection)
            if locked_fingerprint != backup["backup_fingerprint"]:
                raise RuntimeError("database changed after backup; migration aborted")
            if _current_version(connection, namespace) == target_version:
                connection.rollback()
                return {
                    "applied": False,
                    "namespace": namespace,
                    "version": target_version,
                    "backup": None,
                }
            for statement in normalized_statements:
                connection.execute(statement)
            connection.execute(
                f"CREATE TABLE IF NOT EXISTS {_quote_identifier(_VERSION_TABLE)} ("
                "namespace TEXT PRIMARY KEY, value TEXT NOT NULL, applied_at TEXT NOT NULL)"
            )
            _verify_database(connection)
            connection.execute(
                f"INSERT INTO {_quote_identifier(_VERSION_TABLE)}(namespace, value, applied_at) VALUES (?, ?, ?)",
                (namespace, target_version, datetime.now(timezone.utc).isoformat()),
            )
            connection.commit()
        except Exception:
            connection.rollback()
            raise
    return {"applied": True, "namespace": namespace, "version": target_version, "backup": backup}
