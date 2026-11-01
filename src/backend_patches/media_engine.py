"""media-engine-v1: local, hash-checked and bounded media subprocesses."""
from __future__ import annotations

from collections import deque
import hashlib
import json
import math
import os
from pathlib import Path
import subprocess
import threading
import time

VIDEO_EXTENSIONS = frozenset('mp4 m4v mov mkv webm avi wmv mpg mpeg ts mts m2ts 3gp flv vob ogv'.split())
AUDIO_EXTENSIONS = frozenset('mp3 wav m4a aac flac ogg oga opus wma amr aiff aif au mka ac3 dts'.split())
MEDIA_EXTENSIONS = VIDEO_EXTENSIONS | AUDIO_EXTENSIONS
FORMATS = 'mov,matroska,webm,avi,asf,flv,mpeg,mpegts,mp3,wav,flac,aac,ogg,amr,aiff,au,ac3,eac3,dts'
MAX_OUTPUT_BYTES = 4 * 1024**3


def describe_media(raw, extension):
    extension = str(extension).lower().lstrip('.')
    if extension not in MEDIA_EXTENSIONS:
        raise ValueError('不支持此媒体格式')
    streams = raw.get('streams', [])
    video = next((s for s in streams if s.get('codec_type') == 'video'
                  and not s.get('disposition', {}).get('attached_pic')), None)
    audio = next((s for s in streams if s.get('codec_type') == 'audio'), None)
    if not video and not audio:
        raise ValueError('文件中没有可播放的音频或视频')
    duration_value = raw.get('format', {}).get('duration')
    if duration_value in (None, '', 'N/A'):
        duration_value = next((s.get('duration') for s in streams
                               if s.get('duration') not in (None, '', 'N/A')), 0)
    duration = float(duration_value)
    if not math.isfinite(duration) or duration < 0:
        raise ValueError('媒体时长无效')
    kind = 'audio' if extension in AUDIO_EXTENSIONS and audio else 'video' if video else 'audio'
    codecs = [s.get('codec_name', '') for s in streams if s.get('codec_type') in ('audio', 'video')
              and not s.get('disposition', {}).get('attached_pic')]
    format_name = str(raw.get('format', {}).get('format_name', ''))
    native = False
    if kind == 'audio':
        codec = audio.get('codec_name', '') if audio else ''
        native = ((extension == 'mp3' and codec == 'mp3')
                  or (extension == 'wav' and codec.startswith('pcm_'))
                  or (extension in ('m4a', 'aac') and codec == 'aac')
                  or (extension in ('ogg', 'oga', 'opus', 'flac') and codec in ('vorbis', 'opus', 'flac')))
        mime = {'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'flac': 'audio/flac',
                'aac': 'audio/aac', 'm4a': 'audio/mp4', 'ogg': 'audio/ogg',
                'oga': 'audio/ogg', 'opus': 'audio/ogg'}.get(extension, 'application/octet-stream')
    else:
        codec = video.get('codec_name', '')
        native = ((extension in ('mp4', 'm4v', 'mov') and codec == 'h264'
                   and (not audio or audio.get('codec_name') in ('aac', 'mp3')))
                  or (extension == 'webm' and codec in ('vp8', 'vp9', 'av1')
                      and (not audio or audio.get('codec_name') in ('opus', 'vorbis'))))
        mime = 'video/webm' if extension == 'webm' else 'video/mp4' if extension in ('mp4', 'm4v', 'mov') else 'application/octet-stream'
    return {'kind': kind, 'duration': duration, 'mime_type': mime, 'native_suggested': native,
            'codecs': codecs, 'format': format_name, 'width': int(video.get('width', 0)) if video else 0,
            'height': int(video.get('height', 0)) if video else 0}


def transcode_command(executable, source, target, kind):
    args = [str(executable), '-hide_banner', '-nostdin', '-v', 'error', '-y',
            '-max_alloc', '134217728', '-threads', '2', '-filter_threads', '2',
            '-protocol_whitelist', 'file,pipe', '-format_whitelist', FORMATS,
            '-i', str(source), '-map_metadata', '-1', '-map_chapters', '-1']
    if kind == 'audio':
        args += ['-map', '0:a:0', '-vn', '-c:a', 'aac', '-ac', '2', '-b:a', '192k',
                 '-movflags', '+faststart', '-f', 'mp4']
    elif kind == 'video':
        args += ['-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
                 '-vf', "fps=30,scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
                 '-c:v', 'h264_mf', '-hw_encoding', '0', '-pix_fmt', 'nv12', '-b:v', '1800k',
                 '-g', '60', '-threads', '2', '-c:a', 'aac', '-ac', '2', '-b:a', '128k',
                 '-f', 'hls', '-hls_time', '4', '-hls_list_size', '0', '-hls_playlist_type', 'event',
                 '-hls_flags', 'independent_segments+temp_file',
                 '-hls_segment_filename', str(Path(target).parent / '%06d.ts')]
    else:
        raise ValueError('媒体类型无效')
    return args + ['-progress', 'pipe:1', '-nostats', str(target)]


def _process_options():
    return {'stdin': subprocess.DEVNULL, 'shell': False,
            **({'creationflags': subprocess.CREATE_NO_WINDOW} if os.name == 'nt' else {})}


class MediaEngine:
    def __init__(self, ffmpeg, ffprobe):
        self.ffmpeg, self.ffprobe = Path(ffmpeg), Path(ffprobe)

    @classmethod
    def from_directory(cls, directory):
        root = Path(directory).resolve(strict=True)
        manifest = json.loads((root / 'engine-manifest.json').read_text('utf-8-sig'))
        for name in ('ffmpeg.exe', 'ffprobe.exe'):
            path = root / name
            expected = manifest.get('files', {}).get(name)
            if isinstance(expected, dict):
                expected = expected.get('sha256')
            if not isinstance(expected, str) or len(expected) != 64 or path.is_symlink():
                raise ValueError('媒体组件清单无效')
            path.resolve(strict=True).relative_to(root)
            with path.open('rb') as stream:
                digest = hashlib.file_digest(stream, 'sha256').hexdigest()
            if digest != expected.lower():
                raise ValueError('媒体组件校验失败')
        return cls(root / 'ffmpeg.exe', root / 'ffprobe.exe')

    def probe(self, path, extension):
        args = [str(self.ffprobe), '-v', 'error', '-max_alloc', '67108864',
                '-protocol_whitelist', 'file,pipe', '-format_whitelist', FORMATS,
                '-probesize', '5000000', '-analyzeduration', '10000000',
                '-show_entries', 'format=format_name,duration:stream=codec_type,codec_name,width,height,duration:stream_disposition=attached_pic',
                '-of', 'json', str(path)]
        result = subprocess.run(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=20, **_process_options())
        if result.returncode or len(result.stdout) > 2 * 1024**2:
            raise ValueError('文件格式识别失败')
        return describe_media(json.loads(result.stdout), extension)

    def transcode(self, source, target, kind, progress, cancelled):
        target = Path(target)
        process = subprocess.Popen(transcode_command(self.ffmpeg, source, target, kind),
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, **_process_options())
        errors = deque(maxlen=16)
        def read_progress():
            for raw in iter(process.stdout.readline, b''):
                key, _, value = raw.decode('utf-8', errors='replace').strip().partition('=')
                if key == 'out_time_us':
                    try:
                        progress(max(0, int(value)) / 1000000)
                    except (ValueError, OverflowError):
                        pass
        def read_errors():
            while chunk := process.stderr.read(4096):
                errors.append(chunk)
        readers = [threading.Thread(target=read_progress, daemon=True), threading.Thread(target=read_errors, daemon=True)]
        for reader in readers:
            reader.start()
        deadline = time.monotonic() + 3600
        try:
            while process.poll() is None:
                if cancelled() or time.monotonic() > deadline:
                    raise TimeoutError('兼容播放准备已停止，请重试或下载原文件')
                total = sum(p.stat().st_size for p in target.parent.iterdir() if p.is_file())
                if total > MAX_OUTPUT_BYTES:
                    raise ValueError('兼容副本超出临时空间限制，请下载原文件播放')
                time.sleep(.2)
            if process.returncode or not target.is_file():
                raise ValueError('无法生成兼容播放版本，请下载原文件播放')
            # A short conversion can finish between polls; its final bytes count too.
            if sum(p.stat().st_size for p in target.parent.iterdir() if p.is_file()) > MAX_OUTPUT_BYTES:
                raise ValueError('兼容副本超出临时空间限制，请下载原文件播放')
        finally:
            if process.poll() is None:
                process.kill()
            process.wait(timeout=10)
            for reader in readers:
                reader.join(timeout=2)
            process.stdout.close()
            process.stderr.close()

