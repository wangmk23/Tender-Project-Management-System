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
    def source(self, include_guide):
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, 'w') as archive:
            archive.writestr('README.md', 'Example source')
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
