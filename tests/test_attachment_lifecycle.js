'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'static', 'app.js'),
    'utf8',
);

function extractFunction(name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `app.js must define ${name}()`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

function previewHarness() {
    const removed = [];
    const revoked = [];
    let destroyed = 0;
    const elements = new Map();
    for (const id of [
        'docPreviewOverlay', 'pdfViewerContainer', 'imageViewerContainer',
        'docxViewerContainer', 'excelViewerContainer',
    ]) {
        elements.set(id, {
            id,
            innerHTML: `${id}-content`,
            classList: {remove() {}},
            removeEventListener(type, handler, options) {
                removed.push({id, type, handler, options});
            },
        });
    }
    const sandbox = {
        document: {
            body: {style: {overflow: 'hidden'}},
            getElementById(id) { return elements.get(id) || null; },
        },
        URL: {revokeObjectURL(url) { revoked.push(url); }},
        luckysheet: {destroy() { destroyed += 1; }},
        console: {error() {}},
        result: null,
    };
    vm.runInNewContext(`
        let _previewSessionVersion = 1;
        const _cancelledPdfLoadingTasks = new WeakSet();
        let _pdfShortcutBound = true;
        let _pdfKeydownHandler = () => {};
        let _pdfWheelHandler = () => {};
        let _previewReturnFocus = null;
        let _previewState = {
            type: 'excel', fileId: 9, fileName: 'sheet.xlsx', pdfDoc: null,
            pageNum: 1, totalPages: 0, scale: 1, rendering: false,
            objectUrls: new Set(['blob:first', 'blob:second']),
            luckysheetCreated: true, pdfLoadingTask: null, sessionVersion: 1,
        };
        ${extractFunction('cancelPdfLoadingTask')}
        ${extractFunction('releaseAttachmentPreviewResources')}
        ${extractFunction('closeDocPreview')}
        result = {
            releaseAttachmentPreviewResources,
            closeDocPreview,
            getState: () => _previewState,
        };
    `, sandbox);
    return {
        ...sandbox.result,
        elements,
        removed,
        revoked,
        get destroyed() { return destroyed; },
        sandbox,
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return {promise, resolve, reject};
}

async function flushUntil(predicate, message) {
    for (let index = 0; index < 20; index += 1) {
        if (predicate()) return;
        await Promise.resolve();
    }
    assert.fail(message);
}

function asyncPreviewHarness(extraSource, overrides = {}) {
    const elements = new Map();
    for (const id of [
        'docPreviewOverlay', 'previewLoading', 'pdfViewerContainer',
        'imageViewerContainer', 'docxViewerContainer', 'excelViewerContainer',
    ]) {
        elements.set(id, {
            id, innerHTML: '', clientWidth: 800, style: {display: ''},
            classList: {remove() {}}, appendChild() {}, replaceChildren(...children) {
                this.innerHTML = children.map(child => child.innerHTML || '').join('');
            },
            removeEventListener() {},
        });
    }
    const sandbox = {
        document: {
            body: {style: {}},
            getElementById(id) { return elements.get(id) || null; },
            createElement() { return {innerHTML: '', childNodes: []}; },
        },
        URL: {revokeObjectURL() {}},
        console: {error() {}, warn() {}},
        Uint8Array,
        WeakSet,
        result: null,
        ...overrides,
    };
    vm.runInNewContext(`
        let _previewSessionVersion = 1;
        const _cancelledPdfLoadingTasks = new WeakSet();
        let _pdfShortcutBound = false;
        let _pdfKeydownHandler = null;
        let _pdfWheelHandler = null;
        let _previewReturnFocus = null;
        let _previewState = {
            type: 'pdf', fileId: 7, fileName: 'old.pdf', pdfDoc: null,
            pdfLoadingTask: null, sessionVersion: 1, pageNum: 1, totalPages: 0,
            scale: 1, rendering: false, objectUrls: new Set(), luckysheetCreated: false,
        };
        ${extractFunction('isAttachmentPreviewSessionCurrent')}
        ${extractFunction('cancelPdfLoadingTask')}
        ${extractFunction('releaseAttachmentPreviewResources')}
        ${extraSource}
        result = {
            releaseAttachmentPreviewResources,
            getState: () => _previewState,
            getVersion: () => _previewSessionVersion,
            run: result,
        };
    `, sandbox);
    return {...sandbox.result, elements, sandbox};
}

test('preview cleanup is synchronous and exactly-once', () => {
    const state = previewHarness();
    state.releaseAttachmentPreviewResources();
    state.releaseAttachmentPreviewResources();

    assert.equal(state.destroyed, 1, 'Luckysheet must be destroyed once');
    assert.deepEqual(state.revoked, ['blob:first', 'blob:second']);
    for (const id of [
        'pdfViewerContainer', 'imageViewerContainer',
        'docxViewerContainer', 'excelViewerContainer',
    ]) {
        assert.equal(state.elements.get(id).innerHTML, '', `${id} must be cleared`);
    }
    assert.deepEqual(
        state.removed.map(item => item.type).sort(),
        ['keydown', 'wheel'],
        'PDF shortcut listeners must be removed with their original references',
    );
    assert.equal(state.getState().objectUrls.size, 0);
    assert.equal(state.getState().fileId, null);
});

test('preview close delegates to the central cleanup', () => {
    const state = previewHarness();
    state.closeDocPreview();
    state.closeDocPreview();
    assert.equal(state.destroyed, 1);
    assert.deepEqual(state.revoked, ['blob:first', 'blob:second']);
    assert.equal(state.sandbox.document.body.style.overflow, '');
});

test('a delayed PDF loading task cannot resurrect a released preview', async () => {
    const loading = deferred();
    let taskDestroyCount = 0;
    let renderCount = 0;
    const loadingTask = {
        promise: loading.promise,
        destroy() { taskDestroyCount += 1; },
    };
    const state = asyncPreviewHarness(
        `${extractFunction('loadPDFPreview')}\nresult = () => loadPDFPreview(7, 1);`,
        {
            loadPdfJsLibrary: async () => ({
                GlobalWorkerOptions: {},
                getDocument() { return loadingTask; },
            }),
            renderAllPDFPages: async () => { renderCount += 1; },
            updatePageInfo() {}, bindPdfShortcuts() {},
        },
    );
    const running = state.run();
    await flushUntil(() => state.getState().pdfLoadingTask === loadingTask, 'PDF loadingTask was not retained');
    state.releaseAttachmentPreviewResources();
    state.releaseAttachmentPreviewResources();
    loading.resolve({numPages: 3, destroy() { throw new Error('loadingTask owns cleanup'); }});
    await running;
    assert.equal(taskDestroyCount, 1, 'PDF loadingTask must be cancelled exactly once');
    assert.equal(renderCount, 0);
    assert.equal(state.getState().pdfDoc, null);
    assert.equal(state.elements.get('pdfViewerContainer').innerHTML, '');
});

test('a delayed Word renderer cannot write after release', async () => {
    const rendered = deferred();
    let renderStarted = false;
    const state = asyncPreviewHarness(
        `${extractFunction('loadWordPreview')}\nresult = () => loadWordPreview(7, 1);`,
        {
            localFetch: async () => ({
                ok: true, status: 200,
                headers: {get() { return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'; }},
                blob: async () => ({
                    size: 10,
                    slice() { return {arrayBuffer: async () => Uint8Array.from([0x50, 0x4b, 0x03, 0x04]).buffer}; },
                }),
            }),
            docx: {renderAsync: async (_blob, staging) => {
                renderStarted = true;
                staging.innerHTML = 'stale-word';
                await rendered.promise;
            }},
        },
    );
    const running = state.run();
    await flushUntil(() => renderStarted, 'Word renderer did not start');
    state.releaseAttachmentPreviewResources();
    rendered.resolve();
    await running;
    assert.equal(state.elements.get('docxViewerContainer').innerHTML, '');
    assert.notEqual(state.elements.get('previewLoading').style.display, 'none');
});

test('a delayed Excel response cannot create Luckysheet after release', async () => {
    const buffer = deferred();
    let readCount = 0;
    let createCount = 0;
    const state = asyncPreviewHarness(
        `${extractFunction('loadExcelPreview')}\nresult = () => loadExcelPreview(7, 1);`,
        {
            localFetch: async () => ({ok: true, status: 200, arrayBuffer: () => buffer.promise}),
            XLSX: {
                read() { readCount += 1; return {SheetNames: [], Sheets: {}}; },
                utils: {sheet_to_json() { return []; }},
            },
            luckysheet: {create() { createCount += 1; }, destroy() {}},
        },
    );
    const running = state.run();
    await Promise.resolve();
    state.releaseAttachmentPreviewResources();
    buffer.resolve(new ArrayBuffer(4));
    await running;
    assert.equal(readCount, 0);
    assert.equal(createCount, 0);
    assert.equal(state.elements.get('excelViewerContainer').innerHTML, '');
});

test('project switch and page unload release previews without cancelling uploads', () => {
    const selectProject = extractFunction('selectProject');
    assert.match(selectProject, /releaseAttachmentPreviewResources\(\)/);
    assert.doesNotMatch(selectProject, /abortActiveUploads\(/);
    assert.match(
        source,
        /window\.addEventListener\(['"]pagehide['"],\s*releaseAttachmentPreviewResources\)/,
    );
    const openPreview = extractFunction('openDocPreview');
    assert.ok(
        openPreview.indexOf('releaseAttachmentPreviewResources()')
            < openPreview.indexOf('++_previewSessionVersion'),
        'opening another file must invalidate the previous session before starting a new one',
    );
    for (const loader of ['loadImagePreview', 'loadPDFPreview', 'loadWordPreview', 'loadExcelPreview']) {
        assert.match(openPreview, new RegExp(`${loader}\\([^;]+sessionVersion\\)`));
    }
});

test('explicit upload cancellation aborts only candidate-owned active requests', () => {
    const aborts = [];
    const owned = {
        candidateOwned: true, settled: false,
        xhr: {readyState: 2, abort() { aborts.push('owned'); }},
    };
    const completed = {
        candidateOwned: true, settled: true,
        xhr: {readyState: 4, abort() { aborts.push('completed'); }},
    };
    const unrelated = {
        candidateOwned: false, settled: false,
        xhr: {readyState: 2, abort() { aborts.push('unrelated'); }},
    };
    const sandbox = {result: null};
    vm.runInNewContext(`
        const activeUploads = new Set();
        ${extractFunction('abortActiveUploads')}
        result = {activeUploads, abortActiveUploads};
    `, sandbox);
    sandbox.result.activeUploads.add(owned);
    sandbox.result.activeUploads.add(completed);
    sandbox.result.activeUploads.add(unrelated);
    assert.equal(sandbox.result.abortActiveUploads(), 1);
    assert.deepEqual(aborts, ['owned']);
});

class FakeEventTarget {
    constructor() { this.listeners = new Map(); }
    addEventListener(type, handler) { this.listeners.set(type, handler); }
    emit(type, event = {}) { this.listeners.get(type)?.(event); }
}

function uploadHarness(responses, {refreshToken = 'token-new'} = {}) {
    const sent = [];
    const headers = [];
    const toasts = [];
    let refreshes = 0;
    let detailRefreshes = 0;
    const activeUploads = new Set();

    class FakeFormData {
        constructor() { this.entries = []; }
        append(...args) { this.entries.push(args); }
    }

    class FakeXMLHttpRequest extends FakeEventTarget {
        constructor() {
            super();
            this.upload = new FakeEventTarget();
            this.readyState = 1;
            this.responseText = '';
            this.status = 0;
            this.responseHeaders = {};
            sent.push(this);
        }
        open(method, url) { this.method = method; this.url = url; }
        setRequestHeader(name, value) {
            headers.push({request: sent.length, name, value});
        }
        getResponseHeader(name) { return this.responseHeaders[name] ?? null; }
        send(body) {
            this.body = body;
            const response = responses.shift();
            assert.ok(response, 'test must provide one response per send');
            if (response.progress) this.upload.emit('progress', response.progress);
            this.status = response.status;
            this.responseText = JSON.stringify(response.body || {});
            this.responseHeaders = response.headers || {};
            this.readyState = 4;
            queueMicrotask(() => this.emit('load'));
        }
        abort() {
            this.readyState = 4;
            queueMicrotask(() => this.emit('abort'));
        }
    }

    const sandbox = {
        currentProject: {id: 7},
        getAttachmentUploadLimitMb: async () => 1024,
        attachmentUploadLimitBytes: () => 1024 * 1024 * 1024,
        FormData: FakeFormData,
        XMLHttpRequest: FakeXMLHttpRequest,
        activeUploads,
        showUploadProgress() {},
        toast(...args) { toasts.push(args); },
        api: async (method, url) => {
            assert.equal(method, 'GET');
            assert.equal(url, '/api/projects/7');
            detailRefreshes += 1;
            return {id: 7, attachments: []};
        },
        storeProjectDetail(project) { return project; },
        renderAttachments() {},
        refreshAttachmentCsrfToken: async () => {
            refreshes += 1;
            sandbox.window.CSRF_TOKEN = refreshToken;
            return refreshToken;
        },
        console: {error() {}},
        window: {CSRF_TOKEN: 'token-old'},
        queueMicrotask,
        result: null,
    };
    vm.runInNewContext(`${extractFunction('uploadFiles')}\nresult = uploadFiles;`, sandbox);
    return {
        uploadFiles: sandbox.result,
        sent,
        headers,
        toasts,
        activeUploads,
        get refreshes() { return refreshes; },
        get detailRefreshes() { return detailRefreshes; },
    };
}

test('ordinary write failures are never retried', async () => {
    const state = uploadHarness([{status: 500, body: {error: 'disk full'}}]);
    await state.uploadFiles([{name: 'large.zip', size: 180 * 1024 * 1024}]);
    assert.equal(state.sent.length, 1);
    assert.equal(state.refreshes, 0);
    assert.equal(state.detailRefreshes, 0);
});

test('CSRF retry occurs once only with explicit pre-acceptance proof and a fresh token', async () => {
    const state = uploadHarness([
        {
            status: 403,
            body: {code: 'csrf_expired', upload_accepted: false},
            headers: {'X-Upload-Accepted': '0'},
        },
        {status: 200, body: {uploaded: [{filename: 'large.zip'}]}},
    ]);
    await state.uploadFiles([{name: 'large.zip', size: 180 * 1024 * 1024}]);
    assert.equal(state.refreshes, 1);
    assert.equal(state.sent.length, 2);
    const csrfHeaders = state.headers.filter(item => item.name === 'X-CSRFToken');
    assert.deepEqual(csrfHeaders.map(item => item.value), ['token-old', 'token-new']);
});

test('CSRF response cannot replay a request after any accepted-data signal', async () => {
    const state = uploadHarness([{
        status: 403,
        body: {code: 'csrf_expired', upload_accepted: true},
        headers: {'X-Upload-Accepted': '1'},
    }]);
    await state.uploadFiles([{name: 'large.zip', size: 180 * 1024 * 1024}]);
    assert.equal(state.refreshes, 0);
    assert.equal(state.sent.length, 1);
});

test('partial upload reports each failure and retains successful server results', async () => {
    const state = uploadHarness([{
        status: 207,
        body: {
            uploaded: [{filename: 'ok.pdf'}],
            errors: [{filename: 'blocked.exe', error: '不允许的文件类型'}],
        },
    }]);
    await state.uploadFiles([
        {name: 'ok.pdf', size: 1024},
        {name: 'blocked.exe', size: 2048},
    ]);
    assert.equal(state.detailRefreshes, 1, 'successful items must be refreshed into the UI');
    assert.equal(state.toasts.some(call => /blocked\.exe.*不允许的文件类型/.test(call[0])), true);
    assert.equal(state.toasts.some(call => /成功上传 1 个文件/.test(call[0])), true);
});

test('large-file upload stays on streaming XHR and exposes explicit cancel', () => {
    const body = extractFunction('uploadFiles');
    assert.match(body, /new XMLHttpRequest\(\)/);
    assert.match(body, /xhr\.timeout\s*=\s*15\s*\*\s*60\s*\*\s*1000/);
    assert.match(body, /xhr\.upload\.addEventListener\(['"]progress['"]/);
    assert.match(body, /xhr\.send\(formData\)/);
    assert.doesNotMatch(body, /FileReader|readAsDataURL|arrayBuffer\(|\.text\(\)/);
    assert.match(source, /onclick="abortActiveUploads\(\)"/);
});


test('PDF zoom leaves fit mode and clamps numeric zoom without racing render', () => {
    const state = {scale:0, actualScale:1.5, rendering:false};
    const select = {value:''};
    let renders = 0;
    const context = {_previewState:state, document:{getElementById:()=>select}, reRenderPDF:()=>renders++};
    vm.runInNewContext([extractFunction('previewZoomOut'), extractFunction('previewZoomIn'), extractFunction('previewSetScale')].join('\n'), context);
    context.previewZoomOut();
    assert.equal(state.scale,1.25);
    context.previewSetScale('0.5');
    assert.equal(state.scale,.5);
    context.previewSetScale('fit');
    assert.equal(state.scale,0);
    context.previewSetScale('100');
    assert.equal(state.scale,5);
    state.rendering=true;
    context.previewSetScale('1');
    assert.equal(state.scale,5);
    assert.equal(renders,4);
});
