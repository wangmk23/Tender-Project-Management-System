"""Excel data import for the packaged application (projects / supplier registrations)."""

from __future__ import annotations

import io
import math
import re
import zipfile
from datetime import date, timedelta
from xml.etree import ElementTree as ET

try:
    from flask import jsonify, request, session
except Exception:  # pragma: no cover - flask always present in the packaged app
    jsonify = None
    request = None
    session = None


_IMPORT_ROUTES_REGISTERED = False

# 表头别名 → 标准字段名（兼容常见中文表头表达）
_PROJECT_HEADER_ALIASES = {
    "项目编号": "number",
    "编号": "number",
    "项目名称": "name",
    "名称": "name",
    "采购人": "purchaser",
    "采购单位": "purchaser",
    "文件编制负责人": "prepare_owner",
    "编制负责人": "prepare_owner",
    "文件审核负责人": "review_owner",
    "审核负责人": "review_owner",
    "年度": "year",
    "年份": "year",
    "采购方式": "method",
    "方式": "method",
    "预算": "budget",
    "项目预算": "budget",
    "预算(元)": "budget",
    "预算金额": "budget",
    "无需投标保证金": "no_deposit",
    "备注": "notes",
}

_LOT_HEADER_ALIASES = {
    "项目编号": "project_number",
    "包号": "lot_number",
    "标段号": "lot_number",
    "包名": "lot_name",
    "标段名称": "lot_name",
    "包预算": "budget",
    "预算": "budget",
    "备注": "notes",
}

_PROJECT_METHODS = {
    "公开招标",
    "竞争性磋商",
    "竞争性谈判",
    "邀请招标",
    "网上竞价",
    "单一来源",
    "遴选",
    "直选",
}

_REGISTRATION_HEADER_ALIASES = {
    "公司名称/联合体牵头单位": "company_name",
    "联合体牵头单位": "company_name",
    "公司名称": "company_name",
    "企业名称": "company_name",
    "供应商": "company_name",
    "供应商名称": "company_name",
    "包号": "lot_number",
    "所属包号": "lot_number",
    "标段号": "lot_number",
    "投标主体类型": "bidder_type",
    "联合体成员": "consortium_members",
    "公司地址": "company_address",
    "地址": "company_address",
    "法定代表人": "legal_representative",
    "联系人": "bid_manager",
    "投标联系人": "bid_manager",
    "投标负责人": "bid_manager",
    "电话": "manager_phone",
    "手机号": "manager_phone",
    "联系电话": "manager_phone",
    "邮箱": "manager_email",
    "电子邮箱": "manager_email",
    "获取日期": "acquisition_date",
    "报名方式": "registration_method",
    "备注": "notes",
}


def _clean_header(value):
    return re.sub(r"\s+", "", str(value or "")).strip()


class _WorkbookRow(dict):
    def __init__(self, values, source_row):
        super().__init__(values)
        self.source_row = source_row


class ImportCellError(ValueError):
    def __init__(self, column, message):
        super().__init__(message)
        self.column = str(column or "")


def _parse_with_column(column, parser, value):
    try:
        return parser(value)
    except ValueError as error:
        raise ImportCellError(column, str(error)) from error


def _column_index(reference):
    letters = "".join(character for character in str(reference or "") if character.isalpha())
    value = 0
    for character in letters.upper():
        value = value * 26 + ord(character) - 64
    return value


def _read_shared_strings(archive):
    shared_strings = []
    try:
        with archive.open("xl/sharedStrings.xml") as handle:
            root = ET.fromstring(handle.read())
        for si in root.iter():
            if si.tag.endswith("}si"):
                texts = [t.text or "" for t in si.iter() if t.tag.endswith("}t")]
                shared_strings.append("".join(texts))
    except KeyError:
        shared_strings = []
    return shared_strings


def _parse_worksheet(archive, member, shared_strings):
    with archive.open(member) as handle:
        sheet_root = ET.fromstring(handle.read())
    namespace_prefix = sheet_root.tag.split("}")[0] + "}" if "}" in sheet_root.tag else ""
    rows_data = []
    for row in sheet_root.iter(namespace_prefix + "row"):
        cells = {}
        for cell in row.iter(namespace_prefix + "c"):
            ref = cell.get("r", "")
            column = _column_index(ref)
            if not column:
                continue
            cell_type = cell.get("t")
            value_node = cell.find(namespace_prefix + "v")
            inline_node = cell.find(namespace_prefix + "is")
            if cell_type == "s" and value_node is not None:
                try:
                    index = int(value_node.text or "0")
                    value = shared_strings[index] if index < len(shared_strings) else ""
                except (ValueError, IndexError):
                    value = ""
            elif cell_type == "inlineStr" and inline_node is not None:
                texts = [t.text or "" for t in inline_node.iter() if t.tag.endswith("}t")]
                value = "".join(texts)
            elif value_node is not None:
                value = value_node.text or ""
                try:
                    if "." in value:
                        value = float(value)
                    else:
                        value = int(value)
                except (TypeError, ValueError):
                    pass
            else:
                value = ""
            cells[column] = value
        if cells:
            try:
                source_row = int(row.get("r") or len(rows_data) + 1)
            except ValueError:
                source_row = len(rows_data) + 1
            rows_data.append((source_row, cells))

    if not rows_data:
        return [], []

    # Template legends can have as many populated cells as narrow headers,
    # and ordinary data rows can contain extra cells. Prefer recognized field
    # aliases before cell count; unknown workbooks retain the old fallback.
    recognized_headers = {
        _clean_header(alias)
        for aliases in (_PROJECT_HEADER_ALIASES, _REGISTRATION_HEADER_ALIASES, _LOT_HEADER_ALIASES)
        for alias in aliases
    }
    header_position = max(
        range(len(rows_data)),
        key=lambda index: (
            sum(_clean_header(value) in recognized_headers for value in rows_data[index][1].values()),
            sum(1 for value in rows_data[index][1].values() if str(value or "").strip()),
        ),
    )
    header_row = rows_data[header_position][1]
    header_columns = sorted(header_row)
    headers = [_clean_header(header_row.get(col, "")) for col in header_columns]
    body_rows = []
    for source_row, row in rows_data[header_position + 1 :]:
        record = {}
        for column_index, column in enumerate(header_columns):
            raw = row.get(column, "")
            if isinstance(raw, float) and raw.is_integer():
                raw = int(raw)
            record[headers[column_index]] = "" if raw is None else str(raw)
        body_rows.append(_WorkbookRow(record, source_row))
    return headers, body_rows


def _parse_xlsx_workbook(data: bytes):
    """Return every worksheet as ``{sheet_name: (headers, rows)}``.

    Workbook relationships, rather than worksheet filenames, determine the
    names, order, and targets. This matters for Excel files whose relationship
    ids are not in numeric sheet order.
    """
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shared_strings = _read_shared_strings(archive)
        try:
            workbook_root = ET.fromstring(archive.read("xl/workbook.xml"))
            relationships_root = ET.fromstring(
                archive.read("xl/_rels/workbook.xml.rels")
            )
        except KeyError as error:
            raise ValueError("工作簿结构不完整") from error

        relationships = {
            item.get("Id"): item.get("Target")
            for item in relationships_root
            if item.get("Id") and item.get("Target")
        }
        workbook = {}
        for sheet in workbook_root.iter():
            if not sheet.tag.endswith("}sheet") and sheet.tag != "sheet":
                continue
            name = str(sheet.get("name") or "").strip()
            relation_id = sheet.get(
                "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
            )
            target = relationships.get(relation_id)
            if not name or not target:
                raise ValueError("工作表关系缺失")
            normalized_target = target.replace("\\", "/").lstrip("/")
            if normalized_target.startswith("../"):
                raise ValueError("工作表路径越界")
            member = (
                normalized_target
                if normalized_target.startswith("xl/")
                else "xl/" + normalized_target
            )
            workbook[name] = _parse_worksheet(archive, member, shared_strings)
        if not workbook:
            raise ValueError("未找到工作表")
        return workbook


def _parse_xlsx(data: bytes):
    """Backward-compatible first-sheet parser."""
    workbook = _parse_xlsx_workbook(data)
    return next(iter(workbook.values()))


def _resolve_aliases(headers, aliases):
    """Map parsed header names to standard field names."""
    mapping = {}
    for header in headers:
        normalized = _clean_header(header)
        standard = aliases.get(normalized)
        if standard is not None:
            mapping[standard] = header
    return mapping


def _parse_optional_date(value):
    from datetime import datetime

    raw = str(value or "").strip()
    if not raw:
        return None
    if re.fullmatch(r"\d+(?:\.0+)?", raw):
        serial = int(float(raw))
        if 1 <= serial <= 2958465:
            try:
                return date(1899, 12, 30) + timedelta(days=serial)
            except OverflowError:
                pass
    normalized = raw.replace("年", "-").replace("月", "-").replace("日", "").strip()
    try:
        return datetime.fromisoformat(normalized.replace("/", "-")).date()
    except ValueError:
        pass
    try:
        return datetime.strptime(normalized, "%Y-%m-%d").date()
    except ValueError:
        pass
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(raw, fmt).date()
        except ValueError:
            continue
    raise ValueError("获取日期格式无效")


def _parse_budget(value):
    raw = str(value or "").strip()
    if not raw:
        return None
    multiplier = 10000 if raw.endswith("万") else 1
    if multiplier != 1:
        raw = raw[:-1]
    raw = raw.replace(",", "").replace("元", "").replace("¥", "").replace("￥", "").strip()
    try:
        parsed = float(raw) * multiplier
    except ValueError as error:
        raise ValueError("预算金额格式无效") from error
    if not math.isfinite(parsed):
        raise ValueError("预算金额必须为有限数值")
    if parsed < 0:
        raise ValueError("预算金额不能为负数")
    return parsed


def _parse_year(value):
    raw = str(value or "").strip()
    if not raw:
        return date.today().year
    if not re.fullmatch(r"\d{4}", raw):
        raise ValueError("年度必须是四位整数")
    return int(raw)


def _parse_boolean(value):
    raw = str(value or "").strip().lower()
    if not raw:
        return False
    if raw in {"是", "true", "1"}:
        return True
    if raw in {"否", "false", "0"}:
        return False
    raise ValueError("无需投标保证金只接受是/否、true/false、1/0")


def _field(record, mapping, name, default=""):
    header = mapping.get(name)
    if not header:
        return default
    return str(record.get(header, default) or default).strip()


def _parse_bidder_type(value):
    raw = str(value or "").strip()
    if not raw or raw in {"单独投标", "standalone"}:
        return "standalone"
    if raw in {"联合体", "联合体投标", "consortium"}:
        return "consortium"
    raise ValueError("投标主体类型无效；可选值：单独投标、联合体")


def _parse_registration_method(value):
    raw = str(value or "").strip()
    if not raw:
        return "线上报名"
    if raw == "线上报名":
        return raw
    if raw in {"现场报名", "线下报名", "现场报名/线下报名"}:
        return "现场报名/线下报名"
    raise ValueError("报名方式无效；可选值：线上报名、现场报名/线下报名")


def _validate_optional_email(value):
    raw = str(value or "").strip()
    if raw and not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", raw):
        raise ValueError("电子邮箱格式无效")
    return raw


def _require_login():
    """Return a 401 response tuple when no user is logged in, else None."""
    if session is None or not session.get("user_id"):
        return jsonify({"error": "请先登录"}), 401
    return None


def _build_workbook_xlsx(sheet_definitions):
    """Build the dependency-free styled workbook used by import templates."""
    from xml.sax.saxutils import escape, quoteattr

    def cell(column, row, value, style=0):
        letters = ""
        while column:
            column, remainder = divmod(column - 1, 26)
            letters = chr(65 + remainder) + letters
        text = escape("" if value is None else str(value))
        return f'<c r="{letters}{row}" s="{style}" t="inlineStr"><is><t>{text}</t></is></c>'

    worksheets = []
    for definition in sheet_definitions:
        headers = definition["headers"]
        required = set(definition["required"])
        widths = definition.get("widths") or [18] * len(headers)
        header_cells = "".join(
            cell(index, 5, header, 3 if header in required else 4)
            for index, header in enumerate(headers, 1)
        )
        date_headers = set(definition.get("date_headers") or ())
        example_cells = "".join(
            cell(index, 6, value, 6 if headers[index - 1] in date_headers else 5)
            for index, value in enumerate(definition["example"], 1)
        )
        column_xml = "".join(
            f'<col min="{index}" max="{index}" width="{width}" customWidth="1"'
            f'{" style=\"6\"" if headers[index - 1] in date_headers else ""}/>'
            for index, width in enumerate(widths, 1)
        )
        last_column = ""
        value = len(headers)
        while value:
            value, remainder = divmod(value - 1, 26)
            last_column = chr(65 + remainder) + last_column
        title = definition["title"]
        validations = []
        for validation in definition.get("validations", []):
            if validation.get("header") not in headers:
                continue
            values = [str(value) for value in validation.get("values", []) if str(value)]
            if not values:
                continue
            column_number = headers.index(validation["header"]) + 1
            column_letters = ""
            while column_number:
                column_number, remainder = divmod(column_number - 1, 26)
                column_letters = chr(65 + remainder) + column_letters
            formula = escape(",".join(values)).replace('"', '&quot;')
            allow_blank = "1" if validation.get("allow_blank", True) else "0"
            validations.append(
                f'<dataValidation type="list" allowBlank="{allow_blank}" showErrorMessage="1" errorTitle="值不正确" error="请从下拉列表中选择" sqref="{column_letters}6:{column_letters}1000"><formula1>"{formula}"</formula1></dataValidation>'
            )
        validations_xml = (
            f'<dataValidations count="{len(validations)}">{"".join(validations)}</dataValidations>'
            if validations else ""
        )
        sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="5" topLeftCell="A6" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <cols>{column_xml}</cols>
  <sheetData>
    <row r="1">{cell(1, 1, title, 1)}</row>
    <row r="2">{cell(1, 2, "必填字段（浅红色）", 3)}{cell(2, 2, "可选字段（浅蓝色）", 4)}</row>
    <row r="3">{cell(1, 3, "请按表头格式填写；正式导入前请删除示例行。", 2)}</row>
    <row r="5">{header_cells}</row>
    <row r="6">{example_cells}</row>
  </sheetData>
  <autoFilter ref="A5:{last_column}6"/>
  {validations_xml}
</worksheet>'''
        worksheets.append(sheet_xml)

    worksheet_overrides = "".join(
        f'<Override PartName="/xl/worksheets/sheet{index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        for index in range(1, len(worksheets) + 1)
    )
    content_types_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>{worksheet_overrides}</Types>'''
    package_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'''
    workbook_sheets = "".join(
        f'<sheet name={quoteattr(definition["name"])} sheetId="{index}" r:id="rId{index}"/>'
        for index, definition in enumerate(sheet_definitions, 1)
    )
    workbook_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{workbook_sheets}</sheets></workbook>'''
    workbook_relationships = "".join(
        f'<Relationship Id="rId{index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet{index}.xml"/>'
        for index in range(1, len(worksheets) + 1)
    )
    workbook_relationships_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">{workbook_relationships}<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'''
    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/></numFmts>
<fonts count="3"><font><sz val="11"/><name val="微软雅黑"/></font><font><b/><sz val="15"/><name val="微软雅黑"/></font><font><b/><sz val="11"/><name val="微软雅黑"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAF7"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border/><border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFill="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1"/></cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", package_relationships_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships_xml)
        archive.writestr("xl/styles.xml", styles_xml)
        for index, worksheet in enumerate(worksheets, 1):
            archive.writestr(f"xl/worksheets/sheet{index}.xml", worksheet)
    return output.getvalue()


_PROJECT_TEMPLATE = (
    {
        "name": "项目",
        "title": "项目数据导入模板",
        "headers": ["项目编号", "项目名称", "采购人", "文件编制负责人", "文件审核负责人", "采购方式", "预算金额", "年度", "无需投标保证金", "备注"],
        "required": ["项目编号", "项目名称"],
        "example": ["PRJ-2026-001", "示例项目", "示例单位", "张三", "李四", "公开招标", "100000", "2026", "否", ""],
        "widths": [22, 36, 26, 18, 18, 16, 16, 10, 18, 30],
        "validations": [
            {"header": "采购方式", "values": sorted(_PROJECT_METHODS), "allow_blank": True},
            {"header": "无需投标保证金", "values": ["是", "否"], "allow_blank": True},
        ],
    },
    {
        "name": "分包",
        "title": "项目分包导入模板",
        "headers": ["项目编号", "包号", "包名", "包预算", "备注"],
        "required": ["项目编号", "包号", "包名"],
        "example": ["PRJ-2026-001", "包1", "示例设备包", "100000", ""],
        "widths": [22, 12, 30, 16, 30],
    },
)

_REGISTRATION_TEMPLATE = (
    {
        "name": "供应商报名",
        "title": "供应商报名数据导入模板",
        "headers": ["所属包号", "投标主体类型", "公司名称/联合体牵头单位", "联合体成员", "报名方式", "公司地址", "法定代表人", "投标负责人", "手机号", "电子邮箱", "获取日期", "备注"],
        "required": ["公司名称/联合体牵头单位"],
        "example": ["包1", "单独投标", "示例科技有限公司", "", "线上报名", "示例地址", "王五", "张三", "13800000000", "demo@example.com", "2026-08-01", ""],
        "widths": [14, 16, 32, 36, 16, 30, 18, 18, 18, 28, 16, 30],
        "date_headers": ["获取日期"],
        "validations": [
            {"header": "投标主体类型", "values": ["单独投标", "联合体"], "allow_blank": True},
            {"header": "报名方式", "values": ["线上报名", "现场报名/线下报名"], "allow_blank": True},
        ],
    },
)


def build_import_template(kind: str, *, lot_numbers=()) -> bytes:
    kind = str(kind or "").strip().lower()
    if kind == "projects":
        return _build_workbook_xlsx(_PROJECT_TEMPLATE)
    if kind == "registrations":
        definition = dict(_REGISTRATION_TEMPLATE[0])
        definition["validations"] = [
            {"header": "所属包号", "values": list(lot_numbers), "allow_blank": True},
            *list(definition.get("validations", [])),
        ]
        return _build_workbook_xlsx((definition,))
    raise ValueError("不支持的模板类型")


def _build_import_routes(app, db, models):
    Project = models.get("Project")
    SupplierRegistration = models.get("SupplierRegistration")
    ProjectLot = models.get("ProjectLot")

    def read_workbook(raw):
        try:
            return _parse_xlsx_workbook(raw)
        except (ValueError, KeyError, zipfile.BadZipFile, ET.ParseError, RuntimeError, StopIteration) as error:
            raise ValueError('文件格式无效，请使用完整的 .xlsx 工作簿') from error

    def initialize_workflow(project):
        from sqlalchemy import text
        try:
            import stage_templates
        except ModuleNotFoundError:
            from src.backend_patches import stage_templates
        # The desktop passes its real settings loader; legacy callers resolve app.
        loader = models.get('load_app_settings')
        if loader is None:
            import app as server_app
            loader = server_app.load_app_settings
            methods = getattr(server_app, 'METHODS', stage_templates.PROCUREMENT_METHODS)
            definitions = getattr(server_app, 'STAGES', [])
        else:
            methods = models.get('METHODS', stage_templates.PROCUREMENT_METHODS)
            definitions = models.get('STAGES', [])
        stage_templates.initialize_project_workflow(db.session, text, project, loader(), methods, definitions)

    def import_projects():
        unauthorized = _require_login()
        if unauthorized is not None:
            return unauthorized
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            return jsonify({"error": "请选择要导入的文件"}), 400
        raw = upload.read()
        if zipfile.is_zipfile(io.BytesIO(raw)):
            try:
                workbook = read_workbook(raw)
            except ValueError as error:
                return jsonify({'error': str(error)}), 400
            if not workbook:
                return jsonify({"error": "文件为空或表头无法识别"}), 400
        else:
            return jsonify({"error": "仅支持 .xlsx 格式（系统未内置 openpyxl）"}), 400

        if "项目" in workbook:
            headers, rows = workbook["项目"]
        else:
            headers, rows = next(iter(workbook.values()))
        mapping = _resolve_aliases(headers, _PROJECT_HEADER_ALIASES)
        missing = [name for name in ("number", "name") if name not in mapping]
        if missing:
            return jsonify({"error": "项目工作表缺少必填表头：项目编号、项目名称"}), 400

        groups = {}
        errors = []
        invalid_numbers = set()
        for record in rows:
            row_index = getattr(record, "source_row", 2)
            number = _field(record, mapping, "number")
            name = _field(record, mapping, "name")
            if not any(str(value or "").strip() for value in record.values()):
                continue
            try:
                if not number or not name:
                    raise ValueError("项目编号和项目名称不能为空")
                if number in groups:
                    raise ValueError("项目编号在导入文件内重复")
                if Project.query.filter_by(number=number).first() is not None:
                    raise ValueError("项目编号已存在")
                method = _field(record, mapping, "method", "公开招标") or "公开招标"
                if method not in _PROJECT_METHODS:
                    raise ImportCellError("采购方式", f"采购方式不受支持；可选值：{'、'.join(sorted(_PROJECT_METHODS))}")
                groups[number] = {
                    "row": row_index,
                    "values": {
                        "number": number,
                        "name": name,
                        "purchaser": _field(record, mapping, "purchaser"),
                        "prepare_owner": _field(record, mapping, "prepare_owner"),
                        "review_owner": _field(record, mapping, "review_owner"),
                        "method": method,
                        "budget": _parse_with_column("预算金额", _parse_budget, _field(record, mapping, "budget")),
                        "year": _parse_with_column("年度", _parse_year, _field(record, mapping, "year")),
                        "no_deposit": _parse_with_column("无需投标保证金", _parse_boolean, _field(record, mapping, "no_deposit")),
                        "notes": _field(record, mapping, "notes"),
                    },
                    "lots": [],
                }
            except ValueError as error:
                invalid_numbers.add(number or f"row:{row_index}")
                errors.append({"sheet": "项目", "row": row_index, "column": getattr(error, "column", ""), "msg": str(error)})

        if "分包" in workbook:
            lot_headers, lot_rows = workbook["分包"]
            lot_mapping = _resolve_aliases(lot_headers, _LOT_HEADER_ALIASES)
            if lot_rows and any(name not in lot_mapping for name in ("project_number", "lot_number", "lot_name")):
                return jsonify({"error": "分包工作表缺少必填表头：项目编号、包号、包名"}), 400
            seen_lots = set()
            for record in lot_rows:
                row_index = getattr(record, "source_row", 2)
                if not any(str(value or "").strip() for value in record.values()):
                    continue
                project_number = _field(record, lot_mapping, "project_number")
                lot_number = _field(record, lot_mapping, "lot_number")
                try:
                    if project_number not in groups:
                        raise ValueError("项目编号未指向本次可导入的项目")
                    if not lot_number or not _field(record, lot_mapping, "lot_name"):
                        raise ValueError("包号和包名不能为空")
                    lot_key = (project_number, lot_number)
                    if lot_key in seen_lots:
                        raise ValueError("同一项目内包号重复")
                    seen_lots.add(lot_key)
                    groups[project_number]["lots"].append(
                        {
                            "lot_number": lot_number,
                            "lot_name": _field(record, lot_mapping, "lot_name"),
                            "budget": _parse_budget(_field(record, lot_mapping, "budget")),
                            "notes": _field(record, lot_mapping, "notes"),
                        }
                    )
                except ValueError as error:
                    invalid_numbers.add(project_number or f"lot-row:{row_index}")
                    errors.append({"sheet": "分包", "row": row_index, "msg": str(error)})

        success = 0
        for number, group in groups.items():
            if number in invalid_numbers:
                continue
            try:
                with db.session.begin_nested():
                    project = Project(**group["values"])
                    db.session.add(project)
                    db.session.flush()
                    initialize_workflow(project)
                    for lot_values in group["lots"]:
                        db.session.add(ProjectLot(project_id=project.id, **lot_values))
                    db.session.flush()
                success += 1
            except Exception as error:
                invalid_numbers.add(number)
                errors.append({"sheet": "项目", "row": group["row"], "msg": str(error)})
        try:
            db.session.commit()
        except Exception as error:
            db.session.rollback()
            return jsonify({"error": f"导入失败：{error}"}), 500
        return jsonify({"success": success, "failed": len(invalid_numbers), "errors": errors})

    def import_registrations(pid):
        import consortium_registration

        unauthorized = _require_login()
        if unauthorized is not None:
            return unauthorized
        upload = request.files.get("file")
        if upload is None or not upload.filename:
            return jsonify({"error": "请选择要导入的文件"}), 400
        raw = upload.read()
        if zipfile.is_zipfile(io.BytesIO(raw)):
            try:
                workbook = read_workbook(raw)
            except ValueError as error:
                return jsonify({'error': str(error)}), 400
            if not workbook:
                return jsonify({'error': '文件为空或表头无法识别'}), 400
            if "供应商报名" in workbook:
                headers, rows = workbook["供应商报名"]
            else:
                headers, rows = next(iter(workbook.values()))
            if not headers:
                return jsonify({"error": "文件为空或表头无法识别"}), 400
        else:
            return jsonify({"error": "仅支持 .xlsx 格式（系统未内置 openpyxl）"}), 400

        project = db.session.get(Project, pid)
        if project is None:
            return jsonify({"error": "项目不存在"}), 404
        if project.is_terminated:
            return jsonify({"error": "项目已关闭"}), 400

        lots = {lot.lot_number: lot.id for lot in (getattr(project, "lots", None) or [])}
        mapping = _resolve_aliases(headers, _REGISTRATION_HEADER_ALIASES)
        if "company_name" not in mapping:
            return jsonify({"error": "供应商报名工作表缺少必填表头：公司名称/联合体牵头单位"}), 400
        updated = 0
        ignored = 0
        success = 0
        failed = 0
        errors = []
        consortium_registration.ensure_schema(db)
        consortium_registration.registration_write_lock.acquire()
        try:
            existing_by_key = {consortium_registration.supplier_identity(row.company_name, row.lot_id): row
                               for row in db.session.query(SupplierRegistration).filter_by(project_id=pid).all()}
            for record in rows:
                row_index = getattr(record, "source_row", 2)
                if not any(str(value or "").strip() for value in record.values()):
                    continue
                try:
                    company_name = _field(record, mapping, "company_name")
                    if not company_name:
                        raise ValueError("公司名称不能为空")
                    lot_value = _field(record, mapping, "lot_number")
                    if len(lots) > 1 and not lot_value:
                        raise ImportCellError("所属包号", "多包项目必须填写所属包号")
                    if lot_value and lot_value not in lots:
                        choices = "、".join(lots) or "当前项目无分包"
                        raise ImportCellError("所属包号", f"所属包号不存在；可选值：{choices}")
                    lot_id = lots.get(lot_value) if lot_value else None
                    identity = consortium_registration.supplier_identity(company_name, lot_id)
                    existing = existing_by_key.get(identity)
                    if existing is not None:
                        values = {}
                        for field in ("company_address", "legal_representative", "bid_manager", "manager_phone", "manager_email", "acquisition_date", "registration_method", "notes"):
                            incoming = _field(record, mapping, field)
                            if incoming and not str(getattr(existing, field, None) or '').strip():
                                if field == 'manager_email': incoming = _parse_with_column("电子邮箱", _validate_optional_email, incoming)
                                if field == 'acquisition_date': incoming = _parse_with_column("获取日期", _parse_optional_date, incoming)
                                if field == 'registration_method': incoming = _parse_with_column("报名方式", _parse_registration_method, incoming)
                                values[field] = incoming
                        with db.session.begin_nested():
                            for field, value in values.items(): setattr(existing, field, value)
                            db.session.flush()
                        if values: updated += 1
                        else: ignored += 1
                        continue
                    bidder_type = _parse_with_column("投标主体类型", _parse_bidder_type, _field(record, mapping, "bidder_type"))
                    member_names = [
                        name.strip()
                        for name in re.split(r"[;；]", _field(record, mapping, "consortium_members"))
                        if name.strip()
                    ]
                    normalized = consortium_registration.validate_payload(
                        {
                            "bidder_type": bidder_type,
                            "company_name": company_name,
                            "consortium_members": [
                                {"company_name": name} for name in member_names
                            ],
                        }
                    )
                    with db.session.begin_nested():
                        registration = SupplierRegistration(
                            project_id=pid,
                            lot_id=lot_id,
                            company_name=normalized["company_name"],
                            company_address=_field(record, mapping, "company_address"),
                            legal_representative=_field(record, mapping, "legal_representative"),
                            bid_manager=_field(record, mapping, "bid_manager"),
                            manager_phone=_field(record, mapping, "manager_phone"),
                            manager_email=_parse_with_column("电子邮箱", _validate_optional_email, _field(record, mapping, "manager_email")),
                            acquisition_date=_parse_with_column("获取日期", _parse_optional_date, _field(record, mapping, "acquisition_date")),
                            registration_method=_parse_with_column("报名方式", _parse_registration_method, _field(record, mapping, "registration_method")),
                            notes=_field(record, mapping, "notes"),
                        )
                        db.session.add(registration)
                        db.session.flush()
                        consortium_registration.replace_members(
                            db,
                            registration.id,
                            normalized["bidder_type"],
                            normalized["consortium_members"],
                        )
                    existing_by_key[identity] = registration
                    success += 1
                except Exception as error:
                    failed += 1
                    errors.append({"sheet": "供应商报名", "row": row_index, "column": getattr(error, "column", ""), "msg": str(error)})
            db.session.commit()
        except Exception as error:
            db.session.rollback()
            return jsonify({"error": f"导入失败：{error}"}), 500
        finally:
            consortium_registration.registration_write_lock.release()
        return jsonify({"success": success, "updated": updated, "ignored": ignored, "failed": failed, "errors": errors})

    app.add_url_rule(
        "/api/import/projects",
        "api_import_projects",
        import_projects,
        methods=["POST"],
    )
    app.add_url_rule(
        "/api/projects/<int:pid>/registrations/import",
        "api_import_registrations",
        import_registrations,
        methods=["POST"],
    )

    def import_templates():
        unauthorized = _require_login()
        if unauthorized is not None:
            return unauthorized
        kind = request.args.get("kind", "projects").strip().lower()
        if kind == "registrations":
            lot_numbers = []
            raw_project_id = request.args.get("project_id")
            if raw_project_id:
                try:
                    project = db.session.get(Project, int(raw_project_id))
                except (TypeError, ValueError):
                    project = None
                if project is None:
                    return jsonify({"error": "项目不存在，无法生成供应商模板"}), 404
                lot_numbers = [
                    str(lot.lot_number)
                    for lot in (getattr(project, "lots", None) or [])
                    if str(getattr(lot, "lot_number", "") or "").strip()
                ]
            body = build_import_template("registrations", lot_numbers=lot_numbers)
            filename = "供应商报名导入模板.xlsx"
        else:
            body = build_import_template("projects")
            filename = "项目导入模板.xlsx"
        from datetime import datetime
        from urllib.parse import quote

        if request.args.get("save") == "1":
            get_export_dir = models.get("get_export_dir")
            if get_export_dir is None:
                return jsonify({"error": "导出目录不可用"}), 500
            export_dir = get_export_dir()
            export_dir.mkdir(parents=True, exist_ok=True)
            output_path = export_dir / filename
            if output_path.exists():
                stamp = datetime.now().strftime("%Y%m%d%H%M%S")
                base = (
                    "供应商报名导入模板"
                    if kind == "registrations"
                    else "项目导入模板"
                )
                output_path = export_dir / f"{base}_{stamp}.xlsx"
            output_path.write_bytes(body)
            return jsonify(
                {
                    "message": "模板已生成",
                    "filename": output_path.name,
                    "path": str(output_path),
                    "folder": str(export_dir),
                }
            )

        return app.response_class(
            body,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": (
                    f'attachment; filename="template.xlsx"; '
                    f"filename*=UTF-8''{quote(filename)}"
                )
            },
        )

    app.add_url_rule(
        "/api/import/templates",
        "api_import_templates",
        import_templates,
        methods=["GET"],
    )


def register_routes(app, db, models):
    """Register import routes once. Safe to call repeatedly."""
    global _IMPORT_ROUTES_REGISTERED
    if _IMPORT_ROUTES_REGISTERED:
        return
    try:
        _build_import_routes(app, db, models)
        _IMPORT_ROUTES_REGISTERED = True
    except Exception:
        # 注册失败不阻断调用方；保留抛出以便排查，下次请求会重试
        raise
