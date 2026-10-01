'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const businessSource = fs.readFileSync('source/frontend/07-business.js', 'utf8');
const coreSource = fs.readFileSync('source/frontend/01-core.js', 'utf8');

function extractFunction(source, name, isAsync = false) {
    const prefix = isAsync ? `async function ${name}(` : `function ${name}(`;
    const start = source.indexOf(prefix);
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

async function runBatch(confirmed) {
    const calls = [];
    let confirmation = null;
    const sandbox = {
        currentProject: {
            id: 7,
            attachments: [
                {id: 1, filename: '<img src=x onerror=alert(1)>.pdf'},
                {id: 2, filename: '正常文件.pdf'},
            ],
        },
        getSelectedAttachments: () => [1, 2],
        confirmDialog: async (...args) => { confirmation = args; return confirmed; },
        api: async (method, url) => {
            calls.push(['api', method, url]);
            if (url.endsWith('/2')) throw new Error('模拟占用');
            return {};
        },
        refreshProject: async () => { calls.push(['refresh']); },
        exitBatchDeleteMode: () => calls.push(['exit']),
        showLoading: message => calls.push(['show', message]),
        hideLoading: () => calls.push(['hide']),
        toast: (...args) => calls.push(['toast', ...args]),
        result: null,
    };
    vm.runInNewContext(`
        ${extractFunction(coreSource, 'escHtml')}
        ${extractFunction(businessSource, 'doBatchDelete', true)}
        result = doBatchDelete();
    `, sandbox);
    await sandbox.result;
    return {calls, confirmation};
}

Promise.resolve()
    .then(async () => {
        const cancelled = await runBatch(false);
        assert.match(cancelled.confirmation[1], /&lt;img/);
        assert.doesNotMatch(cancelled.confirmation[1], /<img/);
        assert.equal(cancelled.calls.length, 0);

        const partial = await runBatch(true);
        assert.deepEqual(partial.calls.filter(call => call[0] === 'api'), [
            ['api', 'DELETE', '/api/attachments/1'],
            ['api', 'DELETE', '/api/attachments/2'],
        ]);
        assert.equal(partial.calls.filter(call => call[0] === 'refresh').length, 1);
        assert.equal(partial.calls.filter(call => call[0] === 'exit').length, 1);
        assert.deepEqual(partial.calls.filter(call => ['show', 'hide'].includes(call[0])).map(call => call[0]),
            ['show', 'hide']);
        const message = partial.calls.find(call => call[0] === 'toast');
        assert.match(message[1], /成功 1/);
        assert.match(message[1], /失败 1/);
        assert.equal(message[2], 'warning');
    })
    .then(() => console.log('attachment batch delete tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
