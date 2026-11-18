"""Supplier registration CRUD, consortium serialization, and workbook export routes.

registration-routes-v1
"""
from __future__ import annotations

from datetime import date as _default_date
from typing import Any

REGISTRATION_ROUTES_SIGNATURE = "registration-routes-v1"


def _ctx(ctx: Any = None):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    if ctx is None:
        return runtime_context.current_context(depth=2)
    return runtime_context.get_runtime_context(ctx)


def supplier_registration_to_dict(ctx: Any, self: Any):
    ctx = _ctx(ctx)
    db = ctx.get("db")
    try:
        from . import consortium_registration
    except ImportError:
        import consortium_registration
    consortium_contract = (
        "bidder_type",
        "consortium_members",
        "registration_consortium_members",
    )
    payload = {
        "id": self.id,
        "project_id": self.project_id,
        "lot_id": self.lot_id,
        "lot_number": self.lot.lot_number if self.lot else "",
        "lot_name": self.lot.lot_name if self.lot else "",
        "company_name": self.company_name,
        "company_address": self.company_address,
        "legal_representative": self.legal_representative,
        "bid_manager": self.bid_manager,
        "manager_phone": self.manager_phone,
        "manager_email": self.manager_email,
        "acquisition_date": (
            self.acquisition_date.isoformat() if self.acquisition_date else None
        ),
        "notes": self.notes,
        "registration_method": self.registration_method or "线上报名",
        "attachments": sorted(
            (attachment.to_dict() for attachment in self.attachments),
            key=lambda item: item.get("uploaded_at") or "",
        ),
    }
    if not consortium_contract:
        raise RuntimeError("consortium serializer contract is unavailable")
    return consortium_registration.enrich_registration(db, payload)


def api_get_registrations(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    DATA_DIR = ctx.get("DATA_DIR")
    Project = ctx.get("Project")
    SupplierRegistration = ctx.get("SupplierRegistration")
    app = ctx.get("app")
    db = ctx.get("db")
    get_export_dir = ctx.get("get_export_dir")
    jsonify = ctx.get("jsonify", lambda v: v)
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    request = ctx.get("request")
    def _build_registration_xlsx(records):
        """Build an .xlsx (SpreadsheetML) for a list of registration dicts.

        ``records`` is a list of dicts conforming to ``supplier_registration_to_dict``
        output (each with company_name / lot_number / bid_manager / manager_phone /
        manager_email / acquisition_date / registration_method / attachments).
        Returns the raw xlsx bytes and the display filename.
        """
        from io import BytesIO
        from datetime import datetime
        from urllib.parse import quote
        from xml.sax.saxutils import escape
        from zipfile import ZIP_DEFLATED, ZipFile
        try:
            from . import signed_attachments
        except ImportError:
            import signed_attachments
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
        generated_at = datetime.now()
        expires_at = int(generated_at.timestamp()) + 7 * 24 * 60 * 60
        secret = None
        attachment_catalog = []

        headers = [
            "序号",
            "项目编号",
            "项目名称",
            "年度",
            "所属包号",
            "投标主体类型",
            "公司名称/联合体牵头单位",
            "联合体成员",
            "报名方式",
            "公司地址",
            "法定代表人",
            "投标负责人",
            "手机号",
            "电子邮箱",
            "获取日期",
            "备注",
            "附件数量",
            "首个附件链接",
        ]
        widths = [6, 20, 34, 9, 12, 14, 30, 34, 14, 28, 16, 16, 18, 26, 14, 30, 10, 46]

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
                    url_formula = parts[1].replace('"', '""')
                    display_formula = parts[2].replace('"', '""')
                    formula = f'HYPERLINK("{url_formula}", "{display_formula}")'
                    return f'<c{attributes}><f>{xml_text(formula)}</f></c>'
            preserve = ' xml:space="preserve"' if text != text.strip() else ""
            return f'<c{attributes} t="inlineStr"><is><t{preserve}>{xml_text(text)}</t></is></c>'

        rows_xml = []
        for index, record in enumerate(records, start=1):
            attachments = record.get("attachments") or []
            signed_links = []
            for attachment in attachments:
                attachment_id = attachment.get("id")
                if attachment_id is None:
                    continue
                if secret is None:
                    secret = signed_attachments.get_or_create_secret(DATA_DIR)
                url = signed_attachments.build_signed_url(
                    base_url, attachment_id, expires_at, secret
                )
                signed_links.append(url)
                attachment_catalog.append(
                    {
                        "project_number": record.get("project_number", "") or "",
                        "project_name": record.get("project_name", "") or "",
                        "company_name": record.get("company_name", "") or "",
                        "filename": attachment.get("filename", "") or f"附件{attachment_id}",
                        "expires_at": datetime.fromtimestamp(expires_at).strftime("%Y-%m-%d %H:%M:%S"),
                        "url": url,
                    }
                )
            members = record.get("consortium_members") or []
            member_text = "；".join(
                str(member.get("company_name", "") or "").strip()
                for member in members
                if isinstance(member, dict) and str(member.get("company_name", "") or "").strip()
            )
            bidder_type = "联合体" if record.get("bidder_type") == "consortium" else "单独投标"
            first_link = (
                f"HYPERLINK::{signed_links[0]}::{attachments[0].get('filename') or '下载附件'}"
                if signed_links
                else ""
            )
            values = [
                index,
                record.get("project_number", "") or "",
                record.get("project_name", "") or "",
                record.get("project_year", "") or "",
                record.get("lot_number", "") or "",
                bidder_type,
                record.get("company_name", "") or "",
                member_text,
                record.get("registration_method", "") or "线上报名",
                record.get("company_address", "") or "",
                record.get("legal_representative", "") or "",
                record.get("bid_manager", "") or "",
                record.get("manager_phone", "") or "",
                record.get("manager_email", "") or "",
                record.get("acquisition_date", "") or "",
                record.get("notes", "") or "",
                len(signed_links),
                first_link,
            ]
            style = 5 if index % 2 else 0
            cells = "".join(
                cell_xml(index + 4, column, value, style)
                for column, value in enumerate(values, 1)
            )
            rows_xml.append(f'<row r="{index + 4}">{cells}</row>')

        title = "供应商报名清单"
        metadata = (
            f"导出时间：{generated_at.strftime('%Y-%m-%d %H:%M:%S')}    "
            f"报名记录数：{len(records)}"
        )
        sheet_rows = [
            f'<row r="1">{cell_xml(1, 1, title, 1)}</row>',
            f'<row r="2">{cell_xml(2, 1, metadata, 2)}</row>',
            f'<row r="4">{"".join(cell_xml(4, column, header, 3) for column, header in enumerate(headers, 1))}</row>',
        ]
        if rows_xml:
            sheet_rows.extend(rows_xml)
            last_row = 4 + len(records)
            merges = '<mergeCell ref="A1:R1"/><mergeCell ref="A2:R2"/>'
        else:
            sheet_rows.append(f'<row r="5">{cell_xml(5, 1, "暂无报名记录", 4)}</row>')
            last_row = 5
            merges = '<mergeCell ref="A1:R1"/><mergeCell ref="A2:R2"/><mergeCell ref="A5:R5"/>'

        cols = "".join(
            f'<col min="{index}" max="{index}" width="{width}" customWidth="1"/>'
            for index, width in enumerate(widths, 1)
        )
        sheet_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
      <cols>{cols}</cols>
      <sheetData>{"".join(sheet_rows)}</sheetData>
      <autoFilter ref="A4:R{last_row}"/>
      <mergeCells count="{3 if not records else 2}">{merges}</mergeCells>
    </worksheet>'''
        catalog_headers = [
            "项目编号",
            "项目名称",
            "报名公司",
            "附件文件名",
            "链接到期时间",
            "下载链接",
        ]
        catalog_rows = [
            '<row r="1">'
            + "".join(
                cell_xml(1, column, header, 3)
                for column, header in enumerate(catalog_headers, 1)
            )
            + "</row>"
        ]
        for catalog_index, item in enumerate(attachment_catalog, start=2):
            values = [
                item["project_number"],
                item["project_name"],
                item["company_name"],
                item["filename"],
                item["expires_at"],
                f'HYPERLINK::{item["url"]}::下载',
            ]
            catalog_rows.append(
                f'<row r="{catalog_index}">'
                + "".join(
                    cell_xml(catalog_index, column, value, 0)
                    for column, value in enumerate(values, 1)
                )
                + "</row>"
            )
        if not attachment_catalog:
            catalog_rows.append(
                '<row r="2">' + cell_xml(2, 1, "暂无附件", 0) + "</row>"
            )
        sheet2_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetData>{"".join(catalog_rows)}</sheetData>
    </worksheet>'''
        member_headers = [
            "项目编号", "所属包号", "联合体牵头单位", "成员单位名称", "公司地址",
            "法定代表人", "联系人", "联系电话", "电子邮箱", "备注",
        ]
        member_rows = ['<row r="1">' + ''.join(
            cell_xml(1, column, header, 3)
            for column, header in enumerate(member_headers, 1)
        ) + '</row>']
        for record in records:
            if record.get("bidder_type") != "consortium":
                continue
            for member in record.get("consortium_members") or []:
                if not isinstance(member, dict) or not str(member.get("company_name") or "").strip():
                    continue
                values = [record.get("project_number", ""), record.get("lot_number", ""), record.get("company_name", ""),
                          member.get("company_name", ""), member.get("company_address", ""), member.get("legal_representative", ""),
                          member.get("bid_manager", ""), member.get("manager_phone", ""), member.get("manager_email", ""), member.get("notes", "")]
                member_row = len(member_rows) + 1
                member_rows.append(f'<row r="{member_row}">' + ''.join(
                    cell_xml(member_row, column, value, 0)
                    for column, value in enumerate(values, 1)
                ) + '</row>')
        sheet3_xml = f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
      <cols><col min="1" max="10" width="25" customWidth="1"/></cols>
      <sheetData>{"".join(member_rows)}</sheetData>
      <autoFilter ref="A1:J{len(member_rows)}"/>
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
    <workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="供应商报名" sheetId="1" r:id="rId1"/><sheet name="附件清单" sheetId="2" r:id="rId3"/></sheets></workbook>'''
        workbook_relationships_xml = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
    <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/></Relationships>'''
        content_types_xml = content_types_xml.replace('</Types>', '<Override PartName="/xl/worksheets/sheet3.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>')
        workbook_xml = workbook_xml.replace('</sheets>', '<sheet name="联合体成员资料" sheetId="3" r:id="rId4"/></sheets>')
        workbook_relationships_xml = workbook_relationships_xml.replace('</Relationships>', '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet3.xml"/></Relationships>')
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
            archive.writestr("xl/worksheets/sheet3.xml", sheet3_xml)
        return output.getvalue()
    def _export_registrations_xlsx(pid):
        """Handle ?export=1 for /api/projects/<pid>/registrations.

        Supports scope=current (default) and scope=all (across projects, optional
        year= filter). With save=1 the workbook is written to the export
        directory and a JSON summary is returned (desktop flow).
        """
        from datetime import date, datetime
        from urllib.parse import quote

        scope = request.args.get("scope", "current")
        selected_year = request.args.get("year", "").strip()

        registrations = []
        current_project = None
        if scope == "all":
            query = SupplierRegistration.query.join(Project, SupplierRegistration.project_id == Project.id)
            if selected_year:
                query = query.filter(Project.year == selected_year)
            registrations = query.order_by(Project.year.desc(), Project.number.desc()).all()
        else:
            current_project = db.get_or_404(Project, pid)
            registrations = list(getattr(current_project, "registrations", None) or [])

        records = []
        for registration in registrations:
            record = dict(registration.to_dict())
            project = current_project or getattr(registration, "project", None)
            record["project_number"] = getattr(project, "number", "") or ""
            record["project_name"] = getattr(project, "name", "") or ""
            record["project_year"] = getattr(project, "year", "") or ""
            records.append(record)
        workbook_bytes = _build_registration_xlsx(records)

        today = date.today()
        if scope == "all":
            ascii_year = "all" if not selected_year else str(selected_year)
            filename = f"全部项目报名_{ascii_year}_{today.strftime('%Y%m%d')}.xlsx"
        else:
            filename = f"供应商报名_{today.strftime('%Y%m%d')}.xlsx"

        def contained_registration_path(export_dir, name):
            resolved_export_dir = export_dir.resolve()
            output_path = export_dir / name
            resolved_output_path = output_path.resolve()
            if resolved_export_dir not in resolved_output_path.parents:
                raise ValueError("export path must remain inside the export directory")
            return output_path

        if request.args.get("save") == "1":
            export_dir = get_export_dir()
            export_dir.mkdir(parents=True, exist_ok=True)
            output_path = contained_registration_path(export_dir, filename)
            if output_path.exists():
                collision_name = (
                    f"供应商报名_{today.strftime('%Y%m%d')}"
                    f"_{datetime.now().strftime('%H%M%S')}.xlsx"
                )
                output_path = contained_registration_path(export_dir, collision_name)
            output_path.write_bytes(workbook_bytes)
            log_operation(
                "export_registrations",
                "project",
                pid,
                f"导出供应商报名（{len(records)}条）",
            )
            return jsonify(
                {
                    "message": "供应商报名已导出",
                    "filename": output_path.name,
                    "path": str(output_path),
                    "folder": str(export_dir),
                    "count": len(records),
                }
            )

        ascii_filename = f"supplier_registrations_{today.strftime('%Y%m%d')}.xlsx"
        disposition = (
            f'attachment; filename="{ascii_filename}"; '
            f"filename*=UTF-8''{quote(filename)}"
        )
        return app.response_class(
            workbook_bytes,
            mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={"Content-Disposition": disposition},
        )

    try:
        from . import consortium_registration
    except ImportError:
        import consortium_registration
    try:
        if request.args.get("export") == "1":
            return _export_registrations_xlsx(pid)
        consortium_registration.ensure_schema(db)
        project = db.get_or_404(Project, pid)
        return jsonify([registration.to_dict() for registration in project.registrations])
    except Exception as error:
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration list failed")
        return jsonify({"error": "读取报名登记失败"}), 500


def api_create_registration(ctx: Any, pid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    SupplierRegistration = ctx.get("SupplierRegistration")
    _normalize_project_lot_id = ctx.get("_normalize_project_lot_id")
    app = ctx.get("app")
    date = ctx.get("date", _default_date)
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    request = ctx.get("request")
    try:
        from . import consortium_registration
    except ImportError:
        import consortium_registration
    consortium_registration.registration_write_lock.acquire()
    try:
        consortium_registration.ensure_schema(db)
        project = db.get_or_404(Project, pid)
        if project.is_terminated:
            return jsonify({"error": "项目已关闭"}), 400
        data = request.get_json() or {}
        if len(list(getattr(project, "lots", None) or [])) > 1 and not data.get("lot_id"):
            return jsonify({"error": "多包项目的报名必须选择所属包"}), 400
        normalized = consortium_registration.validate_payload(data)
        effective_lot_id = _normalize_project_lot_id(data.get("lot_id"), pid)
        if consortium_registration.find_existing_registration(db, SupplierRegistration, pid, normalized["company_name"], effective_lot_id):
            return jsonify({"error": "该供应商已在本项目的所选采购包报名，请编辑已有记录"}), 409
        acquisition_date = None
        if data.get("acquisition_date"):
            try:
                acquisition_date = date.fromisoformat(data["acquisition_date"])
            except (TypeError, ValueError):
                return jsonify({"error": "获取日期格式无效"}), 400
        registration = SupplierRegistration(
            project_id=pid,
            lot_id=_normalize_project_lot_id(data.get("lot_id"), pid),
            company_name=normalized["company_name"],
            company_address=data.get("company_address", ""),
            legal_representative=data.get("legal_representative", ""),
            bid_manager=data.get("bid_manager", ""),
            manager_phone=data.get("manager_phone", ""),
            manager_email=data.get("manager_email", ""),
            acquisition_date=acquisition_date,
            notes=data.get("notes", ""),
            registration_method=data.get("registration_method", "线上报名"),
        )
        db.session.add(registration)
        db.session.flush()
        consortium_registration.replace_members(
            db,
            registration.id,
            normalized["bidder_type"],
            normalized["consortium_members"],
        )
        db.session.commit()
        return jsonify(registration.to_dict()), 201
    except consortium_registration.ValidationError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        db.session.rollback()
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration create failed")
        return jsonify({"error": "报名登记保存失败"}), 500
    finally:
        consortium_registration.registration_write_lock.release()


def api_update_registration(ctx: Any, pid: int, rid: int):
    ctx = _ctx(ctx)
    Project = ctx.get("Project")
    SupplierRegistration = ctx.get("SupplierRegistration")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    _normalize_project_lot_id = ctx.get("_normalize_project_lot_id")
    app = ctx.get("app")
    date = ctx.get("date", _default_date)
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    request = ctx.get("request")
    try:
        from . import consortium_registration
    except ImportError:
        import consortium_registration
    consortium_registration.registration_write_lock.acquire()
    try:
        consortium_registration.ensure_schema(db)
        registration = _ensure_project_resource(
            db.get_or_404(SupplierRegistration, rid), pid
        )
        data = request.get_json() or {}
        project = db.get_or_404(Project, pid)
        effective_lot_id = data.get("lot_id", getattr(registration, "lot_id", None))
        if len(list(getattr(project, "lots", None) or [])) > 1 and not effective_lot_id:
            return jsonify({"error": "多包项目的报名必须选择所属包"}), 400
        current = consortium_registration.enrich_registration(
            db, {"id": registration.id}
        )
        normalized = consortium_registration.validate_payload(
            {
                "bidder_type": data.get("bidder_type", current["bidder_type"]),
                "company_name": data.get("company_name", registration.company_name),
                "consortium_members": data.get(
                    "consortium_members", current["consortium_members"]
                ),
            },
            current_type=current["bidder_type"],
        )
        effective_lot_id = _normalize_project_lot_id(effective_lot_id, pid)
        if consortium_registration.find_existing_registration(db, SupplierRegistration, pid, normalized["company_name"], effective_lot_id, exclude_id=rid):
            return jsonify({"error": "该供应商已在本项目的所选采购包报名，请编辑已有记录"}), 409
        if "lot_id" in data:
            registration.lot_id = _normalize_project_lot_id(data.get("lot_id"), pid)
        registration.company_name = normalized["company_name"]
        for field in (
            "company_address",
            "legal_representative",
            "bid_manager",
            "manager_phone",
            "manager_email",
            "notes",
            "registration_method",
        ):
            if field in data:
                setattr(registration, field, data[field])
        if "acquisition_date" in data:
            try:
                registration.acquisition_date = (
                    date.fromisoformat(data["acquisition_date"])
                    if data["acquisition_date"]
                    else None
                )
            except (TypeError, ValueError):
                db.session.rollback()
                return jsonify({"error": "获取日期格式无效"}), 400
        consortium_registration.replace_members(
            db,
            registration.id,
            normalized["bidder_type"],
            normalized["consortium_members"],
        )
        db.session.commit()
        return jsonify(registration.to_dict())
    except consortium_registration.ValidationError as error:
        db.session.rollback()
        return jsonify({"error": str(error)}), 400
    except Exception as error:
        db.session.rollback()
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration update failed")
        return jsonify({"error": "报名登记保存失败"}), 500
    finally:
        consortium_registration.registration_write_lock.release()


def api_delete_registration(ctx: Any, pid: int, rid: int):
    ctx = _ctx(ctx)
    SupplierRegistration = ctx.get("SupplierRegistration")
    UPLOAD_FOLDER = ctx.get("UPLOAD_FOLDER")
    _ensure_project_resource = ctx.get("_ensure_project_resource")
    _validate_file_path = ctx.get("_validate_file_path")
    app = ctx.get("app")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    try:
        from . import consortium_registration
    except ImportError:
        import consortium_registration
    try:
        consortium_registration.ensure_schema(db)
        registration = _ensure_project_resource(
            db.get_or_404(SupplierRegistration, rid), pid
        )
        attachments = list(registration.attachments)
        consortium_registration.delete_members(db, registration.id)
        db.session.delete(registration)
        db.session.commit()
        for attachment in attachments:
            try:
                file_path = UPLOAD_FOLDER / attachment.file_path
                _validate_file_path(file_path, attachment.file_path)
                if file_path.exists():
                    file_path.unlink()
                else:
                    app.logger.warning(
                        f"文件不存在，仅清理数据库记录: att_id={attachment.id}"
                    )
            except Exception as error:
                app.logger.warning(
                    f"删除报名附件文件失败: att_id={attachment.id}, {error}"
                )
        return jsonify({"ok": True})
    except Exception as error:
        db.session.rollback()
        if getattr(error, "code", None):
            raise
        app.logger.exception("registration delete failed")
        return jsonify({"error": "删除报名登记失败"}), 500
