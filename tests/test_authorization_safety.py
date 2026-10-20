"""Regression checks use only disposable signing keys and directories."""
import contextlib
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from datetime import date, timedelta
from unittest.mock import patch
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

repo = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(repo / 'authorization' if (repo / 'authorization').is_dir() else repo))
import license_issuer as issuer
PUBLIC = hasattr(issuer, 'initialize_keys')

class SafetyTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.target = self.base / 'app'
        self.target.mkdir()
        (self.base/'keys').mkdir()
        self.key = Ed25519PrivateKey.generate()
        self.fp = {'machine_hash': 'a'*64, 'device_code': 'PM-FICTIONAL'}
        self.stack = contextlib.ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.dict(os.environ, PROCUREMENT_ISSUER_HOME=str(self.base/'keys'), LICENSE_REDUCED_MOTION='1'))
        self.stack.enter_context(patch.object(issuer, 'program_dir', return_value=self.base))
        self.stack.enter_context(patch.object(issuer, 'machine_fingerprint', return_value=self.fp))
        self.stack.enter_context(patch.object(issuer, 'load_private_key', return_value=self.key))
        self.stack.enter_context(patch.object(issuer, 'self_check', return_value=(True, 'test key')))

    def issue(self, **kwargs):
        return issuer.issue(target_dir=self.target, organization=kwargs.pop('organization','Fictional'),
                            expires=kwargs.pop('expires',None), password='dummy-password', **kwargs)

    def test_signature_failure_preserves_existing_license(self):
        output=self.target/'license.dat';output.write_bytes(b'old-license')
        with patch.object(issuer,'self_check',return_value=(False,'wrong signing key')):
            with self.assertRaises(ValueError):self.issue()
        self.assertEqual(output.read_bytes(),b'old-license')

    def test_nonhex_hash_is_rejected_before_write(self):
        with self.assertRaises(ValueError):self.issue(machine_hash='z'*64)
        self.assertFalse((self.target/'license.dat').exists())

    def test_blank_organization_is_rejected_before_write(self):
        with self.assertRaises(ValueError):self.issue(organization='  ')
        self.assertFalse((self.target/'license.dat').exists())

    def test_past_expiry_is_rejected_before_write(self):
        with self.assertRaises(ValueError):self.issue(expires=date.today()-timedelta(days=1))
        self.assertFalse((self.target/'license.dat').exists())

    def test_remote_sign_does_not_probe_local_device(self):
        with patch.object(issuer,'machine_fingerprint',side_effect=AssertionError('unnecessary local probe')):
            document,_=self.issue(machine_hash='b'*64)
        self.assertEqual(document['payload']['machine_hash'],'b'*64)

    def test_record_failure_exposes_already_committed_result(self):
        with patch.object(issuer,'append_record',side_effect=PermissionError('CSV denied')):
            with self.assertRaises(issuer.RecordWriteError) as caught:self.issue()
        self.assertTrue(caught.exception.output.is_file())
        self.assertEqual(caught.exception.document['payload']['organization'],'Fictional')

    def test_retry_record_never_reissues_license(self):
        document,output=self.issue()
        before=output.read_bytes()
        with patch.object(issuer,'write_license',side_effect=AssertionError('do not reissue')):
            issuer.retry_record(document,output,'Fictional')
        self.assertEqual(before,output.read_bytes())

    def test_retry_record_is_idempotent_for_same_license(self):
        import csv
        document,output=self.issue()
        issuer.retry_record(document,output,'Fictional')
        home=issuer.issuer_home() if PUBLIC else self.base
        with (home/'授权记录.csv').open(encoding='utf-8-sig',newline='') as handle:
            rows=list(csv.reader(handle))
        self.assertEqual(sum(r[0]==document['payload']['license_id'] for r in rows if r),1)

    def test_cli_can_retry_committed_record_without_resigning(self):
        document,output=self.issue();before=output.read_bytes()
        with patch.object(issuer,'issue',side_effect=AssertionError('never resign')),contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(issuer.cli(['--retry-record','--target',str(self.target)]),0)
        self.assertEqual(output.read_bytes(),before)

    def prepare_private_key(self):
        path=self.base/'password.pem'
        path.write_bytes(self.key.private_bytes(serialization.Encoding.PEM,serialization.PrivateFormat.PKCS8,
                                                serialization.BestAvailableEncryption(b'old-password')))
        self.stack.enter_context(patch.object(issuer,'private_key_path',return_value=path))
        return path

    def test_password_replace_failure_preserves_old_private_key(self):
        path=self.prepare_private_key();before=path.read_bytes()
        with patch('license_storage.os.replace',side_effect=PermissionError('locked')):
            with self.assertRaises(PermissionError):issuer.change_private_key_password('old-password','new-password')
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(list(self.base.glob('.issuer-key-*')),[])

    def test_password_change_retains_public_key_and_uses_new_password(self):
        path=self.prepare_private_key()
        issuer.change_private_key_password('old-password','new-password')
        key=serialization.load_pem_private_key(path.read_bytes(),password=b'new-password')
        with self.assertRaises(ValueError):serialization.load_pem_private_key(path.read_bytes(),password=b'old-password')
        self.assertEqual(key.public_key().public_bytes_raw(),self.key.public_key().public_bytes_raw())

    def test_partial_temporary_key_write_preserves_original(self):
        import license_storage
        path=self.prepare_private_key();before=path.read_bytes()
        original=os.fdopen
        class Interrupted:
            def __init__(self, descriptor, mode):self.file=original(descriptor,mode)
            def __enter__(self):return self
            def __exit__(self,*args):self.file.close()
            def write(self,data):
                self.file.write(data[:24])
                raise OSError('interrupted temporary write')
        with patch.object(license_storage.os,'fdopen',side_effect=Interrupted):
            with self.assertRaises(OSError):issuer.change_private_key_password('old-password','new-password')
        self.assertEqual(path.read_bytes(),before)
        self.assertEqual(list(self.base.glob('.issuer-key-*')),[])

    def test_failed_new_key_validation_preserves_original(self):
        path=self.prepare_private_key();before=path.read_bytes()
        with patch('license_storage.serialization.load_pem_private_key',side_effect=ValueError('readback mismatch')):
            with self.assertRaises(ValueError):issuer.change_private_key_password('old-password','new-password')
        self.assertEqual(path.read_bytes(),before)

    def test_conflicting_cli_expiry_options_are_rejected(self):
        with patch.object(issuer,'issue') as sign,contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                issuer.cli(['--sign','--target',str(self.target),'--org','Fictional','--permanent','--days','30','--password','dummy'])
        sign.assert_not_called()

    def test_cli_validation_error_exits_without_a_tk_dialog(self):
        with patch.object(issuer,'cli',side_effect=ValueError('signature validation failed')), \
             patch('tkinter.Tk') as create_window,contextlib.redirect_stderr(io.StringIO()) as error:
            self.assertEqual(issuer.main([]),2)
        create_window.assert_not_called()
        self.assertIn('signature validation failed',error.getvalue())

    def test_gui_remote_empty_hash_never_reaches_password_or_signing(self):
        import tkinter as tk
        from license_dialogs import Dialogs
        root=tk.Tk();root.withdraw();self.addCleanup(root.destroy)
        ui=issuer.create_window(root,self.fp)
        (self.target/'bidding.db').touch()
        ui.target_var.set(str(self.target));ui.org_var.set('Fictional');ui.set_signing_mode('remote')
        with patch.object(Dialogs,'askstring',return_value=None) as password,patch.object(Dialogs,'showwarning'):
            ui.issue()
        password.assert_not_called()

    @unittest.skipUnless(PUBLIC,'public initialization only')
    def test_resume_initialization_keeps_existing_keys_and_binding(self):
        for bound in (False,True):
            with self.subTest(bound=bound),patch.dict(os.environ,PROCUREMENT_ISSUER_HOME=str(self.base/f'keys-{bound}')), \
                 patch.object(issuer,'get_volume_serial',return_value='ABCDEF12'):
                # Restore the real loader for temporary initialized keys.
                with patch.object(issuer,'export_public_key',side_effect=PermissionError('target denied')):
                    with self.assertRaises(PermissionError):issuer.initialize_keys('dummy-password',self.target,bound_mode=bound)
                before=issuer.private_key_path().read_bytes()
                key=serialization.load_pem_private_key(before,password=b'dummy-password')
                config=issuer.bound_config_path().read_bytes() if bound else None
                with patch.object(issuer,'load_private_key',return_value=key):
                    output=issuer.initialize_keys('dummy-password',self.target,bound_mode=bound,resume=True)
                self.assertTrue(output.is_file());self.assertEqual(before,issuer.private_key_path().read_bytes())
                if bound:self.assertEqual(config,issuer.bound_config_path().read_bytes())
                # Each subcase needs its own export directory.
                output.unlink()

    @unittest.skipUnless(PUBLIC,'public initialization only')
    def test_resume_on_wrong_disk_preserves_configuration_and_keys(self):
        with patch.object(issuer,'get_volume_serial',return_value='ABCDEF12'):
            issuer.initialize_keys('dummy-password',self.target,bound_mode=True)
        before=issuer.private_key_path().read_bytes();config=issuer.bound_config_path().read_bytes()
        with patch.object(issuer,'get_volume_serial',return_value='12345678'):
            with self.assertRaises(PermissionError):issuer.initialize_keys('dummy-password',self.target,bound_mode=True,resume=True)
        self.assertEqual(config,issuer.bound_config_path().read_bytes());self.assertEqual(before,issuer.private_key_path().read_bytes())

    @unittest.skipUnless(PUBLIC,'public initialization only')
    def test_resume_missing_bound_configuration_cannot_create_new_binding(self):
        with patch.object(issuer,'get_volume_serial',return_value='ABCDEF12'):
            issuer.initialize_keys('dummy-password',self.target,bound_mode=True)
            before=issuer.private_key_path().read_bytes()
            key=serialization.load_pem_private_key(before,password=b'dummy-password')
            issuer.bound_config_path().unlink()
            with patch.object(issuer,'load_private_key',return_value=key):
                with self.assertRaises(PermissionError):issuer.initialize_keys('dummy-password',self.target,bound_mode=True,resume=True)
        self.assertFalse(issuer.bound_config_path().exists());self.assertEqual(before,issuer.private_key_path().read_bytes())

if __name__=='__main__':unittest.main()
