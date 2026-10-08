'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const stageSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '11-stage-settings.js'), 'utf8');
const projectSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '02-projects.js'), 'utf8');

function load() {
    const sandbox = {
        STAGES: [{key: 'legacy', name: '旧阶段', icon: '•'}],
        METHODS: ['公开招标', '竞争性磋商'],
        systemSettings: {
            stage_templates: {
                '公开招标': [{id: 'notice', name: '公告', icon: '📢', modules: ['common']}],
                '竞争性磋商': [{id: 'talk', name: '磋商', icon: '🤝', modules: ['common']}],
            },
        },
        allProjects: [],
        currentIsAdmin: true,
        currentProject: null,
        escHtml: String,
        document: {getElementById() { return null; }},
    };
    vm.createContext(sandbox);
    vm.runInContext(stageSource, sandbox);
    const start = projectSource.indexOf('function batchAdvanceStageDefinitions');
    const end = projectSource.indexOf('function switchBAMode', start);
    assert.ok(start >= 0, 'method-aware batch helpers must exist');
    vm.runInContext(projectSource.slice(start, end), sandbox);
    return sandbox;
}

test('batch stages come from the selected procurement method template', () => {
    const context = load();
    assert.deepEqual(
        JSON.parse(JSON.stringify(context.batchAdvanceStageDefinitions('竞争性磋商'))),
        [{key: 'talk', name: '磋商', icon: '🤝'}],
    );
});

test('batch candidates require matching method and pending selected stage', () => {
    const context = load();
    const projects = [
        {id: 1, method: '公开招标', stages: [{stage_key: 'notice', completed: false, skipped: false}]},
        {id: 2, method: '竞争性磋商', stages: [{stage_key: 'talk', completed: false, skipped: false}]},
        {id: 3, method: '公开招标', stages: [{stage_key: 'notice', completed: true, skipped: false}]},
        {id: 4, method: '公开招标', is_terminated: true, stages: [{stage_key: 'notice', completed: false}]},
        {id: 5, method: '公开招标', stages: [{stage_key: 'notice', completed: false, template_removed: true}]},
    ];
    assert.deepEqual(
        context.batchAdvanceCandidates('公开招标', 'notice', projects).map(project => project.id),
        [1],
    );
});

test('project batch list resolves snapshot metadata without fixed STAGES lookup', () => {
    const start = projectSource.indexOf('function onBatchProjectChange');
    const end = projectSource.indexOf('function _bindBACount', start);
    const source = projectSource.slice(start, end);
    assert.match(source, /projectStageDefinition/);
    assert.doesNotMatch(source, /STAGES\.find/);
    assert.match(source, /batchAdvancePendingStages/);
});

test('dialog source exposes procurement method before stage selection', () => {
    assert.match(projectSource, /batchMethodSelect/);
    assert.match(projectSource, /采购方式/);
    assert.match(projectSource, /onBatchMethodChange/);
});

test('project picker excludes completed progress and projects without actionable stages', () => {
    const context = load();
    const projects = [
        {id:1, progress:80, stages:[{key:'notice',completed:false}]},
        {id:2, progress:20, stages:[{key:'notice',completed:true}]},
        {id:3, progress:0, stages:[{key:'notice',skipped:true},{key:'gone',template_removed:true}]},
        {id:4, progress:10, is_terminated:true, stages:[{key:'notice'}]},
        {id:5, progress:100}, {id:6, progress:40},
        {id:7, progress:40, stages:[]},
        {id:8, progress:0, stages:[{completed:false}]},
        {id:9, progress:100, stages:[{key:'notice',completed:false}]},
    ];
    assert.deepEqual(context.batchAdvanceProjectCandidates(projects).map(row=>row.id),[1]);
    assert.match(projectSource,/const active = batchAdvanceProjectCandidates\(\)/);
});
