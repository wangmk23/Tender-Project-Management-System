import tempfile
import types
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from src.backend_patches import app_replacements


class RegistrationDeleteTransactionTests(unittest.TestCase):
    def exercise(self, fail):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'registration.txt'
            file.write_bytes(b'original attachment')
            attachment = types.SimpleNamespace(id=1, file_path=file.name)
            registration = types.SimpleNamespace(id=2, attachments=[attachment])
            events = []

            def commit():
                self.assertTrue(file.exists())
                events.append('commit')
                if fail:
                    raise RuntimeError('isolated commit failure')

            session = types.SimpleNamespace(delete=Mock(), commit=commit, rollback=Mock())
            consortium = types.ModuleType('consortium_registration')
            consortium.ensure_schema = Mock()
            consortium.delete_members = Mock()
            scope = {
                'db': types.SimpleNamespace(get_or_404=lambda *args: registration, session=session),
                'SupplierRegistration': object(), '_ensure_project_resource': lambda row, pid: row,
                'UPLOAD_FOLDER': root, '_validate_file_path': lambda *args: None,
                'app': types.SimpleNamespace(logger=types.SimpleNamespace(warning=Mock(), exception=Mock())),
                'jsonify': lambda result: result,
            }
            handler = types.FunctionType(app_replacements.api_delete_registration.__code__, scope)
            with patch.dict('sys.modules', {'consortium_registration': consortium}):
                result = handler(3, 2)
            if fail:
                self.assertEqual(result[1], 500)
                self.assertEqual(file.read_bytes(), b'original attachment')
                session.rollback.assert_called_once()
            else:
                self.assertEqual(result, {'ok': True})
                self.assertFalse(file.exists())
                session.rollback.assert_not_called()
            self.assertEqual(events, ['commit'])

    def test_commit_failure_keeps_file_and_rolls_back(self):
        self.exercise(True)

    def test_success_cleans_file_after_commit(self):
        self.exercise(False)
