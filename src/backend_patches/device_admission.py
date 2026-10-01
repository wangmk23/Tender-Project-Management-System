"""Browser-token device admission for the frozen V5 application."""

from __future__ import annotations

import ctypes
import ctypes.wintypes
import hashlib
import hmac
import ipaddress
import json
import os
import secrets
import sqlite3
import threading
from contextlib import closing
from datetime import datetime, timedelta, timezone
from pathlib import Path


_PROTECT_SECRET = None
_UNPROTECT_SECRET = None
_KEY_FILENAME = "device_admission_key.dpapi"
_TOKEN_DAYS = 365
_SEEN_THROTTLE = timedelta(minutes=5)
_OBSERVER_COOKIE = "device_observer_id"
_OBSERVER_COOKIE_DAYS = 730
_OBSERVER_ONLINE_WINDOW = timedelta(minutes=5)
_OBSERVER_RETENTION = timedelta(days=180)
_OBSERVER_NEW_PER_IP_LIMIT = 20
_OBSERVER_GLOBAL_LIMIT = 2000
_OBSERVER_LIST_LIMIT = 200


def _device_secret_key_id(secret: bytes) -> str:
    return hashlib.sha256(b"PM-DEVICE-KEY-ID\0" + bytes(secret)).hexdigest()


class DeviceAdmissionError(Exception):
    status = 400


class ValidationError(DeviceAdmissionError):
    pass


class RateLimitError(DeviceAdmissionError):
    status = 429


class ConflictError(DeviceAdmissionError):
    status = 409


class NotFoundError(DeviceAdmissionError):
    status = 404


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
        raise RuntimeError("设备准入密钥加密仅支持 Windows")
    source_buffer = ctypes.create_string_buffer(raw)
    source = _DataBlob(
        len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char))
    )
    target = _DataBlob()
    crypt32 = ctypes.windll.crypt32
    if protect:
        success = crypt32.CryptProtectData(
            ctypes.byref(source),
            "ProjectManagementDeviceAdmission",
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


def _load_or_create_secret(data_dir: Path) -> bytes:
    root = Path(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    path = root / _KEY_FILENAME
    if path.is_file():
        value = _dpapi_transform(path.read_bytes(), False)
        if len(value) != 32:
            raise ValueError("设备准入密钥长度无效")
        return value
    value = secrets.token_bytes(32)
    protected = _dpapi_transform(value, True)
    pending = path.with_suffix(path.suffix + ".tmp")
    try:
        with pending.open("xb") as stream:
            stream.write(protected)
            stream.flush()
            os.fsync(stream.fileno())
        if path.exists():
            pending.unlink(missing_ok=True)
            existing = _dpapi_transform(path.read_bytes(), False)
            if len(existing) != 32:
                raise ValueError("设备准入密钥长度无效")
            return existing
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)
    return value


def _bind_secret(data_dir: Path, value: bytes) -> None:
    secret = bytes(value)
    if len(secret) != 32:
        raise ValueError("设备准入密钥长度无效")
    root = Path(data_dir)
    root.mkdir(parents=True, exist_ok=True)
    path = root / _KEY_FILENAME
    pending = path.with_suffix(path.suffix + ".rebind")
    try:
        protected = _dpapi_transform(secret, True)
        with pending.open("wb") as stream:
            stream.write(protected)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
    finally:
        pending.unlink(missing_ok=True)


def credential_hash(secret: bytes, namespace: str, raw: str) -> str:
    message = f"{namespace}\0{str(raw or '')}".encode("utf-8")
    return hmac.new(secret, message, hashlib.sha256).hexdigest()


def credential_hashes(secrets, namespace: str, raw: str) -> list[tuple[str | None, str]]:
    values = []
    seen = set()
    for key_id, secret in secrets:
        digest = credential_hash(secret, namespace, raw)
        if digest not in seen:
            seen.add(digest)
            values.append((key_id, digest))
    return values


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _iso(value: datetime) -> str:
    return _as_utc(value).isoformat(timespec="microseconds")


def _parse(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return _as_utc(datetime.fromisoformat(str(value)))
    except (TypeError, ValueError):
        return None


def _clean_text(value, label: str, minimum: int, maximum: int) -> str:
    normalized = str(value or "").strip()
    if not minimum <= len(normalized) <= maximum:
        if minimum:
            raise ValidationError(f"{label}必须为{minimum}至{maximum}个字符")
        raise ValidationError(f"{label}不能超过{maximum}个字符")
    return normalized


def _clean_ip(value) -> str:
    try:
        return str(ipaddress.ip_address(str(value or "").strip()))
    except ValueError as exc:
        raise ValidationError("来源地址无效") from exc


def _mapping(row) -> dict | None:
    if row is None:
        return None
    if isinstance(row, sqlite3.Row):
        return dict(row)
    if hasattr(row, "_mapping"):
        return dict(row._mapping)
    return dict(row)


class DeviceAdmissionService:
    def __init__(
        self,
        database_path,
        data_dir,
        *,
        encrypted_connect=None,
        master_key=None,
        keyring=None,
        clock=None,
        token_factory=None,
    ):
        self.database_path = Path(database_path)
        self.data_dir = Path(data_dir)
        self.encrypted_connect = encrypted_connect
        self.master_key = master_key
        self.keyring = keyring
        self.clock = clock or _utc_now
        self.token_factory = token_factory or (lambda: secrets.token_urlsafe(32))
        self._secret = None
        self._verification_entries = None
        self._secret_lock = threading.RLock()
        self.ensure_schema()

    @property
    def secret(self) -> bytes:
        return self.primary_secret

    @property
    def primary_secret(self) -> bytes:
        if self._secret is None:
            with self._secret_lock:
                if self._secret is None:
                    self._load_key_material()
        return self._secret

    @property
    def verification_secrets(self) -> list[tuple[str | None, bytes]]:
        if self._verification_entries is None:
            with self._secret_lock:
                if self._verification_entries is None:
                    self._load_key_material()
        return list(self._verification_entries)

    def _load_key_material(self) -> None:
        if self.keyring is None:
            self._secret = _load_or_create_secret(self.data_dir)
            self._verification_entries = [(None, self._secret)]
            return
        key_path = self.data_dir / _KEY_FILENAME
        local = None
        local_error = None
        if key_path.is_file():
            try:
                local = _load_or_create_secret(self.data_dir)
            except Exception as exc:
                local_error = exc
        if local is not None:
            enrolled = self.keyring.enroll(
                local, source="local_dpapi", primary=True
            )
            if enrolled.get("created") or enrolled.get("promoted"):
                self._audit_keyring_system(
                    "device.keyring.enrolled",
                    detail={
                        "key_id_prefix": enrolled["key_id"][:12],
                        "source": "local_dpapi",
                    },
                )
            self._secret = local
        else:
            recovered = self.keyring.primary_key()
            if recovered is not None:
                self.rebind_local_cache(recovered)
                self._secret = recovered
                self._audit_keyring_system(
                    "device.keyring.rebound",
                    detail={
                        "key_id_prefix": _device_secret_key_id(recovered)[:12],
                        "source": "keyring",
                    },
                )
            elif local_error is not None:
                raise local_error
            else:
                self._secret = _load_or_create_secret(self.data_dir)
                enrolled = self.keyring.enroll(
                    self._secret, source="local_dpapi", primary=True
                )
                self._audit_keyring_system(
                    "device.keyring.enrolled",
                    detail={
                        "key_id_prefix": enrolled["key_id"][:12],
                        "source": "local_dpapi",
                    },
                )
        entries, unavailable = self.keyring.verification_entries_with_failures()
        for failure in unavailable:
            self._audit_keyring_system(
                "device.keyring.unavailable", result="error", detail=failure
            )
        self._verification_entries = [
            (key_id, secret) for key_id, secret in entries
        ]
        if not any(hmac.compare_digest(secret, self._secret) for _, secret in entries):
            raise RuntimeError("设备准入主密钥未写入密钥环")

    def rebind_local_cache(self, secret: bytes) -> None:
        _bind_secret(self.data_dir, secret)

    def enroll_secret(self, secret: bytes, *, source: str, primary: bool) -> dict:
        if self.keyring is None:
            raise RuntimeError("设备密钥环不可用")
        result = self.keyring.enroll(secret, source=source, primary=primary)
        if primary:
            self.rebind_local_cache(secret)
        self._secret = None
        self._verification_entries = None
        return result

    def import_secret(self, secret: bytes, admin_user_id: int) -> dict:
        if self.keyring is None:
            raise RuntimeError("设备密钥环不可用")
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            enrolled = self.keyring.enroll_in_transaction(
                connection, secret, source="migration_code", primary=False
            )
            self._audit(
                connection,
                "device.keyring.imported",
                actor_user_id=int(admin_user_id),
                detail={"key_id_prefix": enrolled["key_id"][:12]},
            )
            status = self.keyring.status(connection=connection)
        self._secret = None
        self._verification_entries = None
        return {"enrolled": enrolled, "status": status}

    def _connect(self):
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        if self.encrypted_connect is None:
            connection = sqlite3.connect(str(self.database_path), timeout=5)
        else:
            connection = self.encrypted_connect(
                self.database_path, self.master_key, False
            )
        row_module = __import__(connection.__class__.__module__, fromlist=["Row"])
        connection.row_factory = getattr(row_module, "Row", sqlite3.Row)
        connection.execute("PRAGMA foreign_keys=ON")
        return connection

    def ensure_schema(self) -> None:
        with closing(self._connect()) as connection, connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS device_access_requests (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    request_lookup_hash TEXT NOT NULL UNIQUE,
                    applicant TEXT NOT NULL,
                    device_label TEXT NOT NULL,
                    reason TEXT NOT NULL DEFAULT '',
                    first_ip TEXT NOT NULL,
                    last_ip TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'pending',
                    reject_reason TEXT,
                    approved_label TEXT,
                    created_at TEXT NOT NULL,
                    decided_at TEXT,
                    decided_by_user_id INTEGER,
                    approved_device_id INTEGER,
                    exchange_consumed_at TEXT
                );
                CREATE TABLE IF NOT EXISTS approved_devices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    token_hash TEXT NOT NULL UNIQUE,
                    label TEXT NOT NULL,
                    applicant TEXT NOT NULL,
                    enabled INTEGER NOT NULL DEFAULT 1,
                    first_ip TEXT NOT NULL,
                    last_ip TEXT,
                    approved_by_user_id INTEGER NOT NULL,
                    approved_at TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    last_seen_at TEXT,
                    revoked_at TEXT,
                    revoked_by_user_id INTEGER
                );
                CREATE TABLE IF NOT EXISTS device_access_audit (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    request_id INTEGER,
                    device_id INTEGER,
                    actor_user_id INTEGER,
                    source_ip TEXT,
                    result TEXT NOT NULL,
                    detail_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS observed_devices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    observer_hash TEXT NOT NULL UNIQUE,
                    first_ip TEXT NOT NULL,
                    last_ip TEXT NOT NULL,
                    user_agent TEXT NOT NULL DEFAULT '',
                    client_label TEXT NOT NULL DEFAULT '未知浏览器',
                    first_seen_at TEXT NOT NULL,
                    last_seen_at TEXT NOT NULL,
                    activity_count INTEGER NOT NULL DEFAULT 1,
                    last_user_id INTEGER,
                    last_username TEXT
                );
                CREATE TABLE IF NOT EXISTS device_admission_config (
                    singleton INTEGER PRIMARY KEY CHECK(singleton=1),
                    enabled INTEGER NOT NULL CHECK(enabled IN (0,1)),
                    updated_at TEXT NOT NULL,
                    updated_by_user_id INTEGER
                );
                CREATE INDEX IF NOT EXISTS ix_device_requests_status_created
                    ON device_access_requests(status, created_at DESC);
                CREATE INDEX IF NOT EXISTS ix_device_requests_ip_created
                    ON device_access_requests(first_ip, created_at DESC);
                CREATE INDEX IF NOT EXISTS ix_approved_devices_enabled_expiry
                    ON approved_devices(enabled, expires_at);
                CREATE INDEX IF NOT EXISTS ix_device_audit_created
                    ON device_access_audit(created_at DESC, id DESC);
                CREATE INDEX IF NOT EXISTS ix_observed_devices_last_seen
                    ON observed_devices(last_seen_at DESC, id DESC);
                """
            )

    def _now(self) -> datetime:
        return _as_utc(self.clock())

    def _audit(
        self,
        connection,
        event_type: str,
        *,
        request_id=None,
        device_id=None,
        actor_user_id=None,
        source_ip=None,
        result="success",
        detail=None,
    ) -> None:
        safe_detail = {
            str(key): value
            for key, value in dict(detail or {}).items()
            if not any(part in str(key).casefold() for part in (
                "token", "secret", "cookie", "csrf", "lookup", "sig"
            ))
        }
        connection.execute(
            "INSERT INTO device_access_audit("
            "event_type,request_id,device_id,actor_user_id,source_ip,result,detail_json,created_at"
            ") VALUES(?,?,?,?,?,?,?,?)",
            (
                event_type,
                request_id,
                device_id,
                actor_user_id,
                source_ip,
                result,
                json.dumps(safe_detail, ensure_ascii=False, sort_keys=True),
                _iso(self._now()),
            ),
        )

    def _audit_keyring_system(self, event_type: str, *, result="success", detail=None) -> None:
        with closing(self._connect()) as connection, connection:
            self._audit(
                connection,
                event_type,
                result=result,
                detail=detail,
            )

    def _request_by_lookup(
        self, connection, lookup_token: str, candidates=None
    ) -> tuple[dict | None, str | None]:
        candidates = candidates or credential_hashes(
            self.verification_secrets, "request", lookup_token
        )
        for key_id, lookup_hash in candidates:
            row = _mapping(connection.execute(
                "SELECT * FROM device_access_requests WHERE request_lookup_hash=?",
                (lookup_hash,),
            ).fetchone())
            if row:
                return row, key_id
        return None, None

    def submit_request(
        self, ip, lookup_token, applicant, device_label, reason=""
    ) -> dict:
        source_ip = _clean_ip(ip)
        lookup = _clean_text(lookup_token, "申请凭证", 16, 512)
        name = _clean_text(applicant, "申请人", 1, 20)
        label = _clean_text(device_label, "设备名称", 1, 40)
        why = _clean_text(reason, "事由", 0, 200)
        lookup_hash = credential_hash(self.primary_secret, "request", lookup)
        now = self._now()
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            existing, _ = self._request_by_lookup(connection, lookup)
            if existing and existing["status"] == "pending":
                connection.execute(
                    "UPDATE device_access_requests SET last_ip=? WHERE id=?",
                    (source_ip, existing["id"]),
                )
                existing["last_ip"] = source_ip
                return existing

            cooldown = connection.execute(
                "SELECT decided_at FROM device_access_requests "
                "WHERE first_ip=? AND status='rejected' AND decided_at IS NOT NULL "
                "ORDER BY decided_at DESC LIMIT 1",
                (source_ip,),
            ).fetchone()
            cooldown_time = _parse(cooldown[0]) if cooldown else None
            if cooldown_time and now < cooldown_time + timedelta(hours=24):
                raise RateLimitError("该设备被拒绝后需等待24小时再申请")
            cutoff = _iso(now - timedelta(hours=1))
            recent_count = connection.execute(
                "SELECT COUNT(*) FROM device_access_requests "
                "WHERE first_ip=? AND created_at>?",
                (source_ip, cutoff),
            ).fetchone()[0]
            if int(recent_count) >= 3:
                self._audit(
                    connection,
                    "request.rate_limited",
                    source_ip=source_ip,
                    result="rejected",
                )
                connection.commit()
                raise RateLimitError("同一地址每小时最多提交3次申请")
            try:
                cursor = connection.execute(
                    "INSERT INTO device_access_requests("
                    "request_lookup_hash,applicant,device_label,reason,first_ip,last_ip,status,created_at"
                    ") VALUES(?,?,?,?,?,?,'pending',?)",
                    (lookup_hash, name, label, why, source_ip, source_ip, _iso(now)),
                )
            except sqlite3.IntegrityError as exc:
                raise ConflictError("申请凭证已使用，请刷新申请页") from exc
            request_id = int(cursor.lastrowid)
            self._audit(
                connection,
                "request.created",
                request_id=request_id,
                source_ip=source_ip,
            )
            return _mapping(connection.execute(
                "SELECT * FROM device_access_requests WHERE id=?", (request_id,)
            ).fetchone())

    def request_status(self, ip, lookup_token) -> dict:
        source_ip = _clean_ip(ip)
        lookup = _clean_text(lookup_token, "申请凭证", 16, 512)
        candidates = credential_hashes(self.verification_secrets, "request", lookup)
        with closing(self._connect()) as connection, connection:
            row, _ = self._request_by_lookup(connection, lookup, candidates)
            if not row:
                raise NotFoundError("申请不存在")
            if row["last_ip"] != source_ip:
                connection.execute(
                    "UPDATE device_access_requests SET last_ip=? WHERE id=?",
                    (source_ip, row["id"]),
                )
                row["last_ip"] = source_ip
            return row

    def approve(self, request_id, admin_user_id, label) -> dict:
        approved_label = _clean_text(label, "设备备注", 1, 40)
        now = _iso(self._now())
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE device_access_requests SET status='approved',approved_label=?,"
                "decided_at=?,decided_by_user_id=?,reject_reason=NULL "
                "WHERE id=? AND status='pending'",
                (approved_label, now, int(admin_user_id), int(request_id)),
            )
            if cursor.rowcount != 1:
                if not connection.execute(
                    "SELECT 1 FROM device_access_requests WHERE id=?", (int(request_id),)
                ).fetchone():
                    raise NotFoundError("申请不存在")
                raise ConflictError("申请已处理")
            self._audit(
                connection,
                "request.approved",
                request_id=int(request_id),
                actor_user_id=int(admin_user_id),
            )
            return _mapping(connection.execute(
                "SELECT * FROM device_access_requests WHERE id=?", (int(request_id),)
            ).fetchone())

    def reject(self, request_id, admin_user_id, reason) -> dict:
        reject_reason = _clean_text(reason, "拒绝理由", 1, 200)
        now = _iso(self._now())
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE device_access_requests SET status='rejected',reject_reason=?,"
                "decided_at=?,decided_by_user_id=? WHERE id=? AND status='pending'",
                (reject_reason, now, int(admin_user_id), int(request_id)),
            )
            if cursor.rowcount != 1:
                if not connection.execute(
                    "SELECT 1 FROM device_access_requests WHERE id=?", (int(request_id),)
                ).fetchone():
                    raise NotFoundError("申请不存在")
                raise ConflictError("申请已处理")
            self._audit(
                connection,
                "request.rejected",
                request_id=int(request_id),
                actor_user_id=int(admin_user_id),
            )
            return _mapping(connection.execute(
                "SELECT * FROM device_access_requests WHERE id=?", (int(request_id),)
            ).fetchone())

    def exchange_approved_request(self, ip, lookup_token) -> tuple[dict, str | None]:
        source_ip = _clean_ip(ip)
        lookup = _clean_text(lookup_token, "申请凭证", 16, 512)
        candidates = credential_hashes(self.verification_secrets, "request", lookup)
        now = self._now()
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            row, _ = self._request_by_lookup(connection, lookup, candidates)
            if not row:
                raise NotFoundError("申请不存在")
            if row["status"] != "approved":
                return row, None
            if row["exchange_consumed_at"] or row["approved_device_id"]:
                return row, None
            raw_token = str(self.token_factory())
            if len(raw_token) < 16:
                raise RuntimeError("设备令牌生成器返回值过短")
            token_hash = credential_hash(self.primary_secret, "device", raw_token)
            approved_at = _parse(row["decided_at"]) or now
            expires_at = approved_at + timedelta(days=_TOKEN_DAYS)
            cursor = connection.execute(
                "INSERT INTO approved_devices("
                "token_hash,label,applicant,enabled,first_ip,last_ip,approved_by_user_id,"
                "approved_at,expires_at,last_seen_at) VALUES(?,?,?,1,?,?,?,?,?,?)",
                (
                    token_hash,
                    row["approved_label"] or row["device_label"],
                    row["applicant"],
                    source_ip,
                    source_ip,
                    int(row["decided_by_user_id"]),
                    _iso(approved_at),
                    _iso(expires_at),
                    _iso(now),
                ),
            )
            device_id = int(cursor.lastrowid)
            update = connection.execute(
                "UPDATE device_access_requests SET approved_device_id=?,"
                "exchange_consumed_at=?,last_ip=? "
                "WHERE id=? AND exchange_consumed_at IS NULL AND approved_device_id IS NULL",
                (device_id, _iso(now), source_ip, row["id"]),
            )
            if update.rowcount != 1:
                raise ConflictError("设备授权已领取")
            self._audit(
                connection,
                "request.exchanged",
                request_id=row["id"],
                device_id=device_id,
                source_ip=source_ip,
            )
            result = _mapping(connection.execute(
                "SELECT * FROM device_access_requests WHERE id=?", (row["id"],)
            ).fetchone())
            result["approved_at"] = _iso(approved_at)
            result["expires_at"] = _iso(expires_at)
            return result, raw_token

    def authorize_device(self, ip, raw_token) -> dict | None:
        try:
            source_ip = _clean_ip(ip)
        except ValidationError:
            return None
        supplied = str(raw_token or "")
        if len(supplied) < 16:
            return None
        candidate_hashes = credential_hashes(
            self.verification_secrets, "device", supplied
        )
        now = self._now()
        with closing(self._connect()) as connection, connection:
            row = None
            matched_key_id = None
            for key_id, token_hash in candidate_hashes:
                row = _mapping(connection.execute(
                    "SELECT * FROM approved_devices WHERE token_hash=?",
                    (token_hash,),
                ).fetchone())
                if row:
                    matched_key_id = key_id
                    break
            if (
                not row
                or not bool(row["enabled"])
                or row["revoked_at"]
                or (_parse(row["expires_at"]) or datetime.min.replace(tzinfo=timezone.utc)) < now
            ):
                return None
            last_seen = _parse(row["last_seen_at"])
            if row["last_ip"] != source_ip or not last_seen or now - last_seen >= _SEEN_THROTTLE:
                next_seen = _iso(now) if not last_seen or now - last_seen >= _SEEN_THROTTLE else row["last_seen_at"]
                connection.execute(
                    "UPDATE approved_devices SET last_ip=?,last_seen_at=? WHERE id=?",
                    (source_ip, next_seen, row["id"]),
                )
                row["last_ip"] = source_ip
                row["last_seen_at"] = next_seen
                if self.keyring is not None and matched_key_id:
                    self.keyring.mark_used(matched_key_id)
            return row

    def set_device_enabled(self, device_id, enabled, admin_user_id) -> dict:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            row = _mapping(connection.execute(
                "SELECT * FROM approved_devices WHERE id=?", (int(device_id),)
            ).fetchone())
            if not row:
                raise NotFoundError("设备不存在")
            if row["revoked_at"]:
                raise ConflictError("已撤销设备不能恢复")
            connection.execute(
                "UPDATE approved_devices SET enabled=? WHERE id=?",
                (int(bool(enabled)), int(device_id)),
            )
            self._audit(
                connection,
                "device.enabled" if enabled else "device.disabled",
                device_id=int(device_id),
                actor_user_id=int(admin_user_id),
            )
            row["enabled"] = int(bool(enabled))
            return row

    def revoke_device(self, device_id, admin_user_id) -> dict:
        now = _iso(self._now())
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            cursor = connection.execute(
                "UPDATE approved_devices SET enabled=0,revoked_at=?,revoked_by_user_id=? "
                "WHERE id=? AND revoked_at IS NULL",
                (now, int(admin_user_id), int(device_id)),
            )
            if cursor.rowcount != 1:
                if not connection.execute(
                    "SELECT 1 FROM approved_devices WHERE id=?", (int(device_id),)
                ).fetchone():
                    raise NotFoundError("设备不存在")
                raise ConflictError("设备已撤销")
            self._audit(
                connection,
                "device.revoked",
                device_id=int(device_id),
                actor_user_id=int(admin_user_id),
            )
            return _mapping(connection.execute(
                "SELECT * FROM approved_devices WHERE id=?", (int(device_id),)
            ).fetchone())

    def list_requests(self, status="pending") -> list[dict]:
        normalized = str(status or "pending").strip().lower()
        if normalized not in {"pending", "approved", "rejected", "cancelled"}:
            raise ValidationError("申请状态无效")
        with closing(self._connect()) as connection, connection:
            return [dict(row) for row in connection.execute(
                "SELECT * FROM device_access_requests WHERE status=? "
                "ORDER BY created_at DESC,id DESC",
                (normalized,),
            )]

    def list_devices(self) -> list[dict]:
        with closing(self._connect()) as connection, connection:
            return [dict(row) for row in connection.execute(
                "SELECT * FROM approved_devices ORDER BY approved_at DESC,id DESC"
            )]

    def _observer_hash(self, raw_token: str) -> str:
        return hmac.new(
            self.primary_secret,
            b"PM-DEVICE-OBSERVER\0" + str(raw_token).encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def issue_observer_token(self) -> str:
        nonce = secrets.token_urlsafe(24)
        signature = hmac.new(
            self.primary_secret,
            b"PM-DEVICE-OBSERVER-COOKIE\0" + nonce.encode("ascii"),
            hashlib.sha256,
        ).hexdigest()
        return f"{nonce}.{signature}"

    def verify_observer_token(self, raw_token) -> bool:
        try:
            nonce, supplied = str(raw_token or "").split(".", 1)
            if not 20 <= len(nonce) <= 64 or len(supplied) != 64:
                return False
            expected = hmac.new(
                self.primary_secret,
                b"PM-DEVICE-OBSERVER-COOKIE\0" + nonce.encode("ascii"),
                hashlib.sha256,
            ).hexdigest()
            return hmac.compare_digest(expected, supplied)
        except (UnicodeEncodeError, ValueError):
            return False

    def admission_enabled(self) -> bool:
        with closing(self._connect()) as connection:
            row = connection.execute(
                "SELECT enabled FROM device_admission_config WHERE singleton=1"
            ).fetchone()
        return bool(row and row["enabled"])

    def set_admission_enabled(self, enabled, *, actor_user_id) -> bool:
        if type(enabled) is not bool:
            raise ValidationError("设备准入开关值无效")
        now = _iso(self._now())
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                "INSERT INTO device_admission_config(singleton,enabled,updated_at,updated_by_user_id) "
                "VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET "
                "enabled=excluded.enabled,updated_at=excluded.updated_at,"
                "updated_by_user_id=excluded.updated_by_user_id",
                (int(enabled), now, int(actor_user_id)),
            )
            self._audit(
                connection,
                "device.admission.enabled" if enabled else "device.admission.disabled",
                actor_user_id=int(actor_user_id),
            )
        return enabled

    def observe_device(
        self, raw_token, source_ip, user_agent="", *, user_id=None, username=None
    ) -> dict:
        token = str(raw_token or "")
        if not self.verify_observer_token(token):
            raise ValidationError("设备标识无效")
        ip = _clean_ip(source_ip)
        agent = str(user_agent or "")[:1000]
        label = _client_label(agent)
        observer_hash = self._observer_hash(token)
        now = self._now()
        now_iso = _iso(now)
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            row = connection.execute(
                "SELECT * FROM observed_devices WHERE observer_hash=?", (observer_hash,)
            ).fetchone()
            if row is None:
                retention_cutoff = _iso(now - _OBSERVER_RETENTION)
                connection.execute(
                    "DELETE FROM observed_devices WHERE last_seen_at<?", (retention_cutoff,)
                )
                new_ip_count = connection.execute(
                    "SELECT COUNT(*) FROM observed_devices WHERE first_ip=? AND first_seen_at>=?",
                    (ip, _iso(now - timedelta(days=1))),
                ).fetchone()[0]
                if new_ip_count >= _OBSERVER_NEW_PER_IP_LIMIT:
                    raise RateLimitError("此地址记录的新设备过多")
                total = connection.execute(
                    "SELECT COUNT(*) FROM observed_devices"
                ).fetchone()[0]
                if total >= _OBSERVER_GLOBAL_LIMIT:
                    remove_count = total - _OBSERVER_GLOBAL_LIMIT + 1
                    connection.execute(
                        "DELETE FROM observed_devices WHERE id IN ("
                        "SELECT id FROM observed_devices ORDER BY last_seen_at ASC,id ASC LIMIT ?)",
                        (remove_count,),
                    )
                connection.execute(
                    "INSERT INTO observed_devices(observer_hash,first_ip,last_ip,user_agent,client_label,"
                    "first_seen_at,last_seen_at,activity_count,last_user_id,last_username) "
                    "VALUES(?,?,?,?,?,?,?,?,?,?)",
                    (observer_hash, ip, ip, agent, label, now_iso, now_iso, 1,
                     int(user_id) if user_id is not None else None,
                     str(username or "")[:120] or None),
                )
            else:
                previous = _parse(row["last_seen_at"])
                normalized_user_id = int(user_id) if user_id is not None else None
                normalized_username = str(username or "")[:120] or None
                interval_elapsed = previous is None or now - previous >= timedelta(minutes=1)
                identity_changed = (
                    normalized_user_id is not None and normalized_user_id != row["last_user_id"]
                ) or (
                    normalized_username is not None and normalized_username != row["last_username"]
                )
                connection_changed = ip != row["last_ip"] or agent != row["user_agent"]
                if interval_elapsed or identity_changed or connection_changed:
                    connection.execute(
                        "UPDATE observed_devices SET last_ip=?,user_agent=?,client_label=?,last_seen_at=?,"
                        "activity_count=activity_count+?,last_user_id=COALESCE(?,last_user_id),"
                        "last_username=COALESCE(?,last_username) WHERE observer_hash=?",
                        (ip, agent, label, now_iso, int(interval_elapsed),
                         normalized_user_id, normalized_username, observer_hash),
                    )
            return dict(connection.execute(
                "SELECT * FROM observed_devices WHERE observer_hash=?", (observer_hash,)
            ).fetchone())

    def list_observed_devices(self, limit=_OBSERVER_LIST_LIMIT) -> list[dict]:
        now = self._now()
        bounded = max(1, min(int(limit), _OBSERVER_LIST_LIMIT))
        with closing(self._connect()) as connection, connection:
            rows = [dict(row) for row in connection.execute(
                "SELECT * FROM observed_devices ORDER BY last_seen_at DESC,id DESC LIMIT ?",
                (bounded,),
            )]
        for row in rows:
            seen = _parse(row.get("last_seen_at"))
            row["online"] = bool(seen and now - seen <= _OBSERVER_ONLINE_WINDOW)
        return rows

    def count_observed_devices(self) -> int:
        with closing(self._connect()) as connection:
            return int(connection.execute(
                "SELECT COUNT(*) FROM observed_devices"
            ).fetchone()[0])

    def audit_keyring_event(
        self, event_type: str, admin_user_id: int, *, result="success", detail=None
    ) -> None:
        with closing(self._connect()) as connection, connection:
            self._audit(
                connection,
                event_type,
                actor_user_id=int(admin_user_id),
                result=result,
                detail=detail,
            )


_LOOKUP_COOKIE = "device_access_lookup"
_DEVICE_COOKIE = "device_access_token"
_ANONYMOUS_ENDPOINTS = {
    "device_access_request_page",
    "device_access_request_submit",
    "device_access_status",
}


def _public_request(row):
    allowed = {
        "id", "applicant", "device_label", "reason", "first_ip", "last_ip",
        "status", "created_at", "decided_at", "decided_by_user_id",
        "reject_reason", "approved_label", "approved_device_id", "exchange_consumed_at",
    }
    return {key: value for key, value in dict(row or {}).items() if key in allowed}


def _public_device(row):
    allowed = {
        "id", "label", "applicant", "enabled", "first_ip", "last_ip",
        "approved_by_user_id", "approved_at", "expires_at", "last_seen_at",
        "revoked_at", "revoked_by_user_id",
    }
    return {key: value for key, value in dict(row or {}).items() if key in allowed}


def _public_observed_device(row):
    allowed = {
        "id", "first_ip", "last_ip", "user_agent", "client_label",
        "first_seen_at", "last_seen_at", "activity_count", "last_user_id",
        "last_username", "online",
    }
    return {key: value for key, value in dict(row or {}).items() if key in allowed}


def _client_label(user_agent: str) -> str:
    value = str(user_agent or "")
    browser = "Edge" if "Edg/" in value else "Chrome" if "Chrome/" in value else "Firefox" if "Firefox/" in value else "Safari" if "Safari/" in value else "未知浏览器"
    system = "Android" if "Android" in value else "iPhone/iPad" if any(item in value for item in ("iPhone", "iPad")) else "Windows" if "Windows" in value else "macOS" if "Macintosh" in value else "Linux" if "Linux" in value else "未知系统"
    return f"{browser} · {system}"


def _loopback_address(value) -> bool:
    try:
        address = ipaddress.ip_address(str(value or ""))
    except ValueError:
        return False
    mapped = getattr(address, "ipv4_mapped", None)
    return address.is_loopback or bool(mapped and mapped.is_loopback)


def register(app, db, runtime):
    """Register device admission routes before the frozen V5 server starts."""
    if "device_admission_service" in app.extensions:
        return app.extensions["device_admission_service"]

    session = runtime["session"]
    request = runtime["request"]
    jsonify = runtime["jsonify"]
    redirect = runtime["redirect"]
    make_response = runtime["make_response"]
    User = runtime["User"]
    data_dir = Path(runtime["DATA_DIR"])
    database_path = runtime.get("DB_PATH") or app.config.get("DATABASE_PATH")
    if not database_path:
        database_path = getattr(getattr(getattr(db, "engine", None), "url", None), "database", None)
    if not database_path:
        raise RuntimeError("设备准入未配置数据库路径")
    keyring_module = runtime.get("device_keyring_module")
    if keyring_module is None:
        try:
            import device_keyring as keyring_module
        except ModuleNotFoundError:
            try:
                from src.backend_patches import device_keyring as keyring_module
            except ModuleNotFoundError:
                keyring_module = None
    master_key = runtime.get("MASTER_KEY")
    keyring = None
    if keyring_module is not None and isinstance(master_key, (bytes, bytearray)) and len(master_key) == 32:
        keyring = keyring_module.DeviceKeyring(
            database_path,
            runtime.get("connect_encrypted"),
            master_key,
        )
    service = DeviceAdmissionService(
        database_path,
        data_dir,
        encrypted_connect=runtime.get("connect_encrypted"),
        master_key=master_key,
        keyring=keyring,
    )
    service.ensure_schema()
    service.primary_secret
    app.extensions["device_admission_service"] = service

    try:
        import device_access_page
    except ModuleNotFoundError:
        from src.backend_patches import device_access_page

    signed_endpoints = set(runtime.get("signed_attachment_endpoints") or ())
    def admission_enabled():
        return service.admission_enabled()

    def json_error(status, code, message):
        response = jsonify({"error": message, "code": code})
        response.status_code = status
        return response

    def load_admin():
        user_id = session.get("user_id")
        if not user_id:
            return None, json_error(401, "login_required", "请先登录")
        try:
            user = db.session.get(User, int(user_id))
        except (TypeError, ValueError):
            user = None
        if not user or not bool(getattr(user, "is_active", True)):
            return None, json_error(401, "login_required", "账号不可用，请重新登录")
        if not bool(getattr(user, "is_admin", False)):
            return None, json_error(403, "admin_required", "只有管理员可以管理设备准入")
        return user, None

    def require_admin_write():
        user, error = load_admin()
        if error:
            return None, error
        expected = str(session.get("csrf_token") or "")
        supplied = str(request.headers.get("X-CSRFToken") or request.form.get("csrf_token") or "")
        if not expected or not hmac.compare_digest(expected, supplied):
            return None, json_error(403, "csrf_required", "请求已过期，请刷新后重试")
        return user, None

    def require_loopback_admin(*, write=False):
        if not _loopback_address(request.remote_addr):
            return None, json_error(
                403, "loopback_required", "设备授权迁移只能在运行电脑本机操作"
            )
        return require_admin_write() if write else load_admin()

    def render_page(state, *, status=200):
        csrf_token = str(session.get("device_access_csrf") or "")
        if not csrf_token:
            csrf_token = secrets.token_urlsafe(32)
            session["device_access_csrf"] = csrf_token
        response = make_response(device_access_page.render_request_page(state, csrf_token), status)
        response.headers["Cache-Control"] = "no-store"
        return response

    def set_lookup_cookie(response, lookup):
        response.set_cookie(
            _LOOKUP_COOKIE, lookup, max_age=172800, httponly=True,
            samesite="Strict", secure=False, path="/",
        )

    def request_page():
        lookup = request.cookies.get(_LOOKUP_COOKIE)
        state = {"status": "new"}
        if lookup:
            try:
                state = service.request_status(request.remote_addr, lookup)
            except DeviceAdmissionError:
                state = {"status": "new"}
        response = render_page(state)
        if not lookup or len(lookup) < 16:
            set_lookup_cookie(response, secrets.token_urlsafe(32))
        return response

    def request_submit():
        expected = str(session.get("device_access_csrf") or "")
        supplied = str(request.form.get("csrf_token") or "")
        if not expected or not hmac.compare_digest(expected, supplied):
            return render_page({"status": "new", "error": "请求已过期，请刷新后重试"}, status=403)
        lookup = request.cookies.get(_LOOKUP_COOKIE)
        if not lookup or len(lookup) < 16:
            lookup = secrets.token_urlsafe(32)
        try:
            state = service.submit_request(
                request.remote_addr, lookup, request.form.get("applicant"),
                request.form.get("device_label"), request.form.get("reason"),
            )
            response = render_page(state)
        except DeviceAdmissionError as exc:
            response = render_page({"status": "new", "error": str(exc)}, status=exc.status)
        set_lookup_cookie(response, lookup)
        return response

    def access_status():
        lookup = request.cookies.get(_LOOKUP_COOKIE)
        if not lookup:
            response = jsonify({"status": "new"})
        else:
            try:
                state, raw_token = service.exchange_approved_request(request.remote_addr, lookup)
                response = jsonify(_public_request(state))
                if raw_token:
                    response.set_cookie(
                        _DEVICE_COOKIE, raw_token, max_age=365 * 24 * 60 * 60,
                        httponly=True, samesite="Strict", secure=False, path="/",
                    )
                    response.delete_cookie(_LOOKUP_COOKIE, path="/", samesite="Strict")
            except NotFoundError:
                response = jsonify({"status": "new"})
            except DeviceAdmissionError as exc:
                response = json_error(exc.status, "device_request_invalid", str(exc))
        response.headers["Cache-Control"] = "no-store"
        return response

    def admin_summary():
        _, error = load_admin()
        if error:
            return error
        pending = service.list_requests("pending")
        approved = service.list_requests("approved")
        devices = service.list_devices()
        return jsonify({
            "admission_enabled": admission_enabled(),
            "pending": len(pending),
            "approved_waiting": sum(1 for row in approved if not row.get("approved_device_id")),
            "devices": len(devices),
            "enabled": sum(1 for row in devices if row.get("enabled") and not row.get("revoked_at")),
            "observed": service.count_observed_devices(),
        })

    def admin_requests():
        _, error = load_admin()
        if error:
            return error
        try:
            rows = service.list_requests(request.args.get("status", "pending"))
        except ValidationError as exc:
            return json_error(400, "validation_error", str(exc))
        return jsonify({"requests": [_public_request(row) for row in rows]})

    def admin_devices():
        _, error = load_admin()
        if error:
            return error
        return jsonify({"devices": [_public_device(row) for row in service.list_devices()]})

    def admin_observed_devices():
        _, error = load_admin()
        if error:
            return error
        return jsonify({"devices": [
            _public_observed_device(row) for row in service.list_observed_devices()
        ]})

    def update_config():
        user, error = require_admin_write()
        if error:
            return error
        payload = request.get_json(silent=True) or {}
        if type(payload.get("enabled")) is not bool:
            return json_error(400, "validation_error", "设备准入开关值无效")
        service.set_admission_enabled(payload["enabled"], actor_user_id=user.id)
        return jsonify({"admission_enabled": admission_enabled()})

    def write_result(callback):
        user, error = require_admin_write()
        if error:
            return error
        try:
            return callback(user)
        except ValidationError as exc:
            return json_error(400, "validation_error", str(exc))
        except NotFoundError as exc:
            return json_error(404, "not_found", str(exc))
        except ConflictError as exc:
            return json_error(409, "conflict", str(exc))

    def approve_request(request_id):
        payload = request.get_json(silent=True) or {}
        return write_result(lambda user: jsonify({"request": _public_request(
            service.approve(request_id, user.id, payload.get("label"))
        )}))

    def reject_request(request_id):
        payload = request.get_json(silent=True) or {}
        return write_result(lambda user: jsonify({"request": _public_request(
            service.reject(request_id, user.id, payload.get("reason"))
        )}))

    def set_enabled(device_id, enabled):
        return write_result(lambda user: jsonify({"device": _public_device(
            service.set_device_enabled(device_id, enabled, user.id)
        )}))

    def revoke(device_id):
        return write_result(lambda user: jsonify({"device": _public_device(
            service.revoke_device(device_id, user.id)
        )}))

    def keyring_status():
        _, error = require_loopback_admin()
        if error:
            return error
        if service.keyring is None:
            return json_error(503, "keyring_unavailable", "设备授权迁移功能不可用")
        try:
            service.primary_secret
            return jsonify(service.keyring.status())
        except (ValueError, OSError):
            return json_error(503, "keyring_unavailable", "无法读取设备准入密钥")

    def keyring_export():
        user, error = require_loopback_admin(write=True)
        if error:
            return error
        if service.keyring is None or keyring_module is None:
            return json_error(503, "keyring_unavailable", "设备授权迁移功能不可用")
        try:
            upload = request.files.get("key_file")
            source = "local_dpapi"
            if upload and upload.filename:
                wrapped = upload.stream.read(4097)
                if len(wrapped) > 4096:
                    raise ValidationError("设备密钥备份不能超过4 KiB")
                secret = _dpapi_transform(wrapped, False)
                if len(secret) != 32:
                    raise ValidationError("设备密钥备份无效")
                source = "backup"
            else:
                secret = service.primary_secret
            code = keyring_module.export_migration_code(secret, master_key)
            key_id = keyring_module.key_identifier(secret)
            service.audit_keyring_event(
                "device.keyring.exported",
                user.id,
                detail={"key_id_prefix": key_id[:12], "source": source},
            )
            return jsonify({"migration_code": code, "source": source})
        except (ValidationError, ValueError, OSError) as exc:
            message = str(exc) if isinstance(exc, ValidationError) else "无法读取设备准入密钥"
            return json_error(400, "device_key_export_failed", message)

    def keyring_import():
        user, error = require_loopback_admin(write=True)
        if error:
            return error
        if service.keyring is None or keyring_module is None:
            return json_error(503, "keyring_unavailable", "设备授权迁移功能不可用")
        payload = request.get_json(silent=True) or {}
        try:
            secret = keyring_module.import_migration_code(
                payload.get("migration_code"), master_key
            )
            imported = service.import_secret(secret, user.id)
            return jsonify({"imported": True, "status": imported["status"]})
        except (ValueError, OSError):
            return json_error(
                400,
                "device_key_import_failed",
                "迁移码无效或不属于当前数据库",
            )

    app.add_url_rule("/request-access", "device_access_request_page", request_page, methods=["GET"])
    app.add_url_rule("/request-access", "device_access_request_submit", request_submit, methods=["POST"])
    app.add_url_rule("/api/device-access/status", "device_access_status", access_status, methods=["GET"])
    app.add_url_rule("/api/device-access/summary", "device_access_admin_summary", admin_summary, methods=["GET"])
    app.add_url_rule("/api/device-access/requests", "device_access_admin_requests", admin_requests, methods=["GET"])
    app.add_url_rule("/api/device-access/devices", "device_access_admin_devices", admin_devices, methods=["GET"])
    app.add_url_rule("/api/device-access/observed-devices", "device_access_admin_observed", admin_observed_devices, methods=["GET"])
    app.add_url_rule("/api/device-access/config", "device_access_admin_config", update_config, methods=["PATCH"])
    app.add_url_rule("/api/device-access/requests/<int:request_id>/approve", "device_access_admin_approve", approve_request, methods=["POST"])
    app.add_url_rule("/api/device-access/requests/<int:request_id>/reject", "device_access_admin_reject", reject_request, methods=["POST"])
    app.add_url_rule("/api/device-access/devices/<int:device_id>/disable", "device_access_admin_disable", lambda device_id: set_enabled(device_id, False), methods=["POST"])
    app.add_url_rule("/api/device-access/devices/<int:device_id>/enable", "device_access_admin_enable", lambda device_id: set_enabled(device_id, True), methods=["POST"])
    app.add_url_rule("/api/device-access/devices/<int:device_id>", "device_access_admin_revoke", revoke, methods=["DELETE"])
    app.add_url_rule("/api/device-access/keyring/status", "device_access_keyring_status", keyring_status, methods=["GET"])
    app.add_url_rule("/api/device-access/keyring/export", "device_access_keyring_export", keyring_export, methods=["POST"])
    app.add_url_rule("/api/device-access/keyring/import", "device_access_keyring_import", keyring_import, methods=["POST"])

    def admission_gate():
        if _loopback_address(request.remote_addr):
            return None
        if not admission_enabled():
            observer_token = request.cookies.get(_OBSERVER_COOKIE)
            if not service.verify_observer_token(observer_token):
                observer_token = service.issue_observer_token()
                request.environ["pm.observer_cookie"] = observer_token
            user = None
            user_id = session.get("user_id")
            if user_id:
                try:
                    user = db.session.get(User, int(user_id))
                except (TypeError, ValueError):
                    user = None
            try:
                service.observe_device(
                    observer_token, request.remote_addr, request.headers.get("User-Agent", ""),
                    user_id=getattr(user, "id", None),
                    username=getattr(user, "username", None),
                )
            except Exception:
                pass
            return None
        endpoint = request.endpoint
        if endpoint in _ANONYMOUS_ENDPOINTS or endpoint in signed_endpoints:
            return None
        if service.authorize_device(request.remote_addr, request.cookies.get(_DEVICE_COOKIE)):
            return None
        if str(request.path or "").startswith("/api/"):
            return json_error(403, "device_not_approved", "此设备尚未获准访问")
        return redirect("/request-access")

    app.before_request(admission_gate)
    functions = app.before_request_funcs.setdefault(None, [])
    functions.remove(admission_gate)
    functions.insert(0, admission_gate)
    app.extensions["device_admission_gate"] = admission_gate

    @app.after_request
    def set_observer_cookie(response):
        observer_token = request.environ.get("pm.observer_cookie")
        if observer_token:
            response.set_cookie(
                _OBSERVER_COOKIE, observer_token,
                max_age=_OBSERVER_COOKIE_DAYS * 24 * 60 * 60,
                httponly=True, samesite="Strict", secure=False, path="/",
            )
        return response
    return service
