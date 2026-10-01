"""Create the public runtime from the editable source and a V5 runtime baseline.

No production database, settings, key or Git history is read by this builder.
The input EXE may contain a legacy bundled database; it is explicitly removed.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import io
import marshal
import os
from pathlib import Path
import re
import sys
import tempfile
import types
import zipfile

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PyInstaller.archive.readers import CArchiveReader
from tools import build_candidate
from tools.compile_module_patches import _read_pyz, _pyz_entry, _rebuild_pyz_upsert
from tools.patch_carchive import patch_executable

ROOT = Path(__file__).resolve().parents[1]
VERSION = 'v5.8.13'
FIRST_PARTY = {'app', 'licensing', 'data_security'} | {p.stem for p in (ROOT / 'src/backend_patches').glob('*.py')}
REPLACEMENTS = {
    'hd-project-manager': 'procurement-project-manager',
    'hd123456': '123456',
    'HD-': 'PM-',
    'v5.8.12': VERSION,
}


def public_license_code():
    source = '''def current_license_status(update_state=True):
    if not LICENSE_REQUIRED:
        return {"status": "valid", "mode": "full", "message": "开发模式", "device_code": "DEV", "organization": "", "expires_at": None, "license_id": ""}
    return verify_license(DATA_DIR, DATA_DIR, update_state=update_state)
'''
    root = compile(source, 'public_license_status.py', 'exec')
    return next(c for c in root.co_consts if isinstance(c, types.CodeType))


def sanitize_code(code, *, first_party, module=''):
    def value(item):
        if isinstance(item, types.CodeType):
            if module == 'app' and item.co_name == 'current_license_status':
                return public_license_code()
            return sanitize_code(item, first_party=first_party, module=module)
        if isinstance(item, tuple):
            return tuple(value(v) for v in item)
        if isinstance(item, frozenset):
            return frozenset(value(v) for v in item)
        if isinstance(item, str) and first_party:
            if code.co_name in {'load_app_settings', 'inject_brand_settings', 'api_get_settings'} and item.endswith('有限公司') and not item.startswith(('示例', '测试', '虚构')):
                item = '采购项目管理系统'
            if module == 'licensing' and code.co_name == 'verify_license' and item == 'static':
                return ''
            for old, new in REPLACEMENTS.items():
                item = item.replace(old, new)
        return item
    filename = code.co_filename.replace('\\', '/').rsplit('/', 1)[-1]
    return code.replace(co_consts=tuple(value(v) for v in code.co_consts), co_filename=filename)


def build(source, expected_sha, destination, report):
    if sys.version_info[:2] == (3, 12):
        os.environ.setdefault('PYTHON312', sys.executable)
    source, destination, report = map(lambda p: Path(p).resolve(), (source, destination, report))
    if len({source, destination, report}) != 3:
        raise ValueError('source, destination and report must be distinct files')
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_sha.lower():
        raise ValueError('runtime baseline SHA256 mismatch')
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        staged = temp / 'staged.exe'
        stage_report = temp / 'staged.json'
        build_candidate.build_candidate(destination=staged, report_path=stage_report, source=source, expected_source_sha256=expected_sha)
        archive = CArchiveReader(staged)
        raw = archive.extract('PYZ.pyz')
        toc, _ = _read_pyz(raw)
        modules = {}
        for name, (typecode, _, _) in toc:
            if typecode == 3:
                continue
            code = marshal.loads(_pyz_entry(raw, toc, name))
            if isinstance(code, types.CodeType):
                modules[name] = marshal.dumps(sanitize_code(code, first_party=name in FIRST_PARTY, module=name))
        pyz = temp / 'PYZ.pyz'
        pyz.write_bytes(_rebuild_pyz_upsert(raw, modules))
        desktop = temp / 'desktop.marshal'
        desktop.write_bytes(marshal.dumps(sanitize_code(marshal.loads(archive.extract('desktop_app')), first_party=True, module='desktop_app')))
        replacements = {'PYZ.pyz': pyz, 'desktop_app': desktop}
        for name, entry in archive.toc.items():
            if entry[-1] == 's' and name != 'desktop_app':
                path = temp / (name + '.marshal')
                path.write_bytes(marshal.dumps(sanitize_code(marshal.loads(archive.extract(name)), first_party=False)))
                replacements[name] = path
        if 'base_library.zip' in archive.toc:
            zip_path = temp / 'base_library.zip'
            with zipfile.ZipFile(io.BytesIO(archive.extract('base_library.zip'))) as original_zip, zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as cleaned_zip:
                for info in original_zip.infolist():
                    payload = original_zip.read(info.filename)
                    if info.filename.endswith('.pyc'):
                        code = marshal.loads(payload[16:])
                        payload = payload[:16] + marshal.dumps(sanitize_code(code, first_party=False))
                    cleaned_zip.writestr(info, payload)
            replacements['base_library.zip'] = zip_path
        for path in (ROOT / 'src/templates').glob('*.html'):
            name = 'templates\\' + path.name
            if name in archive.toc:
                replacements[name] = path
        for name in archive.toc:
            if name.replace('\\', '/') == 'static/app/app.js':
                replacements[name] = ROOT / 'src/project_manager/static/app/app.js'
        excluded = frozenset(name for name in archive.toc if name == 'bidding.db' or name.endswith('license_public_key.pem') or name in {'app_settings.json', 'license.dat', '.license_state.bin'} or 'private_key' in name.lower() or name.endswith(('chartmix.umd.min.js', 'chartmix.css')))
        patch_executable(staged, destination, replacements, exclude=excluded)
        candidate = CArchiveReader(destination)
        assert not (set(candidate.toc) & set(excluded))
        result = {'version': VERSION, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
                  'runtime_modules': len(modules), 'excluded_assets': sorted(excluded),
                  'initial_username': 'admin', 'initial_password': '123456',
                  'public_key_path': 'DATA_DIR/license_public_key.pem',
                  'source_build': 'editable extensions over compiled V5 runtime'}
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2), 'utf-8')
        return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-exe', required=True)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--report', required=True)
    args = parser.parse_args()
    print(json.dumps(build(args.source_exe, args.source_sha256, args.destination, args.report), ensure_ascii=False, indent=2))
