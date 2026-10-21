"""procurement-catalog-v1: transactional identities, defaults and project snapshots."""
from __future__ import annotations
import copy
import hashlib
import json
import re
import uuid
from datetime import datetime, timedelta, timezone
from sqlalchemy import text

if __package__:
    from . import stage_templates as templates
else:
    import stage_templates as templates

REGIMES = {
    'government_procurement': '政府采购',
    'mandatory_construction_bidding': '依法必须招标的工程建设项目',
    'enterprise': '企业及国有企业自主采购',
    'collective': '集体经济组织采购',
    'other': '其他采购',
}
LEGACY_MINIMUMS = dict(zip(templates.PROCUREMENT_METHODS, (3, 3, 3, 3, 3, 1, 3, 1)))


class CatalogError(ValueError):
    def __init__(self, code, message, status=400, **details):
        super().__init__(message)
        self.code, self.status, self.details = code, status, details


def _sql(db, statement, values=None):
    return db.session.execute(text(statement), values or {})


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def _now():
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


def _timeline_time(value, *, utc_naive=False):
    if value in (None, ''):
        return None
    value = value.isoformat() if hasattr(value, 'isoformat') else str(value)
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    except (ValueError, TypeError):
        return None
    if len(value) == 10 or parsed.tzinfo is not None:
        return value
    # Project creation is stored as naive UTC by the original SQLite model;
    # user-entered stage completion timestamps use Beijing time.
    return value + ('+00:00' if utc_naive else '+08:00')


def project_timeline(payload, terminated_at=None):
    """Read existing facts only; never substitute a plan or installation date."""
    created = _timeline_time(payload.get('created_at'), utc_naive=True)
    if payload.get('is_terminated'):
        state = payload.get('terminated_type')
        state = state if state in ('liubiao', 'feibiao') else 'terminated'
        ended = _timeline_time(terminated_at, utc_naive=True)
        return dict(state=state, created_at=created, ended_at=ended,
                    end_source='termination_record' if ended else 'unrecorded')
    stages = [s for s in payload.get('stages', []) if not s.get('template_removed')]
    complete = bool(stages) and all(s.get('completed') or s.get('skipped') for s in stages)
    dates = [_timeline_time(s.get('completed_at') or s.get('completed_date'))
             for s in stages if not s.get('skipped')]
    ended = None
    if complete and dates and all(dates):
        def instant(value):
            parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
            return parsed.replace(tzinfo=timezone(timedelta(hours=8))).timestamp() if parsed.tzinfo is None else parsed.timestamp()
        ended = max(dates, key=instant)
        end_day = datetime.fromtimestamp(instant(ended), timezone(timedelta(hours=8))).date().isoformat()
        if any(len(value) == 10 and value == end_day for value in dates):
            ended = end_day
    return dict(state='completed' if complete else 'active', created_at=created,
                ended_at=ended, end_source='stage_completion' if ended else 'unrecorded')


def record_project_end(database, project, was_terminated):
    """Persist a termination transition in the same business transaction."""
    if not project.is_terminated:
        _sql(database, 'DELETE FROM project_end_dates WHERE project_id=:id', dict(id=project.id))
    elif not was_terminated:
        created = _timeline_time(getattr(project, 'created_at', None), utc_naive=True) or ''
        _sql(database, '''INSERT INTO project_end_dates(project_id,created_at_snapshot,ended_at)
            VALUES(:id,:created,:ended) ON CONFLICT(project_id) DO UPDATE SET
            created_at_snapshot=excluded.created_at_snapshot,ended_at=excluded.ended_at''',
            dict(id=project.id, created=created, ended=_now()))


def enrich_project_timeline(database, payload, end_dates=None):
    if end_dates is None:
        end_dates = {r[0]:(r[1],r[2]) for r in _sql(database,
            'SELECT project_id,created_at_snapshot,ended_at FROM project_end_dates WHERE project_id=:id',
            dict(id=payload['id']))}
    created = _timeline_time(payload.get('created_at'), utc_naive=True) or ''
    stored = end_dates.get(payload['id'])
    ended = stored[1] if stored and stored[0] == created else None
    return dict(payload, project_timeline=project_timeline(payload, ended))


def _lock(db):
    connection = db.session.connection()
    raw = connection.connection.driver_connection
    if connection.dialect.name == 'sqlite' and not raw.in_transaction:
        connection.exec_driver_sql('BEGIN IMMEDIATE')


def ensure_schema(database):
    statements = [
        '''CREATE TABLE IF NOT EXISTS project_end_dates (
            project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            created_at_snapshot TEXT NOT NULL, ended_at TEXT NOT NULL)''',
        'CREATE TABLE IF NOT EXISTS procurement_catalog_state (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, common_stages TEXT NOT NULL)',
        '''CREATE TABLE IF NOT EXISTS procurement_methods (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, regime TEXT, notes TEXT NOT NULL,
            enabled INTEGER NOT NULL, position INTEGER NOT NULL, revision INTEGER NOT NULL,
            builtin_kind TEXT, quantity_rule TEXT NOT NULL, exceptions TEXT NOT NULL,
            template_mode TEXT NOT NULL, stages TEXT NOT NULL, updated_at TEXT NOT NULL)''',
        'CREATE UNIQUE INDEX IF NOT EXISTS procurement_method_identity ON procurement_methods(COALESCE(regime,\'\'),name)',
        '''CREATE TABLE IF NOT EXISTS project_procurement_snapshots (
            project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
            method_id TEXT NOT NULL REFERENCES procurement_methods(id) ON DELETE RESTRICT,
            snapshot_json TEXT NOT NULL, workflow_revision INTEGER NOT NULL DEFAULT 0)''',
        '''CREATE TABLE IF NOT EXISTS lot_procurement_snapshots (
            lot_id INTEGER PRIMARY KEY REFERENCES project_lots(id) ON DELETE CASCADE,
            method_id TEXT NOT NULL REFERENCES procurement_methods(id) ON DELETE RESTRICT,
            snapshot_json TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS procurement_method_guarantee_defaults (method_id TEXT PRIMARY KEY REFERENCES procurement_methods(id) ON DELETE CASCADE, rules TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS procurement_reference_presets (
            preset_key TEXT PRIMARY KEY,method_id TEXT,status TEXT NOT NULL,
            reference_json TEXT NOT NULL,config_fingerprint TEXT NOT NULL,installed_at TEXT NOT NULL)''',
        '''CREATE TABLE IF NOT EXISTS procurement_config_audit (
            id INTEGER PRIMARY KEY, action TEXT NOT NULL, scope TEXT NOT NULL,
            payload_json TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL)''',
    ]
    for sql in statements:
        _sql(database, sql)


def ready(database):
    return bool(_sql(database, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='procurement_catalog_state'").first()) and bool(_sql(database, 'SELECT 1 FROM procurement_catalog_state WHERE id=1').first())


def _audit(db, action, scope, payload, actor):
    _sql(db, 'INSERT INTO procurement_config_audit(action,scope,payload_json,actor,created_at) VALUES(:a,:s,:p,:u,:t)',
         dict(a=action, s=str(scope), p=_json(payload), u=str(actor), t=_now()))


def _decode(row):
    if row is None:
        raise CatalogError('METHOD_NOT_FOUND', '采购方式不存在', 404)
    result = dict(row)
    for field in ('quantity_rule', 'exceptions', 'stages'):
        result[field] = json.loads(result[field])
    result['enabled'] = bool(result['enabled'])
    return result


def get_method(db, identity):
    return _decode(_sql(db, 'SELECT * FROM procurement_methods WHERE id=:id', {'id': identity}).mappings().first())


def _count_references(db, method):
    count = _sql(db, 'SELECT COUNT(*) FROM project_procurement_snapshots WHERE method_id=:id', {'id': method['id']}).scalar()
    count += _sql(db, 'SELECT COUNT(*) FROM lot_procurement_snapshots WHERE method_id=:id', {'id': method['id']}).scalar()
    count += _sql(db, 'SELECT COUNT(*) FROM projects p WHERE p.method=:name AND NOT EXISTS (SELECT 1 FROM project_procurement_snapshots s WHERE s.project_id=p.id)', {'name': method['name']}).scalar()
    return count


def load_catalog(database):
    state = _sql(database, 'SELECT revision,common_stages FROM procurement_catalog_state WHERE id=1').first()
    if not state:
        raise CatalogError('CATALOG_NOT_INITIALIZED', '采购方式目录尚未初始化', 409)
    methods = [_decode(r) for r in _sql(database, 'SELECT * FROM procurement_methods ORDER BY position,id').mappings()]
    # Aggregate references once, rather than issuing one project query per row.
    references = dict(_sql(database, 'SELECT method_id,COUNT(*) FROM project_procurement_snapshots GROUP BY method_id').all())
    for mid, count in _sql(database, 'SELECT method_id,COUNT(*) FROM lot_procurement_snapshots GROUP BY method_id'):
        references[mid] = references.get(mid, 0) + count
    preset_rows = _preset_records(database)
    origins = {r['method_id']: r for r in preset_rows if r['status']=='installed'}
    manual={r[0] for r in _sql(database,"SELECT DISTINCT scope FROM procurement_config_audit WHERE action IN ('method_update','guarantee_defaults')")}
    automatic=set()
    if _sql(database,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='personal_flow_profiles'").first():
        raw=_sql(database,'SELECT profile_json FROM personal_flow_profiles WHERE id=1').scalar()
        try:automatic={r.get('target_id') for r in json.loads(raw or '{}').get('updated',[])}
        except (ValueError,TypeError,AttributeError):pass
    for method in methods:
        method['reference_count'] = references.get(method['id'], 0)
        origin = origins.get(method['id'])
        if origin:
            method['reference_preset'] = {**json.loads(origin['reference_json']),
                'customized': origin['config_fingerprint'] != _preset_fingerprint(method)}
        method['user_owned'] = not origin or method['reference_count']>0 or method['id'] in manual or (method['reference_preset']['customized'] and method['id'] not in automatic)
    result = dict(revision=state[0], common_stages=json.loads(state[1]), methods=methods, management_mode='custom')
    if preset_rows:
        result['preset_summary'] = dict(installed=sum(r['status']=='installed' for r in preset_rows),
            conflicts=sum(r['status']=='conflict' for r in preset_rows), capacity_pending=sum(r['status']=='capacity' for r in preset_rows))
    return result


def _preset_records(database):
    if not _sql(database, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='procurement_reference_presets'").first():
        return []
    return list(_sql(database, 'SELECT * FROM procurement_reference_presets').mappings())


def _preset_fingerprint(method):
    fields = ('name','regime','notes','enabled','quantity_rule','exceptions','template_mode','stages')
    return hashlib.sha256(_json({field:method[field] for field in fields}).encode('utf8')).hexdigest()


def install_national_presets(database):
    """Append missing reference configs once; never reclassify or rewrite history."""
    if __package__:from . import procurement_presets
    else:import procurement_presets
    _lock(database)
    ensure_schema(database)
    previous = {r['preset_key']:r for r in _preset_records(database)}
    for preset in procurement_presets.definitions():
        prior = previous.get(preset['key'])
        if prior and prior['status'] != 'capacity':
            continue
        method = preset['method']
        exists = _sql(database, 'SELECT id FROM procurement_methods WHERE regime=:r AND name=:n',
            dict(r=method['regime'],n=method['name'])).first()
        if exists:
            identity,status,fingerprint = exists[0],'conflict',''
        elif _sql(database, 'SELECT COUNT(*) FROM procurement_methods').scalar() >= 200:
            identity,status,fingerprint = None,'capacity',''
        else:
            saved = save_method(database,method,load_catalog(database)['revision'],'national_reference_install')
            identity,status,fingerprint = saved['id'],'installed',_preset_fingerprint(saved)
        values = dict(key=preset['key'],mid=identity,status=status,reference=_json(preset['reference']),fingerprint=fingerprint,at=_now())
        if prior and prior['status']=='capacity' and status=='capacity':
            continue
        _sql(database, '''INSERT INTO procurement_reference_presets VALUES(:key,:mid,:status,:reference,:fingerprint,:at)
            ON CONFLICT(preset_key) DO UPDATE SET method_id=excluded.method_id,status=excluded.status,
            reference_json=excluded.reference_json,config_fingerprint=excluded.config_fingerprint,installed_at=excluded.installed_at''', values)
        _audit(database,'national_preset_'+status,preset['key'],dict(method_id=identity),'national_reference_install')
    return load_catalog(database)


def normalize_quantity(value):
    if not isinstance(value, dict) or value.get('mode') not in ('fixed', 'unfixed'):
        raise CatalogError('INVALID_QUANTITY', '请选择固定数量或不固定最低数量')
    minimum = value.get('minimum')
    if value['mode'] == 'fixed':
        if type(minimum) is not int or not 1 <= minimum <= 99:
            raise CatalogError('INVALID_QUANTITY', '配置最低数量须为1至99的整数')
    elif minimum is not None:
        raise CatalogError('INVALID_QUANTITY', '不固定最低数量时不能同时填写数量')
    return dict(mode=value['mode'], minimum=minimum)


def normalize_stages(rows):
    try:
        return templates.normalize_stage_templates({'flow': rows}, ['flow'], [], strict=True, migrate_legacy_auto_completion=False)['flow']
    except ValueError as error:
        raise CatalogError('INVALID_FLOW', str(error)) from error


def _exceptions(rows, previous=()):
    if not isinstance(rows, list) or len(rows) > 20:
        raise CatalogError('INVALID_EXCEPTION', '每种采购方式最多配置20项例外情形')
    result = []
    previous_ids = {r['id'] for r in previous}
    for row in rows:
        if not isinstance(row, dict):
            raise CatalogError('INVALID_EXCEPTION', '例外情形格式不正确')
        title = _string(row.get('title'), '例外情形标题', 60)
        description = _string(row.get('description'), '例外适用说明', 2000)
        enabled = row.get('enabled', True)
        if type(enabled) is not bool:
            raise CatalogError('INVALID_EXCEPTION', '例外启用状态不正确')
        identity = row.get('id') or uuid.uuid4().hex
        if row.get('id') and identity not in previous_ids:
            raise CatalogError('INVALID_EXCEPTION', '例外情形标识不属于此采购方式')
        if identity in {r['id'] for r in result}:
            raise CatalogError('INVALID_EXCEPTION', '例外情形标识重复')
        result.append(dict(id=identity, title=title, description=description, enabled=enabled, quantity_rule=normalize_quantity(row.get('quantity_rule'))))
    return result


def _string(value, label, limit, optional=False):
    if not isinstance(value, str) or (not optional and not value.strip()) or len(value.strip()) > limit or re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', value):
        raise CatalogError('INVALID_TEXT', f'{label}须为{limit}字以内的文字' + ('且不能为空' if not optional else ''))
    return value.strip()


def _revision(actual, expected):
    if type(expected) is not int or expected != actual:
        raise CatalogError('REVISION_CONFLICT', '配置已被其他操作更新，请重新读取后再保存；当前输入未保存', 409)


def _bump(db):
    _sql(db, 'UPDATE procurement_catalog_state SET revision=revision+1 WHERE id=1')


def _insert(db, row):
    values = {**row, 'enabled': int(row['enabled']), 'updated_at': _now()}
    for field in ('quantity_rule', 'exceptions', 'stages'):
        values[field] = _json(values[field])
    fields = ','.join(values)
    _sql(db, f'INSERT INTO procurement_methods({fields}) VALUES({",".join(":"+k for k in values)})', values)


def save_method(database, payload, expected_revision, actor, method_id=None):
    _lock(database)
    if not isinstance(payload, dict) or set(payload) - {'name', 'regime', 'notes', 'enabled', 'quantity_rule', 'exceptions', 'template_mode', 'stages'}:
        raise CatalogError('INVALID_METHOD', '采购方式配置字段不正确')
    old = get_method(database, method_id) if method_id else None
    cat = load_catalog(database)
    _revision(old['revision'] if old else cat['revision'], expected_revision)
    if not old and len(cat['methods']) >= 200:
        raise CatalogError('METHOD_LIMIT', '采购方式最多保留200项，可停用不再使用的方式')
    row = copy.deepcopy(old) if old else dict(id=uuid.uuid4().hex, name='', regime=None, notes='', enabled=True, position=len(cat['methods']), revision=0,
        builtin_kind=None, quantity_rule=dict(mode='unfixed', minimum=None), exceptions=[], template_mode='common', stages=[])
    row.update(copy.deepcopy(payload))
    row['name'] = _string(row['name'], '采购方式名称', 60)
    row['notes'] = _string(row['notes'], '备注', 2000, optional=True)
    if row['regime'] is not None and row['regime'] not in REGIMES:
        raise CatalogError('INVALID_REGIME', '历史分类标识不正确')
    if 'regime' not in payload and (not old or row['name'] != old['name']):
        if any(m['id']!=row['id'] and m['name']==row['name'] and m['user_owned'] for m in cat['methods']):
            raise CatalogError('DUPLICATE_METHOD', '已存在同名采购方式，请使用其他名称', 409)
    if type(row['enabled']) is not bool:
        raise CatalogError('INVALID_ENABLED', '启用状态须为是或否')
    duplicate = _sql(database, 'SELECT id FROM procurement_methods WHERE name=:name AND COALESCE(regime,\'\')=:regime AND id<>:id',
                     dict(name=row['name'], regime=row['regime'] or '', id=row['id'])).first()
    if duplicate:
        raise CatalogError('DUPLICATE_METHOD', '已存在同名采购方式，请使用其他名称', 409)
    row['quantity_rule'] = normalize_quantity(row['quantity_rule'])
    row['exceptions'] = _exceptions(row['exceptions'], old['exceptions'] if old else ())
    if row['template_mode'] not in ('common', 'independent'):
        raise CatalogError('INVALID_FLOW', '请选择通用流程或独立流程')
    row['stages'] = normalize_stages(row['stages']) if row['template_mode'] == 'independent' else []
    if old:_validate_guarantee_anchors(guarantee_defaults(database,row['id']), method_stages(database,row))
    row['revision'] += 1
    row.pop('updated_at', None)
    if old:
        values = {**row, 'enabled': int(row['enabled']), 'updated_at': _now()}
        for field in ('quantity_rule', 'exceptions', 'stages'):
            values[field] = _json(values[field])
        _sql(database, 'UPDATE procurement_methods SET '+','.join(k+'=:'+k for k in values if k!='id')+' WHERE id=:id', values)
    else:
        _insert(database, row)
    _bump(database)
    _audit(database, 'method_update' if old else 'method_create', row['id'], dict(before=old, after=row), actor)
    return get_method(database, row['id'])


def reorder_methods(database, ids, expected_revision, actor):
    _lock(database)
    cat = load_catalog(database)
    _revision(cat['revision'], expected_revision)
    if not isinstance(ids, list) or len(ids) != len(cat['methods']) or len(set(ids)) != len(ids) or set(ids) != {m['id'] for m in cat['methods']}:
        raise CatalogError('INVALID_ORDER', '排序必须包含全部采购方式且不能重复')
    for index, identity in enumerate(ids):
        _sql(database, 'UPDATE procurement_methods SET position=:p WHERE id=:id', dict(p=index, id=identity))
    _bump(database)
    _audit(database, 'method_reorder', 'catalog', ids, actor)
    return load_catalog(database)


def delete_method(database, method_id, expected_revision, actor):
    _lock(database)
    row = get_method(database, method_id)
    _revision(row['revision'], expected_revision)
    count = _count_references(database, row)
    if count:
        raise CatalogError('METHOD_IN_USE', f'该采购方式已有{count}处项目或采购包引用，不能删除，可改为停用', 409, reference_count=count)
    _sql(database, 'DELETE FROM procurement_methods WHERE id=:id', {'id': method_id})
    _bump(database)
    _audit(database, 'method_delete', method_id, row, actor)


def save_common_flow(database, stages, expected_revision, actor):
    _lock(database)
    _revision(load_catalog(database)['revision'], expected_revision)
    rows = normalize_stages(stages)
    for method in load_catalog(database)['methods']:
        if method['template_mode']=='common':_validate_guarantee_anchors(guarantee_defaults(database,method['id']),rows)
    _sql(database, 'UPDATE procurement_catalog_state SET common_stages=:rows,revision=revision+1 WHERE id=1', {'rows': _json(rows)})
    _audit(database, 'common_flow', 'catalog', rows, actor)
    return load_catalog(database)


def method_stages(database, method):
    return copy.deepcopy(method['stages'] if method['template_mode'] == 'independent' else load_catalog(database)['common_stages'])


def _snapshot(method):
    return dict(method_id=method['id'], name_snapshot=method['name'], regime=method['regime'], method_revision=method['revision'],
                quantity_rule=copy.deepcopy(method['quantity_rule']), exceptions=copy.deepcopy(method['exceptions']), builtin_kind=method['builtin_kind'])


def bind_project(database, project, method):
    _lock(database)
    current = get_method(database, method['id'])
    _revision(current['revision'], method['revision'])
    if not current['enabled']:
        raise CatalogError('METHOD_UNAVAILABLE', '采购方式已停用，请重新选择', 409)
    require_user_method(database,current)
    previous = project_snapshot(database, project.id)
    if previous and previous['method_id'] != current['id']:
        # Explicit package snapshots retain their own rules; inherited scopes
        # must choose an exception from the newly selected method again.
        if _sql(database, "SELECT 1 FROM sqlite_master WHERE type='table' AND name='procurement_quantity_overrides'").first():
            values = {'pid': project.id}
            scopes = '''project_id=:pid AND (lot_id=0 OR NOT EXISTS
                (SELECT 1 FROM lot_procurement_snapshots l WHERE l.lot_id=procurement_quantity_overrides.lot_id))'''
            removed = list(_sql(database, 'SELECT * FROM procurement_quantity_overrides WHERE '+scopes, values).mappings())
            if removed:
                _audit(database, 'quantity_exception_reset', project.id, [dict(row) for row in removed], 'project_method_change')
                _sql(database, 'DELETE FROM procurement_quantity_overrides WHERE '+scopes, values)
    snapshot = _snapshot(current)
    _sql(database, '''INSERT INTO project_procurement_snapshots(project_id,method_id,snapshot_json,workflow_revision)
        VALUES(:pid,:mid,:json,1) ON CONFLICT(project_id) DO UPDATE SET method_id=excluded.method_id,
        snapshot_json=excluded.snapshot_json''', dict(pid=project.id, mid=current['id'], json=_json(snapshot)))
    return snapshot


def project_snapshot(database, project_id):
    row = _sql(database, 'SELECT snapshot_json,workflow_revision FROM project_procurement_snapshots WHERE project_id=:id', {'id': project_id}).first()
    return {**json.loads(row[0]), 'workflow_revision': row[1]} if row else None


def enrich_project(database, project, payload):
    result = dict(payload)
    snapshot = project_snapshot(database, project.id)
    if snapshot:
        current = get_method(database, snapshot['method_id'])
        result['procurement'] = {**snapshot, 'current_name': current['name'], 'current_enabled': current['enabled']}
    return result


def require_user_method(database,method):
    current=next(m for m in load_catalog(database)['methods'] if m['id']==method['id'])
    if not current['user_owned']:
        raise CatalogError('METHOD_REFERENCE_ARCHIVED','该自动参考项已退出选择列表，请选择或创建自己的采购方式',409)


def resolve_method(database, method_id=None, name=None, regime=None, existing_project=None):
    if method_id:
        row = get_method(database, method_id)
    else:
        candidates = [m for m in load_catalog(database)['methods'] if m['user_owned'] and m['name'] == name and (regime is None or m['regime'] == regime)]
        if len(candidates) > 1:
            raise CatalogError('AMBIGUOUS_METHOD', '存在同名历史配置，请明确选择采购方式')
        if not candidates:
            raise CatalogError('METHOD_NOT_FOUND', '采购方式不存在，请从当前目录选择')
        row = candidates[0]
    if existing_project:
        old = project_snapshot(database, existing_project.id)
        if old and old['method_id'] == row['id']:
            return row
    if not row['enabled']:
        raise CatalogError('METHOD_DISABLED', '该采购方式已停用，不能用于新建或改选项目')
    require_user_method(database,row)
    return row


def is_online_bidding(project, payload=None):
    procurement = (payload or {}).get('procurement') or getattr(project, 'procurement', None) or {}
    return procurement.get('builtin_kind') == '网上竞价' or any('online_bidding' in (s.get('modules') or []) for s in (payload or {}).get('stages', []))


def migrate_legacy(database, settings, stage_definitions):
    ensure_schema(database)
    _lock(database)
    if _sql(database, 'SELECT 1 FROM procurement_catalog_state WHERE id=1').first():
        return load_catalog(database)
    minimums = settings.get('supplier_minimums', LEGACY_MINIMUMS)
    if not isinstance(minimums, dict) or set(minimums) != set(LEGACY_MINIMUMS):
        raise CatalogError('INVALID_LEGACY_SETTINGS', '原供应商数量配置不完整，原配置已保留，请先修复')
    for value in minimums.values():
        normalize_quantity(dict(mode='fixed', minimum=value))
    try:
        legacy_flows = templates.normalize_stage_templates(settings.get('stage_templates'), templates.PROCUREMENT_METHODS, stage_definitions,
            stage_order=settings.get('stage_order'), strict=True, migrate_legacy_auto_completion=settings.get('stage_auto_completion_policy_version') != 1)
    except ValueError as error:
        raise CatalogError('INVALID_LEGACY_SETTINGS', str(error)) from error
    common = templates.default_stage_templates(['common'], stage_definitions, settings.get('stage_order'))['common']
    if not common:
        raise CatalogError('INVALID_LEGACY_SETTINGS', '通用阶段定义为空，无法初始化目录')
    _sql(database, 'INSERT INTO procurement_catalog_state VALUES(1,1,:flow)', {'flow': _json(common)})
    by_name = {}
    project_rows = list(_sql(database, 'SELECT id,method FROM projects').mappings())
    names = list(templates.PROCUREMENT_METHODS)
    for p in project_rows:
        if p['method'] and p['method'] not in names:
            names.append(p['method'])
    for index, name in enumerate(names):
        row = dict(id=uuid.uuid4().hex, name=name, regime=None, notes='由旧版配置迁移，适用制度待确认', enabled=True, position=index, revision=1,
            builtin_kind=name if name in LEGACY_MINIMUMS else None, quantity_rule=dict(mode='fixed',minimum=minimums[name]) if name in minimums else dict(mode='unfixed',minimum=None),
            exceptions=[], template_mode='independent' if name in legacy_flows else 'common', stages=legacy_flows.get(name, []))
        _insert(database, row)
        defaults=settings.get('guarantee_default_rules',{}).get(name,[])
        if defaults:_sql(database,'INSERT INTO procurement_method_guarantee_defaults VALUES(:id,:rules)',dict(id=row['id'],rules=_json(defaults)))
        by_name[name] = row
    for project in project_rows:
        method = by_name.get(project['method'])
        if method:
            _sql(database, 'INSERT INTO project_procurement_snapshots(project_id,method_id,snapshot_json,workflow_revision) VALUES(:pid,:mid,:json,0)',
                 dict(pid=project['id'], mid=method['id'], json=_json(_snapshot(method))))
    if _sql(database, "SELECT 1 FROM sqlite_master WHERE name='lot_procurement_controls'").first():
        for lot in _sql(database, 'SELECT lot_id,procurement_method FROM lot_procurement_controls WHERE procurement_method IS NOT NULL').mappings():
            method = by_name.get(lot['procurement_method'])
            if method:
                _sql(database, 'INSERT INTO lot_procurement_snapshots VALUES(:lid,:mid,:json)', dict(lid=lot['lot_id'],mid=method['id'],json=_json(_snapshot(method))))
    _audit(database, 'legacy_migration', 'catalog', dict(methods=len(names), projects=len(project_rows)), 'migration')
    return load_catalog(database)


def reference_method_key(project, database=None):
    if database is None:
        from flask import current_app, has_app_context
        database=current_app.extensions.get('procurement_catalog',{}).get('db') if has_app_context() else None
    if database is not None and ready(database):
        snapshot=project_snapshot(database,project.id)
        return snapshot.get('builtin_kind') if snapshot else None
    return getattr(project,'method',None) if getattr(project,'method',None) in LEGACY_MINIMUMS else None


def deadline_regime_for_management(regime):
    return {'government_procurement':'government_procurement','mandatory_construction_bidding':'bidding','enterprise':'enterprise','collective':'custom','other':'custom'}.get(regime,'')


def guarantee_defaults(database, method_id):
    row=_sql(database,'SELECT rules FROM procurement_method_guarantee_defaults WHERE method_id=:id',{'id':method_id}).first()
    return json.loads(row[0]) if row else []


def _validate_guarantee_anchors(rules, stages):
    keys={s['id'] for s in stages}
    if any(r.get('enabled') and (not r.get('start_stage_key') or r['start_stage_key'] not in keys or r.get('manual_start_at')) for r in rules):
        raise CatalogError('GUARANTEE_ANCHOR','保证金默认规则的起算阶段被引用，请先调整该规则',409)


def save_guarantee_defaults(database, method_id, rules, expected_revision, actor):
    _lock(database);method=get_method(database,method_id);_revision(method['revision'],expected_revision)
    if __package__:from . import tender_guarantee
    else:import tender_guarantee
    rows=tender_guarantee.validate({'records':[],'rules':rules,'confirmed':False},[],[])['rules']
    _validate_guarantee_anchors(rows,method_stages(database,method))
    _sql(database,'INSERT INTO procurement_method_guarantee_defaults VALUES(:id,:rules) ON CONFLICT(method_id) DO UPDATE SET rules=excluded.rules',dict(id=method_id,rules=_json(rows)))
    _sql(database,'UPDATE procurement_methods SET revision=revision+1,updated_at=:now WHERE id=:id',dict(id=method_id,now=_now()))
    _bump(database);_audit(database,'guarantee_defaults',method_id,rows,actor)
    return get_method(database,method_id)


def initialize_project_business_defaults(database,project,stages):
    """Seed optional defaults only for modules in this brand-new project snapshot."""
    checklist_keys={s['id'] for s in stages if 'checklist' in s['modules']}
    archive=any('archive' in s['modules'] for s in stages)
    initialize=getattr(project,'ensure_workflow_defaults',None)
    if callable(initialize) and (checklist_keys or archive):initialize();database.session.flush()
    tables={r[0] for r in _sql(database,"SELECT name FROM sqlite_master WHERE type='table' AND name IN ('stage_checklist_items','archive_catalog_items')")}
    if 'stage_checklist_items' in tables:
        rows=_sql(database,'SELECT id,stage_key FROM stage_checklist_items WHERE project_id=:pid',{'pid':project.id}).all()
        for identity,key in rows:
            if key not in checklist_keys:_sql(database,'DELETE FROM stage_checklist_items WHERE id=:id',{'id':identity})
        _sql(database,'UPDATE stage_checklist_items SET required=0 WHERE project_id=:pid',{'pid':project.id})
    if not archive and 'archive_catalog_items' in tables:_sql(database,'DELETE FROM archive_catalog_items WHERE project_id=:pid',{'pid':project.id})
    mapper=getattr(project,'__mapper__',None)
    relations=[name for name in ('stage_checklist_items','archive_catalog_items') if mapper is not None and name in mapper.relationships]
    if relations:database.session.expire(project,relations)
