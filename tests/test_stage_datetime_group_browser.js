'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),acorn=require('acorn');
const {chromium}=require(process.env.PM_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'source/frontend/04-project-workflow.js'),'utf8');
const node=acorn.parse(source,{ecmaVersion:'latest'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='completeStage');
test('stage date and minute share a themed frame in completion, slide and batch forms',async()=>{
 const edge=process.env.PM_EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
 try{
  for(const theme of ['default','dark'])for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:844},reducedMotion:'reduce'});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent(`<!doctype html><style>${fs.readFileSync(path.join(root,'src/static/style.css'),'utf8').replace(/^\uFEFF/,'')}</style>
    <div id="modalOverlay" class="modal-overlay open"></div><div id="modal" class="modal open"><div class="modal-header"><h3>完成阶段</h3></div><div id="modalBody" class="modal-body"></div></div>`);
   await page.addScriptTag({content:fs.readFileSync(path.join(root,'source/frontend/00-icons.js'),'utf8')});
   await page.evaluate(theme=>{
    document.documentElement.dataset.theme=theme;
    window.currentProject={id:1,stages:[{key:'registration_end',name:'报名与审核',completed:false}]};
    window.escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    window.projectStageDefinition=s=>({name:s.name,icon:'👥'});
    window.stageLocalMinuteNow=()=> '2026-10-13T09:30';window.stageTimestampParts=()=>({date:'2026-10-13',time:'09:30'});
    window.stageKeyToken=()=> 'registration_end';window.showModal=(_,html)=>{document.getElementById('modalBody').innerHTML=html;};
   },theme);
   await page.addScriptTag({content:source.slice(node.start,node.end)});await page.evaluate(()=>completeStage('registration_end'));
   for(const form of ['completion','slide','batch']){
    if(form==='slide')await page.evaluate(()=>{
     document.getElementById('modalBody').innerHTML='<div class="stage-editor"><label>计划时间</label><div class="stage-minute-pair"><input type="date" id="stagePlannedAt" value="2026-10-13"><input type="time" id="stagePlannedTime" step="60" value="00:00"></div></div>';
    });
    if(form==='batch')await page.evaluate(()=>{
     document.getElementById('modalBody').innerHTML='<div id="batchDateList"><label class="batch-plan-row"><input type="checkbox" checked><span>模拟阶段</span><div class="stage-minute-pair"><input type="date" class="bd-at" value="2026-10-13"><input type="time" class="bd-time" step="60" value="09:30"></div></label></div>';
    });
    const layout=await page.locator('.stage-minute-pair').evaluate(el=>{
     const frame=el.getBoundingClientRect(),s=getComputedStyle(el),inputs=[...el.querySelectorAll('input')];
     return {border:s.borderTopWidth,bg:s.backgroundColor,overflow:el.scrollWidth>el.clientWidth+1,
      height:frame.height,controls:inputs.map(input=>{const r=input.getBoundingClientRect(),c=getComputedStyle(input);return {top:r.top,height:r.height,padding:c.paddingTop,radius:c.borderTopLeftRadius,border:c.borderTopWidth,bg:c.backgroundColor,within:r.left>=frame.left&&r.right<=frame.right&&r.top>=frame.top&&r.bottom<=frame.bottom};})};
    });
    assert.equal(layout.border,'1px',`${form} ${theme} ${width}: shared frame`);
    assert.notEqual(layout.bg,'rgba(0, 0, 0, 0)');assert.equal(layout.overflow,false);
    assert.ok(layout.controls.every(c=>c.border==='0px'&&c.within),`${form}: inner fields fit unified frame`);
    assert.equal(layout.controls[0].height,layout.controls[1].height,`${form}: equal field height`);
    assert.equal(layout.height,42,`${form}: one shared row`);
    assert.equal(layout.controls[0].top,layout.controls[1].top,`${form}: fields aligned in one row`);
    assert.ok(layout.controls.every(c=>c.padding==='0px'&&c.radius==='0px'),`${form}: no old field padding or radius`);
    assert.ok(layout.controls.every(c=>c.bg==='rgba(0, 0, 0, 0)'));
    const first=page.locator('.stage-minute-pair input').first(),last=page.locator('.stage-minute-pair input').last();
    await first.fill('2026-10-12');await last.fill('17:30');assert.equal(await first.inputValue(),'2026-10-12');assert.equal(await last.inputValue(),'17:30');
   }
   assert.deepEqual(errors,[]);await page.close();
  }
 }finally{await browser.close();}
});
