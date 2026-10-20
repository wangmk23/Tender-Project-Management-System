import contextlib
import os
from pathlib import Path
import sys
import tempfile
import threading
import time
import tkinter as tk
import unittest
from unittest.mock import patch

repo=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(repo/'authorization' if (repo/'authorization').is_dir() else repo))
import license_issuer as issuer
from license_dialogs import Dialogs

class OperationTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.path=Path(self.temp.name);(self.path/'bidding.db').touch()
        self.stack=contextlib.ExitStack();self.addCleanup(self.stack.close)
        self.stack.enter_context(patch.object(issuer,'program_dir',return_value=self.path))
        self.stack.enter_context(patch.dict(os.environ,PROCUREMENT_ISSUER_HOME=str(self.path/'keys'),LICENSE_REDUCED_MOTION='1'))
        self.root=tk.Tk();self.root.withdraw();self.addCleanup(self.root.destroy)
        self.ui=issuer.create_window(self.root,{'machine_hash':'a'*64,'device_code':'PM-FAKE'})
        self.ui.target_var.set(str(self.path));self.ui.org_var.set('Fictional')
        for method in ('showinfo','showwarning','showerror'):
            self.stack.enter_context(patch.object(Dialogs,method))

    def drain(self):
        limit=time.monotonic()+3
        while self.ui.tasks.busy and time.monotonic()<limit:
            self.root.update();time.sleep(.005)
        self.root.update()
        self.assertFalse(self.ui.tasks.busy)

    def test_signing_keeps_event_loop_running_and_prevents_duplicate_clicks(self):
        started=threading.Event();release=threading.Event()
        doc={'payload':{'device_code':'PM-FAKE','expires_at':None}}
        def slow(**kwargs):
            started.set();release.wait(2)
            return doc,self.path/'license.dat'
        self.addCleanup(release.set)
        with patch.object(issuer,'issue',side_effect=slow) as sign,patch.object(Dialogs,'askstring',return_value='dummy') as prompt:
            before=time.monotonic();self.ui.issue()
            self.assertLess(time.monotonic()-before,.2)
            self.assertTrue(started.wait(1))
            tick=[];self.root.after(0,lambda:tick.append(True));self.root.update()
            self.assertTrue(tick);self.assertTrue(self.ui.tasks.busy)
            self.ui.issue();self.assertEqual(prompt.call_count,1);self.assertEqual(sign.call_count,1)
            release.set();self.drain()

    def test_record_failure_then_retry_only_updates_record(self):
        doc={'payload':{'device_code':'PM-FAKE','expires_at':None,'organization':'Fictional'}}
        error=issuer.RecordWriteError(doc,self.path/'license.dat','Fictional',PermissionError('CSV locked'))
        with patch.object(issuer,'issue',side_effect=error) as sign,patch.object(Dialogs,'askstring',return_value='dummy'):
            self.ui.issue();self.drain()
            self.assertIsNotNone(self.ui.pending_record)
            self.assertEqual(str(self.ui.issue_button.cget('state')),'disabled')
            with patch.object(issuer,'retry_record') as retry:
                self.ui.retry_record();self.drain()
            retry.assert_called_once_with(doc,self.path/'license.dat','Fictional')
            self.assertEqual(sign.call_count,1)
        self.assertIsNone(self.ui.pending_record)

    def test_export_failure_is_shown_without_losing_fields(self):
        with patch('tkinter.filedialog.asksaveasfilename',return_value=str(self.path)),patch.object(Dialogs,'showerror') as error:
            self.ui.export_device_info()
        error.assert_called_once();self.assertEqual(self.ui.org_var.get(),'Fictional')

    def test_two_half_wheel_events_accumulate_one_scroll_unit(self):
        self.root.update_idletasks()
        with patch.object(self.ui.content_canvas,'yview_scroll') as scroll:
            self.ui.content_canvas.event_generate('<MouseWheel>',delta=60)
            self.ui.content_canvas.event_generate('<MouseWheel>',delta=60)
            self.root.update()
        self.assertEqual(sum(call.args[0] for call in scroll.call_args_list),-1)

    def test_closing_task_owner_discards_callback(self):
        from license_tasks import BackgroundTasks
        child=tk.Toplevel(self.root);child.withdraw()
        completed=[];release=threading.Event()
        tasks=BackgroundTasks(child)
        tasks.start(lambda:release.wait(1),lambda result:completed.append(result),lambda error:completed.append(error))
        child.destroy();release.set();time.sleep(.04);self.root.update()
        self.assertEqual(completed,[])

if __name__=='__main__':unittest.main()
