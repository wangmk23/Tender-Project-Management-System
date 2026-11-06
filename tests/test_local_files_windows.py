import os
import tempfile
import unittest
from pathlib import Path
from src.backend_patches.local_files_windows import DirectoryIdentity, validate_name

class IdentityTests(unittest.TestCase):
    @unittest.skipUnless(os.name == 'nt', 'Windows native relative directory operations')
    def test_create_returns_pinned_directory_and_enumerates_same_object(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            provider = DirectoryIdentity()
            identity = provider.identify(root)
            with provider.pin_directory(root, root=root, identity=identity) as handle:
                with provider.create_child_directory(handle, root, '新项目') as child_handle:
                    child = root/'新项目'
                    with self.assertRaises(OSError):
                        child.rename(root/'被替换')
                    with provider.create_child_directory(child_handle, child, '评审'):
                        (child/'原资料.txt').write_bytes(b'owned')
                    rows = {item[0]: item for item in provider.read_pinned_directory(child_handle)}
                    self.assertEqual(rows['原资料.txt'][1:3], ('file', 5))
                    self.assertEqual(rows['评审'][1], 'directory')
            child.rename(root/'已归档')

    @unittest.skipUnless(os.name == 'nt', 'Windows mapped drive check')
    def test_network_drive_is_rejected_even_with_a_drive_letter(self):
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as temporary:
            with patch('src.backend_patches.local_files_windows.windows_drive_type', return_value=4):
                with self.assertRaises(ValueError):
                    DirectoryIdentity().identify(temporary)

    @unittest.skipUnless(os.name == 'nt', 'Windows directory handle sharing')
    def test_pinned_path_cannot_be_swapped_during_file_admission(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / '资料'
            root.mkdir()
            child = root/'评审'
            child.mkdir()
            provider = DirectoryIdentity()
            identity = provider.identify(root)
            with provider.pin_directory(child, root=root, identity=identity):
                with self.assertRaises(OSError):
                    root.rename(root.with_name('被替换'))
                with self.assertRaises(OSError):
                    child.rename(root/'被替换')
            root.rename(root.with_name('已归档'))
    @unittest.skipUnless(os.name == 'nt', 'Windows persistent directory identity')
    def test_saved_identity_recovers_after_move_and_provider_restart(self):
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); old=root/'中文'; old.mkdir()
            provider=DirectoryIdentity(); identity=provider.identify(old)
            parent=root/'archive'; parent.mkdir(); new=parent/'renamed'; old.rename(new)
            self.assertEqual(Path(DirectoryIdentity().resolve(str(old),identity)[0]),new)
            old.mkdir()
            self.assertEqual(DirectoryIdentity().resolve(str(old),identity)[1],'replaced')
    def test_names_reject_windows_unsafe_paths(self):
        for name in ('..','a/b','a\\b','CON','a.','a ','C:foo','','NUL.txt'):
            with self.subTest(name=name), self.assertRaises(ValueError): validate_name(name)
    def test_root_junction_is_rejected(self):
        import subprocess
        if os.name!='nt': self.skipTest('Windows junction test')
        with tempfile.TemporaryDirectory() as t:
            root=Path(t); target=root/'target'; target.mkdir(); link=root/'link'
            result=subprocess.run(['cmd','/c','mklink','/J',str(link),str(target)],capture_output=True)
            self.assertEqual(result.returncode,0)
            try:
                with self.assertRaises(ValueError): DirectoryIdentity().identify(link)
            finally: os.rmdir(link)
