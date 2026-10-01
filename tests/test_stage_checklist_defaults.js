'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appPath = path.join(__dirname, '..', 'src', 'static', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

function extractFunction(name) {
    const asyncStart = source.indexOf(`async function ${name}(`);
    const syncStart = source.indexOf(`function ${name}(`);
    const start = asyncStart >= 0 ? asyncStart : syncStart;
    assert.notEqual(start, -1, `app.js must define ${name}()`);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

function normalize(value) {
    return JSON.parse(JSON.stringify(value));
}

async function testProjectChecklistUpdates() {
    const requests = [];
    const sandbox = {
        api: async (...args) => {
            requests.push(normalize(args));
            return {};
        },
        result: null,
    };
    vm.runInNewContext(
        `${extractFunction('getRequiredStageChecklistItems')}\n` +
        `${extractFunction('setProjectStageChecklistOptional')}\n` +
        'result = {getRequiredStageChecklistItems, setProjectStageChecklistOptional};',
        sandbox,
    );

    const project = {
        id: 7,
        stages: [
            {checklist: [{id: 11, required: true}, {id: 12, required: false}]},
            {checklist: [{id: 13, required: true}]},
            {},
        ],
    };
    assert.deepEqual(
        Array.from(sandbox.result.getRequiredStageChecklistItems(project), item => item.id),
        [11, 13],
    );
    assert.deepEqual(normalize(sandbox.result.getRequiredStageChecklistItems(null)), []);
    assert.equal(await sandbox.result.setProjectStageChecklistOptional(project), 2);
    assert.deepEqual(requests, [
        ['PUT', '/api/projects/7/stage-checklist/11', {required: false}],
        ['PUT', '/api/projects/7/stage-checklist/13', {required: false}],
    ]);

    requests.length = 0;
    assert.equal(await sandbox.result.setProjectStageChecklistOptional({id: 8, stages: []}), 0);
    assert.deepEqual(requests, []);
}

async function testMigrationSummary() {
    const projects = {
        7: {id: 7, stages: [{checklist: [{id: 71, required: true}]}]},
        8: {id: 8, stages: [{checklist: [{id: 81, required: true}]}]},
    };
    const requests = [];
    const sandbox = {
        allProjects: [],
        api: async (method, url, body) => {
            requests.push(normalize([method, url, body]));
            if (method === 'GET') {
                const id = Number(url.split('/').pop());
                if (id === 9) throw new Error('denied');
                return projects[id];
            }
            return {};
        },
        result: null,
    };
    vm.runInNewContext(
        `${extractFunction('getRequiredStageChecklistItems')}\n` +
        `${extractFunction('setProjectStageChecklistOptional')}\n` +
        `${extractFunction('migrateAllStageChecklistDefaults')}\n` +
        'result = migrateAllStageChecklistDefaults;',
        sandbox,
    );

    const result = await sandbox.result([{id: 7}, {id: 9}, {id: 8}]);
    assert.deepEqual(normalize(result), {
        projects_scanned: 3,
        items_updated: 2,
        failures: [{project_id: 9, error: 'denied'}],
    });
    assert.equal(requests.filter(([method]) => method === 'PUT').length, 2);
}

function testCreationDefaults() {
    const addFunction = extractFunction('addChecklistItem');
    assert.doesNotMatch(addFunction, /id="checkRequired"\s+checked/);

    const createFunction = extractFunction('createProject');
    const initializeAt = createFunction.indexOf('await initializeProjectChecklistDefaults(p.id)');
    const storeAt = createFunction.indexOf('storeProjectDetail(p');
    const selectAt = createFunction.indexOf('selectProject(p.id)');
    assert.ok(initializeAt >= 0, 'new projects must initialize checklist defaults');
    assert.ok(storeAt >= 0, 'new projects must be inserted into local state immediately');
    assert.ok(selectAt > storeAt, 'the locally stored project must be selected');
    assert.ok(selectAt < initializeAt, 'the project must open before checklist initialization finishes');
    assert.match(createFunction, /项目已创建，但检查清单默认项初始化失败/);
    assert.doesNotMatch(extractFunction('selectProject'), /initializeProjectChecklistDefaults|setProjectStageChecklistOptional/);
    assert.doesNotMatch(extractFunction('refreshProject'), /initializeProjectChecklistDefaults|setProjectStageChecklistOptional/);
}

Promise.all([testProjectChecklistUpdates(), testMigrationSummary(), testCreationDefaults()])
    .then(() => console.log('stage checklist default tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
