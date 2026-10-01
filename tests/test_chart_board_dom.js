'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'source', 'frontend', '10-chart-board.js'),
    'utf8',
);

function harness() {
    const listeners = {};
    const content = {innerHTML: '', querySelector() { return null; }};
    const navParent = {insertAdjacentElement(position, node) { assert.equal(position, 'afterend'); document.nodes.nav = node; }};
    const viewParent = {insertAdjacentElement(position, node) { assert.equal(position, 'afterend'); document.nodes.view = node; }};
    const document = {
        nodes: {content},
        documentElement: {dataset: {}},
        createElement() {
            if (!this.nodes.nav) return {dataset: {}, listeners: {}, setAttribute() {}, addEventListener(type, listener) { (this.listeners[type] ||= []).push(listener); }};
            return {id: '', className: '', innerHTML: ''};
        },
        getElementById(id) {
            if (id === 'chartBoardContent') return content;
            if (id === 'view-chart-board') return this.nodes.view || null;
            return null;
        },
        querySelector(selector) {
            if (selector === '.nav-item[data-view="chart-board"]') return this.nodes.nav || null;
            if (selector === '.nav-item[data-view="procure"]') return navParent;
            if (selector === '#view-procure') return viewParent;
            return null;
        },
        addEventListener(type, listener) { (listeners[type] ||= []).push(listener); },
    };
    const context = {
        console,
        document,
        URLSearchParams,
        allProjects: [],
        api: async () => ({items: [], next_cursor: null}),
        switchView() {},
        closeSidebar() {},
        setTimeout,
        clearTimeout,
        result: null,
    };
    vm.createContext(context);
    vm.runInContext(`${source}\nresult = {renderChartBoard, ensureChartBoardWorkspace, installChartBoardInteractions};`, context);
    return {context, content, document, listeners, ...context.result};
}

const view = harness();
view.ensureChartBoardWorkspace();
assert.equal(view.document.nodes.nav.dataset.view, 'chart-board');
assert.equal(view.document.nodes.view.id, 'view-chart-board');

vm.runInContext(`
    chartActivityState.items = [{
        id: 91,
        actor_label: '<img onerror=1>',
        label: '修改项目',
        action: 'project.update',
        project: {id: 34, number: 'PRJ-034', name: '<script>alert(1)</script>'},
        changes: [{field: 'name', before: '旧', after: '新'}],
        created_at: '2026-07-29T10:00:00'
    }];
    chartActivityState.loaded = true;
`, view.context);
view.renderChartBoard({
    kpis: {total: 5, active: 3, overdue: 1, completed: 1},
    monthlyTrend: [
        {month: '2月', created: 1, completed: 0},
        {month: '3月', created: 0, completed: 0},
        {month: '4月', created: 1, completed: 0},
        {month: '5月', created: 1, completed: 0},
        {month: '6月', created: 1, completed: 0},
        {month: '7月', created: 1, completed: 1},
    ],
    statusDistribution: [{name: '进行中', count: 3}],
    methodDistribution: [{name: '公开招标', count: 2}],
    riskDistribution: [{name: '逾期', count: 1}],
});

const html = view.content.innerHTML;
assert.match(html, /<h2>项目数据看板<\/h2>/);
assert.match(html, /class="cb-kpis"/);
assert.match(html, /data-chart-type="six-month-trend"/);
assert.match(html, /data-chart-type="status-distribution"/);
assert.match(html, /data-chart-type="method-distribution"/);
assert.match(html, /data-chart-type="risk-distribution"/);
assert.match(html, /<aside class="cb-activity"/);
assert.match(html, /&lt;img onerror=1&gt;/);
assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.doesNotMatch(html, /data-cb-action="(?:theme|layout|refresh)"/);
assert.doesNotMatch(html, /<img onerror=1>|<script>alert/);
assert.doesNotMatch(html, /NaN|Infinity/);

view.installChartBoardInteractions();
view.installChartBoardInteractions();
assert.equal(view.listeners.click.length, 1);
assert.equal(view.listeners.change.length, 1);

console.log('chart board DOM tests passed');
