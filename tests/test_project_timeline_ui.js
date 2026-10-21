'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function setup(){
 const dom=new JSDOM('<div id="chartBoardContent"></div>');let selected=null;
 const c=vm.createContext({document:dom.window.document,URLSearchParams,console,setTimeout,clearTimeout,
  selectProject:id=>{selected=id;},allProjects:[],api:async()=>({items:[]})});
 vm.runInContext(fs.readFileSync(__dirname+'/../source/frontend/10-chart-board.js','utf8'),c);
 return {c,d:dom.window.document,dom,selected:()=>selected};
}
const now=new Date('2026-10-20T14:00:00+08:00');
function project(id,extra={}){return {id,number:'P-'+id,name:'项目'+id,method:'公开招标',
 project_timeline:{created_at:'2026-10-01T02:00:00+00:00',state:'active',ended_at:null},...extra};}
test('timeline freezes closed duration and measures active projects to today using Beijing calendar days',()=>{
 const {c}=setup();const closed=project(2,{project_timeline:{created_at:'2026-10-01T23:30:00+00:00',ended_at:'2026-10-05T01:00:00+08:00',state:'completed'}});
 const rows=c.buildChartBoardData([project(1),closed],now).timelineRows;
 assert.equal(rows.find(r=>r.id===1).elapsedDays,19);assert.equal(rows.find(r=>r.id===2).elapsedDays,3);
});
test('timeline keeps missing and reversed dates visible rather than inventing zero duration',()=>{
 const {c}=setup();const p=project(1,{project_timeline:{state:'completed',created_at:'2026-10-10',ended_at:'2026-10-09'}});
 const rows=c.buildChartBoardData([p,project(2,{project_timeline:{state:'liubiao',created_at:null,ended_at:null}})],now).timelineRows;
 assert.equal(rows.find(r=>r.id===1).elapsedDays,null);assert.equal(rows.find(r=>r.id===1).dateIssue,true);
 assert.equal(rows.find(r=>r.id===2).elapsedDays,null);
});
test('minute precision stage completion does not conflict with creation seconds in the same minute',()=>{
 const {c}=setup();const p=project(1,{project_timeline:{state:'completed',created_at:'2026-10-20T02:00:35+00:00',ended_at:'2026-10-20T10:00+08:00'}});
 const row=c.buildChartBoardData([p],now).timelineRows[0];assert.equal(row.dateIssue,false);assert.equal(row.elapsedDays,0);
});
test('future actual completion is flagged and does not count future elapsed days',()=>{
 const {c}=setup();const p=project(1,{project_timeline:{state:'completed',created_at:'2026-10-01',ended_at:'2027-10-09'}});
 const row=c.buildChartBoardData([p],now).timelineRows[0];assert.equal(row.dateIssue,true);assert.equal(row.elapsedDays,null);
});
test('pagination preserves keyboard focus and chooses an enabled button on the last page',()=>{
 const {c,d}=setup();c.renderChartBoard(c.buildChartBoardData(Array.from({length:45},(_,i)=>project(i+1)),now));c.installChartBoardInteractions();
 let next=d.querySelector('[data-cb-timeline-page="next"]');next.focus();next.click();assert.equal(d.activeElement.dataset.cbTimelinePage,'next');
 next=d.querySelector('[data-cb-timeline-page="next"]');next.click();assert.equal(d.activeElement.dataset.cbTimelinePage,'prev');
});
test('Chinese IME composition keeps the original input connected until the final search',()=>{
 const {c,d,dom}=setup();c.renderChartBoard(c.buildChartBoardData([project(1,{name:'归档项目'}),project(2)],now));c.installChartBoardInteractions();
 const input=d.getElementById('cbTimelineSearch');input.focus();input.dispatchEvent(new dom.window.CompositionEvent('compositionstart',{bubbles:true}));
 input.value='归档';input.dispatchEvent(new dom.window.InputEvent('input',{bubbles:true,isComposing:true}));
 assert.strictEqual(d.getElementById('cbTimelineSearch'),input);assert.equal(input.isConnected,true);
 input.dispatchEvent(new dom.window.CompositionEvent('compositionend',{bubbles:true,data:'归档'}));
 assert.equal(d.querySelectorAll('[data-cb-timeline-project]').length,1);assert.equal(d.activeElement.id,'cbTimelineSearch');
 assert.equal(d.getElementById('cbTimelineSearch').value,'归档');
});
test('search blur change does not reapply a search already handled by input',()=>{
 const {c,d,dom}=setup();c.renderChartBoard(c.buildChartBoardData([project(1)],now));c.installChartBoardInteractions();
 const input=d.getElementById('cbTimelineSearch');input.focus();input.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.strictEqual(d.getElementById('cbTimelineSearch'),input);
});
test('timeline table is escaped and opens a project through its accessible button',()=>{
 const {c,d,dom,selected}=setup();c.renderChartBoard(c.buildChartBoardData([project(1,{name:'<img src=x onerror=1>'})],now));c.installChartBoardInteractions();
 assert.match(d.body.textContent,/项目起止时间表/);assert.equal(d.querySelector('.cb-timeline img'),null);
 const button=d.querySelector('[data-cb-timeline-project="1"]');assert.ok(button);button.dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true}));assert.equal(selected(),1);
});
test('timeline search and status filters compose and paginate without repainting the charts',()=>{
 const {c,d,dom}=setup();const projects=Array.from({length:45},(_,i)=>project(i+1));projects[23]=project(24,{name:'归档测试',project_timeline:{state:'feibiao',created_at:null,ended_at:null}});
 c.renderChartBoard(c.buildChartBoardData(projects,now));c.installChartBoardInteractions();const trend=d.querySelector('.cb-trend');
 assert.equal(d.querySelectorAll('[data-cb-timeline-project]').length,20);
 d.querySelector('[data-cb-timeline-page="next"]').click();assert.match(d.querySelector('.cb-timeline-page-status').textContent,/2/);
 const input=d.getElementById('cbTimelineSearch');input.value='归档';input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(d.querySelectorAll('[data-cb-timeline-project]').length,1);assert.strictEqual(d.querySelector('.cb-trend'),trend);
 const select=d.getElementById('cbTimelineStatus');select.value='completed';select.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
 assert.equal(d.querySelectorAll('[data-cb-timeline-project]').length,0);assert.match(d.querySelector('.cb-timeline').textContent,/没有符合条件/);
});
