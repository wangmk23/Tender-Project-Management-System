'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const {JSDOM} = require(process.env.PM_JSDOM_MODULE || 'jsdom');
const root = path.join(__dirname, '..');
const command = fs.readFileSync(path.join(root, 'source/frontend/09-command-center.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'source/frontend/01-core.js'), 'utf8');
const coreFunctions = ['topManagedDialog', 'dialogControls', 'focusDialogStart', 'handleDialogFocus',
    'activateDialogFocus', 'releaseDialogFocus', 'resetModalState', 'showModal', 'closeModal'];
const dialogCode = acorn.parse(core, {ecmaVersion: 'latest'}).body
    .filter(node => node.type === 'FunctionDeclaration' && coreFunctions.includes(node.id.name))
    .map(node => core.slice(node.start, node.end)).join('\n');

function setup(projects = fixture(), stats = null) {
    const dom = new JSDOM(`<div class="view active" id="dashboardView"><div id="dashboardContent"></div></div>
        <div id="modalOverlay"></div><div id="modal"><header><h3 id="modalTitle"></h3>
        <button id="closeDialog" type="button">关闭窗口</button></header><div id="modalBody"></div>
        <div id="modalFooter"></div></div>`, {runScripts: 'outside-only'});
    const w = dom.window;
    w.HTMLElement.prototype.getClientRects = function() { return [{width: 10, height: 10}]; };
    w.escHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
    w.allProjects = projects;
    w.projectColor = () => '#2563eb';
    w.selectProject = id => { w.selectedProject = id; return Promise.resolve(true); };
    w.switchView = () => { throw new Error('metric lists must keep the dashboard open'); };
    w.eval('const dialogFocusStack = []; let dialogFocusListenersReady = false;\n' + dialogCode);
    w.eval(fs.readFileSync(path.join(root,'source/frontend/22-procurement-methods.js'),'utf8'));
    w.eval(command);
    const model = w.commandCenterModel(projects, stats, new Date('2026-10-12T09:00:00'));
    w.document.getElementById('dashboardContent').innerHTML = w.renderCommandCenterDashboard(model);
    w.installCommandActionDelegation(w.document);
    w.document.getElementById('closeDialog').onclick = w.closeModal;
    return {dom, w, d: w.document, model};
}

function fixture() {
    return [
        {id: 1, number: 'SIM-001', name: '模拟设备采购', purchaser: '模拟医院', method: '公开招标',
            progress: 25, current_stage_key: 'review', current_stage_name: '文件审核', stages: [
                {key: 'review', name: '文件审核', planned_at: '2026-10-11T09:30'},
                {key: 'opening', name: '开标', modules: ['bid_opening'], planned_at: '2026-10-12T11:00'},
                {key: 'results', name: '结果公示', planned_at: '2026-10-17'},
            ]},
        {id: 2, number: 'SIM-002', name: '模拟服务采购', purchaser: '模拟学校', method: '竞争性磋商',
            progress: 60, current_stage_key: 'review', current_stage_name: '评审', stages: [
                {key: 'review', name: '评审', planned_at: '2026-10-18T15:00'},
                {key: 'later', name: '归档', planned_at: '2026-10-22'},
            ]},
        {id: 3, number: 'SIM-003', name: '模拟已完成采购', purchaser: '模拟医院', method: '公开招标',
            progress: 100, current_stage_name: '资料归档', stages: []},
        {id: 4, number: 'SIM-004', name: '模拟终止采购', purchaser: '模拟学校', method: '竞争性磋商',
            progress: 30, is_terminated: true, stages: [{key: 'review', planned_at: '2026-10-10'}]},
    ];
}

test('all five metric buttons open distinct lists without navigating or moving the dashboard', () => {
    const {w, d} = setup();
    const dashboard = d.getElementById('dashboardContent');
    const original = dashboard.innerHTML;
    dashboard.scrollTop = 137;
    const expected = [['进行中', 2], ['未开标项目', 1], ['7 天内节点', 3], ['逾期节点', 1], ['已完成', 1]];
    [...d.querySelectorAll('.command-metric')].forEach((button, index) => {
        button.focus();
        button.click();
        assert.ok(d.getElementById('modal').classList.contains('open'));
        assert.match(d.getElementById('modalTitle').textContent, new RegExp(expected[index][0]));
        assert.equal(d.querySelectorAll('.command-metric-result').length, expected[index][1]);
        assert.equal(dashboard.innerHTML, original);
        assert.equal(dashboard.scrollTop, 137);
        d.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        assert.equal(d.getElementById('modal').classList.contains('open'), false);
        assert.equal(d.activeElement, button);
    });
});

test('node lists retain separate nodes, exact plan times and their project context', () => {
    const {d} = setup();
    d.querySelectorAll('.command-metric')[2].click();
    const rows = [...d.querySelectorAll('.command-metric-result')];
    assert.equal(rows.length, 3, 'two nodes of one project remain two results');
    assert.match(rows[0].textContent, /模拟设备采购/);
    assert.match(rows[0].textContent, /开标/);
    assert.match(rows[0].textContent, /2026-10-12 11:00/);
    assert.match(rows[1].textContent, /结果公示/);
    assert.match(d.getElementById('modalTitle').textContent, /3.*节点/);
});

test('local search and method filters combine, preserve input focus and reset empty results', () => {
    const {w, d} = setup();
    d.querySelector('.command-metric').click();
    const input = d.querySelector('[data-metric-query]');
    const method = d.querySelector('[data-metric-method]');
    input.focus(); input.value = '医院'; input.dispatchEvent(new w.Event('input', {bubbles: true}));
    assert.equal(d.querySelectorAll('.command-metric-result').length, 1);
    assert.equal(d.activeElement, input);
    method.value = '竞争性磋商'; method.dispatchEvent(new w.Event('change', {bubbles: true}));
    assert.equal(d.querySelectorAll('.command-metric-result').length, 0);
    assert.match(d.querySelector('[data-metric-results]').textContent, /没有符合/);
    d.querySelector('[data-metric-reset]').click();
    assert.equal(input.value, ''); assert.equal(method.value, '');
    assert.equal(d.querySelectorAll('.command-metric-result').length, 2);
    assert.match(d.querySelector('.command-metric-result').textContent, /SIM-001.*模拟医院/s);
    assert.match(d.querySelector('.command-metric-result').textContent, /文件审核.*25%/s);
});

test('opening project details is explicit and closes only the list dialog', () => {
    const {w, d} = setup();
    d.querySelector('.command-metric').click();
    assert.equal(w.selectedProject, undefined);
    d.querySelector('[data-command-action="open-metric-project"]').click();
    assert.equal(w.selectedProject, '1');
    assert.equal(d.getElementById('modal').classList.contains('open'), false);
});

test('zero counts and escaped project names render safe empty or literal content', () => {
    const empty = setup([]);
    empty.d.querySelector('.command-metric').click();
    assert.match(empty.d.getElementById('modalTitle').textContent, /0/);
    assert.match(empty.d.querySelector('[data-metric-results]').textContent, /暂无进行中项目/);
    const projects = fixture(); projects[0].name = '<img src=x onerror=alert(1)>';
    const {d} = setup(projects);
    d.querySelector('.command-metric').click();
    assert.equal(d.querySelectorAll('#modalBody img').length, 0);
    assert.match(d.querySelector('.command-metric-result').textContent, /<img src=x/);
});

test('list uses the displayed model snapshot and dialog focus traps keyboard traversal', () => {
    const {w, d} = setup();
    w.allProjects = [];
    const button = d.querySelector('.command-metric'); button.focus(); button.click();
    assert.equal(d.querySelectorAll('.command-metric-result').length, 2);
    const controls = [...d.getElementById('modal').querySelectorAll('button,input,select')];
    controls.at(-1).focus();
    d.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Tab', bubbles: true, cancelable: true}));
    assert.equal(d.activeElement, controls[0]);
    controls[0].focus();
    d.dispatchEvent(new w.KeyboardEvent('keydown', {key: 'Tab', shiftKey: true, bubbles: true, cancelable: true}));
    assert.equal(d.activeElement, controls.at(-1));
    d.getElementById('closeDialog').click();
    assert.equal(d.activeElement, button);
});

test('separately refreshed stats cannot inflate project counts beyond the visible snapshot', () => {
    const projects = fixture();
    projects.push({id: 5, number: 'SIM-005', name: '模拟待初始化项目'});
    projects.push({id: 6, number: 'SIM-006', name: '模拟自定义流程', method: '自定义采购', progress: 20,
        current_stage_key: 'custom-opening', stages: [
            {stage_key: 'custom-opening', name: '自定义开启响应', modules: ['bid_opening'], planned_at: '2026-10-22T09:00'},
        ]});
    const {d, model} = setup(projects, {total: 6, in_progress: 90, completed: 99});
    assert.equal(model.metrics.active, 4);
    assert.equal(model.metrics.completed, 1);
    assert.equal(model.metrics.unopened, 2);
    const cards = d.querySelectorAll('.command-metric');
    for (const [index, expected] of [[0, 4], [1, 2], [4, 1]]) {
        assert.equal(Number(cards[index].querySelector('strong').textContent), expected);
        cards[index].click();
        assert.equal(d.querySelectorAll('.command-metric-result').length, expected);
        assert.match(d.querySelector('[data-metric-summary]').textContent, new RegExp(`显示 ${expected} / ${expected}`));
        d.querySelector('[data-metric-close]').click();
    }
});

test('removed historical nodes stay outside the overdue and due-soon lists', () => {
    const projects = [{id:1, number:'SIM-OLD', name:'模拟历史流程', method:'公开招标', progress:10,
        stages:[
            {key:'removed-old',name:'已移除的历史阶段',template_removed:true,planned_at:'2026-10-11T09:30'},
            {key:'removed-soon',name:'已移除的未来阶段',template_removed:true,planned_at:'2026-10-13T09:30'},
            {key:'current',name:'当前待办节点',planned_at:'2026-10-13T11:00'},
        ]}];
    const {d,model}=setup(projects);
    assert.equal(model.metrics.overdue,0);
    assert.equal(model.metrics.dueSoon,1);
    d.querySelectorAll('.command-metric')[2].click();
    assert.equal(d.querySelectorAll('.command-metric-result').length,1);
    assert.match(d.querySelector('[data-metric-results]').textContent,/当前待办节点/);
    assert.doesNotMatch(d.querySelector('[data-metric-results]').textContent,/已移除/);
    d.querySelector('[data-metric-close]').click();
    d.querySelectorAll('.command-metric')[3].click();
    assert.equal(d.querySelectorAll('.command-metric-result').length,0);
});

test('valid planned seconds and microseconds appear and retain local deadline meaning', () => {
    const projects=[{id:1,number:'SIM-PRECISE',name:'模拟精确计划',method:'公开招标',progress:10,
        stages:[
            {key:'milliseconds',name:'毫秒计划节点',planned_at:'2026-10-13T09:30:02.123'},
            {key:'microseconds',name:'微秒计划节点',planned_at:'2026-10-13T09:30:02.123456'},
            {key:'invalid',name:'无效秒数节点',planned_at:'2026-10-13T09:30:61.123'},
        ]}];
    const {w,d,model}=setup(projects);
    assert.equal(model.metrics.dueSoon,2);
    d.querySelectorAll('.command-metric')[2].click();
    assert.equal(d.querySelectorAll('.command-metric-result').length,2);
    assert.match(d.querySelector('[data-metric-results]').textContent,/2026-10-13 09:30:02\.123456/);
    const stamp=w.commandDeadline('2026-10-13T09:30:02.123456');
    assert.ok(stamp);
    assert.equal(stamp.getHours(),9);assert.equal(stamp.getMinutes(),30);
    assert.equal(stamp.getSeconds(),2);assert.equal(stamp.getMilliseconds(),123);
    const dateOnly=w.commandDeadline('2026-10-13');
    assert.equal(dateOnly.getHours(),23);assert.equal(dateOnly.getMinutes(),59);
    assert.equal(dateOnly.getSeconds(),59);assert.equal(dateOnly.getMilliseconds(),999);
    assert.equal(w.commandDeadline('2026-10-13T09:30:02.123+08:00'),null);
});
