"""Inventory and short native Windows smoke checks; not the product format matrix."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys
import wave


def validate_runtime_license(output):
    notice = ' '.join(output.split())
    if ('GNU Lesser General Public License' not in notice or
            'version 2.1 of the License' not in notice):
        raise ValueError('runtime license is not LGPL version 2.1 or later')


def create_smoke_inputs(directory):
    # Standard real files keep the mandatory transcodes independent of avdevice,
    # which the offline CLI deliberately does not build.
    image, audio = directory / 'source.ppm', directory / 'source.wav'
    image.write_bytes(b'P6\n320 240\n255\n' + bytes([25, 70, 130]) * 320 * 240)
    samples = b''.join(struct.pack('<h', int(12000 * math.sin(2 * math.pi * 440 * i / 44100)))
                       for i in range(44100))
    with wave.open(str(audio), 'wb') as stream:
        stream.setparams((1, 2, 44100, 0, 'NONE', 'not compressed'))
        stream.writeframes(samples)
    return image, audio


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
        checks.append({'name': label, 'exit_code': completed.returncode, 'passed': completed.returncode == 0,
                       'arguments': arguments})
        return output
    try:
        for binary in ('ffmpeg.exe', 'ffprobe.exe'):
            command(binary + '-version', binary, ['-version'])
        license_text = command('license', 'ffmpeg.exe', ['-L'])
        validate_runtime_license(license_text)
        for flag in ('-buildconf', '-decoders', '-encoders', '-formats', '-protocols', '-filters', '-pix_fmts'):
            command(flag[1:], 'ffmpeg.exe', ['-hide_banner', flag])
        image, audio = create_smoke_inputs(reports)
        command('png-smoke', 'ffmpeg.exe', ['-hide_banner', '-nostdin', '-v', 'error',
            '-i', str(image), '-frames:v', '1', '-c:v', 'png', '-update', '1', '-y', str(reports / 'smoke.png')])
        command('aac-smoke', 'ffmpeg.exe', ['-hide_banner', '-nostdin', '-v', 'error',
            '-i', str(audio), '-c:a', 'aac', '-y', str(reports / 'smoke.m4a')])
        command('wav-file-smoke', 'ffmpeg.exe', ['-hide_banner', '-nostdin', '-v', 'error',
            '-i', str(audio), '-c:a', 'pcm_s16le', '-y', str(reports / 'smoke.wav')])
        command('h264-mf-smoke', 'ffmpeg.exe', ['-hide_banner', '-nostdin', '-v', 'error',
            '-loop', '1', '-framerate', '10', '-i', str(image), '-i', str(audio),
            '-c:v', 'h264_mf', '-pix_fmt', 'nv12', '-b:v', '400k', '-c:a', 'aac', '-t', '1',
            '-y', str(reports / 'smoke.mp4')])
        for filename, expected in (('smoke.wav', {'pcm_s16le'}), ('smoke.m4a', {'aac'}),
                                    ('smoke.mp4', {'h264', 'aac'}), ('smoke.png', {'png'})):
            path = reports / filename
            if not path.is_file() or not path.stat().st_size:
                raise ValueError('real file output missing/empty: ' + filename)
            payload = command('probe-' + filename, 'ffprobe.exe', ['-v', 'error', '-show_format',
                '-show_streams', '-of', 'json', str(path)])
            actual = {row['codec_name'] for row in json.loads(payload)['streams']}
            if not expected.issubset(actual):
                raise ValueError(f'file read-back codec mismatch: {filename}: {actual}')
            checks.append({'name': 'real file write and probe read-back ' + filename, 'passed': True,
                           'bytes': path.stat().st_size, 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
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
            'scope': 'native executable inventories plus real PPM/WAV inputs transcoded to PNG/WAV/AAC/H264-MF with ffprobe read-back; full format matrix remains pending'}, indent=2) + '\n', 'utf-8')
    return passed


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', type=Path, required=True)
    args = parser.parse_args()
    raise SystemExit(0 if run(args.engine.resolve()) else 1)
