'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const command = fs.readFileSync(path.join(root, 'source', 'frontend', '09-command-center.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'source', 'frontend', '08-bootstrap.js'), 'utf8');

function extractFunction(name) {
    const start = command.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const braceStart = command.indexOf('{', command.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < command.length; index += 1) {
        if (command[index] === '{') depth += 1;
        if (command[index] === '}') depth -= 1;
        if (depth === 0) return command.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

assert.match(command, /function enhanceApplicationShell\(/);
assert.match(command, /function openCommandPalette\(/);
assert.match(command, /function filterCommandPalette\(/);
assert.match(bootstrap, /enhanceApplicationShell\(\)/);
assert.match(bootstrap, /e\.key\.toLowerCase\(\) === 'k'/);
assert.doesNotMatch(command, /commandActionCenter|openActionCenter|renderActionCenter/);
assert.doesNotMatch(command, /data-view=["']actions["']/);
assert.doesNotMatch(command, /打开行动中心|统一行动中心/);
assert.doesNotMatch(bootstrap, /closeActionCenter/);

const removed = [];
const logoBadge = {
    textContent: '',
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    remove() { removed.push('.logo span'); },
};
const document = {
    querySelector(selector) {
        if (selector === '.command-global-rail' || selector === '#view-dashboard > .view-header') {
            return {remove() { removed.push(selector); }};
        }
        if (selector === '.logo span') {
            return logoBadge;
        }
        if (selector === '.sidebar-nav') {
            return {querySelector() { return null; }, appendChild() { throw new Error('must not add navigation'); }};
        }
        return null;
    },
};
vm.runInNewContext(`${extractFunction('enhancePrimaryNavigation')}\nenhancePrimaryNavigation();`, {document});
assert.deepEqual(removed, ['.command-global-rail', '.logo span', '#view-dashboard > .view-header']);
assert.ok(removed.includes('.logo span'));
assert.equal(logoBadge.textContent, '');

console.log('command center shell tests passed');
