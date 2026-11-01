"""Fail-closed and synthetic-fixture checks for actual PDF EXE acceptance."""
import contextlib
import hashlib
import io
import json
from pathlib import Path
import re
import tempfile
import unittest
from unittest.mock import patch

from tools import verify_pdf_reader_release as pdf


class PdfReaderReleaseVerifierTests(unittest.TestCase):
    def test_fresh_custom_catalog_is_selected_by_enabled_identity_not_regime(self):
        class Client:
            def request(self, method, path, payload=None):
                if method == 'GET':
                    return {'methods': [dict(id='disabled',name='公开招标',regime='government_procurement',enabled=False,user_owned=True),
                                        dict(id='custom',name='自建采购',regime=None,enabled=True,user_owned=True)]}
                self.payload=payload
                return {'id': 42}
        client=Client()
        self.assertEqual(pdf.seed_project(client),{'id':42})
        self.assertEqual(client.payload['procurement_method_id'],'custom')
        self.assertNotIn('method',client.payload)

    def test_cli_requires_candidate_hash_and_evidence(self):
        for args in ([], ['--candidate', 'candidate.exe'],
                     ['--candidate', 'candidate.exe', '--candidate-sha256', 'a' * 64]):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                pdf.parser().parse_args(args)
            self.assertEqual(error.exception.code, 2)

    def test_malformed_hash_is_rejected_before_runtime_start(self):
        for digest in ('', 'skip', 'a' * 63, 'g' * 64):
            with self.subTest(digest=digest), self.assertRaisesRegex(ValueError, '64'):
                pdf.validate_candidate(Path('missing.exe'), digest)

    def test_altered_candidate_fails_and_writes_failed_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            directory = Path(temp)
            candidate = directory / 'synthetic-not-executable.exe'
            candidate.write_bytes(b'not an actual executable; validation must prevent launch')
            args = pdf.parser().parse_args(['--candidate', str(candidate), '--candidate-sha256', 'a' * 64,
                                          '--evidence', str(directory / 'evidence')])
            with patch('tools.release_browser.sys.platform', 'win32'):
                result = pdf.run(args)
            self.assertFalse(result['passed'])
            self.assertIn('hash mismatch', result['error'])
            self.assertGreater(result['failed'], 0)
            evidence = json.loads((args.evidence / 'pdf-reader-exe-acceptance.json').read_text('utf-8'))
            self.assertFalse(evidence['passed'])
            self.assertFalse(evidence['physical_print_verified'])

    def test_report_cannot_pass_if_required_gates_were_omitted(self):
        report = pdf.Report()
        report.check('candidate', lambda: True)
        result = report.result()
        self.assertFalse(result['passed'])
        self.assertIn('browser', result['missing_required_checks'])
        self.assertFalse(result['native_desktop_verified'])
        self.assertFalse(result['actual_phone_verified'])

    def test_urls_remain_in_exact_attachment_and_owned_origin(self):
        base = 'http://127.0.0.1:12345'
        path = '/api/attachments/7/download?preview=1'
        self.assertEqual(pdf.attachment_url(base, 7, path), base + path)
        for value in ('https://example.com/x', '//example.com/x', '/api/attachments/8/view',
                      '/api/attachments/7/../settings', '/api/attachments/7/%76iew',
                      'http://user@127.0.0.1:12345/api/attachments/7/view', path + '#fragment'):
            with self.subTest(value=value), self.assertRaises(ValueError):
                pdf.attachment_url(base, 7, value)

    def test_text_fixtures_have_real_xref_nested_bookmarks_and_internal_link(self):
        with tempfile.TemporaryDirectory() as temp:
            fixtures = pdf.make_fixtures(Path(temp))
            for name, count in (('short', 3), ('long', 269)):
                body = fixtures[name].read_bytes()
                self.assertTrue(body.startswith(b'%PDF-1.4'))
                self.assertEqual(len(re.findall(rb'/Type /Page\b', body)), count)
                self.assertEqual(body.count(b'ProjectNeedle'), count)
                self.assertIn(b'/Title (Chapters)', body)
                self.assertIn(b'/Title (Final section)', body)
                self.assertIn(b'/Subtype /Link', body)
                self.assertNotIn(b'/URI', body)
                start = int(re.search(rb'startxref\n(\d+)\n', body).group(1))
                self.assertEqual(body[start:start + 4], b'xref')
                entries = body[start:].split(b'0000000000 65535 f \n', 1)[1].split(b'trailer', 1)[0].splitlines()
                for index, entry in enumerate(entries, 1):
                    offset = int(entry[:10])
                    self.assertTrue(body[offset:].startswith(f'{index} 0 obj\n'.encode()))

    def test_scan_fixture_is_an_image_without_searchable_text_or_fake_bookmarks(self):
        with tempfile.TemporaryDirectory() as temp:
            body = pdf.make_fixtures(Path(temp))['scan'].read_bytes()
            self.assertIn(b'/Subtype /Image', body)
            self.assertNotIn(b'BT ', body)
            self.assertNotIn(b'/Outlines', body)
            self.assertNotIn(b'ProjectNeedle', body)

    def test_automatic_print_fixture_contains_an_actual_pdf_named_open_action(self):
        with tempfile.TemporaryDirectory() as temp:
            fixtures = pdf.make_fixtures(Path(temp))
            self.assertIn('autoprint', fixtures)
            self.assertIn(b'/OpenAction << /S /Named /N /Print >>', fixtures['autoprint'].read_bytes())

    def test_print_preparation_requires_native_stub_and_all_rendered_images(self):
        for value in ({'calls': 0, 'images': []}, {'calls': 1, 'images': []},
                      {'calls': 1, 'images': [True, False, True]}, {'calls': 1, 'images': [True]}):
            with self.subTest(value=value), self.assertRaises(AssertionError):
                pdf.validate_print_snapshot(value, pages=3)
        result = pdf.validate_print_snapshot({'calls': 1, 'images': [True, True, True]}, pages=3)
        self.assertEqual(result['rendered_pages'], 3)
        self.assertFalse(result['physical_print_verified'])

    @contextlib.contextmanager
    def _http_preflight_client(self, change=None):
        from flask import Flask
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as temporary:
            root=Path(temporary);(root/'pdf-reader').mkdir()
            (root/'pdf-reader/index.html').write_text('<p>Owned reader shell</p>','utf-8')
            locale=root/'libs/pdfjs-reader/6.4.299/web/locale'
            (locale/'zh-CN').mkdir(parents=True)
            (locale/'locale.json').write_text(json.dumps({'zh-cn':'zh-CN/viewer.ftl'}),'utf-8')
            (locale/'zh-CN/viewer.ftl').write_text('pdfjs-previous-button-label = 上一页\npdfjs-next-button-label = 下一页\npdfjs-print-button-label = 打印\n','utf-8')
            app=Flask(__name__,static_folder=str(root),static_url_path='/static')
            @app.get('/login')
            def login():return 'login'
            @app.after_request
            def framing(response):
                from flask import request
                if request.path=='/static/pdf-reader/index.html':
                    response.headers['X-Frame-Options']='SAMEORIGIN'
                    response.headers.add('Content-Security-Policy',"default-src 'self'")
                    response.headers.add('Content-Security-Policy',"frame-ancestors 'self'")
                else:response.headers['X-Frame-Options']='DENY'
                if change:change(request,response)
                return response
            client=app.test_client()
            class Session:
                def get(self,url,*,headers=None,timeout=None,allow_redirects=None):
                    self_outer.assertFalse(allow_redirects)
                    self_outer.assertEqual(timeout,20)
                    response=client.get(url,headers=headers or {},buffered=True)
                    response.content=response.get_data()
                    response.raw=SimpleNamespace(headers=response.headers)
                    return response
            self_outer=self
            yield SimpleNamespace(base_url='http://localhost',session=Session())

    def test_http_preflight_checks_real_conditional_range_and_multivalue_csp(self):
        with self._http_preflight_client() as client:
            result=pdf.http_reader_checks(client)
        self.assertEqual([result[key]['status'] for key in ('shell','conditional','range','login')],[200,304,206,200])
        self.assertEqual(result['range']['bytes'],16)
        self.assertEqual(len(result['shell']['content_security_policy']),2)

    def test_http_preflight_rejects_changed_framing_on_cached_or_partial_shell(self):
        for status in (200,304,206):
            with self.subTest(status=status):
                def change(request,response):
                    if request.path.endswith('/index.html') and response.status_code==status:
                        response.headers['X-Frame-Options']='DENY'
                with self._http_preflight_client(change) as client,self.assertRaisesRegex(AssertionError,'SAMEORIGIN'):
                    pdf.http_reader_checks(client)

    def test_http_preflight_requires_exact_conditional_and_range_status(self):
        for status in (304,206):
            with self.subTest(status=status):
                def change(request,response):
                    if response.status_code==status:response.status_code=200
                with self._http_preflight_client(change) as client,self.assertRaisesRegex(AssertionError,str(status)):
                    pdf.http_reader_checks(client)

    def test_http_preflight_rejects_missing_permissive_or_conflicting_frame_ancestors(self):
        for value in ('',"frame-ancestors *","frame-ancestors 'none'"):
            with self.subTest(value=value):
                def change(request,response):
                    if request.path.endswith('/index.html'):
                        del response.headers['Content-Security-Policy']
                        response.headers.add('Content-Security-Policy',value)
                with self._http_preflight_client(change) as client,self.assertRaisesRegex(AssertionError,'frame-ancestors'):
                    pdf.http_reader_checks(client)

    def test_http_preflight_rejects_missing_etag_or_relaxed_login_framing(self):
        for field in ('etag','login'):
            with self.subTest(field=field):
                def change(request,response):
                    if field=='etag' and request.path.endswith('/index.html'):response.headers.pop('ETag',None)
                    if field=='login' and request.path=='/login':response.headers['X-Frame-Options']='SAMEORIGIN'
                with self._http_preflight_client(change) as client,self.assertRaises(AssertionError):
                    pdf.http_reader_checks(client)

    def test_report_requires_http_preflight_even_when_all_other_checks_passed(self):
        report=pdf.Report()
        for name in pdf.REQUIRED_CHECKS-{'http framing'}:report.check(name,lambda:True)
        self.assertFalse(report.result()['passed'])
        self.assertIn('http framing',report.result()['missing_required_checks'])

    def test_open_action_bridge_preserves_pdfjs_map_entries_before_serialization(self):
        import subprocess
        for value in ("new Map([['action','Print']])","({action:'Print'})"):
            with self.subTest(value=value):
                script=("const PDFViewerApplication={pdfDocument:{getOpenAction:async()=>"+value+"}};"
                        "const result=await ("+pdf.OPEN_ACTION_SCRIPT+")();process.stdout.write(JSON.stringify(result));")
                result=subprocess.check_output(['node','--input-type=module','-e',script],text=True)
                self.assertEqual(json.loads(result),{'action':'Print'})

    def test_http_preflight_rejects_locale_failure_instead_of_accepting_english_fallback(self):
        def change(request,response):
            if request.path.endswith('/locale.json'):response.status_code=500
        with self._http_preflight_client(change) as client,self.assertRaisesRegex(AssertionError,'locale.*200'):
            pdf.http_reader_checks(client)

    def test_http_preflight_requires_valid_chinese_mapping_and_translated_labels(self):
        for variant in ('invalid-json','english-only','translation-missing'):
            with self.subTest(variant=variant):
                def change(request,response):
                    if request.path.endswith('/locale.json') and variant!='translation-missing':
                        response.direct_passthrough=False
                        response.set_data('invalid' if variant=='invalid-json' else '{"en-us":"en-US/viewer.ftl"}')
                    if request.path.endswith('/zh-CN/viewer.ftl') and variant=='translation-missing':
                        response.direct_passthrough=False;response.set_data('pdfjs-print-button-label = Print')
                with self._http_preflight_client(change) as client,self.assertRaises(AssertionError):
                    pdf.http_reader_checks(client)


if __name__ == '__main__':
    unittest.main()
