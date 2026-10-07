import marshal
import unittest
from unittest.mock import patch
from types import SimpleNamespace
from tools import build_local_upgrade as upgrade


class LicenseCompatibilityTests(unittest.TestCase):
    def check(self, *, changed_module=None, changed_key=False, changed_status=False):
        app = marshal.dumps(compile('def current_license_status(update_state=True):\n    return verify_license(DATA_DIR, BASE_DIR, update_state=update_state)\n', 'legacy.py', 'exec'))
        other = marshal.dumps(compile('def current_license_status(update_state=True):\n    return {"mode": "full"}\n', 'modified.py', 'exec'))
        original = SimpleNamespace(toc={'static\\license_public_key.pem':None}, extract=lambda name: b'original' if name=='PYZ.pyz' else b'old-public-key')
        candidate = SimpleNamespace(toc={'static\\license_public_key.pem':None}, extract=lambda name: b'candidate' if name=='PYZ.pyz' else (b'new-public-key' if changed_key else b'old-public-key'))
        def entry(raw, toc, name):
            if name=='app':return other if raw==b'candidate' and changed_status else app
            return b'changed' if raw==b'candidate' and name==changed_module else name.encode()
        with patch.object(upgrade,'CArchiveReader',side_effect=[original,candidate]), \
                patch.object(upgrade,'_read_pyz',return_value=(None,None)), \
                patch.object(upgrade,'_pyz_entry',side_effect=entry):
            return upgrade.verify_license_compatibility('old.exe','new.exe')

    def test_preserved_protocol_and_public_key_pass(self):
        self.assertTrue(self.check()['license_status_function_unchanged'])

    def test_changed_key_or_protected_module_is_rejected(self):
        for options in ({'changed_key':True},{'changed_module':'licensing'},{'changed_module':'data_security'}):
            with self.subTest(options=options), self.assertRaises(ValueError):self.check(**options)

    def test_changed_status_function_cannot_bypass_original_verification(self):
        with self.assertRaises(ValueError):self.check(changed_status=True)
