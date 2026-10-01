import importlib
import json
import tempfile
import types
import unittest
from pathlib import Path
from urllib.parse import parse_qs, urlparse


class SigningTests(unittest.TestCase):
    def setUp(self):
        try:
            self.module = importlib.import_module("src.backend_patches.signed_attachments")
        except ModuleNotFoundError:
            self.module = None

    def test_signature_is_versioned_deterministic_and_bound_to_id_and_expiry(self):
        module = self.module
        self.assertIsNotNone(module)
        secret = b"s" * 32

        url = module.build_signed_url("http://192.168.5.7:5001", 7, 1770000000, secret)
        query = parse_qs(urlparse(url).query)

        self.assertEqual(urlparse(url).path, "/api/public/attachments/7/download")
        self.assertEqual(query["expires"], ["1770000000"])
        self.assertEqual(
            query["sig"],
            ["c71c14e4f1782f621f4c17ec1ee64ffce172493bbbe09f0c54d21cf7b7efb7e6"],
        )
        self.assertEqual(module.verify_signature(7, 1770000000, query["sig"][0], secret, 1769999999), "valid")
        self.assertEqual(module.verify_signature(8, 1770000000, query["sig"][0], secret, 1769999999), "invalid")
        self.assertEqual(module.verify_signature(7, 1770000001, query["sig"][0], secret, 1769999999), "invalid")
        self.assertEqual(module.verify_signature(7, 1770000000, "0" * 64, secret, 1769999999), "invalid")
        self.assertEqual(module.verify_signature(7, 1770000000, query["sig"][0], secret, 1770000001), "expired")

    def test_key_is_generated_once_and_stored_only_as_protected_bytes(self):
        module = self.module
        self.assertIsNotNone(module)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            previous_protect = module._PROTECT_SECRET
            previous_unprotect = module._UNPROTECT_SECRET
            module._PROTECT_SECRET = lambda raw: b"protected:" + raw
            module._UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
            try:
                first = module.get_or_create_secret(root)
                second = module.get_or_create_secret(root)
            finally:
                module._PROTECT_SECRET = previous_protect
                module._UNPROTECT_SECRET = previous_unprotect

            self.assertEqual(len(first), 32)
            self.assertEqual(second, first)
            stored = (root / "attachment_link_key.dpapi").read_bytes()
            self.assertTrue(stored.startswith(b"protected:"))
            self.assertNotEqual(stored, first)


class FakeApp:
    def __init__(self):
        self.routes = {}

    def add_url_rule(self, path, endpoint, handler, methods):
        self.routes[path] = handler


class FakeSession:
    def __init__(self, attachment):
        self.attachment = attachment

    def get(self, model, attachment_id):
        if self.attachment and int(attachment_id) == self.attachment.id:
            return self.attachment
        return None


class FakeDownloadResponse:
    def __init__(self, payload, disposition, mimetype):
        self._payload = bytes(payload)
        self.headers = {"Content-Disposition": disposition}
        self.mimetype = mimetype

    def get_data(self):
        return self._payload


class DownloadRouteTests(unittest.TestCase):
    def setUp(self):
        self.module = importlib.import_module("src.backend_patches.signed_attachments")
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.uploads = self.root / "uploads"
        self.uploads.mkdir()
        (self.uploads / "safe.pdf").write_bytes(b"encrypted-on-disk")
        self.attachment = types.SimpleNamespace(
            id=4,
            file_path="safe.pdf",
            filename="资料.pdf",
            mime_type="application/pdf",
        )
        self.samples = {
            "资料.pdf": (b"%PDF-1.7\nreadable", "application/pdf"),
            "方案.docx": (
                b"PK\x03\x04docx-readable",
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            ),
            "清单.xlsx": (
                b"PK\x03\x04xlsx-readable",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            ),
            "截图.png": (b"\x89PNG\r\n\x1a\nreadable", "image/png"),
        }
        self.response_calls = []
        self.app = FakeApp()
        self.module._INVALID_ATTEMPTS.clear()
        self.previous_request = self.module.request
        self.previous_jsonify = self.module.jsonify
        self.previous_protect = self.module._PROTECT_SECRET
        self.previous_unprotect = self.module._UNPROTECT_SECRET
        self.module._PROTECT_SECRET = lambda raw: b"protected:" + raw
        self.module._UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.module.jsonify = lambda value: value
        self.models = {
            "Attachment": type("Attachment", (), {}),
            "DATA_DIR": self.root,
            "UPLOAD_FOLDER": self.uploads,
            "attachment_response": self.fake_attachment_response,
            "now": lambda: 1000,
        }
        self.db = types.SimpleNamespace(session=FakeSession(self.attachment))
        self.module.register_routes(self.app, self.db, self.models)

    def tearDown(self):
        self.module.request = self.previous_request
        self.module.jsonify = self.previous_jsonify
        self.module._PROTECT_SECRET = self.previous_protect
        self.module._UNPROTECT_SECRET = self.previous_unprotect
        self.temporary.cleanup()

    def fake_attachment_response(self, path, attachment, as_download):
        self.response_calls.append((Path(path), attachment, as_download))
        payload, mimetype = self.samples[attachment.filename]
        from urllib.parse import quote

        return FakeDownloadResponse(
            payload,
            (
                'attachment; filename="attachment"; '
                f"filename*=UTF-8''{quote(attachment.filename)}"
            ),
            mimetype,
        )

    def request_download(self, expires, signature, remote="192.168.5.8"):
        self.module.request = types.SimpleNamespace(
            args={"expires": str(expires), "sig": signature}, remote_addr=remote
        )
        return self.app.routes["/api/public/attachments/<int:aid>/download"](4)

    def signature(self, expires=2000):
        secret = self.module.get_or_create_secret(self.root)
        url = self.module.build_signed_url("http://lan", 4, expires, secret)
        return parse_qs(urlparse(url).query)["sig"][0]

    def test_valid_signature_returns_decrypted_bytes_for_supported_file_families(self):
        from urllib.parse import unquote

        for filename, (expected, mimetype) in self.samples.items():
            with self.subTest(filename=filename):
                self.attachment.filename = filename
                self.attachment.mime_type = mimetype
                response = self.request_download(2000, self.signature())

                self.assertEqual(response.get_data(), expected)
                self.assertNotEqual(
                    response.get_data(), (self.uploads / "safe.pdf").read_bytes()
                )
                self.assertEqual(response.mimetype, mimetype)
                disposition = response.headers["Content-Disposition"]
                self.assertTrue(disposition.startswith("attachment;"))
                encoded_name = disposition.split("filename*=UTF-8''", 1)[1]
                self.assertEqual(unquote(encoded_name), filename)
        self.assertEqual(len(self.response_calls), len(self.samples))
        for path, attachment, as_download in self.response_calls:
            self.assertEqual(path, (self.uploads / "safe.pdf").resolve())
            self.assertIs(attachment, self.attachment)
            self.assertTrue(as_download)
        audit = json.loads(
            (self.root / "attachment_download_audit.jsonl")
            .read_text(encoding="utf-8")
            .splitlines()[-1]
        )
        self.assertEqual(audit["result"], "downloaded")
        self.assertNotIn("sig", audit)

    def test_missing_or_failing_decryption_pipeline_returns_safe_503(self):
        for label, replacement, expected_audit in (
            ("missing", None, "decrypt-unavailable"),
            ("failure", lambda *_args: (_ for _ in ()).throw(ValueError("secret path")), "decrypt-error"),
        ):
            with self.subTest(label=label):
                app = FakeApp()
                models = dict(self.models)
                if replacement is None:
                    models.pop("attachment_response", None)
                else:
                    models["attachment_response"] = replacement
                self.module.register_routes(app, self.db, models)
                self.module.request = types.SimpleNamespace(
                    args={"expires": "2000", "sig": self.signature()},
                    remote_addr="192.168.5.8",
                )

                response, status = app.routes[
                    "/api/public/attachments/<int:aid>/download"
                ](4)

                self.assertEqual(status, 503)
                self.assertEqual(response, {"error": "附件下载暂不可用"})
                self.assertNotIn("secret", str(response))
                audit_lines = (self.root / "attachment_download_audit.jsonl").read_text(
                    encoding="utf-8"
                ).splitlines()
                self.assertEqual(json.loads(audit_lines[-1])["result"], expected_audit)

    def test_expired_tampered_missing_and_path_escape_fail_closed(self):
        expired = self.request_download(999, self.signature(999))
        self.assertEqual(expired[1], 410)

        tampered = self.request_download(2000, "0" * 64)
        self.assertEqual(tampered[1], 404)

        self.db.session.attachment = None
        missing = self.request_download(2000, self.signature())
        self.assertEqual(missing[1], 404)

        outside = self.root / "outside.txt"
        outside.write_text("secret", encoding="utf-8")
        self.db.session.attachment = types.SimpleNamespace(id=4, file_path="../outside.txt", filename="outside.txt")
        escaped = self.request_download(2000, self.signature())
        self.assertEqual(escaped[1], 404)
        self.assertEqual(self.response_calls, [])

    def test_repeated_invalid_requests_are_throttled_but_valid_link_still_works(self):
        statuses = [self.request_download(2000, "0" * 64)[1] for _ in range(4)]
        self.assertEqual(statuses, [404, 404, 404, 429])

        valid = self.request_download(2000, self.signature())
        self.assertEqual(valid.get_data(), self.samples["资料.pdf"][0])


if __name__ == "__main__":
    unittest.main()
