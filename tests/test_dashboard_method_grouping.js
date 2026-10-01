'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '09-command-center.js'), 'utf8');

function context() {
    const sandbox = {
        console,
        document: {addEventListener() {}},
        allProjects: [],
        systemSettings: {
            stage_templates: {
                '公开招标': [
                    {id: 'notice', name: '公告', icon: '📢', modules: ['common']},
                    {id: 'open', name: '开标', icon: '🎯', modules: ['common', 'bid_opening']},
                ],
                '直选': [{id: 'choose', name: '直选', icon: '✅', modules: ['common']}],
            },
        },
        METHODS: ['公开招标', '直选'],
        sidebarDataVersion: 1,
        escHtml: String,
        projectColor() { return '#00f'; },
        normalizeClientStageTemplates(value) { return value; },
    };
    vm.createContext(sandbox);
    vm.runInContext(source, sandbox);
    return sandbox;
}

test('unopened metric only counts active projects with a pending bid-opening module stage', () => {
    const subject = context();
    const projects = [
        {id: 1, method: '公开招标', progress: 30, stages: [{stage_key: 'open', completed: false, skipped: false}]},
        {id: 2, method: '公开招标', progress: 40, stages: [{stage_key: 'open', completed: true, skipped: false}]},
        {id: 3, method: '直选', progress: 10, stages: [{stage_key: 'choose', completed: false}]},
        {id: 4, method: '公开招标', progress: 20, is_terminated: true, stages: [{stage_key: 'open', completed: false}]},
    ];
    assert.deepEqual(projects.map(project => subject.projectIsUnopened(project)), [true, false, false, false]);
    const model = subject.commandCenterModel(projects, {total: 4, in_progress: 3, completed: 0}, new Date(2026, 7, 31));
    assert.equal(model.metrics.unopened, 1);
    assert.deepEqual(
        JSON.parse(JSON.stringify(model.unopenedProjects.map(project => project.id))),
        [1],
    );
});

test('active project list renders procurement-method groups', () => {
    const subject = context();
    const html = subject.renderActiveProjectList([
        {id: 1, method: '公开招标', number: 'A', name: '甲', progress: 30},
        {id: 2, method: '直选', number: 'B', name: '乙', progress: 20},
    ]);
    assert.match(html, /command-project-group/);
    assert.match(html, /公开招标/);
    assert.match(html, /直选/);
});

test('dashboard exposes the unopened projects metric', () => {
    assert.match(source, /未开标项目/);
    assert.match(source, /model\.metrics\.unopened/);
    for (const removedCopy of ['活跃项目', '配置开标阶段且尚未完成', '需要提前安排', '需要立即处理', '累计完成项目']) {
        assert.doesNotMatch(source, new RegExp(removedCopy));
    }
});

test('dashboard expands unopened projects into a procurement-method grouped panel', () => {
    const subject = context();
    const projects = [
        {id: 1, method: '公开招标', number: 'A', name: '未开标甲', progress: 30, stages: [{stage_key: 'open', completed: false}]},
        {id: 2, method: '公开招标', number: 'B', name: '已开标乙', progress: 50, stages: [{stage_key: 'open', completed: true}]},
    ];
    subject.allProjects.push(...projects);
    const model = subject.commandCenterModel(projects, {total: 2, in_progress: 2, completed: 0}, new Date(2026, 7, 31));
    const html = subject.renderCommandCenterDashboard(model, new Date(2026, 7, 31));
    assert.match(html, /command-unopened-panel/);
    assert.match(html, /<span>未开标项目<\/span>/);
    assert.match(html, /未开标甲/);
    assert.doesNotMatch(html.match(/command-unopened-panel[\s\S]*?<\/article>/)?.[0] || '', /已开标乙/);
    assert.equal(subject.renderActiveProjectList([], '暂无未开标项目'), '<div class="command-empty">暂无未开标项目</div>');
});
