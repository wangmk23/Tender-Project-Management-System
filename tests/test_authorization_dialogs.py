"""Hidden Tk modal checks: no display, device probes, keys, or business data."""
import sys
import tkinter as tk
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'authorization'))
import license_theme as theme
from license_dialogs import Dialog, Dialogs


class DialogTests(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.withdraw()
        self.addCleanup(lambda: self.root.destroy() if self.root.winfo_exists() else None)
        theme.apply(self.root)

    def test_password_is_masked_and_confirm_returns_exact_text(self):
        dialog = Dialog(self.root, '私钥密码', '请输入密码', kind='string', show='*')
        self.assertEqual(dialog.window.state(), 'withdrawn')
        self.assertEqual(dialog.entry.cget('show'), '*')
        dialog.entry.insert(0, '  secret  ')
        dialog.accept()
        self.assertEqual(dialog.result, '  secret  ')

    def test_cancel_close_and_escape_keep_cancel_semantics(self):
        for kind, expected in [('string', None), ('question', False), ('error', 'ok')]:
            dialog = Dialog(self.root, '测试', '正文', kind=kind)
            self.assertTrue(dialog.window.protocol('WM_DELETE_WINDOW'))
            self.assertTrue(dialog.window.bind('<Escape>'))
            dialog.cancel()
            self.assertEqual(dialog.result, expected)

    def test_chinese_buttons_and_long_path_scroll_area(self):
        dialog = Dialog(self.root, '确认', 'E:/长路径/' * 500, kind='question')
        self.assertEqual(dialog.ok_button.cget('text'), '确定')
        self.assertEqual(dialog.cancel_button.cget('text'), '取消')
        self.assertEqual(dialog.message.cget('wrap'), 'char')
        self.assertEqual(dialog.message.cget('state'), 'disabled')
        self.assertIsNotNone(dialog.scrollbar)
        dialog.cancel()

    def test_facade_waits_with_presentation_mocked(self):
        def hidden_present(dialog):
            dialog.window.after_idle(dialog.accept)
        with patch.object(Dialog, 'present', hidden_present):
            facade = Dialogs(self.root)
            self.assertEqual(facade.askstring('密码', '正文', initialvalue='value', show='*'), 'value')
            self.assertTrue(facade.askyesno('确认', '正文'))
            for method in (facade.showinfo, facade.showwarning, facade.showerror):
                self.assertEqual(method('标题', '正文'), 'ok')

    def test_facade_cancel_and_owner_close_unblock_wait(self):
        def hidden_cancel(dialog):
            dialog.window.after_idle(dialog.cancel)
        with patch.object(Dialog, 'present', hidden_cancel):
            self.assertIsNone(Dialogs(self.root).askstring('密码', '正文'))
            self.assertFalse(Dialogs(self.root).askyesno('确认', '正文'))
        owner = tk.Toplevel(self.root)
        owner.withdraw()
        def hidden_owner_close(dialog):
            dialog.window.after_idle(owner.destroy)
        with patch.object(Dialog, 'present', hidden_owner_close):
            self.assertIsNone(Dialogs(owner).askstring('密码', '正文'))

    def test_focus_returns_to_original_control_without_forcing_desktop_focus(self):
        entry = tk.Entry(self.root)
        with patch.object(self.root, 'focus_get', return_value=entry):
            dialog = Dialog(self.root, '密码', '正文', kind='string')
        self.assertTrue(dialog.window.bind('<Return>'))
        with patch.object(entry, 'focus_set') as restore:
            dialog.cancel()
            restore.assert_called_once_with()

    def test_application_call_sites_use_local_facade_and_parent_file_pickers(self):
        import license_issuer
        import inspect
        source = inspect.getsource(license_issuer.create_window)
        self.assertIn('messagebox = simpledialog = Dialogs(root)', source)
        self.assertIn('askdirectory(parent=self.root', source)
        self.assertIn('asksaveasfilename(\n                parent=self.root,', source)
        self.assertNotIn('from tkinter import filedialog, messagebox', source)

    def test_prior_grab_is_restored(self):
        previous = tk.Toplevel(self.root)
        previous.withdraw()
        previous.grab_set()
        dialog = Dialog(self.root, '密码', '正文', kind='string')
        dialog.window.grab_set()
        dialog.cancel()
        self.assertEqual(self.root.grab_current(), previous)
        previous.grab_release()
        previous.destroy()

    def test_parent_destruction_cancels_without_stale_widgets(self):
        owner = tk.Toplevel(self.root)
        owner.withdraw()
        dialog = Dialog(owner, '密码', '正文', kind='string')
        owner.destroy()
        dialog.cancel()
        self.assertIsNone(dialog.result)


if __name__ == '__main__':
    unittest.main()
