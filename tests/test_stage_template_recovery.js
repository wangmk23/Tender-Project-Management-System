'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const modulePath = path.join(__dirname, '..', 'source', 'frontend', '11-stage-settings.js');

function plain(value) {
    return JSON.parse(JSON.stringify(value));
}

function loadModule(extra = {}) {
    const calls = [];
    const sandbox = {
        STAGES: [
            {key: 'plan', name: '计划接收', icon: '📥'},
            {key: 'bid_opening', name: '开标', icon: '🎯'},
        ],
        METHODS: ['公开招标', '竞争性磋商'],
        systemSettings: {},
        currentIsAdmin: true,
        currentProject: null,
        api: async (method, url, payload) => {
            calls.push({method, url, payload});
            return {settings: {stage_templates: payload.stage_templates}};
        },
        confirmDialog: async () => true,
        toast() {},
        escHtml(value) { return String(value); },
        document: {getElementById() { return null; }},
        ...extra,
    };
    sandbox.calls = calls;
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(modulePath, 'utf8'), sandbox);
    return sandbox;
}

test('legacy stages expand into an independent template for every procurement method', () => {
    const context = loadModule({systemSettings: {stage_order: ['bid_opening', 'plan']}});

    const templates = plain(context.defaultClientStageTemplates(context.systemSettings));

    assert.deepEqual(Object.keys(templates), ['公开招标', '竞争性磋商']);
    assert.deepEqual(templates['公开招标'].map(row => row.id), ['bid_opening', 'plan']);
    assert.deepEqual(templates['公开招标'][0].modules, ['common', 'checklist', 'bid_opening', 'auto_completion']);
    templates['公开招标'][0].name = '已修改';
    assert.equal(templates['竞争性磋商'][0].name, '开标');
});

test('normalization accepts complete method templates and adds common exactly once', () => {
    const context = loadModule();
    const raw = {
        '公开招标': [{id: 'notice', name: '公告', icon: '📢', modules: ['checklist', 'common']}],
        '竞争性磋商': [{id: 'talk', name: '磋商', icon: '🤝', modules: ['checklist']}],
    };

    const normalized = plain(context.normalizeClientStageTemplates(raw, {}));

    assert.deepEqual(normalized['公开招标'][0].modules, ['common', 'checklist']);
    assert.deepEqual(normalized['竞争性磋商'][0].modules, ['common', 'checklist']);
});

test('saving templates submits all methods and adopts the normalized response', async () => {
    const initial = {
        '公开招标': [{id: 'plan', name: '计划接收', icon: '📥', modules: ['common']}],
        '竞争性磋商': [{id: 'talk', name: '磋商', icon: '🤝', modules: ['common']}],
    };
    const context = loadModule({systemSettings: {stage_templates: initial}});
    context.beginStageTemplateDraft();
    context.selectStageTemplateMethod('竞争性磋商');
    context.updateStageTemplateDraft('talk', 'name', '磋商会议');

    assert.equal(await context.saveStageTemplates({disabled: false}), true);

    assert.equal(context.calls.length, 1);
    assert.deepEqual(plain(context.calls[0]), {
        method: 'PATCH',
        url: '/api/settings',
        payload: {
            stage_templates: {
                '公开招标': [{id: 'plan', name: '计划接收', icon: '📥', modules: ['common']}],
                '竞争性磋商': [{id: 'talk', name: '磋商会议', icon: '🤝', modules: ['common']}],
            },
        },
    });
});

test('template editor exposes procurement tabs, module choices, save, and additive sync', () => {
    const context = loadModule({
        systemSettings: {
            stage_templates: {
                '公开招标': [{id: 'plan', name: '计划接收', icon: '📥', modules: ['common']}],
                '竞争性磋商': [{id: 'talk', name: '磋商', icon: '🤝', modules: ['common']}],
            },
            stage_module_catalog: [
                {id: 'common', name: '通用阶段信息', singleton: false},
                {id: 'bid_opening', name: '开标与响应处理', singleton: true},
                {id: 'auto_completion', name: '到时自动完成', singleton: false},
            ],
        },
    });

    context.toggleStageTemplateExpanded('plan');
    const html = context.renderStageTemplateCard(context.systemSettings, true);

    assert.match(html, /公开招标/);
    assert.match(html, /竞争性磋商/);
    assert.match(html, /开标与响应处理/);
    assert.match(html, /到时自动完成/);
    assert.match(html, /data-stage-template-module="auto_completion"/);
    assert.match(html, /保存模板/);
    assert.match(html, /同步现有项目/);
    assert.match(html, /data-stage-template-field="icon"/);
    assert.match(html, /📢/);
    assert.match(html, /🎯/);
});

test('template stages render as collapsed summary cards and expand one editor on demand', () => {
    const context = loadModule({
        systemSettings: {
            stage_templates: {
                '公开招标': [
                    {id: 'plan', name: '计划接收', icon: '📥', modules: ['common']},
                    {id: 'bid_opening', name: '开标', icon: '🎯', modules: ['common', 'bid_opening']},
                ],
                '竞争性磋商': [{id: 'talk', name: '磋商', icon: '🤝', modules: ['common']}],
            },
            stage_module_catalog: [
                {id: 'common', name: '通用阶段信息', singleton: false},
                {id: 'bid_opening', name: '开标与响应处理', singleton: true},
            ],
        },
    });

    const collapsed = context.renderStageTemplateCard(context.systemSettings, true);
    assert.match(collapsed, /class="stage-template-summary"/);
    assert.match(collapsed, /data-stage-template-action="expand"/);
    assert.doesNotMatch(collapsed, /class="stage-template-editor"/);

    context.toggleStageTemplateExpanded('plan');
    const expanded = context.renderStageTemplateCard(context.systemSettings, true);
    assert.match(expanded, /data-stage-template-id="plan"[\s\S]*class="stage-template-editor"/);
    assert.match(expanded, /data-stage-template-field="icon"/);
    assert.match(expanded, /<option value="📥" selected>/);
    assert.match(expanded, /data-stage-template-id="bid_opening"[\s\S]*>编辑<\/button>/);
    assert.equal((expanded.match(/class="stage-template-editor"/g) || []).length, 1);
});
