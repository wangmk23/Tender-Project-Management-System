"""Check the reviewed UI behaviors in a hash-pinned EXE using isolated data."""
from pathlib import Path
import argparse,hashlib,json,os,sys,tempfile,time
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright

COLORS='''el=>{
 const c=document.createElement('canvas');c.width=c.height=1;const ctx=c.getContext('2d',{willReadFrequently:true});
 const rgba=s=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=s;ctx.fillRect(0,0,1,1);let p=Array.from(ctx.getImageData(0,0,1,1).data);return [p[0],p[1],p[2],p[3]/255]};
 const mix=(a,b)=>a.slice(0,3).map((x,i)=>x*a[3]+b[i]*(1-a[3]));let chain=[];for(let e=el;e;e=e.parentElement)chain.unshift(e);
 let bg=[255,255,255];for(const e of chain)bg=mix(rgba(getComputedStyle(e).backgroundColor),bg);
 const fg=mix(rgba(getComputedStyle(el).color),bg);const lum=a=>a.map(x=>x/255).map(x=>x<=.04045?x/12.92:((x+.055)/1.055)**2.4).reduce((s,x,i)=>s+x*[.2126,.7152,.0722][i],0);
 let a=lum(fg),b=lum(bg);return {foreground:fg,background:bg,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),font:getComputedStyle(el).fontSize};
}'''

def verify(candidate,sha,fixtures,output):
 assert hashlib.sha256(candidate.read_bytes()).hexdigest()==sha
 output.mkdir(parents=True,exist_ok=True);checks=[];colors=[];layouts=[];errors=[];shots=[]
 def check(label,ok,detail=None):checks.append(dict(name=label,passed=bool(ok),detail=detail))
 with tempfile.TemporaryDirectory(prefix='pm-ui-review-') as tmp:
  os.environ['PM_TEST_LICENSE_DIR']=str(fixtures)
  client=PackagedClient(candidate,Path(tmp),'review',unused_port())
  try:
   client.start();settings=client.request('GET','/api/settings')
   client.patch_settings({'reminder_enabled':False,'event_reminder_create_enabled':False,'event_reminder_complete_enabled':False,'supplier_shortage_email_enabled':False,
    'reminder_recipient_groups':[dict(id='audit-team',name='项目经办人',enabled=False,recipients=['review@example.test'],event_types=['daily_stage','deposit_refund'],content_fields={'project_name':True,'stage_name':True,'deposit_balance':True})]})
   for i,method in enumerate(['公开招标','竞争性磋商','网上竞价','遴选']):
    p=client.request('POST','/api/projects',dict(number=f'UI-2026-{i+1:03}',name='公共服务中心办公设备与配套信息系统采购及运维服务项目（第二次采购）' if i==0 else f'界面验证模拟采购项目{i}',purchaser='界面审查模拟采购人',method=method,prepare_owner='模拟经办人',budget='638500',year=2026,deposit_required_amount='10000'))
    if i==0:project=p
    detail=client.get_project(p['id'])
    first=detail['stages'][0]
    for item in first.get('checklist',[]):client.request('PUT',f'/api/projects/{p["id"]}/stage-checklist/{item["id"]}',{'completed':True})
    client.request('PUT',f'/api/projects/{p["id"]}/stages/{first["key"]}',{'completed':True,'completed_at':'2026-10-12T09:30'})
    for j,s in enumerate(detail['stages'][1:3]):client.request('PUT',f'/api/projects/{p["id"]}/stages/{s["key"]}',{'planned_at':f'2026-10-{15+j:02}T17:30'})
   pid=project['id']
   reg=client.request('POST',f'/api/projects/{pid}/registrations',dict(company_name='界面审查模拟建设工程咨询有限公司',bidder_type='consortium',registration_method='现场报名/线下报名',consortium_members=[dict(company_name='界面审查模拟建筑设计有限公司',company_address='模拟地址',legal_representative='模拟代表人',bid_manager='模拟联系人',manager_phone='13800000000',manager_email='member@example.test',notes='保留成员草稿')]))
   ledger=client.request('GET',f'/api/projects/{pid}/tender-guarantee');ledger['data']['records']=[dict(registration_id=reg['id'],participation='submitted',validity='valid',reason='',deposit_status='paid',deposit_amount='10000',refunded_amount='0',handling='rule')]
   client.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(revision=ledger['revision'],data=ledger['data']))
   before=client.get_project(pid)
   info=client.request('GET','/api/system-info');version='v'+json.loads((ROOT/'package.json').read_text('utf-8'))['version'];assert info['version']==version,info
   with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    try:
     ctx=browser.new_context(viewport={'width':1366,'height':900},locale='zh-CN',timezone_id='Asia/Shanghai',reduced_motion='reduce');ctx.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
     page.goto(client.base_url,wait_until='networkidle');page.wait_for_selector('.command-metric')
     def shot(label,theme,width):
      page.wait_for_timeout(200);name=f'{label}-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name)
     def contrast(label,locator,minimum=4.5):
      c=locator.evaluate(COLORS);colors.append(dict(name=label,**c));check(label,c['ratio']>=minimum,c)
     for theme in ['default','dark','blue','green']:
      for width in [1366,390]:
       prefix=f'{theme}/{width}'
       page.set_viewport_size({'width':width,'height':900});page.evaluate('(t)=>applyTheme(t)',theme)
       page.evaluate('(pid)=>selectProject(pid)',pid);page.wait_for_function('(pid)=>currentProject?.id===pid',arg=pid);page.evaluate("switchProjectTab('board')");page.wait_for_timeout(220)
       check(prefix+' real native project tabs',page.locator('#projectTabs button[role=tab]').count()==5)
       tab=page.locator('#project-tab-board');tab.focus();tab.press('ArrowRight');check(prefix+' keyboard arrow',page.evaluate('document.activeElement.dataset.tab')=='timeline')
       page.keyboard.press('End');check(prefix+' keyboard End',page.evaluate('document.activeElement.dataset.tab')=='attachments');page.keyboard.press('Home');check(prefix+' keyboard Home',page.evaluate('document.activeElement.dataset.tab')=='board')
       check(prefix+' single stage summary',page.locator('.project-command-summary').count()==1 and page.locator('.current-stage-card').count()==0)
       check(prefix+' batch disclosure initially closed',not page.locator('.board-tools').evaluate('(e)=>e.open'))
       contrast(prefix+' active project tab',page.locator('#projectTabs .tab.active'))
       for i,badge in enumerate(page.locator('#boardContent .timing-badge').all()):contrast(prefix+f' due badge {i}',badge)
       if page.locator('.project-status-pill').count():contrast(prefix+' project status',page.locator('.project-status-pill').first)
       check(prefix+' no static blur',page.locator('.project-topbar').evaluate('(e)=>getComputedStyle(e).backdropFilter')=='none')
       active=page.locator('.board-col[data-board-state=active] .task-open-btn').first
       box=active.bounding_box();layouts.append(dict(case=prefix,current_stage_top=box['y']))
       check(prefix+' primary stage earlier in viewport',box['y']<(476 if width>760 else 756),box)
       check(prefix+' whole page fits',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
       shot('项目工作区',theme,width)
       active.focus();page.keyboard.press('Enter');page.wait_for_selector('#slidePanel.open')
       try:page.wait_for_function('document.getElementById("slidePanel").contains(document.activeElement)',timeout=1500)
       except Exception:pass
       check(prefix+' keyboard stage focus inside',page.locator('#slidePanel').evaluate('(e)=>e.contains(document.activeElement)'))
       page.keyboard.press('Escape');check(prefix+' close restores stage trigger',active.evaluate('(e)=>e===document.activeElement'))
       page.evaluate("openStageSlide('registration_end')");page.wait_for_selector('#slidePanel.open')
       page.get_by_role('button',name='完成时间',exact=True).click();page.wait_for_selector('.pm-datetime-popup')
       check(prefix+' combined date and time',page.locator('.pm-datetime-calendar').is_visible() and page.locator('.pm-datetime-time').is_visible())
       check(prefix+' date popup fits',page.locator('.pm-datetime-popup').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.x>=0&&r.right<=innerWidth+1&&r.y>=0&&r.bottom<=innerHeight+1}'))
       shot('日期时分',theme,width);page.keyboard.press('Escape')
       page.evaluate('(id)=>showRegistrationForm(id)',reg['id']);page.wait_for_selector('#modal.open')
       check(prefix+' registration labelled',page.locator('#registrationForm input,#registrationForm select,#registrationForm textarea').evaluate_all('(es)=>es.filter(e=>e.getClientRects().length&&!e.hidden&&e.type!=="hidden").every(e=>e.labels.length||e.getAttribute("aria-label")||e.getAttribute("aria-labelledby"))'))
       if width==390:
        check(prefix+' close hit target',page.locator('#modal .modal-header .btn-icon').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.width>=44&&r.height>=44}'))
       company=page.locator('#regCompany');company.fill('');page.locator('#modalSaveBtn').click();page.wait_for_selector('#regCompany[aria-invalid=true]')
       check(prefix+' error focus',page.evaluate('document.activeElement.id')=='regCompany')
       check(prefix+' durable inline error',page.locator('#registrationForm .field-error').count()>0 and page.locator('#registrationForm .form-error-summary').count()==1)
       check(prefix+' member draft retained',page.locator('[data-member-field=notes]').input_value()=='保留成员草稿')
       shot('报名字段错误',theme,width);company.fill(reg['company_name']);page.wait_for_function('!document.querySelector("#regCompany[aria-invalid=true]")')
       check(prefix+' correction clears errors',page.locator('#registrationForm .field-error').count()==0)
       page.evaluate('closeModal();closeSlide();switchProjectTab("info")')
       check(prefix+' project info labelled',page.locator('#infoContent input,#infoContent select,#infoContent textarea').evaluate_all('(es)=>es.filter(e=>e.getClientRects().length&&!e.hidden).every(e=>e.labels.length||e.getAttribute("aria-label")||e.getAttribute("aria-labelledby"))'))
       page.evaluate("openStageSlide('deposit_refund')");page.wait_for_selector('.tg-section');page.evaluate('(id)=>showGuaranteeRefundForm(id)',reg['id']);page.wait_for_selector('#modal.open')
       check(prefix+' explicit full refund action',page.locator('#modalSaveBtn').inner_text()=='确认已全额退还')
       check(prefix+' refund modal fits',page.locator('#modal').evaluate('(e)=>e.getBoundingClientRect().right<=innerWidth+1&&e.getBoundingClientRect().left>=0'))
       if width==390:check(prefix+' refund action hit target',page.locator('#modalSaveBtn').evaluate('(e)=>e.getBoundingClientRect().height>=44'))
       shot('确认全额退还',theme,width);page.evaluate('closeModal();closeSlide();switchView("settings")');page.wait_for_function('!!systemSettings');page.evaluate("setSettingsCategory('workflow')");page.wait_for_timeout(200)
       selected_method=page.locator('#catalogManagerHost .procurement-method-select[aria-pressed="true"]')
       selected_method.wait_for(state='visible')
       contrast(prefix+' selected procurement method',selected_method)
       shot('流程设置',theme,width)
       page.evaluate("setSettingsCategory('email');openRecipientGroupDrawer('audit-team')")
       check(prefix+' recipient labels',page.locator('#recipientGroupName,#recipientGroupEmails,#recipientGroupPrefix').evaluate_all('(es)=>es.length===3&&es.every(e=>e.labels.length===1)'))
       check(prefix+' recipient fits',page.locator('.recipient-group-drawer').evaluate('(e)=>e.getBoundingClientRect().right<=innerWidth+1'))
       shot('收件组',theme,width);page.evaluate('closeRecipientGroupDrawer();switchView("chart-board")');page.wait_for_selector('.cb-trend-data summary')
       summary=page.locator('.cb-trend-data summary');summary.focus();page.keyboard.press('Enter');check(prefix+' monthly data keyboard opens',page.locator('.cb-trend-data').evaluate('(e)=>e.open'))
       check(prefix+' six monthly rows',page.locator('.cb-trend-data tbody tr').count()==6)
       check(prefix+' monthly data fits',page.locator('.cb-trend-table-wrap table').evaluate('(e)=>e.getBoundingClientRect().right<=innerWidth+1'))
       shot('趋势与月度数据',theme,width);summary.focus();page.keyboard.press('Space')
       try:page.wait_for_function('!document.querySelector(".cb-trend-data").open',timeout=1500)
       except Exception:pass
       check(prefix+' monthly data keyboard closes',not page.locator('.cb-trend-data').evaluate('(e)=>e.open'))
       login_ctx=browser.new_context(viewport={'width':width,'height':900},locale='zh-CN',reduced_motion='reduce');login_ctx.add_init_script('localStorage.setItem("pm_theme",'+json.dumps(theme)+')');login=login_ctx.new_page();login.goto(client.base_url+'/login',wait_until='networkidle')
       contrast(prefix+' packaged login button',login.locator('.btn-login'));check(prefix+' login explicit labels',login.locator('input[name=username],input[name=password]').evaluate_all('(es)=>es.every(e=>e.labels.length===1)'))
       name=f'登录-{theme}-{width}.png';login.screenshot(path=str(output/name));shots.append(name);login_ctx.close()
     # Small viewport checks include calendar and sidebar overlays.
     page.set_viewport_size({'width':375,'height':667});page.evaluate("switchView('calendar')");page.wait_for_selector('.calendar-grid');check('375 calendar whole page fits',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'));shot('小屏日历','dark',375)
     check('no browser script errors',not errors,errors)
    finally:browser.close()
   after=client.get_project(pid)
   check('viewing and invalid saves preserve stage/result/member/payment data',all(before.get(k)==after.get(k) for k in ['stages','registrations','bid_results','tender_guarantee']))
  finally:client.stop()
 result=dict(version=version,sha256=sha,passed=sum(c['passed'] for c in checks),total=len(checks),failures=[c for c in checks if not c['passed']],checks=checks,colors=colors,layouts=layouts,screenshots=shots,page_errors=errors,real_mail_sent=0,native_desktop_verified=False)
 (output/'UI审查改进成品验证.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8')
 return result

if __name__=='__main__':
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--license-fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
 r=verify(a.candidate.resolve(),a.sha256,a.license_fixtures.resolve(),a.output.resolve());print(json.dumps({k:r[k] for k in ['passed','total','failures','sha256','page_errors']},ensure_ascii=False));sys.exit(bool(r['failures']))
