"""Inventory and short native Windows smoke checks; not the product format matrix."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys


def run(engine):
    manifest_path = engine / 'engine-manifest.json'
    manifest = json.loads(manifest_path.read_text('utf-8'))
    for name, expected in manifest['files'].items():
        if hashlib.sha256((engine / name).read_bytes()).hexdigest() != expected:
            raise ValueError('engine hash mismatch: ' + name)
    reports = engine / 'runtime-info'
    reports.mkdir(exist_ok=True)
    checks = []
    def command(label, binary, arguments, timeout=60):
        completed = subprocess.run([str(engine / binary), *arguments], capture_output=True,
            text=True, encoding='utf-8', errors='replace', timeout=timeout,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        output = completed.stdout + completed.stderr
        (reports / (label + '.txt')).write_text(output, 'utf-8')
        checks.append({'name': label, 'exit_code': completed.returncode, 'passed': completed.returncode == 0})
        return output
    try:
        for binary in ('ffmpeg.exe', 'ffprobe.exe'):
            command(binary + '-version', binary, ['-version'])
        license_text = command('license', 'ffmpeg.exe', ['-L'])
        if 'GNU Lesser General Public License' not in license_text or 'version 2.1' not in license_text:
            raise ValueError('runtime license is not LGPL version 2.1 or later')
        for flag in ('-buildconf', '-decoders', '-encoders', '-formats', '-protocols', '-filters', '-pix_fmts'):
            command(flag[1:], 'ffmpeg.exe', ['-hide_banner', flag])
        command('png-smoke', 'ffmpeg.exe', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi',
            '-i', 'color=c=black:s=64x64', '-frames:v', '1', '-c:v', 'png', '-y', str(reports / 'smoke.png')])
        command('aac-smoke', 'ffmpeg.exe', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi',
            '-i', 'sine=frequency=440:duration=1', '-c:a', 'aac', '-y', str(reports / 'smoke.m4a')])
        command('h264-mf-smoke', 'ffmpeg.exe', ['-hide_banner', '-nostdin', '-v', 'error', '-f', 'lavfi',
            '-i', 'color=c=black:s=64x64:r=10:d=1', '-c:v', 'h264_mf', '-pix_fmt', 'nv12',
            '-b:v', '200k', '-an', '-y', str(reports / 'smoke.mp4')])
        manifest['native_execution_verified'] = True
    except Exception as error:
        checks.append({'name': 'native inventory completed', 'passed': False, 'error': str(error)})
    finally:
        passed = bool(checks) and all(row['passed'] for row in checks)
        manifest['basic_smoke_passed'] = passed
        manifest['runtime_checks'] = checks
        manifest['full_format_matrix_verified'] = False
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', 'utf-8')
        (reports / 'smoke-result.json').write_text(json.dumps({'passed': passed, 'checks': checks,
            'scope': 'native executable inventories plus PNG/AAC/h264_mf synthetic smoke; full real-file matrix remains pending'}, indent=2) + '\n', 'utf-8')
    return passed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if run(args.engine.resolve()) else 1)
