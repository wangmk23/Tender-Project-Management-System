from functools import wraps
from pathlib import Path
import tempfile
import time
import threading
import os
import unittest

from flask import Flask, jsonify, session
from unittest.mock import patch
from src.backend_patches.media_preview import MediaCache, register


class FakeEngine:
    def __init__(self):
        self.probes = 0
        self.conversions = 0

    def probe(self, path, extension):
        self.probes += 1
        return {'kind': 'audio', 'duration': 10, 'mime_type': 'audio/mpeg', 'native_suggested': True}

    def transcode(self, source, target, kind, progress, cancelled):
        self.conversions += 1
        target.write_bytes(b'compatible-audio')
        progress(1)


class MediaPreviewTests(unittest.TestCase):
    def test_close_drains_its_active_reader_before_removing_plaintext(self):
        self.assertEqual(self.ready()['status'], 'ready')
        release = self.cache.lease(1, self.source, 'original')
        cached = self.cache.file(1, self.source, 'original')
        reader = cached.open('rb')
        self.cache.attach_reader(release, reader.close)
        self.cache.close()
        self.assertTrue(reader.closed)
        self.assertFalse(cached.exists())
        release()
        self.assertFalse(cached.exists())
        self.assertTrue(self.source.exists())

    def test_worker_finishing_after_close_still_cleans_plaintext(self):
        started, finish = threading.Event(), threading.Event()
        probe = self.engine.probe
        def blocked(path, extension):
            started.set(); finish.wait(5)
            return probe(path, extension)
        self.engine.probe = blocked
        self.request()
        self.assertTrue(started.wait(2))
        with patch.object(self.cache.worker, 'join'):
            self.cache.close()
        finish.set()
        self.cache.worker.join(timeout=3)
        self.assertFalse(self.cache.worker.is_alive())
        self.assertFalse(any((self.root / 'cache').rglob('source.mp3')))

    def test_retry_cannot_replace_an_error_job_while_its_stream_is_leased(self):
        self.request('compatible')
        self.assertEqual(self.ready('compatible')['status'], 'ready')
        key = self.cache._key(1, self.source, 'compatible')
        job = self.cache.jobs[key]
        release = self.cache.lease(1, self.source, 'compatible')
        job['state'] = 'error'
        try:
            with self.assertRaises(RuntimeError):
                self.cache.prepare(1, self.source, self.filename, 'compatible',
                                   lambda path: (path.read_bytes(),), retry=True)
            self.assertIs(self.cache.jobs[key], job)
        finally:
            release()
        self.assertFalse(job['directory'].exists())
        self.assertEqual(self.cache.prepare(1, self.source, self.filename, 'compatible',
            lambda path: (path.read_bytes(),), retry=True)['status'], 'queued')

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source = self.root / 'source.mp3'
        self.source.write_bytes(b'0123456789')
        self.engine = FakeEngine()
        self.filename = '合成录音.mp3'
        self.cache = MediaCache(self.root / 'cache', lambda: self.engine, max_jobs=4)

    def tearDown(self):
        self.cache.close()
        self.temp.cleanup()

    def request(self, profile='original', reader=None):
        return self.cache.prepare(1, self.source, self.filename, profile,
                                  reader or (lambda path: (path.read_bytes(),)))

    def ready(self, profile='original'):
        deadline = time.monotonic() + 3
        while time.monotonic() < deadline:
            result = self.request(profile)
            if result['status'] in ('ready', 'error'):
                return result
            time.sleep(.01)
        self.fail('owned media job did not finish')

    def test_repeat_prepare_reuses_one_decryption_and_one_probe(self):
        calls = []
        def reader(path):
            calls.append(path)
            yield b'01234'
            yield b'56789'
        self.request(reader=reader)
        for _ in range(10):
            self.request(reader=reader)
        self.assertEqual(self.ready()['status'], 'ready')
        self.assertEqual(len(calls), 1)
        self.assertEqual(self.engine.probes, 1)
        self.assertEqual(self.cache.file(1, self.source, 'original').read_bytes(), b'0123456789')

    def test_unverified_partial_plaintext_is_never_exposed(self):
        def invalid_reader(path):
            yield b'unauthenticated partial bytes'
            raise ValueError('authentication tag rejected')
        self.request(reader=invalid_reader)
        self.assertEqual(self.ready()['status'], 'error')
        self.assertEqual(self.engine.probes, 0)
        self.assertIsNone(self.cache.file(1, self.source, 'original'))
        self.assertEqual(list((self.root / 'cache').rglob('source.part')), [])
        self.assertEqual(self.source.read_bytes(), b'0123456789')

    def test_explicit_retry_recovers_a_failed_read_without_rewriting_the_attachment(self):
        def broken(path):
            raise OSError('owned simulated read error')
            yield
        self.request(reader=broken)
        self.assertEqual(self.ready()['status'], 'error')
        self.cache.prepare(1, self.source, '合成录音.mp3', 'original', lambda path: (path.read_bytes(),), retry=True)
        self.assertEqual(self.ready()['status'], 'ready')
        self.assertEqual(self.source.read_bytes(), b'0123456789')

    def test_capacity_rejection_is_bounded_and_a_ready_file_survives_it(self):
        self.cache.max_jobs = 1
        self.assertEqual(self.ready()['status'], 'ready')
        other = self.root / 'second.mp3'
        other.write_bytes(b'other')
        with self.assertRaises(RuntimeError):
            self.cache.prepare(2, other, 'other.mp3', 'original', lambda path: (path.read_bytes(),))
        self.assertEqual(self.cache.file(1, self.source, 'original').read_bytes(), b'0123456789')

    def test_actual_conversion_bytes_cannot_bypass_the_global_cache_budget(self):
        self.cache.max_bytes = 2 * 1024**2
        def oversized(source, target, kind, progress, cancelled):
            target.write_bytes(b'x' * (3 * 1024**2))
        self.engine.transcode = oversized
        self.request('compatible')
        result = self.ready('compatible')
        self.assertEqual(result['status'], 'error')
        self.assertIsNone(self.cache.file(1, self.source, 'compatible'))
        self.assertLessEqual(sum(p.stat().st_size for p in self.cache.root.rglob('*') if p.is_file()), self.cache.max_bytes)
        self.assertEqual(self.cache.file(1, self.source, 'original').read_bytes(), b'0123456789')

    def test_a_slow_active_media_lease_prevents_idle_conversion_cancellation(self):
        started, finish = threading.Event(), threading.Event()
        def held(source, target, kind, progress, cancelled):
            self.cancel_probe = cancelled
            started.set()
            finish.wait(2)
            target.write_bytes(b'compatible')
        self.engine.transcode = held
        try:
            self.request('compatible')
            self.assertTrue(started.wait(2))
            release = self.cache.lease(1, self.source, 'compatible')
            with self.cache.lock:
                job = self.cache.jobs[self.cache._key(1, self.source, 'compatible')]
                job['touched'] -= 91
            self.assertFalse(self.cancel_probe())
            release()
            with self.cache.lock:
                job['touched'] -= 91
            self.assertTrue(self.cancel_probe())
        finally:
            finish.set()

    def test_serving_a_playlist_does_not_lock_the_file_against_atomic_replacement(self):
        self.filename = '合成录像.mkv'
        self.engine.probe = lambda path, extension: {'kind': 'video', 'duration': 4,
            'mime_type': 'application/octet-stream', 'native_suggested': False}
        def hls(source, target, kind, progress, cancelled):
            (target.parent / '000000.ts').write_bytes(b'owned segment')
            target.write_text('#EXTM3U\n#EXTINF:4,\n000000.ts\n#EXT-X-ENDLIST\n', encoding='utf-8')
        self.engine.transcode = hls
        self.request('compatible')
        self.assertEqual(self.ready('compatible')['status'], 'ready')
        app = Flask(__name__)
        attachment = type('Attachment', (), {'file_path': self.source.name, 'filename': self.filename})()
        db = type('DB', (), {'session': type('Session', (), {'get': lambda _, model, aid: attachment})()})()
        register(app, db, {'Attachment': object, 'UPLOAD_FOLDER': self.root, 'DATA_DIR': self.root,
            'login_required': lambda fn: fn, 'iter_decrypted_file': lambda path, key: (path.read_bytes(),),
            'ATTACHMENT_KEY': b'owned fake key', 'cache': self.cache})
        response = app.test_client().get('/api/attachments/1/media/compatible/index.m3u8', buffered=False)
        try:
            self.assertEqual(response.status_code, 200)
            playlist = self.cache.file(1, self.source, 'compatible', 'index.m3u8')
            pending = playlist.with_suffix('.tmp')
            pending.write_bytes(b'#EXTM3U\n#EXT-X-ENDLIST\n')
            os.replace(pending, playlist)
        finally:
            response.close()

    def test_compatible_retry_does_not_duplicate_original_or_modify_input(self):
        self.request('compatible')
        self.assertEqual(self.ready('compatible')['status'], 'ready')
        self.request('compatible')
        self.assertEqual((self.engine.probes, self.engine.conversions), (1, 1))
        self.assertEqual(self.cache.file(1, self.source, 'compatible').read_bytes(), b'compatible-audio')
        self.assertEqual(self.source.read_bytes(), b'0123456789')

    def test_changed_source_invalidates_old_cached_media_and_members_are_restricted(self):
        self.assertEqual(self.ready()['status'], 'ready')
        self.source.write_bytes(b'changed-longer-source')
        self.assertIsNone(self.cache.file(1, self.source, 'original'))
        for name in ('../source.mp3', 'C:/secret', 'https://external/video', 'x.m3u8'):
            with self.subTest(name=name):
                self.assertIsNone(self.cache.file(1, self.source, 'compatible', name))

    def test_authenticated_range_head_and_out_of_range_match_the_original_bytes(self):
        app = Flask(__name__)
        app.secret_key = 'owned-test-session-only'
        attachment = type('Attachment', (), {'file_path': self.source.name, 'filename': '合成录音.mp3', 'project_id': 8})()
        db = type('DB', (), {'session': type('Session', (), {'get': lambda _, model, aid: attachment if aid == 1 else None})()})()
        def login_required(fn):
            @wraps(fn)
            def wrapped(*args, **kwargs):
                return fn(*args, **kwargs) if session.get('user_id') else (jsonify(error='login required'), 401)
            return wrapped
        register(app, db, {'Attachment': object, 'UPLOAD_FOLDER': self.root, 'DATA_DIR': self.root,
            'login_required': login_required, 'iter_decrypted_file': lambda path, key: (path.read_bytes(),),
            'ATTACHMENT_KEY': b'owned fake key', 'cache': self.cache})
        client = app.test_client()
        self.assertEqual(client.get('/api/attachments/1/media').status_code, 401)
        with client.session_transaction() as values:
            values['user_id'] = 1
        self.assertEqual(client.get('/api/attachments/999/media').status_code, 404)
        client.get('/api/attachments/1/media')
        self.assertEqual(self.ready()['status'], 'ready')
        response = client.get('/api/attachments/1/media/stream?profile=original', headers={'Range': 'bytes=2-5'})
        self.assertEqual((response.status_code, response.data), (206, b'2345'))
        self.assertIn('no-store', response.headers['Cache-Control'])
        response.close()
        head = client.head('/api/attachments/1/media/stream?profile=original')
        self.assertEqual((head.status_code, head.data), (200, b''))
        head.close()
        self.assertEqual(client.get('/api/attachments/1/media/stream?profile=original', headers={'Range': 'bytes=30-40'}).status_code, 416)
        self.assertEqual(client.get('/api/attachments/1/media?profile=arbitrary').status_code, 400)
        attachment.file_path = '../outside.mp3'
        self.assertEqual(client.get('/api/attachments/1/media').status_code, 404)


if __name__ == '__main__':
    unittest.main()
