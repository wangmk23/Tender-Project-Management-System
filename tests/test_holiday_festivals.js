'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const views = fs.readFileSync('source/frontend/05-views.js','utf8');
const render = views.slice(views.indexOf('function renderCalendar('),views.indexOf('\nfunction prevMonth('));
const escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function draw(display=true) {
    const dom = new JSDOM('<div id="calendarContent"></div>');
    const sandbox = {document:dom.window.document, calendarYear:2026,calendarMonth:10,
        calendarSelectedDate:'2026-10-01', calendarKeyboardNavigation:null, calendarDefaultDate:()=> '2026-10-01',
        todayISO:()=> '2026-10-20', escHtml, readUiPreferences:()=>({holidayDisplay:display}),
        calendarAgendaHtml:()=>'',calendarEventMetadata:e=>({name:e.stage_name,icon:'calendar'})};
    vm.createContext(sandbox);
    vm.runInContext(render+';globalThis.renderCalendar=renderCalendar;',sandbox);
    sandbox.renderCalendar({holiday_calendar:{confirmed:true},weekday_names:['日','一','二','三','四','五','六'],
        cells:[{empty:true},...[1,2,7,8,10].map(day=>({day,date_str:`2026-10-${String(day).padStart(2,'0')}`,
            holiday:{confirmed:true,status:day<=7?'holiday':'workday',label:day<=7?'休':day===10?'班':'',
                name:day<=7?'国庆节':'调休补班',festival_name:day===1?'国庆节':day===8?'<自定义>':''},
            events:day===2?[{stage_name:'开标',planned_time:'09:30'}]:[]}))]});
    return dom.window.document;
}
test('calendar renders festival only on its date, retains rest/makeup and stage events',()=>{
    const doc=draw();
    assert.equal(doc.querySelector('[data-calendar-date="2026-10-01"] .calendar-holiday-name').textContent,'国庆节');
    for(const day of ['02','07']) {
        const cell=doc.querySelector(`[data-calendar-date="2026-10-${day}"]`);
        assert.equal(cell.querySelector('.calendar-holiday-name'),null);
        assert.equal(cell.querySelector('.calendar-holiday-mark').textContent,'休');
        assert.ok(cell.classList.contains('holiday-rest'));
    }
    assert.equal(doc.querySelector('[data-calendar-date="2026-10-10"] .calendar-holiday-mark').textContent,'班');
    assert.equal(doc.querySelector('[data-calendar-date="2026-10-02"] .calendar-cell-event b').textContent,'开标');
    const custom=doc.querySelector('[data-calendar-date="2026-10-08"]');
    assert.equal(custom.querySelector('.calendar-holiday-name').textContent,'<自定义>');
    assert.ok(!custom.innerHTML.includes('<自定义>'));
    assert.match(custom.getAttribute('aria-label'),/<自定义>/);
});
test('holiday preference hides festival labels, backgrounds and badges together',()=>{
    const doc=draw(false);
    assert.equal(doc.querySelectorAll('.calendar-holiday-name,.calendar-holiday-mark,.holiday-rest,.holiday-makeup').length,0);
});
test('preview summarizes festival dates separately using readable labels',()=>{
    const source=fs.readFileSync('source/frontend/19-holiday-calendar.js','utf8');
    const start=source.indexOf('function hcText('),end=source.indexOf('\nasync function',start);
    const sandbox={};vm.createContext(sandbox);vm.runInContext(source.slice(start,end),sandbox);
    assert.equal(sandbox.hcText({holidays:7,workdays:1,festivals:1}),'放假日期数：7；补班日期数：1；节日当天数：1');
    assert.match(sandbox.hcText({festival_name:'国庆节',kind:'festival'}),/当天节日：国庆节；安排：节日当天/);
});
