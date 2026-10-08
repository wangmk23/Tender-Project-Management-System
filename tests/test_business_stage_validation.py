"""Stage input regressions using an isolated in-memory business fixture."""

import unittest
from datetime import date, datetime

from tests import test_stage_locations


class BusinessStageValidationTests(unittest.TestCase):
    def setUp(self):
        self.fixture = test_stage_locations.StageLocationTests()
        self.fixture.setUp()
        self.addCleanup(self.fixture.doCleanups)

    def test_invalid_schedule_preserves_saved_schedule_and_other_fields(self):
        original = datetime(2026, 10, 9, 9, 30)
        for value in ('2026-13-09T09:30', 'not-a-date', [], 123):
            with self.subTest(value=value):
                self.fixture.stage.planned_datetime = original
                self.fixture.stage.notes = '原备注'
                response = self.fixture.save(planned_at=value, notes='不应保存')
                self.assertEqual(response.status_code, 400)
                self.assertEqual(self.fixture.stage.planned_datetime, original)
                self.assertEqual(self.fixture.stage.notes, '原备注')

    def test_invalid_completion_date_does_not_complete_stage(self):
        for value in ('2026-02-30', 'not-a-date', [], 123):
            with self.subTest(value=value):
                self.fixture.stage.completed = False
                self.fixture.stage.completed_date = None
                self.fixture.stage.notes = '原备注'
                response = self.fixture.save(completed=True, completed_date=value, notes='不应保存')
                self.assertEqual(response.status_code, 400)
                self.assertFalse(self.fixture.stage.completed)
                self.assertIsNone(self.fixture.stage.completed_date)
                self.assertEqual(self.fixture.stage.notes, '原备注')

    def test_invalid_completion_date_preserves_existing_completion(self):
        self.fixture.stage.completed = True
        self.fixture.stage.completed_date = date(2026, 9, 30)
        response = self.fixture.save(completed_date='2026-02-30', notes='不应保存')
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.fixture.stage.completed_date, date(2026, 9, 30))
        self.assertEqual(self.fixture.stage.notes, '原备注')

    def test_explicit_schedule_clear_and_valid_dates_remain_supported(self):
        self.assertEqual(self.fixture.save(planned_at='2026-10-09T09:30').status_code, 200)
        self.assertEqual(self.fixture.stage.planned_datetime, datetime(2026, 10, 9, 9, 30))
        self.assertEqual(self.fixture.save(planned_at='').status_code, 200)
        self.assertIsNone(self.fixture.stage.planned_datetime)
        self.assertEqual(self.fixture.save(completed=True, completed_date='2026-10-08').status_code, 200)
        self.assertEqual(self.fixture.stage.completed_date, date(2026, 10, 8))


if __name__ == '__main__':
    unittest.main()
