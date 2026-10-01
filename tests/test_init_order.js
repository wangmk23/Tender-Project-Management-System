'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'source/frontend/manifest.json'), 'utf-8'));
const appJs = fs.readFileSync(path.join(ROOT, 'src/static/app.js'), 'utf-8');

test('manifest places the init/bootstrap entry (08-bootstrap.js) last', () => {
    const last = manifest.sections[manifest.sections.length - 1].file;
    assert.strictEqual(last, '08-bootstrap.js',
        `bootstrap must be the last section so its top-level init() call runs after every ` +
        `module-level declaration; currently last is ${last}`);
});

test('built app.js defers init() instead of calling it synchronously at top level', () => {
    const deferred = appJs.includes("setTimeout(init, 0)") || appJs.includes("DOMContentLoaded', init");
    assert.ok(deferred,
        'init() must be deferred (setTimeout/DOMContentLoaded) so module-level `let` declarations ' +
        'are initialized before init runs; otherwise a temporal-dead-zone error aborts init() ' +
        'before the dynamic 采购人分类 / 图表看板 sidebar entries are inserted.');
    // the old broken direct top-level call must be gone
    assert.ok(!appJs.includes('\ninit();\n') && !appJs.includes('\ninit();\r'),
        'app.js still contains a bare top-level init(); call that would run before later modules load');
});

test('built app.js wires both dynamic board nav insertions into init', () => {
    assert.ok(appJs.includes('function ensurePurchaserBoardWorkspace'),
        'missing ensurePurchaserBoardWorkspace');
    assert.ok(appJs.includes('function ensureChartBoardWorkspace'),
        'missing ensureChartBoardWorkspace');
    // both are invoked from init (installChartBoardShell -> ensureChartBoardWorkspace, plus direct call)
    assert.ok(
        appJs.includes('installChartBoardShell()') && appJs.includes('ensurePurchaserBoardWorkspace()'),
        'init() does not invoke the board workspace ensure functions');
});
