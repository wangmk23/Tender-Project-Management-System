"""Package public binaries and tracked source with an accessible root guide."""
from pathlib import Path
import argparse
import hashlib
import io
import json
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ('procurement-project-manager.exe', 'license-issuer.exe', 'license-bound.exe')
# Local collaboration context belongs in the private source snapshot only.
LOCAL_CONTEXT_PREFIXES = ('docs/模块协作/', 'docs/plans/', 'docs/superpowers/')


def media_source_entries(path, expected_sha256):
    blob = path if isinstance(path, bytes) else Path(path).read_bytes() if path is not None else b''
    if not blob or hashlib.sha256(blob).hexdigest() != expected_sha256:
        raise ValueError('Exact corresponding media source archive is required')
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)) or any(name.startswith(('/', '\\')) or '\\' in name
                or '..' in name.split('/') for name in names):
            raise ValueError('Unsafe media source archive entries')
        manifests = [name for name in names if name == 'engine-manifest.json' or name.endswith('/engine-manifest.json')]
        if len(manifests) != 1:
            raise ValueError('Exactly one media engine manifest is required')
        prefix = manifests[0][:-len('engine-manifest.json')]
        selected = {name[len(prefix):]: name for name in names if name.startswith(prefix) and not name.endswith('/')}
        manifest = json.loads(archive.read(manifests[0]))
        if manifest.get('license') != 'LGPL-2.1-or-later':
            raise ValueError('Unexpected media engine license')
        for prefix in ('sources/', 'recipe/', 'licenses/'):
            if not any(name.startswith(prefix) for name in selected):
                raise ValueError('Incomplete corresponding media source: ' + prefix)
        for source in manifest['sources'].values():
            if hashlib.sha256(archive.read(selected['sources/' + source['filename']])).hexdigest() != source['sha256']:
                raise ValueError('Corresponding media source checksum mismatch')
        return {name: archive.read(original) for name, original in selected.items()
                if name not in ('ffmpeg.exe', 'ffprobe.exe')}


def package(directory, tag, description, *, source_ref='HEAD', media_engine_source=None):
    if not re.fullmatch(r'v\d+\.\d+\.\d+-public(?:-[a-z0-9-]+)?', tag):
        raise ValueError('Invalid public release tag')
    if not description.strip() or re.search(r'[\\/:*?"<>|\x00-\x1f]', description):
        raise ValueError('Description must be a filename component')
    directory = Path(directory).resolve()
    destination = directory/f'procurement-project-manager-{tag}-windows.zip'
    if destination.exists():
        raise FileExistsError('Choose a new release directory; preserve earlier packages')
    manifest = json.loads((ROOT/'docs/releases'/f'{tag}.json').read_text('utf-8'))
    media_sources = {}
    media_archive = None
    if manifest.get('media_engine'):
        if media_engine_source is None:
            raise ValueError('Exact corresponding media source archive is required')
        media_archive = Path(media_engine_source).read_bytes()
        media_sources = media_source_entries(media_archive, manifest['media_engine']['source_archive_sha256'])
    for name in ASSETS:
        if hashlib.sha256((directory/name).read_bytes()).hexdigest() != manifest['assets'][name]:
            raise ValueError(f'Public asset checksum mismatch: {name}')
    archive = subprocess.check_output(['git', 'archive', '--format=zip', source_ref], cwd=ROOT)
    version = tag.split('-public', 1)[0]
    suffix = f'公开版-{description}-{version}.exe'
    names = dict(zip(ASSETS, ('项目管理系统-V5-'+suffix,
        '项目管理系统授权工具-自由运用版-'+suffix,
        '项目管理系统授权工具-绑定磁盘版-'+suffix)))
    with zipfile.ZipFile(io.BytesIO(archive)) as source:
        if '使用说明.txt' not in source.namelist():
            raise ValueError('Tracked source must include 使用说明.txt at ZIP root')
        guide = source.read('使用说明.txt').decode('utf-8-sig')
        if not all(term in guide for term in ('初始化密钥', '至少 10 位', 'admin', '123456', 'license.dat')):
            raise ValueError('Root guide is missing first-use authorization steps')
        with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
            for name in source.namelist():
                if name == 'AGENTS.md' or name.startswith(LOCAL_CONTEXT_PREFIXES):
                    continue
                output.writestr(name, source.read(name))
            for original, local_name in names.items():
                output.write(directory/original, local_name)
            for name, data in media_sources.items():
                output.writestr('第三方组件/媒体引擎源码与构建/' + name, data)
            if media_archive is not None:
                output.writestr('第三方组件/媒体引擎完整源码与构建.zip', media_archive)
    with zipfile.ZipFile(destination) as output:
        if output.testzip() is not None:
            raise RuntimeError('Package integrity verification failed')
    return destination


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--description', required=True)
    parser.add_argument('--source-ref', default='HEAD')
    parser.add_argument('--media-engine-source')
    args = parser.parse_args()
    print(package(args.directory, args.tag, args.description, source_ref=args.source_ref,
                  media_engine_source=args.media_engine_source))
