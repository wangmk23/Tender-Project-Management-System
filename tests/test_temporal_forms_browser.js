'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
async function browser(){const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';return chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});}
async function pageFor(b,markup,theme='default',width=1366){
 const p=await b.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
 await p.setContent(`<style>${fs.readFileSync(path.join(root,'src/static/style.css'),'utf8').replace(/^\uFEFF/,'')}</style><main style="padding:20px;max-width:510px">${markup}</main>`);
 await p.evaluate(t=>{document.documentElement.dataset.theme=t;window.changes=[];document.querySelectorAll('input').forEach(i=>i.addEventListener('change',()=>changes.push([i.id,i.value])));},theme);
 for(const file of ['00-icons.js','17-datetime-picker.js']) await p.addScriptTag({content:fs.readFileSync(path.join(root,'source/frontend',file),'utf8')});
 return p;
}
async function confirm(p){await p.getByRole('button',{name:'确定',exact:true}).click();}

test('registration and other date-only fields use the shared calendar without adding a time',async()=>{
 const b=await browser();try{for(const theme of ['default','dark'])for(const width of [1366,390]){
  const p=await pageFor(b,'<label for="regDate">获取日期</label><input type="date" id="regDate" value="2026-10-14">',theme,width);
  assert.equal(await p.locator('.pm-datetime-trigger').count(),1);
  assert.equal(await p.locator('#regDate').isVisible(),false);
  await p.locator('.pm-datetime-trigger').click();assert.equal(await p.locator('.pm-datetime-days button').count(),42);
  assert.equal(await p.locator('.pm-datetime-time').count(),0);
  await p.locator('[data-date="2026-10-15"]').click();assert.equal(await p.evaluate(()=>regDate.value),'2026-10-14');
  await confirm(p);assert.deepEqual(await p.evaluate(()=>[regDate.value,changes]),['2026-10-15',[['regDate','2026-10-15']]]);
  await p.locator('.pm-datetime-trigger').click();await p.locator('[data-date="2026-10-16"]').click();await p.keyboard.press('Escape');
  assert.equal(await p.evaluate(()=>regDate.value),'2026-10-15');await p.close();
 }}finally{await b.close();}
});

test('mail send time uses themed hour and minute lists without a date',async()=>{
 const b=await browser();try{
  const p=await pageFor(b,'<label for="reminderTime">发送时间</label><input type="time" id="reminderTime" value="09:00">','dark',390);
  assert.equal(await p.locator('.pm-datetime-trigger').count(),1);await p.locator('.pm-datetime-trigger').click();
  assert.equal(await p.locator('.pm-datetime-calendar').count(),0);
  await p.locator('[data-hour="08"]').click();await p.locator('[data-minute="37"]').click();await confirm(p);
  assert.deepEqual(await p.evaluate(()=>[reminderTime.value,changes]),['08:37',[['reminderTime','08:37']]]);await p.close();
 }finally{await b.close();}
});

test('business timestamps retain seconds and native datetime-local format',async()=>{
 const b=await browser();try{
  const p=await pageFor(b,'<label for="quote">平台实际报价时间</label><input type="datetime-local" step="1" id="quote" value="2026-10-14T11:23:45">');
  assert.equal(await p.locator('.pm-datetime-trigger').count(),1);await p.locator('.pm-datetime-trigger').click();
  await p.locator('[data-date="2026-10-15"]').click();await confirm(p);
  assert.equal(await p.evaluate(()=>quote.value),'2026-10-15T11:23:45');
  await p.locator('.pm-datetime-trigger').click();await p.locator('[data-minute="28"]').click();await p.locator('[data-second="12"]').click();await confirm(p);
  assert.equal(await p.evaluate(()=>quote.value),'2026-10-15T11:28:12');await p.close();
 }finally{await b.close();}
});

test('standalone constraints, read-only fields, dynamic rows and programmatic fills are honored',async()=>{
 const b=await browser();try{
  const p=await pageFor(b,'<label for="date">回复日期</label><input type="date" id="date" min="2026-10-14" max="2026-10-16" value="2026-10-14">');
  assert.equal(await p.locator('.pm-datetime-trigger').count(),1);await p.locator('.pm-datetime-trigger').click();
  assert.equal(await p.locator('[data-date="2026-10-13"]').isDisabled(),true);
  await p.keyboard.press('Escape');await p.evaluate(()=>date.readOnly=true);
  await p.waitForFunction(()=>document.querySelector('.pm-datetime-trigger').disabled);
  await p.evaluate(()=>document.querySelector('main').insertAdjacentHTML('beforeend','<div class="form-grid-2"><input type="datetime-local" id="other" value="2026-10-14T09:00"></div>'));
  await p.waitForFunction(()=>document.querySelectorAll('.pm-datetime-trigger').length===2);
  await p.evaluate(()=>{other.value='2026-10-15T12:34';PMDateTime.refresh();});
  assert.match(await p.locator('.pm-datetime-trigger').nth(1).innerText(),/2026-10-15.*12:34/);
  await p.locator('.pm-datetime-trigger').nth(1).click();await p.evaluate(()=>other.disabled=true);
  await p.waitForFunction(()=>!document.querySelector('.pm-datetime-popup'));await p.close();
 }finally{await b.close();}
});

test('calendar and navigation SVGs are centered in real icon-theme controls',async()=>{
 const b=await browser();try{for(const theme of ['default','dark']){
  const p=await pageFor(b,'<label for="date">完成时间</label><div class="stage-minute-pair"><input id="date" type="date" value="2026-10-14"><input type="time" value="11:23"></div>',theme);
  await p.locator('.pm-datetime-trigger').click();
  for(const selector of ['.pm-datetime-trigger','.pm-datetime-month button:first-child','.pm-datetime-month button:last-child','.pm-datetime-close']){
   const center=await p.locator(selector).evaluate(el=>{const svg=el.querySelector('svg');if(!svg)return null;const a=el.getBoundingClientRect(),s=svg.getBoundingClientRect();return {dy:Math.abs((a.top+a.bottom-s.top-s.bottom)/2),dx:Math.abs((a.left+a.right-s.left-s.right)/2),height:s.height};});
   assert.ok(center,selector+' has SVG');assert.ok(center.dy<=.5,selector+' is vertically centered');
   if(selector!=='.pm-datetime-trigger')assert.ok(center.dx<=.5,selector+' is horizontally centered');
  }
  await p.close();
 }}finally{await b.close();}
});

test('shared form modal clips header and footer surfaces to its themed rounded frame',async()=>{
 const b=await browser();try{for(const theme of ['default','dark']){
  const p=await pageFor(b,'<div class="modal open" id="modal"><div class="modal-header"><h3>新增报名</h3></div><div class="modal-body"><div class="modal-form"><label>获取日期</label><input type="date"></div></div><div class="modal-footer"><button class="btn btn-primary">保存</button></div></div>',theme,390);
  const box=await p.locator('#modal').evaluate(el=>{const s=getComputedStyle(el);return {overflow:s.overflowX,radius:parseFloat(s.borderTopLeftRadius),surface:s.backgroundColor,bodyOverflow:getComputedStyle(el.querySelector('.modal-body')).overflowY};});
  assert.equal(box.overflow,'hidden');assert.ok(box.radius>=12);assert.equal(box.bodyOverflow,'auto');
  await p.close();
 }}finally{await b.close();}
});

test('invalid time bounds and required clearing do not write backing fields',async()=>{
 const b=await browser();try{
  const p=await pageFor(b,'<input id="bound" type="datetime-local" min="2026-10-14T09:00" value="2026-10-14T10:00"><input id="required" type="date" required value="2026-10-14">');
  await p.locator('.pm-datetime-trigger').first().click();await p.locator('[data-hour="08"]').click();await confirm(p);
  assert.equal(await p.evaluate(()=>bound.value),'2026-10-14T10:00');
  assert.equal(await p.locator('.pm-datetime-popup').count(),1);
  assert.ok((await p.locator('.pm-datetime-summary').innerText()).length>0);
  await p.keyboard.press('Escape');await p.locator('.pm-datetime-trigger').nth(1).click();await p.getByRole('button',{name:'清除',exact:true}).click();await confirm(p);
  assert.equal(await p.evaluate(()=>required.value),'2026-10-14');assert.deepEqual(await p.evaluate(()=>changes),[]);
  await p.close();
 }finally{await b.close();}
});

test('fractional seconds and narrow second-aware pickers retain precision and fit the screen',async()=>{
 const b=await browser();try{
  const p=await pageFor(b,'<input id="quote" type="datetime-local" step="0.001" value="2026-10-14T11:23:45.678">','dark',390);
  await p.locator('.pm-datetime-trigger').click();
  const box=await p.locator('.pm-datetime-popup').evaluate(el=>{const r=el.getBoundingClientRect();return {within:r.right<=innerWidth&&r.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth+1};});
  assert.equal(box.within,true);assert.equal(box.overflow,false);
  await p.locator('[data-minute="28"]').click();await confirm(p);assert.equal(await p.evaluate(()=>quote.value),'2026-10-14T11:28:45.678');
  await p.close();
 }finally{await b.close();}
});

test('existing seconds survive minute edits with default step and step any',async()=>{
 const b=await browser();try{for(const step of ['', 'step="any"']){
  const p=await pageFor(b,`<input id="quote" type="datetime-local" ${step} value="2026-10-14T11:23:45.678">`);
  await p.locator('.pm-datetime-trigger').click();await p.locator('[data-minute="28"]').click();await confirm(p);
  assert.equal(await p.locator('.pm-datetime-popup').count(),0);
  assert.equal(await p.evaluate(()=>quote.value),'2026-10-14T11:28:45.678');await p.close();
 }}finally{await b.close();}
});

test('bounded blank calendar has a reachable enabled date and keyboard obeys its range',async()=>{
 const b=await browser();try{
  const p=await pageFor(b,'<input id="date" type="date" min="2026-10-14" max="2026-10-16">');
  await p.locator('.pm-datetime-trigger').click();
  await p.getByRole('button',{name:'现在',exact:true}).click();
  // Show the deterministic bound month independent of the machine date.
  await p.keyboard.press('Escape');await p.evaluate(()=>{date.value='2026-10-14';PMDateTime.refresh();});
  await p.locator('.pm-datetime-trigger').click();await p.getByRole('button',{name:'清除',exact:true}).click();
  const reachable=p.locator('.pm-datetime-days button[tabindex="0"]:not(:disabled)');
  assert.equal(await reachable.count(),1);await reachable.focus();await p.keyboard.press('ArrowRight');
  assert.equal(await p.locator('[data-date="2026-10-15"]').getAttribute('aria-selected'),'true');
  await p.keyboard.press('ArrowUp');assert.equal(await p.locator('[data-date="2026-10-15"]').getAttribute('aria-selected'),'true');
  await p.close();
 }finally{await b.close();}
});

test('server six-digit fractional timestamps display and keep their precision in original fields',async()=>{
 const b=await browser();try{for(const fraction of ['678000','678123']){
  const p=await pageFor(b,`<input id="stamp" type="datetime-local" value="2026-10-14T11:23:45.${fraction}">`);
  const initial=await p.evaluate(()=>stamp.value);assert.ok(initial,'server fractional value must not become empty');
  await p.locator('.pm-datetime-trigger').click();await p.locator('[data-minute="28"]').click();await confirm(p);
  assert.equal(await p.evaluate(()=>stamp.value),initial.replace(':23:',':28:'));
  assert.equal(await p.evaluate(()=>stamp.type),'datetime-local');
  assert.equal(await p.evaluate(()=>Number(stamp.value.split('.')[1].padEnd(6,'0'))),Number(fraction));
  await p.close();
 }}finally{await b.close();}
});
