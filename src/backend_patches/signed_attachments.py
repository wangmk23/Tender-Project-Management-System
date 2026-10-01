"""Controlled LAN attachment signing module: signed-attachments-v1."""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import hashlib
import hmac
import json
import os
import secrets
import tempfile
import threading
import time
from collections import deque
from pathlib import Path
from urllib.parse import urlencode

try:
    from flask import jsonify, request
except Exception:  # pragma: no cover - Flask is present in the packaged app
    jsonify = None
    request = None


_PROTECT_SECRET = None
_UNPROTECT_SECRET = None
_INVALID_ATTEMPTS = {}
_INVALID_LIMIT = 3
_INVALID_WINDOW_SECONDS = 60
_INVALID_MAX_CLIENTS = 1024
_INVALID_LOCK = threading.Lock()
_KEY_FILENAME = "attachment_link_key.dpapi"
_AUDIT_FILENAME = "attachment_download_audit.jsonl"


class _DataBlob(ctypes.Structure):
    _fields_ = [
        ("size", ctypes.wintypes.DWORD),
        ("data", ctypes.POINTER(ctypes.c_char)),
    ]


def _dpapi_transform(raw: bytes, protect: bool) -> bytes:
    hook = _PROTECT_SECRET if protect else _UNPROTECT_SECRET
    if hook is not None:
        return bytes(hook(raw))
    if os.name != "nt":
        raise RuntimeError("附件签名密钥加密仅支持 Windows")
    source_buffer = ctypes.create_string_buffer(raw)
    source = _DataBlob(
        len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char))
    )
    target = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if protect:
        success = crypt32.CryptProtectData(
            ctypes.byref(source),
            "ProjectManagementAttachmentLinks",
            None,
            None,
            None,
            0,
            ctypes.byref(target),
        )
    else:
        success = crypt32.CryptUnprotectData(
            ctypes.byref(source), None, None, None, None, 0, ctypes.byref(target)
        )
    if not success:
        raise ctypes.WinError()
    try:
        return ctypes.string_at(target.data, target.size)
    finally:
        ctypes.windll.kernel32.LocalFree(target.data)


def _read_secret(path: Path) -> bytes:
    secret = _dpapi_transform(path.read_bytes(), False)
    if len(secret) != 32:
        raise ValueError("附件签名密钥长度无效")
    return secret


def get_or_create_secret(data_dir: Path) -> bytes:
    data_dir = Path(data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    path = data_dir / _KEY_FILENAME
    if path.is_file():
        return _read_secret(path)
    secret = secrets.token_bytes(32)
    protected = _dpapi_transform(secret, True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=data_dir, prefix=path.name + ".", suffix=".tmp", delete=False
        ) as stream:
            pending = Path(stream.name)
            stream.write(protected)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            # Publish a complete file without overwriting a concurrent winner.
            # Windows rename refuses an existing destination (also on FAT/exFAT).
            if os.name == "nt":
                os.rename(pending, path)
            else:
                os.link(pending, path)
        except FileExistsError:
            return _read_secret(path)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)
    return secret


def _payload(attachment_id: int, expires_at: int) -> bytes:
    return f"v1\n{int(attachment_id)}\n{int(expires_at)}".encode("ascii")


def _signature(attachment_id: int, expires_at: int, secret: bytes) -> str:
    return hmac.new(
        secret, _payload(attachment_id, expires_at), hashlib.sha256
    ).hexdigest()


def build_signed_url(
    base_url: str, attachment_id: int, expires_at: int, secret: bytes
) -> str:
    base = str(base_url or "").rstrip("/")
    signature = _signature(attachment_id, expires_at, secret)
    query = urlencode({"expires": int(expires_at), "sig": signature})
    return f"{base}/api/public/attachments/{int(attachment_id)}/download?{query}"


def verify_signature(
    attachment_id: int,
    expires_at: int,
    signature: str,
    secret: bytes,
    now: int,
) -> str:
    supplied = str(signature or "")
    if len(supplied) != 64 or any(char not in "0123456789abcdef" for char in supplied):
        return "invalid"
    try:
        expires_at = int(expires_at)
        expected = _signature(int(attachment_id), expires_at, secret)
    except (TypeError, ValueError, OverflowError):
        return "invalid"
    if not hmac.compare_digest(expected, supplied):
        return "invalid"
    if int(now) > expires_at:
        return "expired"
    return "valid"


def _audit(data_dir: Path, attachment_id, remote_addr, result, expires_at) -> None:
    record = {
        "attachment_id": int(attachment_id),
        "expires_at": int(expires_at) if str(expires_at).isdigit() else None,
        "remote_addr": str(remote_addr or ""),
        "result": result,
        "timestamp": int(time.time()),
    }
    path = Path(data_dir) / _AUDIT_FILENAME
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def _invalid_request_is_throttled(remote_addr: str, now: int) -> bool:
    key = str(remote_addr or "unknown")
    cutoff = int(now) - _INVALID_WINDOW_SECONDS
    with _INVALID_LOCK:
        if key not in _INVALID_ATTEMPTS:
            # Reclaim inactive sources before admitting another source; rejected
            # requests never allocate unbounded state or evict a live limiter.
            stale_keys = [
                source for source, events in _INVALID_ATTEMPTS.items()
                if not events or events[-1] <= cutoff
            ]
            for stale_key in stale_keys:
                _INVALID_ATTEMPTS.pop(stale_key, None)
            if len(_INVALID_ATTEMPTS) >= _INVALID_MAX_CLIENTS:
                return True
            _INVALID_ATTEMPTS[key] = deque()
        attempts = _INVALID_ATTEMPTS[key]
        while attempts and attempts[0] <= cutoff:
            attempts.popleft()
        if len(attempts) >= _INVALID_LIMIT:
            return True
        attempts.append(int(now))
        return False


def register_routes(app, db, models) -> None:
    if getattr(app, "_signed_attachment_routes_registered", False):
        return
    Attachment = models["Attachment"]
    data_dir = Path(models["DATA_DIR"])
    upload_folder = Path(models["UPLOAD_FOLDER"])
    attachment_response = models.get("attachment_response")
    now_provider = models.get("now", time.time)

    def download_signed_attachment(aid):
        remote_addr = getattr(request, "remote_addr", "")
        expires_raw = getattr(request, "args", {}).get("expires", "")
        signature = getattr(request, "args", {}).get("sig", "")
        try:
            expires_at = int(expires_raw)
        except (TypeError, ValueError, OverflowError):
            expires_at = 0
        now = int(now_provider())
        try:
            secret = get_or_create_secret(data_dir)
            status = verify_signature(aid, expires_at, signature, secret, now)
        except Exception:
            _audit(data_dir, aid, remote_addr, "key-error", expires_at)
            return jsonify({"error": "附件下载暂不可用"}), 503
        if status == "expired":
            _audit(data_dir, aid, remote_addr, "expired", expires_at)
            return jsonify({"error": "附件链接已过期，请重新导出"}), 410
        if status != "valid":
            throttled = _invalid_request_is_throttled(remote_addr, now)
            _audit(
                data_dir,
                aid,
                remote_addr,
                "throttled" if throttled else "invalid",
                expires_at,
            )
            if throttled:
                return jsonify({"error": "请求过于频繁，请稍后再试"}), 429
            return jsonify({"error": "附件不存在"}), 404

        attachment = db.session.get(Attachment, aid)
        if attachment is None:
            _audit(data_dir, aid, remote_addr, "not-found", expires_at)
            return jsonify({"error": "附件不存在"}), 404
        try:
            root = upload_folder.resolve()
            path = (root / str(attachment.file_path)).resolve()
            path.relative_to(root)
            if not path.is_file():
                raise FileNotFoundError(path)
        except (OSError, RuntimeError, ValueError):
            _audit(data_dir, aid, remote_addr, "not-found", expires_at)
            return jsonify({"error": "附件不存在"}), 404

        if not callable(attachment_response):
            _audit(data_dir, aid, remote_addr, "decrypt-unavailable", expires_at)
            return jsonify({"error": "附件下载暂不可用"}), 503
        try:
            response = attachment_response(path, attachment, True)
        except Exception:
            _audit(data_dir, aid, remote_addr, "decrypt-error", expires_at)
            return jsonify({"error": "附件下载暂不可用"}), 503
        _audit(data_dir, aid, remote_addr, "downloaded", expires_at)
        return response

    app.add_url_rule(
        "/api/public/attachments/<int:aid>/download",
        "api_download_signed_attachment",
        download_signed_attachment,
        methods=["GET"],
    )
    app._signed_attachment_routes_registered = True
