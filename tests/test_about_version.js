'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {JSDOM} = require('jsdom');
const acorn = require('acorn');

const source = fs.readFileSync(path.join(__dirname, '../source/frontend/06-admin.js'), 'utf8');
const declaration = acorn.parse(source, {ecmaVersion:'latest'}).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'renderAboutCard');
function about(info) {
    const context = {info, escHtml: value => String(value).replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]))};
    vm.createContext(context);
    vm.runInContext(source.slice(declaration.start, declaration.end) + '\nresult = renderAboutCard(info);', context);
    return new JSDOM(context.result).window.document;
}

test('About displays the running server version, including future versions', () => {
    for (const version of ['v5.8.24', 'v5.8.25', 'v6.0.0']) {
        const document = about({version});
        assert.equal(document.querySelector('.settings-list strong').textContent, version);
        assert.match(document.querySelector('.settings-list span').textContent, /系统版本/);
    }
});

test('About does not invent a version when system information is unavailable', () => {
    assert.equal(about({}).querySelector('.settings-list strong').textContent, '读取中');
    assert.equal(about({_loadError:'offline'}).querySelector('.settings-list strong').textContent, '读取失败');
});

test('About escapes the server version as text', () => {
    const value = '<img src=x onerror=alert(1)>';
    const document = about({version:value});
    assert.equal(document.querySelector('.settings-list strong').textContent, value);
    assert.equal(document.querySelector('img'), null);
});

test('About does not present the historical runtime date as the current build date', () => {
    const text = about({version:'v5.8.25'}).body.textContent;
    assert.doesNotMatch(text, /2026-07-29|基础版本|构建日期/);
});
