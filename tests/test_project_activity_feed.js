'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'source', 'frontend', '10-chart-board.js'),
    'utf8',
);
const requests = [];
const responses = [];
const content = {innerHTML: '', querySelector() { return null; }};
const context = {
    console: {error() {}},
    URLSearchParams,
    allProjects: [{id: 34, number: 'PRJ-034', name: '测试项目'}],
    document: {
        documentElement: {dataset: {}},
        getElementById(id) { return id === 'chartBoardContent' ? content : null; },
        querySelector() { return null; },
        addEventListener() {},
    },
    api: async (method, url) => {
        requests.push({method, url});
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
    },
    setTimeout,
    clearTimeout,
    result: null,
};
vm.createContext(context);
vm.runInContext(`${source}\nresult = {chartActivityUrl, loadChartActivity, updateChartActivityFilter, cleanupChartBoardLifecycle, invalidateChartBoardData, chartActivityState};`, context);
const {
    chartActivityUrl,
    loadChartActivity,
    updateChartActivityFilter,
    cleanupChartBoardLifecycle,
    invalidateChartBoardData,
    chartActivityState,
} = context.result;

assert.equal(
    chartActivityUrl({userId: 7, projectId: 34, action: 'project.update'}, 91),
    '/api/settings?project_activity_view=recent&limit=30&before_id=91&user_id=7&project_id=34&action=project.update',
);

responses.push({
    items: [{id: 2, user_id: 7, actor_label: '张三 (zhangsan)', action: 'project.update', label: '修改项目', project: {id: 34, number: 'PRJ-034', name: '测试项目'}, changes: [], created_at: '2026-07-29T10:00:00'}],
    next_cursor: 2,
});
responses.push({
    items: [
        {id: 2, user_id: 7, actor_label: '重复', action: 'project.update', label: '重复', project: {id: 34}, changes: [], created_at: ''},
        {id: 1, user_id: 8, actor_label: 'lisi', action: 'stage.complete', label: '完成阶段', project: {id: 34, number: 'PRJ-034', name: '测试项目'}, changes: [], created_at: '2026-07-29T09:00:00'},
    ],
    next_cursor: null,
});

async function run() {
    let resolveInterrupted;
    responses.unshift(new Promise(resolve => { resolveInterrupted = resolve; }));
    const interrupted = loadChartActivity({reset: true});
    assert.equal(chartActivityState.loading, true);
    cleanupChartBoardLifecycle();
    assert.equal(chartActivityState.loading, false, 'leaving the board must clear a stale loading state');
    resolveInterrupted({items: [], next_cursor: null});
    await interrupted;
    requests.length = 0;

    chartActivityState.loading = true;
    invalidateChartBoardData();
    assert.equal(chartActivityState.loading, false, 'data invalidation must allow the activity request to restart');

    await loadChartActivity({reset: true});
    assert.equal(requests[0].method, 'GET');
    assert.match(requests[0].url, /project_activity_view=recent&limit=30/);
    assert.match(content.innerHTML, /张三 \(zhangsan\)/);
    await loadChartActivity();
    assert.match(requests[1].url, /before_id=2/);
    assert.equal((content.innerHTML.match(/data-activity-id="2"/g) || []).length, 1);
    assert.equal((content.innerHTML.match(/data-activity-id="1"/g) || []).length, 1);

    responses.push({items: [], next_cursor: null});
    await updateChartActivityFilter('action', 'stage.complete');
    assert.match(requests[2].url, /action=stage.complete/);
    assert.doesNotMatch(requests[2].url, /before_id=/);

    responses.push(new Error('offline'));
    await loadChartActivity({reset: true});
    assert.match(content.innerHTML, /操作记录加载失败/);
}

run().then(() => console.log('project activity feed tests passed')).catch(error => {
    console.error(error);
    process.exitCode = 1;
});
