'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'source', 'frontend', '01-core.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'source', 'frontend', '04-project-workflow.js'), 'utf8');
const business = fs.readFileSync(path.join(root, 'source', 'frontend', '07-business.js'), 'utf8');
const projects = fs.readFileSync(path.join(root, 'source', 'frontend', '02-projects.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'source', 'frontend', '08-bootstrap.js'), 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function renderStage(key, project = {}) {
    const stage = {key, completed: false, skipped: false, notes: '', ...(project.stage || {})};
    const sandbox = {
        currentProject: {
            id: 7,
            method: '公开招标',
            stages: [stage],
            registrations: [],
            lots: [],
            bid_results: [],
            notice_deliveries: [],
            service_fee_invoices: [],
            ...project,
        },
        editingStageKey: null,
        STAGES: [{key, icon: '•', name: key}],
        STAGE_NAME_CN: {[key]: key},
        systemSettings: {},
        escHtml,
        todayISO() { return '2026-08-02'; },
        renderStageChecklist() { return ''; },
        renderClarificationSection() { return ''; },
        registrationMemberSummaryHtml() { return ''; },
        renderComplaintSection() { return ''; },
        renderArchiveCatalogSection() { return ''; },
        openSlide(title, html) { sandbox.result = html; },
        toast() {},
        result: '',
    };
    sandbox.stageKey = key;
    vm.runInNewContext(`
        ${extractFunction(core, 'projectStageDefinition')}
        ${extractFunction(core, 'stageHasModule')}
        ${extractFunction(workflow, 'openStageSlide')}
        openStageSlide(stageKey);
    `, sandbox);
    return sandbox.result;
}

test('stage detail escapes notice and invoice text before inserting HTML', () => {
    const hostile = '<img src=x onerror="alert(1)">';
    const html = renderStage('winning_notice', {
        stage: {modules: ['common', 'winning_notice', 'service_fee']},
        notice_deliveries: [{id: 1, supplier_name: '供应商', lot_number: hostile, delivery_method: hostile}],
        service_fee_invoices: [{id: 2, invoice_number: hostile, lot_number: hostile, invoice_date: '2026-08-02'}],
    });
    assert.doesNotMatch(html, /<img\b[^>]*onerror=/);
    assert.match(html, /&lt;img src=x onerror=&quot;alert\(1\)&quot;&gt;/);
});

test('stage sections give icon-only add buttons explicit accessible names', () => {
    const registration = renderStage('registration_end');
    assert.match(registration, /aria-label="新增供应商报名"[^>]*>\+<\/button>/);

    const result = renderStage('result_announced');
    assert.match(result, /aria-label="新增项目包或标段"[^>]*>\+<\/button>/);
    assert.match(result, /aria-label="新增中标或成交结果"[^>]*>\+<\/button>/);

    const notice = renderStage('winning_notice');
    assert.match(notice, /aria-label="新增通知书领取记录"[^>]*>\+<\/button>/);
    const serviceFee = renderStage('service_fee');
    assert.match(serviceFee, /aria-label="新增服务费发票"[^>]*>\+<\/button>/);
});

test('clarification and complaint sections label their icon-only add buttons', () => {
    const sandbox = {escHtml, result: null};
    vm.runInNewContext(`
        ${extractFunction(business, 'renderClarificationSection')}
        ${extractFunction(business, 'renderComplaintSection')}
        result = [
            renderClarificationSection({announcement_clarifications: []}),
            renderComplaintSection({complaints: []}),
        ];
    `, sandbox);
    assert.match(sandbox.result[0], /aria-label="新增澄清或更正"[^>]*>\+<\/button>/);
    assert.match(sandbox.result[1], /aria-label="新增质疑或投诉"[^>]*>\+<\/button>/);
});

test('legacy stage keys round-trip through safe event tokens and API path segments', () => {
    const sandbox = {};
    vm.runInNewContext(`
        ${extractFunction(core, 'stageKeyToken')}
        ${extractFunction(core, 'stageKeyFromToken')}
        ${extractFunction(core, 'stageApiSegment')}
        const hostile = "bad');alert(1);//<tag>";
        result = {
            token: stageKeyToken(hostile),
            roundTrip: stageKeyFromToken(stageKeyToken(hostile)),
            segment: stageApiSegment(hostile),
        };
    `, sandbox);
    assert.doesNotMatch(sandbox.result.token, /['"<>]/);
    assert.equal(sandbox.result.roundTrip, "bad');alert(1);//<tag>");
    assert.equal(sandbox.result.segment, "bad')%3Balert(1)%3B%2F%2F%3Ctag%3E".replace(/'/g, '%27'));
});

test('historical stage metadata never enters raw HTML, inline events, or stage URLs', () => {
    assert.doesNotMatch(core, /\$\{item\.stage\.icon\}/);
    assert.doesNotMatch(projects, /\$\{(?:currentDefinition|nextDefinition|definition)\.icon\}/);
    assert.doesNotMatch(projects, /(?:openStageSlide|toggleStage)\('\$\{s\.key\}/);
    assert.doesNotMatch(workflow, /doCompleteStage\('\$\{key\}/);
    assert.doesNotMatch(bootstrap, /openStageSlide\('\$\{p\.current_stage_key\}/);
    for (const source of [projects, workflow]) {
        assert.doesNotMatch(source, /\/stages\/\$\{(?:key|item\.key|editingStageKey)\}/);
    }
});
