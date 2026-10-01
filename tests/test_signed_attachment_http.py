import tempfile
import types
import unittest
from pathlib import Path

from flask import Flask, Response

from src.backend_patches import signed_attachments


XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


class FakeSession:
    def __init__(self, attachment):
        self.attachment = attachment

    def get(self, _model, attachment_id):
        if int(attachment_id) == self.attachment.id:
            return self.attachment
        return None


class SignedAttachmentHttpTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.uploads = self.root / "uploads"
        self.uploads.mkdir()
        (self.uploads / "encrypted.bin").write_bytes(b"encrypted-on-disk")
        self.attachment = types.SimpleNamespace(
            id=7,
            file_path="encrypted.bin",
            filename="导出清单.xlsx",
            mime_type=XLSX_MIME,
        )
        self.original_bytes = b"PK\x03\x04readable-xlsx"
        self.app = Flask(f"signed-http-{id(self)}")
        self.previous_protect = signed_attachments._PROTECT_SECRET
        self.previous_unprotect = signed_attachments._UNPROTECT_SECRET
        signed_attachments._PROTECT_SECRET = lambda raw: b"protected:" + raw
        signed_attachments._UNPROTECT_SECRET = lambda raw: raw.removeprefix(
            b"protected:"
        )
        signed_attachments._INVALID_ATTEMPTS.clear()

        def attachment_response(path, attachment, as_download):
            self.assertEqual(Path(path), (self.uploads / "encrypted.bin").resolve())
            self.assertIs(attachment, self.attachment)
            self.assertTrue(as_download)
            response = Response(self.original_bytes, mimetype=XLSX_MIME)
            response.headers["Content-Disposition"] = (
                "attachment; filename=attachment.xlsx; "
                "filename*=UTF-8''%E5%AF%BC%E5%87%BA%E6%B8%85%E5%8D%95.xlsx"
            )
            return response

        signed_attachments.register_routes(
            self.app,
            types.SimpleNamespace(session=FakeSession(self.attachment)),
            {
                "Attachment": type("Attachment", (), {}),
                "DATA_DIR": self.root,
                "UPLOAD_FOLDER": self.uploads,
                "attachment_response": attachment_response,
                "now": lambda: 1_000,
            },
        )

    def tearDown(self):
        signed_attachments._PROTECT_SECRET = self.previous_protect
        signed_attachments._UNPROTECT_SECRET = self.previous_unprotect
        self.temporary.cleanup()

    def test_valid_signed_url_returns_original_bytes_over_real_http(self):
        secret = signed_attachments.get_or_create_secret(self.root)
        url = signed_attachments.build_signed_url("", 7, 2_000, secret)

        response = self.app.test_client().get(url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, self.original_bytes)
        self.assertNotEqual(response.data, b"encrypted-on-disk")
        self.assertEqual(response.mimetype, XLSX_MIME)
        self.assertIn("attachment;", response.headers["Content-Disposition"])
        self.assertIn("filename*=UTF-8''", response.headers["Content-Disposition"])

    def test_malformed_signatures_are_invalid_and_throttled_not_service_errors(self):
        client = self.app.test_client()
        signatures = ["中文", "x" * 64, "0" * 63, "0" * 65, ""]
        statuses = [
            client.get("/api/public/attachments/7/download", query_string={"expires": 2000, "sig": value}).status_code
            for value in signatures
        ]
        self.assertEqual(statuses, [404, 404, 404, 429, 429])
        audit = (self.root / "attachment_download_audit.jsonl").read_text(encoding="utf-8")
        self.assertNotIn("key-error", audit)
        self.assertNotIn("中文", audit)
        secret = signed_attachments.get_or_create_secret(self.root)
        valid = client.get(signed_attachments.build_signed_url("", 7, 2000, secret))
        self.assertEqual(valid.status_code, 200)


if __name__ == "__main__":
    unittest.main()
