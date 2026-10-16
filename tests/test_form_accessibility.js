'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const path = require('node:path');
const frontend = path.join(__dirname, '../source/frontend');

function fixture(html = '<main></main>', registration = null, lots = []) {
    const dom = new JSDOM(html);
    const calls = [];
    const context = vm.createContext({window: dom.window, document: dom.window.document,
        currentProject: {id: 1, lots, registrations: registration ? [registration] : []},
        escHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
        toast() {}, closeModal() {}, refreshProject: async () => {}, reopenStageModule() {},
        showModal(title, body, save) { dom.window.document.querySelector('main').innerHTML = body; context.save = save; },
        api: async (method, url, data) => { calls.push({method, url, data}); return {id: 1}; },
    });
    const helper = path.join(frontend, '20-form-accessibility.js');
    if (fs.existsSync(helper)) vm.runInContext(fs.readFileSync(helper, 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(frontend, '07-business.js'), 'utf8'), context);
    return {dom, context, calls, doc: dom.window.document};
}

test('common fields gain clickable labels and toggle names without replacing existing associations', () => {
    const {doc, context} = fixture(`<main><div><label>项目编号</label><input id="number"></div>
        <div><label>开始时间</label><div><input id="date" type="date"><input id="time" type="time" aria-label="开始时刻"></div></div>
        <div class="toggle-row"><div class="toggle-switch"><input id="enabled" type="checkbox"></div><span class="toggle-label">启用通知</span></div>
        <label><input type="checkbox" id="wrapped">每日提醒</label><input id="named" aria-label="既有名称"></main>`);
    assert.ok(context.window.PMForms, 'shared form enhancement is available');
    context.window.PMForms.enhance(doc.querySelector('main'));
    context.window.PMForms.enhance(doc.querySelector('main'));
    assert.equal(doc.querySelector('label').htmlFor, 'number');
    assert.equal(doc.querySelector('#number').labels[0].textContent, '项目编号');
    assert.equal(doc.querySelector('#date').labels[0].textContent, '开始时间');
    assert.equal(doc.querySelector('#time').getAttribute('aria-label'), '开始时刻');
    const toggle = doc.querySelector('#enabled');
    assert.equal(doc.getElementById(toggle.getAttribute('aria-labelledby')).textContent, '启用通知');
    assert.equal(doc.querySelector('#wrapped').labels.length, 1);
    assert.equal(doc.querySelector('#named').getAttribute('aria-label'), '既有名称');
});

test('field feedback reveals collapsed inputs and removes only its own description', () => {
    const {doc, context} = fixture('<main><div id="form"><details><summary>成员</summary><label for="email">邮箱</label><input id="email" aria-describedby="hint"><small id="hint">工作邮箱</small></details></div></main>');
    assert.ok(context.window.PMForms, 'field feedback is available');
    const form = doc.querySelector('#form'), input = doc.querySelector('#email');
    context.window.PMForms.showErrors(form, {email: '<邮箱无效>'});
    assert.equal(doc.activeElement, input);
    assert.equal(input.closest('details').open, true);
    assert.equal(input.getAttribute('aria-invalid'), 'true');
    const ids = input.getAttribute('aria-describedby').split(' ');
    assert.equal(doc.getElementById(ids[1]).textContent, '<邮箱无效>');
    assert.equal(doc.querySelectorAll('.field-error img').length, 0);
    context.window.PMForms.showErrors(form, {email: '邮箱仍无效'});
    assert.equal(form.querySelectorAll('.field-error').length, 1);
    context.window.PMForms.clearErrors(form);
    assert.equal(input.hasAttribute('aria-invalid'), false);
    assert.equal(input.getAttribute('aria-describedby'), 'hint');
    assert.equal(form.querySelector('.form-error-summary'), null);
});

test('registration repeated invalid saves keep inline feedback, focus and all member drafts', async () => {
    const registration = {id: 1, bidder_type: 'consortium', company_name: '牵头单位', consortium_members: [{company_name: '成员甲', notes: '成员草稿'}], attachments: []};
    const {doc, context, calls, dom} = fixture('<main></main>', registration);
    context.showRegistrationForm(1);
    const company = doc.querySelector('#regCompany');
    assert.ok(company.labels.length, 'lead company has a clickable visible label');
    assert.equal(company.labels[0].htmlFor, 'regCompany');
    for (const input of doc.querySelectorAll('#registrationForm input, #registrationForm select, #registrationForm textarea')) {
        assert.ok(input.labels.length, `${input.id} has a visible label`);
    }
    company.value = '';
    for (let count = 0; count < 2; count++) {
        assert.equal(await context.save(), false);
        assert.equal(company.getAttribute('aria-invalid'), 'true');
        assert.equal(doc.activeElement, company);
        assert.match(doc.getElementById(company.getAttribute('aria-describedby')).textContent, /牵头单位/);
    }
    assert.equal(calls.length, 0);
    assert.equal(doc.querySelector('[data-member-field="notes"]').value, '成员草稿');
    company.value = '修正牵头'; company.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    assert.equal(company.hasAttribute('aria-invalid'), false);
    assert.equal(doc.querySelector('.form-error-summary'), null);
    await context.save();
    assert.equal(calls[0].data.consortium_members[0].notes, '成员草稿');
});

test('registration errors follow member ownership when reordered and clear only when valid', async () => {
    const registration = {id: 1, bidder_type: 'consortium', company_name: '牵头', consortium_members: [{company_name: '甲'}, {company_name: '乙', manager_email: 'invalid'}], attachments: []};
    const {doc, context, dom, calls} = fixture('<main></main>', registration);
    context.showRegistrationForm(1); await context.save();
    let email = doc.querySelector('#regMember1manager_email');
    assert.equal(email.getAttribute('aria-invalid'), 'true');
    assert.equal(email.closest('details').open, true);
    doc.querySelector('[data-consortium-action="up"][data-member-index="1"]').click();
    email = doc.querySelector('#regMember0manager_email');
    assert.equal(email.value, 'invalid');
    assert.equal(email.getAttribute('aria-invalid'), 'true');
    email.value = 'still wrong'; email.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    assert.equal(email.getAttribute('aria-invalid'), 'true');
    email.value = 'member@example.test'; email.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
    assert.equal(email.hasAttribute('aria-invalid'), false);
    await context.save(); assert.equal(calls[0].data.consortium_members[0].company_name, '乙');
});

test('multi-lot and missing member feedback target actionable controls without saving', async () => {
    const registration = {id: 1, bidder_type: 'consortium', company_name: '牵头', consortium_members: [{company_name: '甲'}], attachments: []};
    const {doc, context, dom, calls} = fixture('<main></main>', registration, [{id: 1}, {id: 2}]);
    context.showRegistrationForm(1); await context.save();
    assert.equal(doc.activeElement.id, 'regLotId');
    doc.querySelector('[data-consortium-action="remove"]').click();
    assert.equal(doc.querySelector('[data-consortium-action="add"]').getAttribute('aria-invalid'), 'true');
    doc.querySelector('#regLotId').value = '1';
    doc.querySelector('#regLotId').dispatchEvent(new dom.window.Event('change', {bubbles: true}));
    assert.equal(doc.querySelector('#regLotId').hasAttribute('aria-invalid'), false);
    await context.save(); assert.equal(doc.activeElement.dataset.consortiumAction, 'add');
    assert.equal(calls.length, 0);
});

test('recipient drawer labels and nested event names survive rebuilding content fields', () => {
    const {context, doc} = fixture();
    Object.assign(context, {systemSettings: {reminder_recipient_groups: []}, activateDialogFocus() {}});
    // This fixture exercises drawer rendering, without booting unrelated user/theme panels.
    const admin = fs.readFileSync(path.join(frontend, '06-admin.js'), 'utf8').replace(/\ninitDisplayPreferences\(\);\s*initUserUI\(\);\s*$/, '');
    vm.runInContext(admin, context);
    context.openRecipientGroupDrawer(null);
    for (const id of ['recipientGroupName', 'recipientGroupEmails', 'recipientGroupPrefix']) {
        assert.equal(doc.getElementById(id).labels.length, 1, id);
    }
    context.refreshRecipientGroupDrawerFields();
    for (const input of doc.querySelectorAll('#recipientGroupDrawerOverlay input[type="checkbox"]')) {
        assert.ok(input.labels[0].textContent.trim(), input.outerHTML);
    }
});
