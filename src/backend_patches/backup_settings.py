"""Host-admin backup directory settings for the frozen V5 application."""
from __future__ import annotations

import hmac
import ipaddress
import os
import tempfile
from pathlib import Path

from flask import has_request_context, jsonify, request, session


def _directory(value):
    if not isinstance(value, str) or not value.strip():
        raise ValueError('请输入完整的备份目录路径')
    value = value.strip()
    if any(ord(char) < 32 for char in value) or value.startswith(('\\\\?\\', '\\\\.\\')):
        raise ValueError('备份目录路径无效')
    path = Path(value).expanduser()
    if not path.is_absolute():
        raise ValueError('备份目录必须是绝对路径')
    return path.resolve()


def _default_directory(runtime):
    """Keep the existing non-C default policy without creating folders on reads."""
    candidates = [Path(runtime.DATA_DIR)/'backups', Path(runtime.BASE_DIR)/'backups']
    if os.name == 'nt':
        candidates.extend(Path(f'{letter}:/')/'项目管理系统备份'
                          for letter in 'DEFGHIJKLMNOPQRSTUVWXYZ' if Path(f'{letter}:/').exists())
    for folder in candidates:
        if os.name == 'nt' and folder.drive.upper() == 'C:':
            continue
        ancestor = folder
        while not ancestor.exists() and ancestor != ancestor.parent:
            ancestor = ancestor.parent
        if ancestor.is_dir() and os.access(ancestor, os.W_OK):
            return folder.resolve()
    raise ValueError('未找到可写的默认非 C 盘目录，请选择其他备份目录')


def _check_writable(folder):
    folder.mkdir(parents=True, exist_ok=True)
    # Each request owns its probe; concurrent checks never overwrite a user file.
    with tempfile.TemporaryFile(dir=folder, prefix='.pm-backup-check-') as stream:
        stream.write(b'backup-directory-check')
        stream.flush()
        os.fsync(stream.fileno())


def register(runtime, *, choose_folder=None, open_folder=None):
    app = runtime.app
    if app.extensions.get('backup_settings_registered'):
        return True

    def configured_directory():
        settings = runtime.load_app_settings()
        value = settings.get('backup_folder', '')
        if value is None:
            value = ''
        if not isinstance(value, str):
            raise ValueError('已保存的备份目录格式无效，请重新设置')
        return value.strip()

    def get_backup_dir():
        try:
            configured = configured_directory()
            folder = _directory(configured) if configured else _default_directory(runtime)
            # Informational pages remain usable when a disk is disconnected.
            if has_request_context() and request.method in ('GET','HEAD') and request.path in (
                    '/api/settings', '/api/system-info', '/api/settings/backup'):
                return folder
            _check_writable(folder)
            return folder
        except (OSError, ValueError) as exc:
            raise RuntimeError('备份目录不可用，请在设置中选择可写目录；未改用其他位置') from exc

    def deny_if_needed(write=False):
        try:
            address = ipaddress.ip_address(request.remote_addr or '')
            mapped = getattr(address, 'ipv4_mapped', None)
            local = address.is_loopback or bool(mapped and mapped.is_loopback)
        except ValueError:
            local = False
        user_id = session.get('user_id')
        user = None
        if local and app.config.get('IS_DESKTOP') and user_id:
            try:
                user = runtime.db.session.get(runtime.User, int(user_id))
            except (ValueError, TypeError):
                pass
        if not user or not user.is_admin or not user.is_active:
            return jsonify(error='请在主机客户端使用管理员账号设置备份目录', code='PERMISSION_DENIED'),403
        if write:
            expected=session.get('csrf_token')
            supplied=request.headers.get('X-CSRFToken') or request.headers.get('X-CSRF-Token')
            if not isinstance(expected,str) or not supplied or not hmac.compare_digest(expected,supplied):
                return jsonify(error='页面安全令牌已失效，请刷新后重试', code='csrf_required'),400
        return None

    def status():
        configured = configured_directory()
        try:
            default = str(_default_directory(runtime))
        except (OSError, ValueError):
            default = ''
        try:
            folder = _directory(configured) if configured else Path(default) if default else None
            available=bool(folder and folder.is_dir() and os.access(folder,os.W_OK))
            error='' if available else '备份目录不存在或不可写，请重新选择；原备份不会移动'
            path=str(folder) if folder else ''
        except (OSError, ValueError) as exc:
            path=configured
            available=False
            error=str(exc)
        return dict(path=path,configured_path=configured,default_path=default,
                    available=available,error=error)

    def get_settings():
        denied=deny_if_needed()
        if denied is not None:
            return denied
        try:
            return jsonify(status())
        except (OSError,ValueError):
            return jsonify(error='无法读取备份目录设置，请检查配置文件'),500

    def update_settings():
        denied=deny_if_needed(write=True)
        if denied is not None:
            return denied
        body=request.get_json(silent=True)
        if not isinstance(body,dict) or not isinstance(body.get('path'),str):
            return jsonify(error='备份目录必须是字符串'),400
        try:
            from stage_templates import settings_write_lock
        except ModuleNotFoundError:
            from src.backend_patches.stage_templates import settings_write_lock
        with settings_write_lock:
            try:
                value=body['path'].strip()
                folder=_directory(value) if value else _default_directory(runtime)
                _check_writable(folder)
            except (OSError,ValueError):
                return jsonify(error='备份目录无效或不可写，原设置已保留'),400
            try:
                runtime.save_app_settings({'backup_folder':str(folder) if value else ''})
            except (OSError,ValueError,RuntimeError):
                return jsonify(error='备份目录设置保存失败，原设置已保留'),500
        return jsonify(**status(),message='备份目录已保存；已有备份保留在原位置')

    def choose():
        denied=deny_if_needed(write=True)
        if denied is not None:
            return denied
        if not callable(choose_folder):
            return jsonify(error='主机文件夹选择器不可用，可直接输入目录'),503
        try:
            selected=choose_folder()
            if not selected:
                return jsonify(cancelled=True)
            value=selected[0] if isinstance(selected,(tuple,list)) else selected
            return jsonify(path=str(_directory(value)))
        except (OSError,ValueError,RuntimeError,AttributeError):
            return jsonify(error='无法打开文件夹选择器，可直接输入目录'),503

    def open_saved():
        denied=deny_if_needed(write=True)
        if denied is not None:
            return denied
        try:
            value=configured_directory()
            folder=_directory(value) if value else _default_directory(runtime)
            if not folder.is_dir():
                return jsonify(error='已保存的备份目录不存在，请先设置有效目录'),400
            opener=open_folder or getattr(os,'startfile',None)
            if not callable(opener):
                raise OSError('folder opener unavailable')
            opener(folder)
            return jsonify(message='已打开备份文件夹')
        except (OSError,ValueError,RuntimeError):
            return jsonify(error='无法打开备份文件夹，请检查路径和访问权限'),503

    runtime.get_backup_dir=get_backup_dir
    app.add_url_rule('/api/settings/backup','api_backup_settings',get_settings,methods=['GET'])
    app.add_url_rule('/api/settings/backup','api_update_backup_settings',update_settings,methods=['PUT'])
    app.add_url_rule('/api/settings/backup/choose','api_choose_backup_folder',choose,methods=['POST'])
    app.add_url_rule('/api/settings/backup/open','api_open_backup_folder',open_saved,methods=['POST'])
    app.extensions['backup_settings_registered']=True
    return True
