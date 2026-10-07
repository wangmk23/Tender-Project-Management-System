"""Exercise issuer callbacks without displaying a desktop window."""
import sys
import tempfile
import tkinter as tk
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'authorization'))
import license_issuer as issuer


class AuthorizationUiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.root = tk.Tk()
        self.root.withdraw()
        self.addCleanup(self.root.destroy)
        for name in ('showinfo', 'showerror', 'showwarning'):
            dialog = patch('tkinter.messagebox.' + name)
            dialog.start()
            self.addCleanup(dialog.stop)
        with patch.dict('os.environ', PROCUREMENT_ISSUER_HOME=str(self.directory / 'keys')):
            self.ui = issuer.create_window(self.root, {'device_code': 'PM-TEST', 'machine_hash': 'a' * 64})

    def test_navigation_keeps_form_values_and_single_active_page(self):
        self.ui.target_var.set(str(self.directory))
        self.ui.org_var.set('Test unit')
        self.ui.notes.insert('1.0','Keep notes')
        self.ui.switch_page('devices')
        self.assertEqual(self.ui.active_page,'devices')
        self.ui.switch_page('keys')
        self.ui.switch_page('issue')
        self.assertEqual(self.ui.org_var.get(),'Test unit')
        self.assertEqual(self.ui.notes.get('1.0','end').strip(),'Keep notes')
        self.assertEqual([key for key,page in self.ui.pages.items() if page.winfo_manager()],['issue'])

    def test_returning_to_local_signing_clears_hidden_remote_target(self):
        self.ui.set_signing_mode('remote')
        self.ui.remote_var.set('b'*64)
        self.ui.set_signing_mode('local')
        self.assertEqual(self.ui.target_mode.get(),'local')
        self.assertEqual(self.ui.remote_var.get(),'')
        self.assertEqual(self.ui.remote_fields.winfo_manager(),'')

    def test_custom_date_is_only_shown_when_needed(self):
        self.assertEqual(self.ui.custom_fields.winfo_manager(),'')
        self.ui.duration_var.set('自定义日期');self.ui._toggle_custom()
        self.assertEqual(self.ui.custom_fields.winfo_manager(),'grid')
        self.ui.duration_var.set('永久');self.ui._toggle_custom()
        self.assertEqual(self.ui.custom_fields.winfo_manager(),'')

    def test_collapsed_notes_preserve_entered_text(self):
        self.assertEqual(self.ui.notes_frame.master.winfo_manager(), '')
        self.ui.toggle_notes()
        self.ui.notes.insert('1.0', 'Retain notes')
        self.ui.toggle_notes()
        self.ui.toggle_notes()
        self.assertEqual(self.ui.notes.get('1.0', 'end').strip(), 'Retain notes')

    def test_copy_uses_inline_feedback(self):
        with patch('tkinter.messagebox.showinfo') as info, \
                patch.object(self.root, 'clipboard_clear') as clear, \
                patch.object(self.root, 'clipboard_append') as append:
            self.ui._copy('PM-TEST')
        clear.assert_called_once_with()
        append.assert_called_once_with('PM-TEST')
        info.assert_not_called()
        self.assertIn('已复制',self.ui.feedback_var.get())

    def test_export_failure_is_reported(self):
        with patch('tkinter.filedialog.asksaveasfilename', return_value=str(self.directory)), patch('tkinter.messagebox.showerror') as error:
            self.ui.export_device_info()
        error.assert_called_once()

    def test_invalid_remote_hash_does_not_prompt_for_password(self):
        (self.directory / 'bidding.db').touch()
        self.ui.target_var.set(str(self.directory))
        self.ui.org_var.set('Test')
        self.ui.remote_var.set('z' * 64)
        with patch('tkinter.simpledialog.askstring', return_value=None) as password, patch('tkinter.messagebox.showwarning') as warning:
            self.ui.issue()
        password.assert_not_called()
        warning.assert_called_once()

    def test_initialize_rejects_nonexistent_directory_before_password(self):
        self.ui.target_var.set(str(self.directory / 'missing'))
        with patch('tkinter.simpledialog.askstring', return_value=None) as password, patch('tkinter.messagebox.showwarning') as warning:
            self.ui.initialize()
        password.assert_not_called()
        warning.assert_called_once()

    def test_custom_expiry_toggle(self):
        self.ui.duration_var.set('自定义日期')
        self.ui._toggle_custom()
        self.assertEqual(str(self.ui.custom_entry.cget('state')), 'normal')
        self.ui.duration_var.set('永久')
        self.ui._toggle_custom()
        self.assertEqual(str(self.ui.custom_entry.cget('state')), 'disabled')
        self.assertIsNone(self.ui._expiry())

    def test_export_cancel_does_not_write(self):
        with patch('tkinter.filedialog.asksaveasfilename', return_value=''), patch.object(Path, 'write_text') as write:
            self.ui.export_device_info()
        write.assert_not_called()

    def test_export_success_preserves_fingerprint(self):
        output = self.directory / 'device.txt'
        with patch('tkinter.filedialog.asksaveasfilename', return_value=str(output)):
            self.ui.export_device_info()
        self.assertIn('PM-TEST', output.read_text('utf-8'))
        self.assertIn('a' * 64, output.read_text('utf-8'))

    def test_issue_valid_remote_reaches_existing_signing_core(self):
        (self.directory / 'bidding.db').touch()
        self.ui.target_var.set(str(self.directory))
        self.ui.org_var.set('Test')
        self.ui.remote_var.set('b' * 64)
        document = {'payload': {'device_code': 'PM-REMOTE', 'expires_at': None}}
        with patch('tkinter.simpledialog.askstring', return_value='temporary-password'), patch.object(issuer, 'issue', return_value=(document, self.directory / 'license.dat')) as sign:
            self.ui.issue()
        self.assertEqual(sign.call_args.kwargs['machine_hash'], 'b' * 64)
        self.assertFalse(sign.call_args.kwargs['bound_mode'])

    def test_icons_are_retained_and_bound_remote_is_hidden(self):
        self.assertEqual(len(self.ui.icons), 8)
        self.assertTrue(all(icon.width() == 20 and icon.height() == 20 for icon in self.ui.icons.values()))
        second = tk.Toplevel(self.root)
        second.withdraw()
        self.addCleanup(second.destroy)
        with patch.dict('os.environ', PROCUREMENT_ISSUER_HOME=str(self.directory / 'keys')):
            ui = issuer.create_window(second, {'device_code': 'PM-TEST', 'machine_hash': 'a' * 64}, bound_mode=True)
        def find_entry(widget):
            for child in widget.winfo_children():
                if child.winfo_class() == 'TEntry' and str(child.cget('textvariable')) == str(ui.remote_var):
                    return child
                found = find_entry(child)
                if found is not None:
                    return found
        self.assertEqual(find_entry(second).master.winfo_manager(), '')


if __name__ == '__main__':
    unittest.main()
