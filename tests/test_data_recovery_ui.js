'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source', 'frontend', '06-admin.js'), 'utf8');

function extractFunction(name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `admin module must define ${name}()`);
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

assert.match(source, /id="dataRecoveryKeyInput"[^>]*type="password"/);
assert.match(source, /autocomplete="off"/);
assert.match(source, /仅在主机电脑本机/);

async function testSuccessfulBindingClearsSensitiveInput() {
    const calls = [];
    const toasts = [];
    const input = {value: 'very-sensitive-recovery-material', focus() {}};
    const button = {disabled: false};
    const sandbox = {
        document: {getElementById: id => id === 'dataRecoveryKeyInput' ? input : null},
        api: async (method, url, body) => {
            calls.push({method, url, body});
            return {bound: true};
        },
        systemInfo: {recovery_key_ready: false},
        cacheCurrentSettingsView() {},
        renderSettingsView() {},
        toast(message, type) { toasts.push({message, type}); },
        button,
        result: null,
    };
    vm.runInNewContext(
        `${extractFunction('bindDataRecoveryKey')}\nresult = bindDataRecoveryKey(button);`,
        sandbox,
    );
    await sandbox.result;
    assert.equal(JSON.stringify(calls), JSON.stringify([{
        method: 'POST',
        url: '/api/data-recovery/bind',
        body: {recovery_key: 'very-sensitive-recovery-material'},
    }]));
    assert.equal(input.value, '');
    assert.equal(button.disabled, false);
    assert.equal(sandbox.systemInfo.recovery_key_ready, true);
    assert.equal(toasts[0].type, 'success');
}

testSuccessfulBindingClearsSensitiveInput()
    .then(() => console.log('data recovery UI tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
