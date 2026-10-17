"""Exercise holiday imports and independent deadlines in a hash-pinned, isolated EXE."""
import argparse, hashlib, io, json, os, shutil, subprocess, sys, tempfile, zipfile
from xml.etree import ElementTree as ET
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright

def verify(candidate,sha,fixtures,output,old_exe=None):
 assert hashlib.sha256(candidate.read_bytes()).hexdigest()==sha
 output.mkdir(parents=True,exist_ok=True);checks=[];errors=[];shots=[]
 def check(name,condition):
  checks.append(dict(name=name,passed=bool(condition)))
  assert condition,name
 real_spawn=subprocess.Popen;owned=set()
 def spawn(args,*a,**kw):
  if isinstance(args,(list,tuple)) and str(Path(args[0]).resolve()) in owned:kw['creationflags']=subprocess.CREATE_NO_WINDOW
  return real_spawn(args,*a,**kw)
 with tempfile.TemporaryDirectory(prefix='deadline-v34-') as temp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}),patch.object(subprocess,'Popen',side_effect=spawn):
  client=PackagedClient(candidate,Path(temp),'deadlines',unused_port());owned.add(str(client.executable.resolve()))
  try:
   client.start();check('mail runtime types are exposed',all(t in client.request('GET','/api/settings')['reminder_runtime_status'] for t in ['business_deadline','deadline_review']));check('runtime version',client.request('GET','/api/system-info')['version']=='v'+json.loads((ROOT/'package.json').read_text('utf-8'))['version'])
   client.patch_settings(dict(reminder_enabled=False,reminder_recipient_groups=[],event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False))
   group=dict(id='deadline-preview',name='期限预览',enabled=True,recipients=['preview@example.test'],event_types=['business_deadline','deadline_review'],content_fields=dict.fromkeys(['deadline_title','deadline_at','deadline_status','deadline_basis','review_reason'],True))
   for kind in group['event_types']:
    result=client.patch_settings(dict(reminder_action='preview_group',reminder_recipient_groups=[group],reminder_group_id=group['id'],reminder_event_type=kind,smtp_host='smtp.example.test',smtp_sender='preview@example.test',smtp_username='preview@example.test',smtp_port=465,smtp_security='ssl'))
    check('actual '+kind+' mail preview includes sample without sending','示例质疑答复' in result['preview']['body'] and '示例条款' in result['preview']['body'])
   check('mail preview does not persist recipient group',client.request('GET','/api/settings')['reminder_recipient_groups']==[])
   project=client.create_project('公开招标','期限联动模拟项目');pid=project['id'];stage=project['stages'][0]['key'];original=client.get_project(pid)
   check('existing project starts disabled without backfill',not client.request('GET',f'/api/projects/{pid}/deadline-settings')['enabled'])
   client.request('PUT',f'/api/projects/{pid}/deadline-settings',dict(revision=0,enabled=True,regime='government_procurement',custom_rules=[]))
   rule_catalog=client.request('GET',f'/api/deadline-rules?project_id={pid}')['rules'];check('government cards available',any(r['id']=='gov_announcement' for r in rule_catalog))
   custom=dict(id='custom:manual',name='文件约定办理期限',days=1,day_kind='workday',kind='maximum',include_start=False,end_policy='none',precision='date',basis='模拟采购文件第3页')
   def preview(**kw):
    body=dict(rule_id='custom',custom_rule=custom,stage_key=stage,lot_id=None,source_type='manual',start_at='2026-10-08',title='文件约定办理期限',remind_days=1);body.update(kw)
    return client.request('POST',f'/api/projects/{pid}/deadlines/preview',body)
   proposed=preview();check('preview does not create item',client.request('GET',f'/api/projects/{pid}/deadlines')['items']==[])
   saved=client.request('POST',f'/api/projects/{pid}/deadlines/confirm',dict(token=proposed['token']))['item'];iid=saved['id']
   check('confirmed independent workday deadline',saved['confirmed_deadline']=='2026-10-09')
   check('stage plan unchanged without explicit sync',client.get_project(pid)['stages']==original['stages'])
   response=client.session.get(client.base_url+'/api/holiday-calendar/template?year=2026',timeout=15);check('blank template downloaded',response.status_code==200)
   archive=zipfile.ZipFile(io.BytesIO(response.content));ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'};check('template sheets',[e.attrib['name'] for e in ET.fromstring(archive.read('xl/workbook.xml')).findall('m:sheets/m:sheet',ns)]==['填写说明','放假调休安排'])
   # Round-trip the active schedule and add a synthetic holiday affecting this item.
   exported=client.session.get(client.base_url+'/api/holiday-calendar/export?year=2026',timeout=15);buf=io.BytesIO()
   with zipfile.ZipFile(io.BytesIO(exported.content)) as archive,zipfile.ZipFile(buf,'w',zipfile.ZIP_DEFLATED) as target:
    for entry in archive.infolist():
     raw=archive.read(entry.filename)
     if entry.filename=='xl/worksheets/sheet2.xml':
      root=ET.fromstring(raw);data=root.find('m:sheetData',ns);number=max(int(r.attrib.get('r',0)) for r in data)+1;row=ET.SubElement(data,'{'+ns['m']+'}row',r=str(number))
      for col,value in zip('ABCD',['2026-10-09','','放假','模拟增加假期']):
       cell=ET.SubElement(row,'{'+ns['m']+'}c',r=col+str(number),t='inlineStr');ET.SubElement(ET.SubElement(cell,'{'+ns['m']+'}is'),'{'+ns['m']+'}t').text=value
      raw=ET.tostring(root,encoding='utf-8',xml_declaration=True)
     target.writestr(entry,raw)
   active=client.request('GET','/api/holiday-calendar?year=2026')
   def upload(raw,revision):
    r=client.session.post(client.base_url+'/api/holiday-calendar/import/preview',headers={'X-CSRFToken':client.csrf_token},data=dict(year=2026,base_revision=revision,document='模拟年度通知'),files={'file':('安排.xlsx',raw,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},timeout=30)
    assert r.status_code==200,(r.status_code,r.text);return r.json()
   annual=upload(buf.getvalue(),active['local_revision']);check('annual preview includes affected deadline',any(x.get('deadline_item_id')==iid for x in annual['impacts']['items']))
   check('upload is not activation',client.request('GET','/api/holiday-calendar?year=2026')['local_revision']==active['local_revision'])
   client.request('POST','/api/holiday-calendar/import/commit',dict(token=annual['token'],confirm_complete=True))
   item=client.request('GET',f'/api/projects/{pid}/deadlines?item_id={iid}')['items'][0]
   check('calendar change preserves confirmed date and proposes new date',item['confirmed_deadline']=='2026-10-09' and item['proposed_deadline']=='2026-10-10' and item['needs_review'])
   calendar=client.request('GET','/api/calendar?year=2026&month=10');events=[e for c in calendar['cells'] for e in c.get('events',[])]
   check('calendar direct item points to original confirmed date',any(e.get('deadline_item_id')==iid and e['date_str']=='2026-10-09' for e in events))
   repeat=upload(buf.getvalue(),client.request('GET','/api/holiday-calendar?year=2026')['local_revision'])
   nochange=client.request('POST','/api/holiday-calendar/import/commit',dict(token=repeat['token'],confirm_complete=True));check('identical import is no-op',not nochange['changed'])
   history=client.request('GET','/api/holiday-calendar/history?year=2026');check('baseline available for restore',len(history['items'])>=2)
   restore=client.request('POST','/api/holiday-calendar/restore/preview',dict(year=2026,revision=min(x['revision'] for x in history['items']),base_revision=client.request('GET','/api/holiday-calendar?year=2026')['local_revision']))
   check('restore preview does not activate',client.request('GET','/api/holiday-calendar?year=2026')['local_revision']==client.request('GET','/api/holiday-calendar?year=2026')['local_revision'])
   client.request('POST','/api/holiday-calendar/import/commit',dict(token=restore['token'],confirm_complete=True))
   item=client.request('GET',f'/api/projects/{pid}/deadlines?item_id={iid}')['items'][0]
   client.request('POST',f'/api/projects/{pid}/deadlines/{iid}/review',dict(revision=item['revision'],action='keep',reason='已发送通知，保留原确认期限'))
   # An unresolved statutory interpretation can be saved, but is never silently confirmed.
   client.request('PUT',f'/api/projects/{pid}/deadline-settings',dict(revision=1,enabled=True,regime='bidding',custom_rules=[]))
   pending=preview(rule_id='bid_candidate_period',custom_rule=None,title='候选人公示',start_at='2026-10-17')
   check('unresolved rule flagged',pending['calculation']['requires_review'])
   pending_item=client.request('POST',f'/api/projects/{pid}/deadlines/confirm',dict(token=pending['token']))['item'];check('saved pending without formal date',pending_item['state']=='pending' and not pending_item['confirmed_deadline'])
   with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    try:
     context=browser.new_context(locale='zh-CN',timezone_id='Asia/Shanghai',viewport={'width':1366,'height':900},reduced_motion='reduce');context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
     page.goto(client.base_url,wait_until='networkidle');page.wait_for_function('typeof showBusinessDeadlines === "function"')
     for theme in ['default','dark','blue','green']:
      for width in [1366,390]:
       page.set_viewport_size({'width':width,'height':900});page.evaluate('(t)=>applyTheme(t)',theme)
       page.evaluate('(p)=>showHolidayCalendarSettings(2026)',pid);page.wait_for_selector('#hcFile');check(f'{theme}/{width} annual panel fits',page.locator('#modal .deadline-workspace').evaluate('(e)=>e.getBoundingClientRect().right<=innerWidth+1'))
       check(f'{theme}/{width} upload accessible',page.locator('#hcFile').evaluate('(e)=>e.labels.length===1'))
       name=f'年度模板导入-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name)
       page.evaluate('closeModal()');page.evaluate('(a)=>showBusinessDeadlines(a.pid,"",a.iid)',dict(pid=pid,iid=iid));page.wait_for_selector('#bdItemDetail .deadline-card');check(f'{theme}/{width} detail includes original date','2026-10-09' in page.locator('#bdItemDetail').inner_text())
       page.locator('#bdEdit').click();check(f'{theme}/{width} custom edit hydrated',page.locator('#bdCustomDays').input_value()=='1')
       check(f'{theme}/{width} form contained',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
       page.locator('#bdForm').scroll_into_view_if_needed();name=f'业务期限-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name)
     check('no browser errors',not errors)
    finally:browser.close()
   client.stop();client.start();check('restart preserves confirmed date',client.request('GET',f'/api/projects/{pid}/deadlines?item_id={iid}')['items'][0]['confirmed_deadline']=='2026-10-09')
  finally:client.stop()
  if old_exe:
   legacy=PackagedClient(old_exe,Path(temp),'legacy33',unused_port());owned.add(str(legacy.executable.resolve()))
   try:
    legacy.start();old=legacy.create_project('公开招标','历史项目升级验证');oldpid=old['id'];oldkey=old['stages'][0]['key']
    for item in old['stages'][0].get('checklist',[]):legacy.request('PUT',f'/api/projects/{oldpid}/stage-checklist/{item["id"]}',dict(completed=True))
    legacy.request('PUT',f'/api/projects/{oldpid}/stages/{oldkey}',dict(completed=True,completed_at='2026-10-08T09:00'))
    before=legacy.get_project(oldpid);legacy.stop();shutil.copy2(candidate,legacy.executable);legacy.start();after=legacy.get_project(oldpid)
    check('prior release upgrade preserves historical stages and results',before['stages']==after['stages'] and before['bid_results']==after['bid_results'])
    untouched=legacy.request('GET',f'/api/projects/{oldpid}/deadlines');check('prior release upgrade creates no historical helper or deadline',not untouched['settings']['enabled'] and untouched['items']==[])
   finally:legacy.stop()
 report=dict(version='v'+json.loads((ROOT/'package.json').read_text('utf-8'))['version'],sha256=sha,checks=checks,passed=sum(x['passed'] for x in checks),total=len(checks),page_errors=errors,screenshots=shots,real_mail_sent=0,native_desktop_verified=False)
 (output/'年度导入与业务期限成品验证.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8');return report

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--license-fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--old-exe',type=Path);a=p.parse_args();r=verify(a.candidate.resolve(),a.sha256,a.license_fixtures.resolve(),a.output.resolve(),a.old_exe);print(json.dumps({k:r[k] for k in ['passed','total','page_errors']},ensure_ascii=False))
