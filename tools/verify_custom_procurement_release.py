"""Verify self-managed methods using fictional data upgraded from v46 only."""
from __future__ import annotations
import argparse,hashlib,json,os,shutil,sys,tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from src.backend_patches import data_import
from playwright.sync_api import sync_playwright

def verify(candidate,old,fixtures,output):
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[]
    def check(name,ok):
        checks.append(dict(name=name,passed=bool(ok)))
        if not ok:raise AssertionError(name)
    def report():
        result=dict(passed=sum(c['passed'] for c in checks),total=len(checks),checks=checks,page_errors=errors,sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),native_desktop_verified=False,real_mail_sent=0,original_business_data_accessed=False)
        (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');return result
    with tempfile.TemporaryDirectory(prefix='custom-methods-owned-') as folder,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old,Path(folder),'owned',unused_port())
        try:
            client.start();client.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False,reminder_recipient_groups=[]))
            cat=client.request('GET','/api/procurement-methods');refs=[m for m in cat['methods'] if m.get('reference_preset')];used,edited=refs[:2]
            project=client.request('POST','/api/projects',dict(number='CUSTOM-OWNED',name='隔离历史项目',procurement_method_id=used['id'],year=2026,no_deposit=True));pid=project['id'];before=client.get_project(pid)
            client.request('PATCH','/api/procurement-methods/'+edited['id'],dict(revision=edited['revision'],notes='管理员手动维护过的配置'))
            cat=client.request('GET','/api/procurement-methods');client.request('PATCH','/api/procurement-regimes/enterprise',dict(revision=cat['revision'],enabled=False))
            oldmethods=client.request('GET','/api/procurement-methods')['methods'];client.stop();shutil.copy2(candidate,client.executable);client.start()
            cat=client.request('GET','/api/procurement-methods')
            check('upgrade preserves every saved method and template',[{k:v for k,v in m.items() if k!='user_owned'} for m in cat['methods']]==oldmethods)
            check('existing project unchanged',client.get_project(pid)==before)
            check('regime preferences no longer control catalog',cat['management_mode']=='custom' and 'regime_enabled' not in cat)
            owned=[m for m in cat['methods'] if m['user_owned']]
            check('original eight plus referenced and manually edited presets retained',len(owned)==10 and {used['id'],edited['id']}.issubset({m['id'] for m in owned}))
            original=next(m for m in owned if not m['regime'] and m['name']=='公开招标')
            made=client.request('POST','/api/projects',dict(number='ORIGINAL-OWNED',name='原方式直接新建',procurement_method_id=original['id'],year=2026))
            check('original method needs no regime',made['procurement']['method_id']==original['id'])
            archive=next(m for m in cat['methods'] if not m['user_owned'])
            blocked=client.session.post(client.base_url+'/api/projects',json=dict(number='ARCHIVED',name='旧参考不可误选',procurement_method_id=archive['id'],year=2026),headers={'X-CSRFToken':client.csrf_token})
            check('stale unused reference choice rejected',blocked.status_code==409 and blocked.json()['code']=='METHOD_REFERENCE_ARCHIVED')
            raw=data_import.build_import_template('projects',procurement_catalog=cat);book=data_import._parse_xlsx_workbook(raw)
            check('import template omits regimes and archived presets','适用制度' not in book['项目'][0] and archive['id'] not in str(book['采购方式目录']) and original['id'] in str(book['采购方式目录']))
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');ctx=browser.new_context(viewport=dict(width=1440,height=960),locale='zh-CN',timezone_id='Asia/Shanghai');ctx.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                try:
                    page.goto(client.base_url,wait_until='networkidle');page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost');page.evaluate('setSettingsCategory("workflow")');page.evaluate('updateUiPreference("motion","off")')
                    check('manager lists only user-owned methods without regimes',page.locator('[data-method-id]').count()==10 and page.locator('[data-regime-toggle],[aria-label="筛选采购制度"],.procurement-reference').count()==0)
                    page.screenshot(path=str(output/'自建采购方式总览.png'))
                    page.evaluate('showNewProjectModal()');check('new project has same owned choices',set(page.locator('#npMethod option').evaluate_all('(rows)=>rows.map(r=>r.value).filter(Boolean)'))=={m['id'] for m in owned if m['enabled']});page.evaluate('closeModal()');page.wait_for_selector('#modal.open',state='hidden')
                    for theme in ['default','dark','blue','green']:
                        page.evaluate('(t)=>updateUiPreference("theme",t)',theme);page.evaluate('showProcurementMethodForm(null,{view:"flow"})');page.wait_for_selector('#pmCommonFlow .btn-primary')
                        check(f'{theme} no regime field',page.locator('#pmRegime').count()==0)
                        for width,height in [(2560,1369),(900,900),(390,900)]:
                            page.set_viewport_size(dict(width=width,height=height));page.evaluate('document.getAnimations().forEach(a=>a.finish())')
                            check(f'{theme}/{width} preview action and footer visible',page.locator('#pmCommonFlow .btn-primary').is_visible() and page.locator('#modalSaveBtn').is_visible())
                            check(f'{theme}/{width} no overflow',page.locator('#modalBody').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2'))
                            if width==2560:check(f'{theme} preview compact',page.locator('#modal').evaluate('(e)=>e.getBoundingClientRect().height<innerHeight*.8'))
                            page.screenshot(path=str(output/f'通用流程预览-{theme}-{width}.png'))
                        page.locator('#pmCommonFlow .btn-primary').click();check(f'{theme} copy opens editor',page.locator('#pmTemplateMode').input_value()=='independent' and page.locator('[data-flow-name]').is_visible())
                        page.evaluate('closeModal()');page.get_by_role('button',name='放弃修改',exact=True).click();page.wait_for_selector('#modal.open',state='hidden')
                    page.set_viewport_size(dict(width=1440,height=960));page.evaluate('showProcurementMethodForm()');page.locator('#pmName').fill('自行创建的方式');page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden')
                    saved=next(m for m in client.request('GET','/api/procurement-methods')['methods'] if m['name']=='自行创建的方式')
                    check('name-only creation saves without regime',saved['regime'] is None and saved['user_owned'])
                    check('no browser script errors',not errors)
                finally:ctx.close();browser.close()
            client.restart();check('custom method survives restart',next(m for m in client.request('GET','/api/procurement-methods')['methods'] if m['id']==saved['id'])==saved);check('historical project stays unchanged after restart',client.get_project(pid)==before)
        except Exception:
            report();raise
        finally:client.stop()
    return report()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--old-exe',type=Path,required=True);p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();r=verify(a.candidate.resolve(),a.old_exe.resolve(),a.fixtures.resolve(),a.output.resolve());print(json.dumps(dict(passed=r['passed'],total=r['total'],page_errors=r['page_errors'])))
