import io
import sys
import types
import unittest
import zipfile
from contextlib import nullcontext
from xml.etree import ElementTree as ET

from src.backend_patches import data_import
from src.backend_patches import consortium_registration


MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
PKG_REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships"


def build_two_sheet_fixture():
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            f'''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
            <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
            <Default Extension="xml" ContentType="application/xml"/>
            <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
            <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
            <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
            </Types>''',
        )
        archive.writestr(
            "xl/workbook.xml",
            f'''<workbook xmlns="{MAIN_NS}" xmlns:r="{REL_NS}"><sheets>
            <sheet name="项目" sheetId="1" r:id="rId2"/>
            <sheet name="分包" sheetId="2" r:id="rId1"/>
            </sheets></workbook>''',
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            f'''<Relationships xmlns="{PKG_REL_NS}">
            <Relationship Id="rId1" Type="{REL_NS}/worksheet" Target="worksheets/sheet2.xml"/>
            <Relationship Id="rId2" Type="{REL_NS}/worksheet" Target="worksheets/sheet1.xml"/>
            </Relationships>''',
        )
        archive.writestr(
            "xl/sharedStrings.xml",
            f'''<sst xmlns="{MAIN_NS}" count="3" uniqueCount="3">
            <si><t>项目编号</t></si><si><t>项目名称</t></si><si><t>共享字符串项目</t></si>
            </sst>''',
        )
        archive.writestr(
            "xl/worksheets/sheet1.xml",
            f'''<worksheet xmlns="{MAIN_NS}"><sheetData>
            <row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="inlineStr"><is><t>年度</t></is></c></row>
            <row r="2"><c r="A2" t="inlineStr"><is><t>CG-001</t></is></c><c r="B2" t="s"><v>2</v></c><c r="C2"><v>2026</v></c></row>
            </sheetData></worksheet>''',
        )
        archive.writestr(
            "xl/worksheets/sheet2.xml",
            f'''<worksheet xmlns="{MAIN_NS}"><sheetData>
            <row r="1"><c r="A1" t="inlineStr"><is><t>项目编号</t></is></c><c r="B1" t="inlineStr"><is><t>包号</t></is></c><c r="C1" t="inlineStr"><is><t>包名</t></is></c></row>
            <row r="2"><c r="A2" t="inlineStr"><is><t>CG-001</t></is></c><c r="B2" t="inlineStr"><is><t>包1</t></is></c><c r="C2" t="inlineStr"><is><t>设备</t></is></c></row>
            </sheetData></worksheet>''',
        )
    return output.getvalue()


class WorkbookReaderTests(unittest.TestCase):
    def test_relationships_control_sheet_names_order_and_targets(self):
        workbook = data_import._parse_xlsx_workbook(build_two_sheet_fixture())

        self.assertEqual(list(workbook), ["项目", "分包"])
        self.assertEqual(workbook["项目"][0], ["项目编号", "项目名称", "年度"])
        self.assertEqual(
            workbook["项目"][1][0],
            {"项目编号": "CG-001", "项目名称": "共享字符串项目", "年度": "2026"},
        )
        self.assertEqual(workbook["分包"][1][0]["包号"], "包1")

    def test_legacy_parser_returns_first_named_sheet(self):
        headers, rows = data_import._parse_xlsx(build_two_sheet_fixture())

        self.assertEqual(headers[:2], ["项目编号", "项目名称"])
        self.assertEqual(rows[0]["项目编号"], "CG-001")

    def test_optional_date_accepts_excel_serial_and_common_excel_text(self):
        self.assertEqual(data_import._parse_optional_date("46272").isoformat(), "2026-09-07")
        self.assertEqual(data_import._parse_optional_date("46272.0").isoformat(), "2026-09-07")
        self.assertEqual(data_import._parse_optional_date("2026-09-07 14:30:00").isoformat(), "2026-09-07")
        self.assertEqual(data_import._parse_optional_date("2026年9月7日").isoformat(), "2026-09-07")


class TemplateWorkbookTests(unittest.TestCase):
    def template_parts(self, kind):
        raw = data_import.build_import_template(kind)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            parts = {name: archive.read(name).decode("utf-8") for name in archive.namelist() if name.endswith((".xml", ".rels"))}
        return raw, parts

    def test_project_template_has_complete_sheets_fields_and_color_legend(self):
        raw, parts = self.template_parts("projects")
        workbook = data_import._parse_xlsx_workbook(raw)

        self.assertEqual(list(workbook), ["项目", "分包"])
        self.assertEqual(
            workbook["项目"][0],
            ["项目编号", "项目名称", "采购人", "文件编制负责人", "文件审核负责人", "采购方式", "预算金额", "年度", "无需投标保证金", "备注"],
        )
        self.assertEqual(workbook["分包"][0], ["项目编号", "包号", "包名", "包预算", "备注"])
        self.assertIn('rgb="FFF4CCCC"', parts["xl/styles.xml"])
        self.assertIn('rgb="FFD9EAF7"', parts["xl/styles.xml"])
        self.assertIn("必填字段", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("可选字段", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("删除示例行", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("pane", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("autoFilter", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("dataValidations", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("公开招标", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("无需投标保证金", parts["xl/worksheets/sheet1.xml"])

    def test_registration_template_covers_the_complete_form(self):
        raw = data_import.build_import_template("registrations", lot_numbers=("包1", "包2"))
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            parts = {name: archive.read(name).decode("utf-8") for name in archive.namelist() if name.endswith((".xml", ".rels"))}
        workbook = data_import._parse_xlsx_workbook(raw)

        self.assertEqual(list(workbook), ["供应商报名"])
        self.assertEqual(
            workbook["供应商报名"][0],
            ["所属包号", "投标主体类型", "公司名称/联合体牵头单位", "联合体成员", "报名方式", "公司地址", "法定代表人", "投标负责人", "手机号", "电子邮箱", "获取日期", "备注"],
        )
        self.assertIn('rgb="FFF4CCCC"', parts["xl/styles.xml"])
        self.assertIn('rgb="FFD9EAF7"', parts["xl/styles.xml"])
        self.assertIn("dataValidations", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("包1,包2", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("单独投标,联合体", parts["xl/worksheets/sheet1.xml"])
        self.assertIn("线上报名,现场报名/线下报名", parts["xl/worksheets/sheet1.xml"])
        self.assertIn('formatCode="yyyy-mm-dd"', parts["xl/styles.xml"])
        self.assertRegex(parts["xl/worksheets/sheet1.xml"], r'<col min="11" max="11"[^>]*style="6"')

    def test_unknown_template_kind_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "模板类型"):
            data_import.build_import_template("unknown")


def workbook_from_rows(name, headers, rows, required=()):
    definition = {
        "name": name,
        "title": "测试导入",
        "headers": headers,
        "required": list(required),
        "example": rows[0],
    }
    raw = data_import._build_workbook_xlsx((definition,))
    if len(rows) == 1:
        return raw
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as original, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for entry in original.infolist():
            content = original.read(entry.filename)
            if entry.filename == "xl/worksheets/sheet1.xml":
                sheet = ET.fromstring(content)
                data = sheet.find(f"{{{MAIN_NS}}}sheetData")
                for index, values in enumerate(rows[1:], 7):
                    one = dict(definition, example=values)
                    with zipfile.ZipFile(io.BytesIO(data_import._build_workbook_xlsx((one,)))) as extra:
                        extra_sheet = ET.fromstring(extra.read(entry.filename))
                        row = extra_sheet.find(f"{{{MAIN_NS}}}sheetData")[-1]
                        row.set("r", str(index))
                        for cell in row:
                            cell.set("r", ''.join(c for c in cell.get("r") if c.isalpha()) + str(index))
                        data.append(row)
                content = ET.tostring(sheet)
            target.writestr(entry, content)
    return output.getvalue()


class FakeQuery:
    def __init__(self, existing=()):
        self.existing = set(existing)
        self.number = None

    def filter_by(self, **values):
        self.number = values.get("number")
        return self

    def first(self):
        if self.number in self.existing:
            return types.SimpleNamespace(id=900, number=self.number)
        return None


class FakeProject:
    query = FakeQuery()

    def __init__(self, **values):
        self.__dict__.update(values)
        self.id = None


class FakeProjectLot:
    def __init__(self, **values):
        self.__dict__.update(values)


class FakeSupplierRegistration:
    def __init__(self, **values):
        self.__dict__.update(values)
        self.id = None


class FakeSession:
    def __init__(self):
        self.projects = []
        self.lots = []
        self.registrations = []
        self.project_for_get = None
        self.commits = 0
        self.rollbacks = 0

    def add(self, value):
        if isinstance(value, FakeProject):
            self.projects.append(value)
        elif isinstance(value, FakeProjectLot):
            self.lots.append(value)
        elif isinstance(value, FakeSupplierRegistration):
            self.registrations.append(value)

    def flush(self):
        for index, project in enumerate(self.projects, 1):
            if project.id is None:
                project.id = index
        for index, registration in enumerate(self.registrations, 1):
            if registration.id is None:
                registration.id = index

    def get(self, model, row_id):
        if model is FakeProject:
            return self.project_for_get
        return None

    def query(self, model):
        records = self.registrations
        return types.SimpleNamespace(filter_by=lambda **filters: types.SimpleNamespace(all=lambda: [r for r in records if all(getattr(r, k, None) == v for k, v in filters.items())]))

    def begin_nested(self):
        return nullcontext()

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


class FakeApp:
    def __init__(self):
        self.routes = {}

    def add_url_rule(self, path, endpoint, handler, methods):
        self.routes[path] = handler


class FakeUpload:
    filename = "import.xlsx"

    def __init__(self, raw):
        self.raw = raw

    def read(self):
        return self.raw


class ProjectImportTests(unittest.TestCase):
    def setUp(self):
        from unittest.mock import patch
        from src.backend_patches import stage_templates
        workflow = patch.object(stage_templates, 'initialize_project_workflow')
        workflow.start()
        self.addCleanup(workflow.stop)
        app_context = patch.dict(sys.modules, {'stage_templates': stage_templates, 'app': types.SimpleNamespace(load_app_settings=lambda: {}, METHODS=stage_templates.PROCUREMENT_METHODS, STAGES=[])})
        app_context.start()
        self.addCleanup(app_context.stop)
        self.original_request = data_import.request
        self.original_session = data_import.session
        self.original_jsonify = data_import.jsonify
        data_import.session = {"user_id": 7}
        data_import.jsonify = lambda value: value
        FakeProject.query = FakeQuery()

    def tearDown(self):
        data_import.request = self.original_request
        data_import.session = self.original_session
        data_import.jsonify = self.original_jsonify

    def build_project_import(self):
        sheets = (
            {
                "name": "项目",
                "title": "测试项目",
                "headers": ["项目编号", "项目名称", "采购人", "文件编制负责人", "文件审核负责人", "采购方式", "预算金额", "年度", "无需投标保证金", "备注"],
                "required": ["项目编号", "项目名称"],
                "example": ["CG-001", "医疗设备", "采购单位", "张三", "李四", "公开招标", "12.5万", "2026", "是", "重点项目"],
            },
            {
                "name": "分包",
                "title": "测试分包",
                "headers": ["项目编号", "包号", "包名", "包预算", "备注"],
                "required": ["项目编号", "包号", "包名"],
                "example": ["CG-001", "包1", "设备包", "125000", "首包"],
            },
        )
        return data_import._build_workbook_xlsx(sheets)

    def test_project_and_lot_fields_are_imported_as_one_group(self):
        app = FakeApp()
        session = FakeSession()
        db = types.SimpleNamespace(session=session)
        data_import._build_import_routes(
            app,
            db,
            {
                "Project": FakeProject,
                "ProjectLot": FakeProjectLot,
                "SupplierRegistration": FakeSupplierRegistration,
                "get_export_dir": lambda: None,
            },
        )
        data_import.request = types.SimpleNamespace(
            files={"file": FakeUpload(self.build_project_import())}, args={}
        )

        response = app.routes["/api/import/projects"]()

        self.assertEqual(response, {"success": 1, "failed": 0, "errors": []})
        self.assertEqual(len(session.projects), 1)
        project = session.projects[0]
        self.assertEqual(project.number, "CG-001")
        self.assertEqual(project.prepare_owner, "张三")
        self.assertEqual(project.review_owner, "李四")
        self.assertEqual(project.budget, 125000.0)
        self.assertEqual(project.year, 2026)
        self.assertIs(project.no_deposit, True)
        self.assertEqual(len(session.lots), 1)
        self.assertEqual(session.lots[0].project_id, project.id)
        self.assertEqual(session.lots[0].lot_number, "包1")

    def test_frozen_app_without_methods_constants_imports_project(self):
        from unittest.mock import patch
        with patch.dict(sys.modules, {'app': types.SimpleNamespace(load_app_settings=lambda: {})}):
            self.test_project_and_lot_fields_are_imported_as_one_group()

    def test_duplicate_database_project_number_is_rejected_with_sheet_row(self):
        FakeProject.query = FakeQuery({"CG-001"})
        app = FakeApp()
        db = types.SimpleNamespace(session=FakeSession())
        data_import._build_import_routes(
            app,
            db,
            {"Project": FakeProject, "ProjectLot": FakeProjectLot, "SupplierRegistration": FakeSupplierRegistration, "get_export_dir": lambda: None},
        )
        data_import.request = types.SimpleNamespace(files={"file": FakeUpload(self.build_project_import())}, args={})

        response = app.routes["/api/import/projects"]()

        self.assertEqual(response["success"], 0)
        self.assertEqual(response["failed"], 1)
        self.assertEqual(response["errors"][0]["sheet"], "项目")
        self.assertEqual(response["errors"][0]["row"], 6)
        self.assertIn("已存在", response["errors"][0]["msg"])

    def test_invalid_project_values_are_not_silently_defaulted(self):
        cases = (
            ("采购方式", "未知方式", "采购方式"),
            ("年度", "26", "年度"),
            ("预算金额", "很多钱", "预算"),
            ("无需投标保证金", "也许", "是/否"),
        )
        for header, value, expected in cases:
            with self.subTest(header=header):
                headers = ["项目编号", "项目名称", header]
                raw = workbook_from_rows("项目", headers, [["CG-ERR", "错误项目", value]], ["项目编号", "项目名称"])
                app = FakeApp()
                db = types.SimpleNamespace(session=FakeSession())
                data_import._build_import_routes(app, db, {"Project": FakeProject, "ProjectLot": FakeProjectLot, "SupplierRegistration": FakeSupplierRegistration, "get_export_dir": lambda: None})
                data_import.request = types.SimpleNamespace(files={"file": FakeUpload(raw)}, args={})

                response = app.routes["/api/import/projects"]()

                self.assertEqual(response["success"], 0)
                self.assertIn(expected, response["errors"][0]["msg"])
                self.assertEqual(response["errors"][0]["column"], header)


class RegistrationImportTests(unittest.TestCase):
    def setUp(self):
        self.original_request = data_import.request
        self.original_session = data_import.session
        self.original_jsonify = data_import.jsonify
        self.previous_consortium = sys.modules.get("consortium_registration")
        sys.modules["consortium_registration"] = consortium_registration
        data_import.session = {"user_id": 7}
        data_import.jsonify = lambda value: value
        self.member_replacements = []
        self.original_replace_members = consortium_registration.replace_members
        self.original_ensure_schema = consortium_registration.ensure_schema
        consortium_registration.ensure_schema = lambda db: None
        consortium_registration.replace_members = (
            lambda db, registration_id, bidder_type, members: self.member_replacements.append(
                (registration_id, bidder_type, members)
            )
        )

    def tearDown(self):
        data_import.request = self.original_request
        data_import.session = self.original_session
        data_import.jsonify = self.original_jsonify
        consortium_registration.replace_members = self.original_replace_members
        consortium_registration.ensure_schema = self.original_ensure_schema
        if self.previous_consortium is None:
            sys.modules.pop("consortium_registration", None)
        else:
            sys.modules["consortium_registration"] = self.previous_consortium

    def run_import(self, values, lots=("包1",), existing=(), extra_rows=(), is_terminated=False):
        headers = ["所属包号", "投标主体类型", "公司名称/联合体牵头单位", "联合体成员", "报名方式", "公司地址", "法定代表人", "投标负责人", "手机号", "电子邮箱", "获取日期", "备注"]
        raw = workbook_from_rows("供应商报名", headers, [values, *extra_rows], ["公司名称/联合体牵头单位"])
        app = FakeApp()
        session = FakeSession()
        session.registrations = list(existing)
        session.project_for_get = types.SimpleNamespace(
            id=12,
            is_terminated=is_terminated,
            lots=[types.SimpleNamespace(id=index, lot_number=number) for index, number in enumerate(lots, 1)],
        )
        db = types.SimpleNamespace(session=session)
        data_import._build_import_routes(
            app,
            db,
            {"Project": FakeProject, "ProjectLot": FakeProjectLot, "SupplierRegistration": FakeSupplierRegistration, "get_export_dir": lambda: None},
        )
        data_import.request = types.SimpleNamespace(files={"file": FakeUpload(raw)}, args={})
        return app.routes["/api/projects/<int:pid>/registrations/import"](12), session

    def test_closed_project_rejects_import_without_creating_or_updating_registrations(self):
        existing = FakeSupplierRegistration(project_id=12, lot_id=1, company_name="供应商", manager_phone="")
        existing.id = 4
        response, session = self.run_import(
            ["包1", "", "供应商", "", "", "", "", "", "13800000000", "", "", ""],
            existing=[existing], is_terminated=True,
            extra_rows=[["包1", "", "新增供应商", "", "", "", "", "", "", "", "", ""]],
        )
        self.assertEqual(response, ({"error": "项目已关闭"}, 400))
        self.assertEqual(session.registrations, [existing])
        self.assertEqual(existing.manager_phone, "")
        self.assertEqual(self.member_replacements, [])

    def test_multi_lot_import_rejects_missing_lot_without_blocking_valid_rows(self):
        row = FakeSupplierRegistration(project_id=12, lot_id=1, company_name="Supplier A")
        row.id = 4
        response, session = self.run_import(
            ["", "", "Supplier A", "", "", "", "", "", "", "", "", ""],
            lots=("包1", "包2"), existing=[row],
            extra_rows=[["包2", "", "Supplier A", "", "", "", "", "", "", "", "", ""]],
        )
        self.assertEqual(response["failed"], 1)
        self.assertEqual(response["success"], 1)
        self.assertIn("所属包号", str(response["errors"]))
        self.assertEqual([item.lot_id for item in session.registrations], [1, 2])

    def test_import_fills_only_blanks_and_skips_repeated_rows(self):
        row = FakeSupplierRegistration(project_id=12, lot_id=1, company_name="供应商Ａ", company_address="原地址", manager_phone="", manager_email="existing@example.com")
        row.id = 4
        incoming = ["包1", "", " 供应商A ", "", "", "新地址", "", "", "13800000000", "invalid ignored email", "", ""]
        response, session = self.run_import(incoming, existing=[row], extra_rows=[incoming])
        self.assertEqual(response, {"success":0, "updated":1, "ignored":1, "failed":0, "errors":[]})
        self.assertEqual(len(session.registrations),1)
        self.assertEqual(row.company_address,"原地址")
        self.assertEqual(row.manager_email,"existing@example.com")
        self.assertEqual(row.manager_phone,"13800000000")

    def test_duplicates_within_new_import_create_one_registration(self):
        incoming = ["包1", "", "供应商", "", "", "", "", "", "", "", "", ""]
        response, session = self.run_import(incoming, extra_rows=[incoming])
        self.assertEqual(response["success"],1)
        self.assertEqual(response["ignored"],1)
        self.assertEqual(len(session.registrations),1)

    def test_consortium_registration_imports_every_form_field(self):
        response, session = self.run_import(
            ["包1", "联合体", "牵头单位", "成员甲；成员乙", "现场报名/线下报名", "公司地址", "王法人", "张负责人", "13800000000", "owner@example.com", "2026-08-09", "备注内容"]
        )

        self.assertEqual(response, {"success": 1, "updated": 0, "ignored": 0, "failed": 0, "errors": []})
        registration = session.registrations[0]
        self.assertEqual(registration.project_id, 12)
        self.assertEqual(registration.lot_id, 1)
        self.assertEqual(registration.company_name, "牵头单位")
        self.assertEqual(registration.company_address, "公司地址")
        self.assertEqual(registration.legal_representative, "王法人")
        self.assertEqual(registration.bid_manager, "张负责人")
        self.assertEqual(registration.manager_phone, "13800000000")
        self.assertEqual(registration.manager_email, "owner@example.com")
        self.assertEqual(registration.acquisition_date.isoformat(), "2026-08-09")
        self.assertEqual(registration.registration_method, "现场报名/线下报名")
        self.assertEqual(
            self.member_replacements,
            [(1, "consortium", [{"company_name": "成员甲"}, {"company_name": "成员乙"}])],
        )

    def test_standalone_defaults_clear_members_and_use_online_method(self):
        response, session = self.run_import(
            ["", "", "单独供应商", "", "", "", "", "", "", "", "", ""]
        )

        self.assertEqual(response["success"], 1)
        self.assertEqual(session.registrations[0].registration_method, "线上报名")
        self.assertEqual(self.member_replacements, [(1, "standalone", [])])

    def test_invalid_registration_values_fail_the_row(self):
        cases = (
            (["不存在", "单独投标", "供应商", "", "线上报名", "", "", "", "", "", "", ""], "所属包号"),
            (["包1", "未知类型", "供应商", "", "线上报名", "", "", "", "", "", "", ""], "投标主体类型"),
            (["包1", "联合体", "牵头单位", "牵头单位", "线上报名", "", "", "", "", "", "", ""], "牵头单位"),
            (["包1", "单独投标", "供应商", "", "邮寄", "", "", "", "", "", "", ""], "报名方式"),
            (["包1", "单独投标", "供应商", "", "线上报名", "", "", "", "", "bad-email", "", ""], "电子邮箱"),
            (["包1", "单独投标", "供应商", "", "线上报名", "", "", "", "", "", "2026-99-99", ""], "获取日期"),
        )
        for values, expected in cases:
            with self.subTest(expected=expected):
                response, session = self.run_import(values)
                self.assertEqual(response["success"], 0)
                self.assertEqual(session.registrations, [])
                self.assertIn(expected, response["errors"][0]["msg"])
                self.member_replacements.clear()


if __name__ == "__main__":
    unittest.main()
