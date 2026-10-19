"""Verify the review repairs against the actual isolated EXE, upgrading from v47."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,sys,tempfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright

def verify(candidate,old,fixtures,output):
 output.mkdir(parents=True,exist_ok=False);checks=[];errors=[];timings={}
 def check(name,passed):
  checks.append(dict(name=name,passed=bool(passed)))
  if not passed:raise AssertionError(name)
 def report():
  value=dict(passed=sum(x['passed'] for x in checks),total=len(checks),checks=checks,page_errors=errors,switch_timings_ms=timings,sha256=hashlib.sha256(candidate.read_bytes()).hexdigest(),production_data_accessed=False,real_mail_sent=0,native_desktop_verified=False)
  (output/'result.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8');return value
 with tempfile.TemporaryDirectory(prefix='review-repairs-owned-') as tmp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
  c=PackagedClient(old,Path(tmp),'review',unused_port())
  try:
   c.start();c.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False,reminder_recipient_groups=[]))
   def add(name,**extra):return c.request('POST','/api/procurement-methods',dict(name=name,revision=c.request('GET','/api/procurement-methods')['revision'],**extra))['method']
   rows=[dict(id='review_'+str(i),name=f'第{i+1}阶段：业务资料核对',icon='📋',modules=['common','checklist']) for i in range(35)]
   method=add('流程配置审查样本',template_mode='independent',stages=rows,exceptions=[dict(title='经核对的例外',description='隔离审查样本',enabled=True,quantity_rule=dict(mode='unfixed',minimum=None))]);mid=method['id']
   # Preserve historical same-name configurations exactly, without exposing regimes in normal UI.
   a=add('同名历史样本',regime='enterprise');b=add('同名历史样本',regime='collective')
   project=c.request('POST','/api/projects',dict(name='既有流程保护样本',number='REVIEW-OLD',procurement_method_id=mid,no_deposit=True,year=2026));pid=project['id'];before=c.get_project(pid);cat_before=c.request('GET','/api/procurement-methods')
   protected={name:hashlib.sha256((c.data_root/name).read_bytes()).hexdigest() for name in ['license.dat','data_key.dpapi']}
   c.stop();shutil.copy2(candidate,c.executable);c.start()
   check('v47 upgrade leaves methods and stage templates unchanged',c.request('GET','/api/procurement-methods')==cat_before)
   check('v47 upgrade leaves existing project unchanged',c.get_project(pid)==before)
   with sync_playwright() as pw:
    browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');ctx=browser.new_context(viewport=dict(width=1366,height=900),locale='zh-CN',timezone_id='Asia/Shanghai');ctx.add_cookies([dict(name=x.name,value=x.value,url=c.base_url) for x in c.session.cookies]);p=ctx.new_page();p.on('pageerror',lambda e:errors.append(str(e)))
    try:
     p.goto(c.base_url,wait_until='networkidle');p.evaluate('switchView("settings")');p.wait_for_selector('#appearancePreferencesHost',state='attached');p.evaluate('setSettingsCategory("workflow")');p.evaluate('updateUiPreference("motion","off")');p.evaluate('(id)=>selectProcurementManagerMethod(id)',mid)
     check('long-flow management actions available near the summary',p.locator('.procurement-method-actions').evaluate('(e)=>e.getBoundingClientRect().bottom<=innerHeight') and p.locator('.procurement-method-actions').get_by_role('button',name='删除',exact=True).is_disabled())
     check('switching methods preserves list DOM and pressed states',p.evaluate('([a,b])=>{const list=document.querySelector(".procurement-method-list"),button=list.querySelector(`[data-method-id="${a}"] button`);selectProcurementManagerMethod(b);return list.isConnected&&button.isConnected&&button.getAttribute("aria-pressed")==="false"}',[mid,a['id']]))
     timings['candidate']=p.evaluate('([a,b])=>{const samples=[];for(let i=0;i<20;i++){const t=performance.now();selectProcurementManagerMethod(i%2?a:b);samples.push(performance.now()-t)}samples.sort((a,b)=>a-b);return {median:samples[10],p95:samples[18],maximum:samples[19]}}',[mid,a['id']])
     for theme in ['default','dark','blue','green']:
      p.evaluate('(t)=>updateUiPreference("theme",t)',theme);p.evaluate('(id)=>selectProcurementManagerMethod(id)',mid);p.screenshot(path=str(output/f'采购方式摘要-{theme}.png'))
      p.evaluate('(id)=>showProcurementMethodForm(id,{view:"flow"})',mid)
      for width,height in [(1366,900),(900,900),(390,844)]:
       p.set_viewport_size(dict(width=width,height=height));p.evaluate('document.getAnimations().forEach(a=>a.finish())')
       check(f'{theme}/{width} centered dialog without overflow',p.locator('#modal').evaluate('(e)=>{const r=e.getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<2&&document.getElementById("modalBody").scrollWidth<=document.getElementById("modalBody").clientWidth+2}'))
       check(f'{theme}/{width} save and selected stage visible',p.locator('#modalSaveBtn').is_visible() and p.locator('[data-flow-name]').is_visible())
       p.screenshot(path=str(output/f'流程编辑-{theme}-{width}.png'))
      p.evaluate('closeModal()');p.wait_for_selector('#modal.open',state='hidden');p.set_viewport_size(dict(width=1366,height=900))
     # Actual ordinary user, not only simulated readonly UI.
     user=c.request('POST','/api/users',dict(username='reviewreader',password='Reader-Review-2026!',is_admin=False))
     reader_context=browser.new_context(viewport=dict(width=1366,height=900));reader=reader_context.new_page();reader.goto(c.base_url+'/login',wait_until='networkidle');reader.locator('input[name="username"]').fill('reviewreader');reader.locator('input[name="password"]').fill('Reader-Review-2026!');reader.locator('button[type="submit"]').click();reader.wait_for_load_state('networkidle')
     reader.evaluate('switchView("settings")');reader.wait_for_selector('#appearancePreferencesHost',state='attached');reader.evaluate('setSettingsCategory("workflow")');reader.evaluate('(id)=>showProcurementMethodForm(id)',mid)
     check('ordinary user sees only disabled exception fields',reader.locator('#pmExceptions input:not(:disabled),#pmExceptions select:not(:disabled),#pmExceptions textarea:not(:disabled),#pmExceptions button:not(:disabled)').count()==0 and reader.locator('#modalSaveBtn').count()==0)
     check('ordinary user cannot submit method changes',reader.evaluate('(id)=>fetch("/api/procurement-methods/"+id,{method:"PATCH",headers:{"Content-Type":"application/json","X-CSRFToken":window.CSRF_TOKEN},body:JSON.stringify({revision:1,notes:"禁止写入"})}).then(r=>r.status)',mid)==403)
     reader_context.close()
     # Restore administrator browser cookies because both tabs share this context.
     ctx.clear_cookies();ctx.add_cookies([dict(name=x.name,value=x.value,url=c.base_url) for x in c.session.cookies]);p.reload(wait_until='networkidle');p.evaluate('switchView("settings")');p.wait_for_selector('#appearancePreferencesHost',state='attached');p.evaluate('setSettingsCategory("workflow")')
     p.evaluate('showProcurementMethodForm()');p.locator('#pmName').fill('数量校验实际样本');p.locator('#pmQuantityMode').select_option('fixed');p.locator('#pmMinimum').fill('0');p.get_by_role('button',name='流程阶段',exact=True).click();p.locator('#modalSaveBtn').click()
     check('invalid minimum reveals and focuses correct field',p.locator('#pmSettingsPanel').is_visible() and p.locator('#pmMinimum').evaluate('(e)=>e===document.activeElement&&e.getAttribute("aria-invalid")==="true"') and p.locator('.field-error').count()>0)
     p.locator('#pmQuantityMode').select_option('unfixed');p.locator('#pmForm details').first.locator('summary').click();p.get_by_role('button',name='新增例外',exact=True).click();check('adding exception immediately marks unsaved draft','未保存' in p.locator('#pmDraftStatus').inner_text());check('unfixed exception minimum hidden',p.locator('[data-exception-minimum]').is_hidden())
     p.locator('[data-exception-field="title"]').fill('例外样本');p.locator('[data-exception-field="description"]').fill('');p.get_by_role('button',name='流程阶段',exact=True).click();p.locator('#modalSaveBtn').click()
     check('invalid exception is expanded and focused',p.locator('#pmExceptionDescription0').evaluate('(e)=>document.activeElement===e&&e.closest("details").open') and p.locator('#pmSettingsPanel').is_visible())
     p.screenshot(path=str(output/'例外校验与字段定位.png'));p.get_by_role('button',name='移除例外',exact=True).click()
     # A real committed POST with an injected catalog GET failure.
     def intercept(route):
      if route.request.method=='GET':route.fulfill(status=503,content_type='application/json',body='{"error":"隔离验证：刷新失败"}')
      else:route.continue_()
     p.locator('#pmName').fill('已保存刷新失败实际样本');p.route('**/api/procurement-methods',intercept);p.locator('#modalSaveBtn').click();p.wait_for_function('document.getElementById("pmSaveStatus").textContent.includes("暂未刷新")')
     check('committed create shows saved warning rather than error',p.locator('#pmFormError').is_hidden() and p.locator('#pmSaveStatus').is_visible())
     saved=next(m for m in c.request('GET','/api/procurement-methods')['methods'] if m['name']=='已保存刷新失败实际样本');revision=saved['revision'];p.locator('#modalSaveBtn').click();p.wait_for_function('!document.getElementById("modalSaveBtn").disabled')
     check('unchanged retry does not write a second create or revision',next(m for m in c.request('GET','/api/procurement-methods')['methods'] if m['id']==saved['id'])['revision']==revision)
     p.screenshot(path=str(output/'已保存但刷新失败.png'));p.unroute('**/api/procurement-methods',intercept);p.locator('#pmSaveStatus').get_by_role('button',name='重试刷新',exact=True).click();p.wait_for_function('document.getElementById("pmSaveStatus").textContent.includes("已刷新")');check('explicit retry refreshes without resubmission',next(m for m in c.request('GET','/api/procurement-methods')['methods'] if m['id']==saved['id'])['revision']==revision);p.locator('#modalSaveBtn').click();p.wait_for_selector('#modal.open',state='hidden')
     labels=p.evaluate('([a,b])=>[a,b].map(id=>procurementMethodLabel(procurementCatalog().methods.find(m=>m.id===id)))',[a['id'],b['id']]);cat=c.request('GET','/api/procurement-methods');c.request('POST','/api/procurement-methods/reorder',dict(ids=[m['id'] for m in reversed(cat['methods'])],revision=cat['revision']));p.evaluate('loadProcurementCatalog({refresh:true}).then(refreshProcurementManager)')
     check('same-name historical labels stable after sorting',p.evaluate('([a,b])=>[a,b].map(id=>procurementMethodLabel(procurementCatalog().methods.find(m=>m.id===id)))',[a['id'],b['id']])==labels)
     check('no browser script errors',not errors)
    finally:ctx.close();browser.close()
   c.restart();check('created method and original project survive restart',c.get_project(pid)==before and any(m['id']==saved['id'] for m in c.request('GET','/api/procurement-methods')['methods']))
   check('license and data key unchanged',all(hashlib.sha256((c.data_root/name).read_bytes()).hexdigest()==value for name,value in protected.items()))
  except Exception:report();raise
  finally:c.stop()
 return report()

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--old-exe',type=Path,required=True);p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args();r=verify(a.candidate.resolve(),a.old_exe.resolve(),a.fixtures.resolve(),a.output.resolve());print(json.dumps(dict(passed=r['passed'],total=r['total'],page_errors=r['page_errors'])))

