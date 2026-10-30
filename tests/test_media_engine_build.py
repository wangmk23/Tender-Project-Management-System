import unittest
from pathlib import Path
import io
import tempfile
import wave
from unittest.mock import patch

from tools.media_engine.engine_manifest import validate_dlls, validate_configuration
from tools.media_engine.fetch_sources import download, compare_source_files
from tools.media_engine.windows_probe import validate_runtime_license, create_smoke_inputs


class MediaEngineBuildTests(unittest.TestCase):
    def test_smoke_inputs_are_real_decodable_files_without_avdevice(self):
        with tempfile.TemporaryDirectory() as directory:
            image, audio = create_smoke_inputs(Path(directory))
            self.assertTrue(image.read_bytes().startswith(b'P6\n320 240\n255\n'))
            self.assertEqual(len(image.read_bytes().split(b'\n', 3)[3]), 320 * 240 * 3)
            with wave.open(str(audio), 'rb') as stream:
                self.assertEqual((stream.getnchannels(), stream.getsampwidth(), stream.getframerate(),
                                  stream.getnframes()), (1, 2, 44100, 44100))
                self.assertNotEqual(set(stream.readframes(44100)), {0})

    def test_official_line_wrapped_lgpl_notice_is_accepted(self):
        validate_runtime_license('modify it under the terms of the GNU Lesser General Public\n'
                                 'License as published by the Free Software Foundation; either\n'
                                 'version 2.1 of the License, or (at your option) any later version.')

    def test_runtime_license_still_rejects_gpl_or_lgpl3(self):
        for notice in ('GNU General Public License version 2.1',
                       'GNU Lesser General Public License version 3', 'nonfree and unredistributable'):
            with self.assertRaisesRegex(ValueError, 'LGPL version 2.1'):
                validate_runtime_license(notice)

    def test_only_git_metadata_is_excluded_from_release_source_comparison(self):
        with tempfile.TemporaryDirectory() as directory:
            checkout, release = Path(directory) / 'git', Path(directory) / 'tar'
            for root in (checkout, release):
                (root / 'lib').mkdir(parents=True)
                (root / 'lib/codec.c').write_bytes(b'original codec')
            (checkout / 'lib/.gitignore').write_bytes(b'build-only metadata')
            names = ['lib/.gitignore', 'lib/codec.c']
            self.assertEqual(compare_source_files(checkout, release, names), [])
            (release / 'lib/codec.c').write_bytes(b'changed codec')
            self.assertEqual(compare_source_files(checkout, release, names), ['lib/codec.c'])

    def test_downloaded_wrong_source_is_never_promoted_to_a_trusted_archive(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'pinned-source.tar.xz'
            with patch('tools.media_engine.fetch_sources.urllib.request.urlopen',
                       side_effect=lambda *args, **kwargs: io.BytesIO(b'wrong-source')), \
                 patch('tools.media_engine.fetch_sources.time.sleep'):
                with self.assertRaisesRegex(ValueError, 'source SHA-256 mismatch'):
                    download('https://example.invalid/source.tar.xz', target, '0' * 64)
            self.assertFalse(target.exists())

    def test_static_engine_rejects_foreign_runtime_dlls(self):
        validate_dlls(['KERNEL32.dll', 'msvcrt.dll', 'api-ms-win-crt-runtime-l1-1-0.dll'])
        with self.assertRaisesRegex(ValueError, 'non-system DLL'):
            validate_dlls(['KERNEL32.dll', 'libwinpthread-1.dll'])

    def test_licensing_and_network_flags_must_not_be_silently_ignored(self):
        configuration = '\n'.join('#define CONFIG_' + name + ' ' + str(value) for name, value in
            [('GPL', 0), ('VERSION3', 0), ('NONFREE', 0), ('NETWORK', 0),
             ('H264_MF_ENCODER', 1), ('D3D11VA', 1), ('LIBDAV1D_DECODER', 1), ('PNG_DECODER', 1),
             ('AAC_ENCODER', 1), ('HLS_MUXER', 1), ('SHARED', 0), ('STATIC', 1)])
        validate_configuration(configuration)
        with self.assertRaisesRegex(ValueError, 'CONFIG_GPL'):
            validate_configuration(configuration.replace('CONFIG_GPL 0', 'CONFIG_GPL 1'))
        with self.assertRaisesRegex(ValueError, 'CONFIG_H264_MF_ENCODER'):
            validate_configuration(configuration.replace('CONFIG_H264_MF_ENCODER 1', 'CONFIG_H264_MF_ENCODER 0'))


if __name__ == '__main__':
    unittest.main()
