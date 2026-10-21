"""Isolated v49->candidate upgrade and real rule/calendar UI verification."""
from __future__ import annotations
import argparse,copy,hashlib,json,os,shutil,sys,tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from tools.verify_guarantee_release import templates,fixture
from playwright.sync_api import sync_playwright


def verify(candidate,old,fixtures,output):
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[]
    def check(name,ok):
        checks.append(dict(name=name,passed=bool(ok)))
        assert ok,name
    def report():
        value=dict(version='v5.8.50',passed=sum(c['passed'] for c in checks),total=len(checks),
                   checks=checks,page_errors=errors,sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),
                   production_data_modified=False,native_desktop_verified=False,real_mail_sent=0)
        (output/'result.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8');return value
    with tempfile.TemporaryDirectory(prefix='guarantee-rules-owned-') as temp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old,Path(temp),'upgrade',unused_port())
        try:
            client.start();templates(client)
            project=client.create_project('公开招标','隔离规则重复与计划联动');pid=project['id']
            regs=[client.request('POST',f'/api/projects/{pid}/registrations',dict(company_name=name)) for name in ['模拟中标单位','模拟未中标单位']]
            records=[dict(registration_id=r['id'],participation='submitted',validity='valid',deposit_status='paid',
                          deposit_amount='4000',refunded_amount='0',handling='rule') for r in regs]
            rule=dict(id='active',lot_id=None,scope='nonwinner',enabled=True,start_stage_key='gw-notice',manual_start_at='',days=5,day_kind='calendar',cutoff='17:00',remind_days=1)
            rules=[rule,dict(rule,id='legacy-one',enabled=False),dict(rule,id='legacy-two',enabled=False),dict(rule,id='winner',scope='winner',enabled=False,start_stage_key='')]
            client.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(revision=0,data=dict(records=records,rules=rules,confirmed=True)))
            client.request('POST',f'/api/projects/{pid}/bid-results',dict(winning_supplier=regs[0]['company_name'],winning_amount='1000'))
            client.request('PUT',f'/api/projects/{pid}/stages/gw-result',dict(completed=True,completed_at='2026-10-01T10:00'))
            client.request('PUT',f'/api/projects/{pid}/stages/gw-notice',dict(planned_at='2026-10-08T09:00'))
            original=client.get_project(pid);original_data=copy.deepcopy(original['tender_guarantee']['data'])
            original_cash=[(r['registration_id'],r['deposit_amount'],r['refunded_amount']) for r in original_data['records']]
            # A second historical project has real deadlines to protect across upgrade.
            old_checks=[];other=fixture(client,old_checks);old_real=client.get_project(other['pid'])
            real_dates={i['registration_id']:i['deadline'] for i in old_real['tender_guarantee']['items'] if i['deadline']}
            client.stop();shutil.copy2(candidate,client.executable);client.start()
            upgraded=client.get_project(pid)
            check('upgrade preserves original rules and actual cash',upgraded['tender_guarantee']['data']==original_data)
            after_real=client.get_project(other['pid'])
            check('upgrade preserves historical real deadlines without false recalculation',all(i['deadline']==real_dates[i['registration_id']] and not i['needs_recheck'] for i in after_real['tender_guarantee']['items'] if i['registration_id'] in real_dates))
            initial={x['registration_id']:x for x in upgraded['tender_guarantee']['items']}
            check('winner explicitly reports disabled winner rule',initial[regs[0]['id']]['issue_code']=='rule_disabled' and initial[regs[0]['id']]['next_action']=='rule')
            check('unfinished stage uses planned date only for estimate',initial[regs[1]['id']]['estimated_deadline']=='2026-10-13T17:00' and not initial[regs[1]['id']]['deadline'])
            # Server rejects new same-scope IDs even when disabled.
            ledger=client.request('GET',f'/api/projects/{pid}/tender-guarantee');bad=copy.deepcopy(ledger['data']);bad['rules'].append(dict(rule,id='should-not-add',enabled=False))
            rejected=client.session.put(client.base_url+f'/api/projects/{pid}/tender-guarantee',json=dict(revision=ledger['revision'],data=bad,reason='模拟重复提交'),headers={'X-CSRFToken':client.csrf_token})
            check('new disabled duplicate rejected server-side',rejected.status_code==400)
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                context=browser.new_context(viewport=dict(width=1440,height=960),locale='zh-CN',timezone_id='Asia/Shanghai')
                context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
                page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                try:
                    page.goto(client.base_url,wait_until='networkidle');page.evaluate('(id)=>selectProject(id)',pid)
                    page.wait_for_function('(id)=>currentProject?.id===id',arg=pid)
                    page.evaluate('updateUiPreference("motion","off");openStageSlide("gw-refund")');page.wait_for_selector('.tg-deadline-card')
                    winner_card=page.locator('.tg-deadline-card').filter(has_text='模拟中标单位')
                    check('winner card names missing rule rather than vague pending state','中标供应商退还规则尚未启用' in winner_card.inner_text())
                    page.get_by_role('button',name='设置退还规则',exact=True).click();page.wait_for_selector('[data-rule-group="whole:nonwinner"]')
                    check('manager groups legacy duplicate scope once',page.locator('[data-rule-group="whole:nonwinner"]').count()==1 and '历史停用记录（2条）' in page.locator('#modalBody').inner_text())
                    group=page.locator('[data-rule-group="whole:nonwinner"]')
                    group.locator('.tg-rule-row-head button').click();page.wait_for_selector('#tgRuleDays')
                    check('editor loads existing rule and shows replacement semantics',page.locator('#tgRuleEnabled').is_checked() and '不会新增' in page.locator('#modalBody').inner_text())
                    page.locator('#tgRuleDays').fill('6');page.locator('#modalSaveBtn').click()
                    page.wait_for_function('currentProject.tender_guarantee.data.rules.find(r=>r.id==="active").days===6')
                    check('save edits original ID without adding another rule',len(client.get_project(pid)['tender_guarantee']['data']['rules'])==4)
                    page.get_by_role('button',name='设置退还规则',exact=True).click();page.locator('[data-rule-group="whole:nonwinner"] .tg-rule-row-head button').click();page.wait_for_selector('#tgRuleDays')
                    check('reopen displays saved value',page.locator('#tgRuleDays').input_value()=='6')
                    page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden')
                    check('repeat save still does not add a rule',len(client.get_project(pid)['tender_guarantee']['data']['rules'])==4)
                    page.locator('[data-guarantee-next="rule"][data-scope="winner"]').click();page.wait_for_selector('#tgRuleStage')
                    check('winner action opens exact existing winner rule',page.locator('#tgRuleScope').input_value()=='winner' and not page.locator('#tgRuleEnabled').is_checked())
                    page.locator('#tgRuleStage').select_option('gw-notice');page.locator('#tgRuleEnabled').check();page.locator('#modalSaveBtn').click()
                    page.wait_for_function('currentProject.tender_guarantee.data.rules.find(r=>r.id==="winner").enabled')
                    check('enabled winner no longer remains review',next(i for i in client.get_project(pid)['tender_guarantee']['items'] if i['registration_id']==regs[0]['id'])['status']=='estimated')
                    check('estimated cards do not show actual overdue countdown',page.locator('[data-refund-deadline]').count()==0)
                    # Verify the manager/editor at stable finished theme states.
                    for theme in ['default','dark','blue','green']:
                        page.evaluate('(t)=>updateUiPreference("theme",t)',theme)
                        for width in [1440,390]:
                            page.set_viewport_size(dict(width=width,height=960));page.evaluate('showGuaranteeRules()');page.wait_for_selector('[data-rule-group="whole:nonwinner"]')
                            check(f'{theme}/{width} manager fits and remains scrollable',page.locator('#modalBody').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2') and page.locator('#modal').evaluate('(e)=>{let r=e.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1}'))
                            page.screenshot(path=str(output/f'规则管理-{theme}-{width}.png'))
                            page.locator('[data-rule-group="whole:winner"] .tg-rule-row-head button').click();page.wait_for_selector('#tgRuleStage')
                            check(f'{theme}/{width} editor save visible without horizontal overflow',page.locator('#modalSaveBtn').is_visible() and page.locator('#modalBody').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2'))
                            page.screenshot(path=str(output/f'规则编辑-{theme}-{width}.png'));page.keyboard.press('Escape');page.wait_for_selector('#modal.open',state='hidden')
                    page.set_viewport_size(dict(width=1440,height=960));page.evaluate('showGuaranteeRules()');page.wait_for_selector('[data-rule-group="whole:nonwinner"]')
                    page.locator('[data-rule-group="whole:nonwinner"] details summary').click()
                    page.locator('[data-rule-id="legacy-one"]').click();page.locator('#confirmOk').click()
                    page.wait_for_function('!currentProject.tender_guarantee.data.rules.some(r=>r.id==="legacy-one")')
                    check('explicit removal only drops selected disabled legacy config',len(client.get_project(pid)['tender_guarantee']['data']['rules'])==3)
                    page.keyboard.press('Escape');page.evaluate('closeSlide();switchView("calendar");calendarYear=2026;calendarMonth=10;loadCalendar({force:true})')
                    page.wait_for_selector('[data-calendar-date="2026-10-13"]');page.locator('[data-calendar-date="2026-10-13"]').click()
                    preview_task=page.locator('#calendarAgenda .calendar-agenda-item').filter(has_text='模拟中标单位')
                    check('calendar labels planned estimate and exact supplier',preview_task.count()==1 and '预计' in preview_task.inner_text())
                    preview_task.click();page.wait_for_selector('#modal.open .tg-form')
                    check('calendar estimate opens explanatory review rather than automatic refund','计划预估' in page.locator('#modalBody').inner_text() and '实际完成' in page.locator('#modalBody').inner_text())
                    page.screenshot(path=str(output/'预计退还截止日历办理.png'))
                    check('no browser script errors',not errors)
                finally:context.close();browser.close()
            # Planned rescheduling is not an adjustment of a real confirmed deadline.
            client.request('PUT',f'/api/projects/{pid}/stages/gw-notice',dict(planned_at='2026-10-09T09:00'))
            moved=client.get_project(pid)['tender_guarantee']['items']
            check('changing plan updates forecasts without fake formal deadlines',all(not i['deadline'] and not i['needs_recheck'] for i in moved))
            client.request('PUT',f'/api/projects/{pid}/stages/gw-notice',dict(completed=True,completed_at='2026-10-10T11:00'))
            actual=client.get_project(pid)['tender_guarantee']['items']
            check('actual completion replaces plan with actual date calculation',sorted(i['deadline'] for i in actual)==['2026-10-15T17:00','2026-10-16T17:00'] and all(not i['estimated_deadline'] for i in actual))
            client.request('PUT',f'/api/projects/{pid}/stages/gw-notice',dict(completed=True,completed_at='2026-10-11T11:00'))
            review=client.get_project(pid)['tender_guarantee']['items']
            check('changing actual date preserves formal deadlines for review',all(i['needs_recheck'] for i in review) and sorted(i['deadline'] for i in review)==sorted(i['deadline'] for i in actual))
            saved=client.get_project(pid)['tender_guarantee']
            check('all operations preserve actual cash',[(r['registration_id'],r['deposit_amount'],r['refunded_amount']) for r in saved['data']['records']]==original_cash)
            client.restart();again=client.get_project(pid)['tender_guarantee']
            check('restart preserves rules cash and review dates',again['data']==saved['data'] and [(i['deadline'],i['proposed_deadline']) for i in again['items']]==[(i['deadline'],i['proposed_deadline']) for i in saved['items']])
        finally:client.stop();report()
    return report()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--old',type=Path,required=True)
    p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=verify(a.candidate.resolve(),a.old.resolve(),a.fixtures.resolve(),a.output.resolve())
    print(json.dumps({k:result[k] for k in ['version','passed','total','page_errors']},ensure_ascii=False))
