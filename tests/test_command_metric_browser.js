'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const acorn = require('acorn');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'source/frontend/01-core.js'), 'utf8');
const dialogNames = ['topManagedDialog', 'dialogControls', 'focusDialogStart', 'handleDialogFocus',
    'activateDialogFocus', 'releaseDialogFocus', 'resetModalState', 'showModal', 'closeModal'];
const dialogs = acorn.parse(core, {ecmaVersion: 'latest'}).body
    .filter(node => node.type === 'FunctionDeclaration' && dialogNames.includes(node.id.name))
    .map(node => core.slice(node.start, node.end)).join('\n');

test('metric lists retain usable controls and contained scrolling in light/dark desktop/mobile', async () => {
    const edge = process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    const output = process.env.PM_METRIC_QA_DIR || path.join(os.tmpdir(), 'pm-command-metric-list-qa');
    fs.mkdirSync(output, {recursive: true});
    try {
        for (const theme of ['default', 'dark']) {
            for (const viewport of [{width: 1366, height: 900}, {width: 390, height: 844}]) {
                const page = await browser.newPage({viewport, reducedMotion: 'reduce'});
                const errors = [];
                page.on('pageerror', error => errors.push(error.message));
                await page.route('**/*', route => route.abort());
                await page.setContent(`<!doctype html><style>${fs.readFileSync(path.join(root, 'src/static/style.css'), 'utf8').replace(/^\uFEFF/, '')}</style>
                    <div class="view active" id="dashboardView"><div id="dashboardContent" style="height:100vh;overflow:auto"></div></div>
                    <div id="modalOverlay" class="modal-overlay"></div><div id="modal" class="modal">
                    <header class="modal-header"><h3 id="modalTitle"></h3><button id="closeDialog" class="btn-icon" aria-label="关闭窗口"><span data-ui-icon="✕"></span></button></header>
                    <div id="modalBody" class="modal-body"></div><div id="modalFooter" class="modal-footer"></div></div>`);
                await page.addScriptTag({content: 'const dialogFocusStack=[];let dialogFocusListenersReady=false;\n' + dialogs});
                for (const name of ['00-icons.js', '22-procurement-methods.js', '09-command-center.js', '15-select-popup.js']) {
                    await page.addScriptTag({content: fs.readFileSync(path.join(root, 'source/frontend', name), 'utf8')});
                }
                await page.evaluate(themeValue => {
                    document.documentElement.dataset.theme = themeValue;
                    window.escHtml = value => String(value ?? '').replace(/[&<>"']/g, c =>
                        ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
                    window.projectColor = () => '#2563eb';
                    window.selectProject = id => { window.selected = id; };
                    window.switchView = () => { throw new Error('unexpected navigation'); };
                    window.allProjects = Array.from({length: 36}, (_, index) => ({id: index + 1,
                        number: `模拟-2026-${String(index + 1).padStart(3, '0')}`,
                        name: index === 0 ? '模拟区域卫生服务中心信息系统设备与维护服务采购' : `模拟项目 ${index + 1}`,
                        purchaser: index % 2 ? '模拟学校' : '模拟医院', method: index % 2 ? '竞争性磋商' : '公开招标',
                        progress: 25, current_stage_name: '文件审核', stages: [
                            {key: 'review', name: '文件审核', planned_at: '2026-10-11T09:30'},
                            {key: 'opening', name: '开标', modules: ['bid_opening'], planned_at: '2026-10-12T11:00'},
                        ]}));
                    document.getElementById('dashboardContent').innerHTML = renderCommandCenterDashboard(
                        commandCenterModel(allProjects, null, new Date('2026-10-12T09:00:00')));
                    document.getElementById('closeDialog').onclick = closeModal;
                    installCommandActionDelegation(document);
                }, theme);
                const card = page.locator('.command-metric').first();
                await card.click();
                await page.locator('.command-metric-list').waitFor({state: 'visible'});
                assert.equal(await page.locator('.command-metric-result').count(), 36);
                const layout = await page.evaluate(() => {
                    const modal = document.getElementById('modal');
                    const results = document.querySelector('[data-metric-results]');
                    const bounds = element => {
                        const box = element.getBoundingClientRect();
                        return {left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width};
                    };
                    return {modal: bounds(modal), query: bounds(document.querySelector('[data-metric-query]')),
                        method: bounds(document.querySelector('[data-metric-method]')),
                        close: bounds(document.querySelector('[data-metric-close]')),
                        overflowX: results.scrollWidth > results.clientWidth + 1,
                        scrollable: results.scrollHeight > results.clientHeight,
                        background: getComputedStyle(modal).backgroundColor,
                        textToken: getComputedStyle(document.documentElement).getPropertyValue('--text')};
                });
                assert.ok(layout.modal.width <= 960 && layout.modal.left >= 0 && layout.modal.right <= viewport.width);
                for (const name of ['query', 'method', 'close']) {
                    assert.ok(layout[name].left >= layout.modal.left && layout[name].right <= layout.modal.right,
                        `${name} stays within ${theme} ${viewport.width}px dialog`);
                    assert.ok(layout[name].top >= layout.modal.top && layout[name].bottom <= layout.modal.bottom);
                }
                assert.equal(layout.overflowX, false);
                assert.equal(layout.scrollable, true);
                assert.ok(layout.textToken.trim(), 'isolated page loads the full theme tokens');
                if (theme === 'dark') assert.notEqual(layout.background, 'rgb(255, 255, 255)');
                await page.locator('[data-metric-method]').click();
                assert.equal(await page.locator('.themed-select-popup').isVisible(), true);
                await page.locator('.themed-select-option').filter({hasText: '竞争性磋商'}).click();
                assert.equal(await page.locator('.command-metric-result').count(), 18);
                await page.locator('[data-metric-reset]').click();
                await page.locator('[data-metric-query]').fill('不存在的模拟项目');
                assert.equal(await page.locator('.command-metric-result').count(), 0);
                assert.match(await page.locator('[data-metric-results]').textContent(), /没有符合条件/);
                await page.locator('[data-metric-reset]').click();
                await page.screenshot({path: path.join(output, `模拟指标列表-${theme}-${viewport.width}.png`)});
                await page.keyboard.press('Escape');
                assert.equal(await page.locator('#modal').isVisible(), false);
                assert.equal(await card.evaluate(element => document.activeElement === element), true);
                await page.locator('.command-metric').nth(2).click();
                assert.equal(await page.locator('.command-metric-result').count(), 36);
                assert.match(await page.locator('.command-metric-result').first().textContent(), /2026-10-12 11:00/);
                await page.locator('[data-metric-close]').click();
                assert.deepEqual(errors, []);
                await page.close();
            }
        }
    } finally {
        await browser.close();
    }
    console.log(`Synthetic metric-list screenshots: ${output}`);
});
