"""Open-source at-rest encryption and recovery-key management for the public edition (Stage 5).

open-data-security-v1
"""
from __future__ import annotations

import base64
import ctypes
from datetime import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import secrets
import shutil
import sqlite3
from typing import Iterator

from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

try:
    from licensing import _dpapi_protect, _dpapi_unprotect, machine_fingerprint
except ModuleNotFoundError:  # pragma: no cover - standalone public edition fallback
    try:
        from public_licensing import _dpapi_protect, _dpapi_unprotect, machine_fingerprint
    except ModuleNotFoundError:
        from src.backend_patches.public_licensing import (
            _dpapi_protect,
            _dpapi_unprotect,
            machine_fingerprint,
        )


OPEN_DATA_SECURITY_SIGNATURE = "open-data-security-v1"
KEY_FILE = "data_key.dpapi"
RECOVERY_PREFIX = "项目管理系统_数据恢复密钥_"
FILE_MAGIC = b"PMENC01\x00"
FILE_HEADER_SIZE = len(FILE_MAGIC) + 12 + 8
FILE_TAG_SIZE = 16


def _sql_key(key: bytes) -> str:
    return f"PRAGMA key=\"x'{key.hex()}'\""


def _usb_recovery_dir() -> Path | None:
    configured = os.environ.get("PROJECT_MGR_RECOVERY_DIR", "").strip()
    if configured:
        path = Path(configured)
        path.mkdir(parents=True, exist_ok=True)
        return path
    if os.name == "nt":
        get_drive_type = ctypes.windll.kernel32.GetDriveTypeW
        for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
            root = Path(f"{letter}:\\")
            tool_dir = root / "项目管理系统授权工具"
            if tool_dir.exists():
                return tool_dir
        for letter in "DEFGHIJKLMNOPQRSTUVWXYZ":
            root = Path(f"{letter}:\\")
            if root.exists() and get_drive_type(str(root)) == 2:
                path = root / "项目管理系统恢复密钥"
                path.mkdir(exist_ok=True)
                return path
    return None


def _write_recovery_key(key: bytes, recovery_dir: Path) -> Path:
    device = machine_fingerprint()["device_code"]
    path = recovery_dir / f"{RECOVERY_PREFIX}{device}.txt"
    payload = {
        "format": 1,
        "device_code": device,
        "created_at": datetime.now().isoformat(timespec="seconds"),
        "key_base64": base64.urlsafe_b64encode(key).decode("ascii"),
        "notice": "此文件可恢复数据库和附件。请仅保存在授权U盘，不要复制到客户电脑。",
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return path


def is_plain_sqlite(path: str | Path) -> bool:
    path = Path(path)
    if not path.exists() or path.stat().st_size < 16:
        return False
    with path.open("rb") as stream:
        return stream.read(16) == b"SQLite format 3\x00"


def connect_encrypted(path: str | Path, key: bytes, check_same_thread: bool = True):
    try:
        import sqlcipher3  # type: ignore[import-not-found]

        conn = sqlcipher3.connect(str(path), timeout=30, check_same_thread=check_same_thread)
        conn.execute(_sql_key(key))
    except ModuleNotFoundError:
        conn = sqlite3.connect(str(path), timeout=30, check_same_thread=check_same_thread)
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def restore_master_key(data_dir: str | Path, recovery_file: str | Path) -> bytes:
    payload = json.loads(Path(recovery_file).read_text(encoding="utf-8"))
    key = base64.urlsafe_b64decode(payload["key_base64"])
    if len(key) != 32:
        raise ValueError("恢复密钥格式错误")
    (Path(data_dir) / KEY_FILE).write_bytes(_dpapi_protect(key))
    return key


def load_or_create_master_key(
    data_dir: str | Path,
    require_recovery: bool = True,
    existing_encrypted: bool = False,
) -> tuple[bytes, Path | None]:
    """Load, recover, or create the application master key."""
    try:
        import data_recovery
    except ModuleNotFoundError:  # pragma: no cover
        from src.backend_patches import data_recovery

    _interactive_recovery_marker = "v5-interactive-recovery-v1"
    data_dir = Path(data_dir)
    key_path = data_dir / KEY_FILE

    def legacy_recovery_files() -> list[Path]:
        recovery_dir = _usb_recovery_dir()
        if recovery_dir:
            return sorted(
                recovery_dir.glob(f"{RECOVERY_PREFIX}*.txt"),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            )
        return []

    def interactive_recovery(cause: Exception | None = None) -> tuple[bytes, Path | None]:
        material = data_recovery.prompt_for_recovery_material(cause)
        if not material:
            if cause is None:
                raise RuntimeError("检测到已有数据，请输入数据恢复密钥后重试")
            raise RuntimeError("本机无法解密数据密钥，请输入数据恢复密钥后重试") from cause
        try:
            key = data_recovery.parse_recovery_material(material)
            database_path = data_dir / "bidding.db"
            if existing_encrypted and database_path.is_file():
                connection = None
                try:
                    connection = connect_encrypted(database_path, key, False)
                    connection.execute("SELECT count(*) FROM sqlite_master").fetchone()
                except Exception as exc:
                    raise data_recovery.RecoveryValidationError("恢复密钥与现有数据不匹配") from exc
                finally:
                    if connection is not None:
                        connection.close()
            data_recovery.bind_recovery_material(
                data_dir,
                material,
                expected_key=None,
                protect=_dpapi_protect,
            )
            return key, None
        except data_recovery.RecoveryValidationError as exc:
            raise RuntimeError(str(exc)) from exc

    if key_path.exists():
        try:
            key = _dpapi_unprotect(key_path.read_bytes())
            if len(key) != 32:
                raise ValueError("invalid key length")
            return key, None
        except Exception as exc:
            files = legacy_recovery_files()
            if files:
                try:
                    key = restore_master_key(data_dir, files[0])
                    return key, files[0]
                except Exception:
                    pass
            return interactive_recovery(exc)

    files = legacy_recovery_files()
    if existing_encrypted:
        if files:
            try:
                key = restore_master_key(data_dir, files[0])
                return key, files[0]
            except Exception:
                return interactive_recovery()
        return interactive_recovery()

    data_dir.mkdir(parents=True, exist_ok=True)
    key = secrets.token_bytes(32)
    recovery_dir = _usb_recovery_dir()
    recovery_path = _write_recovery_key(key, recovery_dir) if recovery_dir else None
    temp = key_path.with_suffix(".tmp")
    try:
        temp.write_bytes(_dpapi_protect(key))
        os.replace(temp, key_path)
    finally:
        temp.unlink(missing_ok=True)
    return key, recovery_path


def migrate_plain_database(path: str | Path, key: bytes, safety_dir: str | Path) -> Path | None:
    path = Path(path)
    if not is_plain_sqlite(path):
        return None
    safety_dir = Path(safety_dir)
    safety_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    safety_copy = safety_dir / f"迁移前数据库_{stamp}.db"
    shutil.copy2(path, safety_copy)
    encrypted = path.with_suffix(".encrypted.tmp")
    encrypted.unlink(missing_ok=True)
    source = sqlite3.connect(str(path), timeout=30)
    target = connect_encrypted(encrypted, key)
    try:
        target.execute("PRAGMA foreign_keys=OFF")
        script = "\n".join(source.iterdump())
        target.executescript(script)
        target.commit()
        target.execute("PRAGMA foreign_keys=ON")
    finally:
        target.close()
        source.close()
    check = connect_encrypted(encrypted, key)
    try:
        result = check.execute("PRAGMA integrity_check").fetchone()
        if not result or result[0] != "ok":
            raise RuntimeError("加密数据库完整性校验失败")
    finally:
        check.close()
    path.unlink()
    encrypted.rename(path)
    return safety_copy


def attachment_key(master_key: bytes) -> bytes:
    return hmac.new(master_key, b"project-manager/attachments/v1", hashlib.sha256).digest()


def is_encrypted_file(path: str | Path) -> bool:
    try:
        with Path(path).open("rb") as stream:
            return stream.read(len(FILE_MAGIC)) == FILE_MAGIC
    except OSError:
        return False


def encrypt_file(path: str | Path, key: bytes) -> bool:
    path = Path(path)
    if is_encrypted_file(path):
        return False
    nonce = secrets.token_bytes(12)
    size = path.stat().st_size
    temp = path.with_name(path.name + ".encrypting")
    encryptor = Cipher(algorithms.AES(key), modes.GCM(nonce)).encryptor()
    try:
        with path.open("rb") as source, temp.open("wb") as target:
            target.write(FILE_MAGIC + nonce + size.to_bytes(8, "big"))
            for chunk in iter(lambda: source.read(1048576), b""):
                target.write(encryptor.update(chunk))
            target.write(encryptor.finalize())
            target.write(encryptor.tag)
        os.replace(temp, path)
    finally:
        temp.unlink(missing_ok=True)
    return True


def encrypted_file_size(path: str | Path) -> int:
    with Path(path).open("rb") as stream:
        header = stream.read(FILE_HEADER_SIZE)
    if len(header) != FILE_HEADER_SIZE or not header.startswith(FILE_MAGIC):
        return Path(path).stat().st_size
    return int.from_bytes(header[-8:], "big")


def iter_decrypted_file(
    path: str | Path,
    key: bytes,
    chunk_size: int = 1048576,
) -> Iterator[bytes]:
    path = Path(path)
    if not is_encrypted_file(path):
        with path.open("rb") as source:
            for chunk in iter(lambda: source.read(chunk_size), b""):
                yield chunk
        return
    with path.open("rb") as source:
        header = source.read(FILE_HEADER_SIZE)
        nonce = header[len(FILE_MAGIC) : len(FILE_MAGIC) + 12]
        ciphertext_size = path.stat().st_size - FILE_HEADER_SIZE - FILE_TAG_SIZE
        source.seek(-FILE_TAG_SIZE, os.SEEK_END)
        tag = source.read(FILE_TAG_SIZE)
        source.seek(FILE_HEADER_SIZE)
        decryptor = Cipher(algorithms.AES(key), modes.GCM(nonce, tag)).decryptor()
        remaining = ciphertext_size
        while remaining:
            chunk = source.read(min(chunk_size, remaining))
            if not chunk:
                raise ValueError("加密附件内容不完整")
            remaining -= len(chunk)
            output = decryptor.update(chunk)
            if output:
                yield output
        final = decryptor.finalize()
        if final:
            yield final


def decrypt_file_to(path: str | Path, target: str | Path, key: bytes) -> None:
    target = Path(target)
    temp = target.with_name(target.name + ".decrypting")
    try:
        with temp.open("wb") as output:
            for chunk in iter_decrypted_file(path, key):
                output.write(chunk)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def migrate_attachment_tree(upload_dir: str | Path, key: bytes) -> int:
    migrated = 0
    for path in Path(upload_dir).rglob("*"):
        if not path.is_file() or path.name.endswith((".encrypting", ".decrypting")):
            continue
        migrated += int(encrypt_file(path, key))
    return migrated


def migrate_legacy_backups(backup_dir: str | Path, key: bytes) -> int:
    migrated = 0
    backup_dir = Path(backup_dir)
    if not backup_dir.exists():
        return migrated
    for path in backup_dir.rglob("*"):
        if not path.is_file() or path.name.endswith((".encrypting", ".decrypting")):
            continue
        if path.suffix.lower() not in {".zip", ".db"} or is_encrypted_file(path):
            continue
        migrated += int(encrypt_file(path, key))
    return migrated
