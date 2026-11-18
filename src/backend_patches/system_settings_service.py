"""System settings, startup registry, and full backup orchestration service.

system-settings-service-v1
"""
from __future__ import annotations

from pathlib import Path as _default_Path
from typing import Any

try:
    from sqlalchemy import text as _default_text
except Exception:  # pragma: no cover
    def _default_text(sql: str) -> str:
        return sql

SYSTEM_SETTINGS_SERVICE_SIGNATURE = "system-settings-service-v1"


def _ctx(ctx: Any = None):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    if ctx is None:
        return runtime_context.current_context(depth=2)
    return runtime_context.get_runtime_context(ctx)


def save_app_settings(ctx: Any, settings: dict[str, Any]):
    ctx = _ctx(ctx)
    SETTINGS_PATH = ctx.get("SETTINGS_PATH")
    load_app_settings = ctx.get("load_app_settings")
    import json
    import os
    import tempfile
    try:
        import stage_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates
    with stage_templates.settings_write_lock:
        if SETTINGS_PATH.exists():
            try:
                existing = json.loads(SETTINGS_PATH.read_text(encoding='utf-8'))
                if not isinstance(existing, dict):
                    raise ValueError('settings must be an object')
            except (ValueError, UnicodeError) as error:
                raise ValueError(f'系统设置文件损坏，原文件已保留：{SETTINGS_PATH}；请从备份恢复设置后重试') from error
        current = load_app_settings()
        current.update(settings)
        payload = json.dumps(current, ensure_ascii=False, indent=2)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=SETTINGS_PATH.parent,
                                             prefix=SETTINGS_PATH.name+'.', suffix='.tmp', delete=False) as stream:
                temporary = stream.name
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, SETTINGS_PATH)
        finally:
            if temporary is not None:
                from pathlib import Path
                Path(temporary).unlink(missing_ok=True)
        return current


def create_full_backup(original=None):
    import types
    import uuid

    if not callable(original):
        raise RuntimeError("备份运行时不可用")
    runtime = original.__globals__.copy()
    clock = runtime["datetime"]
    nonce = uuid.uuid4().hex

    class BackupClock(clock):
        def strftime(self, format):
            if format == "%Y%m%d_%H%M%S":
                return super().strftime("%Y%m%d_%H%M%S_%f") + "_" + nonce
            return super().strftime(format)

    runtime["datetime"] = BackupClock
    isolated = types.FunctionType(original.__code__, runtime, original.__name__,
                                  original.__defaults__, original.__closure__)
    isolated.__kwdefaults__ = original.__kwdefaults__
    return isolated()


def get_export_dir(ctx: Any = None):
    ctx = _ctx(ctx)
    DATA_DIR = ctx.get("DATA_DIR")
    load_app_settings = ctx.get("load_app_settings")
    import sys
    from pathlib import Path
    configured = load_app_settings().get("export_folder") or ""
    base = Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(DATA_DIR)
    default = base / "exports"
    folder = Path(configured).expanduser() if configured else default
    try:
        folder.mkdir(parents=True, exist_ok=True)
        return folder.resolve()
    except (OSError, ValueError):
        # A stale path from another Windows account must not break settings.
        # If even the default is unwritable, keep settings accessible so users
        # can select a valid folder; the actual file write reports its error.
        try:
            default.mkdir(parents=True, exist_ok=True)
        except OSError:
            pass
        return default.resolve()


def api_get_settings(ctx: Any = None):
    ctx = _ctx(ctx)
    DATA_DIR = ctx.get("DATA_DIR")
    DB_PATH = ctx.get("DB_PATH")
    MASTER_KEY = ctx.get("MASTER_KEY")
    OperationLog = ctx.get("OperationLog")
    Path = ctx.get("Path", _default_Path)
    SETTINGS_PATH = ctx.get("SETTINGS_PATH")
    User = ctx.get("User")
    app = ctx.get("app")
    connect_encrypted = ctx.get("connect_encrypted")
    db = ctx.get("db")
    get_desktop_dir = ctx.get("get_desktop_dir")
    get_export_dir = ctx.get("get_export_dir")
    jsonify = ctx.get("jsonify")
    load_app_settings = ctx.get("load_app_settings")
    request = ctx.get("request")
    session = ctx.get("session", {})
    try:
        import stage_templates as settings_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates as settings_templates
    with settings_templates.settings_write_lock:
        import ipaddress
        import json
        import os
        import sys
        import winreg
        try:
            import reminder_routing
        except ModuleNotFoundError:
            from src.backend_patches import reminder_routing
        try:
            import stage_workflow
        except ModuleNotFoundError:
            from src.backend_patches import stage_workflow
        try:
            import stage_templates
        except ModuleNotFoundError:
            from src.backend_patches import stage_templates

        if request.args.get("project_activity_view", "").strip() == "recent":
            try:
                import project_activity
            except ModuleNotFoundError:
                from src.backend_patches import project_activity

            try:
                result = project_activity.read_activity(
                    db,
                    OperationLog,
                    User,
                    viewer={
                        "id": session.get("user_id"),
                        "is_admin": bool(session.get("is_admin")),
                    },
                    limit=request.args.get("limit", 30),
                    before_id=request.args.get("before_id"),
                    user_id=request.args.get("user_id"),
                    project_id=request.args.get("project_id"),
                    action=request.args.get("action"),
                )
                return jsonify(result)
            except ValueError as error:
                return jsonify({"error": str(error)}), 400
            except Exception:
                app.logger.exception("project activity read failed")
                return jsonify({"error": "读取项目操作记录失败"}), 500

        if request.args.get("purchaser_board_view", "").strip() == "bootstrap":
            try:
                import purchaser_classification
            except ModuleNotFoundError:
                from src.backend_patches import purchaser_classification

            try:
                result = purchaser_classification.read_purchaser_board(
                    DB_PATH,
                    DATA_DIR / "backups",
                    bool(session.get("is_admin")),
                    connect_encrypted,
                    MASTER_KEY,
                )
                return jsonify(result)
            except Exception:
                return jsonify({"error": "读取采购人分类看板失败"}), 500

        if not session.get("is_admin"):
            return jsonify({"is_desktop": bool(app.config.get("IS_DESKTOP"))})

        credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
        pending_path = credential_path.with_suffix(credential_path.suffix + ".tmp")
        credential_rollback_path = credential_path.with_suffix(
            credential_path.suffix + ".rollback"
        )
        settings_rollback_path = SETTINGS_PATH.with_name(
            SETTINGS_PATH.name + ".reminder-rollback"
        )
        transaction_path = SETTINGS_PATH.with_name("reminder_settings_transaction.json")
        if transaction_path.is_file():
            recovery_temporary = SETTINGS_PATH.with_name(
                SETTINGS_PATH.name + ".reminder-recovery"
            )
            credential_recovery_temporary = credential_path.with_suffix(
                credential_path.suffix + ".recovery"
            )
            try:
                transaction = json.loads(transaction_path.read_text(encoding="utf-8"))
                if transaction.get("version") != 1:
                    raise ValueError("unsupported reminder settings transaction")
                if pending_path.is_file():
                    if transaction.get("settings_existed"):
                        recovery_temporary.write_bytes(settings_rollback_path.read_bytes())
                        os.replace(recovery_temporary, SETTINGS_PATH)
                    else:
                        SETTINGS_PATH.unlink(missing_ok=True)
                    if transaction.get("mode") == "clear":
                        if transaction.get("credential_existed"):
                            credential_recovery_temporary.write_bytes(
                                credential_rollback_path.read_bytes()
                            )
                            os.replace(credential_recovery_temporary, credential_path)
                        else:
                            credential_path.unlink(missing_ok=True)
                    pending_path.unlink(missing_ok=True)
                settings_rollback_path.unlink(missing_ok=True)
                credential_rollback_path.unlink(missing_ok=True)
                transaction_path.unlink()
            except Exception:
                recovery_temporary.unlink(missing_ok=True)
                credential_recovery_temporary.unlink(missing_ok=True)
                return jsonify({"error": "邮件提醒设置事务恢复失败，自动发送已停止"}), 500

        settings = load_app_settings()
        response = {
            "export_folder": str(get_export_dir()),
            "configured_export_folder": settings.get("export_folder") or "",
            "login_subtitle": settings.get("login_subtitle") or "采购项目管理系统",
            "desktop_export_folder": str(get_desktop_dir() / "项目管理系统导出"),
            "program_export_folder": str((Path(sys.executable).resolve().parent if getattr(sys, "frozen", False) else Path(DATA_DIR)) / "exports"),
            "settings_path": str(SETTINGS_PATH),
            "is_desktop": bool(app.config.get("IS_DESKTOP")),
        }
        response["stage_order"] = stage_workflow.normalize_stage_order(
            settings.get("stage_order"),
            ctx.get("STAGES", []),
            warn=getattr(getattr(app, "logger", None), "warning", None),
        )
        response["stage_templates"] = stage_templates.normalize_stage_templates(
            settings.get("stage_templates"),
            ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
            ctx.get("STAGES", []),
            stage_order=response["stage_order"],
            warn=getattr(getattr(app, "logger", None), "warning", None),
            migrate_legacy_auto_completion=settings.get(
                "stage_auto_completion_policy_version"
            ) != 1,
        )
        response["stage_module_catalog"] = stage_templates.module_catalog_payload()
        response["reminder_stage_definitions"] = reminder_routing.reminder_stage_definitions(
            settings, ctx.get("STAGES", []), ctx.get("METHODS"),
            database=getattr(app, "extensions", {}).get("procurement_catalog", {}).get("db"),
        )
        reminder_defaults = {
            "reminder_enabled": False,
            "reminder_time": "09:00",
            "reminder_subject": "采购执行提醒：{date} 共 {count} 个节点",
            "reminder_advance_days": 0,
            "reminder_weekdays": [0, 1, 2, 3, 4, 5, 6],
            "smtp_host": "",
            "smtp_port": 465,
            "smtp_security": "ssl",
            "smtp_username": "",
            "smtp_sender": "",
            "reminder_recipients": [],
            "reminder_stage_keys": [
                stage["key"]
                for stage in ctx.get(
                    "STAGES",
                    [
                        {"key": key}
                        for key in (
                            "project_setup", "procurement_request", "agency_agreement", "document_draft",
                            "doc_review", "announcement", "registration_end", "bid_opening", "evaluation",
                            "result_notice", "winning_notice", "contract", "acceptance", "archive",
                        )
                    ],
                )
            ],
            "reminder_content": {
                "project_number": True,
                "project_name": True,
                "purchaser": True,
                "stage_name": True,
                "planned_at": True,
                "registration_count": True,
            },
            "event_reminder_create_enabled": False,
            "event_reminder_complete_enabled": False,
            "supplier_minimums": {
                "公开招标": 3, "竞争性磋商": 3, "竞争性谈判": 3, "邀请招标": 3,
                "网上竞价": 3, "单一来源": 1, "遴选": 3, "直选": 1,
            },
        }
        for key, default in reminder_defaults.items():
            response[key] = settings.get(key, default)
        if "reminder_stage_keys" not in settings:
            response["reminder_stage_keys"] = list(dict.fromkeys([
                *response["reminder_stage_keys"],
                *(stage["key"] for stage in response["reminder_stage_definitions"]),
            ]))
        try:
            response["reminder_recipient_groups"] = reminder_routing.normalize_recipient_groups(
                settings
            )
        except reminder_routing.RecipientGroupValidationError:
            response["reminder_recipient_groups"] = []
        response["smtp_password_configured"] = credential_path.is_file()
        state_path = SETTINGS_PATH.with_name("reminder_send_log.json")
        reminder_status = {}
        if state_path.is_file():
            try:
                reminder_status = json.loads(state_path.read_text(encoding="utf-8"))
            except (OSError, UnicodeError, json.JSONDecodeError):
                reminder_status = {"last_error": "提醒状态文件无法读取，自动发送已停止"}
        if not isinstance(reminder_status, dict):
            reminder_status = {}
            app.logger.warning('reminder status has invalid structure')
        response["reminder_status"] = {
            key: reminder_status.get(key)
            for key in ("last_check_at", "last_success_at", "last_error", "sent_today")
        }
        if not isinstance(response["reminder_status"]["last_error"], str) or response["reminder_status"]["last_error"] not in reminder_routing.SAFE_ERROR_CODES:
            response["reminder_status"]["last_error"] = None

        def safe_runtime_status(path, event_type):
            from datetime import datetime

            status = {
                "last_check_at": None,
                "last_success_at": None,
                "error_code": None,
                "pending_count": 0,
            }
            if not path.is_file():
                return status
            try:
                value = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(value, dict):
                    return status
                nested = value.get("runtime_status")
                source = nested.get(event_type, {}) if isinstance(nested, dict) else value
                if not isinstance(source, dict):
                    return status
                for key in ("last_check_at", "last_success_at"):
                    raw = source.get(key)
                    if isinstance(raw, str) and len(raw) <= 40:
                        try:
                            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                        except ValueError:
                            parsed = None
                        status[key] = raw if parsed is not None else None
                error_code = source.get("error_code", source.get("last_error"))
                status["error_code"] = (
                    error_code if isinstance(error_code, str) and error_code in reminder_routing.SAFE_ERROR_CODES else None
                )
                pending_count = source.get("pending_count")
                if type(pending_count) is int and pending_count >= 0:
                    status["pending_count"] = pending_count
                else:
                    pending = value.get("pending_deliveries", value.get("pending_events", {}))
                    if isinstance(pending, dict):
                        status["pending_count"] = sum(
                            1
                            for item in pending.values()
                            if isinstance(item, dict)
                            and item.get("status", "pending") == "pending"
                            and (
                                item.get("event_type") == event_type
                                or str(item.get("event_key") or "").startswith(
                                    "create" if event_type == "project_create" else "complete"
                                )
                            )
                        )
            except (OSError, UnicodeError, json.JSONDecodeError):
                return status
            return status

        daily_delivery_state_path = SETTINGS_PATH.with_name(
            "daily_stage_delivery_state.json"
        )
        if not daily_delivery_state_path.is_file():
            daily_delivery_state_path = SETTINGS_PATH.with_name("reminder_send_log.json")
        response["reminder_runtime_status"] = {
            "daily_stage": safe_runtime_status(
                daily_delivery_state_path, "daily_stage"
            ),
            "project_create": safe_runtime_status(
                SETTINGS_PATH.with_name("project_events_state.json"), "project_create"
            ),
            "project_complete": safe_runtime_status(
                SETTINGS_PATH.with_name("project_events_state.json"), "project_complete"
            ),
            "supplier_shortage": safe_runtime_status(
                SETTINGS_PATH.with_name("supplier_reminder_status.json"),
                "supplier_shortage",
            ),
        }

        try:
            remote = ipaddress.ip_address(request.remote_addr or "")
            mapped = getattr(remote, "ipv4_mapped", None)
            loopback = remote.is_loopback or bool(mapped and mapped.is_loopback)
        except ValueError:
            loopback = False

        if os.name != "nt" or not response["is_desktop"] or not loopback:
            return jsonify(response)

        expected = f'"{Path(sys.executable).resolve()}" --startup-minimized'
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Run",
                0,
                winreg.KEY_READ,
            ) as key:
                actual = str(winreg.QueryValueEx(key, "ProjectManagementSystemDesktop")[0])
        except FileNotFoundError:
            actual = ""
        except OSError:
            app.logger.exception("read startup settings failed")
            response["startup_enabled"] = None
            response["startup_error"] = "无法读取这台电脑的开机启动设置，请检查 Windows 权限后重试"
            return jsonify(response)

        response["startup_enabled"] = actual.strip().casefold() == expected.casefold()
        return jsonify(response)


def api_update_settings(ctx: Any = None):
    ctx = _ctx(ctx)
    DATA_DIR = ctx.get("DATA_DIR")
    DB_PATH = ctx.get("DB_PATH")
    MASTER_KEY = ctx.get("MASTER_KEY")
    Path = ctx.get("Path", _default_Path)
    SETTINGS_PATH = ctx.get("SETTINGS_PATH")
    app = ctx.get("app")
    connect_encrypted = ctx.get("connect_encrypted")
    db = ctx.get("db")
    jsonify = ctx.get("jsonify")
    load_app_settings = ctx.get("load_app_settings")
    log_operation = ctx.get("log_operation", lambda *a, **kw: None)
    request = ctx.get("request")
    save_app_settings = ctx.get("save_app_settings")
    session = ctx.get("session", {})
    text = ctx.get("text", _default_text)
    try:
        import stage_templates as settings_templates
    except ModuleNotFoundError:
        from src.backend_patches import stage_templates as settings_templates
    with settings_templates.settings_write_lock:
        import ctypes
        import ctypes.wintypes
        import email.utils
        import json
        import ipaddress
        import os
        import smtplib
        import ssl
        import sys
        from datetime import datetime
        import winreg
        from email.message import EmailMessage
        try:
            import reminder_routing
        except ModuleNotFoundError:
            from src.backend_patches import reminder_routing
        try:
            import stage_workflow
        except ModuleNotFoundError:
            from src.backend_patches import stage_workflow
        try:
            import stage_templates
        except ModuleNotFoundError:
            from src.backend_patches import stage_templates

        data = request.get_json(force=True, silent=True) or {}
        if "stage_template_sync_method" in data and set(data) != {"stage_template_sync_method"}:
            return jsonify({"error": "阶段模板同步必须单独提交，不能同时修改其它设置"}), 400
        purchaser_action = str(data.get("purchaser_board_action") or "").strip()
        if purchaser_action:
            try:
                import purchaser_classification
            except ModuleNotFoundError:
                from src.backend_patches import purchaser_classification

            try:
                result, status = purchaser_classification.execute_purchaser_action(
                    DB_PATH,
                    DATA_DIR / "backups",
                    purchaser_action,
                    data,
                    bool(session.get("is_admin")),
                    str(session.get("username") or ""),
                    connect_encrypted,
                    MASTER_KEY,
                )
            except Exception:
                return jsonify({"error": "保存采购人分类失败"}), 500
            if status < 400:
                log_operation(
                    f"purchaser_{purchaser_action}",
                    "purchaser_classification",
                    data.get("id") or data.get("category_id"),
                    f"采购人分类操作：{purchaser_action}",
                )
            return jsonify(result), status

        updates = {}
        credential_path = None
        pending_credential = None
        clear_smtp_password = False
        preview_result = None
        original_settings = None
        stage_template_sync_summary = None

        if "stage_order" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改阶段顺序"}), 403
            try:
                updates["stage_order"] = stage_workflow.normalize_stage_order(
                    data.get("stage_order"),
                    ctx.get("STAGES", []),
                    strict=True,
                )
            except stage_workflow.StageOrderValidationError as exc:
                return jsonify({"error": str(exc)}), 400

        if "stage_templates" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改阶段模板"}), 403
            current_settings = load_app_settings()
            try:
                updates["stage_templates"] = stage_templates.normalize_stage_templates(
                    data.get("stage_templates"),
                    ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
                    ctx.get("STAGES", []),
                    stage_order=current_settings.get("stage_order"),
                    strict=True,
                    migrate_legacy_auto_completion=False,
                )
                try:
                    import tender_guarantee
                except ModuleNotFoundError:
                    from src.backend_patches import tender_guarantee
                tender_guarantee.validate_default_rule_stage_references(
                    current_settings, updates["stage_templates"]
                )
                updates["stage_auto_completion_policy_version"] = 1
            except ValueError as exc:
                return jsonify({"error": str(exc)}), 400

        if "stage_template_sync_method" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以同步阶段模板"}), 403
            sync_method = str(data.get("stage_template_sync_method") or "").strip()
            methods = [str(method) for method in ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS)]
            if sync_method not in methods:
                return jsonify({"error": "采购方式不正确"}), 400
            current_settings = load_app_settings()
            normalized_templates = stage_templates.normalize_stage_templates(
                current_settings.get("stage_templates"),
                methods,
                ctx.get("STAGES", []),
                stage_order=current_settings.get("stage_order"),
                migrate_legacy_auto_completion=current_settings.get(
                    "stage_auto_completion_policy_version"
                ) != 1,
            )
            try:
                with db.engine.begin() as connection:
                    stage_template_sync_summary = stage_templates.sync_v5_stage_template(
                        connection,
                        text,
                        sync_method,
                        normalized_templates[sync_method],
                    )
            except Exception:
                app.logger.exception("stage template sync failed")
                return jsonify({"error": "同步现有项目失败"}), 500

        reminder_fields = {
            "reminder_enabled",
            "reminder_time",
            "reminder_subject",
            "reminder_advance_days",
            "reminder_weekdays",
            "smtp_host",
            "smtp_port",
            "smtp_security",
            "smtp_username",
            "smtp_sender",
            "smtp_password",
            "clear_smtp_password",
            "reminder_recipients",
            "reminder_stage_keys",
            "reminder_content",
            "reminder_action",
            "event_reminder_create_enabled",
            "event_reminder_complete_enabled",
            "supplier_shortage_email_enabled",
            "reminder_recipient_groups",
            "reminder_group_id",
            "reminder_event_type",
        }
        reminder_requested = bool(reminder_fields.intersection(data))

        if "supplier_minimums" in data:
            try:
                import lot_supplier_risk
            except ModuleNotFoundError:
                from src.backend_patches import lot_supplier_risk
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改供应商数量规则"}), 403
            try:
                updates["supplier_minimums"] = lot_supplier_risk.normalize_minimums(
                    data.get("supplier_minimums")
                )
            except lot_supplier_risk.ValidationError as error:
                return jsonify({"error": str(error)}), 400

        def local_desktop_admin_error():
            if not session.get("is_admin"):
                return "只有管理员可以修改邮件提醒", 403
            if not app.config.get("IS_DESKTOP"):
                return "只能在桌面端本机修改邮件提醒", 403
            try:
                remote = ipaddress.ip_address(request.remote_addr or "")
                mapped = getattr(remote, "ipv4_mapped", None)
                loopback = remote.is_loopback or bool(mapped and mapped.is_loopback)
            except ValueError:
                loopback = False
            if not loopback:
                return "只能在桌面端本机修改邮件提醒", 403
            return None

        def normalize_recipients(values):
            if isinstance(values, str):
                values = values.replace(";", ",").split(",")
            if not isinstance(values, list):
                raise ValueError("收件邮箱必须是列表")
            normalized = []
            seen = set()
            for value in values:
                address = email.utils.parseaddr(str(value).strip())[1]
                if not address or "@" not in address or "." not in address.rsplit("@", 1)[1]:
                    raise ValueError(f"无效收件邮箱：{value}")
                marker = address.casefold()
                if marker not in seen:
                    seen.add(marker)
                    normalized.append(address)
            return normalized

        def normalize_smtp_hostname(value):
            return str(value or "").strip().rstrip(".").casefold()

        def dpapi_transform(raw, protect):
            hook_name = "_REMINDER_PROTECT_SECRET" if protect else "_REMINDER_UNPROTECT_SECRET"
            hook = ctx.get(hook_name)
            if hook:
                return hook(raw)
            if os.name != "nt":
                raise RuntimeError("SMTP 密码加密仅支持 Windows")

            class DataBlob(ctypes.Structure):
                _fields_ = [("size", ctypes.wintypes.DWORD), ("data", ctypes.POINTER(ctypes.c_char))]

            source_buffer = ctypes.create_string_buffer(raw)
            source = DataBlob(len(raw), ctypes.cast(source_buffer, ctypes.POINTER(ctypes.c_char)))
            target = DataBlob()
            crypt32 = ctypes.windll.crypt32
            if protect:
                success = crypt32.CryptProtectData(
                    ctypes.byref(source),
                    "ProcurementCommandCenterSMTP",
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

        def transaction_paths(path):
            return {
                "pending": path.with_suffix(path.suffix + ".tmp"),
                "credential_rollback": path.with_suffix(path.suffix + ".rollback"),
                "settings_rollback": SETTINGS_PATH.with_name(
                    SETTINGS_PATH.name + ".reminder-rollback"
                ),
                "marker": SETTINGS_PATH.with_name("reminder_settings_transaction.json"),
            }

        def recover_reminder_transaction(path):
            paths = transaction_paths(path)
            if not paths["marker"].is_file():
                return True
            settings_recovery = SETTINGS_PATH.with_name(
                SETTINGS_PATH.name + ".reminder-recovery"
            )
            credential_recovery = path.with_suffix(path.suffix + ".recovery")
            try:
                transaction = json.loads(paths["marker"].read_text(encoding="utf-8"))
                if transaction.get("version") != 1:
                    raise ValueError("unsupported reminder settings transaction")
                if paths["pending"].is_file():
                    if transaction.get("settings_existed"):
                        settings_recovery.write_bytes(
                            paths["settings_rollback"].read_bytes()
                        )
                        os.replace(settings_recovery, SETTINGS_PATH)
                    else:
                        SETTINGS_PATH.unlink(missing_ok=True)
                    if transaction.get("mode") == "clear":
                        if transaction.get("credential_existed"):
                            credential_recovery.write_bytes(
                                paths["credential_rollback"].read_bytes()
                            )
                            os.replace(credential_recovery, path)
                        else:
                            path.unlink(missing_ok=True)
                    paths["pending"].unlink(missing_ok=True)
                paths["settings_rollback"].unlink(missing_ok=True)
                paths["credential_rollback"].unlink(missing_ok=True)
                paths["marker"].unlink()
                return True
            except Exception:
                settings_recovery.unlink(missing_ok=True)
                credential_recovery.unlink(missing_ok=True)
                return False

        def stage_reminder_transaction(path, protected, mode, settings_existed, snapshot):
            paths = transaction_paths(path)
            marker_temporary = paths["marker"].with_suffix(paths["marker"].suffix + ".tmp")
            try:
                if settings_existed:
                    paths["settings_rollback"].write_bytes(snapshot)
                else:
                    paths["settings_rollback"].unlink(missing_ok=True)
                credential_existed = path.is_file()
                if mode == "clear" and credential_existed:
                    paths["credential_rollback"].write_bytes(path.read_bytes())
                else:
                    paths["credential_rollback"].unlink(missing_ok=True)
                paths["pending"].write_bytes(protected if mode == "set" else b"")
                marker_temporary.write_text(
                    json.dumps(
                        {
                            "version": 1,
                            "mode": mode,
                            "settings_existed": settings_existed,
                            "credential_existed": credential_existed,
                        },
                        ensure_ascii=False,
                        sort_keys=True,
                    )
                    + "\n",
                    encoding="utf-8",
                )
                os.replace(marker_temporary, paths["marker"])
                return paths
            except Exception:
                marker_temporary.unlink(missing_ok=True)
                paths["pending"].unlink(missing_ok=True)
                paths["settings_rollback"].unlink(missing_ok=True)
                paths["credential_rollback"].unlink(missing_ok=True)
                raise

        def commit_reminder_transaction(path, paths, mode):
            if mode == "set":
                os.replace(paths["pending"], path)
            else:
                path.unlink(missing_ok=True)
                paths["pending"].unlink()
            for artifact in (
                paths["settings_rollback"],
                paths["credential_rollback"],
                paths["marker"],
            ):
                try:
                    artifact.unlink(missing_ok=True)
                except OSError:
                    pass

        def send_test_email(settings, password):
            message = EmailMessage()
            subject_template = settings.get("reminder_subject") or "采购执行提醒：{date} 共 {count} 个节点"
            try:
                test_subject = subject_template.format(date="测试", count=0)
            except (KeyError, IndexError):
                test_subject = subject_template
            message["Subject"] = test_subject
            message["From"] = settings["smtp_sender"]
            message["To"] = ", ".join(settings["reminder_recipients"])
            message.set_content("邮件提醒配置有效。此测试邮件不包含任何项目或供应商数据。")
            factory = ctx.get("_REMINDER_SMTP_FACTORY")
            if settings["smtp_security"] == "ssl":
                constructor = factory or smtplib.SMTP_SSL
                connection = constructor(
                    settings["smtp_host"],
                    settings["smtp_port"],
                    timeout=15,
                    context=ssl.create_default_context(),
                )
            else:
                constructor = factory or smtplib.SMTP
                connection = constructor(settings["smtp_host"], settings["smtp_port"], timeout=15)
            with connection as smtp:
                if settings["smtp_security"] == "starttls":
                    smtp.starttls(context=ssl.create_default_context())
                if settings.get("smtp_username"):
                    smtp.login(settings["smtp_username"], password)
                refused = smtp.send_message(message)
                if isinstance(refused, dict) and refused:
                    raise smtplib.SMTPRecipientsRefused(refused)

        def requeue_nonexpired_failed_stage_reminders(now):
            state_path = SETTINGS_PATH.with_name("daily_stage_delivery_state.json")
            if not state_path.is_file():
                return 0
            state = json.loads(state_path.read_text(encoding="utf-8"))
            deliveries = state.get("deliveries") if isinstance(state, dict) else None
            if (
                not isinstance(state, dict)
                or state.get("version") != 1
                or not isinstance(deliveries, dict)
            ):
                raise ValueError("invalid daily stage delivery state")
            requeued = 0
            next_attempt_at = now.isoformat(timespec="seconds")
            for record in deliveries.values():
                if not isinstance(record, dict) or record.get("status") != "failed":
                    continue
                event = record.get("event")
                if not isinstance(event, dict) or event.get("event_type") != "daily_stage":
                    continue
                try:
                    planned = datetime.fromisoformat(
                        str(event.get("planned_at") or "").strip().replace("Z", "+00:00")
                    )
                except (TypeError, ValueError):
                    continue
                if planned.date() < now.date() or record.get("sent_at"):
                    continue
                record["status"] = "pending"
                record["attempts"] = 0
                record["next_attempt_at"] = next_attempt_at
                record["error_code"] = None
                requeued += 1
            if not requeued:
                return 0
            state["last_error"] = None
            state["pending_count"] = sum(
                isinstance(record, dict) and record.get("status") == "pending"
                for record in deliveries.values()
            )
            temporary = state_path.with_suffix(state_path.suffix + ".requeue.tmp")
            temporary.write_text(
                json.dumps(state, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, state_path)
            return requeued

        def build_reminder_preview(settings):
            preview_date = datetime.now()
            preview_settings = dict(settings)
            preview_settings["smtp_password_configured"] = credential_path.is_file()
            stage_names = {stage["key"]: stage["name"] for stage in reminder_routing.reminder_stage_definitions(
                settings, ctx.get("STAGES", []), ctx.get("METHODS"),
                database=getattr(app, "extensions", {}).get("procurement_catalog", {}).get("db"),
            )}
            enabled_stages = set(preview_settings.get("reminder_stage_keys") or stage_names)
            content = preview_settings.get("reminder_content") or {}
            sample_items = [
                {
                    "stage_key": "registration_end",
                    "stage_name": stage_names.get("registration_end", "报名截止"),
                    "project_number": "CG-2026-001",
                    "project_name": "示例采购项目",
                    "purchaser": "示例采购人单位",
                    "planned_text": preview_date.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": 5,
                },
                {
                    "stage_key": "bid_opening",
                    "stage_name": stage_names.get("bid_opening", "开标"),
                    "project_number": "CG-2026-002",
                    "project_name": "示例开标项目",
                    "purchaser": "示例采购人单位",
                    "planned_text": preview_date.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": 0,
                },
            ]
            sample_items = [item for item in sample_items if item["stage_key"] in enabled_stages]
            if not sample_items:
                sample_key = next((key for key in stage_names if key in enabled_stages), "registration_end")
                sample_items = [{
                    "stage_key": sample_key,
                    "stage_name": stage_names.get(sample_key, "流程节点") + "（示例）",
                    "project_number": "CG-2026-示例",
                    "project_name": "示例采购项目",
                    "purchaser": "示例采购人单位",
                    "planned_text": preview_date.strftime("%Y-%m-%d %H:%M"),
                    "registration_count": 3,
                }]
            count = len(sample_items)
            date_str = preview_date.date().isoformat()
            subject_template = preview_settings.get("reminder_subject") or "采购执行提醒：{date} 共 {count} 个节点"
            subject = subject_template.format(date=date_str, count=count)
            lines = ["以下流程节点即将到期，请及时跟进：", ""]
            for index, item in enumerate(sample_items, 1):
                lines.append(f"{index}. {item['stage_name']}" if content.get("stage_name", True) else f"{index}.")
                if content.get("project_number", True):
                    lines.append(f"项目编号：{item['project_number']}")
                if content.get("project_name", True):
                    lines.append(f"项目名称：{item['project_name']}")
                if content.get("purchaser", True):
                    lines.append(f"采购人：{item['purchaser']}")
                if item["stage_key"] == "bid_opening" and content.get("planned_at", True):
                    lines.append(f"开标时间：{item['planned_text']}")
                elif content.get("planned_at", True):
                    lines.append(f"计划时间：{item['planned_text']}")
                if item["stage_key"] == "registration_end" and content.get("registration_count", True):
                    lines.append(f"{item['registration_count']} 家供应商已报名")
                lines.append("")
            body = "\n".join(lines)
            return {
                "subject": subject,
                "body": body,
                "recipient_count": len(preview_settings.get("reminder_recipients") or []),
                "sender": preview_settings.get("smtp_sender") or "(未配置)",
            }

        def sample_group_event(event_type):
            preview_at = datetime.now().strftime("%Y-%m-%d %H:%M")
            return {
                "event_type": event_type,
                "event_key": f"preview:{event_type}",
                "project_number": "CG-2026-001",
                "project_name": "示例采购项目",
                "purchaser": "示例采购人单位",
                "method": "公开招标",
                "year": 2026,
                "stage_name": "报名截止",
                "planned_at": preview_at,
                "registration_count": 5,
                "event_at": preview_at,
                "progress": 100 if event_type == "project_complete" else 20,
                "lot_identity": "包1 示例采购包",
                "supplier_count": 2,
                "supplier_minimum": 3,
                "supplier_missing": 1,
                "registration_deadline": preview_at,
                "supplier_name": "示例供应商", "deposit_balance": "1000.00",
                "refund_deadline": preview_at, "refund_status": "待退还", "review_at": preview_at[:10],
                "deadline_title": "示例质疑答复", "deadline_at": preview_at,
                "deadline_status": "原确认期限保留，需复核" if event_type == "deadline_review" else "待办理",
                "deadline_basis": "示例条款（请按实际项目核对）", "review_reason": "年度安排变化，请核对新建议",
            }

        def selected_group_delivery(settings, group_id, requested_event_type=None):
            groups = reminder_routing.normalize_recipient_groups(settings)
            selected = next((group for group in groups if group["id"] == group_id), None)
            if selected is None or not selected["enabled"]:
                raise ValueError("收件组不存在或未启用")
            event_type = str(requested_event_type or "").strip()
            if not event_type:
                event_type = selected["event_types"][0]
            if event_type not in selected["event_types"]:
                raise ValueError("该收件组未启用所选提醒类型")
            event = sample_group_event(event_type)
            deliveries = reminder_routing.route_reminder_event(event, [selected])
            selected_recipients = set(selected["recipients"])
            deliveries = [
                delivery
                for delivery in deliveries
                if delivery["recipient"] in selected_recipients
            ]
            if not deliveries:
                raise ValueError("收件组没有可投递邮箱")
            return event, deliveries

        def build_group_preview(settings, group_id, requested_event_type=None):
            event, deliveries = selected_group_delivery(
                settings, group_id, requested_event_type
            )
            message = reminder_routing.render_recipient_message(
                event, deliveries[0], str(settings.get("smtp_sender") or "preview@example.invalid")
            )
            return {
                "subject": str(message["Subject"]),
                "body": message.get_body(preferencelist=("plain",)).get_content(),
                "html": message.get_body(preferencelist=("html",)).get_content(),
                "recipient_count": len(deliveries),
                "recipients": [delivery["recipient"] for delivery in deliveries],
                "event_type": event["event_type"],
            }

        def claim_test_send(group_id):
            state_path = SETTINGS_PATH.with_name("reminder_test_send_state.json")
            now_value = datetime.now()
            if state_path.is_file():
                try:
                    state = json.loads(state_path.read_text(encoding="utf-8"))
                    last_sent = datetime.fromisoformat(str(state.get("last_sent_at") or ""))
                    if (now_value - last_sent).total_seconds() < 60:
                        return False
                except (OSError, UnicodeError, json.JSONDecodeError, TypeError, ValueError):
                    raise ValueError("测试邮件频率状态无法读取")
            temporary = state_path.with_suffix(state_path.suffix + ".tmp")
            temporary.write_text(
                json.dumps(
                    {"last_sent_at": now_value.isoformat(timespec="seconds"), "group_id": group_id},
                    ensure_ascii=False,
                    sort_keys=True,
                ) + "\n",
                encoding="utf-8",
            )
            os.replace(temporary, state_path)
            return True

        if reminder_requested:
            error = local_desktop_admin_error()
            if error:
                message, status = error
                return jsonify({"error": message}), status

        startup_enabled = None
        if "startup_enabled" in data:
            startup_enabled = data.get("startup_enabled")
            if not isinstance(startup_enabled, bool):
                return jsonify({"error": "开机启动状态必须是布尔值"}), 400
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改开机启动设置"}), 403
            if os.name != "nt":
                return jsonify({"error": "开机自动启动仅支持 Windows"}), 400

            try:
                remote = ipaddress.ip_address(request.remote_addr or "")
                mapped = getattr(remote, "ipv4_mapped", None)
                loopback = remote.is_loopback or bool(mapped and mapped.is_loopback)
            except ValueError:
                loopback = False
            if not app.config.get("IS_DESKTOP") or not loopback:
                return jsonify({"error": "只能在桌面端本机修改开机启动设置"}), 403

        credential_path = SETTINGS_PATH.with_name("reminder_credentials.dpapi")
        if not recover_reminder_transaction(credential_path):
            return jsonify({"error": "邮件提醒设置事务恢复失败，自动发送已停止"}), 500

        if reminder_requested:
            known_stage_keys = {
                "project_setup", "procurement_request", "agency_agreement", "document_draft",
                "doc_review", "announcement", "registration_end", "bid_opening", "evaluation",
                "result_notice", "winning_notice", "contract", "acceptance", "archive",
            }
            known_content = {
                field
                for fields in reminder_routing.FIELD_ALLOWLISTS.values()
                for field in fields
            }
            current = load_app_settings()
            known_stage_keys.update(
                stage["key"] for stage in reminder_routing.reminder_stage_definitions(
                    current, ctx.get("STAGES", []), ctx.get("METHODS"),
                    database=getattr(app, "extensions", {}).get("procurement_catalog", {}).get("db"),
                )
            )
            original_settings = dict(current)
            candidate = dict(current)
            try:
                if "reminder_enabled" in data:
                    if not isinstance(data["reminder_enabled"], bool):
                        raise ValueError("邮件提醒开关必须是布尔值")
                    candidate["reminder_enabled"] = data["reminder_enabled"]
                if "reminder_time" in data:
                    value = str(data["reminder_time"] or "")
                    pieces = value.split(":")
                    if len(pieces) != 2 or not all(piece.isdigit() for piece in pieces):
                        raise ValueError("提醒时间必须使用 HH:MM")
                    hour, minute = (int(piece) for piece in pieces)
                    if not (0 <= hour <= 23 and 0 <= minute <= 59):
                        raise ValueError("提醒时间必须使用 HH:MM")
                    candidate["reminder_time"] = f"{hour:02d}:{minute:02d}"
                if "reminder_subject" in data:
                    subject = str(data["reminder_subject"] or "").strip()
                    if not subject:
                        raise ValueError("邮件主题不能为空")
                    if len(subject) > 120:
                        raise ValueError("邮件主题不能超过 120 个字符")
                    # 仅允许 {date}/{count} 两个占位符，杜绝 format 属性链访问
                    import re as _re
                    for _token in _re.findall(r"\{[^{}]*\}", subject):
                        if _token not in ("{date}", "{count}"):
                            raise ValueError("邮件主题仅支持 {date} 和 {count} 占位符")
                    candidate["reminder_subject"] = subject
                if "reminder_advance_days" in data:
                    advance = int(data["reminder_advance_days"])
                    if not 0 <= advance <= 30:
                        raise ValueError("提前提醒天数必须在 0 到 30 之间")
                    candidate["reminder_advance_days"] = advance
                if "reminder_weekdays" in data:
                    weekdays = data["reminder_weekdays"]
                    if not isinstance(weekdays, list) or not weekdays:
                        raise ValueError("提醒星期不能为空")
                    normalized_weekdays = sorted(set(int(d) for d in weekdays))
                    if not all(0 <= d <= 6 for d in normalized_weekdays):
                        raise ValueError("提醒星期必须在 0-6 之间（0=周一）")
                    candidate["reminder_weekdays"] = normalized_weekdays
                for key in ("smtp_host", "smtp_username", "smtp_sender"):
                    if key in data:
                        candidate[key] = str(data[key] or "").strip()
                if "smtp_port" in data:
                    port = int(data["smtp_port"])
                    if not 1 <= port <= 65535:
                        raise ValueError("SMTP 端口必须在 1 到 65535 之间")
                    candidate["smtp_port"] = port
                if "smtp_security" in data:
                    security = str(data["smtp_security"] or "").lower()
                    if security not in {"ssl", "starttls"}:
                        raise ValueError("SMTP 加密方式只能是 SSL 或 STARTTLS")
                    candidate["smtp_security"] = security
                if "reminder_recipients" in data:
                    candidate["reminder_recipients"] = normalize_recipients(data["reminder_recipients"])
                if "reminder_stage_keys" in data:
                    stages = list(dict.fromkeys(str(value) for value in data["reminder_stage_keys"]))
                    if not stages or not set(stages) <= known_stage_keys:
                        raise ValueError("提醒节点包含未知阶段或为空")
                    candidate["reminder_stage_keys"] = stages
                if "reminder_content" in data:
                    content = data["reminder_content"]
                    if not isinstance(content, dict) or not set(content) <= known_content:
                        raise ValueError("邮件内容选项无效")
                    if any(not isinstance(value, bool) for value in content.values()):
                        raise ValueError("邮件内容选项必须是布尔值")
                    candidate["reminder_content"] = {key: bool(content.get(key, False)) for key in known_content}
                if "event_reminder_create_enabled" in data:
                    if not isinstance(data["event_reminder_create_enabled"], bool):
                        raise ValueError("新建项目提醒开关必须是布尔值")
                    candidate["event_reminder_create_enabled"] = data[
                        "event_reminder_create_enabled"
                    ]
                if "event_reminder_complete_enabled" in data:
                    if not isinstance(data["event_reminder_complete_enabled"], bool):
                        raise ValueError("项目完成提醒开关必须是布尔值")
                    candidate["event_reminder_complete_enabled"] = data[
                        "event_reminder_complete_enabled"
                    ]
                if "supplier_shortage_email_enabled" in data:
                    if not isinstance(data["supplier_shortage_email_enabled"], bool):
                        raise ValueError("供应商不足提醒开关必须是布尔值")
                    candidate["supplier_shortage_email_enabled"] = data[
                        "supplier_shortage_email_enabled"
                    ]
                if "reminder_recipient_groups" in data:
                    groups = reminder_routing.validate_recipient_groups(
                        data["reminder_recipient_groups"]
                    )
                    candidate["reminder_recipient_groups"] = groups
                    recipients = []
                    recipient_seen = set()
                    selected_types = set()
                    selected_fields = set()
                    for group in groups:
                        if not group["enabled"]:
                            continue
                        selected_types.update(group["event_types"])
                        selected_fields.update(
                            key
                            for key, enabled in group["content_fields"].items()
                            if enabled
                        )
                        for recipient in group["recipients"]:
                            if recipient not in recipient_seen:
                                recipient_seen.add(recipient)
                                recipients.append(recipient)
                    candidate["reminder_recipients"] = recipients
                    candidate["reminder_content"] = {
                        key: key in selected_fields for key in sorted(known_content)
                    }
                    candidate["reminder_enabled"] = bool(
                        {"daily_stage", "supplier_shortage", "deposit_refund", "deposit_review", "business_deadline", "deadline_review"}.intersection(selected_types)
                    )
                    candidate["event_reminder_create_enabled"] = (
                        "project_create" in selected_types
                    )
                    candidate["event_reminder_complete_enabled"] = (
                        "project_complete" in selected_types
                    )
                    candidate["supplier_shortage_email_enabled"] = (
                        "supplier_shortage" in selected_types
                    )
                elif "reminder_recipient_groups" in current:
                    # Main controls edit the default subscription. Explicit groups
                    # retain their own recipients and field choices.
                    groups = reminder_routing.normalize_recipient_groups(current)
                    default_group = next((group for group in groups if group["id"] == "legacy-default"), None)
                    if default_group is not None:
                        if "reminder_content" in data:
                            default_group["content_fields"].update({
                                key: candidate["reminder_content"][key]
                                for key in ("project_number", "project_name", "purchaser", "stage_name", "planned_at", "registration_count")
                            })
                        if "reminder_recipients" in data and candidate["reminder_recipients"] != current.get("reminder_recipients", []):
                            default_group["recipients"] = list(candidate["reminder_recipients"])
                            candidate["reminder_recipients"] = list(dict.fromkeys(
                                recipient for group in groups if group["enabled"] or group is default_group
                                for recipient in group["recipients"]
                            ))
                        for flag, event_type in (
                            ("reminder_enabled", "daily_stage"),
                            ("event_reminder_create_enabled", "project_create"),
                            ("event_reminder_complete_enabled", "project_complete"),
                            ("supplier_shortage_email_enabled", "supplier_shortage"),
                        ):
                            if flag in data:
                                selected = set(default_group["event_types"])
                                if candidate[flag]:
                                    selected.add(event_type)
                                else:
                                    selected.discard(event_type)
                                default_group["event_types"] = sorted(selected)
                        default_group["enabled"] = bool(default_group["event_types"])
                        candidate["reminder_recipient_groups"] = reminder_routing.validate_recipient_groups(groups)
                if any(key in data for key in (
                    "reminder_content", "reminder_recipient_groups", "reminder_enabled",
                    "event_reminder_create_enabled", "event_reminder_complete_enabled",
                )):
                    candidate.setdefault("reminder_content", dict.fromkeys((
                        "project_number", "project_name", "purchaser", "stage_name", "planned_at", "registration_count"
                    ), True))
                    effective_groups = reminder_routing.normalize_recipient_groups(candidate)
                    for group in effective_groups:
                        if not group["enabled"]:
                            continue
                        for event_type in group["event_types"]:
                            if not any(group["content_fields"].get(field) for field in reminder_routing.FIELD_ALLOWLISTS[event_type]):
                                raise ValueError(f"收件组“{group['name']}”的{reminder_routing.EVENT_LABELS[event_type]}至少选择一个适用的内容字段")
                if (
                    candidate.get("reminder_enabled")
                    or candidate.get("event_reminder_create_enabled")
                    or candidate.get("event_reminder_complete_enabled")
                    or data.get("reminder_action") == "send_test"
                ):
                    if not candidate.get("smtp_host"):
                        raise ValueError("请填写 SMTP 服务器")
                    if not candidate.get("smtp_sender"):
                        raise ValueError("请填写发件邮箱")
                    if normalize_smtp_hostname(candidate.get("smtp_host")) in {
                        "smtp-mail.outlook.com", "smtp.office365.com"
                    }:
                        raise ValueError(
                            "Outlook/Hotmail 当前要求 OAuth2 现代身份验证，"
                            "不能使用 SMTP 密码测试或启用自动提醒"
                        )
                    candidate["reminder_recipients"] = normalize_recipients(candidate.get("reminder_recipients", []))
                    if not candidate["reminder_recipients"]:
                        raise ValueError("请至少填写一个收件邮箱")
            except (TypeError, ValueError) as exc:
                return jsonify({"error": str(exc)}), 400

            password = str(data.get("smtp_password") or "")
            clear_smtp_password = data.get("clear_smtp_password") is True
            if password and not clear_smtp_password:
                try:
                    pending_credential = dpapi_transform(
                        password.encode("utf-8"), True
                    )
                except Exception:
                    app.logger.exception("dpapi protect smtp password failed")
                    return jsonify({"error": "无法安全保存 SMTP 密码"}), 500

            for key in (
                "reminder_enabled", "reminder_time", "reminder_subject",
                "reminder_advance_days", "reminder_weekdays",
                "smtp_host", "smtp_port", "smtp_security",
                "smtp_username", "smtp_sender", "reminder_recipients", "reminder_stage_keys",
                "reminder_content",
                "event_reminder_create_enabled", "event_reminder_complete_enabled",
                "supplier_shortage_email_enabled", "reminder_recipient_groups",
            ):
                if key in candidate:
                    updates[key] = candidate[key]

            if data.get("reminder_action") == "preview":
                preview_result = build_reminder_preview(candidate)

            if data.get("reminder_action") == "preview_group":
                try:
                    preview_result = build_group_preview(
                        candidate,
                        str(data.get("reminder_group_id") or ""),
                        data.get("reminder_event_type"),
                    )
                except (ValueError, reminder_routing.RecipientGroupValidationError) as exc:
                    return jsonify({"error": str(exc)}), 400

            if data.get("reminder_action") == "send_test":
                if not password and not credential_path.is_file():
                    return jsonify({"error": "请先配置 SMTP 密码"}), 400
                try:
                    secret = password or dpapi_transform(
                        credential_path.read_bytes(), False
                    ).decode("utf-8")
                    send_test_email(candidate, secret)
                except smtplib.SMTPAuthenticationError:
                    return jsonify({
                        "error": "SMTP 身份验证失败：请检查登录账号和邮箱授权码；不要填写网页登录密码"
                    }), 502
                except ssl.SSLError:
                    return jsonify({
                        "error": "SMTP TLS 加密协商失败：请检查端口与加密方式是否匹配"
                    }), 502
                except (TimeoutError, OSError):
                    return jsonify({
                        "error": "无法连接 SMTP 服务器：请检查服务器地址、端口和网络状态"
                    }), 502
                except smtplib.SMTPException:
                    return jsonify({
                        "error": "SMTP 服务器拒绝发送：请检查发件邮箱、收件邮箱和服务商限制"
                    }), 502
                except Exception:
                    return jsonify({
                        "error": "测试邮件发送失败：请检查邮件配置后重试"
                    }), 502

            if data.get("reminder_action") == "send_group_test":
                group_id = str(data.get("reminder_group_id") or "")
                if not password and not credential_path.is_file():
                    return jsonify({"error": "请先配置 SMTP 密码"}), 400
                try:
                    event, deliveries = selected_group_delivery(
                        candidate, group_id, data.get("reminder_event_type")
                    )
                    if not claim_test_send(group_id):
                        return jsonify({
                            "error": "操作过于频繁，请 60 秒后重试",
                            "error_code": "TEST_EMAIL_RATE_LIMITED",
                        }), 429
                    messages = [
                        (
                            f"test:{index}",
                            reminder_routing.render_recipient_message(
                                event, delivery, str(candidate.get("smtp_sender") or "")
                            ),
                        )
                        for index, delivery in enumerate(deliveries)
                    ]
                    secret = password or dpapi_transform(
                        credential_path.read_bytes(), False
                    ).decode("utf-8")
                    results = reminder_routing.send_delivery_batch(
                        messages,
                        {
                            "host": candidate.get("smtp_host"),
                            "port": candidate.get("smtp_port"),
                            "security": candidate.get("smtp_security"),
                            "username": candidate.get("smtp_username"),
                        },
                        secret,
                        smtp_factory=ctx.get("_REMINDER_SMTP_FACTORY"),
                    )
                    failure = next(
                        (result for result in results if result["status"] != "sent"),
                        None,
                    )
                    if failure:
                        messages_by_code = {
                            "CONFIG_INVALID": "邮件服务器配置无效：请检查地址、端口和加密方式",
                            "SMTP_AUTH_FAILED": "SMTP 身份验证失败：请检查登录账号和邮箱授权码",
                            "SMTP_TLS_FAILED": "SMTP TLS 加密协商失败：请检查端口与加密方式",
                            "SMTP_CONNECTION_FAILED": "无法连接 SMTP 服务器：请检查地址、端口和网络",
                            "SMTP_SEND_FAILED": "SMTP 服务器拒绝发送：请检查邮箱和服务商限制",
                        }
                        return jsonify({
                            "error": messages_by_code.get(failure["error_code"], "测试邮件发送失败：请检查邮件配置后重试"),
                            "error_code": failure["error_code"],
                        }), 502
                except (ValueError, reminder_routing.RecipientGroupValidationError) as exc:
                    return jsonify({"error": str(exc)}), 400
                except Exception:
                    return jsonify({
                        "error": "测试邮件发送失败：请检查邮件配置后重试",
                        "error_code": "SMTP_SEND_FAILED",
                    }), 502

        if data.get("reminder_action") in {"preview", "preview_group", "send_group_test"}:
            # Preview/test drafts are not settings saves. Only delivery cooldown
            # state is persisted for group tests.
            response = {"message": "测试邮件已发送" if data["reminder_action"] == "send_group_test" else "邮件预览已生成"}
            if preview_result is not None:
                response["preview"] = preview_result
            return jsonify(response)

        if "export_folder" in data or "login_subtitle" in data:
            if not session.get("is_admin"):
                return jsonify({"error": "只有管理员可以修改系统设置"}), 403

        if "export_folder" in data:
            raw = str(data.get("export_folder") or "").strip().strip('"')
            if not raw:
                return jsonify({"error": "保存位置不能为空"}), 400
            folder = Path(raw).expanduser()
            try:
                folder.mkdir(parents=True, exist_ok=True)
            except Exception as exc:
                app.logger.exception("create export folder failed")
                return jsonify({"error": "无法创建保存目录，请检查路径权限"}), 400
            updates["export_folder"] = str(folder)

        if "login_subtitle" in data:
            subtitle = str(data.get("login_subtitle") or "").strip()
            if not subtitle:
                return jsonify({"error": "登录页副标题不能为空"}), 400
            if len(subtitle) > 60:
                return jsonify({"error": "登录页副标题不能超过 60 个字符"}), 400
            updates["login_subtitle"] = subtitle

        if startup_enabled is not None:
            expected = f'"{Path(sys.executable).resolve()}" --startup-minimized'
            run_key = r"Software\Microsoft\Windows\CurrentVersion\Run"
            value_name = "ProjectManagementSystemDesktop"
            try:
                if startup_enabled:
                    with winreg.CreateKey(winreg.HKEY_CURRENT_USER, run_key) as key:
                        winreg.SetValueEx(key, value_name, 0, winreg.REG_SZ, expected)
                else:
                    try:
                        with winreg.OpenKey(
                            winreg.HKEY_CURRENT_USER,
                            run_key,
                            0,
                            winreg.KEY_SET_VALUE,
                        ) as key:
                            winreg.DeleteValue(key, value_name)
                    except FileNotFoundError:
                        pass
            except OSError:
                app.logger.exception("save startup settings failed")
                return jsonify({"error": "保存开机启动设置失败"}), 500

        credential_change = credential_path is not None and (
            pending_credential is not None or clear_smtp_password
        )
        settings_existed = False
        settings_snapshot = None
        transaction = None
        transaction_mode = None
        if credential_change:
            try:
                settings_existed = SETTINGS_PATH.is_file()
                if settings_existed:
                    settings_snapshot = SETTINGS_PATH.read_bytes()
                transaction_mode = "set" if pending_credential is not None else "clear"
                transaction = stage_reminder_transaction(
                    credential_path,
                    pending_credential,
                    transaction_mode,
                    settings_existed,
                    settings_snapshot,
                )
            except Exception:
                return jsonify({"error": "无法安全保存 SMTP 密码"}), 500

        try:
            settings = save_app_settings(updates)
        except Exception as settings_error:
            if transaction is not None:
                try:
                    if original_settings is not None:
                        save_app_settings(original_settings)
                except Exception:
                    pass
                recover_reminder_transaction(credential_path)
            return jsonify({"error": str(settings_error) if isinstance(settings_error, ValueError) else "保存系统设置失败"}), 500
        if transaction is not None:
            try:
                commit_reminder_transaction(
                    credential_path, transaction, transaction_mode
                )
            except Exception:
                try:
                    if original_settings is not None:
                        save_app_settings(original_settings)
                except Exception:
                    pass
                recover_reminder_transaction(credential_path)
                return jsonify({"error": "无法安全保存 SMTP 密码"}), 500
        requeued_failed_reminders = 0
        if data.get("reminder_action") == "send_test":
            try:
                requeued_failed_reminders = requeue_nonexpired_failed_stage_reminders(
                    datetime.now()
                )
            except (OSError, UnicodeError, json.JSONDecodeError, ValueError):
                app.logger.exception("requeue failed stage reminders failed")
        log_operation("update_settings", "system", None, "更新系统设置")
        response = {
            "message": "邮件提醒设置已保存" if reminder_requested else "设置已保存",
            "settings": settings,
            "export_folder": settings.get("export_folder"),
        }
        response["settings"]["stage_templates"] = stage_templates.normalize_stage_templates(
            settings.get("stage_templates"),
            ctx.get("METHODS", stage_templates.PROCUREMENT_METHODS),
            ctx.get("STAGES", []),
            stage_order=settings.get("stage_order"),
            migrate_legacy_auto_completion=settings.get(
                "stage_auto_completion_policy_version"
            ) != 1,
        )
        response["settings"]["stage_module_catalog"] = stage_templates.module_catalog_payload()
        if startup_enabled is not None:
            response["startup_enabled"] = startup_enabled
            response["message"] = "已开启开机自动启动" if startup_enabled else "已关闭开机自动启动"
        if data.get("reminder_action") in {"send_test", "send_group_test"}:
            response["message"] = "测试邮件已发送"
        if data.get("reminder_action") == "send_test":
            response["requeued_failed_reminders"] = requeued_failed_reminders
        if preview_result is not None:
            response["message"] = "邮件预览已生成"
            response["preview"] = preview_result
        if stage_template_sync_summary is not None:
            response["message"] = "阶段模板已同步到现有项目"
            skipped = stage_template_sync_summary.get('projects_skipped_legacy', 0)
            if skipped:
                response["message"] = f"已同步 {stage_template_sync_summary['projects_updated']} 个项目，{skipped} 个旧竞价项目保持原样"
            response["sync_summary"] = stage_template_sync_summary
        return jsonify(response)
