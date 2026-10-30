"""Verify complete, reviewed offline media distributions before frozen packaging."""
from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

ROOT = Path(__file__).resolve().parents[1]
PLAYER_PIN = '37f378ba9fccfb508914ee0d68ec2c21940e07f62425363bb7706ab15274a383'
# Filled only after the pinned LGPL build and real Windows file I/O checks pass.
ENGINE_PIN = '2fd95003f791e929992be8dbe16f55da7f4147e61af8224b697c782fb5093337'


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def pinned_tree(directory, manifest_name, expected_digest):
    directory = Path(directory).resolve(strict=True)
    manifest_path = directory / manifest_name
    blob = manifest_path.read_bytes()
    if not expected_digest or manifest_path.is_symlink() or hashlib.sha256(blob).hexdigest() != expected_digest:
        raise ValueError('Media distribution manifest differs from reviewed input')
    files = json.loads(blob.decode('utf-8-sig'))['files']
    expected_names = set(files) | {manifest_name}
    actual = {p.relative_to(directory).as_posix() for p in directory.rglob('*') if p.is_file()}
    if actual != expected_names or len({name.casefold() for name in expected_names}) != len(expected_names):
        raise ValueError('Media distribution file set differs from reviewed input')
    result = {}
    for name in sorted(expected_names):
        relative = PurePosixPath(name)
        if relative.is_absolute() or '\\' in name or any(p in ('', '.', '..') for p in name.split('/')):
            raise ValueError('Media distribution contains unsafe paths')
        path = directory / name
        if path.is_symlink() or any(p.is_symlink() for p in path.parents if p != directory):
            raise ValueError('Media distribution links are forbidden')
        path.resolve(strict=True).relative_to(directory)
        expected = files.get(name, expected_digest)
        if isinstance(expected, dict): expected = expected['sha256']
        if digest(path) != expected:
            raise ValueError('Media distribution file checksum differs: ' + name)
        result[name] = path
    return result


def player_assets():
    directory = ROOT / 'src/project_manager/static/libs/videojs/10.2.0'
    return {'static\\libs\\videojs\\10.2.0\\' + name.replace('/', '\\'): path
            for name, path in pinned_tree(directory, 'PROVENANCE.json', PLAYER_PIN).items()}


def engine_assets():
    if not ENGINE_PIN:
        raise ValueError('Approved media engine input is missing; full media build cannot pass')
    directory = ROOT / 'src/project_manager/static/libs/media-engine'
    return {'static\\libs\\media-engine\\' + name.replace('/', '\\'): path
            for name, path in pinned_tree(directory, 'PROVENANCE.json', ENGINE_PIN).items()}


def media_assets():
    return {**player_assets(), **engine_assets()}


def media_asset_hashes():
    """Capture approved digests from the same manifest bytes checked by the pins."""
    result = {}
    for relative, filename, pin in (
        ('videojs/10.2.0', 'PROVENANCE.json', PLAYER_PIN),
        ('media-engine', 'PROVENANCE.json', ENGINE_PIN),
    ):
        blob = (ROOT / 'src/project_manager/static/libs' / relative / filename).read_bytes()
        if hashlib.sha256(blob).hexdigest() != pin:
            raise ValueError('Media distribution manifest differs from reviewed input')
        files = json.loads(blob.decode('utf-8-sig'))['files']
        for name, value in {**files, filename: pin}.items():
            result['static\\libs\\' + relative.replace('/', '\\') + '\\' + name.replace('/', '\\')] = (
                value['sha256'] if isinstance(value, dict) else value)
    return result
