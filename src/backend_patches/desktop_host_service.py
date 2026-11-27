"""Open-source desktop host service (single-instance mutex, port discovery, LAN info, tray, and WSGI server thread).

desktop-host-service-v1
"""
from __future__ import annotations

import ctypes
import os
from pathlib import Path
import socket
import threading
import time
from typing import Any
from werkzeug.serving import make_server


DESKTOP_HOST_SERVICE_SIGNATURE = "desktop-host-service-v1"
APP_NAME = "项目管理系统"
SERVER_HOST = "0.0.0.0"
LOCAL_HOST = "127.0.0.1"
DEFAULT_PORT = 5001
_INSTANCE_MUTEX_NAME = "Local\\HD_ProjectManagementSystem_Desktop_SingleInstance"

_INSTANCE_MUTEX: Any = None
_SHOULD_EXIT: bool = False
_TRAY_READY: bool = False
_TRAY_ICON: Any = None
_FLASK_THREAD: Any = None
_WINDOW: Any = None


def _acquire_single_instance(
    *,
    mutex_name: str = _INSTANCE_MUTEX_NAME,
    app_name: str = APP_NAME,
) -> bool:
    """Allow only one desktop host process on Windows."""
    global _INSTANCE_MUTEX
    if os.name != "nt":
        return True
    kernel32 = ctypes.windll.kernel32
    kernel32.CreateMutexW.restype = ctypes.c_void_p
    handle = kernel32.CreateMutexW(None, False, mutex_name)
    if not handle:
        return False
    if kernel32.GetLastError() == 183:
        kernel32.CloseHandle(ctypes.c_void_p(handle))
        message_box_timeout = getattr(ctypes.windll.user32, "MessageBoxTimeoutW", None)
        if message_box_timeout:
            message_box_timeout(
                None,
                "项目管理系统已经在运行。\n\n请从右下角任务栏托盘打开现有窗口。",
                app_name,
                64,
                0,
                2000,
            )
            return False
        ctypes.windll.user32.MessageBeep(64)
        return False
    _INSTANCE_MUTEX = handle
    return True


def _release_single_instance() -> None:
    global _INSTANCE_MUTEX
    if os.name == "nt" and _INSTANCE_MUTEX:
        ctypes.windll.kernel32.ReleaseMutex(ctypes.c_void_p(_INSTANCE_MUTEX))
        ctypes.windll.kernel32.CloseHandle(ctypes.c_void_p(_INSTANCE_MUTEX))
        _INSTANCE_MUTEX = None


def _log(message: str, *, server_app: Any = None) -> None:
    try:
        if server_app is None:
            import app as server_app  # type: ignore[no-redef]
        log_dir = Path(server_app.DATA_DIR) / "logs"
        log_dir.mkdir(exist_ok=True)
        with (log_dir / "desktop_tray.log").open("a", encoding="utf-8") as f:
            f.write(f"{time.strftime('%Y-%m-%d %H:%M:%S')} {message}\n")
    except Exception:
        return None


def _find_port(
    *,
    server_host: str = SERVER_HOST,
    default_port: int = DEFAULT_PORT,
    log_fn: Any = None,
) -> int:
    logger = log_fn or _log
    configured = os.environ.get("PROJECT_MGR_PORT")
    if configured:
        try:
            port = int(configured)
            if 1 <= port <= 65535:
                return port
        except (TypeError, ValueError):
            logger(f"Invalid PROJECT_MGR_PORT ignored: {configured}")

    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind((server_host, default_port))
            return default_port
        except OSError:
            s.bind((server_host, 0))
            return int(s.getsockname()[1])


def _get_lan_ip(*, local_host: str = LOCAL_HOST) -> str:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            return str(s.getsockname()[0])
    except OSError:
        try:
            return str(socket.gethostbyname(socket.gethostname()))
        except OSError:
            return local_host


def _write_lan_info(
    port: int,
    *,
    server_app: Any = None,
    local_host: str = LOCAL_HOST,
    lan_ip_fn: Any = None,
) -> tuple[str, str, Path]:
    if server_app is None:
        import app as server_app  # type: ignore[no-redef]
    lan_ip = (lan_ip_fn or _get_lan_ip)()
    local_url = f"http://{local_host}:{port}"
    lan_url = f"http://{lan_ip}:{port}"
    server_app.app.config["IS_DESKTOP"] = True
    server_app.app.config["LAN_IP"] = lan_ip
    server_app.app.config["LAN_PORT"] = str(port)
    server_app.app.config["LAN_URL"] = lan_url
    info_path = Path(server_app.DATA_DIR) / "局域网访问地址.txt"
    info_path.write_text(
        "\n".join(
            [
                "项目管理系统 局域网访问地址",
                "",
                f"本机桌面访问：{local_url}",
                f"局域网访问：{lan_url}",
                "",
                "使用方法：把本程序所在电脑作为主机保持开机，并保持桌面版运行。",
                "同一局域网内其他电脑打开“局域网访问”地址即可。",
                "点击窗口 X 会隐藏到托盘，请在托盘菜单选择“退出”才会关闭服务。",
            ]
        ),
        encoding="utf-8",
    )
    return local_url, lan_url, info_path


def _load_tray_image(icon_path: Path, *, image_mod: Any = None, log_fn: Any = None):
    logger = log_fn or _log
    if image_mod is None:
        from PIL import Image as image_mod  # type: ignore[no-redef]
    try:
        if Path(icon_path).exists():
            return image_mod.open(icon_path)
    except Exception as exc:
        logger(f"Load tray image failed: {exc}")
    img = image_mod.new("RGBA", (64, 64), (37, 99, 235, 255))
    return img


def _show_window(icon: Any = None, item: Any = None, *, window: Any = None, log_fn: Any = None) -> None:
    target = window if window is not None else _WINDOW
    if not target:
        return None
    try:
        target.show()
        target.restore()
    except Exception as exc:
        (log_fn or _log)(f"Show window failed: {exc}")


def _open_data_dir(icon: Any = None, item: Any = None, *, server_app: Any = None, log_fn: Any = None) -> None:
    try:
        if server_app is None:
            import app as server_app  # type: ignore[no-redef]
        os.startfile(str(server_app.DATA_DIR))
    except Exception as exc:
        (log_fn or _log)(f"Open data dir failed: {exc}")


def _copy_lan_url(lan_url: str, *, log_fn: Any = None):
    logger = log_fn or _log

    def do_copy(icon: Any = None, item: Any = None) -> None:
        try:
            import tkinter as tk

            root = tk.Tk()
            root.withdraw()
            root.clipboard_clear()
            root.clipboard_append(lan_url)
            root.update()
            root.destroy()
        except Exception as exc:
            logger(f"Copy LAN URL failed: {exc}")

    return do_copy


def _exit_app(
    icon: Any = None,
    item: Any = None,
    *,
    tray_icon: Any = None,
    flask_thread: Any = None,
    window: Any = None,
    log_fn: Any = None,
) -> None:
    global _SHOULD_EXIT
    _SHOULD_EXIT = True
    logger = log_fn or _log
    logger("Exit requested from tray")
    t_icon = tray_icon if tray_icon is not None else _TRAY_ICON
    try:
        if t_icon:
            t_icon.stop()
    except Exception as exc:
        logger(f"Tray stop failed: {exc}")
    f_thread = flask_thread if flask_thread is not None else _FLASK_THREAD
    w_obj = window if window is not None else _WINDOW
    try:
        if f_thread:
            f_thread.shutdown()
    finally:
        if w_obj:
            w_obj.destroy()


def _setup_tray(
    icon_path: Path,
    lan_url: str,
    *,
    pystray_mod: Any = None,
    image_loader: Any = None,
    log_fn: Any = None,
):
    global _TRAY_ICON, _TRAY_READY
    if pystray_mod is None:
        import pystray as pystray_mod  # type: ignore[no-redef]
    loader = image_loader or _load_tray_image
    logger = log_fn or _log
    image = loader(icon_path)
    menu = pystray_mod.Menu(
        pystray_mod.MenuItem("打开系统", _show_window, default=True),
        pystray_mod.MenuItem(f"局域网：{lan_url}", None, enabled=False),
        pystray_mod.MenuItem("复制局域网地址", _copy_lan_url(lan_url)),
        pystray_mod.MenuItem("打开数据目录", _open_data_dir),
        pystray_mod.MenuItem("退出", _exit_app),
    )
    _TRAY_ICON = pystray_mod.Icon(APP_NAME, image, APP_NAME, menu)
    _TRAY_ICON.run_detached()


def notify_desktop(
    title: str,
    message: str,
    *,
    tray_icon: Any = None,
    log_fn: Any = None,
) -> bool:
    """Show a native Windows system-tray balloon/toast notification via pystray."""
    icon = tray_icon if tray_icon is not None else _TRAY_ICON
    if icon is None or not callable(getattr(icon, "notify", None)):
        return False
    safe_title = str(title or APP_NAME).strip()[:64]
    safe_message = str(message or "").strip()[:240]
    if not safe_message:
        return False
    try:
        icon.notify(safe_message, safe_title)
        return True
    except Exception as exc:
        (log_fn or _log)(f"Desktop tray notify failed: {exc}")
        return False
    _TRAY_READY = True
    logger("pystray tray started")
    return _TRAY_ICON


class FlaskThread(threading.Thread):
    def __init__(self, port: int, *, server_app: Any = None, server_host: str = SERVER_HOST) -> None:
        super().__init__(daemon=True)
        if server_app is None:
            import app as server_app  # type: ignore[no-redef]
        self.port = port
        self.httpd = make_server(server_host, port, server_app.app, threaded=True)

    def run(self) -> None:
        self.httpd.serve_forever()

    def shutdown(self) -> None:
        self.httpd.shutdown()
