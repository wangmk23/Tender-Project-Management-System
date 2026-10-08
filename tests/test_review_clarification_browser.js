'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const {assemble} = require('../tools/build_frontend');
const root = path.resolve(__dirname, '..');

test('clarification deadline toggle responds once to label, slider, and keyboard activation', async () => {
    const edge = process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    try {
        const page = await browser.newPage({viewport: {width: 1366, height: 768}, reducedMotion: 'reduce'});
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        const html = fs.readFileSync(path.join(root, 'src/templates/workspace.html'), 'utf8')
            .replace(/{{ current_user_id \| tojson }}/g, '1')
            .replace(/{{ current_username \| tojson }}/g, '"isolated-review"')
            .replace(/{{ current_is_admin \| tojson }}/g, 'true')
            .replace(/{{ csrf_token \| tojson }}/g, '"isolated-review"');
        const bundle = assemble(path.join(root, 'source/frontend'), JSON.parse(fs.readFileSync(path.join(root, 'source/frontend/manifest.json'), 'utf8')));
        await page.route('**/*', async route => {
            const url = new URL(route.request().url());
            if (url.pathname === '/static/app.js') return route.fulfill({contentType: 'application/javascript', body: bundle});
            if (url.pathname.startsWith('/static/')) {
                const file = path.join(root, 'src', url.pathname);
                return fs.existsSync(file) ? route.fulfill({path: file}) : route.fulfill({status: 404, body: ''});
            }
            if (!url.pathname.startsWith('/api/')) return route.fulfill({contentType: 'text/html', body: html});
            const data = url.pathname === '/api/projects' ? [] : url.pathname === '/api/system-info' ? {license: {}, is_admin: true} : url.pathname === '/api/settings' ? {categories: [], units: [], groups: [], reminder_recipient_groups: []} : {};
            return route.fulfill({json: data});
        });
        await page.goto('http://127.0.0.1:59997/', {waitUntil: 'networkidle'});
        await page.evaluate(() => {
            currentProject = {id: 1, name: '隔离测试项目', method: '公开招标', lots: [], stages: [], announcement_clarifications: []};
            showClarificationForm();
        });
        const checkbox = page.locator('#clarAffects');
        const fields = page.locator('#clarDeadlineFields');
        const label = page.locator('#modal label.toggle-row .toggle-label');
        const slider = page.locator('#modal label.toggle-row .toggle-slider');
        assert.equal(await checkbox.isChecked(), false);
        assert.equal(await fields.isVisible(), false);
        for (const target of [label, slider]) {
            await target.click();
            assert.equal(await checkbox.isChecked(), true, 'one visible click must enable the deadline adjustment');
            assert.equal(await fields.isVisible(), true);
            await target.click();
            assert.equal(await checkbox.isChecked(), false);
            assert.equal(await fields.isVisible(), false);
        }
        await checkbox.focus();
        await page.keyboard.press('Space');
        assert.equal(await checkbox.isChecked(), true, 'keyboard activation must enable the deadline adjustment');
        assert.equal(await fields.isVisible(), true);
        await page.keyboard.press('Space');
        assert.equal(await checkbox.isChecked(), false);
        assert.equal(await fields.isVisible(), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#modal.open').count(), 0);
        assert.deepEqual(errors, []);
    } finally {
        await browser.close();
    }
});
