'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {assemble, composeStyles} = require('../tools/build_frontend');
const root = path.join(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'source/frontend/manifest.json'), 'utf8'));
const bundle = assemble(path.join(root, 'source/frontend'), manifest).toString('utf8');
const styles = composeStyles(fs.readFileSync(path.join(root, 'src/static/style.css'), 'utf8'), manifest.styles.map(item => fs.readFileSync(path.join(root, item.file), 'utf8')));
const html = fs.readFileSync(path.join(root, 'src/templates/workspace.html'), 'utf8')
    .replace(/{{ current_user_id \| tojson }}/g, '1').replace(/{{ current_username \| tojson }}/g, '"隔离布局验证"')
    .replace(/{{ current_is_admin \| tojson }}/g, 'false').replace(/{{ csrf_token \| tojson }}/g, '"synthetic"');
const longName = '城区中小学智慧教室设备更新、校园网络改造及三年运行维护服务采购项目（含多校区分期实施与配套培训）';
const planned = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10) + 'T09:30:00';
const projects = Array.from({length: 24}, (_, i) => ({
    id: i + 1, number: `测试-2026-${String(i + 1).padStart(3, '0')}`, name: i === 0 ? longName : `校园设施与公共服务能力提升采购项目 ${i + 1}`,
    year: 2026, method: '公开招标', purchaser: '示例教育服务中心', progress: 25, prepare_owner: '陈安宁', current_stage_key: 'bid_opening', current_stage_name: '开标',
    stages: [{key: 'plan_received', name: '计划接收', completed: true}, {key: 'bid_opening', name: '开标', completed: false, planned_at: planned, notes: '仅用于隔离布局验证'}],
    lots: [], suppliers: [], attachments: [], activity: [],
}));

function contrast(foreground, background) {
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(channel => {
        const s = channel / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4;
    }).reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    const a = luminance(foreground), b = luminance(background);
    return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
}

test('synthetic full application keeps all navigation discoverable, task context readable and mobile work above the fold in four themes', async () => {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    const output = process.env.PM_UI_EXPERIENCE_OUTPUT;
    if (output) fs.mkdirSync(output, {recursive: true});
    const results = [];
    try {
        for (const theme of ['default', 'dark', 'blue', 'green']) for (const width of [1366, 390]) {
            const page = await browser.newPage({viewport: {width, height: width === 390 ? 844 : 768}, reducedMotion: 'reduce'});
            const errors = [];
            page.on('pageerror', error => errors.push(String(error)));
            await page.route('**/*', route => {
                const url = new URL(route.request().url());
                assert.equal(url.hostname, '127.0.0.1');
                assert.equal(route.request().method(), 'GET');
                const pathname = url.pathname;
                if (pathname === '/static/app.js') return route.fulfill({contentType: 'text/javascript', body: bundle});
                if (pathname === '/static/style.css') return route.fulfill({contentType: 'text/css', body: styles});
                if (pathname.startsWith('/static/') && fs.existsSync(path.join(root, 'src/project_manager', pathname))) return route.fulfill({path: path.join(root, 'src/project_manager', pathname)});
                if (pathname.startsWith('/static/')) return route.fulfill({body: ''});
                if (pathname === '/api/projects') return route.fulfill({json: projects});
                if (/^\/api\/projects\/\d+$/.test(pathname)) return route.fulfill({json: projects[Number(pathname.split('/').pop()) - 1]});
                if (pathname === '/api/stats') return route.fulfill({json: {total: projects.length, in_progress: projects.length, completed: 0}});
                if (pathname === '/api/system-info') return route.fulfill({json: {is_admin: false, is_desktop: false, license: {}}});
                if (pathname.startsWith('/api/')) return route.fulfill({json: {methods: []}});
                return route.fulfill({contentType: 'text/html', body: html});
            });
            await page.goto('http://127.0.0.1:59996/', {waitUntil: 'networkidle'});
            await page.evaluate(theme => {updateUiPreference('theme', theme); updateUiPreference('motion', 'off');}, theme);
            await page.locator('.command-action-row').first().waitFor();
            const metrics = await page.evaluate(() => {
                const task = document.querySelector('.command-action-row');
                const panel = task.closest('.command-panel');
                const meta = task.querySelector('small');
                const nav = document.querySelector('.sidebar-nav');
                const list = document.getElementById('projectList');
                const firstName = list.querySelector('.project-name');
                const rect = element => {const r = element.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};};
                return {
                    firstTask: rect(task), nav: rect(nav), navigationCount: nav.querySelectorAll('.nav-item').length,
                    navClipped: nav.scrollHeight > nav.clientHeight + 1,
                    destinations: [...nav.querySelectorAll('.nav-item')].map(rect),
                    projectListHeight: list.clientHeight, projectListScrolls: list.scrollHeight > list.clientHeight,
                    projectNameHeight: firstName.clientHeight, projectNameLines: getComputedStyle(firstName).webkitLineClamp,
                    infoFonts: [...task.querySelectorAll('small,.command-action-time')].map(el => parseFloat(getComputedStyle(el).fontSize)),
                    infoColor: getComputedStyle(meta).color, panelColor: getComputedStyle(panel).backgroundColor,
                    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
                    metricCount: document.querySelectorAll('.command-metric').length,
                    actionCount: document.querySelectorAll('.command-page-actions button').length,
                    taskOverflow: task.scrollWidth > task.clientWidth + 1,
                };
            });
            const label = `${theme}/${width}`;
            assert.equal(metrics.navigationCount, 5, label);
            assert.equal(metrics.navClipped, false, label + ' all destinations visible without nav scrolling');
            assert.ok(metrics.destinations.every(item => item.y >= metrics.nav.y && item.bottom <= metrics.nav.bottom + 1), label);
            assert.ok(metrics.projectListHeight >= 80 && metrics.projectListScrolls, label + ' project list scrolls independently');
            assert.ok(metrics.infoFonts.every(size => size >= 12), label + ' readable task context');
            assert.ok(contrast(metrics.infoColor, metrics.panelColor) >= 4.5, label + ' context contrast');
            assert.equal(metrics.taskOverflow, false, label);
            assert.equal(metrics.pageOverflow, false, label);
            assert.equal(metrics.metricCount, 5, label + ' preserves five metrics');
            assert.equal(metrics.actionCount, 4, label + ' preserves four actions');
            if (width === 390) assert.ok(metrics.firstTask.y < 650, label + ` first todo y=${metrics.firstTask.y}`);
            if (output) await page.screenshot({path: path.join(output, `overview-${theme}-${width}.png`)});
            if (width === 390) await page.evaluate(() => toggleSidebar());
            if (output) await page.screenshot({path: path.join(output, `navigation-${theme}-${width}.png`)});
            await page.evaluate(() => closeSidebar());
            await page.evaluate(() => {
                currentProject = allProjects[0]; switchView('project', {load: false}); renderProjectDetail(currentProject); switchProjectTab('tasks');
                // Integration checks use the real production wrapper emitted by renderTasks.
            });
            const table = page.getByRole('region', {name: '项目阶段任务表'});
            await table.focus();
            const tableMetrics = await table.evaluate(element => ({width:element.clientWidth,scroll:element.scrollWidth,overflow:document.documentElement.scrollWidth > innerWidth + 1,outline:getComputedStyle(element).outlineStyle,hintVisible:getComputedStyle(document.getElementById('taskTableScrollHint')).display !== 'none'}));
            assert.equal(tableMetrics.overflow, false, label + ' task page stays within viewport');
            assert.equal(tableMetrics.outline, 'solid', label + ' scroll region has visible focus');
            assert.equal(tableMetrics.hintVisible, width === 390, label);
            if (width === 390) {
                assert.ok(tableMetrics.scroll > tableMetrics.width, label + ' table can scroll locally');
                await page.keyboard.press('ArrowRight');
                await page.waitForFunction(() => document.querySelector('.task-table-scroll').scrollLeft > 0);
            }
            if (output) await page.screenshot({path: path.join(output, `tasks-${theme}-${width}.png`)});
            await page.evaluate(() => updateUiPreference('size', 'large'));
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, label + ' large text preserves viewport');
            await page.evaluate(() => switchView('dashboard', {load:false}));
            assert.equal(await page.locator('.command-action-row').first().evaluate(element => element.scrollWidth > element.clientWidth + 1), false, label + ' large todo text wraps within its row');
            assert.ok(await page.locator('.command-action-copy small').first().evaluate(element => parseFloat(getComputedStyle(element).fontSize)) >= 13, label + ' task context follows large text preference');
            assert.deepEqual(errors, [], label);
            results.push({theme,width,...metrics,contrast:contrast(metrics.infoColor,metrics.panelColor),table:tableMetrics});
            await page.close();
        }
        if (output) fs.writeFileSync(path.join(output, 'layout-metrics.json'), JSON.stringify(results, null, 2));
        console.log(JSON.stringify(results.map(({theme,width,firstTask,projectListHeight,contrast}) => ({theme,width,firstTaskY:firstTask.y,projectListHeight,contrast}))));
    } finally { await browser.close(); }
});
