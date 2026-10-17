"""supplier-quantity-v1: phase-aware checks and auditable human decisions."""
from __future__ import annotations
import hashlib
import json
from datetime import datetime, timezone
from sqlalchemy import text

if __package__:
    from . import procurement_catalog as c, tender_guarantee as tender, stage_templates
else:
    import procurement_catalog as c, tender_guarantee as tender, stage_templates

PHASES = [('evaluation', 'valid'), ('result_publication', 'valid'), ('bid_results', 'valid'),
          ('online_bidding', 'submitted'), ('bid_opening', 'submitted'), ('registration', 'registered')]


def ensure_schema(db):
    c._sql(db, '''CREATE TABLE IF NOT EXISTS supplier_quantity_decisions (
        id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        lot_id INTEGER NOT NULL DEFAULT 0,stage_key TEXT NOT NULL,fingerprint TEXT NOT NULL,
        payload_json TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,
        UNIQUE(project_id,lot_id,stage_key,fingerprint))''')
    c._sql(db, '''CREATE TABLE IF NOT EXISTS procurement_quantity_overrides (
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,lot_id INTEGER NOT NULL DEFAULT 0,
        quantity_rule TEXT NOT NULL,reason TEXT NOT NULL,exception_id TEXT,revision INTEGER NOT NULL,
        PRIMARY KEY(project_id,lot_id))''')


def _table(db, name):
    return bool(c._sql(db, "SELECT 1 FROM sqlite_master WHERE type='table' AND name=:name", {'name': name}).first())


def quantity_rule_for_scope(database, project, lot=None):
    snapshot = c.project_snapshot(database, project.id)
    if not snapshot:
        return dict(mode='unfixed', minimum=None, rule_source='unconfigured', exceptions=[])
    lid = getattr(lot, 'id', None)
    if lid is not None:
        stored = c._sql(database, 'SELECT snapshot_json FROM lot_procurement_snapshots WHERE lot_id=:id', {'id': lid}).first()
        if stored:snapshot = json.loads(stored[0])
    result = {**snapshot['quantity_rule'], 'rule_source': 'project_snapshot', 'exceptions': snapshot.get('exceptions', []),
              'method_id': snapshot['method_id'], 'method_revision': snapshot['method_revision']}
    if lid is not None and _table(database, 'lot_procurement_controls'):
        row = c._sql(database, 'SELECT minimum_supplier_override,override_basis FROM lot_procurement_controls WHERE lot_id=:id', {'id': lid}).first()
        if row and row[0] is not None:
            if not str(row[1] or '').strip():raise c.CatalogError('INVALID_LOT_RULE', '采购包数量覆盖须填写说明')
            result.update(c.normalize_quantity(dict(mode='fixed', minimum=row[0])), rule_source='lot', reason=row[1])
    row = c._sql(database, 'SELECT quantity_rule,reason,exception_id,revision FROM procurement_quantity_overrides WHERE project_id=:p AND lot_id=:l', {'p': project.id, 'l': lid or 0}).first()
    if row:
        result.update(json.loads(row[0]), reason=row[1], exception_id=row[2], override_revision=row[3], rule_source='exception')
    return result


def _stage(db, project, key):
    rows = c._sql(db, 'SELECT stage_key,modules_json,template_removed FROM stages WHERE project_id=:id', {'id': project.id}).all()
    row = next((r for r in rows if r[0] == key and not r[2]), None)
    if row is None:raise c.CatalogError('STAGE_NOT_FOUND', '阶段不存在或已移除', 404)
    modules = json.loads(row[1]) if row[1] else stage_templates.legacy_modules_for_stage(key)
    return next((phase for module, phase in PHASES if module in modules), None)


def _hash(value):
    return hashlib.sha256(c._json(value).encode('utf-8')).hexdigest()


def evaluate_quantity(database, project, stage_key, lot_id=None):
    phase = _stage(database, project, stage_key)
    if phase is None:
        return dict(status='satisfied', applicable=False, phase=None, stage_key=stage_key, lot_id=lot_id)
    lots = list(getattr(project, 'lots', []) or [])
    lot = next((x for x in lots if x.id == lot_id), None) if lot_id is not None else None
    if lot_id is not None and lot is None:
        raise c.CatalogError('INVALID_LOT', '采购包不存在或不属于当前项目')
    rule = quantity_rule_for_scope(database, project, lot)
    regs = tender._registrations(project)
    scoped = [r for r in regs if r.get('lot_id') == lot_id]
    pending = bool(lots and any(r.get('lot_id') is None for r in regs))
    facts = dict(registrations=regs)
    actual = len(scoped)
    if phase != 'registered':
        _, data, roster, _ = tender._load(database, project.id)
        pending = pending or not data.get('confirmed') or roster != tender.roster_fingerprint(regs)
        records = {r['registration_id']: r for r in data.get('records', [])}
        selected = [records.get(r['id'], {}) for r in scoped]
        pending = pending or any(r.get('participation', 'pending') == 'pending' for r in selected)
        if phase == 'submitted':
            actual = sum(r.get('participation') == 'submitted' for r in selected)
        else:
            pending = pending or any(r.get('participation') == 'submitted' and r.get('validity', 'pending') == 'pending' for r in selected)
            actual = len(tender.eligible_ids(data, regs, lot_id, no_deposit=bool(getattr(project, 'no_deposit', False))))
        facts.update(confirmed=data.get('confirmed'), roster=roster, amounts=data.get('amounts', []), no_deposit=bool(getattr(project, 'no_deposit', False)),
            records=[{k:r.get(k) for k in ('registration_id','participation','validity','deposit_status','deposit_amount','bidder_identity_snapshot','lot_id_snapshot')} for r in selected])
    required = rule['minimum']
    fingerprint = _hash(dict(project_id=project.id, lot_id=lot_id, stage_key=stage_key, phase=phase, rule=rule, facts=facts))
    row = c._sql(database, 'SELECT payload_json,actor,created_at FROM supplier_quantity_decisions WHERE project_id=:p AND lot_id=:l AND stage_key=:s AND fingerprint=:f',
        dict(p=project.id, l=lot_id or 0, s=stage_key, f=fingerprint)).first()
    decision = ({**json.loads(row[0]), 'actor':row[1], 'created_at':row[2]} if row else None)
    missing = None if pending or required is None else max(0, required-actual)
    status = 'pending' if pending else 'unfixed' if required is None else 'satisfied' if not missing else 'confirmed' if decision else 'shortage'
    return dict(status=status, applicable=True, phase=phase, stage_key=stage_key, lot_id=lot_id,
        lot_name=getattr(lot, 'lot_name', None) or getattr(lot, 'lot_number', None) or '项目整体',
        actual_count=None if pending else actual, required_count=required, missing_count=missing, rule_source=rule['rule_source'],
        fingerprint=fingerprint, decision=decision, exceptions=rule['exceptions'], reason=rule.get('reason', ''))


def stage_quantities(database, project, stage_key):
    scopes = list(getattr(project, 'lots', []) or [])
    if scopes and _table(database, 'lot_procurement_controls'):
        closed = {r[0] for r in c._sql(database, "SELECT lot_id FROM lot_procurement_controls WHERE status='liubiao'")}
        scopes = [lot for lot in scopes if lot.id not in closed]
        if not scopes:return []
    return [evaluate_quantity(database, project, stage_key, getattr(lot, 'id', None)) for lot in (scopes or [None])]


def confirm_quantity(database, project, payload, actor):
    c._lock(database)
    key = payload.get('stage_key')
    lid = payload.get('lot_id')
    if lid is not None and (type(lid) is not int or lid <= 0):raise c.CatalogError('INVALID_LOT', '采购包标识不正确')
    if not isinstance(key, str):raise c.CatalogError('INVALID_STAGE', '请选择要处理的阶段')
    state = evaluate_quantity(database, project, key, lid)
    if not state.get('applicable'):
        raise c.CatalogError('NOT_APPLICABLE', '当前阶段没有供应商数量检查')
    if state['fingerprint'] != payload.get('fingerprint'):
        raise c.CatalogError('QUANTITY_CHANGED', '名单或数量规则已变化，请重新核对后确认', 409)
    if state['status'] == 'pending':
        raise c.CatalogError('ROSTER_PENDING', '请先核对实际参与、文件接收及有效投标名单', 409)
    reason = c._string(payload.get('reason'), '人工确认说明', 2000)
    exception_id = payload.get('exception_id')
    if exception_id:
        exception = next((x for x in state['exceptions'] if x['id'] == exception_id and x['enabled']), None)
        if not exception:raise c.CatalogError('INVALID_EXCEPTION', '例外情形不存在或未启用')
        c._sql(database, '''INSERT INTO procurement_quantity_overrides VALUES(:p,:l,:r,:reason,:ex,1)
            ON CONFLICT(project_id,lot_id) DO UPDATE SET quantity_rule=excluded.quantity_rule,reason=excluded.reason,
            exception_id=excluded.exception_id,revision=revision+1''',
            dict(p=project.id,l=lid or 0,r=c._json(exception['quantity_rule']),reason=reason,ex=exception_id))
        state = evaluate_quantity(database, project, key, lid)
    saved = dict(reason=reason, exception_id=exception_id, actual_count=state['actual_count'], required_count=state['required_count'], rule_source=state['rule_source'])
    c._sql(database, '''INSERT OR IGNORE INTO supplier_quantity_decisions(project_id,lot_id,stage_key,fingerprint,payload_json,actor,created_at)
        VALUES(:p,:l,:s,:f,:j,:a,:t)''', dict(p=project.id,l=lid or 0,s=key,f=state['fingerprint'],j=c._json(saved),a=str(actor),t=datetime.now(timezone.utc).isoformat(timespec='seconds')))
    return evaluate_quantity(database, project, key, lid)


def validate_stage_advance(database, project, stage_key, actor=None):
    problems = [x for x in stage_quantities(database, project, stage_key) if x['status'] in ('pending','shortage')]
    if not problems:return None
    return dict(code='SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED',
        error='供应商名单待核对或数量不足，请核对后人工确认继续办理', stage_key=stage_key, items=problems)
