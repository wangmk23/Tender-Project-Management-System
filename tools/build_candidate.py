"""Build an integrity-checked candidate EXE from tested static resources."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import marshal
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from PyInstaller.archive.readers import ArchiveReadError, CArchiveReader

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from tools.patch_carchive import patch_executable
from tools.ui_template_patch import prepare_release_templates
from tools.compile_module_patches import (
    BACKEND_VERSION_SOURCES,
    BACKEND_VERSION_TARGET,
    BACKEND_VERSION_TARGETS,
    CONTROLLED_MODULE_SIGNATURES,
    _code_markers,
    _is_controlled_module,
    _named_code_objects,
    _pyz_entry,
    _read_pyz,
)


ROOT = Path(__file__).resolve().parents[1]
ALLOWED_REPLACEMENTS = {
    "PYZ.pyz",
    "desktop_app",
    "static\\app-icon.ico",
    "static\\app.js",
    "static\\style.css",
    "templates\\login.html",
    "templates\\workspace.html",
}
# A source may already contain the exact compiled backend patch. In that case
# an idempotent rebuild must not require PYZ.pyz to differ byte-for-byte; the
# candidate's module counts, markers, registrations, and versions are verified
# below regardless of whether the archive entry changed.
REQUIRED_REPLACEMENTS: set[str] = set()
SOURCE_EXE_ENV = "PM_SOURCE_EXE"
SOURCE_SHA256_ENV = "PM_SOURCE_EXE_SHA256"


def copy_windows_icon(executable: Path, icon_path: Path) -> None:
    """Copy an ICO into PE resources while preserving the PyInstaller overlay."""

    from PyInstaller.utils.win32.icon import CopyIcons_FromIco

    if not executable.is_file():
        raise FileNotFoundError(f"candidate EXE does not exist: {executable}")
    if not icon_path.is_file():
        raise FileNotFoundError(f"Windows icon does not exist: {icon_path}")
    reader = CArchiveReader(str(executable))
    original = executable.read_bytes()
    overlay = original[reader._start_offset :]
    for attempt in range(6):
        try:
            CopyIcons_FromIco(str(executable), [str(icon_path)])
            break
        except Exception as error:
            code=getattr(error, 'winerror', None)
            if code is None and error.args and isinstance(error.args[0], int):
                code=error.args[0]
            if code not in {32,110} or attempt == 5:
                raise
            time.sleep(.25 * (attempt + 1))
            executable.write_bytes(original)

    try:
        CArchiveReader(str(executable))
    except ArchiveReadError:
        with executable.open("ab") as stream:
            stream.write(overlay)
            stream.flush()
            os.fsync(stream.fileno())
    CArchiveReader(str(executable))


def _group_icon_ids(payload: bytes) -> tuple[int, ...]:
    """Return RT_ICON ids referenced by one RT_GROUP_ICON payload."""

    if len(payload) < 6:
        raise RuntimeError("Windows icon group header is truncated")
    reserved, image_type, count = struct.unpack_from("<HHH", payload)
    expected_length = 6 + count * 14
    if reserved != 0 or image_type != 1 or not count or len(payload) != expected_length:
        raise RuntimeError("Windows icon group metadata is invalid")
    return tuple(
        struct.unpack_from("<BBBBHHIH", payload, 6 + index * 14)[-1]
        for index in range(count)
    )


def _windows_icon_manifest(executable: Path) -> tuple[tuple[object, bytes, tuple[tuple[int, bytes], ...]], ...]:
    """Read each group icon and only the image resources it references."""

    import pefile

    pe = pefile.PE(str(executable), fast_load=True)
    try:
        pe.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_RESOURCE"]]
        )
        resources: dict[int, dict[object, bytes]] = {}
        for type_entry in pe.DIRECTORY_ENTRY_RESOURCE.entries:
            resource_type = type_entry.id
            if resource_type not in {3, 14}:
                continue
            typed_resources = resources.setdefault(resource_type, {})
            for name_entry in type_entry.directory.entries:
                name = str(name_entry.name) if name_entry.name is not None else name_entry.id
                languages = name_entry.directory.entries
                if len(languages) != 1:
                    raise RuntimeError(
                        f"Windows icon resource {resource_type}/{name!r} "
                        "must have exactly one language"
                    )
                data = languages[0].data.struct
                typed_resources[name] = bytes(pe.get_data(data.OffsetToData, data.Size))
        group_resources = resources.get(14, {})
        icon_resources = resources.get(3, {})
        group_names = sorted(
            group_resources,
            key=lambda value: (isinstance(value, str), str(value)),
        )
        return tuple(
            (
                group_name,
                group_payload,
                tuple(
                    (icon_id, icon_resources[icon_id])
                    for icon_id in _group_icon_ids(group_payload)
                ),
            )
            for group_name in group_names
            for group_payload in (group_resources[group_name],)
        )
    finally:
        pe.close()


def _ico_icon_manifest(icon_path: Path) -> tuple[tuple[object, bytes, tuple[tuple[int, bytes], ...]], ...]:
    from PyInstaller.utils.win32.icon import IconFile

    icon = IconFile(str(icon_path))
    group_payload = icon.grp_icon_dir() + icon.grp_icondir_entries(1)
    images = tuple((index, bytes(payload)) for index, payload in enumerate(icon.images, 1))
    return ((1, group_payload, images),)


def _icon_manifest_sha256(manifest) -> str:
    digest = hashlib.sha256()
    for group_name, group_payload, images in manifest:
        encoded_name = (
            f"string:{group_name}" if isinstance(group_name, str) else f"integer:{group_name}"
        ).encode("utf-8")
        digest.update(struct.pack("<II", len(encoded_name), len(group_payload)))
        digest.update(encoded_name)
        digest.update(group_payload)
        for icon_id, payload in images:
            digest.update(struct.pack("<II", icon_id, len(payload)))
            digest.update(payload)
    return digest.hexdigest()


def windows_icon_sha256(executable: Path) -> str:
    """Hash group-icon resources and only the images referenced by them."""

    return _icon_manifest_sha256(_windows_icon_manifest(executable))


def verify_windows_icon(executable: Path, icon_path: Path) -> None:
    """Require the executable's active PE icon resources to equal an ICO."""

    actual = _windows_icon_manifest(executable)
    expected = _ico_icon_manifest(icon_path)
    if actual != expected:
        raise RuntimeError(
            "Windows icon resources do not match the requested ICO: "
            f"expected={_icon_manifest_sha256(expected)}, "
            f"actual={_icon_manifest_sha256(actual)}"
        )


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def frontend_inventory() -> dict:
    module_root = (ROOT / "source" / "frontend").resolve()
    manifest_path = module_root / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    sections = manifest.get("sections")
    if manifest.get("version") != 1 or not isinstance(sections, list) or not sections:
        raise RuntimeError("frontend manifest contract is invalid")

    files = []
    markers = []
    module_hashes = {}
    module_payloads = []
    for section in sections:
        if not isinstance(section, dict):
            raise RuntimeError("frontend manifest section must be an object")
        filename = section.get("file")
        marker = section.get("marker")
        if not isinstance(filename, str) or not isinstance(marker, str) or not marker:
            raise RuntimeError("frontend manifest section is missing file or marker")
        path = (module_root / filename).resolve()
        if path.parent != module_root or not path.is_file():
            raise RuntimeError(f"frontend module path is invalid: {filename!r}")
        payload = path.read_bytes()
        marker_bytes = marker.encode("utf-8")
        if payload.count(marker_bytes) != 1:
            raise RuntimeError(
                f"frontend module marker count must be one: {filename!r}"
            )
        files.append(filename)
        markers.append(marker_bytes)
        module_payloads.append(payload)
        module_hashes[filename] = sha256_bytes(payload)

    if len(set(files)) != len(files) or len(set(markers)) != len(markers):
        raise RuntimeError("frontend manifest files and markers must be unique")
    assembled = b"".join(module_payloads)
    for marker in markers:
        if assembled.count(marker) != 1:
            raise RuntimeError("frontend assembled marker count must be one")
    bundle = (ROOT / "src" / "static" / "app.js").read_bytes()
    if assembled != bundle:
        raise RuntimeError("generated src/static/app.js is stale")
    normalized = bundle.replace(b"\r\n", b"\n")
    return {
        "frontend_module_sha256": module_hashes,
        "frontend_sha256": sha256_bytes(normalized),
    }


def validate_changed_entries(changed) -> None:
    actual = set(changed)
    missing = REQUIRED_REPLACEMENTS - actual
    unexpected = actual - ALLOWED_REPLACEMENTS
    if missing or unexpected:
        raise RuntimeError(
            "candidate EXE changes violate the archive whitelist: "
            f"missing={sorted(missing)!r}, unexpected={sorted(unexpected)!r}, "
            f"actual={sorted(actual)!r}"
        )


def resolve_source_executable(
    source: str | Path | None = None,
    expected_sha256: str | None = None,
) -> Path:
    configured_source = (
        str(source)
        if source is not None
        else os.environ.get(SOURCE_EXE_ENV, "").strip()
    )
    configured_hash = (
        expected_sha256
        if expected_sha256 is not None
        else os.environ.get(SOURCE_SHA256_ENV, "").strip()
    )
    if not configured_source:
        raise RuntimeError(
            f"{SOURCE_EXE_ENV} must identify the read-only source EXE"
        )
    if not configured_hash:
        raise RuntimeError(
            f"{SOURCE_SHA256_ENV} must pin the source EXE SHA-256"
        )

    requested = Path(configured_source)
    if requested.is_symlink():
        raise ValueError("source EXE must not be a symbolic link")
    source_path = requested.resolve(strict=True)
    if not source_path.is_file():
        raise FileNotFoundError(
            f"source EXE is not a regular file: {source_path}"
        )
    if source_path.suffix.lower() != ".exe":
        raise ValueError(
            f"source build input must use the .exe suffix: {source_path}"
        )
    normalized_hash = configured_hash.strip().lower()
    if len(normalized_hash) != 64 or any(
        character not in "0123456789abcdef" for character in normalized_hash
    ):
        raise ValueError(
            "source EXE SHA-256 must contain exactly 64 hexadecimal characters"
        )
    actual_hash = sha256_file(source_path)
    if not hmac.compare_digest(actual_hash, normalized_hash):
        raise RuntimeError(
            "source EXE SHA-256 mismatch: "
            f"expected={normalized_hash}, actual={actual_hash}"
        )
    return source_path


def find_python312() -> Path:
    configured = os.environ.get("PYTHON312", "").strip()
    if not configured:
        raise RuntimeError("PYTHON312 must point to a Python 3.12 executable")
    executable = Path(configured).resolve()
    if not executable.is_file():
        raise FileNotFoundError(f"PYTHON312 does not exist: {executable}")
    result = subprocess.run(
        [str(executable), "--version"],
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    version = (result.stdout or result.stderr).strip()
    if not version.startswith("Python 3.12."):
        raise RuntimeError(f"PYTHON312 has the wrong version: {version}")
    return executable


def _replace_with_retry(
    source: Path,
    destination: Path,
    *,
    timeout_seconds: float = 5.0,
    poll_interval_seconds: float = 0.05,
) -> None:
    """Atomically replace a file after transient Windows scanners release it."""

    deadline = time.monotonic() + timeout_seconds
    while True:
        try:
            os.replace(source, destination)
            return
        except PermissionError as exc:
            sharing_violation = os.name == "nt" and (
                getattr(exc, "winerror", None) == 32 or exc.errno == 32
            )
            if not sharing_violation or time.monotonic() >= deadline:
                raise
            time.sleep(poll_interval_seconds)


def _write_integrity_report(report_path: Path, report: dict) -> None:
    report_path.parent.mkdir(parents=True, exist_ok=True)
    temporary_report = report_path.with_suffix(report_path.suffix + ".tmp")
    temporary_report.write_text(
        json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    _replace_with_retry(temporary_report, report_path)


def _build_icon_only_candidate(source: Path, destination: Path, report_path: Path) -> dict:
    icon_path = ROOT / "src" / "assets" / "app-icon-transparent.ico"
    patch_executable(
        source,
        destination,
        {"static\\app-icon.ico": icon_path},
    )
    copy_windows_icon(destination, icon_path)

    original = CArchiveReader(str(source))
    candidate = CArchiveReader(str(destination))
    if set(candidate.toc) != set(original.toc):
        raise RuntimeError("icon-only candidate archive entry set changed")

    changed: list[str] = []
    unchanged_hashes: dict[str, str] = {}
    modified_hashes: dict[str, dict[str, str]] = {}
    for name, original_entry in original.toc.items():
        candidate_entry = candidate.toc[name]
        if candidate_entry[3:] != original_entry[3:]:
            raise RuntimeError(f"icon-only archive metadata changed: {name}")
        original_hash = sha256_bytes(original.extract(name))
        candidate_hash = sha256_bytes(candidate.extract(name))
        if original_hash == candidate_hash:
            unchanged_hashes[name] = original_hash
        else:
            changed.append(name)
            modified_hashes[name] = {
                "source_sha256": original_hash,
                "candidate_sha256": candidate_hash,
            }
    unexpected = set(changed) - {"static\\app-icon.ico"}
    if unexpected:
        raise RuntimeError(
            f"icon-only candidate changed unexpected entries: {sorted(changed)!r}"
        )
    packaged_icon = candidate.extract("static\\app-icon.ico")
    if packaged_icon != icon_path.read_bytes():
        raise RuntimeError("icon-only candidate tray icon does not match source asset")

    report = {
        "build_mode": "icon-only",
        "source_path": str(source),
        "source_sha256": sha256_file(source),
        "candidate_sha256": sha256_file(destination),
        "entry_count": len(original.toc),
        "changed_entries": changed,
        "modified_entry_sha256": modified_hashes,
        "unchanged_entry_sha256": unchanged_hashes,
        "protected_entry_sha256": unchanged_hashes,
        "tray_icon_sha256": sha256_bytes(packaged_icon),
        "windows_icon_sha256": windows_icon_sha256(destination),
    }
    _write_integrity_report(report_path, report)
    return report


def _build_candidate_unpublished(
    destination: Path,
    report_path: Path,
    *,
    source: Path,
    icon_only: bool = False,
) -> dict:
    if icon_only:
        return _build_icon_only_candidate(source, destination, report_path)
    python312 = find_python312()
    frontend_report = frontend_inventory()
    with tempfile.TemporaryDirectory() as temporary_directory:
        temporary_root = Path(temporary_directory)
        original = CArchiveReader(str(source))
        desktop_input = temporary_root / "desktop_app.marshal"
        pyz_input = temporary_root / "PYZ.pyz"
        desktop_output = temporary_root / "desktop_app.patched.marshal"
        pyz_output = temporary_root / "PYZ.patched.pyz"
        normalized_app = temporary_root / "app.js"
        normalized_style = temporary_root / "style.css"
        workspace_template = temporary_root / "workspace.html"
        login_template = temporary_root / "login.html"
        icon_path = ROOT / "src" / "assets" / "app-icon-transparent.ico"
        desktop_input.write_bytes(original.extract("desktop_app"))
        pyz_input.write_bytes(original.extract("PYZ.pyz"))
        normalized_app.write_bytes(
            (ROOT / "src" / "static" / "app.js")
            .read_bytes()
            .replace(b"\r\n", b"\n")
        )
        normalized_style.write_bytes(
            (ROOT / "src" / "static" / "style.css")
            .read_bytes()
            .replace(b"\r\n", b"\n")
        )
        workspace_html, login_html = prepare_release_templates(
            original.extract("templates\\workspace.html").decode("utf-8-sig"),
            original.extract("templates\\login.html").decode("utf-8-sig"),
            BACKEND_VERSION_TARGET,
        )
        workspace_template.write_bytes(b"\xef\xbb\xbf" + workspace_html.encode("utf-8"))
        login_template.write_bytes(b"\xef\xbb\xbf" + login_html.encode("utf-8"))
        subprocess.run(
            [
                str(python312),
                str(ROOT / "tools" / "compile_module_patches.py"),
                "compile",
                "--desktop-input",
                str(desktop_input),
                "--pyz-input",
                str(pyz_input),
                "--app-replacements",
                str(ROOT / "src" / "backend_patches" / "app_replacements.py"),
                "--desktop-replacements",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "desktop_app_replacements.py"
                ),
                "--purchaser-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "purchaser_classification.py"
                ),
                "--data-safety-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "data_safety.py"
                ),
                "--consortium-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "consortium_registration.py"
                ),
                "--project-activity-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "project_activity.py"
                ),
                "--data-import-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "data_import.py"
                ),
                "--signed-attachments-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "signed_attachments.py"
                ),
                "--device-admission-module",
                str(ROOT / "src" / "backend_patches" / "device_admission.py"),
                "--device-keyring-module",
                str(ROOT / "src" / "backend_patches" / "device_keyring.py"),
                "--device-access-page-module",
                str(ROOT / "src" / "backend_patches" / "device_access_page.py"),
                "--http-security-module",
                str(ROOT / "src" / "backend_patches" / "http_security.py"),
                "--data-recovery-module",
                str(ROOT / "src" / "backend_patches" / "data_recovery.py"),
                "--data-security-replacements",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "data_security_replacements.py"
                ),
                "--lot-supplier-risk-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "lot_supplier_risk.py"
                ),
                "--reminder-routing-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "reminder_routing.py"
                ),
                "--stage-workflow-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "stage_workflow.py"
                ),
                "--stage-templates-module",
                str(
                    ROOT
                    / "src"
                    / "backend_patches"
                    / "stage_templates.py"
                ),
                "--desktop-output",
                str(desktop_output),
                "--pyz-output",
                str(pyz_output),
            ],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
        subprocess.run(
            [
                str(python312),
                str(ROOT / "tools" / "compile_module_patches.py"),
                "verify",
                "--desktop",
                str(desktop_output),
                "--pyz",
                str(pyz_output),
            ],
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            env={**os.environ, "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
        replacements = {
            "PYZ.pyz": pyz_output,
            "desktop_app": desktop_output,
            "static\\app-icon.ico": icon_path,
            "static\\app.js": normalized_app,
            "static\\style.css": normalized_style,
            "templates\\workspace.html": workspace_template,
            "templates\\login.html": login_template,
        }
        patch_executable(source, destination, replacements)
        copy_windows_icon(destination, icon_path)

    original = CArchiveReader(str(source))
    candidate = CArchiveReader(str(destination))
    if set(candidate.toc) != set(original.toc):
        raise RuntimeError("候选 EXE 的归档条目集合发生变化")

    changed: list[str] = []
    unchanged_hashes: dict[str, str] = {}
    modified_hashes: dict[str, dict[str, str]] = {}
    protected_hashes: dict[str, str] = {}
    for name, original_entry in original.toc.items():
        candidate_entry = candidate.toc[name]
        if candidate_entry[3:] != original_entry[3:]:
            raise RuntimeError(f"归档元数据发生变化: {name}")
        original_hash = sha256_bytes(original.extract(name))
        candidate_hash = sha256_bytes(candidate.extract(name))
        if original_hash == candidate_hash:
            unchanged_hashes[name] = original_hash
        else:
            changed.append(name)
            modified_hashes[name] = {
                "source_sha256": original_hash,
                "candidate_sha256": candidate_hash,
            }
        if name not in ALLOWED_REPLACEMENTS:
            if original_hash != candidate_hash:
                raise RuntimeError(f"protected archive entry changed: {name}")
            protected_hashes[name] = original_hash

    if not REQUIRED_REPLACEMENTS <= set(changed) <= ALLOWED_REPLACEMENTS:
        raise RuntimeError(
            f"候选 EXE 修改项不符合白名单: expected={sorted(ALLOWED_REPLACEMENTS)!r}, actual={sorted(changed)!r}"
        )

    candidate_pyz = candidate.extract("PYZ.pyz")
    pyz_toc, _ = _read_pyz(candidate_pyz)
    toc_names = [name for name, _ in pyz_toc]
    pyz_module_counts = {
        name: toc_names.count(name)
        for name in (
            "online_bidding",
            "consortium_registration",
            "customer_management",
            "data_import",
            "data_safety",
            "project_activity",
            "lot_supplier_risk",
            "purchaser_classification",
            "signed_attachments",
            "upload_limit_settings",
            "reminder_routing",
            "stage_workflow",
            "stage_templates",
            "device_admission",
            "device_keyring",
            "device_access_page",
            "http_security",
            "data_recovery",
            "data_security",
        )
    }
    if pyz_module_counts != {
        "online_bidding": 1,
        "consortium_registration": 1,
        "customer_management": 0,
        "data_import": 1,
        "data_safety": 1,
        "project_activity": 1,
        "lot_supplier_risk": 1,
        "purchaser_classification": 1,
        "signed_attachments": 1,
        "upload_limit_settings": 1,
        "reminder_routing": 1,
        "stage_workflow": 1,
        "stage_templates": 1,
        "device_admission": 1,
        "device_keyring": 1,
        "device_access_page": 1,
        "http_security": 1,
        "data_recovery": 1,
        "data_security": 1,
    }:
        raise RuntimeError(f"candidate PYZ module counts are invalid: {pyz_module_counts!r}")
    app_root = marshal.loads(_pyz_entry(candidate_pyz, pyz_toc, "app"))
    desktop_root = marshal.loads(candidate.extract("desktop_app"))
    desktop_main = _named_code_objects(desktop_root, "main")
    data_security_root = marshal.loads(
        _pyz_entry(candidate_pyz, pyz_toc, "data_security")
    )
    data_security_loaders = _named_code_objects(
        data_security_root, "load_or_create_master_key"
    )
    device_admission_runtime_checks = {
        "device_admission_module_count": pyz_module_counts["device_admission"],
        "device_keyring_module_count": pyz_module_counts["device_keyring"],
        "device_access_page_module_count": pyz_module_counts["device_access_page"],
        "http_security_module_count": pyz_module_counts["http_security"],
        "data_recovery_module_count": pyz_module_counts["data_recovery"],
        "data_security_module_count": pyz_module_counts["data_security"],
        "device_admission_signature": _is_controlled_module(
            marshal.loads(_pyz_entry(candidate_pyz, pyz_toc, "device_admission")),
            CONTROLLED_MODULE_SIGNATURES["device_admission"],
        ),
        "device_keyring_signature": _is_controlled_module(
            marshal.loads(_pyz_entry(candidate_pyz, pyz_toc, "device_keyring")),
            CONTROLLED_MODULE_SIGNATURES["device_keyring"],
        ),
        "device_access_page_signature": _is_controlled_module(
            marshal.loads(_pyz_entry(candidate_pyz, pyz_toc, "device_access_page")),
            CONTROLLED_MODULE_SIGNATURES["device_access_page"],
        ),
        "http_security_signature": _is_controlled_module(
            marshal.loads(_pyz_entry(candidate_pyz, pyz_toc, "http_security")),
            CONTROLLED_MODULE_SIGNATURES["http_security"],
        ),
        "data_recovery_signature": _is_controlled_module(
            marshal.loads(_pyz_entry(candidate_pyz, pyz_toc, "data_recovery")),
            CONTROLLED_MODULE_SIGNATURES["data_recovery"],
        ),
        "interactive_recovery_loader": len(data_security_loaders) == 1
        and "v5-interactive-recovery-v1" in _code_markers(data_security_loaders[0]),
        "desktop_registration": len(desktop_main) == 1 and all(
            marker in _code_markers(desktop_main[0])
            for marker in (
                "device_admission",
                "device_keyring",
                "http_security",
                "install_http_security",
                "data_recovery",
            )
        ),
        "frontend_admin_panel": all(
            marker in candidate.extract("static\\app.js").decode("utf-8")
            for marker in (
                "deviceAdmissionState",
                "device-access",
                "/api/device-access/summary",
                "/api/data-recovery/bind",
                "dataRecoveryKeyInput",
            )
        ),
    }
    if not all(
        value == 1 if key.endswith("_count") else bool(value)
        for key, value in device_admission_runtime_checks.items()
    ):
        raise RuntimeError(
            "candidate device-admission runtime checks failed: "
            f"{device_admission_runtime_checks!r}"
        )
    stage_templates_root = marshal.loads(
        _pyz_entry(candidate_pyz, pyz_toc, "stage_templates")
    )
    stage_serializers = _named_code_objects(
        stage_templates_root, "serialize_v5_project_payload"
    )
    create_project_functions = _named_code_objects(app_root, "api_create_project")
    workflow_initializers = _named_code_objects(stage_templates_root, "initialize_project_workflow")
    frontend_text = candidate.extract("static\\app.js").decode("utf-8")
    style_text = candidate.extract("static\\style.css").decode("utf-8")
    stage_template_runtime_checks = {
        "stage_templates_module_count": pyz_module_counts["stage_templates"],
        "serializer_count": len(stage_serializers),
        "api_create_project_count": len(create_project_functions),
        "serializer_marker": bool(stage_serializers) and all(
            marker in _code_markers(stage_serializers[0])
            for marker in ("stage_name", "modules_json", "template_removed")
        ),
        "create_snapshot_marker": bool(create_project_functions)
        and "initialize_project_workflow" in _code_markers(create_project_functions[0])
        and len(workflow_initializers) == 1
        and all(marker in _code_markers(workflow_initializers[0])
                for marker in ("replace_v5_project_stage_snapshot", "template_for_method", "ensure_workflow_defaults")),
        "dynamic_frontend_helpers": all(
            marker in frontend_text
            for marker in ("resetModalState", "projectStageDefinition", "stageHasModule")
        ),
        "original_purchaser_grid": all(
            marker in style_text
            for marker in (".purchaser-category-grid", ".purchaser-unit-grid")
        ),
    }
    if not all(
        value == 1 if key.endswith("_count") else bool(value)
        for key, value in stage_template_runtime_checks.items()
    ):
        raise RuntimeError(
            "candidate stage-template runtime checks failed: "
            f"{stage_template_runtime_checks!r}"
        )
    login_required = _named_code_objects(app_root, "login_required")
    if len(login_required) != 1 or "install_upload_limit_settings" not in _code_markers(
        login_required[0]
    ):
        raise RuntimeError("candidate does not preserve upload-limit route installation")
    registration_patch_counts = {
        "serializer": sum(
            all(marker in _code_markers(code) for marker in (
                "bidder_type",
                "consortium_members",
                "registration_consortium_members",
            ))
            for code in _named_code_objects(app_root, "to_dict")
        ),
        **{
            name: len(_named_code_objects(app_root, name))
            for name in (
                "api_get_registrations",
                "api_create_registration",
                "api_update_registration",
                "api_delete_registration",
            )
        },
    }
    if registration_patch_counts != {
        "serializer": 1,
        "api_get_registrations": 1,
        "api_create_registration": 1,
        "api_update_registration": 1,
        "api_delete_registration": 1,
    }:
        raise RuntimeError(
            f"candidate registration patch counts are invalid: {registration_patch_counts!r}"
        )
    for name in BACKEND_VERSION_TARGETS:
        functions = _named_code_objects(app_root, name)
        if len(functions) != 1:
            raise RuntimeError(
                f"candidate backend version target {name!r} count is {len(functions)}"
            )
        markers = _code_markers(functions[0])
        if BACKEND_VERSION_TARGET not in markers or any(
            source_version in markers for source_version in BACKEND_VERSION_SOURCES if source_version != BACKEND_VERSION_TARGET
        ):
            raise RuntimeError(f"candidate backend version target is stale: {name!r}")

    report = {
        "build_mode": "standard",
        "source_path": str(source),
        "source_sha256": sha256_file(source),
        "candidate_sha256": sha256_file(destination),
        "entry_count": len(original.toc),
        "changed_entries": sorted(changed),
        "tray_icon_sha256": sha256_bytes(candidate.extract("static\\app-icon.ico")),
        "windows_icon_sha256": windows_icon_sha256(destination),
        "modified_entry_sha256": modified_hashes,
        "unchanged_entry_sha256": unchanged_hashes,
        "protected_entry_sha256": protected_hashes,
        "pyz_module_counts": pyz_module_counts,
        "registration_patch_counts": registration_patch_counts,
        "stage_template_runtime_checks": stage_template_runtime_checks,
        "device_admission_runtime_checks": device_admission_runtime_checks,
        "backend_version": BACKEND_VERSION_TARGET,
        **frontend_report,
    }
    _write_integrity_report(report_path, report)
    return report


def _validate_publication_paths(source: Path, destination: Path, report: Path) -> None:
    paths = [Path(path).resolve() for path in (source, destination, report)]
    for index, first in enumerate(paths):
        for second in paths[index + 1:]:
            same_name = os.path.normcase(str(first)) == os.path.normcase(str(second))
            same_file = first.exists() and second.exists() and os.path.samefile(first, second)
            if same_name or same_file:
                raise ValueError("source EXE, candidate EXE and integrity report must use distinct paths")


def _publish_verified_pair(candidate: Path, integrity: Path, destination: Path, report: Path) -> None:
    """Restore the previous pair if publication of either file fails.

    Two different files cannot be swapped as one filesystem transaction. This
    protects handled failures; a process/power interruption still needs the
    retained backup and integrity hash before a candidate is used.
    """
    backups = {}
    retain_backups = False
    try:
        for target in (destination, report):
            if target.exists():
                fd, name = tempfile.mkstemp(prefix='.previous-', suffix=target.suffix, dir=target.parent)
                os.close(fd)
                backup = Path(name)
                backups[target] = backup
                shutil.copy2(target, backup)
            else:
                backups[target] = None
        try:
            _replace_with_retry(candidate, destination)
            _replace_with_retry(integrity, report)
        except Exception as publication_error:
            failures = []
            for target, backup in backups.items():
                try:
                    if backup is None:
                        target.unlink(missing_ok=True)
                    else:
                        _replace_with_retry(backup, target)
                except Exception as rollback_error:
                    failures.append(f"{target}: {rollback_error}")
            if failures:
                retain_backups = True
                raise RuntimeError("publication failed and rollback needs recovery; backups retained: " + '; '.join(failures)) from publication_error
            raise
    finally:
        if not retain_backups:
            for backup in backups.values():
                if backup is not None:
                    backup.unlink(missing_ok=True)


def build_candidate(
    destination: Path,
    report_path: Path,
    *,
    source: str | Path | None = None,
    expected_source_sha256: str | None = None,
    icon_only: bool = False,
) -> dict:
    """Build and verify beside the destination, then publish the verified pair."""

    resolved_source = resolve_source_executable(source, expected_source_sha256)
    destination = Path(destination)
    report_path = Path(report_path)
    _validate_publication_paths(resolved_source, destination, report_path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    candidate_fd, candidate_name = tempfile.mkstemp(
        # Keep the temporary PE path ASCII-only.  Windows resource updates can
        # fail with ERROR_OPEN_FAILED for long non-ASCII temporary basenames.
        prefix=".candidate-",
        suffix=".tmp.exe",
        dir=destination.parent,
    )
    report_fd, report_name = tempfile.mkstemp(
        prefix=".integrity-",
        suffix=".tmp.json",
        dir=report_path.parent,
    )
    os.close(candidate_fd)
    os.close(report_fd)
    temporary_candidate = Path(candidate_name)
    temporary_report = Path(report_name)
    temporary_candidate.unlink()
    temporary_report.unlink()
    try:
        report = _build_candidate_unpublished(
            temporary_candidate,
            temporary_report,
            source=resolved_source,
            icon_only=icon_only,
        )
        verify_windows_icon(
            temporary_candidate,
            ROOT / "src" / "assets" / "app-icon-transparent.ico",
        )
        if json.loads(temporary_report.read_text(encoding="utf-8")) != report:
            raise RuntimeError("candidate integrity report does not match build result")
        _publish_verified_pair(temporary_candidate, temporary_report, destination, report_path)
        return report
    finally:
        temporary_candidate.unlink(missing_ok=True)
        temporary_report.unlink(missing_ok=True)


def parse_args(argv: list[str] | None = None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source-exe", default=os.environ.get(SOURCE_EXE_ENV))
    parser.add_argument(
        "--source-sha256", default=os.environ.get(SOURCE_SHA256_ENV)
    )
    parser.add_argument(
        "--destination", type=Path, default=ROOT / "dist" / "candidate.exe"
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=ROOT / "dist" / "candidate-integrity.json",
    )
    parser.add_argument(
        "--icon-only",
        action="store_true",
        help="replace only the packaged tray icon and Windows PE icon resources",
    )
    args = parser.parse_args(argv)
    if not args.source_exe:
        parser.error(f"--source-exe or {SOURCE_EXE_ENV} is required")
    if not args.source_sha256:
        parser.error(f"--source-sha256 or {SOURCE_SHA256_ENV} is required")
    return args


def main(argv: list[str] | None = None) -> None:
    args = parse_args(argv)
    report = build_candidate(
        args.destination,
        args.report,
        source=args.source_exe,
        expected_source_sha256=args.source_sha256,
        icon_only=args.icon_only,
    )
    print(f"candidate: {args.destination}")
    print(f"sha256: {report['candidate_sha256']}")
    print(f"entries: {report['entry_count']}, changed: {', '.join(report['changed_entries'])}")


if __name__ == "__main__":
    main()
