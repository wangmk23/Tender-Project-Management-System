'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'source', 'frontend', '01-core.js'), 'utf8');
const bootstrap = fs.readFileSync(path.join(root, 'source', 'frontend', '08-bootstrap.js'), 'utf8');

function extractFunction(source, name) {
    const starts = [source.indexOf(`function ${name}(`), source.indexOf(`async function ${name}(`)].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `${name} must exist`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to extract ${name}`);
}

function extractListenerStatement(source, prefix) {
    const start = source.indexOf(prefix);
    assert.notEqual(start, -1, `${prefix} must exist`);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, source.indexOf(');', index) + 2);
    }
    throw new Error(`Unable to extract ${prefix}`);
}

let chartEnsures = 0;
let chartRefreshes = 0;
let chartCleanups = 0;
let purchaserEnsures = 0;
let purchaserLoads = 0;
const views = new Map(['dashboard', 'chart-board', 'purchasers'].map(name => [name, {classList: {add() {}, remove() {}}}]));
const nav = {classList: {add() {}, remove() {}}};
const sandbox = {
    projectNavigationVersion: 0,
    document: {
        querySelectorAll(selector) { return selector === '.view' ? [...views.values()] : [nav]; },
        querySelector() { return nav; },
        getElementById(id) {
            if (id.startsWith('view-')) return views.get(id.slice(5));
            return {classList: {toggle() {}}};
        },
    },
    ensureChartBoardWorkspace() { chartEnsures += 1; },
    refreshChartBoard() { chartRefreshes += 1; },
    cleanupChartBoardLifecycle() { chartCleanups += 1; },
    ensurePurchaserBoardWorkspace() { purchaserEnsures += 1; },
    loadPurchaserBoard() { purchaserLoads += 1; },
    loadDashboard() {}, loadCalendar() {}, loadProcureBoard() {}, loadSettingsView() {},
    setTimeout: () => 0,
};
vm.runInNewContext(`${extractFunction(core, 'playViewEnter')}\n${extractFunction(core, 'switchView')}\nswitchView('chart-board'); switchView('purchasers');`, sandbox);
assert.equal(chartEnsures, 1);
assert.equal(chartRefreshes, 1);
assert.equal(chartCleanups, 1, 'leaving the chart view performs chart-only lifecycle cleanup');
assert.equal(purchaserEnsures, 1);
assert.equal(purchaserLoads, 1, 'purchaser navigation remains intact');
assert.equal(chartCleanups, 1, 'chart cleanup must remain scoped to chart lifecycle state');

assert.match(bootstrap, /installChartBoardShell\(\)/);
assert.match(bootstrap, /addEventListener\('pagehide', cleanupChartBoardLifecycle\)/);
assert.match(bootstrap, /closeCommandPalette\(\)/);
assert.doesNotMatch(bootstrap, /closeChartThemeMenu|closeActionCenter/);
assert.doesNotMatch(extractFunction(core, 'switchView'), /closeCommandPalette|closeActionCenter/);

const escapeCalls = [];
const escapeDocument = {
    addEventListener(type, listener) { if (type === 'keydown') this.keydown = listener; },
    getElementById() { return null; },
};
vm.runInNewContext(extractListenerStatement(bootstrap, "document.addEventListener('keydown', e => {"), {
    document: escapeDocument,
    topManagedDialog() { return null; },
    closeCommandPalette() { escapeCalls.push('palette'); },
    closeModal() { escapeCalls.push('modal'); },
    closeSlide() { escapeCalls.push('slide'); },
    openCommandPalette() {}, showNewProjectModal() {}, saveProjectInfo() {}, switchProjectTab() {},
    currentProject: null, editingStageKey: null,
});
escapeDocument.keydown({key: 'Escape', ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}});
assert.deepEqual(escapeCalls, ['palette', 'modal', 'slide']);

console.log('navigation cleanup tests passed');
