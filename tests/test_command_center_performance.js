'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {createProjects} = require('./fixtures/frontend_dataset');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source', 'frontend', '09-command-center.js'), 'utf8');
let indexedReads = 0;
const context = {
    console,
    projectSearchById: {
        get(id) {
            indexedReads += 1;
            return `indexed-${id}`;
        },
    },
    projectSearchText() {
        throw new Error('indexed lookup should avoid fallback scanning');
    },
};
vm.createContext(context);
vm.runInContext(source, context, {filename: '09-command-center.js'});

assert.equal(typeof context.commandSearchIndex, 'function');
const projects = createProjects(1000);
const timings = [];
let output = null;
for (let iteration = 0; iteration < 25; iteration += 1) {
    context.invalidateCommandCenterData();
    const start = performance.now();
    output = context.commandCenterModel(
        projects,
        {total: 1000, in_progress: 1000},
        new Date('2026-07-20T09:00:00'),
    );
    timings.push(performance.now() - start);
}
timings.sort((left, right) => left - right);
const medianMs = timings[Math.floor(timings.length / 2)];
assert.equal(output.metrics.total, 1000);
assert.ok(output.actions.length > 0);
assert.ok(medianMs < 20, `median ${medianMs.toFixed(3)}ms exceeds 20ms`);

const firstIndex = context.commandSearchIndex(projects);
const secondIndex = context.commandSearchIndex(projects);
assert.equal(firstIndex, secondIndex, 'same project version must reuse the search index');
assert.equal(firstIndex.length, 1000);
assert.equal(indexedReads, 1000, 'search index construction must perform one indexed read per project');

console.log(`command center performance tests passed; median=${medianMs.toFixed(3)}ms`);
