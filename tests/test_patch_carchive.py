import hashlib
import os
import tempfile
import unittest
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader

from tools.build_candidate import resolve_source_executable
from tools.patch_carchive import patch_executable


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


@unittest.skipUnless(
    os.environ.get("PM_SOURCE_EXE") and os.environ.get("PM_SOURCE_EXE_SHA256"),
    "CArchive integration requires an explicit hash-pinned source",
)
class PatchCArchiveTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = resolve_source_executable()

    def test_replaces_only_requested_entries_and_preserves_source(self):
        source_hash_before = sha256_file(self.source)
        original = CArchiveReader(str(self.source))
        protected = ("PYZ.pyz", "desktop_app", "python312.dll", "static\\app-logo.svg")
        protected_hashes = {
            name: sha256_bytes(original.extract(name))
            for name in protected
        }

        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            app_js = temp / "app.js"
            style_css = temp / "style.css"
            app_js.write_bytes(b"/* replacement app */\n")
            style_css.write_bytes(b"/* replacement style */\n")
            destination = temp / "candidate.exe"

            patch_executable(
                self.source,
                destination,
                {
                    "static\\app.js": app_js,
                    "static\\style.css": style_css,
                },
            )

            patched = CArchiveReader(str(destination))
            self.assertEqual(patched.extract("static\\app.js"), app_js.read_bytes())
            self.assertEqual(patched.extract("static\\style.css"), style_css.read_bytes())
            self.assertEqual(set(patched.toc), set(original.toc))
            for name, expected_hash in protected_hashes.items():
                self.assertEqual(sha256_bytes(patched.extract(name)), expected_hash, name)

        self.assertEqual(sha256_file(self.source), source_hash_before)

    def test_rejects_unknown_archive_entry_without_writing_output(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            temp = Path(temp_dir)
            replacement = temp / "replacement.bin"
            replacement.write_bytes(b"replacement")
            destination = temp / "candidate.exe"

            with self.assertRaises(KeyError):
                patch_executable(
                    self.source,
                    destination,
                    {"missing\\entry.bin": replacement},
                )

            self.assertFalse(destination.exists())


if __name__ == "__main__":
    unittest.main()
