"""Verify lifecycle facts and chart-board UI in an isolated old->new EXE upgrade."""
from pathlib import Path
import argparse,copy,hashlib,json,os,shutil,sys,tempfile
from datetime import datetime
from zoneinfo import ZoneInfo
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright


def verify(candidate,old,fixtures,output):
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[]
    def check(name,ok):
        checks.append(dict(name=name,passed=bool(ok)));assert ok,name
    def save():
        result=dict(version='v'+json.loads((ROOT/'package.json').read_text('utf-8'))['version'],checks=checks,passed=sum(c['passed'] for c in checks),total=len(checks),
            page_errors=errors,sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),
            production_data_modified=False,native_desktop_verified=False,real_mail_sent=0)
        (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8');return result
    with tempfile.TemporaryDirectory(prefix='project-timeline-owned-') as temp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old,Path(temp),'upgrade',unused_port())
        try:
            client.start();client.patch_settings(dict(reminder_enabled=False,reminder_recipient_groups=[],event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False))
            cat=client.request('GET','/api/procurement-methods')
            method=client.request('POST','/api/procurement-methods',dict(name='隔离起止测试',revision=cat['revision'],template_mode='independent',quantity_rule=dict(mode='unfixed',minimum=None),
                stages=[dict(id='begin',name='受理',modules=['common']),dict(id='end',name='办结',modules=['common'])]))['method']
            def create(number,name):return client.request('POST','/api/projects',dict(number=number,name=name,procurement_method_id=method['id'],no_deposit=True))
            active=create('LIFE-001','模拟进行中项目');normal=create('LIFE-002','模拟正常完成');legacy=create('LIFE-003','模拟历史流标')
            bad=create('LIFE-004','模拟时间倒置');closed=create('LIFE-005','模拟新结束记录')
            stamp=datetime.now(ZoneInfo('Asia/Shanghai')).isoformat(timespec='minutes')[:16]
            for p,date in [(normal,stamp),(bad,'2000-01-01T09:00')]:
                for key in ['begin','end']:client.request('PUT',f'/api/projects/{p["id"]}/stages/{key}',dict(completed=True,completed_at=date))
            client.request('PUT',f'/api/projects/{legacy["id"]}',dict(is_terminated=True,terminated_type='liubiao',terminated_reason='模拟历史原因'))
            before={p['id']:client.get_project(p['id']) for p in [active,normal,legacy,bad,closed]}
            client.stop();shutil.copy2(candidate,client.executable);client.start()
            after={pid:client.get_project(pid) for pid in before}
            check('upgrade preserves original created timestamps and stage records',all(after[pid]['created_at']==before[pid]['created_at'] and after[pid]['stages']==before[pid]['stages'] for pid in before))
            timeline=lambda pid:client.get_project(pid)['project_timeline']
            check('old active stays open without an invented end',timeline(active['id'])['state']=='active' and timeline(active['id'])['ended_at'] is None)
            check('old completed project derives actual completion',timeline(normal['id'])['state']=='completed' and timeline(normal['id'])['ended_at'].startswith(stamp))
            check('old termination has unknown time rather than upgrade time',timeline(legacy['id'])['state']=='liubiao' and timeline(legacy['id'])['ended_at'] is None)
            pid=closed['id'];first=client.request('PUT',f'/api/projects/{pid}',dict(is_terminated=True,terminated_type='terminated',terminated_reason='模拟终止'))['project_timeline']
            check('new termination has a durable actual end',first['state']=='terminated' and first['end_source']=='termination_record' and bool(first['ended_at']))
            repeated=client.request('PUT',f'/api/projects/{pid}',dict(is_terminated=True,terminated_type='terminated',notes='补充说明'))['project_timeline']
            check('repeated save does not reset end time',repeated['ended_at']==first['ended_at'])
            restored=client.request('PUT',f'/api/projects/{pid}',dict(is_terminated=False))['project_timeline']
            check('restore clears current end date',restored['state']=='active' and restored['ended_at'] is None)
            final_closed=client.request('PUT',f'/api/projects/{pid}',dict(is_terminated=True,terminated_type='feibiao'))['project_timeline']
            check('reclose records separate invalid-tender status',final_closed['state']=='feibiao' and bool(final_closed['ended_at']))
            fresh=create('LIFE-006','模拟新增流标');fresh_id=fresh['id']
            check('new project creation reports its saved UTC creation fact',bool(fresh['project_timeline']['created_at']) and fresh['project_timeline']['created_at'].endswith('+00:00'))
            fresh_closed=client.request('PUT',f'/api/projects/{fresh_id}',dict(is_terminated=True,terminated_type='liubiao'))['project_timeline']
            check('new failed tender has its own end date',fresh_closed['state']=='liubiao' and bool(fresh_closed['ended_at']))
            listing=client.request('GET','/api/projects')
            check('list and detail carry identical lifecycle facts',all(next(p for p in listing if p['id']==pid)['project_timeline']==timeline(pid) for pid in [active['id'],normal['id'],legacy['id'],closed['id'],fresh_id]))
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                context=browser.new_context(viewport=dict(width=1440,height=1050),locale='zh-CN',timezone_id='Asia/Shanghai')
                context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=context.new_page()
                page.on('pageerror',lambda error:errors.append(str(error)))
                try:
                    page.goto(client.base_url,wait_until='networkidle');page.evaluate('updateUiPreference("motion","off");switchView("chart-board")');page.wait_for_selector('.cb-timeline')
                    table=page.locator('.cb-timeline');check('table is added alongside original charts and activity',page.locator('.cb-trend').count()==1 and page.locator('.cb-activity').count()==1 and table.get_by_role('columnheader').count()==6)
                    check('historical missing end is visible', '未记录' in table.locator('tr').filter(has_text='模拟历史流标').inner_text())
                    check('reversed historical dates are flagged', '时间待核对' in table.locator('tr').filter(has_text='模拟时间倒置').inner_text())
                    check('same-minute completion remains a valid zero-day duration','0 天' in table.locator('tr').filter(has_text='模拟正常完成').inner_text())
                    requests=[];page.on('request',lambda request:requests.append(request.url) if '/api/projects' in request.url else None)
                    search=page.locator('#cbTimelineSearch');search.fill('模拟');search.press('End');search.press('a');check('search keeps keyboard focus',page.evaluate('document.activeElement.id')=='cbTimelineSearch')
                    page.locator('#cbTimelineSearch').fill('模拟新增流标');page.locator('#cbTimelineStatus').select_option('liubiao')
                    check('search and status filters combine',page.locator('[data-cb-timeline-project]').count()==1 and '模拟新增流标' in table.inner_text())
                    page.locator('#cbTimelineSort').select_option('duration');check('local filtering does not request every project again',not requests)
                    page.locator('[data-cb-timeline-project]').click();page.wait_for_function('(id)=>currentProject?.id===id',arg=fresh_id)
                    check('project name opens exact project',page.evaluate('currentProject.id')==fresh_id)
                    page.evaluate('switchView("chart-board")');page.wait_for_selector('.cb-timeline');page.locator('#cbTimelineSearch').fill('');page.locator('#cbTimelineStatus').select_option('all')
                    for theme in ['default','dark','blue','green']:
                        page.evaluate('(theme)=>updateUiPreference("theme",theme)',theme)
                        for width in [1440,390]:
                            page.set_viewport_size(dict(width=width,height=1050));table=page.locator('.cb-timeline');table.scroll_into_view_if_needed()
                            check(f'{theme}/{width} timeline stays inside viewport',table.evaluate('(e)=>{const r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&e.scrollWidth<=e.clientWidth+2}'))
                            check(f'{theme}/{width} controls and project entries remain usable',page.locator('#cbTimelineStatus').is_visible() and page.locator('[data-cb-timeline-project]').count()==6)
                            if width==390:
                                page.locator('#cbTimelineTitle').scroll_into_view_if_needed();page.screenshot(path=str(output/f'项目起止时间表-{theme}-{width}-顶部.png'))
                                table.locator('footer').scroll_into_view_if_needed();page.screenshot(path=str(output/f'项目起止时间表-{theme}-{width}-底部.png'))
                            else:table.screenshot(path=str(output/f'项目起止时间表-{theme}-{width}.png'))
                    check('no browser script errors',not errors)
                finally:context.close();browser.close()
            for key in ['begin','end']:client.request('PUT',f'/api/projects/{active["id"]}/stages/{key}',dict(completed=True,completed_at=stamp))
            check('all stages complete produces normal end',timeline(active['id'])['state']=='completed' and bool(timeline(active['id'])['ended_at']))
            client.request('PUT',f'/api/projects/{active["id"]}/stages/end',dict(completed=False))
            check('undo completion reopens duration instead of retaining stale end',timeline(active['id'])['state']=='active' and timeline(active['id'])['ended_at'] is None)
            saved=[timeline(pid) for pid in [normal['id'],legacy['id'],closed['id'],fresh_id]];client.restart()
            check('restart preserves both actual and unknown history times',[timeline(pid) for pid in [normal['id'],legacy['id'],closed['id'],fresh_id]]==saved)
        finally:client.stop();save()
    return save()


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--candidate',type=Path,required=True);parser.add_argument('--old',type=Path,required=True)
    parser.add_argument('--fixtures',type=Path,required=True);parser.add_argument('--output',type=Path,required=True);a=parser.parse_args()
    result=verify(a.candidate.resolve(),a.old.resolve(),a.fixtures.resolve(),a.output.resolve())
    print(json.dumps({k:result[k] for k in ['version','passed','total','page_errors']},ensure_ascii=False))
