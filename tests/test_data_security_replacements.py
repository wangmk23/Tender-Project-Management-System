from __future__ import annotations

import base64
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from src.backend_patches import data_recovery
from src.backend_patches import data_security_replacements


class InteractiveStartupRecoveryTests(unittest.TestCase):
    def setUp(self):
        # The frozen loader resolves a top-level module; ensure the test mocks
        # that same object even if another suite added backend_patches to sys.path.
        modules = mock.patch.dict(sys.modules, {"data_recovery": data_recovery})
        modules.start()
        self.addCleanup(modules.stop)

    def test_wrong_well_formed_key_is_rejected_before_rebinding_encrypted_database(self):
        wrong = base64.urlsafe_b64encode(b"w" * 32).decode("ascii")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "bidding.db").write_bytes(b"encrypted-db")
            target = root / "data_key.dpapi"
            target.write_bytes(b"old-machine-wrapper")
            connection = mock.Mock()
            connection.execute.side_effect = RuntimeError("file is encrypted")
            with mock.patch.multiple(
                data_security_replacements,
                KEY_FILE="data_key.dpapi",
                _dpapi_unprotect=mock.Mock(side_effect=OSError("other machine")),
                _dpapi_protect=mock.Mock(return_value=b"must-not-be-written"),
                _usb_recovery_dir=mock.Mock(return_value=None),
                restore_master_key=mock.Mock(),
                connect_encrypted=mock.Mock(return_value=connection),
                RECOVERY_PREFIX="recovery-",
                create=True,
            ), mock.patch.object(
                data_recovery, "prompt_for_recovery_material", return_value=wrong
            ):
                with self.assertRaisesRegex(RuntimeError, "不匹配"):
                    data_security_replacements.load_or_create_master_key(
                        root, require_recovery=True, existing_encrypted=True
                    )
            self.assertEqual(target.read_bytes(), b"old-machine-wrapper")

    def test_failed_dpapi_uses_local_prompt_and_rebinds_without_external_directory(self):
        key = bytes(range(32))
        encoded = base64.urlsafe_b64encode(key).decode("ascii")
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "data_key.dpapi").write_bytes(b"old-machine-wrapper")
            with mock.patch.multiple(
                data_security_replacements,
                KEY_FILE="data_key.dpapi",
                _dpapi_unprotect=mock.Mock(side_effect=OSError("other machine")),
                _dpapi_protect=mock.Mock(return_value=b"new-machine-wrapper"),
                _usb_recovery_dir=mock.Mock(return_value=None),
                restore_master_key=mock.Mock(),
                RECOVERY_PREFIX="recovery-",
                create=True,
            ), mock.patch.object(
                data_recovery, "prompt_for_recovery_material", return_value=encoded
            ):
                restored, source = data_security_replacements.load_or_create_master_key(
                    root, require_recovery=True, existing_encrypted=True
                )
            self.assertEqual(restored, key)
            self.assertIsNone(source)
            self.assertEqual(
                (root / "data_key.dpapi").read_bytes(), b"new-machine-wrapper"
            )

    def test_cancelled_prompt_preserves_existing_wrapper_and_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "data_key.dpapi"
            target.write_bytes(b"old-machine-wrapper")
            with mock.patch.multiple(
                data_security_replacements,
                KEY_FILE="data_key.dpapi",
                _dpapi_unprotect=mock.Mock(side_effect=OSError("other machine")),
                _usb_recovery_dir=mock.Mock(return_value=None),
                RECOVERY_PREFIX="recovery-",
                create=True,
            ), mock.patch.object(
                data_recovery, "prompt_for_recovery_material", return_value=None
            ):
                with self.assertRaisesRegex(RuntimeError, "恢复密钥"):
                    data_security_replacements.load_or_create_master_key(
                        root, require_recovery=True, existing_encrypted=True
                    )
            self.assertEqual(target.read_bytes(), b"old-machine-wrapper")


if __name__ == "__main__":
    unittest.main()
