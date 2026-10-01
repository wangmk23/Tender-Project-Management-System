'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const test = require('node:test');
const {createProjects} = require('./fixtures/frontend_dataset');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'app.js'), 'utf8');

function extractFunction(name) {
    const starts = [source.indexOf(`function ${name}(`), source.indexOf(`async function ${name}(`)]
        .filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `app.js must define ${name}()`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

function createIndexHarness(projects) {
    const list = {innerHTML: ''};
    const search = {value: ''};
    const sandbox = {
        allProjects: projects, currentProject: null, sidebarFilter: 'all',
        sidebarManageMode: false, selectedProjectIds: new Set(), sidebarDataVersion: 0,
        sidebarRenderSignature: '', projectDetailCache: new Map(),
        projectDetailRequests: new Map(), projectDetailRequestVersions: new Map(),
        normalizationCalls: 0, result: null,
        document: {getElementById(id) {
            if (id === 'projectList') return list;
            if (id === 'searchInput') return search;
            return null;
        }},
        projectColor() { return '#2563eb'; },
        projectStatusInfo() { return {cls: 'active', icon: '●', text: '进行中'}; },
        challengeBadgeHtml() { return ''; }, projectHasOverdue() { return false; },
        projectHasSoon() { return false; }, updateManageUI() {},
        escHtml(value) { return String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;'); },
    };
    vm.runInNewContext(`
        const projectById = new Map();
        const projectSearchById = new Map();
        const projectOrderById = new Map();
        const sidebarProjectNumberCollator = new Intl.Collator('zh-CN', {numeric: true, sensitivity: 'base'});
        let sidebarSortDirection = 'asc';
        let sidebarMethodFilter = '';
        ${extractFunction('projectSearchText')}
        ${extractFunction('normalizeSidebarSortDirection')}
        ${extractFunction('validSidebarProjectNumber')}
        ${extractFunction('sortSidebarProjects')}
        ${extractFunction('ensureSidebarSortControl')}
        ${extractFunction('ensureSidebarMethodFilter')}
        const baseProjectSearchText = projectSearchText;
        projectSearchText = project => { normalizationCalls += 1; return baseProjectSearchText(project); };
        ${extractFunction('rebuildProjectIndexes')}
        ${extractFunction('renderSidebar')}
        ${extractFunction('markSidebarDataChanged')}
        ${extractFunction('storeProjectDetail')}
        ${extractFunction('dropProjectDetail')}
        rebuildProjectIndexes(allProjects);
        result = {projectById, projectSearchById, projectOrderById,
            renderSidebar, storeProjectDetail, dropProjectDetail};
    `, sandbox);
    return {sandbox, list, search, ...sandbox.result};
}

function percentile(sorted, fraction) {
    return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

const projects = createProjects(1000);
projects[499] = {...projects[499], name: 'Mixed CASE 项目', purchaser: '测试医院'};
const state = createIndexHarness(projects);
assert.equal(state.projectById.size, 1000);
assert.equal(state.projectById.get(500).name, 'Mixed CASE 项目');
assert.equal(state.projectSearchById.size, 1000);
assert.match(state.projectSearchById.get(500), /mixed case 项目/);
assert.equal(state.sandbox.normalizationCalls, 1000, 'index rebuild normalizes each project once');

state.search.value = 'mixed case';
state.sandbox.sidebarDataVersion += 1;
state.renderSidebar();
assert.match(state.list.innerHTML, /Mixed CASE 项目/);
state.search.value = '测试医院';
state.renderSidebar();
assert.equal(state.sandbox.normalizationCalls, 1000, 'sidebar filtering must read cached text');

state.storeProjectDetail({id: 500, name: '索引已更新', number: 'UPDATED', purchaser: '新采购人'});
assert.equal(state.projectById.get(500).name, '索引已更新');
assert.match(state.projectSearchById.get(500), /新采购人/);
assert.equal(state.sandbox.normalizationCalls, 1001, 'a precise update normalizes only the changed project');
state.dropProjectDetail(500);
assert.equal(state.projectById.has(500), false);
assert.equal(state.projectSearchById.has(500), false);
assert.equal(state.projectOrderById.has(500), false);
assert.equal(state.sandbox.allProjects.some(project => Number(project.id) === 500), false);

assert.match(extractFunction('loadAllProjects'), /rebuildProjectIndexes\(allProjects\)/);
assert.doesNotMatch(extractFunction('renderSidebar'), /`\$\{p\.number\} \$\{p\.name\}/);
assert.doesNotMatch(
    source,
    /currentProject\s*=\s*await api\('GET',\s*`\/api\/projects\/\$\{currentProject\.id\}`\)/,
    'project refreshes after writes must flow through storeProjectDetail()',
);

test('successful DELETE removes local project even when reload fails', async () => {
    const projects = [{id: 1, name: 'deleted'}, {id: 2, name: 'retained'}];
    const renderedProjectIds = [];
    const sandbox = {
        currentProject: projects[0],
        allProjects: projects,
        projectById: new Map(projects.map(project => [project.id, project])),
        projectSearchById: new Map([[1, 'deleted'], [2, 'retained']]),
        projectOrderById: new Map([[1, 0], [2, 1]]),
        projectDetailCache: new Map(projects.map(project => [project.id, project])),
        projectDetailRequests: new Map(),
        projectDetailRequestVersions: new Map(),
        sidebarDataVersion: 0,
        confirmDialog: async () => true,
        api: async method => {
            assert.equal(method, 'DELETE');
            return {};
        },
        loadAllProjects: async () => { throw new Error('reload failed'); },
        closeModal() {}, switchView() {}, toast() {},
        renderSidebar() {
            renderedProjectIds.push(sandbox.allProjects.map(project => project.id));
        },
        result: null,
    };
    vm.runInNewContext(`
        ${extractFunction('markSidebarDataChanged')}
        ${extractFunction('dropProjectDetail')}
        ${extractFunction('deleteCurrentProject')}
        result = deleteCurrentProject();
    `, sandbox);
    await sandbox.result;
    assert.deepEqual(sandbox.allProjects.map(project => project.id), [2]);
    assert.equal(sandbox.projectById.has(1), false);
    assert.equal(sandbox.projectSearchById.has(1), false);
    assert.equal(sandbox.projectOrderById.get(2), 0);
    assert.equal(sandbox.sidebarDataVersion, 1);
    assert.deepEqual(renderedProjectIds.at(-1), [2]);
});

for (const deleteFunction of ['batchDeleteProjects', 'deleteCurrentProject']) {
    const body = extractFunction(deleteFunction);
    assert.ok(
        body.indexOf('renderSidebar()') >= 0
        && body.indexOf('renderSidebar()') < body.indexOf('await loadAllProjects()'),
        `${deleteFunction} must render the local deletion before attempting reload`,
    );
}

const benchmarkState = createIndexHarness(createProjects(1000));
for (let index = 0; index < 10; index += 1) {
    benchmarkState.search.value = `warmup-${index}`;
    benchmarkState.renderSidebar();
}
const timings = [];
for (let index = 0; index < 50; index += 1) {
    benchmarkState.search.value = `SIM-${String(index + 1).padStart(5, '0')}`;
    const startedAt = performance.now();
    benchmarkState.renderSidebar();
    timings.push(performance.now() - startedAt);
}
timings.sort((left, right) => left - right);
const medianMs = percentile(timings, 0.5);
const p95Ms = percentile(timings, 0.95);
assert.ok(medianMs < 20, `1000-project median ${medianMs.toFixed(3)}ms must be under 20ms`);
assert.ok(p95Ms < 50, `1000-project P95 ${p95Ms.toFixed(3)}ms must be under 50ms`);
console.log(`frontend index benchmark: median=${medianMs.toFixed(3)}ms p95=${p95Ms.toFixed(3)}ms samples=50`);
console.log('frontend performance tests passed');
