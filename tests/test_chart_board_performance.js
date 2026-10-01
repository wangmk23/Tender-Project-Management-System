'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {createProjects} = require('./fixtures/frontend_dataset');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'source', 'frontend', '10-chart-board.js'),
    'utf8',
);
const context = {console, URLSearchParams, result: null};
vm.createContext(context);
vm.runInContext(`${source}\nresult = buildChartBoardData;`, context);
const buildChartBoardData = context.result;
const projects = createProjects(1000, 14).map((project, index) => ({
    ...project,
    method: index % 2 ? '公开招标' : '竞争性磋商',
    challenge_state: index % 31 === 0 ? '质疑中' : '',
    created_at: `2026-${String((index % 7) + 1).padStart(2, '0')}-${String((index % 27) + 1).padStart(2, '0')}`,
    completed_at: project.progress >= 100 ? '2026-07-15' : null,
}));
const now = new Date('2026-07-20T09:00:00+08:00');

for (let index = 0; index < 10; index += 1) buildChartBoardData(projects, now);
const samples = [];
for (let index = 0; index < 50; index += 1) {
    const started = performance.now();
    const result = buildChartBoardData(projects, now);
    samples.push(performance.now() - started);
    assert.equal(result.kpis.total, 1000);
}
samples.sort((left, right) => left - right);
const median = samples[Math.floor(samples.length / 2)];
const p95 = samples[Math.ceil(samples.length * 0.95) - 1];
assert.ok(median < 20, `chart aggregation median ${median.toFixed(3)}ms exceeds 20ms`);
assert.ok(p95 < 50, `chart aggregation P95 ${p95.toFixed(3)}ms exceeds 50ms`);
console.log(`chart board performance tests passed; median=${median.toFixed(3)}ms p95=${p95.toFixed(3)}ms`);
