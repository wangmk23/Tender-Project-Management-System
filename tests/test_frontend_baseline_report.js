'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'frontend-report-'));
const auditPath = path.join(temp, 'audit.json');
const benchmarkPath = path.join(temp, 'benchmark.json');
const outputPath = path.join(temp, 'baseline.md');
fs.writeFileSync(auditPath, JSON.stringify({
    bytes: 100,
    lines: 10,
    namedFunctions: 2,
    duplicateFunctions: [{name: 'same', count: 2}],
    apiRoutePrefixes: ['/api/projects'],
    riskCounts: {
        innerHTMLAssignments: 1,
        insertAdjacentHTMLCalls: 0,
        directFetchCalls: 1,
        timeoutCalls: 0,
        intervalCalls: 0,
        objectUrlCreates: 1,
        objectUrlRevokes: 1,
    },
    externalOrigins: [],
    telemetryMarkers: [],
}));
fs.writeFileSync(benchmarkPath, JSON.stringify({
    runtime: 'v-test',
    warmups: 1,
    iterations: 2,
    scenarios: [{
        projects: 10,
        samples: 2,
        renderedProjects: 10,
        outputBytes: 500,
        medianMs: 1.25,
        p95Ms: 1.5,
    }],
}));
const run = spawnSync(
    process.execPath,
    [
        'tools/render_frontend_baseline.js',
        '--audit',
        auditPath,
        '--benchmark',
        benchmarkPath,
        '--output',
        outputPath,
    ],
    {cwd: path.join(__dirname, '..'), encoding: 'utf8'},
);
assert.equal(run.status, 0, run.stderr);
const report = fs.readFileSync(outputPath, 'utf8');
assert.match(report, /源文件：10 行，100 字节，2 个命名函数/);
assert.match(report, /`same`：2 次/);
assert.match(report, /10 \| 1\.25 \| 1\.5 \| 500/);
assert.match(report, /未检测到遥测标记/);
console.log('frontend baseline report tests passed');
