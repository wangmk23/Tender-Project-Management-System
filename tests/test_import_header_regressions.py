import io
import unittest
import zipfile

from src.backend_patches import data_import


class ImportHeaderSelectionTests(unittest.TestCase):
    def test_two_column_template_selects_real_header_after_legend(self):
        raw = data_import._build_workbook_xlsx(({
            'name': '供应商报名', 'title': '测试导入',
            'headers': ['公司名称', '所属包号'], 'required': ['公司名称'],
            'example': ['隔离测试供应商', '包1'],
        },))
        headers, rows = data_import._parse_xlsx_workbook(raw)['供应商报名']
        self.assertEqual(headers, ['公司名称', '所属包号'])
        self.assertEqual(rows[0], {'公司名称': '隔离测试供应商', '所属包号': '包1'})
        self.assertEqual(rows[0].source_row, 6)

    def parse_sheet(self, xml):
        xml = xml.replace('<worksheet>', '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('sheet.xml', xml)
        with zipfile.ZipFile(io.BytesIO(stream.getvalue())) as archive:
            return data_import._parse_worksheet(archive, 'sheet.xml', [])

    def test_sparse_normalized_alias_headers_win_over_richer_data_rows(self):
        headers, rows = self.parse_sheet('''<worksheet><sheetData>
            <row r="4"><c r="B4" t="inlineStr"><is><t> 项目 编号 </t></is></c>
            <c r="F4" t="inlineStr"><is><t>项目 名称</t></is></c></row>
            <row r="9"><c r="A9"><v>extra</v></c><c r="B9"><v>CG-ISOLATED</v></c>
            <c r="D9"><v>extra</v></c><c r="F9"><v>测试项目</v></c></row>
            </sheetData></worksheet>''')
        self.assertEqual(headers, ['项目编号', '项目名称'])
        self.assertEqual(rows[0], {'项目编号': 'CG-ISOLATED', '项目名称': '测试项目'})
        self.assertEqual(rows[0].source_row, 9)

    def test_unknown_workbook_preserves_earliest_most_populated_fallback(self):
        headers, rows = self.parse_sheet('''<worksheet><sheetData>
            <row r="1"><c r="A1"><v>instructions</v></c></row>
            <row r="2"><c r="A2"><v>Unknown A</v></c><c r="B2"><v>Unknown B</v></c></row>
            <row r="3"><c r="A3"><v>value-a</v></c><c r="B3"><v>value-b</v></c></row>
            </sheetData></worksheet>''')
        self.assertEqual(headers, ['UnknownA', 'UnknownB'])
        self.assertEqual(rows[0].source_row, 3)


if __name__ == '__main__':
    unittest.main()
