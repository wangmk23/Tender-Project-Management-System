'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(
    path.join(__dirname, '..', 'source', 'frontend', '02-projects.js'),
    'utf8',
);

function extractFunction(name) {
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
    throw new Error(`unable to extract ${name}`);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return {promise, resolve, reject};
}

function harness({cached = [], requested = []} = {}) {
    const calls = [];
    const pending = new Map();
    const sandbox = {
        Promise,
        Map,
        Set,
        console: {error() {}},
        projectDetailCache: new Map(cached.map(id => [id, {id}])),
        projectDetailRequests: new Map(requested.map(id => [id, Promise.resolve()])),
        requestProjectDetail(id) {
            const operation = deferred();
            calls.push(Number(id));
            pending.set(Number(id), operation);
            return operation.promise;
        },
        result: null,
    };
    vm.runInNewContext(`
        const PROJECT_PREFETCH_LIMIT = 3;
        const projectPrefetchQueue = [];
        const projectPrefetchQueued = new Set();
        let projectPrefetchActive = 0;
        let projectPrefetchGeneration = 0;
        ${extractFunction('isActiveProjectSummary')}
        ${extractFunction('cancelProjectPrefetch')}
        ${extractFunction('drainProjectPrefetchQueue')}
        ${extractFunction('queueProjectDetailPrefetch')}
        ${extractFunction('scheduleActiveProjectPrefetch')}
        ${extractFunction('promoteProjectPrefetch')}
        result = {
            isActiveProjectSummary,
            cancelProjectPrefetch,
            drainProjectPrefetchQueue,
            queueProjectDetailPrefetch,
            scheduleActiveProjectPrefetch,
            promoteProjectPrefetch,
            queue: projectPrefetchQueue,
            queued: projectPrefetchQueued,
            active: () => projectPrefetchActive,
        };
    `, sandbox);
    return {state: sandbox.result, calls, pending};
}

async function flush() {
    await Promise.resolve();
    await Promise.resolve();
}

async function testOnlyActiveProjectsUseThreeWorkersAndFailuresDoNotBlock() {
    const {state, calls, pending} = harness({cached: [6], requested: [7]});
    state.scheduleActiveProjectPrefetch([
        {id: 1, progress: 0, is_terminated: false},
        {id: 2, progress: 45, is_terminated: false},
        {id: 3, progress: 99, is_terminated: false},
        {id: 4, progress: 0, is_terminated: false},
        {id: 5, progress: 5, is_terminated: false},
        {id: 6, progress: 10, is_terminated: false},
        {id: 7, progress: 20, is_terminated: false},
        {id: 8, progress: 100, is_terminated: false},
        {id: 9, progress: 10, is_terminated: true},
    ]);

    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(state.active(), 3);
    pending.get(1).resolve({accepted: true});
    await flush();
    assert.deepEqual(calls, [1, 2, 3, 4]);
    pending.get(2).reject(new Error('one project failed'));
    await flush();
    assert.deepEqual(calls, [1, 2, 3, 4, 5]);
    assert.equal(state.active(), 3);
}

function testPromotionAndCancellationOnlyReorderQueuedWork() {
    const {state} = harness();
    state.scheduleActiveProjectPrefetch([
        {id: 1, progress: 0},
        {id: 2, progress: 0},
        {id: 3, progress: 0},
        {id: 4, progress: 0},
        {id: 5, progress: 0},
    ]);
    assert.deepEqual(Array.from(state.queue, item => item.id), [4, 5]);
    state.promoteProjectPrefetch(5);
    assert.deepEqual(Array.from(state.queue, item => item.id), [5, 4]);
    state.cancelProjectPrefetch(5);
    assert.deepEqual(Array.from(state.queue, item => item.id), [4]);
    assert.equal(state.queued.has(5), false);
}

function testEligibilityRequiresNotTerminatedAndIncomplete() {
    const {state} = harness();
    assert.equal(state.isActiveProjectSummary({progress: 0, is_terminated: false}), true);
    assert.equal(state.isActiveProjectSummary({progress: 100, is_terminated: false}), false);
    assert.equal(state.isActiveProjectSummary({progress: 10, is_terminated: true}), false);
}

Promise.resolve()
    .then(testOnlyActiveProjectsUseThreeWorkersAndFailuresDoNotBlock)
    .then(testPromotionAndCancellationOnlyReorderQueuedWork)
    .then(testEligibilityRequiresNotTerminatedAndIncomplete)
    .then(() => console.log('project prefetch tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
