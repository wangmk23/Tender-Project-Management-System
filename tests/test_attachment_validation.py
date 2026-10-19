"""Content checks run before the preserved encrypted attachment writer."""
import importlib
import io
import unittest
import zipfile

from flask import Flask, jsonify, request
from PIL import Image


def office(kind):
    target = {'docx': 'word/document.xml', 'xlsx': 'xl/workbook.xml', 'pptx': 'ppt/presentation.xml'}[kind]
    raw = io.BytesIO()
    with zipfile.ZipFile(raw, 'w', zipfile.ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<Types/>')
        archive.writestr('_rels/.rels', '<Relationships/>')
        archive.writestr(target, '<document/>')
    return raw.getvalue()


class AttachmentValidationTests(unittest.TestCase):
    def setUp(self):
        self.app = Flask(__name__)
        self.app.secret_key = 'isolated-test-only'
        self.persisted = []

        @self.app.post('/api/projects/<int:project_id>/attachments')
        def upload(project_id):
            values = [file.read() for file in request.files.getlist('files')]
            self.persisted.extend(values)
            return jsonify(saved=len(values))

        try:
            module = importlib.import_module('src.backend_patches.attachment_validation')
        except ModuleNotFoundError:
            module = None
        if module:
            module.register(self.app)
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session['user_id'] = 1

    def send(self, name, raw):
        return self.client.post('/api/projects/3/attachments', data={'files': (io.BytesIO(raw), name)})

    def test_html_disguised_as_pdf_never_reaches_writer(self):
        response = self.send('fake.pdf', b'<html><script>alert(1)</script></html>')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.persisted, [])
        self.assertEqual(response.json['code'], 'attachment_content_invalid')

    def test_valid_binary_and_office_streams_are_rewound_unchanged(self):
        fixtures = {'test.pdf': b'%PDF-1.4\n1 0 obj <<>> endobj\n%%EOF\n',
                    'test.png': b'\x89PNG\r\n\x1a\n' + b'\0\0\0\rIHDR' + bytes(13) + bytes(4) + b'\0\0\0\0IEND\xaeB`\x82',
                    'test.txt': '隔离资料'.encode(), 'test.csv': b'name,value\nx,1',
                    'test.json': b'{"ok":true}', 'test.xml': b'<?xml version="1.0"?><data/>'}
        fixtures.update({f'test.{kind}': office(kind) for kind in ('docx', 'xlsx', 'pptx')})
        for extension, image_format in [('png', 'PNG'), ('jpg', 'JPEG'), ('jpeg', 'JPEG'), ('gif', 'GIF'), ('bmp', 'BMP'), ('webp', 'WEBP')]:
            buffer = io.BytesIO()
            Image.new('RGB', (12, 12), '#2563eb').save(buffer, format=image_format)
            fixtures['image.' + extension] = buffer.getvalue()
        for extension in ('doc', 'xls', 'ppt'):
            # The light legacy check verifies the OLE container signature only;
            # historical Office content parsing remains the native app's job.
            fixtures['legacy.' + extension] = b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1' + bytes(504)
        fixtures['archive.7z'] = b"7z\xbc\xaf'\x1c" + bytes(26)
        fixtures['archive.rar'] = b'Rar!\x1a\x07\x00' + bytes(8)
        archive = io.BytesIO()
        with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED) as output:
            output.writestr('folder/example.txt', 'normal archive')
        fixtures['archive.zip'] = archive.getvalue()
        for name, raw in fixtures.items():
            with self.subTest(name=name):
                self.assertEqual(self.send(name, raw).status_code, 200)
                self.assertEqual(self.persisted[-1], raw)

    def test_legacy_biff2_and_spreadsheetml_xls_remain_valid(self):
        # Official pinned SheetJS writer output for supplier/company and amount/100.
        biff=bytes.fromhex('09000400020010001e0008000747656e6572616c4300040000000000040010000000000000000008737570706c69657204000e000000010000000006616d6f756e7404000f000100000000000007636f6d70616e79020009000100010000000064000a000000')
        xml=b'<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet><Table><Row><Cell><Data>company</Data></Cell></Row></Table></Worksheet></Workbook>'
        for raw in (biff,xml):
            with self.subTest(format=raw[:8]):
                self.assertEqual(self.send('valid-export.xls',raw).status_code,200)
                self.assertEqual(self.persisted[-1],raw)
        for raw in (biff[:-1],biff[:8]+b'\x04\x00\xff\xff'+b'x',
                    b'<Workbook><Worksheet><Table/></Worksheet></Workbook>'):
            with self.subTest(invalid=raw[:8]):
                self.assertEqual(self.send('invalid.xls',raw).status_code,400)

    def test_fake_binary_formats_and_wrong_office_container_are_rejected(self):
        for suffix in ('pdf', 'png', 'jpg', 'gif', 'bmp', 'webp', 'doc', 'xls', 'ppt', 'zip', 'rar', '7z', 'exe'):
            with self.subTest(suffix=suffix):
                self.assertEqual(self.send('fake.' + suffix, b'<html>fake</html>').status_code, 400)
        self.assertEqual(self.send('wrong.xlsx', office('docx')).status_code, 400)
        self.assertEqual(self.persisted, [])

    def test_utf16_xml_entity_declaration_is_rejected_before_expansion(self):
        raw = '<!DOCTYPE data [<!ENTITY value "expanded">]><data>&value;</data>'.encode('utf-16')
        self.assertEqual(self.send('entity.xml', raw).status_code, 400)
        self.assertEqual(self.persisted, [])

    def test_zip_bomb_and_traversal_members_are_rejected(self):
        for name, content in [('bomb.txt', bytes(2 * 1024 * 1024)), ('../outside.txt', b'bad')]:
            raw = io.BytesIO()
            with zipfile.ZipFile(raw, 'w', zipfile.ZIP_DEFLATED) as archive:
                archive.writestr(name, content)
            self.assertEqual(self.send('unsafe.zip', raw.getvalue()).status_code, 400)
        self.assertEqual(self.persisted, [])

    def test_excessively_nested_json_returns_validation_error_not_server_error(self):
        raw = (10000 * '[' + '0' + 10000 * ']').encode()
        self.assertEqual(self.send('nested.json', raw).status_code, 400)
        self.assertEqual(self.persisted, [])

    def test_mixed_batch_is_rejected_before_any_file_is_written(self):
        response = self.client.post('/api/projects/3/attachments', data={'files': [
            (io.BytesIO(b'plain text'), 'good.txt'), (io.BytesIO(b'<html/>'), 'bad.pdf')]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.persisted, [])


if __name__ == '__main__':
    unittest.main()
