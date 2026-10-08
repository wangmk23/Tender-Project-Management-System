"""Animation scheduler and actual hidden Tk integration; no production keys."""
import os
import sys
import tempfile
import tkinter as tk
import unittest
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'authorization'))
import license_motion
import license_issuer as tool

class Scheduler:
    def __init__(self): self.jobs = {}; self.sequence = 0
    def bind(self, *args, **kwargs): pass
    def after(self, delay, callback):
        self.sequence += 1; self.jobs[self.sequence] = callback; return self.sequence
    def after_cancel(self, job): self.jobs.pop(job, None)
    def step(self):
        callbacks = list(self.jobs.values()); self.jobs.clear()
        for callback in callbacks: callback()

class MotionTests(unittest.TestCase):
    def test_rapid_switch_cancels_previous_and_finishes_at_origin(self):
        scheduler = Scheduler(); positions = []
        with patch.object(license_motion, 'animations_enabled', return_value=True), patch.object(license_motion.time, 'monotonic', return_value=10) as now:
            motion = license_motion.Motion(scheduler, None, None)
            motion.animate('page', lambda value: positions.append(round(10*(1-value))))
            self.assertEqual(positions[-1], 10)
            now.return_value = 10.05; scheduler.step()
            self.assertTrue(0 < positions[-1] < 10)
            motion.animate('page', lambda value: positions.append(round(10*(1-value))))
            self.assertEqual(len(scheduler.jobs), 1)
            now.return_value = 10.25; scheduler.step()
            self.assertEqual(positions[-1], 0)
            self.assertFalse(motion.jobs); self.assertFalse(scheduler.jobs)

    def test_reduced_motion_uses_no_timer(self):
        scheduler = Scheduler(); values = []
        with patch.dict(os.environ, {'LICENSE_REDUCED_MOTION': '1'}):
            motion = license_motion.Motion(scheduler, None, None)
            motion.animate('page', values.append)
        self.assertEqual(values, [1.0]); self.assertFalse(scheduler.jobs)

    def test_hidden_tk_forms_states_and_focus_survive_rapid_navigation(self):
        root = tk.Tk(); root.withdraw(); self.addCleanup(root.destroy)
        directory = tempfile.TemporaryDirectory(); self.addCleanup(directory.cleanup)
        home_function = 'program_dir' if hasattr(tool, 'program_dir') else 'issuer_home'
        with patch.object(tool, home_function, return_value=Path(directory.name)), patch.object(license_motion, 'animations_enabled', return_value=True), patch.object(license_motion.time, 'monotonic', return_value=1) as now:
            ui = tool.create_window(root, {'device_code':'PM-TEST', 'machine_hash':'a'*64})
            ui.org_var.set('Retained'); ui.duration_var.set('自定义日期'); ui._toggle_custom()
            ui.custom_var.set('2099-01-01')
            ui.toggle_notes(); ui.notes.insert('1.0', 'Retained notes')
            focus = root.focus_get()
            for page in ('keys','devices','issue','keys','issue'): ui.switch_page(page)
            self.assertEqual(ui.content_canvas.coords(ui.canvas_window), [0,10])
            self.assertEqual(set(ui.motion.jobs), {'page','navigation'})
            self.assertEqual(root.focus_get(), focus)
            self.assertEqual(ui.org_var.get(), 'Retained')
            self.assertTrue(ui.custom_entry.instate(['!disabled']))
            self.assertEqual(ui.notes.get('1.0','end').strip(), 'Retained notes')
            self.assertEqual([name for name,page in ui.pages.items() if page.winfo_manager()], ['issue'])
            now.return_value = 1.2
            # Invoke scheduled callbacks immediately without a real-time sleep.
            for job in list(ui.motion.jobs.values()):
                callback = root.tk.call('after', 'info', job)[0]
                root.tk.call('after', 'cancel', job); root.tk.call(callback)
            self.assertEqual(ui.content_canvas.coords(ui.canvas_window), [0,0])
            self.assertFalse(ui.motion.jobs)
            self.assertEqual(tuple(map(int,ui.nav_buttons['issue'].cget('padding'))), (12,12,12,12))

if __name__ == '__main__': unittest.main()
