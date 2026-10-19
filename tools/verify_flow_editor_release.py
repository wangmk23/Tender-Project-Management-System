"""Verify the centered flow editor using an owned, fictional upgrade workspace."""
from __future__ import annotations
import argparse, hashlib, json, os, shutil, sys, tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from playwright.sync_api import sync_playwright

def verify(candidate,sha,old,fixtures,output):
    if hashlib.sha256(candidate.read_bytes()).hexdigest()!=sha:raise ValueError('Candidate checksum differs')
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[];shots=[]
    def check(name,value):
        checks.append(dict(name=name,passed=bool(value)))
        if not value:raise AssertionError(name)
    def report():
        value=dict(passed=sum(c['passed'] for c in checks),total=len(checks),checks=checks,page_errors=errors,screenshots=shots,sha256=sha,native_desktop_verified=False,real_mail_sent=0,original_business_data_accessed=False)
        (output/'result.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8');return value
    with tempfile.TemporaryDirectory(prefix='flow-editor-upgrade-') as folder,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old,Path(folder),'owned',unused_port())
        try:
            client.start();client.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False,reminder_recipient_groups=[]))
            cat=client.request('GET','/api/procurement-methods')
            rows=[dict(id='first',name='历史需求核对',icon='📥',modules=['common','checklist']),dict(id='register',name='历史报名',icon='👥',modules=['common','registration']),dict(id='archive',name='历史归档',icon='📦',modules=['common','archive'])]
            method=client.request('POST','/api/procurement-methods',dict(name='隔离流程编辑验证',regime='enterprise',revision=cat['revision'],template_mode='independent',stages=rows))['method'];mid=method['id']
            project=client.request('POST','/api/projects',dict(number='FLOW-OWNED',name='隔离历史项目',procurement_method_id=mid,no_deposit=True,year=2026));pid=project['id']
            client.request('PUT',f'/api/projects/{pid}/stages/first',dict(completed=True,completed_at='2026-10-17T09:15',notes='已完成记录保持'))
            before=client.get_project(pid);oldcat=client.request('GET','/api/procurement-methods')
            # v44 can carry an active personal profile. Preserve its later edits, but restore normal visibility.
            if oldcat.get('personal_profile'):
                target=next(m for m in oldcat['methods'] if m['name']=='公开招标' and m['regime']=='government_procurement')
                edited=json.loads(json.dumps(target['stages']));edited[0]['name']='旧专属版后手动修改的阶段'
                client.request('PATCH','/api/procurement-methods/'+target['id'],dict(revision=target['revision'],template_mode='independent',stages=edited))
                oldcat=client.request('GET','/api/procurement-methods')
            oldcat.pop('personal_profile',None)
            oldcat.pop('regime_enabled',None)
            oldcat.pop('regimes',None)
            oldcat['management_mode']='custom'
            oldcat['methods']=[{k:v for k,v in m.items() if k!='user_owned'} for m in oldcat['methods']]
            protected={name:hashlib.sha256((client.data_root/name).read_bytes()).hexdigest() for name in ['license.dat','data_key.dpapi']}
            client.stop();shutil.copy2(candidate,client.executable);client.start()
            check('version matches release',client.request('GET','/api/system-info')['version']=='v'+json.loads((ROOT/'package.json').read_text('utf8'))['version'])
            check('upgrade preserves historical project exactly',client.get_project(pid)==before)
            check('upgrade preserves procurement catalog exactly',dict(client.request('GET','/api/procurement-methods'),methods=[{k:v for k,v in m.items() if k!='user_owned'} for m in client.request('GET','/api/procurement-methods')['methods']])==oldcat)
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                context=browser.new_context(viewport=dict(width=1366,height=900),locale='zh-CN',timezone_id='Asia/Shanghai')
                context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                try:
                    page.goto(client.base_url,wait_until='networkidle');page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost');page.evaluate('setSettingsCategory("workflow")')
                    check('custom manager has no regime filter or switches',page.locator('[aria-label="筛选采购制度"],[data-regime-toggle]').count()==0)
                    page.evaluate('(id)=>selectProcurementManagerMethod(id)',mid)
                    entry=page.locator('[data-procurement-overview]')
                    check('separate workflow entry is visible',entry.get_by_role('button',name='编辑流程',exact=True).count()==1 and entry.get_by_role('button',name='基本设置',exact=True).count()==1)
                    page.evaluate('document.getAnimations().forEach(a=>a.finish())');page.screenshot(path=str(output/'采购方式总览.png'));shots.append('采购方式总览.png')
                    entry.locator('[data-overview-stage="register"]').click();check('preview stage opens at the selected stage',page.locator('[data-flow-name]').input_value()=='历史报名');page.evaluate('closeModal()');page.wait_for_selector('#modal.open',state='hidden')
                    for theme in ['default','dark','blue','green']:
                        page.evaluate('(theme)=>{updateUiPreference("theme",theme);updateUiPreference("motion","off");}',theme)
                        for width in [1366,900,390]:
                            page.set_viewport_size(dict(width=width,height=900));page.evaluate('closeSidebar()');page.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',mid)
                            field=page.locator('[data-flow-name]');check(f'{theme}/{width} selected stage directly editable',field.is_visible() and field.input_value()=='历史需求核对')
                            check(f'{theme}/{width} centered modal and footer visible',page.locator('#modal').evaluate('(e)=>{const r=e.getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<2&&r.right<=innerWidth&&r.x>=0}') and page.locator('#modalSaveBtn').is_visible())
                            check(f'{theme}/{width} no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+2') and page.locator('#modalBody').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2'))
                            check(f'{theme}/{width} layout fits viewport',page.locator('.shared-stage-workspace').evaluate('(e)=>{const a=e.firstElementChild.getBoundingClientRect(),b=e.lastElementChild.getBoundingClientRect();return innerWidth>700?b.x>=a.right-1:b.y>=a.bottom-1}'))
                            page.locator('[data-flow-select="register"]').click();check(f'{theme}/{width} switching stages opens correct editor',field.input_value()=='历史报名')
                            page.locator('[data-flow-select="first"]').focus();page.keyboard.press('Enter');check(f'{theme}/{width} keyboard can select stage',field.input_value()=='历史需求核对')
                            name=f'流程编辑-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name);page.evaluate('closeModal()');page.wait_for_selector('#modal.open',state='hidden')
                    page.set_viewport_size(dict(width=1366,height=900));page.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',mid)
                    page.locator('[data-flow-name]').fill('方式新需求名称');check('rename updates overview immediately',page.locator('[data-flow-stage="first"] [data-flow-label]').inner_text()=='方式新需求名称')
                    page.get_by_role('button',name='基本设置',exact=True).last.click();page.locator('#pmNotes').fill('保留跨视图草稿');page.get_by_role('button',name='流程阶段',exact=True).click();check('switching settings retains stage draft',page.locator('[data-flow-name]').input_value()=='方式新需求名称')
                    page.locator('[data-flow-select="archive"]').click();page.locator('.shared-stage-actions').get_by_role('button',name='上移',exact=True).click();check('reorder keeps selected stage editor',page.locator('[data-flow-name]').input_value()=='历史归档')
                    page.locator('[data-flow-add]').click();page.locator('[data-flow-name]').fill('补充管理阶段');page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden')
                    saved=next(m for m in client.request('GET','/api/procurement-methods')['methods'] if m['id']==mid)
                    check('workflow persisted names order and new stage',[(r['id'],r['name']) for r in saved['stages'][:3]]==[('first','方式新需求名称'),('archive','历史归档'),('register','历史报名')] and saved['stages'][-1]['name']=='补充管理阶段')
                    check('basic draft saved with flow',saved['notes']=='保留跨视图草稿')
                    check('template save leaves historical project untouched',client.get_project(pid)==before)
                    page.evaluate('showCommonProcurementFlow()');check('common template uses same directly editable layout',page.locator('.shared-stage-workspace').is_visible() and page.locator('[data-flow-name]').is_visible());page.evaluate('closeModal()');page.wait_for_selector('#modal.open',state='hidden')
                    page.evaluate('(pid)=>showProjectWorkflowEditor(pid)',pid);page.wait_for_selector('#projectFlowStages [data-flow-name]');page.locator('[data-flow-name]').fill('尝试改写已完成阶段');page.get_by_role('button',name='预览调整',exact=True).click();page.wait_for_selector('#flowPreview h3');check('completed stage remains protected',page.locator('#flowCommit').is_disabled() and '已完成阶段' in page.locator('#flowPreview').inner_text())
                    check('blocked project edit did not write data',client.get_project(pid)==before)
                    page.evaluate('closeModal()');page.get_by_role('button',name='放弃修改',exact=True).click();page.wait_for_selector('#modal.open',state='hidden')
                    cat=client.request('GET','/api/procurement-methods');legacy=next(m for m in cat['methods'] if not m['regime'] and m['name']=='公开招标');others={m['id']:m for m in cat['methods'] if m['id']!=legacy['id']}
                    page.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',legacy['id'])
                    page.locator('[data-flow-name]').fill('自行维护的原流程');page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden')
                    copied=client.request('GET','/api/procurement-methods');check('original flow edits independently without changing other methods',all(m==others[m['id']] for m in copied['methods'] if m['id']!=legacy['id']) and next(m for m in copied['methods'] if m['id']==legacy['id'])['stages'][0]['name']=='自行维护的原流程')
                    check('original flow edit does not change completed project',client.get_project(pid)==before)
                    page.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',mid);page.set_viewport_size(dict(width=1280,height=720));check('short desktop viewport keeps fields and save visible',page.locator('[data-flow-name]').is_visible() and page.locator('#modalSaveBtn').is_visible());page.screenshot(path=str(output/'流程编辑-矮窗口.png'));shots.append('流程编辑-矮窗口.png');page.evaluate('closeModal()');page.wait_for_selector('#modal.open',state='hidden')
                    check('no browser script errors',not errors)
                finally:context.close();browser.close()
            client.restart();check('workflow survives restart',next(m for m in client.request('GET','/api/procurement-methods')['methods'] if m['id']==mid)==saved)
            check('historical project survives restart unchanged',client.get_project(pid)==before)
            check('license and data-key files unchanged',all(hashlib.sha256((client.data_root/name).read_bytes()).hexdigest()==value for name,value in protected.items()))
        except Exception:
            if 'page' in locals():
                try:page.screenshot(path=str(output/'failure.png'))
                except Exception:pass
            report();raise
        finally:client.stop()
    return report()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--old-exe',type=Path,required=True);p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=verify(a.candidate.resolve(),a.sha256,a.old_exe.resolve(),a.fixtures.resolve(),a.output.resolve());print(json.dumps(dict(passed=result['passed'],total=result['total'],page_errors=result['page_errors'])))
