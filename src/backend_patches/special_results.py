"""special-results-v1: versioned result lists and formal awards, per project/lot."""
from __future__ import annotations

import json
import re
import uuid
from decimal import Decimal, InvalidOperation

from flask import jsonify, request, session
from sqlalchemy.exc import SQLAlchemyError

if __package__:
    from . import electronic_tender, procurement_catalog as c, recycle_bin, tender_guarantee
else:
    import electronic_tender, procurement_catalog as c, recycle_bin, tender_guarantee

SCENARIOS = {
    'enterprise_multi': '企业采购·多家中标或入围', 'gov_goods_service': '同包定标与候选人',
    'framework_stage1': '框架协议第一阶段入围', 'framework_stage2': '框架协议第二阶段成交',
}
SCENARIO_MODES = dict(enterprise_multi='multi', gov_goods_service='pricing',
                      framework_stage1='framework', framework_stage2='calloff')
FORMAL = {'winner', 'shortlisted'}
ALL_ROLES = FORMAL | {'candidate', 'previous'}
MODES = {
    'multi': ALL_ROLES, 'shares': ALL_ROLES, 'limited': ALL_ROLES, 'change': ALL_ROLES,
    'framework': ALL_ROLES - {'winner'}, 'calloff': ALL_ROLES,
    'pricing': ALL_ROLES - {'shortlisted'}, 'candidates': ALL_ROLES - FORMAL,
    'no_award': ALL_ROLES - FORMAL,
}
PRICE_KINDS = {'total', 'unit', 'discount', 'rate', 'reduction', 'other'}


def ensure_schema(db):
    c._sql(db, """CREATE TABLE IF NOT EXISTS special_result_scopes(
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        lot_key INTEGER NOT NULL, revision INTEGER NOT NULL, scenario TEXT NOT NULL,
        payload TEXT NOT NULL, PRIMARY KEY(project_id,lot_key))""")
    c._sql(db, """CREATE TABLE IF NOT EXISTS special_result_entries(
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        lot_key INTEGER NOT NULL, registration_id INTEGER NOT NULL,
        UNIQUE(project_id,lot_key,registration_id))""")
    c._sql(db, """CREATE TABLE IF NOT EXISTS special_result_revisions(
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        lot_key INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL,
        actor TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(project_id,lot_key,revision))""")


def _text(value, label, limit=2000, required=False):
    if value is None:
        value = ''
    if not isinstance(value, str) or len(value) > limit or (required and not value.strip()):
        raise c.CatalogError('INVALID_TEXT', f'请核对{label}（最多{limit}字）')
    return value.strip()


def _decimal(value, label, places=6, limit=Decimal('9999999999999')):
    if value is None or value == '':
        return ''
    try:
        number = Decimal(str(value))
    except (ValueError, InvalidOperation):
        raise c.CatalogError('INVALID_NUMBER', f'{label}须为数字') from None
    if not number.is_finite() or number < 0 or number > limit or -number.as_tuple().exponent > places:
        raise c.CatalogError('INVALID_NUMBER', f'请核对{label}的数值和小数位数')
    return format(number.normalize(), 'f') if number else '0'


def _objects(value, label, maximum):
    if not isinstance(value, list) or len(value) > maximum or not all(isinstance(x, dict) for x in value):
        raise c.CatalogError('INVALID_LIST', f'请核对{label}，最多{maximum}项')
    return value


def _lot(project, raw):
    if raw in ('', None):
        return None
    if not re.fullmatch(r'[1-9][0-9]{0,17}', str(raw)):
        raise c.CatalogError('INVALID_LOT', '采购包编号无效')
    lid = int(raw)
    if lid not in {lot.id for lot in project.lots}:
        raise c.CatalogError('LOT_NOT_FOUND', '采购包不属于该项目', 404)
    return lid


def _registrations(project, lot_id):
    return {r.id: r for r in project.registrations if r.lot_id == lot_id}


def _params(pid, lot_id):
    return dict(p=pid, k=lot_id or 0)


def _read(db, project, lot_id, revision=None):
    params = _params(project.id, lot_id)
    if revision is None:
        raw = c._sql(db, 'SELECT payload FROM special_result_scopes WHERE project_id=:p AND lot_key=:k', params).scalar()
    else:
        raw = c._sql(db, """SELECT payload FROM special_result_revisions
            WHERE project_id=:p AND lot_key=:k AND revision=:r""", dict(params,r=revision)).scalar()
        if raw is None:
            raise c.CatalogError('REVISION_NOT_FOUND', '找不到此版本', 404)
    return json.loads(raw) if raw else dict(lot_id=lot_id, mode='pricing', revision=0, items=[], entries=[], notes='')


def saved_entry(db, models, project, lot_id, registration_id):
    if (lot_id is not None and not any(l.id == lot_id for l in project.lots)
            or registration_id not in _registrations(project, lot_id)
            or recycle_bin.is_deleted(db, 'project', project.id)):
        return None
    return next((e for e in _read(db, project, lot_id)['entries'] if e['registration_id'] == registration_id), None)


def _items(raw):
    items, ids = [], set()
    for item in _objects(raw, '货物服务清单', 500):
        identity = _text(item.get('id'), '清单编号', 100, True)
        if identity in ids:
            raise c.CatalogError('INVALID_ITEMS', '清单编号重复')
        ids.add(identity)
        kind = item.get('kind') or 'goods'
        if kind not in ('goods','service','works'):
            raise c.CatalogError('INVALID_ITEMS','清单类别无效')
        items.append(dict(id=identity, name=_text(item.get('name'), '品目名称', 200, True), kind=kind,
                          spec=_text(item.get('spec'),'规格'), unit=_text(item.get('unit'),'单位',80),
                          quantity=_decimal(item.get('quantity'),'数量')))
    return items, ids


def _prices(raw, ids):
    prices, seen = [], set()
    for row in _objects(raw, '报价', 2505):
        iid = _text(row.get('item_id'), '报价品目编号', 100)
        kind = _text(row.get('kind'), '报价类型', 40, True)
        if (iid and iid not in ids) or kind not in PRICE_KINDS:
            raise c.CatalogError('INVALID_PRICE','报价引用了未知标的或无效的计价方式')
        line_no = row.get('line_no', 1)
        if type(line_no) is not int or not 1 <= line_no <= 999999:
            raise c.CatalogError('INVALID_PRICE','报价明细行号须为 1 至 999999 的整数')
        key = (iid, kind, line_no if iid else 1)
        if key in seen:
            message = '同一标的和计价方式的明细行号重复' if iid else '同一供应商的整体报价每种计价方式只可登记一行'
            raise c.CatalogError('INVALID_PRICE', message)
        seen.add(key)
        value = row.get('value')
        if kind == 'other':
            value = _text(value,'其他计价',500)
        else:
            value = _decimal(value,'报价',places=2 if kind == 'total' and not iid else 6)
        prices.append(dict(item_id=iid,kind=kind,line_no=line_no,
                           detail_name=_text(row.get('detail_name'),'报价明细名称',200),
                           value=value,net=_decimal(row.get('net'),'不含税价格'),
                           tax=_decimal(row.get('tax'),'税率',limit=Decimal(100)),
                           basis=_text(row.get('basis'),'计价依据'),notes=_text(row.get('notes'),'报价备注')))
    return prices


def _prepare(raw, registrations):
    mode = _text(raw.get('mode'), '登记模式', 40, True)
    if mode not in MODES:
        raise c.CatalogError('INVALID_SCENARIO', '请选择有效的登记模式')
    notes = _text(raw.get('notes'),'登记说明',10000,required=mode in ('change','no_award'))
    items, ids = _items(raw.get('items',[]))
    entries, seen = [], set()
    for row in _objects(raw.get('entries',[]), '供应商', 200):
        rid = row.get('registration_id')
        if type(rid) is not int or rid not in registrations:
            raise c.CatalogError('REGISTRATION_NOT_FOUND','请选择本项目和本采购包内的报名供应商')
        if rid in seen:
            raise c.CatalogError('DUPLICATE_SUPPLIER','同一报名主体不能重复登记')
        seen.add(rid)
        role = _text(row.get('role'), '供应商角色', 40, True)
        if role not in MODES[mode]:
            raise c.CatalogError('INVALID_ROLE','所选登记模式与供应商结果类型不符')
        rank = row.get('rank')
        if rank not in ('', None) and not re.fullmatch(r'[1-9][0-9]{0,5}',str(rank)):
            raise c.CatalogError('INVALID_RANK','排序须为正整数')
        entries.append(dict(registration_id=rid, company_name=registrations[rid].company_name,
                            role=role, rank=int(rank) if rank not in ('',None) else None,
                            share=_decimal(row.get('share'),'份额',limit=Decimal(100)),
                            region=_text(row.get('region'),'区域',500), notes=_text(row.get('notes'),'结果备注'),
                            prices=_prices(row.get('prices',[]),ids),bid_result_id=None))
    if mode in ('pricing','calloff') and sum(e['role']=='winner' for e in entries)>1:
        raise c.CatalogError('SINGLE_WINNER','该模式同包最多一名正式中标或成交主体')
    if mode == 'shares' and sum(Decimal(e['share'] or '0') for e in entries if e['role'] in FORMAL)>100:
        raise c.CatalogError('INVALID_SHARE','同包正式结果的份额合计不能超过100%')
    return dict(mode=mode,items=items,entries=entries,notes=notes)

def _rules(db, project, lot_id, data, old, raw):
    params = _params(project.id, lot_id)
    snapshot = c.project_snapshot(db, project.id) or {}
    scoped = c._sql(db,'SELECT snapshot_json FROM lot_procurement_snapshots WHERE lot_id=:k',params).scalar()
    method = json.loads(scoped) if scoped else snapshot
    stage_online = c._sql(db,"""SELECT 1 FROM stages WHERE project_id=:p
        AND modules_json LIKE '%"online_bidding"%' AND COALESCE(template_removed,0)=0 LIMIT 1""",params).first()
    if stage_online or any('网上竞价' in str(m.get('builtin_kind') or m.get('name_snapshot') or '')
                           for m in (snapshot,method)) or getattr(project,'method','') == '网上竞价':
        raise c.CatalogError('ONLINE_CONFIRMATION_REQUIRED','请通过网上竞价的平台核对登记成交结果',409)
    mode = data['mode']
    if lot_id in electronic_tender.closed_lot_ids(db,project.id) and mode != 'no_award':
        raise c.CatalogError('LOT_CLOSED','该采购包已流标，仅可记录无成交结果',409)
    if electronic_tender.enabled(db,project.id) and mode != 'no_award':
        electronic_tender.require_open_scope(db,project,lot_id)
    formal = [e for e in data['entries'] if e['role'] in FORMAL]
    if method.get('regime') == 'government_procurement':
        framework = '框架' in str(method.get('name_snapshot') or '')
        if (mode in ('framework','calloff') and not framework
                or not framework and (len(formal)>1 or any(e['role']=='shortlisted' for e in formal))):
            raise c.CatalogError('SINGLE_WINNER','普通政府采购同包只能登记一家正式成交主体，入围须对应框架协议采购')
    if mode == 'calloff':
        stage1 = c._sql(db,"""SELECT payload FROM special_result_revisions WHERE project_id=:p
            AND lot_key=:k AND json_extract(payload,'$.mode')='framework' ORDER BY revision DESC LIMIT 1""",params).scalar()
        if stage1:
            allowed = {e['registration_id'] for e in json.loads(stage1)['entries'] if e['role']=='shortlisted'}
            if any(e['registration_id'] not in allowed for e in formal):
                raise c.CatalogError('NOT_SHORTLISTED','第二阶段只能从第一阶段已入围的供应商中选定')
    if data['entries'] and tender_guarantee.policy_for(db,project)['strict_results']:
        payload = tender_guarantee.get_payload(db, project, include_mail=False)
        allowed = tender_guarantee.eligible_ids(payload['data'], tender_guarantee._registrations(project), lot_id,
                                               no_deposit=bool(getattr(project,'no_deposit',False)))
        if any(e['role'] != 'previous' and e['registration_id'] not in allowed for e in data['entries']):
            raise c.CatalogError('INELIGIBLE','请先在开标或评审中确认该采购包的有效投标供应商')
    if raw.get('scenario'):
        legacy_ids = {e.get('registration_id') for e in raw.get('entries', []) if 'price_lines' not in e}
        for entry in old['entries']:
            prices = entry['prices']
            price_groups = {(p['item_id'], p['kind']) for p in prices}
            if entry['registration_id'] in legacy_ids and (len(price_groups) != len(prices) or any(p.get('detail_name') for p in prices)):
                raise c.CatalogError('PRICE_LINES_REQUIRED','此供应商已有报价明细，请在特殊结果登记页面编辑',409)
    if raw.get('scenario') and raw.get('confirm_remove_items') is not True:
        priced = {p['item_id'] for e in old['entries'] for p in e['prices']}
        keep = {i['id'] for i in data['items']}
        removed = [i['name'] for i in old['items'] if i['id'] in priced - keep]
        if removed:
            raise c.CatalogError('CONFIRM_REMOVE_ITEMS','移除的清单项已有报价，请确认后再保存',409,items=removed)


def _materialize(db, models, project, lot_id, data, old):
    Result = models['BidResult']
    rows = {r.id:r for r in Result.query.filter_by(project_id=project.id,lot_id=lot_id)}
    prior = {e['registration_id']:e['bid_result_id'] for e in old['entries'] if e.get('bid_result_id')}
    if set(prior.values()) != rows.keys():
        raise c.CatalogError('ORDINARY_RESULTS_EXIST','此范围已有独立结果或结果已变化，请核对原记录',409)
    retained = set()
    for entry in data['entries']:
        if entry['role'] not in FORMAL:
            continue
        rid = entry['registration_id']
        row = rows.get(prior.get(rid))
        if row is None:
            row = Result(project_id=project.id,lot_id=lot_id)
            db.session.add(row)
        row.winning_supplier = entry['company_name']
        row.notes = entry['notes']
        row.is_shortlisted = entry['role']=='shortlisted'
        scope_prices = {v['kind']:v['value'] for v in entry['prices'] if not v['item_id']}
        row.winning_amount = scope_prices.get('total') or None
        row.discount_rate = scope_prices.get('discount') or ''
        db.session.flush()
        entry['bid_result_id'] = row.id
        retained.add(row.id)
    for identity in rows.keys() - retained:
        db.session.delete(rows[identity])
    db.session.flush()


def _save(db,models,project,lot_id,raw):
    c._lock(db)
    db.session.refresh(project)
    if recycle_bin.is_deleted(db,'project',project.id):
        raise c.CatalogError('PROJECT_NOT_FOUND','项目不存在',404)
    if getattr(project,'is_terminated',False):
        raise c.CatalogError('PROJECT_CLOSED','项目已关闭',409)
    _lot(project,lot_id)
    if project.lots and lot_id is None:
        raise c.CatalogError('LOT_REQUIRED','请选择本项目的采购包')
    old = _read(db,project,lot_id)
    if type(raw.get('revision')) is not int or raw['revision'] != old['revision']:
        raise c.CatalogError('REVISION_CONFLICT','登记已更新，请刷新后再保存',409,current=old)
    data = _prepare(raw,_registrations(project,lot_id))
    _rules(db,project,lot_id,data,old,raw)
    _materialize(db,models,project,lot_id,data,old)
    params = _params(project.id,lot_id)
    # Keep historical supplier identities reserved even after they leave the current result.
    for entry in data['entries']:
        p = dict(params,r=entry['registration_id'])
        c._sql(db,"""INSERT OR IGNORE INTO special_result_entries(project_id,lot_key,registration_id)
            VALUES(:p,:k,:r)""",p)
        entry['id'] = c._sql(db,"""SELECT id FROM special_result_entries
            WHERE project_id=:p AND lot_key=:k AND registration_id=:r""",p).scalar()
    data.update(lot_id=lot_id,revision=old['revision']+1)
    params.update(rev=data['revision'], m=data['mode'], body=c._json(data), actor=str(session['user_id']), at=c._now())
    c._sql(db,"""INSERT INTO special_result_scopes(project_id,lot_key,revision,scenario,payload)
        VALUES(:p,:k,:rev,:m,:body) ON CONFLICT(project_id,lot_key) DO UPDATE SET
        revision=:rev,scenario=:m,payload=:body""",params)
    c._sql(db,"""INSERT INTO special_result_revisions(project_id,lot_key,revision,payload,actor,created_at)
        VALUES(:p,:k,:rev,:body,:actor,:at)""",params)
    c._audit(db,'special_result_save',project.id,dict(lot_id=lot_id,revision=data['revision'],mode=data['mode']),params['actor'])
    return data


def _from_scenario(raw):
    mode = SCENARIO_MODES.get(_text(raw.get('scenario'),'场景',60))
    if mode is None:
        raise c.CatalogError('INVALID_SCENARIO','请选择业务场景')
    items, refs = [], {}
    for row in _objects(raw.get('items',[]),'清单',500):
        ref = _text(row.get('id'),'品目编号',100)
        identity = 'i'+uuid.uuid4().hex[:12] if not ref or ref.startswith('new:') else ref
        if ref and ref in refs:
            raise c.CatalogError('INVALID_ITEMS','清单编号重复')
        refs[ref] = identity
        items.append(dict(row,id=identity,kind=row.get('category','goods')))
    entries = []
    for row in _objects(raw.get('entries',[]),'供应商',200):
        if 'price_lines' in row:
            lines = _objects(row['price_lines'], '报价', 2505)
            unpacked = []
            for line in lines:
                ref = _text(line.get('item_id'), '报价品目编号', 100)
                unpacked.append(dict(line, item_id=refs.get(ref,ref)))
            role = 'previous' if row.get('role')=='unsuccessful' else row.get('role')
            entries.append(dict(row,role=role,prices=unpacked,notes=row.get('note','')))
            continue
        prices = row.get('prices',{})
        if not isinstance(prices,dict):
            raise c.CatalogError('INVALID_PRICE','供应商价格格式不正确')
        unpacked = []
        for ref,p in prices.items():
            if not isinstance(p,dict):
                raise c.CatalogError('INVALID_PRICE','价格格式不正确')
            unpacked.append(dict(item_id=refs.get(ref,ref),kind='unit',value=_decimal(p.get('amount'),'报价',4),
                                 net=p.get('amount_ex_tax'),tax=p.get('tax_rate'),basis=p.get('billing'),notes=p.get('note')))
        role = 'previous' if row.get('role')=='unsuccessful' else row.get('role')
        entries.append(dict(row,role=role,prices=unpacked,notes=row.get('note','')))
    return dict(raw,mode=mode,items=items,entries=entries)


def _response(db,project,data,legacy):
    history = c._sql(db,"""SELECT revision,json_extract(payload,'$.mode') AS mode,actor,created_at FROM
        special_result_revisions WHERE project_id=:p AND lot_key=:k ORDER BY revision DESC""",
        _params(project.id,data['lot_id'])).mappings()
    result = dict(data,history=[dict(h) for h in history])
    if not legacy:
        return result
    result.update(enabled=bool(data['revision']),scenarios=SCENARIOS,scenario=next(
        (s for s,m in SCENARIO_MODES.items() if m==data['mode'] and data['revision']),None))
    result['items']=[dict(i,category=i['kind'],quantity=i['quantity'] or None) for i in data['items']]
    result['entries']=[dict(e,note=e['notes'],price_lines=e['prices'],prices={p['item_id']:dict(amount=p['value'] or None,
        amount_ex_tax=p['net'] or None,tax_rate=p['tax'] or None,billing=p['basis'],note=p['notes'])
        for p in reversed(e['prices']) if p['kind']=='unit'}) for e in data['entries']]
    names = [e['company_name'] for e in data['entries'] if e['role'] in FORMAL]
    result['summary']=dict(count=len(names),names=names)
    return result


def register(app, db, models, authorize):
    if app.extensions.get('special_results'):
        return
    with app.app_context():
        ensure_schema(db)
        db.session.commit()
    app.extensions['special_results'] = True

    @app.route('/api/projects/<int:pid>/special-results', methods=['GET','PUT'])
    def special_results(pid):
        write = request.method=='PUT'
        project, denied = authorize(models,pid=pid,write=write)
        if denied is not None:
            return denied
        try:
            if recycle_bin.is_deleted(db,'project',pid):
                raise c.CatalogError('PROJECT_NOT_FOUND','项目不存在',404)
            if write:
                raw=request.get_json(silent=True)
                if not isinstance(raw,dict):
                    raise c.CatalogError('INVALID_INPUT','请求须为登记对象')
                lid=_lot(project,request.args.get('lot_id',raw.get('lot_id')))
                if 'lot_id' in raw and _lot(project,raw['lot_id'])!=lid:
                    raise c.CatalogError('LOT_MISMATCH','请求中的采购包不一致')
                legacy='scenario' in raw and 'mode' not in raw
                data=_save(db,models,project,lid,_from_scenario(raw) if legacy else raw)
                result=_response(db,project,data,legacy)
                db.session.commit()
            else:
                lid=_lot(project,request.args.get('lot_id'))
                data=_read(db,project,lid,request.args.get('revision'))
                result=_response(db,project,data,request.args.get('format')=='scenario')
            return jsonify(result)
        except c.CatalogError as error:
            db.session.rollback()
            return jsonify(error=str(error),code=error.code,**error.details),error.status
        except SQLAlchemyError:
            db.session.rollback()
            app.logger.exception('特殊结果存取失败')
            return jsonify(error='登记暂时无法读写，请刷新后重试'),503

    @app.before_request
    def guard_ordinary_results():
        if request.method not in ('POST','PUT','DELETE') or not session.get('user_id'):
            return None
        match = re.fullmatch(r'/api/projects/(\d+)/bid-results(?:/(\d+))?/?',request.path)
        if not match:
            return None
        pid=int(match[1])
        c._lock(db)
        scoped = {r[0] for r in c._sql(db,'SELECT lot_key FROM special_result_scopes WHERE project_id=:p',dict(p=pid))}
        if not scoped:
            return None
        current_lot = None
        if match[2]:
            row = db.session.get(models['BidResult'],int(match[2]))
            if row is None or row.project_id!=pid:
                return None
            current_lot = row.lot_id
        raw = request.get_json(silent=True)
        requested = raw.get('lot_id',current_lot) if isinstance(raw,dict) else current_lot
        try:
            target = int(requested or 0)
        except (ValueError,TypeError):
            return None
        if target in scoped or match[2] and (current_lot or 0) in scoped:
            return jsonify(error='此范围的结果已通过特殊结果登记管理，请在该登记中修改'),409
        return None
