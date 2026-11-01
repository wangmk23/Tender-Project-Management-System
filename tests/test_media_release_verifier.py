"""Fail-closed checks for the packaged-media acceptance harness itself."""
from pathlib import Path
import tempfile
import unittest

from tools import verify_media_release as media


class MediaReleaseVerifierTests(unittest.TestCase):
    def test_cli_requires_both_hash_pinned_executables_and_evidence(self):
        with self.assertRaises(SystemExit) as raised:
            media.parser().parse_args([])
        self.assertEqual(raised.exception.code, 2)

    def test_download_urls_cannot_leave_this_attachment_or_loopback_origin(self):
        base = 'http://127.0.0.1:12345'
        for bad in ('https://example.com/a', '//example.com/a', '/api/attachments/2/media/stream',
                    '/api/attachments/1/media/../../settings', 'http://user@127.0.0.1:12345/api/attachments/1/media/stream'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                media.media_url(base, 1, bad)
        self.assertEqual(media.media_url(base, 1, '/api/attachments/1/media/stream?profile=original'),
                         base + '/api/attachments/1/media/stream?profile=original')

    def test_hls_only_accepts_six_digit_local_segments_and_complete_playlist(self):
        self.assertEqual(media.hls_members('#EXTM3U\n#EXTINF:4,\n000000.ts\n#EXT-X-ENDLIST\n'), ['000000.ts'])
        for bad in ('#EXTM3U\nhttps://example.com/x.ts\n#EXT-X-ENDLIST',
                    '#EXTM3U\n../000000.ts\n#EXT-X-ENDLIST',
                    '#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="https://example.com/key"\n000000.ts\n#EXT-X-ENDLIST',
                    '#EXTM3U\n000000.ts', '#EXTM3U\n#EXT-X-ENDLIST'):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                media.hls_members(bad)

    def test_real_fixtures_have_audio_and_avi_riff_containers(self):
        with tempfile.TemporaryDirectory() as temp:
            audio, video = media.make_fixtures(Path(temp), seconds=1)
            self.assertEqual(audio.read_bytes()[8:12], b'WAVE')
            body = video.read_bytes()
            self.assertEqual(body[:4], b'RIFF')
            self.assertEqual(body[8:12], b'AVI ')
            self.assertIn(b'movi', body)
            self.assertIn(b'idx1', body)

    def test_poll_reports_error_instead_of_waiting_or_skipping(self):
        class Response:
            status_code = 200
            def raise_for_status(self): pass
            def json(self): return {'status': 'error', 'message': 'decode failed'}
        class Session:
            def get(self, *_args, **_kwargs): return Response()
        class Client:
            base_url = 'http://127.0.0.1:12345'
            session = Session()
        with self.assertRaisesRegex(AssertionError, 'decode failed'):
            media.wait_ready(Client(), 1, 'original', timeout=.1)

    def test_engine_manifest_is_required_and_cannot_reference_altered_binaries(self):
        with tempfile.TemporaryDirectory() as temp:
            with self.assertRaises((FileNotFoundError, ValueError)):
                media.validate_engine(Path(temp))

    def test_seed_selects_explicit_regime_method_id_instead_of_ambiguous_name(self):
        class Client:
            def request(self, method, path, payload=None):
                if path == '/api/procurement-methods':
                    return {'methods': [{'name': '公开招标', 'regime': 'enterprise_procurement', 'id': 5},
                                        {'name': '公开招标', 'regime': 'government_procurement', 'id': 9}]}
                self.payload = payload
                return {'id': 1}
        client = Client()
        self.assertEqual(media.seed_project(client), {'id': 1})
        self.assertEqual(client.payload['procurement_method_id'], 9)
        self.assertNotIn('method', client.payload)

    def test_recorder_preserves_failure_without_claiming_acceptance(self):
        report = media.Report()
        with self.assertRaises(AssertionError):
            report.check('important gate', lambda: (_ for _ in ()).throw(AssertionError('bad')))
        self.assertFalse(report.result()['passed'])
        self.assertEqual(report.result()['failed'], 1)
        self.assertFalse(report.result()['native_desktop_verified'])
        self.assertFalse(report.result()['actual_phone_verified'])


if __name__ == '__main__':
    unittest.main()
