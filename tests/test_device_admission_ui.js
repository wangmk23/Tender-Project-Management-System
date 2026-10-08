'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'source', 'frontend', '13-device-admission.js');
const adminSource = fs.readFileSync(path.join(root, 'source', 'frontend', '06-admin.js'), 'utf8');

function escHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);
}

function loadModule({isAdmin = true, apiImpl} = {}) {
    const calls = [];
    const intervals = [];
    const elements = new Map();
    const sandbox = {
        currentIsAdmin: isAdmin,
        activeSettingsCategory: 'device-access',
        escHtml,
        toast() {},
        showModal() {},
        closeModal() {},
        confirm: () => true,
        confirmDialog: async () => true,
        prompt: () => '',
        setInterval(fn, delay) { intervals.push({fn, delay}); return intervals.length; },
        clearInterval() {},
        setTimeout(fn) { fn(); return 1; },
        clearTimeout() {},
        document: {
            getElementById(id) { return elements.get(id) || null; },
        },
        FormData: class FormData {
            constructor() { this.values = []; }
            append(name, value) { this.values.push([name, value]); }
        },
        apiForm: async (url, body) => {
            calls.push({method: 'POST_FORM', url, body});
            if (apiImpl) return apiImpl('POST_FORM', url, body);
            return {};
        },
        api: async (method, url, body) => {
            calls.push({method, url, body});
            if (apiImpl) return apiImpl(method, url, body);
            if (url.endsWith('/summary')) return {pending: 2, approved_waiting: 1, devices: 3, enabled: 2};
            if (url.includes('/requests')) return {requests: []};
            if (url.endsWith('/devices')) return {devices: []};
            return {};
        },
    };
    vm.createContext(sandbox);
    const source = fs.readFileSync(modulePath, 'utf8');
    vm.runInContext(`${source}\nObject.assign(globalThis, {deviceAdmissionState, loadDeviceAdmissionSummary, loadDeviceAdmissionPanel, renderDeviceAdmissionPanel, startDeviceAdmissionSummaryPolling, stopDeviceAdmissionSummaryPolling, startDeviceAdmissionPanelPolling, stopDeviceAdmissionPanelPolling, setDeviceAdmissionEnabled, setApprovedDeviceEnabled, revokeApprovedDevice, generateDeviceMigrationCode, importDeviceMigrationCode});`, sandbox);
    sandbox.calls = calls;
    sandbox.intervals = intervals;
    sandbox.elements = elements;
    return sandbox;
}

test('device admission module exists', () => {
    assert.equal(fs.existsSync(modulePath), true);
});

test('ordinary users never load device admission data', async () => {
    const context = loadModule({isAdmin: false});
    await context.loadDeviceAdmissionSummary();
    await context.loadDeviceAdmissionPanel();
    context.startDeviceAdmissionSummaryPolling();
    context.startDeviceAdmissionPanelPolling();
    assert.equal(context.calls.length, 0);
    assert.equal(context.intervals.length, 0);
    assert.match(context.renderDeviceAdmissionPanel(), /只有管理员/);
});

test('admin summary and panel polling use bounded distinct intervals', async () => {
    const context = loadModule();
    context.startDeviceAdmissionSummaryPolling();
    context.startDeviceAdmissionPanelPolling();
    await Promise.resolve();
    assert.deepEqual(context.intervals.map(item => item.delay), [60000, 15000]);
    assert.ok(context.calls.some(call => call.url === '/api/device-access/summary'));
});

test('hostile request and device fields are escaped and actions use data attributes', () => {
    const context = loadModule();
    context.deviceAdmissionState.loading = false;
    context.deviceAdmissionState.requests = [{
        id: 7,
        applicant: '<img src=x onerror=alert(1)>',
        device_label: '电脑"><script>alert(2)</script>',
        reason: '<svg onload=alert(3)>',
        first_ip: '<b>ip</b>',
        status: 'pending',
        created_at: '2026-09-07T09:00:00+00:00',
    }];
    context.deviceAdmissionState.rejected = [];
    context.deviceAdmissionState.devices = [{
        id: 9, label: '<iframe>bad</iframe>', applicant: '张三', enabled: 1,
        last_ip: '192.168.1.3', expires_at: '2027-09-07T09:00:00+00:00',
    }];
    const html = context.renderDeviceAdmissionPanel();
    assert.doesNotMatch(html, /<img|<script|<svg|<iframe/);
    assert.match(html, /&lt;img/);
    assert.match(html, /data-device-action="approve" data-device-id="7"/);
    assert.doesNotMatch(html, /onclick=/);
    assert.match(html, /aria-live="polite"/);
});

test('device lifecycle actions call the matching APIs and recover busy state', async () => {
    const context = loadModule();
    await context.setApprovedDeviceEnabled(9, false);
    await context.setApprovedDeviceEnabled(9, true);
    await context.revokeApprovedDevice(9);
    assert.ok(context.calls.some(call => call.method === 'POST' && call.url.endsWith('/9/disable')));
    assert.ok(context.calls.some(call => call.method === 'POST' && call.url.endsWith('/9/enable')));
    assert.ok(context.calls.some(call => call.method === 'DELETE' && call.url.endsWith('/9')));
    assert.equal(context.deviceAdmissionState.busyIds.size, 0);
});

test('repeated device actions are coalesced while a write is pending', async () => {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const context = loadModule({
        apiImpl(method, url) {
            if (url.endsWith('/9/disable')) return pending;
            if (url.endsWith('/summary')) return {};
            if (url.includes('/requests')) return {requests: []};
            if (url.endsWith('/devices')) return {devices: []};
            return {};
        },
    });
    const first = context.setApprovedDeviceEnabled(9, false);
    const second = await context.setApprovedDeviceEnabled(9, false);
    assert.equal(second, false);
    assert.equal(context.calls.filter(call => call.url.endsWith('/9/disable')).length, 1);
    release({});
    assert.equal(await first, true);
});

test('responsive device cards do not introduce a horizontal scroller', () => {
    const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');
    assert.match(css, /\.device-access-panel\{display:grid/);
    assert.match(css, /@media\(max-width:900px\)[^{]*\{[\s\S]*?\.device-access-grid\{grid-template-columns:1fr\}/);
    const deviceRules = css.split('\n').filter(line => line.includes('device-access')).join('\n');
    assert.doesNotMatch(deviceRules, /overflow-x\s*:\s*auto/);
});

test('device admission occupies the full settings content width with prioritized sections', () => {
    const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');
    assert.match(adminSource, /id="deviceAdmissionPanelHost" class="settings-card-host-wide"/);
    assert.match(css, /\.device-access-pending\{grid-column:1\/-1\}/);
    assert.match(css, /\.device-access-panel\{[^}]*grid-template-columns:minmax\(0,1fr\)/);
});

test('admin can toggle admission and inspect observed browsers separately', async () => {
    const context = loadModule();
    context.deviceAdmissionState.loading = false;
    context.deviceAdmissionState.summary = {admission_enabled: false, observed: 1};
    context.deviceAdmissionState.observed = [{
        id: 3, client_label: 'Chrome · Android', last_ip: '192.168.1.20',
        last_username: 'user-1', first_seen_at: '2026-09-09T01:00:00Z',
        last_seen_at: '2026-09-09T01:02:00Z', activity_count: 2, online: true,
    }];
    const html = context.renderDeviceAdmissionPanel();
    assert.match(html, /设备准入开关/);
    assert.match(html, /关闭时无需申请/);
    assert.match(html, /已连接设备/);
    assert.match(html, /Chrome · Android/);
    assert.match(html, /user-1/);
    assert.match(html, /在线/);
    assert.match(html, /data-device-action="toggle-admission"/);

    await context.setDeviceAdmissionEnabled(true);
    assert.ok(context.calls.some(call => call.method === 'PATCH'
        && call.url === '/api/device-access/config' && call.body.enabled === true));
});

test('migration controls render only for admin and expose no code in HTML', () => {
    assert.doesNotMatch(loadModule().renderDeviceAdmissionPanel(), /授权迁移/);
    const context = loadModule();
    context.deviceAdmissionState.keyring = {ready: true, key_count: 2, legacy_count: 1};
    context.deviceAdmissionState.migrationCode = 'must-not-render';
    const html = context.renderDeviceAdmissionPanel();
    assert.match(html, /授权迁移/);
    assert.match(html, /生成设备授权迁移码/);
    assert.match(html, /导入设备授权迁移码/);
    assert.doesNotMatch(html, /must-not-render/);
    assert.doesNotMatch(loadModule({isAdmin: false}).renderDeviceAdmissionPanel(), /授权迁移/);
});

test('migration is collapsed below daily device management with labelled full size fields', () => {
    const context = loadModule();
    context.deviceAdmissionState.keyring = {ready: true, key_count: 1};
    const html = context.renderDeviceAdmissionPanel();
    assert.match(html, /<details class="[^"]*device-access-migration"/);
    assert.doesNotMatch(html, /<details[^>]*device-access-migration[^>]*\bopen\b/);
    assert.ok(html.indexOf('device-access-approved') < html.indexOf('device-access-migration'));
    assert.match(html, /for="deviceMigrationCodeInput"/);
    assert.match(html, /class="device-migration-input"/);
});

test('refresh updates devices while retaining the open migration editor and focus', async () => {
    const context = loadModule();
    let retained = null;
    let focusOptions = null;
    const input = {value: 'draft', focus(options) { focusOptions = options; }};
    context.document.activeElement = input;
    const status = {innerHTML: 'old'};
    const migration = {contains: node => node === input, querySelector: () => status};
    const replacement = {querySelector: () => ({innerHTML: 'new'}), replaceWith(node) { retained = node; }};
    const host = {innerHTML: 'old list', querySelector: selector => selector.endsWith('[open]') ? migration : replacement};
    context.elements.set('deviceAdmissionPanelHost', host);
    await context.loadDeviceAdmissionPanel();
    assert.match(host.innerHTML, /device-access-panel/);
    assert.equal(retained, migration);
    assert.equal(input.value, 'draft');
    assert.equal(status.innerHTML, 'new');
    assert.equal(focusOptions.preventScroll, true);
    host.querySelector = () => null;
    await context.loadDeviceAdmissionPanel();
    assert.match(host.innerHTML, /device-access-panel/);
});

test('generate uses JSON or bounded file upload and only writes transient input', async () => {
    const context = loadModule({
        apiImpl(method, url) {
            if (url.endsWith('/export')) return {migration_code: 'transient-code'};
            return {};
        },
    });
    const output = {value: ''};
    context.elements.set('deviceMigrationCodeOutput', output);
    await context.generateDeviceMigrationCode(null);
    assert.equal(output.value, 'transient-code');
    assert.ok(context.calls.some(call => call.method === 'POST' && call.url.endsWith('/export')));

    await context.generateDeviceMigrationCode({name: 'device_admission_key.dpapi'});
    assert.ok(context.calls.some(call => call.method === 'POST_FORM' && call.url.endsWith('/export')));
});

test('import always clears migration code input after success or failure', async () => {
    for (const shouldFail of [false, true]) {
        const context = loadModule({
            apiImpl(method, url) {
                if (url.endsWith('/import') && shouldFail) throw new Error('bad code');
                return {};
            },
        });
        const input = {value: 'one-time-code'};
        context.elements.set('deviceMigrationCodeInput', input);
        const result = await context.importDeviceMigrationCode();
        assert.equal(input.value, '');
        assert.equal(result, !shouldFail);
    }
});


test('themed device confirmations await acceptance and cancellation writes nothing', async () => {
    const context = loadModule();
    let decide;
    context.confirmDialog = () => new Promise(resolve => { decide = resolve; });
    let pending = context.setDeviceAdmissionEnabled(true);
    await Promise.resolve();
    assert.equal(context.calls.length, 0);
    decide(false); assert.equal(await pending, false);
    assert.equal(context.calls.length, 0);
    pending = context.revokeApprovedDevice(9);
    await Promise.resolve();
    assert.equal(context.calls.length, 0);
    decide(false); assert.equal(await pending, false);
    assert.equal(context.calls.length, 0);
});
