"""Backup location changes use owned directories and never open Explorer."""
import json
import builtins
import hashlib
import marshal
import os
import sqlite3
import tempfile
import types
import unittest
import zipfile
from datetime import date, datetime
from contextlib import closing
from pathlib import Path
from unittest.mock import Mock, patch

from flask import Flask
from flask_sqlalchemy import SQLAlchemy

try:
    from src.backend_patches import backup_settings
except ImportError:
    backup_settings = None


class BackupSettingsTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(backup_settings, 'backup settings feature must be implemented')
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = Flask(__name__)
        self.app.config.update(SECRET_KEY='owned-test', TESTING=True, IS_DESKTOP=True,
                               SQLALCHEMY_DATABASE_URI='sqlite://')
        self.db = SQLAlchemy(self.app)
        class User(self.db.Model):
            id = self.db.Column(self.db.Integer, primary_key=True)
            is_admin = self.db.Column(self.db.Boolean, default=False)
            is_active = self.db.Column(self.db.Boolean, default=True)
        self.User = User
        self.context = self.app.app_context()
        self.context.push()
        self.addCleanup(self.context.pop)
        self.db.create_all()
        self.db.session.add_all([User(id=1,is_admin=True), User(id=2)])
        self.db.session.commit()
        self.addCleanup(self.db.session.remove)
        self.original = self.root / 'old backups'
        self.original.mkdir()
        (self.original / 'preserved.pmbak').write_bytes(b'old backup')
        self.settings = {'backup_folder':str(self.original), 'unrelated':'preserved'}
        self.settings_path = self.root / 'settings.json'
        self.settings_path.write_text(json.dumps(self.settings), encoding='utf-8')
        def load():
            return json.loads(self.settings_path.read_text(encoding='utf-8'))
        def save(values):
            state = load()
            state.update(values)
            self.settings_path.write_text(json.dumps(state), encoding='utf-8')
        self.runtime = types.SimpleNamespace(app=self.app, db=self.db, User=User,
            DATA_DIR=self.root, BASE_DIR=self.root,
            load_app_settings=load, save_app_settings=save,
            get_backup_dir=lambda:self.original)
        default_patch=patch.object(backup_settings,'_default_directory',return_value=self.root/'backups')
        default_patch.start()
        self.addCleanup(default_patch.stop)
        self.opener = Mock()
        self.picker = Mock(return_value=None)
        backup_settings.register(self.runtime, choose_folder=self.picker, open_folder=self.opener)
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session.update(user_id=1, is_admin=True, csrf_token='owned-csrf')

    def put(self, path):
        return self.client.put('/api/settings/backup', json={'path':path},
                               headers={'X-CSRFToken':'owned-csrf'})

    def test_saves_real_writable_chinese_directory_without_moving_old_backup(self):
        target = self.root / '自定义备份 & [资料] # %'
        response = self.put(str(target))
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(Path(response.json['path']), target.resolve())
        self.assertEqual(self.runtime.get_backup_dir(), target.resolve())
        (self.runtime.get_backup_dir()/'actual.pmbak').write_bytes(b'new backup')
        self.assertTrue((target/'actual.pmbak').is_file())
        self.assertEqual((self.original/'preserved.pmbak').read_bytes(), b'old backup')
        self.assertEqual(self.runtime.load_app_settings()['unrelated'],'preserved')

    def test_invalid_or_unwritable_directory_keeps_previous_setting(self):
        occupied = self.root/'file'
        occupied.write_bytes(b'not directory')
        for value in ('relative/path', 'https://example.com', 123, None, str(occupied)):
            with self.subTest(value=value):
                self.assertEqual(self.put(value).status_code,400)
                self.assertEqual(self.runtime.load_app_settings(),self.settings)
        with patch.object(backup_settings, '_check_writable', side_effect=OSError('denied')):
            self.assertEqual(self.put(str(self.root/'denied')).status_code,400)
        self.assertEqual(self.runtime.load_app_settings(), self.settings)

    def test_cancel_does_not_save_and_open_uses_saved_folder_only(self):
        result = self.client.post('/api/settings/backup/choose',headers={'X-CSRFToken':'owned-csrf'})
        self.assertEqual(result.json,{'cancelled':True})
        self.assertEqual(self.runtime.load_app_settings(),self.settings)
        response=self.client.post('/api/settings/backup/open',json={'path':'C:/arbitrary'},
                                  headers={'X-CSRFToken':'owned-csrf'})
        self.assertEqual(response.status_code,200)
        self.opener.assert_called_once_with(self.original.resolve())

    def test_real_admin_desktop_loopback_and_csrf_are_required(self):
        self.assertEqual(self.client.put('/api/settings/backup',json={'path':str(self.root)}).status_code,400)
        with self.client.session_transaction() as session:
            session['user_id']=2
        self.assertEqual(self.put(str(self.root)).status_code,403)
        with self.client.session_transaction() as session:
            session['user_id']=1
        self.assertEqual(self.client.get('/api/settings/backup',environ_overrides={'REMOTE_ADDR':'100.113.64.12'}).status_code,403)
        self.app.config['IS_DESKTOP']=False
        self.assertEqual(self.put(str(self.root)).status_code,403)
        self.app.config['IS_DESKTOP']=True
        self.db.session.get(self.User,1).is_active=False
        self.db.session.commit()
        self.assertEqual(self.put(str(self.root)).status_code,403)

    def test_missing_configured_folder_is_reported_without_silent_fallback(self):
        missing=self.root/'lost-drive'
        self.runtime.save_app_settings({'backup_folder':str(missing)})
        response=self.client.get('/api/settings/backup')
        self.assertEqual(response.status_code,200)
        self.assertFalse(response.json['available'])
        self.assertFalse(missing.exists(), 'reading settings must not create a directory')
        self.assertEqual(Path(response.json['path']),missing)
        with patch.object(backup_settings, '_check_writable', side_effect=OSError('offline')):
            with self.assertRaises(RuntimeError):
                self.runtime.get_backup_dir()
        self.assertEqual(self.runtime.load_app_settings()['backup_folder'],str(missing))

    def test_reset_validates_default_and_preserves_other_settings(self):
        response=self.put('')
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.runtime.load_app_settings()['backup_folder'],'')
        self.assertEqual(self.runtime.load_app_settings()['unrelated'],'preserved')
        self.assertEqual(Path(response.json['path']),Path(response.json['default_path']))

    def test_save_failure_preserves_previous_configuration_and_open_failure_is_visible(self):
        with patch.object(self.runtime,'save_app_settings',side_effect=OSError('disk full')):
            self.assertEqual(self.put(str(self.root/'new')).status_code,500)
        self.assertEqual(self.runtime.load_app_settings(),self.settings)
        self.opener.side_effect=OSError('no shell')
        result=self.client.post('/api/settings/backup/open',headers={'X-CSRFToken':'owned-csrf'})
        self.assertEqual(result.status_code,503)
        self.assertIn('error',result.json)

    @unittest.skipUnless(os.environ.get('PM_SOURCE_EXE') and os.environ.get('PM_SOURCE_EXE_SHA256'),
                         'requires pinned frozen baseline PM_SOURCE_EXE and PM_SOURCE_EXE_SHA256')
    def test_frozen_full_backup_uses_configured_directory_and_preserves_database_and_attachments(self):
        from PyInstaller.archive.readers import CArchiveReader
        from tools.compile_module_patches import _read_pyz, _pyz_entry, _named_code_objects
        from src.backend_patches.app_replacements import create_full_backup
        baseline=Path(os.environ['PM_SOURCE_EXE'])
        self.assertEqual(hashlib.sha256(baseline.read_bytes()).hexdigest(),os.environ['PM_SOURCE_EXE_SHA256'])
        pyz=CArchiveReader(str(baseline)).extract('PYZ.pyz')
        toc,_=_read_pyz(pyz)
        code=marshal.loads(_pyz_entry(pyz,toc,'app'))
        target=self.root/'新备份目录'
        self.assertEqual(self.put(str(target)).status_code,200)
        database=self.root/'owned.db'
        with closing(sqlite3.connect(database)) as connection:
            connection.execute('CREATE TABLE owned(value TEXT)')
            connection.execute("INSERT INTO owned VALUES('preserved')")
            connection.commit()
        uploads=self.root/'uploads'
        uploads.mkdir()
        (uploads/'附件.txt').write_text('保留附件',encoding='utf-8')
        globals_=dict(__builtins__=builtins.__dict__, get_backup_dir=self.runtime.get_backup_dir,
            datetime=datetime,date=date,DATA_ENCRYPTION_ENABLED=False,DB_PATH=database,
            sqlite3=sqlite3,zipfile=zipfile,UPLOAD_FOLDER=uploads,hashlib=hashlib,json=json,os=os,
            save_app_settings=self.runtime.save_app_settings,MASTER_KEY=b't'*32,ATTACHMENT_KEY=b't'*32)
        original=types.FunctionType(_named_code_objects(code,'create_full_backup')[0],globals_)
        result=Path(create_full_backup(original))
        self.assertEqual(result.parent,target)
        with zipfile.ZipFile(result) as archive:
            self.assertIn('bidding.db',archive.namelist())
            self.assertTrue(any(archive.read(name)=='保留附件'.encode() for name in archive.namelist()
                                if name.endswith('.txt')))
        self.assertEqual((self.original/'preserved.pmbak').read_bytes(),b'old backup')


if __name__=='__main__':
    unittest.main()
