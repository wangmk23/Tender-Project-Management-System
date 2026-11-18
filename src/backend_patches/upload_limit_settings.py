"""Runtime-configurable attachment upload limits for the packaged app.

upload-limit-settings-v1
"""
from __future__ import annotations

import json


DEFAULT_UPLOAD_LIMIT_MB = 1024
MIN_UPLOAD_LIMIT_MB = 1
MAX_UPLOAD_LIMIT_MB = 2048
MEBIBYTE = 1048576
MULTIPART_OVERHEAD_BYTES = 16 * 1048576
SETTING_KEY = "max_file_size_mb"
INSTALLATION_KEY = "pm_upload_limit_settings_installed"


def normalize_upload_limit_mb(value) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("附件上限必须是整数")
    if not (MIN_UPLOAD_LIMIT_MB <= value <= MAX_UPLOAD_LIMIT_MB):
        raise ValueError("附件上限必须在1至2048MB之间")
    return value


def read_upload_limit_mb(app_globals) -> int:
    settings = app_globals["load_app_settings"]()
    raw = settings.get(SETTING_KEY, DEFAULT_UPLOAD_LIMIT_MB)
    try:
        return normalize_upload_limit_mb(raw)
    except ValueError:
        return DEFAULT_UPLOAD_LIMIT_MB


def _apply_runtime_limit(app, app_globals, value: int) -> None:
    limit_bytes = value * MEBIBYTE
    app_globals["MAX_FILE_SIZE"] = limit_bytes
    app.config["MAX_CONTENT_LENGTH"] = limit_bytes + MULTIPART_OVERHEAD_BYTES


def _file_storage_size(storage) -> int | None:
    stream = getattr(storage, "stream", None)
    if stream is None:
        return getattr(storage, "content_length", None)
    try:
        position = stream.tell()
        stream.seek(0, 2)
        size = stream.tell()
        stream.seek(position)
        return size
    except (AttributeError, OSError):
        value = getattr(storage, "content_length", None)
        return value if isinstance(value, int) and value >= 0 else None


def install_upload_limit_settings(app, app_globals, login_required) -> None:
    """Install the setting endpoint and upload guards exactly once."""
    if app.extensions.get(INSTALLATION_KEY):
        return None
    app.extensions[INSTALLATION_KEY] = True

    from flask import jsonify, request, session

    _apply_runtime_limit(app, app_globals, read_upload_limit_mb(app_globals))

    def upload_limit_settings_view():
        if request.method == "GET":
            return jsonify({SETTING_KEY: read_upload_limit_mb(app_globals)})
        if not bool(session.get("is_admin")):
            return jsonify({"error": "只有管理员可以修改附件上传上限"}), 403
        payload = request.get_json(silent=True)
        if not isinstance(payload, dict) or set(payload) != {SETTING_KEY}:
            return jsonify({"error": "请求只允许包含附件上传上限"}), 400
        try:
            value = normalize_upload_limit_mb(payload.get(SETTING_KEY))
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        settings = dict(app_globals["load_app_settings"]())
        settings[SETTING_KEY] = value
        try:
            app_globals["save_app_settings"](settings)
        except (OSError, UnicodeError, ValueError):
            logger = app_globals.get("logger")
            if logger is not None:
                logger.exception("save attachment upload limit failed")
            return jsonify({"error": "附件上传上限保存失败"}), 500
        _apply_runtime_limit(app, app_globals, value)
        return jsonify(
            {
                "ok": True,
                SETTING_KEY: value,
                "message": "附件上传上限已保存",
            }
        )

    app.add_url_rule(
        "/api/settings/upload-limit",
        endpoint="api_upload_limit_settings",
        view_func=login_required(upload_limit_settings_view),
        methods=("GET", "PATCH"),
    )

    @app.before_request
    def apply_configured_upload_limit():
        value = read_upload_limit_mb(app_globals)
        _apply_runtime_limit(app, app_globals, value)
        if request.method != "POST" or "/attachments" not in request.path:
            return None
        limit_bytes = value * MEBIBYTE
        uploaded_files = request.files.getlist("files")
        for storage in uploaded_files:
            size = _file_storage_size(storage)
            if size is not None and size > limit_bytes:
                for uploaded_file in uploaded_files:
                    uploaded_file.close()
                return (
                    jsonify(
                        {
                            "error": f"{storage.filename or '文件'} 超过{value}MB限制"
                        }
                    ),
                    413,
                )
        return None

    @app.after_request
    def expose_configured_upload_limit(response):
        if (
            response.status_code >= 400
            or request.endpoint not in {"api_get_settings", "api_system_info"}
            or not response.is_json
        ):
            return response
        payload = response.get_json(silent=True)
        if not isinstance(payload, dict):
            return response
        payload[SETTING_KEY] = read_upload_limit_mb(app_globals)
        response.set_data(json.dumps(payload, ensure_ascii=False))
        response.content_type = "application/json; charset=utf-8"
        return response
