"""Recombine the distributed unsigned EXE with a modified pystray library.

The complete unmodified upstream source is supplied in vendor-sources.
This tool changes pystray code only and preserves the application objects.
"""
import argparse
import hashlib
import json
import marshal
from pathlib import Path
import sys

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PyInstaller.archive.readers import CArchiveReader
from tools.compile_module_patches import _read_pyz, _rebuild_pyz_upsert
from tools.patch_carchive import patch_executable
import tempfile


def replace_library(source, expected_sha, library_source, destination):
    if sys.version_info[:2] != (3, 12):
        raise RuntimeError('the runtime requires Python 3.12 bytecode')
    source, library_source, destination = map(lambda p: Path(p).resolve(), (source, library_source, destination))
    if source == destination:
        raise ValueError('output must differ from the original EXE')
    if hashlib.sha256(source.read_bytes()).hexdigest() != expected_sha.lower():
        raise ValueError('runtime SHA256 mismatch')
    package = library_source if library_source.name == 'pystray' else library_source / 'pystray'
    if not (package / '__init__.py').is_file():
        raise ValueError('--library-source must contain the pystray package')
    archive = CArchiveReader(source)
    raw = archive.extract('PYZ.pyz')
    toc, _ = _read_pyz(raw)
    names = {name for name, _ in toc}
    compiled = {}
    for path in package.rglob('*.py'):
        relative = path.relative_to(package).with_suffix('')
        parts = list(relative.parts)
        if parts[-1] == '__init__':
            parts.pop()
        name = '.'.join(['pystray', *parts])
        if name not in names:
            raise ValueError(f'new module {name} requires extending the PYZ additions in the build tools')
        compiled[name] = marshal.dumps(compile(path.read_bytes(), relative.as_posix() + '.py', 'exec'))
    expected = {name for name in names if name == 'pystray' or name.startswith('pystray.')}
    if set(compiled) != expected:
        raise ValueError(f'missing distributed modules: {sorted(expected - set(compiled))}')
    with tempfile.TemporaryDirectory() as directory:
        patched = Path(directory) / 'PYZ.pyz'
        patched.write_bytes(_rebuild_pyz_upsert(raw, compiled))
        patch_executable(source, destination, {'PYZ.pyz': patched})
    return {'replaced': sorted(compiled), 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-exe', required=True)
    parser.add_argument('--source-sha256', required=True)
    parser.add_argument('--library-source', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    print(json.dumps(replace_library(args.source_exe, args.source_sha256, args.library_source, args.destination), indent=2))
