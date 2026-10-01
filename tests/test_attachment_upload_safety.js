'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('source/frontend/03-attachments.js', 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`async function ${name}(`);
    assert.ok(start >= 0, `${name} must exist`);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`cannot parse ${name}`);
}

class FakeEventTarget {
    constructor() { this.listeners = {}; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
}

function createHarness(status = 400) {
    const toasts = [];
    const progress = [];
    let xhrCount = 0;
    let sendCount = 0;
    let refreshCalls = 0;

    class FakeFormData {
        constructor() { this.entries = []; }
        append(...args) { this.entries.push(args); }
    }

    class FakeXMLHttpRequest extends FakeEventTarget {
        constructor() {
            super();
            xhrCount += 1;
            this.upload = new FakeEventTarget();
            this.status = status;
            this.responseText = '{}';
        }
        open() {}
        setRequestHeader() {}
        send() {
            sendCount += 1;
            this.listeners.load();
        }
    }

    const sandbox = {
        currentProject: {id: 7},
        getAttachmentUploadLimitMb: async () => 1024,
        attachmentUploadLimitBytes: () => 1024 * 1024 * 1024,
        FormData: FakeFormData,
        XMLHttpRequest: FakeXMLHttpRequest,
        showUploadProgress: (...args) => progress.push(args),
        toast: (...args) => toasts.push(args),
        api: async () => { throw new Error('api must not run after a failed upload'); },
        refreshAttachmentCsrfToken: async () => {
            refreshCalls += 1;
            return 'token-refreshed';
        },
        renderAttachments: () => {},
        console: {error: () => {}},
        window: {CSRF_TOKEN: 'token-7'},
        result: null,
    };
    vm.runInNewContext(`${extractFunction('uploadFiles')}\nresult = uploadFiles;`, sandbox);
    return {
        uploadFiles: sandbox.result,
        toasts,
        progress,
        get xhrCount() { return xhrCount; },
        get sendCount() { return sendCount; },
        get refreshCalls() { return refreshCalls; },
    };
}

async function testExpiredUploadIsNotReplayed() {
    const state = createHarness(400);
    await state.uploadFiles([{name: '模拟.pdf', size: 1024 * 1024}]);
    assert.equal(state.sendCount, 1);
    assert.equal(state.refreshCalls, 0);
    assert.equal(state.toasts.some(call => /请求已过期，请刷新页面后重试/.test(call[0])), true);
    assert.deepEqual(state.progress, [[true, 0], [false]]);
}

async function testFilesUpToOneGigabyteReachTheUploadRequest() {
    const state = createHarness();
    await state.uploadFiles([{name: 'large.zip', size: 900 * 1024 * 1024}]);
    assert.equal(state.xhrCount, 1);
}

async function testFilesOverOneGigabyteAreRejectedBeforeUpload() {
    const state = createHarness();
    await state.uploadFiles([{name: 'too-large.zip', size: 1030 * 1024 * 1024}]);
    assert.equal(state.xhrCount, 0);
    assert.equal(state.toasts.some(call => /1030\.0MB/.test(call[0])), true);
}

Promise.resolve()
    .then(testExpiredUploadIsNotReplayed)
    .then(testFilesUpToOneGigabyteReachTheUploadRequest)
    .then(testFilesOverOneGigabyteAreRejectedBeforeUpload)
    .then(() => console.log('attachment upload safety tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
