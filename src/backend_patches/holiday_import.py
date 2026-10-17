"""holiday-import-v1: bounded offline XLSX import and immutable annual revisions.

The active index is the only publication point. Revision files are immutable;
previews are session-bound temporary data, never calendar state.
"""
from __future__ import annotations

from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
import hashlib
import hmac
import json
import os
import re
import secrets
import tempfile
import threading
import time
import zipfile

MAX_UPLOAD = 2 * 1024 * 1024
MAX_MEMBER = 4 * 1024 * 1024
MAX_TOTAL = 8 * 1024 * 1024
PREVIEW_TTL = 1800
MAX_PREVIEWS = 100
HEADERS = ('开始日期', '结束日期', '安排', '节日名称')
DATA_SHEET = '放假调休安排'
NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
_write_lock = threading.RLock()


class ImportProblem(ValueError):
    def __init__(self, message, status=400, *, row=None, field=None):
        super().__init__(message)
        self.status = status
        self.errors = [dict(sheet=DATA_SHEET, row=row, field=field, message=message)]


def _hc():
    if __package__: from . import holiday_calendar
    else: import holiday_calendar
    return holiday_calendar


def _year(value):
    if isinstance(value, bool) or not re.fullmatch(r'\d{4}', str(value)) or not 2000 <= int(value) <= 2100:
        raise ImportProblem('年度须为2000至2100')
    return int(value)


def _revision(value):
    if isinstance(value, bool) or not re.fullmatch(r'\d{1,12}', str(value)):
        raise ImportProblem('基准修订无效，请刷新年度安排后重试')
    return int(value)


def _json_bytes(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')


def _content(snapshot):
    return dict(year=snapshot['year'], holidays=sorted(snapshot['holidays'], key=lambda x: x['date']),
                workdays=sorted(snapshot['workdays']),
                workday_names={day: snapshot.get('workday_names', {}).get(day, '调休补班') for day in sorted(snapshot['workdays'])})


def _digest(snapshot):
    return hashlib.sha256(_json_bytes(_content(snapshot))).hexdigest()


def revision_of(snapshot):
    """Local CAS revision; legacy/embedded sources start at revision zero."""
    return int(snapshot.get('local_revision') or 0)


def _read_json(path, limit=MAX_MEMBER):
    with Path(path).open('rb') as stream:
        raw = stream.read(limit + 1)
    if len(raw) > limit: raise ValueError('日历文件超限')
    return json.loads(raw)


def _index(folder):
    path = Path(folder) / 'active.json'
    if not path.exists(): return {'schema': 1, 'years': {}}
    data = _read_json(path, 131072)
    if not isinstance(data, dict) or data.get('schema') != 1 or not isinstance(data.get('years'), dict):
        raise ValueError('活动日历索引无效')
    for year, rev in data['years'].items():
        _year(year)
        if type(rev) is not int or rev < 1: raise ValueError('活动修订无效')
    return data


def _record(folder, year, revision):
    data = _read_json(Path(folder) / 'revisions' / f'{year}-{revision}.json')
    if data.get('year') != year or data.get('revision') != revision or not isinstance(data.get('snapshot'), dict):
        raise ValueError('修订记录无效')
    snapshot = data['snapshot']
    _validate_snapshot(snapshot)
    if snapshot['year'] != year or data.get('sha256') != _digest(snapshot): raise ValueError('修订内容校验失败')
    return data


def get_active(year, cache_dir):
    """Return an active manual snapshot, None for untouched legacy sources.

    A broken index or referenced revision is explicit, never a fallback to an
    unrelated embedded/legacy calendar.
    """
    if not cache_dir: return None
    try:
        revision = _index(cache_dir)['years'].get(str(_year(year)))
        if revision is None: return None
        record = _record(cache_dir, year, revision)
        return {**record['snapshot'], 'version': revision, 'local_revision': revision,
                'origin': 'manual_import', 'confirmed': True,
                'updated_at': record['created_at'][:10], 'confirmed_at': record['created_at'],
                'confirmed_by': record['actor'], 'sha256': record['sha256'], 'operation': record['operation']}
    except (OSError, ValueError, KeyError, TypeError) as error:
        raise _hc().HolidayDataUnavailable('年度安排存储异常，须由管理员核对并恢复；原期限保留') from error


def _validate_snapshot(snapshot):
    year = _year(snapshot.get('year'))
    holidays, workdays = snapshot.get('holidays'), snapshot.get('workdays')
    if not isinstance(holidays, list) or not isinstance(workdays, list) or len(holidays) + len(workdays) > 366:
        raise ValueError('年度安排列表无效')
    seen = set()
    for item in holidays:
        if not isinstance(item, dict): raise ValueError('放假日期无效')
        key = item.get('date')
        day = _hc()._date(key)
        if day.year != year or key in seen: raise ValueError('年度日期重复或跨年')
        if not isinstance(item.get('name'), str) or not 1 <= len(item['name']) <= 40: raise ValueError('名称无效')
        seen.add(key)
    for key in workdays:
        day = _hc()._date(key)
        if day.year != year or key in seen: raise ValueError('年度日期重复或跨年')
        seen.add(key)
    names = snapshot.get('workday_names', {})
    if not isinstance(names, dict) or set(names) - set(workdays): raise ValueError('补班名称无效')
    if any(not isinstance(name, str) or not 1 <= len(name) <= 40 for name in names.values()): raise ValueError('补班名称无效')
    return snapshot


def _xml_parts(raw):
    if len(raw) > MAX_UPLOAD: raise ImportProblem('上传文件最多2MiB', 413)
    parts, total = {}, 0
    try:
        with zipfile.ZipFile(BytesIO(raw)) as archive:
            members = archive.infolist()
            if len(members) > 128: raise ImportProblem('工作簿ZIP成员最多128个', 413)
            names = [item.filename for item in members]
            if len(names) != len(set(names)): raise ImportProblem('工作簿含重复ZIP成员，请另存为新的xlsx')
            for info in members:
                path = PurePosixPath(info.filename)
                if path.is_absolute() or '..' in path.parts or '\\' in info.filename or info.flag_bits & 1:
                    raise ImportProblem('工作簿含不安全路径或加密内容')
                if info.compress_type not in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED):
                    raise ImportProblem('不支持此工作簿压缩方式')
                lower = info.filename.lower()
                if 'vbaproject' in lower or lower.endswith('.bin') or 'externallinks/' in lower:
                    raise ImportProblem('不支持宏或外部工作簿链接')
                if info.file_size > MAX_MEMBER or total + info.file_size > MAX_TOTAL:
                    raise ImportProblem('工作簿展开体积超限：单成员4MiB、总计8MiB', 413)
                with archive.open(info) as stream: content = stream.read(MAX_MEMBER + 1)
                total += len(content)
                if len(content) > MAX_MEMBER or total > MAX_TOTAL:
                    raise ImportProblem('工作簿实际展开体积超限', 413)
                if lower.endswith(('.xml', '.rels')):
                    if re.search(br'<!\s*(?:DOCTYPE|ENTITY)', content, re.I):
                        raise ImportProblem('工作簿XML不允许DOCTYPE或实体定义')
                    # Reject UTF-16 declarations before ElementTree can expand them.
                    if b'\x00' in content: raise ImportProblem('请将工作簿另存为标准UTF-8格式')
                    root = ET.fromstring(content)
                    if sum(1 for _ in root.iter()) > 50000: raise ImportProblem('工作簿XML结构超限', 413)
                    for element in root.iter():
                        tag = element.tag.rsplit('}', 1)[-1]
                        if tag == 'f': raise ImportProblem('不支持公式单元格，请粘贴为文本日期或数值')
                        if tag == 'Relationship':
                            target = element.get('Target', '')
                            if element.get('TargetMode', '').lower() == 'external' or urlsplit(target).scheme or target.startswith('//'):
                                raise ImportProblem('工作簿不允许外部关系或链接')
                        if 'macroenabled' in element.get('ContentType', '').lower():
                            raise ImportProblem('不支持启用宏的工作簿')
                    parts[info.filename] = root
    except ImportProblem: raise
    except (zipfile.BadZipFile, OSError, RuntimeError, ET.ParseError, ValueError, NotImplementedError) as error:
        raise ImportProblem('文件不是有效的xlsx工作簿，请重新下载模板填写') from error
    return parts


def _date_styles(parts):
    root = parts.get('xl/styles.xml')
    if root is None: return set()
    formats = {int(item.get('numFmtId')): item.get('formatCode', '') for item in root.findall(f'{{{NS}}}numFmts/{{{NS}}}numFmt')}
    styles = set()
    for index, item in enumerate(root.findall(f'{{{NS}}}cellXfs/{{{NS}}}xf')):
        number = int(item.get('numFmtId', '0'))
        fmt = re.sub(r'"[^"]*"|\\.|\[[^\]]*\]', '', formats.get(number, '')).lower()
        if number in (14, 15, 16, 17, 22, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 54, 57, 58) or all(x in fmt for x in ('y', 'm', 'd')):
            styles.add(index)
    return styles


def _string_text(element):
    """Spreadsheet rich text excludes XML indentation and phonetic guides."""
    if element is None: return ''
    segments = []
    for child in element:
        if child.tag == f'{{{NS}}}t': segments.append(child.text or '')
        elif child.tag == f'{{{NS}}}r':
            segments.extend(node.text or '' for node in child.findall(f'{{{NS}}}t'))
    return ''.join(segments)


def parse_xlsx(raw, year):
    """Normalize only the four columns in the explicitly named data sheet."""
    year = _year(year)
    parts = _xml_parts(raw)
    try:
        workbook = parts['xl/workbook.xml']
        rels = {node.get('Id'): node.get('Target') for node in parts['xl/_rels/workbook.xml.rels']}
        sheets = [node for node in workbook.findall(f'{{{NS}}}sheets/{{{NS}}}sheet') if node.get('name') == DATA_SHEET]
        if len(sheets) != 1: raise ImportProblem('缺少唯一的“放假调休安排”工作表，请使用模板')
        target = rels[sheets[0].get(f'{{{REL_NS}}}id')]
        path = target.lstrip('/') if target.startswith('/') else 'xl/' + target
        if '..' in PurePosixPath(path).parts: raise ImportProblem('工作表路径无效')
        sheet = parts[path]
        prop = workbook.find(f'{{{NS}}}workbookPr')
        system1904 = prop is not None and prop.get('date1904') in ('1', 'true')
        strings = []
        shared = parts.get('xl/sharedStrings.xml')
        if shared is not None:
            strings = [_string_text(node) for node in shared.findall(f'{{{NS}}}si')]
        styles = _date_styles(parts)
        rows, seen_rows = [], set()
        for row in sheet.findall(f'{{{NS}}}sheetData/{{{NS}}}row'):
            number = int(row.get('r', '0'))
            if number < 1 or number in seen_rows: raise ImportProblem('工作表行号重复或无效', row=number)
            seen_rows.add(number)
            values, date_columns, seen_cells = ['', '', '', ''], set(), set()
            for cell in row.findall(f'{{{NS}}}c'):
                ref = cell.get('r', '')
                match = re.fullmatch(r'([A-Z]+)([1-9]\d*)', ref)
                if not match or int(match[2]) != number or ref in seen_cells:
                    raise ImportProblem('单元格位置重复或无效', row=number)
                seen_cells.add(ref)
                kind = cell.get('t', 'n')
                value = cell.findtext(f'{{{NS}}}v', '')
                if kind == 'inlineStr': value = _string_text(cell.find(f'{{{NS}}}is'))
                elif kind == 's': value = strings[int(value)]
                elif kind not in ('n', 'd', 'str') and value: raise ImportProblem('单元格类型无效', row=number)
                column = match[1]
                if column not in 'ABCD' or len(column) != 1:
                    if value.strip(): raise ImportProblem('仅支持模板中的四列，请移除多余内容', row=number)
                    continue
                index = 'ABCD'.index(column)
                if kind == 'n' and value and int(cell.get('s', '0')) in styles:
                    if index > 1: raise ImportProblem('安排和节日名称须为文本', row=number, field=HEADERS[index])
                    try:
                        serial = float(value)
                        if serial != int(serial) or serial < 0 or (not system1904 and serial == 60): raise ValueError()
                        base = date(1904, 1, 1) if system1904 else date(1899, 12, 31) if serial < 60 else date(1899, 12, 30)
                        value = (base + timedelta(days=int(serial))).isoformat()
                    except (ValueError, OverflowError): raise ImportProblem('Excel日期数值无效，请改为YYYY-MM-DD', row=number, field=HEADERS[index])
                    date_columns.add(index)
                elif kind == 'n' and value and index < 2 and number > 1:
                    raise ImportProblem('日期数字没有明确的日期格式，请改为YYYY-MM-DD', row=number, field=HEADERS[index])
                values[index] = value.strip()
            if any(values): rows.append((number, values))
        if not rows or rows[0] != (1, list(HEADERS)):
            raise ImportProblem('第一行须为：开始日期、结束日期、安排、节日名称', row=1, field='表头')
        rows = rows[1:]
        if not rows: raise ImportProblem('安排表为空，请填写该年度完整放假调休安排', row=2)
        if len(rows) > 366: raise ImportProblem('每年度最多366条安排', 413)
        holidays, workdays, names, seen = [], [], {}, set()
        for number, values in rows:
            start, end, kind, name = values
            for index, text in enumerate((start, end or start)):
                try: day = _hc()._date(text)
                except (TypeError, ValueError): raise ImportProblem('日期须为有效的YYYY-MM-DD，如2027-01-01', row=number, field=HEADERS[index])
                if day.year != year: raise ImportProblem(f'日期须在{year}年内，跨年安排请分年度填写', row=number, field=HEADERS[index])
            start_day, end_day = date.fromisoformat(start), date.fromisoformat(end or start)
            if end_day < start_day: raise ImportProblem('结束日期不得早于开始日期', row=number, field='结束日期')
            if kind not in ('放假', '补班'): raise ImportProblem('安排须选择放假或补班', row=number, field='安排')
            if not 1 <= len(name) <= 40 or any(ord(char) < 32 for char in name):
                raise ImportProblem('节日名称须为1至40个字符', row=number, field='节日名称')
            while start_day <= end_day:
                key = start_day.isoformat()
                if key in seen: raise ImportProblem(f'{key}重复或同时标记放假与补班，请合并或修正', row=number, field='开始日期')
                seen.add(key)
                if len(seen) > 366: raise ImportProblem('展开日期最多366个', 413, row=number)
                if kind == '放假': holidays.append(dict(date=key, name=name))
                else: workdays.append(key); names[key] = name
                start_day += timedelta(days=1)
        return _content(dict(year=year, holidays=holidays, workdays=workdays, workday_names=names))
    except ImportProblem: raise
    except (KeyError, TypeError, ValueError, IndexError, OverflowError) as error:
        raise ImportProblem('工作簿结构或单元格格式无效，请使用模板重新保存') from error


def build_xlsx(year, snapshot=None):
    """Build two native OOXML sheets; every user value is an explicit string."""
    year = _year(year)
    def cell(column, row, value):
        return f'<c r="{column}{row}" t="inlineStr"><is><t xml:space="preserve">{escape(str(value))}</t></is></c>'
    def row(number, values):
        return f'<row r="{number}">' + ''.join(cell(column, number, value) for column, value in zip('ABCD', values)) + '</row>'
    instructions = [f'{year}年放假调休安排', '本模板按所选年度完整替换；普通周末无需单列。',
                    '开始日期和结束日期使用YYYY-MM-DD；结束日期留空表示当天。', '安排选择放假或补班；节日名称1至40字。',
                    '请核对国家年度放假调休通知；企业自定假期不能作为国家工作日日历。',
                    '下列仅为格式示例，不参与导入：', f'{year}-01-01 至 {year}-01-03 放假 元旦（格式示例）',
                    f'{year}-01-09 补班 元旦调休（格式示例，须核对实际通知）']
    sheet1 = f'<worksheet xmlns="{NS}"><cols><col min="1" max="1" width="88" customWidth="1"/></cols><sheetData>' + ''.join(row(index, [text]) for index, text in enumerate(instructions, 1)) + '</sheetData></worksheet>'
    records = []
    if snapshot:
        records.extend((item['date'], '', '放假', item['name']) for item in snapshot['holidays'])
        records.extend((key, '', '补班', snapshot.get('workday_names', {}).get(key, '调休补班')) for key in snapshot['workdays'])
        records.sort(key=lambda value: value[0])
    sheet2 = f'<worksheet xmlns="{NS}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" state="frozen"/></sheetView></sheetViews><cols><col min="1" max="2" width="18" customWidth="1"/><col min="3" max="3" width="12" customWidth="1"/><col min="4" max="4" width="28" customWidth="1"/></cols><sheetData>' + row(1, HEADERS) + ''.join(row(index, values) for index, values in enumerate(records, 2)) + '</sheetData><dataValidations count="1"><dataValidation type="list" allowBlank="0" showErrorMessage="1" sqref="C2:C367"><formula1>"放假,补班"</formula1></dataValidation></dataValidations></worksheet>'
    workbook = f'<workbook xmlns="{NS}" xmlns:r="{REL_NS}"><sheets><sheet name="填写说明" sheetId="1" r:id="rId1"/><sheet name="放假调休安排" sheetId="2" r:id="rId2"/></sheets></workbook>'
    package_ns = 'http://schemas.openxmlformats.org/package/2006/relationships'
    rels = f'<Relationships xmlns="{package_ns}">' + ''.join(f'<Relationship Id="rId{i}" Type="{REL_NS}/worksheet" Target="worksheets/sheet{i}.xml"/>' for i in (1, 2)) + '</Relationships>'
    types = '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + ''.join(f'<Override PartName="/xl/worksheets/sheet{i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' for i in (1, 2)) + '</Types>'
    stream = BytesIO()
    with zipfile.ZipFile(stream, 'w', zipfile.ZIP_DEFLATED) as archive:
        for path, text in [('[Content_Types].xml', types), ('_rels/.rels', f'<Relationships xmlns="{package_ns}"><Relationship Id="rId1" Type="{REL_NS}/officeDocument" Target="xl/workbook.xml"/></Relationships>'), ('xl/workbook.xml', workbook), ('xl/_rels/workbook.xml.rels', rels), ('xl/worksheets/sheet1.xml', sheet1), ('xl/worksheets/sheet2.xml', sheet2)]:
            archive.writestr(path, '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + text)
    return stream.getvalue()


def _atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    raw = _json_bytes(value)
    if len(raw) > MAX_MEMBER: raise ImportProblem('预览内容超限，请减少业务影响清单后重试', 413)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.tmp-', delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if temporary: temporary.unlink(missing_ok=True)


@contextmanager
def _locked(folder):
    """Serialize a read/merge/index swap across threads and application processes."""
    folder = Path(folder)
    folder.mkdir(parents=True, exist_ok=True)
    with _write_lock, (folder / '.write.lock').open('a+b') as stream:
        if os.name == 'nt':
            import msvcrt
            stream.seek(0, os.SEEK_END)
            if not stream.tell(): stream.write(b'0'); stream.flush()
            stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_LOCK, 1)
        else:
            import fcntl
            fcntl.flock(stream.fileno(), fcntl.LOCK_EX)
        try: yield
        finally:
            if os.name == 'nt': stream.seek(0); msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else: fcntl.flock(stream.fileno(), fcntl.LOCK_UN)


def _date_map(snapshot):
    result = {item['date']: dict(kind='holiday', name=item['name']) for item in snapshot['holidays']}
    result.update({key: dict(kind='workday', name=snapshot.get('workday_names', {}).get(key, '调休补班')) for key in snapshot['workdays']})
    return result


def _diff(previous, snapshot):
    old, new = _date_map(previous), _date_map(snapshot)
    return dict(added=[dict(date=key, **new[key]) for key in sorted(new.keys() - old.keys())],
                removed=[dict(date=key, **old[key]) for key in sorted(old.keys() - new.keys())],
                changed=[dict(date=key, before=old[key], after=new[key]) for key in sorted(old.keys() & new.keys()) if old[key] != new[key]])


def _summary(snapshot):
    return dict(holidays=len(snapshot['holidays']), workdays=len(snapshot['workdays']))


def register(app, db, models):
    from flask import jsonify, request, session, send_file
    if getattr(app, '_holiday_import_registered', False): return
    folder = Path(models['DATA_DIR']) / 'holiday_calendar'

    def auth(write=False, admin=False):
        user_id = session.get('user_id')
        if not user_id: raise ImportProblem('请先登录', 401)
        User = models.get('User')
        user = db.session.get(User, user_id) if User else None
        if not user or not bool(getattr(user, 'is_active', True)): raise ImportProblem('账号不可用，请重新登录', 401)
        if admin and not bool(getattr(user, 'is_admin', False)): raise ImportProblem('仅管理员可管理年度安排', 403)
        if write:
            expected, supplied = str(session.get('csrf_token') or ''), str(request.headers.get('X-CSRFToken') or '')
            if not expected or not hmac.compare_digest(expected.encode(), supplied.encode()): raise ImportProblem('请求已过期，请刷新后重试', 403)
        return user

    def guarded(handler):
        def wrapped(**kwargs):
            try: return handler(**kwargs)
            except ImportProblem as error: return jsonify(error=str(error), errors=error.errors), error.status
            except _hc().HolidayDataUnavailable: return jsonify(error='年度安排存储异常，请管理员核对并恢复', code='CALENDAR_STORAGE_UNAVAILABLE'), 503
            except (OSError, ValueError, TypeError, KeyError): return jsonify(error='年度安排暂时无法保存或读取，原有数据已保留', code='CALENDAR_STORAGE_UNAVAILABLE'), 503
        wrapped.__name__ = handler.__name__
        return wrapped

    def active(year):
        snapshot = _hc().get_calendar(year, folder)
        snapshot = {**snapshot, 'local_revision': revision_of(snapshot), 'confirmed': bool(snapshot.get('version'))}
        snapshot.setdefault('origin', 'builtin' if year == 2026 and not (folder / f'{year}.json').exists() else 'legacy' if snapshot['confirmed'] else 'unconfirmed')
        return snapshot

    def binding():
        if not session.get('_holiday_import_session'): session['_holiday_import_session'] = secrets.token_hex(24)
        return hashlib.sha256(str(session['_holiday_import_session']).encode()).hexdigest()

    def cleanup_previews():
        area = folder / 'previews'
        area.mkdir(parents=True, exist_ok=True)
        paths = sorted(area.glob('*.json'), key=lambda path: path.stat().st_mtime)
        for path in paths:
            if time.time() - path.stat().st_mtime > PREVIEW_TTL * 2:
                path.unlink(missing_ok=True)
        if len(list(area.glob('*.json'))) >= MAX_PREVIEWS: raise ImportProblem('当前待确认预览较多，请稍后重试', 503)

    def public_preview(preview):
        try: page = int(request.args.get('page', 1))
        except ValueError: raise ImportProblem('分页页码无效')
        if page < 1: raise ImportProblem('分页页码无效')
        output = {key: preview[key] for key in ('token', 'status', 'year', 'diff', 'summary', 'errors', 'base_revision')}
        impacts = preview['impacts']
        output['impacts'] = dict(status=impacts['status'], total=impacts['total'], page=page, page_size=50,
                                 items=impacts['items'][(page - 1) * 50:page * 50])
        if impacts.get('error'): output['impacts']['error'] = impacts['error']
        return output

    def create_preview(year, base, snapshot, user, *, operation='import', restored_from=None, source_hash='', document='', source_url=''):
        previous = active(year)
        if revision_of(previous) != base: raise ImportProblem('年度安排已更新，请刷新后重新预览', 409)
        if operation == 'restore':
            document, source_url = snapshot.get('document', ''), snapshot.get('source_url', '')
        if not isinstance(document, str) or len(document) > 200 or any(ord(char) < 32 for char in document):
            raise ImportProblem('公告名称最多200字，请使用单行文本')
        if not isinstance(source_url, str) or len(source_url) > 2048: raise ImportProblem('来源链接过长或无效')
        if source_url:
            url = urlsplit(source_url)
            if url.scheme not in ('https', 'http') or not url.hostname or url.username or url.password or any(char.isspace() for char in source_url):
                raise ImportProblem('来源链接仅支持安全HTTP或HTTPS地址')
        snapshot = {**_content(snapshot), 'source_url': source_url, 'document': document, 'origin': 'manual_import'}
        provider = app.extensions.get('calendar_impact_provider')
        impacts = dict(status='unavailable', total=None, items=[], error='业务影响扫描暂不可用，请稍后重新预览')
        if provider:
            try:
                candidate = {**snapshot, 'version': base + 1, 'local_revision': base + 1,
                             'confirmed': True, 'sha256': _digest(snapshot), 'is_preview': True}
                items = provider(year, candidate)
                if not isinstance(items, list) or len(items) > 10000: raise ValueError('影响清单无效或超限')
                _json_bytes(items)
                impacts = dict(status='complete', total=len(items), items=items)
            except Exception:
                app.logger.warning('年度安排业务影响扫描未完成')
        token = secrets.token_urlsafe(32)
        preview = dict(token=token, year=year, base_revision=base, snapshot=snapshot,
                       user_id=str(session['user_id']), session=binding(), created_at=time.time(),
                       expires_at=time.time() + PREVIEW_TTL, status='ready' if impacts['status'] == 'complete' else 'impact_unavailable',
                       summary=_summary(snapshot), diff=_diff(previous, snapshot), errors=[], impacts=impacts,
                       operation=operation, restored_from=restored_from, source_sha256=source_hash, consumed=False)
        with _locked(folder):
            cleanup_previews()
            _atomic_json(folder / 'previews' / f'{token}.json', preview)
        return preview

    def load_preview(token):
        if not isinstance(token, str) or not re.fullmatch(r'[A-Za-z0-9_-]{43}', token): raise ImportProblem('预览不存在，请重新上传', 404)
        path = folder / 'previews' / f'{token}.json'
        if not path.is_file(): raise ImportProblem('预览不存在，请重新上传', 404)
        value = _read_json(path)
        if value.get('user_id') != str(session['user_id']) or value.get('session') != binding(): raise ImportProblem('预览不存在，请重新上传', 404)
        if value.get('expires_at', 0) <= time.time(): raise ImportProblem('预览已过期，请重新上传', 410)
        if value.get('consumed'): raise ImportProblem('预览已确认，请刷新年度安排', 409)
        return value

    @guarded
    def calendar_get():
        auth()
        snapshot = active(_year(request.args.get('year', datetime.now().year)))
        settings = models.get('load_app_settings', lambda: {})()
        return jsonify({**snapshot, 'use_national_workdays': bool(settings.get('reminder_use_national_workdays'))})

    def workbook_response(body, filename):
        if request.args.get('save')!='1':
            return send_file(BytesIO(body),mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',as_attachment=True,download_name=filename)
        import ipaddress
        auth(write=True)
        try:
            remote=ipaddress.ip_address(request.remote_addr or '')
            mapped=getattr(remote,'ipv4_mapped',None)
            loopback=remote.is_loopback or bool(mapped and mapped.is_loopback)
        except ValueError:loopback=False
        if not app.config.get('IS_DESKTOP') or not loopback:raise ImportProblem('仅桌面客户端本机可保存到文件保存位置；浏览器请使用下载',403)
        resolve=models.get('get_export_dir')
        if not callable(resolve):raise ImportProblem('文件保存位置不可用，请检查设置',503)
        target=None;created=False
        try:
            destination=Path(resolve());destination.mkdir(parents=True,exist_ok=True)
            for attempt in range(20):
                target=destination/(filename if attempt==0 else f'{Path(filename).stem}_{datetime.now():%Y%m%d_%H%M%S}_{secrets.token_hex(4)}.xlsx')
                try:stream=target.open('xb')
                except FileExistsError:continue
                created=True
                with stream:stream.write(body)
                return jsonify(message='文件已保存',filename=target.name,path=str(target.resolve()),folder=str(destination.resolve()))
            raise OSError('Could not reserve unique workbook filename')
        except OSError as error:
            if created and target is not None:
                try:target.unlink(missing_ok=True)
                except OSError:pass
            raise ImportProblem('文件保存失败，请检查“文件保存位置”的目录和写入权限',503) from error

    @guarded
    def template():
        auth()
        year = _year(request.args.get('year', datetime.now().year))
        return workbook_response(build_xlsx(year),f'{year}年放假调休安排模板.xlsx')

    @guarded
    def export():
        auth()
        year = _year(request.args.get('year', datetime.now().year))
        snapshot = active(year)
        if not snapshot['confirmed']: raise ImportProblem('该年度安排尚未确认，请先下载空模板')
        return workbook_response(build_xlsx(year,snapshot),f'{year}年放假调休安排.xlsx')

    @guarded
    def preview_upload():
        user = auth(True, True)
        if request.content_length is not None and request.content_length > MAX_UPLOAD + 65536: raise ImportProblem('上传文件最多2MiB', 413)
        year, base = _year(request.form.get('year')), _revision(request.form.get('base_revision'))
        upload = request.files.get('file')
        if upload is None or not (upload.filename or '').lower().endswith('.xlsx'): raise ImportProblem('仅支持.xlsx文件，请使用年度安排模板')
        raw = upload.stream.read(MAX_UPLOAD + 1)
        snapshot = parse_xlsx(raw, year)
        return jsonify(public_preview(create_preview(year, base, snapshot, user, source_hash=hashlib.sha256(raw).hexdigest(),
                                                      document=request.form.get('document', ''), source_url=request.form.get('source_url', ''))))

    @guarded
    def preview_get(token):
        auth()
        return jsonify(public_preview(load_preview(token)))

    @guarded
    def history():
        auth()
        year = _year(request.args.get('year', datetime.now().year))
        current = active(year)
        revision, items, seen = revision_of(current), [], set()
        while revision:
            if revision in seen: raise _hc().HolidayDataUnavailable('修订链损坏')
            seen.add(revision)
            record = _record(folder, year, revision)
            items.append({key: record[key] for key in ('revision', 'created_at', 'actor', 'operation', 'summary')})
            revision = record['previous_revision']
        return jsonify(year=year, items=items)

    @guarded
    def restore_preview():
        user = auth(True, True)
        body = request.get_json(silent=True)
        if not isinstance(body, dict): raise ImportProblem('恢复请求无效')
        year, base, revision = _year(body.get('year')), _revision(body.get('base_revision')), _revision(body.get('revision'))
        current, reachable = revision_of(active(year)), set()
        while current:
            reachable.add(current)
            record = _record(folder, year, current)
            if current == revision: break
            current = record['previous_revision']
        if revision not in reachable: raise ImportProblem('历史修订不存在', 404)
        return jsonify(public_preview(create_preview(year, base, record['snapshot'], user, operation='restore', restored_from=revision)))

    @guarded
    def commit():
        user = auth(True, True)
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or body.get('confirm_complete') is not True: raise ImportProblem('请确认已核对该年度完整放假调休安排')
        with _locked(folder):
            preview = load_preview(body.get('token'))
            if preview['status'] != 'ready' or preview['impacts']['status'] != 'complete': raise ImportProblem('业务影响扫描未完成，请重新预览后确认', 503)
            year, snapshot = preview['year'], preview['snapshot']
            previous = active(year)
            if revision_of(previous) != preview['base_revision']: raise ImportProblem('年度安排已更新，请重新预览后确认', 409)
            changed = _digest(previous) != _digest(snapshot)
            if changed or preview['operation'] == 'restore':
                index = _index(folder)
                # An earlier failed index swap can leave an orphan; never overwrite it.
                revision = revision_of(previous) + 1
                while (folder / 'revisions' / f'{year}-{revision}.json').exists(): revision += 1
                legacy = folder / f'{year}.json'
                if legacy.is_file() and not revision_of(previous):
                    baseline = _read_json(legacy, 131072)
                    baseline_path = folder / 'legacy' / f'{year}-{hashlib.sha256(_json_bytes(baseline)).hexdigest()}.json'
                    if not baseline_path.exists(): _atomic_json(baseline_path, baseline)
                previous_revision = revision_of(previous)
                if not previous_revision and previous.get('confirmed'):
                    baseline_snapshot = {**_content(previous), 'source_url': previous.get('source_url', ''),
                                         'document': previous.get('document', ''), 'origin': previous.get('origin', 'official_source')}
                    baseline_record = dict(year=year, revision=revision, previous_revision=0,
                                           created_at=previous.get('updated_at', '') + 'T00:00:00+00:00',
                                           actor='原有年度安排', actor_id='', operation='baseline', restored_from=None,
                                           snapshot=baseline_snapshot, sha256=_digest(baseline_snapshot),
                                           source_sha256=hashlib.sha256(_json_bytes(previous)).hexdigest(), summary=_summary(previous))
                    _atomic_json(folder / 'revisions' / f'{year}-{revision}.json', baseline_record)
                    _record(folder, year, revision)
                    previous_revision = revision
                    revision += 1
                    while (folder / 'revisions' / f'{year}-{revision}.json').exists(): revision += 1
                record = dict(year=year, revision=revision, previous_revision=previous_revision,
                              created_at=datetime.now(timezone.utc).isoformat(timespec='seconds'),
                              actor=str(getattr(user, 'username', None) or getattr(user, 'name', None) or session['user_id']),
                              actor_id=str(session['user_id']), operation=preview['operation'], restored_from=preview['restored_from'],
                              snapshot=snapshot, sha256=_digest(snapshot), source_sha256=preview['source_sha256'], summary=_summary(snapshot))
                path = folder / 'revisions' / f'{year}-{revision}.json'
                _atomic_json(path, record)
                _record(folder, year, revision)
                index['years'][str(year)] = revision
                _atomic_json(folder / 'active.json', index)
            # The index swap is already the durable commit point. A consumed-token
            # write failure must not turn a successful publication into a 503.
            preview['consumed'] = True
            try: _atomic_json(folder / 'previews' / f'{preview["token"]}.json', preview)
            except OSError: pass
            result = active(year)
        message = '年度安排已更新；原确认期限保留，受影响事项需复核' if changed else '已记录恢复修订；安排内容未变化' if preview['operation'] == 'restore' else '安排未变化'
        return jsonify(changed=changed, message=message, calendar=result)

    @guarded
    def deprecated_update():
        auth(True, True)
        raise ImportProblem('联网更新已停用，请下载模板并导入年度完整安排', 410)

    routes = [('/api/holiday-calendar', 'holiday_calendar_settings', calendar_get, ['GET']),
              ('/api/holiday-calendar/template', 'holiday_calendar_template', template, ['GET','POST']),
              ('/api/holiday-calendar/export', 'holiday_calendar_export', export, ['GET','POST']),
              ('/api/holiday-calendar/import/preview', 'holiday_import_preview', preview_upload, ['POST']),
              ('/api/holiday-calendar/import/previews/<token>', 'holiday_import_preview_get', preview_get, ['GET']),
              ('/api/holiday-calendar/import/commit', 'holiday_import_commit', commit, ['POST']),
              ('/api/holiday-calendar/history', 'holiday_import_history', history, ['GET']),
              ('/api/holiday-calendar/restore/preview', 'holiday_import_restore', restore_preview, ['POST']),
              ('/api/holiday-calendar/update', 'holiday_calendar_update', deprecated_update, ['POST'])]
    for path, endpoint, handler, methods in routes:
        if endpoint in app.view_functions: app.view_functions[endpoint] = handler
        else: app.add_url_rule(path, endpoint, handler, methods=methods)
    app._holiday_import_registered = True
