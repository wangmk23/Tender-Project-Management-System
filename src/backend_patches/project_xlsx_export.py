"""Streaming OOXML (.xlsx) project list export service.

project-xlsx-export-v1
"""
from __future__ import annotations

from datetime import date as _default_date, datetime as _default_datetime
from typing import Any

try:
    from sqlalchemy.orm import joinedload as _default_joinedload
except Exception:  # pragma: no cover
    def _default_joinedload(*args: Any, **kwargs: Any) -> Any:
        return None

PROJECT_XLSX_EXPORT_SIGNATURE = "project-xlsx-export-v1"


def api_export(ctx: Any = None):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    if ctx is None:
        ctx = runtime_context.current_context(depth=1)
    else:
        ctx = runtime_context.get_runtime_context(ctx)

    DATA_DIR = ctx.get("DATA_DIR")
    Project = ctx.get("Project")
    STAGES = ctx.get("STAGES", [])
    app = ctx.get("app")
    date = ctx.get("date", _default_date)
    datetime = ctx.get("datetime", _default_datetime)
    db = ctx.get("db")
    get_export_dir = ctx.get("get_export_dir")
    joinedload = ctx.get("joinedload", _default_joinedload)
    jsonify = ctx.get("jsonify", lambda v: v)
    load_app_settings = ctx.get("load_app_settings", lambda: {})
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    request = ctx.get("request")
    from io import BytesIO
    from urllib.parse import quote
    from xml.sax.saxutils import escape
    from zipfile import ZIP_DEFLATED, ZipFile
    try:
        import signed_attachments
    except ModuleNotFoundError:
        from src.backend_patches import signed_attachments
    try:
        import stage_workflow
    except ModuleNotFoundError:
        from src.backend_patches import stage_workflow

    selected_year = request.args.get("year", "").strip()
    query = Project.query.options(
        joinedload(Project.stages), joinedload(Project.lots), joinedload(Project.bid_results)
    )
    if selected_year:
        query = query.filter(Project.year == selected_year)
    projects = query.order_by(Project.year.desc(), Project.number.desc()).all()

    headers = [
        "序号",
        "项目编号",
        "项目名称",
        "采购人",
        "年度",
        "采购方式",
        "项目预算(元)",
        "包号",
        "包名",
        "包预算(元)",
        "公告发布时间",
        "开标时间",
        "当前阶段",
        "项目状态",
        "进度%",
        "中标/成交供应商",
        "中标金额/折扣率",
        "备注",
        "附件链接",
    ]
    widths = [6, 20, 38, 26, 8, 13, 14, 10, 24, 14, 14, 14, 12, 10, 8, 26, 18, 34, 46]

    def display_date(value):
        if not value:
            return ""
        if hasattr(value, "strftime"):
            return value.strftime("%Y-%m-%d")
        return str(value)

    def stage_date(stages, stage_key):
        for stage in stages:
            if getattr(stage, "stage_key", None) == stage_key:
                return display_date(
                    getattr(stage, "completed_date", None)
                    or getattr(stage, "planned_datetime", None)
                )
        return ""

    def bid_values(bids):
        suppliers = []
        amounts = []
        for bid in bids:
            supplier = getattr(bid, "winning_supplier", None)
            amount = getattr(bid, "winning_amount", None)
            if amount is None or amount == "":
                amount = getattr(bid, "discount_rate", None)
            if supplier:
                suppliers.append(str(supplier))
            if amount is not None and amount != "":
                amounts.append(str(amount))
        return "、".join(suppliers), "、".join(amounts)

    def project_status(project):
        if getattr(project, "is_terminated", False):
            terminated_type = getattr(project, "terminated_type", None)
            if terminated_type in ("流标", "废标", "终止"):
                return terminated_type
            return "已终止"
        try:
            completed = float(getattr(project, "progress", 0) or 0) >= 100
        except (TypeError, ValueError):
            completed = False
        return "已完成" if completed else "进行中"

    settings = load_app_settings()
    ordered_stages = stage_workflow.ordered_stage_definitions(STAGES, settings)
    stage_order = [stage["key"] for stage in ordered_stages]
    stage_names = {stage["key"]: stage["name"] for stage in ordered_stages}
    generated_at = datetime.now()
    attachment_expires_at = int(generated_at.timestamp()) + 7 * 24 * 60 * 60
    attachment_secret = None
    base_url = str(getattr(request, "host_url", "") or "").rstrip("/")
    if "127.0.0.1" in base_url or "localhost" in base_url:
        try:
            import socket
            probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            try:
                probe.connect(("10.255.255.255", 1))
                local_ip = probe.getsockname()[0]
            except Exception:
                local_ip = socket.gethostbyname(socket.gethostname())
            finally:
                probe.close()
            if local_ip and not local_ip.startswith("127."):
                host_str = str(getattr(request, "host", "") or "")
                port = host_str.split(":")[-1] if ":" in host_str else "5001"
                base_url = f"http://{local_ip}:{port}"
        except Exception:
            pass
    attachment_catalog = []
    rows = []
    catalog_export=ctx.get('_PROCUREMENT_CATALOG_ENABLED',False)
    snapshots={};lot_snapshots={};stage_snapshots={};row_scopes=[]
    if catalog_export:
        try:import procurement_catalog as catalog
        except ModuleNotFoundError:from src.backend_patches import procurement_catalog as catalog
        from sqlalchemy import text as catalog_sql
        snapshots={r[0]:__import__('json').loads(r[1]) for r in db.session.execute(catalog_sql('SELECT project_id,snapshot_json FROM project_procurement_snapshots'))}
        lot_snapshots={r[0]:__import__('json').loads(r[1]) for r in db.session.execute(catalog_sql('SELECT lot_id,snapshot_json FROM lot_procurement_snapshots'))}
        for r in db.session.execute(catalog_sql('SELECT * FROM stages ORDER BY COALESCE(stage_position,id),id')).mappings():
            if not r['template_removed']:stage_snapshots.setdefault(r['project_id'],[]).append(dict(r))
    for project in projects:
        stages = list(getattr(project, "stages", None) or [])
        lots = list(getattr(project, "lots", None) or [])
        bid_results = list(getattr(project, "bid_results", None) or [])
        project_attachments = []
        attachment_model = ctx.get("Attachment")
        if attachment_model is not None and hasattr(attachment_model, "query"):
            try:
                project_attachments = attachment_model.query.filter_by(
                    project_id=project.id
                ).all()
            except Exception:
                project_attachments = []
        attachment_names = []
        attachment_first_url = ""
        for attachment in project_attachments:
            attachment_names.append(getattr(attachment, "filename", None) or f"附件{attachment.id}")
            if not attachment_first_url:
                if attachment_secret is None:
                    attachment_secret = signed_attachments.get_or_create_secret(DATA_DIR)
                attachment_first_url = signed_attachments.build_signed_url(
                    base_url,
                    attachment.id,
                    attachment_expires_at,
                    attachment_secret,
                )
        if attachment_first_url:
            attachment_display = (
                attachment_names[0]
                if len(attachment_names) == 1
                else f"附件({len(attachment_names)}个)"
            )
            attachment_links = f"HYPERLINK::{attachment_first_url}::{attachment_display}"
        else:
            attachment_links = ""
        for attachment in project_attachments:
            if attachment_secret is None:
                attachment_secret = signed_attachments.get_or_create_secret(DATA_DIR)
            attachment_catalog.append(
                {
                    "project_number": getattr(project, "number", None) or "",
                    "project_name": getattr(project, "name", None) or "",
                    "year": getattr(project, "year", None) or "",
                    "filename": getattr(attachment, "filename", None) or f"附件{attachment.id}",
                    "expires_at": datetime.fromtimestamp(attachment_expires_at).strftime("%Y-%m-%d %H:%M:%S"),
                    "url": signed_attachments.build_signed_url(
                        base_url,
                        attachment.id,
                        attachment_expires_at,
                        attachment_secret,
                    ),
                }
            )
        progress = getattr(project, "progress", None)
        current_stage_key = getattr(project, "current_stage_key", None)
        if "stage_order" in settings:
            project_stage_by_key = {
                getattr(stage, "stage_key", None) or getattr(stage, "key", None): stage
                for stage in stages
            }
            current_stage_key = next(
                (
                    key
                    for key in stage_order
                    if key in project_stage_by_key
                    and not bool(getattr(project_stage_by_key[key], "completed", False))
                    and not bool(getattr(project_stage_by_key[key], "skipped", False))
                ),
                None,
            )
        current_stage = (
            "网上竞价"
            if current_stage_key == "online_bidding"
            else stage_names.get(current_stage_key, "")
        )
        if catalog_export:
            actual=stage_snapshots.get(project.id,[])
            progress=round(100*sum(bool(x.get('completed') or x.get('skipped')) for x in actual)/len(actual)) if actual else 0
            pending=next((x for x in actual if not(x.get('completed') or x.get('skipped'))),None)
            current_stage=(pending.get('stage_name') or stage_names.get(pending['stage_key'],pending['stage_key'])) if pending else '已完成'
        common_values = [
            getattr(project, "number", None) or "",
            getattr(project, "name", None) or "",
            getattr(project, "purchaser", None) or "",
            getattr(project, "year", None) or "",
            getattr(project, "method", None) or "",
            getattr(project, "budget", None) if getattr(project, "budget", None) is not None else "",
            stage_date(stages, "announcement"),
            stage_date(stages, "bid_opening"),
            current_stage,
            project_status(project),
            progress if progress is not None else "",
            getattr(project, "notes", None) or "",
        ]

        if lots:
            for lot in lots:
                lot_bids = [
                    bid
                    for bid in bid_results
                    if getattr(bid, "lot_id", None) == getattr(lot, "id", None)
                ]
                suppliers, amounts = bid_values(lot_bids)
                row_scopes.append((project.id,lot.id))
                rows.append(
                    [
                        common_values[0],
                        common_values[1],
                        common_values[2],
                        common_values[3],
                        common_values[4],
                        common_values[5],
                        getattr(lot, "lot_number", None) or "",
                        getattr(lot, "lot_name", None) or "",
                        getattr(lot, "budget", None)
                        if getattr(lot, "budget", None) is not None
                        else "",
                        common_values[6],
                        common_values[7],
                        common_values[8],
                        common_values[9],
                        common_values[10],
                        suppliers,
                        amounts,
                        common_values[11],
                        attachment_links,
                    ]
                )
        else:
            suppliers, amounts = bid_values(bid_results)
            row_scopes.append((project.id,None))
            rows.append(
                [
                    common_values[0],
                    common_values[1],
                    common_values[2],
                    common_values[3],
                    common_values[4],
                    common_values[5],
                    "",
                    "",
                    "",
                    common_values[6],
                    common_values[7],
                    common_values[8],
                    common_values[9],
                    common_values[10],
                    suppliers,
                    amounts,
                    common_values[11],
                    attachment_links,
                ]
            )

    if catalog_export:
        headers += ['采购方式标识','适用制度'];widths += [36,38]
        for values,scope in zip(rows,row_scopes):
            snap=lot_snapshots.get(scope[1]) or snapshots.get(scope[0],{})
            values[4]=snap.get('name_snapshot',values[4])
            values += [snap.get('method_id',''),catalog.REGIMES.get(snap.get('regime'),'待确认制度')]

    def cell_ref(column, row):
        letters = ""
        while column:
            column, remainder = divmod(column - 1, 26)
            letters = chr(65 + remainder) + letters
        return f"{letters}{row}"

    def xml_text(value):
        text = "" if value is None else str(value)
        text = "".join(
            character
            for character in text
            if ord(character) in (0x09, 0x0A, 0x0D)
            or 0x20 <= ord(character) <= 0xD7FF
            or 0xE000 <= ord(character) <= 0xFFFD
            or 0x10000 <= ord(character) <= 0x10FFFF
        )
        return escape(text)

    def cell_xml(row, column, value, style):
        attributes = f' r="{cell_ref(column, row)}" s="{style}"'
        if isinstance(value, (int, float)) and not isinstance(value, bool):
            return f"<c{attributes}><v>{value}</v></c>"
        text = "" if value is None else str(value)
        if not text:
            return f"<c{attributes}/>"
        if text.startswith("HYPERLINK::"):
            parts = text.split("::", 2)
            if len(parts) == 3:
                url, display = parts[1], parts[2]
                url_formula = url.replace('"', '""')
                display_formula = display.replace('"', '""')
                formula = f'HYPERLINK("{url_formula}", "{display_formula}")'
                return f'<c{attributes}><f>{xml_text(formula)}</f></c>'
        preserve = ' xml:space="preserve"' if text != text.strip() else ""
        return f'<c{attributes} t="inlineStr"><is><t{preserve}>{xml_text(text)}</t></is></c>'

    def row_xml(row_number, values, style, status_style=None):
        cells = []
        for column, value in enumerate(values, 1):
            cell_style = status_style if column == 14 and status_style is not None else style
            cells.append(cell_xml(row_number, column, value, cell_style))
        return f'<row r="{row_number}">{"".join(cells)}</row>'

    status_styles = {"已完成": 6, "进行中": 7, "流标": 8, "废标": 8, "终止": 8, "已终止": 8}
    title = "项目导出清单"
    year_label = selected_year or "全部年份"

    def filename_component(value, fallback, ascii_only=False):
        component = []
        pending_separator = False
        for character in str(value):
            allowed = character.isalnum() or character in ("-", "_")
            if ascii_only:
                allowed = allowed and character.isascii()
            if allowed:
                if pending_separator and component:
                    component.append("_")
                component.append(character)
                pending_separator = False
            else:
                pending_separator = True
        return "".join(component).strip("_-") or fallback

    filename_year = (
        filename_component(selected_year, "year") if selected_year else "全部年份"
    )
    metadata = (
        f"导出时间：{generated_at.strftime('%Y-%m-%d %H:%M:%S')}    "
        f"筛选年份：{year_label}    项目数：{len(projects)}"
    )
    sheet_rows = [
        f'<row r="1">{cell_xml(1, 1, title, 1)}</row>',
        f'<row r="2">{cell_xml(2, 1, metadata, 2)}</row>',
        row_xml(4, headers, 3),
    ]
    if rows:
        for row_number, values in enumerate(rows, 5):
            style = 5 if (row_number - 5) % 2 else 0
            status = values[12]
            sheet_rows.append(row_xml(row_number, [row_number - 4, *values], style, status_styles.get(status)))
        last_row = 4 + len(rows)
        end_col=cell_ref(len(headers),1)[:-1]
        merges = f'<mergeCell ref="A1:{end_col}1"/><mergeCell ref="A2:{end_col}2"/>'
    else:
        sheet_rows.append(f'<row r="5">{cell_xml(5, 1, "暂无符合条件的数据", 4)}</row>')
        last_row = 5
        end_col=cell_ref(len(headers),1)[:-1]
        merges = f'<mergeCell ref="A1:{end_col}1"/><mergeCell ref="A2:{end_col}2"/><mergeCell ref="A5:{end_col}5"/>'

    cols = "".join(
        f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
        for index, width in enumerate(widths, 1)
    )
    sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A5" sqref="A5"/></sheetView></sheetViews>
  <cols>{cols}</cols>
  <sheetData>{"".join(sheet_rows)}</sheetData>
  <autoFilter ref="A4:{end_col}{last_row}"/>
  <mergeCells count="{3 if not rows else 2}">{merges}</mergeCells>
</worksheet>'''

    def sheet_cell_xml(row, column, value, link_url=None):
        letters = ""
        while column:
            column, remainder = divmod(column - 1, 26)
            letters = chr(65 + remainder) + letters
        ref = f"{letters}{row}"
        style = 3 if row == 1 else 0
        attributes = f' r="{ref}" s="{style}"'
        text = "" if value is None else str(value)
        escaped = xml_text(text)
        if link_url:
            url_formula = link_url.replace('"', '""')
            formula = f'HYPERLINK("{url_formula}", "{text.replace(chr(34), chr(34) * 2)}")'
            return f'<c{attributes}><f>{xml_text(formula)}</f></c>'
        if not text:
            return f'<c{attributes}/>'
        return f'<c{attributes} t="inlineStr"><is><t>{escaped}</t></is></c>'

    sheet2_rows = [
        '<row r="1">'
        + sheet_cell_xml(1, 1, "项目编号")
        + sheet_cell_xml(1, 2, "项目名称")
        + sheet_cell_xml(1, 3, "年度")
        + sheet_cell_xml(1, 4, "附件文件名")
        + sheet_cell_xml(1, 5, "链接到期时间")
        + sheet_cell_xml(1, 6, "下载链接")
        + '</row>'
    ]
    for catalog_index, item in enumerate(attachment_catalog, start=2):
        sheet2_rows.append(
            f'<row r="{catalog_index}">'
            + sheet_cell_xml(catalog_index, 1, item["project_number"])
            + sheet_cell_xml(catalog_index, 2, item["project_name"])
            + sheet_cell_xml(catalog_index, 3, item["year"])
            + sheet_cell_xml(catalog_index, 4, item["filename"])
            + sheet_cell_xml(catalog_index, 5, item["expires_at"])
            + sheet_cell_xml(catalog_index, 6, "下载", item["url"])
            + '</row>'
        )
    if not attachment_catalog:
        sheet2_rows.append('<row r="2">' + sheet_cell_xml(2, 1, "暂无附件") + '</row>')
    sheet2_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>{"".join(sheet2_rows)}</sheetData>
</worksheet>'''
    styles_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="10"/><name val="Microsoft YaHei"/></font><font><b/><sz val="10"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts>
  <fills count="9"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF1F4E78"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEAF2F8"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF7FBF9"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF3F4F6"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9EAD3"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFFFF2CC"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4CCCC"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right><top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="5" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="4" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyAlignment="1" applyBorder="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>'''
    content_types_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>'''
    package_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>'''
    workbook_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="项目导出" sheetId="1" r:id="rId1"/><sheet name="附件清单" sheetId="2" r:id="rId3"/></sheets></workbook>'''
    workbook_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'''
    app_properties_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Project Management System</Application></Properties>'''
    core_properties_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:creator>Project Management System</dc:creator><cp:lastModifiedBy>Project Management System</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">{generated_at.strftime('%Y-%m-%dT%H:%M:%SZ')}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{generated_at.strftime('%Y-%m-%dT%H:%M:%SZ')}</dcterms:modified></cp:coreProperties>'''

    output = BytesIO()
    with ZipFile(output, "w", ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", content_types_xml)
        archive.writestr("_rels/.rels", package_relationships_xml)
        archive.writestr("docProps/app.xml", app_properties_xml)
        archive.writestr("docProps/core.xml", core_properties_xml)
        archive.writestr("xl/workbook.xml", workbook_xml)
        archive.writestr("xl/_rels/workbook.xml.rels", workbook_relationships_xml)
        archive.writestr("xl/styles.xml", styles_xml)
        archive.writestr("xl/worksheets/sheet1.xml", sheet_xml)
        archive.writestr("xl/worksheets/sheet2.xml", sheet2_xml)
    workbook_bytes = output.getvalue()

    today = date.today().strftime("%Y-%m-%d")
    filename = f"项目列表_{filename_year}_{today}.xlsx"

    def contained_export_path(export_dir, name):
        resolved_export_dir = export_dir.resolve()
        output_path = export_dir / name
        resolved_output_path = output_path.resolve()
        if resolved_export_dir not in resolved_output_path.parents:
            raise ValueError("export path must remain inside the export directory")
        return output_path

    if request.args.get("save") == "1":
        export_dir = get_export_dir()
        export_dir.mkdir(parents=True, exist_ok=True)
        output_path = contained_export_path(export_dir, filename)
        if output_path.exists():
            collision_filename = (
                f"项目列表_{filename_year}_{today}_{datetime.now().strftime('%H%M%S')}.xlsx"
            )
            output_path = contained_export_path(export_dir, collision_filename)
        output_path.write_bytes(workbook_bytes)
        log_operation("export_projects", "project", None, f"导出项目列表（{len(projects)}个）")
        return jsonify(
            {
                "message": "项目列表已导出",
                "filename": output_path.name,
                "path": str(output_path),
                "folder": str(export_dir),
                "year": selected_year,
                "count": len(projects),
            }
        )

    ascii_year = (
        filename_component(selected_year, "year", ascii_only=True)
        if selected_year
        else "all"
    )
    ascii_filename = f"ProjectList_{ascii_year}_{today}.xlsx"
    disposition = (
        f'attachment; filename="{ascii_filename}"; '
        f"filename*=UTF-8''{quote(filename)}"
    )
    return app.response_class(
        workbook_bytes,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": disposition},
    )
