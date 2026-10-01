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

function helpers(document = {}) {
    const sandbox = {result: null, document};
    vm.runInNewContext(`
        const METHODS = ['公开招标','竞争性磋商','竞争性谈判','邀请招标','网上竞价','单一来源','遴选','直选'];
        function escHtml(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }
        ${extractFunction('renderSupplierMinimumSettingsCard')}
        ${extractFunction('collectSupplierMinimumSettings')}
        ${extractFunction('registrationLotOptions')}
        ${extractFunction('validateManualLotFlowPayload')}
        ${extractFunction('validateRestoreLotPayload')}
        ${extractFunction('reprocurementPayload')}
        result = {renderSupplierMinimumSettingsCard, collectSupplierMinimumSettings, registrationLotOptions, validateManualLotFlowPayload, validateRestoreLotPayload, reprocurementPayload};
    `, sandbox);
    return sandbox.result;
}

test('supplier minimum settings render exactly eight bounded method inputs', () => {
    const h = helpers();
    const html = h.renderSupplierMinimumSettingsCard({supplier_minimums: {'公开招标': 4}}, true);
    assert.equal((html.match(/data-supplier-minimum=/g) || []).length, 8);
    assert.equal((html.match(/min="1" max="99"/g) || []).length, 8);
    for (const method of ['公开招标','竞争性磋商','竞争性谈判','邀请招标','网上竞价','单一来源','遴选','直选']) {
        assert.ok(html.includes(method));
    }
    assert.ok(html.includes('value="4"'));
});

test('settings collector sends the complete supplier minimum map', () => {
    const inputs = ['公开招标','竞争性磋商','竞争性谈判','邀请招标','网上竞价','单一来源','遴选','直选']
        .map((method, index) => ({dataset: {supplierMinimum: method}, value: String(index + 1)}));
    const h = helpers({querySelectorAll: () => inputs});
    const result = h.collectSupplierMinimumSettings();
    assert.equal(Object.keys(result).length, 8);
    assert.equal(result['公开招标'], 1);
    assert.equal(result['直选'], 8);
});

test('multi-lot registration removes project-wide option and requires a lot', () => {
    const h = helpers();
    const many = h.registrationLotOptions({lots: [{id: 1, lot_number: '01包', lot_name: '甲'}, {id: 2, lot_number: '02包', lot_name: '乙'}]}, null);
    assert.ok(!many.includes('整体项目'));
    assert.ok(many.includes('请选择采购包'));
    const one = h.registrationLotOptions({lots: [{id: 1, lot_number: '01包', lot_name: '甲'}]}, null);
    assert.ok(one.includes('整体项目'));
});

test('manual flow and restore validation require complete input', () => {
    const h = helpers();
    assert.equal(h.validateManualLotFlowPayload({lot_id: null, response_count: 2, reason: '不足'}), '请选择采购包');
    assert.equal(h.validateManualLotFlowPayload({lot_id: 1, response_count: 1.5, reason: '不足'}), '实际响应家数必须为大于等于0的整数');
    assert.equal(h.validateManualLotFlowPayload({lot_id: 1, response_count: 2, reason: ''}), '请填写流标原因');
    assert.equal(h.validateManualLotFlowPayload({lot_id: 1, response_count: 2, reason: '不足'}), '');
    assert.equal(h.validateRestoreLotPayload({reason: ''}), '请填写撤销原因');
    assert.equal(h.validateRestoreLotPayload({reason: '重新核验'}), '');
});

test('reprocurement copies business fields and never copies registrations', () => {
    const h = helpers();
    const payload = h.reprocurementPayload({
        id: 7, lot_number: '01包', lot_name: '办公设备', budget: 900, notes: '旧备注', registrations: [{id: 1}],
    }, '竞争性谈判');
    assert.equal(payload.reprocurement_source_lot_id, 7);
    assert.equal(payload.lot_number, '01包');
    assert.equal(payload.lot_name, '办公设备');
    assert.equal(payload.budget, 900);
    assert.equal(payload.procurement_method, '竞争性谈判');
    assert.equal(Object.hasOwn(payload, 'registrations'), false);
    assert.ok(extractFunction('showReprocurementForm').includes('METHODS.map'));
});

test('workflow exposes manual flow, admin restore and reprocurement actions', () => {
    assert.ok(bundle.includes('showManualLotFlowForm'));
    assert.ok(bundle.includes('showRestoreLotForm'));
    assert.ok(bundle.includes('showReprocurementForm'));
    assert.ok(bundle.includes("lot_action: 'manual_liubiao'"));
    assert.ok(bundle.includes("lot_action: 'restore'"));
    assert.ok(bundle.includes('reprocurement_source_lot_id'));
});
