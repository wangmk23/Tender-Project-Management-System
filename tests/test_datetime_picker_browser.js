'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const acorn=require('acorn');
const root=path.resolve(__dirname,'..');
const script=path.join(root,'source/frontend/17-datetime-picker.js');
async function browser(){const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';return chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});}
async function setup(browser,theme,width,values=['2026-10-12','17:30']){
 const page=await browser.newPage({viewport:{width,height:844}});
 await page.setContent(`<style>${fs.readFileSync(path.join(root,'src/static/style.css'),'utf8').replace(/^\uFEFF/,'')}</style><main style="padding:20px;max-width:510px"><label for="date">计划时间</label><div class="stage-minute-pair"><input id="date" type="date" value="${values[0]}"><input id="time" type="time" value="${values[1]}"></div><button id="after">后续操作</button></main>`);
 await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;window.saves=[];document.getElementById('date').onchange=document.getElementById('time').onchange=()=>saves.push([date.value,time.value]);},theme);
 await page.addScriptTag({content:fs.existsSync(script)?fs.readFileSync(script,'utf8'):'/* picker not implemented */'});
 return page;
}
test('date, hour and minute open together in a themed panel, with atomic save and cancel',async()=>{
 const b=await browser();
 try{for(const theme of ['default','dark'])for(const width of [1366,390]){
  const page=await setup(b,theme,width);const errors=[];page.on('pageerror',e=>errors.push(e.message));
  assert.equal(await page.locator('.pm-datetime-trigger').count(),1,'one combined date/time trigger');
  assert.equal(await page.locator('#date').isVisible(),false,'native calendar must not open');
  await page.locator('.pm-datetime-trigger').click();
  await page.locator('.pm-datetime-popup').waitFor();
  assert.equal(await page.locator('.pm-datetime-days button').count(),42);
  assert.equal(await page.locator('[data-time-part="hour"] button').count(),24);
  assert.equal(await page.locator('[data-time-part="minute"] button').count(),60);
  const bounds=await page.locator('.pm-datetime-popup').evaluate(el=>{const r=el.getBoundingClientRect();return {within:r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth+1,bg:getComputedStyle(el).backgroundColor};});
  assert.ok(bounds.within);assert.equal(bounds.overflow,false);assert.notEqual(bounds.bg,'rgba(0, 0, 0, 0)');
  const surface=await page.locator('.pm-datetime-popup').evaluate(el=>{
   document.documentElement.style.setProperty('--surface-raised','rgba(20,30,40,.6)');
   const c=getComputedStyle(el),p=getComputedStyle(el.querySelector('.btn-primary'));
   return {background:c.backgroundColor,primary:p.backgroundColor};
  });
  assert.ok(!surface.background.startsWith('rgba('),'popup remains opaque over glass-themed surfaces');
  await page.locator('[data-date="2026-10-13"]').click();await page.locator('[data-hour="09"]').click();await page.locator('[data-minute="28"]').click();
  assert.deepEqual(await page.evaluate(()=>[date.value,time.value,saves.length]),['2026-10-12','17:30',0],'draft does not autosave');
  await page.getByRole('button',{name:'确定',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>[date.value,time.value,saves]),['2026-10-13','09:28',[['2026-10-13','09:28']]],'date and minute saved together once');
  await page.locator('.pm-datetime-trigger').click();await page.locator('[data-minute="07"]').click();await page.keyboard.press('Escape');
  assert.equal(await page.locator('.pm-datetime-popup').count(),0);assert.equal(await page.evaluate(()=>time.value),'09:28');assert.equal(await page.locator('.pm-datetime-trigger').evaluate(el=>el===document.activeElement),true);
  assert.deepEqual(errors,[]);await page.close();
 }}finally{await b.close();}
});
test('date-only records, leap days, clearing, disabled controls and dynamically created batch rows',async()=>{
 const b=await browser();try{
  const page=await setup(b,'dark',390,['2024-02-28','']);
  await page.locator('.pm-datetime-trigger').click();await page.locator('[data-date="2024-02-29"]').click();await page.getByRole('button',{name:'确定',exact:true}).click();
  assert.deepEqual(await page.evaluate(()=>[date.value,time.value]),['2024-02-29',''],'legacy date-only remains date-only');
  await page.locator('.pm-datetime-trigger').click();await page.getByRole('button',{name:'清除',exact:true}).click();await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(await page.evaluate(()=>date.value),'2024-02-29');
  await page.locator('.pm-datetime-trigger').click();await page.getByRole('button',{name:'清除',exact:true}).click();await page.getByRole('button',{name:'确定',exact:true}).click();assert.deepEqual(await page.evaluate(()=>[date.value,time.value]),['','']);
  await page.evaluate(()=>{date.disabled=true;time.disabled=true;});await page.waitForFunction(()=>document.querySelector('.pm-datetime-trigger').disabled);
  await page.evaluate(()=>document.body.insertAdjacentHTML('beforeend','<div id="batchDateList"><label class="batch-plan-row"><input type="checkbox" id="cb"><span>阶段</span><div class="stage-minute-pair"><input type="date" class="bd-at" value="2026-10-12"><input type="time" class="bd-time" value="17:30"></div></label></div>'));
  const trigger=page.locator('#batchDateList .pm-datetime-trigger');await trigger.waitFor();await trigger.click();assert.equal(await page.locator('#cb').isChecked(),false,'opening picker does not toggle enclosing row');
  await page.getByRole('button',{name:'确定',exact:true}).click();await page.close();
 }finally{await b.close();}
});
test('keyboard focus, stale drafts, remounted forms and short windows keep the underlying form intact',async()=>{
 const b=await browser();try{
  const page=await setup(b,'dark',390);await page.setViewportSize({width:390,height:480});
  await page.evaluate(()=>document.querySelector('main').style.marginTop='350px');
  await page.locator('.pm-datetime-trigger').click();
  const box=await page.locator('.pm-datetime-popup').boundingBox();assert.ok(box.y>=0&&box.y+box.height<=480);
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-date="2026-10-13"]').getAttribute('aria-selected'),'true');
  await page.getByRole('button',{name:'确定',exact:true}).focus();await page.keyboard.press('Tab');assert.equal(await page.getByRole('button',{name:'关闭日期时间选择'}).evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.getByRole('button',{name:'确定',exact:true}).evaluate(el=>el===document.activeElement),true);
  await page.locator('[data-hour="18"]').focus();await page.keyboard.press('ArrowDown');assert.equal(await page.locator('[data-hour="19"]').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Escape');assert.deepEqual(await page.evaluate(()=>[date.value,time.value,saves.length]),['2026-10-12','17:30',0]);
  await page.locator('.pm-datetime-trigger').click();await page.locator('[data-minute="08"]').click();
  await page.evaluate(()=>{date.value='2026-11-11';time.value='11:11';});await page.getByRole('button',{name:'确定',exact:true}).click();assert.deepEqual(await page.evaluate(()=>[date.value,time.value,saves.length]),['2026-11-11','11:11',0],'stale draft cannot overwrite external update');
  await page.locator('.pm-datetime-trigger').click();await page.evaluate(()=>document.querySelector('.stage-minute-pair').remove());await page.waitForFunction(()=>!document.querySelector('.pm-datetime-popup'));
  await page.close();
 }finally{await b.close();}
});
test('picker participates in the real application modal focus manager',async()=>{
 const b=await browser();try{
  const page=await setup(b,'dark',1366);
  const source=fs.readFileSync(path.join(root,'source/frontend/01-core.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'source/frontend/09-command-center.js'),'utf8');
  const names=new Set(['topManagedDialog','dialogControls','focusDialogStart','handleDialogFocus','activateDialogFocus','releaseDialogFocus','focusSafely','focusFallback']);
  const functions=acorn.parse(source,{ecmaVersion:'latest'}).body.filter(node=>node.type==='FunctionDeclaration'&&names.has(node.id.name)).map(node=>source.slice(node.start,node.end)).join('\n');
  await page.addScriptTag({content:'const dialogFocusStack=[];let dialogFocusListenersReady=false;\n'+functions});
  await page.evaluate(()=>{const modal=document.querySelector('main');modal.classList.add('open');activateDialogFocus(modal,()=>modal.classList.remove('open'));});
  await page.locator('.pm-datetime-trigger').click();assert.equal(await page.locator('.pm-datetime-popup').evaluate(el=>el.contains(document.activeElement)),true,'parent modal cannot steal popup focus');
  await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-date="2026-10-13"]').getAttribute('aria-selected'),'true');
  await page.keyboard.press('Escape');assert.equal(await page.locator('.pm-datetime-popup').count(),0);assert.equal(await page.locator('main').getAttribute('class'),'open');
  assert.equal(await page.locator('.pm-datetime-trigger').evaluate(el=>el===document.activeElement),true);await page.close();
 }finally{await b.close();}
});
test('programmatically closing the stage panel also removes its date popup',async()=>{
 const b=await browser();try{
  const page=await setup(b,'dark',1366);await page.evaluate(()=>document.querySelector('main').className='slide-panel open');
  await page.locator('.pm-datetime-trigger').click();assert.equal(await page.locator('.pm-datetime-popup').count(),1);
  await page.evaluate(()=>document.querySelector('main').classList.remove('open'));await page.waitForTimeout(100);
  assert.equal(await page.locator('.pm-datetime-popup').count(),0);assert.equal(await page.evaluate(()=>saves.length),0);await page.close();
 }finally{await b.close();}
});
