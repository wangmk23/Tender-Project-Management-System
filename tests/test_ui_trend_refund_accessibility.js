'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const acorn = require('acorn');
const {JSDOM} = require(process.env.PM_JSDOM_MODULE || 'jsdom');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');

const frontend = path.join(__dirname, '..', 'source', 'frontend');
const chartSource = fs.readFileSync(path.join(frontend, '10-chart-board.js'), 'utf8');

function trend(rows) {
    const dom = new JSDOM('<main></main>');
    const context = vm.createContext({document: dom.window.document});
    vm.runInContext(chartSource, context);
    dom.window.document.querySelector('main').innerHTML = context.renderTrendChart(rows);
    return dom;
}

test('trend exposes every month and both counts in a named table through a focusable native disclosure', () => {
    const dom = trend([
        {month: '5月', created: 2, completed: 0},
        {month: '6月', created: 4, completed: 3},
        {month: '7月', created: 1, completed: 1},
        {month: '8月', created: 0, completed: 0},
        {month: '9月', created: 5, completed: 2},
        {month: '10月', created: 3, completed: 5},
    ]);
    const d = dom.window.document;
    const summary = d.querySelector('details > summary');
    assert.ok(summary, 'exact monthly data must have a native keyboard disclosure');
    summary.focus();
    assert.equal(d.activeElement, summary);
    assert.match(summary.textContent, /数据/);
    const table = summary.parentElement.querySelector('table');
    assert.match(table.caption.textContent, /近.*6.*月.*项目.*数量/);
    assert.deepEqual([...table.querySelectorAll('thead th')].map(th => [th.scope, th.textContent]), [
        ['col', '月份'], ['col', '新增（项）'], ['col', '完成（项）'],
    ]);
    assert.deepEqual([...table.querySelectorAll('tbody tr')].map(tr => [...tr.children].map(cell => cell.textContent)), [
        ['5月', '2', '0'], ['6月', '4', '3'], ['7月', '1', '1'],
        ['8月', '0', '0'], ['9月', '5', '2'], ['10月', '3', '5'],
    ]);
    assert.ok([...table.querySelectorAll('tbody th')].every(th => th.scope === 'row'));
    assert.deepEqual([...d.querySelectorAll('.cb-trend-scale')].map(tick => tick.textContent), ['0', '3', '5']);
    dom.window.close();
});

test('trend shares normalized counts between its geometry, tooltip and table, including zeros and equal values', () => {
    const dom = trend([
        {month: '2026年十月非常长的月份标签<img src=x>', created: '4', completed: 4},
        {month: '零值', created: 0, completed: 0},
        {month: '异常值', created: -2, completed: 'invalid'},
    ]);
    const d = dom.window.document;
    const dataRows = [...d.querySelectorAll('tbody tr')];
    assert.equal(dataRows.length, 3, 'all source rows must reach the accessible data');
    assert.equal(dataRows[0].children[0].textContent, '2026年十月非常长的月份标签<img src=x>');
    assert.deepEqual(dataRows.map(row => [...row.querySelectorAll('td')].map(cell => cell.textContent)), [
        ['4', '4'], ['0', '0'], ['0', '0'],
    ]);
    assert.equal(d.querySelector('img'), null);
    const created = [...d.querySelectorAll('circle.cb-trend-created')];
    const completed = [...d.querySelectorAll('circle.cb-trend-completed')];
    assert.deepEqual(created.map(point => point.getAttribute('cy')), ['54', '184', '184']);
    assert.equal(created[0].getAttribute('cy'), completed[0].getAttribute('cy'));
    assert.match(created[2].textContent, /新增 0/);
    assert.ok([...d.querySelectorAll('.cb-trend-month')].every(label => [...label.firstChild.textContent].length <= 6), 'long visual labels must not overlap neighboring months');
    assert.doesNotMatch(d.querySelector('svg').outerHTML, /NaN|Infinity/);
    dom.window.close();
});

test('all-zero trend retains a meaningful baseline and exact zero counts', () => {
    const dom = trend([{month: '9月', created: 0, completed: 0}, {month: '10月', created: 0, completed: 0}]);
    const d = dom.window.document;
    assert.deepEqual([...d.querySelectorAll('.cb-trend-scale')].map(tick => tick.textContent), ['0', '1']);
    assert.ok([...d.querySelectorAll('circle')].every(point => point.getAttribute('cy') === '184'));
    assert.deepEqual([...d.querySelectorAll('tbody td')].map(cell => cell.textContent), ['0', '0', '0', '0']);
    dom.window.close();
});

test('trend monthly data opens and closes by keyboard and wraps long months in both themes at desktop and phone widths', async () => {
    const edge = process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    try {
        for (const theme of ['default', 'dark']) {
            for (const width of [1366, 390]) {
                const page = await browser.newPage({viewport: {width, height: 844}});
                await page.route('**/*', route => route.abort());
                const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'style.css'), 'utf8').replace(/^\uFEFF/, '');
                await page.setContent(`<!doctype html><html data-theme="${theme}"><head><style>${css}</style></head><body><main style="max-width:760px;margin:auto"></main></body></html>`);
                await page.addScriptTag({content: chartSource});
                await page.evaluate(() => {
                    document.querySelector('main').innerHTML = renderTrendChart([
                        {month: '2026年十月份LongMonthWithoutAnySpacesForWrapping', created: 4, completed: 4},
                        {month: '6月', created: 0, completed: 0}, {month: '7月', created: 1, completed: 0},
                        {month: '8月', created: 0, completed: 2}, {month: '9月', created: 1, completed: 1},
                        {month: '10月', created: 3, completed: 4},
                    ]);
                });
                await page.keyboard.press('Tab');
                const summary = page.locator('summary');
                assert.equal(await summary.evaluate(node => node === document.activeElement), true);
                await page.keyboard.press('Enter');
                const table = page.getByRole('table', {name: '近 6 个月项目新增与完成数量'});
                assert.equal(await table.isVisible(), true);
                assert.equal(await table.locator('tbody tr').count(), 6);
                const geometry = await page.evaluate(() => {
                    const cell = document.querySelector('tbody th');
                    const box = document.querySelector('table').getBoundingClientRect();
                    return {pageWidth: document.documentElement.scrollWidth, tableRight: box.right,
                        cellOverflows: cell.scrollWidth > cell.clientWidth + 1};
                });
                assert.ok(geometry.pageWidth <= width, `${theme}/${width}: expanded data must stay within the page`);
                assert.ok(geometry.tableRight <= width, `${theme}/${width}: every numeric column must remain visible`);
                assert.equal(geometry.cellOverflows, false, `${theme}/${width}: full month labels must wrap`);
                await page.keyboard.press('Space');
                assert.equal(await table.isVisible(), false);
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }
});

function refundHarness() {
    const dom = new JSDOM('<div id="modalOverlay"></div><section id="modal"><h2 id="modalTitle"></h2><div id="modalBody"></div><footer id="modalFooter"></footer></section>');
    const calls = [];
    let rejectSave;
    const pendingSave = new Promise((resolve, reject) => { rejectSave = reject; });
    const context = vm.createContext({
        document: dom.window.document,
        currentProject: {id: 9, registrations: [{id: 1, company_name: '测试供应商', lot_id: null}], lots: [], tender_guarantee: {
            revision: 2, data: {confirmed: true, records: [{registration_id: 1, deposit_status: 'paid', deposit_amount: '100', refunded_amount: '30', handling: 'hold'}], rules: []},
        }},
        api: async (method, url, body) => { calls.push({method, url, body}); return pendingSave; },
        escHtml: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'),
        toast() {}, activateDialogFocus() {}, releaseDialogFocus() {}, refreshProject: async () => {},
    });
    const core = fs.readFileSync(path.join(frontend, '01-core.js'), 'utf8');
    const functions = acorn.parse(core, {ecmaVersion: 'latest'}).body.filter(node => node.type === 'FunctionDeclaration'
        && ['resetModalState', 'showModal', 'closeModal'].includes(node.id.name));
    vm.runInContext(functions.map(node => core.slice(node.start, node.end)).join('\n'), context);
    vm.runInContext(fs.readFileSync(path.join(frontend, '18-tender-guarantee.js'), 'utf8'), context);
    return {dom, context, calls, rejectSave};
}

test('refund confirmation communicates recording a completed full refund and retains that action after save failure', async () => {
    const state = refundHarness();
    const {context, dom, calls} = state;
    await context.showGuaranteeRefundForm(1);
    const d = dom.window.document;
    const button = d.getElementById('modalSaveBtn');
    assert.equal(button.textContent, '确认已全额退还');
    assert.match(d.getElementById('modalBody').textContent, /仅在实际退款完成后确认/);
    assert.match(d.getElementById('modalBody').textContent, /本次全额退还¥70\.00/);
    assert.equal(calls.length, 0, 'opening the form must not record a refund');
    const saving = button.onclick();
    assert.equal(button.textContent, '登记中…');
    assert.equal(button.disabled, true);
    assert.equal(button.getAttribute('aria-busy'), 'true');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].method, 'PUT');
    assert.equal(calls[0].body.data.records[0].refunded_amount, '100.00');
    assert.equal(calls[0].body.data.records[0].deposit_amount, '100');
    assert.equal(calls[0].body.data.records[0].handling, 'hold');
    state.rejectSave(new Error('测试保存失败'));
    await saving;
    assert.equal(button.textContent, '确认已全额退还');
    assert.equal(button.disabled, false);
    assert.equal(button.hasAttribute('aria-busy'), false);
    context.showModal('普通资料', '<p>资料</p>', async () => false);
    assert.equal(d.getElementById('modalSaveBtn').textContent, '保存');
    dom.window.close();
});
test('activity loading preserves the open trend table and its keyboard focus', async () => {
    const dom=new JSDOM('<div id="chartBoardContent"></div>',{runScripts:'outside-only'});
    const w=dom.window;let complete;
    const context=vm.createContext({document:w.document,allProjects:[],URLSearchParams,api:()=>new Promise(resolve=>complete=resolve)});
    try {
        vm.runInContext(chartSource,context);
        context.renderChartBoard(context.buildChartBoardData([]));
        const details=w.document.querySelector('.cb-trend-data'),summary=details.querySelector('summary');
        details.open=true;summary.focus();
        const pending=context.loadChartActivity({reset:true});
        assert.equal(w.document.querySelector('.cb-trend-data'),details,'starting an unrelated request must retain the trend nodes');
        complete({items:[],next_cursor:null});await pending;
        assert.equal(details.open,true);assert.equal(w.document.activeElement,summary);
        assert.equal(w.document.querySelector('.cb-trend-data'),details);
    } finally {w.close();}
});
