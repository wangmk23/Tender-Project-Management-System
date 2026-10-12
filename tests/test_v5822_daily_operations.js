'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),acorn=require('acorn');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,'../source/frontend',name),'utf8');
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function functions(name,names){const s=read(name);return acorn.parse(s,{ecmaVersion:'latest'}).body.filter(n=>n.type==='FunctionDeclaration'&&names.includes(n.id.name)).map(n=>s.slice(n.start,n.end)).join('\n');}
function workspace(){
 const dom=new JSDOM('<div id="dashboardContent"></div><div id="modal"><div id="modalBody"></div><div id="modalFooter"></div></div><div id="commandPaletteResults"></div>',{runScripts:'outside-only'}),w=dom.window;
 Object.assign(w,{escHtml:esc,projectColor:()=> '#2563eb',METHODS:['公开招标','网上竞价'],allProjects:[],projectSearchById:new Map(),showModal(title,html){w.document.getElementById('modalBody').innerHTML=html;},closeModal(){},orderProjectStages:stages=>stages||[],switchView(){throw Error('unexpected navigation');}});
 w.eval(functions('02-projects.js',['projectSearchText']));w.eval(read('09-command-center.js'));
 return {dom,w,d:w.document};
}
test('countdown and pending queue both ignore template-removed stages',()=>{
 const {dom,w}=workspace(),now=new Date('2026-10-13T09:00:00');
 const p={id:1,progress:20,stages:[{key:'gone',template_removed:true,planned_at:'2026-10-13T09:10'},{key:'valid',planned_at:'2026-10-13T10:00'}]};
 assert.equal(w.pickNearestKeyNode([p],now).stageKey,'valid');assert.deepEqual(Array.from(w.rankCommandActions([p],now),x=>x.stageKey),['valid']);dom.window.close();
});
function touchHarness(){
 const dom=new JSDOM('<div class="sidebar-project"><span id="target">项目</span></div>',{runScripts:'outside-only'}),w=dom.window,s=read('08-bootstrap.js');
 const start=s.indexOf('let touchStartTime ='),end=s.indexOf('function onLongPress(',start);let now=1000,menus=0,clicks=0;
 w.Date.now=()=>now;w.onLongPress=()=>menus++;
 const el=w.document.getElementById('target');el.addEventListener('click',()=>clicks++);w.eval(s.slice(start,end));
 const send=(type,points=[{clientX:10,clientY:10}])=>{const e=new w.Event(type,{bubbles:true,cancelable:true});Object.defineProperties(e,{touches:{value:points},changedTouches:{value:points}});el.dispatchEvent(e);return e;};
 return {dom,w,el,send,advance:ms=>now+=ms,menus:()=>menus,clicks:()=>clicks};
}
test('long press cancels synthetic pointer click but preserves keyboard and a new tap',()=>{
 const h=touchHarness();h.send('touchstart');h.advance(600);assert.equal(h.send('touchend').defaultPrevented,true);assert.equal(h.menus(),1);
 h.el.dispatchEvent(new h.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:1}));assert.equal(h.clicks(),0);
 h.el.dispatchEvent(new h.w.MouseEvent('click',{bubbles:true,cancelable:true,detail:0}));assert.equal(h.clicks(),1);
 h.send('touchstart');h.advance(80);assert.equal(h.send('touchend').defaultPrevented,false);
 h.el.dispatchEvent(new h.w.MouseEvent('click',{bubbles:true,detail:1}));assert.equal(h.clicks(),2);h.dom.window.close();
});
test('touch cancellation, scrolling, multitouch and empty end do not open menu',()=>{
 for(const type of ['touchcancel','touchmove','multi','empty']){
  const h=touchHarness();h.send('touchstart');h.advance(700);
  if(type==='multi')h.send('touchstart',[{clientX:10,clientY:10},{clientX:11,clientY:11}]);
  else if(type==='touchmove')h.send('touchmove',[{clientX:40,clientY:10}]);else if(type==='touchcancel')h.send(type);
  assert.doesNotThrow(()=>h.send('touchend',type==='empty'?[]:[{clientX:10,clientY:10}]));assert.equal(h.menus(),0,type);h.dom.window.close();
 }
});
function model(){
 const projects=Array.from({length:9},(_,i)=>({id:i+1,name:'模拟项目 '+(i+1),number:'PRJ-'+i,purchaser:'模拟学校',method:'网上竞价',progress:30}));
 return {metrics:{total:9,active:9,unopened:3,overdue:1,dueSoon:1,completed:0},activeProjects:projects,completedProjects:[],unopenedProjects:projects.slice(0,3),actions:[{projectId:1,stageKey:'review',stageName:'报名审核',projectName:'模拟项目 1',projectNumber:'PRJ-0',plannedAt:'2026-10-12T12:00',urgency:'overdue',days:-1},{projectId:2,stageKey:'quote',stageName:'一次报价',projectName:'模拟项目 2',projectNumber:'PRJ-1',plannedAt:'2026-10-13T12:00',urgency:'today',days:0}],insights:{methods:{'网上竞价':9},riskProjects:projects.slice(0,1)}};
}
test('dashboard puts pending work first, keeps five metric entries and limits duplicate previews',()=>{
 const {dom,w,d}=workspace(),m=model();w.allProjects=m.activeProjects;d.getElementById('dashboardContent').innerHTML=w.renderCommandCenterDashboard(m);
 assert.ok(d.querySelector('.command-panel').classList.contains('command-action-queue'));
 assert.equal(d.querySelectorAll('.command-metric').length,5);assert.ok(d.querySelectorAll('.command-project-row').length<=5);
 assert.equal(d.querySelectorAll('.command-unopened-panel').length,0);
 w.installCommandActionDelegation(d);d.querySelector('[data-command-filter="today"]').click();
 assert.equal(d.querySelectorAll('.command-action-row').length,1);assert.match(d.querySelector('.command-action-list').textContent,/一次报价/);
 d.querySelector('[data-command-filter="all"]').click();assert.equal(d.querySelectorAll('.command-action-row').length,2);dom.window.close();
});
test('project current action names owner and exact deadline, skipping removed current stage',()=>{
 const {dom,w}=workspace();const p={id:1,progress:20,current_stage_key:'gone',stages:[{key:'gone',name:'移除阶段',template_removed:true},{key:'review',name:'报名审核',planned_at:'2026-10-13T12:34',responsible_person:'模拟审核员'}]};
 const m=w.projectWorkspaceModel(p);assert.equal(m.currentStage.key,'review');const html=w.renderProjectActionStrip(m);assert.match(html,/模拟审核员/);assert.match(html,/2026-10-13 12:34/);dom.window.close();
});
test('command palette searches procurement method from same project index as sidebar',()=>{
 const {dom,w,d}=workspace();w.allProjects=[{id:1,name:'模拟项目',number:'PRJ-001',purchaser:'模拟学校',method:'网上竞价',progress:20}];
 assert.match(w.projectSearchText(w.allProjects[0]),/网上竞价/);assert.match(w.projectSearchText(w.allProjects[0]),/进行中/);
 const matches=w.filterCommandPalette('  网上竞价  ');assert.ok(matches.some(x=>x.type==='project'&&x.value==='1'));dom.window.close();
});
test('new project places basic fields first and keeps optional fields with separate persistent actions',()=>{
 const {dom,w,d}=workspace();w.eval(functions('06-admin.js',['showNewProjectModal']));w.showNewProjectModal();
 const body=d.getElementById('modalBody');assert.ok(body.querySelector('details')?.contains(d.getElementById('npPrepareOwner')));
 assert.equal(body.querySelector('details').open,false);assert.ok(!body.querySelector('details').contains(d.getElementById('npName')));
 assert.ok(body.querySelector('details').contains(d.getElementById('npBudget')));assert.ok(d.getElementById('modalFooter').contains(d.getElementById('npCreateBtn')));
 assert.ok(d.getElementById('modalFooter').querySelector('[data-new-project-cancel]'));dom.window.close();
});
