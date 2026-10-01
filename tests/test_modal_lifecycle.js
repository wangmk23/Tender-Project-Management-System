'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'source', 'frontend', '01-core.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'source', 'frontend', '06-admin.js'), 'utf8');

function extractFunction(source, name) {
    const functionStart = source.indexOf(`function ${name}(`);
    assert.notEqual(functionStart, -1, `${name} must exist`);
    const asyncStart = source.lastIndexOf('async ', functionStart);
    const start = asyncStart >= 0 && asyncStart + 6 === functionStart ? asyncStart : functionStart;
    const bodyStart = source.indexOf('{', source.indexOf(')', functionStart));
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = bodyStart; index < source.length; index += 1) {
        const character = source[index];
        if (escaped) {
            escaped = false;
            continue;
        }
        if (character === '\\') {
            escaped = true;
            continue;
        }
        if (quote) {
            if (character === quote) quote = '';
            continue;
        }
        if (character === '"' || character === "'" || character === '`') {
            quote = character;
            continue;
        }
        if (character === '{') depth += 1;
        if (character === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

function classList() {
    const values = new Set();
    return {
        add(...names) { names.forEach(name => values.add(name)); },
        remove(...names) { names.forEach(name => values.delete(name)); },
        contains(name) { return values.has(name); },
    };
}

function element() {
    return {
        classList: classList(),
        style: {display: ''},
        textContent: '',
        innerHTML: '',
        value: '',
        disabled: false,
        onclick: null,
        focus() {},
        setAttribute() {},
        setSelectionRange() {},
    };
}

function harness() {
    const elements = Object.fromEntries([
        'userMenu', 'modal', 'modalTitle', 'modalBody', 'modalFooter',
        'modalOverlay', 'modalSaveBtn',
    ].map(id => [id, element()]));
    const sandbox = {
        window: {CURRENT_USER: {id: 1}},
        document: {
            getElementById(id) { return elements[id] || null; },
        },
        api: async method => method === 'GET' ? [] : {},
        escHtml(value) { return String(value ?? ''); },
        toast() {},
        activateDialogFocus() {},
        releaseDialogFocus() {},
        confirmDialog: async () => true,
        reasonDialog: async () => ({ok: false, value: ''}),
    };
    vm.createContext(sandbox);
    vm.runInContext(`
        ${extractFunction(coreSource, 'resetModalState')}
        ${extractFunction(coreSource, 'showModal')}
        ${extractFunction(coreSource, 'closeModal')}
        let userManagementUsers = [];
        ${extractFunction(adminSource, 'openChangePassword')}
        ${extractFunction(adminSource, 'openUserManagement')}
        ${extractFunction(adminSource, 'renderUserList')}
        ${extractFunction(adminSource, 'showUserForm')}
    `, sandbox);
    return {sandbox, elements};
}

function seedSharedFooter(state) {
    state.sandbox.showModal('保存型弹窗', '<input>', async () => true);
    assert.equal(state.elements.modalFooter.style.display, 'flex');
    assert.match(state.elements.modalFooter.innerHTML, /取消/);
    assert.match(state.elements.modalFooter.innerHTML, /保存/);
}

test('change-password modal removes actions left by a shared-footer modal', () => {
    const state = harness();
    seedSharedFooter(state);

    state.sandbox.openChangePassword();

    assert.equal(state.elements.modalFooter.style.display, 'none');
    assert.equal(state.elements.modalFooter.innerHTML, '');
    assert.match(state.elements.modalBody.innerHTML, /submitChangePassword/);
});

test('user management and user forms never inherit shared-footer actions', async () => {
    const state = harness();
    seedSharedFooter(state);

    await state.sandbox.openUserManagement();
    assert.equal(state.elements.modalFooter.style.display, 'none');
    assert.equal(state.elements.modalFooter.innerHTML, '');
    assert.equal(state.elements.modal.classList.contains('modal-wide'), true);

    seedSharedFooter(state);
    state.sandbox.showUserForm(0);
    assert.equal(state.elements.modalFooter.style.display, 'none');
    assert.equal(state.elements.modalFooter.innerHTML, '');
    assert.equal(state.elements.modal.classList.contains('modal-wide'), false);
});

test('closing a modal clears body and footer state before the next open', () => {
    const state = harness();
    seedSharedFooter(state);

    state.sandbox.closeModal();

    assert.equal(state.elements.modalBody.innerHTML, '');
    assert.equal(state.elements.modalFooter.innerHTML, '');
    assert.equal(state.elements.modalFooter.style.display, 'none');
    assert.equal(state.elements.modal.classList.contains('open'), false);
    assert.equal(state.elements.modalOverlay.classList.contains('open'), false);
});
