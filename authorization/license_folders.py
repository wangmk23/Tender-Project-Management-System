"""Open an explicitly chosen directory without a shell or reading key files."""
import os
from pathlib import Path
import stat
from tkinter import ttk

import license_theme as theme


def open_folder(folder):
    """Validate/list the directory before asking Windows to open that directory."""
    directory = Path(folder).resolve(strict=True)
    if not stat.S_ISDIR(directory.stat().st_mode):
        raise ValueError('保存位置不是目录，请检查路径。')
    # Check list access without reading any contained file (including PEM keys).
    with os.scandir(directory):
        pass
    try:
        os.startfile(str(directory), 'open')
    except PermissionError:
        raise
    except OSError as error:
        # An opener failure may itself be FileNotFoundError even when the
        # directory exists; keep it separate from directory validation errors.
        raise OSError('资源管理器无法打开此文件夹：' + str(error)) from error


class FolderLocation(ttk.Frame):
    """A wrapping native path button with pointer, Return and Space activation."""
    def __init__(self, parent, folder, *, text=None, on_error=None):
        super().__init__(parent, style='Card.TFrame')
        # Capture a concrete path now; never re-read mutable form variables later.
        self.folder = Path(folder).absolute()
        self.on_error = on_error
        self.columnconfigure(0, weight=1)
        self._style = str(self).replace('.', '_') + '.TButton'
        self._styles = ttk.Style(self)
        self._styles.configure(self._style, anchor='w', justify='left',
                               wraplength=530, foreground=theme.ACCENT)
        self.button = ttk.Button(self, text=str(text if text is not None else self.folder),
                                 command=self.open, takefocus=True, cursor='hand2',
                                 style=self._style)
        self.button.grid(row=0, column=0, sticky='ew')
        self.button.bind('<Return>', self._activate)
        self.button.bind('<space>', self._activate)
        self.button.bind('<Configure>', self._resize)
        ttk.Label(self, text='点击路径打开文件夹 · Enter / 空格',
                  style='Muted.TLabel').grid(row=1, column=0, sticky='w', pady=(6, 0))

    def _resize(self, event):
        self._styles.configure(self._style, wraplength=max(80, event.width - 32))

    def _activate(self, event=None):
        self.open()
        return 'break'

    def open(self):
        try:
            open_folder(self.folder)
            return True
        except FileNotFoundError:
            reason = '文件夹不存在，请检查保存位置；不会自动创建目录。'
        except PermissionError:
            reason = '没有访问或打开此文件夹的权限，请检查目录权限。'
        except (OSError, ValueError) as error:
            reason = '文件夹打开失败：' + str(error)
        message = str(self.folder) + '\n' + reason
        if self.on_error is not None:
            self.on_error(message)
        else:
            from license_dialogs import Dialogs
            Dialogs(self).showerror('无法打开文件夹', message)
        return False

