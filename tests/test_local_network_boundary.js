'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const coreSource = fs.readFileSync('source/frontend/01-core.js', 'utf8');
const businessSource = fs.readFileSync('source/frontend/07-business.js', 'utf8');

function extractFunction(source, name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `${name} must exist`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`cannot parse ${name}`);
}

async function testLocalFetchBoundary() {
    const calls = [];
    const sandbox = {
        window: {location: {origin: 'http://127.0.0.1:5000'}},
        URL,
        fetch: async (...args) => { calls.push(args); return {ok: true}; },
        result: null,
    };
    vm.runInNewContext(`${extractFunction(coreSource, 'localFetch')}\nresult = localFetch;`, sandbox);
    await sandbox.result('/api/projects', {method: 'GET', credentials: 'include'});
    assert.equal(calls[0][0], '/api/projects');
    assert.equal(calls[0][1].method, 'GET');
    assert.equal(calls[0][1].credentials, 'same-origin');
    await assert.rejects(() => sandbox.result('https://example.com/api/projects'), /Local API/);
    await assert.rejects(() => sandbox.result('//example.com/api/projects'), /Local API/);
    await assert.rejects(() => sandbox.result('/settings'), /Local API/);
    assert.equal(calls.length, 1);
}

async function testApiFormOptionsAndErrors() {
    const calls = [];
    let response = {ok: true, status: 200, json: async () => ({uploaded: 1})};
    const formData = {kind: 'synthetic-form'};
    const sandbox = {
        window: {
            CSRF_TOKEN: 'token-7',
            location: {origin: 'http://127.0.0.1:5000'},
        },
        URL,
        fetch: async (...args) => { calls.push(args); return response; },
        result: null,
    };
    vm.runInNewContext(`
        ${extractFunction(coreSource, 'localFetch')}
        ${extractFunction(coreSource, 'apiForm')}
        result = apiForm;
    `, sandbox);

    const result = await sandbox.result('/api/projects/7/attachments', formData);
    assert.equal(result.uploaded, 1);
    assert.equal(calls[0][1].method, 'POST');
    assert.equal(calls[0][1].credentials, 'same-origin');
    assert.equal(calls[0][1].headers.Accept, 'application/json');
    assert.equal(calls[0][1].headers['X-CSRFToken'], 'token-7');
    assert.equal('Content-Type' in calls[0][1].headers, false);
    assert.equal(calls[0][1].body, formData);

    response = {ok: false, status: 422, json: async () => ({error: '无效附件'})};
    await assert.rejects(
        () => sandbox.result('/api/projects/7/attachments', formData),
        /无效附件/,
    );
}

function testBusinessUploadsUseApiForm() {
    assert.doesNotMatch(businessSource, /\bfetch\(/);
    assert.equal((businessSource.match(/\bapiForm\(/g) || []).length, 6);
}

function testEveryFetchUsesTheBoundary() {
    const manifest = JSON.parse(fs.readFileSync('source/frontend/manifest.json', 'utf8'));
    const modules = manifest.sections.map(section =>
        fs.readFileSync(`source/frontend/${section.file}`, 'utf8'));
    assert.equal((modules.join('\n').match(/\bfetch\(/g) || []).length, 1);
    assert.equal((modules[0].match(/\bfetch\(/g) || []).length, 1);
    assert.doesNotMatch(fs.readFileSync('source/frontend/03-attachments.js', 'utf8'), /\bfetch\(/);
    assert.doesNotMatch(fs.readFileSync('source/frontend/08-bootstrap.js', 'utf8'), /\bfetch\(/);
}

Promise.resolve()
    .then(testLocalFetchBoundary)
    .then(testApiFormOptionsAndErrors)
    .then(testBusinessUploadsUseApiForm)
    .then(testEveryFetchUsesTheBoundary)
    .then(() => console.log('local network boundary tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
