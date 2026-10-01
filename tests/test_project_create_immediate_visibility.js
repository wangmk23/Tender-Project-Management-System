'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'app.js'), 'utf8');

function extractFunction(name) {
    const start = source.indexOf(`async function ${name}(`);
    assert.notEqual(start, -1, `app.js must define async ${name}()`);
    const braceStart = source.indexOf('{', start);
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
    const promise = new Promise(ok => { resolve = ok; });
    return {promise, resolve};
}

async function testProjectIsVisibleBeforeChecklistInitializationCompletes() {
    const checklist = deferred();
    const events = [];
    const fields = {
        npNumber: {value: 'CG-NEW'},
        npName: {value: '即时显示项目'},
        npPurchaser: {value: '采购人'},
        npMethod: {value: '公开招标'},
        npBudget: {value: ''},
        npPrepareOwner: {value: ''},
        npReviewOwner: {value: ''},
        npYear: {value: '2026'},
        npNoDeposit: {checked: false},
    };
    const created = {id: 77, number: 'CG-NEW', name: '即时显示项目'};
    const sandbox = {
        document: {
            getElementById: id => id === 'view-project'
                ? {classList: {contains: name => name === 'active'}}
                : fields[id],
        },
        window: {_newProjectLots: []},
        allProjects: [],
        currentProject: null,
        api: async (method, url) => {
            assert.deepEqual([method, url], ['POST', '/api/projects']);
            return created;
        },
        initializeProjectChecklistDefaults: () => checklist.promise,
        storeProjectDetail(project, options) {
            events.push(['store', project.id, options?.prepend === true]);
            sandbox.allProjects.push(project);
        },
        renderSidebar() { events.push(['render']); },
        closeModal() { events.push(['close']); },
        selectProject(id) { events.push(['select', id]); sandbox.currentProject = created; },
        loadAllProjects: async () => { events.push(['load']); },
        requestProjectDetail: async id => {
            events.push(['detail-request', id]);
            return {accepted: true, project: {...created, initialized: true}};
        },
        renderProjectDetail(project) { events.push(['detail-render', project.id]); },
        dropProjectDetail(id) { events.push(['drop', id]); },
        toast() {},
        result: null,
    };
    vm.runInNewContext(`${extractFunction('createProject')}\nresult = createProject;`, sandbox);

    const pendingCreate = sandbox.result();
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events.slice(0, 4), [
        ['store', 77, true],
        ['close'],
        ['render'],
        ['select', 77],
    ]);
    assert.equal(events.some(([name]) => name === 'load'), false);

    checklist.resolve(0);
    await pendingCreate;
    assert.equal(events.some(([name]) => name === 'load'), false, 'creation must not reload all projects');
    assert.deepEqual(events.slice(-2), [
        ['detail-request', 77],
        ['detail-render', 77],
    ]);

    const createSource = extractFunction('createProject');
    assert.match(
        createSource,
        /await requestProjectDetail\(p\.id,\s*\{force:\s*true\}\);[\s\S]*Number\(currentProject\?\.id\) === Number\(p\.id\)/,
        'selection must be rechecked after the forced detail request resolves',
    );
    assert.match(
        createSource,
        /document\.getElementById\('view-project'\)\?\.classList\.contains\('active'\)/,
        'the created project may only rerender while its view remains active',
    );
}

testProjectIsVisibleBeforeChecklistInitializationCompletes()
    .then(() => console.log('project create immediate visibility tests passed'))
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    });
