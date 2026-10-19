"""Exercise a special upgrade over fictional saved workflows in an owned workspace."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,sys,tempfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright

def verify(candidate,old,fixtures,output):
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[];shots=[]
    def check(name,value):
        checks.append(dict(name=name,passed=bool(value)))
        if not value:raise AssertionError(name)
    with tempfile.TemporaryDirectory(prefix='personal-flows-owned-') as temp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old,Path(temp),'owned',unused_port())
        try:
            client.start();client.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False,reminder_recipient_groups=[],reminder_stage_keys=['project_setup']))
            cat=client.request('GET','/api/procurement-methods');source=next(m for m in cat['methods'] if m['name']=='公开招标' and m['regime'] is None)
            flow=[dict(id='first',name='使用电脑原有需求核对',icon='📥',modules=['common','checklist']),dict(id='archive',name='使用电脑原有归档',icon='📦',modules=['common','archive'])]
            client.request('PATCH','/api/procurement-methods/'+source['id'],dict(revision=source['revision'],stages=flow,template_mode='independent'))
            target=next(m for m in cat['methods'] if m['name']=='公开招标' and m['regime'])
            created=client.request('POST','/api/projects',dict(name='迁移前历史项目',number='PERSONAL-OLD',procurement_method_id=target['id'],year=2026,no_deposit=True))
            first=client.get_project(created['id'])['stages'][0]['key']
            client.request('PUT',f"/api/projects/{created['id']}/stages/{first}",dict(completed=True,completed_at='2026-10-17T09:15',notes='历史完成时间与备注保持'))
            before=client.get_project(created['id']);settings=client.request('GET','/api/settings')
            settings_bytes=(client.data_root/'app_settings.json').read_bytes()
            client.stop();shutil.copy2(candidate,client.executable);client.start()
            cat=client.request('GET','/api/procurement-methods');profile=cat['personal_profile']
            check('special build activates on deployment configuration',profile['active'])
            check('existing project including snapshots unchanged',client.get_project(created['id'])==before)
            check('completed historical stage was included in preservation check',any(s.get('completed') and s.get('notes')=='历史完成时间与备注保持' for s in before['stages']))
            check('source method identity and regime preserved',next(m for m in cat['methods'] if m['id']==source['id'])['regime'] is None)
            for m in cat['methods']:
                if m['name']=='公开招标':check('saved source overrides default '+str(m['regime']),m['stages']==flow)
            new=client.request('POST','/api/projects',dict(name='专属流程新建验证',number='PERSONAL-NEW',procurement_method_id=source['id'],year=2026,no_deposit=True));project=client.get_project(new['id'])
            check('new project accepts saved method without regime assignment',[s['name'] for s in project['stages']]==[s['name'] for s in flow])
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                context=browser.new_context(viewport=dict(width=1366,height=900),locale='zh-CN',timezone_id='Asia/Shanghai')
                context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=context.new_page();page.on('pageerror',lambda error:errors.append(str(error)))
                try:
                    page.goto(client.base_url,wait_until='networkidle');page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost');page.evaluate('setSettingsCategory("workflow")')
                    check('personal UI has no pending assignment', '待确认' not in page.locator('.procurement-manager').inner_text() and '待分配' not in page.locator('.procurement-manager').inner_text())
                    check('compact master and detail visible',page.locator('[data-procurement-workspace]').is_visible() and page.locator('[data-procurement-overview]').is_visible())
                    visible=[m for m in cat['methods'] if m['id'] not in profile['hidden_method_ids']]
                    check('one row per saved method on unambiguous upgrade',page.locator('.procurement-method-row').count()==len(visible))
                    for theme in ['dark','default','blue','green']:
                        for width in [1366,390]:
                            page.set_viewport_size(dict(width=width,height=900));page.evaluate('(theme)=>applyTheme(theme)',theme);page.evaluate('(id)=>selectProcurementManagerMethod(id)',source['id'])
                            check('layout fits '+theme+'/'+str(width),page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
                            check('source stages visible '+theme+'/'+str(width),'使用电脑原有需求核对' in page.locator('[data-procurement-overview]').inner_text())
                            filename=f'专属流程-{theme}-{width}.png';page.screenshot(path=str(output/filename),full_page=True);shots.append(filename)
                    page.set_viewport_size(dict(width=1366,height=900));page.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',source['id'])
                    check('flow remains directly editable in centered dialog',page.locator('[data-flow-name]').is_visible() and page.locator('#modalSaveBtn').is_visible())
                    page.locator('[data-flow-name]').fill('升级后我的新编辑');page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden')
                    check('edited flow visible in overview','升级后我的新编辑' in page.locator('[data-procurement-overview]').inner_text())
                    check('no browser errors',not errors)
                finally:context.close();browser.close()
            current=client.request('GET','/api/procurement-methods');edited=next(m for m in current['methods'] if m['id']==source['id'])
            client.restart();after=client.request('GET','/api/procurement-methods')
            check('restart does not overwrite later edit',next(m for m in after['methods'] if m['id']==source['id'])==edited)
            check('restart does not rerun migration',after['revision']==current['revision'])
            check('old project still unchanged after editing and restart',client.get_project(created['id'])==before)
            after_settings=client.request('GET','/api/settings');ignored={'procurement_catalog','stage_templates','supplier_minimums','stage_module_catalog','reminder_stage_definitions'}
            changed_keys=[key for key in settings.keys()|after_settings.keys() if key not in ignored and settings.get(key)!=after_settings.get(key)]
            if changed_keys:print('NON_FLOW_SETTINGS_DIFF_KEYS',changed_keys,flush=True)
            check('non-flow settings unchanged',not changed_keys)
            check('stored settings file unchanged byte for byte',(client.data_root/'app_settings.json').read_bytes()==settings_bytes)
            check('explicit reminder subscriptions unchanged',after_settings['reminder_stage_keys']==settings['reminder_stage_keys'])
        finally:client.stop()
    result=dict(total=len(checks),passed=sum(c['passed'] for c in checks),checks=checks,page_errors=errors,screenshots=shots,sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),original_data_accessed=False,native_desktop_verified=False)
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8');return result

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',required=True,type=Path);p.add_argument('--old',required=True,type=Path);p.add_argument('--fixtures',required=True,type=Path);p.add_argument('--output',required=True,type=Path);a=p.parse_args()
    r=verify(a.candidate.resolve(),a.old.resolve(),a.fixtures.resolve(),a.output.resolve());print(json.dumps(dict(total=r['total'],passed=r['passed'],page_errors=r['page_errors'])))
