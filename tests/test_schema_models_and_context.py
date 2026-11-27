"""Tests for Stage 1 (Declarative Schema Mirror) and Stage 2 (AppContextRegistry)."""
from __future__ import annotations

import os
import sqlite3
import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from src.backend_patches import data_safety, runtime_context, schema_models


class SchemaModelsAndContextTests(unittest.TestCase):
    def test_table_specs_cover_all_three_categories_and_build_mirror_tables(self):
        categories = {}
        for name, spec in schema_models.TABLE_SPECS.items():
            cat = spec["category"]
            categories[cat] = categories.get(cat, 0) + 1
            self.assertIn(name, schema_models.MIRROR_TABLES)
            table = schema_models.MIRROR_TABLES[name]
            expected_cols = [c["name"] for c in spec["columns"]]
            actual_cols = [c.name for c in table.columns]
            self.assertEqual(actual_cols, expected_cols, f"column mismatch in {name}")

        self.assertEqual(categories.get("core_orm"), 18)
        self.assertEqual(categories.get("materialized_patch"), 14)
        self.assertGreaterEqual(categories.get("on_demand_patch", 0), 29)
        self.assertEqual(len(schema_models.CORE_ORM_MIRRORS), 18)
        self.assertEqual(
            schema_models.STAGE_EXTENSION_COLUMNS,
            (
                "stage_name",
                "stage_icon",
                "modules_json",
                "template_removed",
                "stage_position",
                "opening_location",
                "evaluation_location",
                "publication_url",
                "completed_at",
            ),
        )
        self.assertEqual(
            schema_models.SUPPLIER_REGISTRATION_EXTENSION_COLUMNS,
            ("bidder_type",),
        )

    def test_in_memory_sqlite_from_mirror_metadata_passes_schema_verification(self):
        from sqlalchemy import create_engine

        engine = create_engine("sqlite:///:memory:")
        try:
            schema_models.MIRROR_METADATA.create_all(engine)
            with engine.connect() as conn:
                report = schema_models.verify_database_schema(conn)
                self.assertTrue(report["passed"], report)
                self.assertEqual(
                    report["verified_present_tables"],
                    len(schema_models.TABLE_SPECS),
                )
                self.assertEqual(report["missing_core_columns"], {})
                self.assertTrue(
                    schema_models.has_table_column(conn, "stages", "completed_at")
                )
                self.assertTrue(
                    schema_models.has_table_column(
                        conn, "supplier_registrations", "bidder_type"
                    )
                )
        finally:
            engine.dispose()

    def test_verify_host_orm_mirror_detects_stage_and_registration_extension_gaps(self):
        fake_host = {}
        for model_name, table_name in schema_models.CORE_ORM_TABLE_MAP.items():
            core_col_names = schema_models.expected_table_columns(
                table_name, include_extensions=False
            )
            fake_cols = [types.SimpleNamespace(name=c) for c in core_col_names]
            fake_host[model_name] = types.SimpleNamespace(
                __tablename__=table_name,
                __table__=types.SimpleNamespace(columns=fake_cols),
            )

        report = schema_models.verify_host_orm_mirror(fake_host)
        self.assertTrue(report["passed"], report)
        self.assertEqual(report["matched_core_models"], 18)
        self.assertEqual(
            set(report["known_extension_gaps_in_core_orm"]),
            {"Stage", "SupplierRegistration"},
        )
        self.assertEqual(
            tuple(report["known_extension_gaps_in_core_orm"]["Stage"]),
            tuple(sorted(schema_models.STAGE_EXTENSION_COLUMNS)),
        )
        self.assertEqual(
            tuple(report["known_extension_gaps_in_core_orm"]["SupplierRegistration"]),
            schema_models.SUPPLIER_REGISTRATION_EXTENSION_COLUMNS,
        )

    def test_register_supports_rollback_skip_env_switch(self):
        fake_app = types.SimpleNamespace(extensions={})
        with patch.dict(os.environ, {"PM_SKIP_SCHEMA_MIRROR": "1"}):
            state = schema_models.register(fake_app)
        self.assertTrue(state["skipped"])
        self.assertTrue(state["passed"])
        self.assertIs(fake_app.extensions["schema_registry"], state)

    def test_runtime_context_registry_supports_live_read_through_and_mapping(self):
        fake_app = types.SimpleNamespace(extensions={})
        fake_db = object()
        fake_project = type("Project", (), {})
        fake_user = type("User", (), {})
        host = types.SimpleNamespace(
            app=fake_app,
            db=fake_db,
            Project=fake_project,
            User=fake_user,
            DATA_DIR=Path("/tmp/data"),
            SETTINGS_PATH=Path("/tmp/data/app_settings.json"),
            STAGES=[{"key": "init"}],
            load_app_settings=lambda: {"theme": "default"},
        )
        fake_sec = types.SimpleNamespace(
            _dpapi_protect=lambda b: b,
            iter_decrypted_file=lambda p, k: iter(()),
        )

        ctx = runtime_context.register_runtime_context(
            host,
            data_security=fake_sec,
            desktop_bridge={"choose_export_folder": lambda: "/tmp/export"},
        )

        self.assertIs(fake_app.extensions["runtime_context"], ctx)
        self.assertIs(runtime_context.get_runtime_context(fake_app), ctx)
        self.assertIs(ctx.Project, fake_project)
        self.assertIs(ctx["User"], fake_user)
        self.assertIn("Project", ctx)
        self.assertEqual(ctx.choose_export_folder(), "/tmp/export")
        self.assertIs(ctx.iter_decrypted_file, fake_sec.iter_decrypted_file)

        # Live read-through when host attribute is monkeypatched by a test
        new_settings_path = Path("/tmp/override/app_settings.json")
        host.SETTINGS_PATH = new_settings_path
        self.assertEqual(ctx.SETTINGS_PATH, new_settings_path)
        self.assertEqual(
            runtime_context.resolve_host_symbol("SETTINGS_PATH", app_or_host=host),
            new_settings_path,
        )

        # Write-through to host module
        ctx._PROCUREMENT_CATALOG_ENABLED = True
        self.assertTrue(host._PROCUREMENT_CATALOG_ENABLED)
        models_dict = ctx.as_models_dict("Project", "User", "DATA_DIR", custom_flag=1)
        self.assertEqual(
            models_dict,
            {
                "Project": fake_project,
                "User": fake_user,
                "DATA_DIR": Path("/tmp/data"),
                "custom_flag": 1,
            },
        )

    def test_golden_master_database_fingerprint_is_deterministic_on_isolated_sqlite(self):
        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "golden.db"
            conn = sqlite3.connect(str(db_path))
            try:
                conn.execute(
                    "CREATE TABLE projects (id INTEGER PRIMARY KEY, number VARCHAR(50) NOT NULL, name VARCHAR(300) NOT NULL)"
                )
                conn.execute(
                    "INSERT INTO projects (id, number, name) VALUES (1, 'GDHD-2026-001', '黄金样本测试项目')"
                )
                conn.commit()
                cols = schema_models.table_columns(conn, "projects")
                self.assertEqual(cols, {"id", "number", "name"})
                fp1 = data_safety.database_fingerprint(conn)
                fp2 = data_safety.database_fingerprint(conn)
                self.assertEqual(fp1["schema_sha256"], fp2["schema_sha256"])
                self.assertEqual(fp1["tables"]["projects"]["rows_sha256"], fp2["tables"]["projects"]["rows_sha256"])
            finally:
                conn.close()

    def test_verify_against_isolated_copy_of_local_validation_baseline_db_when_available(self):
        base_dir = Path(os.environ.get("PM_TEST_LICENSE_DIR") or "__unconfigured_license_fixtures__")
        db_file = base_dir / "bidding.db"
        key_file = base_dir / "data_key.dpapi"
        if not (db_file.is_file() and key_file.is_file()):
            self.skipTest("local validation baseline database is not present")
        try:
            import ctypes
            import ctypes.wintypes
            import shutil
            from sqlcipher3 import dbapi2 as sqlcipher
        except Exception as exc:
            self.skipTest(f"sqlcipher3/DPAPI unavailable: {exc}")

        class DATA_BLOB(ctypes.Structure):
            _fields_ = [
                ("cbData", ctypes.wintypes.DWORD),
                ("pbData", ctypes.POINTER(ctypes.c_char)),
            ]

        raw = key_file.read_bytes()
        if raw.startswith(b"DPAPI"):
            raw = raw[5:]
        buf = ctypes.create_string_buffer(raw, len(raw))
        in_blob = DATA_BLOB(len(raw), ctypes.cast(buf, ctypes.POINTER(ctypes.c_char)))
        out_blob = DATA_BLOB()
        crypt32 = ctypes.windll.crypt32
        kernel32 = ctypes.windll.kernel32
        if not crypt32.CryptUnprotectData(
            ctypes.byref(in_blob), None, None, None, None, 0, ctypes.byref(out_blob)
        ):
            self.skipTest("DPAPI key belongs to a different Windows user context")
        try:
            key_bytes = ctypes.string_at(out_blob.pbData, out_blob.cbData)
        finally:
            kernel32.LocalFree(out_blob.pbData)

        with tempfile.TemporaryDirectory() as tmp:
            tmp_dir = Path(tmp)
            for suffix in ("", "-wal", "-shm"):
                src_f = base_dir / f"bidding.db{suffix}"
                if src_f.is_file():
                    shutil.copy2(src_f, tmp_dir / f"bidding.db{suffix}")
            conn = sqlcipher.connect(str(tmp_dir / "bidding.db"))
            try:
                conn.execute(f"PRAGMA key = \"x'{key_bytes.hex()}'\"")
                report = schema_models.verify_database_schema(conn)
                self.assertTrue(report["passed"], report)
                self.assertEqual(report["verified_present_tables"], 32)
                self.assertEqual(report["missing_core_columns"], {})
            finally:
                conn.close()

    def test_ast_gate_eliminates_ad_hoc_globals_get_and_raw_pragma_table_info_in_patches(self):
        patch_dir = Path(__file__).resolve().parents[1] / "src" / "backend_patches"
        globals_get_violations: list[str] = []
        pragma_violations: list[str] = []

        for py_file in sorted(patch_dir.glob("*.py")):
            source = py_file.read_text(encoding="utf-8")
            for idx, line in enumerate(source.splitlines(), 1):
                stripped = line.strip()
                if stripped.startswith("#") or stripped.startswith('"""'):
                    continue
                if "globals().get(" in stripped and py_file.name != "runtime_context.py":
                    globals_get_violations.append(f"{py_file.name}:{idx}: {stripped}")
                if "PRAGMA table_info" in stripped and py_file.name != "schema_models.py":
                    pragma_violations.append(f"{py_file.name}:{idx}: {stripped}")

        self.assertEqual(globals_get_violations, [])
        self.assertEqual(pragma_violations, [])

    def test_stage_3_all_split_modules_expose_controlled_signatures_and_thin_app_replacements(self):
        from src.backend_patches import (
            app_replacements,
            auth_decorators,
            project_crud_routes,
            project_event_reminders,
            project_xlsx_export,
            registration_routes,
            scheduled_digest_backup,
            stage_auto_completion,
            system_settings_service,
        )

        expected_signatures = {
            project_event_reminders.PROJECT_EVENT_REMINDERS_SIGNATURE: "project-event-reminders-v1",
            scheduled_digest_backup.SCHEDULED_DIGEST_BACKUP_SIGNATURE: "scheduled-digest-backup-v1",
            stage_auto_completion.STAGE_AUTO_COMPLETION_SIGNATURE: "stage-auto-completion-v1",
            system_settings_service.SYSTEM_SETTINGS_SERVICE_SIGNATURE: "system-settings-service-v1",
            project_xlsx_export.PROJECT_XLSX_EXPORT_SIGNATURE: "project-xlsx-export-v1",
            auth_decorators.AUTH_DECORATORS_SIGNATURE: "auth-decorators-v1",
            registration_routes.REGISTRATION_ROUTES_SIGNATURE: "registration-routes-v1",
            project_crud_routes.PROJECT_CRUD_ROUTES_SIGNATURE: "project-crud-routes-v1",
        }
        for actual, expected in expected_signatures.items():
            self.assertEqual(actual, expected)

        for handler in (
            project_event_reminders.run_project_event_reminders_if_due,
            scheduled_digest_backup.run_scheduled_backup_if_due,
            stage_auto_completion._auto_advance_stages,
            system_settings_service.api_get_settings,
            system_settings_service.api_update_settings,
            system_settings_service.save_app_settings,
            system_settings_service.get_export_dir,
            project_xlsx_export.api_export,
            auth_decorators.admin_required,
            auth_decorators.login_required,
            registration_routes.supplier_registration_to_dict,
            registration_routes.api_get_registrations,
            project_crud_routes.api_projects,
            project_crud_routes.api_project,
            project_crud_routes.api_update_stage,
            project_crud_routes.api_batch_advance_stage,
        ):
            self.assertTrue(callable(handler))

        app_rep_path = Path(app_replacements.__file__)
        line_count = len(app_rep_path.read_text(encoding="utf-8").splitlines())
        self.assertLess(line_count, 200)


if __name__ == "__main__":
    unittest.main()
