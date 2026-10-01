'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'app.js'), 'utf8');

function extractFunction(name) {
    const start = bundle.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `warning-edition bundle must retain ${name}()`);
    const braceStart = bundle.indexOf('{', bundle.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < bundle.length; index += 1) {
        if (bundle[index] === '{') depth += 1;
        if (bundle[index] === '}') depth -= 1;
        if (depth === 0) return bundle.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

test('configured attachment limit validation survives candidate frontend rebuilds', () => {
    const sandbox = {result: null};
    vm.runInNewContext(`
        ${extractFunction('normalizeAttachmentUploadLimitMb')}
        result = normalizeAttachmentUploadLimitMb;
    `, sandbox);

    assert.equal(sandbox.result('1024'), 1024);
    assert.equal(sandbox.result(2048), 2048);
    assert.throws(() => sandbox.result(0));
    assert.throws(() => sandbox.result(2049));
    assert.throws(() => sandbox.result('1.5'));
});
