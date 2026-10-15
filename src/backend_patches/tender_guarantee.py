"""tender-guarantee-v1: explicit participation, cash liabilities and audited deadlines."""
from __future__ import annotations
import copy
import hashlib
import hmac
import json
import re
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation

PARTICIPATION=('pending','absent','no_documents','rejected','submitted')
VALIDITY=('pending','valid','invalid')


def _holiday():
    try: import holiday_calendar
    except ModuleNotFoundError: from src.backend_patches import holiday_calendar
    return holiday_calendar


def _money(value):
    if isinstance(value,bool): raise ValueError('金额格式无效')
    try: result=Decimal(str(value or '0'))
    except InvalidOperation: raise ValueError('金额格式无效')
    if not result.is_finite() or result<0 or result>Decimal('999999999999.99') or result.as_tuple().exponent < -2:
        raise ValueError('金额须为非负数且最多两位小数')
    return format(result,'.2f')


def _string(value,limit=2000):
    if not isinstance(value,str) or len(value)>limit: raise ValueError('文本格式或长度无效')
    return value.strip()


def _timestamp(value,day_only=False):
    value=_string(value,30)
    if not value: return ''
    pattern=r'\d{4}-\d{2}-\d{2}' if day_only else r'\d{4}-\d{2}-\d{2}(?:T(?:[01]\d|2[0-3]):[0-5]\d)?'
    if not re.fullmatch(pattern,value): raise ValueError('日期或时分格式无效')
    datetime.fromisoformat(value)
    return value


def roster_fingerprint(registrations):
    identities=[(int(r['id']),r.get('lot_id'),str(r.get('company_name','')),r.get('bidder_type','standalone'),
                 json.dumps(r.get('consortium_members',[]),ensure_ascii=False,sort_keys=True)) for r in registrations]
    return hashlib.sha256(json.dumps(sorted(identities),ensure_ascii=False).encode()).hexdigest()


def validate(raw,registrations,lot_ids,previous=None,correct_cash=False):
    if not isinstance(raw,dict) or not isinstance(raw.get('records',[]),list) or not isinstance(raw.get('rules',[]),list):
        raise ValueError('参与及保证金登记格式错误')
    if type(raw.get('confirmed',False)) is not bool: raise ValueError('名单确认状态无效')
    if len(raw.get('records',[]))>1000 or len(raw.get('rules',[]))>100: raise ValueError('登记数量过多')
    by_id={r['id']:r for r in registrations}; old={r['registration_id']:r for r in (previous or {}).get('records',[])};seen=set(); records=[]
    for value in raw.get('records',[]):
        if not isinstance(value,dict) or type(value.get('registration_id')) is not int or value['registration_id'] not in by_id and value['registration_id'] not in old:
            raise ValueError('供应商报名记录不存在')
        rid=value['registration_id']
        if rid in seen: raise ValueError('供应商登记重复')
        seen.add(rid)
        row={'registration_id':rid,'participation':value.get('participation','pending'),
             'validity':value.get('validity','pending'),'deposit_status':value.get('deposit_status','unknown'),
             'handling':value.get('handling','review')}
        if row['participation'] not in PARTICIPATION or row['validity'] not in VALIDITY:
            raise ValueError('投标状态无效')
        if row['deposit_status'] not in ('unknown','unpaid','paid') or row['handling'] not in ('review','rule','hold'):
            raise ValueError('保证金状态无效')
        for field in ('reason','handling_reason','manual_basis','cash_correction_basis'): row[field]=_string(value.get(field,''))
        registered=by_id.get(rid)
        prior=old.get(rid,{})
        preserve=prior.get('deposit_status')=='paid' and not (correct_cash and row['cash_correction_basis'])
        row['supplier_name_snapshot']=prior['supplier_name_snapshot'] if preserve else registered['company_name'] if registered else prior['supplier_name_snapshot']
        row['lot_id_snapshot']=prior.get('lot_id_snapshot') if preserve else registered.get('lot_id') if registered else prior.get('lot_id_snapshot')
        row['bidder_identity_snapshot']=prior.get('bidder_identity_snapshot','') if preserve else roster_fingerprint([registered]) if registered else prior.get('bidder_identity_snapshot','')
        if row['validity']=='valid' and row['participation']!='submitted': raise ValueError('只有已提交并接收文件的供应商可确认为有效投标')
        if (row['validity']=='invalid' or row['participation'] in ('absent','no_documents','rejected')) and not row['reason']:
            raise ValueError('未参加、文件未接收或投标无效须填写原因')
        row['deposit_amount']=_money(value.get('deposit_amount','0')); row['refunded_amount']=_money(value.get('refunded_amount','0'))
        if Decimal(row['refunded_amount'])>Decimal(row['deposit_amount']): raise ValueError('已退金额不能超过实际缴纳金额')
        if row['deposit_status']!='paid' and Decimal(row['deposit_amount'])!=0: raise ValueError('缴纳情况未确认或未缴纳时不能填写已缴金额')
        if row['deposit_status']=='paid' and Decimal(row['deposit_amount'])<=0: raise ValueError('已缴保证金须填写实际金额')
        row['review_at']=_timestamp(value.get('review_at',''),True)
        row['manual_start_at']=_timestamp(value.get('manual_start_at',''),True)
        row['manual_deadline']=_timestamp(value.get('manual_deadline',''))
        if row['handling']=='hold' and (not row['handling_reason'] or not row['review_at']): raise ValueError('暂缓处理须填写原因及复核日期')
        if row['manual_deadline'] and (not row['manual_start_at'] or not row['manual_basis']): raise ValueError('手动截止日期须填写起算日及调整依据')
        if row['manual_deadline'] and row['manual_deadline'][:10]<row['manual_start_at']: raise ValueError('退还截止不能早于起算日')
        records.append(row)
    rules=[]; ids=set(); scopes=set();old_rules={r['id']:r for r in (previous or {}).get('rules',[])}
    for value in raw.get('rules',[]):
        if not isinstance(value,dict): raise ValueError('退还规则格式错误')
        rule={key:value.get(key,default) for key,default in (
            ('id',''),('lot_id',None),('scope','nonwinner'),('enabled',False),('start_stage_key',''),
            ('manual_start_at',''),('days',5),('day_kind','workday'),('cutoff',''),('remind_days',1))}
        rule['id']=_string(rule['id'],80)
        if not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',rule['id']) or rule['id'] in ids: raise ValueError('规则编号无效或重复')
        ids.add(rule['id'])
        historic_lot=old_rules.get(rule['id'],{}).get('lot_id')==rule['lot_id'] and rule['id'] in old_rules
        if rule['lot_id'] is not None and (type(rule['lot_id']) is not int or rule['lot_id'] not in lot_ids and not historic_lot): raise ValueError('规则采购包不存在')
        if rule['scope'] not in ('winner','nonwinner','exception') or type(rule['enabled']) is not bool: raise ValueError('规则适用对象无效')
        if type(rule['days']) is not int or not 1<=rule['days']<=365 or rule['day_kind'] not in ('calendar','workday'): raise ValueError('退还期限无效')
        if type(rule['remind_days']) is not int or not 0<=rule['remind_days']<=365: raise ValueError('提前提醒天数无效')
        rule['start_stage_key']=_string(rule['start_stage_key'],200)
        rule['manual_start_at']=_timestamp(rule['manual_start_at'],True)
        rule['cutoff']=_string(rule['cutoff'],5)
        if rule['cutoff'] and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',rule['cutoff']): raise ValueError('截止时分无效')
        if rule['enabled']:
            if bool(rule['start_stage_key'])==bool(rule['manual_start_at']): raise ValueError('启用规则须选择一个实际起算阶段或日期')
            identity=(rule['lot_id'],rule['scope'])
            if identity in scopes: raise ValueError('同一采购包及对象只能启用一条退还规则')
            scopes.add(identity)
        rules.append(rule)
    amounts=raw.get('amounts',(previous or {}).get('amounts',[])); normalized=[]; seen_lots=set()
    if not isinstance(amounts,list) or len(amounts)>100:raise ValueError('文件要求金额格式错误')
    for value in amounts:
        if not isinstance(value,dict):raise ValueError('文件要求金额格式错误')
        lot=value.get('lot_id')
        historic=any(x.get('lot_id')==lot for x in (previous or {}).get('amounts',[]))
        if lot is not None and (type(lot) is not int or lot not in lot_ids and not historic):raise ValueError('金额对应采购包不存在')
        if lot in seen_lots:raise ValueError('同一采购包不能重复设置金额')
        seen_lots.add(lot);normalized.append(dict(lot_id=lot,amount=_money(value.get('amount'))))
    return {'records':records,'rules':rules,'amounts':normalized,'confirmed':raw.get('confirmed',False)}


def ordinary_audit(previous,data):
    """Routine operations retain actor/time/snapshots without asking for prose.

    Exceptional deadline/hold/cash corrections still require a human reason.
    """
    old={r['registration_id']:r for r in previous.get('records',[])}
    notes=[]
    for row in data['records']:
        before=old.get(row['registration_id'],{})
        if row==before:continue
        special=('manual_start_at','manual_deadline','manual_basis','handling_reason','review_at','cash_correction_basis')
        if any(row.get(k,'')!=before.get(k,'') for k in special):return ''
        if row['handling']=='hold' and before.get('handling')!='hold':return ''
        if before.get('deposit_status')=='paid' and (row['deposit_status']!='paid' or Decimal(row['deposit_amount'])!=Decimal(before['deposit_amount'])):return ''
        if Decimal(row['refunded_amount'])<Decimal(before.get('refunded_amount','0')):return ''
        notes.append('登记退款' if Decimal(row['refunded_amount'])>Decimal(before.get('refunded_amount','0')) else '核对参与及缴款')
    if previous.get('rules',[])!=data['rules']:notes.append('设置退还规则')
    if previous.get('amounts',[])!=data['amounts']:notes.append('设置文件要求金额')
    if previous.get('confirmed',False)!=data['confirmed']:notes.append('核对参与名单')
    if {r['registration_id'] for r in previous.get('records',[])}-set(r['registration_id'] for r in data['records']):return ''
    return '；'.join(dict.fromkeys(notes))


def eligible_ids(data,registrations,lot_id):
    if not data.get('confirmed') or data.get('stale'): return []
    records={x['registration_id']:x for x in data.get('records',[])}
    return [r['id'] for r in registrations if r.get('lot_id')==lot_id and
            records.get(r['id'],{}).get('participation')=='submitted' and records[r['id']].get('validity')=='valid']


def _deadline_dt(value):
    if not value: return None
    return datetime.fromisoformat(value) if 'T' in value else datetime.combine(date.fromisoformat(value),time(23,59,59))


def derive_items(data,registrations,stages,winners,now=None,previous=None,cache_dir=None,no_deposit=False,accept_recalculation=False):
    now=now or datetime.now(); regs={x['id']:x for x in registrations}
    old={x['registration_id']:x for x in previous or []}; items=[]
    stage_map={str(x.get('key') or x.get('stage_key')):x for x in stages}
    for row in data.get('records',[]):
        rid=row['registration_id']; reg=regs.get(rid)
        if row['deposit_status']!='paid': continue
        orphan=reg is None
        if orphan: reg={'id':rid,'company_name':row.get('supplier_name_snapshot',f'供应商记录{rid}'),'lot_id':row.get('lot_id_snapshot')}
        changed_identity=not orphan and bool(row.get('bidder_identity_snapshot')) and row['bidder_identity_snapshot']!=roster_fingerprint([reg])
        if changed_identity:
            reg={'id':rid,'company_name':row.get('supplier_name_snapshot',reg['company_name']),'lot_id':row.get('lot_id_snapshot')}
        balance=Decimal(row['deposit_amount'])-Decimal(row['refunded_amount'])
        prior=old.get(rid,{})
        exceptional=orphan or changed_identity or row['participation'] in ('absent','no_documents','rejected') or row['validity']=='invalid'
        unconfirmed=row['participation']=='pending' or row['validity']=='pending' or winners is None
        winner=winners is not None and any(x.get('lot_id')==reg.get('lot_id') and str(x.get('winning_supplier','')).strip()==str(reg['company_name']).strip() for x in winners)
        scope='exception' if exceptional else ('unconfirmed' if unconfirmed else ('winner' if winner else 'nonwinner'))
        rule=next((r for r in data.get('rules',[]) if r['enabled'] and r['scope']==scope and r['lot_id']==reg.get('lot_id')),None)
        item=dict(id=f'registration:{rid}',registration_id=rid,lot_id=reg.get('lot_id'),supplier_name=reg['company_name'],
                  scope=scope,balance=format(balance,'.2f'),deadline='',proposed_deadline='',status='review',review_at=row['review_at'],
                  basis=row.get('manual_basis') or row.get('handling_reason') or '',needs_recheck=False,overdue=False,rule_id='',anchor='')
        proposed=''; start=''; issue=''; rule_signature=''; stage_signature=''
        if row['manual_deadline']:
            proposed=row['manual_deadline']; start=row['manual_start_at']; rule_signature=row['manual_basis']
        elif row['handling']=='rule' and rule and not no_deposit:
            item['rule_id']=rule['id']; rule_signature=json.dumps(rule,sort_keys=True,ensure_ascii=False)
            if not exceptional and winners is None: issue='结果名单尚未确认'
            elif rule['manual_start_at']: start=rule['manual_start_at']
            else:
                stage=stage_map.get(rule['start_stage_key'])
                if stage and stage.get('completed') and not stage.get('skipped'):
                    actual=stage.get('completed_at') or stage.get('completed_date')
                    start=str(actual or '')[:10]
                    stage_signature=str(actual or '')
                    if not start: issue='起算阶段缺少实际完成日期'
                else: issue='等待起算阶段完成'
            if start and not issue:
                try: proposed=_holiday().calculate_deadline(start,rule['days'],rule['day_kind'],rule['cutoff'],cache_dir=cache_dir)
                except ValueError as error: issue=str(error)
        else: issue='实际参与、投标有效性或结果尚未确认' if scope=='unconfirmed' else '无需保证金已启用，请核实已缴款项' if no_deposit else '退还规则待确认'
        if orphan: issue='报名记录已移除，已缴保证金仍需核实处理'
        if changed_identity: issue='缴款主体或采购包发生变化，请核对原缴款凭据'
        anchor=hashlib.sha256(json.dumps([proposed,start,stage_signature,rule_signature,scope],ensure_ascii=False).encode()).hexdigest()
        item.update(anchor=anchor,deadline=proposed,basis=item['basis'] or issue or f'{start}起算',remind_days=(rule or {}).get('remind_days',1),start_at=start)
        if prior.get('deadline') and (prior.get('anchor')!=anchor or prior.get('needs_recheck')) and not accept_recalculation:
            item.update(deadline=prior['deadline'],proposed_deadline=proposed,needs_recheck=True,anchor=prior.get('anchor',''),basis=issue or '起算依据或期限发生变化，请复核')
        if row['handling'] in ('review','hold') and prior.get('deadline'):
            item['deadline']=prior['deadline']; item['anchor']=prior.get('anchor','')
        if orphan or changed_identity:
            item['needs_recheck']=True
            if prior.get('deadline'):item['deadline']=prior['deadline']
        when=_deadline_dt(item['deadline']); item['overdue']=bool(when and now>when and balance>0)
        if balance==0: item['status']='returned'
        elif row['handling']=='hold': item['status']='hold'
        elif row['handling']=='review' or item['needs_recheck'] or issue and not proposed: item['status']='waiting' if issue=='等待起算阶段完成' else 'review'
        elif when: item['status']='overdue' if now>when else ('due' if now.date()==when.date() else 'pending')
        items.append(item)
    return items


def _execute(db,sql,args=None):
    from sqlalchemy import text
    return db.session.execute(text(sql),args or {})


def ensure_schema(db):
    for sql in (
        'CREATE TABLE IF NOT EXISTS tender_policies(project_id INTEGER PRIMARY KEY, payload TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS tender_ledgers(project_id INTEGER PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL, roster TEXT NOT NULL, items TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS tender_history(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL,revision INTEGER NOT NULL,payload TEXT NOT NULL,actor TEXT NOT NULL,recorded_at TEXT NOT NULL,reason TEXT NOT NULL)',
        'CREATE TABLE IF NOT EXISTS tender_mail(delivery_key TEXT PRIMARY KEY,event TEXT NOT NULL,delivery TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,next_at TEXT,sent_at TEXT,error_code TEXT)'):
        _execute(db,sql)


def _stage_rows(db,pid):
    """Read metadata once, on the current transaction's connection."""
    from sqlalchemy import inspect
    schema=inspect(db.session.connection())
    if not schema.has_table('stages'):return {}
    columns={x['name'] for x in schema.get_columns('stages')}
    names=[x for x in ('stage_key','completed_at','modules_json') if x in columns]
    if 'stage_key' not in names:return {}
    rows=_execute(db,'SELECT '+','.join(names)+' FROM stages WHERE project_id=:pid',dict(pid=pid)).mappings().all()
    return {row['stage_key']:dict(row) for row in rows}


def _role(db,project,stage,metadata=None):
    key=str(getattr(stage,'stage_key',getattr(stage,'key','')))
    modules=[]
    rows=_stage_rows(db,project.id) if metadata is None else metadata
    value=rows.get(key,{}).get('modules_json')
    if value:
        try: modules=json.loads(value)
        except (ValueError,TypeError): pass
    if key in ('result_announced','bid_results','online_result_announced'): modules+=['result_publication']
    return modules


def policy_for(db,project):
    row=_execute(db,'SELECT payload FROM tender_policies WHERE project_id=:pid',dict(pid=project.id)).first()
    if row: return json.loads(row[0])
    stages=list(getattr(project,'stages',[]) or [])
    complete=bool(stages) and all(getattr(s,'completed',False) or getattr(s,'skipped',False) for s in stages)
    metadata=_stage_rows(db,project.id) if any(getattr(s,'completed',False) for s in stages) else {}
    publication_done=any(getattr(s,'completed',False) and any(m in ('result_publication','bid_results') for m in _role(db,project,s,metadata)) for s in stages)
    defaults=[]
    try:
        from flask import current_app
        loader=current_app.extensions.get('guarantee_settings_loader')
        if callable(loader):defaults=copy.deepcopy(loader().get('guarantee_default_rules',{}).get(getattr(project,'method',''),[]))
    except RuntimeError:pass
    policy={'version':1,'strict_results':not (complete or publication_done),'default_rules':defaults,
            'frozen_stage_keys':[s.stage_key for s in stages if getattr(s,'completed',False)],
            'historical_complete':complete,'enrolled_at':datetime.now().isoformat(timespec='seconds')}
    _execute(db,'INSERT OR IGNORE INTO tender_policies VALUES(:pid,:payload)',dict(pid=project.id,payload=json.dumps(policy)))
    return policy


def _load(db,pid):
    row=_execute(db,'SELECT revision,payload,roster,items FROM tender_ledgers WHERE project_id=:pid',dict(pid=pid)).first()
    return (row[0],json.loads(row[1]),row[2],json.loads(row[3])) if row else (0,{'records':[],'rules':[],'confirmed':False},'',[])


def set_document_amount(db,project,amount,lot_id=None,actor=''):
    """Participate in the caller's transaction; never infer actual payment."""
    current,data,roster,items=_load(db,project.id)
    data=copy.deepcopy(data)
    if not current:data['rules']=copy.deepcopy(policy_for(db,project).get('default_rules',[]))
    if lot_id is not None and lot_id not in {l.id for l in project.lots}:raise ValueError('采购包不存在')
    amounts=[x for x in data.get('amounts',[]) if x['lot_id']!=lot_id]
    if amount is not None and str(amount).strip()!='':amounts.append(dict(lot_id=lot_id,amount=_money(amount)))
    data['amounts']=amounts;encoded=json.dumps(data,ensure_ascii=False)
    if current:
        changed=_execute(db,'UPDATE tender_ledgers SET revision=revision+1,payload=:data WHERE project_id=:pid AND revision=:rev',dict(data=encoded,pid=project.id,rev=current))
        if changed.rowcount!=1:raise ValueError('保证金设置已变化，请刷新后重试')
    else:_execute(db,'INSERT INTO tender_ledgers VALUES(:pid,1,:data,:roster,:items)',dict(pid=project.id,data=encoded,roster=roster,items=json.dumps(items)))
    _execute(db,'INSERT INTO tender_history(project_id,revision,payload,actor,recorded_at,reason) VALUES(:pid,:rev,:data,:actor,:at,:reason)',dict(pid=project.id,rev=current+1,data=json.dumps({'data':data,'items':items},ensure_ascii=False),actor=str(actor),at=datetime.now().isoformat(timespec='seconds'),reason='设置采购文件要求金额'))


def guarantee_projects(db,Project):
    from sqlalchemy.orm import selectinload
    ids=[row[0] for row in _execute(db,"SELECT project_id FROM tender_ledgers WHERE items!='[]'").all()]
    if not ids:return []
    query=Project.query.filter(Project.id.in_(ids))
    for name in ('stages','registrations','lots','bid_results'):
        relation=getattr(Project,name,None)
        if hasattr(getattr(relation,'property',None),'mapper'):query=query.options(selectinload(relation))
    return query.all()


def _registrations(project):
    regs=[]
    for r in project.registrations:
        serialized=r.to_dict() if callable(getattr(r,'to_dict',None)) else {}
        regs.append(dict(id=r.id,company_name=r.company_name,lot_id=getattr(r,'lot_id',None),
                         bidder_type=serialized.get('bidder_type','standalone'),consortium_members=serialized.get('consortium_members',[])))
    return regs


def project_context(db,project):
    regs=_registrations(project)
    stages=[]; result_done=False
    metadata=_stage_rows(db,project.id) if project.stages else {}
    for s in project.stages:
        key=s.stage_key; actual=getattr(s,'completed_date',None)
        stages.append(dict(key=key,completed=bool(s.completed),skipped=bool(getattr(s,'skipped',False)),completed_date=str(actual) if actual else '',completed_at=metadata.get(key,{}).get('completed_at')))
        if s.completed and any(m in ('result_publication','bid_results') for m in _role(db,project,s,metadata)): result_done=True
    winners=[dict(lot_id=getattr(b,'lot_id',None),winning_supplier=b.winning_supplier) for b in getattr(project,'bid_results',[])] if result_done else None
    return regs,stages,winners


def get_payload(db,project,cache_dir=None,now=None,include_mail=True):
    policy=policy_for(db,project); revision,data,roster,prior=_load(db,project.id)
    if not revision and policy.get('default_rules'):
        data['rules']=copy.deepcopy(policy['default_rules'])
    if data.get('records'):regs,stages,winners=project_context(db,project)
    else:regs=_registrations(project);stages=[];winners=None
    stale=bool(roster and roster!=roster_fingerprint(regs))
    data=copy.deepcopy(data); data['stale']=stale
    items=derive_items(data,regs,stages,winners,now,prior,cache_dir,no_deposit=bool(getattr(project,'no_deposit',False)))
    if revision and items!=prior:
        _execute(db,'UPDATE tender_ledgers SET items=:items WHERE project_id=:pid AND revision=:revision',
                 dict(items=json.dumps(items,ensure_ascii=False),pid=project.id,revision=revision))
    failed=0;pending=0
    for status,event_json in (_execute(db,'SELECT status,event FROM tender_mail WHERE status IN (\'failed\',\'pending\',\'sending\')').all() if include_mail else []):
        event=json.loads(event_json)
        if event.get('project_id')==project.id:
            failed+=status=='failed';pending+=status in ('pending','sending')
    return dict(revision=revision,data=data,policy=policy,items=items,
                summary=dict(registered=len(regs),valid=len(eligible_ids(data,regs,None))+sum(len(eligible_ids(data,regs,l.id)) for l in getattr(project,'lots',[])),
                             paid=sum(r['deposit_status']=='paid' for r in data.get('records',[])),
                             pending=sum(x['status']!='returned' for x in items),balance=format(sum(Decimal(x['balance']) for x in items),'.2f'),stale=stale,
                             mail_failed=failed,mail_pending=pending))


def calendar_events(db,projects,year,month,cache_dir=None):
    events=[]
    active={row[0] for row in _execute(db,"SELECT project_id FROM tender_ledgers WHERE items!='[]'").all()}
    for p in projects:
        if p.id not in active:continue
        payload=get_payload(db,p,cache_dir,include_mail=False)
        for item in payload['items']:
            if item['status']=='returned': continue
            for field,title in (('deadline','保证金退还截止'),('review_at','保证金处理复核')):
                at=item.get(field,'')
                if at and at.startswith(f'{year}-{month:02d}-'):
                    events.append(dict(kind='deposit_refund',event_id=f"{p.id}:{item['id']}:{field}",project_id=p.id,project_number=p.number,project_name=p.name,
                                       stage_key='deposit_refund',stage_name=title,icon='💳',date_str=at[:10],planned_time=at[11:16] if 'T' in at else '',
                                       planned_at=at,registration_id=item['registration_id'],guarantee_action='review' if field=='review_at' else 'refund',supplier_name=item['supplier_name'],lot_id=item['lot_id'],balance=item['balance'],needs_recheck=item['needs_recheck'],completed=False,skipped=False))
    return events


def reminder_events(db,projects,now,cache_dir=None):
    result=[]
    for p in projects:
        revision,_,_,prior=_load(db,p.id)
        if not revision: continue
        payload=get_payload(db,p,cache_dir,now,include_mail=False)
        for item in payload['items']:
            if item['status']=='returned': continue
            lot=next((l for l in getattr(p,'lots',[]) if l.id==item['lot_id']),None)
            types=[];deadline=item.get('deadline','')
            if deadline and not item['needs_recheck'] and item['status'] in ('pending','due','overdue','hold'):
                if date.fromisoformat(deadline[:10])-timedelta(days=item.get('remind_days',1))<=now.date(): types.append('deposit_refund')
            if item['needs_recheck'] or item['status']=='review' or item.get('review_at') and item['review_at']<=now.date().isoformat(): types.append('deposit_review')
            for event_type in types:
                event=dict(project_id=p.id,event_type=event_type,event_key=f"{event_type}:{p.id}:{item['id']}:{item['anchor']}:{now.date()}",
                           project_number=p.number,project_name=p.name,purchaser=getattr(p,'purchaser',''),method=getattr(p,'method',''),year=getattr(p,'year',''),
                           lot_identity=f'{lot.lot_number} {lot.lot_name}' if lot else '项目整体',supplier_name=item['supplier_name'],
                           deposit_balance=item['balance'],refund_deadline=deadline,
                           refund_status={'pending':'待退还','due':'今日到期','overdue':'已逾期','hold':'暂缓处理','review':'待核实','waiting':'等待起算'}.get(item['status'],item['status']),
                           review_at=item.get('review_at',''))
                result.append(event)
    return result


def publication_completion_error(db,project,stage_key,cache_dir=None):
    if not policy_for(db,project)['strict_results']:return ''
    stage=next((s for s in project.stages if s.stage_key==stage_key),None)
    if not stage or not any(m in ('result_publication','bid_results') for m in _role(db,project,stage)):return ''
    payload=get_payload(db,project,cache_dir);regs,_,_=project_context(db,project)
    results=list(getattr(project,'bid_results',[]))
    if not results:return '请先登记已核对有效投标供应商的结果，再完成结果公告'
    for result in results:
        allowed=eligible_ids(payload['data'],regs,getattr(result,'lot_id',None))
        if not any(r['id'] in allowed and r['company_name'].strip()==result.winning_supplier.strip() for r in regs):
            return '已有结果的供应商尚未确认为有效投标，请核对；原结果已保留'
    return ''


def register(app,db,models):
    from flask import jsonify,request,session
    from sqlalchemy.exc import IntegrityError
    from pathlib import Path
    if getattr(app,'_tender_guarantee_registered',False): return
    Project=models['Project']; cache_dir=Path(models.get('DATA_DIR','.'))/'holiday_calendar'
    with app.app_context():
        ensure_schema(db)
        for p in Project.query.all(): policy_for(db,p)
        db.session.commit()
    # Initial baseline is captured before defaults are enabled: upgrades never apply new defaults retrospectively.
    app.extensions['guarantee_settings_loader']=models.get('load_app_settings')

    def auth(write=False):
        if not session.get('user_id'): return jsonify(error='请先登录'),401
        User=models.get('User')
        user=db.session.get(User,session['user_id']) if User else None
        if User and (not user or not bool(getattr(user,'is_active',True))):return jsonify(error='账号不可用，请重新登录'),401
        if write:
            expected=str(session.get('csrf_token') or ''); supplied=str(request.headers.get('X-CSRFToken') or '')
            if not expected or not hmac.compare_digest(expected.encode(),supplied.encode()): return jsonify(error='请求已过期，请刷新后重试'),403
        return None

    def ledger(pid):
        denied=auth(request.method=='PUT')
        if denied: return denied
        p=db.get_or_404(Project,pid)
        if request.method=='PUT':
            body=request.get_json(silent=True)
            current,previous,old_roster,prior=_load(db,pid)
            if not isinstance(body,dict) or type(body.get('revision')) is not int or body['revision']!=current:
                return jsonify(error='登记已更新，请重新打开后编辑'),409
            try:
                reason=_string(body.get('reason',''))
                regs,stages,winners=project_context(db,p)
                correction=body.get('confirm_cash_correction',False)
                if type(correction) is not bool: raise ValueError('缴款更正确认状态无效')
                data=validate(body.get('data'),regs,[l.id for l in getattr(p,'lots',[])],previous,correction)
                if not reason:reason=ordinary_audit(previous,data)
                if current and not reason:raise ValueError('特殊调整或更正已有登记须填写原因')
                new_records={r['registration_id']:r for r in data['records']}
                explicit_confirmation=body.get('confirm_roster',False)
                if type(explicit_confirmation) is not bool:raise ValueError('名单确认状态无效')
                roster_changed=bool(old_roster and old_roster!=roster_fingerprint(regs))
                old_participation=[(r['registration_id'],r['participation'],r['validity'],r['reason']) for r in previous.get('records',[])]
                new_participation=[(r['registration_id'],r['participation'],r['validity'],r['reason']) for r in data['records']]
                if current and (roster_changed or sorted(old_participation)!=sorted(new_participation)) and not explicit_confirmation:
                    data['confirmed']=False
                for old in previous.get('records',[]):
                    new=new_records.get(old['registration_id'])
                    if not new:continue
                    reduced=old['deposit_status']=='paid' and (new['deposit_status']!='paid' or Decimal(new['deposit_amount'])<Decimal(old['deposit_amount']))
                    if reduced and (not correction or not new['cash_correction_basis']):
                        raise ValueError('更正已缴金额或缴纳状态须明确确认误录更正并填写依据；实际退还请登记已退金额')
                new_ids={r['registration_id'] for r in data['records']}
                if any(r['registration_id'] not in new_ids and r['deposit_status']=='paid' and Decimal(r['deposit_amount'])>Decimal(r['refunded_amount']) for r in previous.get('records',[])):
                    raise ValueError('仍有未退保证金的供应商不能从处理登记中移除')
                stage_keys={s['key'] for s in stages}
                previous_starts={r['id']:r.get('start_stage_key') for r in previous.get('rules',[])}
                if any(r['enabled'] and r['start_stage_key'] and r['start_stage_key'] not in stage_keys and previous_starts.get(r['id'])!=r['start_stage_key'] for r in data['rules']): raise ValueError('起算阶段不存在')
                accepted=body.get('accept_recalculation',False)
                if type(accepted) is not bool: raise ValueError('复核状态无效')
                items=derive_items(data,regs,stages,winners,previous=prior,cache_dir=cache_dir,no_deposit=bool(getattr(p,'no_deposit',False)),accept_recalculation=accepted)
                encoded=json.dumps(data,ensure_ascii=False); item_json=json.dumps(items,ensure_ascii=False); roster=roster_fingerprint(regs)
                if current:
                    changed=_execute(db,'UPDATE tender_ledgers SET revision=revision+1,payload=:payload,roster=:roster,items=:items WHERE project_id=:pid AND revision=:revision',dict(pid=pid,revision=current,payload=encoded,roster=roster,items=item_json))
                    if changed.rowcount!=1: db.session.rollback();return jsonify(error='登记已更新，请重新打开'),409
                else:
                    _execute(db,'INSERT INTO tender_ledgers VALUES(:pid,1,:payload,:roster,:items)',dict(pid=pid,payload=encoded,roster=roster,items=item_json))
                _execute(db,'INSERT INTO tender_history(project_id,revision,payload,actor,recorded_at,reason) VALUES(:pid,:rev,:payload,:actor,:at,:reason)',
                         dict(pid=pid,rev=current+1,payload=json.dumps({'data':data,'items':items},ensure_ascii=False),actor=str(session.get('username') or session['user_id']),at=datetime.now().isoformat(timespec='seconds'),reason=reason or '首次登记'))
                db.session.commit()
            except ValueError as error:
                db.session.rollback();return jsonify(error=str(error)),400
            except IntegrityError:
                db.session.rollback();return jsonify(error='登记已更新，请重新打开'),409
        value=get_payload(db,p,cache_dir);db.session.commit();return jsonify(value)
    app.add_url_rule('/api/projects/<int:pid>/tender-guarantee','tender_guarantee_ledger',ledger,methods=['GET','PUT'])

    def defaults():
        denied=auth(request.method=='PUT')
        if denied:return denied
        settings=models['load_app_settings']();templates=settings.get('stage_templates') or {}
        if request.method=='PUT':
            User=models.get('User');user=db.session.get(User,session['user_id']) if User else None
            if not user or not getattr(user,'is_admin',False):return jsonify(error='只有管理员可修改新项目默认规则'),403
            body=request.get_json(silent=True)
            try:
                if not isinstance(body,dict) or body.get('method') not in templates:raise ValueError('采购方式无效')
                method=body['method'];rules=validate({'records':[],'rules':body.get('rules'),'confirmed':False},[],[])['rules']
                keys={x['id'] for x in templates[method]}
                if any(r['enabled'] and (not r['start_stage_key'] or r['start_stage_key'] not in keys or r['manual_start_at']) for r in rules):raise ValueError('新项目默认规则须选择该方式的起算阶段，不能固定历史起算日')
                mapping=copy.deepcopy(settings.get('guarantee_default_rules',{}));mapping[method]=rules
                models['save_app_settings']({'guarantee_default_rules':mapping})
            except ValueError as error:return jsonify(error=str(error)),400
            return jsonify(ok=True,message='默认规则已保存，仅供之后创建的新项目使用')
        return jsonify(rules=settings.get('guarantee_default_rules',{}),templates=templates)
    app.add_url_rule('/api/tender-guarantee/defaults','tender_guarantee_defaults',defaults,methods=['GET','PUT'])

    def retry_mail(pid):
        denied=auth(True)
        if denied:return denied
        p=db.get_or_404(Project,pid);requeued=0
        for key,event_json in _execute(db,"SELECT delivery_key,event FROM tender_mail WHERE status='failed'").all():
            event=json.loads(event_json)
            if event.get('project_id')==pid:
                _execute(db,"UPDATE tender_mail SET status='pending',attempts=0,next_at=:at,error_code=NULL WHERE delivery_key=:key",
                         dict(key=key,at=datetime.now().isoformat(timespec='seconds')));requeued+=1
        db.session.commit();return jsonify(ok=True,requeued=requeued,message='已重新排队；只发送当前仍有效的提醒，请勿重复重试状态不确定的邮件')
    app.add_url_rule('/api/projects/<int:pid>/tender-guarantee/retry-mail','tender_guarantee_retry_mail',retry_mail,methods=['POST'])

    @app.before_request
    def guard_result():
        if request.method not in ('POST','PUT') or not session.get('user_id'): return None
        match=re.fullmatch(r'/api/projects/(\d+)/bid-results(?:/(\d+))?',request.path)
        if not match: return None
        p=db.session.get(Project,int(match[1]))
        if not p: return None
        policy=policy_for(db,p)
        if not policy['strict_results']: return None
        body=request.get_json(silent=True)
        if not isinstance(body,dict): return jsonify(error='结果数据格式错误'),400
        original=next((b for b in getattr(p,'bid_results',[]) if str(b.id)==match[2]),None) if match[2] else None
        raw_lot=body.get('lot_id',getattr(original,'lot_id',None))
        try: lot_id=int(raw_lot) if raw_lot not in (None,'') else None
        except (ValueError,TypeError): return jsonify(error='采购包无效'),400
        name=body.get('winning_supplier',getattr(original,'winning_supplier',''))
        if not isinstance(name,str): return jsonify(error='供应商名称无效'),400
        payload=get_payload(db,p,cache_dir); regs,_,_=project_context(db,p)
        allowed=eligible_ids(payload['data'],regs,lot_id)
        if not any(r['id'] in allowed and r['company_name'].strip()==name.strip() for r in regs):
            return jsonify(error='请先在开标或评审中确认该采购包的有效投标供应商，再登记结果'),400
        return None

    @app.before_request
    def guard_publication_completion():
        if request.method not in ('POST','PUT') or not session.get('user_id'):return None
        body=request.get_json(silent=True)
        if not isinstance(body,dict):return None
        selected=[]
        match=re.fullmatch(r'/api/projects/(\d+)/stages/([^/]+)',request.path)
        if match and body.get('completed') and not body.get('skipped'):
            selected=[(int(match[1]),match[2])]
        elif request.path=='/api/batch/advance-stage' and isinstance(body.get('project_ids'),list):
            for pid in body['project_ids']:
                if type(pid) is int or isinstance(pid,str) and pid.isdigit():selected.append((int(pid),str(body.get('stage_key',''))))
        for pid,key in selected:
            p=db.session.get(Project,pid)
            if not p or not policy_for(db,p)['strict_results']:continue
            stage=next((s for s in p.stages if s.stage_key==key),None)
            if not stage or not any(m in ('result_publication','bid_results') for m in _role(db,p,stage)):continue
            payload=get_payload(db,p,cache_dir);regs,_,_=project_context(db,p);results=list(getattr(p,'bid_results',[]))
            if not results:return jsonify(error='请先登记已核对有效投标供应商的结果，再完成结果公告'),409
            for result in results:
                allowed=eligible_ids(payload['data'],regs,getattr(result,'lot_id',None))
                if not any(r['id'] in allowed and r['company_name'].strip()==result.winning_supplier.strip() for r in regs):
                    return jsonify(error='已有结果的供应商尚未确认为有效投标，请核对；原结果已保留'),409
        return None

    @app.before_request
    def guard_notice_supplier():
        if request.method not in ('POST','PUT') or not session.get('user_id'):return None
        match=re.fullmatch(r'/api/projects/(\d+)/notice-deliveries(?:/(\d+))?',request.path)
        if not match:return None
        p=db.session.get(Project,int(match[1]))
        if not p or not policy_for(db,p)['strict_results']:return None
        body=request.get_json(silent=True)
        if not isinstance(body,dict):return jsonify(error='通知书数据格式错误'),400
        original=next((n for n in getattr(p,'notice_deliveries',[]) if str(n.id)==match[2]),None) if match[2] else None
        raw_lot=body.get('lot_id',getattr(original,'lot_id',None))
        try:lot_id=int(raw_lot) if raw_lot not in (None,'') else None
        except (ValueError,TypeError):return jsonify(error='采购包无效'),400
        name=body.get('supplier_name',getattr(original,'supplier_name',''))
        if not isinstance(name,str):return jsonify(error='供应商名称无效'),400
        payload=get_payload(db,p,cache_dir);regs,_,_=project_context(db,p)
        allowed=eligible_ids(payload['data'],regs,lot_id)
        valid=any(r['id'] in allowed and r['company_name'].strip()==name.strip() for r in regs)
        winner=any(getattr(b,'lot_id',None)==lot_id and b.winning_supplier.strip()==name.strip() for b in getattr(p,'bid_results',[]))
        if not valid or not winner:return jsonify(error='请选择该采购包已确认有效且已登记中标或成交结果的供应商'),400
        return None

    @app.after_request
    def enrich_project(response):
        if response.status_code>=400 or not response.is_json: return response
        if request.path=='/api/projects' and request.method=='POST':
            value=response.get_json()
            if isinstance(value,dict) and type(value.get('id')) is int:
                p=db.session.get(Project,value['id'])
                if p:
                    policy_for(db,p);value['tender_guarantee']=get_payload(db,p,cache_dir)
                    db.session.commit();response.set_data(json.dumps(value,ensure_ascii=False));response.headers.pop('Content-Length',None)
            return response
        if not re.fullmatch(r'/api/projects/\d+',request.path) or request.method!='GET': return response
        value=response.get_json();p=db.session.get(Project,int(request.path.rsplit('/',1)[-1]))
        if isinstance(value,dict) and p:
            value['tender_guarantee']=get_payload(db,p,cache_dir);db.session.commit();response.set_data(json.dumps(value,ensure_ascii=False));response.headers.pop('Content-Length',None)
        return response
    app._tender_guarantee_registered=True
