"""holiday-calendar-v1: verified national holidays and working-day calculations."""
from __future__ import annotations
from datetime import date, datetime, timedelta
from pathlib import Path
import hashlib
import json
import os
import re
import tempfile
import urllib.request

SOURCE = 'https://www.beijing.gov.cn/zhengce/zhengcefagui/202511/t20251104_4258873.html'
UPDATE_BASE = 'https://raw.githubusercontent.com/wangmk23/Tender-Project-Management-System/main/docs/data/holidays/'
# Festival dates are annotations, not the national holiday schedule. In
# particular, Spring Festival and Qingming need not start on the first day off.
# Lunar dates/solar term verified against Hong Kong Observatory's 2026 table:
# https://www.hko.gov.hk/tc/gts/time/calendar/pdf/files/2026.pdf
FESTIVALS_2026 = (('2026-01-01', '元旦'), ('2026-02-17', '春节'),
                  ('2026-04-05', '清明节'), ('2026-05-01', '劳动节'),
                  ('2026-06-19', '端午节'), ('2026-09-25', '中秋节'),
                  ('2026-10-01', '国庆节'))


class HolidayDataUnavailable(ValueError): pass


def _date(value):
    if isinstance(value, datetime): return value.date()
    if isinstance(value, date): return value
    if not isinstance(value, str) or not re.fullmatch(r'\d{4}-\d{2}-\d{2}', value):
        raise ValueError('日期须为YYYY-MM-DD')
    return date.fromisoformat(value)


def _builtin():
    spans=[('元旦','2026-01-01','2026-01-03'),('春节','2026-02-15','2026-02-23'),
           ('清明节','2026-04-04','2026-04-06'),('劳动节','2026-05-01','2026-05-05'),
           ('端午节','2026-06-19','2026-06-21'),('中秋节','2026-09-25','2026-09-27'),
           ('国庆节','2026-10-01','2026-10-07')]
    holidays=[]
    for name,start,end in spans:
        current=_date(start)
        while current<=_date(end):
            holidays.append({'date':current.isoformat(),'name':name}); current+=timedelta(days=1)
    return {'year':2026,'version':1,'updated_at':'2025-11-04','source_url':SOURCE,
            'document':'国办发明电〔2025〕7号','holidays':holidays,
            'workdays':['2026-01-04','2026-02-14','2026-02-28','2026-05-09','2026-09-20','2026-10-10']}


def validate_festivals(data):
    """Optional annotations may overlap days off, but have their own uniqueness."""
    if 'festivals' not in data: return
    festivals = data['festivals']
    if not isinstance(festivals, list) or len(festivals) > 366:
        raise ValueError('节日当天列表无效')
    seen = set()
    for item in festivals:
        if not isinstance(item, dict): raise ValueError('节日当天记录无效')
        day = _date(item.get('date'))
        name = item.get('name')
        if day.year != data['year'] or day.isoformat() in seen:
            raise ValueError('节日当天日期重复或跨年')
        if not isinstance(name, str) or not 1 <= len(name.strip()) <= 40 or any(ord(c) < 32 for c in name):
            raise ValueError('节日当天名称无效')
        seen.add(day.isoformat())


def festival_dates(snapshot):
    """Read annotations without upgrading or rewriting immutable old revisions.

    Explicit empty lists mean no labels. Only the verified legacy year has a
    fallback; never infer a lunar festival from the beginning of a holiday span.
    """
    if 'festivals' in snapshot:
        return [dict(date=item['date'], name=item['name']) for item in snapshot['festivals']]
    return [dict(date=day, name=name) for day, name in FESTIVALS_2026] if snapshot.get('year') == 2026 else []


def validate_data(data):
    if not isinstance(data,dict) or type(data.get('year')) is not int or not 2000<=data['year']<=2100:
        raise ValueError('节假日年度无效')
    if type(data.get('version')) is not int or data['version']<1: raise ValueError('节假日版本无效')
    from urllib.parse import urlsplit
    source=urlsplit(str(data.get('source_url','')))
    if source.scheme!='https' or not (source.hostname or '').endswith('.gov.cn') or source.username:
        raise ValueError('节假日须有官方来源')
    _date(data.get('updated_at'))
    holidays=data.get('holidays'); workdays=data.get('workdays')
    if not isinstance(holidays,list) or not isinstance(workdays,list) or len(holidays)>150 or len(workdays)>60:
        raise ValueError('节假日列表格式错误')
    seen=set()
    for item in holidays:
        if not isinstance(item,dict) or not isinstance(item.get('name'),str) or not 1<=len(item['name'])<=40:
            raise ValueError('节日名称无效')
        day=_date(item.get('date'))
        if day.year!=data['year'] or day.isoformat() in seen: raise ValueError('节假日日期重复或跨年')
        seen.add(day.isoformat())
    makeup=set()
    for item in workdays:
        day=_date(item)
        if day.year!=data['year'] or item in seen or item in makeup: raise ValueError('补班日期重复或冲突')
        makeup.add(item)
    validate_festivals(data)
    result=json.loads(json.dumps(data,ensure_ascii=False))
    # Source validation above remains strict; manual revisions use their own
    # validation and never acquire an official-source attribution here.
    result.update(local_revision=0,origin='official_source',confirmed=True)
    return result


def get_calendar(year,cache_dir=None):
    if type(year) is not int or not 2000<=year<=2100: raise ValueError('年度无效')
    # A request-local candidate map lets existing calculators preview one year
    # without changing active files or process-global readers. Other years keep
    # reading the actual calendar directory.
    if isinstance(cache_dir,dict):
        if year in cache_dir:
            candidate=cache_dir[year]
            if not isinstance(candidate,dict) or candidate.get('year')!=year or not candidate.get('version'):
                raise HolidayDataUnavailable('预览年度安排无效')
            if __package__: from .holiday_import import _validate_snapshot
            else: from holiday_import import _validate_snapshot
            _validate_snapshot(candidate)
            return json.loads(json.dumps(candidate,ensure_ascii=False))
        return get_calendar(year,cache_dir.get('_cache_dir'))
    if cache_dir:
        if __package__: from .holiday_import import get_active
        else: from holiday_import import get_active
        active=get_active(year,cache_dir)
        if active is not None:return active
    builtin=validate_data(_builtin()) if year==2026 else None
    if cache_dir:
        path=Path(cache_dir)/f'{year}.json'
        if path.is_file():
            try:
                if path.stat().st_size>131072: raise ValueError('文件过大')
                value=validate_data(json.loads(path.read_text('utf-8')))
                if value['year']!=year: raise ValueError('年度不匹配')
                if not builtin or value['version']>=builtin['version']: return value
            except (OSError,ValueError,UnicodeError): pass
    return builtin or {'year':year,'version':0,'local_revision':0,'origin':'unconfirmed','confirmed':False,'holidays':[],'workdays':[],'source_url':''}


def day_info(value,data=None,cache_dir=None):
    day=_date(value); snapshot=data or get_calendar(day.year,cache_dir)
    if snapshot.get('year')!=day.year or not snapshot.get('version'):
        return {'date':day.isoformat(),'status':'unknown','name':'安排未确认','festival_name':'','label':'','confirmed':False}
    key=day.isoformat(); holiday=next((x for x in snapshot['holidays'] if x['date']==key),None)
    if holiday: status,name,label='holiday',holiday['name'],'休'
    elif key in snapshot['workdays']: status,name,label='workday','调休补班','班'
    elif day.weekday()>=5: status,name,label='weekend','周末',''
    else: status,name,label='workday','',''
    festival_name = next((item['name'] for item in festival_dates(snapshot) if item['date'] == key), '')
    return {'date':key,'status':status,'name':name,'festival_name':festival_name,'label':label,'confirmed':True}


def calculate_deadline(start,days,kind,cutoff='',data=None,cache_dir=None):
    current=_date(start)
    if type(days) is not int or not 1<=days<=365: raise ValueError('期限须为1至365天')
    if kind not in ('calendar','workday'): raise ValueError('期限类型无效')
    if cutoff and (not isinstance(cutoff,str) or not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',cutoff)):
        raise ValueError('截止时分无效')
    count=0
    while count<days:
        current+=timedelta(days=1)
        if kind=='calendar': count+=1; continue
        info=day_info(current,data,cache_dir)
        if not info['confirmed']: raise HolidayDataUnavailable(f'{current.year}年放假调休安排未确认，无法准确计算工作日期限')
        if info['status']=='workday': count+=1
    return current.isoformat()+('T'+cutoff if cutoff else '')


def update_data(cache_dir,year=2026,url=None):
    expected=UPDATE_BASE+str(year)+'.json'
    if url is not None and url!=expected: raise ValueError('只能更新经核验的节假日数据源')
    with urllib.request.urlopen(expected,timeout=10) as response:
        if response.geturl()!=expected: raise ValueError('节假日更新地址发生变化')
        raw=response.read(131073)
    if len(raw)>131072: raise ValueError('节假日更新文件过大')
    data=validate_data(json.loads(raw.decode('utf-8')))
    if data['year']!=year: raise ValueError('更新年度不匹配')
    previous=get_calendar(year,cache_dir)
    if data['version']<previous['version']: raise ValueError('拒绝旧版本节假日数据')
    if data['version']==previous['version'] and previous['version'] and data!=previous:
        raise ValueError('同版本节假日数据不一致')
    folder=Path(cache_dir); folder.mkdir(parents=True,exist_ok=True)
    temp=None
    try:
        with tempfile.NamedTemporaryFile(dir=folder,mode='w',encoding='utf-8',delete=False) as stream:
            temp=stream.name; json.dump(data,stream,ensure_ascii=False,indent=2); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp,folder/f'{year}.json')
    finally:
        if temp: Path(temp).unlink(missing_ok=True)
    return {'year':year,'version':data['version'],'source_url':data['source_url'],
            'sha256':hashlib.sha256(raw).hexdigest(),'changed':data!=previous}
