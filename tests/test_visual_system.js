'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');
const source = fs.readFileSync(path.join(root, 'src', 'static', 'app.js'), 'utf8');
const chartModulePath = path.join(root, 'source', 'frontend', '10-chart-board.js');

function extractFunction(name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `app.js must define ${name}()`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

test('stable-evolution tokens cover status, focus, spacing, and motion', () => {
    for (const token of [
        '--space-1', '--space-6', '--focus-ring',
        '--status-info', '--status-warning', '--status-error', '--status-success',
        '--status-info-surface', '--status-warning-surface',
        '--status-error-surface', '--status-success-surface',
        '--motion-fast', '--motion-base', '--motion-slow', '--motion-ease',
    ]) {
        assert.match(css, new RegExp(`${token}\\s*:`), `missing ${token}`);
    }
});

test('state markup is consistent, escaped, and announced accessibly', () => {
    const sandbox = {
        escHtml(value) {
            return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
                .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
        },
        result: null,
    };
    vm.runInNewContext(`
        ${extractFunction('uiStateMarkup')}
        result = [
            uiStateMarkup('loading', '正在读取'),
            uiStateMarkup('empty', '暂无项目'),
            uiStateMarkup('warning', '附件较大'),
            uiStateMarkup('error', '<b>加载失败</b>', {actionLabel: '重试'}),
            uiStateMarkup('saving', '正在保存'),
            uiStateMarkup('success', '已保存'),
        ];
    `, sandbox);
    const [loading, empty, warning, error, saving, success] = sandbox.result;
    assert.match(loading, /ui-state ui-state-loading/);
    assert.match(loading, /role="status"/);
    assert.match(empty, /ui-state-empty/);
    assert.match(warning, /ui-state-warning/);
    assert.match(error, /ui-state-error/);
    assert.match(error, /&lt;b&gt;加载失败&lt;\/b&gt;/);
    assert.match(error, /<button[^>]+>重试<\/button>/);
    assert.match(error, /role="alert"/);
    assert.match(saving, /aria-busy="true"/);
    assert.match(success, /ui-state-success/);
});

test('all six state classes have text-and-color presentation', () => {
    for (const state of ['loading', 'empty', 'warning', 'error', 'saving', 'success']) {
        assert.match(css, new RegExp(`\\.ui-state-${state}\\b`), `missing ${state} state`);
    }
    assert.match(css, /\.ui-state-copy\s+strong/);
    assert.match(css, /\.ui-state-copy\s+p/);
});

test('toast feedback keeps its own readable foreground and background', () => {
    const toastSource = extractFunction('toast');
    assert.doesNotMatch(toastSource, /ui-state-feedback|ui-state-\$\{state\}/);
    assert.match(toastSource, /`toast \$\{state\} show`/);
});

test('compact desktop keeps primary actions visible at 1366 by 768', () => {
    assert.match(
        css,
        /@media\s*\(min-width:\s*1181px\)\s*and\s*\(max-width:\s*1440px\)\s*and\s*\(max-height:\s*820px\)/,
    );
    assert.match(css, /\.stable-primary-actions\s*\{[^}]*position:\s*sticky[^}]*right:/s);
});

test('project sidebar collapses below desktop threshold but not at 1366', () => {
    assert.match(
        css,
        /@media\s*\(max-width:\s*1180px\)\s*and\s*\(min-width:\s*769px\)/,
    );
    assert.match(css, /\.sidebar\s*\{[^}]*transform:\s*translateX\(-100%\)/s);
    assert.match(css, /\.sidebar\.open\s*\{[^}]*translateX\(0\)/s);
    assert.match(css, /\.hamburger\s*\{[^}]*display:\s*flex/s);
});

test('sidebar navigation reserves exactly three rows and keeps the active view visible', () => {
    assert.match(
        css,
        /\.sidebar-nav\s*\{[^}]*--sidebar-nav-row-height:\s*46\.5px[^}]*max-height:\s*139\.5px[^}]*flex:\s*0\s+0\s+auto[^}]*overflow-y:\s*auto[^}]*overscroll-behavior:\s*contain/s,
    );
    assert.match(
        css,
        /@media\s*\(max-width:\s*1180px\)[\s\S]*?\.sidebar-nav\s*\{[^}]*--sidebar-nav-row-height:\s*60px[^}]*max-height:\s*180px/s,
    );
    assert.match(
        css,
        /@media\s*\(max-width:\s*400px\)[\s\S]*?\.sidebar-nav\s*\{[^}]*--sidebar-nav-row-height:\s*45px[^}]*max-height:\s*135px/s,
    );
    const switchSource = extractFunction('switchView');
    assert.match(switchSource, /const activeNav = document\.querySelector/);
    assert.match(switchSource, /activeNav\?\.classList\.add\('active'\)/);
    assert.match(switchSource, /activeNav\?\.scrollIntoView\?\.\(\{block:\s*'nearest'\}\)/);
});

test('settings about card shows the v5.8.12 release version', () => {
    const aboutSource = extractFunction('renderAboutCard');
    const initSource = extractFunction('init');
    assert.match(aboutSource, /<strong>5\.8\.12<\/strong>/);
    assert.match(aboutSource, /<strong>2026-07-29<\/strong>/);
    assert.doesNotMatch(aboutSource, /<strong>5\.8\.4<\/strong>/);
    assert.match(initSource, /document\.title\s*=\s*'项目管理系统'/);
    assert.doesNotMatch(initSource, /document\.title\s*=\s*'项目管理系统 v/);
});

test('motion and keyboard focus preferences are explicit', () => {
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(css, /\.purchaser-unit-open:focus-visible/);
    assert.match(css, /\.admin-control:focus-visible/);
    assert.match(css, /\.sidebar-project:focus-visible/);
});

test('purchaser board remains in-place after procurement with labeled admin controls', () => {
    const ensureSource = extractFunction('ensurePurchaserBoardWorkspace');
    const renderSource = extractFunction('renderPurchaserBoard');
    assert.match(ensureSource, /data-view="procure"/);
    assert.match(ensureSource, /insertAdjacentElement\('afterend', nav\)/);
    assert.match(ensureSource, /按采购人分类/);
    assert.match(renderSource, /admin-control/);
    assert.match(renderSource, /分类管理/);
    assert.match(extractFunction('renderPurchaserProjectPane'), /移动分类/);
    assert.doesNotMatch(source, /view-customers|customer_action|customer-drawer|purchaser-drawer|mergeCustomer/);
    assert.doesNotMatch(css, /\.customer-management|\.customer-drawer|\.purchaser-drawer/);
});

test('dynamic cards and shell actions receive stable semantics', () => {
    const semantics = extractFunction('applyStableVisualSemantics');
    assert.match(semantics, /stable-primary-actions/);
    assert.match(semantics, /role.*button/);
    assert.match(semantics, /tabindex/);
    assert.match(semantics, /hasAttribute\('onkeydown'\)/);
    assert.doesNotMatch(semantics, /\.purchaser-unit-card/);
    assert.match(extractFunction('enhanceApplicationShell'), /applyStableVisualSemantics/);
    const purchaserRender = extractFunction('renderPurchaserDirectoryResults');
    assert.match(purchaserRender, /<button type="button" class="purchaser-unit-open/);
    assert.doesNotMatch(purchaserRender, /purchaser-unit-card[^>]+role="button"/);
    assert.doesNotMatch(purchaserRender, /purchaser-unit-card[^>]+tabindex=/);
    assert.doesNotMatch(purchaserRender, /purchaser-unit-(?:card|open)[^>]+onkeydown=/);
});

test('sidebar scroll areas use subtle theme-aware five pixel scrollbars', () => {
    assert.match(css, /--sidebar-scroll-thumb\s*:/);
    assert.match(css, /--sidebar-scroll-thumb-hover\s*:/);
    assert.match(css, /:root\[data-theme="dark"\][\s\S]*--sidebar-scroll-thumb\s*:/);
    assert.match(css, /\.sidebar-nav\s*,\s*\.sidebar-project-list\s*\{[^}]*scrollbar-width:\s*thin[^}]*scrollbar-color:\s*var\(--sidebar-scroll-thumb\)\s+transparent/s);
    assert.match(css, /\.sidebar-nav::\-webkit-scrollbar\s*,\s*\.sidebar-project-list::\-webkit-scrollbar\s*\{[^}]*width:\s*5px[^}]*height:\s*5px/s);
    assert.match(css, /\.sidebar-nav::\-webkit-scrollbar-track\s*,\s*\.sidebar-project-list::\-webkit-scrollbar-track\s*\{[^}]*background:\s*transparent/s);
    assert.match(css, /\.sidebar-nav::\-webkit-scrollbar-thumb\s*,\s*\.sidebar-project-list::\-webkit-scrollbar-thumb\s*\{[^}]*background:\s*var\(--sidebar-scroll-thumb\)/s);
    assert.match(css, /(?:hover|focus-within)[\s\S]*var\(--sidebar-scroll-thumb-hover\)/);
});

test('chart board inherits global theme and uses the responsive B layout', () => {
    assert.ok(fs.existsSync(chartModulePath), 'chart board module must exist');
    const chartSource = fs.readFileSync(chartModulePath, 'utf8');
    assert.doesNotMatch(chartSource, /CHART_THEMES|chartBoardTheme|chartThemeMenu/);
    assert.doesNotMatch(css, /--chart-color-|\.chart-theme-/);
    assert.match(css, /\.cb-board-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s+minmax\(320px,\s*360px\)/s);
    assert.doesNotMatch(css, /@media\s*\(max-width:\s*1280px\)[\s\S]*?\.cb-board-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(css, /@media\s*\(max-width:\s*960px\)[\s\S]*?\.cb-board-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(css, /@media\s*\(max-width:\s*880px\)[\s\S]*?\.cb-kpis\s*\{[^}]*repeat\(2,[^}]*\}\s*\.cb-supporting\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
    assert.match(css, /\.cb-activity-filters select:focus-visible[^}]*box-shadow:\s*var\(--focus-ring\)/s);
    assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.cb-/);
    assert.match(source, /function enhanceApplicationShell\(/);
    assert.match(source, /function ensurePurchaserBoardWorkspace\(/);
    assert.doesNotMatch(chartSource, /view-customers|customer-management|customer-drawer|purchaser-drawer/);
});

test('procurement distribution keeps each count inside its own responsive item', () => {
    assert.match(
        css,
        /@media\(max-width:1500px\)[\s\S]*?\.command-insight-list\s*\{[^}]*grid-template-columns:\s*repeat\(2,minmax\(0,1fr\)\)[^}]*column-gap:\s*24px/s,
    );
    assert.match(
        css,
        /\.command-insight-row\s*\{[^}]*min-width:\s*0[^}]*grid-template-columns:\s*minmax\(0,1fr\)\s+minmax\(80px,1\.2fr\)\s+minmax\(32px,max-content\)/s,
    );
    assert.match(css, /\.command-insight-count\s*\{[^}]*min-width:\s*32px[^}]*text-align:\s*right/s);
    assert.match(
        css,
        /@media\(max-width:760px\)[\s\S]*?\.command-insight-list\s*\{[^}]*grid-template-columns:\s*minmax\(0,1fr\)/s,
    );
});
