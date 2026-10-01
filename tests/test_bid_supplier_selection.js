'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '07-business.js'), 'utf8');
const workflowSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '04-project-workflow.js'), 'utf8');
const coreSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '01-core.js'), 'utf8');

function load(project) {
    const sandbox = {currentProject: project, escHtml: String};
    vm.createContext(sandbox);
    const start = source.indexOf('function registrationSupplierLabel');
    const end = source.indexOf('function showBidResultForm', start);
    assert.ok(start >= 0, 'bid supplier selection helpers must exist');
    vm.runInContext(source.slice(start, end), sandbox);
    return sandbox;
}

test('selected lot restricts winner choices to registrations for that lot', () => {
    const context = load({registrations: [
        {id: 1, lot_id: 10, company_name: '甲公司'},
        {id: 2, lot_id: 20, company_name: '乙公司'},
        {id: 3, lot_id: 10, company_name: '甲公司'},
    ]});
    assert.deepEqual(
        JSON.parse(JSON.stringify(context.eligibleBidRegistrations(context.currentProject, 10))),
        [{id: 1, lot_id: 10, company_name: '甲公司'}],
    );
});

test('consortium choices show the lead and every member while preserving the lead value', () => {
    const project = {registrations: [
        {
            id: 7,
            lot_id: 10,
            company_name: '牵头单位',
            bidder_type: 'consortium',
            consortium_members: [{company_name: '成员甲'}, {company_name: '成员乙'}],
        },
    ]};
    const context = load(project);
    const html = context.bidSupplierOptionsHtml(10, '牵头单位');
    assert.match(html, /value="牵头单位"/);
    assert.match(html, /牵头单位（联合体：成员甲、成员乙）/);
    assert.match(html, /selected/);
});

test('saved results resolve to a full consortium label and retain a safe legacy fallback', () => {
    const project = {registrations: [
        {
            id: 7,
            lot_id: 10,
            company_name: '牵头单位',
            bidder_type: 'consortium',
            consortium_members: [{company_name: '成员甲'}, {company_name: '成员乙'}],
        },
    ]};
    const context = load(project);
    assert.equal(
        context.winningSupplierLabel(project, {lot_id: 10, winning_supplier: '牵头单位'}),
        '牵头单位（联合体：成员甲、成员乙）',
    );
    assert.equal(
        context.winningSupplierLabel(project, {lot_id: 99, winning_supplier: '历史供应商'}),
        '历史供应商',
    );
    assert.match(workflowSource, /winningSupplierLabel\(p,\s*b\)/);
    assert.match(coreSource, /winningSupplierLabel\(p,\s*first\)/);
});

test('whole-project choice lists all registered suppliers and never free text', () => {
    const context = load({registrations: [
        {id: 1, lot_id: null, company_name: '甲公司'},
        {id: 2, lot_id: 20, company_name: '乙公司'},
    ]});
    const html = context.bidSupplierOptionsHtml('', '乙公司');
    assert.match(html, /甲公司/);
    assert.match(html, /乙公司/);
    assert.match(html, /selected/);
    assert.match(source, /<select id="bidSupplier"/);
    assert.doesNotMatch(source, /<input id="bidSupplier"/);
});

test('empty registrations render a blocked choice with registration guidance', () => {
    const context = load({registrations: []});
    assert.match(context.bidSupplierOptionsHtml('', ''), /暂无已报名供应商/);
    assert.match(source, /请先添加供应商报名/);
});

test('notice supplier choices come from winning results and follow the selected lot', () => {
    const context = load({
        lots: [
            {id: 10, lot_number: '包1'},
            {id: 20, lot_number: '包2'},
        ],
        registrations: [],
        bid_results: [
            {id: 1, lot_id: 10, winning_supplier: '甲公司'},
            {id: 2, lot_id: 20, winning_supplier: '乙公司'},
        ],
    });
    assert.deepEqual(
        JSON.parse(JSON.stringify(context.eligibleNoticeBidResults(context.currentProject, 10))),
        [{id: 1, lot_id: 10, winning_supplier: '甲公司'}],
    );
    const lotHtml = context.noticeWinnerOptionsHtml(10, '');
    assert.match(lotHtml, /value="甲公司" selected/);
    assert.doesNotMatch(lotHtml, /乙公司/);
    const wholeHtml = context.noticeWinnerOptionsHtml('', '乙公司');
    assert.match(wholeHtml, /甲公司/);
    assert.match(wholeHtml, /乙公司/);
    assert.match(wholeHtml, /value="乙公司" selected/);
});

test('notice supplier choices display every consortium member while storing the lead', () => {
    const context = load({
        lots: [{id: 10, lot_number: '包1'}],
        registrations: [{
            id: 7,
            lot_id: 10,
            company_name: '牵头单位',
            bidder_type: 'consortium',
            consortium_members: [{company_name: '成员甲'}, {company_name: '成员乙'}],
        }],
        bid_results: [{id: 1, lot_id: 10, winning_supplier: '牵头单位'}],
    });
    const html = context.noticeWinnerOptionsHtml(10, '');
    assert.match(html, /value="牵头单位" selected/);
    assert.match(html, /牵头单位（联合体：成员甲、成员乙）/);
});

test('notice form uses a winner select and refreshes it when the lot changes', () => {
    assert.match(source, /id="noticeLotId"[^>]*onchange="refreshNoticeWinnerOptions\(\)"/);
    assert.match(source, /<select id="noticeSupplier"/);
    assert.doesNotMatch(source, /<input id="noticeSupplier"/);
    assert.match(source, /当前范围暂无中标或成交供应商/);
    assert.match(source, /请选择前面阶段的中标或成交供应商/);
});
