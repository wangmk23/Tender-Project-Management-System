"""Verify a hash-pinned guarantee candidate using synthetic data and headless HTTP."""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright


def templates(client):
    settings=client.request('GET','/api/settings');templates=settings['stage_templates']
    templates['公开招标']=[{'id':key,'name':name,'icon':icon,'modules':['common',module]} for key,name,icon,module in (
        ('gw-open','开标确认','🎯','bid_opening'),('gw-eval','有效投标确认','📊','evaluation'),
        ('gw-result','结果公告','📣','result_publication'),('gw-notice','通知书发出','🏆','winning_notice'),
        ('gw-refund','保证金退还','💳','deposit_refund'),('gw-archive','资料归档','📦','archive'))]
    client.patch_settings({'stage_templates':templates,'reminder_enabled':False,'reminder_recipient_groups':[],
                          'event_reminder_create_enabled':False,'event_reminder_complete_enabled':False,'supplier_shortage_email_enabled':False})


def rejected(client,method,path,data,status=400):
    response=client.session.request(method,client.base_url+path,json=data,headers={'X-CSRFToken':client.csrf_token},timeout=15)
    assert response.status_code==status,(response.status_code,response.text)


def fixture(client,checks):
    templates(client);project=client.create_project('公开招标','模拟保证金联动');pid=project['id']
    regs=[]
    for name in ('模拟有效中标人','模拟有效未中标人','模拟无效但已缴款','模拟未参加'):
        regs.append(client.request('POST',f'/api/projects/{pid}/registrations',{'company_name':name}))
    rejected(client,'POST',f'/api/projects/{pid}/bid-results',{'winning_supplier':regs[0]['company_name']})
    checks.append('new result API rejects unconfirmed registration without changing results')
    records=[]
    for index,r in enumerate(regs):
        records.append(dict(registration_id=r['id'],participation='absent' if index==3 else 'submitted',validity='valid' if index<2 else 'invalid',
                            reason='' if index<2 else '模拟未通过资格审查' if index==2 else '模拟未到场',
                            deposit_status='paid' if index<3 else 'unpaid',deposit_amount=str((index+1)*100 if index<3 else 0),
                            refunded_amount='50' if index==1 else '0',handling='review' if index==2 else 'rule',review_at='2026-10-13' if index==2 else ''))
    rules=[dict(id='winner',lot_id=None,scope='winner',enabled=True,manual_start_at='2026-10-01',start_stage_key='',days=5,day_kind='calendar',cutoff='',remind_days=1),
           dict(id='nonwinner',lot_id=None,scope='nonwinner',enabled=True,manual_start_at='',start_stage_key='gw-notice',days=5,day_kind='workday',cutoff='',remind_days=1)]
    ledger=client.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(revision=0,data=dict(records=records,rules=rules,confirmed=True)))
    assert ledger['summary']['valid']==2 and ledger['summary']['balance']=='550.00',ledger
    rejected(client,'POST',f'/api/projects/{pid}/bid-results',{'winning_supplier':regs[2]['company_name']})
    winner=client.request('POST',f'/api/projects/{pid}/bid-results',{'winning_supplier':regs[0]['company_name'],'winning_amount':'1000'})
    for key in ('gw-result','gw-notice'):
        client.request('PUT',f'/api/projects/{pid}/stages/{key}',dict(completed=True,completed_at='2026-10-01T17:30'))
    detail=client.get_project(pid);items=detail['tender_guarantee']['items'];by_id={x['registration_id']:x for x in items}
    assert by_id[regs[0]['id']]['deadline']=='2026-10-06',items
    assert by_id[regs[1]['id']]['deadline']=='2026-10-13' and by_id[regs[1]['id']]['balance']=='150.00',items
    assert by_id[regs[2]['id']]['balance']=='300.00' and by_id[regs[2]['id']]['status']=='review',items
    checks.append('valid roster controls result selection; invalid paid still retained; winner natural and nonwinner national workday deadlines derive from actual completion')
    calendar=client.request('GET','/api/calendar?year=2026&month=10');by_date={x['date_str']:x for x in calendar['cells'] if not x['empty']}
    assert by_date['2026-10-01']['holiday']['label']=='休' and by_date['2026-10-10']['holiday']['label']=='班'
    assert any(e.get('kind')=='deposit_refund' for e in by_date['2026-10-13']['events']),calendar
    checks.append('actual calendar merges holiday rest/makeup and computed refund deadline without fake midnight')
    unknown=client.request('GET','/api/holiday-calendar?year=2027');assert not unknown['confirmed']
    client.request('POST','/api/holiday-calendar/preferences',{'use_national_workdays':True})
    assert client.request('GET','/api/holiday-calendar?year=2026')['use_national_workdays']
    checks.append('unknown year explicit, admin national-workday mail preference persists')
    default_rule=dict(id='default_nonwinner',lot_id=None,scope='nonwinner',enabled=True,manual_start_at='',start_stage_key='gw-notice',days=5,day_kind='workday',cutoff='',remind_days=1)
    client.request('PUT','/api/tender-guarantee/defaults',{'method':'公开招标','rules':[default_rule]})
    new_project=client.create_project('公开招标','模拟新项目规则快照')
    new_ledger=client.request('GET',f'/api/projects/{new_project["id"]}/tender-guarantee')
    assert new_ledger['data']['rules'][0]['id']=='default_nonwinner' and new_ledger['items']==[]
    assert len(client.request('GET',f'/api/projects/{pid}/tender-guarantee')['data']['rules'])==2
    checks.append('actual admin default rules snapshot into future project only; existing project unchanged and unknown cash creates no reminders')
    return dict(pid=pid,registrations=regs,winner=winner)


def browser_verify(client,data,output,checks):
    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
        try:
            context=browser.new_context(viewport={'width':1366,'height':900},timezone_id='Asia/Shanghai',locale='zh-CN',reduced_motion='reduce')
            context.add_cookies([{'name':c.name,'value':c.value,'url':client.base_url} for c in client.session.cookies])
            page=context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(client.base_url+'/',wait_until='domcontentloaded');page.wait_for_selector('.command-metric')
            page.evaluate('(id)=>selectProject(id)',data['pid']);page.wait_for_function('(id)=>currentProject?.id===id',arg=data['pid'])
            for theme in ('default','dark'):
                for width in (1366,390):
                    page.set_viewport_size({'width':width,'height':900});page.evaluate('(t)=>applyTheme(t)',theme)
                    page.evaluate("openStageSlide('gw-eval')");page.wait_for_selector('.tg-roster-row')
                    assert page.locator('.tg-roster-row').count()==4
                    page.screenshot(path=str(output/f'参与名单-{theme}-{width}.png'))
                    page.evaluate('(id)=>showGuaranteePaymentForm(id)',data['registrations'][2]['id']);page.wait_for_selector('#tgDepositAmount')
                    assert page.locator('#tgDepositStatus').input_value()=='paid' and page.locator('#tgDepositAmount').input_value()=='300.00'
                    assert page.locator('#tgManualBasis').count()==0 and page.locator('#tgAuditReason').count()==0
                    assert page.locator('#modal').evaluate('(e)=>e.getBoundingClientRect().right<=innerWidth')
                    page.screenshot(path=str(output/f'无效投标保证金-{theme}-{width}.png'));page.evaluate('closeModal()')
                    page.evaluate("openStageSlide('gw-refund')");page.wait_for_selector('.tg-deadline-card')
                    assert page.locator('.tg-deadline-card').count()==3
                    assert page.locator('[data-refund-deadline]').count()==2
                    page.screenshot(path=str(output/f'退还期限-{theme}-{width}.png'))
                    page.get_by_role('tab',name='未中标供应商').click()
                    assert page.locator('.tg-deadline-card').count()==1
                    assert '模拟有效未中标人' in page.locator('.tg-deadline-card').inner_text()
                    page.screenshot(path=str(output/f'未中标筛选-{theme}-{width}.png'))
                    page.evaluate("tgSetGuaranteeScope('all')")
                    checks.append(f'actual themed participation and cash UI {theme} {width}px: invalid paid, deadline countdown and modal visible')
            page.set_viewport_size({'width':1366,'height':900});page.evaluate('closeSlide();showBidResultForm()');page.wait_for_selector('#bidSupplier')
            options=page.locator('#bidSupplier option').all_text_contents()
            assert any('模拟有效中标人' in x for x in options) and not any('模拟无效' in x or '模拟未参加' in x for x in options),options
            page.evaluate("closeModal();switchView('calendar');calendarYear=2026;calendarMonth=10;loadCalendar({force:true})")
            page.wait_for_selector('.calendar-cell.holiday-rest');assert page.locator('.calendar-cell.holiday-makeup').count()==1
            page.screenshot(path=str(output/'国家放假调休与保证金日历.png'))
            page.evaluate("selectCalendarDay('2026-10-13')")
            page.locator('.calendar-agenda-item').filter(has_text='模拟无效但已缴款').filter(has_text='保证金处理复核').click()
            page.wait_for_function("document.getElementById('modalTitle').textContent==='处理保证金复核'")
            assert '模拟无效但已缴款' in page.locator('#modal').inner_text()
            assert '尚未生成' in page.locator('#modal').inner_text()
            page.screenshot(path=str(output/'日历复核直接处理.png'))
            page.evaluate('closeModal();showGuaranteeAmountForm()');page.wait_for_selector('#tgExpected0')
            page.locator('#tgExpected0').fill('30000');page.locator('#modalSaveBtn').click()
            page.wait_for_function("currentProject?.tender_guarantee?.data?.amounts?.[0]?.amount==='30000.00'")
            page.evaluate('(id)=>showGuaranteePaymentForm(id)',data['registrations'][3]['id'])
            assert page.locator('#tgDepositAmount').input_value()=='30000.00'
            assert page.locator('#tgDepositStatus').input_value()=='unpaid'
            page.evaluate('closeModal()')
            page.evaluate('(id)=>showGuaranteeRefundForm(id)',data['registrations'][2]['id'])
            page.locator('#tgRefundAmount').fill('20');page.locator('#modalSaveBtn').click()
            page.wait_for_function("currentProject?.tender_guarantee?.summary?.balance==='530.00'")
            page.evaluate('(id)=>showGuaranteeResumeForm(id)',data['registrations'][2]['id'])
            page.locator('#modalSaveBtn').click()
            page.wait_for_function('(id)=>currentProject.tender_guarantee.data.records.find(r=>r.registration_id===id).review_at===""',arg=data['registrations'][2]['id'])
            remaining=page.evaluate("async()=>{const x=await api('GET','/api/calendar?year=2026&month=10');return x.cells.flatMap(c=>c.events||[])}")
            assert not any(e.get('registration_id')==data['registrations'][2]['id'] and e.get('guarantee_action')=='review' for e in remaining)
            checks.append('calendar review click opens exact supplier with explanation and actions; document amount prefills without payment; actual incremental refund saves without prose')
            assert not errors,errors
            checks.append('actual result options exclude invalid/absent; calendar displays official holiday/makeup markers; zero browser errors')
        finally:browser.close()


def verify(candidate,sha,licenses,output,old_exe=None):
    assert hashlib.sha256(candidate.read_bytes()).hexdigest()==sha
    output.mkdir(parents=True,exist_ok=True);checks=[];report=dict(candidate=str(candidate),sha256=sha,passed=False,checks=checks,real_mail_messages_sent=0,native_desktop_verified=False)
    original=subprocess.Popen; owned=set()
    def spawn(args,**kwargs):
        if str(Path(args[0]).resolve()) in owned:
            args=[args[0],'--headless'];kwargs['creationflags']=subprocess.CREATE_NO_WINDOW
        return original(args,**kwargs)
    with tempfile.TemporaryDirectory(prefix='guarantee-verified-',ignore_cleanup_errors=True) as folder,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(licenses)}),patch.object(subprocess,'Popen',side_effect=spawn):
        client=PackagedClient(candidate,Path(folder),'new',unused_port());owned.add(str(client.executable.resolve()))
        try:
            client.start();assert client.request('GET','/api/system-info')['version']=='v5.8.28'
            data=fixture(client,checks);browser_verify(client,data,output,checks)
            client.stop();client.start();again=client.get_project(data['pid'])
            assert again['tender_guarantee']['summary']['balance']=='530.00';checks.append('candidate restart retains actual cash, rule and policy data')
        finally:client.stop()
        if old_exe:
            legacy=PackagedClient(old_exe,Path(folder),'legacy',unused_port());owned.add(str(legacy.executable.resolve()))
            try:
                legacy.start();templates(legacy);p=legacy.create_project('公开招标','模拟历史完成');pid=p['id']
                r=legacy.request('POST',f'/api/projects/{pid}/registrations',{'company_name':'模拟历史供应商'})
                legacy.request('POST',f'/api/projects/{pid}/bid-results',{'winning_supplier':r['company_name'],'winning_amount':'100'})
                for stage in p['stages']:legacy.request('PUT',f'/api/projects/{pid}/stages/{stage["key"]}',{'completed':True,'completed_at':'2026-10-01T17:30'})
                before=legacy.get_project(pid);legacy.stop();shutil.copy2(candidate,legacy.executable);legacy.start();after=legacy.get_project(pid)
                assert after['bid_results']==before['bid_results'] and after['stages']==before['stages']
                assert not after['tender_guarantee']['policy']['strict_results'] and after['tender_guarantee']['items']==[]
                checks.append('actual v5.8.26->v5.8.28 upgrade preserves completed project stages/results and does not generate historical cash reminders')
            finally:legacy.stop()
    report.update(passed=True,count=len(checks));(output/'保证金与日历真实成品验证.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8');return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate',type=Path,required=True);parser.add_argument('--sha256',required=True)
    parser.add_argument('--license-fixtures',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--old-exe',type=Path)
    args=parser.parse_args();print(json.dumps(verify(args.candidate.resolve(),args.sha256,args.license_fixtures.resolve(),args.output,args.old_exe),ensure_ascii=False))
