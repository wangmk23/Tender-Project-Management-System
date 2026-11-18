"""Open-source license verification and DPAPI helpers for the public edition (Stage 5).

public-licensing-v1
"""
from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
from datetime import date, datetime
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from typing import Any
import uuid

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives import serialization


PUBLIC_LICENSING_SIGNATURE = "public-licensing-v1"
PRODUCT_ID = "hd-project-manager"
LICENSE_FILENAME = "license.dat"
STATE_FILENAME = ".license_state.bin"
PUBLIC_OPEN_MODE_ENV = "PM_PUBLIC_EDITION_UNRESTRICTED"


def _hidden_startupinfo():
    if os.name != "nt":
        return None
    info = subprocess.STARTUPINFO()
    info.dwFlags |= subprocess.STARTF_USESHOWWINDOW
    info.wShowWindow = 0
    return info


def _machine_guid() -> str:
    if os.name != "nt":
        return platform.node()
    try:
        import winreg

        flags = winreg.KEY_READ | getattr(winreg, "KEY_WOW64_64KEY", 0)
        with winreg.OpenKey(
            winreg.HKEY_LOCAL_MACHINE,
            r"SOFTWARE\Microsoft\Cryptography",
            0,
            flags,
        ) as key:
            return str(winreg.QueryValueEx(key, "MachineGuid")[0]).strip()
    except OSError:
        return platform.node()


def _system_uuid() -> str:
    if os.name != "nt":
        return platform.machine()
    command = [
        "powershell.exe",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "(Get-CimInstance Win32_ComputerSystemProduct).UUID",
    ]
    try:
        value = subprocess.check_output(
            command,
            text=True,
            encoding="utf-8",
            errors="ignore",
            timeout=8,
            startupinfo=_hidden_startupinfo(),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        ).strip()
        return value or "unknown-system-uuid"
    except Exception:
        return "unknown-system-uuid"


def get_volume_serial(root: str | Path | None = None) -> str:
    if os.name != "nt":
        return "non-windows"
    root = root or Path(os.environ.get("SystemDrive", "C:")).anchor or "C:\\"
    root = str(root)
    if len(root) >= 2 and root[1] == ":" and not root.endswith("\\"):
        root += "\\"
    serial = wintypes.DWORD()
    max_len = wintypes.DWORD()
    flags = wintypes.DWORD()
    volume_name = ctypes.create_unicode_buffer(261)
    fs_name = ctypes.create_unicode_buffer(261)
    ok = ctypes.windll.kernel32.GetVolumeInformationW(
        root,
        volume_name,
        len(volume_name),
        ctypes.byref(serial),
        ctypes.byref(max_len),
        ctypes.byref(flags),
        fs_name,
        len(fs_name),
    )
    if ok:
        return f"{serial.value:08X}"
    return "unknown-volume"


def machine_fingerprint() -> dict[str, Any]:
    components = {
        "system_uuid": _system_uuid().upper(),
        "machine_guid": _machine_guid().upper(),
        "system_volume": get_volume_serial().upper(),
    }
    canonical = "|".join(components[key] for key in sorted(components))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    device_code = "PM-" + "-".join(digest[i : i + 4].upper() for i in range(0, 20, 4))
    return {
        "machine_hash": digest,
        "device_code": device_code,
        "components": components,
    }


def canonical_payload(payload: dict[str, Any]) -> bytes:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("cbData", wintypes.DWORD),
        ("pbData", ctypes.POINTER(ctypes.c_byte)),
    ]


def _dpapi_protect(data: bytes) -> bytes:
    if os.name != "nt":
        return data
    buffer = ctypes.create_string_buffer(data)
    source = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    target = _DataBlob()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source),
        "ProjectManagerLicenseState",
        None,
        None,
        None,
        0,
        ctypes.byref(target),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(target.pbData)


def _dpapi_unprotect(data: bytes) -> bytes:
    if os.name != "nt":
        return data
    buffer = ctypes.create_string_buffer(data)
    source = _DataBlob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    target = _DataBlob()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source),
        None,
        None,
        None,
        None,
        0,
        ctypes.byref(target),
    ):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.pbData, target.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(target.pbData)


def _read_last_seen(data_dir: str | Path) -> date | None:
    path = Path(data_dir) / STATE_FILENAME
    try:
        payload = json.loads(_dpapi_unprotect(path.read_bytes()).decode("utf-8"))
        return date.fromisoformat(payload["last_seen"])
    except Exception:
        return None


def _write_last_seen(data_dir: str | Path, value: date) -> None:
    path = Path(data_dir) / STATE_FILENAME
    raw = json.dumps({"last_seen": value.isoformat()}).encode("utf-8")
    path.write_bytes(_dpapi_protect(raw))


def verify_license(
    data_dir: str | Path,
    resource_dir: str | Path,
    update_state: bool = True,
    *, unrestricted: bool | None = None,
) -> dict[str, Any]:
    fingerprint = machine_fingerprint()
    if unrestricted if unrestricted is not None else os.environ.get(PUBLIC_OPEN_MODE_ENV) == "1":
        return {
            "status": "valid",
            "mode": "full",
            "message": "开源公开版（无硬件锁）",
            "device_code": fingerprint["device_code"],
            "machine_hash": fingerprint["machine_hash"],
            "organization": "公开版用户",
            "expires_at": None,
            "license_id": "PUBLIC-OPEN",
        }
    result: dict[str, Any] = {
        "status": "missing",
        "mode": "blocked",
        "message": "尚未授权",
        "device_code": fingerprint["device_code"],
        "machine_hash": fingerprint["machine_hash"],
        "organization": "",
        "expires_at": None,
        "license_id": "",
    }
    license_path = Path(data_dir) / LICENSE_FILENAME
    public_key_path = Path(resource_dir) / "static" / "license_public_key.pem"
    if not license_path.exists():
        return result
    if not public_key_path.exists():
        result.update(status="configuration_error", message="授权公钥缺失")
        return result
    try:
        document = json.loads(license_path.read_text(encoding="utf-8"))
        payload = document["payload"]
        signature = base64.b64decode(document["signature"], validate=True)
        public_key = serialization.load_pem_public_key(public_key_path.read_bytes())
        public_key.verify(signature, canonical_payload(payload))
        if payload.get("product") != PRODUCT_ID:
            raise ValueError("许可证产品不匹配")
        if payload.get("machine_hash") != fingerprint["machine_hash"]:
            result.update(status="machine_mismatch", message="许可证不属于当前电脑")
            return result
        today = date.today()
        not_before = date.fromisoformat(payload.get("not_before") or payload["issued_at"][:10])
        if today < not_before:
            result.update(status="not_started", message="授权尚未生效")
            return result
        last_seen = _read_last_seen(data_dir)
        if last_seen and today < last_seen:
            result.update(status="clock_rollback", message="检测到系统时间回拨，请重新授权")
            return result
        expires_text = payload.get("expires_at")
        expires_at = date.fromisoformat(expires_text) if expires_text else None
        common = {
            "organization": payload.get("organization") or "",
            "expires_at": expires_text,
            "license_id": payload.get("license_id") or "",
            "issued_at": payload.get("issued_at") or "",
        }
        if expires_at and today > expires_at:
            result.update(
                status="expired",
                mode="read_only",
                message="授权已到期，当前为只读模式",
                **common,
            )
            return result
        if update_state:
            _write_last_seen(data_dir, today)
        result.update(
            status="valid",
            mode="full",
            message="授权有效",
            **common,
        )
        return result
    except InvalidSignature:
        result.update(status="invalid_signature", message="许可证签名无效")
        return result
    except Exception as exc:
        result.update(status="invalid", message=f"许可证无效：{exc}")
        return result
