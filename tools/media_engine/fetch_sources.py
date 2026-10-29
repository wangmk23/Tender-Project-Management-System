"""Download only content-hash-pinned official source materials; never a binary build."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tarfile
import time
import urllib.request


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def download(url, destination, expected=None):
    if destination.is_file() and expected and sha(destination) == expected:
        return
    for attempt in range(3):
        temporary = destination.with_suffix(destination.suffix + '.part')
        try:
            with urllib.request.urlopen(url, timeout=120) as response, temporary.open('wb') as output:
                while chunk := response.read(1024 * 1024):
                    output.write(chunk)
            if expected and sha(temporary) != expected:
                raise ValueError('source SHA-256 mismatch: ' + destination.name)
            os.replace(temporary, destination)
            return
        except Exception:
            if attempt == 2:
                raise
            time.sleep(2)


def extract(path, directory):
    with tarfile.open(path, 'r:*') as source:
        for member in source.getmembers():
            if member.issym() or member.islnk() or not (directory / member.name).resolve().is_relative_to(directory.resolve()):
                raise ValueError('source archive contains unsafe link/path: ' + member.name)
        source.extractall(directory, filter='data')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--downloads', type=Path, required=True)
    parser.add_argument('--extract', type=Path, required=True)
    args = parser.parse_args()
    pins = json.loads(Path(__file__).with_name('sources.json').read_text('utf-8'))
    args.downloads.mkdir(parents=True, exist_ok=True)
    args.extract.mkdir(parents=True, exist_ok=True)
    for name in ('ffmpeg', 'dav1d', 'zlib'):
        item = pins[name]
        path = args.downloads / item['filename']
        download(item['url'], path, item['sha256'])
        extract(path, args.extract)
        print(name + ' source SHA256 ' + item['sha256'], flush=True)
    item = pins['ffmpeg']
    download(item['signature_url'], args.downloads / (item['filename'] + '.asc'))
    download(item['signing_key_url'], args.downloads / 'ffmpeg-devel.asc', item['signing_key_sha256'])


if __name__ == '__main__':
    main()
