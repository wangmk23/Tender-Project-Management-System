const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const source = fs.readFileSync('source/frontend/06-admin.js', 'utf8');
function load(settings) {
    const dom = new JSDOM('<main></main>');
    const ctx = vm.createContext({systemSettings: settings, document: dom.window.document,
        getOrderedStages: () => [{key: 'first', name: '开始'}], clientProcurementMethods: () => ['公开招标'],
        normalizeClientStageTemplates: value => value, escHtml: value => String(value).replaceAll('<', '&lt;')});
    vm.runInContext(source.slice(source.indexOf('function reminderStageDefinitions'), source.indexOf('function renderLegacyReminderSettingsCard')), ctx);
    return {ctx, dom};
}
test('mail choices use server definitions including snapshot-only subscriptions', () => {
    const settings = {reminder_stage_definitions: [{key: 'snapshot', name: '项目快照专用', methods: ['历史项目流程']}], stage_templates: {'公开招标': []}};
    const {ctx, dom} = load(settings);
    const rows = ctx.reminderStageDefinitions(settings);
    dom.window.document.querySelector('main').innerHTML = ctx.renderReminderStageGroups(rows, new Set(['snapshot']), '');
    const input = dom.window.document.querySelector('[data-reminder-stage][value="snapshot"]');
    assert.ok(input);
    assert.ok(input.checked);
    assert.match(input.parentElement.textContent, /项目快照专用/);
    dom.window.close();
});
test('catalog fallback retains duplicate-name independent templates and historical selected keys', () => {
    const settings = {procurement_catalog: {common_stages: [{id: 'first', name: '开始'}], methods: [
        {name: '同名采购', regime: 'enterprise', template_mode: 'independent', stages: [{id: 'custom_a', name: '独立一'}]},
        {name: '同名采购', regime: 'collective', template_mode: 'independent', stages: [{id: 'custom_b', name: '独立二'}]}]},
        reminder_stage_keys: ['old_key']};
    const {ctx, dom} = load(settings);
    const rows = ctx.reminderStageDefinitions(settings);
    assert.ok(['custom_a', 'custom_b', 'old_key'].every(key => rows.some(row => row.key === key)));
    dom.window.close();
});
