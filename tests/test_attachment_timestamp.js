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
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js must define ${name}()`);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

function timestampFormatter() {
    const sandbox = {Date, Intl, Number, result: null};
    vm.runInNewContext(`
        ${extractFunction('parseAttachmentTimestamp')}
        ${extractFunction('formatDateTimeShort')}
        result = formatDateTimeShort;
    `, sandbox);
    return sandbox.result;
}

test('timezone-less attachment timestamps are UTC and display in Beijing time', () => {
    assert.equal(timestampFormatter()('2026-08-14T10:05:00'), '8/14 18:05');
});

test('explicit offsets are normalized to Beijing time', () => {
    const format = timestampFormatter();
    assert.equal(format('2026-08-14T10:05:00Z'), '8/14 18:05');
    assert.equal(format('2026-08-14T18:05:00+08:00'), '8/14 18:05');
});

test('empty and invalid attachment timestamps fail safely', () => {
    const format = timestampFormatter();
    assert.equal(format(''), '');
    assert.equal(format('not-a-time'), 'not-a-time');
});
