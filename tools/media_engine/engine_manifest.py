"""Fail-closed inspection of the cross-compiled, separately distributed engine."""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
SYSTEM_DLLS = {'kernel32.dll', 'msvcrt.dll', 'ucrtbase.dll', 'advapi32.dll', 'bcrypt.dll',
              'ole32.dll', 'oleaut32.dll', 'user32.dll', 'gdi32.dll', 'shell32.dll',
              'shlwapi.dll', 'secur32.dll', 'crypt32.dll', 'ws2_32.dll', 'winmm.dll',
              'version.dll', 'ntdll.dll', 'comdlg32.dll', 'comctl32.dll', 'd3d11.dll', 'dxgi.dll'}


def digest(path):
    result = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def validate_dlls(names):
    for name in names:
        lowered = name.lower()
        if lowered not in SYSTEM_DLLS and not lowered.startswith(('api-ms-win-', 'ext-ms-win-')):
            raise ValueError('non-system DLL dependency: ' + name)


def validate_configuration(configuration):
    required = {'GPL': 0, 'VERSION3': 0, 'NONFREE': 0, 'NETWORK': 0,
                'H264_MF_ENCODER': 1, 'D3D11VA': 1, 'LIBDAV1D_DECODER': 1, 'PNG_DECODER': 1,
                'AAC_ENCODER': 1, 'HLS_MUXER': 1, 'SHARED': 0, 'STATIC': 1}
    for key, expected in required.items():
        if not re.search(r'^#define CONFIG_' + key + r' ' + str(expected) + r'\s*$', configuration, re.M):
            raise ValueError(f'CONFIG_{key} must be {expected}')


def make_manifest(stage, build, recipe_commit):
    configuration = '\n'.join((build / name).read_text('utf-8')
                              for name in ('config.h', 'config_components.h'))
    validate_configuration(configuration)
    pins = json.loads((ROOT / 'tools/media_engine/sources.json').read_text('utf-8'))
    sources = {}
    for name in ('ffmpeg', 'dav1d', 'zlib'):
        item = pins[name]
        path = stage / 'sources' / item['filename']
        if digest(path) != item['sha256']:
            raise ValueError('source hash changed: ' + name)
        sources[name] = item
    dependencies, files = {}, {}
    for name in ('ffmpeg.exe', 'ffprobe.exe'):
        path = stage / name
        if not path.is_file() or path.read_bytes()[:2] != b'MZ':
            raise ValueError('Windows executable missing: ' + name)
        imports = subprocess.check_output(['x86_64-w64-mingw32-objdump', '-p', str(path)], text=True)
        (stage / 'build-info' / (name + '.pe-imports.txt')).write_text(imports, 'utf-8')
        names = sorted(set(re.findall(r'DLL Name:\s+(\S+)', imports)))
        if not names:
            raise ValueError('empty PE import inspection: ' + name)
        validate_dlls(names)
        dependencies[name] = names
        files[name] = digest(path)
    inventory = {}
    for singular in ('DECODER', 'ENCODER', 'DEMUXER', 'MUXER', 'FILTER', 'PROTOCOL'):
        inventory[singular.lower() + 's'] = sorted(name.lower() for name in re.findall(
            r'^#define CONFIG_(\w+)_' + singular + r' 1$', configuration, re.M))
    if set(inventory['protocols']) != {'file', 'pipe'}:
        raise ValueError('local file/pipe must be the only enabled protocols')
    arguments = json.loads((stage / 'build-info/configure.json').read_text('utf-8'))
    manifest = {'schema_version': 1, 'version': pins['ffmpeg']['version'],
                'license': 'LGPL-2.1-or-later', 'files': files, 'configure': arguments,
                'source_commit': pins['ffmpeg']['commit'], 'sources': sources,
                'recipe_commit': recipe_commit, 'target': 'windows-x86_64',
                'linkage': 'static FFmpeg/dav1d/zlib; Windows system DLLs only',
                'system_dll_dependencies': dependencies, 'codec_inventory': inventory,
                'created_at': datetime.now(timezone.utc).isoformat(),
                'sources_modified': False, 'cross_build_verified': True,
                'native_execution_verified': False, 'full_format_matrix_verified': False,
                'media_foundation_requirement': 'Windows Media Foundation OS feature and an available encoder MFT; Windows N/Server availability must be tested.'}
    (stage / 'engine-manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', type=Path, required=True)
    parser.add_argument('--build', type=Path, required=True)
    parser.add_argument('--recipe-commit', required=True)
    args = parser.parse_args()
    make_manifest(args.stage, args.build, args.recipe_commit)
