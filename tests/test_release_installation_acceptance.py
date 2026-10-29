"""Fail-closed boundaries for the frozen-release acceptance tools."""
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

from tools.verify_authorization_release import release_assets
from tools.verify_installation_release import digest, pinned_asset, restore_snapshot, snapshot, verify


class AcceptanceBoundaryTests(unittest.TestCase):
    def test_installation_hash_mismatch_never_starts_executable_and_writes_failure(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            candidate = root / 'candidate.exe'
            candidate.write_bytes(b'wrong candidate')
            with patch('subprocess.Popen') as process:
                result = verify(candidate, '0' * 64, root, candidate, '0' * 64, root / 'evidence')
            process.assert_not_called()
            self.assertEqual(result['status'], 'failed')
            self.assertEqual(result['passed'], 0)
            self.assertTrue(result['manual_pending'])
            self.assertFalse(result['native_desktop_verified'])
            self.assertEqual(json.loads((root / 'evidence/installation.json').read_text('utf-8'))['status'], 'failed')

    def test_baseline_hash_mismatch_never_starts_executable(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            exe = root / 'candidate.exe'
            exe.write_bytes(b'pinned candidate')
            with patch('subprocess.Popen') as process:
                result = verify(exe, digest(exe), root, exe, '0' * 64, root / 'evidence')
            process.assert_not_called()
            self.assertEqual(result['status'], 'failed')

    def test_public_fixture_requires_exported_public_key(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            exe = root / 'candidate.exe'
            exe.write_bytes(b'pinned candidate')
            (root / 'license.dat').write_bytes(b'synthetic license')
            with patch('subprocess.Popen') as process:
                result = verify(exe, digest(exe), root, exe, digest(exe), root / 'evidence')
            process.assert_not_called()
            self.assertEqual(result['status'], 'failed')
            self.assertIn('license_public_key.pem', result['error'])

    def test_manifest_pins_both_exact_issuer_assets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            expected = {}
            for name in ('license-issuer.exe', 'license-bound.exe'):
                (root / name).write_bytes(name.encode())
                expected[name] = digest(root / name)
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'assets': expected}), 'utf-8')
            self.assertTrue(all(row['manifest_verified'] for row in release_assets(root, manifest).values()))
            (root / 'license-bound.exe').write_bytes(b'other revision')
            with self.assertRaisesRegex(ValueError, 'license-bound.exe'):
                release_assets(root, manifest)

    def test_public_asset_mapping_uses_only_hash_verified_file(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            rows = []
            for name in ('license-issuer.exe', 'license-bound.exe'):
                public = root / ('public-' + name)
                public.write_bytes(name.encode())
                rows.append({'github_name': name, 'local_name': public.name,
                             'local_path': str(public), 'sha256': digest(public)})
            manifest = root / 'mapping.json'
            manifest.write_text(json.dumps(rows), 'utf-8')
            actual = release_assets(root, manifest)
            self.assertEqual(actual['license-issuer.exe']['path'], str(root / 'public-license-issuer.exe'))
            # A same-named, wrong executable cannot bypass the public mapping hash.
            (root / 'license-issuer.exe').write_bytes(b'private-compatible tool')
            with self.assertRaises(ValueError):
                release_assets(root, manifest)

    def test_snapshot_restores_database_keys_and_files_with_exact_hashes(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original = root / 'original'
            original.mkdir()
            for name in ('bidding.db', '.synthetic-key', 'license.dat'):
                (original / name).write_bytes(name.encode())
            archive = root / 'backup.zip'
            hashes = snapshot(original, archive)
            restored = root / 'restored'
            restored.mkdir()
            restore_snapshot(archive, restored, hashes)
            self.assertEqual(hashes, {name: digest(restored / name) for name in hashes})

    def test_restore_rejects_archive_path_traversal(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / 'bad.zip'
            with zipfile.ZipFile(archive, 'w') as output:
                output.writestr('../outside.txt', b'escape')
            restored = root / 'restored'
            restored.mkdir()
            with self.assertRaisesRegex(ValueError, 'escapes'):
                restore_snapshot(archive, restored, {'../outside.txt': hashlib.sha256(b'escape').hexdigest()})
            self.assertFalse((root / 'outside.txt').exists())

    def test_restore_rejects_modified_backup_content(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            archive = root / 'tampered.zip'
            with zipfile.ZipFile(archive, 'w') as output:
                output.writestr('bidding.db', b'modified')
            restored = root / 'restored'
            restored.mkdir()
            with self.assertRaisesRegex(ValueError, 'hash mismatch'):
                restore_snapshot(archive, restored, {'bidding.db': '0' * 64})


if __name__ == '__main__':
    unittest.main()
