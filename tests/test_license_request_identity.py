import types
import unittest
from src.backend_patches import http_security

class IdentityTests(unittest.TestCase):
    def test_native_uuid_parses_smbios_and_rejects_truncated_data(self):
        import uuid
        value=uuid.UUID('00112233-4455-6677-8899-aabbccddeeff')
        record=bytes([1,25,0,0,0,0,0,0])+value.bytes_le+b'\x00'+b'\x00\x00'
        raw=bytes([0,3,2,0])+len(record).to_bytes(4,'little')+record
        self.assertEqual(http_security.smbios_system_uuid(raw),str(value).upper())
        for bad in (b'',raw[:12],raw[:8]+bytes([1,255])+raw[10:]):
            self.assertIsNone(http_security.smbios_system_uuid(bad))

    def fixture(self):
        namespace={'uuid_value':'HOST-A','disk_value':'DISK-A','checks':0}
        exec("def _system_uuid(): return uuid_value\ndef machine_fingerprint(): return (_system_uuid(), disk_value)\ndef verify_license(*a, **kw):\n global checks\n checks+=1\n return machine_fingerprint(), checks",namespace)
        return namespace

    def test_native_path_keeps_live_disk_and_license_checks_and_leaves_original_untouched(self):
        ns=self.fixture();native={'uuid':'HOST-A'}
        fast=http_security.prepare_license_verifier(ns['verify_license'],reader=lambda:native['uuid'])
        self.assertEqual(fast()[0],('HOST-A','DISK-A'))
        native['uuid']='HOST-B';ns['disk_value']='DISK-B'
        # Cloned globals retain functions which read current host state. A changing UUID
        # never reuses a previous authorization result.
        self.assertEqual(fast()[0],('HOST-B','DISK-B'))
        self.assertEqual(ns['_system_uuid'](),'HOST-A')

    def test_native_failure_during_requests_falls_back_without_reusing_authorization(self):
        ns=self.fixture();values=iter(['HOST-A',None,'HOST-B'])
        fast=http_security.prepare_license_verifier(ns['verify_license'],reader=lambda:next(values))
        self.assertEqual(fast()[0],('HOST-A','DISK-A'))
        self.assertEqual(fast()[0],('HOST-B','DISK-A'))

    def test_unavailable_or_mismatched_native_identity_keeps_preserved_verifier(self):
        ns=self.fixture()
        for value in (None,'DIFFERENT'):
            self.assertIs(http_security.prepare_license_verifier(ns['verify_license'],reader=lambda:value),ns['verify_license'])

    def test_optional_acceleration_tolerates_runtime_without_verifier(self):
        runtime=types.SimpleNamespace(app=types.SimpleNamespace(extensions={}))
        self.assertFalse(http_security.install_live_license_identity(runtime))
        self.assertEqual(runtime.app.extensions,{})
