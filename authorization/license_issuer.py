# -*- coding: utf-8 -*-
"""Public Ed25519 license issuer. Initialize your own encrypted keys before signing.
The bound entry checks its explicitly configured program volume at startup and issue.
"""

from __future__ import annotations

import argparse
import base64
import csv
import ctypes
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import uuid
from datetime import date, datetime, timedelta
from pathlib import Path

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

PRODUCT_ID = "procurement-project-manager"
LICENSE_FILENAME = "license.dat"
STATE_FILENAME = ".license_state.bin"
APP_TITLE = "项目管理系统授权工具 · 自由运用版"
APP_VERSION = "1.5-free"

DURATIONS = ("7天", "30天", "90天", "365天", "永久", "自定义日期")


# --------------------------------------------------------------------------- #
# 机器指纹
# --------------------------------------------------------------------------- #
def _machine_guid() -> str:
    if os.name != "nt":
        return platform.node()
    import winreg

    flags = winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0)
    try:
        with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Cryptography", 0, flags) as key:
            value, _ = winreg.QueryValueEx(key, "MachineGuid")
        return str(value).strip()
    except OSError:
        return platform.node()


def _system_uuid() -> str:
    if os.name != "nt":
        return "non-windows"
    command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command",
               "(Get-CimInstance Win32_ComputerSystemProduct).UUID"]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, encoding="utf-8", errors="ignore",
            timeout=8, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        return (result.stdout or "").strip()
    except Exception:
        return "unknown-system-uuid"


def get_volume_serial(root: str = None) -> str:
    """返回驱动器卷序列号（8 位十六进制）。root 传 'E:\\' 或 'E:' 均可。"""
    if os.name != "nt":
        return "non-windows"
    drive = root or os.environ.get("SystemDrive", "C:")
    if not str(drive).endswith("\\"):
        drive = str(drive).rstrip(":") + ":\\"
    try:
        volume_name = ctypes.create_unicode_buffer(261)
        fs_name = ctypes.create_unicode_buffer(261)
        serial = ctypes.c_uint(0)
        ok = ctypes.windll.kernel32.GetVolumeInformationW(
            drive, volume_name, 261, ctypes.byref(serial), None, None, fs_name, 261
        )
        if not ok:
            return "unknown-volume"
        return "%08X" % serial.value
    except Exception:
        return "unknown-volume"


def machine_fingerprint() -> dict:
    components = {
        "system_uuid": _system_uuid().upper(),
        "machine_guid": _machine_guid().upper(),
        "system_volume": get_volume_serial().upper(),
    }
    canonical = "|".join(components[key] for key in sorted(components))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    device_code = "PM-" + "-".join(digest[i:i + 4].upper() for i in range(0, 20, 4))
    return {"machine_hash": digest, "device_code": device_code, "components": components}


def device_code_from_hash(machine_hash: str) -> str:
    return "PM-" + "-".join(machine_hash[i:i + 4].upper() for i in range(0, 20, 4))


def canonical_payload(payload: dict) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


# --------------------------------------------------------------------------- #
# 程序目录 / 私钥 / 记录
# --------------------------------------------------------------------------- #
def program_dir() -> Path:
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent


def issuer_home() -> Path:
    override = os.environ.get("PROCUREMENT_ISSUER_HOME")
    base = Path(override).expanduser() if override else Path(
        os.environ.get("LOCALAPPDATA", str(Path.home() / ".local" / "share"))) / "ProcurementProjectManager" / "issuer"
    base = base.resolve()
    source_root = Path(__file__).resolve().parent.parent
    in_source = not getattr(sys, 'frozen', False) and (base == source_root or source_root in base.parents)
    if in_source or any((p / ".git").exists() for p in (base, *base.parents)):
        raise ValueError("私钥目录必须在源码和 Git 仓库之外，请设置 PROCUREMENT_ISSUER_HOME。")
    return base


def private_key_path() -> Path:
    return issuer_home() / "license_private_key.pem"


def public_key_path() -> Path:
    return issuer_home() / "license_public_key.pem"


def bound_config_path() -> Path:
    return program_dir() / "issuer-config.json"


def valid_serial(serial: str) -> bool:
    return isinstance(serial, str) and bool(re.fullmatch(r"[0-9A-Fa-f]{8}", serial)) and serial != "00000000"


def verify_bound_disk() -> bool:
    try:
        config = json.loads(bound_config_path().read_text("utf-8"))
        expected = config.get("volume_serial")
        current = get_volume_serial(program_dir().anchor)
        return (config.get("version") == 1 and config.get("product") == PRODUCT_ID
                and valid_serial(expected) and valid_serial(current)
                and expected.upper() == current.upper())
    except (OSError, ValueError, AttributeError, TypeError):
        return False


def require_bound_disk() -> None:
    if not verify_bound_disk():
        raise PermissionError("授权磁盘验证未通过；首次使用请在指定磁盘初始化，已有配置请勿覆盖。")


def export_public_key(pem: bytes, target: Path) -> Path:
    target = Path(target)
    output = target / "license_public_key.pem"
    if output.exists():
        if output.read_bytes() != pem:
            raise ValueError("目标已有不同公钥，请使用匹配的签发密钥。")
        return output
    target.mkdir(parents=True, exist_ok=True)
    with output.open("xb") as handle:
        handle.write(pem)
    return output


def initialize_keys(password: str, target_dir, *, bound_mode: bool = False) -> Path:
    if len(password) < 10:
        raise ValueError("私钥密码至少10位。")
    home = issuer_home()
    config_path = bound_config_path()
    if bound_mode and config_path.exists():
        raise FileExistsError("磁盘配置已存在；不会自动覆盖或重新绑定。")
    serial = get_volume_serial(program_dir().anchor) if bound_mode else None
    if bound_mode and not valid_serial(serial):
        raise PermissionError("无法识别当前磁盘序列号，不能初始化绑定版。")
    target = Path(target_dir)
    if private_key_path().exists() or public_key_path().exists():
        if not bound_mode or not private_key_path().is_file() or not public_key_path().is_file():
            raise FileExistsError("密钥已存在或初始化不完整；不会覆盖现有密钥。")
        # Explicit bound setup may reuse a complete pair after password validation.
        key = load_private_key(password)
        pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
        output = export_public_key(pem, target)
        with config_path.open("x", encoding="utf-8") as handle:
            json.dump({"version": 1, "product": PRODUCT_ID, "volume_serial": serial.upper()}, handle, indent=2)
        return output
    if (target / "license_public_key.pem").exists():
        raise FileExistsError("目标已有公钥；初始化不会覆盖。")
    key = Ed25519PrivateKey.generate()
    private_pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                    serialization.BestAvailableEncryption(password.encode("utf-8")))
    public_pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    home.mkdir(parents=True, exist_ok=True)
    with private_key_path().open("xb") as handle:
        handle.write(private_pem)
    try:
        private_key_path().chmod(0o600)
    except OSError:
        pass
    with public_key_path().open("xb") as handle:
        handle.write(public_pem)
    if bound_mode:
        with config_path.open("x", encoding="utf-8") as handle:
            json.dump({"version": 1, "product": PRODUCT_ID, "volume_serial": serial.upper()}, handle, indent=2)
    return export_public_key(public_pem, target)


def load_private_key(password: str):
    path = private_key_path()
    if not path.exists():
        raise FileNotFoundError("尚未初始化密钥，请先点击初始化密钥。")
    key = serialization.load_pem_private_key(path.read_bytes(), password=password.encode("utf-8"))
    if not isinstance(key, Ed25519PrivateKey):
        raise ValueError("必须使用 Ed25519 签发密钥。")
    pem = key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    if not public_key_path().exists() or public_key_path().read_bytes() != pem:
        raise ValueError("签发密钥不完整或公私钥不匹配。")
    return key


def append_record(payload: dict, target, organization: str) -> None:
    path = issuer_home() / "授权记录.csv"
    exists = path.exists()
    with path.open("a", newline="", encoding="utf-8-sig") as handle:
        writer = csv.writer(handle)
        if not exists:
            writer.writerow(("授权编号", "单位", "设备码", "签发时间", "到期日期", "目标目录"))
        writer.writerow((
            payload.get("license_id", ""),
            organization,
            payload.get("device_code", ""),
            payload.get("issued_at", ""),
            payload.get("expires_at") or "永久",
            str(target),
        ))


# --------------------------------------------------------------------------- #
# 签发核心
# --------------------------------------------------------------------------- #
def build_payload(*, organization: str, machine_hash: str, device_code: str,
                  expires: date | None, notes: str = "") -> dict:
    now = datetime.now().replace(microsecond=0)
    return {
        "license_id": "PM-" + now.strftime("%Y%m%d") + "-" + uuid.uuid4().hex[:8].upper(),
        "product": PRODUCT_ID,
        "organization": organization,
        "machine_hash": machine_hash,
        "device_code": device_code,
        "issued_at": now.isoformat(),
        "not_before": date.today().isoformat(),
        "expires_at": expires.isoformat() if expires else None,
        "notes": notes.strip(),
    }


def sign_payload(payload: dict, private_key) -> dict:
    signature = private_key.sign(canonical_payload(payload))
    return {"payload": payload, "signature": base64.b64encode(signature).decode("ascii")}


def write_license(document: dict, target: Path) -> Path:
    """原子写入 license.dat，并清除旧的 .license_state.bin 以强制重新校验。"""
    target = Path(target)
    target.mkdir(parents=True, exist_ok=True)
    output = target / LICENSE_FILENAME
    temporary = target / (LICENSE_FILENAME + ".tmp")
    data = json.dumps(document, ensure_ascii=False, indent=2)
    temporary.write_text(data, encoding="utf-8")
    os.replace(temporary, output)
    state_file = target / STATE_FILENAME
    if state_file.exists():
        try:
            state_file.unlink()
        except OSError:
            pass
    return output


def self_check(document: dict, public_key_pem: bytes | None = None) -> tuple[bool, str]:
    """Verify the signature against the configured issuer public key."""
    try:
        public_key = serialization.load_pem_public_key(public_key_pem or public_key_path().read_bytes())
        public_key.verify(
            base64.b64decode(document["signature"], validate=True),
            canonical_payload(document["payload"]),
        )
    except Exception as error:  # noqa: BLE001
        return False, f"签名自检失败：{error}"
    payload = document["payload"]
    if payload.get("product") != PRODUCT_ID:
        return False, "产品标识不匹配"
    return True, "签名自检通过"


def issue(*, target_dir, organization: str, expires: date | None, password: str,
          machine_hash: str | None = None, notes: str = "", bound_mode: bool = False) -> tuple[dict, Path]:
    if bound_mode:
        require_bound_disk()
        if machine_hash:
            raise ValueError("绑定磁盘版仅为当前电脑签发。")
    if not organization.strip():
        raise ValueError("使用单位不能为空。")
    if expires is not None and expires < date.today():
        raise ValueError("到期日期不能早于今天。")
    if machine_hash and not re.fullmatch(r"[0-9a-fA-F]{64}", machine_hash.strip()):
        raise ValueError("机器码必须是64位十六进制。")
    local = machine_fingerprint()
    if machine_hash:
        machine_hash = machine_hash.strip().lower()
        device_code = device_code_from_hash(machine_hash)
    else:
        machine_hash = local["machine_hash"]
        device_code = local["device_code"]
    payload = build_payload(organization=organization, machine_hash=machine_hash,
                            device_code=device_code, expires=expires, notes=notes)
    private_key = load_private_key(password)
    document = sign_payload(payload, private_key)
    pem = private_key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)
    ok, message = self_check(document, pem)
    if not ok:
        raise ValueError(message)
    if bound_mode:
        require_bound_disk()
    export_public_key(pem, Path(target_dir))
    output = write_license(document, Path(target_dir))
    append_record(payload, target_dir, organization)
    return document, output


# --------------------------------------------------------------------------- #
# 图形界面
# --------------------------------------------------------------------------- #
def create_window(root, fingerprint, *, bound_mode=False):
    import tkinter as tk
    from tkinter import filedialog, messagebox, simpledialog, ttk

    class IssuerTool:
        def __init__(self, root: "tk.Tk") -> None:
            self.root = root
            self.fingerprint = fingerprint
            root.title(APP_TITLE)
            icon = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parents[1] / 'src' / 'assets')) / 'app-icon-transparent.ico'
            if icon.is_file():
                try:
                    root.iconbitmap(str(icon))
                except tk.TclError:
                    pass
            root.geometry("960x720")
            root.minsize(800, 560)
            root.resizable(True, True)
            root.configure(bg="#101725")
            self._build_ui()

        # ---------- 界面 ----------
        def _build_ui(self) -> None:
            from license_layout import build
            build(self, bound_mode=bound_mode)

        def switch_page(self, name):
            titles={'issue':('签发授权','为当前电脑或指定设备签发授权文件。'),
                    'devices':('设备信息','查看当前电脑的设备信息。'),
                    'keys':('密钥管理','初始化签发密钥，维护私钥密码。')}
            if name not in titles:
                return
            self.active_page=name
            for key,page in self.pages.items():
                if key==name:page.grid(row=0,column=0,sticky='ew')
                else:page.grid_remove()
                self.nav_buttons[key].configure(style='NavActive.TButton' if key==name else 'Nav.TButton')
            self.page_title.set(titles[name][0])
            self.page_description.set(titles[name][1])
            if name=='issue':
                self.issue_button.grid()
                self.expiry_label.grid()
            else:
                self.issue_button.grid_remove()
                self.expiry_label.grid_remove()
            self.feedback_var.set('')
            self.content_canvas.yview_moveto(0)

        def toggle_notes(self):
            card = self.notes_frame.master
            expanded = bool(card.winfo_manager())
            if expanded:
                card.grid_remove()
            else:
                card.grid()
            self.notes_toggle.configure(text='添加备注' if expanded else '收起备注')

        def set_signing_mode(self, mode):
            if bound_mode:mode='local'
            self.target_mode.set(mode)
            if mode=='remote':self.remote_fields.grid()
            else:
                self.remote_var.set('')
                self.remote_fields.grid_remove()
            self.local_mode_button.configure(style='ModeActive.TButton' if mode=='local' else 'Mode.TButton')
            self.remote_mode_button.configure(style='ModeActive.TButton' if mode=='remote' else 'Mode.TButton')

        # ---------- 动作 ----------
        def refresh_setup_status(self):
            try:
                ready=private_key_path().is_file() and public_key_path().is_file() and (not bound_mode or verify_bound_disk())
            except (ValueError,OSError):
                ready=False
            self.setup_status.set('签发密钥已就绪。' if ready else '首次使用：请先进入密钥管理完成初始化。')
            self.key_status.set('密钥已就绪' if ready else '尚未完成密钥初始化')

        def _copy(self, value: str) -> None:
            self.root.clipboard_clear()
            self.root.clipboard_append(value)
            self.feedback_var.set('已复制到剪贴板。')

        def _toggle_custom(self, _event=None) -> None:
            custom=self.duration_var.get()=='自定义日期'
            self.custom_entry.configure(state='normal' if custom else 'disabled')
            if custom:self.custom_fields.grid()
            else:self.custom_fields.grid_remove()
            try:
                expires=self._expiry()
                self.expiry_summary.set('到期日：'+(str(expires) if expires else '永久'))
            except ValueError:
                self.expiry_summary.set('填写有效的到期日期。')

        def choose_target(self) -> None:
            chosen = filedialog.askdirectory(title="选择项目管理系统解压后的文件夹")
            if chosen:
                self.target_var.set(chosen)

        def _expiry(self):
            value = self.duration_var.get()
            if value == "永久":
                return None
            if value == "自定义日期":
                expiry = date.fromisoformat(self.custom_var.get().strip())
                if expiry < date.today():
                    raise ValueError("到期日期不能早于今天")
                return expiry
            days = int(value.replace("天", ""))
            return date.today() + timedelta(days=days)

        def export_device_info(self) -> None:
            chosen = filedialog.asksaveasfilename(
                title="导出本机设备信息", defaultextension=".txt",
                initialfile="本机设备信息.txt", filetypes=[("文本文件", "*.txt")])
            if not chosen:
                return
            fp = self.fingerprint
            lines = [
                f"设备码：{fp['device_code']}",
                f"机器码：{fp['machine_hash']}",
                "",
                "说明：把本文件发给授权管理员即可远程签发；本文件不含私钥，无法用于签发。",
            ]
            try:
                Path(chosen).write_text("\n".join(lines), encoding="utf-8")
            except OSError as error:
                messagebox.showerror("导出失败", f"无法保存设备信息：{error}", parent=self.root)
                return
            messagebox.showinfo("已导出", f"已保存到：\n{chosen}")

        def issue(self) -> None:
            target_text = self.target_var.get().strip().strip('"')
            target = Path(target_text)
            if not target_text or not target.exists() or not target.is_dir():
                messagebox.showwarning("目标无效", "请选择项目管理系统解压后的文件夹。")
                return
            if not (target / "bidding.db").exists() and not any(target.glob("*.exe")):
                messagebox.showwarning("目标无效", "该目录中未找到项目管理系统 EXE 和 bidding.db。")
                return
            organization = self.org_var.get().strip()
            if not organization:
                messagebox.showwarning("信息不完整", "请填写使用单位。")
                return
            try:
                expires = self._expiry()
            except ValueError as error:
                messagebox.showerror("日期无效", str(error))
                return

            remote = self.remote_var.get().strip()
            if remote and not re.fullmatch(r"[0-9a-fA-F]{64}", remote):
                messagebox.showwarning(
                    "机器码无效",
                    "远程机器码必须是 64 位十六进制（machine_hash）。\n"
                    "设备码无法直接签发——请让对方先「导出本机设备信息」。")
                return

            password = simpledialog.askstring("私钥密码", "请输入签发私钥密码：", show="*", parent=self.root)
            if not password:
                return
            try:
                document, output = issue(
                    target_dir=target, organization=organization, expires=expires,
                    password=password, machine_hash=remote or None,
                    notes=self.notes.get("1.0", "end"), bound_mode=bound_mode,
                )
            except FileNotFoundError as error:
                messagebox.showerror("授权失败", str(error))
                return
            except Exception as error:
                messagebox.showerror("授权失败", str(error))
                return

            message = "签名自检通过"
            payload = document["payload"]
            expiry_text = payload["expires_at"] or "永久"
            messagebox.showinfo(
                "授权成功",
                f"已授权：{organization}\n设备：{payload['device_code']}\n到期：{expiry_text}"
                f"\n\n{message}\n写入位置：{output}\n\n请返回项目管理系统激活页面刷新。",
            )

        def initialize(self) -> None:
            target_text = self.target_var.get().strip().strip('"')
            if not target_text or not Path(target_text).is_dir():
                messagebox.showwarning("请选择目录", "请选择已存在的目标系统目录。")
                return
            if bound_mode and not messagebox.askyesno("绑定当前磁盘", "初始化将绑定工具所在磁盘，并生成自己的加密密钥。是否继续？", parent=self.root):
                return
            password = simpledialog.askstring("初始化密钥", "设置私钥密码（至少10位）：", show="*", parent=self.root)
            if not password:
                return
            again = simpledialog.askstring("初始化密钥", "再次输入私钥密码：", show="*", parent=self.root)
            if password != again:
                messagebox.showerror("密码不一致", "两次密码不一致。")
                return
            try:
                output = initialize_keys(password, target_text, bound_mode=bound_mode)
            except Exception as error:
                messagebox.showerror("初始化失败", str(error))
                return
            self.refresh_setup_status()
            messagebox.showinfo("初始化成功", f"已生成加密密钥并导出公钥：{output}\n管理员密钥目录：{issuer_home()}")

        def change_password(self) -> None:
            current = simpledialog.askstring("修改密码", "请输入当前私钥密码：", show="*", parent=self.root)
            if not current:
                return
            try:
                key = load_private_key(current)
            except Exception:  # noqa: BLE001
                messagebox.showerror("修改失败", "当前密码错误。")
                return
            new = simpledialog.askstring("修改密码", "请输入新密码（至少10位）：", show="*", parent=self.root)
            if not new:
                return
            if len(new) < 10:
                messagebox.showwarning("密码过短", "新密码至少10位。")
                return
            again = simpledialog.askstring("修改密码", "请再次输入新密码：", show="*", parent=self.root)
            if again != new:
                messagebox.showwarning("密码不一致", "两次输入的新密码不一致。")
                return
            data = key.private_bytes(
                serialization.Encoding.PEM,
                serialization.PrivateFormat.PKCS8,
                serialization.BestAvailableEncryption(new.encode("utf-8")),
            )
            private_key_path().write_bytes(data)
            messagebox.showinfo("修改成功", "私钥密码已更新，请妥善保管。")

    return IssuerTool(root)


def run_gui(*, bound_mode=False) -> int:
    import tkinter as tk
    root = tk.Tk()
    create_window(root, machine_fingerprint(), bound_mode=bound_mode)
    root.mainloop()
    return 0


# --------------------------------------------------------------------------- #
# 命令行
# --------------------------------------------------------------------------- #
def _attach_console() -> None:
    """打包为无控制台窗口时，若从命令行调用，则挂回父进程控制台以便输出可见。"""
    if os.name != "nt":
        return
    try:
        if sys.stdout is None or sys.stderr is None:
            if ctypes.windll.kernel32.AttachConsole(-1):
                if sys.stdout is None:
                    sys.stdout = open("CONOUT$", "w", encoding="utf-8", buffering=1)
                if sys.stderr is None:
                    sys.stderr = open("CONOUT$", "w", encoding="utf-8", buffering=1)
                if sys.stdin is None:
                    sys.stdin = open("CONIN$", "r", encoding="utf-8")
    except OSError:
        pass
    # A windowed executable may have no console even when invoked by automation.
    # File operations must still finish, without a fatal dialog caused by print(None).
    if sys.stdout is None or sys.stderr is None:
        import _winapi
        import msvcrt
        current = _winapi.GetCurrentProcess()
        for name, constant in [('stdout', -11), ('stderr', -12)]:
            if getattr(sys, name) is not None:
                continue
            try:
                handle = _winapi.GetStdHandle(constant)
                if handle in (None, 0, -1):
                    continue
                duplicate = _winapi.DuplicateHandle(current, handle, current, 0, False, _winapi.DUPLICATE_SAME_ACCESS)
                descriptor = msvcrt.open_osfhandle(duplicate, os.O_WRONLY | os.O_BINARY)
                setattr(sys, name, os.fdopen(descriptor, 'w', encoding='utf-8'))
            except OSError:
                pass
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")
    if sys.stdin is None:
        sys.stdin = open(os.devnull, "r", encoding="utf-8")


def cli(argv=None, *, bound_mode=False) -> int:
    if len(sys.argv) > 1:
        _attach_console()
    parser = argparse.ArgumentParser(description="项目管理系统授权签发工具")
    parser.add_argument("--fingerprint", action="store_true", help="打印本机设备码/机器码")
    parser.add_argument("--export-info", metavar="PATH", help="导出本机设备信息到指定文件")
    parser.add_argument("--self-test", action="store_true", help="只读诊断并输出 JSON，不读取私钥")
    parser.add_argument("--init", action="store_true", help="生成自己的加密密钥，绑定版明确绑定当前磁盘")
    parser.add_argument("--sign", action="store_true", help="免界面签发")
    parser.add_argument("--target", help="目标系统目录")
    parser.add_argument("--org", help="使用单位")
    parser.add_argument("--days", type=int, help="授权天数（与 --expires 二选一）")
    parser.add_argument("--expires", help="到期日 YYYY-MM-DD")
    parser.add_argument("--permanent", action="store_true", help="永久授权")
    parser.add_argument("--machine-hash", help="对方机器码（64位十六进制），留空为本机")
    parser.add_argument("--notes", default="", help="备注")
    parser.add_argument("--password", help="私钥密码")
    args = parser.parse_args(argv)

    if args.init:
        if not args.target:
            parser.error("--init 需要 --target 目标系统目录")
        password = args.password or os.environ.get("PROCUREMENT_ISSUER_PASSWORD")
        if password is None:
            import getpass
            password = getpass.getpass("设置私钥密码（至少10位）：")
            if password != getpass.getpass("再次输入密码："):
                parser.error("两次密码不一致")
        output = initialize_keys(password, args.target, bound_mode=bound_mode)
        print(f"已生成加密密钥；公钥导出到 {output}")
        return 0

    if bound_mode and not args.self_test:
        if bound_config_path().exists() or args.sign:
            require_bound_disk()

    if args.fingerprint or args.export_info:
        fp = machine_fingerprint()
        text = f"设备码：{fp['device_code']}\n机器码：{fp['machine_hash']}\n"
        if args.export_info:
            Path(args.export_info).write_text(text, encoding="utf-8")
            print(f"已导出到 {args.export_info}")
        print(text.rstrip())
        return 0

    if args.self_test:
        fp = machine_fingerprint()
        payload = build_payload(organization="自检", machine_hash=fp["machine_hash"],
                                device_code=fp["device_code"], expires=None)
        serial = get_volume_serial(program_dir().anchor)
        report = {
            "ok": verify_bound_disk() if bound_mode else private_key_path().is_file() and public_key_path().is_file(),
            "app_version": APP_VERSION,
            "private_key_exists": private_key_path().exists(),
            "current_volume_serial": serial,
            "device_code": fp["device_code"],
            "machine_hash": fp["machine_hash"],
            "license_id_sample": payload["license_id"],
            "tested_at": datetime.now().replace(microsecond=0).isoformat(),
        }
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ok"] else 2

    if args.sign:
        if not args.target or not args.org:
            parser.error("--sign 需要 --target 与 --org")
        if args.permanent:
            expires = None
        elif args.expires:
            expires = date.fromisoformat(args.expires)
        elif args.days:
            expires = date.today() + timedelta(days=args.days)
        else:
            parser.error("请指定 --permanent / --expires / --days 之一")
        password = args.password or os.environ.get("PROCUREMENT_ISSUER_PASSWORD")
        if password is None:
            import getpass
            password = getpass.getpass("请输入签发私钥密码：")
        document, output = issue(target_dir=args.target, organization=args.org, expires=expires,
                                 password=password, machine_hash=args.machine_hash, notes=args.notes, bound_mode=bound_mode)
        message = "签名自检通过"
        print(f"已写入 {output}")
        print(f"授权编号：{document['payload']['license_id']}")
        print(f"设备码　：{document['payload']['device_code']}")
        print(f"到期　　：{document['payload']['expires_at'] or '永久'}")
        print(f"自检　　：{message}")
        return 0

    return run_gui(bound_mode=bound_mode)


def main(argv=None):
    try:
        return cli(argv)
    except (PermissionError, ValueError, OSError) as error:
        _attach_console()
        diagnostic = os.environ.get('PROCUREMENT_ISSUER_DIAGNOSTIC')
        if diagnostic:
            Path(diagnostic).write_text(json.dumps({'error': str(error), 'frozen': bool(getattr(sys, 'frozen', False))}), encoding='utf-8')
        print(str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    sys.exit(main())
