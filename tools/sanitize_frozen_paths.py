"""Remove local build paths from Python code filenames in a frozen EXE."""
import argparse
import io
import marshal
from pathlib import Path
import sys
import tempfile
import zipfile

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from PyInstaller.archive.readers import CArchiveReader
from tools.build_public import sanitize_code
from tools.compile_module_patches import _read_pyz, _pyz_entry, _rebuild_pyz_upsert
from tools.patch_carchive import patch_executable


def sanitize(source, destination):
    source, destination = Path(source).resolve(), Path(destination).resolve()
    archive = CArchiveReader(source)
    replacements = {}
    with tempfile.TemporaryDirectory() as directory:
        temp = Path(directory)
        raw = archive.extract('PYZ.pyz')
        toc, _ = _read_pyz(raw)
        modules = {name: marshal.dumps(sanitize_code(marshal.loads(_pyz_entry(raw, toc, name)), first_party=False))
                   for name, (kind, _, _) in toc if kind != 3}
        pyz = temp / 'PYZ.pyz'
        pyz.write_bytes(_rebuild_pyz_upsert(raw, modules))
        replacements['PYZ.pyz'] = pyz
        for name, entry in archive.toc.items():
            if entry[-1] == 's':
                file = temp / (name + '.marshal')
                file.write_bytes(marshal.dumps(sanitize_code(marshal.loads(archive.extract(name)), first_party=False)))
                replacements[name] = file
        file = temp / 'base_library.zip'
        with zipfile.ZipFile(io.BytesIO(archive.extract('base_library.zip'))) as source_zip, zipfile.ZipFile(file, 'w', zipfile.ZIP_DEFLATED) as destination_zip:
            for info in source_zip.infolist():
                payload = source_zip.read(info.filename)
                if info.filename.endswith('.pyc'):
                    payload = payload[:16] + marshal.dumps(sanitize_code(marshal.loads(payload[16:]), first_party=False))
                destination_zip.writestr(info, payload)
        replacements['base_library.zip'] = file
        patch_executable(source, destination, replacements)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--destination', required=True)
    args = parser.parse_args()
    sanitize(args.source, args.destination)
