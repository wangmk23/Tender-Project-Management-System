'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const modulePath = path.join(
    __dirname, '..', 'source', 'frontend', '11-stage-settings.js',
);
const adminPath = path.join(
    __dirname, '..', 'source', 'frontend', '06-admin.js',
);
const moduleExists = fs.existsSync(modulePath);

test('stage order UI module is available', () => {
    assert.equal(moduleExists, true, '11-stage-settings.js must exist');
});

function loadModule(extra = {}) {
    if (!moduleExists) return null;
    const source = fs.readFileSync(modulePath, 'utf8');
    const calls = [];
    const sandbox = {
        STAGES: [
            {key: 'a', name: '计划接收', icon: 'A'},
            {key: 'b', name: '文件审核', icon: 'B'},
            {key: 'c', name: '结果公示', icon: 'C'},
        ],
        systemSettings: {},
        currentIsAdmin: true,
        api: async (method, url, payload) => {
            calls.push({method, url, payload});
            return {settings: {stage_order: payload.stage_order}};
        },
        toast() {},
        renderSettingsView() {},
        escHtml(value) { return String(value); },
        document: {
            getElementById() { return null; },
            querySelectorAll() { return []; },
        },
        ...extra,
    };
    sandbox.calls = calls;
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

test('client normalization accepts only a complete exact permutation', {skip: !moduleExists}, () => {
    const context = loadModule();
    assert.deepEqual(
        plain(context.normalizeClientStageOrder(['c', 'a', 'b'])),
        ['c', 'a', 'b'],
    );
    for (const invalid of [null, 'c,a,b', ['a', 'a', 'c'], ['a', 'b'], ['a', 'b', 'x']]) {
        assert.deepEqual(
            plain(context.normalizeClientStageOrder(invalid)),
            ['a', 'b', 'c'],
        );
    }
});

test('project snapshot order is authoritative even when legacy keys are rearranged', {skip: !moduleExists}, () => {
    const context = loadModule({
        systemSettings: {stage_order: ['c', 'a', 'b']},
    });
    assert.deepEqual(
        plain(context.getOrderedStages().map(stage => [stage.key, stage.name])),
        [['c', '结果公示'], ['a', '计划接收'], ['b', '文件审核']],
    );
    const rows = [
        {stage_key: 'b'},
        {stage_key: 'external'},
        {stage_key: 'c'},
        {stage_key: 'a'},
    ];
    assert.deepEqual(
        plain(context.orderProjectStages(rows).map(row => row.stage_key)),
        ['b', 'external', 'c', 'a'],
    );
    assert.deepEqual(rows.map(row => row.stage_key), ['b', 'external', 'c', 'a']);

    const positioned = [
        {stage_key: 'a', order: 2},
        {stage_key: 'b', order: 0},
        {stage_key: 'c', order: 1},
        {stage_key: 'removed', order: null},
    ];
    assert.deepEqual(
        plain(context.orderProjectStages(positioned).map(row => row.stage_key)),
        ['b', 'c', 'a', 'removed'],
    );
});

test('move and reset edit a draft without changing saved settings', {skip: !moduleExists}, () => {
    const settings = {stage_order: ['a', 'b', 'c']};
    const context = loadModule({systemSettings: settings});
    context.beginStageOrderDraft();
    context.moveStageOrder('b', -1);
    assert.deepEqual(plain(context.getStageOrderDraft()), ['b', 'a', 'c']);
    assert.deepEqual(settings.stage_order, ['a', 'b', 'c']);
    context.moveStageOrder('b', -1);
    assert.deepEqual(plain(context.getStageOrderDraft()), ['b', 'a', 'c']);
    context.resetStageOrderDraft();
    assert.deepEqual(plain(context.getStageOrderDraft()), ['a', 'b', 'c']);
});

test('drop inserts the dragged stage at the target position', {skip: !moduleExists}, () => {
    const context = loadModule({systemSettings: {stage_order: ['a', 'b', 'c']}});
    context.beginStageOrderDraft();
    context.reorderStageDraft('c', 'a');
    assert.deepEqual(plain(context.getStageOrderDraft()), ['c', 'a', 'b']);
});

test('save sends the full order and adopts the normalized response', {skip: !moduleExists}, async () => {
    const refreshes = [];
    const context = loadModule({
        systemSettings: {stage_order: ['a', 'b', 'c']},
        currentProject: {id: 7},
        loadAllProjects: async () => { refreshes.push('projects'); },
        dropProjectDetail: id => { refreshes.push(`drop:${id}`); },
        refreshProject: async () => { refreshes.push('detail'); },
    });
    context.beginStageOrderDraft();
    context.moveStageOrder('c', -1);
    const saved = await context.saveStageOrder({disabled: false});
    assert.equal(saved, true);
    assert.deepEqual(plain(context.calls), [{
        method: 'PATCH',
        url: '/api/settings',
        payload: {stage_order: ['a', 'c', 'b']},
    }]);
    assert.deepEqual(plain(context.systemSettings.stage_order), ['a', 'c', 'b']);
    assert.deepEqual(refreshes, ['projects', 'drop:7', 'detail']);
});

test('failed save keeps the draft and non-admin save never calls the API', {skip: !moduleExists}, async () => {
    const failures = [];
    const context = loadModule({
        systemSettings: {stage_order: ['a', 'b', 'c']},
        api: async () => { failures.push('called'); throw new Error('offline'); },
    });
    context.beginStageOrderDraft();
    context.moveStageOrder('b', -1);
    assert.equal(await context.saveStageOrder({disabled: false}), false);
    assert.deepEqual(plain(context.getStageOrderDraft()), ['b', 'a', 'c']);
    assert.deepEqual(failures, ['called']);

    context.currentIsAdmin = false;
    failures.length = 0;
    assert.equal(await context.saveStageOrder({disabled: false}), false);
    assert.deepEqual(failures, []);
});

test('stage order card escapes labels and exposes drag plus button controls', {skip: !moduleExists}, () => {
    const context = loadModule({
        STAGES: [
            {key: 'a', name: '<script>', icon: '<'},
            {key: 'b', name: '审核', icon: 'B'},
            {key: 'c', name: '公示', icon: 'C'},
        ],
        escHtml(value) {
            return String(value).replaceAll('<', '&lt;').replaceAll('>', '&gt;');
        },
    });
    const html = context.renderStageOrderCard({}, true);
    assert.doesNotMatch(html, /<script>/);
    assert.match(html, /draggable="true"/);
    assert.match(html, /data-stage-order-key="a"/);
    assert.match(html, /上移/);
    assert.match(html, /下移/);
    assert.match(html, /恢复默认/);
    assert.match(html, /保存阶段顺序/);
});

test('reminder stage choices follow the configured workflow order', {skip: !moduleExists}, () => {
    const context = loadModule({
        systemSettings: {stage_order: ['c', 'a', 'b']},
        isDesktopApp: () => true,
        detectSmtpProvider: () => 'custom',
        renderReminderRuntimeStatus: () => '',
    });
    const adminSource = fs.readFileSync(adminPath, 'utf8');
    const start = adminSource.indexOf('function reminderStageDefinitions');
    const end = adminSource.indexOf('function renderReminderSettingsCard', start);
    vm.runInContext(adminSource.slice(start, end), context);

    const html = context.renderLegacyReminderSettingsCard({
        stage_order: ['c', 'a', 'b'],
        reminder_stage_keys: ['a', 'b', 'c'],
    });

    assert.ok(html.indexOf('结果公示') < html.indexOf('计划接收'));
    assert.ok(html.indexOf('计划接收') < html.indexOf('文件审核'));
});
