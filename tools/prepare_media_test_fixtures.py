"""Prepare the pinned, synthetic HLS input for cross-platform frontend checks."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parents[1]


def prepare():
    source = ROOT / 'tests/fixtures/media-ui'
    manifest = json.loads((source / 'manifest.json').read_text('utf-8'))
    blob = source / 'synthetic-hls.zip'
    if hashlib.sha256(blob.read_bytes()).hexdigest() != manifest['sha256']:
        raise ValueError('Synthetic HLS archive hash mismatch')
    destination = ROOT / '.codex/module-state/media-ui/hls'
    with zipfile.ZipFile(blob) as archive:
        if set(archive.namelist()) != set(manifest['files']):
            raise ValueError('Synthetic HLS member set mismatch')
        payloads = {}
        for name, digest in manifest['files'].items():
            if Path(name).name != name or '/' in name or '\\' in name:
                raise ValueError('Unexpected HLS fixture path')
            payloads[name] = archive.read(name)
            if hashlib.sha256(payloads[name]).hexdigest() != digest:
                raise ValueError('Synthetic HLS member hash mismatch')
        destination.mkdir(parents=True, exist_ok=True)
        for name, data in payloads.items():
            (destination / name).write_bytes(data)
    print(f'Prepared {len(payloads)} pinned synthetic HLS files')


if __name__ == '__main__':
    prepare()
