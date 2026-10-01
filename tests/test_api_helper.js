'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('source/frontend/01-core.js', 'utf8');

function extractAsyncFunction(name) {
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

async function invoke(method, body, response) {
    const calls = [];
    const sandbox = {
        window: {CSRF_TOKEN: 'token-7', location: {origin: 'http://127.0.0.1:5000'}},
        URL,
        fetch: async (...args) => { calls.push(args); return response; },
        result: null,
    };
    vm.runInNewContext(
        `${extractAsyncFunction('localFetch')}\n${extractAsyncFunction('api')}\n`
            + `result = api(${JSON.stringify(method)}, '/api/test', ${JSON.stringify(body)});`,
        sandbox,
    );
    return {value: await sandbox.result, calls};
}

Promise.resolve()
    .then(async () => {
        const ok = {ok: true, status: 200, json: async () => ({value: 1})};
        const get = await invoke('GET', undefined, ok);
        assert.deepEqual(get.value, {value: 1});
        assert.equal(get.calls[0][1].credentials, 'same-origin');
        assert.equal(get.calls[0][1].headers.Accept, 'application/json');
        assert.equal('Content-Type' in get.calls[0][1].headers, false);
        assert.equal('X-CSRFToken' in get.calls[0][1].headers, false);
        assert.equal('body' in get.calls[0][1], false);

        const post = await invoke('POST', {name: '模拟'}, ok);
        assert.equal(post.calls[0][1].headers['Content-Type'], 'application/json');
        assert.equal(post.calls[0][1].headers['X-CSRFToken'], 'token-7');
        assert.equal(post.calls[0][1].body, JSON.stringify({name: '模拟'}));

        await assert.rejects(
            () => invoke('DELETE', undefined,
                {ok: false, status: 409, json: async () => ({error: '冲突'})}),
            /冲突/,
        );
        await assert.rejects(
            () => invoke('PUT', {},
                {ok: false, status: 409, json: async () => ({error: '请先完成阶段必检项'})}),
            /请先完成阶段必检项/,
        );
    })
    .then(() => console.log('api helper tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
