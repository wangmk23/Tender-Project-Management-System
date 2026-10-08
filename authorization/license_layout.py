"""Three focused pages for signing, device information and key management."""
import tkinter as tk
from tkinter import ttk
import license_theme as theme


class Card(tk.Canvas):
    """A restrained rounded surface around ordinary, accessible Tk controls."""
    def __init__(self, parent, *, notice=False):
        super().__init__(parent, bg=theme.BG, highlightthickness=0, bd=0, height=160)
        self.inset = 12
        self.body = ttk.Frame(self, style='Notice.TFrame' if notice else 'Card.TFrame', padding=4)
        self.surface = self.create_polygon(0, 0, 1, 1, fill='#1d3556' if notice else theme.PANEL, outline='#304d72' if notice else theme.BORDER, smooth=True)
        self.window = self.create_window(0, 0, window=self.body, anchor='nw')
        self.bind('<Configure>', self._size)
        self.body.bind('<Configure>', self._height)

    def _height(self, event):
        self.configure(height=event.height + self.inset * 2)

    def _size(self, event):
        w, h, r = event.width - 1, event.height - 1, 12
        self.coords(self.surface, r, 1, w-r, 1, w, 1, w, r, w, h-r, w, h, w-r, h,
                    r, h, 1, h, 1, h-r, 1, r, 1, 1)
        self.itemconfigure(self.window, width=max(1, event.width - self.inset * 2))
        self.coords(self.window, self.inset, self.inset)


def build(ui, *, bound_mode=False):
    from license_icons import load
    from pathlib import Path
    import license_issuer as issuer
    theme.apply(ui.root)
    ui.icons = load(ui.root)
    ui.pages = {}
    ui.nav_buttons = {}
    ui.active_page = 'issue'
    ui.target_mode = tk.StringVar(value='local')
    ui.target_var = tk.StringVar()
    ui.org_var = tk.StringVar()
    ui.duration_var = tk.StringVar(value='365天')
    ui.custom_var = tk.StringVar()
    ui.remote_var = tk.StringVar()
    ui.device_var = tk.StringVar(value=ui.fingerprint['device_code'])
    ui.hash_var = tk.StringVar(value=ui.fingerprint['machine_hash'])
    ui.setup_status = tk.StringVar()
    ui.key_status = tk.StringVar(value='尚未初始化')
    ui.feedback_var = tk.StringVar()
    ui.expiry_summary = tk.StringVar()

    ui.root.columnconfigure(1, weight=1)
    ui.root.rowconfigure(0, weight=1)
    sidebar = ttk.Frame(ui.root, style='Sidebar.TFrame', padding=(18, 26))
    sidebar.grid(row=0, column=0, sticky='nsew')
    sidebar.configure(width=176)
    sidebar.grid_propagate(False)
    sidebar.columnconfigure(0, weight=1)
    sidebar.rowconfigure(4, weight=1)
    ttk.Label(sidebar, text='项目管理系统', style='SidebarCaption.TLabel').grid(row=0, column=0, sticky='w')
    ttk.Label(sidebar, text='授权中心', style='Brand.TLabel').grid(row=1, column=0, sticky='w', pady=(5, 30))
    nav = ttk.Frame(sidebar, style='Sidebar.TFrame')
    nav.grid(row=2, column=0, sticky='ew')
    for key, label, image in [('issue', '签发授权', 'shield'), ('devices', '设备信息', 'device'), ('keys', '密钥管理', 'key')]:
        button = ttk.Button(nav, text='  '+label, image=ui.icons[image], compound='left', style='Nav.TButton', command=lambda key=key: ui.switch_page(key))
        button.pack(fill='x', pady=4)
        ui.nav_buttons[key] = button
    ttk.Label(sidebar, text='绑定磁盘版' if bound_mode else '自由运用版', style='SidebarCaption.TLabel').grid(row=5, column=0, sticky='w', pady=(0, 5))
    ttk.Label(sidebar, text=issuer.APP_VERSION, style='SidebarCaption.TLabel').grid(row=6, column=0, sticky='w')

    main = ttk.Frame(ui.root, padding=(24, 20, 24, 16))
    main.grid(row=0, column=1, sticky='nsew')
    main.columnconfigure(0, weight=1)
    main.rowconfigure(1, weight=1)
    header = ttk.Frame(main)
    header.grid(row=0, column=0, columnspan=2, sticky='ew', pady=(0, 16))
    ui.page_title = tk.StringVar()
    ui.page_description = tk.StringVar()
    ttk.Label(header, textvariable=ui.page_title, style='PageTitle.TLabel').pack(anchor='w')
    ttk.Label(header, textvariable=ui.page_description, style='ShellMuted.TLabel').pack(anchor='w', pady=(5, 0))
    viewport = ttk.Frame(main)
    viewport.grid(row=1, column=0, columnspan=2, sticky='nsew')
    viewport.columnconfigure(0, weight=1)
    viewport.rowconfigure(0, weight=1)
    ui.content_canvas = tk.Canvas(viewport, bg=theme.BG, highlightthickness=0, bd=0)
    ui.content_canvas.grid(row=0, column=0, sticky='nsew')
    scrollbar = ttk.Scrollbar(viewport, orient='vertical', command=ui.content_canvas.yview)
    scrollbar.grid(row=0, column=1, sticky='ns', padx=(6, 0))
    ui.content_canvas.configure(yscrollcommand=scrollbar.set)
    contents = ttk.Frame(ui.content_canvas)
    contents.columnconfigure(0, weight=1)
    canvas_window = ui.content_canvas.create_window((0, 0), window=contents, anchor='nw')
    ui.content_canvas.bind('<Configure>', lambda event: ui.content_canvas.itemconfigure(canvas_window, width=event.width))
    contents.bind('<Configure>', lambda _event: ui.content_canvas.configure(scrollregion=ui.content_canvas.bbox('all')))
    def wheel(event):
        if event.widget.winfo_toplevel() is ui.root and str(event.widget).startswith(str(main)):
            ui.content_canvas.yview_scroll(int(-event.delta/120), 'units')
    ui.root.bind('<MouseWheel>', wheel, add='+')
    for key in ['issue', 'devices', 'keys']:
        page = ttk.Frame(contents)
        page.columnconfigure(0, weight=1)
        ui.pages[key] = page

    def card(page, row, title, explanation=''):
        panel = Card(page)
        panel.grid(row=row, column=0, sticky='ew', pady=(0, 14))
        body = panel.body
        body.columnconfigure(0, weight=1)
        ttk.Label(body, text=title, style='Section.TLabel').grid(row=0, column=0, sticky='w')
        if explanation:
            ttk.Label(body, text=explanation, style='Muted.TLabel', wraplength=530).grid(row=1, column=0, sticky='w', pady=(5, 12))
        return body

    page = ui.pages['issue']
    banner_card = Card(page, notice=True)
    banner_card.grid(row=0, column=0, sticky='ew', pady=(0, 14))
    banner = banner_card.body
    banner.columnconfigure(0, weight=1)
    ttk.Label(banner, textvariable=ui.setup_status, style='Notice.TLabel', wraplength=430).grid(row=0, column=0, sticky='w')
    ttk.Button(banner, text='密钥管理', command=lambda: ui.switch_page('keys')).grid(row=0, column=1, padx=(14, 0))
    form = card(page, 1, '授权信息', '选择系统数据目录，填写使用单位与授权期限。')
    fields = ttk.Frame(form, style='Card.TFrame')
    fields.grid(row=2, column=0, sticky='ew')
    fields.columnconfigure(0, weight=1)
    ttk.Label(fields, text='系统数据目录').grid(row=0, column=0, sticky='w')
    target = ttk.Frame(fields, style='Card.TFrame')
    target.grid(row=1, column=0, sticky='ew', pady=(6, 14))
    target.columnconfigure(0, weight=1)
    ttk.Entry(target, textvariable=ui.target_var).grid(row=0, column=0, sticky='ew')
    ttk.Button(target, text='选择目录', image=ui.icons['folder'], compound='left', command=ui.choose_target).grid(row=0, column=1, padx=(10, 0))
    row = ttk.Frame(fields, style='Card.TFrame')
    row.grid(row=2, column=0, sticky='ew')
    row.columnconfigure(0, weight=3)
    row.columnconfigure(1, weight=2)
    organization = ttk.Frame(row, style='Card.TFrame')
    organization.grid(row=0, column=0, sticky='ew', padx=(0, 18))
    organization.columnconfigure(0, weight=1)
    ttk.Label(organization, text='使用单位').grid(row=0, column=0, sticky='w')
    ttk.Entry(organization, textvariable=ui.org_var).grid(row=1, column=0, sticky='ew', pady=(6, 0))
    duration = ttk.Frame(row, style='Card.TFrame')
    duration.grid(row=0, column=1, sticky='ew')
    duration.columnconfigure(0, weight=1)
    ttk.Label(duration, text='授权期限').grid(row=0, column=0, sticky='w')
    combo = ttk.Combobox(duration, textvariable=ui.duration_var, values=issuer.DURATIONS, state='readonly', width=16)
    combo.grid(row=1, column=0, sticky='ew', pady=(6, 0))
    combo.bind('<<ComboboxSelected>>', ui._toggle_custom)
    ui.custom_fields = ttk.Frame(fields, style='Card.TFrame')
    ui.custom_fields.grid(row=3, column=0, sticky='ew', pady=(14, 0))
    ui.custom_fields.columnconfigure(1, weight=1)
    ttk.Label(ui.custom_fields, text='到期日期').grid(row=0, column=0, padx=(0, 12))
    ui.custom_entry = ttk.Entry(ui.custom_fields, textvariable=ui.custom_var, state='disabled')
    ui.custom_entry.grid(row=0, column=1, sticky='ew')
    ttk.Label(ui.custom_fields, text='YYYY-MM-DD', style='Muted.TLabel').grid(row=0, column=2, padx=(10, 0))
    ui.custom_fields.grid_remove()

    device = card(page, 2, '授权设备', '绑定磁盘版仅为当前电脑签发。' if bound_mode else '本机签发无需填写机器码；远程签发使用对方导出的机器码。')
    mode = ttk.Frame(device, style='Card.TFrame')
    mode.grid(row=2, column=0, sticky='w')
    ui.local_mode_button = ttk.Button(mode, text='当前电脑', command=lambda: ui.set_signing_mode('local'))
    ui.local_mode_button.pack(side='left')
    ui.remote_mode_button = ttk.Button(mode, text='远程电脑', command=lambda: ui.set_signing_mode('remote'))
    if not bound_mode: ui.remote_mode_button.pack(side='left', padx=(8, 0))
    ui.remote_fields = ttk.Frame(device, style='Card.TFrame')
    ui.remote_fields.grid(row=3, column=0, sticky='ew', pady=(12, 0))
    ui.remote_fields.columnconfigure(0, weight=1)
    ttk.Label(ui.remote_fields, text='对方机器码（64位）').grid(row=0, column=0, sticky='w')
    ttk.Entry(ui.remote_fields, textvariable=ui.remote_var, font=('Consolas', 10)).grid(row=1, column=0, sticky='ew', pady=(6, 0))
    ui.remote_fields.grid_remove()
    ui.notes_toggle = ttk.Button(mode, text='添加备注', command=ui.toggle_notes)
    ui.notes_toggle.pack(side='left', padx=(18, 0))
    ui.notes_frame = card(page, 3, '备注（可选）')
    ui.notes = tk.Text(ui.notes_frame, height=2, wrap='word', bg=theme.CONTROL, fg=theme.TEXT, insertbackground=theme.TEXT, selectbackground='#35527a', relief='flat', highlightthickness=1, highlightbackground=theme.BORDER, highlightcolor=theme.ACCENT, padx=10, pady=8, font=('Microsoft YaHei UI', 10))
    ui.notes.grid(row=2, column=0, sticky='ew', pady=(8, 0))
    ui.notes_frame.master.grid_remove()

    devices = card(ui.pages['devices'], 0, '当前电脑', '复制设备信息，或导出后交给授权签发人员。')
    for row, label, var in [(2, '设备码', ui.device_var), (4, '机器码', ui.hash_var)]:
        ttk.Label(devices, text=label, style='Muted.TLabel').grid(row=row, column=0, sticky='w', pady=(0, 6))
        field = ttk.Frame(devices, style='Card.TFrame')
        field.grid(row=row+1, column=0, sticky='ew', pady=(0, 18))
        field.columnconfigure(0, weight=1)
        ttk.Entry(field, textvariable=var, state='readonly', font=('Consolas', 10)).grid(row=0, column=0, sticky='ew')
        ttk.Button(field, text='复制', image=ui.icons['copy'], compound='left', command=lambda var=var: ui._copy(var.get())).grid(row=0, column=1, padx=(10, 0))
    ttk.Button(devices, text='导出设备信息', image=ui.icons['export'], compound='left', command=ui.export_device_info).grid(row=6, column=0, sticky='w')

    keys = card(ui.pages['keys'], 0, '签发密钥', '首次使用先初始化密钥；已有密钥可继续使用。')
    ttk.Label(keys, textvariable=ui.key_status, style='KeyStatus.TLabel').grid(row=2, column=0, sticky='w', pady=(0, 12))
    key_target = ttk.Frame(keys, style='Card.TFrame')
    key_target.grid(row=3, column=0, sticky='ew', pady=(0, 12))
    key_target.columnconfigure(0, weight=1)
    ttk.Label(key_target, text='公钥导出目录').grid(row=0, column=0, sticky='w', pady=(0, 6))
    ttk.Entry(key_target, textvariable=ui.target_var).grid(row=1, column=0, sticky='ew')
    ttk.Button(key_target, text='选择目录', command=ui.choose_target).grid(row=1, column=1, padx=(10, 0))
    actions = ttk.Frame(keys, style='Card.TFrame')
    actions.grid(row=4, column=0, sticky='w')
    ttk.Button(actions, text='初始化密钥', image=ui.icons['key'], compound='left', style='Primary.TButton', command=ui.initialize).pack(side='left')
    ttk.Button(actions, text='修改私钥密码', image=ui.icons['lock'], compound='left', command=ui.change_password).pack(side='left', padx=(10, 0))
    details = card(ui.pages['keys'], 1, '密钥保存位置', '加密私钥保留在签发端，公钥与授权文件交给系统使用。')
    try: home = str(issuer.issuer_home())
    except ValueError: home = '密钥目录配置无效，请检查环境配置。'
    ttk.Label(details, text=home, style='Muted.TLabel', wraplength=530).grid(row=2, column=0, sticky='w')
    if bound_mode:
        ttk.Label(details, text='初始化会绑定工具所在磁盘。', style='Muted.TLabel').grid(row=3, column=0, sticky='w', pady=(12, 0))

    footer = ttk.Frame(main, padding=(0, 16, 0, 0))
    footer.grid(row=2, column=0, columnspan=2, sticky='ew')
    footer.columnconfigure(0, weight=1)
    ttk.Label(footer, textvariable=ui.feedback_var, style='ShellMuted.TLabel', wraplength=410).grid(row=0, column=0, sticky='w')
    ui.issue_button = ttk.Button(footer, text='签发并保存', image=ui.icons['shield'], compound='left', style='Primary.TButton', command=ui.issue)
    ui.issue_button.grid(row=0, column=1, sticky='e')
    ui.expiry_label = ttk.Label(footer, textvariable=ui.expiry_summary, style='ShellMuted.TLabel')
    ui.expiry_label.grid(row=1, column=0, sticky='w', pady=(7, 0))
    ui.refresh_setup_status()
    ui.set_signing_mode('local')
    ui.custom_var.trace_add('write', lambda *_args: ui._toggle_custom())
    ui._toggle_custom()
    ui.switch_page('issue')
