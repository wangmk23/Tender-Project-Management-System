"""Local-only recovery-key binding for the frozen V5 application."""

from __future__ import annotations

import base64
import binascii
import hmac
import ipaddress
import json
import os
from pathlib import Path


_MAX_MATERIAL_LENGTH = 8192
_KEY_FILENAME = "data_key.dpapi"


class RecoveryValidationError(ValueError):
    """Raised when supplied recovery material cannot safely be used."""


def parse_recovery_material(value) -> bytes:
    """Decode either the legacy recovery JSON or its raw URL-safe key value."""

    material = str(value or "").strip()
    if not material or len(material) > _MAX_MATERIAL_LENGTH:
        raise RecoveryValidationError("恢复密钥格式无效")
    try:
        if material.startswith("{"):
            document = json.loads(material)
            material = str(document.get("key_base64") or "").strip()
        if not material or len(material) > _MAX_MATERIAL_LENGTH:
            raise ValueError
        padded = material + "=" * (-len(material) % 4)
        key = base64.b64decode(padded, altchars=b"-_", validate=True)
    except (AttributeError, TypeError, ValueError, json.JSONDecodeError, binascii.Error) as exc:
        raise RecoveryValidationError("恢复密钥格式无效") from exc
    if len(key) != 32:
        raise RecoveryValidationError("恢复密钥格式无效")
    return key


def bind_recovery_material(data_dir, material, *, expected_key=None, protect=None):
    """Validate and atomically bind a recovery key to the current Windows user."""

    key = parse_recovery_material(material)
    if expected_key is not None and not hmac.compare_digest(key, bytes(expected_key)):
        raise RecoveryValidationError("恢复密钥与当前数据不匹配")
    if not callable(protect):
        raise RuntimeError("本机密钥保护功能不可用")

    root = Path(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    target = root / _KEY_FILENAME
    pending = target.with_suffix(target.suffix + ".recovery-binding")
    try:
        wrapped = bytes(protect(key))
        if not wrapped:
            raise RuntimeError("本机密钥保护失败")
        with pending.open("wb") as stream:
            stream.write(wrapped)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, target)
    finally:
        pending.unlink(missing_ok=True)
    return {"bound": True}


def _is_loopback(value) -> bool:
    try:
        address = ipaddress.ip_address(str(value or ""))
    except ValueError:
        return False
    mapped = getattr(address, "ipv4_mapped", None)
    return address.is_loopback or bool(mapped and mapped.is_loopback)


def prompt_for_recovery_material(reason=None):
    """Ask locally for recovery material before the web application starts."""

    try:
        import tkinter as tk
        from tkinter import messagebox
    except Exception:
        return None

    result = {"value": None}
    root = tk.Tk()
    root.title("项目管理系统 - 数据恢复")
    root.resizable(False, False)
    root.attributes("-topmost", True)

    frame = tk.Frame(root, padx=24, pady=20)
    frame.pack(fill="both", expand=True)
    tk.Label(frame, text="需要验证数据恢复密钥", font=("Microsoft YaHei UI", 14, "bold")).pack(anchor="w")
    tk.Label(
        frame,
        text="请粘贴恢复密钥，验证成功后将自动绑定到当前电脑。\n密钥只在本次验证期间保留在内存中。",
        justify="left",
        pady=10,
    ).pack(anchor="w")
    value = tk.StringVar()
    entry = tk.Entry(frame, textvariable=value, width=62, show="●")
    entry.pack(fill="x", pady=(2, 14))

    controls = tk.Frame(frame)
    controls.pack(fill="x")

    def toggle_visibility():
        entry.configure(show="" if entry.cget("show") else "●")

    def submit():
        try:
            parse_recovery_material(value.get())
        except RecoveryValidationError as exc:
            messagebox.showerror("恢复密钥无效", str(exc), parent=root)
            return
        result["value"] = value.get()
        value.set("")
        root.destroy()

    tk.Button(controls, text="显示/隐藏", command=toggle_visibility).pack(side="left")
    tk.Button(controls, text="取消", command=root.destroy).pack(side="right", padx=(8, 0))
    tk.Button(controls, text="验证并绑定", command=submit).pack(side="right")
    root.protocol("WM_DELETE_WINDOW", root.destroy)
    root.update_idletasks()
    root.geometry(
        f"+{max(0, (root.winfo_screenwidth() - root.winfo_width()) // 2)}"
        f"+{max(0, (root.winfo_screenheight() - root.winfo_height()) // 2)}"
    )
    entry.focus_set()
    root.mainloop()
    return result["value"]


def register(app, runtime):
    """Register local-only admin recovery-key status and binding routes."""

    if app.extensions.get("data_recovery_registered"):
        return True

    database = runtime["db"]
    user_model = runtime["User"]

    def deny(message="只有本机管理员可以设置恢复密钥"):
        return app.json.response({"error": message}), 403

    def load_admin():
        from flask import request, session

        if not _is_loopback(request.remote_addr):
            return None
        user_id = session.get("user_id")
        if not user_id:
            return None
        try:
            user = database.session.get(user_model, int(user_id))
        except (TypeError, ValueError):
            return None
        active = getattr(user, "is_active", getattr(user, "active", True))
        if not user or not bool(active) or not bool(getattr(user, "is_admin", False)):
            return None
        return user

    def status():
        if load_admin() is None:
            return deny()
        key_file = Path(runtime["DATA_DIR"]) / _KEY_FILENAME
        response = app.json.response({"bound": key_file.is_file()})
        response.headers["Cache-Control"] = "no-store"
        return response

    def bind():
        from flask import request

        if load_admin() is None:
            return deny()
        payload = request.get_json(silent=True) or {}
        try:
            result = bind_recovery_material(
                runtime["DATA_DIR"],
                payload.get("recovery_key"),
                expected_key=runtime["MASTER_KEY"],
                protect=runtime["protect_key"],
            )
        except RecoveryValidationError as exc:
            return app.json.response({"error": str(exc)}), 400
        response = app.json.response(result)
        response.headers["Cache-Control"] = "no-store"
        return response

    def export():
        if load_admin() is None:
            return deny()
        key = bytes(runtime["MASTER_KEY"])
        if len(key) != 32:
            return app.json.response({"error": "当前数据密钥不可用"}), 503
        response = app.json.response({
            "format": 1,
            "key_base64": base64.urlsafe_b64encode(key).decode("ascii"),
            "description": "V5 数据恢复密钥，请与数据备份分开妥善保存。",
        })
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        return response

    def save():
        import secrets
        from datetime import datetime

        if load_admin() is None:
            return deny()
        key = bytes(runtime["MASTER_KEY"])
        if len(key) != 32:
            return app.json.response({"error": "当前数据密钥不可用"}), 503
        try:
            folder = Path(runtime["get_export_dir"]()).resolve()
            folder.mkdir(parents=True, exist_ok=True)
            filename = "V5-数据恢复密钥-" + datetime.now().strftime("%Y%m%d-%H%M%S") + "-" + secrets.token_hex(3) + ".json"
            target = folder / filename
            material = {"format": 1, "key_base64": base64.urlsafe_b64encode(key).decode("ascii"),
                        "description": "V5 数据恢复密钥，请与数据备份分开妥善保存。"}
            created = False
            try:
                with target.open("x", encoding="utf-8") as stream:
                    created = True
                    json.dump(material, stream, ensure_ascii=False, indent=2)
                    stream.flush()
                    os.fsync(stream.fileno())
            except Exception:
                if created:
                    target.unlink(missing_ok=True)
                raise
        except (OSError, KeyError, TypeError, ValueError):
            return app.json.response({"error": "恢复密钥保存失败，请检查设置中的导出目录及写入权限"}), 500
        response = app.json.response({"saved": True, "path": str(target), "filename": filename})
        response.headers["Cache-Control"] = "no-store"
        return response

    def choose_export_folder():
        if load_admin() is None:
            return deny()
        chooser = runtime.get("choose_export_folder")
        if not callable(chooser):
            return app.json.response({"error": "请在主机客户端选择保存文件夹"}), 400
        selected = chooser()
        return app.json.response({"path": str(selected[0]) if selected else None})

    app.add_url_rule("/api/settings/choose-export-folder", "choose_export_folder", choose_export_folder, methods=["POST"])
    app.add_url_rule("/api/data-recovery/save", "data_recovery_save", save, methods=["POST"])
    app.add_url_rule("/api/data-recovery/export", "data_recovery_export", export, methods=["POST"])
    app.add_url_rule("/api/data-recovery/status", "data_recovery_status", status, methods=["GET"])
    app.add_url_rule("/api/data-recovery/bind", "data_recovery_bind", bind, methods=["POST"])
    app.extensions["data_recovery_registered"] = True
    return True
