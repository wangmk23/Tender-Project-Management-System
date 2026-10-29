'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {JSDOM}=require('jsdom');
const root=path.join(__dirname,'..');const html=fs.readFileSync(path.join(root,'src/templates/workspace.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
const source=['01-core.js','02-projects.js','03-attachments.js','04-project-workflow.js','05-views.js','06-admin.js','07-business.js','09-command-center.js','10-chart-board.js','11-stage-settings.js','22-procurement-methods.js','23-project-flow-editor.js','24-ui-preferences.js'].map(name=>fs.readFileSync(path.join(root,'source/frontend',name),'utf8')).join('\n');
function setup(t){const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());const w=dom.window;w.matchMedia=()=>({matches:false,addEventListener(){}});w.eval(source+'\nwindow.seedLinkageProjects=rows=>{allProjects=rows;rebuildProjectIndexes(rows);invalidateProjectDerivedState();};window.seedLinkage=p=>{currentProject=p;allProjects=[p];rebuildProjectIndexes(allProjects);systemSettings={};};');w.PMIcons={label:(el,text)=>{el.textContent=text;}};w.toast=()=>{};w.showLoading=()=>{};w.hideLoading=()=>{};const p={id:1,name:'合成项目',method:'公开招标',progress:0,current_stage_key:'a',stages:[{key:'a',name:'编制',modules:['common'],completed:false,notes:'原备注'}],lots:[],registrations:[],bid_results:[],complaints:[]};w.seedLinkage(p);return {w,d:w.document,p};}
test('required checklist rejection rolls back only completion controls and keeps the note draft',async t=>{
 const {w,d}=setup(t);w.openStageSlide('a');d.getElementById('stageCompleted').checked=true;d.getElementById('stageCompletedDate').value='2026-10-26';d.getElementById('stageCompletedTime').value='09:30';d.getElementById('stageNotes').value='未提交草稿';
 w.api=async()=>{const error=new Error('请先完成阶段必检项');error.status=409;error.details={pending_checklist:['核对采购文件']};throw error;};
 assert.equal(await w.saveStageFromSlide(),false);assert.equal(d.getElementById('stageCompleted').checked,false);assert.equal(d.getElementById('stageCompletedDate').value,'');assert.equal(d.getElementById('stageNotes').value,'未提交草稿');assert.match(d.getElementById('stageSaveError').textContent,/核对采购文件/);
});
test('a failed checklist checkbox reverts to its saved value',async t=>{
 const {w,d,p}=setup(t);p.stages[0].modules.push('checklist');p.stages[0].checklist=[{id:5,title:'核对',completed:false,required:true}];w.openStageSlide('a');const cb=d.querySelector('.checklist-row input');cb.checked=true;w.api=async()=>{throw new Error('网络失败');};
 await w.toggleStageChecklist(5,true,cb);assert.equal(cb.checked,false);assert.equal(cb.disabled,false);
});
test('repeated undo gestures share one confirmation and one write',async t=>{
 const {w,p}=setup(t);p.stages[0].completed=true;let accept;let confirms=0,writes=0;w.confirmDialog=()=>{confirms++;return new Promise(resolve=>{accept=resolve;});};w.api=async()=>{writes++;return {};};w.refreshProject=async()=>{};
 const first=w.toggleStage('a'),second=w.toggleStage('a');assert.equal(confirms,1);accept(true);await Promise.all([first,second]);assert.equal(writes,1);
});
test('project stage batches collect failures and refresh even after a partial commit',async t=>{
 const {w,d,p}=setup(t);p.stages.push({key:'b',name:'评审'},{key:'c',name:'归档'});d.body.insertAdjacentHTML('beforeend','<input class="batch-cb" type="checkbox" data-key="a" checked><input class="batch-cb" type="checkbox" data-key="b" checked><input class="batch-cb" type="checkbox" data-key="c" checked>');let calls=0,refreshes=0;w.confirmDialog=async()=>true;w.api=async()=>{if(++calls===2)throw new Error('评审未完成必检');return {};};w.refreshProject=async()=>{refreshes++;};w.exitBatchMode=()=>{};
 await w.batchCompleteSelected();assert.equal(calls,3);assert.equal(refreshes,1);assert.match(d.getElementById('modalBody').textContent,/成功\s*2.*失败\s*1/s);assert.match(d.getElementById('modalBody').textContent,/评审未完成必检/);
});
test('free text budgets remain readable in existing and new package rows',t=>{
 const {w,d,p}=setup(t);p.lots=[{id:1,lot_name:'合成包',budget:'按实际结算'}];w.renderInfo();assert.match(d.getElementById('infoContent').textContent,/按实际结算/);assert.doesNotMatch(d.getElementById('infoContent').textContent,/NaN/);
 d.body.insertAdjacentHTML('beforeend','<div id="packList"></div>');w._newProjectLots=[{lot_number:'1',lot_name:'合成包',budget:'以实际发生为准'}];w.renderPackList();assert.match(d.getElementById('packList').textContent,/以实际发生为准/);assert.doesNotMatch(d.getElementById('packList').textContent,/NaN/);
});
test('large sidebars render bounded pages while searches still cover every project',t=>{
 const {w,d,p}=setup(t);const rows=Array.from({length:3000},(_,i)=>({...p,id:i+1,number:'SIM-'+String(i+1).padStart(4,'0'),name:'合成采购项目'+(i+1)}));
 w.seedLinkageProjects(rows);w.renderSidebar();assert.equal(d.querySelectorAll('.sidebar-project').length,100);assert.match(d.querySelector('.sidebar-list-pager').textContent,/3000/);
 w.setSidebarPage(1);assert.equal(d.querySelectorAll('.sidebar-project').length,100);
 d.getElementById('searchInput').value='SIM-3000';w.renderSidebar();assert.equal(d.querySelectorAll('.sidebar-project').length,1);assert.equal(d.querySelector('.sidebar-project').dataset.projectId,'3000');
});
test('background project detail refresh does not consume the first next-page click',t=>{
 const {w,d,p}=setup(t);const rows=Array.from({length:300},(_,i)=>({...p,id:i+1,number:'SIM-'+String(i+1).padStart(4,'0'),name:'合成项目'+(i+1)}));
 w.sortUiProjects=projects=>projects;w.seedLinkageProjects(rows);w.renderSidebar();w.storeProjectDetail({...rows[0],notes:'背景详情预取'});w.setSidebarPage(1);
 assert.equal(d.querySelector('.sidebar-project').dataset.projectId,'101');assert.match(d.querySelector('.sidebar-list-pager').textContent,/2\/3/);
 w.storeProjectDetail({...rows[1],notes:'另一条背景详情'});w.renderSidebar();assert.equal(d.querySelector('.sidebar-project').dataset.projectId,'101');
 d.getElementById('searchInput').value='SIM';w.renderSidebar();assert.equal(d.querySelector('.sidebar-project').dataset.projectId,'1');
});
test('cancelling no-deposit restoration preserves the project flag and writes nothing',async t=>{
 const {w,d,p}=setup(t);p.no_deposit=true;d.body.insertAdjacentHTML('beforeend','<input id="infoNoDeposit" type="checkbox">');let writes=0;w.api=async()=>{writes++;return {};};w.confirmDialog=async()=>false;
 await w.saveNoDeposit();assert.equal(writes,0);assert.equal(d.getElementById('infoNoDeposit').checked,true);
});
test('a failed project selection keeps the current draft and exposes a persistent retry',async t=>{
 const {w,d,p}=setup(t);let requests=0;w.promoteProjectPrefetch=()=>{};w.requestProjectDetail=async()=>{requests++;throw new Error('详情暂时不可用');};
 assert.equal(await w.selectProject(2),false);const error=d.getElementById('projectLoadError');assert(error);assert.match(error.textContent,/重试/);assert.equal(p.stages[0].notes,'原备注');
 error.querySelector('button').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(requests,2);
});
test('registration attachment retry reuses the created registration and explains object errors',async t=>{
 const {w,d}=setup(t);let creates=0,uploads=0;w.api=async method=>{if(method==='POST')creates++;return {id:7};};w.refreshProject=async()=>{};w.reopenStageModule=()=>{};w.getAttachmentUploadLimitMb=async()=>1024;
 w.apiForm=async()=>{if(++uploads===1){const error=new Error('服务器拒绝文件');error.status=422;throw error;}return {uploaded:[{filename:'资料.pdf'}]};};
 w.showRegistrationForm();d.getElementById('regCompany').value='合成供应商';Object.defineProperty(d.getElementById('regFiles'),'files',{value:[new w.File(['a'],'资料.pdf')],configurable:true});
 await d.getElementById('modalSaveBtn').onclick();assert.equal(d.getElementById('modal').classList.contains('open'),true);assert.match(d.getElementById('modalSaveBtn').textContent,/重试/);
 await d.getElementById('modalSaveBtn').onclick();assert.equal(creates,1);assert.equal(uploads,2);
 assert.match(w.formatUploadErrors([{filename:'资料.pdf',error:'文件格式不支持'}]).join('；'),/资料.pdf.*文件格式不支持/);
});
test('successful attachment upload with failed refresh reports the saved result and offers GET retry only',async t=>{
 const {w,d}=setup(t);let sent=0,gets=0;const messages=[];w.toast=message=>messages.push(message);w.getAttachmentUploadLimitMb=async()=>1024;w.showUploadProgress=()=>{};
 w.XMLHttpRequest=class{constructor(){this.upload={addEventListener(){}};this.status=200;this.responseText='{"uploaded":[{"filename":"资料.pdf"}]}';this.listeners={};}addEventListener(name,fn){this.listeners[name]=fn;}open(){}setRequestHeader(){}send(){sent++;this.listeners.load();}};
 w.api=async()=>{gets++;throw new Error('详情服务失败');};await w.uploadFiles([new w.File(['a'],'资料.pdf')]);
 assert.equal(sent,1);assert(messages.some(message=>/已上传|成功上传/.test(message)));assert(!messages.some(message=>/上传失败/.test(message)));
 const retry=d.querySelector('.attachment-refresh-warning button');assert(retry);retry.click();await new Promise(resolve=>setImmediate(resolve));assert.equal(sent,1);assert.equal(gets,2);
});
test('confirmed business deadline alerts have their own units and never inflate stage-node counts',t=>{
 const {w,d,p}=setup(t);p.business_deadline_summary={total:1,overdue:1,dueSoon:0,review:0,alerts:1};p.business_deadline_alerts=[{id:'bd1',stage_key:'a',title:'已确认答复期限',confirmed_deadline:'2026-10-01',time_status:'overdue'}];
 const model=w.commandCenterModel([p],null,new Date('2026-10-26'));assert.equal(model.metrics.overdue,0);
 d.getElementById('dashboardContent').innerHTML=w.renderCommandCenterDashboard(model);const panel=d.querySelector('.command-deadline-panel');assert(panel);assert.match(panel.textContent,/逾期\s*1\s*个事项/);assert.equal(panel.querySelector('[data-command-action="open-business-deadline"]').dataset.deadlineId,'bd1');
});
test('a pending registration never reads files or edits status from another project form',async t=>{
 const {w,d,p}=setup(t);let release,started;const waiting=new Promise(resolve=>{started=resolve;});const saved=new Promise(resolve=>{release=resolve;});const uploads=[];
 w.api=async()=>{started();return saved;};w.refreshProject=async()=>{};w.reopenStageModule=()=>{};w.uploadRegistrationFiles=async(pid,id,files)=>{uploads.push({pid,id,files:[...files].map(file=>file.name)});};
 w.showRegistrationForm();d.getElementById('regCompany').value='供应商 A';Object.defineProperty(d.getElementById('regFiles'),'files',{value:[new w.File(['a'],'A.pdf')]});const first=d.getElementById('modalSaveBtn').onclick();await waiting;
 w.closeModal();w.seedLinkage({...p,id:2});w.showRegistrationForm();d.getElementById('regCompany').value='供应商 B';Object.defineProperty(d.getElementById('regFiles'),'files',{value:[new w.File(['b'],'B.pdf')]});
 release({id:7});await first;assert.deepEqual(uploads,[{pid:1,id:7,files:['A.pdf']}]);assert.equal(d.getElementById('regCompany').value,'供应商 B');assert.equal(d.getElementById('registrationUploadState'),null);
});
test('a preserved stage draft keeps its opening token after a background model refresh',async t=>{
 const {w,d,p}=setup(t);p.record_version='P-old';p.stages[0].record_version='A-old';w.openStageSlide('a');d.getElementById('stageNotes').value='旧基线草稿';
 w.seedLinkage({...p,record_version:'P-new',stages:[{...p.stages[0],notes:'他人新备注',record_version:'A-new'}]});let sent;
 w.api=async(method,url,body)=>{sent=body;throw new Error('版本冲突');};await w.saveStageFromSlide();assert.equal(sent.record_version,'A-old');assert.equal(d.getElementById('stageNotes').value,'旧基线草稿');
});
test('a preserved info draft keeps its opening project token after background refresh',async t=>{
 const {w,d,p}=setup(t);p.record_version='P-old';p.budget='100';w.renderInfo();d.getElementById('infoBudget').value='旧基线预算草稿';
 w.seedLinkage({...p,record_version:'P-new',budget:'200'});let sent;w.api=async(method,url,body)=>{sent=body;throw new Error('版本冲突');};await w.saveProjectInfo();assert.equal(sent.record_version,'P-old');assert.equal(sent.budget,'旧基线预算草稿');
});
