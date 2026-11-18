"""Source-only initialization and backup services, confined to DATA_DIR."""
from contextlib import closing
from datetime import datetime
import ipaddress
import json
import os
from pathlib import Path
import secrets
import sqlite3
import tempfile
import threading
import zipfile
from flask import abort, redirect, render_template_string, request, session
from werkzeug.security import generate_password_hash
from src.backend_patches import public_licensing, stage_templates


def local_secret(data_dir, filename, size=32):
    """No drive scans, recovery prompts or writes outside the selected data root."""
    path = Path(data_dir) / filename
    if path.exists():
        value = public_licensing._dpapi_unprotect(path.read_bytes())
        if len(value) != size:
            raise RuntimeError('本机密钥无效，请使用原电脑的数据目录或恢复流程')
        return value
    value = secrets.token_bytes(size)
    try:
        with path.open('xb') as stream:
            stream.write(public_licensing._dpapi_protect(value))
            stream.flush()
            os.fsync(stream.fileno())
    except FileExistsError:
        return local_secret(data_dir, filename, size)
    return value


def register_services(app, db, ctx):
    User = ctx['User']
    setup_lock = threading.Lock()

    @app.before_request
    def first_use():
        if request.path in ('/', '/login') and not User.query.first():
            return redirect('/setup')

    @app.route('/setup', methods=['GET','POST'])
    def setup():
        try:
            local = ipaddress.ip_address(request.remote_addr or '').is_loopback
        except ValueError:
            local = False
        if not local:
            abort(403)
        if User.query.first():
            return redirect('/login')
        error = ''
        token = session.setdefault('setup_token', secrets.token_urlsafe(32))
        if request.method == 'POST':
            if not secrets.compare_digest(token, request.form.get('token','')):
                abort(400)
            username = request.form.get('username','').strip()
            password = request.form.get('password','')
            error = ctx['_validate_username'](username) or ('密码至少 12 位' if len(password) < 12 else '')
            if not error:
                with setup_lock:
                    # Serialize first-admin creation across processes as well.
                    db.session.rollback()
                    from sqlalchemy import text
                    db.session.execute(text('BEGIN IMMEDIATE'))
                    if User.query.first():
                        db.session.rollback()
                        return redirect('/login')
                    db.session.add(User(username=username, password_hash=generate_password_hash(password), is_admin=True, is_active=True))
                    db.session.commit()
                session.clear()
                return redirect('/login')
        return render_template_string('''<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>首次设置 · 项目管理系统</title>
<style>body{font:14px/1.6 "Microsoft YaHei",sans-serif;background:#f6f7f9;color:#1a1d21}main{max-width:400px;margin:12vh auto;padding:28px;background:white;border:1px solid #e3e6ea;border-radius:8px}label{display:block;margin-top:16px}input,button{box-sizing:border-box;width:100%;padding:10px;border:1px solid #cdd2d9;border-radius:6px;font:inherit}button{margin-top:24px;background:#2563eb;color:white}input:focus-visible,button:focus-visible{outline:2px solid #2563eb;outline-offset:2px}.error{color:#b91c1c}</style>
<main><h1>设置管理员账号</h1><p>为这份独立的数据创建管理员。请妥善保存账号和密码。</p>
<form method="post"><input type="hidden" name="token" value="{{token}}"><label for="username">账号</label><input id="username" name="username" required autocomplete="username" value="{{username}}"><label for="password">密码（至少 12 位）</label><input id="password" name="password" type="password" minlength="12" required autocomplete="new-password"><p class="error" role="alert">{{error}}</p><button>创建管理员</button></form></main></html>''', token=token, error=error, username=request.form.get('username',''))

    def create_full_backup():
        folder = Path(ctx['get_backup_dir']())
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / ('项目系统备份-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f') + '-' + secrets.token_hex(3) + '.zip')
        data_dir = Path(ctx['DATA_DIR'])
        # SQLite backup API creates a coherent DB snapshot including WAL. The
        # settings writer lock protects configuration files during their copy.
        with stage_templates.settings_write_lock, tempfile.TemporaryDirectory(prefix='pm-source-backup-') as scratch:
            snapshot = Path(scratch) / 'bidding.db'
            with closing(sqlite3.connect(str(ctx['DB_PATH']))) as source, closing(sqlite3.connect(str(snapshot))) as dest:
                source.backup(dest)
            with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED) as archive:
                archive.write(snapshot, 'bidding.db')
                for path in sorted(data_dir.iterdir()):
                    if path.is_file() and path.suffix in ('.json','.jsonl','.dpapi') and path.name != 'session_key.dpapi':
                        archive.write(path, path.name)
                for subdir in ('uploads','holiday_calendar'):
                    root = data_dir / subdir
                    if root.exists():
                        for path in root.rglob('*'):
                            if path.is_file() and not path.is_symlink():
                                archive.write(path, path.relative_to(data_dir).as_posix())
                archive.writestr('backup-info.json', json.dumps({'format':1,'edition':'pure-source','created_at':datetime.now().isoformat()},ensure_ascii=False))
        return target
    ctx.set_symbol('create_full_backup', create_full_backup)
