import tempfile
import unittest
from pathlib import Path
from unittest import mock
from src.backend_patches import app_replacements

class ExportDirectoryTests(unittest.TestCase):
    def test_frozen_default_uses_executable_directory_and_custom_path_wins(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with mock.patch.multiple(app_replacements, load_app_settings=lambda: {}, create=True), mock.patch('sys.frozen', True, create=True), mock.patch('sys.executable', str(root / 'app.exe')):
                self.assertEqual(app_replacements.get_export_dir(), root / 'exports')
                with mock.patch.object(app_replacements, 'load_app_settings', return_value={'export_folder':str(root/'custom')}):
                    self.assertEqual(app_replacements.get_export_dir(),root/'custom')

    def test_stale_directory_cannot_break_settings_even_if_default_unwritable(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            with mock.patch.multiple(app_replacements, load_app_settings=lambda: {'export_folder':str(root/'old-account'/'exports')}, create=True), mock.patch('sys.frozen',True,create=True), mock.patch('sys.executable',str(root/'app.exe')):
                with mock.patch.object(Path,'mkdir',side_effect=PermissionError('denied')):
                    self.assertEqual(app_replacements.get_export_dir(),root/'exports')
