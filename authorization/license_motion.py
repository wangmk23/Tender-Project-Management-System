"""Short, cancellable native Tk transitions; never block signing callbacks."""
import os
import sys
import time
import tkinter as tk


def animations_enabled():
    if os.environ.get('LICENSE_REDUCED_MOTION', '').lower() in ('1', 'true', 'yes'):
        return False
    if sys.platform == 'win32':
        try:
            import ctypes
            enabled = ctypes.c_int(1)
            if ctypes.windll.user32.SystemParametersInfoW(0x1042, 0, ctypes.byref(enabled), 0):
                return bool(enabled.value)
        except (AttributeError, OSError):
            pass
    return True


class Motion:
    def __init__(self, root, canvas, window):
        self.root, self.canvas, self.window = root, canvas, window
        self.enabled = animations_enabled()
        self.jobs = {}
        self.resets = {}
        root.bind('<Destroy>', self._destroy, add='+')

    def _destroy(self, event):
        if event.widget is self.root:
            for channel in list(self.jobs):
                self.cancel(channel)

    def cancel(self, channel):
        job = self.jobs.pop(channel, None)
        if job is not None:
            try:
                self.root.after_cancel(job)
            except tk.TclError:
                pass
        reset = self.resets.pop(channel, None)
        if reset:
            try:
                reset()
            except tk.TclError:
                pass

    def animate(self, channel, render, duration=160):
        self.cancel(channel)
        if not self.enabled:
            render(1.0)
            return
        started = time.monotonic()
        self.resets[channel] = lambda: render(1.0)
        def tick():
            elapsed = (time.monotonic() - started) * 1000 / duration
            progress = min(1.0, elapsed)
            render(1 - (1 - progress) ** 3)
            if progress < 1:
                self.jobs[channel] = self.root.after(16, tick)
            else:
                self.jobs.pop(channel, None)
                self.resets.pop(channel, None)
        tick()

    def page(self):
        self.animate('page', lambda progress: self.canvas.coords(self.window, 0, round(10 * (1-progress))))

    def selection(self, button, *, channel='selection', padding=(12, 12)):
        left, vertical = padding
        self.animate(channel, lambda progress: button.configure(
            padding=(left + round(3*(1-progress)), vertical, left, vertical)), 120)
