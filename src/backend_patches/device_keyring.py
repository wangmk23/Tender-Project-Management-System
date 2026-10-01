"""Portable encrypted keyring for V5 device admission migration."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path

from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes


_ROW_INFO = b"project-manager/device-admission-keyring/v1"
_MIGRATION_INFO = b"project-manager/device-admission-migration/v1"
_ROW_AAD = b"PM-DEVICE-KEYRING-V1\0"
_MIGRATION_AAD = b"PM-DEVICE-MIGRATION-V1\0"
_VALID_STATES = {"primary", "legacy"}
_VALID_SOURCES = {"local_dpapi", "migration_code", "backup"}
_MAX_CODE_LENGTH = 8192


class KeyringError(ValueError):
    pass


class MigrationCodeError(KeyringError):
    pass


def _require_key(value, label: str) -> bytes:
    try:
        raw = bytes(value)
    except (TypeError, ValueError) as exc:
        raise KeyringError(f"{label}无效") from exc
    if len(raw) != 32:
        raise KeyringError(f"{label}长度无效")
    return raw


def _derived_key(master_key: bytes, info: bytes) -> bytes:
    master = _require_key(master_key, "数据主密钥")
    # RFC 5869 HKDF-SHA256 with an omitted salt (HashLen zero bytes).  Keeping
    # this tiny implementation avoids depending on optional high-level
    # cryptography modules that are absent from the historical frozen EXE.
    pseudorandom_key = hmac.new(bytes(32), master, hashlib.sha256).digest()
    return hmac.new(pseudorandom_key, info + b"\x01", hashlib.sha256).digest()


def _encrypt(key: bytes, nonce: bytes, plaintext: bytes, associated_data: bytes) -> bytes:
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    encryptor.authenticate_additional_data(associated_data)
    ciphertext = encryptor.update(plaintext) + encryptor.finalize()
    return ciphertext + encryptor.tag


def _decrypt(key: bytes, nonce: bytes, ciphertext: bytes, associated_data: bytes) -> bytes:
    if len(ciphertext) < 16:
        raise InvalidTag
    decryptor = Cipher(
        algorithms.AES(key), modes.GCM(nonce, ciphertext[-16:])
    ).decryptor()
    decryptor.authenticate_additional_data(associated_data)
    return decryptor.update(ciphertext[:-16]) + decryptor.finalize()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="microseconds")


def key_identifier(secret: bytes) -> str:
    value = _require_key(secret, "设备准入密钥")
    return hashlib.sha256(b"PM-DEVICE-KEY-ID\0" + value).hexdigest()


def _urlsafe_encode(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _urlsafe_decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def export_migration_code(secret: bytes, master_key: bytes) -> str:
    device_secret = _require_key(secret, "设备准入密钥")
    key_id = key_identifier(device_secret)
    nonce = secrets.token_bytes(12)
    payload = json.dumps(
        {
            "migration_id": secrets.token_hex(16),
            "secret": _urlsafe_encode(device_secret),
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    ciphertext = _encrypt(
        _derived_key(master_key, _MIGRATION_INFO),
        nonce,
        payload,
        _MIGRATION_AAD + key_id.encode("ascii"),
    )
    envelope = json.dumps(
        {
            "ciphertext": _urlsafe_encode(ciphertext),
            "key_id": key_id,
            "nonce": _urlsafe_encode(nonce),
            "version": 1,
        },
        ensure_ascii=True,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("ascii")
    return _urlsafe_encode(envelope)


def import_migration_code(code: str, master_key: bytes) -> bytes:
    normalized = str(code or "").strip()
    if not normalized or len(normalized) > _MAX_CODE_LENGTH:
        raise MigrationCodeError("迁移码无效")
    try:
        envelope = json.loads(_urlsafe_decode(normalized).decode("ascii"))
        if not isinstance(envelope, dict) or envelope.get("version") != 1:
            raise ValueError("version")
        key_id = str(envelope["key_id"])
        if len(key_id) != 64:
            raise ValueError("key_id")
        nonce = _urlsafe_decode(str(envelope["nonce"]))
        ciphertext = _urlsafe_decode(str(envelope["ciphertext"]))
        if len(nonce) != 12 or len(ciphertext) < 17:
            raise ValueError("envelope")
        payload_raw = _decrypt(
            _derived_key(master_key, _MIGRATION_INFO),
            nonce,
            ciphertext,
            _MIGRATION_AAD + key_id.encode("ascii"),
        )
        payload = json.loads(payload_raw.decode("ascii"))
        if not isinstance(payload, dict) or len(str(payload.get("migration_id", ""))) != 32:
            raise ValueError("payload")
        secret = _urlsafe_decode(str(payload["secret"]))
        if key_identifier(secret) != key_id:
            raise ValueError("key mismatch")
        return _require_key(secret, "设备准入密钥")
    except (InvalidTag, KeyError, TypeError, ValueError, UnicodeError, json.JSONDecodeError) as exc:
        raise MigrationCodeError("迁移码无效或不属于当前数据库") from exc


class DeviceKeyring:
    def __init__(
        self,
        database_path,
        encrypted_connect,
        master_key,
        *,
        clock=None,
        limit=8,
    ):
        self.database_path = Path(database_path)
        self.encrypted_connect = encrypted_connect
        self.master_key = _require_key(master_key, "数据主密钥")
        self.clock = clock
        self.limit = int(limit)
        if self.limit < 1 or self.limit > 32:
            raise KeyringError("设备密钥数量上限无效")
        self._wrap_key = _derived_key(self.master_key, _ROW_INFO)
        self.ensure_schema()

    def _connect(self):
        self.database_path.parent.mkdir(parents=True, exist_ok=True)
        if self.encrypted_connect is None:
            import sqlite3

            return sqlite3.connect(str(self.database_path), timeout=5)
        return self.encrypted_connect(self.database_path, self.master_key, False)

    def _now(self) -> str:
        if self.clock is None:
            return _utc_now()
        value = self.clock()
        if isinstance(value, datetime):
            if value.tzinfo is None:
                value = value.replace(tzinfo=timezone.utc)
            return value.astimezone(timezone.utc).isoformat(timespec="microseconds")
        return str(value)

    def ensure_schema(self) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "CREATE TABLE IF NOT EXISTS device_admission_keys ("
                "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                "key_id TEXT NOT NULL UNIQUE,"
                "nonce BLOB NOT NULL,"
                "ciphertext BLOB NOT NULL,"
                "state TEXT NOT NULL,"
                "source TEXT NOT NULL,"
                "created_at TEXT NOT NULL,"
                "last_used_at TEXT)"
            )
            connection.execute(
                "CREATE INDEX IF NOT EXISTS idx_device_admission_keys_state "
                "ON device_admission_keys(state,id)"
            )

    def _wrap(self, secret: bytes, key_id: str) -> tuple[bytes, bytes]:
        nonce = secrets.token_bytes(12)
        ciphertext = _encrypt(
            self._wrap_key,
            nonce,
            secret,
            _ROW_AAD + key_id.encode("ascii"),
        )
        return nonce, ciphertext

    def _unwrap(self, key_id: str, nonce: bytes, ciphertext: bytes) -> bytes:
        try:
            secret = _decrypt(
                self._wrap_key,
                bytes(nonce),
                bytes(ciphertext),
                _ROW_AAD + key_id.encode("ascii"),
            )
            secret = _require_key(secret, "设备准入密钥")
            if key_identifier(secret) != key_id:
                raise KeyringError("设备密钥标识不匹配")
            return secret
        except (InvalidTag, TypeError, ValueError, KeyringError) as exc:
            raise KeyringError("设备密钥环认证失败") from exc

    def _enroll_on(self, connection, secret: bytes, *, source: str, primary: bool) -> dict:
        value = _require_key(secret, "设备准入密钥")
        normalized_source = str(source or "")
        if normalized_source not in _VALID_SOURCES:
            raise KeyringError("设备密钥来源无效")
        key_id = key_identifier(value)
        state = "primary" if primary else "legacy"
        nonce, ciphertext = self._wrap(value, key_id)
        existing = connection.execute(
            "SELECT id,state FROM device_admission_keys WHERE key_id=?", (key_id,)
        ).fetchone()
        created = existing is None
        promoted = bool(primary and existing is not None and existing[1] != "primary")
        if created:
            count = int(
                connection.execute(
                    "SELECT COUNT(*) FROM device_admission_keys"
                ).fetchone()[0]
            )
            if count >= self.limit:
                raise KeyringError("设备历史密钥数量已达上限")
            connection.execute(
                "INSERT INTO device_admission_keys("
                "key_id,nonce,ciphertext,state,source,created_at) VALUES(?,?,?,?,?,?)",
                (key_id, nonce, ciphertext, state, normalized_source, self._now()),
            )
        else:
            # Re-enrollment proves possession of the original plaintext and can
            # safely repair a corrupted encrypted row without changing its id.
            connection.execute(
                "UPDATE device_admission_keys SET nonce=?,ciphertext=? WHERE key_id=?",
                (nonce, ciphertext, key_id),
            )
        if primary:
            connection.execute(
                "UPDATE device_admission_keys SET state='legacy' WHERE key_id<>?",
                (key_id,),
            )
            connection.execute(
                "UPDATE device_admission_keys SET state='primary',source=? WHERE key_id=?",
                (normalized_source, key_id),
            )
        row = connection.execute(
            "SELECT key_id,state,source,created_at,last_used_at "
            "FROM device_admission_keys WHERE key_id=?",
            (key_id,),
        ).fetchone()
        return {
            "key_id": row[0],
            "state": row[1],
            "source": row[2],
            "created_at": row[3],
            "last_used_at": row[4],
            "created": created,
            "promoted": promoted,
        }

    def enroll_in_transaction(
        self, connection, secret: bytes, *, source: str, primary: bool
    ) -> dict:
        return self._enroll_on(
            connection, secret, source=source, primary=primary
        )

    def enroll(self, secret: bytes, *, source: str, primary: bool) -> dict:
        with closing(self._connect()) as connection, connection:
            connection.execute("BEGIN IMMEDIATE")
            return self._enroll_on(
                connection, secret, source=source, primary=primary
            )

    def _rows(self):
        with closing(self._connect()) as connection:
            return connection.execute(
                "SELECT key_id,nonce,ciphertext,state,source,created_at,last_used_at "
                "FROM device_admission_keys "
                "ORDER BY CASE state WHEN 'primary' THEN 0 ELSE 1 END,id"
            ).fetchall()

    def verification_entries_with_failures(
        self,
    ) -> tuple[list[tuple[str, bytes]], list[dict]]:
        entries = []
        failures = []
        for row in self._rows():
            if row[3] not in _VALID_STATES or row[4] not in _VALID_SOURCES:
                raise KeyringError("设备密钥环状态无效")
            try:
                entries.append((row[0], self._unwrap(row[0], row[1], row[2])))
            except KeyringError:
                if row[3] == "primary":
                    raise
                failures.append({
                    "error_code": "KEYRING_RECORD_AUTH_FAILED",
                    "key_id_prefix": row[0][:12],
                })
        return entries, failures

    def verification_entries(self) -> list[tuple[str, bytes]]:
        entries, _ = self.verification_entries_with_failures()
        return entries

    def verification_keys(self) -> list[bytes]:
        return [secret for _, secret in self.verification_entries()]

    def primary_key(self) -> bytes | None:
        rows = self._rows()
        primary = [row for row in rows if row[3] == "primary"]
        if len(primary) > 1:
            raise KeyringError("设备密钥环存在多个主密钥")
        if not primary:
            return None
        row = primary[0]
        return self._unwrap(row[0], row[1], row[2])

    def mark_used(self, key_id: str) -> None:
        with closing(self._connect()) as connection, connection:
            connection.execute(
                "UPDATE device_admission_keys SET last_used_at=? WHERE key_id=?",
                (self._now(), str(key_id)),
            )

    def status(self, connection=None) -> dict:
        rows = self._rows() if connection is None else connection.execute(
            "SELECT key_id,nonce,ciphertext,state,source,created_at,last_used_at "
            "FROM device_admission_keys "
            "ORDER BY CASE state WHEN 'primary' THEN 0 ELSE 1 END,id"
        ).fetchall()
        for row in rows:
            if row[3] not in _VALID_STATES or row[4] not in _VALID_SOURCES:
                raise KeyringError("设备密钥环状态无效")
        return {
            "ready": any(row[3] == "primary" for row in rows),
            "key_count": len(rows),
            "legacy_count": sum(row[3] == "legacy" for row in rows),
            "last_used_at": max((row[6] for row in rows if row[6]), default=None),
        }
