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


def package(directory, tag, description, *, source_ref='HEAD'):
    if not re.fullmatch(r'v\d+\.\d+\.\d+-public(?:-[a-z0-9-]+)?', tag):
        raise ValueError('Invalid public release tag')
    if not description.strip() or re.search(r'[\\/:*?"<>|\x00-\x1f]', description):
        raise ValueError('Description must be a filename component')
    directory = Path(directory).resolve()
    destination = directory/f'procurement-project-manager-{tag}-windows.zip'
    if destination.exists():
        raise FileExistsError('Choose a new release directory; preserve earlier packages')
    manifest = json.loads((ROOT/'docs/releases'/f'{tag}.json').read_text('utf-8'))
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
                output.writestr(name, source.read(name))
            for original, local_name in names.items():
                output.write(directory/original, local_name)
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
    args = parser.parse_args()
    print(package(args.directory, args.tag, args.description, source_ref=args.source_ref))
