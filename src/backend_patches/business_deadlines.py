"""business-deadlines-v1: independent, audited deadlines in the existing database.

No historical backfill, background SMTP or guessed actual stage dates. Confirmed
values only change through an explicit review transaction.
"""
from __future__ import annotations
import copy
import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timedelta
from pathlib import Path

if __package__:
    from . import deadline_rules as rules
else:
    import deadline_rules as rules


def _execute(db,sql,args=None):
    from sqlalchemy import text
    return db.session.execute(text(sql),args or {})


def ensure_schema(db):
    for sql in (
        'CREATE TABLE IF NOT EXISTS business_deadline_settings(project_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL,payload TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS business_deadline_items(id TEXT PRIMARY KEY,project_id INTEGER NOT NULL,revision INTEGER NOT NULL,state TEXT NOT NULL,payload TEXT NOT NULL)',
        'CREATE INDEX IF NOT EXISTS business_deadline_project ON business_deadline_items(project_id,state)',
        'CREATE TABLE IF NOT EXISTS business_deadline_dependencies(item_id TEXT NOT NULL,year INTEGER NOT NULL,PRIMARY KEY(item_id,year))',
        'CREATE INDEX IF NOT EXISTS business_deadline_year ON business_deadline_dependencies(year,item_id)',
        'CREATE TABLE IF NOT EXISTS business_deadline_audit(id INTEGER PRIMARY KEY,project_id INTEGER NOT NULL,item_id TEXT NOT NULL,action TEXT NOT NULL,actor TEXT NOT NULL,recorded_at TEXT NOT NULL,reason TEXT NOT NULL,payload TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS business_deadline_previews(token TEXT PRIMARY KEY,owner TEXT NOT NULL,created_at TEXT NOT NULL,payload TEXT NOT NULL)'):
        _execute(db,sql)


def _json(value):return json.dumps(value,ensure_ascii=False,sort_keys=True,separators=(',',':'))
def _hash(value):return hashlib.sha256(_json(value).encode('utf-8')).hexdigest()
def _now():return datetime.now(rules.SHANGHAI).replace(tzinfo=None)


def settings_for(db,pid):
    row=_execute(db,'SELECT revision,payload FROM business_deadline_settings WHERE project_id=:pid',dict(pid=pid)).first()
    if not row:
        from flask import current_app,has_app_context
        suggested=''
        if has_app_context() and current_app.extensions.get('procurement_catalog'):
            if __package__:from . import procurement_catalog as catalog
            else:import procurement_catalog as catalog
            snapshot=catalog.project_snapshot(db,pid)
            if snapshot:suggested=catalog.deadline_regime_for_management(snapshot['regime'])
        return dict(revision=0,enabled=False,regime='',custom_rules=[],**({'suggested_regime':suggested} if suggested else {}))
    return dict(json.loads(row[1]),revision=row[0])


def _audit(db,pid,item_id,action,actor,reason,before,after):
    _execute(db,'INSERT INTO business_deadline_audit(project_id,item_id,action,actor,recorded_at,reason,payload) VALUES(:pid,:item,:action,:actor,:at,:reason,:payload)',
             dict(pid=pid,item=item_id or '',action=action,actor=str(actor),at=_now().isoformat(timespec='seconds'),reason=reason,payload=_json(dict(before=before,after=after))))


def _save(db,item,previous_revision=None):
    if previous_revision is None:
        item['revision']=1
        _execute(db,'INSERT INTO business_deadline_items VALUES(:id,:pid,:revision,:state,:payload)',dict(id=item['id'],pid=item['project_id'],revision=1,state=item['state'],payload=_json(item)))
    else:
        item['revision']=previous_revision+1
        changed=_execute(db,'UPDATE business_deadline_items SET revision=:new_revision,state=:state,payload=:payload WHERE id=:id AND project_id=:pid AND revision=:revision',dict(new_revision=item['revision'],state=item['state'],payload=_json(item),id=item['id'],pid=item['project_id'],revision=previous_revision))
        if changed.rowcount!=1:raise Conflict('事项已更新，请重新打开后操作')
    _execute(db,'DELETE FROM business_deadline_dependencies WHERE item_id=:id',dict(id=item['id']))
    years={d['year'] for d in item.get('calculation',{}).get('dependencies',[])}|{d['year'] for d in item.get('confirmed_calculation',{}).get('dependencies',[])}
    for year in years:_execute(db,'INSERT INTO business_deadline_dependencies VALUES(:id,:year)',dict(id=item['id'],year=year))


class Conflict(ValueError):pass


def _rows(db,pid=None,year=None):
    sql='SELECT i.payload FROM business_deadline_items i'
    args={};conditions=[]
    if year is not None:
        sql+=' JOIN business_deadline_dependencies d ON d.item_id=i.id'
        conditions+=['d.year=:year',"i.state NOT IN ('completed','cancelled')"];args['year']=year
    if pid is not None:conditions.append('i.project_id=:pid');args['pid']=pid
    if conditions:sql+=' WHERE '+' AND '.join(conditions)
    return [json.loads(r[0]) for r in _execute(db,sql,args).all()]


def _record(project,kind,identity):
    attrs={'complaint':('complaints',),'clarification':('announcement_clarifications','clarifications'),'clarification_notification':('announcement_clarifications','clarifications')}
    for attr in attrs.get(kind,()):
        for row in getattr(project,attr,[]) or []:
            if str(getattr(row,'id',''))==str(identity):return row
    return None


def _value(row,key):
    value=getattr(row,key,None)
    if value is None:return ''
    if isinstance(value,datetime):return rules.normalized_at(value)
    if hasattr(value,'isoformat'):return value.isoformat()
    return str(value)


def _source(project,item,*,strict=False):
    """Read the original actual fact; extension fields only fill genuinely absent facts."""
    kind=item.get('source_type','manual');identity=item.get('source_id','')
    if kind=='manual':
        return dict(type=kind,id=identity,exists=True,start_at=item.get('registered_start_at',item.get('start_at','')),end_at=item.get('registered_end_at',item.get('end_at','')),lot_id=item.get('lot_id'),stage_key=item.get('stage_key',''))
    if kind not in ('complaint','clarification','clarification_notification'):raise ValueError('请选择真实业务记录或明确登记实际发生时间；阶段计划不能作为实际事件')
    allowed=item.get('rule',{}).get('allowed_sources')
    if allowed and kind not in allowed:
        if strict:raise ValueError('当前规则需要'+item['rule'].get('actual_event','对应实际事件')+'；请选择匹配的业务记录或单独登记该实际事实')
        return dict(type=kind,id=identity,exists=False,start_at='',end_at='',lot_id=item.get('lot_id'))
    row=_record(project,kind,identity)
    if row is None:
        if strict:raise ValueError('关联业务记录不存在，请重新选择')
        return dict(type=kind,id=identity,exists=False,start_at='',end_at='',lot_id=item.get('lot_id'))
    lot=getattr(row,'lot_id',None)
    if strict and lot!=item.get('lot_id'):raise ValueError('业务记录与采购包不一致，请重新选择')
    if kind=='complaint':
        actual=_value(row,'submit_date')
        if strict and item.get('rule',{}).get('id')=='gov_question_reply' and getattr(row,'complaint_type','质疑')!='质疑':raise ValueError('收到投诉不等于收到质疑函，请选择质疑记录')
    elif kind=='clarification':actual=_value(row,'publish_date')
    else:actual='' # A publication date is not the written-notification timestamp.
    registered=item.get('registered_start_at','')
    if strict and actual and registered and rules.normalized_at(actual)!=rules.normalized_at(registered):raise Conflict('实际日期已在原业务记录中登记，请在原记录修正后重新预览')
    return dict(type=kind,id=identity,exists=True,start_at=actual or registered,end_at=item.get('registered_end_at',''),lot_id=lot,
                original_at=actual,publication_at=_value(row,'publish_date') if kind.startswith('clarification') else '',
                record_type=str(getattr(row,'complaint_type','')),stage_key=item.get('stage_key',''))


def sources_for(project):
    result=[]
    for kind,attrs,field in (('complaint',('complaints',),'submit_date'),('clarification',('announcement_clarifications','clarifications'),'publish_date')):
        seen=set()
        for attr in attrs:
            for row in getattr(project,attr,[]) or []:
                identity=getattr(row,'id',None)
                if identity in seen:continue
                seen.add(identity)
                label=(str(getattr(row,'complaint_type','质疑'))+' · '+str(getattr(row,'challenger','收到记录'))) if kind=='complaint' else str(getattr(row,'title','澄清公告'))
                result.append(dict(source_type=kind,source_id=identity,title=label,start_at=_value(row,field),end_at='',lot_id=getattr(row,'lot_id',None),stage_key=''))
                if kind=='clarification':result.append(dict(source_type='clarification_notification',source_id=identity,title=label+' · 实际通知',start_at='',end_at='',lot_id=getattr(row,'lot_id',None),stage_key=''))
    return result


def _fresh(db,project,item,cache_dir=None,*,overlay=None):
    source=_source(project,item)
    settings=settings_for(db,project.id)
    applicable=rules.catalog(settings['regime'],reference_method_key(project,db))+settings['custom_rules']
    effective=next((r for r in applicable if r['id']==item['rule']['id']),None)
    inline_custom=bool(item['rule'].get('custom') and not any(r['id']==item['rule']['id'] for r in settings['custom_rules']))
    if effective is None:effective=item['rule']
    else:
        effective=copy.deepcopy(effective)
        if item['rule'].get('cutoff'):effective.update(cutoff=item['rule']['cutoff'],precision='minute')
    at=source.get('start_at','')
    calc=rules.calculate(effective,at,end_at=source.get('end_at',''),cache_dir=overlay or cache_dir)
    calc['rule_snapshot']=copy.deepcopy(effective)
    if not settings['enabled'] or not inline_custom and not any(r['id']==item['rule']['id'] for r in applicable):
        calc.update(valid=False,requires_review=True,deadline='')
        calc['warnings'].append('原规则不再匹配当前已启用的适用制度和采购方式，请重新核对规则')
    if not source['exists']:
        calc.update(valid=False,requires_review=True,deadline='')
        calc['warnings'].append('原业务记录已删除或撤销，原确认期限保留，请核实')
    if source.get('lot_id')!=item.get('lot_id'):
        calc.update(valid=False,requires_review=True,deadline='')
        calc['warnings'].append('原业务记录的采购包已变化，请核对事项关联后重新预览')
    if item['rule']['id']=='gov_question_reply' and source['type']=='complaint' and source.get('record_type') not in ('','质疑'):
        calc.update(valid=False,requires_review=True,deadline='')
        calc['warnings'].append('原记录现为投诉，不能作为收到质疑函的事实继续计算质疑答复')
    signature=_hash(dict(source=source,rule=effective,dependencies=calc['dependencies'],settings=dict(regime=settings['regime'],enabled=settings['enabled'])))
    return source,calc,signature


def _time_status(item,now=None):
    now=now or _now()
    if now.tzinfo:now=now.astimezone(rules.SHANGHAI).replace(tzinfo=None)
    at=item.get('confirmed_deadline','')
    if not at:return 'unconfirmed'
    value,timed=rules.parse_at(at)
    when=value if timed else datetime.combine(value,datetime.max.time())
    if now>when:return 'overdue'
    if when.date()-timedelta(days=item.get('remind_days',1))<=now.date():return 'near'
    return 'upcoming'


def _public(item,now=None):
    result=copy.deepcopy(item)
    result['time_status']=_time_status(item,now)
    result['status']='review' if item.get('needs_review') else result['time_status']
    return result


def list_items(db,project,cache_dir=None,now=None):
    """Refresh fingerprints; active confirmed deadlines remain frozen for review."""
    items=_rows(db,project.id)
    calendar_memo={'_cache_dir':cache_dir}
    for item in items:
        if item['state'] in ('completed','cancelled'):continue
        source,calc,signature=_fresh(db,project,item,cache_dir,overlay=calendar_memo)
        if signature==item.get('seen_fingerprint'):continue
        previous=copy.deepcopy(item)
        item.update(source_snapshot=source,start_at=source.get('start_at',''),end_at=source.get('end_at',''),calculation=calc,
                    proposed_deadline=calc['deadline'],seen_fingerprint=signature,needs_review=True,
                    review_reason='起算事实、适用制度或依赖日历版本发生变化；请核实原确认期限')
        _save(db,item,previous['revision'])
        _audit(db,project.id,item['id'],'change_detected','system',item['review_reason'],previous,item)
    return [_public(i,now) for i in items]


def _sync_stage(db,project,item):
    """Only an explicit mapping changes a legacy plan, in this transaction."""
    if not item.get('sync_stage_plan') or not item.get('confirmed_deadline'):return
    if __package__:
        from . import stage_templates
    else:
        import stage_templates
    stage=next((s for s in getattr(project,'stages',[]) if getattr(s,'stage_key','')==item['stage_key']),None)
    if stage is None:raise Conflict('关联阶段已变化，请重新选择后预览')
    # Match api_update_stage's mapped model property, not the JSON planned_at alias.
    if not hasattr(type(stage),'planned_datetime'):raise ValueError('阶段计划存储不支持同步，事项尚未确认')
    stamp=stage_templates.parse_stage_datetime(item['confirmed_deadline'],'期限同步计划时间',allow_date=True)
    stage.planned_datetime=stamp
    if hasattr(type(stage),'planned_date'):stage.planned_date=stamp.date() if stamp else None
    db.session.flush()


def covered_stage_recipients(db,project,stage_key,planned_at,groups,now,cache_dir=None):
    """Dedup only explicit same-item mappings, same instant and actual subscribers."""
    if __package__:
        from .reminder_routing import route_reminder_event
    else:
        from reminder_routing import route_reminder_event
    try:normalized=rules.normalized_at(planned_at)
    except (ValueError,TypeError):return set()
    covered=set()
    for item in list_items(db,project,cache_dir,now):
        if not item.get('sync_stage_plan') or item['state']!='confirmed' or item['stage_key']!=stage_key:continue
        at=item.get('confirmed_deadline','')
        # A date-only legal end-of-day cannot equal an arbitrary stage time.
        if not at or rules.normalized_at(at)!=normalized:continue
        if at[:10]>(now.date()+timedelta(days=item.get('remind_days',1))).isoformat():continue
        for kind in ('business_deadline','deadline_review') if item['needs_review'] else ('business_deadline',):
            event=dict(event_type=kind,event_key=f"{kind}:{project.id}:{item['id']}:{now.date()}",project_id=project.id)
            for delivery in route_reminder_event(event,groups):
                if delivery.get('recipient'):covered.add(delivery['recipient'])
    return covered


def _project(Project,pid,db):
    return db.session.get(Project,pid)


def calendar_events(db,Project,year,month,cache_dir=None):
    events=[]
    pids={i['project_id'] for i in _rows(db) if i['state'] not in ('completed','cancelled')}
    for pid in pids:
        p=_project(Project,pid,db)
        if not p:continue
        for item in list_items(db,p,cache_dir):
            at=item.get('confirmed_deadline','')
            if item['state'] in ('completed','cancelled') or not at.startswith(f'{year}-{month:02d}-'):continue
            time=at[11:16] if 'T' in at else ''
            events.append(dict(kind='business_deadline',event_id='business_deadline:'+item['id'],deadline_item_id=item['id'],project_id=pid,
                               project_number=getattr(p,'number',''),project_name=getattr(p,'name',''),stage_key=item['stage_key'],stage_name=item['title'],
                               title=item['title'],date_str=at[:10],time=time,planned_time=time,planned_at=at,lot_id=item['lot_id'],
                               source_type=item['source_type'],source_id=item['source_id'],needs_review=item['needs_review'],completed=False,skipped=False))
    return events


def impact_items(db,Project,year,snapshot,cache_dir=None):
    """Read-only overlay: never store previews or alter original confirmed values."""
    items=_rows(db,year=year);projects={};result=[]
    overlay={year:snapshot,'_cache_dir':cache_dir}
    for item in items:
        pid=item['project_id']
        if pid not in projects:projects[pid]=_project(Project,pid,db)
        p=projects[pid]
        if not p:continue
        _,calc,_=_fresh(db,p,item,cache_dir,overlay=overlay)
        previous=item.get('confirmed_calculation') or item.get('calculation',{})
        old=next((d for d in previous.get('dependencies',[]) if d['year']==year),{})
        new=next((d for d in calc['dependencies'] if d['year']==year),{})
        if old.get('content_hash')==new.get('content_hash'):continue
        result.append(dict(kind='business_deadline',id=item['id'],deadline_item_id=item['id'],project_id=pid,project_number=getattr(p,'number',''),project_name=getattr(p,'name',''),
                           title=item['title'],stage_key=item['stage_key'],lot_id=item['lot_id'],confirmed_deadline=item.get('confirmed_deadline',''),
                           proposed_deadline=calc['deadline'],deadline_changed=item.get('confirmed_deadline','')!=calc['deadline'],calendar_changed=True,
                           needs_review=True,warnings=calc['warnings'],revision=item['revision'],
                           overdue=_time_status(dict(confirmed_deadline=calc['deadline']))=='overdue'))
    return result


def reminder_events(db,Project,now,cache_dir=None):
    if now.tzinfo:now=now.astimezone(rules.SHANGHAI).replace(tzinfo=None)
    result=[]
    pids={i['project_id'] for i in _rows(db) if i['state'] not in ('completed','cancelled')}
    for pid in pids:
        p=_project(Project,pid,db)
        if not p:continue
        for item in list_items(db,p,cache_dir,now):
            if item['state'] in ('completed','cancelled'):continue
            at=item.get('confirmed_deadline','');types=[]
            if at and at[:10]<= (now.date()+timedelta(days=item.get('remind_days',1))).isoformat():types.append('business_deadline')
            if item['needs_review']:types.append('deadline_review')
            lot=next((l for l in getattr(p,'lots',[]) if getattr(l,'id',None)==item['lot_id']),None)
            for kind in types:
                result.append(dict(event_type=kind,event_key=f"{kind}:{pid}:{item['id']}:{now.date().isoformat()}",project_id=pid,
                                   project_number=getattr(p,'number',''),project_name=getattr(p,'name',''),purchaser=getattr(p,'purchaser',''),
                                   method=getattr(p,'method',''),year=getattr(p,'year',''),lot_identity=(str(getattr(lot,'lot_number',''))+' '+str(getattr(lot,'lot_name',''))).strip() if lot else '项目整体',
                                   stage_key=item['stage_key'],stage_name=next((getattr(s,'name',item['stage_key']) for s in getattr(p,'stages',[]) if getattr(s,'stage_key','')==item['stage_key']),item['stage_key']),
                                   deadline_item_id=item['id'],deadline_title=item['title'],deadline_at=at,deadline_status=('需复核 · ' if item['needs_review'] else '')+{'overdue':'已逾期','near':'临近/今日到期','upcoming':'未到期','unconfirmed':'待确认'}.get(item['time_status'],item['time_status']),
                                   deadline_basis=item['rule'].get('basis',''),review_reason=item.get('review_reason','')))
    return result


def register(app,db,models):
    from flask import jsonify,request,session
    from sqlalchemy.exc import SQLAlchemyError
    if getattr(app,'_business_deadlines_registered',False):return
    Project=models['Project'];cache=Path(models.get('DATA_DIR','.'))/'holiday_calendar'
    with app.app_context():ensure_schema(db);db.session.commit()

    def auth(pid=None,write=False):
        if not session.get('user_id'):return None,(jsonify(error='请先登录'),401)
        User=models.get('User');user=db.session.get(User,session['user_id']) if User else None
        if User and (not user or not bool(getattr(user,'is_active',True))):return None,(jsonify(error='账号不可用，请重新登录'),401)
        if write:
            a=str(session.get('csrf_token') or '');b=str(request.headers.get('X-CSRFToken') or '')
            if not a or not hmac.compare_digest(a.encode(),b.encode()):return None,(jsonify(error='请求已过期，请刷新后重试'),403)
        if pid is None:return None,None
        p=_project(Project,pid,db)
        if not p:return None,(jsonify(error='项目不存在'),404)
        access=models.get('can_access_project') or app.extensions.get('deadline_project_access')
        if access and not access(user,p):return None,(jsonify(error='无权访问此项目'),403)
        return p,None

    def owner():
        if not session.get('_deadline_session'):session['_deadline_session']=secrets.token_urlsafe(24)
        return _hash([session.get('user_id'),session['_deadline_session'],session.get('csrf_token')])

    def body():
        value=request.get_json(silent=True)
        if not isinstance(value,dict):raise ValueError('请求数据格式错误')
        if len(_json(value))>32768:raise ValueError('请求内容过长')
        return value

    def fail(error):
        db.session.rollback()
        if isinstance(error,Conflict):return jsonify(error=str(error)),409
        if isinstance(error,ValueError):return jsonify(error=str(error)),400
        app.logger.warning('业务期限存储操作失败: %s',type(error).__name__)
        return jsonify(error='暂时无法保存或读取业务期限，原有记录已保留'),503

    def settings(pid):
        p,denied=auth(pid,request.method=='PUT')
        if denied:return denied
        try:
            current=settings_for(db,pid)
            if request.method=='GET':return jsonify(current)
            value=body()
            if type(value.get('save_as_default',False)) is not bool:raise ValueError('默认规则保存状态无效')
            if value.get('save_as_default'):
                User=models.get('User');user=db.session.get(User,session['user_id']) if User else None
                if not user or not bool(getattr(user,'is_admin',False)):return jsonify(error='仅管理员可保存新项目默认规则'),403
                if not models.get('save_app_settings'):raise ValueError('默认规则存储不可用')
            if type(value.get('revision')) is not int or value['revision']!=current['revision']:raise Conflict('适用规则已更新，请重新打开后编辑')
            if type(value.get('enabled')) is not bool:raise ValueError('启用状态无效')
            if not isinstance(value.get('regime',''),str):raise ValueError('适用制度无效')
            regime=rules.ALIASES.get(value.get('regime',''),value.get('regime',''))
            if regime not in ('',)+rules.REGIMES or value['enabled'] and not regime:raise ValueError('请明确选择适用制度，不能根据采购方式自动判断')
            custom=value.get('custom_rules',[])
            if not isinstance(custom,list) or len(custom)>30:raise ValueError('自定义规则最多30条')
            custom=[rules.validate_custom(r) for r in custom]
            # Stored snapshots include controlled metadata; normalize back to accepted parameters on next PUT.
            if len({r['id'] for r in custom})!=len(custom):raise ValueError('自定义规则标识重复')
            after=dict(enabled=value['enabled'],regime=regime,custom_rules=custom)
            if current['revision']:
                changed=_execute(db,'UPDATE business_deadline_settings SET revision=revision+1,payload=:payload WHERE project_id=:pid AND revision=:rev',dict(payload=_json(after),pid=pid,rev=current['revision']))
                if changed.rowcount!=1:raise Conflict('适用规则已更新，请重新打开')
            else:_execute(db,'INSERT INTO business_deadline_settings VALUES(:pid,1,:payload)',dict(pid=pid,payload=_json(after)))
            after['revision']=current['revision']+1
            _audit(db,pid,'','settings',session['user_id'],'明确保存项目期限适用规则',current,after)
            list_items(db,p,cache)
            if value.get('save_as_default'):models['save_app_settings']({'business_deadline_defaults':{k:copy.deepcopy(after[k]) for k in ('enabled','regime','custom_rules')}})
            db.session.commit();return jsonify(after)
        except (ValueError,SQLAlchemyError,OSError) as error:return fail(error)

    def rule_catalog():
        try:pid=int(request.args.get('project_id',''))
        except (ValueError,TypeError):return jsonify(error='请选择项目后查看适用规则'),400
        p,denied=auth(pid)
        if denied:return denied
        current=settings_for(db,pid)
        return jsonify(rules=rules.catalog(current['regime'],reference_method_key(p,db))+current['custom_rules'])

    def listing(pid):
        p,denied=auth(pid)
        if denied:return denied
        try:
            page=max(1,int(request.args.get('page',1)));items=list_items(db,p,cache)
            for field in ('stage_key','source_type','source_id','lot_id'):
                if request.args.get(field) is not None:items=[i for i in items if str(i.get(field,''))==request.args[field]]
            identity=request.args.get('item_id') or request.args.get('id')
            if identity:items=[i for i in items if i['id']==identity]
            total=len(items);items=items[(page-1)*50:page*50]
            db.session.commit()
            return jsonify(items=items,settings=settings_for(db,pid),sources=sources_for(p),
                           stages=[dict(key=getattr(s,'stage_key',''),name=getattr(s,'name','业务阶段')) for s in getattr(p,'stages',[])],
                           lots=[dict(id=l.id,lot_name=getattr(l,'lot_name','采购包')) for l in getattr(p,'lots',[])],revision=max((i['revision'] for i in items),default=0),page=page,page_size=50,total=total)
        except (ValueError,SQLAlchemyError,OSError) as error:return fail(error)

    def preview(pid):
        p,denied=auth(pid,True)
        if denied:return denied
        try:
            current=settings_for(db,pid)
            if not current['enabled'] or not current['regime']:raise ValueError('请先明确选择适用制度并启用期限助手')
            value=body();rid=value.get('rule_id','')
            selected=next((r for r in rules.catalog(current['regime'],reference_method_key(p,db))+current['custom_rules'] if r['id']==rid),None)
            if value.get('custom_rule'):
                selected=rules.validate_custom(value['custom_rule'])
            if not selected:raise ValueError('规则不适用于当前项目制度和采购方式，请重新选择')
            lot=value.get('lot_id') or None
            if lot is not None:
                try:lot=int(lot)
                except (ValueError,TypeError):raise ValueError('采购包无效')
                if lot not in {getattr(l,'id',None) for l in getattr(p,'lots',[])}:raise ValueError('采购包不存在')
            stage=str(value.get('stage_key',''))
            if stage and stage not in {str(getattr(s,'stage_key','')) for s in getattr(p,'stages',[])}:raise ValueError('关联阶段不存在')
            sync=value.get('sync_stage_plan',False)
            if type(sync) is not bool or sync and not stage:raise ValueError('同步阶段计划须明确选择对应阶段')
            remind=value.get('remind_days',1)
            if type(remind) is not int or not 0<=remind<=365:raise ValueError('提醒提前天数须为0至365')
            title=value.get('title') or selected['name']
            if not isinstance(title,str) or not 1<=len(title.strip())<=100:raise ValueError('事项名称须为1至100字')
            kind=str(value.get('source_type') or 'manual');sid=value.get('source_id')
            if not isinstance(sid,(str,int,type(None))) or isinstance(sid,bool) or len(str(sid or ''))>100:raise ValueError('业务记录标识无效')
            if selected['id']=='gov_clarification_notice' and kind not in ('manual','clarification_notification'):raise ValueError('请登记实际书面通知时间；澄清公告发布日期不能代替通知时间')
            cutoff=value.get('cutoff','')
            if not isinstance(cutoff,str):raise ValueError('截止时分无效')
            if cutoff:
                if not isinstance(cutoff,str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',cutoff):raise ValueError('截止时分无效')
                selected=copy.deepcopy(selected);selected.update(cutoff=cutoff,precision='minute')
            identity=value.get('id') or value.get('item_id')
            if identity is not None and (not isinstance(identity,str) or not 1<=len(identity)<=100):raise ValueError('事项标识无效')
            item=dict(id=identity or secrets.token_hex(16),project_id=pid,title=title.strip(),rule=selected,
                      stage_key=stage,lot_id=lot,source_type=kind,source_id=sid if sid is not None else secrets.token_hex(12),
                      registered_start_at=rules.normalized_at(value['start_at']) if value.get('start_at') else '',
                      registered_end_at=rules.normalized_at(value['end_at']) if value.get('end_at') else '',remind_days=remind,
                      sync_stage_plan=sync,state='pending',needs_review=False,confirmed_deadline='',confirmed_calculation={},revision=0)
            old=next((i for i in _rows(db,pid) if i['id']==item['id']),None)
            if identity and old is None:raise ValueError('原事项不存在，请重新打开后编辑')
            if old:
                if value.get('revision')!=old['revision']:raise Conflict('事项已更新，请重新打开后预览')
                if old['state'] in ('completed','cancelled'):raise ValueError('已办结或已取消事项不可覆盖，请新增事项')
            source=_source(p,item,strict=True)
            if not source['start_at']:raise ValueError('缺少实际发生日期，请补充原业务记录或明确登记实际日期')
            # A copy displayed in the form is not a separately registered fact.
            # If the original field is later cleared we must report that absence.
            if source.get('original_at'):item['registered_start_at']=''
            item.update(start_at=rules.normalized_at(source['start_at']),end_at=source['end_at'],source_snapshot=source)
            _,calc,signature=_fresh(db,p,item,cache)
            if not calc['valid']:raise ValueError('；'.join(calc['warnings']))
            item.update(calculation=calc,proposed_deadline=calc['deadline'],seen_fingerprint=signature)
            now=_now();who=owner()
            _execute(db,'DELETE FROM business_deadline_previews WHERE created_at<:at',dict(at=(now-timedelta(minutes=30)).isoformat()))
            if _execute(db,'SELECT count(*) FROM business_deadline_previews WHERE owner=:owner',dict(owner=who)).scalar()>=64:raise ValueError('预览过多，请稍后重试或确认已有预览')
            if _execute(db,'SELECT count(*) FROM business_deadline_previews').scalar()>=512:raise ValueError('当前预览较多，请稍后重试')
            token=secrets.token_urlsafe(32)
            payload=dict(item=item,old_revision=old['revision'] if old else 0,settings_revision=current['revision'],fingerprint=signature)
            _execute(db,'INSERT INTO business_deadline_previews VALUES(:token,:owner,:at,:payload)',dict(token=token,owner=who,at=now.isoformat(),payload=_json(payload)))
            db.session.commit();return jsonify(token=token,calculation=calc,item=_public(item))
        except (ValueError,SQLAlchemyError,OSError) as error:return fail(error)

    def confirm(pid):
        p,denied=auth(pid,True)
        if denied:return denied
        try:
            value=body();token=value.get('token','')
            if not isinstance(token,str) or len(token)>100:raise ValueError('预览凭据无效')
            row=_execute(db,'SELECT created_at,payload FROM business_deadline_previews WHERE token=:token AND owner=:owner',dict(token=token,owner=owner())).first()
            if not row:return jsonify(error='预览不存在或已使用，请重新计算'),404
            if _now()-datetime.fromisoformat(row[0])>timedelta(minutes=30):return jsonify(error='预览已过期，请重新计算'),410
            payload=json.loads(row[1]);item=payload['item']
            if item['project_id']!=pid:return jsonify(error='预览不属于当前项目'),404
            if settings_for(db,pid)['revision']!=payload['settings_revision']:raise Conflict('适用规则已变化，请重新预览')
            old=next((i for i in _rows(db,pid) if i['id']==item['id']),None)
            if (old['revision'] if old else 0)!=payload['old_revision']:raise Conflict('事项已变化，请重新预览')
            _,calc,signature=_fresh(db,p,item,cache)
            if signature!=payload['fingerprint']:raise Conflict('起算事实或年度安排已变化，请重新预览')
            item['calculation']=calc
            if old:
                item.update(confirmed_deadline=old['confirmed_deadline'],confirmed_calculation=old.get('confirmed_calculation',{}),state=old['state'],needs_review=True,review_reason='已重新计算，请明确复核后采用新建议')
            elif calc['requires_review']:
                item.update(state='pending',needs_review=True,review_reason='规则待核对；需明确复核适用事实和计算口径')
            else:
                item.update(state='confirmed',confirmed_deadline=calc['deadline'],confirmed_calculation=calc,needs_review=False,accepted_fingerprint=signature)
            item.update(actor=str(session['user_id']),updated_at=_now().isoformat(timespec='seconds'))
            _save(db,item,old['revision'] if old else None)
            if not old and item['state']=='confirmed':_sync_stage(db,p,item)
            _audit(db,pid,item['id'],'preview_confirmed',session['user_id'],'确认服务端期限预览',old,item)
            consumed=_execute(db,'DELETE FROM business_deadline_previews WHERE token=:token AND owner=:owner',dict(token=token,owner=owner()))
            if consumed.rowcount!=1:raise Conflict('预览已使用，请重新打开事项')
            db.session.commit();return jsonify(item=_public(item),message='事项已保存，原确认期限保留待复核' if item['needs_review'] else '期限已确认')
        except (ValueError,SQLAlchemyError,OSError) as error:return fail(error)

    def mutate(pid,item_id,mode):
        p,denied=auth(pid,True)
        if denied:return denied
        try:
            value=body();items=list_items(db,p,cache)
            item=next((i for i in items if i['id']==item_id),None)
            if not item:return jsonify(error='事项不存在'),404
            if type(value.get('revision')) is not int or value['revision']!=item['revision']:raise Conflict('事项已更新，请重新打开后操作')
            if item['state'] in ('completed','cancelled'):raise ValueError('事项已办结或取消，历史记录已保留')
            reason=value.get('reason','')
            if not isinstance(reason,str) or len(reason)>1000:raise ValueError('操作说明须在1000字以内')
            reason=reason.strip();before=copy.deepcopy(item)
            if mode=='status':
                state=value.get('status')
                if state not in ('completed','cancelled'):raise ValueError('仅支持明确办结或取消事项')
                if state=='cancelled' and not reason:raise ValueError('取消事项须填写原因')
                item.update(state=state,closed_at=_now().isoformat(timespec='seconds'))
                action=state;reason=reason or '明确登记事项已办理完毕'
            else:
                action=value.get('action');calc=item['calculation']
                if action not in ('accept','keep','pending'):raise ValueError('复核操作无效')
                if action in ('keep','pending') and not reason:raise ValueError('保留原期限或尚需核实须填写原因')
                if action=='accept':
                    if not calc['valid'] or not calc['deadline']:raise ValueError('当前缺少有效起算事实或日历安排，不能采用新建议')
                    if calc['requires_review'] and not reason:raise ValueError('计算口径尚待核对，请填写核对依据后明确采用')
                    if calc.get('interval_satisfied') is False:raise ValueError('实际通知与提交截止不满足最小间隔，请先修正业务事实')
                    item.update(confirmed_deadline=calc['deadline'],confirmed_calculation=calc,rule=copy.deepcopy(calc.get('rule_snapshot',item['rule'])),state='confirmed',needs_review=False,accepted_fingerprint=item['seen_fingerprint'])
                elif action=='keep':
                    if not item.get('confirmed_deadline'):raise ValueError('尚无原确认期限可保留')
                    item.update(needs_review=False,accepted_fingerprint=item['seen_fingerprint'])
                else:item['needs_review']=True
                item['review_reason']=reason if action=='pending' else ''
                item['review_note']=reason
                reason=reason or '经核对采用当前建议期限'
            item.update(actor=str(session['user_id']),updated_at=_now().isoformat(timespec='seconds'))
            _save(db,item,before['revision']);_audit(db,pid,item_id,action,session['user_id'],reason,before,item)
            if mode=='review' and action=='accept':_sync_stage(db,p,item)
            db.session.commit();return jsonify(item=_public(item),message='事项已更新')
        except (ValueError,SQLAlchemyError,OSError) as error:return fail(error)

    app.add_url_rule('/api/deadline-rules','business_deadline_rules',rule_catalog,methods=['GET'])
    app.add_url_rule('/api/projects/<int:pid>/deadline-settings','business_deadline_settings',settings,methods=['GET','PUT'])
    app.add_url_rule('/api/projects/<int:pid>/deadlines','business_deadline_list',listing,methods=['GET'])
    app.add_url_rule('/api/projects/<int:pid>/deadlines/preview','business_deadline_preview',preview,methods=['POST'])
    app.add_url_rule('/api/projects/<int:pid>/deadlines/confirm','business_deadline_confirm',confirm,methods=['POST'])
    app.add_url_rule('/api/projects/<int:pid>/deadlines/<item_id>/review','business_deadline_review',lambda pid,item_id:mutate(pid,item_id,'review'),methods=['POST'])
    app.add_url_rule('/api/projects/<int:pid>/deadlines/<item_id>/status','business_deadline_status',lambda pid,item_id:mutate(pid,item_id,'status'),methods=['POST'])

    @app.after_request
    def legacy_source_changed(response):
        if request.method=='GET' and request.path=='/api/settings' and response.status_code==200 and response.is_json:
            if __package__: from . import guarantee_delivery
            else: import guarantee_delivery
            payload=response.get_json()
            payload.setdefault('reminder_runtime_status',{}).update(guarantee_delivery.runtime_status(db,app.extensions.get('deadline_mail_last_check')))
            response.set_data(json.dumps(payload,ensure_ascii=False));response.headers.pop('Content-Length',None)
            return response
        if request.method not in ('PUT','PATCH','POST','DELETE') or not 200<=response.status_code<300:return response
        if request.method=='POST' and request.path=='/api/projects' and response.is_json:
            try:
                result=response.get_json() or {};pid=result.get('id') or (result.get('project') or {}).get('id')
                defaults=(models.get('load_app_settings',lambda:{})() or {}).get('business_deadline_defaults')
                if pid and defaults and not settings_for(db,pid)['revision']:
                    _execute(db,'INSERT INTO business_deadline_settings VALUES(:pid,1,:payload)',dict(pid=int(pid),payload=_json(defaults)))
                    _audit(db,int(pid),'','new_project_default','system','新建项目取得默认适用规则快照',None,defaults)
                    db.session.commit()
            except (ValueError,SQLAlchemyError,OSError,TypeError):
                db.session.rollback();app.logger.warning('新项目默认期限规则未保存，请手动选择适用制度')
            return response
        match=re.fullmatch(r'/api/projects/(\d+)/(?:complaints|clarifications)(?:/.*)?',request.path)
        if not match:return response
        try:
            p=_project(Project,int(match[1]),db)
            if p:list_items(db,p,cache);db.session.commit()
        except (ValueError,SQLAlchemyError,OSError):
            db.session.rollback();app.logger.warning('业务期限待复核状态将在下次读取时核对')
        return response
    app._business_deadlines_registered=True


def reference_method_key(project,db):
    from flask import current_app,has_app_context
    if has_app_context() and current_app.extensions.get('procurement_catalog'):
        if __package__:from . import procurement_catalog
        else:import procurement_catalog
        return procurement_catalog.reference_method_key(project,db)
    return getattr(project,'method','')
