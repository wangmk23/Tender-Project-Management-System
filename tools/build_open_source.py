"""Pure-source PyInstaller build pipeline (Stage 6).

Builds the Public Edition directly from `src/` + `source/frontend/` without any
legacy `.exe` base archive (`--source-exe`). Also generates deterministic
PyInstaller `.spec` and build manifests for both `public` and
`compatible-bridge` configurations.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
STANDALONE_ENTRY = ROOT / "src" / "project_manager" / "standalone_app.py"
TEMPLATES_DIR = ROOT / "src" / "templates"
STATIC_DIR = ROOT / "src" / "project_manager" / "static"
ICON_PATH = ROOT / "src" / "assets" / "app-icon-transparent.ico"
LOCKFILE_PATH = ROOT / "requirements-lock.txt"
DEFAULT_APP_NAME = "项目管理系统"


def _package_version() -> str:
    pkg = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return "v" + str(pkg["version"])


def collect_hidden_imports() -> list[str]:
    """Collect all pure-source modules under `src/backend_patches` and `src/project_manager`."""
    imports: list[str] = ["src.project_manager.standalone_app", "src.project_manager.desktop_runtime", "webview", "pystray", "PIL.Image"]
    patches_dir = ROOT / "src" / "backend_patches"
    if patches_dir.is_dir():
        for py_file in sorted(patches_dir.glob("*.py")):
            if py_file.name.startswith("__"):
                continue
            imports.append("src.backend_patches." + py_file.stem)
    return imports


def render_pyinstaller_spec(
    *,
    app_name: str = DEFAULT_APP_NAME,
    edition: str = "public",
    output_dir: Path | None = None,
) -> str:
    """Render a deterministic PyInstaller `.spec` script for pure-source builds."""
    hidden = collect_hidden_imports()
    datas: list[tuple[str, str]] = []
    if TEMPLATES_DIR.exists():
        datas.append((str(TEMPLATES_DIR), "templates"))
    if STATIC_DIR.exists():
        for asset in sorted(STATIC_DIR.iterdir()):
            if asset.name != "app":  # obsolete React output is not used by the Flask UI
                datas.append((str(asset), "static/" + asset.name if asset.is_dir() else "static"))
    datas.append((str(ROOT / "package.json"), "."))
    icon_expr = repr(str(ICON_PATH)) if ICON_PATH.exists() else "None"
    spec_lines = [
        "# -*- mode: python ; coding: utf-8 -*-",
        f"# Pure-source PyInstaller spec ({edition}, {_package_version()})",
        "from PyInstaller.building.build_main import Analysis, PYZ, EXE",
        "",
        "block_cipher = None",
        "",
        "a = Analysis(",
        f"    [{repr(str((output_dir or ROOT / '_build' / 'open_source') / 'source_launcher.py'))}],",
        f"    pathex=[{repr(str(ROOT))}],",
        "    binaries=[],",
        f"    datas={datas!r},",
        f"    hiddenimports={hidden!r},",
        "    hookspath=[],",
        "    hooksconfig={},",
        "    runtime_hooks=[],",
        "    excludes=[],",
        "    win_no_prefer_redirects=False,",
        "    win_private_assemblies=False,",
        "    cipher=block_cipher,",
        "    noarchive=False,",
        ")",
        "pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)",
        "exe = EXE(",
        "    pyz,",
        "    a.scripts,",
        "    a.binaries,",
        "    a.zipfiles,",
        "    a.datas,",
        "    [],",
        f"    name={app_name!r},",
        "    debug=False,",
        "    bootloader_ignore_signals=False,",
        "    strip=False,",
        "    upx=False,",
        "    console=False,",
        f"    icon={icon_expr},",
        ")",
    ]
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        (output_dir / "source_launcher.py").write_text("from src.project_manager.standalone_app import run_desktop\nraise SystemExit(run_desktop())\n", encoding="utf-8")
        (output_dir / "pure_source.spec").write_text("\n".join(spec_lines) + "\n", encoding="utf-8")
    return "\n".join(spec_lines) + "\n"


def build_open_source(
    *,
    edition: str = "public",
    output_dir: Path,
    dry_run: bool = False,
) -> dict[str, Any]:
    """Generate pure-source spec & manifest and optionally invoke PyInstaller."""
    if edition not in {"public", "compatible-bridge"}:
        raise ValueError(f"Unsupported edition: {edition!r}")
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError(f"Pure-source build requires Python 3.12, got {sys.version_info[:2]}")
    output_dir = Path(output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    spec_path = output_dir / "pure_source.spec"
    render_pyinstaller_spec(app_name=DEFAULT_APP_NAME + "-" + _package_version(), edition=edition, output_dir=output_dir)

    manifest: dict[str, Any] = {
        "edition": edition,
        "version": _package_version(),
        "entry": str(STANDALONE_ENTRY),
        "templates_dir": str(TEMPLATES_DIR),
        "static_dir": str(STATIC_DIR),
        "lockfile": str(LOCKFILE_PATH),
        "lockfile_sha256": hashlib.sha256(LOCKFILE_PATH.read_bytes()).hexdigest()
        if LOCKFILE_PATH.is_file()
        else None,
        "spec_path": str(spec_path),
        "requires_legacy_source_exe": False,
        "hidden_imports_count": len(collect_hidden_imports()),
        "dry_run": dry_run,
    }

    if not dry_run:
        dist_dir = output_dir / "dist"
        work_dir = output_dir / "build"
        subprocess.run(
            [
                sys.executable,
                "-m",
                "PyInstaller",
                "--noconfirm",
                "--clean",
                "--distpath",
                str(dist_dir),
                "--workpath",
                str(work_dir),
                str(spec_path),
            ],
            cwd=str(ROOT),
            check=True,
        )
        exe_path = dist_dir / f"{DEFAULT_APP_NAME}-{_package_version()}.exe"
        manifest["exe_path"] = str(exe_path)
        if not exe_path.is_file():
            raise RuntimeError("PyInstaller did not produce the expected executable")
        if exe_path.is_file():
            manifest["exe_sha256"] = hashlib.sha256(exe_path.read_bytes()).hexdigest()

    manifest_path = output_dir / "open_source_build_manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return manifest


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--edition", choices=("public", "compatible-bridge"), default="public")
    parser.add_argument("--output-dir", type=Path, default=ROOT / "_build" / "open_source")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    result = build_open_source(edition=args.edition, output_dir=args.output_dir, dry_run=args.dry_run)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
