'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const coreSource = fs.readFileSync(path.join(root, 'source', 'frontend', '01-core.js'), 'utf8');
const viewsSource = fs.readFileSync(path.join(root, 'source', 'frontend', '05-views.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(root, 'source', 'frontend', '06-admin.js'), 'utf8');
const projectsSource = fs.readFileSync(path.join(root, 'source', 'frontend', '02-projects.js'), 'utf8');
const workflowSource = fs.readFileSync(path.join(root, 'source', 'frontend', '04-project-workflow.js'), 'utf8');

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
    return {promise, resolve, reject};
}

const sandbox = {
    console,
    URL,
    Promise,
    Map,
    Set,
    Date,
    window: {location: {hostname: 'localhost', origin: 'http://localhost'}, CSRF_TOKEN: ''},
    document: {documentElement: {dataset: {}}, getElementById() { return null; }, querySelectorAll() { return []; }, querySelector() { return null; }},
    localStorage: {getItem() { return null; }, setItem() {}},
    result: null,
};
vm.createContext(sandbox);
vm.runInContext(`${coreSource}\nresult = {VIEW_CACHE_TTL_MS, viewDataCache, viewDataRequests, projectDetailCache, projectDetailRequests, projectDetailRequestVersions, readViewCache, writeViewCache, invalidateViewCache, invalidateProjectDerivedState, requestViewData, api};`, sandbox);

const {
    VIEW_CACHE_TTL_MS,
    viewDataRequests,
    projectDetailCache,
    projectDetailRequests,
    projectDetailRequestVersions,
    readViewCache,
    writeViewCache,
    invalidateViewCache,
    invalidateProjectDerivedState,
    requestViewData,
    api,
} = sandbox.result;
const plain = value => JSON.parse(JSON.stringify(value));

function extractFunction(source, name) {
    const starts = [source.indexOf(`function ${name}(`), source.indexOf(`async function ${name}(`)]
        .filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `${name} must exist`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to extract ${name}`);
}

assert.equal(readViewCache('dashboard'), null);
writeViewCache('dashboard', {total: 7}, 1000);
assert.deepEqual(plain(readViewCache('dashboard', 1001).value), {total: 7});
assert.equal(readViewCache('dashboard', 1001).fresh, true);
assert.equal(readViewCache('dashboard', 1000 + VIEW_CACHE_TTL_MS + 1).fresh, false);

const pending = deferred();
let loaderCalls = 0;
const loader = () => { loaderCalls += 1; return pending.promise; };
const first = requestViewData('dashboard', loader);
const duplicate = requestViewData('dashboard', loader);
assert.strictEqual(first, duplicate);
assert.equal(loaderCalls, 1);
pending.resolve({total: 8});

Promise.resolve(first).then(result => {
    assert.equal(result.accepted, true);
    assert.deepEqual(plain(result.value), {total: 8});
    assert.equal(viewDataRequests.has('dashboard'), false);
    writeViewCache('calendar:2026-07', {month: 7});
    writeViewCache('calendar:2026-08', {month: 8});
    writeViewCache('settings', {theme: 'dark'});
    invalidateViewCache('calendar:');
    assert.equal(readViewCache('calendar:2026-07'), null);
    assert.equal(readViewCache('calendar:2026-08'), null);
    assert.deepEqual(plain(readViewCache('settings').value), {theme: 'dark'});
}).then(async () => {
    const older = deferred();
    const newer = deferred();
    const oldRequest = requestViewData('race', () => older.promise);
    const newRequest = requestViewData('race', () => newer.promise, {force: true});
    newer.resolve('new');
    assert.deepEqual(plain(await newRequest), {value: 'new', accepted: true});
    older.resolve('old');
    assert.deepEqual(plain(await oldRequest), {value: 'old', accepted: false});

    const invalidated = deferred();
    const invalidatedRequest = requestViewData('calendar:2026-09', () => invalidated.promise);
    invalidateViewCache('calendar:');
    const replacement = deferred();
    const replacementRequest = requestViewData('calendar:2026-09', () => replacement.promise);
    assert.notStrictEqual(replacementRequest, invalidatedRequest);
    replacement.resolve('replacement-month');
    assert.deepEqual(plain(await replacementRequest), {value: 'replacement-month', accepted: true});
    invalidated.resolve('stale-month');
    assert.deepEqual(plain(await invalidatedRequest), {value: 'stale-month', accepted: false});

    vm.runInContext(`
        let purchaserBoardData = {cached: true};
        function invalidateCommandCenterData() { window.commandInvalidations = (window.commandInvalidations || 0) + 1; }
        function invalidateChartBoardData() { window.chartInvalidations = (window.chartInvalidations || 0) + 1; }
        function queueProjectDetailPrefetch(projectId, options) {
            window.projectRefreshes = [...(window.projectRefreshes || []), {projectId, options}];
        }
        function cancelProjectPrefetch(projectId) {
            window.projectCancellations = [...(window.projectCancellations || []), projectId];
        }
    `, sandbox);
    projectDetailCache.set(7, {id: 7});
    writeViewCache('dashboard', {total: 1});
    writeViewCache('calendar:2026-07', {month: 7});
    writeViewCache('procure', {projects: [7]});
    sandbox.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({id: 999}),
    });
    await api('PUT', '/api/projects/7/stages/bid_opening', {completed: true});
    assert.equal(projectDetailCache.has(7), false);
    assert.equal(readViewCache('dashboard'), null);
    assert.equal(readViewCache('calendar:2026-07'), null);
    assert.equal(readViewCache('procure'), null);
    assert.equal(vm.runInContext('purchaserBoardData', sandbox), null);
    assert.equal(sandbox.window.commandInvalidations, 1);
    assert.equal(sandbox.window.chartInvalidations, 1);
    assert.deepEqual(
        plain(sandbox.window.projectRefreshes || []),
        [{projectId: '7', options: {front: true}}],
    );

    sandbox.fetch = () => Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({success: true}),
    });
    await api('DELETE', '/api/projects/7');
    assert.deepEqual(plain(sandbox.window.projectCancellations), ['7']);
    assert.equal(sandbox.window.projectRefreshes.length, 1);

    projectDetailCache.set(8, {id: 8});
    writeViewCache('dashboard', {total: 2});
    sandbox.fetch = () => Promise.resolve({
        ok: false,
        status: 500,
        json: async () => ({error: 'write rejected'}),
    });
    await assert.rejects(
        api('PUT', '/api/projects/8', {name: 'rejected'}),
        /write rejected/,
    );
    assert.equal(projectDetailCache.has(8), true);
    assert.notEqual(readViewCache('dashboard'), null);

    assert.match(viewsSource, /function calendarCacheKey\(year, month\)/);
    assert.match(adminSource, /function settingsCacheKey\(\)/);
    assert.doesNotMatch(extractFunction(viewsSource, 'loadDashboard'), /showViewLoading/);
    assert.doesNotMatch(extractFunction(viewsSource, 'loadCalendar'), /showViewLoading/);
    assert.doesNotMatch(extractFunction(adminSource, 'loadSettingsView'), /innerHTML\s*=\s*['"`][^'"`]*正在读取/);

    const refresh = deferred();
    const renders = [];
    const toasts = [];
    const dashboardSandbox = {
        readViewCache() { return {value: {stats: {total: 7}, projects: [{id: 1}]}, fresh: false}; },
        renderDashboard(stats, projects) { renders.push({stats, projects}); },
        requestViewData() { return refresh.promise; },
        writeViewCache() { throw new Error('failed refresh must not replace cache'); },
        renderViewSkeleton() { throw new Error('cached dashboard must not show a skeleton'); },
        renderViewLoadError() { throw new Error('cached dashboard must not show a blocking error'); },
        toast(message, type) { toasts.push({message, type}); },
        api() { throw new Error('requestViewData controls this harness'); },
        allProjects: [{id: 1}],
        console: {error() {}},
        result: null,
    };
    vm.createContext(dashboardSandbox);
    vm.runInContext(`${extractFunction(viewsSource, 'loadDashboard')}\nresult = loadDashboard();`, dashboardSandbox);
    assert.deepEqual(plain(renders), [{stats: {total: 7}, projects: [{id: 1}]}]);
    refresh.reject(new Error('offline'));
    await dashboardSandbox.result;
    assert.equal(renders.length, 1);
    assert.equal(toasts.length, 1);
    assert.equal(toasts[0].type, 'warning');

    assert.match(coreSource, /function invalidateProjectDerivedState\(projectId\)/);
    assert.match(extractFunction(coreSource, 'invalidateProjectDerivedState'), /invalidateViewCache\('dashboard'\)/);
    assert.match(extractFunction(coreSource, 'invalidateProjectDerivedState'), /invalidateViewCache\('calendar:'\)/);
    assert.match(extractFunction(projectsSource, 'loadAllProjects'), /invalidateProjectDerivedState\(\)/);
    assert.match(extractFunction(projectsSource, 'loadAllProjects'), /scheduleActiveProjectPrefetch\(allProjects\)/);
    assert.match(extractFunction(workflowSource, 'refreshProject'), /invalidateProjectViews\(\)/);
    assert.match(extractFunction(workflowSource, 'refreshProject'), /loadDashboard\(\{force:\s*true\}\)/);
    assert.match(adminSource, /function cacheCurrentSettingsView\(\)/);
    assert.match(extractFunction(adminSource, 'cacheCurrentSettingsView'), /writeViewCache\(settingsCacheKey\(\)/);

    const calendarFailure = deferred();
    const calendarErrors = [];
    const calendarToasts = [];
    const calendarSandbox = {
        calendarYear: 2026,
        calendarMonth: 7,
        document: {getElementById() { return {textContent: ''}; }},
        calendarCacheKey(year, month) { return `calendar:${year}-${month}`; },
        readViewCache() { return null; },
        renderViewSkeleton() {},
        requestViewData() { return calendarFailure.promise; },
        renderCalendar() {},
        writeViewCache() {},
        renderViewLoadError(...args) { calendarErrors.push(args); },
        toast(...args) { calendarToasts.push(args); },
        console: {error() {}},
        result: null,
    };
    vm.createContext(calendarSandbox);
    vm.runInContext(`${extractFunction(viewsSource, 'loadCalendar')}\nresult = loadCalendar();`, calendarSandbox);
    calendarSandbox.calendarMonth = 8;
    calendarFailure.reject(new Error('abandoned month failed'));
    await calendarSandbox.result;
    assert.equal(calendarErrors.length, 0);
    assert.equal(calendarToasts.length, 0);

    assert.match(adminSource, /function markSettingsFormDirty\(\)/);
    const settingsRefresh = deferred();
    let settingsRenders = 0;
    const settingsSandbox = {
        settingsFormDirty: false,
        systemInfo: null,
        systemSettings: null,
        document: {getElementById() { return {}; }},
        settingsCacheKey() { return 'settings'; },
        readViewCache() { return {value: {systemInfo: {version: 1}, systemSettings: {smtp_host: 'cached'}}, fresh: false}; },
        renderSettingsView() { settingsRenders += 1; },
        requestViewData() { return settingsRefresh.promise; },
        writeViewCache() {},
        renderViewSkeleton() {}, renderViewLoadError() {}, toast() {},
        console: {error() {}},
        result: null,
    };
    vm.createContext(settingsSandbox);
    vm.runInContext(`${extractFunction(adminSource, 'loadSettingsView')}\nresult = loadSettingsView();`, settingsSandbox);
    assert.equal(settingsRenders, 1);
    settingsSandbox.settingsFormDirty = true;
    settingsRefresh.resolve({accepted: true, value: {systemInfo: {version: 2}, systemSettings: {smtp_host: 'fresh'}}});
    await settingsSandbox.result;
    assert.equal(settingsRenders, 1);
    assert.equal(settingsSandbox.systemSettings.smtp_host, 'fresh');

    console.log('fast view navigation tests passed');
}).catch(error => { console.error(error); process.exitCode = 1; });
