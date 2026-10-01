'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bundle = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'static', 'app.js'),
    'utf8',
);

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
        ${extractFunction('normalizeConsortiumMembers')}
        ${extractFunction('validateRegistrationPayload')}
        ${extractFunction('renderConsortiumMemberRows')}
        ${extractFunction('registrationMemberSummaryHtml')}
        result = {
            normalizeConsortiumMembers,
            validateRegistrationPayload,
            renderConsortiumMemberRows,
            registrationMemberSummaryHtml,
        };
    `, sandbox);
    return sandbox.result;
}

test('normalization preserves order and standalone clears hidden drafts', () => {
    const helpers = loadHelpers();
    assert.deepEqual(
        JSON.parse(JSON.stringify(helpers.normalizeConsortiumMembers([
            {company_name: ' 成员乙 '},
            '成员甲',
        ]))),
        [{company_name: '成员乙'}, {company_name: '成员甲'}],
    );
    const standalone = {
        bidder_type: 'standalone',
        company_name: '牵头单位',
        consortium_members: [{company_name: '隐藏草稿'}],
    };
    assert.equal(helpers.validateRegistrationPayload(standalone), '');
    assert.deepEqual(
        JSON.parse(JSON.stringify(standalone.consortium_members)),
        [],
    );
});

test('client validation mirrors backend limits and duplicate rules', () => {
    const helpers = loadHelpers();
    const error = payload => helpers.validateRegistrationPayload(payload);
    assert.equal(error({bidder_type: 'other', company_name: 'A'}), '投标主体类型无效');
    assert.equal(error({bidder_type: 'consortium', company_name: '', consortium_members: []}), '请填写联合体牵头单位');
    assert.equal(error({bidder_type: 'consortium', company_name: 'A', consortium_members: []}), '联合体至少需要一个成员单位');
    assert.equal(error({bidder_type: 'consortium', company_name: 'A', consortium_members: [{company_name: ''}]}), '成员单位名称不能为空');
    assert.equal(error({bidder_type: 'consortium', company_name: 'A', consortium_members: [{company_name: 'B'}, {company_name: ' b '}]}), '成员单位名称不能重复');
    assert.equal(error({bidder_type: 'consortium', company_name: 'A', consortium_members: [{company_name: ' a '}]}), '成员单位不能与牵头单位相同');
    assert.equal(error({bidder_type: 'consortium', company_name: 'A', consortium_members: Array.from({length: 21}, (_, i) => ({company_name: `B${i}`}))}), '联合体成员不能超过20个');
    assert.equal(error({bidder_type: 'consortium', company_name: 'A', consortium_members: [{company_name: 'B'.repeat(201)}]}), '成员单位名称不能超过200个字符');
});

test('member rows and summary escape hostile names without data-driven inline script', () => {
    const helpers = loadHelpers();
    const hostile = `</a><img src=x onerror="alert(1)">\n'`;
    const rows = helpers.renderConsortiumMemberRows([hostile, '安全成员']);
    assert.ok(rows.includes('&lt;/a&gt;&lt;img'));
    assert.ok(rows.includes('&quot;alert(1)&quot;'));
    assert.ok(rows.includes('data-consortium-action="remove"'));
    assert.ok(rows.includes('data-member-index="0"'));
    assert.ok(!rows.includes('onclick='));
    assert.ok(!rows.includes('<img'));

    const summary = helpers.registrationMemberSummaryHtml({
        bidder_type: 'consortium',
        consortium_members: [{company_name: hostile}, {company_name: '成员乙'}],
    });
    assert.ok(summary.includes('联合体成员：'));
    assert.ok(summary.includes('&lt;/a&gt;&lt;img'));
    assert.ok(!summary.includes('<img'));
    assert.equal(helpers.registrationMemberSummaryHtml({bidder_type: 'standalone'}), '');
});

test('registration modal exposes consortium controls and count remains parent-based', () => {
    const formSource = extractFunction('showRegistrationForm');
    assert.ok(formSource.includes('投标主体类型'));
    assert.ok(formSource.includes('联合体牵头单位'));
    assert.ok(formSource.includes('data-consortium-action'));
    assert.ok(formSource.includes('addEventListener'));
    assert.ok(formSource.includes("bidder_type"));
    assert.ok(formSource.includes("consortium_members"));

    assert.ok(bundle.includes('(p.registrations||[]).length'));
    assert.ok(!bundle.includes('registration_count + consortium_members'));
});
