'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'app.js'), 'utf8');
assert.match(source, /const projectDetailCache = new Map\(\)/);
assert.match(source, /const projectDetailRequests = new Map\(\)/);
assert.match(source, /const projectDetailRequestVersions = new Map\(\)/);
assert.match(source, /let projectSelectionVersion = 0/);

function extractFunction(name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `app.js must define ${name}()`);
    const start = Math.min(...starts);
    const signatureEnd = source.indexOf(')', start);
    const braceStart = source.indexOf('{', signatureEnd);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return {promise, resolve, reject};
}

function coordinator(api) {
    const sandbox = {api, allProjects: [{id: 7, name: 'summary'}], result: null};
    vm.runInNewContext(`
        const projectDetailCache = new Map();
        const projectDetailRequests = new Map();
        const projectDetailRequestVersions = new Map();
        const projectOrderById = new Map([[7, 0]]);
        ${extractFunction('storeProjectDetail')}
        ${extractFunction('requestProjectDetail')}
        ${extractFunction('dropProjectDetail')}
        result = {projectDetailCache, projectDetailRequests,
            projectDetailRequestVersions, storeProjectDetail,
            requestProjectDetail, dropProjectDetail};
    `, sandbox);
    return {sandbox, ...sandbox.result};
}

function testNewProjectCanBePrependedToExistingDescendingList() {
    const state = coordinator(async () => ({}));
    state.storeProjectDetail({id: 36, name: 'new'}, {prepend: true});
    assert.deepEqual(
        Array.from(state.sandbox.allProjects, project => project.id),
        [36, 7],
    );
}

async function testDeduplicatesAndRejectsSupersededResponse() {
    const calls = [];
    const first = deferred();
    const forced = deferred();
    const values = [first, forced];
    const state = coordinator(async (method, url) => {
        calls.push([method, url]);
        return values[calls.length - 1].promise;
    });

    const one = state.requestProjectDetail(7);
    const duplicate = state.requestProjectDetail(7);
    assert.strictEqual(one, duplicate);
    assert.equal(calls.length, 1);

    const newer = state.requestProjectDetail(7, {force: true});
    assert.equal(calls.length, 2);
    forced.resolve({id: 7, name: 'fresh'});
    assert.equal((await newer).accepted, true);
    first.resolve({id: 7, name: 'stale'});
    assert.equal((await one).accepted, false);
    assert.equal(state.projectDetailCache.get(7).name, 'fresh');
    assert.equal(state.sandbox.allProjects[0].name, 'fresh');
}

async function testDropInvalidatesPendingResponse() {
    const pending = deferred();
    const state = coordinator(() => pending.promise);
    state.storeProjectDetail({id: 7, name: 'cached'});
    const request = state.requestProjectDetail(7);
    state.dropProjectDetail(7);
    assert.equal(state.projectDetailCache.has(7), false);
    pending.resolve({id: 7, name: 'deleted-project'});
    assert.equal((await request).accepted, false);
    assert.equal(state.projectDetailCache.has(7), false);
}

function selectionHarness(cacheEntries = []) {
    const requests = [];
    const renders = [];
    const loaders = [];
    const toasts = [];
    const errors = [];
    const sandbox = {
        projectDetailCache: new Map(cacheEntries),
        projectSelectionVersion: 0,
        projectNavigationVersion: 0, projectEditVersion: 0,
        isEditingApplicationForm: () => false,
        allProjects: [{id: 7}, {id: 8}],
        currentProject: null,
        promoteProjectPrefetch() {},
        requestProjectDetail(pid) {
            const value = deferred();
            requests.push({pid: Number(pid), ...value});
            return value.promise;
        },
        storeProjectDetail(project) {
            sandbox.projectDetailCache.set(Number(project.id), project);
            return project;
        },
        renderProjectDetail(project, resetTab) {
            sandbox.currentProject = project;
            renders.push({id: project.id, resetTab});
        },
        showViewLoading(id) { loaders.push(id); },
        switchView() {},
        toast(message, type) { toasts.push({message, type}); },
        console: {error(...args) { errors.push(args); }},
        result: null,
    };
    vm.runInNewContext(`${extractFunction('selectProject')}\nresult = selectProject;`, sandbox);
    return {sandbox, selectProject: sandbox.result, requests, renders, loaders, toasts, errors};
}

async function testCacheRendersBeforeBackgroundResponse() {
    const cached = {id: 7, name: 'cached'};
    const fresh = {id: 7, name: 'fresh'};
    const state = selectionHarness([[7, cached]]);
    const selecting = state.selectProject(7);
    assert.deepEqual(state.renders[0], {id: 7, resetTab: true});
    assert.equal(state.loaders.length, 0);
    state.requests[0].resolve({project: fresh, accepted: true});
    await selecting;
    assert.deepEqual(state.renders[1], {id: 7, resetTab: false});
}

async function testFirstLoadShowsFeedback() {
    const state = selectionHarness();
    const selecting = state.selectProject(7);
    assert.equal(state.loaders.length, 5);
    assert.equal(state.renders.length, 0);
    state.requests[0].resolve({project: {id: 7}, accepted: true});
    await selecting;
    assert.deepEqual(state.renders[0], {id: 7, resetTab: true});
}

async function testOldSelectionCannotOverwriteNewSelection() {
    const state = selectionHarness();
    const selectingSeven = state.selectProject(7);
    const selectingEight = state.selectProject(8);
    state.requests[1].resolve({project: {id: 8}, accepted: true});
    await selectingEight;
    state.requests[0].resolve({project: {id: 7}, accepted: true});
    await selectingSeven;
    assert.deepEqual(state.renders.map(item => item.id), [8]);
}

async function testCachedRefreshFailureKeepsVisibleData() {
    const state = selectionHarness([[7, {id: 7, name: 'cached'}]]);
    const selecting = state.selectProject(7);
    state.requests[0].reject(new Error('offline'));
    await selecting;
    assert.deepEqual(state.renders.map(item => item.id), [7]);
    assert.equal(state.toasts[0].type, 'warning');
    assert.equal(state.errors.length, 1);
}

async function testRefreshReusesPendingDetailRequest() {
    const calls = [];
    const fresh = {id: 7, name: 'after-write'};
    const sandbox = {
        currentProject: {id: 7, name: 'before-write'},
        projectNavigationVersion: 0, projectEditVersion: 0,
        isEditingApplicationForm: () => false,
        requestProjectDetail: async (pid, options) => {
            calls.push({pid, options});
            return {project: fresh, accepted: true};
        },
        safeRender() {},
        invalidateProjectTabRenders() {}, activeProjectTabName() { return 'board'; }, ensureProjectTabRendered() {},
        renderSidebar() {}, renderProjectTopbar() {}, renderBoard() {},
        renderTimeline() {}, renderTasks() {}, renderInfo() {}, renderAttachments() {},
        invalidateProjectViews() {},
        document: {getElementById() { return null; }},
        result: null,
    };
    vm.runInNewContext(`${extractFunction('refreshProject')}\nresult = refreshProject();`, sandbox);
    await sandbox.result;
    assert.equal(calls.length, 1);
    assert.equal(calls[0].pid, 7);
    assert.equal(calls[0].options, undefined);
    assert.equal(sandbox.currentProject.name, 'after-write');
}

function testDeletionPathsInvalidateCache() {
    const batch = extractFunction('batchDeleteProjects');
    const single = extractFunction('deleteCurrentProject');
    assert.match(batch, /dropProjectDetail\(pid\)/);
    assert.match(single, /dropProjectDetail\(deletedProjectId\)/);
}

Promise.resolve()
    .then(testNewProjectCanBePrependedToExistingDescendingList)
    .then(testDeduplicatesAndRejectsSupersededResponse)
    .then(testDropInvalidatesPendingResponse)
    .then(testCacheRendersBeforeBackgroundResponse)
    .then(testFirstLoadShowsFeedback)
    .then(testOldSelectionCannotOverwriteNewSelection)
    .then(testCachedRefreshFailureKeepsVisibleData)
    .then(testRefreshReusesPendingDetailRequest)
    .then(testDeletionPathsInvalidateCache)
    .then(() => console.log('project detail cache tests passed'))
    .catch(error => { console.error(error); process.exitCode = 1; });
