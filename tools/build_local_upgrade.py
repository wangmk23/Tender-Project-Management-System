"""Update an existing deployment while preserving its original license verifier.

The input is an existing licensed runtime, not the sanitized public runtime.
This tool does not modify license files, signing keys or application data.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import marshal
from pathlib import Path
import shutil
import sys
import tempfile
import types

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PyInstaller.archive.readers import CArchiveReader
from tools.build_candidate import build_candidate
from tools.compile_module_patches import _read_pyz, _pyz_entry, _rebuild_pyz_upsert
from tools.patch_carchive import patch_executable


def _license_status_code(code):
    matches = [value for value in code.co_consts if isinstance(value, types.CodeType)
               and value.co_name == 'current_license_status']
    if len(matches) != 1:
        raise ValueError('Expected exactly one original license status function')
    return matches[0]


def verify_license_compatibility(source, candidate):
    original = CArchiveReader(str(source))
    updated = CArchiveReader(str(candidate))
    first = original.extract('PYZ.pyz')
    second = updated.extract('PYZ.pyz')
    first_toc, _ = _read_pyz(first)
    second_toc, _ = _read_pyz(second)
    for module in ('licensing', 'data_security'):
        if _pyz_entry(first, first_toc, module) != _pyz_entry(second, second_toc, module):
            raise ValueError('Update changed protected module: ' + module)
    before = _license_status_code(marshal.loads(_pyz_entry(first, first_toc, 'app')))
    after = _license_status_code(marshal.loads(_pyz_entry(second, second_toc, 'app')))
    if before != after:
        raise ValueError('Update changed the original license status function')
    public_keys = [name for name in original.toc if name.lower().endswith('license_public_key.pem')]
    for name in public_keys:
        if name not in updated.toc or original.extract(name) != updated.extract(name):
            raise ValueError('Update changed the original public key')
    return {'licensing_module_unchanged': True, 'data_security_module_unchanged': True,
            'license_status_function_unchanged': True, 'embedded_public_keys_preserved': len(public_keys)}


def build(source, source_sha256, destination, report):
    source = Path(source).resolve()
    destination = Path(destination).resolve()
    report = Path(report).resolve()
    if source in (destination, report) or destination == report:
        raise ValueError('Build input, output and report must be distinct')
    if destination.exists() or report.exists():
        raise FileExistsError('Choose new output paths; existing releases are preserved')
    with tempfile.TemporaryDirectory() as directory:
        candidate = Path(directory) / 'candidate.exe'
        integrity = Path(directory) / 'integrity.json'
        result = build_candidate(candidate, integrity, source=source,
                                 expected_source_sha256=source_sha256)
        original_archive = CArchiveReader(str(source))
        candidate_archive = CArchiveReader(str(candidate))
        original_pyz = original_archive.extract('PYZ.pyz')
        original_toc, _ = _read_pyz(original_pyz)
        protected = {name: _pyz_entry(original_pyz, original_toc, name)
                     for name in ('licensing', 'data_security')}
        pyz_path = Path(directory) / 'compatible.pyz'
        pyz_path.write_bytes(_rebuild_pyz_upsert(candidate_archive.extract('PYZ.pyz'), protected))
        compatible = Path(directory) / 'compatible.exe'
        patch_executable(candidate, compatible, {'PYZ.pyz': pyz_path})
        compatibility = verify_license_compatibility(source, compatible)
        candidate = compatible
        result['candidate_sha256'] = hashlib.sha256(candidate.read_bytes()).hexdigest()
        result['edition'] = 'existing-deployment-upgrade'
        result['license_compatibility'] = compatibility
        result['production_license_and_data_modified'] = False
        result['public_distribution'] = False
        destination.parent.mkdir(parents=True, exist_ok=True)
        report.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(candidate, destination)
        if hashlib.sha256(destination.read_bytes()).hexdigest() != result['candidate_sha256']:
            raise RuntimeError('Published output hash differs from verified candidate')
        report.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-exe', required=True)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--report', required=True)
    arguments = parser.parse_args()
    result = build(arguments.source_exe, arguments.source_sha256, arguments.destination, arguments.report)
    print(json.dumps({'sha256': result['candidate_sha256'], 'license_compatibility': result['license_compatibility']}, indent=2))
