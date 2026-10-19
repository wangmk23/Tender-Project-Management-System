"""Check regime switches and compact preview using only owned upgrade data."""
from __future__ import annotations
import argparse,hashlib,json,os,shutil,sys,tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright

def verify(candidate,old,fixtures,output):
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[]
    def check(name,ok):
        checks.append(dict(name=name,passed=bool(ok)))
        if not ok:raise AssertionError(name)
    def report():
        result=dict(passed=sum(c['passed'] for c in checks),total=len(checks),checks=checks,page_errors=errors,sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),native_desktop_verified=False,real_mail_sent=0,original_business_data_accessed=False)
        (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
    with tempfile.TemporaryDirectory(prefix='regime-switch-owned-') as folder,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old,Path(folder),'owned',unused_port())
        try:
            client.start();client.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False,reminder_recipient_groups=[]))
            cat=client.request('GET','/api/procurement-methods');gov=next(m for m in cat['methods'] if m['regime']=='government_procurement')
            project=client.request('POST','/api/projects',dict(number='REGIME-OWNED',name='隔离历史政府采购项目',procurement_method_id=gov['id'],year=2026,no_deposit=True));pid=project['id']
            before=client.get_project(pid);oldmethods=client.request('GET','/api/procurement-methods')['methods'];client.stop();shutil.copy2(candidate,client.executable);client.start()
            check('upgrade preserves all methods and templates',client.request('GET','/api/procurement-methods')['methods']==oldmethods)
            check('upgrade preserves historical project',client.get_project(pid)==before)
            check('upgrade defaults preserve current scope',all(client.request('GET','/api/procurement-methods')['regime_enabled'].values()))
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');ctx=browser.new_context(viewport=dict(width=1440,height=960),locale='zh-CN',timezone_id='Asia/Shanghai');ctx.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                try:
                    page.goto(client.base_url,wait_until='networkidle');page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost');page.evaluate('setSettingsCategory("workflow")');page.evaluate('updateUiPreference("motion","off")')
                    check('five labeled switches visible',page.locator('[data-regime-toggle]').count()==5)
                    page.locator('[data-regime-toggle="government_procurement"]').focus();page.keyboard.press('Space');page.wait_for_function('document.getElementById("procurementRegimeStatus").textContent.includes("已保存")')
                    check('keyboard switch saved to server',client.request('GET','/api/procurement-methods')['regime_enabled']['government_procurement'] is False)
                    for regime in ['mandatory_construction_bidding','collective','other']:
                        page.locator(f'label:has([data-regime-toggle="{regime}"])').click();page.wait_for_function('document.getElementById("procurementRegimeStatus").textContent.includes("已保存")')
                    page.evaluate('showNewProjectModal()');page.wait_for_selector('#npMethod')
                    available=page.locator('#npMethod option').evaluate_all('(rows)=>rows.map(r=>r.value).filter(Boolean)');cat=client.request('GET','/api/procurement-methods')
                    check('new project lists only enabled enterprise regime',set(available)=={m['id'] for m in cat['methods'] if m['regime']=='enterprise' and m['enabled']})
                    check('history filter still includes existing disabled-regime project',page.locator('#sidebarMethodSelect option[value="'+gov['id']+'"]').count()==1)
                    blocked=client.session.post(client.base_url+'/api/projects',json=dict(number='BLOCKED-OWNED',name='禁止新建',procurement_method_id=gov['id'],year=2026),headers={'X-CSRFToken':client.csrf_token})
                    check('stale client cannot create disabled-regime project',blocked.status_code==409 and blocked.json()['code']=='REGIME_DISABLED')
                    page.evaluate('closeModal()');page.wait_for_selector('#modal.open',state='hidden')
                    for theme in ['default','dark','blue','green']:
                        page.evaluate('(t)=>updateUiPreference("theme",t)',theme);page.set_viewport_size(dict(width=1440,height=960));page.evaluate('document.getAnimations().forEach(a=>a.finish())');page.screenshot(path=str(output/f'制度启用-{theme}.png'))
                        page.evaluate('showProcurementMethodForm(null,{view:"flow"})');page.wait_for_selector('#pmCommonFlow .btn-primary')
                        for width,height in [(2560,1369),(900,900),(390,900)]:
                            page.set_viewport_size(dict(width=width,height=height));page.evaluate('document.getAnimations().forEach(a=>a.finish())')
                            check(f'{theme}/{width} common preview action and footer visible',page.locator('#pmCommonFlow .btn-primary').is_visible() and page.locator('#modalSaveBtn').is_visible())
                            check(f'{theme}/{width} no horizontal overflow',page.locator('#modalBody').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2'))
                            if width==2560:check(f'{theme} common modal avoids oversized empty window',page.locator('#modal').evaluate('(e)=>e.getBoundingClientRect().height<innerHeight*.8'))
                            page.screenshot(path=str(output/f'通用流程预览-{theme}-{width}.png'))
                        page.locator('#pmCommonFlow .btn-primary').click();check(f'{theme} copy enters independent stage editor',page.locator('#pmTemplateMode').input_value()=='independent' and page.locator('[data-flow-name]').is_visible())
                        page.evaluate('closeModal()');page.get_by_role('button',name='放弃修改',exact=True).click();page.wait_for_selector('#modal.open',state='hidden')
                    page.set_viewport_size(dict(width=1440,height=960));page.locator('label:has([data-regime-toggle="enterprise"])').click();page.wait_for_function('document.getElementById("procurementRegimeStatus").textContent.includes("已保存")');page.evaluate('showNewProjectModal()');check('all regimes off gives actionable empty state','启用采购制度' in page.locator('#npMethod').inner_text());page.evaluate('closeModal()');page.wait_for_selector('#modal.open',state='hidden')
                    page.locator('label:has([data-regime-toggle="enterprise"])').click();page.wait_for_function('document.getElementById("procurementRegimeStatus").textContent.includes("已保存")')
                    check('toggles and cancelled copies leave methods untouched',client.request('GET','/api/procurement-methods')['methods']==oldmethods)
                    check('historical project stays unchanged',client.get_project(pid)==before);check('no browser script errors',not errors)
                finally:ctx.close();browser.close()
            states=client.request('GET','/api/procurement-methods')['regime_enabled'];client.restart();check('all switch states survive restart',client.request('GET','/api/procurement-methods')['regime_enabled']==states)
        except Exception:
            if 'page' in locals():
                try:page.screenshot(path=str(output/'failure.png'))
                except Exception:pass
            report();raise
        finally:client.stop()
    return report()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--old-exe',type=Path,required=True);p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();r=verify(a.candidate.resolve(),a.old_exe.resolve(),a.fixtures.resolve(),a.output.resolve());print(json.dumps(dict(passed=r['passed'],total=r['total'],page_errors=r['page_errors'])))
