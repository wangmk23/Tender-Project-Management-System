"""A single background operation; all Tk callbacks stay on the UI thread."""
from queue import Empty, Queue
from threading import Thread


class BackgroundTasks:
    def __init__(self, root, set_busy=None):
        self.root, self.set_busy = root, set_busy or (lambda busy: None)
        self.busy = False
        self.closed = False
        self.queue = Queue()
        self.timer = None
        root.bind('<Destroy>', self._destroyed, add='+')

    def _destroyed(self, event):
        if event.widget is self.root:
            self.close()

    def close(self):
        self.closed = True
        if self.timer is not None:
            try:
                self.root.after_cancel(self.timer)
            except Exception:
                pass
        self.timer = None

    def start(self, work, success, failure):
        if self.closed or self.busy:
            return False
        self.busy = True
        self.set_busy(True)
        def run():
            try:
                result = (True, work())
            except Exception as error:
                result = (False, error)
            # No Tk methods may be called from this worker, even on destruction.
            self.queue.put(result)
        Thread(target=run, daemon=True, name='issuer-operation').start()
        def poll():
            self.timer = None
            if self.closed:
                return
            try:
                ok, result = self.queue.get_nowait()
            except Empty:
                self.timer = self.root.after(20, poll)
                return
            self.busy = False
            self.set_busy(False)
            (success if ok else failure)(result)
        self.timer = self.root.after(20, poll)
        return True
