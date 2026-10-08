"""Desktop palette aligned with the project manager dark theme."""
import tkinter as tk
from tkinter import ttk

BG = '#101725'
PANEL = '#192335'
CONTROL = '#202b40'
TEXT = '#ebeff5'
MUTED = '#8ea0b8'
PRIMARY = '#2f6bc8'
ACCENT = '#72adff'
BORDER = '#29374c'
SIDEBAR = '#111b2d'


def surface_image(root, width, height, fill, outline, radius=14, backdrop=None):
    """Supersampled RGBA edges; native ttk controls retain their behavior."""
    from PIL import Image, ImageDraw, ImageTk
    scale = 4
    image = Image.new('RGBA', (width * scale, height * scale), backdrop)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((0, 0, width * scale - 1, height * scale - 1),
                           radius=radius * scale, fill=fill, outline=outline, width=scale)
    image = image.resize((width, height), Image.Resampling.LANCZOS)
    return ImageTk.PhotoImage(image, master=root)


def _rounded_image(root, fill, outline, radius=9, backdrop=PANEL):
    size = radius * 2 + 8
    image = surface_image(root, size, size, fill, outline, radius, backdrop)
    root._license_theme_images.append(image)
    return image


def _rounded_controls(root, style):
    # Keep native buttons and text areas: image elements only replace their skin.
    root._license_theme_images = getattr(root, '_license_theme_images', [])
    for name in ('TButton', 'Primary.TButton', 'Footer.Primary.TButton', 'Nav.TButton', 'NavActive.TButton',
                 'Mode.TButton', 'ModeActive.TButton', 'Status.TButton', 'TEntry', 'TCombobox'):
        element = 'License.' + name + '.surface'
        images = []
        for state in ((), ('disabled',), ('pressed',), ('active',), ('focus',)):
            fill = style.lookup(name, 'fieldbackground' if name in ('TEntry', 'TCombobox') else 'background', state)
            outline = style.lookup(name, 'bordercolor', state)
            backdrop = SIDEBAR if name.startswith('Nav') else BG if name in ('Status.TButton','Footer.Primary.TButton') else PANEL
            image = _rounded_image(root, fill, outline, backdrop=backdrop)
            images.append(image if not state else (*state, image))
        if element not in style.element_names():
            style.element_create(element, 'image', *images, border=10, sticky='nsew')
        if name == 'TEntry':
            children = [('Entry.padding', {'sticky': 'nsew', 'children': [('Entry.textarea', {'sticky': 'nsew'})]})]
        elif name == 'TCombobox':
            children = [('Combobox.downarrow', {'side': 'right', 'sticky': ''}),
                        ('Combobox.padding', {'sticky': 'nsew', 'children': [('Combobox.textarea', {'sticky': 'nsew'})]})]
        else:
            children = [('Button.padding', {'sticky': 'nsew', 'children': [('Button.label', {'sticky': 'nsew'})]})]
        style.layout(name, [(element, {'sticky': 'nsew', 'children': children})])

    element = 'License.Vertical.Scrollbar.thumb'
    images = [_rounded_image(root, '#35455e', '#35455e', radius=4, backdrop=BG),
              ('pressed', _rounded_image(root, '#59759c', '#59759c', radius=4, backdrop=BG)),
              ('active', _rounded_image(root, '#496181', '#496181', radius=4, backdrop=BG))]
    if element not in style.element_names():
        style.element_create(element, 'image', *images, border=4, sticky='nsew')
    style.layout('Vertical.TScrollbar', [('Vertical.Scrollbar.trough', {
        'sticky': 'ns', 'children': [(element, {'sticky': 'nsew'})]})])


def apply(root):
    root.configure(bg=BG)
    # Classic password controls need fonts; a global *Font would override ttk headings.
    for widget in ('Label', 'Entry', 'Button'):
        root.option_add(f'*{widget}.Font', ('Microsoft YaHei UI', 10))
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
    style.configure('.', background=PANEL, foreground=TEXT, font=('Microsoft YaHei UI', 10),
                    lightcolor=CONTROL, darkcolor=CONTROL, bordercolor=BORDER)
    style.configure('TFrame', background=BG)
    style.configure('TLabelframe', background=PANEL, bordercolor='#344158', relief='solid')
    style.configure('TLabelframe.Label', background=PANEL, foreground=TEXT, font=('Microsoft YaHei UI', 11, 'bold'))
    style.configure('TLabel', background=PANEL, foreground=TEXT)
    style.configure('Section.TLabel', background=PANEL, foreground=TEXT, font=('Microsoft YaHei UI', 11, 'bold'))
    style.configure('Shell.TLabel', background=BG)
    style.configure('TButton', padding=(14, 9), background=CONTROL, foreground=TEXT, bordercolor='#344158', focusthickness=2, focuscolor='#60a5fa')
    style.map('TButton', background=[('disabled', PANEL), ('pressed', '#314463'), ('active', '#2a3650')], foreground=[('disabled', MUTED)])
    style.configure('Primary.TButton', background=PRIMARY, foreground='#ffffff', font=('Microsoft YaHei UI', 10, 'bold'))
    style.map('Primary.TButton', background=[('disabled', CONTROL), ('pressed', '#24559f'), ('active', '#3573ce')], foreground=[('disabled', MUTED), ('!disabled', '#ffffff')])
    for name in ('TEntry', 'TCombobox'):
        style.configure(name, background=CONTROL, fieldbackground=CONTROL, foreground=TEXT, padding=(7, 5), bordercolor=BORDER, lightcolor=CONTROL, darkcolor=CONTROL, insertcolor=TEXT, arrowcolor=MUTED)
        style.map(name, background=[('disabled', PANEL), ('readonly', CONTROL), ('active', CONTROL)], fieldbackground=[('disabled', PANEL), ('readonly', CONTROL)], foreground=[('disabled', MUTED), ('readonly', TEXT)], bordercolor=[('disabled', BORDER), ('focus', '#60a5fa')], lightcolor=[('disabled', PANEL), ('readonly', CONTROL), ('focus', CONTROL)], darkcolor=[('disabled', PANEL), ('readonly', CONTROL), ('focus', CONTROL)], selectbackground=[('!disabled', '#26446b')], selectforeground=[('!disabled', '#ffffff')])
    style.configure('Vertical.TScrollbar', background='#35455e', troughcolor=BG, bordercolor=BG, lightcolor=BG, darkcolor=BG, arrowcolor=MUTED, arrowsize=12, borderwidth=0)
    style.map('Vertical.TScrollbar', background=[('disabled', PANEL), ('pressed', '#59759c'), ('active', '#496181')], lightcolor=[('!disabled', BG)], darkcolor=[('!disabled', BG)], bordercolor=[('!disabled', BG)])
    style.configure('Card.TFrame', background=PANEL)
    style.configure('Sidebar.TFrame', background=SIDEBAR)
    style.configure('SidebarCaption.TLabel', background=SIDEBAR, foreground=MUTED, font=('Microsoft YaHei UI', 9))
    style.configure('Brand.TLabel', background=SIDEBAR, foreground=TEXT, font=('Microsoft YaHei UI', 18, 'bold'))
    style.configure('PageTitle.TLabel', background=BG, foreground=TEXT, font=('Microsoft YaHei UI', 18, 'bold'))
    style.configure('ShellMuted.TLabel', background=BG, foreground='#a6b6cd', font=('Microsoft YaHei UI', 9))
    style.configure('Muted.TLabel', background=PANEL, foreground='#a6b6cd', font=('Microsoft YaHei UI', 9))
    style.configure('Notice.TFrame', background=BG)
    style.configure('Notice.TLabel', background=BG, foreground='#c5daf8', font=('Microsoft YaHei UI', 9))
    style.configure('KeyStatus.TLabel', background=PANEL, foreground='#92d8b5', font=('Microsoft YaHei UI', 12, 'bold'))
    style.configure('Nav.TButton', bordercolor=SIDEBAR, background=SIDEBAR, foreground='#b3c1d7', borderwidth=0, relief='flat', anchor='w', padding=(12,12))
    style.map('Nav.TButton', background=[('active','#1b2c48')],foreground=[('active',TEXT)])
    style.configure('NavActive.TButton', bordercolor='#203653', background='#203653', foreground='#c8dfff', borderwidth=0, relief='flat', anchor='w', padding=(12,12))
    style.map('NavActive.TButton', background=[('active','#2c4a78')])
    style.configure('Mode.TButton', background=CONTROL, foreground=TEXT, padding=(16,8))
    style.configure('ModeActive.TButton', background='#2a4b76', foreground='#dceaff', padding=(16,8))
    for name in ('TButton', 'Primary.TButton', 'Nav.TButton', 'NavActive.TButton', 'Mode.TButton', 'ModeActive.TButton'):
        background = style.lookup(name, 'background')
        style.configure(name, lightcolor=background, darkcolor=background, borderwidth=0, relief='flat')
        style.map(name, bordercolor=[('disabled', BORDER), ('focus', '#60a5fa')],
                  lightcolor=[('disabled', PANEL), ('!disabled', background)],
                  darkcolor=[('disabled', PANEL), ('!disabled', background)])
    for name, color in [('Nav.TButton', SIDEBAR), ('NavActive.TButton', '#203653')]:
        style.map(name, bordercolor=[('focus', ACCENT), ('active', '#263c58'), ('!focus', color)])
    style.configure('Status.TButton', background=BG, bordercolor=BG, padding=(10, 5), foreground=ACCENT)
    style.configure('Status.TLabel', background=BG, foreground='#8bd0b0', font=('Microsoft YaHei UI', 10))
    _rounded_controls(root, style)
    return style
