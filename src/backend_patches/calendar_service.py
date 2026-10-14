"""calendar-service-v1: shared holiday display and guarantee agenda integration."""
import copy
import hmac
import json
from datetime import datetime
from pathlib import Path


def _modules():
    try: import holiday_calendar,tender_guarantee
    except ModuleNotFoundError: from src.backend_patches import holiday_calendar,tender_guarantee
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


def register(app,db,models):
    from flask import jsonify,request,session
    if getattr(app,'_holiday_calendar_registered',False):return
    Project=models['Project']; cache=Path(models['DATA_DIR'])/'holiday_calendar'

    def calendar_settings():
        if not session.get('user_id'):return jsonify(error='请先登录'),401
        try: year=int(request.args.get('year',datetime.now().year))
        except (ValueError,TypeError):return jsonify(error='年度无效'),400
        hc,_=_modules()
        try: data=hc.get_calendar(year,cache)
        except ValueError as e:return jsonify(error=str(e)),400
        settings=models['load_app_settings']()
        return jsonify({**data,'confirmed':bool(data.get('version')),'use_national_workdays':bool(settings.get('reminder_use_national_workdays'))})

    def update_calendar():
        if not session.get('user_id'):return jsonify(error='请先登录'),401
        User=models.get('User'); user=db.session.get(User,session['user_id']) if User else None
        if not user or not getattr(user,'is_admin',False):return jsonify(error='仅管理员可更新节假日安排'),403
        expected=str(session.get('csrf_token') or '');supplied=str(request.headers.get('X-CSRFToken') or '')
        if not expected or not hmac.compare_digest(expected.encode(),supplied.encode()):return jsonify(error='请求已过期，请刷新后重试'),403
        body=request.get_json(silent=True)
        if not isinstance(body,dict) or type(body.get('year')) is not int:return jsonify(error='年度无效'),400
        hc,_=_modules()
        try:
            result=hc.update_data(cache,body['year'])
            return jsonify(result=result,message='已核对节假日安排；受影响的退还期限将显示待复核')
        except Exception:
            return jsonify(error='暂时无法获取已核验的年度安排，原有数据已保留'),503
    app.add_url_rule('/api/holiday-calendar','holiday_calendar_settings',calendar_settings,methods=['GET'])
    app.add_url_rule('/api/holiday-calendar/update','holiday_calendar_update',update_calendar,methods=['POST'])

    def preferences():
        if not session.get('user_id'):return jsonify(error='请先登录'),401
        User=models.get('User');user=db.session.get(User,session['user_id']) if User else None
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
            _,tg=_modules();events=tg.calendar_events(db,Project.query.all(),year,month,cache)
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
    now=now or datetime.now();cache=Path(data_dir)/'holiday_calendar';path=cache/'update_status.json'
    try: previous=json.loads(path.read_text('utf-8'))
    except (OSError,ValueError):previous={}
    last=previous.get('checked_at','')
    try:
        if (now-datetime.fromisoformat(last)).total_seconds()<7*86400:return
    except ValueError:pass
    cache.mkdir(parents=True,exist_ok=True);hc,_=_modules();results=[]
    for year in (now.year,now.year+1):
        try:results.append(hc.update_data(cache,year))
        except Exception:results.append({'year':year,'updated':False})
    # This is status only. Verified data files are atomically persisted by update_data.
    temp=path.with_suffix('.tmp');temp.write_text(json.dumps({'checked_at':now.isoformat(timespec='seconds'),'results':results}),encoding='utf-8');temp.replace(path)
