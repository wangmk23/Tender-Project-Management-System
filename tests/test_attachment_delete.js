'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const attachmentSource = fs.readFileSync('source/frontend/03-attachments.js', 'utf8');
const businessSource = fs.readFileSync('source/frontend/07-business.js', 'utf8');
const combined = `${attachmentSource}\n${businessSource}`;
assert.equal(Array.from(combined.matchAll(/^async function deleteAttachment\(/gm)).length, 1);

function extractFunction(source, name) {
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

async function runDelete(confirmed, editingStageKey, apiError = null) {
    const calls = [];
    const messages = [];
    const sandbox = {
        currentProject: {id: 7, attachments: [{id: 12, filename: '模拟文件.pdf'}]},
        editingStageKey,
        confirmDialog: async (...args) => { messages.push(args); return confirmed; },
        api: async (...args) => {
            calls.push(['api', ...args]);
            if (apiError) throw apiError;
            return {};
        },
        refreshProject: async () => { calls.push(['refresh']); },
        openStageSlide: key => calls.push(['slide', key]),
        showLoading: () => calls.push(['show']),
        hideLoading: () => calls.push(['hide']),
        toast: (...args) => calls.push(['toast', ...args]),
        console: {error: (...args) => calls.push(['error', ...args])},
        result: null,
    };
    vm.runInNewContext(
        `${extractFunction(attachmentSource, 'deleteAttachment')}\nresult = deleteAttachment(12);`,
        sandbox,
    );
    await sandbox.result;
    return {calls, messages};
}

Promise.resolve()
    .then(async () => {
        const cancelled = await runDelete(false, null);
        assert.equal(cancelled.calls.length, 0);

        const main = await runDelete(true, null);
        assert.deepEqual(main.calls.find(call => call[0] === 'api'),
            ['api', 'DELETE', '/api/attachments/12']);
        assert.equal(main.calls.some(call => call[0] === 'refresh'), true);
        assert.equal(main.calls.some(call => call[0] === 'slide'), false);
        assert.match(main.messages[0][1], /模拟文件\.pdf/);
        assert.deepEqual(main.calls.filter(call => ['show', 'hide'].includes(call[0])),
            [['show'], ['hide']]);

        const slide = await runDelete(true, 'result_announced');
        assert.deepEqual(slide.calls.find(call => call[0] === 'slide'),
            ['slide', 'result_announced']);

        const failed = await runDelete(true, null, new Error('模拟冲突'));
        assert.equal(failed.calls.some(call => call[0] === 'refresh'), false);
        assert.equal(failed.calls.some(call => call[0] === 'hide'), true);
        assert.equal(failed.calls.some(call => call[0] === 'toast' && /模拟冲突/.test(call[1])), true);
    })
    .then(() => console.log('attachment delete tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
