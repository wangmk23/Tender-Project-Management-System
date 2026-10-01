'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');
const {createProjects} = require('../tests/fixtures/frontend_dataset');

const appPath = path.join(__dirname, '..', 'src', 'static', 'app.js');

function extractFunction(source, name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
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

function percentile(sorted, fraction) {
    const index = Math.min(
        sorted.length - 1,
        Math.ceil(sorted.length * fraction) - 1,
    );
    return sorted[index];
}

function runScenario(renderSidebar, list, search, sandbox, size, warmups, iterations) {
    const selectProjectQuery = index => {
        const projectId = (index % size) + 1;
        search.value = `SIM-${String(projectId).padStart(5, '0')}`;
        sandbox.sidebarDataVersion += 1;
    };
    for (let index = 0; index < warmups; index += 1) {
        selectProjectQuery(index);
        renderSidebar();
    }
    const timings = [];
    const outputs = new Set();
    let outputChanges = 0;
    let previousOutput = null;
    const writesBeforeMeasurement = list.writeCount;
    for (let index = 0; index < iterations; index += 1) {
        selectProjectQuery(index + warmups);
        const start = performance.now();
        renderSidebar();
        timings.push(performance.now() - start);
        const output = list.innerHTML;
        outputs.add(output);
        if (previousOutput !== null && output !== previousOutput) outputChanges += 1;
        previousOutput = output;
    }
    timings.sort((left, right) => left - right);
    return {
        projects: size,
        samples: iterations,
        measuredRenders: list.writeCount - writesBeforeMeasurement,
        distinctOutputs: outputs.size,
        outputChanges,
        renderedProjects: (
            list.innerHTML.match(/class="sidebar-project/g) || []
        ).length,
        outputBytes: Buffer.byteLength(list.innerHTML, 'utf8'),
        medianMs: Number(percentile(timings, 0.5).toFixed(3)),
        p95Ms: Number(percentile(timings, 0.95).toFixed(3)),
    };
}

function benchmarkSidebar({
    sizes = [100, 500, 1000],
    warmups = 10,
    iterations = 50,
} = {}) {
    const source = fs.readFileSync(appPath, 'utf8');
    const scenarios = sizes.map(size => {
        const list = {
            value: '',
            writeCount: 0,
            get innerHTML() { return this.value; },
            set innerHTML(value) {
                this.value = value;
                this.writeCount += 1;
            },
        };
        const search = {value: ''};
        const projects = createProjects(size);
        const sandbox = {
            allProjects: projects,
            currentProject: null,
            sidebarFilter: 'all',
            sidebarManageMode: false,
            selectedProjectIds: new Set(),
            sidebarDataVersion: 1,
            sidebarRenderSignature: '',
            result: null,
            document: {
                getElementById(id) {
                    return id === 'projectList' ? list : search;
                },
            },
            projectColor() { return '#2563eb'; },
            projectStatusInfo() {
                return {cls: 'active', icon: '●', text: '进行中'};
            },
            challengeBadgeHtml() { return ''; },
            projectHasOverdue() { return false; },
            projectHasSoon() { return false; },
            customerForProject(project) {
                return {name: project.purchaser || '', tags: [], category_id: null};
            },
            matchesProjectCustomerFilters() { return true; },
            updateManageUI() {},
            escHtml(value) {
                return String(value ?? '')
                    .replaceAll('&', '&amp;')
                    .replaceAll('<', '&lt;');
            },
        };
        vm.runInNewContext(
            `const projectById = new Map();
            const projectSearchById = new Map();
            const projectOrderById = new Map();
            const sidebarProjectNumberCollator = new Intl.Collator('zh-CN', {numeric: true, sensitivity: 'base'});
            let sidebarSortDirection = 'asc';
            let sidebarMethodFilter = '';
            ${extractFunction(source, 'projectSearchText')}
            ${extractFunction(source, 'normalizeSidebarSortDirection')}
            ${extractFunction(source, 'validSidebarProjectNumber')}
            ${extractFunction(source, 'sortSidebarProjects')}
            ${extractFunction(source, 'ensureSidebarSortControl')}
            ${extractFunction(source, 'ensureSidebarMethodFilter')}
            ${extractFunction(source, 'rebuildProjectIndexes')}
            ${extractFunction(source, 'renderSidebar')}
            rebuildProjectIndexes(allProjects);
            result = renderSidebar;`,
            sandbox,
        );
        return runScenario(
            sandbox.result,
            list,
            search,
            sandbox,
            size,
            warmups,
            iterations,
        );
    });
    return {runtime: process.version, warmups, iterations, scenarios};
}

function main(argv = process.argv.slice(2)) {
    const index = argv.indexOf('--output');
    if (index < 0 || !argv[index + 1]) {
        throw new Error('usage: benchmark_sidebar.js --output OUTPUT_JSON');
    }
    const output = path.resolve(argv[index + 1]);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(
        output,
        `${JSON.stringify(benchmarkSidebar(), null, 2)}\n`,
        'utf8',
    );
}

if (require.main === module) main();
module.exports = {benchmarkSidebar, extractFunction};
