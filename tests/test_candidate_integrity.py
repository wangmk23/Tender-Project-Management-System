import hashlib
import gc
import inspect
import json
import marshal
import os
import shutil
import subprocess
import sys
import tempfile
import time
import types
import unittest
from datetime import datetime
from unittest.mock import patch
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader
from PIL import Image

import tools.build_candidate as candidate_builder
from tools.build_candidate import (
    ALLOWED_REPLACEMENTS,
    REQUIRED_REPLACEMENTS,
    build_candidate,
    resolve_source_executable,
    validate_changed_entries,
)
from tools.compile_module_patches import (
    _code_markers,
    _named_code_objects,
    _pyz_entry,
    _read_pyz,
)


ROOT = Path(__file__).resolve().parents[1]


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def unlink_with_retry(path: Path, timeout_seconds: float = 5.0) -> None:
    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            path.unlink()
            return
        except PermissionError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(0.05)


class CandidateIntegrityTests(unittest.TestCase):
    def test_verified_candidate_publish_retries_a_transient_share_violation(self):
        replace_with_retry = getattr(candidate_builder, "_replace_with_retry", None)
        self.assertIsNotNone(
            replace_with_retry,
            "verified candidate publication must tolerate transient Windows locks",
        )
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "verified.tmp.exe"
            destination = root / "candidate.exe"
            source.write_bytes(b"new verified candidate")
            destination.write_bytes(b"previous verified candidate")
            real_replace = os.replace
            attempts = 0

            def transient_then_replace(actual_source, actual_destination):
                nonlocal attempts
                attempts += 1
                if attempts == 1:
                    raise PermissionError(32, "synthetic sharing violation")
                return real_replace(actual_source, actual_destination)

            with (
                patch.object(candidate_builder.os, "replace", side_effect=transient_then_replace),
                patch.object(candidate_builder.time, "sleep") as sleep,
            ):
                replace_with_retry(source, destination, timeout_seconds=1)

            self.assertEqual(destination.read_bytes(), b"new verified candidate")
            self.assertEqual(attempts, 2)
            sleep.assert_called_once()

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PM_SOURCE_EXE_SHA256"),
        "icon-only candidate test requires an explicit hash-pinned source",
    )
    def test_icon_only_candidate_changes_no_other_archive_entries(self):
        self.assertIn(
            "icon_only",
            inspect.signature(build_candidate).parameters,
            "build_candidate icon-only mode is missing",
        )
        source = resolve_source_executable()
        with tempfile.TemporaryDirectory() as temp_dir:
            candidate = Path(temp_dir) / "icon-only.exe"
            report_path = Path(temp_dir) / "icon-only.json"
            report = build_candidate(
                candidate,
                report_path,
                source=source,
                expected_source_sha256=os.environ["PM_SOURCE_EXE_SHA256"],
                icon_only=True,
            )

            original = CArchiveReader(str(source))
            patched = CArchiveReader(str(candidate))
            target_icon = (
                ROOT / "src" / "assets" / "app-icon-transparent.ico"
            ).read_bytes()
            expected_changed = (
                set()
                if original.extract("static\\app-icon.ico") == target_icon
                else {"static\\app-icon.ico"}
            )
            changed = {
                name
                for name in original.toc
                if sha256_bytes(original.extract(name))
                != sha256_bytes(patched.extract(name))
            }
            self.assertEqual(changed, expected_changed)
            self.assertEqual(report["changed_entries"], sorted(expected_changed))
            self.assertEqual(report["build_mode"], "icon-only")
            self.assertEqual(
                report["windows_icon_sha256"],
                candidate_builder.windows_icon_sha256(candidate),
            )

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PM_SOURCE_EXE_SHA256"),
        "Windows icon resource test requires an explicit hash-pinned source",
    )
    def test_windows_icon_copy_is_idempotent_and_preserves_archive(self):
        copy_windows_icon = getattr(candidate_builder, "copy_windows_icon", None)
        windows_icon_sha256 = getattr(candidate_builder, "windows_icon_sha256", None)
        self.assertIsNotNone(copy_windows_icon, "copy_windows_icon is missing")
        self.assertIsNotNone(windows_icon_sha256, "windows_icon_sha256 is missing")

        source = resolve_source_executable()
        icon = ROOT / "src" / "assets" / "app-icon-transparent.ico"
        with tempfile.TemporaryDirectory() as temp_dir:
            candidate = Path(temp_dir) / "icon-resource-test.exe"
            shutil.copy2(source, candidate)
            copy_windows_icon(candidate, icon)
            after_icon_hash = windows_icon_sha256(candidate)
            copy_windows_icon(candidate, icon)
            self.assertEqual(windows_icon_sha256(candidate), after_icon_hash)

            original_archive = CArchiveReader(str(source))
            candidate_archive = CArchiveReader(str(candidate))
            self.assertEqual(set(candidate_archive.toc), set(original_archive.toc))
            for name in original_archive.toc:
                self.assertEqual(
                    sha256_bytes(candidate_archive.extract(name)),
                    sha256_bytes(original_archive.extract(name)),
                    name,
                )

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PM_SOURCE_EXE_SHA256"),
        "Windows icon verification requires an explicit hash-pinned source",
    )
    def test_windows_icon_verification_rejects_a_different_ico(self):
        verify_windows_icon = getattr(candidate_builder, "verify_windows_icon", None)
        self.assertIsNotNone(
            verify_windows_icon,
            "verify_windows_icon must compare PE resources with the requested ICO",
        )

        source = resolve_source_executable()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            wrong_icon = root / "wrong.ico"
            Image.new("RGBA", (32, 32), (230, 20, 20, 255)).save(
                wrong_icon,
                format="ICO",
                sizes=[(16, 16), (32, 32)],
            )

            with self.assertRaisesRegex(RuntimeError, "Windows icon"):
                verify_windows_icon(source, wrong_icon)

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PM_SOURCE_EXE_SHA256"),
        "transactional candidate build requires an explicit hash-pinned source",
    )
    def test_failed_build_preserves_the_previous_verified_candidate_pair(self):
        source = resolve_source_executable()
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            destination = root / "candidate.exe"
            report_path = root / "candidate-integrity.json"
            previous_candidate = b"previous verified candidate"
            previous_report = b'{"status":"verified"}\n'
            destination.write_bytes(previous_candidate)
            report_path.write_bytes(previous_report)

            with patch.object(
                candidate_builder,
                "copy_windows_icon",
                side_effect=RuntimeError("synthetic icon copy failure"),
            ):
                with self.assertRaisesRegex(RuntimeError, "synthetic icon copy failure"):
                    build_candidate(
                        destination,
                        report_path,
                        source=source,
                        expected_source_sha256=os.environ["PM_SOURCE_EXE_SHA256"],
                        icon_only=True,
                    )

            self.assertEqual(destination.read_bytes(), previous_candidate)
            self.assertEqual(report_path.read_bytes(), previous_report)

    def test_incremental_candidate_allows_idempotent_whitelisted_changes(self):
        validate_changed_entries({
            "templates\\workspace.html",
        })

        validate_changed_entries({"PYZ.pyz", "desktop_app"})
        with self.assertRaises(RuntimeError):
            validate_changed_entries({"PYZ.pyz", "templates\\unknown.html"})

    def test_build_candidate_rejects_wrong_source_hash_before_writing_output(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "source.exe"
            source.write_bytes(b"not-the-pinned-source")
            destination = root / "candidate.exe"
            report_path = root / "candidate-integrity.json"
            with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                build_candidate(
                    destination,
                    report_path,
                    source=source,
                    expected_source_sha256="0" * 64,
                )
            self.assertFalse(destination.exists())
            self.assertFalse(report_path.exists())

    def test_explicit_hash_pinned_source_is_portable_across_paths(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            alternate = root / "alternate.exe"
            alternate.write_bytes(b"alternate executable")
            destination = root / "candidate.exe"
            report_path = root / "candidate-integrity.json"

            self.assertEqual(
                resolve_source_executable(alternate, sha256_file(alternate)),
                alternate.resolve(),
            )
            self.assertFalse(destination.exists())
            self.assertFalse(report_path.exists())

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PM_SOURCE_EXE_SHA256"),
        "candidate integration requires an explicit hash-pinned source",
    )
    def test_candidate_changes_only_approved_resources_and_verifies_dependency_free_export(self):
        self.assertEqual(
            ALLOWED_REPLACEMENTS,
            {
                "PYZ.pyz", "desktop_app", "static\\app.js", "static\\style.css",
                "static\\app-icon.ico",
                "templates\\login.html", "templates\\workspace.html",
            },
        )
        python312 = Path(sys.executable)
        self.assertTrue(python312.is_file(), python312)
        source = resolve_source_executable()
        source_hash_before = sha256_file(source)
        self.assertEqual(source_hash_before, os.environ["PM_SOURCE_EXE_SHA256"])

        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            candidate = temp / "candidate.exe"
            report_path = temp / "candidate-integrity.json"
            with patch.dict(os.environ, {"PYTHON312": str(python312)}):
                report = build_candidate(
                    candidate,
                    report_path,
                    source=source,
                    expected_source_sha256=os.environ["PM_SOURCE_EXE_SHA256"],
                )

            original = CArchiveReader(str(source))
            patched = CArchiveReader(str(candidate))
            self.assertEqual(set(patched.toc), set(original.toc))

            changed: set[str] = set()
            for name, original_entry in original.toc.items():
                patched_entry = patched.toc[name]
                self.assertEqual(patched_entry[3:], original_entry[3:], name)
                original_hash = sha256_bytes(original.extract(name))
                patched_hash = sha256_bytes(patched.extract(name))
                if original_hash != patched_hash:
                    changed.add(name)

            self.assertTrue(REQUIRED_REPLACEMENTS <= changed <= ALLOWED_REPLACEMENTS)
            self.assertEqual(report["changed_entries"], sorted(changed))
            self.assertEqual(report["source_sha256"], source_hash_before)
            self.assertEqual(report["source_path"], str(source.resolve()))
            self.assertEqual(report["candidate_sha256"], sha256_file(candidate))
            self.assertEqual(report["entry_count"], len(original.toc))
            self.assertEqual(json.loads(report_path.read_text(encoding="utf-8")), report)
            packaged_icon = patched.extract("static\\app-icon.ico")
            self.assertEqual(
                packaged_icon,
                (ROOT / "src" / "assets" / "app-icon-transparent.ico").read_bytes(),
            )
            self.assertEqual(report["tray_icon_sha256"], sha256_bytes(packaged_icon))
            self.assertEqual(
                report["windows_icon_sha256"],
                candidate_builder.windows_icon_sha256(candidate),
            )
            self.assertEqual(report["backend_version"], candidate_builder.BACKEND_VERSION_TARGET)
            self.assertEqual(
                report["pyz_module_counts"],
                {
                    "consortium_registration": 1,
                    "customer_management": 0,
                    "data_import": 1,
                    "data_safety": 1,
                    "lot_supplier_risk": 1,
                    "online_bidding": 1,
                    "project_activity": 1,
                    "purchaser_classification": 1,
                    "signed_attachments": 1,
                    "upload_limit_settings": 1,
                    "reminder_routing": 1,
                    "stage_templates": 1,
                    "stage_workflow": 1,
                    "device_admission": 1,
                    "device_keyring": 1,
                    "device_access_page": 1,
                    "http_security": 1,
                    "data_recovery": 1,
                    "data_security": 1,
                },
            )
            self.assertEqual(
                report["registration_patch_counts"],
                {
                    "serializer": 1,
                    "api_get_registrations": 1,
                    "api_create_registration": 1,
                    "api_update_registration": 1,
                    "api_delete_registration": 1,
                },
            )
            self.assertEqual(
                report["stage_template_runtime_checks"],
                {
                    "stage_templates_module_count": 1,
                    "serializer_count": 1,
                    "api_create_project_count": 1,
                    "serializer_marker": True,
                    "create_snapshot_marker": True,
                    "dynamic_frontend_helpers": True,
                    "original_purchaser_grid": True,
                },
            )
            self.assertEqual(
                report["device_admission_runtime_checks"],
                {
                    "device_admission_module_count": 1,
                    "device_keyring_module_count": 1,
                    "device_access_page_module_count": 1,
                    "http_security_module_count": 1,
                    "data_recovery_module_count": 1,
                    "data_security_module_count": 1,
                    "device_admission_signature": True,
                    "device_keyring_signature": True,
                    "device_access_page_signature": True,
                    "http_security_signature": True,
                    "data_recovery_signature": True,
                    "interactive_recovery_loader": True,
                    "desktop_registration": True,
                    "frontend_admin_panel": True,
                },
            )
            self.assertEqual(
                set(report["frontend_module_sha256"]),
                {
                    "00-icons.js",
                    "01-core.js",
                    "02-projects.js",
                    "03-attachments.js",
                    "04-project-workflow.js",
                    "05-views.js",
                    "06-admin.js",
                    "07-business.js",
                    "08-bootstrap.js",
                    "09-command-center.js",
                    "10-chart-board.js",
                    "11-stage-settings.js",
                    "12-settings-navigation.js",
                    "13-device-admission.js",
                    "14-online-bidding.js",
                    "15-select-popup.js",
                    "16-purchaser-workspace.js",
                },
            )
            self.assertEqual(
                report["frontend_sha256"],
                sha256_bytes(patched.extract("static\\app.js")),
            )
            self.assertEqual(
                patched.extract("static\\app.js"),
                (Path("src/static/app.js").read_bytes().replace(b"\r\n", b"\n")),
            )
            desktop_root = marshal.loads(patched.extract("desktop_app"))
            desktop_main = _named_code_objects(desktop_root, "main")
            self.assertEqual(len(desktop_main), 1)
            desktop_main_markers = _code_markers(desktop_main[0])
            self.assertIn("data_import", desktop_main_markers)
            self.assertIn("signed_attachments", desktop_main_markers)
            self.assertIn("register_routes", desktop_main_markers)
            self.assertIn("_attachment_response", desktop_main_markers)
            self.assertIn("device_admission", desktop_main_markers)
            self.assertIn("device_keyring", desktop_main_markers)
            self.assertIn("http_security", desktop_main_markers)
            self.assertIn("data_recovery", desktop_main_markers)
            self.assertIn("install_http_security", desktop_main_markers)
            frontend = patched.extract("static\\app.js").decode("utf-8")
            for runtime_marker in (
                "resetModalState",
                "projectStageDefinition",
                "stageHasModule",
            ):
                self.assertIn(runtime_marker, frontend)
            for workflow_marker in (
                "STAGE_ICON_OPTIONS",
                "batchMethodSelect",
                "procureBoardYears",
                "bidSupplierOptionsHtml",
            ):
                self.assertIn(workflow_marker, frontend)
            for retained_feature in (
                "supplierRiskStateOf",
                "showRegistrationImportDialog",
                "normalizeAttachmentUploadLimitMb",
            ):
                self.assertIn(retained_feature, frontend)
            for marker in (
                "按采购人分类",
                "purchaser_board_view",
                "openPurchaserProjects",
                "投标主体类型",
                "联合体牵头单位",
                "data-consortium-action",
            ):
                self.assertIn(marker, frontend)
            for removed_marker in (
                "view-customers",
                "customer_action",
                "mergeCustomer",
            ):
                self.assertNotIn(removed_marker, frontend)
            self.assertEqual(
                patched.extract("static\\style.css"),
                (Path("src/static/style.css").read_bytes().replace(b"\r\n", b"\n")),
            )
            workspace = patched.extract("templates\\workspace.html").decode("utf-8-sig")
            login = patched.extract("templates\\login.html").decode("utf-8-sig")
            self.assertIn("<title>项目管理系统</title>", workspace)
            self.assertNotRegex(workspace, r'<div class="logo"[^>]*>.*?<span[^>]*>v\d')
            self.assertIn("<title>项目管理系统 - 登录</title>", login)
            self.assertIn("login-theme-bootstrap", login)
            inner_toc, _ = _read_pyz(patched.extract("PYZ.pyz"))
            inner_modules = dict(inner_toc)
            self.assertIn("purchaser_classification", inner_modules)
            self.assertIn("data_safety", inner_modules)
            self.assertIn("consortium_registration", inner_modules)
            self.assertIn("lot_supplier_risk", inner_modules)
            self.assertIn("upload_limit_settings", inner_modules)
            self.assertIn("reminder_routing", inner_modules)
            self.assertIn("stage_workflow", inner_modules)
            self.assertIn("device_admission", inner_modules)
            self.assertIn("device_keyring", inner_modules)
            self.assertIn("device_access_page", inner_modules)
            self.assertIn("http_security", inner_modules)
            stage_workflow_root = marshal.loads(
                _pyz_entry(patched.extract("PYZ.pyz"), inner_toc, "stage_workflow")
            )
            self.assertTrue(
                any(
                    "stage-workflow-order-v1" in marker
                    for marker in _code_markers(stage_workflow_root)
                )
            )
            signed_root = marshal.loads(
                _pyz_entry(patched.extract("PYZ.pyz"), inner_toc, "signed_attachments")
            )
            signed_markers = _code_markers(signed_root)
            self.assertIn("attachment_response", signed_markers)
            self.assertIn("decrypt-unavailable", signed_markers)
            for removed_module in (
                "customer_management",
                "customer_classification",
                "customer_tags",
            ):
                self.assertNotIn(removed_module, inner_modules)

            app_root = marshal.loads(
                _pyz_entry(patched.extract("PYZ.pyz"), inner_toc, "app")
            )
            login_required = _named_code_objects(app_root, "login_required")
            self.assertEqual(len(login_required), 1)
            self.assertIn(
                "install_upload_limit_settings",
                _code_markers(login_required[0]),
            )
            schedulers = _named_code_objects(
                app_root,
                "run_scheduled_backup_if_due",
            )
            self.assertEqual(len(schedulers), 1)
            settings_reads = []

            def load_app_settings():
                settings_reads.append("read")
                return {
                    "backup_time": "00:00",
                    "last_backup_date": "1900-01-01",
                    "reminder_enabled": False,
                }

            runtime = {
                "__builtins__": __builtins__,
                "SETTINGS_PATH": temp / "runtime-settings.json",
                "create_full_backup": lambda: "formal-runtime-backup",
                "datetime": datetime,
                "load_app_settings": load_app_settings,
            }
            scheduler = types.FunctionType(
                schedulers[0],
                runtime,
                argdefs=(None,),
            )
            self.assertEqual(str(inspect.signature(scheduler)), "(now=None)")
            self.assertEqual(scheduler(), "formal-runtime-backup")
            self.assertEqual(settings_reads, ["read", "read"])
            with self.assertRaises(TypeError):
                scheduler(job="digest")

            protected_groups = {
                "database": {name for name in original.toc if name == "bidding.db"},
                "other_templates": {
                    name for name in original.toc
                    if name.startswith("templates\\") and name not in ALLOWED_REPLACEMENTS
                },
                "runtime_dlls": {
                    name for name in original.toc if name.lower().endswith(".dll")
                },
                "icons": {
                    name
                    for name in original.toc
                    if name.lower().endswith((".ico", ".png", ".svg"))
                    and name != "static\\app-icon.ico"
                },
                "bundled_assets": {
                    name
                    for name in original.toc
                    if name.startswith("static\\libs\\")
                    or name == "static\\license_public_key.pem"
                },
            }
            for group, entries in protected_groups.items():
                self.assertTrue(entries, f"protected group is empty: {group}")
            for protected in set().union(*protected_groups.values()):
                self.assertEqual(
                    sha256_bytes(patched.extract(protected)),
                    sha256_bytes(original.extract(protected)),
                    protected,
                )
                self.assertEqual(
                    report["protected_entry_sha256"][protected],
                    sha256_bytes(original.extract(protected)),
                    protected,
                )

            expected_protected = set(original.toc) - ALLOWED_REPLACEMENTS
            self.assertEqual(set(report["protected_entry_sha256"]), expected_protected)

            desktop_module = temp / "desktop_app.marshal"
            pyz_archive = temp / "PYZ.pyz"
            desktop_module.write_bytes(patched.extract("desktop_app"))
            pyz_archive.write_bytes(patched.extract("PYZ.pyz"))
            result = subprocess.run(
                [
                    str(python312),
                    "tools/compile_module_patches.py",
                    "verify",
                    "--desktop",
                    str(desktop_module),
                    "--pyz",
                    str(pyz_archive),
                ],
                check=True,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            self.assertEqual(result.stdout, "module patches verified\n")

            del patched
            gc.collect()
            unlink_with_retry(candidate)

        self.assertEqual(sha256_file(source), source_hash_before)
        self.assertEqual(source_hash_before, os.environ["PM_SOURCE_EXE_SHA256"])


if __name__ == "__main__":
    unittest.main()
