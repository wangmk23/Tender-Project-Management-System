import builtins
import importlib.util
import io
import re
import sys
import tempfile
import types
import unittest
import zipfile
from datetime import date as real_date
from datetime import datetime as real_datetime
from pathlib import Path
from urllib.parse import quote
from unittest.mock import Mock, patch
from xml.etree import ElementTree

from src.backend_patches import signed_attachments as signed_attachments_module


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "src" / "backend_patches" / "app_replacements.py"
OOXML_NS = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
DOWNLOAD_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
REQUIRED_MEMBERS = {
    "[Content_Types].xml",
    "_rels/.rels",
    "docProps/app.xml",
    "docProps/core.xml",
    "xl/workbook.xml",
    "xl/_rels/workbook.xml.rels",
    "xl/styles.xml",
    "xl/worksheets/sheet1.xml",
}
EXPECTED_HEADERS = [
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
EXPECTED_ROW = [
    1,
    "PRJ-2026-001",
    "XML & 中文项目",
    "采购人<甲>",
    "2026",
    "公开招标",
    100000,
    "1",
    "A 包",
    60000.0,
    "2026-07-01",
    "2026-07-10",
    "中标公告",
    "进行中",
    80,
    "供应商 A",
    "58000.0",
    "备注 & <safe>",
    "",
]
EXPECTED_ADDITIONAL_ROW = [
    2,
    "PRJ-2026-001",
    "XML & 中文项目",
    "采购人<甲>",
    "2026",
    "公开招标",
    100000,
    "2",
    "B 包",
    40000.0,
    "2026-07-01",
    "2026-07-10",
    "中标公告",
    "进行中",
    80,
    "供应商 B、供应商 C",
    "39000.0、92%",
    "备注 & <safe>",
    "",
]
EXPECTED_ROWS = [EXPECTED_ROW, EXPECTED_ADDITIONAL_ROW]
EXPECTED_WIDTHS = [6, 20, 38, 26, 8, 13, 14, 10, 24, 14, 14, 14, 12, 10, 8, 26, 18, 34, 46]
FIXED_NOW = real_datetime(2026, 7, 16, 9, 30, 45)
FIXED_TODAY = real_date(2026, 7, 16)
ORIGINAL_IMPORT = builtins.__import__


def reject_openpyxl(name, globals=None, locals=None, fromlist=(), level=0):
    if name.startswith("openpyxl"):
        raise AssertionError(f"unexpected import: {name}")
    return ORIGINAL_IMPORT(name, globals, locals, fromlist, level)


def assert_cells_bordered_and_wrapped(test_case, workbook, sheet_name, refs, title_ref=None):
    styles = ElementTree.fromstring(workbook.read("xl/styles.xml"))
    sheet = ElementTree.fromstring(workbook.read(sheet_name))
    xfs = styles.find("x:cellXfs", OOXML_NS)
    borders = styles.find("x:borders", OOXML_NS)
    test_case.assertIsNotNone(xfs)
    test_case.assertIsNotNone(borders)
    test_case.assertGreaterEqual(len(borders), 2)
    border = borders[1]
    for edge in ("left", "right", "top", "bottom"):
        test_case.assertEqual(border.find(f"x:{edge}", OOXML_NS).attrib.get("style"), "thin")
    for ref in refs:
        cell = sheet.find(f".//x:c[@r='{ref}']", OOXML_NS)
        test_case.assertIsNotNone(cell, ref)
        test_case.assertIn("s", cell.attrib, ref)
        xf = xfs[int(cell.attrib["s"])]
        test_case.assertEqual(xf.attrib.get("borderId"), "1", ref)
        test_case.assertEqual(xf.attrib.get("applyBorder"), "1", ref)
        alignment = xf.find("x:alignment", OOXML_NS)
        test_case.assertIsNotNone(alignment, ref)
        test_case.assertEqual(alignment.attrib.get("wrapText"), "1", ref)
    if title_ref:
        title = sheet.find(f".//x:c[@r='{title_ref}']", OOXML_NS)
        test_case.assertIsNotNone(title)
        title_xf = xfs[int(title.attrib["s"])]
        test_case.assertEqual(title_xf.attrib.get("borderId"), "0")


def load_replacements():
    if not MODULE_PATH.is_file():
        raise AssertionError(f"missing replacement module: {MODULE_PATH}")
    spec = importlib.util.spec_from_file_location("app_replacements_under_test", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class FrozenDateTime(real_datetime):
    @classmethod
    def now(cls, tz=None):
        if tz is not None:
            return tz.fromutc(FIXED_NOW.replace(tzinfo=tz))
        return cls(
            FIXED_NOW.year,
            FIXED_NOW.month,
            FIXED_NOW.day,
            FIXED_NOW.hour,
            FIXED_NOW.minute,
            FIXED_NOW.second,
        )


class FrozenDate(real_date):
    @classmethod
    def today(cls):
        return cls(FIXED_TODAY.year, FIXED_TODAY.month, FIXED_TODAY.day)


class FakeColumn:
    def __init__(self, name):
        self.name = name

    def __eq__(self, other):
        return ("eq", self.name, other)

    def desc(self):
        return ("desc", self.name)


class FakeResponse:
    def __init__(self, response=b"", mimetype=None, headers=None, status=200):
        if isinstance(response, str):
            response = response.encode("utf-8")
        self._data = bytes(response)
        self.mimetype = mimetype
        self.headers = dict(headers or {})
        self.status_code = status

    def get_data(self):
        return self._data


class FakeQuery:
    def __init__(self, projects):
        self._projects = list(projects)
        self.filtered_year = None
        self.options_calls = []
        self.filter_calls = []
        self.order_by_calls = []

    def options(self, *args):
        self.options_calls.append(args)
        return self

    def filter(self, expression):
        self.filter_calls.append(expression)
        if isinstance(expression, tuple) and expression[:2] == ("eq", "year"):
            self.filtered_year = expression[2]
        return self

    def order_by(self, *args):
        self.order_by_calls.append(args)
        return self

    def all(self):
        projects = list(self._projects)
        if self.filtered_year:
            projects = [project for project in projects if str(project.year) == str(self.filtered_year)]
        return projects


class FakeProjectModel:
    query = None
    stages = object()
    lots = object()
    bid_results = object()
    year = FakeColumn("year")
    number = FakeColumn("number")


def joinedload(attribute):
    return ("joinedload", attribute)


def cell_value(cell):
    inline = cell.find("x:is", OOXML_NS)
    if inline is not None:
        texts = [node.text or "" for node in inline.findall(".//x:t", OOXML_NS)]
        return "".join(texts)
    raw = cell.findtext("x:v", default="", namespaces=OOXML_NS)
    if raw == "":
        return ""
    if re.fullmatch(r"-?\d+", raw):
        return int(raw)
    try:
        return float(raw)
    except ValueError:
        return raw


def row_values(sheet, row_number):
    row = sheet.find(f"./x:sheetData/x:row[@r='{row_number}']", OOXML_NS)
    if row is None:
        return {}
    values = {}
    for cell in row.findall("x:c", OOXML_NS):
        ref = cell.attrib["r"]
        column = re.sub(r"\d+", "", ref)
        values[column] = cell_value(cell)
    return values


def response_bytes(response):
    if hasattr(response, "get_data"):
        return response.get_data()
    if hasattr(response, "data"):
        return response.data
    raise AssertionError(f"response does not expose bytes: {type(response)!r}")


class ExportReplacementTests(unittest.TestCase):
    maxDiff = None

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.temp_path = Path(self.temp_dir.name)
        self.export_dir = self.temp_path / "exports"
        self.export_dir.mkdir(parents=True, exist_ok=True)

        first_lot = types.SimpleNamespace(
            id=201,
            lot_number="1",
            lot_name="A 包",
            budget=60000.0,
            notes="",
        )
        second_lot = types.SimpleNamespace(
            id=202,
            lot_number="2",
            lot_name="B 包",
            budget=40000.0,
            notes="",
        )
        first_bid_result = types.SimpleNamespace(
            id=301,
            lot_id=first_lot.id,
            lot_number=first_lot.lot_number,
            winning_supplier="供应商 A",
            winning_amount="58000.0",
            discount_rate="",
            notes="",
        )
        second_bid_result = types.SimpleNamespace(
            id=302,
            lot_id=second_lot.id,
            lot_number=second_lot.lot_number,
            winning_supplier="供应商 B",
            winning_amount="39000.0",
            discount_rate="",
            notes="",
        )
        third_bid_result = types.SimpleNamespace(
            id=303,
            lot_id=second_lot.id,
            lot_number=second_lot.lot_number,
            winning_supplier="供应商 C",
            winning_amount="",
            discount_rate="92%",
            notes="",
        )
        unmatched_bid_result = types.SimpleNamespace(
            id=304,
            lot_id=999,
            lot_number="99",
            winning_supplier="不应导出的供应商",
            winning_amount="1.0",
            discount_rate="",
            notes="",
        )
        announcement = types.SimpleNamespace(
            stage_key="announcement",
            completed_date=real_date(2026, 7, 1),
            planned_datetime=None,
        )
        bid_opening = types.SimpleNamespace(
            stage_key="bid_opening",
            completed_date=None,
            planned_datetime=real_datetime(2026, 7, 10, 9, 0),
        )
        project = types.SimpleNamespace(
            id=101,
            number="PRJ-2026-001",
            name="XML & 中文项目",
            purchaser="采购人<甲>",
            year="2026",
            method="公开招标",
            budget=100000,
            current_stage_key="result_announced",
            progress=80,
            notes="备注 & <safe>",
            is_terminated=False,
            terminated_type=None,
            stages=[announcement, bid_opening],
            lots=[first_lot, second_lot],
            bid_results=[
                first_bid_result,
                second_bid_result,
                third_bid_result,
                unmatched_bid_result,
            ],
        )
        self.project = project
        self.query = FakeQuery([project])

        self.module = load_replacements()
        self.module.request = types.SimpleNamespace(args={})
        FakeProjectModel.query = self.query
        self.module.Project = FakeProjectModel
        self.module.joinedload = joinedload
        self.module.STAGES = [
            {"key": "announcement", "name": "公告发布"},
            {"key": "bid_opening", "name": "开标"},
            {"key": "result_announced", "name": "中标公告"},
        ]
        self.module.datetime = FrozenDateTime
        self.module.date = FrozenDate
        self.module.Path = Path
        self.module.app = types.SimpleNamespace(
            config={"IS_DESKTOP": True},
            response_class=FakeResponse,
        )
        self.module.jsonify = lambda value: value
        self.module.get_export_dir = lambda: self.export_dir
        self.module.load_app_settings = lambda: {}
        self.module.log_operation = Mock()
        self.previous_signed_attachments = sys.modules.get("signed_attachments")
        sys.modules["signed_attachments"] = signed_attachments_module
        self.previous_protect = signed_attachments_module._PROTECT_SECRET
        self.previous_unprotect = signed_attachments_module._UNPROTECT_SECRET
        signed_attachments_module._PROTECT_SECRET = lambda raw: b"protected:" + raw
        signed_attachments_module._UNPROTECT_SECRET = lambda raw: raw.removeprefix(b"protected:")
        self.module.DATA_DIR = self.temp_path

    def tearDown(self):
        signed_attachments_module._PROTECT_SECRET = self.previous_protect
        signed_attachments_module._UNPROTECT_SECRET = self.previous_unprotect
        if self.previous_signed_attachments is None:
            sys.modules.pop("signed_attachments", None)
        else:
            sys.modules["signed_attachments"] = self.previous_signed_attachments
        self.temp_dir.cleanup()

    def assert_query_matches_contract(self):
        self.assertEqual(self.query.filter_calls, [("eq", "year", "2026")])
        self.assertEqual(
            self.query.order_by_calls,
            [(("desc", "year"), ("desc", "number"))],
        )

    def assert_workbook_matches_contract(self, payload):
        with zipfile.ZipFile(io.BytesIO(payload)) as workbook:
            names = set(workbook.namelist())
            self.assertTrue(REQUIRED_MEMBERS.issubset(names))
            sheet = ElementTree.fromstring(workbook.read("xl/worksheets/sheet1.xml"))

        merges = {
            merged.attrib["ref"]
            for merged in sheet.findall("./x:mergeCells/x:mergeCell", OOXML_NS)
        }
        self.assertIn("A1:S1", merges)
        self.assertIn("A2:S2", merges)

        row_1 = row_values(sheet, 1)
        row_2 = row_values(sheet, 2)
        row_4 = row_values(sheet, 4)

        self.assertEqual(row_1["A"], "项目导出清单")
        self.assertIn("导出时间：", row_2["A"])
        self.assertIn("筛选年份：2026", row_2["A"])
        self.assertIn("项目数：1", row_2["A"])
        self.assertEqual([row_4.get(column) for column in "ABCDEFGHIJKLMNOPQRS"], EXPECTED_HEADERS)
        data_row_numbers = [
            int(node.attrib["r"])
            for node in sheet.findall("./x:sheetData/x:row", OOXML_NS)
            if int(node.attrib["r"]) >= 5
        ]
        self.assertEqual(data_row_numbers, [5, 6])
        data_rows = [
            [
                row_values(sheet, row_number).get(column)
                for column in "ABCDEFGHIJKLMNOPQRS"
            ]
            for row_number in data_row_numbers
        ]
        self.assertEqual(data_rows, EXPECTED_ROWS)

        pane = sheet.find("./x:sheetViews/x:sheetView/x:pane", OOXML_NS)
        self.assertIsNotNone(pane)
        self.assertEqual(pane.attrib.get("topLeftCell"), "A5")

        auto_filter = sheet.find("./x:autoFilter", OOXML_NS)
        self.assertIsNotNone(auto_filter)
        self.assertRegex(auto_filter.attrib.get("ref", ""), r"^A4:S\d+$")
        end_row = int(auto_filter.attrib["ref"].split(":")[1][1:])
        self.assertGreaterEqual(end_row, 4 + len(EXPECTED_ROWS))

        columns = []
        for node in sheet.findall("./x:cols/x:col", OOXML_NS):
            width = float(node.attrib["width"])
            for _ in range(int(node.attrib["min"]), int(node.attrib["max"]) + 1):
                columns.append(width)
        self.assertGreaterEqual(len(columns), len(EXPECTED_WIDTHS))
        for actual, expected in zip(columns[: len(EXPECTED_WIDTHS)], EXPECTED_WIDTHS):
            self.assertAlmostEqual(actual, expected, places=2)

        sheet_view = sheet.find("./x:sheetViews/x:sheetView", OOXML_NS)
        self.assertIsNotNone(sheet_view)
        self.assertEqual(sheet_view.attrib.get("showGridLines"), "0")

    def test_api_export_download_mode_emits_valid_xlsx_without_openpyxl(self):
        self.module.request.args = {"download": "1", "year": "2026"}

        with patch("builtins.__import__", side_effect=reject_openpyxl):
            response = self.module.api_export()

        self.assert_query_matches_contract()
        self.assertEqual(response.mimetype, DOWNLOAD_MIME)
        expected_filename = "项目列表_2026_2026-07-16.xlsx"
        expected_ascii = "ProjectList_2026_2026-07-16.xlsx"
        self.assertEqual(
            response.headers.get("Content-Disposition"),
            f"attachment; filename=\"{expected_ascii}\"; filename*=UTF-8''{quote(expected_filename)}",
        )
        self.assert_workbook_matches_contract(response_bytes(response))

    def test_export_current_stage_uses_configured_workflow_order(self):
        result_stage = types.SimpleNamespace(
            stage_key="result_announced",
            completed=False,
            skipped=False,
            completed_date=None,
            planned_datetime=None,
        )
        self.project.stages.append(result_stage)
        self.project.current_stage_key = "announcement"
        self.module.load_app_settings = lambda: {
            "stage_order": ["result_announced", "bid_opening", "announcement"]
        }
        self.module.request.args = {"download": "1", "year": "2026"}

        response = self.module.api_export()

        with zipfile.ZipFile(io.BytesIO(response_bytes(response))) as workbook:
            sheet = ElementTree.fromstring(
                workbook.read("xl/worksheets/sheet1.xml")
            )
        self.assertEqual(row_values(sheet, 5)["M"], "中标公告")

    def test_api_export_save_mode_returns_json_and_writes_same_valid_xlsx(self):
        self.module.request.args = {"save": "1", "year": "2026"}

        with patch("builtins.__import__", side_effect=reject_openpyxl):
            result = self.module.api_export()

        self.assert_query_matches_contract()
        self.assertEqual(
            set(result),
            {"message", "filename", "path", "folder", "year", "count"},
        )
        self.assertIsInstance(result["message"], str)
        self.assertTrue(result["message"])
        self.assertEqual(result["year"], "2026")
        self.assertEqual(result["count"], 1)
        self.assertEqual(result["folder"], str(self.export_dir))
        self.assertEqual(result["filename"], "项目列表_2026_2026-07-16.xlsx")

        saved_path = Path(result["path"])
        self.assertTrue(saved_path.exists())
        self.assertEqual(saved_path.parent, self.export_dir)
        self.assertEqual(saved_path.name, result["filename"])
        self.assert_workbook_matches_contract(saved_path.read_bytes())

        self.module.log_operation.assert_called_once()
        self.assertEqual(self.module.log_operation.call_args.args[0], "export_projects")

    def test_api_export_save_mode_contains_traversal_year_inside_export_directory(self):
        malicious_year = "/../../escaped"
        (self.export_dir / "项目列表_").mkdir()
        self.module.request.args = {"save": "1", "year": malicious_year}

        result = self.module.api_export()

        self.assertEqual(self.query.filter_calls, [("eq", "year", malicious_year)])
        self.assertEqual(result["year"], malicious_year)
        saved_path = Path(result["path"])
        self.assertEqual(saved_path.resolve().parent, self.export_dir.resolve())
        self.assertNotIn("/", result["filename"])
        self.assertNotIn("\\", result["filename"])
        self.assertFalse((self.temp_path / "escaped_2026-07-16.xlsx").exists())

    def test_api_export_download_mode_sanitizes_header_year(self):
        malicious_year = '2026"\r\nX-Injected: yes'
        self.module.request.args = {"download": "1", "year": malicious_year}

        response = self.module.api_export()

        self.assertEqual(self.query.filter_calls, [("eq", "year", malicious_year)])
        disposition = response.headers["Content-Disposition"]
        self.assertNotIn("\r", disposition)
        self.assertNotIn("\n", disposition)
        self.assertNotIn("X-Injected: yes", disposition)
        self.assertRegex(
            disposition,
            r'^attachment; filename="ProjectList_[A-Za-z0-9_-]+_2026-07-16\.xlsx"; '
            r"filename\*=UTF-8''[A-Za-z0-9%_.-]+$",
        )

    def test_api_export_removes_xml_1_0_illegal_control_characters(self):
        self.project.name = "XML\u000b项目"
        self.module.request.args = {"download": "1", "year": "2026"}

        response = self.module.api_export()

        with zipfile.ZipFile(io.BytesIO(response_bytes(response))) as workbook:
            sheet_xml = workbook.read("xl/worksheets/sheet1.xml")
        self.assertNotIn(b"\x0b", sheet_xml)
        sheet = ElementTree.fromstring(sheet_xml)
        self.assertEqual(row_values(sheet, 5)["C"], "XML项目")

    def test_api_export_signs_each_attachment_for_seven_days_on_lan(self):
        attachments = [
            types.SimpleNamespace(id=41, project_id=101, filename="报名表.pdf"),
            types.SimpleNamespace(id=42, project_id=101, filename="授权书.docx"),
        ]

        class AttachmentQuery:
            def filter_by(self, **values):
                self.project_id = values["project_id"]
                return self

            def all(self):
                return [item for item in attachments if item.project_id == self.project_id]

        self.module.Attachment = type("Attachment", (), {"query": AttachmentQuery()})
        self.module.request = types.SimpleNamespace(
            args={"download": "1", "year": "2026"},
            host_url="http://192.168.5.7:5001/",
            host="192.168.5.7:5001",
        )

        response = self.module.api_export()

        with zipfile.ZipFile(io.BytesIO(response_bytes(response))) as workbook:
            main_xml = workbook.read("xl/worksheets/sheet1.xml").decode("utf-8")
            catalog_xml = workbook.read("xl/worksheets/sheet2.xml").decode("utf-8")
        self.assertIn("/api/public/attachments/41/download?expires=", main_xml)
        self.assertIn("/api/public/attachments/41/download?expires=", catalog_xml)
        self.assertIn("/api/public/attachments/42/download?expires=", catalog_xml)
        self.assertNotIn("/api/attachments/41/download", catalog_xml)
        self.assertIn("链接到期时间", catalog_xml)
        match = re.search(r"attachments/41/download\?expires=(\d+)&amp;sig=([0-9a-f]{64})", catalog_xml)
        self.assertIsNotNone(match)
        self.assertEqual(int(match.group(1)) - int(FIXED_NOW.timestamp()), 7 * 24 * 60 * 60)

    def test_export_table_headers_and_data_have_borders_and_wrapping(self):
        attachments = [
            types.SimpleNamespace(id=41, project_id=101, filename="attachment-long-name.pdf")
        ]

        class AttachmentQuery:
            def filter_by(self, **values):
                self.project_id = values["project_id"]
                return self

            def all(self):
                return [item for item in attachments if item.project_id == self.project_id]

        self.module.Attachment = type("Attachment", (), {"query": AttachmentQuery()})
        self.module.request = types.SimpleNamespace(
            args={"download": "1", "year": "2026"},
            host_url="http://192.168.5.7:5001/",
            host="192.168.5.7:5001",
        )

        response = self.module.api_export()

        with zipfile.ZipFile(io.BytesIO(response_bytes(response))) as workbook:
            assert_cells_bordered_and_wrapped(
                self,
                workbook,
                "xl/worksheets/sheet1.xml",
                ("A4", "R5", "S5"),
                title_ref="A1",
            )
            assert_cells_bordered_and_wrapped(
                self,
                workbook,
                "xl/worksheets/sheet2.xml",
                ("A1", "A2", "F2"),
            )


if __name__ == "__main__":
    unittest.main()
