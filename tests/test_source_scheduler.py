import unittest
from unittest.mock import Mock
from flask import Flask, has_app_context
from src.project_manager.source_scheduler import SourceScheduler

class SchedulerTests(unittest.TestCase):
    def test_failure_does_not_skip_next_job_and_context_is_removed(self):
        app = Flask(__name__)
        seen = []
        def fail():
            self.assertTrue(has_app_context())
            raise RuntimeError('private details')
        scheduler = SourceScheduler(app, jobs=[('bad', fail), ('good', lambda: seen.append(has_app_context()))])
        scheduler.tick()
        self.assertEqual(seen, [True])
        self.assertFalse(has_app_context())

    def test_stop_wakes_wait_and_joins(self):
        import threading
        called = threading.Event()
        scheduler = SourceScheduler(Flask(__name__), interval=3600, jobs=[('mock', called.set)])
        scheduler.start()
        self.assertTrue(called.wait(2))
        scheduler.stop()
        self.assertFalse(scheduler.thread.is_alive())
        scheduler.tick()

    def test_jobs_bind_explicit_factory_context(self):
        from unittest.mock import patch
        from src.project_manager import source_scheduler as module
        app = Flask(__name__)
        ctx = {'DATA_DIR': 'isolated', 'create_full_backup': Mock()}
        app.extensions['runtime_context'] = ctx
        with patch.object(module.scheduled_digest_backup, 'run_scheduled_backup_if_due') as backup, \
             patch.object(module.project_event_reminders, 'run_project_event_reminders_if_due') as events, \
             patch.object(module.stage_auto_completion, '_auto_advance_stages') as stages, \
             patch.object(module.guarantee_delivery, 'run') as guarantees, \
             patch.object(module.calendar_service, 'check_updates') as calendar:
            SourceScheduler(app).tick()
        self.assertEqual(backup.call_count, 2)
        backup.assert_any_call(ctx, job='backup')
        backup.assert_any_call(ctx, job='digest')
        events.assert_called_once_with(ctx)
        stages.assert_called_once_with(ctx)
        self.assertIs(guarantees.call_args.args[0].create_full_backup, ctx['create_full_backup'])
        calendar.assert_called_once_with('isolated')
