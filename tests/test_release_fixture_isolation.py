import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from tests.test_stage_template_packaged_e2e import PackagedClient


class FixtureIsolationTests(unittest.TestCase):
    def test_owned_clients_configure_backup_and_export_before_the_first_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary)
            candidate=root/'source.exe';candidate.write_bytes(b'synthetic fixture input')
            client=PackagedClient(candidate,root,'owned',12345)
            config_path=client.data_root/'app_settings.json'
            self.assertTrue(config_path.is_file())
            config=json.loads(config_path.read_text(encoding='utf-8'))
            for key in ('backup_folder','export_folder'):
                self.assertTrue(Path(config[key]).is_relative_to(client.data_root))
            self.assertTrue(config['last_backup_date'])
            self.assertIsNone(client.process)

    def test_public_fixture_copies_public_key_without_copying_signing_material(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);candidate=root/'source.exe';candidate.write_bytes(b'fixture')
            fixture=root/'fixture';fixture.mkdir()
            for name in ('license.dat','license_public_key.pem','license_private_key.pem'):
                (fixture/name).write_text(name,encoding='utf-8')
            with patch.dict(os.environ,PM_TEST_LICENSE_DIR=str(fixture)):
                client=PackagedClient(candidate,root,'owned',12345)
            self.assertTrue((client.data_root/'license_public_key.pem').is_file())
            self.assertFalse((client.data_root/'license_private_key.pem').exists())
