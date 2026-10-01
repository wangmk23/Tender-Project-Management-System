import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools.build_candidate import resolve_source_executable, sha256_file


class BuildInputTests(unittest.TestCase):
    def make_executable(self, root: Path, content: bytes = b"source") -> Path:
        source = root / "source.exe"
        source.write_bytes(content)
        return source

    def test_missing_explicit_input_is_rejected(self):
        with patch.dict(os.environ, {}, clear=True):
            with self.assertRaisesRegex(RuntimeError, "PM_SOURCE_EXE"):
                resolve_source_executable()

    def test_missing_expected_hash_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = self.make_executable(Path(temp_dir))
            with patch.dict(os.environ, {}, clear=True):
                with self.assertRaisesRegex(RuntimeError, "PM_SOURCE_EXE_SHA256"):
                    resolve_source_executable(source=source)

    def test_non_exe_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = Path(temp_dir) / "source.bin"
            source.write_bytes(b"source")
            with self.assertRaisesRegex(ValueError, r"\.exe"):
                resolve_source_executable(source, sha256_file(source))

    def test_hash_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = self.make_executable(Path(temp_dir))
            with self.assertRaisesRegex(RuntimeError, "SHA-256 mismatch"):
                resolve_source_executable(source, "0" * 64)

    @unittest.skipUnless(hasattr(Path, "symlink_to"), "symlinks unavailable")
    def test_symlink_input_is_rejected(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = self.make_executable(root)
            link = root / "linked.exe"
            try:
                link.symlink_to(source)
            except OSError:
                self.skipTest("symlink creation is not permitted")
            with self.assertRaisesRegex(ValueError, "symbolic link"):
                resolve_source_executable(link, sha256_file(source))

    def test_explicit_path_and_hash_return_resolved_read_only_input(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = self.make_executable(Path(temp_dir), b"pinned source")
            resolved = resolve_source_executable(source, sha256_file(source))
            self.assertEqual(resolved, source.resolve())
            self.assertEqual(resolved.read_bytes(), b"pinned source")

    def test_environment_input_is_supported(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            source = self.make_executable(Path(temp_dir), b"environment source")
            variables = {
                "PM_SOURCE_EXE": str(source),
                "PM_SOURCE_EXE_SHA256": sha256_file(source),
            }
            with patch.dict(os.environ, variables, clear=True):
                self.assertEqual(resolve_source_executable(), source.resolve())


if __name__ == "__main__":
    unittest.main()
