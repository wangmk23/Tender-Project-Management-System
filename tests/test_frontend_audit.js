'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const {analyzeSource} = require('../tools/audit_frontend');

const applicationSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'static', 'app.js'),
    'utf8',
);
assert.doesNotMatch(
    applicationSource,
    /customer_view|customer_action|view-customers|客户管理|mergeCustomer/,
);
assert.match(applicationSource, /function releaseAttachmentPreviewResources\(\)/);
assert.match(applicationSource, /function abortActiveUploads\(\)/);
assert.match(
    applicationSource,
    /window\.addEventListener\(['"]pagehide['"],\s*releaseAttachmentPreviewResources\)/,
);
const uploadStart = applicationSource.indexOf('async function uploadFiles(');
const uploadEnd = applicationSource.indexOf('function showUploadProgress(', uploadStart);
assert.ok(uploadStart >= 0 && uploadEnd > uploadStart, 'uploadFiles source must be auditable');
const uploadSource = applicationSource.slice(uploadStart, uploadEnd);
assert.match(uploadSource, /new XMLHttpRequest\(\)/);
assert.match(uploadSource, /xhr\.send\(formData\)/);
assert.doesNotMatch(uploadSource, /FileReader|readAsDataURL|arrayBuffer\(|\.text\(\)/);

const fixture = [
    'function alpha() { return fetch("/api/projects"); }',
    'async function beta() { node.innerHTML = "<b>x</b>"; }',
    'function alpha() { return URL.createObjectURL(blob); }',
    'function cleanup() { URL.revokeObjectURL(url); }',
    'const cdn = "https://cdn.example.test/ui.css";',
    'navigator.sendBeacon("https://metrics.example.test/collect", "x");',
].join('\n');

const result = analyzeSource(fixture);
assert.equal(result.lines, 6);
assert.deepEqual(result.duplicateFunctions, [{name: 'alpha', count: 2}]);
assert.deepEqual(result.apiRoutePrefixes, ['/api/projects']);
assert.equal(result.riskCounts.innerHTMLAssignments, 1);
assert.equal(result.riskCounts.directFetchCalls, 1);
assert.equal(result.riskCounts.objectUrlCreates, 1);
assert.equal(result.riskCounts.objectUrlRevokes, 1);
assert.deepEqual(result.externalOrigins, [
    'https://cdn.example.test',
    'https://metrics.example.test',
]);
assert.deepEqual(result.telemetryMarkers, ['sendBeacon']);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-audit-'));
const sourcePath = path.join(temp, 'fixture.js');
const outputPath = path.join(temp, 'audit.json');
fs.writeFileSync(sourcePath, fixture, 'utf8');
const cli = spawnSync(
    process.execPath,
    ['tools/audit_frontend.js', '--source', sourcePath, '--output', outputPath],
    {cwd: path.join(__dirname, '..'), encoding: 'utf8'},
);
assert.equal(cli.status, 0, cli.stderr);
assert.deepEqual(JSON.parse(fs.readFileSync(outputPath, 'utf8')), result);
console.log('frontend audit tests passed');
