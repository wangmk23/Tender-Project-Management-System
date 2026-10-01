'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {JSDOM} = require(process.env.PM_JSDOM_MODULE || 'jsdom');
function harness() {
    const dom = new JSDOM('<div id="infoContent"></div><div id="modalOverlay"></div><div id="modal" class="open"><h3 id="modalTitle"></h3><div id="modalBody"></div><div id="modalFooter"></div></div><div id="docPreviewOverlay"><button id="previewClose">关闭</button></div><div id="previewLoading"></div><div id="imageViewerContainer"></div><div id="pdfViewerContainer"></div><div id="docxViewerContainer"></div><div id="excelViewerContainer"></div>', {pretendToBeVisual:true});
    const w = dom.window;
    w.HTMLElement.prototype.getClientRects = function(){return [{width:1,height:1}];};
    const ctx = {window:w, document:w.document, console, setTimeout, clearTimeout, getComputedStyle:w.getComputedStyle.bind(w), FormData:w.FormData, URL:w.URL, cleanupChartBoardLifecycle(){}, toast(){}, isApplicationTextInput:el=>['INPUT','SELECT','TEXTAREA'].includes(el.tagName), focusSafely:el=>{if(!el?.isConnected)return false;el.focus();return true;}, focusFallback(){}};
    vm.createContext(ctx);
    for(const f of ['01-core.js','02-projects.js','03-attachments.js','04-project-workflow.js','07-business.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../source/frontend',f),'utf8'),ctx);
    ctx.run = code => vm.runInContext(code,ctx);
    ctx.run("toast=()=>{}; loadImagePreview=()=>{}; refreshProject=async()=>{}; renderSidebar=()=>{}; renderProjectTopbar=()=>{}; switchView=()=>{}; switchProjectTab=()=>{}; cleanupChartBoardLifecycle=()=>{};");
    ctx.run("currentProject={id:1,name:'项目一',number:'1',purchaser:'采购人',method:'公开招标',year:2026,lots:[],complaints:[{id:8,events:[]}]};");
    return {ctx, document:w.document, dom};
}
test('batch fill preserves existing datetime time and reports actual valid fields',()=>{
 const {ctx,document}=harness(); document.body.insertAdjacentHTML('beforeend','<input id="batchStartDate" type="date" value="2026-10-01"><input id="batchInterval" value="7"><input class="bd-cb" type="checkbox" checked data-key="a"><input class="bd-at" type="datetime-local" data-key="a" value="2026-09-20T09:35"><input class="bd-cb" type="checkbox" checked data-key="b"><input class="bd-at" type="date" data-key="b"><input class="bd-cb" type="checkbox" checked data-key="missing">');
 const messages=[];ctx.toast=m=>messages.push(m);ctx.fillBatchDates();assert.equal(document.querySelector('[data-key="a"].bd-at').value,'2026-10-01T09:35');assert.equal(document.querySelector('[data-key="b"].bd-at').value,'2026-10-08');assert.match(messages[0],/2 个阶段/);
});
test('complaint attachment retry updates one event and keeps pending files',async()=>{
 const {ctx,document}=harness();const calls=[];ctx.api=async(method,url)=>{calls.push({method,url});return {id:19};};ctx.showComplaintProcess=()=>{};ctx.showComplaintEventForm(8);const file=new ctx.window.File(['x'],'a.pdf');Object.defineProperty(document.getElementById('eventFiles'),'files',{value:[file]});let attempts=0;ctx.apiForm=async()=>{if(!attempts++)throw new Error('上传失败');return {};};
 await document.getElementById('modalSaveBtn').onclick();assert.equal(document.getElementById('eventFiles').files.length,1);await document.getElementById('modalSaveBtn').onclick();assert.deepEqual(calls.map(x=>x.method),['POST','PUT']);assert.match(calls[1].url,/events\/19$/);
});
test('information draft survives switching projects and is cleared after successful save',async()=>{
 const {ctx,document}=harness();ctx.renderInfo();document.getElementById('infoName').value='项目一未保存';document.getElementById('infoName').dispatchEvent(new ctx.window.Event('input',{bubbles:true}));
 ctx.run("renderProjectDetail({id:2,name:'项目二',number:'2',method:'公开招标',year:2026,lots:[]},true)");ctx.renderInfo();assert.equal(document.getElementById('infoName').value,'项目二');
 ctx.run("renderProjectDetail({id:1,name:'项目一',number:'1',method:'公开招标',year:2026,lots:[]},true)");ctx.renderInfo();assert.equal(document.getElementById('infoName').value,'项目一未保存');ctx.api=async()=>({});await ctx.saveProjectInfo();ctx.run("currentProject.name='服务器最新';renderInfo()");assert.equal(document.getElementById('infoName').value,'服务器最新');
});
test('preview owns focus and one Escape closes only preview and restores trigger',()=>{
 const {ctx,document}=harness();document.getElementById('modalBody').innerHTML='<button id="trigger">预览</button><textarea>下层草稿</textarea>';ctx.activateDialogFocus(document.getElementById('modal'),ctx.closeModal);document.getElementById('trigger').focus();
 ctx.openDocPreview({filename:'a.png'},'image',1);assert.ok(document.getElementById('docPreviewOverlay').contains(document.activeElement));document.getElementById('previewClose').focus();assert.equal(document.activeElement.id,'previewClose');document.activeElement.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(document.getElementById('docPreviewOverlay').classList.contains('open'),false);assert.equal(document.getElementById('modal').classList.contains('open'),true);assert.equal(document.activeElement.id,'trigger');
});
const operationSourceRoot = path.join(__dirname, '../source/frontend');
test('unmodified focus and reverted values do not create drafts; discard restores server values',()=>{
 const {ctx,document}=harness();ctx.renderInfo();document.getElementById('infoName').focus();assert.equal(ctx.run('projectInfoDrafts.size'),0);const input=document.getElementById('infoName');input.value='改动';input.dispatchEvent(new ctx.window.Event('input'));assert.equal(ctx.run('projectInfoDrafts.size'),1);input.value='项目一';input.dispatchEvent(new ctx.window.Event('input'));assert.equal(ctx.run('projectInfoDrafts.size'),0);input.value='丢弃';input.dispatchEvent(new ctx.window.Event('input'));ctx.discardProjectInfoDraft();assert.equal(document.getElementById('infoName').value,'项目一');assert.equal(ctx.run('projectInfoDrafts.size'),0);
});
test('failed save retains draft and save completion preserves edits made while request was pending',async()=>{
 const {ctx,document}=harness();ctx.renderInfo();const input=document.getElementById('infoName');input.value='已提交';input.dispatchEvent(new ctx.window.Event('input'));ctx.api=async()=>{throw new Error('offline');};await ctx.saveProjectInfo();assert.equal(ctx.run('projectInfoDrafts.get(1).infoName'),'已提交');let finish;ctx.api=()=>new Promise(resolve=>{finish=resolve;});const pending=ctx.saveProjectInfo();input.value='保存中的新草稿';input.dispatchEvent(new ctx.window.Event('input'));finish({});await pending;ctx.renderInfo();assert.equal(document.getElementById('infoName').value,'保存中的新草稿');
});
test('complaint attachment upload remains bound to original project during delayed create',async()=>{
 const {ctx,document}=harness();let finish;const urls=[];ctx.api=()=>new Promise(resolve=>{finish=resolve;});ctx.apiForm=async url=>{urls.push(url);return {};};ctx.showComplaintEventForm(8);Object.defineProperty(document.getElementById('eventFiles'),'files',{value:[new ctx.window.File(['x'],'a.pdf')]});const pending=document.getElementById('modalSaveBtn').onclick();ctx.run('currentProject={id:2};projectNavigationVersion++');finish({id:19});await pending;assert.deepEqual(urls,['/api/projects/1/complaints/8/events/19/attachments']);assert.equal(ctx.run('currentProject.id'),2);assert.equal(document.getElementById('modal').classList.contains('open'),true);
});
test('preview Tab is trapped and Escape document handlers cannot close underlying modal',()=>{
 const {ctx,document}=harness();const bootstrap=fs.readFileSync(path.join(operationSourceRoot,'08-bootstrap.js'),'utf8');ctx.closeCommandPalette=()=>{};vm.runInContext(bootstrap.slice(bootstrap.indexOf("document.addEventListener('keydown', e =>"),bootstrap.lastIndexOf("window.addEventListener('pagehide'")),ctx);
 document.getElementById('modalBody').innerHTML='<button id="trigger">预览</button><textarea>下层草稿</textarea>';ctx.activateDialogFocus(document.getElementById('modal'),ctx.closeModal);document.getElementById('trigger').focus();ctx.openDocPreview({filename:'a.png'},'image',1);document.getElementById('previewClose').focus();const tab=new ctx.window.KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});document.activeElement.dispatchEvent(tab);assert.equal(tab.defaultPrevented,true);assert.equal(document.activeElement.id,'previewClose');document.activeElement.dispatchEvent(new ctx.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));assert.equal(document.getElementById('modal').classList.contains('open'),true);assert.equal(document.querySelector('textarea').value,'下层草稿');
});
test('batch datetime without prior time uses the displayed 09:00 default',()=>{
 const {ctx,document}=harness();document.body.insertAdjacentHTML('beforeend','<input id="batchStartDate" type="date" value="2026-10-01"><input id="batchInterval" value="7"><input class="bd-cb" type="checkbox" checked data-key="a"><input class="bd-at" type="datetime-local" data-key="a">');ctx.fillBatchDates();assert.equal(document.querySelector('.bd-at').value,'2026-10-01T09:00');
});
test('opening batch date form displays serialized dates and timed stages without invalid input values',async()=>{
 const {ctx,document}=harness();ctx.projectStageDefinition=s=>({icon:'',name:s.key});ctx.stageHasModule=(s,module)=>s.key.startsWith('timed') && module==='bid_opening';
 ctx.run("currentProject.stages=[{key:'date',planned_at:'2026-10-02T08:30:00'},{key:'timed',planned_at:'2026-10-03T10:45:00'},{key:'timed_date_only',planned_at:'2026-10-04'},{key:'empty',planned_at:null}]");
 await ctx.batchSetPlannedDate();assert.equal(document.querySelector('.bd-at[data-key="date"]').value,'2026-10-02');assert.equal(document.querySelector('.bd-at[data-key="timed"]').value,'2026-10-03T10:45');assert.equal(document.querySelector('.bd-at[data-key="timed_date_only"]').value,'2026-10-04T09:00');assert.equal(document.querySelector('.bd-at[data-key="empty"]').value,'');
});
