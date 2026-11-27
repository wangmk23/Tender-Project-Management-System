"""One stoppable scheduler per source host; no work runs on import."""
import threading
from types import SimpleNamespace
from src.backend_patches import (scheduled_digest_backup, project_event_reminders,
                                 stage_auto_completion, guarantee_delivery, calendar_service,
                                 recycle_bin, notification_channels)


def jobs_for(app):
    ctx = app.extensions['runtime_context']
    return (
        ('backup', lambda: scheduled_digest_backup.run_scheduled_backup_if_due(ctx, job='backup')),
        ('digest', lambda: scheduled_digest_backup.run_scheduled_backup_if_due(ctx, job='digest')),
        ('project-event', lambda: project_event_reminders.run_project_event_reminders_if_due(ctx)),
        ('stage-completion', lambda: stage_auto_completion._auto_advance_stages(ctx)),
        ('guarantee-reminder', lambda: guarantee_delivery.run(SimpleNamespace(**dict(ctx)))),
        ('holiday-update', lambda: calendar_service.check_updates(ctx['DATA_DIR'])),
        ('recycle-bin-purge', lambda: recycle_bin.purge_expired_items(ctx)),
        ('notification-dispatch', lambda: notification_channels.run_notification_dispatch(ctx)),
    )


class SourceScheduler:
    def __init__(self, app, interval=60, jobs=None):
        self.app = app
        self.jobs = jobs_for(app) if jobs is None else jobs
        self.interval = interval
        self.stopped = threading.Event()
        self.thread = threading.Thread(target=self._loop, name='source-scheduler', daemon=True)

    def tick(self):
        for name, job in self.jobs:
            if self.stopped.is_set():
                break
            try:
                # A fresh context removes the scoped DB session after each job,
                # including a failed transaction, before the next job starts.
                with self.app.app_context():
                    job()
            except Exception:
                self.app.logger.error('Scheduler %s failed', name)

    def _loop(self):
        while not self.stopped.is_set():
            self.tick()
            self.stopped.wait(self.interval)

    def start(self):
        self.thread.start()

    def stop(self):
        self.stopped.set()
        # Do not release the data-directory mutex while a job is still writing.
        if self.thread.ident is not None:
            self.thread.join()
