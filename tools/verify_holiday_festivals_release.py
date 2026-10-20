"""Verify festival labels and Excel import/export against an isolated real EXE."""
from __future__ import annotations
import argparse, hashlib, json, os, sys, tempfile
from pathlib import Path
from unittest.mock import patch
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from tests.test_holiday_import import workbook
from src.backend_patches import holiday_import as hi
from playwright.sync_api import sync_playwright


def verify(candidate, fixtures, output, filled):
    output.mkdir(parents=True, exist_ok=False)
    checks, errors = [], []
    def check(name, ok):
        checks.append(dict(name=name, passed=bool(ok)))
        assert ok, name
    def result():
        value = dict(version='v5.8.49', sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),
                     passed=sum(c['passed'] for c in checks), total=len(checks), checks=checks,
                     page_errors=errors, native_desktop_verified=False, production_data_modified=False,
                     real_mail_sent=0)
        (output/'result.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),'utf-8')
        return value
    with tempfile.TemporaryDirectory(prefix='festival-release-') as temp, patch.dict(os.environ, {'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client = PackagedClient(candidate, Path(temp), 'festival', unused_port())
        try:
            client.start()
            destination = Path(temp)/'指定下载目录'
            client.patch_settings(dict(export_folder=str(destination),reminder_enabled=False,
                reminder_recipient_groups=[],event_reminder_create_enabled=False,
                event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False))
            project = client.create_project('公开招标', '隔离节日显示验证')
            before = client.get_project(project['id'])
            october = client.request('GET','/api/calendar?year=2026&month=10')
            days = {c['day']:c['holiday'] for c in october['cells'] if not c.get('empty')}
            check('National Day only October 1',days[1]['festival_name']=='国庆节' and all(not days[i]['festival_name'] for i in range(2,8)))
            check('seven rest badges and original makeup day retained',all(days[i]['label']=='休' for i in range(1,8)) and days[10]['label']=='班')
            for month, day, name, first in [(2,17,'春节',15),(4,5,'清明节',4)]:
                calendar=client.request('GET',f'/api/calendar?year=2026&month={month}')
                cells={c['day']:c['holiday'] for c in calendar['cells'] if not c.get('empty')}
                check(f'{name} actual day differs from first day off',cells[day]['festival_name']==name and not cells[first]['festival_name'])
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                context=browser.new_context(viewport=dict(width=1440,height=960),locale='zh-CN',timezone_id='Asia/Shanghai',accept_downloads=True)
                context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
                page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                try:
                    page.goto(client.base_url,wait_until='networkidle')
                    page.evaluate('switchView("calendar");calendarYear=2026;calendarMonth=10;loadCalendar()')
                    page.wait_for_selector('[data-calendar-date="2026-10-01"]')
                    for theme in ['default','dark','blue','green']:
                        page.evaluate('(t)=>applyTheme(t)',theme)
                        for width in [1440,390]:
                            page.set_viewport_size(dict(width=width,height=960))
                            check(f'{theme}/{width} only actual festival labelled',page.locator('.calendar-holiday-name').count()==1 and page.locator('.calendar-holiday-name').inner_text()=='国庆节')
                            check(f'{theme}/{width} calendar has no horizontal overflow',page.locator('#calendarContent').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2'))
                            page.screenshot(path=str(output/f'节日显示-{theme}-{width}.png'))
                    page.set_viewport_size(dict(width=1440,height=960))
                    page.evaluate('showHolidayCalendarSettings(2026)');page.wait_for_selector('#hcFile')
                    page.locator('.holiday-import-guide summary').click()
                    check('import guide distinguishes festival from days off', '不改变工作日计算' in page.locator('.holiday-import-guide').inner_text())
                    page.screenshot(path=str(output/'导入填写说明.png'))
                    page.locator('#hcTemplate').click()
                    page.wait_for_function('document.querySelector("#hcFeedback").textContent.startsWith("已保存：")')
                    paths=list(destination.glob('*模板*.xlsx'))
                    check('desktop template saved to configured folder',len(paths)==1 and str(destination) in page.locator('#hcFeedback').inner_text())
                    # Use a workbook filled and saved by Artifact Tool, not only XML fixtures.
                    page.locator('#hcFile').set_input_files(str(filled))
                    page.locator('#hcPreviewButton').click();page.wait_for_selector('#hcCommit')
                    preview=page.evaluate('hcSettingsState.preview')
                    check('preview separately counts seven rest one makeup one festival',preview['summary']==dict(holidays=7,workdays=1,festivals=1))
                    check('preview does not apply before confirmation',client.request('GET','/api/holiday-calendar?year=2026')['local_revision']==0)
                    page.locator('#hcComplete').check();page.locator('#hcCommit').click()
                    page.wait_for_function('hcSettingsState.data?.local_revision===1')
                    active=client.request('GET','/api/holiday-calendar?year=2026')
                    check('confirmed import includes independent festival row',active['festivals']==[dict(date='2026-10-01',name='国庆节')])
                    page.locator('#hcExport').click();page.wait_for_function('document.querySelector("#hcFeedback").textContent.startsWith("已保存：")')
                    exported=next(p for p in destination.glob('*.xlsx') if '模板' not in p.name)
                    parsed=hi.parse_xlsx(exported.read_bytes(),2026)
                    check('desktop export roundtrips all three record types',all(parsed[k]==active[k] for k in ['holidays','workdays','festivals']))
                    page.evaluate('window.isDesktopApp=()=>false')
                    with page.expect_download() as pending:page.locator('#hcTemplate').click()
                    download=pending.value;download.save_as(output/'浏览器下载模板.xlsx')
                    check('browser uses download with Chinese name',download.suggested_filename=='2026年放假调休安排模板.xlsx')
                    page.locator('#hcFile').set_input_files(str(filled));page.locator('#hcPreviewButton').click();page.wait_for_selector('#hcCommit')
                    check('browser reimport matches saved data',page.evaluate('hcSettingsState.preview.summary.festivals')==1)
                    page.keyboard.press('Escape');page.wait_for_selector('#modal.open',state='hidden')
                    check('Escape closes import modal',page.locator('#modal.open').count()==0)
                    check('no browser script errors',not errors)
                finally:context.close();browser.close()
            check('existing project and stages unchanged',client.get_project(project['id'])==before)
            client.restart()
            check('festival import survives EXE restart',client.request('GET','/api/holiday-calendar?year=2026')['festivals']==active['festivals'])
            check('existing project survives restart unchanged',client.get_project(project['id'])==before)
            # Old headers remain accepted; malformed festival intervals fail with row errors.
            for label,raw,status in [
                ('legacy four-column input accepted',workbook([('2027-01-01','','放假','元旦')]),200),
                ('festival multi-day interval rejected',workbook([('2027-01-01','2027-01-03','节日当天','元旦')],headers=hi.HEADERS),400)]:
                response=client.session.post(client.base_url+'/api/holiday-calendar/import/preview',
                    data=dict(year=2027,base_revision=0), files={'file':('安排.xlsx',raw,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},headers={'X-CSRFToken':client.csrf_token})
                check(label,response.status_code==status)
        finally:client.stop();result()
    return result()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--fixtures',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--filled',type=Path,required=True);args=parser.parse_args()
    value=verify(args.candidate.resolve(),args.fixtures.resolve(),args.output.resolve(),args.filled.resolve())
    print(json.dumps({k:value[k] for k in ['version','passed','total','page_errors']},ensure_ascii=False))
