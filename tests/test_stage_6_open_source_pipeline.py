"""Stage 6 tests: Standalone pure-source app assembly & PyInstaller build pipeline without legacy base EXE."""
from __future__ import annotations

import json
from pathlib import Path
import tempfile
import unittest

from src.backend_patches import stats_calendar_log_routes
from src.project_manager import PURE_SOURCE_SIGNATURE, standalone_app
from tools import build_open_source


ROOT = Path(__file__).resolve().parents[1]


def _expected_version() -> str:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return "v" + str(pkg["version"])


class Stage6OpenSourcePipelineTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def test_version_and_release_metadata_are_synchronized(self) -> None:
        pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        version = str(pkg["version"])
        tag_version = f"v{version}"
        self.assertEqual(standalone_app.APP_VERSION, tag_version)
        self.assertEqual(stats_calendar_log_routes.DEFAULT_BACKEND_VERSION, tag_version)
        manifest_path = ROOT / "docs" / "releases" / f"{tag_version}-public.json"
        notes_path = ROOT / "docs" / "releases" / "notes" / f"{tag_version}-public.md"
        self.assertTrue(manifest_path.is_file(), f"Missing release manifest: {manifest_path}")
        self.assertTrue(notes_path.is_file(), f"Missing release notes: {notes_path}")
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest.get("version"), f"{tag_version}-public")

    def test_pure_source_app_creates_database_and_exposes_all_core_routes(self) -> None:
        self.assertEqual(PURE_SOURCE_SIGNATURE, "project-manager-pure-source-v1")
        expected_version = _expected_version()
        data_dir = self.tmp_path / "data"
        app = standalone_app.create_app(data_dir=data_dir, public_unrestricted=True)
        try:
            ext = app.extensions.get("standalone_pure_source")
            self.assertIsNotNone(ext)
            self.assertTrue(ext["pure_source"])
            self.assertEqual(ext["version"], expected_version)
            self.assertGreaterEqual(ext["route_count"], 70)

            # Verify SQLite file initialized from pure-source schema_models without legacy EXE
            db_file = data_dir / "bidding.db"
            self.assertTrue(db_file.is_file())

            # Verify key endpoints & template rendering via Flask test client
            client = app.test_client()
            login_resp = client.get("/login")
            self.assertEqual(login_resp.status_code, 302)
            self.assertEqual(login_resp.location, "/setup")
            self.assertEqual(client.get("/setup").status_code, 200)
            resp = client.get("/health")
            self.assertEqual(resp.status_code, 200)
            self.assertEqual(resp.get_json(), {"ok": True, "version": expected_version})

            lic_resp = client.get("/api/license/status")
            self.assertEqual(lic_resp.status_code, 200)
            lic_data = lic_resp.get_json()
            self.assertEqual(lic_data["status"], "valid")
            self.assertEqual(lic_data["mode"], "full")

            # Unauthenticated protected API route redirects/returns 401
            stats_resp = client.get("/api/stats")
            self.assertIn(stats_resp.status_code, (302, 401))
        finally:
            db = app.extensions["runtime_context"].get("db")
            with app.app_context():
                db.session.remove()
                db.engine.dispose()

    def test_build_open_source_dry_run_generates_spec_and_manifest(self) -> None:
        expected_version = _expected_version()
        out_dir = self.tmp_path / "os_build"
        manifest = build_open_source.build_open_source(
            edition="public",
            output_dir=out_dir,
            dry_run=True,
        )
        self.assertFalse(manifest["requires_legacy_source_exe"])
        self.assertEqual(manifest["edition"], "public")
        self.assertEqual(manifest["version"], expected_version)
        self.assertGreaterEqual(manifest["hidden_imports_count"], 30)
        self.assertTrue((out_dir / "pure_source.spec").is_file())
        self.assertTrue((out_dir / "open_source_build_manifest.json").is_file())

        spec_text = (out_dir / "pure_source.spec").read_text(encoding="utf-8")
        self.assertIn("source_launcher.py", spec_text)
        self.assertIn("run_desktop", (out_dir / "source_launcher.py").read_text(encoding="utf-8"))
        self.assertIn("project_manager.standalone_app", spec_text)
        self.assertIn("'templates'", spec_text)
        self.assertIn("'static'", spec_text)


if __name__ == "__main__":
    unittest.main()
