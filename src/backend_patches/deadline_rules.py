"""deadline-rules-v1: controlled reference cards and explainable calculations.

Reference dates and interpretation are deliberately distinct from confirmed business
deadlines. National schedule rest days do not prove statutory public holidays.
"""
from __future__ import annotations
import copy
import hashlib
import json
import re
from datetime import date, datetime, timedelta, timezone

if __package__:
    from . import holiday_calendar as hc
else:
    import holiday_calendar as hc

SHANGHAI = timezone(timedelta(hours=8))
REGIMES = ('government_procurement', 'bidding', 'enterprise', 'custom')
ALIASES = {'政府采购货物服务':'government_procurement','招标投标规则':'bidding','企业自主采购':'enterprise','自定义':'custom'}
S1='https://www.mof.gov.cn/gp/xxgkml/tfs/201707/t20170718_2652766.htm'
S2='https://www.mof.gov.cn/gp/xxgkml/tfs/201801/t20180102_2791702.htm'
S3='https://www.ndrc.gov.cn/xxgk/zcfb/qt/201511/t20151103_967423.html'
S4='https://fgw.sh.gov.cn/ys-zfcg-1.3.4.2/20240325/41c1ca257ef74dbea98f012dd6ec2007.html'


def _card(key, name, regime, methods, days, kind, basis, url, **more):
    return dict(id=key, name=name, version=1, regimes=[regime], methods=methods,
                days=days, kind=kind, relation='at_least' if kind in ('minimum','interval') else 'at_most',
                day_kind='workday', include_start=False, direction='backward' if kind=='interval' else 'forward',
                end_policy='none', precision='date', basis=basis, source_url=url,
                source_checked_at='2026-10-17', reminders={'days_before':1}, **more)


_TENDER=['公开招标','邀请招标']
CARDS=[
    _card('gov_announcement','招标/资格预审公告期','government_procurement',_TENDER,5,'minimum','财政部令第87号第16、85条',S1),
    _card('gov_file_provision','招标文件提供期','government_procurement',_TENDER,5,'minimum','财政部令第87号第18、85条',S1),
    _card('gov_result_publish','结果公告最迟发布','government_procurement',_TENDER,2,'maximum','财政部令第87号第69、85条',S1),
    _card('gov_result_period','结果公告期','government_procurement',_TENDER,1,'minimum','财政部令第87号第69、85条',S1),
    _card('gov_nonbid_announcement','非招标公告期','government_procurement',['竞争性谈判','竞争性磋商'],3,'minimum','财库〔2015〕135号第二部分第四项第2点',S4),
    _card('gov_question_reply','质疑答复','government_procurement',[],7,'maximum','财政部令第94号第13条',S2),
    _card('gov_clarification_notice','澄清后准备时间校验','government_procurement',_TENDER,15,'interval','财政部令第87号第27、85条',S1),
    _card('bid_candidate_period','中标候选人公示','bidding',_TENDER,3,'minimum','招标投标法实施条例第54条（依法必须招标）',S3),
    _card('bid_document_objection_reply','招标文件/资格预审文件异议答复','bidding',_TENDER,3,'maximum','招标投标法实施条例第22条',S3),
    _card('bid_result_objection_reply','评标结果异议答复','bidding',_TENDER,3,'maximum','招标投标法实施条例第54条（依法必须招标）',S3),
]
for _r in CARDS:
    _r['allowed_sources']=['manual']
    _r['actual_event']={
        'gov_announcement':'公告实际发布', 'gov_file_provision':'文件实际开始提供',
        'gov_result_publish':'采购人实际确定结果', 'gov_result_period':'结果公告实际发布',
        'gov_nonbid_announcement':'采购公告实际发布','gov_question_reply':'实际收到质疑函',
        'gov_clarification_notice':'实际书面通知与提交文件截止',
        'bid_candidate_period':'候选人公示实际发布','bid_document_objection_reply':'实际收到文件异议',
        'bid_result_objection_reply':'实际收到评标结果异议'}[_r['id']]
    if _r['id']=='gov_question_reply':_r['allowed_sources'].append('complaint')
    if _r['id']=='gov_clarification_notice':_r['allowed_sources'].append('clarification_notification')
    if _r['id']=='gov_clarification_notice':
        _r.update(day_kind='calendar',end_policy='statutory_unverified',precision='minute',requires_two_events=True)
    elif _r['regimes']==['bidding']:
        _r.update(day_kind='calendar',end_policy='unverified',interpretation_review=True)


def catalog(regime, method):
    """Never infer a legal regime from purchaser, method or project name."""
    regime=ALIASES.get(regime,regime)
    return copy.deepcopy([r for r in CARDS if regime in r['regimes'] and (not r['methods'] or method in r['methods'])])


def parse_at(value):
    if isinstance(value, datetime): dt=value
    elif isinstance(value, date): return value, False
    elif isinstance(value,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}',value): return date.fromisoformat(value),False
    elif isinstance(value,str) and re.fullmatch(r'\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?',value):
        dt=datetime.fromisoformat(value.replace('Z','+00:00'))
    else: raise ValueError('请填写实际发生日期或时间（YYYY-MM-DD或YYYY-MM-DDTHH:MM）')
    if dt.tzinfo: dt=dt.astimezone(SHANGHAI).replace(tzinfo=None)
    return dt,True


def normalized_at(value):
    dt,minute=parse_at(value)
    return dt.isoformat(timespec='minutes') if minute else dt.isoformat()


def validate_custom(rule):
    """Allow business parameters, never executable expressions or statutory impersonation."""
    if not isinstance(rule,dict): raise ValueError('自定义规则格式错误')
    allowed={'id','name','days','day_kind','kind','include_start','end_policy','precision','basis','source_url','cutoff','remind_days','version'}
    # Permit round-tripping our own output; derived metadata is always rebuilt.
    if set(rule)-allowed-{'custom','regimes','direction'}: raise ValueError('自定义规则包含不支持的字段')
    result={k:copy.deepcopy(v) for k,v in rule.items() if k in allowed}
    if not isinstance(result.get('day_kind'),str):raise ValueError('期限计数类型无效')
    result['day_kind']={'workdays':'workday','calendar_days':'calendar'}.get(result.get('day_kind'),result.get('day_kind'))
    result.setdefault('kind','maximum');result.setdefault('include_start',False)
    result.setdefault('end_policy','none');result.setdefault('precision','date')
    if type(result.get('days')) is not int or not 1<=result['days']<=365: raise ValueError('期限须为1至365天')
    if result.get('day_kind') not in ('calendar','workday'): raise ValueError('期限计数类型无效')
    if result.get('kind') not in ('minimum','maximum','interval'): raise ValueError('期限关系无效')
    if type(result.get('include_start',False)) is not bool: raise ValueError('起算日设置无效')
    if result.get('end_policy','none') not in ('none','next_workday','unverified'): raise ValueError('末日处理设置无效')
    if result.get('precision','date') not in ('date','minute'): raise ValueError('日期精度无效')
    for key,size in (('name',80),('basis',500)):
        if not isinstance(result.get(key),str) or not 1<=len(result[key].strip())<=size: raise ValueError('请填写自定义名称及制度/文件依据')
    key=str(result.get('id','custom:manual'))
    if not key.startswith('custom:') or len(key)>100: raise ValueError('自定义规则标识无效')
    result['id']=key
    cutoff=result.get('cutoff','')
    if not isinstance(cutoff,str) or cutoff and not re.fullmatch(r'(?:[01]\d|2[0-3]):[0-5]\d',cutoff): raise ValueError('截止时分无效')
    if type(result.get('version',1)) is not int or not 1<=result.get('version',1)<=100000:raise ValueError('自定义规则版本无效')
    if result.get('source_url'):
        from urllib.parse import urlsplit
        if not isinstance(result['source_url'],str) or len(result['source_url'])>2000:raise ValueError('来源链接无效')
        link=urlsplit(result['source_url'])
        if link.scheme not in ('http','https') or not link.hostname or link.username: raise ValueError('来源链接须为HTTP(S)')
    result.update(version=result.get('version',1),custom=True,regimes=['enterprise','custom'],direction='backward' if result['kind']=='interval' else 'forward')
    return result


def _revision(snapshot):
    return snapshot.get('local_revision') or snapshot.get('revision') or snapshot.get('version',0)


def calculate(rule,start_at,*,end_at='',cache_dir=None):
    """Compute a suggestion; interval cards validate two facts looking backwards.

    ``cache_dir`` may also be an overlay {year: snapshot}, used only for impact
    previews without activating or writing any calendar revision.
    """
    result=dict(deadline='',raw_deadline='',dependencies=[],steps=[],warnings=[],requires_review=False,valid=False,
                missing_years=[],basis=rule.get('basis',''),source_url=rule.get('source_url',''))
    calendars={}
    def snapshot(day):
        if day.year not in calendars:
            value=cache_dir.get(day.year) if isinstance(cache_dir,dict) else None
            if value is None:
                base=cache_dir.get('_cache_dir') if isinstance(cache_dir,dict) else cache_dir
                value=hc.get_calendar(day.year,base)
                if isinstance(cache_dir,dict):cache_dir[day.year]=value
            calendars[day.year]=value
        data=calendars[day.year]
        if not data.get('version') or data.get('confirmed') is False:
            if day.year not in result['missing_years']:result['missing_years'].append(day.year)
            raise hc.HolidayDataUnavailable(f'{day.year}年放假调休安排未确认')
        return data
    def working(day):
        data=snapshot(day)
        return hc.day_info(day,data)['status']=='workday'
    try:
        start,has_time=parse_at(start_at)
        if not 2000<=start.year<=2100: raise ValueError('实际发生年度须在2000至2100之间')
        days=rule.get('days')
        if type(days) is not int or not 1<=days<=365:raise ValueError('期限天数无效')
        if rule.get('day_kind') not in ('calendar','workday'):raise ValueError('期限计数类型无效')
        current=start.date() if has_time else start
        if rule.get('kind')=='interval':
            if not end_at:raise ValueError('须同时填写实际通知时间与提交文件截止时间，公告时间不能代替实际通知')
            end,end_time=parse_at(end_at)
            if not (has_time and end_time):
                result['warnings'].append('最小间隔须核对两个事件的实际时分；仅有日期不能确认满足最低间隔')
                result['requires_review']=True
            end_date=end.date() if end_time else end
            current=end_date
            count=0
            while count<days:
                current-=timedelta(days=1)
                included=rule['day_kind']=='calendar' or working(current)
                count+=int(included)
                result['steps'].append(dict(date=current.isoformat(),counted=included,count=count,direction='backward'))
            if has_time and end_time:
                latest=datetime.combine(current,end.time())
                result['interval_satisfied']=start<=latest
                result['deadline']=latest.isoformat(timespec='minutes')
            else:
                result['interval_satisfied']=None
                result['deadline']=current.isoformat()
            result['raw_deadline']=result['deadline']
            if result['interval_satisfied'] is False:
                result['warnings'].append('实际通知与提交截止不足规定间隔，应核对并顺延提交截止')
                result['requires_review']=True
        else:
            count=0
            if not rule.get('include_start',False):current+=timedelta(days=1)
            while count<days:
                included=rule['day_kind']=='calendar' or working(current)
                count+=int(included)
                result['steps'].append(dict(date=current.isoformat(),counted=included,count=count))
                if count<days:current+=timedelta(days=1)
            def formatted(day):
                if rule.get('precision','date')=='date':return day.isoformat()
                cutoff=rule.get('cutoff','')
                if cutoff:return day.isoformat()+'T'+cutoff
                if has_time:return datetime.combine(day,start.time()).isoformat(timespec='minutes')
                result['requires_review']=True
                result['warnings'].append('请核对期限所需的实际时分')
                return day.isoformat()
            result['raw_deadline']=formatted(current)
            if rule.get('end_policy')=='next_workday':
                while not working(current):current+=timedelta(days=1)
            result['deadline']=formatted(current)
        policy=rule.get('end_policy','none')
        if policy in ('statutory_unverified','unverified') or rule.get('interpretation_review'):
            result['requires_review']=True
            result['warnings'].append('起算/末日处理规则待核对；年度放假调休状态不能证明国家法定节假日，不自动顺延')
        result['valid']=True
    except (ValueError,TypeError,OverflowError,hc.HolidayDataUnavailable) as error:
        result['warnings'].append(str(error));result['requires_review']=True
    result['dependencies']=[dict(year=year,revision=_revision(value),content_hash=value.get('content_hash') or hashlib.sha256(json.dumps({k:value.get(k) for k in ('year','holidays','workdays')},sort_keys=True,ensure_ascii=False).encode()).hexdigest()) for year,value in sorted(calendars.items())]
    return result
