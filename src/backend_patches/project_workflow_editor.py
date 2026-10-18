"""project-workflow-editor-v1: read-only impact preview and protected per-project edits."""
from __future__ import annotations
import hashlib
import json
from sqlalchemy import text
from flask import current_app, has_app_context

if __package__:
    from . import procurement_catalog as c, stage_templates as st
else:
    import procurement_catalog as c, stage_templates as st

TABLE_ROLES = {
    'stage_checklist_items': ('检查清单', None), 'attachments': ('阶段附件', None),
    'supplier_quantity_decisions': ('数量人工确认', None),
    'supplier_registrations': ('供应商报名', {'registration','bid_opening','evaluation'}),
    'bid_results': ('中标或成交结果', {'result_publication','bid_results','winning_notice'}),
    'project_lots': ('采购包资料', {'bid_results','result_publication'}),
    'announcement_clarifications': ('澄清答复', {'clarification'}),
    'complaints': ('质疑投诉', {'result_publication'}),
    'notice_deliveries': ('通知书领取', {'winning_notice'}),
    'archive_deliveries': ('归档资料', {'archive'}),
    'archive_catalog_items': ('归档清单', {'archive'}),
    'service_fee_invoices': ('服务费记录', {'service_fee'}),
    'online_bidding_projects': ('竞价台账', {'online_bidding'}),
}


def _capture(db, project):
    # One schema/count capture per preview, not one full project read per stage.
    rows = [dict(r) for r in c._sql(db, 'SELECT * FROM stages WHERE project_id=:id ORDER BY COALESCE(stage_position,id),id', {'id': project.id}).mappings()]
    legacy = current_app.extensions.get('procurement_catalog', {}).get('STAGES', []) if has_app_context() else []
    definitions = {r.get('key', r.get('id')):r for r in legacy}
    for row in rows:
        definition = definitions.get(row['stage_key'], {})
        row['_legacy_name'] = definition.get('name', row['stage_key'])
        row['_legacy_icon'] = definition.get('icon', '•')
    tables = {r[0] for r in c._sql(db, "SELECT name FROM sqlite_master WHERE type='table'")}
    counts = {}
    for table, (label, roles) in TABLE_ROLES.items():
        if table not in tables:continue
        cols = {r[1] for r in c._sql(db, f'PRAGMA table_info({table})')}
        if 'project_id' not in cols:continue
        group = 'stage_key' if 'stage_key' in cols else 'stage_id' if 'stage_id' in cols else None
        if group:
            values = dict(c._sql(db, f'SELECT {group},COUNT(*) FROM {table} WHERE project_id=:id GROUP BY {group}', {'id': project.id}).all())
        else:
            values = {None: c._sql(db, f'SELECT COUNT(*) FROM {table} WHERE project_id=:id', {'id': project.id}).scalar()}
        counts[table] = dict(label=label, roles=sorted(roles) if roles else None, group=group, values={str(k):v for k,v in values.items()})
    guarantee = []
    for table in ('tender_ledgers', 'tender_policies'):
        if table in tables:
            row = c._sql(db, f'SELECT payload FROM {table} WHERE project_id=:id', {'id': project.id}).first()
            if row:
                value = json.loads(row[0])
                guarantee.extend(value.get('rules', []) + value.get('default_rules', []))
    deadlines = []
    if 'business_deadline_items' in tables:
        deadlines = [json.loads(r[0]) for r in c._sql(db, 'SELECT payload FROM business_deadline_items WHERE project_id=:id ORDER BY id', {'id': project.id})]
    return dict(rows=rows, counts=counts, guarantee=guarantee, deadlines=deadlines,
                revision=(c.project_snapshot(db, project.id) or {}).get('workflow_revision', 0))


def _modules(row):
    modules=json.loads(row['modules_json']) if row.get('modules_json') else st.legacy_modules_for_stage(row['stage_key'])
    return [m for m in modules if m!=st.AUTO_COMPLETION_POLICY_MARKER]


def _dependencies(context, row):
    key = row['stage_key'];modules = set(_modules(row));result = []
    if row.get('completed') or row.get('skipped'):
        result.append(dict(kind='completed', label='已完成或已跳过的历史阶段'))
    for field in ('notes','responsible_person','opening_location','evaluation_location','publication_url','planned_at','planned_date','planned_time'):
        if row.get(field):result.append(dict(kind='stage_data', label='阶段已有资料或计划提醒', field=field))
    for table, item in context['counts'].items():
        if item['group']:
            match = str(key if item['group'] == 'stage_key' else row['id'])
            count = item['values'].get(match, 0)
            if table == 'attachments' and 'archive' in modules:
                count += item['values'].get('None', 0) + item['values'].get('', 0)
        else:
            count = item['values'].get('None', 0) if item['roles'] and modules.intersection(item['roles']) else 0
        if count:result.append(dict(kind=table, label=item['label'], count=count))
    for rule in context['guarantee']:
        if rule.get('enabled') and rule.get('start_stage_key') == key:
            result.append(dict(kind='guarantee', label='保证金规则起算阶段引用'))
    for item in context['deadlines']:
        if item.get('stage_key') == key or item.get('source', {}).get('stage_key') == key:
            result.append(dict(kind='deadline', label='业务期限或提醒引用'))
    return result


def stage_dependencies(database, project, stage_key):
    context = _capture(database, project)
    row = next((r for r in context['rows'] if r['stage_key'] == stage_key), None)
    if not row:raise c.CatalogError('STAGE_NOT_FOUND', '阶段不存在', 404)
    return _dependencies(context, row)


def _definition(row):
    return dict(id=row['stage_key'], name=row.get('stage_name') or row.get('_legacy_name', row['stage_key']), icon=row.get('stage_icon') or row.get('_legacy_icon', '•'), modules=_modules(row))


def _plan(database, project, proposed):
    stages = c.normalize_stages(proposed)
    context = _capture(database, project)
    existing = {r['stage_key']:r for r in context['rows'] if not r.get('template_removed')}
    retired = {r['stage_key'] for r in context['rows'] if r.get('template_removed')}
    desired = {r['id']:r for r in stages}
    blocked = [];added=[];updated=[];removed=[]
    for index, row in enumerate(stages):
        old = existing.get(row['id'])
        if not old:
            if row['id'] in retired:blocked.append(dict(stage_key=row['id'], reasons=[dict(label='该标识属于已移除的历史阶段，请为新增阶段使用新标识')]))
            else:added.append(row)
            continue
        definition = _definition(old)
        change = definition != row
        if change or old.get('stage_position') != index:
            updated.append(row)
        if change and (old.get('completed') or old.get('skipped')):
            blocked.append(dict(stage_key=row['id'], reasons=[dict(label='已完成阶段的名称、图标及业务模块保持原状')]))
        elif set(definition['modules']) - set(row['modules']):
            reasons = _dependencies(context, old)
            if reasons:blocked.append(dict(stage_key=row['id'], reasons=reasons))
    for key, old in existing.items():
        if key not in desired:
            removed.append(_definition(old))
            reasons = _dependencies(context, old)
            if reasons:blocked.append(dict(stage_key=key, reasons=reasons))
    fingerprint = hashlib.sha256(c._json(context).encode('utf-8')).hexdigest()
    return stages, dict(base_fingerprint=fingerprint, diff=dict(added=added,updated=updated,removed=removed), blocked=blocked)


def preview_project_flow(database, project, stages):
    return _plan(database, project, stages)[1]


def apply_project_flow(database, project, stages, base_fingerprint, actor):
    c._lock(database)
    rows, preview = _plan(database, project, stages)
    if preview['base_fingerprint'] != base_fingerprint:
        raise c.CatalogError('FLOW_CHANGED', '项目阶段或关联资料已变化，请重新预览后再保存', 409)
    if preview['blocked']:
        raise c.CatalogError('FLOW_DEPENDENCIES', '部分阶段已有完成记录、业务资料或规则依赖，无法直接调整', 409, blocked=preview['blocked'])
    current = {r[0]:bool(r[1] or r[2]) for r in c._sql(database, 'SELECT stage_key,completed,skipped FROM stages WHERE project_id=:id', {'id': project.id})}
    for index, row in enumerate(rows):
        values = dict(pid=project.id,key=row['id'],name=row['name'],icon=row['icon'],modules=c._json(st._stored_snapshot_modules(row['modules'])),position=index)
        if row['id'] in current:
            if not current[row['id']]:
                c._sql(database, 'UPDATE stages SET stage_name=:name,stage_icon=:icon,modules_json=:modules,template_removed=0,stage_position=:position WHERE project_id=:pid AND stage_key=:key', values)
            elif preview['diff']['added'] or preview['diff']['removed'] or any(r['id']==row['id'] for r in preview['diff']['updated']):
                c._sql(database, 'UPDATE stages SET stage_position=:position WHERE project_id=:pid AND stage_key=:key', values)
        else:
            c._sql(database, 'INSERT INTO stages(project_id,stage_key,stage_name,stage_icon,modules_json,template_removed,stage_position) VALUES(:pid,:key,:name,:icon,:modules,0,:position)', values)
    for row in preview['diff']['removed']:
        c._sql(database, 'UPDATE stages SET template_removed=1,stage_position=NULL WHERE project_id=:pid AND stage_key=:key', dict(pid=project.id,key=row['id']))
    c._sql(database, 'UPDATE project_procurement_snapshots SET workflow_revision=workflow_revision+1 WHERE project_id=:pid', {'pid': project.id})
    c._audit(database, 'project_flow_change', project.id, preview['diff'], actor)
    return preview
