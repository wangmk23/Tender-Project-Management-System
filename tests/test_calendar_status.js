'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
const source=fs.readFileSync(path.join(__dirname,'../source/frontend/05-views.js'),'utf8');
const now=Date.parse('2026-11-10T10:00:00+08:00');
function setup(events=[]) {
    const dom=new JSDOM('<section id="view-calendar" class="active"><div id="calendarContent"></div></section><input id="unrelatedDraft" value="保留草稿">',{pretendToBeVisual:true});
    class Clock extends Date {constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}}
    const context=vm.createContext({document:dom.window.document,Date:Clock,calendarYear:2026,calendarMonth:11,calendarSelectedDate:'2026-11-10',calendarEventsByDate:new Map(),escHtml:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),todayISO:()=> '2026-11-10'});
    vm.runInContext(source,context);
    const data={weekday_names:['日','一','二','三','四','五','六'],cells:[{day:10,date_str:'2026-11-10',events}]};
    return {context,dom,data};
}

test('calendar distinguishes completed, skipped, overdue and pending without changing business records',()=>{
    const {context}=setup();assert.equal(typeof context.calendarEventStatus,'function');
    const event=Object.freeze({project_id:1,stage_key:'opening',planned_time:'09:59',completed:false});
    const status=(extra,date='2026-11-10',at=now)=>context.calendarEventStatus({...event,...extra},date,at);
    assert.equal(status({}).label,'逾期未完成');
    assert.equal(status({completed:true}).label,'已完成');
    assert.equal(status({completed:true,skipped:true}).label,'已跳过');
    assert.equal(status({planned_time:'10:01'}).label,'待办');
    assert.equal(event.completed,false);
});

test('calendar uses Beijing time and handles exact due time, date-only and invalid dates conservatively',()=>{
    const {context}=setup();assert.equal(typeof context.calendarEventStatus,'function');
    const status=(event,date='2026-11-10',at=now)=>context.calendarEventStatus(event,date,at).key;
    assert.equal(status({planned_time:'10:00'}),'pending');
    assert.equal(status({planned_time:'10:00'},'2026-11-10',now+1000),'overdue');
    assert.equal(status({}),'pending');
    assert.equal(status({},'2026-11-09'),'overdue');
    assert.equal(status({},'2026-11-10',Date.parse('2026-11-10T23:59:59.999+08:00')),'pending');
    assert.equal(status({},'2026-11-10',Date.parse('2026-11-11T00:00:00+08:00')),'overdue');
    assert.equal(status({planned_at:'2026-11-10T01:59:00Z'}),'overdue');
    assert.equal(status({planned_time:'25:00'}),'pending');
    assert.equal(status({},'2026-02-30'),'pending');
    assert.equal(status({},''),'pending');
});

test('calendar never calls estimated or review deadlines overdue',()=>{
    const {context}=setup();assert.equal(typeof context.calendarEventStatus,'function');
    for(const item of [{kind:'deposit_refund',estimated:true},{kind:'deposit_refund',needs_recheck:true},{kind:'business_deadline',needs_review:true}]) {
        const status=context.calendarEventStatus(item,'2026-11-01',now);
        assert.notEqual(status.key,'overdue');
        assert.match(status.label,/预计|复核/);
        assert.equal(context.calendarEventStatus({...item,completed:true},'2026-11-01',now).key,'done');
    }
});

test('month cells and agenda expose visible statuses and accessible day summaries',()=>{
    const events=[{project_id:1,stage_key:'done',stage_name:'已办节点',planned_time:'09:00',completed:true},
        {project_id:2,stage_key:'late',stage_name:'未办节点',planned_time:'09:59'},
        {project_id:3,stage_key:'next',stage_name:'<img src=x>',planned_time:'10:01'}];
    const {context,dom,data}=setup(events);context.renderCalendar(data);
    const doc=dom.window.document;
    assert.deepEqual([...doc.querySelectorAll('.calendar-cell-event .calendar-node-status')].map(n=>n.textContent),['已完成','逾期','待办']);
    assert.deepEqual([...doc.querySelectorAll('.calendar-agenda-item .calendar-node-status')].map(n=>n.textContent),['已完成','逾期未完成','待办']);
    assert.match(doc.querySelector('[data-calendar-date]').getAttribute('aria-label'),/1个逾期未完成/);
    assert.equal(doc.querySelectorAll('img').length,0);
    assert.equal(events[1].completed,undefined);
});

test('minute status refresh preserves focus, selected day and unrelated draft without any writes',()=>{
    const {context,dom,data}=setup([{project_id:1,stage_key:'review',stage_name:'文件审核',planned_time:'10:01'}]);
    context.renderCalendar(data);assert.equal(typeof context.refreshCalendarNodeStatuses,'function');
    const doc=dom.window.document,day=doc.querySelector('[data-calendar-date]'),row=doc.querySelector('.calendar-agenda-item');
    day.focus();context.refreshCalendarNodeStatuses(now+120000);
    assert.equal(doc.activeElement,day);assert.equal(doc.querySelector('.calendar-agenda-item'),row);
    assert.equal(row.querySelector('.calendar-node-status').textContent,'逾期未完成');
    assert.equal(doc.querySelector('.calendar-cell-event .calendar-node-status').textContent,'逾期');
    assert.match(doc.querySelector('.calendar-cell-event').title,/逾期未完成/);
    assert.equal(doc.querySelector('#unrelatedDraft').value,'保留草稿');
    assert.equal(day.getAttribute('aria-pressed'),'true');
    assert.match(day.getAttribute('aria-label'),/逾期未完成/);
});

test('calendar full descriptions retain project identity and status after refresh',()=>{
 const {context,dom,data}=setup([{project_id:1,project_name:'名称很长的采购项目甲',project_number:'TEST-001',stage_name:'文件审核',planned_time:'10:01'}]);
 context.renderCalendar(data);const node=dom.window.document.querySelector('.calendar-cell-event');
 assert.match(node.title,/名称很长的采购项目甲/);assert.match(node.title,/10:01/);
 context.refreshCalendarNodeStatuses(now+120000);assert.match(node.title,/名称很长的采购项目甲/);assert.match(node.title,/逾期未完成/);
 dom.window.close();
});
