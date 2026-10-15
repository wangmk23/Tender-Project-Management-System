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
import time
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
RUNTIME_VERSION='v'+json.loads((ROOT/'package.json').read_text('utf-8'))['version']
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


def verify_upfront(client,checks):
    payload=dict(number='UPFRONT-001',name='模拟项目起始金额',method='公开招标',deposit_required_amount='30000')
    before=len(client.request('GET','/api/projects'))
    rejected(client,'POST','/api/projects',dict(payload,deposit_required_amount='1.001'))
    assert len(client.request('GET','/api/projects'))==before
    created=client.request('POST','/api/projects',payload);pid=created['id']
    value=client.request('GET',f'/api/projects/{pid}/tender-guarantee')
    assert value['data']['amounts']==[dict(lot_id=None,amount='30000.00')] and value['items']==[]
    lot=client.request('POST',f'/api/projects/{pid}/lots',dict(lot_number='包1',lot_name='模拟采购包',deposit_required_amount='5000'))
    value=client.request('GET',f'/api/projects/{pid}/tender-guarantee')
    assert next(x['amount'] for x in value['data']['amounts'] if x['lot_id']==lot['id'])=='5000.00'
    excluded=client.request('POST','/api/projects',dict(payload,number='UPFRONT-002',no_deposit=True))
    assert client.request('GET',f'/api/projects/{excluded["id"]}/tender-guarantee')['data'].get('amounts',[])==[]
    checks.append('project and lot document amount saved in initial transaction; invalid amount creates no project; no-deposit creates no payment')


def verify_payment_policy(client,checks):
    p=client.request('POST','/api/projects',dict(name='模拟不足额缴款',number='PAYMENT-V30',method='公开招标',deposit_required_amount='10000'))
    pid=p['id'];r=client.request('POST',f'/api/projects/{pid}/registrations',{'company_name':'模拟不足额供应商'})
    ledger=client.request('GET',f'/api/projects/{pid}/tender-guarantee')
    ledger['data']['records']=[dict(registration_id=r['id'],participation='submitted',validity='valid',reason='',deposit_status='paid',deposit_amount='5000',refunded_amount='0',handling='rule')]
    ledger['data']['confirmed']=True
    saved=client.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(revision=ledger['revision'],data=ledger['data']))
    assert saved['data']['records'][0]['participation']=='absent' and saved['summary']['balance']=='5000.00'
    assert saved['summary']['valid']==0
    rejected(client,'POST',f'/api/projects/{pid}/bid-results',{'winning_supplier':'模拟不足额供应商'})
    checks.append('actual API defaults insufficient payment to absent, retains cash and rejects result selection')


def browser_verify_simplification(page,client,output,checks):
    page.wait_for_function('!window._newProjectCreatePending')
    page.evaluate('closeModal();closeSlide();showNewProjectModal()')
    assert page.locator('#npDepositAmount').get_attribute('type')=='text'
    page.locator('.new-project-options>summary').click();page.locator('label[for="npMultiPack"]').click()
    assert page.locator('#packDepositAmount').get_attribute('type')=='text'
    page.locator('#npDepositAmount').fill('10000');page.locator('#packDepositAmount').fill('3000')
    page.locator('.new-project-guarantee .toggle-row').click()
    assert not page.locator('#npDepositAmount').is_visible() and not page.locator('#packDepositAmount').is_visible()
    page.locator('.new-project-guarantee .toggle-row').click()
    assert page.locator('#npDepositAmount').input_value()=='10000' and page.locator('#packDepositAmount').input_value()=='3000'
    page.screenshot(path=str(output/'手动保证金与分包.png'));page.evaluate('closeModal()')
    checks.append('actual manual inputs hide and restore project and lot amounts without deleting drafts')
    p=client.request('POST','/api/projects',dict(name='模拟无需保证金',number='NO-DEPOSIT-V30',method='公开招标',no_deposit=True))
    client.request('POST',f"/api/projects/{p['id']}/registrations",{'company_name':'模拟免保证金供应商'})
    page.evaluate('(pid)=>selectProject(pid)',p['id']);page.wait_for_function('(pid)=>currentProject?.id===pid',arg=p['id'])
    page.evaluate("openStageSlide('gw-eval')");page.wait_for_selector('.tg-roster-row')
    roster=page.locator('.tg-section').filter(has_text='实际参与与有效投标')
    assert '核对参与' in roster.inner_text()
    assert not any(text in roster.inner_text() for text in ('登记缴款','缴纳情况待确认','保证金金额'))
    page.screenshot(path=str(output/'无需保证金的实际参与.png'))
    checks.append('actual no-deposit stage preserves participation and hides ordinary payment controls')
    page.evaluate("async()=>{closeSlide();switchView('settings');await loadSettingsView({force:true});}")
    page.evaluate('''()=>{isDesktopApp=()=>true;systemSettings.reminder_recipient_groups=[{id:'verification',name:'模拟分组',enabled:true,recipients:['fixture@example.test'],event_types:['daily_stage','deposit_refund','supplier_shortage'],content_fields:{project_name:true,stage_name:true,deposit_balance:true,supplier_count:true}}];document.getElementById('settingsContent').innerHTML=renderReminderSettingsCard(systemSettings);}''')
    assert page.locator('#reminderRecipients,[data-reminder-content],#eventReminderCreateEnabled').count()==0
    for theme in ('default','dark'):
        for width in (1366,390):
            page.set_viewport_size({'width':width,'height':900});page.evaluate('(theme)=>applyTheme(theme)',theme)
            page.evaluate("openRecipientGroupDrawer('verification')")
            assert page.locator('[data-recipient-category]').count()==4
            assert page.locator('[data-recipient-field][value="project_name"]').count()==1
            assert page.locator('.recipient-group-drawer').evaluate('(e)=>e.getBoundingClientRect().right<=innerWidth')
            assert not page.locator('.recipient-group-drawer-body').evaluate('(e)=>e.scrollWidth>e.clientWidth+1')
            page.screenshot(path=str(output/f'邮件分组分类-{theme}-{width}.png'));page.evaluate('closeRecipientGroupDrawer()')
    checks.append('actual mail subscription entry has categorized fields in both themes and narrow/wide views; no mail sent')


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
            requests=[]
            def observe(req):
                if req.method=='GET' and ('/api/projects/'+str(data['pid'])) in req.url:requests.append(req.url)
            page.on('request',observe)
            def delayed(route):time.sleep(.35);route.continue_()
            page.route('**/api/projects/'+str(data['pid']),delayed)
            feedback=page.evaluate('args=>{const t=performance.now();window.pendingGuarantee=openCalendarGuarantee(args[0],args[1],"review");return {milliseconds:performance.now()-t,visible:!!document.querySelector("[data-guarantee-request]")}}',[data['pid'],data['registrations'][2]['id']])
            assert feedback['visible']
            page.wait_for_function("document.getElementById('modalTitle').textContent==='处理保证金复核'")
            page.unroute('**/api/projects/'+str(data['pid']),delayed);page.remove_listener('request',observe)
            assert len([u for u in requests if '/tender-guarantee' in u])==0,requests
            assert len([u for u in requests if u.endswith('/api/projects/'+str(data['pid']))])==1,requests
            (output/'响应测量.json').write_text(json.dumps(dict(feedback=feedback,project_detail_requests=1,duplicate_ledger_requests=0,injected_network_delay_ms=350)),encoding='utf-8')
            page.evaluate("closeModal();switchView('calendar');calendarYear=2026;calendarMonth=10;loadCalendar({force:true})")
            page.wait_for_selector('.calendar-cell.holiday-rest')
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
            assert page.locator('#tgRefundAmount').count()==0
            assert '全额退还' in page.locator('#modal').inner_text()
            page.locator('#modalSaveBtn').click()
            page.wait_for_function("currentProject?.tender_guarantee?.summary?.balance==='250.00'")
            page.evaluate('(id)=>showGuaranteeResumeForm(id)',data['registrations'][2]['id'])
            page.locator('#modalSaveBtn').click()
            page.wait_for_function('(id)=>currentProject.tender_guarantee.data.records.find(r=>r.registration_id===id).review_at===""',arg=data['registrations'][2]['id'])
            remaining=page.evaluate("async()=>{const x=await api('GET','/api/calendar?year=2026&month=10');return x.cells.flatMap(c=>c.events||[])}")
            assert not any(e.get('registration_id')==data['registrations'][2]['id'] and e.get('guarantee_action')=='review' for e in remaining)
            checks.append('calendar review click opens exact supplier with explanation and actions; document amount prefills without payment; full outstanding refund saves without prose and retains prior cash')
            page.evaluate('closeSlide();showNewProjectModal()');page.wait_for_selector('#npDepositAmount')
            assert page.locator('#npDepositAmount').is_visible()
            page.locator('#npName').fill('模拟新建金额');page.locator('#npDepositAmount').fill('12345.67')
            page.locator('.new-project-guarantee .toggle-row').click();assert page.locator('#npDepositAmount').is_disabled()
            page.locator('.new-project-guarantee .toggle-row').click();assert page.locator('#npDepositAmount').is_enabled()
            page.screenshot(path=str(output/'新建项目起始保证金.png'));page.locator('#npCreateBtn').click()
            page.wait_for_function("currentProject?.name==='模拟新建金额' && currentProject.tender_guarantee?.data?.amounts?.[0]?.amount==='12345.67'")
            assert page.evaluate('currentProject.tender_guarantee.items.length')==0
            checks.append('actual new-project form exposes amount immediately; no-deposit disables amount; creation persists amount without supplier cash')
            browser_verify_simplification(page,client,output,checks)
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
            client.start();assert client.request('GET','/api/system-info')['version']==RUNTIME_VERSION
            data=fixture(client,checks);verify_upfront(client,checks);verify_payment_policy(client,checks);browser_verify(client,data,output,checks)
            client.stop();client.start();again=client.get_project(data['pid'])
            assert again['tender_guarantee']['summary']['balance']=='250.00';checks.append('candidate restart retains actual cash, rule and policy data')
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
                checks.append('actual v5.8.26->v5.8.30 upgrade preserves completed project stages/results and does not generate historical cash reminders')
            finally:legacy.stop()
    report.update(passed=True,count=len(checks));(output/'保证金与日历真实成品验证.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8');return report


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate',type=Path,required=True);parser.add_argument('--sha256',required=True)
    parser.add_argument('--license-fixtures',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);parser.add_argument('--old-exe',type=Path)
    args=parser.parse_args();print(json.dumps(verify(args.candidate.resolve(),args.sha256,args.license_fixtures.resolve(),args.output,args.old_exe),ensure_ascii=False))
