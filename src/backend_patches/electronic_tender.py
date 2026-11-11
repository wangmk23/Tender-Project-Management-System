"""electronic-tender-v1: public-tender registration counts and opening quotes."""
from __future__ import annotations
import json
import re
from datetime import datetime, timezone, timedelta
from decimal import Decimal, InvalidOperation
from flask import request, session, jsonify, g
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
if __package__:
    from . import procurement_catalog as c, project_record_versions as versions
else:
    import procurement_catalog as c, project_record_versions as versions

LABEL='公开招标-电子标'
MINIMUM=3
CHINA=timezone(timedelta(hours=8))


def ensure_schema(db):
    c._sql(db, """CREATE TABLE IF NOT EXISTS electronic_tender_ledgers(
        project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL DEFAULT 0,counts_json TEXT NOT NULL DEFAULT '[]',
        quotes_json TEXT NOT NULL DEFAULT '{}',cutoff_snapshot TEXT,updated_at TEXT)""")


def enabled(db,pid):
    if not c._sql(db,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='project_procurement_snapshots'").first():return False
    return bool((c.project_snapshot(db,pid) or {}).get('electronic_tender'))


def initialize(db,project,method,value):
    if type(value) is not bool:raise c.CatalogError('INVALID_ELECTRONIC_MODE','电子标标志必须为布尔值')
    if not value:return
    if method.get('builtin_kind')!='公开招标' and method['name']!='公开招标':
        raise c.CatalogError('INVALID_ELECTRONIC_METHOD','电子标选项仅适用于公开招标')
    if not module_stages(db,project.id,'registration') or not module_stages(db,project.id,'bid_opening'):
        raise c.CatalogError('ELECTRONIC_FLOW_REQUIRED','请先在公开招标流程中配置报名截止和开标模块')
    snap=c.project_snapshot(db,project.id);snap.pop('workflow_revision',None);snap['electronic_tender']=True
    c._sql(db,'UPDATE project_procurement_snapshots SET snapshot_json=:j WHERE project_id=:p',dict(j=c._json(snap),p=project.id))
    ensure_schema(db)
    c._sql(db,"""INSERT INTO electronic_tender_ledgers(project_id) VALUES(:p)
        ON CONFLICT(project_id) DO NOTHING""",dict(p=project.id))


def change_mode(db,project,value,actor):
    """Explicit information-page correction; retain all existing business rows."""
    if type(value) is not bool:raise c.CatalogError('INVALID_ELECTRONIC_MODE','电子标标志必须为布尔值')
    snapshot=c.project_snapshot(db,project.id)
    before=bool((snapshot or {}).get('electronic_tender'))
    if value:
        if not snapshot:raise c.CatalogError('ELECTRONIC_METHOD_REQUIRED','请先明确选择公开招标采购方式',409)
        initialize(db,project,c.get_method(db,snapshot['method_id']),True)
    elif before:
        snapshot.pop('workflow_revision',None);snapshot.pop('electronic_tender',None)
        c._sql(db,'UPDATE project_procurement_snapshots SET snapshot_json=:j WHERE project_id=:p',dict(j=c._json(snapshot),p=project.id))
    if before!=value:c._audit(db,'electronic_tender_mode_change',project.id,dict(before=before,after=value,existing_records_preserved=True),actor)


def stage_rows(db,pid):
    return [dict(r) for r in c._sql(db,'SELECT * FROM stages WHERE project_id=:p ORDER BY id',dict(p=pid)).mappings() if not r.get('template_removed')]


def module_stages(db,pid,module):
    if __package__:from . import stage_templates
    else:import stage_templates
    return [r for r in stage_rows(db,pid) if module in (json.loads(r['modules_json']) if r.get('modules_json') else stage_templates.legacy_modules_for_stage(r['stage_key']))]


def cutoff(db,pid):
    rows=module_stages(db,pid,'registration')
    stage=rows[0] if rows else None
    raw=next((stage.get(k) for k in ('planned_datetime','planned_at','planned_date') if stage.get(k)),None) if stage else None
    if not raw:return stage,None
    try:
        value=str(raw)
        if len(value)==10:value+='T23:59:59.999999'
        parsed=datetime.fromisoformat(value.replace('Z','+00:00'))
        return stage,parsed if parsed.tzinfo else parsed.replace(tzinfo=CHINA)
    except (TypeError,ValueError):return stage,None


def ledger(db,pid):
    row=c._sql(db,'SELECT * FROM electronic_tender_ledgers WHERE project_id=:p',dict(p=pid)).mappings().first()
    return dict(row) if row else dict(revision=0,counts_json='[]',quotes_json='{}',cutoff_snapshot=None)


def observation(db,project,lot_id=None):
    row=ledger(db,project.id);stage,deadline=cutoff(db,project.id)
    valid=bool(deadline and datetime.now(timezone.utc)>=deadline and row['cutoff_snapshot']==deadline.isoformat())
    count=next((x['count'] for x in json.loads(row['counts_json']) if x['lot_id']==lot_id),None)
    return dict(count=count if valid else None,confirmed=valid and count is not None,minimum=MINIMUM,
                cutoff=deadline.isoformat() if deadline else None,stage_key=stage['stage_key'] if stage else None)


def state(db,project):
    active=enabled(db,project.id);row=ledger(db,project.id) if active else dict(revision=0,counts_json='[]',quotes_json='{}',cutoff_snapshot=None)
    stage,deadline=cutoff(db,project.id);now=datetime.now(timezone.utc)
    counts=json.loads(row['counts_json']);obs=observation(db,project) if active else dict(confirmed=False)
    scope_ids=[getattr(l,'id') for l in getattr(project,'lots',[]) or []] or [None]
    confirmed=bool(active and all(observation(db,project,lid)['confirmed'] for lid in scope_ids))
    return dict(enabled=active,revision=row['revision'],counts=counts,quotes=json.loads(row['quotes_json']),minimum=MINIMUM,
                registration_stage_key=stage['stage_key'] if stage else None,cutoff=deadline.isoformat() if deadline else None,
                after_cutoff=bool(deadline and now>=deadline),registration_confirmed=confirmed,
                closed_lot_ids=sorted(closed_lot_ids(db,project.id)),
                record_version=versions.snapshots(db,[project.id]).get(project.id,{}).get('project'))


def verify_write(db,project,payload):
    c._lock(db);db.session.refresh(project)
    if not enabled(db,project.id):raise c.CatalogError('NOT_ELECTRONIC_TENDER','当前项目未选择公开招标-电子标',409)
    if project.is_terminated:raise c.CatalogError('PROJECT_CLOSED','项目已关闭，原电子标记录保留',409)
    row=ledger(db,project.id)
    if type(payload.get('revision')) is not int or row['revision']!=payload['revision']:
        raise c.CatalogError('ELECTRONIC_VERSION_CONFLICT','电子标资料已变化，请重新读取；草稿可保留核对',409)
    token=versions.snapshots(db,[project.id])[project.id]['project']
    if payload.get('record_version')!=token:raise c.CatalogError('RECORD_VERSION_CONFLICT','项目或阶段已变化，请重新读取后核对',409)
    return row


def save_counts(db,project,payload,actor):
    row=verify_write(db,project,payload);stage,deadline=cutoff(db,project.id)
    if not deadline:raise c.CatalogError('REGISTRATION_CUTOFF_REQUIRED','请先设置报名截止时间',409)
    now=datetime.now(timezone.utc)
    if now<deadline:raise c.CatalogError('REGISTRATION_NOT_CLOSED','报名尚未截止，截止后再登记报名家数',409)
    values=payload.get('counts')
    if not isinstance(values,list) or not values:raise ValueError('请登记报名家数')
    lots=list(getattr(project,'lots',[]) or []);by_id={l.id:l for l in lots};scope_ids=set(by_id) if lots else {None}
    counts=[];seen=set()
    for item in values:
        if not isinstance(item,dict):raise ValueError('报名家数格式不正确')
        lid=item.get('lot_id');count=item.get('count')
        if lid is not None and (type(lid) is not int or lid<=0):raise ValueError('采购包标识不正确')
        if lid not in scope_ids or lid in seen:raise ValueError('采购包不属于本项目或重复登记')
        if type(count) is not int or not 0<=count<=100000:raise ValueError('报名家数须为非负整数，未知不能填写0代替')
        seen.add(lid);counts.append(dict(lot_id=lid,count=count))
    if seen!=scope_ids:raise ValueError('请登记各采购包报名家数')
    shortages=[x for x in counts if x['count']<MINIMUM]
    if shortages and payload.get('confirm_shortage') is not True:
        raise c.CatalogError('ELECTRONIC_SHORTAGE_CONFIRMATION_REQUIRED','报名不足3家，确认登记后将标记流标',409,shortages=shortages)
    was_terminated=bool(project.is_terminated)
    for item in shortages:
        reason=f"报名截止后确认报名{item['count']}家，不满3家，流标"
        if lots:
            if __package__:from . import lot_supplier_risk
            else:import lot_supplier_risk
            lot_supplier_risk.manual_liubiao(db,project,by_id[item['lot_id']],item['count'],reason,actor)
        else:
            project.is_terminated=True;project.terminated_type='liubiao';project.terminated_reason=reason
    if not project.is_terminated and not stage.get('completed'):
        pending=[item.title for item in getattr(project,'stage_checklist_items',[]) if item.stage_key==stage['stage_key'] and item.required and not item.completed]
        if pending:raise c.CatalogError('REQUIRED_CHECKLIST_PENDING','请先完成本阶段必检项：'+'、'.join(pending),409,pending_checklist=pending)
    c.record_project_end(db,project,was_terminated)
    c._sql(db,'UPDATE electronic_tender_ledgers SET counts_json=:j,cutoff_snapshot=:c,revision=revision+1,updated_at=:t WHERE project_id=:p',dict(j=c._json(counts),c=deadline.isoformat(),t=now.isoformat(),p=project.id))
    # Record the actual cutoff review using the existing stage, not a new flow.
    c._sql(db,"UPDATE stages SET completed=1,skipped=0,completed_date=COALESCE(completed_date,:d) WHERE id=:s",dict(d=now.astimezone(CHINA).date().isoformat(),s=stage['id']))
    if __package__:from . import stage_templates
    else:import stage_templates
    if not stage.get('completed'):
        stage_templates.persist_stage_completed_at(db.session,text,project.id,stage['stage_key'],now.astimezone(CHINA).replace(tzinfo=None))
    c._audit(db,'electronic_registration',project.id,dict(before=json.loads(row['counts_json']),after=counts,liubiao=shortages),actor)


def quote_amount(value):
    if value is None or value=='':return ''
    if isinstance(value,bool):raise ValueError('报价格式不正确')
    try:amount=Decimal(str(value))
    except (InvalidOperation,ValueError):raise ValueError('报价格式不正确')
    if not amount.is_finite() or amount<0 or amount>Decimal('999999999999.99') or amount.as_tuple().exponent < -2:raise ValueError('报价须为非负金额，最多两位小数')
    return format(amount,'.2f')


def save_quotes(db,project,payload,actor):
    row=verify_write(db,project,payload)
    observations=[observation(db,project,getattr(l,'id',None)) for l in (list(getattr(project,'lots',[]) or []) or [None])]
    if not all(x['confirmed'] for x in observations):raise c.CatalogError('ELECTRONIC_REGISTRATION_PENDING','请先在报名截止后登记报名家数',409)
    regs={r.id:r for r in project.registrations};quotes=json.loads(row['quotes_json']);seen=set();items=payload.get('quotes')
    if not isinstance(items,list):raise ValueError('报价格式不正确')
    for item in items:
        if not isinstance(item,dict):raise ValueError('报价格式不正确')
        rid=item.get('registration_id')
        if type(rid) is not int or rid not in regs or rid in seen:raise ValueError('供应商不属于本项目或重复登记')
        require_open_scope(db,project,getattr(regs[rid],'lot_id',None))
        seen.add(rid);quotes[str(rid)]=quote_amount(item.get('amount'))
    c._sql(db,'UPDATE electronic_tender_ledgers SET quotes_json=:q,revision=revision+1,updated_at=:t WHERE project_id=:p',dict(q=c._json(quotes),t=datetime.now(timezone.utc).isoformat(),p=project.id))
    c._audit(db,'electronic_opening_quotes',project.id,dict(before=json.loads(row['quotes_json']),after=quotes),actor)




def require_open_scope(db,project,lid):
    lots=list(getattr(project,'lots',[]) or [])
    if lots and lid not in {l.id for l in lots}:raise ValueError('请选择本项目已达到3家报名的采购包')
    observed=observation(db,project,lid)
    if not observed['confirmed'] or observed['count']<MINIMUM:
        raise c.CatalogError('ELECTRONIC_REGISTRATION_PENDING','该项目或采购包尚未完成报名登记，或不足3家已流标',409)
    if lid is not None and c._sql(db,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='lot_procurement_controls'").first():
        row=c._sql(db,'SELECT status FROM lot_procurement_controls WHERE lot_id=:l',dict(l=lid)).first()
        if row and row[0]=='liubiao':raise c.CatalogError('LOT_CLOSED','该采购包已流标',409)

def closed_lot_ids(db,pid):
    if not c._sql(db,"SELECT 1 FROM sqlite_master WHERE type='table' AND name='lot_procurement_controls'").first():return set()
    return {r[0] for r in c._sql(db,"""SELECT l.id FROM project_lots l
        JOIN lot_procurement_controls s ON s.lot_id=l.id
        WHERE l.project_id=:p AND s.status='liubiao'""",dict(p=pid))}


def completion_problem(db,project,key):
    if not enabled(db,project.id):return None
    rows=module_stages(db,project.id,'registration');registration=key in [s['stage_key'] for s in rows]
    opening=key in [s['stage_key'] for s in module_stages(db,project.id,'bid_opening')]
    later=any(key in [s['stage_key'] for s in module_stages(db,project.id,m)] for m in ['evaluation','result_publication','bid_results'])
    if not (registration or opening or later):return None
    scopes=list(getattr(project,'lots',[]) or []) or [None]
    closed=closed_lot_ids(db,project.id)
    observations=[observation(db,project,getattr(l,'id',None)) for l in scopes if getattr(l,'id',None) not in closed]
    if not observations or not all(x['confirmed'] and x['count']>=MINIMUM for x in observations):
        return dict(code='ELECTRONIC_REGISTRATION_PENDING',error='请在报名截止后登记报名家数；不满3家须按流标处理')
    if opening:
        if __package__:from . import tender_guarantee
        else:import tender_guarantee
        _,data,_,_=tender_guarantee._load(db,project.id)
        active_ids={r.id for r in project.registrations if getattr(r,'lot_id',None) not in closed}
        submitted={r['registration_id'] for r in data.get('records',[]) if r.get('participation')=='submitted' and r['registration_id'] in active_ids}
        quotes=json.loads(ledger(db,project.id)['quotes_json'])
        if any(not quotes.get(str(rid)) for rid in submitted):
            return dict(code='ELECTRONIC_QUOTES_PENDING',error='请先登记已提交投标供应商的解密报价')
    return None

def register(app,db,models,authorize):
    if app.extensions.get('electronic_tender'):return
    with app.app_context():ensure_schema(db);db.session.commit()
    app.extensions['electronic_tender']=True
    @app.before_request
    def electronic_write_guard():
        if request.method not in ('POST','PUT','PATCH'):return None
        match=re.fullmatch(r'/api/projects/(\d+)/registrations(?:/\d+|/import)?',request.path)
        stage_match=re.fullmatch(r'/api/projects/(\d+)/stages/([^/]+)',request.path)
        if not match and not stage_match:return None
        pid=int((match or stage_match)[1])
        project=db.session.get(models['Project'],pid)
        if not project or not enabled(db,pid):return None
        _,denied=authorize(models,write=True,pid=pid)
        if denied:return denied
        try:
            c._lock(db)
            if match:
                g.electronic_tender_project=pid
                infos=[observation(db,project,getattr(l,'id',None)) for l in (list(getattr(project,'lots',[]) or []) or [None])]
                if not all(x['confirmed'] for x in infos) or project.is_terminated:
                    raise c.CatalogError('ELECTRONIC_REGISTRATION_PENDING','报名阶段不登记公司；截止后登记家数，再到开标登记解密名单',409)
                if not request.path.endswith('/import'):
                    body=request.get_json(silent=True)
                    if not isinstance(body,dict):raise ValueError('请求格式不正确')
                    rid=int(request.path.rsplit('/',1)[1]) if request.path.rsplit('/',1)[1].isdigit() else None
                    original=next((r for r in project.registrations if r.id==rid),None)
                    lid=body.get('lot_id',getattr(original,'lot_id',None))
                    if lid in (None,''):lid=None
                    elif type(lid) is int or isinstance(lid,str) and lid.isdigit():lid=int(lid)
                    else:raise ValueError('采购包标识不正确')
                    require_open_scope(db,project,lid)

            else:
                body=request.get_json(silent=True)
                if not isinstance(body,dict):raise ValueError('请求格式不正确')
                if body.get('completed') or body.get('skipped'):
                    problem=completion_problem(db,project,stage_match[2])
                    if problem:return jsonify(problem),409
        except (c.CatalogError,ValueError) as error:
            db.session.rollback();return jsonify(error=str(error),code=getattr(error,'code','INVALID_INPUT')),getattr(error,'status',400)
        return None
    def dispatch(pid,action=None):
        project,denied=authorize(models,write=request.method!='GET',pid=pid)
        if denied:return denied
        try:
            if request.method!='GET':
                if action not in ('registration','quotes'):return jsonify(error='操作不存在'),404
                payload=request.get_json(silent=True)
                if not isinstance(payload,dict):raise ValueError('请求格式不正确')
                (save_counts if action=='registration' else save_quotes)(db,project,payload,session['user_id'])
                db.session.commit();db.session.expire_all()
            return jsonify(state(db,project))
        except (c.CatalogError,ValueError,TypeError,SQLAlchemyError) as error:
            db.session.rollback()
            if isinstance(error,c.CatalogError):return jsonify(error=str(error),code=error.code,**error.details),error.status
            if isinstance(error,(ValueError,TypeError)):return jsonify(error=str(error)),400
            app.logger.warning('电子标登记失败: %s',type(error).__name__)
            return jsonify(error='电子标资料未保存，请重新读取后核对'),503
    app.add_url_rule('/api/projects/<int:pid>/electronic-tender','electronic_tender_state',dispatch,methods=['GET'])
    app.add_url_rule('/api/projects/<int:pid>/electronic-tender/<action>','electronic_tender_write',dispatch,methods=['PUT'])
