"""Folder actions use disposable paths, hidden Tk and a mocked OS opener only."""
import contextlib
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import tkinter as tk
import unittest
from unittest.mock import patch

repo = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo / 'authorization' if (repo / 'authorization').is_dir() else repo))
import license_issuer as issuer
from license_dialogs import Dialog, Dialogs
import license_theme as theme
PUBLIC = hasattr(issuer, 'initialize_keys')


class FolderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='issuer-folder-')
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.folder = self.base / '中文 空格 & [目录] # %'
        self.folder.mkdir()
        self.output = self.folder / 'license_public_key.pem'
        self.output.write_bytes(b'own-test-fixture')
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.opened = self.stack.enter_context(patch('os.startfile', create=True))
        self.root = tk.Tk()
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        theme.apply(self.root)

    def folders(self):
        self.assertIsNotNone(importlib.util.find_spec('license_folders'),
                             '保存位置尚未提供可操作的目录控件')
        import license_folders
        return license_folders

    def location(self, folder=None, **options):
        return self.folders().FolderLocation(self.root, folder or self.folder, **options)

    def test_chinese_special_path_is_passed_to_os_as_directory_without_shell(self):
        self.folders().open_folder(self.folder)
        self.opened.assert_called_once_with(str(self.folder.resolve()), 'open')
        self.assertEqual(self.output.read_bytes(), b'own-test-fixture')

    def test_file_path_cannot_be_opened_as_a_folder(self):
        with self.assertRaisesRegex(ValueError, '目录'):
            self.folders().open_folder(self.output)
        self.opened.assert_not_called()

    def test_missing_folder_has_clear_error_without_creating_it(self):
        missing = self.folder / '已删除'
        errors = []
        location = self.location(missing, on_error=errors.append)
        self.assertFalse(location.open())
        self.assertIn('不存在', errors[0])
        self.assertFalse(missing.exists())
        self.opened.assert_not_called()

    def test_permission_denied_is_reported_and_never_opens_pem(self):
        errors = []
        location = self.location(on_error=errors.append)
        with patch('os.scandir', side_effect=PermissionError('denied')):
            self.assertFalse(location.open())
        self.assertIn('权限', errors[0])
        self.opened.assert_not_called()
        self.assertEqual(self.output.read_bytes(), b'own-test-fixture')

    def test_os_failure_is_reported_with_original_path(self):
        errors = []
        location = self.location(on_error=errors.append)
        self.opened.side_effect = OSError('Explorer unavailable')
        self.assertFalse(location.open())
        self.assertIn('打开失败', errors[0])
        self.assertIn(str(self.folder), errors[0])

    def test_missing_explorer_is_reported_as_open_failure_for_existing_folder(self):
        errors = []
        location = self.location(on_error=errors.append)
        self.opened.side_effect = FileNotFoundError('Explorer unavailable')
        self.assertFalse(location.open())
        self.assertTrue(self.folder.is_dir())
        self.assertIn('打开失败', errors[0])
        self.assertIn('资源管理器', errors[0])
        self.assertNotIn('文件夹不存在', errors[0])
        self.assertEqual(self.output.read_bytes(), b'own-test-fixture')

    def test_path_button_click_opens_only_its_saved_folder(self):
        location = self.location(text=str(self.output))
        self.assertTrue(str(location.button.cget('takefocus')) in ('1', 'true'))
        self.assertEqual(location.button.cget('text'), str(self.output))
        location.button.invoke()
        self.opened.assert_called_once_with(str(self.folder.resolve()), 'open')

    def test_return_and_space_bindings_open_folder_and_stop_dialog_accept(self):
        location = self.location()
        # Dispatch the widget's actual registered Tcl key callback directly:
        # hidden windows intentionally never receive desktop keyboard focus.
        for sequence in ('<Return>', '<space>'):
            with self.subTest(sequence=sequence):
                binding = location.button.bind(sequence)
                self.assertTrue(binding, '路径控件缺少键盘操作')
                command = binding.split('[', 1)[1].split(' ', 1)[0]
                self.assertEqual(self.root.tk.call(command), 'break')
        self.assertEqual(self.opened.call_count, 2)

    def test_long_path_style_wraps_and_retains_focus_state(self):
        location = self.location(text=str(self.output) * 10)
        from tkinter import ttk
        style = ttk.Style(self.root)
        self.assertGreater(int(style.lookup(location.button.cget('style'), 'wraplength')), 0)
        self.assertTrue(style.lookup(location.button.cget('style'), 'bordercolor', ('focus',)))

    def test_result_dialog_path_opens_parent_and_stays_open(self):
        self.assertIn('saved_file', __import__('inspect').signature(Dialog).parameters,
                      '导出成功弹窗尚未支持保存位置操作')
        dialog = Dialog(self.root, '公钥已导出', '加密私钥保留在签发端。', saved_file=self.output)
        self.addCleanup(dialog.cancel)
        dialog.folder_location.button.invoke()
        self.opened.assert_called_once_with(str(self.folder.resolve()), 'open')
        self.assertFalse(dialog._closed)
        self.assertEqual(dialog.window.state(), 'withdrawn')

    def test_result_dialog_keeps_output_snapshot_when_path_object_changes(self):
        self.assertIn('saved_file', __import__('inspect').signature(Dialog).parameters)
        dialog = Dialog(self.root, '公钥已导出', '已保存。', saved_file=self.output)
        self.addCleanup(dialog.cancel)
        old = self.output
        self.output = self.base / 'another' / 'license_public_key.pem'
        dialog.folder_location.button.invoke()
        self.opened.assert_called_once_with(str(old.parent.resolve()), 'open')


class KeyPageTests(unittest.TestCase):
    def setUp(self):
        FolderTests.setUp(self)
        self.stack.enter_context(patch.object(issuer, 'program_dir', return_value=self.base))
        self.stack.enter_context(patch.dict(os.environ, PROCUREMENT_ISSUER_HOME=str(self.base / 'keys'),
                                            LICENSE_REDUCED_MOTION='1'))
        self.stack.enter_context(patch.object(issuer, 'get_volume_serial', return_value='ABCDEF12'))
        self.stack.enter_context(patch.object(Dialogs, 'showwarning'))
        self.errors = self.stack.enter_context(patch.object(Dialogs, 'showerror'))
        self.infos = self.stack.enter_context(patch.object(Dialogs, 'showinfo'))

    def ui(self, bound=False):
        if PUBLIC:
            return issuer.create_window(self.root, {'machine_hash': 'a' * 64, 'device_code': 'PM-TEST'}, bound_mode=bound)
        with patch.object(issuer, 'BOUND_MODE', bound):
            return issuer.create_window(self.root, {'machine_hash': 'a' * 64, 'device_code': 'PM-TEST'})

    def test_free_and_bound_key_pages_open_saved_key_parent_without_loading_keys(self):
        key = issuer.private_key_path()
        key.parent.mkdir(exist_ok=True)
        key.write_bytes(b'own-test-no-real-private-key')
        for bound in (False, True):
            with self.subTest(bound=bound):
                ui = self.ui(bound)
                location = getattr(ui, 'key_location', None)
                self.assertIsNotNone(location, '密钥保存位置仍为不可操作文本')
                with patch.object(issuer, 'load_private_key', side_effect=AssertionError('must not load a key')):
                    location.button.invoke()
                self.opened.assert_called_with(str(key.parent.resolve()), 'open')
                self.assertEqual(key.read_bytes(), b'own-test-no-real-private-key')
                ui.tasks.close()
                for child in self.root.winfo_children():
                    child.destroy()

    @unittest.skipUnless(PUBLIC, 'public export workflow only')
    def test_cancel_and_export_failure_leave_keys_and_no_success_location(self):
        ui = self.ui()
        ui.target_var.set(str(self.folder))
        with patch.object(Dialogs, 'askstring', return_value=None):
            ui.initialize()
        self.assertFalse(issuer.private_key_path().exists())
        self.infos.assert_not_called()
        ui.target_var.set(str(self.base))
        with patch.object(Dialogs, 'askstring', return_value='own-test-password'), \
             patch.object(issuer, 'export_public_key', side_effect=PermissionError('target denied')):
            ui.initialize()
            self.drain(ui)
        self.assertTrue(issuer.private_key_path().is_file())
        before = issuer.private_key_path().read_bytes()
        self.assertEqual(self.output.read_bytes(), b'own-test-fixture')
        self.infos.assert_not_called()
        self.errors.assert_called_once()
        self.assertEqual(issuer.private_key_path().read_bytes(), before)
        self.opened.assert_not_called()

    @unittest.skipUnless(PUBLIC, 'public export workflow only')
    def test_success_uses_actual_output_parent_even_after_target_changes(self):
        self.output.unlink()
        ui = self.ui()
        ui.target_var.set(str(self.folder))
        with patch.object(Dialogs, 'askstring', return_value='own-test-password'):
            ui.initialize()
            self.drain(ui)
        kwargs = self.infos.call_args.kwargs
        self.assertEqual(kwargs.get('saved_file'), self.output,
                         '成功结果没有绑定本次实际导出文件')
        key_before = issuer.private_key_path().read_bytes()
        ui.target_var.set(str(self.base))
        # Use the real result dialog, with presentation still hidden.
        dialog = Dialog(self.root, '初始化成功', '公钥已保存。', **kwargs)
        self.addCleanup(dialog.cancel)
        dialog.folder_location.button.invoke()
        self.opened.assert_called_once_with(str(self.folder.resolve()), 'open')
        self.assertEqual(issuer.private_key_path().read_bytes(), key_before)

    @unittest.skipUnless(PUBLIC, 'public export workflow only')
    def test_resume_keeps_keys_and_binding_and_reports_actual_file(self):
        self.output.unlink()
        ui = self.ui(True)
        ui.target_var.set(str(self.folder))
        with patch.object(Dialogs, 'askyesno', return_value=True), \
             patch.object(Dialogs, 'askstring', return_value='own-test-password'):
            ui.initialize()
            self.drain(ui)
            key = issuer.private_key_path().read_bytes()
            config = issuer.bound_config_path().read_bytes()
            ui.target_var.set(str(self.base))
            ui.initialize(resume=True)
            self.drain(ui)
        self.assertEqual(self.infos.call_args.kwargs.get('saved_file'), self.base / self.output.name)
        self.assertEqual(issuer.private_key_path().read_bytes(), key)
        self.assertEqual(issuer.bound_config_path().read_bytes(), config)
        self.opened.assert_not_called()

    def drain(self, ui):
        deadline = time.monotonic() + 10
        while ui.tasks.busy and time.monotonic() < deadline:
            self.root.update()
            time.sleep(.005)
        self.root.update()
        self.assertFalse(ui.tasks.busy)


if __name__ == '__main__':
    unittest.main()

