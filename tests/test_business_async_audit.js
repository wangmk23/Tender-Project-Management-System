'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');

function deferred() {
    let resolve;
    const promise = new Promise(done => { resolve = done; });
    return {promise, resolve};
}

function harness(moduleName) {
    const elements = new Map();
    const calls = [];
    const context = {
        console, currentProject: {id: 1, lots: [], stages: [], attachments: [{id: 10, filename: 'a.pdf'}]},
        projectNavigationVersion: 1, escHtml: value => value || '',
        window: {addEventListener() {}}, setTimeout() {},
        document: {
            addEventListener() {}, querySelectorAll: () => [{value: '1'}],
            getElementById(id) {
                if (!elements.has(id)) elements.set(id, {
                    value: '', checked: false, files: [], dataset: {},
                    classList: {add() {}, remove() {}},
                    addEventListener(name, fn) { this[name] = fn; },
                    removeEventListener() {},
                });
                return elements.get(id);
            },
        },
        FormData: class {append() {}},
        getAttachmentUploadLimitMb: async () => 1, attachmentUploadLimitBytes: () => 10000,
        XMLHttpRequest: class {
            constructor() { this.upload = {addEventListener() {}}; this.status = 200; this.responseText = '{}'; }
            addEventListener(name, fn) { this[name] = fn; }
            open() {} setRequestHeader() {} send() { this.load(); }
        },
        toast() {}, storeProjectDetail: project => project,
        showModal(title, html, save) { context.save = save; },
        closeModal() {}, refreshProject: async () => {}, reopenStageModule() {},
        api: async (method, url, data) => { calls.push({method, url, data}); return {id: 11, updated: 1}; },
        apiForm: async () => ({}),
    };
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../source/frontend', moduleName), 'utf8'), context);
    context.showUploadProgress = () => {};
    context.renderAttachments = () => { context.renderCount = (context.renderCount || 0) + 1; };
    return {context, calls, element: id => context.document.getElementById(id)};
}

test('upload detail response cannot replace a subsequently selected project', async () => {
    const {context} = harness('03-attachments.js');
    const detail = deferred(), requested = deferred();
    context.api = async () => { requested.resolve(); return detail.promise; };
    const pending = context.uploadFiles([{name: 'a.pdf', size: 1}]);
    await requested.promise;
    context.currentProject = {id: 2}; context.projectNavigationVersion++;
    detail.resolve({id: 1, attachments: []});
    await pending;
    assert.equal(context.currentProject.id, 2);
    assert.equal(context.renderCount || 0, 0);
});

test('rename refresh stays bound to original project and cannot replace a new selection', async () => {
    const {context, element} = harness('03-attachments.js');
    const write = deferred(), urls = [];
    context.api = async (method, url) => {
        urls.push(url);
        return method === 'PUT' ? write.promise : {id: 1, attachments: []};
    };
    context.renameAttachment(10);
    element('renameInput').value = 'renamed';
    const pending = element('renameOk').click();
    context.currentProject = {id: 2}; context.projectNavigationVersion++;
    write.resolve({filename: 'renamed.pdf'});
    await pending;
    assert.deepEqual(urls, ['/api/attachments/10', '/api/projects/1']);
    assert.equal(context.currentProject.id, 2);
    assert.equal(context.renderCount || 0, 0);
});

test('retry after clarification attachment failure updates the created record', async () => {
    const {context, calls, element} = harness('07-business.js');
    element('clarTitle').value = 'Clarification';
    element('clarFiles').files = [{name: 'a.pdf'}];
    let uploads = 0;
    context.apiForm = async () => { if (++uploads === 1) throw Error('network failed'); return {}; };
    context.showClarificationForm();
    await assert.rejects(context.save(), /network failed/);
    await context.save();
    assert.deepEqual(calls.map(({method, url}) => [method, url]), [
        ['POST', '/api/projects/1/clarifications'], ['PUT', '/api/projects/1/clarifications/11'],
    ]);
});

test('archive bulk clear is a valid standalone change', async () => {
    const {context, calls, element} = harness('07-business.js');
    element('bulkMissingReason').value = '清空';
    context.showBulkArchiveForm();
    await context.save();
    assert.equal(calls.length, 1);
    assert.equal(calls[0].data.missing_reason, '');
});
