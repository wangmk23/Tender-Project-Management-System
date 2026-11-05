"""local-project-folders-v1: safe, host-owned project directory mapping and inspection.

The mapping is metadata only. No API in this module renames, moves or deletes
any existing user file. Files stay on the Windows host and are NOT uploaded.
"""
from __future__ import annotations

import hmac
import ipaddress
import json
import os
import re
import tempfile
import threading
from pathlib import Path
from flask import jsonify, request, session

STAGES = (
    "01_项目接收与立项",
    "02_采购需求与原始资料",
    "03_采购文件编制",
    "04_公告与报名资料",
    "05_开标资料",
    "06_评标评审资料",
    "07_结果公示与合同",
    "08_项目归档资料",
    "99_临时工作文件",
)
_MAX_SCAN = 1500
_MAX_EXAMPLES = 100
_LOCK = threading.RLock()
_FORBIDDEN_NAMES = frozenset({"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)),
                              *(f"LPT{i}" for i in range(1, 10))})


def _local_request():
    try:
        address = ipaddress.ip_address(request.remote_addr or "")
        mapped = getattr(address, "ipv4_mapped", None)
        return address.is_loopback or bool(mapped and mapped.is_loopback)
    except ValueError:
        return False


def _validate_directory(value, *, must_exist=True):
    if not isinstance(value, str) or not value.strip() or len(value) > 2048:
        raise ValueError("请输入有效的完整文件夹路径")
    value = value.strip()
    if any(ord(c) < 32 or ord(c) == 127 for c in value):
        raise ValueError("路径包含无效控制字符")
    if value.startswith(("\\\\?\\", "\\\\.\\", "//?/", "//./")):
        raise ValueError("不允许使用设备命名空间路径")
    candidate = Path(value).expanduser()
    if not candidate.is_absolute():
        raise ValueError("文件夹必须使用绝对路径")
    # Resolving a link only for the root itself prevents storing a changeable alias.
    if candidate.is_symlink() or getattr(candidate, "is_junction", lambda: False)():
        raise ValueError("不能直接关联符号链接或目录联接点")
    path = candidate.resolve(strict=must_exist)
    if path == Path(path.anchor):
        raise ValueError("不能关联整个磁盘或文件系统根目录")
    if must_exist and not path.is_dir():
        raise ValueError("文件夹不存在或无法读取")
    return path


def _folder_name(number, name):
    raw = f"{str(number or '').strip()}_{str(name or '').strip()}".strip(" _")
    raw = re.sub(r'[<>:"/\\|?*\\x00-\\x1f]', "_", raw).rstrip(" .")
    raw = re.sub(r"_+", "_", raw)[:100].rstrip(" .")
    if not raw or raw.split(".", 1)[0].upper() in _FORBIDDEN_NAMES:
        raise ValueError("项目编号或名称无法生成安全文件夹名称")
    return raw


def _load(path):
    if not path.exists():
        return {}
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(value, dict) or any(
            not isinstance(k, str) or not k.isdecimal()
            or not isinstance(v, str) or len(v) > 2048 for k, v in value.items()
        ):
            raise ValueError("invalid mapping format")
        return value
    except (OSError, ValueError, UnicodeError) as exc:
        raise RuntimeError("项目文件夹关联索引损坏，原文件已保留，禁止覆盖；请从备份恢复") from exc


def _save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(
            "w", encoding="utf-8", dir=path.parent, prefix=".local-folders-",
            suffix=".tmp", delete=False,
        ) as stream:
            pending = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(pending, path)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _scan(root):
    """Bounded metadata traversal; ignore links/reparse points and file contents."""
    stats = {"files": 0, "directories": 0, "bytes": 0, "truncated": False,
             "skipped_links": 0, "errors": 0, "examples": [], "stages": []}
    if not root.is_dir():
        return stats
    for stage in STAGES:
        target = root / stage
        stats["stages"].append({
            "name": stage, "exists": target.is_dir() and not target.is_symlink()
            and not getattr(target, "is_junction", lambda: False)()
        })
    remaining = [(root, 0)]
    checked = 0
    while remaining:
        directory, depth = remaining.pop()
        try:
            with os.scandir(directory) as entries:
                items = sorted(entries, key=lambda entry: entry.name.casefold())
        except OSError:
            stats["errors"] += 1
            continue
        for item in items:
            checked += 1
            if checked > _MAX_SCAN:
                stats["truncated"] = True
                return stats
            try:
                item_path = Path(item.path)
                if item.is_symlink() or getattr(item_path, "is_junction", lambda: False)():
                    stats["skipped_links"] += 1
                    continue
                if item.is_dir(follow_symlinks=False):
                    stats["directories"] += 1
                    if depth < 3:
                        remaining.append((item_path, depth + 1))
                elif item.is_file(follow_symlinks=False):
                    details = item.stat(follow_symlinks=False)
                    stats["files"] += 1
                    stats["bytes"] += details.st_size
                    if len(stats["examples"]) < _MAX_EXAMPLES:
                        stats["examples"].append({
                            "name": item.name,
                            "relative_directory": str(directory.relative_to(root)),
                            "size": details.st_size,
                            "modified": int(details.st_mtime),
                        })
            except OSError:
                stats["errors"] += 1
    return stats


def register(app, db, *, Project, User, DATA_DIR, login_required, opener=None):
    """Attach routes once; writes require a fresh local administrator and CSRF."""
    if app.extensions.get("local_project_folders_registered"):
        return True
    index_path = Path(DATA_DIR) / "local_project_folders.json"

    def project(pid):
        return db.session.get(Project, pid)

    def deny_write():
        if not app.config.get("IS_DESKTOP") or not _local_request():
            return jsonify(error="请在系统主机上使用管理员账号进行文件夹管理"), 403
        try:
            user = db.session.get(User, int(session.get("user_id")))
        except (ValueError, TypeError):
            user = None
        if not user or not user.is_admin or not user.is_active:
            return jsonify(error="仅本机管理员可以修改项目文件夹关联"), 403
        expected = session.get("csrf_token")
        supplied = request.headers.get("X-CSRFToken") or request.headers.get("X-CSRF-Token")
        if not isinstance(expected, str) or not isinstance(supplied, str) or not hmac.compare_digest(expected, supplied):
            return jsonify(error="页面安全令牌已失效，请刷新后重试", code="csrf_required"), 400
        return None

    def read_mapping(pid):
        with _LOCK:
            return _load(index_path).get(str(pid), "")

    @login_required
    def info(pid):
        if project(pid) is None:
            return jsonify(error="项目不存在"), 404
        try:
            value = read_mapping(pid)
        except RuntimeError as exc:
            return jsonify(error=str(exc)), 500
        root = Path(value) if value else None
        return jsonify({
            "linked": bool(value), "path": value, "exists": bool(root and root.is_dir()),
            "can_manage": bool(app.config.get("IS_DESKTOP") and _local_request()),
            "can_open_here": bool(os.name == "nt" and app.config.get("IS_DESKTOP") and _local_request()),
            "stages": list(STAGES),
        })

    @login_required
    def scan(pid):
        if project(pid) is None:
            return jsonify(error="项目不存在"), 404
        try:
            value = read_mapping(pid)
            if not value:
                return jsonify(error="请先关联项目文件夹"), 404
            root = _validate_directory(value)
            return jsonify({"path": str(root), **_scan(root)})
        except ValueError as exc:
            return jsonify(error=str(exc)), 409
        except RuntimeError as exc:
            return jsonify(error=str(exc)), 500
        except OSError:
            return jsonify(error="无法读取项目文件夹，请检查磁盘与共享权限"), 503

    @login_required
    def link(pid):
        denied = deny_write()
        if denied is not None:
            return denied
        if project(pid) is None:
            return jsonify(error="项目不存在"), 404
        body = request.get_json(silent=True)
        if not isinstance(body, dict) or not isinstance(body.get("path"), str):
            return jsonify(error="请输入文件夹绝对路径，留空可取消关联"), 400
        try:
            value = str(_validate_directory(body["path"])) if body["path"].strip() else ""
            with _LOCK:
                mapping = _load(index_path)
                if value:
                    if any(k != str(pid) and os.path.normcase(v) == os.path.normcase(value)
                           for k, v in mapping.items()):
                        return jsonify(error="该文件夹已关联其他项目，不能重复关联"), 409
                    mapping[str(pid)] = value
                else:
                    mapping.pop(str(pid), None)
                _save(index_path, mapping)
            return jsonify(ok=True, path=value, linked=bool(value))
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except (OSError, RuntimeError) as exc:
            app.logger.warning("Local folder mapping save failed: %s", type(exc).__name__)
            return jsonify(error="文件夹关联保存失败，原关联信息未改变"), 500

    @login_required
    def create(pid):
        denied = deny_write()
        if denied is not None:
            return denied
        obj = project(pid)
        if obj is None:
            return jsonify(error="项目不存在"), 404
        body = request.get_json(silent=True)
        if not isinstance(body, dict):
            return jsonify(error="请输入父级目录"), 400
        try:
            parent = _validate_directory(body.get("parent_path"))
            target = parent / _folder_name(getattr(obj, "number", ""), getattr(obj, "name", ""))
            if target.exists():
                return jsonify(error="目标项目文件夹已经存在，请使用关联现有文件夹"), 409
            with _LOCK:
                mapping = _load(index_path)
                if mapping.get(str(pid)):
                    return jsonify(error="项目已关联文件夹，请先核对原关联"), 409
                target.mkdir(exist_ok=False)
                # No operations are ever performed on pre-existing project files.
                for stage in STAGES:
                    (target / stage).mkdir(exist_ok=False)
                mapping[str(pid)] = str(target)
                _save(index_path, mapping)
            return jsonify(ok=True, path=str(target), created=True)
        except ValueError as exc:
            return jsonify(error=str(exc)), 400
        except FileExistsError:
            return jsonify(error="目标文件夹已存在，未覆盖原文件"), 409
        except (OSError, RuntimeError):
            app.logger.exception("Local project folder creation failed")
            return jsonify(error="创建未完成；请先检查磁盘上的新目录，再决定关联，不会自动清理文件"), 500

    @login_required
    def open_folder(pid):
        denied = deny_write()
        if denied is not None:
            return denied
        if project(pid) is None:
            return jsonify(error="项目不存在"), 404
        if os.name != "nt" and opener is None:
            return jsonify(error="仅支持在 Windows 系统主机打开资源管理器"), 501
        try:
            value = read_mapping(pid)
            if not value:
                return jsonify(error="项目尚未关联文件夹"), 404
            root = _validate_directory(value)
            (opener or os.startfile)(str(root))
            return jsonify(opened=True)
        except ValueError as exc:
            return jsonify(error=str(exc)), 409
        except (OSError, RuntimeError):
            return jsonify(error="无法打开文件夹，请检查磁盘连接和权限"), 503

    base = "/api/projects/<int:pid>/local-folder"
    app.add_url_rule(base, "local_folder_info", info, methods=["GET"])
    app.add_url_rule(base + "/scan", "local_folder_scan", scan, methods=["GET"])
    app.add_url_rule(base, "local_folder_link", link, methods=["PUT"])
    app.add_url_rule(base + "/create", "local_folder_create", create, methods=["POST"])
    app.add_url_rule(base + "/open", "local_folder_open", open_folder, methods=["POST"])
    app.extensions["local_project_folders_registered"] = True
    return True
