'use strict';

const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const acorn = require('acorn');

const core = fs.readFileSync('source/frontend/01-core.js', 'utf8');
const attachments = fs.readFileSync('source/frontend/03-attachments.js', 'utf8');
function declaration(source, name) {
    const node = acorn.parse(source, {ecmaVersion: 'latest'}).body.find(
        item => item.type === 'FunctionDeclaration' && item.id.name === name,
    );
    assert.ok(node, name);
    return source.slice(node.start, node.end);
}

function response(body, status = 200, type = 'application/json') {
    return {ok: status >= 200 && status < 300, status, headers: {get: () => type}, json: async () => body};
}
const expired = () => response({code: 'csrf_expired', error: '请求已过期'}, 403);

function harness(fetch) {
    const calls = [];
    const deadlines = [];
    const sandbox = {
        window: {CSRF_TOKEN: 'old-token', location: {origin: 'http://127.0.0.1:5000'}},
        URL, AbortController, clearTimeout,
        setTimeout(callback, milliseconds) {
            deadlines.push(milliseconds);
            return setTimeout(callback, milliseconds === 20000 ? 5 : milliseconds);
        },
        currentProject: null, projectById: new Map(),
        fetch: async (url, options) => {
            calls.push({url, options});
            return fetch(url, options, calls.length);
        },
    };
    const functions = ['localFetch', 'readApiJsonResponse', 'isCsrfFailure', 'api', 'apiForm']
        .map(name => declaration(core, name));
    functions.push(declaration(attachments, 'refreshAttachmentCsrfToken'));
    vm.runInNewContext(functions.join('\n'), sandbox);
    return {sandbox, calls, deadlines};
}

async function settles(promise) {
    let timer;
    try {
        return await Promise.race([
            promise.then(value => ({value}), error => ({error})),
            new Promise(resolve => { timer = setTimeout(() => resolve({pending: true}), 80); }),
        ]);
    } finally { clearTimeout(timer); }
}

test('real refresh contract requires POST and returns a fresh token through the local API boundary', async () => {
    const state = harness(async (url, options) => {
        assert.equal(url, '/api/csrf-refresh');
        if (options.method !== 'POST') return response(null, 405, 'text/html');
        return response({csrf_token: 'new-token'});
    });
    assert.equal(await state.sandbox.refreshAttachmentCsrfToken(), 'new-token');
    assert.equal(state.sandbox.window.CSRF_TOKEN, 'new-token');
    assert.equal(state.calls.length, 1);
    assert.equal(state.calls[0].options.credentials, 'same-origin');
    assert.equal(state.calls[0].options.headers.Accept, 'application/json');
});

for (const multipart of [false, true]) {
    test(`${multipart ? 'multipart' : 'JSON'} write recovers once using the actual refresh helper`, async () => {
        const state = harness(async (url, options, call) => {
            if (url === '/api/csrf-refresh') {
                assert.equal(options.method, 'POST');
                return response({csrf_token: 'new-token'});
            }
            return call === 1 ? expired() : response({saved: true});
        });
        const payload = {synthetic: 'body'};
        const result = multipart
            ? await state.sandbox.apiForm('/api/synthetic-write', payload)
            : await state.sandbox.api('POST', '/api/synthetic-write', payload);
        assert.equal(result.saved, true);
        assert.equal(state.calls.length, 3);
        assert.deepEqual(state.calls.map(call => call.url), ['/api/synthetic-write', '/api/csrf-refresh', '/api/synthetic-write']);
        assert.equal(state.calls[0].options.headers['X-CSRFToken'], 'old-token');
        assert.equal(state.calls[2].options.headers['X-CSRFToken'], 'new-token');
        assert.equal(state.calls[0].options.body, state.calls[2].options.body);
    });
}

test('persistent CSRF rejection refreshes once and never replays a third mutation', async () => {
    const state = harness(async (url, options) => url === '/api/csrf-refresh'
        ? (assert.equal(options.method, 'POST'), response({csrf_token: 'new-token'})) : expired());
    await assert.rejects(state.sandbox.api('POST', '/api/synthetic-write', {}), /请求已过期/);
    assert.equal(state.calls.length, 3);
    assert.equal(state.calls.filter(call => call.url === '/api/csrf-refresh').length, 1);
});

test('ordinary permission 403 never refreshes or repeats a write', async () => {
    const state = harness(async () => response({code: 'permission_denied', error: '无权操作'}, 403));
    await assert.rejects(state.sandbox.api('POST', '/api/synthetic-write', {}), /无权操作/);
    assert.equal(state.calls.length, 1);
});

test('write timeout never refreshes or blindly replays uncertain data', async () => {
    const state = harness(() => new Promise(() => {}));
    const outcome = await settles(state.sandbox.api('POST', '/api/synthetic-write', {}));
    assert.equal(outcome.error?.error_code, 'REQUEST_TIMEOUT');
    assert.equal(state.calls.length, 1);
});

for (const phase of ['fetch', 'JSON body']) {
    test(`refresh ${phase} deadline rejects a hung response and preserves the previous token`, async () => {
        const state = harness(() => phase === 'fetch' ? new Promise(() => {})
            : {...response(null), json: () => new Promise(() => {})});
        const outcome = await settles(state.sandbox.refreshAttachmentCsrfToken());
        assert.equal(outcome.error?.error_code, 'REQUEST_TIMEOUT');
        assert.equal(state.sandbox.window.CSRF_TOKEN, 'old-token');
        assert.equal(state.calls.length, 1);
        assert.ok(state.deadlines.includes(20000));
    });
}

test('a hung refresh body releases the rejected mutation without retrying it', async () => {
    const state = harness(async url => url === '/api/csrf-refresh'
        ? {...response(null), json: () => new Promise(() => {})} : expired());
    const outcome = await settles(state.sandbox.api('POST', '/api/synthetic-write', {}));
    assert.match(outcome.error?.message || '', /请求已过期/);
    assert.equal(state.calls.length, 2);
    assert.equal(state.sandbox.window.CSRF_TOKEN, 'old-token');
});

test('missing, malformed and login-page refresh responses preserve the existing token', async () => {
    for (const result of [response({}), {...response(null), json: async () => { throw new SyntaxError('invalid JSON'); }},
        response(null, 200, 'text/html')]) {
        const state = harness(async () => result);
        await assert.rejects(state.sandbox.refreshAttachmentCsrfToken());
        assert.equal(state.sandbox.window.CSRF_TOKEN, 'old-token');
        assert.equal(state.calls.length, 1);
    }
});
