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
    .replace(/{{ current_user_id \| tojson }}/g, '1').replace(/{{ current_username \| tojson }}/g, '"隔离键盘验证"')
    .replace(/{{ current_is_admin \| tojson }}/g, 'false').replace(/{{ csrf_token \| tojson }}/g, '"synthetic"');

function calendarData(year, month) {
    return {weekday_names: ['日', '一', '二', '三', '四', '五', '六'], cells: Array.from({length: new Date(year, month, 0).getDate()}, (_, index) => ({
        day: index + 1, date_str: `${year}-${String(month).padStart(2, '0')}-${String(index + 1).padStart(2, '0')}`, events: [],
    }))};
}

test('full application calendar supports named controls, date activation, week boundaries, month crossing and stable focus', async () => {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    const errors = [];
    try {
        const page = await browser.newPage({viewport: {width: 1366, height: 768}});
        page.on('pageerror', error => errors.push(String(error)));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            assert.equal(url.hostname, '127.0.0.1', 'all application requests remain synthetic and local');
            assert.equal(route.request().method(), 'GET', 'keyboard verification never writes application data');
            if (url.pathname === '/static/app.js') return route.fulfill({contentType: 'text/javascript', body: bundle});
            if (url.pathname === '/static/style.css') return route.fulfill({contentType: 'text/css', body: styles});
            if (url.pathname.startsWith('/static/') && fs.existsSync(path.join(root, 'src/project_manager', url.pathname))) return route.fulfill({path: path.join(root, 'src/project_manager', url.pathname)});
            if (url.pathname.startsWith('/static/')) return route.fulfill({body: ''});
            if (url.pathname === '/api/calendar') return route.fulfill({json: calendarData(Number(url.searchParams.get('year')), Number(url.searchParams.get('month')))});
            if (url.pathname === '/api/projects') return route.fulfill({json: []});
            if (url.pathname === '/api/stats') return route.fulfill({json: {total: 0}});
            if (url.pathname === '/api/system-info') return route.fulfill({json: {is_admin: false, is_desktop: false, license: {}}});
            if (url.pathname.startsWith('/api/')) return route.fulfill({json: {methods: []}});
            return route.fulfill({contentType: 'text/html', body: html});
        });
        await page.goto('http://127.0.0.1:59997/', {waitUntil: 'networkidle'});
        await page.evaluate(async () => {switchView('calendar', {load: false}); calendarYear = 2026; calendarMonth = 10; calendarSelectedDate = '2026-10-21'; await loadCalendar({force: true});});
        await page.getByRole('button', {name: '上个月', exact: true}).waitFor();
        await page.getByRole('button', {name: '下个月', exact: true}).waitFor();
        assert.equal(await page.locator('.calendar-cell[data-calendar-date][tabindex="0"]').count(), 1);
        assert.equal(await page.locator('.calendar-cell.empty:is(button,[tabindex])').count(), 0, 'placeholders are inert');
        const focused = () => page.evaluate(() => document.activeElement.dataset.calendarDate);
        const selected = () => page.locator('.calendar-cell[aria-pressed="true"]').getAttribute('data-calendar-date');
        await page.locator('[data-calendar-date="2026-10-21"]').focus();
        await page.keyboard.press('ArrowRight');
        assert.equal(await focused(), '2026-10-22');
        assert.equal(await selected(), '2026-10-22');
        await page.keyboard.press('ArrowUp');
        assert.equal(await focused(), '2026-10-15');
        await page.keyboard.press('Home');
        assert.equal(await focused(), '2026-10-11', 'Sunday is the initial week start');
        await page.keyboard.press('End');
        assert.equal(await focused(), '2026-10-17');
        await page.evaluate(() => updateUiPreference('weekStart', 1));
        await page.locator('[data-calendar-date="2026-10-15"]').focus();
        await page.keyboard.press('Home');
        assert.equal(await focused(), '2026-10-12', 'Monday preference changes the week boundary');
        await page.keyboard.press('End');
        assert.equal(await focused(), '2026-10-18');
        await page.locator('[data-calendar-date="2026-10-01"]').focus();
        await page.keyboard.press('Home');
        assert.equal(await focused(), '2026-10-01', 'Home skips unavailable cells');
        await page.locator('[data-calendar-date="2026-10-31"]').focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.activeElement.dataset.calendarDate === '2026-11-01');
        assert.equal(await selected(), '2026-11-01');
        await page.keyboard.press('ArrowLeft');
        await page.waitForFunction(() => document.activeElement.dataset.calendarDate === '2026-10-31');
        await page.keyboard.press('PageDown');
        await page.waitForFunction(() => document.activeElement.dataset.calendarDate === '2026-11-30');
        await page.keyboard.press('PageUp');
        await page.waitForFunction(() => document.activeElement.dataset.calendarDate === '2026-10-30');
        await page.evaluate(() => renderCalendar({weekday_names: ['一','二','三','四','五','六','日'], cells: Array.from({length:31}, (_, i) => ({day:i+1,date_str:`2026-10-${String(i+1).padStart(2,'0')}`,events:[]}))}, 2026, 10));
        assert.equal(await focused(), '2026-10-30', 'background refresh preserves the current date focus');
        await page.locator('[data-calendar-date="2026-10-21"]').focus();
        await page.keyboard.press('Enter');
        assert.equal(await selected(), '2026-10-21');
        await page.locator('[data-calendar-date="2026-10-22"]').focus();
        await page.keyboard.press('Space');
        assert.equal(await selected(), '2026-10-22');
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(() => document.activeElement.matches('.calendar-cell')), false, 'Tab leaves the date group after its one selected-day stop');
        assert.match(await page.locator('[data-calendar-date="2026-10-22"]').getAttribute('aria-label'), /2026年10月22日/);
        await page.getByRole('button', {name: '下个月', exact: true}).focus();
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.getElementById('calendarTitle').textContent.includes('11月'));
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '下个月', 'month toolbar retains focus');
        await page.evaluate(async () => {calendarYear=2028;calendarMonth=1;calendarSelectedDate='2028-01-31';await loadCalendar({force:true});});
        await page.locator('[data-calendar-date="2028-01-31"]').focus();
        await page.keyboard.press('PageDown');
        await page.waitForFunction(() => document.activeElement.dataset.calendarDate === '2028-02-29');
        await page.keyboard.press('Shift+PageUp');
        await page.waitForFunction(() => document.activeElement.dataset.calendarDate === '2027-02-28');
        await page.evaluate(async () => {calendarYear=2026;calendarMonth=8;calendarSelectedDate='2026-08-24';await loadCalendar({force:true});});
        await page.locator('[data-calendar-date="2026-08-24"]').focus();
        await page.keyboard.press('ArrowDown');
        assert.equal(await focused(), '2026-08-31');
        assert.equal(await page.evaluate(() => {const r=document.activeElement.getBoundingClientRect();return r.top>=-1&&r.bottom<=innerHeight+1;}), true, 'six-row months keep keyboard focus in the visible viewport');
        await page.evaluate(async () => {calendarYear=2026;calendarMonth=12;calendarSelectedDate='2026-12-31';await loadCalendar({force:true});});
        await page.locator('[data-calendar-date="2026-12-31"]').focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.activeElement.dataset.calendarDate === '2027-01-01');
        // An asynchronous month load must not steal focus from someone who already left the date grid.
        let releaseMonth;
        await page.evaluate(() => invalidateViewCache('calendar:2027-02'));
        await page.route('**/api/calendar?year=2027&month=2', async route => {
            await new Promise(resolve => {releaseMonth=resolve;});
            await route.fulfill({json:calendarData(2027,2)});
        });
        await page.locator('[data-calendar-date="2027-01-31"]').focus();
        await page.keyboard.press('ArrowRight');
        await page.waitForFunction(() => document.getElementById('calendarTitle').textContent.includes('2月'));
        await page.getByRole('button', {name:'下个月',exact:true}).focus();
        assert.equal(typeof releaseMonth, 'function'); releaseMonth();
        await page.locator('[data-calendar-date="2027-02-01"]').waitFor();
        assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), '下个月', 'late response respects focus outside the grid');
        const output=process.env.PM_UI_EXPERIENCE_OUTPUT;
        if(output)fs.mkdirSync(output,{recursive:true});
        for(const theme of ['default','dark','blue','green'])for(const width of [1366,390]){
            await page.setViewportSize({width,height:width===390?844:768});
            await page.evaluate(theme=>{updateUiPreference('theme',theme);updateUiPreference('motion','off');},theme);
            await page.locator('.calendar-cell[tabindex="0"]').focus();
            assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${theme}/${width} calendar stays within the viewport`);
            assert.equal(await page.locator('.calendar-cell[tabindex="0"]').count(),1);
            if(output)await page.screenshot({path:path.join(output,`calendar-${theme}-${width}.png`)});
        }
        assert.deepEqual(errors, []);
    } finally { await browser.close(); }
});
