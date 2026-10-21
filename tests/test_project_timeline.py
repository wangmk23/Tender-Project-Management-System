import unittest
from unittest.mock import patch
from sqlalchemy import text
from src.backend_patches import procurement_catalog as catalog
from tests import test_procurement_method_api as fixtures


class ProjectTimelineTests(unittest.TestCase):
    def test_completed_uses_latest_actual_date_not_template_position_or_skipped_dates(self):
        payload=dict(created_at='2026-10-01T09:00',progress=100,stages=[
            dict(key='first',completed=True,completed_at='2026-10-09T12:30'),
            dict(key='last',completed=True,completed_date='2026-10-08'),
            dict(key='skip',completed=True,skipped=True,completed_date='2026-10-20'),
            dict(key='removed',completed=False,template_removed=True)])
        result=catalog.project_timeline(payload)
        self.assertEqual(result['state'],'completed')
        self.assertEqual(result['ended_at'],'2026-10-09T12:30+08:00')
        self.assertEqual(result['created_at'],'2026-10-01T09:00+00:00')
        self.assertEqual(result['end_source'],'stage_completion')

    def test_open_stage_overrides_rounded_progress_or_stale_completion(self):
        result=catalog.project_timeline(dict(progress=100,completed_at='2026-10-09',
            stages=[dict(completed=False,planned_at='2026-10-20')]))
        self.assertEqual(result['state'],'active');self.assertIsNone(result['ended_at'])

    def test_date_only_completion_on_latest_day_does_not_invent_precise_end_time(self):
        result=catalog.project_timeline(dict(stages=[dict(completed=True,completed_date='2026-10-09'),
            dict(completed=True,completed_at='2026-10-09T09:00')]))
        self.assertEqual(result['ended_at'],'2026-10-09')

    def test_missing_actual_dates_are_not_inferred_from_plans_or_current_time(self):
        result=catalog.project_timeline(dict(progress=100,stages=[dict(completed=True,planned_at='2026-10-20')]))
        self.assertEqual(result['state'],'completed');self.assertIsNone(result['ended_at'])
        self.assertIsNone(result['created_at'])
        self.assertEqual(result['end_source'],'unrecorded')

    def test_terminated_outcomes_are_distinct_and_never_use_stage_end(self):
        for kind in ['terminated','liubiao','feibiao']:
            payload=dict(is_terminated=True,terminated_type=kind,progress=100,
                stages=[dict(completed=True,completed_date='2026-10-09')])
            self.assertEqual(catalog.project_timeline(payload)['state'],kind)
            self.assertIsNone(catalog.project_timeline(payload)['ended_at'])
            self.assertEqual(catalog.project_timeline(payload,'2026-10-10T09:00+00:00')['ended_at'],'2026-10-10T09:00+00:00')


class ProjectTimelineApiTests(unittest.TestCase):
    setUp=fixtures.ProcurementMethodApiTests.setUp
    tearDown=fixtures.ProcurementMethodApiTests.tearDown
    login=fixtures.ProcurementMethodApiTests.login

    def put(self,body):
        return self.client.put('/api/projects/1',json=body,headers=self.headers)

    def test_close_is_recorded_once_restore_clears_and_reclose_records_new_time(self):
        with patch.object(catalog,'_now',return_value='2026-10-20T02:00:00+00:00'):
            first=self.put(dict(is_terminated=True,terminated_type='liubiao',terminated_reason='模拟原因'))
        self.assertEqual(first.status_code,200,first.json)
        self.assertEqual(first.json['project_timeline']['state'],'liubiao')
        self.assertEqual(first.json['project_timeline']['ended_at'],'2026-10-20T02:00:00+00:00')
        with patch.object(catalog,'_now',return_value='2026-10-21T02:00:00+00:00'):
            second=self.put(dict(is_terminated=True,terminated_type='liubiao',notes='补充说明'))
        self.assertEqual(second.json['project_timeline']['ended_at'],first.json['project_timeline']['ended_at'])
        restored=self.put(dict(is_terminated=False))
        self.assertEqual(restored.json['project_timeline']['state'],'active')
        self.assertIsNone(restored.json['project_timeline']['ended_at'])
        with patch.object(catalog,'_now',return_value='2026-10-22T02:00:00+00:00'):
            last=self.put(dict(is_terminated=True,terminated_type='feibiao'))
        self.assertEqual(last.json['project_timeline']['ended_at'],'2026-10-22T02:00:00+00:00')

    def test_existing_closed_project_remains_unknown_instead_of_install_time(self):
        project=self.db.session.get(self.Project,1);project.is_terminated=True;project.terminated_type='terminated';self.db.session.commit()
        result=self.put(dict(notes='补充旧项目说明')).json
        self.assertIsNone(result['project_timeline']['ended_at'])
        self.assertEqual(result['project_timeline']['end_source'],'unrecorded')

    def test_rejected_write_has_no_end_record(self):
        result=self.put(dict(is_terminated=True,name=''))
        self.assertEqual(result.status_code,400)
        self.assertEqual(self.db.session.execute(text('SELECT COUNT(*) FROM project_end_dates')).scalar(),0)
