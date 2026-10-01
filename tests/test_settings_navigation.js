'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const modulePath = path.join(root, 'source', 'frontend', '12-settings-navigation.js');
const moduleExists = fs.existsSync(modulePath);
const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');

test('settings navigation module is available', () => {
    assert.equal(moduleExists, true, '12-settings-navigation.js must exist');
});

function createClassList() {
    const values = new Set();
    return {
        add(value) { values.add(value); },
        remove(value) { values.delete(value); },
        contains(value) { return values.has(value); },
    };
}

function loadModule(extra = {}) {
    if (!moduleExists) return null;
    const source = fs.readFileSync(modulePath, 'utf8');
    const overlay = {
        classList: createClassList(),
        querySelectorAll() { return []; },
    };
    const trigger = {focusCalls: 0, focus() { this.focusCalls += 1; }};
    const firstNav = {focusCalls: 0, focus() { this.focusCalls += 1; }};
    const sandbox = {
        settingsFormDirty: false,
        renderCalls: 0,
        toasts: [],
        document: {
            getElementById(id) {
                if (id === 'settingsCategoryDrawer') return overlay;
                return null;
            },
            querySelector(selector) {
                if (selector === '.settings-category-button') return firstNav;
                return null;
            },
        },
        ...extra,
    };
    sandbox.renderSettingsView = () => { sandbox.renderCalls += 1; };
    sandbox.toast = (message, kind) => { sandbox.toasts.push([message, kind]); };
    sandbox.overlay = overlay;
    sandbox.trigger = trigger;
    sandbox.firstNav = firstNav;
    vm.createContext(sandbox);
    vm.runInContext(`${source}\nglobalThis.__settingsCategories = SETTINGS_CATEGORIES;\nglobalThis.__visibleSettingsCategories = getVisibleSettingsCategories();`, sandbox);
    return sandbox;
}

test('settings categories are fixed, complete and normalize unknown keys', {skip: !moduleExists}, () => {
    const context = loadModule({currentIsAdmin: false});
    assert.deepEqual(
        JSON.parse(JSON.stringify(context.__visibleSettingsCategories.map(item => item.key))),
        ['general', 'workflow', 'email', 'files', 'system', 'about'],
    );
    assert.equal(context.normalizeSettingsCategory('workflow'), 'workflow');
    assert.equal(context.normalizeSettingsCategory('device-access'), 'general');
    assert.equal(context.normalizeSettingsCategory('unknown'), 'general');

    const admin = loadModule({currentIsAdmin: true, deviceAdmissionState: {summary: {pending: 3}}});
    assert.deepEqual(
        JSON.parse(JSON.stringify(admin.__visibleSettingsCategories.map(item => item.key))),
        ['general', 'workflow', 'email', 'files', 'system', 'device-access', 'about'],
    );
    admin.setSettingsCategory('device-access');
    const buttons = admin.renderSettingsCategoryButtons();
    assert.match(buttons, /data-settings-category="device-access"/);
    assert.match(buttons, /aria-label="3 个待审批设备"/);
});

test('category switching renders the selection but protects dirty email drafts', {skip: !moduleExists}, () => {
    const context = loadModule();
    assert.equal(context.setSettingsCategory('workflow'), true);
    assert.equal(context.getActiveSettingsCategory(), 'workflow');
    assert.equal(context.renderCalls, 1);

    context.setSettingsCategory('email');
    context.settingsFormDirty = true;
    const rendersBeforeBlockedChange = context.renderCalls;
    assert.equal(context.setSettingsCategory('files'), false);
    assert.equal(context.getActiveSettingsCategory(), 'email');
    assert.equal(context.renderCalls, rendersBeforeBlockedChange);
    assert.deepEqual(context.toasts.at(-1), ['请先保存邮件提醒设置再切换分类', 'warning']);
});

test('drawer opens, closes on Escape and restores focus', {skip: !moduleExists}, () => {
    const context = loadModule();
    context.openSettingsCategoryDrawer(context.trigger);
    assert.equal(context.overlay.classList.contains('open'), true);
    assert.equal(context.firstNav.focusCalls, 1);
    let prevented = 0;
    context.handleSettingsCategoryDrawerKeydown({
        key: 'Escape',
        preventDefault() { prevented += 1; },
    });
    assert.equal(prevented, 1);
    assert.equal(context.overlay.classList.contains('open'), false);
    assert.equal(context.trigger.focusCalls, 1);
});

test('settings shell renders one active panel plus desktop and mobile navigation', {skip: !moduleExists}, () => {
    const context = loadModule();
    context.setSettingsCategory('workflow');
    const html = context.renderSettingsNavigationShell({
        general: '<p>GENERAL_ONLY</p>',
        workflow: '<p>WORKFLOW_ONLY</p>',
        email: '<p>EMAIL_ONLY</p>',
        files: '<p>FILES_ONLY</p>',
        system: '<p>SYSTEM_ONLY</p>',
        about: '<p>ABOUT_ONLY</p>',
    });
    assert.match(html, /class="settings-shell"/);
    assert.match(html, /class="settings-nav"/);
    assert.match(html, /id="settingsCategoryDrawer"/);
    assert.match(html, /role="tabpanel"/);
    assert.match(html, /WORKFLOW_ONLY/);
    assert.doesNotMatch(html, /GENERAL_ONLY|EMAIL_ONLY|FILES_ONLY|SYSTEM_ONLY|ABOUT_ONLY/);
    assert.match(html, /aria-selected="true"[^>]*>[\s\S]*?项目流程<\/button>/);
});

test('stage rail is a responsive grid without a nested horizontal scroller', () => {
    const match = css.match(/\.project-stage-rail\s*\{([^}]*)\}/);
    assert.ok(match, 'project stage rail rule must exist');
    assert.match(match[1], /display\s*:\s*grid/);
    assert.match(match[1], /grid-template-columns\s*:\s*repeat\(7,minmax\(0,1fr\)\)/);
    assert.doesNotMatch(match[1], /overflow-x\s*:\s*auto/);
    assert.match(css, /@media\s*\(max-width:\s*1100px\)[\s\S]*\.project-stage-rail[^}]*repeat\(5/);
    assert.match(css, /@media\s*\(max-width:\s*768px\)[\s\S]*\.project-stage-rail[^}]*repeat\(3/);
    assert.match(css, /@media\s*\(max-width:\s*520px\)[\s\S]*\.project-stage-rail[^}]*repeat\(2/);
});
