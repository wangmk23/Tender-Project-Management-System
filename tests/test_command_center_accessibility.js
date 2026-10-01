'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source', 'frontend', '09-command-center.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'source', 'frontend', '08-bootstrap.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

assert.match(source, /class="command-palette" role="dialog" aria-modal="true"/);
assert.match(source, /function trapModalFocus\(/);
assert.match(source, /function focusSafely\(/);
assert.match(source, /function openCommandPalette\(/);
assert.match(source, /function closeCommandPalette\(/);
assert.doesNotMatch(source, /command-action-center|commandActionCenter|ActionCenter/);
assert.doesNotMatch(bootstrap, /closeActionCenter/);
assert.doesNotMatch(css, /\.command-action-center/);
assert.match(css, /\.command-palette-item/);
assert.match(css, /:focus-visible/);

const first = {focusCount: 0, focus() { this.focusCount += 1; }};
const last = {focusCount: 0, focus() { this.focusCount += 1; }};
const container = {querySelectorAll() { return [first, last]; }};
const context = {document: {activeElement: last}, Array, result: null};
vm.runInNewContext(`${extractFunction('trapModalFocus')}\nresult = trapModalFocus;`, context);
let prevented = false;
context.result({key: 'Tab', shiftKey: false, preventDefault() { prevented = true; }}, container);
assert.equal(prevented, true);
assert.equal(first.focusCount, 1);

console.log('command center accessibility tests passed');
