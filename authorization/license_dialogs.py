"""Application-owned dark modal dialogs; native file pickers stay native.

Construction is hidden. Only present() maps/focuses the window, allowing GUI
regressions to exercise real Tk widgets without disturbing the desktop.
"""
import tkinter as tk
from tkinter import ttk
from pathlib import Path

import license_theme as theme
from license_layout import Card


class Dialog:
    def __init__(self, owner, title, text, *, kind='info', show='', initialvalue=''):
        self.owner = owner
        self.kind = kind
        self.result = None if kind == 'string' else False if kind == 'question' else 'ok'
        self._closed = False
        self._previous_focus = owner.focus_get()
        self._previous_grab = owner.grab_current()
        self._previous_grab_status = (self._previous_grab.grab_status()
                                      if self._previous_grab is not None else None)
        self.window = tk.Toplevel(owner)
        self.window.withdraw()
        self.window.title(str(title))
        for icon in (Path(__file__).with_name('app-icon-transparent.ico'),
                     Path(__file__).resolve().parent.parent/'src/assets/app-icon-transparent.ico'):
            if icon.is_file():
                try:
                    self.window.iconbitmap(str(icon))
                except tk.TclError:
                    pass
                break
        self.window.configure(bg=theme.BG)
        # Tk/Windows may keep a transient of a withdrawn owner hidden too.
        # Startup errors use a withdrawn root, so only attach visible owners.
        if owner.winfo_toplevel().winfo_viewable():
            self.window.transient(owner.winfo_toplevel())
        self.window.resizable(True, True)
        self.window.columnconfigure(0, weight=1)
        self.window.rowconfigure(0, weight=1)
        self.window.protocol('WM_DELETE_WINDOW', self.cancel)
        self.window.bind('<Escape>', self.cancel)
        self.window.bind('<Return>', self.accept)
        self.window.bind('<Destroy>', self._destroyed, add='+')
        card = Card(self.window)
        card.grid(row=0, column=0, sticky='nsew', padx=16, pady=16)
        body = card.body
        body.columnconfigure(0, weight=1)
        body.rowconfigure(1, weight=1)
        titles = {'info': '操作完成', 'warning': '请检查', 'error': '操作未完成',
                  'question': '请确认', 'string': '密码验证' if show else '请输入'}
        ttk.Label(body, text=str(title) or titles.get(kind, '提示'), style='Section.TLabel').grid(
            row=0, column=0, sticky='w', pady=(0, 12))
        message_frame = ttk.Frame(body, style='Card.TFrame')
        message_frame.grid(row=1, column=0, sticky='nsew')
        message_frame.columnconfigure(0, weight=1)
        message_frame.rowconfigure(0, weight=1)
        # Character wrapping also handles unbroken Windows paths. A bounded
        # viewport keeps unusually long diagnostics accessible on small screens.
        lines = str(text).splitlines() or ['']
        height = min(9, max(2, sum(max(1, (len(line) + 39) // 40) for line in lines)))
        self.message = tk.Text(message_frame, wrap='char', height=height, width=40,
                               bg=theme.PANEL, fg=theme.TEXT, relief='flat', bd=0,
                               highlightthickness=0, font=('Microsoft YaHei UI', 10),
                               padx=0, pady=0, cursor='arrow', takefocus=True)
        self.message.insert('1.0', str(text))
        self.message.configure(state='disabled')
        self.message.grid(row=0, column=0, sticky='nsew')
        self.scrollbar = ttk.Scrollbar(message_frame, orient='vertical', command=self.message.yview)
        self.scrollbar.grid(row=0, column=1, sticky='ns', padx=(8, 0))
        def scroll_status(first, last):
            self.scrollbar.set(first, last)
            if float(first) == 0.0 and float(last) == 1.0:
                self.scrollbar.grid_remove()
            else:
                self.scrollbar.grid()
        self.message.configure(yscrollcommand=scroll_status)
        self.entry = None
        if kind == 'string':
            self.entry = ttk.Entry(body, show=show)
            self.entry.insert(0, initialvalue or '')
            self.entry.grid(row=2, column=0, sticky='ew', pady=(16, 8))
        buttons = ttk.Frame(body, style='Card.TFrame')
        buttons.grid(row=3, column=0, sticky='e', pady=(16, 0))
        self.cancel_button = None
        if kind in ('string', 'question'):
            self.cancel_button = ttk.Button(buttons, text='取消', command=self.cancel)
            self.cancel_button.pack(side='left', padx=(0, 10))
        self.ok_button = ttk.Button(buttons, text='确定', style='Primary.TButton', command=self.accept)
        self.ok_button.pack(side='left')
        self.window.update_idletasks()
        # Tk scales fonts in points. Scale the minimum canvas width with DPI too.
        scale = max(1.0, float(owner.tk.call('tk', 'scaling')) / (96 / 72))
        width = min(max(round(430 * scale), self.window.winfo_reqwidth()), owner.winfo_screenwidth() - 40)
        height = min(max(round(240 * scale), self.window.winfo_reqheight()), owner.winfo_screenheight() - 80)
        self.window.minsize(min(width, round(390 * scale)), min(height, round(230 * scale)))
        parent = owner.winfo_toplevel()
        if parent.winfo_viewable():
            x = parent.winfo_rootx() + (parent.winfo_width() - width) // 2
            y = parent.winfo_rooty() + (parent.winfo_height() - height) // 2
        else:
            x = (owner.winfo_screenwidth() - width) // 2
            y = (owner.winfo_screenheight() - height) // 2
        x = max(0, min(x, owner.winfo_screenwidth() - width))
        y = max(0, min(y, owner.winfo_screenheight() - height))
        self.window.geometry(f'{width}x{height}+{x}+{y}')

    def present(self):
        self.window.deiconify()
        self.window.wait_visibility()
        self.window.grab_set()
        target = self.entry if self.entry is not None else self.ok_button
        target.focus_set()
        if self.entry is not None:
            self.entry.selection_range(0, 'end')

    def run(self):
        try:
            self.present()
            if self.window.winfo_exists():
                self.window.wait_window()
        except tk.TclError:
            # An owner destroyed while a modal wait runs cancels the dialog.
            self.cancel()
        return self.result

    def accept(self, event=None):
        if self._closed:
            return 'break'
        if self.kind == 'string':
            self.result = self.entry.get()
        elif self.kind == 'question':
            self.result = True
        self._close()
        return 'break'

    def cancel(self, event=None):
        self._close()
        return 'break'

    def _destroyed(self, event):
        if event.widget is self.window:
            self._close(destroy=False)

    def _close(self, *, destroy=True):
        if self._closed:
            return
        self._closed = True
        try:
            if self.window.winfo_exists():
                if self.window.grab_current() is self.window:
                    self.window.grab_release()
                if self.entry is not None:
                    self.entry.delete(0, 'end')
                if destroy:
                    self.window.destroy()
        except tk.TclError:
            pass
        try:
            if self._previous_grab is not None and self._previous_grab.winfo_exists():
                if self._previous_grab_status == 'global':
                    self._previous_grab.grab_set_global()
                else:
                    self._previous_grab.grab_set()
            if self._previous_focus is not None and self._previous_focus.winfo_exists():
                self._previous_focus.focus_set()
        except tk.TclError:
            pass


class Dialogs:
    """Local replacement for the messagebox/simpledialog calls in one app."""
    def __init__(self, owner):
        self.owner = owner

    def _open(self, title, text, kind, *, parent=None, show='', initialvalue='', **options):
        return Dialog(parent if parent is not None else self.owner, title, text,
                      kind=kind, show=show, initialvalue=initialvalue).run()

    def askstring(self, title, prompt, **options):
        return self._open(title, prompt, 'string', **options)

    def askyesno(self, title, message, **options):
        return self._open(title, message, 'question', **options)

    def showinfo(self, title, message, **options):
        return self._open(title, message, 'info', **options)

    def showwarning(self, title, message, **options):
        return self._open(title, message, 'warning', **options)

    def showerror(self, title, message, **options):
        return self._open(title, message, 'error', **options)
