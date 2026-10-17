import io
import json
import tempfile
import unittest
import warnings
import zipfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
from xml.sax.saxutils import escape

from flask import Flask
from src.backend_patches import holiday_calendar as hc, calendar_service as cs


def workbook(rows, *, date1904=False, raw_cells=False, extra=None):
    """Independent small Excel fixture, including numeric date styles."""
    entries = {
        '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
        'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><workbookPr date1904="%s"/><sheets><sheet name="放假调休安排" sheetId="1" r:id="rId1"/></sheets></workbook>' % int(date1904),
        'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Target="worksheets/sheet1.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"/></Relationships>',
        'xl/styles.xml': '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><cellXfs count="2"><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs></styleSheet>',
    }
    all_rows = [('开始日期', '结束日期', '安排', '节日名称')] + rows
    contents = []
    for number, row in enumerate(all_rows, 1):
        cells = []
        for column, value in zip('ABCD', row):
            if raw_cells and number > 1 and str(value).startswith('<c '):
                cells.append(value.replace('{r}', column + str(number)))
            else:
                cells.append('<c r="%s%d" t="inlineStr"><is><t>%s</t></is></c>' % (column, number, escape(str(value))))
        contents.append('<row r="%d">%s</row>' % (number, ''.join(cells)))
    entries['xl/worksheets/sheet1.xml'] = '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>%s</sheetData></worksheet>' % ''.join(contents)
    entries.update(extra or {})
    target = io.BytesIO()
    with zipfile.ZipFile(target, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name, value in entries.items(): archive.writestr(name, value)
    return target.getvalue()


class HolidayImportTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.folder = Path(self.temp.name) / 'holiday_calendar'
        self.app = Flask(__name__)
        self.app.secret_key = 'isolated-test-key'
        self.user = SimpleNamespace(id=1, is_active=True, is_admin=True, username='管理员')
        self.db = SimpleNamespace(session=SimpleNamespace(get=lambda *args: self.user))
        self.models = dict(User=object, Project=object, DATA_DIR=self.temp.name,
                           load_app_settings=lambda: {}, save_app_settings=lambda value: None)
        self.app.extensions['calendar_impact_provider'] = lambda year, data: [dict(id=7, title='公告期限', year=year)]
        cs.register(self.app, self.db, self.models)
        self.client = self.app.test_client()
        with self.client.session_transaction() as session:
            session['user_id'] = 1
            session['csrf_token'] = 'csrf'

    def hi(self):
        from src.backend_patches import holiday_import
        return holiday_import

    def preview(self, rows=None, year=2027, base=0, raw=None, client=None):
        response = (client or self.client).post('/api/holiday-calendar/import/preview', data={
            'year': str(year), 'base_revision': str(base),
            'file': (io.BytesIO(raw or workbook(rows or [('2027-01-01', '2027-01-03', '放假', '元旦'), ('2027-01-09', '', '补班', '元旦调休')])), '安排.xlsx')}, headers={'X-CSRFToken': 'csrf'})
        response.request.environ['wsgi.input'].close()
        return response

    def commit(self, token, client=None):
        return (client or self.client).post('/api/holiday-calendar/import/commit', json=dict(token=token, confirm_complete=True), headers={'X-CSRFToken': 'csrf'})

    def test_template_blank_data_and_current_export_roundtrip(self):
        response = self.client.get('/api/holiday-calendar/template?year=2027')
        self.assertEqual(response.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:
            book = archive.read('xl/workbook.xml').decode()
            self.assertIn('填写说明', book)
            self.assertIn('放假调休安排', book)
            sheet = archive.read('xl/worksheets/sheet2.xml').decode()
            self.assertIn('dataValidation', sheet)
            self.assertNotIn('2027-01-01', sheet)
        exported = self.client.get('/api/holiday-calendar/export?year=2026')
        parsed = self.hi().parse_xlsx(exported.data, 2026)
        self.assertEqual(parsed['holidays'], hc.get_calendar(2026)['holidays'])
        self.assertEqual(parsed['workdays'], hc.get_calendar(2026)['workdays'])

    def test_desktop_template_and_export_save_to_configured_folder_without_overwrite(self):
        destination=Path(self.temp.name)/'指定保存目录'
        self.models['get_export_dir']=lambda:destination
        self.app.config['IS_DESKTOP']=True
        for kind in ('template','export'):
            url=f'/api/holiday-calendar/{kind}?year=2026&save=1'
            responses=[self.client.post(url,headers={'X-CSRFToken':'csrf'}),self.client.get(url,headers={'X-CSRFToken':'csrf'})]
            for response in responses:
                self.assertTrue(response.is_json, response.content_type)
                self.assertEqual(response.status_code,200,response.json)
                path=Path(response.json['path'])
                self.assertEqual(path.parent,destination)
                self.assertTrue(path.is_file())
                with zipfile.ZipFile(path) as archive:self.assertIsNone(archive.testzip())
            self.assertNotEqual(responses[0].json['path'],responses[1].json['path'])

    def test_disk_save_requires_local_desktop_and_csrf_and_reports_write_failure(self):
        destination=Path(self.temp.name)/'downloads'
        self.models['get_export_dir']=lambda:destination
        url='/api/holiday-calendar/template?year=2026&save=1'
        self.assertEqual(self.client.get(url,headers={'X-CSRFToken':'csrf'}).status_code,403)
        self.app.config['IS_DESKTOP']=True
        self.assertEqual(self.client.get(url,headers={'X-CSRFToken':'csrf'},environ_overrides={'REMOTE_ADDR':'192.168.1.9'}).status_code,403)
        self.assertEqual(self.client.get(url).status_code,403)
        self.assertFalse(destination.exists())
        def denied():raise PermissionError('synthetic inaccessible folder')
        self.models['get_export_dir']=denied
        response=self.client.get(url,headers={'X-CSRFToken':'csrf'})
        self.assertEqual(response.status_code,503)
        self.assertIn('文件保存',response.json['error'])

    def test_failed_new_file_write_removes_only_partial_file_and_preserves_existing_download(self):
        from unittest.mock import patch
        destination=Path(self.temp.name)/'downloads';destination.mkdir()
        original=destination/'2026年放假调休安排模板.xlsx';original.write_bytes(b'original download')
        self.models['get_export_dir']=lambda:destination;self.app.config['IS_DESKTOP']=True
        real_open=Path.open
        class InterruptedWriter:
            def __init__(self,stream):self.stream=stream
            def __enter__(self):return self
            def __exit__(self,*args):self.stream.close()
            def write(self,body):self.stream.write(body[:7]);raise PermissionError('synthetic write interrupted')
        def interrupted(path,mode='r',*args,**kwargs):
            stream=real_open(path,mode,*args,**kwargs)
            return InterruptedWriter(stream) if mode=='xb' and path.parent==destination else stream
        with patch.object(Path,'open',interrupted):
            response=self.client.post('/api/holiday-calendar/template?year=2026&save=1',headers={'X-CSRFToken':'csrf'})
        self.assertEqual(response.status_code,503)
        self.assertEqual(original.read_bytes(),b'original download')
        self.assertEqual(list(destination.iterdir()),[original])

    def test_preview_does_not_activate_commit_is_manual_and_roundtrips(self):
        response = self.preview()
        self.assertEqual(response.status_code, 200, response.json)
        data = response.json
        self.assertEqual(data['status'], 'ready')
        self.assertEqual(data['summary']['holidays'], 3)
        self.assertFalse(hc.get_calendar(2027, self.folder)['version'])
        saved = self.commit(data['token'])
        self.assertEqual(saved.status_code, 200, saved.json)
        self.assertTrue(saved.json['changed'])
        active = hc.get_calendar(2027, self.folder)
        self.assertEqual(active['origin'], 'manual_import')
        self.assertEqual(active['source_url'], '')
        self.assertTrue(active['confirmed'])
        self.assertEqual(active['local_revision'], 1)
        self.assertEqual(hc.day_info('2027-01-09', cache_dir=self.folder)['status'], 'workday')
        exported = self.client.get('/api/holiday-calendar/export?year=2027')
        self.assertEqual(self.hi().parse_xlsx(exported.data, 2027)['workday_names']['2027-01-09'], '元旦调休')
        again = self.commit(data['token'])
        self.assertEqual(again.status_code, 409)

    def test_invalid_rows_formulas_and_unsafe_archive_cannot_change_calendar(self):
        invalid = [
            [('2027-12-31', '2028-01-02', '放假', '跨年')],
            [('2027-02-29', '', '放假', '不存在')],
            [('2027-01-02', '2027-01-01', '放假', '倒置')],
            [('2027-01-01', '', '放假', '甲'), ('2027-01-01', '', '补班', '乙')],
            [('01/02/2027', '', '放假', '地区格式')],
            [('2027-01-01', '', '上班', '错误安排')],
        ]
        for rows in invalid:
            with self.subTest(rows=rows):
                response = self.preview(rows)
                self.assertEqual(response.status_code, 400, response.json)
                self.assertTrue(response.json['errors'][0]['row'])
        malicious = [workbook([('<c r="{r}"><f>TODAY()</f><v>1</v></c>', '', '放假', '公式')], raw_cells=True),
                     workbook([], extra={'xl/vbaProject.bin': b'VBA'}),
                     workbook([], extra={'custom.xml': '<!DOCTYPE a [<!ENTITY b "x">]><a/>'}),
                     workbook([], extra={'_rels/.rels': '<Relationships><Relationship TargetMode="External" Target="https://example.com"/></Relationships>'})]
        for raw in malicious:
            with self.subTest(raw_length=len(raw)):
                self.assertEqual(self.preview(raw=raw).status_code, 400)
        self.assertFalse((self.folder / 'active.json').exists())

    def test_archive_limits_and_duplicate_members(self):
        duplicate = io.BytesIO(workbook([]))
        with warnings.catch_warnings():
            warnings.simplefilter('ignore', UserWarning)
            with zipfile.ZipFile(duplicate, 'a') as archive: archive.writestr('xl/styles.xml', '<a/>')
        self.assertEqual(self.preview(raw=duplicate.getvalue()).status_code, 400)
        huge = workbook([], extra={'huge.xml': b' ' * (4 * 1024 * 1024 + 1)})
        self.assertEqual(self.preview(raw=huge).status_code, 413)
        self.assertEqual(self.preview(raw=b'x' * (2 * 1024 * 1024 + 1)).status_code, 413)
        many = workbook([], extra={f'part{i}.xml': '<a/>' for i in range(130)})
        self.assertEqual(self.preview(raw=many).status_code, 413)

    def test_excel_1900_and_1904_numeric_dates(self):
        # 2027-01-01 = 46388 in 1900 dates, 44926 in 1904 dates.
        for serial, system in [(46388, False), (44926, True)]:
            raw = workbook([('<c r="{r}" s="1"><v>%d</v></c>' % serial, '', '放假', '元旦')], date1904=system, raw_cells=True)
            parsed = self.hi().parse_xlsx(raw, 2027)
            self.assertEqual(parsed['holidays'], [{'date': '2027-01-01', 'name': '元旦'}])

    def test_same_content_no_revision_and_restore_creates_revision(self):
        first = self.preview().json
        self.assertEqual(self.commit(first['token']).status_code, 200)
        same = self.preview(base=1).json
        self.assertFalse(self.commit(same['token']).json['changed'])
        second = self.preview([('2027-01-02', '', '放假', '调整')], base=1).json
        self.assertEqual(self.commit(second['token']).status_code, 200)
        history = self.client.get('/api/holiday-calendar/history?year=2027').json
        self.assertEqual(len(history['items']), 2)
        restore = self.client.post('/api/holiday-calendar/restore/preview', json=dict(year=2027, revision=1, base_revision=2), headers={'X-CSRFToken': 'csrf'})
        self.assertEqual(restore.status_code, 200, restore.json)
        result = self.commit(restore.json['token'])
        self.assertEqual(result.json['calendar']['local_revision'], 3)
        self.assertEqual(len(result.json['calendar']['holidays']), 3)
        self.assertEqual(self.client.get('/api/holiday-calendar/history?year=2027').json['items'][0]['operation'], 'restore')

    def test_concurrent_years_preserved_same_year_conflicts(self):
        first = self.preview().json
        stale = self.preview([('2027-02-01', '', '放假', '不同')]).json
        other = self.preview([('2028-01-01', '', '放假', '元旦')], year=2028).json
        # Exercise two independent HTTP clients carrying the same signed session.
        cookie = self.client.get_cookie('session')
        def bound_save(token):
            with self.app.test_client() as client:
                client.set_cookie('session', cookie.value)
                return self.commit(token, client).status_code
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(bound_save, [first['token'], other['token']]))
        self.assertEqual(results, [200, 200])
        self.assertEqual(self.commit(stale['token']).status_code, 409)
        self.assertEqual(hc.get_calendar(2027, self.folder)['local_revision'], 1)
        self.assertEqual(hc.get_calendar(2028, self.folder)['local_revision'], 1)

    def test_expiry_other_session_csrf_admin_and_missing_impact_provider(self):
        response = self.preview(); token = response.json['token']
        other = self.app.test_client()
        with other.session_transaction() as session:
            session['user_id'] = 1; session['csrf_token'] = 'csrf'
        self.assertEqual(self.commit(token, other).status_code, 404)
        preview_path = self.folder / 'previews' / f'{token}.json'
        stored = json.loads(preview_path.read_text('utf-8'))
        stored['expires_at'] = 1
        preview_path.write_text(json.dumps(stored), encoding='utf-8')
        self.assertEqual(self.commit(token).status_code, 410)
        self.assertEqual(self.client.post('/api/holiday-calendar/import/commit', json=dict(token=token, confirm_complete=True)).status_code, 403)
        self.user.is_admin = False
        self.assertEqual(self.preview().status_code, 403)
        self.user.is_admin = True
        self.user.is_active = False
        self.assertEqual(self.client.get('/api/holiday-calendar?year=2026').status_code, 401)
        self.user.is_active = True
        del self.app.extensions['calendar_impact_provider']
        incomplete = self.preview()
        self.assertEqual(incomplete.json['status'], 'impact_unavailable')
        self.assertIsNone(incomplete.json['impacts']['total'])
        self.assertEqual(self.commit(incomplete.json['token']).status_code, 503)

    def test_index_failure_keeps_old_calendar_and_corruption_is_explicit(self):
        first = self.preview().json
        self.assertEqual(self.commit(first['token']).status_code, 200)
        second = self.preview([('2027-02-01', '', '放假', '二月')], base=1).json
        original = self.hi().os.replace
        def fail_index(source, destination):
            if Path(destination).name == 'active.json': raise OSError('disk failure')
            return original(source, destination)
        with patch.object(self.hi().os, 'replace', side_effect=fail_index):
            self.assertEqual(self.commit(second['token']).status_code, 503)
        self.assertEqual(hc.get_calendar(2027, self.folder)['holidays'][0]['date'], '2027-01-01')
        (self.folder / 'active.json').write_text('{broken', encoding='utf-8')
        with self.assertRaises(hc.HolidayDataUnavailable): hc.get_calendar(2027, self.folder)

    def test_network_update_routes_and_weekly_check_never_fetch(self):
        with patch.object(hc.urllib.request, 'urlopen', side_effect=AssertionError('network forbidden')):
            response = self.client.post('/api/holiday-calendar/update', json=dict(year=2026), headers={'X-CSRFToken': 'csrf'})
            self.assertEqual(response.status_code, 410)
            self.assertIn('导入', response.json['error'])
            cs.check_updates(self.temp.name)
        self.assertFalse((self.folder / 'update_status.json').exists())

    def test_preview_pagination_persisted_bounds_and_failed_scan(self):
        self.app.extensions['calendar_impact_provider'] = lambda year, data: [dict(id=i) for i in range(123)]
        first = self.preview().json
        self.assertEqual(first['impacts']['total'], 123)
        self.assertEqual(len(first['impacts']['items']), 50)
        second = self.client.get('/api/holiday-calendar/import/previews/' + first['token'] + '?page=2')
        self.assertEqual(second.status_code, 200)
        self.assertEqual(second.json['impacts']['items'][0], {'id': 50})
        self.assertEqual(self.client.get('/api/holiday-calendar/import/previews/' + first['token'] + '?page=0').status_code, 400)
        with patch.object(self.hi(), 'MAX_PREVIEWS', 1):
            self.assertEqual(self.preview().status_code, 503)
        def failed(year, snapshot): raise RuntimeError('unavailable')
        self.app.extensions['calendar_impact_provider'] = failed
        with self.assertLogs(self.app.logger, level='WARNING'):
            result = self.preview().json
        self.assertEqual(result['status'], 'impact_unavailable')
        self.assertIsNone(result['impacts']['total'])

    def test_names_are_text_and_optional_source_is_attributed_without_verification(self):
        raw = workbook([('2027-01-01', '', '放假', '=HYPERLINK("https://example.com", "节日")')])
        response = self.client.post('/api/holiday-calendar/import/preview', data={
            'year': '2027', 'base_revision': '0', 'document': '年度通知 <测试>',
            'source_url': 'https://example.com/notice', 'file': (io.BytesIO(raw), '安排.xlsx')}, headers={'X-CSRFToken': 'csrf'})
        self.assertEqual(response.status_code, 200, response.json)
        saved = self.commit(response.json['token']).json['calendar']
        self.assertEqual(saved['document'], '年度通知 <测试>')
        self.assertEqual(saved['source_url'], 'https://example.com/notice')
        self.assertEqual(saved['origin'], 'manual_import')
        exported = self.client.get('/api/holiday-calendar/export?year=2027')
        with zipfile.ZipFile(io.BytesIO(exported.data)) as archive:
            xml = archive.read('xl/worksheets/sheet2.xml').decode()
            self.assertNotIn('<f>', xml)
            self.assertIn('=HYPERLINK', xml)

    def test_legacy_source_preserved_and_archived_before_first_manual_commit(self):
        self.folder.mkdir(parents=True)
        original = json.dumps(hc.get_calendar(2026), ensure_ascii=False).encode('utf-8')
        (self.folder / '2026.json').write_bytes(original)
        preview = self.preview([('2026-01-01', '', '放假', '人工修订')], year=2026)
        self.assertEqual(preview.status_code, 200)
        self.assertEqual(self.commit(preview.json['token']).status_code, 200)
        self.assertEqual((self.folder / '2026.json').read_bytes(), original)
        archived = list((self.folder / 'legacy').glob('2026-*.json'))
        self.assertEqual(len(archived), 1)
        self.assertEqual(json.loads(archived[0].read_text('utf-8'))['holidays'][0]['date'], '2026-01-01')
        history = self.client.get('/api/holiday-calendar/history?year=2026').json['items']
        self.assertEqual([item['operation'] for item in history], ['import', 'baseline'])
        restored = self.client.post('/api/holiday-calendar/restore/preview', json=dict(year=2026, revision=history[1]['revision'], base_revision=history[0]['revision']), headers={'X-CSRFToken': 'csrf'})
        result = self.commit(restored.json['token'])
        self.assertEqual(result.status_code, 200)
        self.assertEqual(len(result.json['calendar']['holidays']), 33)

    def test_embedded_2026_is_restorable_after_replacement(self):
        response = self.preview([('2026-01-01', '', '放假', '人工修订')], year=2026)
        self.commit(response.json['token'])
        history = self.client.get('/api/holiday-calendar/history?year=2026').json['items']
        self.assertEqual(history[-1]['operation'], 'baseline')
        restored = self.client.post('/api/holiday-calendar/restore/preview', json=dict(year=2026, revision=history[-1]['revision'], base_revision=history[0]['revision']), headers={'X-CSRFToken': 'csrf'})
        result = self.commit(restored.json['token'])
        self.assertEqual(result.status_code, 200)
        self.assertEqual(result.json['calendar']['source_url'], hc.SOURCE)
        self.assertEqual(len(result.json['calendar']['workdays']), 6)

    def test_disabled_account_cannot_change_reminder_preferences(self):
        self.user.is_active = False
        response = self.client.post('/api/holiday-calendar/preferences', json=dict(use_national_workdays=True), headers={'X-CSRFToken': 'csrf'})
        self.assertEqual(response.status_code, 401)

    def test_restore_current_content_still_records_a_new_restore_revision(self):
        first = self.preview().json
        self.commit(first['token'])
        restored = self.client.post('/api/holiday-calendar/restore/preview', json=dict(year=2027, revision=1, base_revision=1), headers={'X-CSRFToken': 'csrf'})
        result = self.commit(restored.json['token'])
        self.assertEqual(result.status_code, 200)
        self.assertFalse(result.json['changed'])
        self.assertEqual(result.json['calendar']['local_revision'], 2)
        self.assertEqual(self.client.get('/api/holiday-calendar/history?year=2027').json['items'][0]['operation'], 'restore')

    def test_impact_callback_receives_calculable_proposed_snapshot(self):
        def provider(year, snapshot):
            self.assertEqual(year, 2027)
            self.assertTrue(snapshot['confirmed'])
            self.assertEqual(snapshot['version'], 1)
            self.assertEqual(snapshot['local_revision'], 1)
            self.assertEqual(snapshot['origin'], 'manual_import')
            self.assertTrue(snapshot['is_preview'])
            self.assertEqual(len(snapshot['sha256']), 64)
            self.assertEqual(hc.day_info('2027-01-01', snapshot)['status'], 'holiday')
            return []
        self.app.extensions['calendar_impact_provider'] = provider
        response = self.preview()
        self.assertEqual(response.json['status'], 'ready')

    def test_empty_missing_headers_ambiguous_dates_and_external_uri_rejected(self):
        self.assertEqual(self.preview(raw=workbook([])).status_code, 400)
        bad_header = workbook([('2027-01-01', '', '放假', '元旦')])
        parts = {}
        with zipfile.ZipFile(io.BytesIO(bad_header)) as archive:
            parts = {name: archive.read(name) for name in archive.namelist()}
        parts['xl/worksheets/sheet1.xml'] = parts['xl/worksheets/sheet1.xml'].replace('结束日期'.encode(), '其他字段'.encode())
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, content in parts.items(): archive.writestr(name, content)
        self.assertEqual(self.preview(raw=stream.getvalue()).status_code, 400)
        ambiguous = workbook([('<c r="{r}"><v>46388</v></c>', '', '放假', '元旦')], raw_cells=True)
        self.assertEqual(self.preview(raw=ambiguous).status_code, 400)
        external = workbook([('2027-01-01', '', '放假', '元旦')], extra={'_rels/.rels': '<Relationships><Relationship Target="https://example.com/data"/></Relationships>'})
        self.assertEqual(self.preview(raw=external).status_code, 400)

    def test_leap_year_full_366_dates_and_safe_source_validation(self):
        parsed = self.hi().parse_xlsx(workbook([('2028-01-01', '2028-12-31', '放假', '全年安排')]), 2028)
        self.assertEqual(len(parsed['holidays']), 366)
        for source in ['javascript:alert(1)', 'https://user:secret@example.com/', 'file:///tmp/a', 'https://example.com/\nInjected']:
            response = self.client.post('/api/holiday-calendar/import/preview', data={
                'year': '2027', 'base_revision': '0', 'source_url': source,
                'file': (io.BytesIO(workbook([('2027-01-01', '', '放假', '元旦')])), '安排.xlsx')}, headers={'X-CSRFToken': 'csrf'})
            self.assertEqual(response.status_code, 400)

    def test_scoped_calendar_overlay_uses_candidate_without_global_state(self):
        first = self.preview().json
        self.commit(first['token'])
        actual = hc.get_calendar(2027, self.folder)
        candidate = {**actual, 'holidays': [{'date': '2027-02-01', 'name': '仅预览'}], 'workdays': [], 'workday_names': {}, 'is_preview': True}
        overlay = {2027: candidate, '_cache_dir': self.folder}
        self.assertEqual(hc.day_info('2027-02-01', cache_dir=overlay)['status'], 'holiday')
        self.assertEqual(hc.day_info('2027-02-01', cache_dir=self.folder)['status'], 'workday')
        self.assertEqual(hc.get_calendar(2026, overlay)['source_url'], hc.SOURCE)
        self.assertFalse(hc.get_calendar(2028, overlay)['confirmed'])
        read = hc.get_calendar(2027, overlay)
        read['holidays'].clear()
        self.assertEqual(len(candidate['holidays']), 1)

    def test_excel_shared_strings_rich_text_and_iso_date_cells(self):
        raw = workbook([('<c r="{r}" t="d"><v>2027-01-01</v></c>', '', '放假', '名称')], raw_cells=True)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            entries = {name: archive.read(name) for name in archive.namelist()}
        entries['xl/sharedStrings.xml'] = ('<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><si>\n<r><t>元</t></r>\n<r><t>旦</t></r>\n<rPh sb="0" eb="1"><t>yuan</t></rPh></si></sst>').encode()
        entries['xl/worksheets/sheet1.xml'] = entries['xl/worksheets/sheet1.xml'].replace('<c r="D2" t="inlineStr"><is><t>名称</t></is></c>'.encode(), b'<c r="D2" t="s"><v>0</v></c>')
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
            for name, content in entries.items(): archive.writestr(name, content)
        result = self.hi().parse_xlsx(stream.getvalue(), 2027)
        self.assertEqual(result['holidays'], [{'date': '2027-01-01', 'name': '元旦'}])


if __name__ == '__main__': unittest.main()
