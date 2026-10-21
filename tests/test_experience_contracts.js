'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const root = path.join(__dirname, '..');
const files = ['01-core.js', '02-projects.js', '05-views.js', '09-command-center.js',
    '11-stage-settings.js', '22-procurement-methods.js', '24-ui-preferences.js'];
const source = files.map(file => fs.readFileSync(path.join(root, 'source/frontend', file), 'utf8')).join('\n');
const workspace = fs.readFileSync(path.join(root, 'src/templates/workspace.html'), 'utf8')
    .replace(/<script\b[\s\S]*?<\/script>/g, '');

function setup(t, stored = {}) {
    const dom = new JSDOM(workspace, {url: 'http://localhost', runScripts: 'outside-only'});
    t.after(() => dom.window.close());
    const w = dom.window;
    w.CURRENT_USER = {id: 1};
    w.matchMedia = () => ({matches: false, addEventListener() {}});
    for (const [key, value] of Object.entries(stored)) w.localStorage.setItem(key, value);
    w.eval(source + '\nwindow.seedExperience = value => { currentProject = value; systemSettings = {}; };');
    return {w, d: w.document};
}

function project(overrides = {}) {
    return {id: 1, number: 'SIM-2026-001', name: '隔离模拟项目', purchaser: '模拟采购人',
        method: '公开招标', progress: 25, budget: '308259.21', current_stage_key: 'doc_prepare',
        stages: [
            {key: 'plan_received', name: '计划接收', completed: true, completed_date: '2026-10-01'},
            {key: 'doc_prepare', name: '文件编制', planned_at: '2026-11-03T09:00:00'},
            {key: 'doc_review', name: '文件审核'},
            {key: 'deposit_refund', name: '保证金退还', skipped: true},
        ], ...overrides};
}

test('distribution totals and every method use the visible snapshot including closed projects', t => {
    const {w, d} = setup(t);
    const methods = ['公开招标', '竞争性磋商', '网上竞价', '遴选', '单一来源', '邀请招标', '直选'];
    const rows = methods.map((method, i) => project({id: i + 1, method,
        is_terminated: i === 6, stages: []}));
    const before = JSON.stringify(rows);
    for (const total of [0, 6, 999]) {
        w.invalidateCommandCenterData();
        const model = w.commandCenterModel(rows, {total}, new Date('2026-10-21T10:00:00'));
        assert.equal(model.metrics.total, 7, 'an unrelated stats count cannot exclude closed rows or inflate the summary');
        d.getElementById('dashboardContent').innerHTML = w.renderCommandCenterDashboard(model);
        assert.equal(d.querySelector('.command-insight-panel .command-panel-head b').textContent, '7');
        const entries = [...d.querySelectorAll('.command-insight-row')];
        assert.equal(entries.length, 7, 'less common methods remain visible instead of being silently truncated');
        assert.deepEqual(entries.map(row => row.querySelector('span').textContent).sort(), methods.slice().sort());
        assert.equal(entries.reduce((sum, row) => sum + Number(row.querySelector('strong').textContent), 0), 7);
    }
    assert.equal(JSON.stringify(rows), before, 'display fixes must leave project records unchanged');
});

test('task previews disclose truncation while keeping every node in the full list model', t => {
    const {w, d} = setup(t);
    const stages = Array.from({length: 7}, (_, i) => ({key: 's' + i, name: '模拟节点' + i,
        planned_at: '2026-11-03T09:' + String(i).padStart(2, '0') + ':00'}));
    const model = w.commandCenterModel([project({stages})], null, new Date('2026-10-21T10:00:00'));
    d.getElementById('dashboardContent').innerHTML = w.renderCommandTaskArea(model);
    assert.equal(d.querySelectorAll('.command-action-row').length, 6);
    assert.match(d.getElementById('dashboardContent').textContent, /显示前\s*6\s*条[，,]?\s*共\s*7\s*个节点/);
    assert.equal(model.actions.length, 7, 'the seventh row remains available to the complete list');
});

test('future deadline labels use readable dates and honor the existing date display preference', t => {
    const {w, d} = setup(t);
    const item = {projectId: 1, projectNumber: 'SIM-1', projectName: '模拟项目',
        stageName: '文件编制', stageKey: 'doc_prepare', plannedAt: '2026-11-03T09:00:00',
        urgency: 'later', days: 13};
    d.getElementById('dashboardContent').innerHTML = w.renderPriorityAction(item);
    assert.equal(d.querySelector('.command-action-time').textContent, '计划 2026-11-03 09:00');
    w.updateUiPreference('dateFormat', 'chinese');
    d.getElementById('dashboardContent').innerHTML = w.renderPriorityAction(item);
    assert.equal(d.querySelector('.command-action-time').textContent, '计划 2026年11月3日 09:00');
    assert.match(d.querySelector('.command-action-meta').textContent, /2026年11月3日 09:00/);
    assert.equal(item.plannedAt, '2026-11-03T09:00:00');
});

test('task status distinguishes the current, pending, completed and skipped stages without changing data', t => {
    const {w, d} = setup(t);
    const value = project();
    const before = JSON.stringify(value);
    w.seedExperience(value);
    w.renderTasks();
    const rows = [...d.querySelectorAll('#tasksContent tbody tr')];
    assert.deepEqual(rows.map(row => row.cells[1].textContent.trim()), ['已完成', '进行中', '待办', '不适用']);
    assert.equal(JSON.stringify(value), before);
    assert.ok(d.querySelector('#tasksContent [role="region"][tabindex="0"]'), 'the wide table must have a keyboard-focusable scroll region');
    assert.match(d.querySelector('#taskTableScrollHint').textContent, /左右滑动/);
    value.is_terminated = true;
    w.renderTasks();
    assert.equal(d.querySelectorAll('.stage-tag.active').length, 0, 'closed projects must not show a stage as active');
});

test('project budget displays exact currency units and leaves historical free text intact', t => {
    const {w, d} = setup(t);
    for (const [budget, expected] of [['308259.21', '308,259.21 元'],
        ['308259.215', '308,259.215 元'], ['90071992547409.91', '90,071,992,547,409.91 元'],
        ['-000123.45600', '-123.45600 元'],
        [0, '0.00 元'],
        [null, '未设置'], ['', '未设置'], ['按实际结算', '按实际结算']]) {
        const value = project({budget});
        w.seedExperience(value);
        w.renderProjectTopbar();
        assert.ok(d.getElementById('projectMeta').textContent.includes('预算：' + expected));
        assert.equal(value.budget, budget);
    }
});

test('new users see active projects before historical rows without hiding any project', t => {
    const {w} = setup(t);
    const rows = [
        project({id: 1, number: 'SIM-2025-001', is_terminated: true, stages: []}),
        project({id: 2, number: 'SIM-2026-002', stages: []}),
        project({id: 3, number: 'SIM-2026-003', progress: 100, stages: []}),
        project({id: 4, number: 'SIM-2026-004', stages: [{planned_at: '2026-10-22T09:00'}]}),
        project({id: 5, number: 'SIM-2026-005', stages: [{planned_at: '2026-10-26T17:30'}]}),
    ];
    const before = JSON.stringify(rows);
    const ordered = w.sortUiProjects(rows);
    assert.deepEqual(Array.from(ordered, row => row.id), [4, 5, 2, 3, 1]);
    assert.equal(JSON.stringify(rows), before);
    assert.equal(w.normalizeUiPreferences({sort: 'active_first'}).sort, 'active_first');
});

test('existing explicit account and legacy sort preferences survive the new default', t => {
    const key = 'pm_ui_preferences_v1:1';
    const {w} = setup(t, {[key]: JSON.stringify({version: 1, values: {sort: 'number_asc'}})});
    assert.equal(w.readUiPreferences().sort, 'number_asc');
    const legacy = setup(t, {projectSidebarSortDirection: 'asc'}).w;
    assert.equal(legacy.readUiPreferences().sort, 'number_asc');
    const descending = setup(t, {projectSidebarSortDirection: 'desc'}).w;
    assert.equal(descending.readUiPreferences().sort, 'number_desc');
});
