'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'app.js'), 'utf8');

function extractFunction(name) {
    const start = bundle.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js must define ${name}()`);
    const braceStart = bundle.indexOf('{', bundle.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < bundle.length; index += 1) {
        if (bundle[index] === '{') depth += 1;
        if (bundle[index] === '}') depth -= 1;
        if (depth === 0) return bundle.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

function loadHelpers() {
    const sandbox = {result: null};
    vm.runInNewContext(`
        function escHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, character => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[character]);
        }
        ${extractFunction('supplierRiskStateOf')}
        ${extractFunction('supplierRiskBadgeHtml')}
        ${extractFunction('renderSupplierRiskBanner')}
        ${extractFunction('renderLotSupplierRows')}
        result = {supplierRiskStateOf, supplierRiskBadgeHtml, renderSupplierRiskBanner, renderLotSupplierRows};
    `, sandbox);
    return sandbox.result;
}

function warningProject(items, extra = {}) {
    return {
        lot_supplier_state: {
            warning_count: items.length,
            flowed_count: 0,
            total_count: items.length,
            days_remaining: 1,
            items,
        },
        ...extra,
    };
}

test('risk banner includes lot number, lot name and exact missing count', () => {
    const helpers = loadHelpers();
    const html = helpers.renderSupplierRiskBanner(warningProject([
        {lot_id: 1, lot_number: '01包', lot_name: '办公设备采购', missing_count: 1, registration_count: 2, required_count: 3, status: 'warning'},
        {lot_id: 3, lot_number: '03包', lot_name: '信息系统维护服务', missing_count: 3, registration_count: 0, required_count: 3, status: 'warning'},
    ]));
    assert.ok(html.includes('2个包报名供应商不足，距离报名截止还有1天。'));
    assert.ok(html.includes('01包 办公设备采购还差1家'));
    assert.ok(html.includes('03包 信息系统维护服务还差3家'));
    assert.ok(html.includes('data-stage-key="registration_end"'));
});

test('banner escapes names, supplies fallbacks and collapses after three lots', () => {
    const helpers = loadHelpers();
    const items = [
        {lot_id: 1, lot_number: '01包', lot_name: '', missing_count: 1, status: 'warning'},
        {lot_id: 2, lot_number: '<img>', lot_name: '<script>alert(1)</script>', missing_count: 2, status: 'warning'},
        {lot_id: 3, lot_number: '03包', lot_name: '三包', missing_count: 3, status: 'warning'},
        {lot_id: 4, lot_number: '04包', lot_name: '四包', missing_count: 1, status: 'warning'},
    ];
    const html = helpers.renderSupplierRiskBanner(warningProject(items));
    assert.ok(html.includes('01包 未命名包还差1家'));
    assert.ok(html.includes('&lt;img&gt; &lt;script&gt;alert(1)&lt;/script&gt;还差2家'));
    assert.ok(!html.includes('<script>'));
    assert.ok(html.includes('另有1个包'));

    const noLot = helpers.renderSupplierRiskBanner(warningProject([
        {lot_id: null, lot_number: '', lot_name: '项目整体', missing_count: 2, status: 'warning'},
    ]));
    assert.ok(noLot.includes('项目整体还差2家'));
});

test('special badges distinguish warning and partial lot flow', () => {
    const helpers = loadHelpers();
    const warning = warningProject([
        {lot_id: 1, status: 'warning'},
        {lot_id: 2, status: 'warning'},
    ]);
    assert.equal(helpers.supplierRiskStateOf(warning).text, '流标预警·2个包');
    assert.ok(helpers.supplierRiskBadgeHtml(warning).includes('流标预警·2个包'));

    const partial = {
        lot_supplier_state: {warning_count: 0, flowed_count: 1, total_count: 3, items: []},
    };
    assert.equal(helpers.supplierRiskStateOf(partial).text, '部分包流标·1/3');
});

test('unsegmented project uses plain warning badge and overall detail', () => {
    const helpers = loadHelpers();
    const project = warningProject([
        {lot_id: null, lot_number: '', lot_name: '项目整体', registration_count: 2, required_count: 3, missing_count: 1, status: 'warning'},
    ]);
    assert.equal(helpers.supplierRiskStateOf(project).text, '流标预警');
    assert.ok(helpers.renderSupplierRiskBanner(project).includes('项目报名供应商不足'));
    assert.ok(helpers.renderLotSupplierRows(project).includes('项目整体'));
    assert.ok(!helpers.supplierRiskBadgeHtml(project).includes('1个包'));
});

test('segmented detail includes lot identity counts and missing count', () => {
    const helpers = loadHelpers();
    const project = warningProject([
        {lot_id: 1, lot_number: '01包', lot_name: '办公设备采购', registration_count: 2, required_count: 3, missing_count: 1, status: 'warning'},
    ]);
    assert.equal(helpers.supplierRiskStateOf(project).text, '流标预警·1个包');
    const rows = helpers.renderLotSupplierRows(project);
    assert.ok(rows.includes('01包 办公设备采购'));
    assert.ok(rows.includes('2/3家'));
    assert.ok(rows.includes('还差1家'));
});

test('lot supplier rows use backend counts and statuses only', () => {
    const helpers = loadHelpers();
    const html = helpers.renderLotSupplierRows(warningProject([
        {lot_id: 1, lot_number: '01包', lot_name: '办公设备采购', registration_count: 2, required_count: 3, status: 'warning'},
        {lot_id: 2, lot_number: '02包', lot_name: '网络设备采购', registration_count: 4, required_count: 3, status: 'active'},
        {lot_id: 3, lot_number: '03包', lot_name: '运维服务', registration_count: 0, required_count: 3, status: 'liubiao'},
    ]));
    assert.ok(html.includes('01包 办公设备采购'));
    assert.ok(html.includes('2/3家'));
    assert.ok(html.includes('流标预警'));
    assert.ok(html.includes('4/3家'));
    assert.ok(html.includes('正常'));
    assert.ok(html.includes('已流标'));
});
