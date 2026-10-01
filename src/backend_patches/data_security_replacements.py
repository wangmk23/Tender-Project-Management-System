"""Replacement functions for interactive, file-independent data recovery."""


def load_or_create_master_key(data_dir, require_recovery=False, existing_encrypted=False):
    """Load, recover, or create the application master key."""

    from pathlib import Path
    import os
    import secrets
    try:
        import data_recovery
    except ModuleNotFoundError:
        from src.backend_patches import data_recovery

    _interactive_recovery_marker = "v5-interactive-recovery-v1"
    data_dir = Path(data_dir)
    key_path = data_dir / KEY_FILE

    def legacy_recovery_files():
        recovery_dir = _usb_recovery_dir()
        return (
            sorted(
                recovery_dir.glob(f"{RECOVERY_PREFIX}*.txt"),
                key=lambda path: path.stat().st_mtime,
                reverse=True,
            )
            if recovery_dir
            else []
        )

    def interactive_recovery(cause=None):
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
                    raise data_recovery.RecoveryValidationError(
                        "恢复密钥与现有数据不匹配"
                    ) from exc
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
                pass
        return interactive_recovery()

    # A clean installation no longer depends on a specially named external folder.
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
