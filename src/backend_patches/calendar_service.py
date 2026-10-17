"""calendar-service-v1: shared holiday display and guarantee agenda integration."""
import copy
import hmac
import json
from datetime import datetime
from pathlib import Path


def _modules():
    if __package__: from . import holiday_calendar,tender_guarantee
    else: import holiday_calendar,tender_guarantee
    return holiday_calendar,tender_guarantee


def enrich_calendar(payload,year,month,events=(),cache_dir=None):
    hc,_=_modules(); result=copy.deepcopy(payload);snapshot=hc.get_calendar(year,cache_dir)
    result['holiday_calendar']={key:snapshot.get(key) for key in ('year','version','source_url','updated_at')}
    result['holiday_calendar']['confirmed']=bool(snapshot.get('version'))
    by_date={}
    for event in events: by_date.setdefault(event['date_str'],[]).append(event)
    for cell in result.get('cells',[]):
        if cell.get('empty') or not cell.get('date_str'):continue
        cell['holiday']=hc.day_info(cell['date_str'],snapshot)
        existing=cell.setdefault('events',[]); ids={x.get('event_id') for x in existing if x.get('event_id')}
        existing.extend(x for x in by_date.get(cell['date_str'],[]) if x.get('event_id') not in ids)
    return result


def preview_impacts(db,Project,year,snapshot,cache_dir=None):
    """Compare all active obligations using a request-local calendar overlay."""
    from decimal import Decimal
    if __package__:
        from . import business_deadlines as deadlines
    else:
        import business_deadlines as deadlines
    _,tg=_modules()
    results=deadlines.impact_items(db,Project,year,snapshot,cache_dir)
    overlay={year:snapshot,'_cache_dir':cache_dir}
    for project in tg.guarantee_projects(db,Project):
        _,data,_,previous=tg._load(db,project.id)
        regs,stages,winners=tg.project_context(db,project)
        current={item['registration_id']:item for item in previous}
        baseline={item['registration_id']:item for item in tg.derive_items(
            data,regs,stages,winners,previous=previous,cache_dir=cache_dir,
            no_deposit=bool(getattr(project,'no_deposit',False)),accept_recalculation=True)}
        proposed=tg.derive_items(data,regs,stages,winners,previous=previous,cache_dir=overlay,
                                 no_deposit=bool(getattr(project,'no_deposit',False)),accept_recalculation=True)
        for item in proposed:
            prior=current.get(item['registration_id'],{})
            if Decimal(item.get('balance') or '0')<=0 or item.get('deadline')==baseline.get(item['registration_id'],{}).get('deadline'):continue
            results.append(dict(kind='deposit_refund',project_id=project.id,
                project_name=getattr(project,'name',''),project_number=getattr(project,'number',''),
                registration_id=item['registration_id'],title='保证金退还截止',
                supplier_name=item.get('supplier_name',''),old_deadline=prior.get('deadline',''),
                new_deadline=item.get('deadline',''),before=prior.get('deadline',''),after=item.get('deadline',''),
                overdue=deadlines._time_status(dict(confirmed_deadline=item.get('deadline','')))=='overdue',
                reason='年度放假调休安排变化，原确认期限保留，更新后需复核'))
    return results


def register(app,db,models):
    from flask import jsonify,request,session
    if getattr(app,'_holiday_calendar_registered',False):return
    Project=models['Project']; cache=Path(models['DATA_DIR'])/'holiday_calendar'

    # Offline handlers retain endpoint names used by existing installations.
    if __package__: from . import holiday_import
    else: import holiday_import
    holiday_import.register(app,db,models)

    def preferences():
        if not session.get('user_id'):return jsonify(error='请先登录'),401
        User=models.get('User');user=db.session.get(User,session['user_id']) if User else None
        if not user or not bool(getattr(user,'is_active',True)):return jsonify(error='账号不可用，请重新登录'),401
        if not user or not getattr(user,'is_admin',False):return jsonify(error='仅管理员可修改提醒日历'),403
        expected=str(session.get('csrf_token') or '');supplied=str(request.headers.get('X-CSRFToken') or '')
        if not expected or not hmac.compare_digest(expected.encode(),supplied.encode()):return jsonify(error='请求已过期，请刷新后重试'),403
        data=request.get_json(silent=True)
        if not isinstance(data,dict) or type(data.get('use_national_workdays')) is not bool:return jsonify(error='提醒日历设置无效'),400
        models['save_app_settings']({'reminder_use_national_workdays':data['use_national_workdays']})
        return jsonify(ok=True)
    app.add_url_rule('/api/holiday-calendar/preferences','holiday_calendar_preferences',preferences,methods=['POST'])

    @app.after_request
    def enrich(response):
        if request.path!='/api/calendar' or request.method!='GET' or response.status_code!=200 or not response.is_json:return response
        try:
            year=int(request.args.get('year',datetime.now().year));month=int(request.args.get('month',datetime.now().month))
            if not 1<=month<=12 or not 2000<=year<=2100:return response
            _,tg=_modules();events=tg.calendar_events(db,tg.guarantee_projects(db,Project),year,month,cache)
            if getattr(app,'_business_deadlines_registered',False):
                if __package__: from . import business_deadlines as deadlines
                else: import business_deadlines as deadlines
                events.extend(deadlines.calendar_events(db,Project,year,month,cache))
            data=enrich_calendar(response.get_json(),year,month,events,cache);db.session.commit()
            response.set_data(json.dumps(data,ensure_ascii=False));response.headers.pop('Content-Length',None)
        except Exception:
            db.session.rollback();app.logger.exception('日历扩展数据读取失败')
            # Do not claim a confirmed holiday year when this extension failed.
            data=response.get_json();data['holiday_calendar']={'year':request.args.get('year'),'confirmed':False,'error':'CALENDAR_EXTENSION_FAILED'}
            response.set_data(json.dumps(data,ensure_ascii=False));response.headers.pop('Content-Length',None)
        return response
    app._holiday_calendar_registered=True


def check_updates(data_dir,now=None):
    """Compatibility hook: annual calendars are now administrator-imported offline."""
    return None
