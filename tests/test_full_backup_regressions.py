import builtins
import hashlib
import io
import json
import marshal
import os
import secrets
import sqlite3
import tempfile
import types
import unittest
import zipfile
from contextlib import closing
from datetime import date, datetime
from pathlib import Path
from unittest.mock import Mock, patch

from PyInstaller.archive.readers import CArchiveReader
from src.backend_patches.app_replacements import create_full_backup
from tools import build_candidate
from tools.compile_module_patches import _named_code_objects, _pyz_entry, _read_pyz


class IconLockRetryTests(unittest.TestCase):
    def test_overlay_append_eacces_retries_whole_icon_update_once(self):
        from PyInstaller.archive.readers import ArchiveReadError
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'candidate.exe'
            icon = Path(folder) / 'candidate.ico'
            overlay = b'COOKIE_ARCHIVE_OVERLAY'
            original = b'ORIGPE00' + overlay
            target.write_bytes(original)
            icon.write_bytes(b'icon')
            before_updates = []
            append_attempts = []
            original_open = Path.open
            def reader(path):
                if not target.read_bytes().endswith(overlay):
                    raise ArchiveReadError('No PyInstaller cookie')
                return Mock(_start_offset=8)
            def update(path, icons):
                before_updates.append(target.read_bytes())
                target.write_bytes(b'UPDATED-PE-HEADER')
            def locked_open(path, mode='r', *args, **kwargs):
                if path == target and mode == 'ab':
                    append_attempts.append(mode)
                    if len(append_attempts) == 1:
                        raise PermissionError(13, 'Permission denied', str(path))
                return original_open(path, mode, *args, **kwargs)
            with patch('PyInstaller.utils.win32.icon.CopyIcons_FromIco', side_effect=update), \
                    patch.object(build_candidate, 'CArchiveReader', side_effect=reader), \
                    patch.object(build_candidate.time, 'sleep') as sleep, \
                    patch.object(Path, 'open', new=locked_open):
                build_candidate.copy_windows_icon(target, icon)
            self.assertEqual(before_updates, [original, original])
            self.assertEqual(len(append_attempts), 2)
            self.assertEqual(sleep.call_count, 1)
            self.assertEqual(target.read_bytes(), b'UPDATED-PE-HEADER' + overlay)
            self.assertEqual(target.read_bytes().count(overlay), 1)

    def test_errno_access_denied_retries_only_on_windows(self):
        error = PermissionError(13, 'Permission denied')
        with patch.object(build_candidate.os, 'name', 'nt'):
            self.assertTrue(build_candidate._transient_windows_file_error(error))
        with patch.object(build_candidate.os, 'name', 'posix'):
            self.assertFalse(build_candidate._transient_windows_file_error(error))

    def run_icon(self, failures):
        with tempfile.TemporaryDirectory() as folder:
            target = Path(folder) / 'candidate.exe'
            icon = Path(folder) / 'candidate.ico'
            original = b'isolated-original-executable-overlay'
            target.write_bytes(original)
            icon.write_bytes(b'isolated-icon')
            attempts = []
            def update(path, icons):
                attempts.append(Path(path).read_bytes())
                if len(attempts) <= failures:
                    Path(path).write_bytes(b'partial resource update')
                    error = PermissionError('EndUpdateResourceW access denied')
                    error.winerror = 5
                    raise error
            with patch('PyInstaller.utils.win32.icon.CopyIcons_FromIco', side_effect=update), \
                    patch.object(build_candidate, 'CArchiveReader', return_value=Mock(_start_offset=8)), \
                    patch.object(build_candidate.time, 'sleep') as sleep:
                if failures >= 6:
                    with self.assertRaises(PermissionError):
                        build_candidate.copy_windows_icon(target, icon)
                else:
                    build_candidate.copy_windows_icon(target, icon)
                    self.assertEqual(target.read_bytes(), original)
            self.assertTrue(all(value == original for value in attempts))
            self.assertEqual(len(attempts), min(failures + 1, 6))
            self.assertEqual(sleep.call_count, min(failures, 5))

    def test_transient_access_denied_restores_candidate_before_retry(self):
        self.run_icon(1)

    def test_permanent_access_denied_is_bounded_and_propagates(self):
        self.run_icon(6)


@unittest.skipUnless(os.environ.get('PM_SOURCE_EXE') and os.environ.get('PM_SOURCE_EXE_SHA256'),
                     'requires explicit hash-pinned source runtime')
class FrozenBackupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        path = Path(os.environ['PM_SOURCE_EXE'])
        cls.source = path
        if hashlib.sha256(path.read_bytes()).hexdigest() != os.environ['PM_SOURCE_EXE_SHA256'].lower():
            raise RuntimeError('backup fixture source hash mismatch')
        raw = CArchiveReader(str(path)).extract('PYZ.pyz')
        toc, _ = _read_pyz(raw)
        app = marshal.loads(_pyz_entry(raw, toc, 'app'))
        cls.backup_code = _named_code_objects(app, 'create_full_backup')[0]
        cls.security_code = marshal.loads(_pyz_entry(raw, toc, 'data_security'))

    def test_permanent_resource_lock_preserves_previous_candidate_pair(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            candidate = root / 'candidate.exe'
            report = root / 'candidate-integrity.json'
            candidate.write_bytes(b'previous verified candidate')
            report.write_bytes(b'previous verified report')
            error = PermissionError('EndUpdateResourceW access denied')
            error.winerror = 5
            with patch('PyInstaller.utils.win32.icon.CopyIcons_FromIco', side_effect=error) as update, \
                    patch.object(build_candidate.time, 'sleep'):
                with self.assertRaises(PermissionError):
                    build_candidate.build_candidate(candidate, report, source=self.source,
                                                    expected_source_sha256=os.environ['PM_SOURCE_EXE_SHA256'],
                                                    icon_only=True)
            self.assertEqual(update.call_count, 6)
            self.assertEqual(candidate.read_bytes(), b'previous verified candidate')
            self.assertEqual(report.read_bytes(), b'previous verified report')

    def fixture(self, root, encrypted=False):
        class FixedClock(datetime):
            @classmethod
            def now(cls, *args):
                return cls(2026, 10, 8, 12, 0, 0)
        database = root / 'isolated.db'
        backups = root / 'backups'
        uploads = root / 'uploads'
        backups.mkdir()
        uploads.mkdir()
        key = bytes(range(32))
        runtime = {'__builtins__': builtins.__dict__, 'get_backup_dir': lambda: backups,
                   'datetime': FixedClock, 'date': date, 'DATA_ENCRYPTION_ENABLED': encrypted,
                   'DB_PATH': database, 'sqlite3': sqlite3, 'zipfile': zipfile,
                   'UPLOAD_FOLDER': uploads, 'hashlib': hashlib, 'json': json, 'os': os,
                   'save_app_settings': lambda values: None, 'MASTER_KEY': key, 'ATTACHMENT_KEY': key}
        security = {'__builtins__': builtins.__dict__, 'Path': Path, 'secrets': secrets,
                    'os': os, 'FILE_MAGIC': b'PMENC01\x00', 'FILE_HEADER_SIZE': 28, 'FILE_TAG_SIZE': 16}
        if encrypted:
            import sqlcipher3
            from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
            security.update(Cipher=Cipher, algorithms=algorithms, modes=modes)
            for name in ('is_encrypted_file', 'encrypt_file', 'iter_decrypted_file'):
                security[name] = types.FunctionType(_named_code_objects(self.security_code, name)[0], security)
            def connect(path, master_key, readonly=False):
                connection = sqlcipher3.connect(str(path))
                connection.execute('PRAGMA key = "x\'' + master_key.hex() + '\'"')
                return connection
            runtime.update(connect_encrypted=connect, encrypt_file=security['encrypt_file'])
        else:
            connect = lambda path, key, readonly=False: sqlite3.connect(path)
        with closing(connect(database, key)) as connection:
            connection.execute('CREATE TABLE original (id INTEGER PRIMARY KEY, value TEXT)')
            connection.execute("INSERT INTO original VALUES(1, 'preserved')")
            connection.commit()
        attachment = uploads / 'nested' / 'isolated.bin'
        attachment.parent.mkdir()
        attachment.write_bytes(b'isolated attachment bytes')
        if encrypted:
            security['encrypt_file'](attachment, key)
        return types.FunctionType(self.backup_code, runtime), connect, key, security

    def test_same_clock_preserves_distinct_backups_and_retention(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original, connect, key, _ = self.fixture(root)
            first = create_full_backup(original)
            first_bytes = first.read_bytes()
            with closing(connect(root / 'isolated.db', key)) as connection:
                connection.execute("UPDATE original SET value='second'")
                connection.commit()
            second = create_full_backup(original)
            self.assertNotEqual(first, second)
            self.assertEqual(first.read_bytes(), first_bytes)
            with zipfile.ZipFile(first) as archive:
                self.assertEqual(archive.read('uploads/nested/isolated.bin'), b'isolated attachment bytes')
                manifest = json.loads(archive.read('backup_manifest.json'))
                for name, metadata in manifest['files'].items():
                    data = archive.read(name)
                    self.assertEqual(metadata['sha256'], hashlib.sha256(data).hexdigest())
                    self.assertEqual(metadata['size'], len(data))
            create_full_backup(original)
            create_full_backup(original)
            self.assertEqual(len(list((root / 'backups').glob('*.pmbak'))), 3)
            self.assertFalse(list((root / 'backups').glob('.*')))
            self.assertEqual(original.__globals__['datetime'].now().strftime('%Y%m%d_%H%M%S'), '20261008_120000')

    def test_encrypted_archive_database_and_attachment_restore_round_trip(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            original, connect, key, security = self.fixture(root, encrypted=True)
            target = create_full_backup(original)
            self.assertTrue(security['is_encrypted_file'](target))
            payload = b''.join(security['iter_decrypted_file'](target, key, 1024))
            with zipfile.ZipFile(io.BytesIO(payload)) as archive:
                restored_database = root / 'restored.db'
                restored_database.write_bytes(archive.read('bidding.db'))
                with closing(connect(restored_database, key)) as connection:
                    self.assertEqual(connection.execute('SELECT id, value FROM original').fetchall(), [(1, 'preserved')])
                restored_attachment = root / 'restored-attachment.bin'
                restored_attachment.write_bytes(archive.read('uploads/nested/isolated.bin'))
                self.assertEqual(b''.join(security['iter_decrypted_file'](restored_attachment, key, 1024)), b'isolated attachment bytes')


if __name__ == '__main__':
    unittest.main()
