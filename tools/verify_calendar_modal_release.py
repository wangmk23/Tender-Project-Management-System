"""Verify actual calendar modal clicks, configured-folder saves and browser downloads."""
import argparse,hashlib,io,json,os,subprocess,sys,tempfile,zipfile
from pathlib import Path
from unittest.mock import patch
from xml.etree import ElementTree as ET
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright
from src.backend_patches.holiday_import import parse_xlsx

def filled_template(raw):
 ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';output=io.BytesIO()
 with zipfile.ZipFile(io.BytesIO(raw)) as source,zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as target:
  for entry in source.infolist():
   body=source.read(entry.filename)
   if entry.filename=='xl/worksheets/sheet2.xml':
    root=ET.fromstring(body);data=root.find('{'+ns+'}sheetData')
    for row in list(data)[1:]:data.remove(row)
    for number,values in enumerate([['2027-01-01','2027-01-03','放假','模拟元旦'],['2027-01-09','','补班','模拟补班']],2):
     row=ET.SubElement(data,'{'+ns+'}row',r=str(number))
     for column,value in zip('ABCD',values):
      cell=ET.SubElement(row,'{'+ns+'}c',r=column+str(number),t='inlineStr');ET.SubElement(ET.SubElement(cell,'{'+ns+'}is'),'{'+ns+'}t').text=value
    body=ET.tostring(root,encoding='utf-8',xml_declaration=True)
   target.writestr(entry,body)
 return output.getvalue()

def verify(candidate,sha,fixtures,output,filled_workbook=None):
 assert hashlib.sha256(candidate.read_bytes()).hexdigest()==sha
 output.mkdir(parents=True,exist_ok=True);checks=[];errors=[];shots=[]
 def check(name,ok):
  checks.append(dict(name=name,passed=bool(ok)));assert ok,name
 with tempfile.TemporaryDirectory(prefix='calendar-modal-') as tmp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
  root=Path(tmp);client=PackagedClient(candidate,root,'modal',unused_port())
  try:
   client.start();folder=root/'用户指定文件夹';client.patch_settings(dict(export_folder=str(folder),reminder_enabled=False,reminder_recipient_groups=[],event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False))
   pid=client.create_project('公开招标','日历弹窗与下载验证')['id']
   with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
    try:
     context=browser.new_context(locale='zh-CN',timezone_id='Asia/Shanghai',viewport={'width':1366,'height':900},accept_downloads=True,reduced_motion='reduce');context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
     page.goto(client.base_url,wait_until='networkidle');page.wait_for_function('typeof showHolidayCalendarSettings==="function"')
     check('real packaged loopback uses desktop branch',page.evaluate('isDesktopApp()'))
     page.evaluate('showHolidayCalendarSettings(2027)');page.wait_for_selector('#modal.open #hcFile')
     check('calendar opens shared centered modal',page.locator('#modal.open .deadline-workspace').count()==1)
     check('opening calendar does not open drawer',page.locator('#slidePanel.open').count()==0)
     page.locator('#hcTemplate').click();page.wait_for_function('document.querySelector("#hcFeedback").textContent.startsWith("已保存：")')
     files=list(folder.glob('2027年放假调休安排模板*.xlsx'));check('client click saves in configured folder',len(files)==1);raw=files[0].read_bytes();initial_hash=hashlib.sha256(raw).hexdigest()
     (output/'2027年放假调休安排模板.xlsx').write_bytes(raw)
     check('client feedback includes actual folder',str(folder) in page.locator('#hcFeedback').inner_text())
     page.locator('#hcTemplate').click();page.wait_for_function('!document.querySelector("#hcTemplate").disabled');check('repeat click reserves new filename',len(list(folder.glob('2027年放假调休安排模板*.xlsx')))==2);check('first template unchanged',hashlib.sha256(files[0].read_bytes()).hexdigest()==initial_hash)
     page.evaluate('window.__actualDesktopCheck=isDesktopApp;window.isDesktopApp=()=>false')
     count=len(list(folder.iterdir()))
     with page.expect_download() as result:page.locator('#hcTemplate').click()
     download=result.value;check('browser keeps Chinese template filename',download.suggested_filename=='2027年放假调休安排模板.xlsx');download.save_as(root/'浏览器模板.xlsx');check('browser does not write host configured folder',len(list(folder.iterdir()))==count);check('browser workbook valid',zipfile.is_zipfile(root/'浏览器模板.xlsx'))
     # UI-only context switch exercises the remote-browser branch against the same real server.
     filled=root/'已填写完整年度.xlsx';filled.write_bytes(filled_workbook.read_bytes() if filled_workbook else filled_template(raw));page.locator('#hcFile').set_input_files(filled);page.locator('#hcDocument').fill('模拟完整年度安排');page.locator('#hcPreviewButton').click();page.wait_for_selector('#hcComplete')
     check('upload preview leaves active calendar unchanged',not client.request('GET','/api/holiday-calendar?year=2027')['confirmed'])
     check('preview shows complete-arrangement consent',page.locator('#hcComplete').count()==1)
     page.locator('#hcComplete').check();page.locator('#hcCommit').click();page.wait_for_function('document.querySelector("#hcFeedback")?.textContent.includes("年度安排已更新")')
     active=client.request('GET','/api/holiday-calendar?year=2027');check('UI confirmation activates expected dates',len(active['holidays'])==3 and active['workdays']==['2027-01-09'])
     with page.expect_download() as result:page.locator('#hcExport').click()
     exported=result.value;exported.save_as(root/'浏览器导出.xlsx');snapshot=parse_xlsx((root/'浏览器导出.xlsx').read_bytes(),2027);check('browser export roundtrips imported schedule',len(snapshot['holidays'])==3 and snapshot['workdays']==['2027-01-09'])
     page.evaluate('window.isDesktopApp=window.__actualDesktopCheck');page.locator('#hcExport').click();page.wait_for_function('document.querySelector("#hcFeedback").textContent.startsWith("已保存：")');check('client export saves actual imported schedule',len(parse_xlsx((folder/'2027年放假调休安排.xlsx').read_bytes(),2027)['holidays'])==3)
     for theme in ['default','dark','blue','green']:
      for width in [1366,390]:
       page.evaluate('(t)=>applyTheme(t)',theme);page.set_viewport_size({'width':width,'height':900});page.evaluate('closeModal();showHolidayCalendarSettings(2027)');page.wait_for_selector('#hcFile')
       prefix=f'{theme}/{width}';check(prefix+' modal fits',page.locator('#modal').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}'));check(prefix+' body scrolls within dialog',page.locator('#modalBody').evaluate('(e)=>getComputedStyle(e).overflowY==="auto"'))
       check(prefix+' close remains visible',page.locator('#hcClose').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight}'))
       name=f'日历安排弹窗-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name)
       page.keyboard.press('Escape');check(prefix+' Escape closes modal',page.locator('#modal.open').count()==0)
     page.set_viewport_size({'width':1366,'height':900});page.evaluate('(pid)=>selectProject(pid)',pid);page.wait_for_function('!!currentProject?.stages?.length');key=page.evaluate('currentProject.stages[0].key');page.evaluate('(key)=>openStageSlide(key)',key);page.wait_for_selector('#slidePanel.open .stage-editor');page.locator('#slideBody').evaluate('(e)=>{const input=document.createElement("input");input.id="calendarReturnDraft";input.value="未保存阶段草稿";e.append(input);input.focus()}');page.evaluate('showHolidayCalendarSettings(2027)');page.wait_for_selector('#hcFile');page.locator('#hcClose').click();check('underlying unsaved stage draft and drawer preserved',page.locator('#calendarReturnDraft').input_value()=='未保存阶段草稿' and page.locator('#slidePanel.open').count()==1)
     check('no browser script errors',not errors)
    finally:browser.close()
   client.stop();client.start();check('import survives EXE restart',client.request('GET','/api/holiday-calendar?year=2027')['workdays']==['2027-01-09'])
  finally:client.stop()
 result=dict(version='v'+json.loads((ROOT/'package.json').read_text('utf-8'))['version'],sha256=sha,passed=len(checks),checks=checks,screenshots=shots,page_errors=errors,native_webview_manually_verified=False,browser_mode='browser branch explicitly selected in headless Chromium',real_mail_sent=0,production_data_modified=False)
 (output/'弹窗与模板下载导入成品验证.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),'utf-8');return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--license-fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--filled-workbook',type=Path);a=p.parse_args();r=verify(a.candidate.resolve(),a.sha256,a.license_fixtures.resolve(),a.output.resolve(),a.filled_workbook);print(json.dumps({k:r[k] for k in ['version','passed','page_errors']},ensure_ascii=False))
