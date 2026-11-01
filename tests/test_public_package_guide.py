import hashlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile
from tools import package_public_release as builder


class PublicPackageGuideTests(unittest.TestCase):
    def test_media_source_package_requires_exact_archive_and_corresponding_sources(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'engine.zip'
            data = b'complete corresponding source'
            manifest = {'license': 'LGPL-2.1-or-later', 'sources': {'ffmpeg': {
                'filename': 'ffmpeg.tar.xz', 'sha256': hashlib.sha256(data).hexdigest()}}}
            with zipfile.ZipFile(path, 'w') as archive:
                archive.writestr('engine-manifest.json', json.dumps(manifest))
                archive.writestr('sources/ffmpeg.tar.xz', data)
                archive.writestr('recipe/build.sh', 'reviewed build recipe')
                archive.writestr('licenses/COPYING.txt', 'license')
                archive.writestr('ffmpeg.exe', b'not duplicated in source appendix')
            pin = hashlib.sha256(path.read_bytes()).hexdigest()
            entries = builder.media_source_entries(path, pin)
            self.assertEqual(builder.media_source_entries(path.read_bytes(), pin), entries)
            self.assertIn('sources/ffmpeg.tar.xz', entries)
            self.assertNotIn('ffmpeg.exe', entries)
            with self.assertRaises(ValueError): builder.media_source_entries(path, '0' * 64)
            with self.assertRaises(ValueError): builder.media_source_entries(None, pin)
            wrapped = Path(directory) / 'wrapped.zip'
            with zipfile.ZipFile(path) as source, zipfile.ZipFile(wrapped, 'w') as output:
                for name in source.namelist():
                    output.writestr('媒体引擎/' + name, source.read(name))
            self.assertEqual(builder.media_source_entries(wrapped, hashlib.sha256(wrapped.read_bytes()).hexdigest()), entries)

    def source(self, include_guide):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('README.md', 'Example source')
            archive.writestr('source/frontend/02-projects.js', 'runtime source')
            archive.writestr('AGENTS.md', 'local machine instructions')
            archive.writestr('docs/模块协作/模块清单.json', 'private local paths')
            archive.writestr('docs/plans/local-plan.md', 'session context')
            archive.writestr('docs/superpowers/specs/local-design.md', 'session context')
            if include_guide:
                archive.writestr('使用说明.txt', '初始化密钥，密码至少 10 位，admin / 123456，license.dat'.encode('utf-8-sig'))
        return buffer.getvalue()

    def test_package_root_contains_readable_guide_and_chinese_binaries(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'docs/releases').mkdir(parents=True)
            hashes = {}
            for name in builder.ASSETS:
                (root/name).write_bytes(name.encode())
                hashes[name] = hashlib.sha256(name.encode()).hexdigest()
            (root/'docs/releases/v1.0.0-public.json').write_text(json.dumps({'assets': hashes}))
            with patch.object(builder, 'ROOT', root), patch.object(builder.subprocess, 'check_output', return_value=self.source(True)):
                result = builder.package(root, 'v1.0.0-public', '使用说明版')
                with zipfile.ZipFile(result) as archive:
                    self.assertIn('使用说明.txt', archive.namelist())
                    self.assertIn('初始化密钥', archive.read('使用说明.txt').decode('utf-8-sig'))
                    self.assertEqual(sum(name.endswith('.exe') for name in archive.namelist()), 3)
                    self.assertIn('项目管理系统-V5-公开版-使用说明版-v1.0.0.exe', archive.namelist())
                    self.assertIn('source/frontend/02-projects.js', archive.namelist())
                    for name in ('AGENTS.md', 'docs/模块协作/模块清单.json',
                                 'docs/plans/local-plan.md', 'docs/superpowers/specs/local-design.md'):
                        self.assertNotIn(name, archive.namelist())
                with self.assertRaises(FileExistsError):
                    builder.package(root, 'v1.0.0-public', '使用说明版')

    def test_missing_guide_refuses_to_create_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root/'docs/releases').mkdir(parents=True)
            hashes = {}
            for name in builder.ASSETS:
                (root/name).write_bytes(b'public')
                hashes[name] = hashlib.sha256(b'public').hexdigest()
            (root/'docs/releases/v1.0.0-public.json').write_text(json.dumps({'assets': hashes}))
            with patch.object(builder, 'ROOT', root), patch.object(builder.subprocess, 'check_output', return_value=self.source(False)):
                with self.assertRaisesRegex(ValueError, '使用说明'):
                    builder.package(root, 'v1.0.0-public', '使用说明版')
            self.assertFalse(list(root.glob('*.zip')))
