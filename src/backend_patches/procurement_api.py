"""procurement-api-v1: protected catalog routes and atomic project lifecycle."""
from __future__ import annotations
import hmac
import json
from datetime import date
from functools import wraps
from flask import current_app, jsonify, request, session
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

if __package__:
    from . import procurement_catalog as catalog, stage_templates, stage_workflow
    from .business_input_validation import validate_business_input
else:
    import procurement_catalog as catalog, stage_templates, stage_workflow
    from business_input_validation import validate_business_input


def authorize(models, *, write=False, admin=False, pid=None):
    if not session.get('user_id'):
        return None, (jsonify(error='请先登录'), 401)
    db = models['db']
    User = models.get('User')
    user = db.session.get(User, session['user_id']) if User else None
    if User and (not user or not bool(getattr(user, 'is_active', True))):
        return None, (jsonify(error='账号不可用，请重新登录'), 401)
    if admin and not (bool(getattr(user, 'is_admin', False)) if User else session.get('is_admin')):
        return None, (jsonify(error='只有管理员可以修改采购方式和默认流程'), 403)
    if write:
        expected, supplied = str(session.get('csrf_token') or ''), str(request.headers.get('X-CSRFToken') or '')
        if not expected or not hmac.compare_digest(expected.encode(), supplied.encode()):
            return None, (jsonify(error='请求已过期，请刷新后重试'), 403)
    project = db.session.get(models['Project'], pid) if pid is not None else None
    if pid is not None:
        if not project:
            return None, (jsonify(error='项目不存在'), 404)
        access = models.get('can_access_project') or current_app.extensions.get('deadline_project_access')
        if access and not access(user, project):
            return None, (jsonify(error='无权访问此项目'), 403)
    return project, None


def body():
    value = request.get_json(silent=True)
    if not isinstance(value, dict) or len(json.dumps(value, ensure_ascii=False)) > 131072:
        raise catalog.CatalogError('INVALID_BODY', '请求须为有效的配置对象，且不能超过允许长度')
    return value


def fail(db, error):
    db.session.rollback()
    if isinstance(error, catalog.CatalogError):
        return jsonify(error=str(error), code=error.code, **error.details), error.status
    if isinstance(error, (ValueError, TypeError)):
        return jsonify(error=str(error), code='INVALID_INPUT'), 400
    current_app.logger.warning('采购配置操作失败: %s', type(error).__name__)
    return jsonify(error='采购配置暂时无法保存，原记录已保留，请重新读取后重试', code='CATALOG_STORAGE_FAILED'), 503


def projection(db):
    cat = catalog.load_catalog(db)
    names = [m['name'] for m in cat['methods']]
    unique = [m for m in cat['methods'] if names.count(m['name']) == 1]
    return dict(procurement_catalog=cat,
        stage_templates={m['name']: catalog.method_stages(db, m) for m in unique},
        supplier_minimums={m['name']: m['quantity_rule']['minimum'] for m in unique},
        stage_module_catalog=stage_templates.module_catalog_payload())


def project_payload(models, project):
    db = models['db']
    payload = stage_templates.serialize_v5_project_payload(db.session, text, project, project.to_dict(),
        {}, stage_templates.PROCUREMENT_METHODS, models.get('STAGES', []))
    payload = catalog.enrich_project(db, project, payload)
    payload['online_bidding_enabled'] = bool(catalog.is_online_bidding(project, payload) and stage_templates.online_bidding_enabled(db.session, text, project.id))
    return payload


def create_project(models):
    db, Project = models['db'], models['Project']
    _, denied = authorize(models, write=True)
    if denied:
        return denied
    try:
        data = body()
        error = validate_business_input('api_create_project', data, [m['name'] for m in catalog.load_catalog(db)['methods']])
        if error:
            raise ValueError(error)
        number, name = str(data.get('number') or '').strip(), str(data.get('name') or '').strip()
        if not number or not name:
            raise ValueError('项目编号和名称不能为空')
        catalog._lock(db)
        if Project.query.filter_by(number=number).first():
            raise ValueError('项目编号已存在')
        method = catalog.resolve_method(db, data.get('procurement_method_id'), data.get('method'), data.get('procurement_regime'))
        year = int(data.get('year') or date.today().year)
        if not 1900 <= year <= 9999:
            raise ValueError('年度格式不正确')
        project = Project(number=number, name=name, purchaser=str(data.get('purchaser') or ''), method=method['name'],
            budget=str(data.get('budget') or ''), year=year, no_deposit=data.get('no_deposit', False),
            prepare_owner=str(data.get('prepare_owner') or ''), review_owner=str(data.get('review_owner') or ''))
        db.session.add(project)
        db.session.flush()
        project.ensure_stages()
        db.session.flush()
        rows = catalog.method_stages(db, method)
        stage_templates.replace_v5_project_stage_snapshot(db.session, text, project.id, rows)
        catalog.bind_project(db, project, method)
        if method['builtin_kind'] == '网上竞价' or any('online_bidding' in r['modules'] for r in rows):
            stage_templates.initialize_online_bidding_scope(db.session, text, project.id, '网上竞价')
        if project.no_deposit:
            for row in rows:
                if 'deposit_refund' in row['modules']:
                    db.session.execute(text('UPDATE stages SET skipped=1,completed=1,completed_date=:today WHERE project_id=:id AND stage_key=:key'), dict(today=date.today().isoformat(), id=project.id, key=row['id']))
        if 'deposit_required_amount' in data and not project.no_deposit:
            if __package__:from . import tender_guarantee
            else:import tender_guarantee
            tender_guarantee.set_document_amount(db, project, data['deposit_required_amount'], actor=session['user_id'])
        catalog._audit(db, 'project_method_bind', project.id, dict(method_id=method['id']), session['user_id'])
        db.session.commit()
        db.session.expire(project, ['stages'])
        payload = project_payload(models, project)
        logger = models.get('log_operation')
        if callable(logger):
            logger('create_project', 'project', project.id, f'创建项目：{project.number} {project.name}')
        return jsonify(payload), 201
    except (catalog.CatalogError, ValueError, TypeError, SQLAlchemyError) as error:
        return fail(db, error)


def update_project(models, pid):
    db, Project = models['db'], models['Project']
    project, denied = authorize(models, write=True, pid=pid)
    if denied:
        return denied
    try:
        data = body()
        names = [m['name'] for m in catalog.load_catalog(db)['methods']]
        # Existing name snapshots remain valid after a rename or disabling.
        names.append(project.method)
        error = validate_business_input('api_update_project', data, names)
        if error:
            raise ValueError(error)
        catalog._lock(db)
        if 'number' in data:
            data['number'] = str(data['number']).strip()
            duplicate = Project.query.filter(Project.number == data['number'], Project.id != project.id).first()
            if duplicate:
                raise ValueError('项目编号已存在')
        if 'name' in data:
            data['name'] = data['name'].strip()
        if 'procurement_method_id' in data or 'method' in data:
            before = catalog.project_snapshot(db, project.id)
            same_legacy_name = not data.get('procurement_method_id') and data.get('method') == project.method
            if not same_legacy_name:
                method = catalog.resolve_method(db, data.get('procurement_method_id'), data.get('method'), data.get('procurement_regime'), existing_project=project)
                if not before or before['method_id'] != method['id']:
                    catalog.bind_project(db, project, method)
                    project.method = method['name']
                    catalog._audit(db, 'project_method_change', project.id, dict(before=before, after=catalog.project_snapshot(db, project.id)), session['user_id'])
        for field in ('name', 'number', 'purchaser', 'budget', 'notes', 'prepare_owner', 'review_owner'):
            if field in data:
                setattr(project, field, data[field])
        if 'year' in data:
            project.year = int(data['year'])
        if 'is_terminated' in data:
            project.is_terminated = data['is_terminated']
            project.terminated_type = data.get('terminated_type') or 'terminated' if project.is_terminated else ''
            if not project.is_terminated:
                project.terminated_reason = ''
        elif 'terminated_type' in data:
            project.terminated_type = data['terminated_type'] or ''
            project.is_terminated = bool(project.terminated_type)
        if 'terminated_reason' in data:
            project.terminated_reason = str(data['terminated_reason'] or '')
        if 'second_tender_id' in data:
            value = data['second_tender_id']
            target = None if value in (None, '') else int(value)
            if target == project.id:
                raise ValueError('不能将项目自身关联为二次招标')
            if target is not None and db.session.get(Project, target) is None:
                raise ValueError('二次招标关联的项目不存在')
            project.second_tender_id = target
        if 'no_deposit' in data:
            project.no_deposit = data['no_deposit']
            # Never rewrite already completed historical stages here.
            if project.no_deposit:
                rows = db.session.execute(text('SELECT stage_key,modules_json FROM stages WHERE project_id=:pid AND COALESCE(completed,0)=0'), {'pid': pid}).all()
                for key, modules in rows:
                    if 'deposit_refund' in json.loads(modules or '[]'):
                        db.session.execute(text('UPDATE stages SET skipped=1,completed=1,completed_date=:today WHERE project_id=:pid AND stage_key=:key'), dict(today=date.today().isoformat(), pid=pid, key=key))
        if 'procurement_archive_sent' in data:
            value = data['procurement_archive_sent']
            if value != project.procurement_archive_sent:
                project.procurement_archive_sent_date = date.today() if value else None
            project.procurement_archive_sent = value
            sync = models.get('_sync_archive_checklist')
            if callable(sync):sync(project)
        db.session.commit()
        db.session.expire(project, ['stages'])
        return jsonify(project_payload(models, project))
    except (catalog.CatalogError, ValueError, TypeError, SQLAlchemyError) as error:
        return fail(db, error)


def register(app, database, models):
    if app.extensions.get('procurement_catalog'):
        return
    models = dict(models, db=database)
    with app.app_context():
        try:
            catalog.migrate_legacy(database, models['load_app_settings'](), models.get('STAGES', []))
            database.session.commit()
        except Exception:
            database.session.rollback()
            raise
    app.extensions['procurement_catalog'] = models

    def protected(admin=False):
        def decorate(fn):
            @wraps(fn)
            def wrapped(*args, **kwargs):
                _, denied = authorize(models, write=request.method != 'GET', admin=admin)
                if denied:return denied
                try:return fn(*args, **kwargs)
                except (catalog.CatalogError, ValueError, TypeError, SQLAlchemyError) as error:return fail(database, error)
            return wrapped
        return decorate

    @protected()
    def listing():
        if request.method == 'GET':
            return jsonify(catalog.load_catalog(database))
        _, denied = authorize(models, write=True, admin=True)
        if denied:return denied
        value = body();revision = value.pop('revision', None)
        row = catalog.save_method(database, value, revision, session['user_id'])
        database.session.commit()
        return jsonify(method=row, revision=catalog.load_catalog(database)['revision']), 201

    @protected(admin=True)
    def modifying(mid):
        value = body();revision = value.pop('revision', None)
        if request.method == 'DELETE':
            catalog.delete_method(database, mid, revision, session['user_id']);row = None
        else:
            row = catalog.save_method(database, value, revision, session['user_id'], mid)
        database.session.commit()
        return jsonify(method=row, revision=catalog.load_catalog(database)['revision'])

    @protected(admin=True)
    def reorder():
        value = body()
        result = catalog.reorder_methods(database, value.get('ids'), value.get('revision'), session['user_id'])
        database.session.commit()
        return jsonify(result)

    @protected(admin=True)
    def common_flow():
        value = body()
        result = catalog.save_common_flow(database, value.get('stages'), value.get('revision'), session['user_id'])
        database.session.commit()
        return jsonify(result)

    app.add_url_rule('/api/procurement-methods', 'procurement_methods', listing, methods=['GET','POST'])
    app.add_url_rule('/api/procurement-methods/<mid>', 'procurement_method', modifying, methods=['PATCH','DELETE'])
    app.add_url_rule('/api/procurement-methods/reorder', 'procurement_method_reorder', reorder, methods=['POST'])
    app.add_url_rule('/api/procurement-common-flow', 'procurement_common_flow', common_flow, methods=['PUT'])

    @app.before_request
    def compatibility_settings():
        if request.path != '/api/settings' or request.method != 'PATCH':return None
        value = request.get_json(silent=True)
        if not isinstance(value, dict) or not {'stage_templates','supplier_minimums','stage_template_sync_method'}.intersection(value):return None
        _, denied = authorize(models, write=True, admin=True)
        if denied:return denied
        try:
            if 'stage_template_sync_method' in value:
                raise catalog.CatalogError('BULK_FLOW_DISABLED', '默认模板只影响新项目；请在需要调整的单个项目内预览并修改流程', 409)
            if set(value) - {'stage_templates','supplier_minimums','catalog_revision'}:
                raise catalog.CatalogError('MIXED_SETTINGS', '采购方式规则须单独保存，不能与其他系统设置混合提交')
            catalog._lock(database)
            cat = catalog.load_catalog(database)
            catalog._revision(cat['revision'], value.get('catalog_revision'))
            for field in ('stage_templates','supplier_minimums'):
                if field not in value:continue
                if not isinstance(value[field], dict):raise ValueError('兼容配置格式不正确')
                for name, item in value[field].items():
                    candidates = [m for m in catalog.load_catalog(database)['methods'] if m['name'] == name]
                    if len(candidates) != 1:raise catalog.CatalogError('AMBIGUOUS_METHOD', '采购方式名称不能唯一匹配，请使用新版目录编辑')
                    method = candidates[0]
                    change = dict(template_mode='independent', stages=item) if field == 'stage_templates' else dict(quantity_rule=dict(mode='unfixed' if item is None else 'fixed', minimum=item))
                    catalog.save_method(database, change, method['revision'], session['user_id'], method['id'])
            database.session.commit()
            return jsonify(settings=projection(database))
        except (catalog.CatalogError, ValueError, TypeError, SQLAlchemyError) as error:return fail(database, error)

    @app.after_request
    def add_catalog_metadata(response):
        if response.status_code >= 400 or not response.is_json:return response
        value = response.get_json()
        if request.path == '/api/settings' and request.method == 'GET' and isinstance(value, dict):
            value.update(projection(database))
        elif request.path == '/api/projects' and request.method == 'GET' and isinstance(value, list):
            snapshots = {r[0]: json.loads(r[1]) | {'workflow_revision':r[2]} for r in catalog._sql(database, 'SELECT project_id,snapshot_json,workflow_revision FROM project_procurement_snapshots')}
            current = {m['id']:m for m in catalog.load_catalog(database)['methods']}
            for row in value:
                snap = snapshots.get(row.get('id'))
                if snap and snap['method_id'] in current:
                    method = current[snap['method_id']]
                    row['procurement'] = {**snap, 'current_name':method['name'], 'current_enabled':method['enabled']}
        elif request.path.startswith('/api/projects/') and request.path.removeprefix('/api/projects/').isdigit() and isinstance(value, dict) and 'id' in value:
            project = database.session.get(models['Project'], value['id'])
            if project:value = catalog.enrich_project(database, project, value)
        else:return response
        response.set_data(json.dumps(value, ensure_ascii=False))
        response.headers.pop('Content-Length', None)
        return response
