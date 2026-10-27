import copy
import unittest
from datetime import datetime
from src.backend_patches import business_deadlines as bd

class DeadlineOverviewTests(unittest.TestCase):
    def test_only_confirmed_active_items_count_and_original_deadlines_remain_frozen(self):
        base=dict(project_id=1,stage_key='a',title='答复事项',state='confirmed',confirmed_deadline='2026-10-25',needs_review=False)
        items=[dict(base,id='overdue'),dict(base,id='soon',confirmed_deadline='2026-10-28T09:00'),
               dict(base,id='review',confirmed_deadline='2026-11-20',needs_review=True),
               dict(base,id='done',state='completed'),dict(base,id='draft',state='pending'),dict(base,id='cancelled',state='cancelled')]
        before=copy.deepcopy(items)
        result=bd.overview_summaries(items,datetime(2026,10,26,12))
        self.assertEqual(result[1]['summary'],dict(total=3,overdue=1,dueSoon=1,review=1,alerts=3))
        self.assertEqual([item['id'] for item in result[1]['items']],['overdue','soon','review'])
        self.assertEqual(items,before)
    def test_preview_is_bounded_without_hiding_the_total_count(self):
        rows=[dict(id=str(i),project_id=1,stage_key='a',title='已确认事项',state='confirmed',confirmed_deadline='2026-10-01') for i in range(10)]
        result=bd.overview_summaries(rows,datetime(2026,10,26))
        self.assertEqual(len(result[1]['items']),6);self.assertEqual(result[1]['summary']['overdue'],10);self.assertEqual(result[1]['summary']['alerts'],10)
