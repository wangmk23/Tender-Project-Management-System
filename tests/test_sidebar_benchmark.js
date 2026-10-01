'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const {
    benchmarkSidebar,
    extractFunction,
} = require('../tools/benchmark_sidebar');

assert.match(
    extractFunction('function sample() { return 1; }', 'sample'),
    /^function sample/,
);
assert.throws(
    () => extractFunction('const value = 1;', 'missing'),
    /must define missing/,
);
const result = benchmarkSidebar({sizes: [10], warmups: 1, iterations: 3});
assert.equal(result.runtime, process.version);
assert.equal(result.scenarios.length, 1);
assert.equal(result.scenarios[0].projects, 10);
assert.equal(result.scenarios[0].samples, 3);
assert.equal(result.scenarios[0].renderedProjects, 10);
assert.equal(result.scenarios[0].measuredRenders, 3);
assert.ok(result.scenarios[0].distinctOutputs >= 2);
assert.ok(result.scenarios[0].outputChanges >= 2);
assert.ok(result.scenarios[0].medianMs < 20);
assert.ok(result.scenarios[0].p95Ms >= result.scenarios[0].medianMs);
assert.ok(result.scenarios[0].p95Ms < 50);

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'sidebar-benchmark-'));
const output = path.join(temp, 'benchmark.json');
const cli = spawnSync(
    process.execPath,
    ['tools/benchmark_sidebar.js', '--output', output],
    {cwd: path.join(__dirname, '..'), encoding: 'utf8'},
);
assert.equal(cli.status, 0, cli.stderr);
const persisted = JSON.parse(fs.readFileSync(output, 'utf8'));
assert.deepEqual(
    persisted.scenarios.map(item => item.projects),
    [100, 500, 1000],
);
for (const scenario of persisted.scenarios) {
    assert.equal(scenario.samples, 50);
    assert.equal(scenario.measuredRenders, 50);
    assert.ok(scenario.distinctOutputs >= 2);
    assert.ok(scenario.outputChanges >= 49);
    assert.ok(scenario.medianMs < 20);
    assert.ok(scenario.p95Ms < 50);
}
console.log('sidebar benchmark tests passed');
