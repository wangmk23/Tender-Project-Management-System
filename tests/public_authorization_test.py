import importlib.util
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'authorization'))
import license_issuer as issuer
import license_bound as bound


class PublicAuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.keys = self.root / 'keys'
        self.target = self.root / 'app'
        self.patches = [patch.dict('os.environ', PROCUREMENT_ISSUER_HOME=str(self.keys)),
                        patch.object(issuer, 'program_dir', return_value=self.root),
                        patch.object(issuer, 'get_volume_serial', return_value='ABCDEF12')]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_frozen_extraction_directory_is_not_the_source_root(self):
        with patch.object(sys, 'frozen', True, create=True), \
                patch.object(issuer, '__file__', str(self.root / '_MEI-example/license_issuer.py')):
            self.assertEqual(issuer.issuer_home(), self.keys.resolve())

    def test_frozen_keys_are_still_rejected_inside_git(self):
        (self.root / '.git').mkdir()
        with patch.object(sys, 'frozen', True, create=True):
            with self.assertRaises(ValueError):
                issuer.issuer_home()

    @unittest.skipUnless(sys.platform == 'win32', 'Windows console semantics')
    def test_command_line_streams_survive_missing_console(self):
        def stream(name, *args, **kwargs):
            if name.startswith('CON'):
                raise OSError('No console')
            return io.StringIO()
        with patch.object(sys, 'stdout', None), patch.object(sys, 'stderr', None), \
                patch.object(sys, 'stdin', None), \
                patch('ctypes.windll.kernel32.AttachConsole', return_value=0), \
                patch('builtins.open', side_effect=stream):
            issuer._attach_console()
            self.assertIsNotNone(sys.stdout)
            self.assertIsNotNone(sys.stderr)

    def test_command_line_output_uses_utf8_on_english_windows(self):
        output = io.BytesIO()
        stream = io.TextIOWrapper(output, encoding='cp1252')
        with patch.object(sys, 'stdout', stream), patch.object(sys, 'stderr', stream):
            issuer._attach_console()
            print('授权初始化完成')
        stream.flush()
        self.assertEqual(output.getvalue().decode('utf-8').strip(), '授权初始化完成')
        stream.detach()

    def test_entry_reports_invalid_configuration_without_fatal_dialog(self):
        with patch.object(issuer, 'cli', side_effect=ValueError('Invalid configuration')), \
                contextlib.redirect_stderr(io.StringIO()) as error:
            self.assertEqual(issuer.main([]), 2)
            self.assertIn('Invalid configuration', error.getvalue())

    def initialize(self, disk=False):
        issuer.initialize_keys('temporary-password', self.target, bound_mode=disk)

    def issue(self, **extra):
        return issuer.issue(target_dir=self.target, organization='Test', expires=None,
                            password='temporary-password', **extra)

    def test_signature_export_and_tampering(self):
        self.initialize()
        document, output = self.issue()
        self.assertTrue(output.is_file())
        self.assertTrue(document['payload']['license_id'].startswith('PM-'))
        self.assertEqual(document['payload']['product'], 'procurement-project-manager')
        pem = (self.target / 'license_public_key.pem').read_bytes()
        self.assertTrue(issuer.self_check(document, pem)[0])
        document['payload']['organization'] = 'Tampered'
        self.assertFalse(issuer.self_check(document, pem)[0])
        self.assertIn(b'ENCRYPTED PRIVATE KEY', issuer.private_key_path().read_bytes())

    def test_no_overwrite_existing_keys_or_wrong_public_key(self):
        self.initialize()
        original = issuer.private_key_path().read_bytes()
        with self.assertRaises(FileExistsError):
            self.initialize()
        self.assertEqual(original, issuer.private_key_path().read_bytes())
        (self.target / 'license_public_key.pem').write_bytes(b'wrong key')
        with self.assertRaises(ValueError):
            self.issue()
        self.assertFalse((self.target / 'license.dat').exists())

    def test_bound_rejects_missing_partial_wrong_unknown_and_remote(self):
        with self.assertRaises(PermissionError):
            self.issue(bound_mode=True)
        self.initialize(disk=True)
        self.assertTrue(bound.verify_disk())
        with patch.object(issuer, 'get_volume_serial', return_value='unknown-volume'):
            self.assertFalse(bound.verify_disk())
            with self.assertRaises(PermissionError):
                self.issue(bound_mode=True)
        with patch.object(issuer, 'get_volume_serial', return_value='12345678'):
            self.assertFalse(bound.verify_disk())
        with self.assertRaises(ValueError):
            self.issue(bound_mode=True, machine_hash='a' * 64)
        config = self.root / 'issuer-config.json'
        config.write_text('{}', encoding='utf-8')
        self.assertFalse(bound.verify_disk())
        with self.assertRaises(PermissionError):
            self.issue(bound_mode=True)

    def test_partial_setup_and_unknown_disk_never_create_keys(self):
        self.keys.mkdir()
        (self.keys / 'license_public_key.pem').write_bytes(b'partial')
        with self.assertRaises(FileExistsError):
            self.initialize()
        self.assertFalse(issuer.private_key_path().exists())
        (self.keys / 'license_public_key.pem').unlink()
        with patch.object(issuer, 'get_volume_serial', return_value='unknown-volume'):
            with self.assertRaises(PermissionError):
                self.initialize(disk=True)
        self.assertFalse(issuer.private_key_path().exists())

    def test_failed_signature_selfcheck_writes_no_license(self):
        self.initialize()
        with patch.object(issuer, 'self_check', return_value=(False, 'invalid')):
            with self.assertRaises(ValueError):
                self.issue()
        self.assertFalse((self.target / 'license.dat').exists())

    def test_cli_init_sign_and_bound_diagnostic_without_gui(self):
        with contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(bound.main(['--self-test']), 2)
            self.assertEqual(issuer.cli(['--init', '--target', str(self.target),
                                        '--password', 'temporary-password']), 0)
            self.assertEqual(issuer.cli(['--sign', '--target', str(self.target), '--org', 'Test',
                                        '--permanent', '--password', 'temporary-password']), 0)
        with contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(bound.main(['--sign', '--target', str(self.target), '--org', 'Test',
                                         '--permanent', '--password', 'temporary-password']), 2)

    def test_bound_entry_rejects_wrong_disk_before_gui(self):
        self.initialize(disk=True)
        with patch.object(issuer, 'get_volume_serial', return_value='12345678'), \
                patch.object(issuer, 'run_gui') as gui, contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(bound.main([]), 2)
            gui.assert_not_called()

    def test_explicit_bound_setup_can_reuse_existing_keys_without_overwrite(self):
        self.initialize()
        original = issuer.private_key_path().read_bytes()
        self.initialize(disk=True)
        self.assertTrue(bound.verify_disk())
        self.assertEqual(original, issuer.private_key_path().read_bytes())
        self.issue(bound_mode=True)
        with self.assertRaises(FileExistsError):
            self.initialize(disk=True)


if __name__ == '__main__':
    unittest.main()
