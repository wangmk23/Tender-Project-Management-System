from __future__ import annotations

import logging
import mimetypes
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from flask import Flask, jsonify, make_response

from src.backend_patches import http_security as subject


class DummyRequestHandler:
    server_version = "Werkzeug/3.1.3"
    sys_version = "Python/3.12"

    def version_string(self):
        return f"{self.server_version} {self.sys_version}"


class HttpSecurityTests(unittest.TestCase):
    def test_conditional_reader_response_preserves_same_origin_framing(self):
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'pdf-reader').mkdir();(root/'pdf-reader/index.html').write_text('owned shell','utf-8')
            app=Flask(__name__,static_folder=temporary,static_url_path='/static')
            subject.install_http_security(app,request_handler_class=DummyRequestHandler,access_loggers=[])
            client=app.test_client();first=client.get('/static/pdf-reader/index.html')
            etag=first.headers['ETag'];first.close()
            for headers,status in (({'If-None-Match':etag},304),({'Range':'bytes=0-4'},206)):
                response=client.get('/static/pdf-reader/index.html',headers=headers)
                try:
                    self.assertEqual(response.status_code,status)
                    self.assertEqual(response.headers['X-Frame-Options'],'SAMEORIGIN')
                    self.assertIn("frame-ancestors 'self'",response.headers.getlist('Content-Security-Policy'))
                finally:response.close()

    def test_only_successful_owned_pdf_reader_shell_allows_same_origin_framing(self):
        app=Flask(__name__,static_folder=None)
        @app.get('/static/<path:filename>',endpoint='static')
        def owned_static(filename):
            return ('owned shell',200) if filename=='pdf-reader/index.html' else ('other static',404 if filename=='missing.html' else 200)
        @app.get('/login')
        def login():return 'login'
        @app.get('/api/attachments/1/view')
        def original():return 'original'
        subject.install_http_security(app,request_handler_class=DummyRequestHandler,access_loggers=[])
        client=app.test_client()
        response=client.get('/static/pdf-reader/index.html?file=%2Fapi%2Fattachments%2F1%2Fview')
        self.assertEqual(response.headers['X-Frame-Options'],'SAMEORIGIN')
        self.assertIn("frame-ancestors 'self'",response.headers.getlist('Content-Security-Policy'))
        self.assertEqual(response.headers['X-Content-Type-Options'],'nosniff')
        for path in ('/login','/api/attachments/1/view','/static/missing.html','/static/pdf-reader/other.html','/static/libs/pdfjs-reader/6.4.299/web/viewer.html'):
            with self.subTest(path=path):
                self.assertEqual(client.get(path).headers['X-Frame-Options'],'DENY')

    def test_redacts_sensitive_query_values_and_preserves_safe_context(self):
        raw = "GET /api/public/attachments/7?expires=99&sig=secret&name=x HTTP/1.1"
        clean = subject.redact_request_target(raw)
        self.assertIn("/api/public/attachments/7?", clean)
        self.assertIn("expires=99", clean)
        self.assertIn("name=x", clean)
        self.assertNotIn("secret", clean)
        self.assertIn("sig=%5BREDACTED%5D", clean)

        mixed = subject.redact_request_target(
            "POST /path?ToKeN=a%20b&csrf=two&CODE=three&safe=yes HTTP/1.1"
        )
        self.assertNotIn("a%20b", mixed)
        self.assertNotIn("two", mixed)
        self.assertNotIn("three", mixed)
        self.assertIn("safe=yes", mixed)
        encoded_key = subject.redact_request_target(
            "GET /path?%73ig=encoded-secret&safe=1 HTTP/1.1"
        )
        self.assertNotIn("encoded-secret", encoded_key)
        self.assertIn("sig=%5BREDACTED%5D", encoded_key)

    def test_malformed_input_falls_back_to_removing_the_query(self):
        malformed = "GET /download?sig=%ZZ&safe=value HTTP/1.1"
        clean = subject.redact_request_target(malformed)
        self.assertEqual(clean, "GET /download HTTP/1.1")
        self.assertEqual(subject.redact_request_target("plain message"), "plain message")

    def test_logging_filter_redacts_message_and_string_arguments_once(self):
        logger = logging.getLogger(f"security-test-{id(self)}")
        logger.filters.clear()
        subject.install_access_log_redaction([logger])
        subject.install_access_log_redaction([logger])
        installed = [item for item in logger.filters if getattr(item, "_device_access_redactor", False)]
        self.assertEqual(len(installed), 1)

        record = logging.LogRecord(
            "werkzeug", logging.INFO, __file__, 1, '"%s" %s',
            ("GET /x?sig=secret&safe=1 HTTP/1.1", 200), None,
        )
        self.assertTrue(installed[0].filter(record))
        rendered = record.getMessage()
        self.assertNotIn("secret", rendered)
        self.assertIn("safe=1", rendered)
        self.assertEqual(record.args[1], 200)

    def test_static_modules_keep_javascript_mime_despite_host_plain_text_mapping(self):
        mimetypes.init()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            paths = ('pdf-reader/bootstrap.mjs',
                     'libs/pdfjs-reader/6.4.299/build/pdf.mjs',
                     'libs/pdfjs-reader/6.4.299/build/pdf.worker.mjs',
                     'libs/pdfjs-reader/6.4.299/web/viewer.mjs')
            for path in paths:
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(b'export const ready = true;\n')
            app = Flask(__name__, static_folder=str(root), static_url_path='/static')
            subject.install_http_security(app, request_handler_class=DummyRequestHandler, access_loggers=[])
            with patch.dict(mimetypes.types_map, {'.mjs': 'text/plain'}):
                self.assertEqual(mimetypes.guess_type('bootstrap.mjs')[0], 'text/plain')
                client = app.test_client()
                for path in paths:
                    with self.subTest(path=path):
                        with client.get('/static/' + path) as response:
                            self.assertEqual(response.status_code, 200)
                            self.assertEqual(response.mimetype, 'text/javascript')
                            self.assertEqual(response.data, b'export const ready = true;\n')
                            self.assertEqual(response.headers['X-Content-Type-Options'], 'nosniff')
                            etag = response.headers['ETag']
                        with client.get('/static/' + path, headers={'Range': 'bytes=0-5'}) as response:
                            self.assertEqual(response.status_code, 206)
                            self.assertEqual(response.mimetype, 'text/javascript')
                            self.assertEqual(response.data, b'export')
                        with client.head('/static/' + path) as response:
                            self.assertEqual(response.mimetype, 'text/javascript')
                            self.assertEqual(response.data, b'')
                        with client.get('/static/' + path, headers={'If-None-Match': etag}) as response:
                            self.assertEqual(response.status_code, 304)
                            self.assertEqual(response.data, b'')

    def test_module_mime_correction_does_not_retype_attachments_or_errors(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'notes.mjs.txt').write_text('plain notes', encoding='utf-8')
            app = Flask(__name__, static_folder=str(root), static_url_path='/static')
            @app.get('/api/attachments/example.mjs')
            def original_attachment():
                return make_response('untrusted attachment', 200, {'Content-Type': 'text/plain'})
            subject.install_http_security(app, request_handler_class=DummyRequestHandler, access_loggers=[])
            client = app.test_client()
            for path in ('/static/notes.mjs.txt', '/api/attachments/example.mjs'):
                with client.get(path) as response:
                    self.assertEqual(response.mimetype, 'text/plain')
                    self.assertEqual(response.headers['X-Frame-Options'], 'DENY')
            with client.get('/static/missing.mjs') as response:
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.mimetype, 'text/html')

    def test_response_headers_cache_policy_and_server_identity(self):
        app = Flask(__name__)

        @app.get("/", endpoint="home")
        def home():
            response = make_response("home")
            response.headers["Cache-Control"] = "public, max-age=60"
            return response

        @app.get("/login", endpoint="login")
        def login():
            response = make_response("login")
            response.headers["Cache-Control"] = "public"
            return response

        @app.get("/request-access", endpoint="device_access_request_page")
        def request_access():
            return "request"

        @app.get("/api/device-access/status", endpoint="device_access_status")
        def access_status():
            return jsonify({"status": "pending"})

        @app.get("/api/device-access/devices", endpoint="device_access_admin_devices")
        def devices():
            return jsonify({"devices": []})

        @app.get("/api/public/attachments/1", endpoint="signed_download")
        def signed_download():
            return "attachment"

        logger = logging.getLogger(f"headers-test-{id(self)}")
        subject.install_http_security(
            app,
            request_handler_class=DummyRequestHandler,
            access_loggers=[logger],
        )
        subject.install_http_security(
            app,
            request_handler_class=DummyRequestHandler,
            access_loggers=[logger],
        )

        client = app.test_client()
        for path in (
            "/", "/login", "/request-access", "/api/device-access/status",
            "/api/device-access/devices", "/api/public/attachments/1",
        ):
            with self.subTest(path=path):
                response = client.get(path)
                self.assertEqual(response.headers["X-Content-Type-Options"], "nosniff")
                self.assertEqual(response.headers["X-Frame-Options"], "DENY")
                self.assertEqual(response.headers["Referrer-Policy"], "same-origin")
                self.assertEqual(
                    response.headers["Permissions-Policy"],
                    "camera=(), microphone=(), geolocation=()",
                )
                self.assertNotIn("Content-Security-Policy", response.headers)

        self.assertEqual(client.get("/").headers["Cache-Control"], "public, max-age=60")
        for path in (
            "/login", "/request-access", "/api/device-access/status",
            "/api/device-access/devices",
        ):
            self.assertEqual(client.get(path).headers["Cache-Control"], "no-store")

        handler = DummyRequestHandler.__new__(DummyRequestHandler)
        identity = handler.version_string()
        self.assertEqual(identity, "ProjectManagementSystem")
        self.assertNotIn("Werkzeug", identity)
        self.assertNotIn("Python", identity)


if __name__ == "__main__":
    unittest.main()
