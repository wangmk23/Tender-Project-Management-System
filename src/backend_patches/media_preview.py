"""media-preview-v1: authenticated read-only derivatives of encrypted attachments."""
from __future__ import annotations

import atexit
import hashlib
import os
from pathlib import Path
import queue
import re
import shutil
import tempfile
import threading
import time
import uuid

try:
    from media_engine import MEDIA_EXTENSIONS, MediaEngine
except ModuleNotFoundError:
    from .media_engine import MEDIA_EXTENSIONS, MediaEngine

MAX_SOURCE_BYTES = 2 * 1024**3 + 1024


class MediaCache:
    def __init__(self, root, engine_provider, *, max_jobs=8, max_bytes=8 * 1024**3, ttl=900):
        self.root = Path(root).resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.engine_provider = engine_provider
        self.max_jobs, self.max_bytes, self.ttl = max_jobs, max_bytes, ttl
        self.lock = threading.RLock()
        self.jobs = {}
        self.readers = {}
        self._budget_checked_at = 0
        self.stopped = threading.Event()
        self.pending = queue.Queue(maxsize=max_jobs)
        self.worker = threading.Thread(target=self._work, daemon=True, name='owned-media-preview')
        self.worker.start()

    def _check_budget(self, *, force=False):
        with self.lock:
            now = time.monotonic()
            if not force and now - self._budget_checked_at < .5:
                return
            total = 0
            for job in self.jobs.values():
                if not job['directory'].is_dir() or job['directory'].is_symlink():
                    continue
                for path in job['directory'].iterdir():
                    try:
                        if path.is_file() and not path.is_symlink():
                            total += path.stat().st_size
                    except FileNotFoundError:
                        pass  # FFmpeg publishes .tmp files by atomic rename.
            self._budget_checked_at = now
            if total > self.max_bytes:
                raise ValueError('临时播放空间已满，请稍后重试或下载原文件')

    def _key(self, aid, source, profile):
        source = Path(source).resolve(strict=True)
        stat = source.stat()
        identity = f'{int(aid)}:{source}:{stat.st_size}:{stat.st_mtime_ns}'
        return (hashlib.sha256(identity.encode()).hexdigest(), profile)

    def _evict(self):
        now = time.monotonic()
        for key, job in list(self.jobs.items()):
            if job['state'] not in ('queued', 'preparing') and not job['leases'] and now - job['touched'] > self.ttl:
                directory = job['directory']
                directory.resolve().relative_to(self.root)
                if directory.is_symlink():
                    continue
                try:
                    if directory.exists():
                        shutil.rmtree(directory)
                except OSError:
                    continue
                del self.jobs[key]

    def _new_job(self, key, source, filename, profile, reader):
        self._evict()
        if self.stopped.is_set() or len(self.jobs) >= self.max_jobs:
            raise RuntimeError('播放准备任务较多，请稍后重试')
        size = source.stat().st_size
        if size > MAX_SOURCE_BYTES:
            raise ValueError('文件超出播放准备限制，请下载原文件')
        reservation = size if profile == 'original' else max(size * 2, 1024**2)
        if sum(job['reservation'] for job in self.jobs.values()) + reservation > self.max_bytes:
            raise RuntimeError('临时播放空间已满，请稍后重试或下载原文件')
        if shutil.disk_usage(self.root).free < reservation + 64 * 1024**2:
            raise RuntimeError('可用空间不足，请下载原文件播放')
        directory = self.root / uuid.uuid4().hex
        directory.mkdir(mode=0o700)
        job = {'key': key, 'source': source, 'filename': filename, 'profile': profile, 'reader': reader,
               'directory': directory, 'state': 'queued', 'touched': time.monotonic(), 'leases': 0,
               'reservation': reservation, 'metadata': {}, 'progress': None, 'message': '', 'file': None}
        self.jobs[key] = job
        self.pending.put_nowait(job)
        return job

    def prepare(self, aid, source, filename, profile='original', reader=None, retry=False):
        if profile not in ('original', 'compatible'):
            raise ValueError('播放版本无效')
        extension = Path(filename).suffix.lower().lstrip('.')
        if extension not in MEDIA_EXTENSIONS:
            raise ValueError('此附件不是支持的音频或视频')
        source = Path(source).resolve(strict=True)
        with self.lock:
            if self.stopped.is_set():
                raise RuntimeError('播放服务已停止')
            original_key = self._key(aid, source, 'original')
            original = self.jobs.get(original_key)
            if original and retry and original['state'] == 'error':
                compatible_key = (original_key[0], 'compatible')
                if not self._discard(compatible_key) or not self._discard(original_key):
                    raise RuntimeError('上次播放读取尚未结束，请稍后重试')
                original = None
            if original is None:
                original = self._new_job(original_key, source, filename, 'original', reader)
            key = (original_key[0], profile)
            job = self.jobs.get(key)
            if job and retry and job['state'] == 'error':
                if not self._discard(key):
                    raise RuntimeError('上次播放读取尚未结束，请稍后重试')
                job = None
            if job is None:
                job = self._new_job(key, source, filename, profile, reader)
            original['touched'] = job['touched'] = time.monotonic()
            return self._description(job)

    def _discard(self, key):
        job = self.jobs.get(key)
        if job is None:
            return True
        inactive = job['state'] not in ('queued', 'preparing') or (self.stopped.is_set() and job['state'] == 'queued')
        if inactive and not job['leases'] and self._remove_files(job):
            self.jobs.pop(key, None)
            return True
        return False

    def _remove_files(self, job):
        directory = job['directory']
        directory.resolve().relative_to(self.root)
        if directory.is_symlink():
            return False
        try:
            if directory.exists():
                shutil.rmtree(directory)
        except OSError:
            return False
        job['reservation'] = 0
        return True

    def _cleanup_stopped(self):
        if not self.stopped.is_set():
            return
        with self.lock:
            for key in list(self.jobs):
                self._discard(key)
            try:
                self.root.rmdir()  # Only our empty owned directory.
            except OSError:
                pass

    def _description(self, job):
        metadata = dict(job['metadata'])
        state = job['state']
        if state == 'preparing' and metadata.get('kind') == 'video' and job.get('file') and job['file'].is_file():
            # FFmpeg publishes each segment and playlist by atomic rename.
            try:
                if re.search(r'^\d{6}\.ts$', job['file'].read_text('utf-8'), re.M):
                    state = 'ready'
            except OSError:
                pass
        return {**metadata, 'status': state, 'filename': job['filename'], 'profile': job['profile'],
                'progress': job['progress'], 'message': job['message'] or
                ('正在准备兼容播放版本' if job['profile'] == 'compatible' else '正在读取媒体文件')}

    def _work(self):
        while not self.stopped.is_set():
            try:
                job = self.pending.get(timeout=1)
            except queue.Empty:
                with self.lock:
                    self._evict()
                continue
            try:
                with self.lock:
                    job['state'] = 'preparing'
                if job['profile'] == 'original':
                    self._original(job)
                else:
                    self._compatible(job)
                self._check_budget(force=True)
                with self.lock:
                    job['state'], job['progress'] = 'ready', 100
                    job['reservation'] = sum(p.stat().st_size for p in job['directory'].iterdir() if p.is_file())
            except Exception as error:
                with self.lock:
                    job['state'] = 'error'
                    job['file'] = None
                    job['message'] = str(error) if isinstance(error, (ValueError, TimeoutError)) else '媒体文件准备失败，请重试或下载原文件'
                    # Unauthenticated plaintext must not survive a failed read.
                    # Preserve the error record so polling cannot rerun the job.
                    if not job['leases']:
                        self._remove_files(job)
            finally:
                self.pending.task_done()
                self._cleanup_stopped()
        self._cleanup_stopped()

    def _original(self, job):
        source = job['source']
        before = (source.stat().st_size, source.stat().st_mtime_ns)
        part = job['directory'] / 'source.part'
        total = 0
        with part.open('wb') as output:
            for chunk in job['reader'](source):
                if self.stopped.is_set():
                    raise TimeoutError('播放准备已停止')
                total += len(chunk)
                if total > MAX_SOURCE_BYTES:
                    raise ValueError('媒体文件过大，请下载原文件')
                output.write(chunk)
        after = (source.stat().st_size, source.stat().st_mtime_ns)
        if before != after:
            raise ValueError('附件已更新，请重新打开预览')
        self._check_budget(force=True)
        extension = Path(job['filename']).suffix.lower().lstrip('.')
        authenticated = job['directory'] / ('source.' + extension)
        os.replace(part, authenticated)
        metadata = self.engine_provider().probe(authenticated, extension)
        with self.lock:
            job['file'], job['metadata'] = authenticated, metadata

    def _compatible(self, job):
        with self.lock:
            original = self.jobs[(job['key'][0], 'original')]
            if original['state'] != 'ready':
                raise ValueError(original['message'] or '原文件尚未就绪，请重试')
            job['metadata'] = dict(original['metadata'])
            kind = original['metadata']['kind']
            target = job['directory'] / ('index.m3u8' if kind == 'video' else 'audio.m4a')
            job['file'] = target
            job['metadata'].update(mime_type='application/vnd.apple.mpegurl' if kind == 'video' else 'audio/mp4', native_suggested=True)
        def progress(seconds):
            with self.lock:
                duration = job['metadata'].get('duration') or 1
                job['progress'] = min(99, max(0, seconds * 100 / duration))
        def cancelled():
            self._check_budget()
            with self.lock:
                return self.stopped.is_set() or (not job['leases'] and time.monotonic() - job['touched'] > 90)
        self.engine_provider().transcode(original['file'], target, kind, progress, cancelled)

    def file(self, aid, source, profile, member=None):
        with self.lock:
            try:
                job = self.jobs.get(self._key(aid, source, profile))
            except (OSError, ValueError):
                return None
            if not job or self._description(job)['status'] != 'ready':
                return None
            target = job['file']
            if member is not None:
                if profile != 'compatible' or not re.fullmatch(r'(?:index\.m3u8|\d{6}\.ts)', member):
                    return None
                target = job['directory'] / member
            if not target or target.is_symlink() or not target.is_file():
                return None
            try:
                target.resolve().relative_to(self.root)
            except ValueError:
                return None
            job['touched'] = time.monotonic()
            return target

    def lease(self, aid, source, profile):
        with self.lock:
            job = self.jobs[self._key(aid, source, profile)]
            job['leases'] += 1
        released = False
        def release():
            nonlocal released
            with self.lock:
                if not released:
                    released = True
                    job['leases'] = max(0, job['leases'] - 1)
                    self.readers.pop(release, None)
                    job['touched'] = time.monotonic()
                    if not job['leases'] and job['state'] == 'error':
                        self._remove_files(job)
                    self._cleanup_stopped()
        with self.lock:
            self.readers[release] = None
        return release

    def attach_reader(self, release, closer):
        with self.lock:
            if release in self.readers:
                self.readers[release] = closer
                return
        closer()  # Shutdown won the race before the response was attached.

    def acquire_file(self, aid, source, profile, member=None):
        with self.lock:
            if self.stopped.is_set():
                return None
            target = self.file(aid, source, profile, member)
            if target is None:
                return None
            mime = self.jobs[self._key(aid, source, profile)]['metadata']['mime_type']
            return target, mime, self.lease(aid, source, profile)

    def close(self):
        self.stopped.set()
        self.worker.join(timeout=23)  # Includes the bounded 20-second ffprobe call.
        with self.lock:
            readers = list(self.readers.items())
        for release, closer in readers:
            try:
                if closer:
                    closer()
            except OSError:
                pass
            finally:
                release()
        self._cleanup_stopped()


def register(app, db, runtime):
    if app.extensions.get('media_preview'):
        return
    from flask import jsonify, request, send_file, Response, redirect
    from werkzeug.wsgi import ClosingIterator
    Attachment = runtime['Attachment']
    upload_root = Path(runtime['UPLOAD_FOLDER']).resolve()
    cache = runtime.get('cache')
    if cache is None:
        import sys
        roots = [Path(getattr(sys, '_MEIPASS', Path(sys.executable).parent)) / 'static/libs/media-engine',
                 Path(sys.executable).parent / '工具/媒体']
        engine = [None]
        def load_engine():
            if engine[0] is None:
                directory = next((p for p in roots if (p / 'engine-manifest.json').is_file()), None)
                if directory is None:
                    raise ValueError('播放组件暂不可用，请重新启动程序或下载原文件')
                engine[0] = MediaEngine.from_directory(directory)
            return engine[0]
        cache = MediaCache(Path(tempfile.mkdtemp(prefix='pm-media-owned-')), load_engine)
        atexit.register(cache.close)
    app.extensions['media_preview'] = cache

    def attachment(aid):
        row = db.session.get(Attachment, aid)
        if row is None or Path(str(getattr(row, 'filename', ''))).suffix.lower().lstrip('.') not in MEDIA_EXTENSIONS:
            return None, None
        try:
            path = (upload_root / str(row.file_path)).resolve(strict=True)
            path.relative_to(upload_root)
            if not path.is_file():
                return None, None
        except (OSError, ValueError):
            return None, None
        return row, path

    def profile_value():
        profile = request.args.get('profile', 'original')
        if profile not in ('original', 'compatible'):
            raise ValueError('播放版本无效')
        return profile

    def metadata(aid):
        row, path = attachment(aid)
        if row is None:
            return jsonify(error='附件不存在'), 404
        try:
            profile = profile_value()
            retry = request.args.get('retry', '0')
            if retry not in ('0', '1'):
                raise ValueError('重试参数无效')
            data = cache.prepare(aid, path, row.filename, profile,
                lambda source: runtime['iter_decrypted_file'](source, runtime['ATTACHMENT_KEY']), retry == '1')
            if data['status'] == 'ready':
                data['url'] = f'/api/attachments/{aid}/media/compatible/index.m3u8' if profile == 'compatible' and data['kind'] == 'video' else f'/api/attachments/{aid}/media/stream?profile={profile}'
            response = jsonify(data)
            response.headers['Cache-Control'] = 'private, no-store'
            return response
        except ValueError as error:
            return jsonify(error=str(error)), 400
        except RuntimeError as error:
            return jsonify(error=str(error)), 429
        except OSError:
            return jsonify(error='附件暂不可用，请重新打开预览'), 404

    def serve(aid, member=None):
        row, path = attachment(aid)
        if row is None:
            return jsonify(error='附件不存在'), 404
        try:
            profile = 'compatible' if member is not None else profile_value()
        except ValueError as error:
            return jsonify(error=str(error)), 400
        acquired = cache.acquire_file(aid, path, profile, member)
        if acquired is None:
            return jsonify(error='播放文件尚未就绪或已过期，请重新打开预览'), 409
        target, mime, release = acquired
        if member is None and profile == 'compatible' and target.suffix == '.m3u8':
            release()
            return redirect(f'/api/attachments/{aid}/media/compatible/index.m3u8', code=307)
        if member is not None:
            mime = 'application/vnd.apple.mpegurl' if member == 'index.m3u8' else 'video/mp2t'
        try:
            response = response_for_file(target, mime, row.filename, member)
        except Exception:
            release()
            raise
        cache.attach_reader(release, getattr(response.response, 'close', lambda: None))
        response.response = ClosingIterator(response.response, [release])
        return response

    def response_for_file(target, mime, filename, member):
        if member == 'index.m3u8':
            # A Windows open file handle prevents FFmpeg replacing its playlist.
            # Read a closed, bounded snapshot; immutable segments may be streamed.
            with target.open('rb') as playlist:
                body = playlist.read(2 * 1024**2 + 1)
            if len(body) > 2 * 1024**2:
                response = jsonify(error='播放列表过大，请下载原文件播放')
                response.status_code = 413
                return response
            response = Response(body, mimetype=mime)
        else:
            response = send_file(target, mimetype=mime, as_attachment=False, conditional=True, download_name=filename)
        response.headers.update({'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff'})
        return response

    login = runtime['login_required']
    app.add_url_rule('/api/attachments/<int:aid>/media', 'api_media_metadata', login(metadata), methods=['GET'])
    app.add_url_rule('/api/attachments/<int:aid>/media/stream', 'api_media_stream', login(serve), methods=['GET'])
    app.add_url_rule('/api/attachments/<int:aid>/media/compatible/<path:member>', 'api_media_segment', login(serve), methods=['GET'])

