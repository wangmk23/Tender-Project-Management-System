'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const views = fs.readFileSync(path.join(root, 'source', 'frontend', '05-views.js'), 'utf8');
const command = fs.readFileSync(path.join(root, 'source', 'frontend', '09-command-center.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');

function extractFunction(source, name) {
    const start = source.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const braceStart = source.indexOf('{', source.indexOf(')', start));
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`unable to extract ${name}`);
}

assert.match(views, /commandCenterModel\(projects, stats/);
assert.match(views, /renderCommandCenterDashboard\(model\)/);
assert.match(views, /closest\('\.view'\).*classList\.contains\('active'\)/);
assert.match(command, /function renderCommandCenterDashboard\(/);
assert.match(command, /data-command-node-card/);
assert.match(command, /最近关键节点倒计时/);
assert.match(command, /data-command-deadline=/);
assert.match(command, /role="timer"/);
assert.doesNotMatch(command, /data-command-node-card[^>]*data-command-click-advance/);
assert.match(command, /data-command-node-next/);
assert.match(command, /function collectKeyNodes\(/);
assert.match(command, /function showCommandNode\(/);
assert.match(command, /function switchToNextNode\(/);
assert.match(command, /function resetCommandCarousel\(/);
assert.match(command, /commandCarouselTimer/);
assert.match(command, /commandCarouselPaused/);
assert.match(command, /collectKeyNodes/);
assert.match(command, /console\.warn/);
assert.doesNotMatch(command, /data-command-focus-direction/);
assert.doesNotMatch(command, /data-command-click-advance/);
assert.match(command, /function initializeCommandCenterMotion\(/);
assert.match(command, /function cleanupCommandCenterMotion\(/);
assert.doesNotMatch(command, /commandDashboardRefreshTimer/);
assert.doesNotMatch(command, /loadDashboard\(\{force: true\}\)/);
assert.match(command, /body\.innerHTML\s*=\s*renderNearestNodeCountdown\(node, now\)/);
assert.match(command, /commandMotionPreference.*addEventListener/);
assert.match(command, /visibilitychange/);
assert.match(command, /prefers-reduced-motion: reduce/);
assert.match(command, /class="[^"]*command-action-queue[^"]*"/);
assert.match(command, /class="[^"]*command-risk-panel[^"]*"/);
assert.doesNotMatch(command, /data-command-action="open-actions"/);
assert.doesNotMatch(command, /open-action-entry|openActionCenterEntry/);
assert.doesNotMatch(command, /\sonclick=/);
assert.match(css, /\.command-dashboard\s*\{/);
assert.match(css, /\.command-content-grid\s*\{[^}]*flex:\s*0\s+0\s+auto[^}]*min-height:\s*auto/s);
assert.match(css, /\.command-page-intro\s*\{[^}]*padding-right:\s*88px/s);
assert.match(css, /\.command-node-card\s*\{/);
assert.match(css, /\.command-node-next\s*\{/);
assert.match(css, /\.command-node-head-right\s*\{/);
assert.match(css, /@media\(max-width:1500px\)/);
assert.match(css, /@media\(max-width:1200px\)/);
assert.match(css, /@media\(max-width:900px\)/);
assert.match(css, /@media\(max-width:760px\)[^}]*\{[\s\S]*?\.command-page-intro\s*\{[^}]*padding-right:\s*0/s);
assert.doesNotMatch(css, /\.command-focus-card\s*\{/);

const escaped = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const context = {
    console,
    Promise,
    document: {addEventListener() {}},
    escHtml: escaped,
    allProjects: [],
    projectSearchById: new Map(),
    projectSearchText() { return ''; },
    projectColor() { return '#4f46e5'; },
    result: null,
};
vm.createContext(context);
vm.runInContext(command, context);
const malicious = '<img src=x onerror=alert(1)>';
const html = context.renderCommandCenterDashboard({
    metrics: {total: 1, active: 1, overdue: 1, dueSoon: 0, completed: 0},
    activeProjects: [
        {id: 7, number: 'P-7', name: malicious, progress: 40},
    ],
    actions: [
        {projectId: '7" autofocus', projectNumber: 'P-7', projectName: malicious, stageKey: 'open', stageName: malicious, urgency: 'overdue', days: -1, plannedAt: '2026-07-20T09:00'},
        {projectId: 8, projectNumber: 'P-8', projectName: '测试项目', stageKey: 'review', stageName: '评审', urgency: 'soon', days: 2, plannedAt: '2026-07-22T10:30'},
    ],
    insights: {methods: {[malicious]: 1}, riskProjects: [{id: 7, number: 'P-7', name: malicious}]},
});
assert.doesNotMatch(html, /<img|onclick=/);
assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
assert.match(html, /data-command-node-card/);
assert.match(html, /最近关键节点倒计时/);
assert.match(html, /data-command-node-next/);
assert.match(html, /暂无待处理关键节点/);
assert.match(html, /data-command-action="switch-view" data-view="calendar"/);

const distributionHtml = context.renderInsightBreakdown({
    methods: {公开招标: 19, 网上竞价: 5, 邀请招标: 3},
});
assert.match(
    distributionHtml,
    /aria-label="公开招标：19 个项目"[^>]*>[\s\S]*?<span>公开招标<\/span>[\s\S]*?<strong class="command-insight-count">19<\/strong>/,
);
assert.match(
    distributionHtml,
    /aria-label="网上竞价：5 个项目"[^>]*>[\s\S]*?<span>网上竞价<\/span>[\s\S]*?<strong class="command-insight-count">5<\/strong>/,
);
assert.match(
    distributionHtml,
    /aria-label="邀请招标：3 个项目"[^>]*>[\s\S]*?<span>邀请招标<\/span>[\s\S]*?<strong class="command-insight-count">3<\/strong>/,
);

const motionListeners = {mouseenter: 0, mouseleave: 0};
const motionCard = {
    dataset: {},
    addEventListener(type) { motionListeners[type] += 1; },
    querySelector(selector) {
        if (selector === '[data-command-node-next]') return {setAttribute() {}};
        return null;
    },
};
const motionRoot = {
    querySelectorAll() { return []; },
    querySelector(selector) {
        if (selector === '[data-command-node-card]') return motionCard;
        return null;
    },
};
const motionContext = {
    Date,
    cleanupCommandCenterMotion() {},
    updateNearestNodeCountdown() {},
    collectKeyNodes() { return [{projectId: 1}, {projectId: 2}]; },
    resetCommandCarousel() {},
    result: null,
};
vm.runInNewContext(
    `${extractFunction(command, 'initializeCommandCenterMotion')}\n`
        + 'initializeCommandCenterMotion(root); initializeCommandCenterMotion(root);',
    {...motionContext, root: motionRoot},
);
assert.deepEqual(
    motionListeners,
    {mouseenter: 1, mouseleave: 1},
    'reinitializing the same dashboard card must not accumulate hover listeners',
);

console.log('command center dashboard tests passed');
