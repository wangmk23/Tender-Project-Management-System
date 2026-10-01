const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const projectSource = fs.readFileSync(
    path.join(__dirname, '..', 'source', 'frontend', '02-projects.js'),
    'utf8',
);

function loadProjectModule(extra = {}) {
    const sandbox = {
        document: {addEventListener() {}},
        ...extra,
    };
    vm.createContext(sandbox);
    vm.runInContext(projectSource, sandbox);
    return sandbox;
}

function createStorage(initial = {}) {
    const values = new Map(Object.entries(initial));
    return {
        getItem(key) { return values.has(key) ? values.get(key) : null; },
        setItem(key, value) { values.set(key, String(value)); },
    };
}

function createSortControlDocument() {
    const manageButton = {id: 'sidebarManageBtn'};
    const parent = {
        children: [{id: 'projectListTitle'}, manageButton],
        insertBefore(node, reference) {
            const referenceIndex = this.children.indexOf(reference);
            this.children.splice(referenceIndex, 0, node);
            node.parentNode = this;
        },
    };
    manageButton.parentNode = parent;
    const document = {
        addEventListener() {},
        createElement(tagName) {
            return {
                tagName: String(tagName).toUpperCase(),
                attributes: {},
                listeners: {},
                setAttribute(name, value) { this.attributes[name] = String(value); },
                addEventListener(name, listener) { this.listeners[name] = listener; },
                get options() {
                    return Array.from(this.innerHTML.matchAll(/<option value="([^"]+)">([^<]+)<\/option>/g), match => ({
                        value: match[1],
                        textContent: match[2],
                    }));
                },
            };
        },
        getElementById(id) {
            if (id === 'sidebarManageBtn') return manageButton;
            return parent.children.find(child => child.id === id) || null;
        },
    };
    return {document, manageButton, parent};
}

test('sidebar project sorting compares complete numbers across years without mutating API order', () => {
    const sandbox = loadProjectModule();
    const projects = [
        {id: 1, number: 'PRJ-2026-010'},
        {id: 2, number: 'PRJ-2025-099'},
        {id: 3, number: 'PRJ-2026-002'},
        {id: 4, number: ''},
        {id: 5, number: '无编号'},
        {id: 6, number: 'PRJ-2026-002'},
        {id: 7, number: 'CG-010'},
        {id: 8, number: 'CG-002'},
        {id: 9, number: 'PRJ-034'},
    ];

    assert.equal(typeof sandbox.sortSidebarProjects, 'function');
    assert.equal(typeof sandbox.normalizeSidebarSortDirection, 'function');
    assert.deepEqual(
        Array.from(sandbox.sortSidebarProjects(projects, 'asc'), item => item.id),
        [8, 7, 9, 2, 3, 6, 1, 4, 5],
    );
    assert.deepEqual(
        Array.from(sandbox.sortSidebarProjects(projects, 'desc'), item => item.id),
        [1, 3, 6, 2, 9, 7, 8, 4, 5],
    );
    assert.deepEqual(projects.map(item => item.id), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
    assert.equal(sandbox.normalizeSidebarSortDirection('desc'), 'desc');
    assert.equal(sandbox.normalizeSidebarSortDirection('unexpected'), 'asc');
});

test('sidebar sort selector mounts before management and persists a safe direction', () => {
    const storage = createStorage();
    const {document, manageButton, parent} = createSortControlDocument();
    const sandbox = loadProjectModule({document, localStorage: storage});
    let renderCalls = 0;
    sandbox.renderSidebar = () => { renderCalls += 1; };

    assert.equal(typeof sandbox.ensureSidebarSortControl, 'function');
    assert.equal(typeof sandbox.setSidebarSortDirection, 'function');
    assert.equal(typeof sandbox.readSidebarSortDirection, 'function');
    const select = sandbox.ensureSidebarSortControl();

    assert.equal(select.id, 'sidebarProjectSort');
    assert.equal(select.options[0].textContent, '编号升序');
    assert.equal(select.options[1].textContent, '编号降序');
    assert.equal(parent.children.indexOf(select), parent.children.indexOf(manageButton) - 1);

    sandbox.setSidebarSortDirection('desc');
    assert.equal(storage.getItem('projectSidebarSortDirection'), 'desc');
    assert.equal(select.value, 'desc');
    assert.equal(renderCalls, 1);

    storage.setItem('projectSidebarSortDirection', 'invalid');
    assert.equal(sandbox.readSidebarSortDirection(), 'asc');
});
