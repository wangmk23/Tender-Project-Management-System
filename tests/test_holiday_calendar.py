import tempfile
import unittest
from src.backend_patches import holiday_calendar as hc


class HolidayCalendarTests(unittest.TestCase):
    def test_official_holidays_and_makeup(self):
        self.assertEqual(hc.day_info('2026-10-01')['status'], 'holiday')
        self.assertEqual(hc.day_info('2026-10-10')['status'], 'workday')
        self.assertEqual(hc.day_info('2026-10-11')['status'], 'weekend')
        self.assertEqual(hc.day_info('2026-09-20')['label'], '班')

    def test_deadline_counts_makeup_excludes_holidays_and_start(self):
        self.assertEqual(hc.calculate_deadline('2026-10-01', 5, 'workday'), '2026-10-13')
        self.assertEqual(hc.calculate_deadline('2026-10-01', 5, 'calendar'), '2026-10-06')
        self.assertEqual(hc.calculate_deadline('2026-10-01', 5, 'workday', '17:30'), '2026-10-13T17:30')

    def test_unknown_year_is_not_estimated(self):
        self.assertFalse(hc.day_info('2027-01-01')['confirmed'])
        with self.assertRaises(hc.HolidayDataUnavailable):
            hc.calculate_deadline('2026-12-31', 1, 'workday')
        self.assertEqual(hc.calculate_deadline('2026-12-31', 1, 'calendar'), '2027-01-01')

    def test_invalid_dates_counts_and_untrusted_updates(self):
        for count in (True, 0, 366, -1):
            with self.assertRaises(ValueError): hc.calculate_deadline('2026-01-01', count, 'workday')
        with self.assertRaises(ValueError): hc.calculate_deadline('2026-02-30', 5, 'calendar')
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(ValueError): hc.update_data(folder, 2026, url='https://example.com/calendar.json')

    def test_builtin_matches_public_dataset(self):
        import json
        from pathlib import Path
        data=json.loads((Path(__file__).resolve().parents[1]/'docs/data/holidays/2026.json').read_text('utf-8'))
        self.assertEqual(hc.validate_data(data), hc.get_calendar(2026))


if __name__ == '__main__': unittest.main()
