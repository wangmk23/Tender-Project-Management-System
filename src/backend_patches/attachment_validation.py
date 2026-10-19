"""attachment-validation-v1: bounded checks before the encrypted writer.

These are format/container checks, not a malware scanner or full document parser.
Nothing is extracted, changed, or persisted by this module.
"""
from __future__ import annotations

import json
from pathlib import PurePosixPath
import re
import struct
import zipfile
from xml.etree import ElementTree


MAX_ZIP_ENTRIES = 10000
MAX_ZIP_DIRECTORY = 8 * 1024 * 1024
MAX_ZIP_EXPANDED = 1024 * 1024 * 1024
MAX_ZIP_RATIO = 1000
MAX_XML = 4 * 1024 * 1024
OFFICE_PARTS = {'docx': 'word/document.xml', 'xlsx': 'xl/workbook.xml', 'pptx': 'ppt/presentation.xml'}
ALLOWED = set('pdf png jpg jpeg gif bmp webp doc xls ppt txt csv json xml zip rar 7z'.split()) | set(OFFICE_PARTS)


def _xml(raw):
    # Remove NUL padding to catch declarations in UTF-16/32 as well as UTF-8.
    if len(raw) > MAX_XML or re.search(br'<!\s*(?:DOCTYPE|ENTITY)', raw.replace(b'\0', b''), re.I):
        raise ValueError('XML内容过大或包含不支持的声明')
    return ElementTree.fromstring(raw)


def _zip(stream, size, extension):
    # Bound the central directory before ZipFile allocates one object per entry.
    stream.seek(max(0, size - 65557))
    tail = stream.read(65557)
    at = tail.rfind(b'PK\x05\x06')
    if at < 0 or len(tail) - at < 22:
        raise ValueError('压缩包目录不完整')
    disk, start_disk, disk_count, count, directory_size, offset, comment = struct.unpack_from('<4H2IH', tail, at + 4)
    if (disk or start_disk or disk_count != count or count > MAX_ZIP_ENTRIES
            or directory_size > MAX_ZIP_DIRECTORY or offset + directory_size > size
            or at + 22 + comment != len(tail)):
        raise ValueError('压缩包目录超出安全范围或使用不支持的分卷/ZIP64格式')
    with zipfile.ZipFile(stream) as archive:
        infos = archive.infolist()
        if len(infos) != count:
            raise ValueError('压缩包目录不一致')
        names, expanded = set(), 0
        for info in infos:
            name = info.filename.replace('\\', '/')
            if name in names or name.startswith('/') or '..' in PurePosixPath(name).parts or ':' in name or '\x00' in name:
                raise ValueError('压缩包包含重复或不安全的路径')
            names.add(name)
            expanded += info.file_size
            if (expanded > MAX_ZIP_EXPANDED or info.file_size > MAX_ZIP_EXPANDED
                    or info.file_size > max(info.compress_size, 1) * MAX_ZIP_RATIO):
                raise ValueError('压缩包解压大小或压缩比例超出安全范围')
        if extension in OFFICE_PARTS:
            for name in ('[Content_Types].xml', '_rels/.rels', OFFICE_PARTS[extension]):
                if name not in names or archive.getinfo(name).file_size > MAX_XML:
                    raise ValueError('Office文件缺少对应格式内容或内容过大')
                _xml(archive.read(name))


def _legacy_excel(stream, size, head):
    if size >= 512 and head.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1'):
        return True
    # Raw BIFF2/3/4 exports have no OLE container. Walk bounded record lengths
    # through EOF rather than accepting an arbitrary file with a BOF prefix.
    if head[:2] in (b'\x09\x00', b'\x09\x02', b'\x09\x04', b'\x09\x08'):
        if size > 64 * 1024 * 1024:
            return False
        stream.seek(0)
        count, end, position = 0, False, 0
        while position < size:
            raw = stream.read(4)
            if len(raw) != 4:
                return False
            kind, length = struct.unpack('<HH', raw)
            position += 4 + length
            count += 1
            if position > size or count > 1000000:
                return False
            if kind == 0x000A and length != 0:
                return False
            end = kind == 0x000A
            stream.seek(length, 1)
        return end
    if size <= MAX_XML:
        stream.seek(0)
        raw = stream.read(MAX_XML + 1)
        try:
            root = _xml(raw)
        except (ValueError, ElementTree.ParseError):
            return False
        ns = '{urn:schemas-microsoft-com:office:spreadsheet}'
        return root.tag == ns + 'Workbook' and root.find(ns+'Worksheet/'+ns+'Table') is not None
    return False


def validate_file(upload):
    """Return a user-facing error or None, always restoring the original stream."""
    stream = upload.stream
    original = stream.tell()
    try:
        extension = str(upload.filename or '').rsplit('.', 1)[-1].lower()
        if extension not in ALLOWED:
            return '不支持此文件格式'
        stream.seek(0, 2)
        size = stream.tell()
        stream.seek(0)
        head = stream.read(4096)
        stream.seek(max(0, size - 4096))
        tail = stream.read(4096)
        valid = False
        if extension == 'pdf':
            valid = bool(re.match(br'%PDF-[12]\.\d', head)) and b'%%EOF' in tail
        elif extension == 'png':
            valid = size >= 45 and head.startswith(b'\x89PNG\r\n\x1a\n\0\0\0\rIHDR') and b'IEND' in tail
        elif extension in ('jpg', 'jpeg'):
            valid = head.startswith(b'\xff\xd8\xff') and b'\xff\xd9' in tail
        elif extension == 'gif':
            valid = size >= 14 and head[:6] in (b'GIF87a', b'GIF89a') and tail.endswith(b';')
        elif extension == 'bmp':
            valid = size >= 26 and head.startswith(b'BM')
        elif extension == 'webp':
            valid = size >= 20 and head.startswith(b'RIFF') and head[8:12] == b'WEBP'
        elif extension == 'xls':
            valid = _legacy_excel(stream, size, head)
        elif extension in ('doc', 'ppt'):
            valid = size >= 512 and head.startswith(b'\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1')
        elif extension == 'rar':
            valid = head.startswith((b'Rar!\x1a\x07\x00', b'Rar!\x1a\x07\x01\x00')) and size >= 14
        elif extension == '7z':
            valid = size >= 32 and head.startswith(b"7z\xbc\xaf'\x1c")
        elif extension == 'zip' or extension in OFFICE_PARTS:
            if not head.startswith((b'PK\x03\x04', b'PK\x05\x06')):
                return '文件内容与扩展名不一致'
            _zip(stream, size, extension)
            valid = True
        elif extension in ('txt', 'csv', 'json', 'xml'):
            # Existing large text attachments remain stream-based; only structured
            # small documents are fully parsed, with a fixed allocation ceiling.
            encoding = 'utf-16' if head.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'
            text = head.decode(encoding, errors='replace')
            valid = '\x00' not in text
            if extension in ('json', 'xml'):
                if size > MAX_XML:
                    return '结构化文本过大，请压缩后上传'
                stream.seek(0)
                raw = stream.read(MAX_XML + 1)
                if extension == 'json':
                    json.loads(raw.decode(encoding))
                else:
                    root = _xml(raw)
                    if root.tag.rsplit('}', 1)[-1].lower() in ('html', 'script'):
                        return '文件内容与XML格式不一致'
        return None if valid else '文件内容与扩展名不一致或文件已损坏'
    except (ValueError, OSError, EOFError, RuntimeError, NotImplementedError, KeyError, zipfile.BadZipFile, ElementTree.ParseError) as error:
        return '文件格式或压缩包校验失败：' + str(error)[:120]
    finally:
        stream.seek(original)


def register(app):
    """Install once; valid streams continue to the existing upload/encryption route."""
    if app.extensions.get('attachment_content_validation'):
        return
    from flask import jsonify, request, session

    @app.before_request
    def validate_attachment_upload():
        if request.method != 'POST' or not re.fullmatch(r'/api/projects/\d+/attachments', request.path):
            return None
        if not session.get('user_id'):
            return None  # Keep the existing authentication response and order.
        errors = []
        for upload in request.files.getlist('files'):
            if not upload.filename:
                continue
            error = validate_file(upload)
            if error:
                errors.append({'filename': upload.filename, 'error': error})
        if errors:
            return jsonify(error='附件格式校验未通过', code='attachment_content_invalid',
                           errors=errors, upload_accepted=False), 400
        return None

    app.extensions['attachment_content_validation'] = True
