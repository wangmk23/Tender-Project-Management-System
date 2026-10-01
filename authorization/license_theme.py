"""Desktop palette aligned with the project manager dark theme."""
from tkinter import ttk

BG = '#101725'
PANEL = '#172033'
CONTROL = '#202b40'
TEXT = '#ebeff5'
MUTED = '#8ea0b8'
PRIMARY = '#008cff'


def apply(root):
    root.configure(bg=BG)
    root.option_add('*Font', ('Microsoft YaHei UI', 10))
    # Tk password dialogs use classic widgets rather than ttk.
    for widget, options in {
        'Frame': {'background': PANEL},
        'Label': {'background': PANEL, 'foreground': TEXT},
        'Entry': {'background': CONTROL, 'foreground': TEXT, 'insertBackground': TEXT},
        'Button': {'background': CONTROL, 'foreground': TEXT, 'activeBackground': '#2a3650', 'activeForeground': TEXT},
    }.items():
        for option, value in options.items():
            root.option_add(f'*{widget}.{option}', value)
    root.option_add('*TCombobox*Listbox.background', CONTROL)
    root.option_add('*TCombobox*Listbox.foreground', TEXT)
    root.option_add('*TCombobox*Listbox.selectBackground', '#26446b')
    root.option_add('*TCombobox*Listbox.selectForeground', '#ffffff')
    style = ttk.Style(root)
    style.theme_use('clam')
    style.configure('.', background=PANEL, foreground=TEXT, font=('Microsoft YaHei UI', 10))
    style.configure('TFrame', background=BG)
    style.configure('TLabelframe', background=PANEL, bordercolor='#344158', relief='solid')
    style.configure('TLabelframe.Label', background=PANEL, foreground=TEXT, font=('Microsoft YaHei UI', 11, 'bold'))
    style.configure('TLabel', background=PANEL, foreground=TEXT)
    style.configure('Shell.TLabel', background=BG)
    style.configure('TButton', padding=(14, 9), background=CONTROL, foreground=TEXT, bordercolor='#344158', focusthickness=2, focuscolor='#60a5fa')
    style.map('TButton', background=[('disabled', PANEL), ('pressed', '#314463'), ('active', '#2a3650')], foreground=[('disabled', MUTED)])
    style.configure('Primary.TButton', background=PRIMARY, foreground='#ffffff', font=('Microsoft YaHei UI', 10, 'bold'))
    style.map('Primary.TButton', background=[('disabled', CONTROL), ('pressed', '#006acc'), ('active', '#007be0')], foreground=[('disabled', MUTED), ('!disabled', '#ffffff')])
    for name in ('TEntry', 'TCombobox'):
        style.configure(name, fieldbackground=CONTROL, foreground=TEXT, padding=8, bordercolor='#344158', insertcolor=TEXT, arrowcolor=MUTED)
        style.map(name, fieldbackground=[('disabled', PANEL), ('readonly', CONTROL)], foreground=[('disabled', MUTED), ('readonly', TEXT)], bordercolor=[('focus', '#60a5fa')], selectbackground=[('!disabled', '#26446b')], selectforeground=[('!disabled', '#ffffff')])
    style.configure('Vertical.TScrollbar', background=CONTROL, troughcolor=BG, bordercolor=BG, arrowcolor=MUTED)
    return style
