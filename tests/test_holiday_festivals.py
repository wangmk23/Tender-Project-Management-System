"""Festival labels are independent of days off; old revision hashes stay valid."""
import copy
import hashlib
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from src.backend_patches import holiday_calendar as hc, holiday_import as hi
from tests.test_holiday_import import workbook

HEADERS = ('开始日期', '结束日期', '类型', '名称')


class FestivalTests(unittest.TestCase):
    def parse(self, rows, year=2026):
        return hi.parse_xlsx(workbook(rows, headers=HEADERS), year)

    def test_official_festival_day_is_not_the_entire_break(self):
        for day, name in [('2026-01-01', '元旦'), ('2026-02-17', '春节'),
                          ('2026-04-05', '清明节'), ('2026-05-01', '劳动节'),
                          ('2026-06-19', '端午节'), ('2026-09-25', '中秋节'),
                          ('2026-10-01', '国庆节')]:
            self.assertEqual(hc.day_info(day)['festival_name'], name)
        for day in ['2026-02-15', '2026-04-04', '2026-10-02', '2026-10-07']:
            info = hc.day_info(day)
            self.assertEqual(info['festival_name'], '')
            self.assertEqual((info['status'], info['label']), ('holiday', '休'))
        self.assertEqual(hc.day_info('2026-10-10')['label'], '班')

    def test_festival_rows_can_overlap_rest_but_do_not_change_workday_arithmetic(self):
        snapshot = self.parse([('2026-10-01', '2026-10-07', '放假', '国庆假期'),
                               ('2026-10-01', '', '节日当天', '国庆节'),
                               ('2026-10-10', '', '补班', '')])
        self.assertEqual(len(snapshot['holidays']), 7)
        self.assertEqual(snapshot['festivals'], [dict(date='2026-10-01', name='国庆节')])
        snapshot['version'] = 1
        self.assertEqual(hc.day_info('2026-10-02', snapshot)['festival_name'], '')
        self.assertEqual(hc.calculate_deadline('2026-10-01', 5, 'workday', data=snapshot), '2026-10-13')
        # A festival label on a working day must never make it a holiday.
        snapshot['festivals'].append(dict(date='2026-10-08', name='自定义节日'))
        self.assertEqual(hc.day_info('2026-10-08', snapshot)['status'], 'workday')
        self.assertEqual(hc.calculate_deadline('2026-10-01', 5, 'workday', data=snapshot), '2026-10-13')

    def test_festival_validation_and_rest_conflict_still_reject_bad_rows(self):
        cases = [
            [('2026-10-01', '2026-10-07', '节日当天', '国庆节')],
            [('2026-10-01', '', '节日当天', '')],
            [('2026-10-01', '', '节日当天', '国庆节'), ('2026-10-01', '', '节日当天', '重复')],
            [('2026-10-01', '', '放假', ''), ('2026-10-01', '', '补班', '')],
            [('2027-01-01', '', '节日当天', '元旦')],
        ]
        for rows in cases:
            with self.subTest(rows=rows), self.assertRaises(hi.ImportProblem):
                self.parse(rows)

    def test_empty_explicit_labels_and_legacy_noncalendar_names_do_not_guess_festivals(self):
        snapshot = self.parse([('2026-10-01', '2026-10-07', '放假', '国庆节')])
        self.assertEqual(snapshot['festivals'], [])
        self.assertEqual(hc.day_info('2026-10-01', {**snapshot, 'version': 1})['festival_name'], '')
        unknown = hi.parse_xlsx(workbook([('2027-02-01', '2027-02-07', '放假', '春节')]), 2027)
        self.assertEqual(hc.day_info('2027-02-01', {**unknown, 'version': 1})['festival_name'], '')

    def test_old_revision_digest_and_files_remain_unchanged(self):
        legacy = dict(year=2026, holidays=[dict(date='2026-10-01', name='国庆节')], workdays=[])
        canonical = dict(**legacy, workday_names={})
        digest = hashlib.sha256(json.dumps(canonical, ensure_ascii=False, sort_keys=True,
                                           separators=(',', ':')).encode()).hexdigest()
        self.assertEqual(hi._digest(legacy), digest)
        with tempfile.TemporaryDirectory() as temp:
            folder = Path(temp)
            (folder / 'revisions').mkdir()
            record = dict(year=2026, revision=1, snapshot=legacy, sha256=digest,
                          created_at='2026-10-19T00:00:00', actor='旧管理员', operation='import')
            paths = {folder/'active.json': dict(schema=1, years={'2026': 1}),
                     folder/'revisions/2026-1.json': record}
            for path, value in paths.items(): path.write_text(json.dumps(value), encoding='utf-8')
            before = {path: path.read_bytes() for path in paths}
            active = hc.get_calendar(2026, folder)
            self.assertEqual(hc.day_info('2026-10-01', active)['festival_name'], '国庆节')
            self.assertNotIn('festivals', active)
            self.assertEqual(before, {path: path.read_bytes() for path in paths})

    def test_new_export_roundtrip_and_preview_show_separate_labels(self):
        original = hc.get_calendar(2026)
        untouched = copy.deepcopy(original)
        parsed = hi.parse_xlsx(hi.build_xlsx(2026, original), 2026)
        self.assertEqual(parsed['holidays'], original['holidays'])
        self.assertEqual(parsed['workdays'], original['workdays'])
        self.assertIn(dict(date='2026-04-05', name='清明节'), parsed['festivals'])
        self.assertEqual(original, untouched)
        altered = copy.deepcopy(parsed)
        altered['festivals'] = [dict(date='2026-10-01', name='国庆节')]
        self.assertEqual(hi._summary(altered)['festivals'], 1)
        self.assertTrue(hi._diff(parsed, altered)['changed'])
        raw = hi.build_xlsx(2026)
        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
            text = archive.read('xl/worksheets/sheet1.xml').decode()
            self.assertIn('节日当天', text)
            data = ET.fromstring(archive.read('xl/worksheets/sheet2.xml'))
            formula = data.find(f'{{{hi.NS}}}dataValidations/{{{hi.NS}}}dataValidation[@type="list"]/{{{hi.NS}}}formula1')
            self.assertEqual(formula.text, '"放假,补班,节日当天"')

    def test_validators_reject_invalid_festival_snapshots(self):
        for festivals in [None, [{'date':'2027-01-01','name':'跨年'}],
                          [{'date':'2026-10-01','name':''}],
                          [{'date':'2026-10-01','name':'a'}]*2]:
            snapshot = {**hc.get_calendar(2026), 'festivals': festivals}
            with self.subTest(festivals=festivals):
                with self.assertRaises(ValueError): hi._validate_snapshot(snapshot)
                with self.assertRaises(ValueError): hc.validate_data(snapshot)


if __name__ == '__main__': unittest.main()
