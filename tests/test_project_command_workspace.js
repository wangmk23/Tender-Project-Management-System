'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const commandPath = path.join(root, 'source', 'frontend', '09-command-center.js');
const command = fs.readFileSync(commandPath, 'utf8');
const projects = fs.readFileSync(path.join(root, 'source', 'frontend', '02-projects.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'source', 'frontend', '01-core.js'), 'utf8');
const stageSettings = fs.readFileSync(path.join(root, 'source', 'frontend', '11-stage-settings.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');

const context = {
    console,
    STAGES: [
        {key: 'demand', name: '需求确认'},
        {key: 'doc_review', name: '采购文件审核'},
        {key: 'announcement', name: '公告发布'},
    ],
    systemSettings: {stage_order: ['announcement', 'demand', 'doc_review']},
    currentIsAdmin: true,
    document: {getElementById() { return null; }},
};
vm.createContext(context);
vm.runInContext(stageSettings, context, {filename: '11-stage-settings.js'});
vm.runInContext(command, context, {filename: '09-command-center.js'});

const project = {
    id: 7,
    number: 'SIM-007',
    name: '合成采购项目',
    purchaser: '合成采购人',
    method: '公开招标',
    progress: 45,
    current_stage_key: 'doc_review',
    stages: [
        {key: 'demand', name: '需求确认', completed: true, skipped: false},
        {key: 'doc_review', name: '采购文件审核', completed: false, skipped: false, planned_at: '2026-07-20'},
        {stage_key: 'announcement', name: '公告发布', completed: false, skipped: false},
    ],
};

const model = context.projectWorkspaceModel(project);
assert.equal(model.currentStage.key, 'doc_review');
assert.equal(model.nextActions[0].kind, 'complete-stage');
assert.equal(model.nextActions[0].stageKey, 'doc_review');
assert.equal(model.stages.length, 3);
assert.deepEqual(
    Array.from(model.stages, stage => stage.key || stage.stage_key),
    ['demand', 'doc_review', 'announcement'],
);

const parent = {
    insertions: 0,
    insertBefore(node, reference) {
        this.insertions += 1;
        assert.equal(reference, tabs);
        workspace = node;
    },
};
const tabs = {parentNode: parent};
let workspace = null;
let semanticRoot = null;
context.document = {
    getElementById(id) {
        if (id === 'projectTabs') return tabs;
        if (id === 'commandProjectWorkspace') return workspace;
        return null;
    },
    createElement(tag) {
        assert.equal(tag, 'section');
        return {id: '', className: '', innerHTML: ''};
    },
};
context.escHtml = value => String(value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
context.applyStableVisualSemantics = rootNode => { semanticRoot = rootNode; };
context.mountProjectWorkspace(project);
assert.equal(parent.insertions, 1);
assert.equal(workspace.id, 'commandProjectWorkspace');
assert.match(workspace.innerHTML, /^<div class="project-command-summary">/);
assert.match(workspace.innerHTML, /class="btn btn-secondary project-overview-toggle"[^>]+aria-expanded="false">展开概览<\/button>/);
assert.match(workspace.innerHTML, /<div class="project-quick-overview" hidden>/);
assert.match(workspace.innerHTML, /data-command-action="open-stage"[^>]+data-stage-key="doc_review"/);
assert.match(workspace.innerHTML, /data-command-action="open-stage"[^>]+data-stage-key="announcement"/, 'stage_key aliases must open the intended stage');
assert.equal(semanticRoot, workspace);

const overviewBody = {hidden: true};
const overviewAttributes = new Map([['aria-expanded', 'false']]);
const overviewControl = {
    dataset: {commandAction: 'toggle-project-overview'},
    textContent: '展开概览',
    closest(selector) {
        assert.equal(selector, '.project-command-workspace');
        return {
            querySelector(bodySelector) {
                assert.equal(bodySelector, '.project-quick-overview');
                return overviewBody;
            },
        };
    },
    getAttribute(name) { return overviewAttributes.get(name) || null; },
    setAttribute(name, value) { overviewAttributes.set(name, value); },
};
context.dispatchCommandAction(overviewControl);
assert.equal(overviewBody.hidden, false);
assert.equal(overviewAttributes.get('aria-expanded'), 'true');
assert.equal(overviewControl.textContent, '收起概览');
context.dispatchCommandAction(overviewControl);
assert.equal(overviewBody.hidden, true);
assert.equal(overviewAttributes.get('aria-expanded'), 'false');
assert.equal(overviewControl.textContent, '展开概览');

context.mountProjectWorkspace({...project, name: '更新后的项目'});
assert.equal(parent.insertions, 1, 'workspace must update in place rather than replace the continuous project view');
assert.doesNotMatch(workspace.innerHTML, /更新后的项目/, 'the compact overview must not duplicate the project title');
assert.match(workspace.innerHTML, /<div class="project-quick-overview" hidden>/, 'refreshed projects must return to the original collapsed layout');

const maliciousStageKey = `safe');globalThis.__workspaceXss=1;//`;
context.mountProjectWorkspace({
    ...project,
    purchaser: `<img src=x onerror="globalThis.__workspaceXss=2">`,
    current_stage_key: maliciousStageKey,
    stages: [{stage_key: maliciousStageKey, name: '恶意阶段', completed: false, skipped: false}],
});
assert.doesNotMatch(workspace.innerHTML, /\sonclick=|<img/);
assert.match(workspace.innerHTML, /data-command-action="open-stage"/);
assert.match(workspace.innerHTML, /project-command-actions[\s\S]+data-command-action="open-stage"/);
assert.match(workspace.innerHTML, /safe'\);globalThis\.__workspaceXss=1;\/\//);
assert.doesNotMatch(workspace.innerHTML, /workspaceXss=2/, 'the original compact layout does not duplicate purchaser markup');

assert.match(command, /function renderProjectIdentity\(/);
assert.match(command, /class="project-stage-rail"/);
assert.match(command, /function mountProjectWorkspace\(/);
assert.match(projects, /mountProjectWorkspace\(p\)/);
assert.match(core, /classList\.add\('command-context-panel'\)/);
assert.match(css, /\.project-command-workspace\s*\{/);
assert.match(css, /\.project-stage-rail\s*\{/);
assert.match(css, /#view-project\s*\{[^}]*overflow-y:\s*auto/s);
assert.match(css, /#view-project \.project-tabs\s*\{[^}]*position:\s*sticky/s);
assert.match(css, /#view-project \.project-tab-content\s*\{[^}]*flex:\s*none[^}]*overflow:\s*visible/s);
assert.match(css, /#view-project \.project-topbar\s*\{[^}]*width:\s*min\(1180px[^}]*border-radius:\s*24px/s);
assert.match(css, /#view-project \.board-columns\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,minmax\(0,1fr\)\)[^}]*overflow:\s*visible/s);
assert.match(css, /#view-project \.board-col-body\s*\{[^}]*max-height:\s*none[^}]*overflow:\s*visible/s);

console.log('project command workspace tests passed');
