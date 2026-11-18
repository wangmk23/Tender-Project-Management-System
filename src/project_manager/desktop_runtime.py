"""Pure-source desktop lifecycle; importing this module never opens a window."""
from __future__ import annotations
import argparse
import hashlib
import os
from pathlib import Path
import sys
import threading
from werkzeug.serving import make_server
from src.backend_patches import desktop_host_service as host
from src.project_manager.source_scheduler import SourceScheduler


def mutex_name(data_dir):
    digest = hashlib.sha256(str(Path(data_dir).resolve()).casefold().encode()).hexdigest()[:24]
    return 'Local\\ProjectManager_Source_' + digest


class DialogBridge:
    def __init__(self, window, webview):
        self.window, self.webview = window, webview

    def select_directory(self):
        result = self.window.create_file_dialog(self.webview.FOLDER_DIALOG)
        return result[0] if result else None

    def select_backup_file(self):
        result = self.window.create_file_dialog(self.webview.OPEN_DIALOG, allow_multiple=False,
                                              file_types=('Backup files (*.zip;*.db)', 'All files (*.*)'))
        return result[0] if result else None


def run(app_factory, argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--data-dir', type=Path, default=None)
    parser.add_argument('--port', type=int, default=int(os.environ.get('PROJECT_MGR_PORT', '5001')))
    parser.add_argument('--lan', action='store_true', help='Listen on all network interfaces')
    parser.add_argument('--startup-minimized', action='store_true')
    args = parser.parse_args(argv)
    if not 0 <= args.port <= 65535:
        parser.error('port must be between 0 and 65535')
    data_dir = args.data_dir or (Path(sys.executable).parent / 'data' if getattr(sys, 'frozen', False)
                                 else Path(__file__).resolve().parents[2] / 'data')
    acquired = False
    server = thread = tray = scheduler = None
    try:
        acquired = host._acquire_single_instance(mutex_name=mutex_name(data_dir))
        if not acquired:
            return 1
        app = app_factory(data_dir=data_dir)
        app.config['IS_DESKTOP'] = not args.headless
        server = make_server('0.0.0.0' if args.lan else '127.0.0.1', args.port, app, threaded=True)
        port = server.server_port
        url = f'http://127.0.0.1:{port}'
        app.config.update(LAN_PORT=str(port), LAN_IP=host._get_lan_ip() if args.lan else '', LAN_URL='')
        if args.lan:
            app.config['LAN_URL'] = f"http://{app.config['LAN_IP']}:{port}"
        scheduler = SourceScheduler(app)
        scheduler.start()
        if args.headless:
            server.serve_forever()
            return 0
        import webview
        import pystray
        resources = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
        icon_path = resources / 'static' / 'app-icon.ico'
        window = webview.create_window('项目管理系统', url, width=1280, height=820, min_size=(1024, 680),
                                       background_color='#f6f8fb', hidden=args.startup_minimized)
        bridge = DialogBridge(window, webview)
        app.extensions['desktop_dialogs'] = bridge
        app.extensions['desktop_bridge'] = {'choose_folder':bridge.select_directory, 'open_folder':lambda path: os.startfile(path, 'explore')}
        exiting = threading.Event()

        def show(icon=None, item=None):
            window.show()
            window.restore()

        def quit_app(icon=None, item=None):
            exiting.set()
            window.destroy()

        def closing():
            if not exiting.is_set() and tray is not None:
                window.hide()
                return False
            return True

        window.events.closing += closing
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        lan_url = app.config['LAN_URL']
        tray = pystray.Icon(host.APP_NAME, host._load_tray_image(icon_path), host.APP_NAME,
                            pystray.Menu(
                                pystray.MenuItem('打开系统', show, default=True),
                                pystray.MenuItem('局域网：' + (lan_url or '未启用'), None, enabled=False),
                                pystray.MenuItem('复制局域网地址', host._copy_lan_url(lan_url), enabled=bool(lan_url)),
                                pystray.MenuItem('打开数据目录', lambda: os.startfile(str(data_dir.resolve()))),
                                pystray.MenuItem('退出', quit_app)))
        tray.run_detached()
        webview.settings['ALLOW_DOWNLOADS'] = True
        webview.start(icon=str(icon_path), private_mode=False)
        return 0
    except KeyboardInterrupt:
        return 0
    finally:
        try:
            if tray is not None:
                tray.stop()
        finally:
            try:
                if server is not None:
                    try:
                        if thread is not None and thread.ident is not None:
                            server.shutdown()
                            thread.join(timeout=5)
                    finally:
                        server.server_close()
            finally:
                try:
                    if scheduler is not None:
                        scheduler.stop()
                finally:
                    if acquired:
                        host._release_single_instance()
