"""account-permissions-v1: live account capabilities for the preserved V5 runtime."""
from __future__ import annotations

import json
import re

from flask import jsonify, request, session
from sqlalchemy import Column, Integer, MetaData, String, Table, Text, select
from sqlalchemy.exc import IntegrityError
from werkzeug.security import generate_password_hash


CAPABILITIES = ('create_projects', 'edit_projects', 'delete_projects', 'manage_attachments', 'export_data')
_metadata = MetaData()
_policies = Table('account_permissions', _metadata,
                  Column('user_id', Integer, primary_key=True),
                  Column('role', String(16), nullable=False),
                  Column('permissions', Text, nullable=False))
_lock = Table('account_permissions_lock', _metadata,
              Column('id', Integer, primary_key=True), Column('value', Integer, nullable=False))


def defaults(role):
    return {key: role == 'admin' or role == 'editor' and key != 'delete_projects' for key in CAPABILITIES}


def _fresh(db, User, uid):
    if uid is None or isinstance(uid, bool):
        return None
    return db.session.get(User, uid, populate_existing=True)


def account_for(db, user):
    """Never trust session flags or a previously loaded ORM instance."""
    uid = getattr(user, 'id', None)
    if uid is None:
        return {'role': 'viewer', 'permissions': defaults('viewer')}
    user = _fresh(db, type(user), uid)
    if user is None:
        return {'role': 'viewer', 'permissions': defaults('viewer')}
    if user.is_admin:
        return {'role': 'admin', 'permissions': defaults('admin')}
    row = db.session.execute(select(_policies).where(_policies.c.user_id == uid)).mappings().first()
    if row is None:
        return {'role': 'editor', 'permissions': defaults('editor')}
    try:
        role = row['role']
        value = json.loads(row['permissions'])
        # A stale admin policy can never override the authoritative users flag.
        if role == 'admin':
            return {'role': 'editor', 'permissions': defaults('editor')}
        if role not in ('editor', 'viewer') or not isinstance(value, dict) or set(value) != set(CAPABILITIES):
            raise ValueError('invalid persisted policy')
        if any(type(value[key]) is not bool for key in CAPABILITIES):
            raise ValueError('invalid persisted flags')
        if role == 'viewer' and any(value[key] for key in CAPABILITIES if key != 'export_data'):
            raise ValueError('invalid viewer writes')
        return {'role': role, 'permissions': value}
    except (ValueError, TypeError):
        return {'role': 'viewer', 'permissions': defaults('viewer')}


def _policy_input(payload, current):
    role = payload.get('role', current['role'])
    if not isinstance(role, str) or role not in ('admin', 'editor', 'viewer'):
        raise ValueError('账号角色无效')
    if 'is_admin' in payload:
        if type(payload['is_admin']) is not bool:
            raise ValueError('管理员状态须为开启或关闭状态')
        if 'role' in payload and payload['is_admin'] != (role == 'admin'):
            raise ValueError('账号角色与管理员状态不一致')
        if 'role' not in payload:
            if payload['is_admin']:
                role = 'admin'
            elif current['role'] == 'admin':
                role = 'editor'
    value = dict(current['permissions']) if role == current['role'] else defaults(role)
    if 'permissions' in payload:
        flags = payload['permissions']
        if not isinstance(flags, dict) or set(flags) - set(CAPABILITIES):
            raise ValueError('操作权限字段无效')
        if any(type(flag) is not bool for flag in flags.values()):
            raise ValueError('操作权限须为开启或关闭状态')
        value.update(flags)
    if role == 'admin':
        value = defaults('admin')
    if role == 'viewer' and any(value[key] for key in CAPABILITIES if key != 'export_data'):
        raise ValueError('只读账号不能开启写入权限，请选择协作编辑')
    return {'role': role, 'permissions': value}


def required_capabilities(method, path, args):
    """Explicit non-admin write inventory; unclassified API writes fail closed."""
    write = method not in ('GET', 'HEAD', 'OPTIONS')
    if path.startswith(('/api/users', '/api/settings', '/api/data-recovery', '/api/device-access/')):
        # Device status is public and is handled separately by the admission gate.
        if path == '/api/device-access/status':
            return ()
        if path.startswith('/api/settings') and not write and not path.startswith('/api/settings/backup'):
            return ()
        return ('admin',)
    if path == '/api/export' or path.startswith('/api/export/') or path in (
            '/api/import/templates', '/api/holiday-calendar/template', '/api/holiday-calendar/export'):
        return ('export_data',)
    if not write and re.fullmatch(r'/api/attachments/\d+/download',path) and args.get('preview') != '1':
        return ('export_data',)
    # Query flags never replace a POST/PUT/DELETE route's write requirement.
    if not write and (args.get('save') == '1' or args.get('export') == '1'):
        return ('export_data',)
    if not write:
        return ()
    if path in ('/api/csrf-refresh', '/api/me/change-password', '/api/software-updates/open-release'):
        return ()
    if path == '/api/projects' and method == 'POST':
        return ('create_projects',)
    if path == '/api/import/projects':
        # Imports can both create projects and update existing project fields.
        return ('create_projects', 'edit_projects')
    if re.fullmatch(r'/api/projects/\d+', path):
        return ('delete_projects',) if method == 'DELETE' else ('edit_projects',)
    if re.fullmatch(r'/api/attachments/\d+/save-local', path):
        return ('export_data',)
    if re.fullmatch(r'/api/attachments/\d+', path):
        return ('manage_attachments',)
    if re.fullmatch(r'/api/projects/\d+/(?:[^/]+/[^/]+/)*attachments', path):
        return ('manage_attachments',)
    if path == '/api/batch/advance-stage':
        return ('edit_projects',)
    if re.match(r'/api/projects/\d+/(?:lots|registrations|bid-results|complaints|stages|stage-checklist|'
                r'clarifications|archive-catalog|notice-deliveries|archive-deliveries|service-fee-invoices|'
                r'online-bidding|tender-guarantee|deadline-settings|deadlines|workflow|supplier-quantity)(?:/|$)', path):
        return ('edit_projects',)
    return ('admin',)


def request_can(app, capability):
    """Read current DB authority for incidental writes in preserved GET handlers."""
    installed = app.extensions.get('account_permissions')
    if installed is None or capability not in CAPABILITIES:
        return False
    current = _fresh(installed['db'], installed['User'], session.get('user_id'))
    return bool(current is not None and current.is_active
                and account_for(installed['db'], current)['permissions'][capability])


def admin_capability_allowed(db, User, user, current_request):
    """The sole historical admin-only business route explicitly delegated by policy."""
    if (getattr(current_request, 'endpoint', None) != 'api_delete_project'
            or getattr(current_request, 'method', None) != 'DELETE'
            or not re.fullmatch(r'/api/projects/\d+', getattr(current_request, 'path', ''))):
        return False
    current = _fresh(db, User, getattr(user, 'id', None))
    return bool(current is not None and current.is_active
                and account_for(db, current)['permissions']['delete_projects'])


def register(app, db, runtime):
    """Install after existing license, CSRF, admission gates and all business routes.

    runtime requires User; validate_username optionally supplies the preserved validator.
    No authenticating/decrypting, filesystem settings or desktop actions occur here.
    """
    if 'account_permissions' in app.extensions:
        return
    User = runtime['User']
    with app.app_context():
        # Additive-only schema. Unconfigured users are interpreted compatibly;
        # no existing account or business row is rewritten during migration.
        with db.engine.begin() as connection:
            _metadata.create_all(connection)
            if connection.execute(select(_lock.c.id).where(_lock.c.id == 1)).first() is None:
                connection.execute(_lock.insert().values(id=1, value=0))

    def denied(account):
        return jsonify(error='当前账号没有此操作权限', code='PERMISSION_DENIED', account=account), 403

    def current_user():
        user = _fresh(db, User, session.get('user_id'))
        if user is None or not user.is_active:
            session.clear()
            return None
        session['username'] = user.username
        session['is_admin'] = bool(user.is_admin)
        return user

    def gate():
        path = request.path
        if not path.startswith('/api/') or request.method == 'OPTIONS':
            return None
        # Preserve the existing public signed-download and device/activation contracts.
        if path.startswith('/api/public/attachments/') or path in ('/api/license/status', '/api/device-access/status'):
            return None
        user = current_user()
        if user is None:
            return jsonify(error='账号已停用或尚未登录，请重新登录'), 401
        account = account_for(db, user)
        required = required_capabilities(request.method, path, request.args)
        if not user.is_admin and any(cap == 'admin' or not account['permissions'][cap] for cap in required):
            return denied(account)

    app.before_request(gate)

    original_to_dict = User.to_dict
    def to_dict(user):
        value = dict(original_to_dict(user))
        value.update(account_for(db, user))
        return value
    User.to_dict = to_dict

    @app.after_request
    def enrich_system_info(response):
        if request.endpoint == 'api_system_info' and response.status_code == 200 and response.is_json:
            value = response.get_json()
            user = current_user()
            if isinstance(value, dict) and user is not None:
                value['account'] = account_for(db, user)
                response.set_data(app.json.dumps(value))
        return response

    def get_account():
        user = current_user()
        if user is None:
            return jsonify(error='请先登录'), 401
        return jsonify(account_for(db, user))
    app.add_url_rule('/api/account-permissions', 'account_permissions_current', get_account, methods=['GET'])

    def validate_input(payload):
        if not isinstance(payload, dict):
            raise ValueError('账号数据须为对象')
        for key in ('username', 'display_name', 'password'):
            if key in payload and not isinstance(payload[key], str):
                raise ValueError('账号名称和密码须为文本')
        if 'is_active' in payload and type(payload['is_active']) is not bool:
            raise ValueError('启用状态须为开启或关闭状态')

    def validate_username(value):
        preserved = runtime.get('validate_username')
        error = preserved(value) if preserved else (
            None if re.fullmatch(r'[a-zA-Z0-9._-]{2,32}', value) else '账号须为2-32位字母、数字、点、下划线或短横线')
        if error:
            raise ValueError(error)

    def save_policy(uid, policy):
        values = dict(role=policy['role'], permissions=json.dumps(policy['permissions'], sort_keys=True))
        db.session.execute(_policies.delete().where(_policies.c.user_id == uid))
        db.session.execute(_policies.insert().values(user_id=uid, **values))

    def mutate(operation, uid=None):
        try:
            payload = {} if operation == 'delete' else request.get_json(silent=True)
            validate_input(payload)
            # End the read-only gate transaction, then acquire a DB write lock
            # before refreshing actor, target and the last-admin count. SQLite's
            # single writer serializes this across processes as well as threads.
            db.session.rollback()
            db.session.execute(_lock.update().where(_lock.c.id == 1).values(value=_lock.c.value + 1))
            actor = current_user()
            if actor is None:
                db.session.rollback()
                return jsonify(error='请重新登录'), 401
            if not actor.is_admin:
                account = account_for(db, actor)
                db.session.rollback()
                return denied(account)
            user = _fresh(db, User, uid) if operation != 'create' else None
            if operation != 'create' and user is None:
                db.session.rollback()
                return jsonify(error='用户不存在'), 404
            if operation == 'delete':
                if user.id == actor.id:
                    raise ValueError('不能删除自己')
                proposed_admin, proposed_active = False, False
                policy = None
            else:
                current = account_for(db, user) if user is not None else {'role': 'editor', 'permissions': defaults('editor')}
                policy = _policy_input(payload, current)
                proposed_admin = policy['role'] == 'admin'
                proposed_active = payload.get('is_active', user.is_active if user else True)
                if user is not None and user.id == actor.id:
                    if not proposed_admin:
                        raise ValueError('不能取消自己的管理员权限')
                    if not proposed_active:
                        raise ValueError('不能禁用自己的账号')
            if (user is not None and user.is_admin and user.is_active and not (proposed_admin and proposed_active)
                    and User.query.filter_by(is_admin=True, is_active=True).count() <= 1):
                raise ValueError('至少需要保留一个启用的管理员')
            if operation == 'delete':
                db.session.execute(_policies.delete().where(_policies.c.user_id == user.id))
                db.session.delete(user)
            else:
                username = payload.get('username', user.username if user else '').strip()
                validate_username(username)
                duplicate = User.query.filter(User.username == username)
                if user is not None:
                    duplicate = duplicate.filter(User.id != user.id)
                if duplicate.first() is not None:
                    raise ValueError('该账号已存在')
                password = payload.get('password', '')
                if operation == 'create' and not password or password and len(password) < 8:
                    raise ValueError('密码至少 8 位')
                if user is None:
                    user = User(username=username, password_hash=generate_password_hash(password))
                    db.session.add(user)
                else:
                    user.username = username
                    if password:
                        user.password_hash = generate_password_hash(password)
                user.is_admin, user.is_active = proposed_admin, proposed_active
                if 'display_name' in payload or operation == 'create':
                    user.display_name = payload.get('display_name', '').strip()
                db.session.flush()
                save_policy(user.id, policy)
            db.session.commit()
            return (jsonify(ok=True) if operation == 'delete' else
                    (jsonify(user.to_dict()), 201 if operation == 'create' else 200))
        except (ValueError, IntegrityError) as error:
            db.session.rollback()
            return jsonify(error=str(error) if isinstance(error, ValueError) else '该账号已存在'), 400
        except Exception:
            db.session.rollback()
            app.logger.error('Account update transaction failed')
            return jsonify(error='账号保存失败，请重试'), 500

    # Existing URL rules and the global CSRF/license hooks remain in force.
    for endpoint, handler in (
            ('api_create_user', lambda: mutate('create')),
            ('api_update_user', lambda uid: mutate('update', uid)),
            ('api_delete_user', lambda uid: mutate('delete', uid))):
        if endpoint not in app.view_functions:
            raise RuntimeError('Missing preserved account route: ' + endpoint)
        app.view_functions[endpoint] = handler
    app.extensions['account_permissions'] = {'db': db, 'User': User}
