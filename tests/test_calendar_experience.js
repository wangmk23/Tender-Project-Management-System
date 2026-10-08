'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const views = fs.readFileSync(path.join(root, 'source', 'frontend', '05-views.js'), 'utf8');
const styles = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function loadHelpers() {
    const sandbox = {escHtml, result: null};
    vm.createContext(sandbox);
    vm.runInContext(`
        ${extractFunction(views, 'calendarDefaultDate')}
        ${extractFunction(views, 'calendarEventMetadata')}
        ${extractFunction(views, 'calendarAgendaHtml')}
        result = {calendarDefaultDate, calendarAgendaHtml};
    `, sandbox);
    return sandbox.result;
}

const sample = {
    cells: [
        {empty: true},
        {empty: false, day: 1, date_str: '2026-09-01', events: []},
        {empty: false, day: 2, date_str: '2026-09-02', events: [{project_id: 7}]},
        {empty: false, day: 3, date_str: '2026-09-03', events: []},
    ],
};

test('calendar chooses a stable useful date for the displayed month', () => {
    const {calendarDefaultDate} = loadHelpers();
    assert.equal(calendarDefaultDate(sample, 2026, 9, '2026-09-03', '2026-09-02'), '2026-09-03');
    assert.equal(calendarDefaultDate(sample, 2026, 9, '', '2026-09-02'), '2026-09-02');
    assert.equal(calendarDefaultDate(sample, 2026, 9, '', '2026-08-31'), '2026-09-02');
    assert.equal(calendarDefaultDate({cells: sample.cells.slice(0, 2)}, 2026, 9, '', '2026-08-31'), '2026-09-01');
});

test('selected-day agenda shows useful project details and escapes imported text', () => {
    const {calendarAgendaHtml} = loadHelpers();
    const html = calendarAgendaHtml('2026-09-02', [{
        project_id: 7,
        number: 'PRJ-2026-007',
        project_name: '<img src=x onerror=alert(1)>',
        stage_name: '开标',
        icon: '🎯',
        planned_time: '09:30',
    }]);
    assert.match(html, /9月2日/);
    assert.match(html, /09:30/);
    assert.match(html, /开标/);
    assert.match(html, /PRJ-2026-007/);
    assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(html, /<img\b/);
    assert.match(html, /selectProject\(7\)/);

    const empty = calendarAgendaHtml('2026-09-03', []);
    assert.match(empty, /当天暂无项目节点/);
});

test('desktop calendar keeps stage labels in cells and puts selected-day agenda below', () => {
    assert.match(views, /class="calendar-layout"/);
    assert.match(views, /class="calendar-event-dots"/);
    assert.match(views, /class="calendar-cell-events"/);
    assert.match(views, /class="calendar-agenda" id="calendarAgenda"/);
    assert.match(views, /function selectCalendarDay\(dateStr\)/);

    assert.match(styles, /\.calendar-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
    assert.match(styles, /\.calendar-agenda\s*\{[^}]*position:\s*static/s);
    assert.match(styles, /\.calendar-cell-events\s*\{[^}]*display:\s*grid/s);
    assert.match(styles, /\.calendar-cell\.selected/);
    assert.match(styles, /@media \(max-width:\s*768px\)[\s\S]*?\.calendar-layout\s*\{[^}]*grid-template-columns:\s*1fr/s);
    assert.match(styles, /@media \(max-width:\s*768px\)[\s\S]*?\.calendar-cell\s*\{[^}]*aspect-ratio:\s*1/s);
    assert.match(styles, /@media \(max-width:\s*768px\)[\s\S]*?\.calendar-cell-events\s*\{[^}]*display:\s*none/s);
    assert.match(styles, /@media \(max-width:\s*768px\)[\s\S]*?#view-calendar \.view-header\s*\{[^}]*flex-wrap:\s*wrap/s);
    assert.match(styles, /@media \(max-width:\s*768px\)[\s\S]*?#view-calendar \.view-header-actions\s*\{[^}]*margin-right:\s*0/s);
});

for (const previous of ['2026-09-03', '2025-12-31']) {
    test(`Today resets selected day as well as month from ${previous}`, () => {
        const sandbox = {Date: class extends Date {constructor() {super(2026, 8, 2, 0, 15);}}, sample};
        vm.createContext(sandbox);
        vm.runInContext(`
            let calendarYear = 2025, calendarMonth = 12;
            let calendarSelectedDate = '${previous}';
            let renderedDate = '', loads = 0;
            ${extractFunction(views, 'calendarDefaultDate')}
            function loadCalendar() {
                loads++;
                renderedDate = calendarDefaultDate(sample, calendarYear, calendarMonth, calendarSelectedDate, '2026-09-02');
            }
            ${extractFunction(views, 'goToday')}
            goToday();
            result = {year: calendarYear, month: calendarMonth, selected: calendarSelectedDate, rendered: renderedDate, loads};
        `, sandbox);
        assert.deepEqual(JSON.parse(JSON.stringify(sandbox.result)), {
            year: 2026, month: 9, selected: '2026-09-02', rendered: '2026-09-02', loads: 1,
        });
    });
}
