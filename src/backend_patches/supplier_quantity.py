"""supplier-quantity-v2: scoped, phase-aware and auditable human decisions."""
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


def _context(database, project, lot_id, phase, rule, scoped, data):
    """Only facts affecting this phase/scope belong in a reusable decision.

    The global roster remains an authoritative pending gate in the evaluator;
    its hash is deliberately absent here so rechecked changes in another lot
    do not invalidate an unchanged local confirmation.
    """
    registrations = []
    for reg in sorted(scoped, key=lambda r: r['id']):
        registrations.append({**reg, 'consortium_members': sorted(
            [{'company_name': member.get('company_name', '')}
             for member in reg.get('consortium_members', [])], key=c._json)})
    facts = dict(registrations=registrations)
    if phase != 'registered':
        records = {r['registration_id']: r for r in data.get('records', [])}
        fields = ('participation', 'validity') if phase == 'valid' else ('participation',)
        facts['records'] = [dict(registration_id=reg['id'],
            **{field: records.get(reg['id'], {}).get(field, 'pending') for field in fields})
            for reg in registrations]
        if phase == 'valid':
            # Eligibility includes payment sufficiency. Preserve the identities,
            # not only their count, without treating unchanged cash totals as a
            # new quantity fact (the cash ledger retains that separate audit).
            facts['eligible_ids'] = sorted(tender.eligible_ids(data, scoped, lot_id,
                no_deposit=bool(getattr(project, 'no_deposit', False))))
    explicit = lot_id is not None and bool(c._sql(database,
        'SELECT 1 FROM lot_procurement_snapshots WHERE lot_id=:l', {'l': lot_id}).first())
    return dict(version=2, project_id=project.id, lot_id=lot_id, phase=phase,
        binding='lot_snapshot' if explicit else 'project_snapshot', rule=rule, facts=facts)


def _legacy_fingerprint(project, lot_id, stage_key, phase, rule, regs, data, roster):
    """Reproduce v1 exactly, including its original ordering and broad scope.

    A v1 row has no stored semantic context: unchanged counts cannot establish
    which rule or identities were approved. Never normalize or relax this hash.
    """
    facts = dict(registrations=regs)
    if phase != 'registered':
        records = {r['registration_id']: r for r in data.get('records', [])}
        selected = [records.get(r['id'], {}) for r in regs if r.get('lot_id') == lot_id]
        facts.update(confirmed=data.get('confirmed'), roster=roster,
            amounts=data.get('amounts', []), no_deposit=bool(getattr(project, 'no_deposit', False)),
            records=[{k: r.get(k) for k in ('registration_id', 'participation', 'validity',
                'deposit_status', 'deposit_amount', 'bidder_identity_snapshot', 'lot_id_snapshot')}
                for r in selected])
    return _hash(dict(project_id=project.id, lot_id=lot_id, stage_key=stage_key,
        phase=phase, rule=rule, facts=facts))


def _decisions(database, project, stage_key, lot_id, phase, rule, regs, scoped, data, roster):
    rows = c._sql(database, '''SELECT stage_key,fingerprint,payload_json,actor,created_at
        FROM supplier_quantity_decisions WHERE project_id=:p AND lot_id=:l
        ORDER BY CASE WHEN stage_key=:s THEN 0 ELSE 1 END,created_at DESC,id DESC''',
        dict(p=project.id, l=lot_id or 0, s=stage_key)).all()
    phases = ('registered', 'submitted', 'valid')
    contexts = {}
    decision = suggestion = None
    for key, fingerprint, payload, actor, created_at in rows:
        try:
            source_phase = _stage(database, project, key)
        except c.CatalogError as error:
            if error.code == 'STAGE_NOT_FOUND':
                continue
            raise
        if source_phase is None or phases.index(source_phase) > phases.index(phase):
            continue
        saved = json.loads(payload)
        version = saved.get('version', 1)
        if version == 2:
            if source_phase not in contexts:
                contexts[source_phase] = _context(database, project, lot_id, source_phase, rule, scoped, data)
            context = contexts[source_phase]
            expected = _hash(context)
            matches = (saved.get('phase') == source_phase and saved.get('context') == context
                and saved.get('context_fingerprint') == expected and fingerprint == expected)
        elif version == 1:
            matches = fingerprint == _legacy_fingerprint(project, lot_id, key, source_phase, rule, regs, data, roster)
        else:
            matches = False
        if not matches:
            continue
        metadata = {k: v for k, v in saved.items() if k not in ('context', 'context_fingerprint')}
        metadata.update(source_stage_key=key, phase=source_phase, actor=actor, created_at=created_at)
        if source_phase == phase and decision is None:
            decision = metadata
        elif source_phase != phase and (suggestion is None or
                phases.index(source_phase) > phases.index(suggestion['phase'])):
            suggestion = metadata
    return decision, None if decision else suggestion


def _evaluate_quantity(database, project, stage_key, lot_id=None):
    phase = _stage(database, project, stage_key)
    if phase is None:
        return dict(status='satisfied', applicable=False, phase=None, stage_key=stage_key, lot_id=lot_id,
            decision=None, decision_reused=False, suggested_decision=None), None
    lots = list(getattr(project, 'lots', []) or [])
    lot = next((x for x in lots if x.id == lot_id), None) if lot_id is not None else None
    if lot_id is not None and lot is None:
        raise c.CatalogError('INVALID_LOT', '采购包不存在或不属于当前项目')
    rule = quantity_rule_for_scope(database, project, lot)
    regs = tender._registrations(project)
    scoped = [r for r in regs if r.get('lot_id') == lot_id]
    pending = bool(lots and any(r.get('lot_id') is None for r in regs))
    data, roster = {}, ''
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
    required = rule['minimum']
    context = _context(database, project, lot_id, phase, rule, scoped, data)
    fingerprint = _hash(context)
    # Pending facts always take precedence; inherited approvals cannot bypass
    # a changed global roster or an unresolved current-phase validity check.
    decision, suggestion = (None, None) if pending else _decisions(
        database, project, stage_key, lot_id, phase, rule, regs, scoped, data, roster)
    missing = None if pending or required is None else max(0, required-actual)
    status = 'pending' if pending else 'unfixed' if required is None else 'satisfied' if not missing else 'confirmed' if decision else 'shortage'
    return dict(status=status, applicable=True, phase=phase, stage_key=stage_key, lot_id=lot_id,
        lot_name=getattr(lot, 'lot_name', None) or getattr(lot, 'lot_number', None) or '项目整体',
        actual_count=None if pending else actual, required_count=required, missing_count=missing, rule_source=rule['rule_source'],
        fingerprint=fingerprint, decision=decision,
        decision_reused=bool(decision and decision['source_stage_key'] != stage_key),
        suggested_decision=suggestion, exceptions=rule['exceptions'], reason=rule.get('reason', '')), context


def evaluate_quantity(database, project, stage_key, lot_id=None):
    return _evaluate_quantity(database, project, stage_key, lot_id)[0]


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
    state, context = _evaluate_quantity(database, project, key, lid)
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
        state, context = _evaluate_quantity(database, project, key, lid)
    saved = dict(reason=reason, exception_id=exception_id, actual_count=state['actual_count'], required_count=state['required_count'], rule_source=state['rule_source'])
    saved.update(version=2, phase=state['phase'], context=context, context_fingerprint=state['fingerprint'])
    c._sql(database, '''INSERT OR IGNORE INTO supplier_quantity_decisions(project_id,lot_id,stage_key,fingerprint,payload_json,actor,created_at)
        VALUES(:p,:l,:s,:f,:j,:a,:t)''', dict(p=project.id,l=lid or 0,s=key,f=state['fingerprint'],j=c._json(saved),a=str(actor),t=datetime.now(timezone.utc).isoformat(timespec='seconds')))
    return evaluate_quantity(database, project, key, lid)


def validate_stage_advance(database, project, stage_key, actor=None):
    problems = [x for x in stage_quantities(database, project, stage_key) if x['status'] in ('pending','shortage')]
    if not problems:return None
    return dict(code='SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED',
        error='供应商名单待核对或数量不足，请核对后人工确认继续办理', stage_key=stage_key, items=problems)
