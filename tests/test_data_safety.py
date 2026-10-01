import hashlib
import json
import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


MODULE_DIR = Path(__file__).resolve().parents[1] / "src" / "backend_patches"
sys.path.insert(0, str(MODULE_DIR))

import data_safety  # noqa: E402
from data_safety import (  # noqa: E402
    create_verified_backup,
    database_fingerprint,
    run_additive_migration,
)


class DataSafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.database = self.root / "data" / "projects.db"
        self.backups = self.root / "backups"
        self.database.parent.mkdir(parents=True)
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executescript(
                """
                PRAGMA foreign_keys=ON;
                CREATE TABLE parent (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
                CREATE TABLE child (
                    id INTEGER PRIMARY KEY,
                    parent_id INTEGER NOT NULL REFERENCES parent(id),
                    value TEXT NOT NULL
                );
                INSERT INTO parent(id, name) VALUES (1, 'original parent');
                INSERT INTO child(id, parent_id, value) VALUES (2, 1, 'original child');
                """
            )
            connection.commit()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_verified_backup_matches_source_and_writes_manifest(self):
        calls = []

        def encrypted_connect(path, master_key, readonly):
            calls.append((Path(path), master_key, readonly))
            return sqlite3.connect(path)

        manifest = create_verified_backup(
            self.database,
            self.backups,
            encrypted_connect=encrypted_connect,
            master_key=b"secret",
        )

        self.assertEqual(
            set(manifest),
            {
                "path", "sha256", "size", "created_at",
                "source_fingerprint", "backup_fingerprint",
            },
        )
        backup_path = Path(manifest["path"])
        self.assertTrue(backup_path.is_file())
        self.assertEqual(manifest["sha256"], hashlib.sha256(backup_path.read_bytes()).hexdigest())
        self.assertEqual(manifest["size"], backup_path.stat().st_size)
        self.assertEqual(manifest["source_fingerprint"], manifest["backup_fingerprint"])
        self.assertTrue((backup_path.with_suffix(backup_path.suffix + ".json")).is_file())
        self.assertEqual(
            json.loads(backup_path.with_suffix(backup_path.suffix + ".json").read_text(encoding="utf-8")),
            manifest,
        )
        self.assertTrue(calls)
        self.assertTrue(all(key == b"secret" and readonly is False for _, key, readonly in calls))
        self.assertIn(self.database, [path for path, _, _ in calls])
        self.assertIn(backup_path, [path for path, _, _ in calls])

    def test_database_fingerprint_reports_table_counts_and_primary_keys(self):
        with closing(sqlite3.connect(self.database)) as connection:
            fingerprint = database_fingerprint(connection)

        self.assertEqual(fingerprint["integrity_check"], "ok")
        self.assertEqual(fingerprint["foreign_key_check"], [])
        self.assertEqual(fingerprint["tables"]["parent"]["count"], 1)
        self.assertEqual(fingerprint["tables"]["parent"]["primary_keys"], [1])
        self.assertEqual(fingerprint["tables"]["child"]["primary_keys"], [2])

    def test_database_fingerprint_supports_quoted_sqlite_identifiers(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                'CREATE TABLE "strange table" ("key column" INTEGER PRIMARY KEY, "blob-value" BLOB)'
            )
            connection.execute(
                'INSERT INTO "strange table"("key column", "blob-value") VALUES (?, ?)',
                (9, sqlite3.Binary(b"\x10\x00")),
            )
            connection.commit()
            fingerprint = database_fingerprint(connection)

        table = fingerprint["tables"]["strange table"]
        self.assertEqual(table["column_order"], ["key column", "blob-value"])
        self.assertEqual(table["primary_keys"], [9])
        self.assertEqual(table["count"], 1)

    def test_database_fingerprint_covers_schema_column_order_and_every_typed_value(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                "CREATE TABLE typed_payload ("
                "id INTEGER PRIMARY KEY, nullable TEXT, payload BLOB, amount REAL, note TEXT, "
                "note_length INTEGER GENERATED ALWAYS AS (length(note)) STORED)"
            )
            connection.execute(
                "INSERT INTO typed_payload(id, nullable, payload, amount, note) VALUES (?, ?, ?, ?, ?)",
                (7, None, sqlite3.Binary(b"\x00\xff"), 3.5, "same primary key"),
            )
            connection.commit()
            before = database_fingerprint(connection)
            connection.execute(
                "UPDATE typed_payload SET nullable=?, payload=?, amount=?, note=? WHERE id=?",
                ("", sqlite3.Binary(b"\x00\xfe"), -0.0, "changed non-primary values", 7),
            )
            connection.commit()
            after_values = database_fingerprint(connection)
            connection.execute("ALTER TABLE typed_payload ADD COLUMN appended INTEGER")
            connection.commit()
            after_schema = database_fingerprint(connection)

        before_table = before["tables"]["typed_payload"]
        after_values_table = after_values["tables"]["typed_payload"]
        self.assertEqual(before_table["count"], after_values_table["count"])
        self.assertEqual(before_table["primary_keys"], after_values_table["primary_keys"])
        self.assertEqual(
            before_table["column_order"],
            ["id", "nullable", "payload", "amount", "note", "note_length"],
        )
        self.assertNotEqual(before_table["rows_sha256"], after_values_table["rows_sha256"])
        self.assertNotEqual(before["content_sha256"], after_values["content_sha256"])
        self.assertNotEqual(after_values["schema_sha256"], after_schema["schema_sha256"])
        self.assertNotEqual(
            after_values_table["rows_sha256"],
            after_schema["tables"]["typed_payload"]["rows_sha256"],
        )

    def test_migration_allowlist_and_idempotency_create_only_one_backup(self):
        statements = [
            "CREATE TABLE migration_added (id INTEGER PRIMARY KEY, value TEXT)",
            "ALTER TABLE parent ADD COLUMN note TEXT",
            "CREATE INDEX idx_migration_added_value ON migration_added(value)",
            "CREATE VIEW parent_names AS SELECT id, name FROM parent",
        ]
        first = run_additive_migration(
            self.database, self.backups, "purchaser", "1", statements
        )
        second = run_additive_migration(
            self.database, self.backups, "purchaser", "1", statements
        )

        self.assertTrue(first["applied"])
        self.assertFalse(second["applied"])
        self.assertEqual(len(list(self.backups.glob("purchaser_pre_migration_*.db"))), 1)
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute("SELECT name FROM parent_names").fetchone()[0], "original parent")
            self.assertEqual(connection.execute("SELECT note FROM parent").fetchone()[0], None)
            self.assertEqual(connection.execute("SELECT value FROM __safe_migration_versions WHERE namespace='purchaser'").fetchone()[0], "1")

    def test_migration_rejects_destructive_sql_variants(self):
        destructive_statements = [
            " delete FROM parent",
            "/* leading comment */ DROP TABLE parent",
            "-- leading comment\nTRUNCATE TABLE parent",
            "REPLACE INTO parent(id, name) VALUES (1, 'changed')",
            "VACUUM INTO 'copy.db'",
            "ALTER /* comment */ TABLE parent RENAME TO renamed_parent",
        ]
        for statement in destructive_statements:
            with self.subTest(statement=statement):
                with self.assertRaises(ValueError):
                    run_additive_migration(
                        self.database, self.backups, "reject_" + str(len(statement)), "1", [statement]
                    )
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute("SELECT name FROM parent WHERE id=1").fetchone()[0], "original parent")

    def test_failing_migration_rolls_back_all_ddl_and_preserves_original_rows(self):
        statements = [
            "CREATE TABLE transient_table (id INTEGER PRIMARY KEY)",
            "ALTER TABLE missing_table ADD COLUMN value TEXT",
        ]

        with self.assertRaises(sqlite3.OperationalError):
            run_additive_migration(self.database, self.backups, "rollback", "1", statements)

        with closing(sqlite3.connect(self.database)) as connection:
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='transient_table'"
                ).fetchone()
            )
            self.assertEqual(
                connection.execute("SELECT id, name FROM parent").fetchall(), [(1, "original parent")]
            )
            self.assertEqual(
                connection.execute("SELECT id, parent_id, value FROM child").fetchall(), [(2, 1, "original child")]
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__safe_migration_versions'"
                ).fetchone()
            )

    def test_migration_aborts_when_database_changes_after_backup_before_lock(self):
        original_backup = data_safety.create_verified_backup

        def backup_then_concurrent_write(*args, **kwargs):
            manifest = original_backup(*args, **kwargs)
            with closing(sqlite3.connect(self.database)) as writer:
                writer.execute("UPDATE parent SET name='concurrent change' WHERE id=1")
                writer.commit()
            return manifest

        with patch.object(data_safety, "create_verified_backup", backup_then_concurrent_write):
            with self.assertRaisesRegex(RuntimeError, "changed after backup"):
                run_additive_migration(
                    self.database,
                    self.backups,
                    "concurrent_change",
                    "1",
                    ["CREATE TABLE must_not_exist (id INTEGER PRIMARY KEY)"],
                )

        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(
                connection.execute("SELECT name FROM parent WHERE id=1").fetchone()[0],
                "concurrent change",
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='must_not_exist'"
                ).fetchone()
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__safe_migration_versions'"
                ).fetchone()
            )

    def test_migration_aborts_without_changes_when_immediate_write_lock_is_unavailable(self):
        def no_wait_connect(path, master_key, readonly):
            return sqlite3.connect(path, timeout=0)

        with closing(sqlite3.connect(self.database)) as blocker:
            blocker.execute("BEGIN IMMEDIATE")
            with self.assertRaises(sqlite3.OperationalError):
                run_additive_migration(
                    self.database,
                    self.backups,
                    "locked",
                    "1",
                    ["CREATE TABLE locked_must_not_exist (id INTEGER PRIMARY KEY)"],
                    encrypted_connect=no_wait_connect,
                )
            blocker.rollback()

        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(
                connection.execute("SELECT id, name FROM parent").fetchall(),
                [(1, "original parent")],
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='locked_must_not_exist'"
                ).fetchone()
            )
            self.assertIsNone(
                connection.execute(
                    "SELECT 1 FROM sqlite_master WHERE type='table' AND name='__safe_migration_versions'"
                ).fetchone()
            )


if __name__ == "__main__":
    unittest.main()
