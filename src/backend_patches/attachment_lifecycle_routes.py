"""Attachment lifecycle, path-traversal guard, and streaming encryption bridge (Stage 4C).

attachment-lifecycle-routes-v1
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import datetime as _default_datetime
import hashlib
import os
from pathlib import Path
import shutil
from typing import Any
from urllib.parse import quote
import uuid

try:
    import runtime_context
except ModuleNotFoundError:  # pragma: no cover - source tree fallback
    from src.backend_patches import runtime_context


ATTACHMENT_LIFECYCLE_ROUTES_SIGNATURE = "attachment-lifecycle-routes-v1"
LEGACY_ROUTE_ENV = "PM_USE_LEGACY_CORE_ROUTES"

STAGE_4C_HELPER_NAMES: tuple[str, ...] = (
    "allowed_file",
    "generate_stored_filename",
    "sanitize_display_filename",
    "get_upload_path",
    "_validate_file_path",
    "_delete_attachment_file",
    "_sha256_file",
    "_encrypt_uploaded_file",
    "_attachment_response",
    "_cleanup_project_files",
    "request_entity_too_large",
)

STAGE_4C_ROUTE_ENDPOINTS: tuple[str, ...] = (
    "api_list_attachments",
    "api_upload_attachment",
    "api_download_attachment",
    "api_save_attachment_local",
    "api_view_attachment",
    "api_update_attachment",
)

STAGE_4C_MANAGED_SYMBOLS: tuple[str, ...] = (
    *STAGE_4C_HELPER_NAMES,
    *STAGE_4C_ROUTE_ENDPOINTS,
)

DEFAULT_MIME_MAP: dict[str, str] = {
    "pdf": "application/pdf",
    "doc": "application/msword",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "xls": "application/vnd.ms-excel",
    "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "ppt": "application/vnd.ms-powerpoint",
    "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "png": "image/png",
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "gif": "image/gif",
    "txt": "text/plain",
    "zip": "application/zip",
    "rar": "application/x-rar-compressed",
    "csv": "text/csv",
}


def _ctx(explicit: Any = None, *, depth: int = 2) -> runtime_context.AppContextRegistry:
    if explicit is None:
        return runtime_context.current_context(depth=depth)
    return runtime_context.get_runtime_context(explicit)


def _is_ctx_like(value: Any) -> bool:
    return isinstance(value, Mapping) or hasattr(value, "signature")


def should_use_legacy_route(route_name: str, env: Mapping[str, str] | None = None) -> bool:
    source = os.environ if env is None else env
    raw = str(source.get(LEGACY_ROUTE_ENV) or "").strip()
    if not raw:
        return False
    tokens = {item.strip() for item in raw.split(",") if item.strip()}
    if {"1", "true", "TRUE", "all", "ALL", "*"} & tokens:
        return True
    return route_name in tokens


def _default_abort(code: int, description: str | None = None) -> None:
    raise LookupError(f"HTTP {code}: {description or ''}")


# ---------------------------------------------------------------------------
# 1. File Validation, Path Guard & Encryption Bridge Helpers
# ---------------------------------------------------------------------------

def allowed_file(ctx_or_filename: Any, filename: str | None = None) -> bool:
    """检查文件扩展名是否允许"""
    if filename is None and not _is_ctx_like(ctx_or_filename):
        filename = str(ctx_or_filename or "")
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_filename, depth=2)
        filename = str(filename or "")
    allowed = ctx.get("ALLOWED_EXTENSIONS", set())
    return "." in filename and Path(filename).suffix.lower().lstrip(".") in allowed


def generate_stored_filename(ctx_or_filename: Any, original_filename: str | None = None) -> str:
    """生成安全的存储文件名（UUID + 原扩展名）"""
    if original_filename is None and not _is_ctx_like(ctx_or_filename):
        original_filename = str(ctx_or_filename or "")
    else:
        original_filename = str(original_filename or "")
    ext = Path(original_filename).suffix.lower()
    return f"{uuid.uuid4().hex}{ext}"


def sanitize_display_filename(ctx_or_filename: Any, filename: str | None = None) -> str:
    """清理用于显示的文件名（保留中文/Unicode，只移除危险字符）。"""
    if filename is None and not _is_ctx_like(ctx_or_filename):
        filename = ctx_or_filename
    if not filename:
        return "unknown"
    name = str(filename).replace("\x00", "").replace("..", "_")
    name = name.strip(" .")
    if not name or name in (".", ".."):
        return "unknown"
    return name


def get_upload_path(ctx_or_pid: Any, project_id: int | str | None = None) -> Path:
    """获取项目的上传目录路径"""
    if project_id is None and not _is_ctx_like(ctx_or_pid):
        project_id = ctx_or_pid
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_pid, depth=2)
    upload_folder = Path(ctx.get("UPLOAD_FOLDER"))
    project_dir = upload_folder / str(project_id)
    project_dir.mkdir(parents=True, exist_ok=True)
    return project_dir


def _validate_file_path(
    ctx_or_full_path: Any,
    full_path_or_rel: Any = None,
    relative_path: Any = None,
) -> None:
    """防止路径遍历攻击：确保解析后的绝对路径在 UPLOAD_FOLDER 内。"""
    if relative_path is None and not _is_ctx_like(ctx_or_full_path):
        full_path = Path(ctx_or_full_path)
        relative_path = full_path_or_rel
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_full_path, depth=2)
        full_path = Path(full_path_or_rel)
    abort = ctx.get("abort", _default_abort)
    app_obj = ctx.get("app")
    upload_folder = Path(ctx.get("UPLOAD_FOLDER"))
    try:
        resolved = full_path.resolve()
        upload_resolved = upload_folder.resolve()
        try:
            resolved.relative_to(upload_resolved)
            return None
        except ValueError:
            if app_obj is not None and hasattr(app_obj, "logger"):
                app_obj.logger.warning(f"Path traversal attempt: {relative_path} -> {resolved}")
            abort(400, description="非法的文件路径")
            return None
    except (ValueError, RuntimeError) as e:
        if app_obj is not None and hasattr(app_obj, "logger"):
            app_obj.logger.warning(f"Invalid file path: {relative_path}: {e}")
        abort(400, description="非法的文件路径")
        return None


def _delete_attachment_file(ctx_or_att: Any, attachment: Any = None) -> None:
    """删除附件对应的磁盘文件，数据库记录由调用方处理。"""
    if attachment is None and not _is_ctx_like(ctx_or_att):
        attachment = ctx_or_att
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_att, depth=2)
    if not attachment or not getattr(attachment, "file_path", None):
        return None
    upload_folder = Path(ctx.get("UPLOAD_FOLDER"))
    file_full_path = upload_folder / attachment.file_path
    _validate_file_path(ctx, file_full_path, attachment.file_path)
    if file_full_path.exists():
        file_full_path.unlink()
    return None


def _sha256_file(ctx_or_path: Any, path: str | Path | None = None) -> str:
    if path is None and not _is_ctx_like(ctx_or_path):
        path = ctx_or_path
    digest = hashlib.sha256()
    with Path(path).open("rb") as stream:
        for chunk in iter(lambda: stream.read(1048576), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _encrypt_uploaded_file(ctx_or_path: Any, path: str | Path | None = None) -> None:
    if path is None and not _is_ctx_like(ctx_or_path):
        path = ctx_or_path
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_path, depth=2)
    if ctx.get("DATA_ENCRYPTION_ENABLED"):
        encrypt_file = ctx.get("encrypt_file")
        if callable(encrypt_file):
            encrypt_file(path, ctx.get("ATTACHMENT_KEY"))


def _attachment_response(
    ctx_or_path: Any,
    path_or_att: Any = None,
    att_or_download: Any = None,
    *,
    as_download: bool | None = None,
):
    if not _is_ctx_like(ctx_or_path):
        path = Path(ctx_or_path)
        attachment = path_or_att
        if as_download is None:
            as_download = bool(att_or_download)
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_path, depth=2)
        path = Path(path_or_att)
        attachment = att_or_download
        if as_download is None:
            as_download = False
    is_encrypted_file = ctx.get("is_encrypted_file")
    if not (ctx.get("DATA_ENCRYPTION_ENABLED") and callable(is_encrypted_file) and is_encrypted_file(path)):
        send_file = ctx.get("send_file")
        return send_file(
            str(path),
            as_attachment=as_download,
            download_name=attachment.filename if as_download else None,
            mimetype=attachment.mime_type or "application/octet-stream",
        )
    Response = ctx.get("Response")
    stream_with_context = ctx.get("stream_with_context", lambda g: g)
    iter_decrypted_file = ctx.get("iter_decrypted_file")
    encrypted_file_size = ctx.get("encrypted_file_size")
    response = Response(
        stream_with_context(iter_decrypted_file(path, ctx.get("ATTACHMENT_KEY"))),
        mimetype=attachment.mime_type or "application/octet-stream",
        direct_passthrough=True,
    )
    if callable(encrypted_file_size):
        response.content_length = encrypted_file_size(path)
    disposition = "attachment" if as_download else "inline"
    response.headers["Content-Disposition"] = (
        f"{disposition}; filename=attachment; filename*=UTF-8''{quote(attachment.filename)}"
    )
    response.headers["Cache-Control"] = "private, no-store"
    return response


def _cleanup_project_files(ctx_or_pid: Any, project_id: int | str | None = None) -> None:
    """删除项目上传目录，避免项目删除后留下孤儿附件。"""
    if project_id is None and not _is_ctx_like(ctx_or_pid):
        project_id = ctx_or_pid
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_pid, depth=2)
    upload_folder = Path(ctx.get("UPLOAD_FOLDER"))
    project_dir = upload_folder / str(project_id)
    _validate_file_path(ctx, project_dir, str(project_id))
    if project_dir.exists() and project_dir.is_dir():
        for child in project_dir.iterdir():
            if child.is_file():
                child.unlink()
        try:
            project_dir.rmdir()
        except OSError:
            app_obj = ctx.get("app")
            if app_obj is not None and hasattr(app_obj, "logger"):
                app_obj.logger.warning(f"项目附件目录非空，保留目录: {project_dir}")


def request_entity_too_large(ctx_or_err: Any = None, error: Any = None):
    if error is None and not _is_ctx_like(ctx_or_err):
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_err, depth=2)
    jsonify = ctx.get("jsonify", lambda v: v)
    max_file_size = int(ctx.get("MAX_FILE_SIZE", 1024 * 1024 * 1024))
    return jsonify({"error": f"文件太大！最大允许 {max_file_size // 1048576}MB，请压缩后重试"}), 413


# ---------------------------------------------------------------------------
# 2. Attachment Lifecycle Routes
# ---------------------------------------------------------------------------

def api_list_attachments(ctx_or_pid: Any, pid: int | None = None):
    """获取项目的附件列表（默认不含供应商报名登记资料）"""
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, Attachment = ctx.get("db"), ctx.get("Project"), ctx.get("Attachment")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    db.get_or_404(Project, pid)
    reg_id = request.args.get("registration_id", type=int)
    include_reg = request.args.get("include_registrations", type=int)
    q = Attachment.query.filter_by(project_id=pid)
    if reg_id is not None:
        q = q.filter_by(registration_id=reg_id)
    elif not include_reg:
        q = q.filter_by(registration_id=None, complaint_id=None, clarification_id=None)
    attachments = q.order_by(Attachment.uploaded_at.desc()).all()
    try:
        try:
            import recycle_bin
        except ModuleNotFoundError:
            from . import recycle_bin
        hidden_atts = recycle_bin.hidden_attachment_ids(db, project_id=pid)
        if hidden_atts:
            attachments = [a for a in attachments if getattr(a, "id", None) not in hidden_atts]
    except Exception:
        pass
    return jsonify([a.to_dict() for a in attachments])


def api_upload_attachment(ctx_or_pid: Any, pid: int | None = None):
    """上传附件到指定项目，支持多文件上传和单个大文件上传"""
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, SupplierRegistration, Complaint, Attachment = (
        ctx.get("db"),
        ctx.get("Project"),
        ctx.get("SupplierRegistration"),
        ctx.get("Complaint"),
        ctx.get("Attachment"),
    )
    request, session, jsonify = ctx.get("request"), ctx.get("session", {}), ctx.get("jsonify", lambda v: v)
    log_operation = ctx.get("log_operation")
    project = db.get_or_404(Project, pid)

    registration_id = request.form.get("registration_id", type=int)
    if registration_id:
        reg = SupplierRegistration.query.filter_by(id=registration_id, project_id=pid).first()
        if not reg:
            return jsonify({"error": "报名记录不存在或不属于该项目"}), 400

    complaint_id = request.form.get("complaint_id", type=int)
    if complaint_id:
        comp = Complaint.query.filter_by(id=complaint_id, project_id=pid).first()
        if not comp:
            return jsonify({"error": "质疑/投诉记录不存在或不属于该项目"}), 400

    if "files" not in request.files:
        return jsonify({"error": "没有选择文件"}), 400
    files = request.files.getlist("files")
    if not files or all(f.filename == "" for f in files):
        return jsonify({"error": "没有选择文件"}), 400

    uploaded_files: list[dict] = []
    errors: list[str] = []
    upload_dir = get_upload_path(ctx, pid)

    for file in files:
        if file.filename == "":
            continue
        if not allowed_file(ctx, file.filename):
            errors.append(f"❌ {file.filename}: 不支持的文件格式")
            continue
        original_name = sanitize_display_filename(ctx, file.filename)
        stored_name = generate_stored_filename(ctx, file.filename)
        file_path = upload_dir / stored_name
        try:
            file.save(str(file_path))
            size = os.path.getsize(file_path)
            content_sha256 = _sha256_file(ctx, file_path)
            _encrypt_uploaded_file(ctx, file_path)
            ext = Path(original_name).suffix.lstrip(".").lower()
            mime_type = DEFAULT_MIME_MAP.get(ext, "application/octet-stream")
            desc = request.form.get("description", "") or (
                "质疑/投诉材料" if complaint_id else ("报名登记资料" if registration_id else "")
            )
            attachment = Attachment(
                project_id=pid,
                registration_id=registration_id,
                complaint_id=complaint_id,
                filename=original_name,
                stored_name=stored_name,
                file_path=f"{pid}/{stored_name}",
                file_size=size,
                mime_type=mime_type,
                sha256=content_sha256,
                uploaded_by=session.get("user_id", 0),
                description=desc,
            )
            db.session.add(attachment)
            db.session.flush()
            uploaded_files.append(attachment.to_dict())
        except Exception as e:
            if file_path.exists():
                file_path.unlink()
            errors.append(f"❌ {file.filename}: 上传失败 - {str(e)}")

    if uploaded_files:
        db.session.commit()
        if callable(log_operation):
            log_operation(
                "upload_attachment",
                "project",
                pid,
                f"上传了 {len(uploaded_files)} 个附件到项目 {project.number}",
            )
    return (
        jsonify(
            {
                "success": True,
                "uploaded": uploaded_files,
                "errors": errors,
                "message": f"成功上传 {len(uploaded_files)} 个文件",
            }
        ),
        200,
    )


def api_download_attachment(ctx_or_aid: Any, aid: int | None = None):
    """下载附件"""
    if aid is None and isinstance(ctx_or_aid, int):
        aid, ctx = ctx_or_aid, _ctx(None, depth=2)
    else:
        ctx, aid = _ctx(ctx_or_aid, depth=2), int(aid)
    db, Attachment = ctx.get("db"), ctx.get("Attachment")
    jsonify = ctx.get("jsonify", lambda v: v)
    attachment = db.get_or_404(Attachment, aid)
    file_full_path = Path(ctx.get("UPLOAD_FOLDER")) / attachment.file_path
    _validate_file_path(ctx, file_full_path, attachment.file_path)
    if not file_full_path.exists():
        return jsonify({"error": "文件不存在"}), 404
    return _attachment_response(ctx, file_full_path, attachment, as_download=True)


def api_save_attachment_local(ctx_or_aid: Any, aid: int | None = None):
    """将附件保存到主机设置的文件保存目录，并可选择用系统默认程序打开。"""
    if aid is None and isinstance(ctx_or_aid, int):
        aid, ctx = ctx_or_aid, _ctx(None, depth=2)
    else:
        ctx, aid = _ctx(ctx_or_aid, depth=2), int(aid)
    db, Attachment = ctx.get("db"), ctx.get("Attachment")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    dt_cls = ctx.get("datetime", _default_datetime)
    log_operation = ctx.get("log_operation")
    attachment = db.get_or_404(Attachment, aid)
    file_full_path = Path(ctx.get("UPLOAD_FOLDER")) / attachment.file_path
    _validate_file_path(ctx, file_full_path, attachment.file_path)
    if not file_full_path.exists():
        return jsonify({"error": "文件不存在"}), 404

    save_folder = Path(ctx.get("get_export_dir")())
    filename = sanitize_display_filename(ctx, attachment.filename)
    target = save_folder / filename
    if target.exists():
        stem = target.stem
        suffix = target.suffix
        target = save_folder / f"{stem}_{dt_cls.now().strftime('%Y%m%d_%H%M%S')}{suffix}"

    is_encrypted_file = ctx.get("is_encrypted_file")
    decrypt_file_to = ctx.get("decrypt_file_to")
    if ctx.get("DATA_ENCRYPTION_ENABLED") and callable(is_encrypted_file) and is_encrypted_file(file_full_path):
        decrypt_file_to(file_full_path, target, ctx.get("ATTACHMENT_KEY"))
    else:
        shutil.copy2(file_full_path, target)

    opened = False
    if request.args.get("open") == "1":
        try:
            if os.name == "nt":
                os.startfile(str(target))
                opened = True
        except Exception as e:
            return jsonify(
                {
                    "error": f"文件已保存，但打开失败：{e}",
                    "path": str(target),
                    "folder": str(save_folder),
                }
            ), 500

    if callable(log_operation):
        log_operation("save_attachment", "attachment", aid, f"保存附件到本地：{target.name}")
    return jsonify(
        {
            "message": "文件已保存",
            "filename": target.name,
            "path": str(target),
            "folder": str(save_folder),
            "opened": opened,
        }
    )


def api_view_attachment(ctx_or_aid: Any, aid: int | None = None):
    """在线预览附件（图片/PDF）"""
    if aid is None and isinstance(ctx_or_aid, int):
        aid, ctx = ctx_or_aid, _ctx(None, depth=2)
    else:
        ctx, aid = _ctx(ctx_or_aid, depth=2), int(aid)
    db, Attachment = ctx.get("db"), ctx.get("Attachment")
    abort = ctx.get("abort", _default_abort)
    jsonify = ctx.get("jsonify", lambda v: v)
    attachment = db.get_or_404(Attachment, aid)
    preview_exts = ctx.get("PREVIEW_EXTENSIONS", set())
    if attachment.extension not in preview_exts:
        abort(400, description="该文件类型不支持在线预览")
    file_full_path = Path(ctx.get("UPLOAD_FOLDER")) / attachment.file_path
    _validate_file_path(ctx, file_full_path, attachment.file_path)
    if not file_full_path.exists():
        return jsonify({"error": "文件不存在"}), 404
    return _attachment_response(ctx, file_full_path, attachment, as_download=False)


def api_update_attachment(ctx_or_aid: Any, aid: int | None = None):
    """更新附件（重命名/修改描述）"""
    if aid is None and isinstance(ctx_or_aid, int):
        aid, ctx = ctx_or_aid, _ctx(None, depth=2)
    else:
        ctx, aid = _ctx(ctx_or_aid, depth=2), int(aid)
    db, Attachment = ctx.get("db"), ctx.get("Attachment")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    log_operation = ctx.get("log_operation")
    attachment = db.get_or_404(Attachment, aid)
    data = request.get_json(silent=True) or {}
    if "filename" in data:
        new_name = str(data["filename"]).strip()
        if new_name:
            old_ext = os.path.splitext(attachment.filename)[1]
            new_ext = os.path.splitext(new_name)[1]
            if not new_ext or new_ext.lower() != old_ext.lower():
                base = os.path.splitext(new_name)[0]
                attachment.filename = base + old_ext
            else:
                attachment.filename = new_name
    if "description" in data:
        attachment.description = str(data["description"]).strip()
    db.session.commit()
    if callable(log_operation):
        log_operation("rename_attachment", "project", attachment.project_id, f"重命名附件：{attachment.filename}")
    return jsonify(attachment.to_dict())


# ---------------------------------------------------------------------------
# 3. Dual-Track Runtime Registration
# ---------------------------------------------------------------------------

def register(host_or_ctx: Any, app: Any = None) -> dict[str, Any]:
    """Install Stage 4C open-source attachment lifecycle helpers and routes with legacy fallback."""
    ctx = _ctx(host_or_ctx, depth=2)
    flask_app = app or ctx.get("app")
    host = ctx.host_module

    legacy_helpers: dict[str, Any] = {}
    legacy_views: dict[str, Any] = {}

    if host is not None:
        for name in STAGE_4C_HELPER_NAMES:
            existing = ctx.get(name)
            if existing is not None:
                legacy_helpers[name] = existing

    if flask_app is not None and hasattr(flask_app, "view_functions"):
        for endpoint in STAGE_4C_ROUTE_ENDPOINTS:
            if endpoint in flask_app.view_functions:
                legacy_views[endpoint] = flask_app.view_functions[endpoint]

    helper_map = {
        "allowed_file": lambda filename: allowed_file(ctx, filename),
        "generate_stored_filename": lambda original_filename: generate_stored_filename(ctx, original_filename),
        "sanitize_display_filename": lambda filename: sanitize_display_filename(ctx, filename),
        "get_upload_path": lambda project_id: get_upload_path(ctx, project_id),
        "_validate_file_path": lambda full_path, relative_path: _validate_file_path(ctx, full_path, relative_path),
        "_delete_attachment_file": lambda attachment: _delete_attachment_file(ctx, attachment),
        "_sha256_file": lambda path: _sha256_file(ctx, path),
        "_encrypt_uploaded_file": lambda path: _encrypt_uploaded_file(ctx, path),
        "_attachment_response": lambda path, attachment, as_download=False: _attachment_response(
            ctx, path, attachment, as_download=as_download
        ),
        "_cleanup_project_files": lambda project_id: _cleanup_project_files(ctx, project_id),
        "request_entity_too_large": lambda error: request_entity_too_large(ctx, error),
    }

    for name, open_fn in helper_map.items():
        def _make_helper(h_name: str, h_fn: Any):
            def _bound(*args: Any, **kwargs: Any):
                if should_use_legacy_route(h_name) and h_name in legacy_helpers:
                    return legacy_helpers[h_name](*args, **kwargs)
                return h_fn(*args, **kwargs)

            _bound.__name__ = h_name
            _bound._is_stage_4c_bound = True
            return _bound

        ctx.set_symbol(name, _make_helper(name, open_fn), write_host=True)

    route_map = {
        "api_list_attachments": lambda pid: api_list_attachments(ctx, pid),
        "api_upload_attachment": lambda pid: api_upload_attachment(ctx, pid),
        "api_download_attachment": lambda aid: api_download_attachment(ctx, aid),
        "api_save_attachment_local": lambda aid: api_save_attachment_local(ctx, aid),
        "api_view_attachment": lambda aid: api_view_attachment(ctx, aid),
        "api_update_attachment": lambda aid: api_update_attachment(ctx, aid),
    }

    installed_views: list[str] = []
    if flask_app is not None and hasattr(flask_app, "view_functions"):
        login_dec = ctx.get("login_required") or (lambda f: f)
        for endpoint, raw_fn in route_map.items():
            raw_fn.__name__ = endpoint
            guarded = login_dec(raw_fn)

            def _make_dual(ep: str, open_handler: Any):
                def _dual(*args: Any, **kwargs: Any):
                    if should_use_legacy_route(ep) and ep in legacy_views:
                        return legacy_views[ep](*args, **kwargs)
                    return open_handler(*args, **kwargs)

                _dual.__name__ = ep
                _dual._is_stage_4c_bound = True
                return _dual

            dual_fn = _make_dual(endpoint, guarded)
            flask_app.view_functions[endpoint] = dual_fn
            ctx.set_symbol(endpoint, dual_fn, write_host=True)
            installed_views.append(endpoint)

    info = {
        "signature": ATTACHMENT_LIFECYCLE_ROUTES_SIGNATURE,
        "installed_helpers": list(helper_map.keys()),
        "installed_views": installed_views,
    }
    if flask_app is not None and hasattr(flask_app, "extensions"):
        flask_app.extensions["stage_4c_attachments"] = info
    return info
