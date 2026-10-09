"""Prepare or apply release titles, author notes and Chinese asset labels."""
import argparse
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
REPOSITORY = 'wangmk23/Tender-Project-Management-System'


def version_title(tag):
    match = re.fullmatch(r'(v\d+\.\d+\.\d+)-public(?:-[a-z0-9-]+)?', tag)
    if not match:
        raise ValueError(f'Unsupported release tag: {tag}')
    return match[1]


def asset_label(name, tag):
    version = version_title(tag)
    known = {
        'procurement-project-manager.exe': f'项目管理系统-{version}.exe',
        'license-issuer.exe': f'授权工具-自由运用版-{version}.exe',
        'license-bound.exe': f'授权工具-绑定磁盘版-{version}.exe',
        'SHA256SUMS': f'SHA256校验-{version}.txt',
    }
    if name in known:
        return known[name]
    if name == f'procurement-project-manager-{tag}-windows.zip':
        return f'项目管理系统-{version}-完整包.zip'
    raise ValueError(f'No Chinese label configured for asset: {name}')


def prepare(releases, notes_dir):
    plan = []
    for release in releases:
        if release['draft']:
            continue
        tag = release['tag_name']
        notes = (Path(notes_dir) / f'{tag}.md').read_text('utf-8').strip() + '\n'
        if not notes.strip():
            raise ValueError(f'Empty release notes: {tag}')
        plan.append({
            'id': release['id'], 'tag': tag, 'url': release['html_url'],
            'before_name': release['name'], 'before_body': release['body'],
            'name': version_title(tag), 'body': notes,
            'assets': [{
                'id': asset['id'], 'name': asset['name'],
                'before_label': asset.get('label'), 'label': asset_label(asset['name'], tag),
                'digest': asset.get('digest'), 'size': asset['size'],
                'download_url': asset['browser_download_url'],
            } for asset in release['assets']],
        })
    return plan


def api(path, body=None):
    command = ['gh', 'api', f'repos/{REPOSITORY}/{path}']
    if body is not None:
        command += ['--method', 'PATCH', '--input', '-']
    result = subprocess.check_output(command, input=None if body is None else json.dumps(body).encode('utf-8'))
    return json.loads(result)


def verify(plan, releases):
    actual = {release['id']: release for release in releases}
    for item in plan:
        release = actual[item['id']]
        assert release['tag_name'] == item['tag']
        assert release['name'] == item['name'] and release['body'].strip() == item['body'].strip()
        assets = {asset['id']: asset for asset in release['assets']}
        assert set(assets) == {asset['id'] for asset in item['assets']}
        for expected in item['assets']:
            asset = assets[expected['id']]
            assert asset['label'] == expected['label']
            assert asset['name'] == expected['name'] and asset['digest'] == expected['digest']
            assert asset['size'] == expected['size']
            assert asset['browser_download_url'] == expected['download_url']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--tag', help='Limit to one published tag')
    parser.add_argument('--notes-directory', default=str(ROOT / 'docs/releases/notes'))
    parser.add_argument('--report', required=True)
    parser.add_argument('--apply', action='store_true', help='Apply a locally prepared plan')
    args = parser.parse_args()
    report = Path(args.report)
    if args.apply:
        plan = json.loads(report.read_text('utf-8'))['plan']
        # Check all targets first. Refuse to overwrite changes made since preparation.
        for item in plan:
            current = api(f"releases/{item['id']}")
            if current['draft'] or current['tag_name'] != item['tag']:
                raise ValueError('Release identity changed since preparation')
            if current['name'] != item['before_name'] or current['body'] != item['before_body']:
                raise ValueError('Release notes changed since preparation; prepare again')
            actual = {asset['id']: asset for asset in current['assets']}
            if set(actual) != {asset['id'] for asset in item['assets']}:
                raise ValueError('Release asset set changed since preparation')
            for expected in item['assets']:
                asset = actual[expected['id']]
                if (asset['name'], asset['label'], asset['digest'], asset['size']) != (
                        expected['name'], expected['before_label'], expected['digest'], expected['size']):
                    raise ValueError('Release asset changed since preparation')
        for item in plan:
            api(f"releases/{item['id']}", {'name':item['name'], 'body':item['body']})
            for asset in item['assets']:
                api(f"releases/assets/{asset['id']}", {'label':asset['label']})
        after = [api(f"releases/{item['id']}") for item in plan]
        verify(plan, after)
        report.with_name(report.stem + '-verified.json').write_text(
            json.dumps({'releases':len(plan),'assets':sum(len(item['assets']) for item in plan),
                        'titles_notes_and_labels_verified':True,'binaries_and_download_urls_unchanged':True,
                        'after':after}, ensure_ascii=False, indent=2), 'utf-8')
    else:
        releases = api('releases?per_page=100')
        if args.tag:
            releases = [release for release in releases if release['tag_name'] == args.tag]
            if not releases:
                raise ValueError('Requested release not found')
        plan = prepare(releases, args.notes_directory)
        report.parent.mkdir(parents=True, exist_ok=True)
        report.write_text(json.dumps({'plan':plan}, ensure_ascii=False, indent=2), 'utf-8')
    print(json.dumps({'releases':len(plan),'assets':sum(len(item['assets']) for item in plan),'applied':args.apply}))


if __name__ == '__main__':
    main()
