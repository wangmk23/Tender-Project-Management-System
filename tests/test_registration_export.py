import importlib.util
import io
import re
import sys
import tempfile
import types
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from unittest.mock import patch

from src.backend_patches import consortium_registration
from src.backend_patches import signed_attachments
from tests.test_export_replacement import (
    FakeResponse,
    OOXML_NS,
    assert_cells_bordered_and_wrapped,
    row_values,
)


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "src" / "backend_patches" / "app_replacements.py"


def load_replacements():
    spec = importlib.util.spec_from_file_location("registration_export_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class RegistrationExportTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.previous_signed = sys.modules.get("signed_attachments")
        self.previous_consortium = sys.modules.get("consortium_registration")
        sys.modules["signed_attachments"] = signed_attachments
        sys.modules["consortium_registration"] = consortium_registration
        self.previous_protect = signed_attachments._PROTECT_SECRET
        self.previous_unprotect = signed_attachments._UNPROTECT_SECRET
        signed_attachments._PROTECT_SECRET = lambda raw: b"protected:" + raw
        signed_attachments._UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")

        self.project = types.SimpleNamespace(
            id=12,
            number="CG-2026-012",
            name="医疗设备项目",
            year="2026",
        )
        record = {
            "id": 31,
            "project_id": 12,
            "lot_number": "包1",
            "bidder_type": "consortium",
            "company_name": "牵头单位",
            "consortium_members": [{"company_name": "成员甲"}, {"company_name": "成员乙"}],
            "registration_method": "线上报名",
            "company_address": "地址",
            "legal_representative": "王法人",
            "bid_manager": "张负责人",
            "manager_phone": "13800000000",
            "manager_email": "owner@example.com",
            "acquisition_date": "2026-08-09",
            "notes": "备注",
            "attachments": [
                {"id": 71, "filename": "报名表.pdf"},
                {"id": 72, "filename": "授权书.docx"},
            ],
        }
        self.registration = types.SimpleNamespace(project=self.project, to_dict=lambda: dict(record))
        self.project.registrations = [self.registration]

        self.module = load_replacements()
        self.module.request = types.SimpleNamespace(
            args={"export": "1", "scope": "current"},
            host_url="http://192.168.5.7:5001/",
            host="192.168.5.7:5001",
        )
        self.module.Project = type("Project", (), {})
        self.module.SupplierRegistration = type("SupplierRegistration", (), {})
        self.module.db = types.SimpleNamespace(get_or_404=lambda model, pid: self.project)
        self.module.app = types.SimpleNamespace(response_class=FakeResponse, logger=types.SimpleNamespace(exception=lambda *a: None))
        self.module.jsonify = lambda value: value
        self.module.DATA_DIR = self.root
        self.module.get_export_dir = lambda: self.root / "exports"
        self.module.log_operation = lambda *args: None

    def tearDown(self):
        signed_attachments._PROTECT_SECRET = self.previous_protect
        signed_attachments._UNPROTECT_SECRET = self.previous_unprotect
        if self.previous_signed is None:
            sys.modules.pop("signed_attachments", None)
        else:
            sys.modules["signed_attachments"] = self.previous_signed
        if self.previous_consortium is None:
            sys.modules.pop("consortium_registration", None)
        else:
            sys.modules["consortium_registration"] = self.previous_consortium
        self.temporary.cleanup()

    def test_export_contains_complete_registration_and_one_signed_row_per_attachment(self):
        response = self.module.api_get_registrations(12)

        with zipfile.ZipFile(io.BytesIO(response.get_data())) as workbook:
            workbook_xml = workbook.read("xl/workbook.xml").decode("utf-8")
            main_xml = workbook.read("xl/worksheets/sheet1.xml")
            attachment_xml = workbook.read("xl/worksheets/sheet2.xml").decode("utf-8")
        self.assertIn('name="供应商报名"', workbook_xml)
        self.assertIn('name="附件清单"', workbook_xml)
        main = ElementTree.fromstring(main_xml)
        headers = row_values(main, 4)
        self.assertEqual(
            [headers.get(chr(65 + index)) for index in range(18)],
            ["序号", "项目编号", "项目名称", "年度", "所属包号", "投标主体类型", "公司名称/联合体牵头单位", "联合体成员", "报名方式", "公司地址", "法定代表人", "投标负责人", "手机号", "电子邮箱", "获取日期", "备注", "附件数量", "首个附件链接"],
        )
        values = row_values(main, 5)
        self.assertEqual(values["B"], "CG-2026-012")
        self.assertEqual(values["F"], "联合体")
        self.assertEqual(values["H"], "成员甲；成员乙")
        self.assertEqual(values["Q"], 2)
        self.assertIn("/api/public/attachments/71/download?expires=", main_xml.decode("utf-8"))
        self.assertIn("/api/public/attachments/71/download?expires=", attachment_xml)
        self.assertIn("/api/public/attachments/72/download?expires=", attachment_xml)
        self.assertEqual(len(re.findall(r"/api/public/attachments/7[12]/download", attachment_xml)), 2)
        self.assertIn("链接到期时间", attachment_xml)
        self.assertNotIn("/api/attachments/", attachment_xml)

    def test_desktop_localhost_export_rewrites_links_to_the_lan_address(self):
        class Probe:
            def connect(self, target):
                return None

            def getsockname(self):
                return ("192.168.8.23", 53124)

            def close(self):
                return None

        self.module.request.host_url = "http://127.0.0.1:5001/"
        self.module.request.host = "127.0.0.1:5001"

        with patch("socket.socket", return_value=Probe()):
            response = self.module.api_get_registrations(12)

        with zipfile.ZipFile(io.BytesIO(response.get_data())) as workbook:
            attachment_xml = workbook.read("xl/worksheets/sheet2.xml").decode("utf-8")
        self.assertIn("http://192.168.8.23:5001/api/public/attachments/71/download", attachment_xml)
        self.assertNotIn("127.0.0.1", attachment_xml)

    def test_export_table_headers_and_data_have_borders_and_wrapping(self):
        response = self.module.api_get_registrations(12)

        with zipfile.ZipFile(io.BytesIO(response.get_data())) as workbook:
            assert_cells_bordered_and_wrapped(
                self,
                workbook,
                "xl/worksheets/sheet1.xml",
                ("A4", "P5", "R5"),
                title_ref="A1",
            )
            assert_cells_bordered_and_wrapped(
                self,
                workbook,
                "xl/worksheets/sheet2.xml",
                ("A1", "A2", "F2"),
            )

    def test_browser_export_content_disposition_is_latin1_safe(self):
        response = self.module.api_get_registrations(12)

        disposition = response.headers["Content-Disposition"]
        disposition.encode("latin-1")
        self.assertRegex(
            disposition,
            r'filename="supplier_registrations_\d{8}\.xlsx"',
        )
        self.assertIn("filename*=UTF-8''", disposition)


if __name__ == "__main__":
    unittest.main()
