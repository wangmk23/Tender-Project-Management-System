"""Real workbook/API exchange must preserve each member's own contact details."""

import io
import sys
import types
import unittest
import zipfile
from unittest.mock import patch
from xml.etree import ElementTree as ET

from flask import Flask
from sqlalchemy import Column, Date, ForeignKey, Integer, String, create_engine, select, text
from sqlalchemy.orm import Session, declarative_base, relationship

from src.backend_patches import consortium_registration as consortium
from src.backend_patches import data_import
from tests.test_registration_export import load_replacements
from tests.test_export_replacement import FakeResponse


Base = declarative_base()
FIELDS = ("company_address", "legal_representative", "bid_manager", "manager_phone", "manager_email", "notes")
MAIN_HEADERS = ["项目编号", "所属包号", "投标主体类型", "公司名称/联合体牵头单位", "联合体成员", "手机号"]
DETAIL_HEADERS = ["项目编号", "所属包号", "联合体牵头单位", "成员单位名称", "公司地址", "法定代表人", "联系人", "联系电话", "电子邮箱", "备注"]
NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


class Project(Base):
    __tablename__ = "projects"
    id = Column(Integer, primary_key=True)
    number = Column(String)
    name = Column(String)
    year = Column(String)
    is_terminated = Column(Integer, default=0)
    lots = relationship("Lot")
    registrations = relationship("Registration")


class Lot(Base):
    __tablename__ = "project_lots"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    lot_number = Column(String)


class Registration(Base):
    __tablename__ = "supplier_registrations"
    id = Column(Integer, primary_key=True)
    project_id = Column(Integer, ForeignKey("projects.id"))
    lot_id = Column(Integer, ForeignKey("project_lots.id"))
    company_name = Column(String)
    company_address = Column(String)
    legal_representative = Column(String)
    bid_manager = Column(String)
    manager_phone = Column(String)
    manager_email = Column(String)
    acquisition_date = Column(Date)
    registration_method = Column(String)
    notes = Column(String)


def workbook(main_rows, detail_rows=None, detail_headers=DETAIL_HEADERS):
    definitions = [dict(name="供应商报名", title="测试", headers=MAIN_HEADERS, required=[], example=main_rows[0])]
    row_groups = [main_rows]
    if detail_rows is not None:
        definitions.append(dict(name="联合体成员资料", title="成员资料", headers=detail_headers, required=[], example=detail_rows[0] if detail_rows else [""] * len(detail_headers)))
        row_groups.append(detail_rows)
    raw = data_import._build_workbook_xlsx(definitions)
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(raw)) as source, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as target:
        for item in source.infolist():
            content = source.read(item.filename)
            for index, rows in enumerate(row_groups, 1):
                if item.filename != f"xl/worksheets/sheet{index}.xml":
                    continue
                sheet = ET.fromstring(content)
                sheet_data = sheet.find(NS + "sheetData")
                for row_number, values in enumerate(rows[1:], 7):
                    row = ET.SubElement(sheet_data, NS + "row", r=str(row_number))
                    for column, value in enumerate(values, 1):
                        letters = ""
                        while column:
                            column, remainder = divmod(column - 1, 26)
                            letters = chr(65 + remainder) + letters
                        cell = ET.SubElement(row, NS + "c", r=f"{letters}{row_number}", t="inlineStr")
                        ET.SubElement(ET.SubElement(cell, NS + "is"), NS + "t").text = str(value)
                content = ET.tostring(sheet)
            target.writestr(item, content)
    return output.getvalue()


class ConsortiumExchangeTests(unittest.TestCase):
    def setUp(self):
        self.engine = create_engine("sqlite://")
        Base.metadata.create_all(self.engine)
        self.session = Session(self.engine)
        self.db = types.SimpleNamespace(session=self.session)
        self.project = Project(id=1, number="P-001", name="项目", year="2026", lots=[Lot(id=11, lot_number="包1"), Lot(id=12, lot_number="包2")])
        self.session.add(self.project)
        self.session.commit()
        consortium.ensure_schema(self.db)
        self.app = Flask(__name__)
        self.app.secret_key = "isolated-exchange-test"
        data_import._build_import_routes(self.app, self.db, dict(Project=Project, ProjectLot=Lot, SupplierRegistration=Registration))
        self.client = self.app.test_client()
        with self.client.session_transaction() as login:
            login["user_id"] = 7
        self.alias = patch.dict(sys.modules, consortium_registration=consortium)
        self.alias.start()

    def tearDown(self):
        self.alias.stop()
        self.session.close()
        self.engine.dispose()

    def import_raw(self, raw):
        result = self.client.post("/api/projects/1/registrations/import", data={"file": (io.BytesIO(raw), "报名.xlsx")})
        self.assertEqual(result.status_code, 200, result.get_json())
        return result.get_json()

    def records(self):
        return self.session.scalars(select(Registration).order_by(Registration.lot_id)).all()

    def members(self, record):
        return consortium.enrich_registration(self.db, {"id": record.id})["consortium_members"]

    def seed(self, lot_id=11, name="牵头单位", members=None):
        registration = Registration(project_id=1, lot_id=lot_id, company_name=name, manager_phone="")
        self.session.add(registration)
        self.session.flush()
        consortium.replace_members(self.db, registration.id, "consortium", members or [{"company_name": "成员甲"}, {"company_name": "成员乙"}])
        self.session.commit()
        return registration

    def export(self, records):
        module = load_replacements()
        project = types.SimpleNamespace(number="P-001", name="项目", year="2026", registrations=[types.SimpleNamespace(to_dict=lambda record=record: record) for record in records])
        module.db = types.SimpleNamespace(get_or_404=lambda model, pid: project)
        module.Project = Project
        module.request = types.SimpleNamespace(args={"export": "1"}, host_url="http://192.168.8.3:5001/", host="192.168.8.3:5001")
        module.app = types.SimpleNamespace(response_class=FakeResponse, logger=types.SimpleNamespace(exception=lambda *args: None))
        with patch.dict(sys.modules, signed_attachments=__import__("src.backend_patches.signed_attachments", fromlist=["*"])):
            return module.api_get_registrations(1).get_data()

    def test_template_preserves_main_format_and_offers_optional_member_details_sheet(self):
        parsed = data_import._parse_xlsx_workbook(data_import.build_import_template("registrations"))
        self.assertIn("联合体成员资料", parsed)
        self.assertEqual(parsed["供应商报名"][0][2:4], ["公司名称/联合体牵头单位", "联合体成员"])
        self.assertEqual(parsed["联合体成员资料"][0], DETAIL_HEADERS)

    def test_new_import_associates_contacts_by_lot_and_member_name_not_sheet_order(self):
        result = self.import_raw(workbook(
            [["P-001", "包1", "联合体", "牵头单位", "成员甲；成员乙", ""], ["P-001", "包2", "联合体", "牵头单位", "成员甲", ""]],
            [["P-001", "包2", "牵头单位", "成员甲", "包2地址", "李法人", "乙联系人", "020-111", "b@example.test", "包2备注"], ["P-001", "包1", "牵头单位", "成员乙", "包1地址", "王法人", "甲联系人", "010-222", "a@example.test", "包1备注"]]))
        self.assertEqual(result["success"], 2)
        records = self.records()
        self.assertEqual(len(records), 2)
        self.assertEqual(self.members(records[0]), [{"company_name": "成员甲"}, dict(zip(("company_name", *FIELDS), ("成员乙", "包1地址", "王法人", "甲联系人", "010-222", "a@example.test", "包1备注")))])
        self.assertEqual(self.members(records[1])[0]["manager_phone"], "020-111")

    def test_existing_import_only_fills_blanks_and_keeps_member_order_and_old_names_only_data(self):
        record = self.seed(members=[dict(company_name="成员乙", manager_phone="手工电话", manager_email="manual@example.test"), dict(company_name="成员甲")])
        result = self.import_raw(workbook([["P-001", "包1", "联合体", "牵头单位", "成员甲；成员乙", "主联系电话"]], [["P-001", "包1", "牵头单位", "成员乙", "补充地址", "", "", "新电话", "invalid-but-kept-old", ""], ["P-001", "包1", "牵头单位", "成员甲", "", "", "新联系人", "", "", ""]]))
        self.assertEqual((result["updated"], result["failed"]), (1, 0))
        self.assertEqual([m["company_name"] for m in self.members(record)], ["成员乙", "成员甲"])
        self.assertEqual(self.members(record)[0]["manager_phone"], "手工电话")
        self.assertEqual(self.members(record)[0]["manager_email"], "manual@example.test")
        self.assertEqual(self.members(record)[1]["bid_manager"], "新联系人")
        legacy = self.import_raw(workbook([["P-001", "包1", "联合体", "牵头单位", "成员甲；成员乙", ""]]))
        self.assertEqual(legacy["ignored"], 1)
        self.assertEqual(self.members(record)[0]["company_address"], "补充地址")

    def test_invalid_member_email_rolls_back_parent_and_all_member_changes(self):
        record = self.seed()
        result = self.import_raw(workbook([["P-001", "包1", "联合体", "牵头单位", "成员甲；成员乙", "不应保存"]], [["P-001", "包1", "牵头单位", "成员甲", "", "", "", "123", "", ""], ["P-001", "包1", "牵头单位", "成员乙", "", "", "", "", "bad-email", ""]]))
        self.assertEqual((result["updated"], result["failed"]), (0, 1))
        self.assertEqual(record.manager_phone, "")
        self.assertNotIn("manager_phone", self.members(record)[0])
        self.assertEqual(result["errors"][0]["sheet"], "联合体成员资料")
        self.assertEqual(result["errors"][0]["row"], 7)

    def test_export_read_back_and_reimport_keep_full_member_details_and_single_parent(self):
        member = dict(zip(("company_name", *FIELDS), ("成员甲", "成员地址", "法人", "联系人", "010-123", "a@example.test", "备注")))
        raw = self.export([dict(id=1, lot_number="包1", company_name="牵头单位", bidder_type="consortium", consortium_members=[member], attachments=[])])
        parsed = data_import._parse_xlsx_workbook(raw)
        self.assertIn("联合体成员资料", parsed)
        self.assertEqual(parsed["联合体成员资料"][1][0]["联系电话"], "010-123")
        self.assertEqual(parsed["供应商报名"][1][0]["联合体成员"], "成员甲")
        result = self.import_raw(raw)
        self.assertEqual(result["success"], 1)
        self.assertEqual(self.members(self.records()[0]), [member])

    def test_distinct_member_names_with_spaces_or_width_are_not_merged(self):
        record = self.seed(members=[dict(company_name="成员A"), dict(company_name="成员Ａ"), dict(company_name="成 员A")])
        result = self.import_raw(workbook([["P-001", "包1", "联合体", "牵头单位", "成员A；成员Ａ；成 员A", ""]], [["P-001", "包1", "牵头单位", "成员A", "", "", "", "111", "", ""], ["P-001", "包1", "牵头单位", "成员Ａ", "", "", "", "222", "", ""], ["P-001", "包1", "牵头单位", "成 员A", "", "", "", "333", "", ""]]))
        self.assertEqual((result["updated"], result["failed"]), (1, 0))
        self.assertEqual([member["manager_phone"] for member in self.members(record)], ["111", "222", "333"])

    def test_unknown_or_duplicate_member_detail_rejects_whole_new_parent(self):
        for names in (["陌生成员"], ["成员甲", "成员甲"]):
            with self.subTest(names=names):
                result = self.import_raw(workbook([["P-001", "包1", "联合体", "牵头单位", "成员甲", ""]], [["P-001", "包1", "牵头单位", name, "", "", "", "123", "", ""] for name in names]))
                self.assertEqual((result["success"], result["failed"]), (0, 1))
                self.assertEqual(self.records(), [])
                self.assertEqual(result["errors"][0]["sheet"], "联合体成员资料")

    def test_member_insert_failure_rolls_back_group_and_allows_other_parent(self):
        self.session.execute(text("CREATE TRIGGER reject_member BEFORE INSERT ON registration_consortium_members WHEN NEW.company_name='失败成员' BEGIN SELECT RAISE(ABORT, 'forced member write failure'); END"))
        self.session.commit()
        result = self.import_raw(workbook([["P-001", "包1", "联合体", "失败牵头", "失败成员", ""], ["P-001", "包2", "联合体", "成功牵头", "正常成员", ""]], [["P-001", "包1", "失败牵头", "失败成员", "", "", "", "123", "", ""]]))
        self.assertEqual((result["success"], result["failed"]), (1, 1))
        self.assertEqual([record.company_name for record in self.records()], ["成功牵头"])
        self.assertEqual(self.session.execute(text("SELECT company_name FROM registration_consortium_members")).all(), [("正常成员",)])

    def test_orphan_details_are_reported_without_inventing_parent_or_members(self):
        result = self.import_raw(workbook([["P-001", "包1", "单独投标", "单独公司", "", ""]], [["P-001", "包2", "不存在牵头", "陌生成员", "", "", "", "123", "", ""]]))
        self.assertEqual((result["success"], result["failed"]), (1, 1))
        self.assertIn("找不到", result["errors"][0]["msg"])
        self.assertEqual(len(self.records()), 1)

    def test_other_project_numbers_cannot_merge_into_current_project(self):
        record = self.seed()
        result = self.import_raw(workbook([["P-OTHER", "包1", "联合体", "牵头单位", "成员甲；成员乙", "错误电话"]]))
        self.assertEqual((result["updated"], result["failed"]), (0, 1))
        self.assertEqual(record.manager_phone, "")
        self.assertEqual(result["errors"][0]["column"], "项目编号")


if __name__ == "__main__":
    unittest.main()
