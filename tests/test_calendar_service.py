import unittest
from src.backend_patches import calendar_service as cs

class CalendarServiceTests(unittest.TestCase):
    def test_holiday_makeup_and_cash_events_share_cells(self):
        raw=dict(cells=[dict(empty=False,date_str='2026-10-01',day=1,events=[]),dict(empty=False,date_str='2026-10-10',day=10,events=[])])
        event=dict(event_id='cash:1',date_str='2026-10-10',stage_name='保证金退还截止')
        result=cs.enrich_calendar(raw,2026,10,[event])
        self.assertEqual(result['cells'][0]['holiday']['status'],'holiday')
        self.assertEqual(result['cells'][1]['holiday']['label'],'班')
        self.assertEqual(result['cells'][1]['events'],[event])
        self.assertEqual(raw['cells'][1]['events'],[])
        self.assertTrue(result['holiday_calendar']['confirmed'])

    def test_unknown_year_stays_explicit_and_no_duplicates(self):
        raw=dict(cells=[dict(empty=False,date_str='2027-01-01',events=[dict(event_id='cash:1')])])
        result=cs.enrich_calendar(raw,2027,1,[dict(event_id='cash:1',date_str='2027-01-01')])
        self.assertEqual(len(result['cells'][0]['events']),1)
        self.assertFalse(result['holiday_calendar']['confirmed'])

if __name__=='__main__':unittest.main()
