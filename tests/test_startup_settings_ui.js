'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'src', 'static', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function extractFunction(name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `app.js must define ${name}()`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

const renderFunction = extractFunction('renderAutoStartCard');
const toggleFunction = extractFunction('setAutoStart');

function render(desktop, isAdmin, enabled, error='') {
    const sandbox = {result: null, error, escHtml: value => String(value)};
    vm.runInNewContext(
        `${renderFunction}\nresult = renderAutoStartCard(${desktop}, ${isAdmin}, ${enabled}, error);`,
        sandbox,
    );
    return sandbox.result;
}

assert.match(render(true, true, false), /开机自动启动/);
assert.doesNotMatch(render(true, true, false), /type="checkbox"[^>]*\schecked(?:\s|>)/s);
assert.match(render(true, true, true), /type="checkbox"[^>]*\schecked(?:\s|>)/s);
assert.equal(render(true, false, false), '');
assert.equal(render(false, true, false), '');
assert.doesNotMatch(render(false, true, false), /Windows|系统托盘|开机/);
assert.match(source, /renderAutoStartCard\(desktop, currentIsAdmin, settings\.startup_enabled === true, settings\.startup_error/);
assert.match(render(true,true,false,'读取权限不足'),/disabled/);
assert.match(render(true,true,false,'读取权限不足'),/读取权限不足/);
assert.match(source, /\$\{autoStartCard\}/);

async function testSuccessfulToggle() {
    const calls = [];
    const toasts = [];
    let renderCount = 0;
    const input = {checked: true, disabled: false};
    const sandbox = {
        api: async (method, url, body) => {
            calls.push({method, url, body});
            if (method === 'PATCH') return {message: '已开启开机自动启动'};
            return {startup_enabled: true};
        },
        systemSettings: null,
        renderSettingsView() { renderCount += 1; },
        toast(message, type) { toasts.push({message, type}); },
        input,
        result: null,
    };
    vm.runInNewContext(
        `${toggleFunction}\nresult = setAutoStart(true, input);`,
        sandbox,
    );
    await sandbox.result;
    assert.equal(calls[0].method, 'PATCH');
    assert.equal(calls[0].url, '/api/settings');
    assert.equal(JSON.stringify(calls[0].body), JSON.stringify({startup_enabled: true}));
    assert.equal(calls[1].method, 'GET');
    assert.equal(calls[1].url, '/api/settings');
    assert.equal(calls[1].body, undefined);
    assert.equal(sandbox.systemSettings.startup_enabled, true);
    assert.equal(renderCount, 1);
    assert.equal(toasts[0].type, 'success');
}

async function testFailedToggleRollsBack() {
    const toasts = [];
    const input = {checked: true, disabled: false};
    const sandbox = {
        api: async () => { throw new Error('registry denied'); },
        systemSettings: null,
        renderSettingsView() { throw new Error('must not render after failure'); },
        toast(message, type) { toasts.push({message, type}); },
        input,
        result: null,
    };
    vm.runInNewContext(
        `${toggleFunction}\nresult = setAutoStart(true, input);`,
        sandbox,
    );
    await sandbox.result;
    assert.equal(input.checked, false);
    assert.equal(input.disabled, false);
    assert.equal(toasts[0].type, 'error');
    assert.match(toasts[0].message, /registry denied/);
}

Promise.resolve()
    .then(testSuccessfulToggle)
    .then(testFailedToggleRollsBack)
    .then(() => console.log('startup settings UI tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
