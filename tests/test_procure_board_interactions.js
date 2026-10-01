'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '05-views.js'), 'utf8');

function extract(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const brace = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = brace; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

test('year choices and project order are descending', () => {
    const context = {
        result: null,
        rows: [
            {id: 1, year: 2025, number: 'P-002'},
            {id: 2, year: 2026, number: 'P-001'},
            {id: 3, year: 2026, number: 'P-010'},
        ],
    };
    vm.runInNewContext(`${extract('procureBoardYears')}\n${extract('sortProcureBoardProjects')}\nresult={years:procureBoardYears(rows), ids:sortProcureBoardProjects(rows).map(row=>row.id)}`, context);
    assert.deepEqual(Array.from(context.result.years), [2026, 2025]);
    assert.deepEqual(Array.from(context.result.ids), [3, 2, 1]);
});

test('board source keeps year filter and centered overlay arrows without vertical-wheel horizontal conversion', () => {
    assert.match(source, /procureBoardYearSelect/);
    assert.match(source, /全部年份/);
    assert.match(source, /scrollProcureBoard\(-1\)/);
    assert.match(source, /scrollProcureBoard\(1\)/);
    assert.match(source, /class="procure-board-frame"/);
    assert.match(source, /class="procure-scroll-button procure-scroll-prev"/);
    assert.match(source, /class="procure-scroll-button procure-scroll-next"/);
    assert.match(source, /addEventListener\('pointerdown'/);
    assert.doesNotMatch(extract('initializeProcureBoardScroller'), /scrollLeft\s*\+=\s*delta/);
    assert.match(source, /procure-board-scroll/);
});

test('clicking a column selects it and vertical wheel scrolls only that column', () => {
    const listeners = {};
    const firstBody = {scrollTop: 20, scrollHeight: 600, clientHeight: 200};
    const secondBody = {scrollTop: 40, scrollHeight: 700, clientHeight: 200};
    const makeColumn = body => ({
        classList: {active: false, toggle(name, enabled) { if (name === 'is-active') this.active = enabled; }},
        querySelector(selector) { return selector === '.board-col-body' ? body : null; },
    });
    const first = makeColumn(firstBody);
    const second = makeColumn(secondBody);
    const scroller = {
        dataset: {}, scrollLeft: 75, clientWidth: 900, scrollWidth: 1800,
        children: [first, second],
        addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
        setPointerCapture() {}, releasePointerCapture() {},
        classList: {add() {}, remove() {}},
        querySelector(selector) { return selector === '.board-col.is-active' ? (second.classList.active ? second : first.classList.active ? first : null) : null; },
    };
    const context = {result: null};
    vm.runInNewContext(`${extract('setActiveProcureBoardColumn')}\n${extract('initializeProcureBoardScroller')}\nresult={setActiveProcureBoardColumn,initializeProcureBoardScroller}`, context);
    context.result.initializeProcureBoardScroller(scroller);
    const clickEvent = {target: {closest: selector => selector === '.board-col' ? second : null}};
    listeners.click[0](clickEvent);
    assert.equal(second.classList.active, true);
    let prevented = false;
    listeners.wheel[0]({deltaX: 0, deltaY: 65, target: {closest: () => null}, preventDefault() { prevented = true; }});
    assert.equal(secondBody.scrollTop, 105);
    assert.equal(firstBody.scrollTop, 20);
    assert.equal(scroller.scrollLeft, 75);
    assert.equal(prevented, true);
});

test('overlay arrows advance exactly one column from the selected column', () => {
    const columns = [0, 296, 592].map((offsetLeft, index) => ({
        offsetLeft,
        classList: {active: index === 1, toggle(name, enabled) { if (name === 'is-active') this.active = enabled; }},
    }));
    const calls = [];
    const scroller = {
        scrollLeft: 0,
        children: columns,
        querySelectorAll: () => columns,
        querySelector: selector => selector === '.board-col.is-active' ? columns.find(column => column.classList.active) : null,
        scrollTo(options) { calls.push(options); },
    };
    const context = {
        document: {getElementById: () => scroller},
        result: null,
    };
    vm.runInNewContext(`${extract('setActiveProcureBoardColumn')}\n${extract('scrollProcureBoard')}\nresult=scrollProcureBoard`, context);
    context.result(1);
    assert.equal(calls[0].left, 592);
    assert.equal(columns[2].classList.active, true);
});
