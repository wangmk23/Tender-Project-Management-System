import sqlite3
import tempfile
import unittest
import types
from contextlib import closing
from pathlib import Path

from src.backend_patches.data_safety import run_additive_migration
from src.backend_patches import app_replacements


class MigrationVersionUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.database = self.root / 'isolated.db'
        self.backups = self.root / 'backups'
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executescript("CREATE TABLE original (id INTEGER PRIMARY KEY, name TEXT);"
                                     "INSERT INTO original VALUES (1, 'preserved');")
            connection.commit()
        run_additive_migration(self.database, self.backups, 'versioned', '1',
                               ['ALTER TABLE original ADD COLUMN first_version TEXT'])

    def test_next_version_preserves_data_and_is_idempotent(self):
        statements = ['ALTER TABLE original ADD COLUMN second_version TEXT']
        result = run_additive_migration(self.database, self.backups, 'versioned', '2', statements)
        self.assertTrue(result['applied'])
        self.assertEqual(result['backup']['backup_fingerprint']['tables']['original']['count'], 1)
        repeat = run_additive_migration(self.database, self.backups, 'versioned', '2', statements)
        self.assertFalse(repeat['applied'])
        self.assertEqual(len(list(self.backups.glob('*.db'))), 2)
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute('SELECT id, name FROM original').fetchall(), [(1, 'preserved')])
            self.assertEqual(connection.execute('SELECT value FROM __safe_migration_versions WHERE namespace=?',
                                                ('versioned',)).fetchone(), ('2',))
            self.assertIn('second_version', [row[1] for row in connection.execute('PRAGMA table_info(original)')])

    def test_failed_next_version_keeps_previous_version_and_rolls_back_schema(self):
        with self.assertRaises(sqlite3.OperationalError):
            run_additive_migration(self.database, self.backups, 'versioned', '2',
                                   ['ALTER TABLE original ADD COLUMN transient TEXT',
                                    'CREATE INDEX invalid_index ON missing_table(id)'])
        with closing(sqlite3.connect(self.database)) as connection:
            self.assertEqual(connection.execute('SELECT value FROM __safe_migration_versions').fetchone(), ('1',))
            self.assertNotIn('transient', [row[1] for row in connection.execute('PRAGMA table_info(original)')])
            self.assertEqual(connection.execute('SELECT id, name FROM original').fetchall(), [(1, 'preserved')])


class ProjectDeletionTransactionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.file = Path(self.temporary.name) / 'isolated.bin'
        self.file.write_bytes(b'preserve-on-rollback')
        self.events = []
        self.attachment = types.SimpleNamespace(id=9, file_path=self.file)
        self.project = types.SimpleNamespace(id=1, attachments=types.SimpleNamespace(all=lambda: [self.attachment]))
        self.session = types.SimpleNamespace(delete=lambda project: self.events.append('delete-row'),
                                             commit=lambda: self.events.append('commit'),
                                             rollback=lambda: self.events.append('rollback'))
        def delete_file(attachment):
            self.events.append('delete-file')
            attachment.file_path.unlink()
        runtime = {'db': types.SimpleNamespace(get_or_404=lambda *args: self.project, session=self.session),
                   'Project': type('Project', (), {}), '_delete_attachment_file': delete_file,
                   '_cleanup_project_files': lambda pid: self.events.append('cleanup'),
                   'jsonify': lambda value: value,
                   'app': types.SimpleNamespace(logger=types.SimpleNamespace(warning=lambda value: self.events.append('warning')))}
        self.function = types.FunctionType(app_replacements.api_delete_project.__code__, runtime)

    def test_failed_commit_keeps_attachment_and_rolls_back(self):
        def fail():
            raise OSError('injected isolated commit failure')
        self.session.commit = fail
        with self.assertRaises(OSError):
            self.function(1)
        self.assertEqual(self.file.read_bytes(), b'preserve-on-rollback')
        self.assertEqual(self.events, ['delete-row', 'rollback'])

    def test_successful_commit_precedes_file_deletion(self):
        self.assertEqual(self.function(1), {'ok': True})
        self.assertEqual(self.events, ['delete-row', 'commit', 'delete-file', 'cleanup'])
        self.assertFalse(self.file.exists())

    def test_post_commit_cleanup_failure_logs_without_rollback(self):
        def fail(pid):
            raise OSError('injected isolated cleanup failure')
        self.function.__globals__['_cleanup_project_files'] = fail
        self.assertEqual(self.function(1), {'ok': True})
        self.assertEqual(self.events, ['delete-row', 'commit', 'delete-file', 'warning'])


class RelatedDeletionTransactionTests(unittest.TestCase):
    def run_case(self, name, *, fail_commit=False, fail_cleanup=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            attachment_path = root / 'isolated.bin'
            attachment_path.write_bytes(b'preserved')
            legacy_path = root / 'legacy.bin'
            legacy_path.write_bytes(b'legacy-preserved')
            events = []
            attachment = types.SimpleNamespace(id=9, file_path='isolated.bin', filename='isolated.bin', project_id=1)
            parent = types.SimpleNamespace(id=1, attachments=[attachment], attachment_path='legacy.bin',
                                           affects_deadline=True, original_deadline='old-deadline', project=object())
            query = types.SimpleNamespace(get=lambda aid: attachment,
                                          filter_by=lambda **kw: types.SimpleNamespace(first_or_404=lambda: parent))
            def commit():
                if fail_commit:
                    raise OSError('injected isolated commit failure')
                events.append('commit')
            session = types.SimpleNamespace(delete=lambda row: events.append('delete-row'), commit=commit,
                                             rollback=lambda: events.append('rollback'), flush=lambda: events.append('flush'))
            def delete_file(row):
                if fail_cleanup:
                    raise OSError('injected isolated cleanup failure')
                (root / row.file_path).unlink()
                events.append('delete-file')
            def validate(path, relative):
                if fail_cleanup and 'commit' in events:
                    raise OSError('injected isolated cleanup failure')
                path.resolve().relative_to(root.resolve())
            class CleanupFailurePath(type(root)):
                def unlink(self, *args, **kwargs):
                    if fail_cleanup:
                        raise OSError('injected isolated cleanup failure')
                    return super().unlink(*args, **kwargs)
            logger = types.SimpleNamespace(warning=lambda *args: events.append('warning'), error=lambda *args: events.append('error'))
            runtime = {'db': types.SimpleNamespace(get_or_404=lambda *args: parent, session=session),
                       'Attachment': types.SimpleNamespace(query=query), 'Complaint': type('Complaint', (), {}),
                       'ComplaintEvent': types.SimpleNamespace(query=query), 'AnnouncementClarification': types.SimpleNamespace(query=query),
                       '_ensure_project_resource': lambda row, pid: row, 'UPLOAD_FOLDER': CleanupFailurePath(root),
                       '_validate_file_path': validate, '_delete_attachment_file': delete_file,
                       '_recalculate_clarification_deadline': lambda *args: events.append('recalculate'),
                       'request': types.SimpleNamespace(method='DELETE'), 'jsonify': lambda value: value,
                       'app': types.SimpleNamespace(logger=logger), 'log_operation': lambda *args: events.append('log')}
            function = types.FunctionType(getattr(app_replacements, name).__code__, runtime)
            args = {'api_delete_attachment': (9,), 'api_delete_complaint': (1, 2),
                    'api_update_delete_complaint_event': (1, 2, 3), 'api_update_delete_clarification': (1, 2)}[name]
            if fail_commit and name != 'api_delete_attachment':
                with self.assertRaises(OSError):
                    function(*args)
            else:
                response = function(*args)
                if fail_commit:
                    self.assertEqual(response[1], 500)
                else:
                    self.assertTrue(response['ok'])
            if fail_commit:
                self.assertEqual(attachment_path.read_bytes(), b'preserved')
                self.assertEqual(legacy_path.read_bytes(), b'legacy-preserved')
                self.assertIn('rollback', events)
            else:
                self.assertNotIn('rollback', events)
                if fail_cleanup:
                    self.assertIn('warning', events)
                    self.assertEqual(attachment_path.read_bytes(), b'preserved')
                else:
                    self.assertFalse(attachment_path.exists())
                    if name == 'api_delete_complaint':
                        self.assertFalse(legacy_path.exists())

    def test_related_delete_commit_failures_preserve_physical_files(self):
        for name in ('api_delete_attachment', 'api_delete_complaint', 'api_update_delete_complaint_event', 'api_update_delete_clarification'):
            with self.subTest(name=name):
                self.run_case(name, fail_commit=True)

    def test_related_successful_deletions_clean_files(self):
        for name in ('api_delete_attachment', 'api_delete_complaint', 'api_update_delete_complaint_event', 'api_update_delete_clarification'):
            with self.subTest(name=name):
                self.run_case(name)

    def test_cleanup_failures_preserve_committed_success(self):
        for name in ('api_delete_attachment', 'api_delete_complaint', 'api_update_delete_complaint_event', 'api_update_delete_clarification'):
            with self.subTest(name=name):
                self.run_case(name, fail_cleanup=True)


if __name__ == '__main__':
    unittest.main()
