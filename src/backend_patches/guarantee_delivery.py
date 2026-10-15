"""guarantee-delivery-v1: durable recipient delivery queue for cash reminders."""
from datetime import datetime,timedelta
from pathlib import Path
import hashlib
import json
import threading
from decimal import Decimal

_LOCK=threading.Lock()


def aggregate_events(events):
    groups={}
    for event in events:
        day=event['event_key'].rsplit(':',1)[-1]
        groups.setdefault((event.get('project_id'),event['event_type'],day),[]).append(event)
    result=[]
    for (pid,kind,day),rows in groups.items():
        item=dict(rows[0]);item['event_key']=f'guarantee-summary:{kind}:{pid}:{day}'
        item['supplier_name']='、'.join(dict.fromkeys(r.get('supplier_name','') for r in rows))
        item['deposit_balance']=format(sum(Decimal(r.get('deposit_balance') or '0') for r in rows),'.2f')
        for field in ('lot_identity','refund_deadline','refund_status','review_at'):
            values=list(dict.fromkeys(str(r.get(field) or '') for r in rows))
            item[field]='；'.join(v for v in values if v)
        result.append(item)
    return result


def _modules():
    try:import tender_guarantee,reminder_routing
    except ModuleNotFoundError:from src.backend_patches import tender_guarantee,reminder_routing
    return tender_guarantee,reminder_routing


def enqueue(db,events,groups,now):
    tg,rr=_modules()
    for event in events:
        for delivery in rr.route_reminder_event(event,groups):
            # Content/routing edits do not resend an already delivered obligation to the same recipient.
            key=hashlib.sha256((event['event_key']+'\0'+delivery['recipient']).encode()).hexdigest()
            tg._execute(db,'INSERT OR IGNORE INTO tender_mail(delivery_key,event,delivery,status,attempts,next_at) VALUES(:key,:event,:delivery,\'pending\',0,:at)',
                        dict(key=key,event=json.dumps(event,ensure_ascii=False),delivery=json.dumps(delivery,ensure_ascii=False),at=now.isoformat(timespec='seconds')))
            tg._execute(db,"UPDATE tender_mail SET event=:event,delivery=:delivery WHERE delivery_key=:key AND status='pending'",
                        dict(key=key,event=json.dumps(event,ensure_ascii=False),delivery=json.dumps(delivery,ensure_ascii=False)))


def claim(db,events,groups,now):
    tg,rr=_modules();eligible={e['event_key'] for e in events};due=[]
    # SMTP may have accepted a message before a crash. Do not silently resend uncertain deliveries.
    tg._execute(db,"UPDATE tender_mail SET status='failed',error_code='SMTP_SEND_FAILED' WHERE status='sending' AND next_at<:stale",dict(stale=(now-timedelta(minutes=20)).isoformat(timespec='seconds')))
    rows=tg._execute(db,"SELECT delivery_key,event,delivery,attempts,next_at FROM tender_mail WHERE status='pending' AND attempts<3 AND (next_at IS NULL OR next_at<=:now)",dict(now=now.isoformat(timespec='seconds'))).all()
    for key,event_json,delivery_json,attempts,next_at in rows:
        event=json.loads(event_json);delivery=json.loads(delivery_json)
        if event['event_key'] not in eligible or not rr.delivery_matches_current_rules(event,delivery,groups):continue
        changed=tg._execute(db,"UPDATE tender_mail SET status='sending',attempts=attempts+1,next_at=:at WHERE delivery_key=:key AND status='pending'",dict(key=key,at=now.isoformat(timespec='seconds')))
        if changed.rowcount==1:due.append(dict(delivery_key=key,event=event,delivery=delivery))
    db.session.commit();return due


def mark_result(db,key,result,now):
    tg,_=_modules();sent=result.get('status')=='sent'
    row=tg._execute(db,'SELECT attempts FROM tender_mail WHERE delivery_key=:key',dict(key=key)).first()
    if not row:return
    error=result.get('error_code') or 'SMTP_SEND_FAILED'
    terminal=error=='SMTP_AUTH_FAILED' or row[0]>=3
    tg._execute(db,'UPDATE tender_mail SET status=:status,next_at=:next,sent_at=:sent,error_code=:error WHERE delivery_key=:key',
                dict(key=key,status='sent' if sent else ('failed' if terminal else 'pending'),
                     next=None if sent or terminal else (now+timedelta(minutes=15)).isoformat(timespec='seconds'),
                     sent=now.isoformat(timespec='seconds') if sent else None,error=None if sent else error))


def _unprotect(raw):
    import ctypes,ctypes.wintypes
    class Blob(ctypes.Structure):_fields_=[('size',ctypes.wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_char))]
    buffer=ctypes.create_string_buffer(raw);source=Blob(len(raw),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_char)));target=Blob()
    if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(source),None,None,None,None,0,ctypes.byref(target)):raise ctypes.WinError()
    try:return ctypes.string_at(target.data,target.size).decode('utf-8')
    finally:ctypes.windll.kernel32.LocalFree(target.data)


def run(server_app,now=None):
    now=now or datetime.now()
    if not _LOCK.acquire(blocking=False):return
    try:
        tg,rr=_modules();settings=server_app.load_app_settings();groups=rr.normalize_recipient_groups(settings)
        if not settings.get('reminder_enabled'):return
        if not any(g['enabled'] and any(t in g['event_types'] for t in ('deposit_refund','deposit_review')) for g in groups):return
        value=str(settings.get('reminder_time') or '09:00')
        try:hour,minute=map(int,value.split(':'))
        except (ValueError,TypeError):hour,minute=9,0
        if (now.hour,now.minute)<(hour,minute):return
        weekdays=settings.get('reminder_weekdays')
        cache=Path(server_app.DATA_DIR)/'holiday_calendar'
        if settings.get('reminder_use_national_workdays'):
            info=tg._holiday().day_info(now.date(),cache_dir=cache)
            if not info['confirmed'] or info['status']!='workday':return
        elif weekdays and now.weekday() not in weekdays:return
        db=server_app.db;tg.ensure_schema(db)
        events=aggregate_events(tg.reminder_events(db,tg.guarantee_projects(db,server_app.Project),now,cache))
        enqueue(db,events,groups,now);db.session.commit();due=claim(db,events,groups,now)
        if not due:return
        try:
            path=Path(server_app.SETTINGS_PATH).with_name('reminder_credentials.dpapi')
            hook=getattr(server_app,'_REMINDER_UNPROTECT_SECRET',None)
            secret=(hook(path.read_bytes()).decode('utf-8') if hook else _unprotect(path.read_bytes()))
            messages=[(r['delivery_key'],rr.render_recipient_message(r['event'],r['delivery'],str(settings.get('smtp_sender') or ''))) for r in due]
            results=rr.send_delivery_batch(messages,dict(host=settings.get('smtp_host'),port=settings.get('smtp_port'),security=settings.get('smtp_security'),username=settings.get('smtp_username')),secret,smtp_factory=getattr(server_app,'_REMINDER_SMTP_FACTORY',None))
        except Exception:
            results=[dict(delivery_key=r['delivery_key'],status='failed',error_code='SMTP_SEND_FAILED') for r in due]
        for result in results:mark_result(db,result['delivery_key'],result,now)
        db.session.commit()
    finally:_LOCK.release()
