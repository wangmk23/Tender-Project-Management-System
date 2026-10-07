"""Build both public authorization tools with the shared application icon."""
from pathlib import Path
import argparse
import subprocess
import sys
import tempfile
import time
from contextlib import contextmanager

if __package__ in {None, ''}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from tools.sanitize_frozen_paths import sanitize

ROOT = Path(__file__).resolve().parents[1]


@contextmanager
def build_workspace():
    """Allow temporary Windows executable readers to release their handles."""
    workspace = tempfile.TemporaryDirectory()
    try:
        yield workspace.name
    finally:
        for attempt in range(6):
            try:
                workspace.cleanup()
                break
            except PermissionError as error:
                if getattr(error, 'winerror', None) != 32 or attempt == 5:
                    raise
                time.sleep(.25 * (attempt + 1))


def build(output):
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with build_workspace() as directory:
        temp = Path(directory)
        for entry, name in [('license_issuer.py', 'license-issuer'), ('license_bound.py', 'license-bound')]:
            subprocess.run([sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--windowed',
                '--name', name, '--paths', str(ROOT / 'authorization'), '--hidden-import', 'license_theme',
                '--icon', str(ROOT / 'src/assets/app-icon-transparent.ico'),
                '--add-data', str(ROOT / 'src/assets/app-icon-transparent.ico') + ';.',
                '--distpath', str(temp / 'dist'), '--workpath', str(temp / name), '--specpath', str(temp),
                str(ROOT / 'authorization' / entry)], cwd=ROOT, check=True)
            sanitize(temp / 'dist' / (name + '.exe'), output / (name + '.exe'))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', default='dist')
    build(parser.parse_args().output)
