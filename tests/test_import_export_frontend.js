'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bundle = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'app.js'), 'utf8');

function extractFunction(name) {
    const start = bundle.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js must define ${name}()`);
    const braceStart = bundle.indexOf('{', bundle.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < bundle.length; index += 1) {
        if (bundle[index] === '{') depth += 1;
        if (bundle[index] === '}') depth -= 1;
        if (depth === 0) return bundle.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

test('import errors preserve sheet row and safe copyable detail', () => {
    const sandbox = {result: null};
    vm.runInNewContext(`
        function escHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, character => ({
                '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
            })[character]);
        }
        ${extractFunction('formatImportErrors')}
        result = formatImportErrors([
            {sheet: '分包', row: 8, column: '包号', msg: '<img src=x onerror=alert(1)>'},
            {sheet: '项目', row: 9, msg: '项目编号重复'},
        ], 1);
    `, sandbox);

    assert.equal(sandbox.result.total, 2);
    assert.match(sandbox.result.text, /^分包 第8行 · 包号列：<img/);
    assert.ok(sandbox.result.html.includes('分包 · 第8行 · 包号列'));
    assert.ok(sandbox.result.html.includes('&lt;img'));
    assert.ok(!sandbox.result.html.includes('<img'));
    assert.ok(sandbox.result.html.includes('另有 1 条'));
});

test('both import dialogs use the shared detailed error renderer', () => {
    const calls = bundle.match(/showImportErrorDetails\(result\.errors\)/g) || [];
    assert.equal(calls.length, 2);
    assert.match(bundle, /downloadImportTemplate\('projects'\)/);
    assert.match(bundle, /downloadImportTemplate\('registrations'\)/);
    assert.match(bundle, /kind=\$\{kind\}\$\{projectQuery\}\$\{isDesktopApp\(\) \? '&save=1' : ''\}/);
    assert.match(bundle, /project_id=\$\{encodeURIComponent\(currentProject\.id\)\}/);
});
