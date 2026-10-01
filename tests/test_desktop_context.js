'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'src', 'static', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `app.js must define ${name}()`);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

const loopbackFunction = extractFunction('isLoopbackHost');
const desktopFunction = extractFunction('isDesktopApp');

function evaluate(hostname, desktopFlag) {
    const sandbox = {
        window: {location: {hostname}},
        systemInfo: {is_desktop: desktopFlag},
        result: null,
    };
    vm.runInNewContext(
        `${loopbackFunction}\n${desktopFunction}\nresult = {loopback: isLoopbackHost(), desktop: isDesktopApp()};`,
        sandbox,
    );
    return sandbox.result;
}

for (const host of ['127.0.0.1', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
    const value = evaluate(host, true);
    assert.equal(value.loopback, true, `${host} should be loopback`);
    assert.equal(value.desktop, true, `${host} should allow desktop mode`);
}

for (const host of ['192.168.101.7', '192.168.101.8', 'pm-system.local', '']) {
    const value = evaluate(host, true);
    assert.equal(value.loopback, false, `${host || '<empty>'} should not be loopback`);
    assert.equal(value.desktop, false, `${host || '<empty>'} should use browser mode`);
}

assert.equal(evaluate('127.0.0.1', false).desktop, false, 'server must declare desktop mode');
assert.match(source, /\/api\/attachments\/\$\{aid\}\/download/);
assert.match(source, /\/api\/attachments\/\$\{aid\}\/save-local/);
assert.match(source, /const saveMode = isDesktopApp\(\) \? 'save=1' : 'download=1'/);

console.log('desktop context tests passed');
