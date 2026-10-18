"""Replay F01-F05/U01-U02 against a hash-pinned EXE with fictional owned data."""
from __future__ import annotations
import argparse,hashlib,json,os,sys,tempfile
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright

HOLD="""({method,suffix})=>{
 window.reviewOriginal=api;window.reviewDone=false;window.reviewHeld=false;
 api=async function(...args){
  if(!reviewHeld&&args[0]===method&&String(args[1]).endsWith(suffix)){
   reviewHeld=true;const frozen=JSON.parse(JSON.stringify(args));
   await new Promise(r=>window.reviewRelease=r);
   try{return await reviewOriginal(...frozen);}finally{reviewDone=true;}
  }return reviewOriginal(...args);
 };
}"""

def verify(candidate,sha,fixtures,output):
    if hashlib.sha256(candidate.read_bytes()).hexdigest()!=sha:raise ValueError('Candidate checksum differs')
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[];shots=[]
    def check(name,value):
        checks.append(dict(name=name,passed=bool(value)))
        if not value:raise AssertionError(name)
    def report():
        value=dict(passed=sum(x['passed'] for x in checks),total=len(checks),checks=checks,page_errors=errors,screenshots=shots,sha256=sha,native_desktop_verified=False,real_mail_sent=0,original_business_data_accessed=False)
        (output/'result.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),'utf8');return value
    with tempfile.TemporaryDirectory(prefix='flow-review-owned-') as folder,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        c=PackagedClient(candidate,Path(folder),'owned',unused_port())
        try:
            c.start();c.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False,reminder_recipient_groups=[]))
            def cat():return c.request('GET','/api/procurement-methods')
            def method(mid):return next(m for m in cat()['methods'] if m['id']==mid)
            rows=[dict(id='start',name='需求核对',icon='📥',modules=['common','checklist']),dict(id='end',name='归档',icon='📦',modules=['common','archive'])]
            def create(regime):return c.request('POST','/api/procurement-methods',dict(name='审查同名方式',regime=regime,revision=cat()['revision'],template_mode='independent',stages=rows))['method']
            a=create('enterprise');b=create('collective')
            p=c.request('POST','/api/projects',dict(number='REVIEW-OWNED',name='隔离历史保护项目',procurement_method_id=a['id'],no_deposit=True,year=2026));pid=p['id'];before=c.get_project(pid)
            old=next(m for m in cat()['methods'] if m['name']=='公开招标' and not m['regime'])
            reference=next(m for m in cat()['methods'] if m['name']=='公开招标' and m['regime']=='government_procurement');reference_before=method(reference['id'])
            with sync_playwright() as pw:
                browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                ctx=browser.new_context(viewport=dict(width=1366,height=900),locale='zh-CN');ctx.add_cookies([dict(name=x.name,value=x.value,url=c.base_url) for x in c.session.cookies]);page=ctx.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                def shot(name):page.screenshot(path=str(output/name));shots.append(name)
                def release():
                    page.evaluate('reviewRelease()');page.wait_for_function('reviewDone');page.wait_for_load_state('networkidle');page.evaluate('()=>{api=reviewOriginal;}')
                try:
                    page.goto(c.base_url,wait_until='networkidle');page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost');page.evaluate('setSettingsCategory("workflow");updateUiPreference("motion","off")')
                    page.evaluate('(id)=>showProcurementMethodForm(id)',a['id']);page.locator('#pmNotes').fill('A的原提交');page.evaluate(HOLD,dict(method='PATCH',suffix='/'+a['id']));page.locator('#modalSaveBtn').click();page.wait_for_function('reviewHeld')
                    page.locator('#modalFooter').get_by_role('button',name='取消',exact=True).click();page.wait_for_selector('#confirmOk');check('F01 close explains submitted request cannot be revoked','不会撤销已提交' in page.locator('#confirmOk').evaluate('(e)=>e.closest(".confirm-dialog")?.textContent||document.body.textContent'))
                    page.locator('#confirmOk').click();page.wait_for_selector('#modal.open',state='hidden');page.locator(f'[data-method-id="{b["id"]}"]').get_by_role('button',name='基本设置',exact=True).click();page.locator('#pmName').fill('B的新名称');page.locator('#pmNotes').fill('B的草稿');release()
                    check('F01 late response keeps B identity',page.evaluate('procurementForm.id')==b['id']);check('F01 B draft remains visible',page.locator('#pmName').input_value()=='B的新名称' and page.locator('#pmNotes').input_value()=='B的草稿');shot('01-延迟保存后保持正确对象.png')
                    page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden');check('F01 next save writes B only',method(b['id'])['name']=='B的新名称' and method(a['id'])['name']==a['name'] and method(a['id'])['notes']=='A的原提交')
                    check('F01 existing project unchanged after method saves',c.get_project(pid)==before)
                    page.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',old['id']);page.locator('[data-flow-name]').fill('维护旧流程的新阶段名');page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden')
                    check('F03 pending method workflow saved without forced classification',method(old['id'])['regime'] is None and method(old['id'])['stages'][0]['name']=='维护旧流程的新阶段名');check('F03 reference and historical project unchanged',method(reference['id'])==reference_before and c.get_project(pid)==before)
                    page.evaluate('(id)=>showProcurementMethodForm(id)',old['id']);page.locator('#pmRegime').select_option('government_procurement');page.wait_for_selector('#pmIdentityConflict:not([hidden])');page.locator('#pmIdentityConflict summary').click();shot('02-旧配置分类冲突与流程对比.png')
                    check('F04 duplicate comparison identifies current and reference flows',page.locator('#pmIdentityConflict').inner_text().find('维护旧流程的新阶段名')>=0 and '现有同名方式流程' in page.locator('#pmIdentityConflict').inner_text())
                    check('F04 disabling is not described as resolving uniqueness','停用仍会保留名称' in page.locator('#pmIdentityConflict').inner_text());check('F04 no automatic rename or merge',page.locator('#pmName').input_value()=='公开招标' and method(old['id'])['regime'] is None and method(reference['id'])==reference_before)
                    page.get_by_role('button',name='保留待确认并维护旧流程',exact=True).click();check('F04 keep-pending route preserves workflow and regime',page.locator('#pmRegime').input_value()=='' and page.locator('[data-flow-name]').input_value()=='维护旧流程的新阶段名')
                    page.get_by_role('button',name='基本设置',exact=True).last.click();page.locator('#pmName').fill('公开招标（原配置维护）');page.locator('#pmRegime').select_option('government_procurement');page.get_by_role('button',name='流程阶段',exact=True).click()
                    check('F05 heading and regime follow unsaved draft','公开招标（原配置维护）' in page.locator('#pmFlowHeading').inner_text() and '政府采购' in page.locator('#pmFlowContext').inner_text() and '未保存' in page.locator('#pmDraftStatus').inner_text())
                    icon=page.locator('[data-flow-icon]');check('U01 closed picker shows named SVG',icon.locator('..').locator('.pm-icon-select-preview svg').count()==1 and icon.locator('..').locator('.pm-icon-select-preview').inner_text().strip()=='接收')
                    icon.focus();page.keyboard.press('ArrowDown');check('U01 open picker options have matching SVGs and names',page.locator('.themed-select-option svg').count()>1 and '接收' in page.locator('.themed-select-popup').inner_text());page.keyboard.press('ArrowDown');page.keyboard.press('Enter');check('U01 keyboard selection retains glyph value and preview',icon.input_value()!='📥' and icon.locator('..').locator('svg').count()==1);shot('03-同步标题与图标.png')
                    page.locator('#modalSaveBtn').click();page.wait_for_selector('#modal.open',state='hidden');check('F04 explicit rename and classification save without altering reference',method(old['id'])['regime']=='government_procurement' and method(old['id'])['name']=='公开招标（原配置维护）' and method(reference['id'])==reference_before)
                    page.evaluate('(pid)=>showProjectWorkflowEditor(pid)',pid);page.wait_for_selector('#projectFlowStages [data-flow-name]');page.locator('[data-flow-name]').fill('第一次提交的项目阶段');page.get_by_role('button',name='预览调整',exact=True).click();page.wait_for_selector('#flowPreview h3');page.evaluate(HOLD,dict(method='POST',suffix='/workflow/commit'));page.locator('#flowCommit').click();page.wait_for_function('reviewHeld');page.locator('[data-flow-name]').fill('保存期间新增的修改');release()
                    check('F02 later draft retained in open dialog',page.locator('#modal.open').count()==1 and page.locator('[data-flow-name]').input_value()=='保存期间新增的修改');check('F02 actual saved content is first submitted content',c.get_project(pid)['stages'][0]['name']=='第一次提交的项目阶段');check('F02 later draft requires repreview with explicit notice',page.locator('#flowCommit').is_disabled() and '新修改' in page.locator('#flowError').inner_text());shot('04-保存期间新草稿保留.png')
                    page.get_by_role('button',name='预览调整',exact=True).click();page.wait_for_function('!document.getElementById("flowCommit").disabled');page.locator('#flowCommit').click();page.wait_for_selector('#modal.open',state='hidden');check('F02 later draft saves after fresh preview',c.get_project(pid)['stages'][0]['name']=='保存期间新增的修改')
                    common=c.request('POST','/api/procurement-methods',dict(name='隔离共享模板引用',regime='other',revision=cat()['revision'],template_mode='common'))['method'];page.evaluate('loadProcurementCatalog({refresh:true})');page.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',common['id']);page.locator('[data-common-consumers] summary').click();check('U02 consumer list and shared semantics visible','隔离共享模板引用' in page.locator('[data-common-consumers]').inner_text() and '共享模板' in page.locator('#pmFlowRelation').inner_text());shot('05-共享模板引用说明.png')
                    check('U02 no unintended historical project rewrite',c.get_project(pid)['stages'][0]['name']=='保存期间新增的修改');check('no browser script errors',not errors)
                except Exception:
                    shot('failure.png');raise
                finally:ctx.close();browser.close()
            finalcat=cat();finalproject=c.get_project(pid);c.restart();check('catalog and intentional project edits survive restart',cat()==finalcat and c.get_project(pid)==finalproject)
        except Exception:report();raise
        finally:c.stop()
    return report()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();r=verify(a.candidate.resolve(),a.sha256,a.fixtures.resolve(),a.output.resolve());print(json.dumps(dict(passed=r['passed'],total=r['total'],page_errors=r['page_errors'])))
