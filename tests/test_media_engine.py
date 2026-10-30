import json
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from src.backend_patches.media_engine import describe_media, transcode_command, MediaEngine


class MediaEngineTests(unittest.TestCase):
    def test_fast_completed_conversion_still_obeys_output_budget(self):
        class CompletedProcess:
            returncode = 0
            stdout = io.BytesIO()
            stderr = io.BytesIO()
            def poll(self): return 0
            def wait(self, timeout=None): return 0
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'output.m4a'
            target.write_bytes(b'x' * 1025)
            with patch('src.backend_patches.media_engine.MAX_OUTPUT_BYTES', 1024), \
                 patch('src.backend_patches.media_engine.subprocess.Popen', return_value=CompletedProcess()):
                with self.assertRaisesRegex(ValueError, '临时空间限制'):
                    MediaEngine('ffmpeg', 'ffprobe').transcode('source', target, 'audio', lambda _: None, lambda: False)

    def test_unknown_container_duration_uses_stream_duration_or_zero(self):
        raw = {'format': {'duration': 'N/A'}, 'streams': [
            {'codec_type': 'audio', 'codec_name': 'mp3', 'duration': '4.5'}]}
        self.assertEqual(describe_media(raw, 'mp3')['duration'], 4.5)
        raw['streams'][0]['duration'] = 'N/A'
        self.assertEqual(describe_media(raw, 'mp3')['duration'], 0)

    def test_real_stream_metadata_drives_native_playback_choice(self):
        raw = {'format': {'format_name': 'mov,mp4,m4a,3gp,3g2,mj2', 'duration': '12.25'},
               'streams': [{'codec_type': 'video', 'codec_name': 'h264', 'width': 1920, 'height': 1080},
                           {'codec_type': 'audio', 'codec_name': 'aac'}]}
        result = describe_media(raw, 'mp4')
        self.assertEqual((result['kind'], result['duration'], result['mime_type']), ('video', 12.25, 'video/mp4'))
        self.assertTrue(result['native_suggested'])
        raw['streams'][0]['codec_name'] = 'hevc'
        self.assertFalse(describe_media(raw, 'mov')['native_suggested'])

    def test_cover_art_does_not_turn_an_audio_file_into_video(self):
        raw = {'format': {'format_name': 'mp3', 'duration': '20'}, 'streams': [
            {'codec_type': 'video', 'codec_name': 'mjpeg', 'disposition': {'attached_pic': 1}},
            {'codec_type': 'audio', 'codec_name': 'mp3'}]}
        self.assertEqual(describe_media(raw, 'mp3')['kind'], 'audio')
        self.assertTrue(describe_media(raw, 'mp3')['native_suggested'])

    def test_invalid_duration_and_empty_or_subtitle_only_files_fail_closed(self):
        for duration in ('nan', 'inf', '-1', 'bad'):
            with self.subTest(duration=duration), self.assertRaises(ValueError):
                describe_media({'format': {'duration': duration}, 'streams': [{'codec_type': 'audio', 'codec_name': 'mp3'}]}, 'mp3')
        for streams in ([], [{'codec_type': 'subtitle', 'codec_name': 'ass'}]):
            with self.assertRaises(ValueError):
                describe_media({'format': {'duration': '1'}, 'streams': streams}, 'mkv')

    def test_conversion_is_local_bounded_and_never_constructs_a_shell_command(self):
        source = Path('C:/isolated/中文 & $(bad).mkv')
        args = transcode_command(Path('C:/tools/ffmpeg.exe'), source, Path('C:/cache/index.m3u8'), 'video')
        self.assertIsInstance(args, list)
        self.assertEqual(args[args.index('-i') + 1], str(source))
        self.assertEqual(args[args.index('-protocol_whitelist') + 1], 'file,pipe')
        self.assertIn('-nostdin', args)
        self.assertIn('h264_mf', args)
        self.assertIn('aac', args)
        self.assertIn('temp_file', args[args.index('-hls_flags') + 1])
        self.assertIn('-threads', args)
        self.assertNotIn('-re', args)

    def test_audio_conversion_has_no_video_and_keeps_browser_compatible_container(self):
        args = transcode_command(Path('ffmpeg.exe'), Path('input.wma'), Path('output.m4a'), 'audio')
        self.assertIn('-vn', args)
        self.assertIn('aac', args)
        self.assertEqual(args[-1], 'output.m4a')
        with self.assertRaises(ValueError):
            transcode_command(Path('ffmpeg'), Path('input'), Path('output'), 'script')

    def test_component_missing_or_hash_mismatch_is_rejected_before_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises((ValueError, FileNotFoundError)):
                MediaEngine.from_directory(root)
            for name in ('ffmpeg.exe', 'ffprobe.exe'):
                (root / name).write_bytes(b'not an approved executable')
            (root / 'engine-manifest.json').write_text(json.dumps({'version': '9.0.2', 'files': {
                'ffmpeg.exe': '0' * 64, 'ffprobe.exe': '0' * 64}}), encoding='utf-8')
            with self.assertRaises(ValueError):
                MediaEngine.from_directory(root)


if __name__ == '__main__':
    unittest.main()
