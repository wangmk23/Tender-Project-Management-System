// ── Categorized settings navigation ──
const SETTINGS_CATEGORIES = Object.freeze([
    Object.freeze({key: 'general', label: '常规与外观', icon: '🎨'}),
    Object.freeze({key: 'workflow', label: '项目流程', icon: '🧭'}),
    Object.freeze({key: 'notifications', label: '通知设置', icon: '🔔'}),
    Object.freeze({key: 'files', label: '文件与数据', icon: '📁'}),
    Object.freeze({key: 'system', label: '系统与网络', icon: '🖥️'}),
    Object.freeze({key: 'device-access', label: '设备准入', icon: '🛡️', adminOnly: true}),
    Object.freeze({key: 'about', label: '关于', icon: 'ℹ️'}),
]);

let activeSettingsCategory = 'general';
let settingsDrawerReturnFocus = null;

function getVisibleSettingsCategories() {
    const admin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
    return SETTINGS_CATEGORIES.filter(category => !category.adminOnly || admin);
}

function normalizeSettingsCategory(key) {
    if (key === 'notifications') return activeSettingsCategory === 'channels' && typeof currentIsAdmin !== 'undefined' && currentIsAdmin ? 'channels' : 'email';
    if (key === 'email') return 'email';
    if (key === 'channels') return typeof currentIsAdmin !== 'undefined' && currentIsAdmin ? 'channels' : 'email';
    return getVisibleSettingsCategories().some(category => category.key === key) ? key : 'general';
}

function getActiveSettingsCategory() {
    return activeSettingsCategory;
}

function hasUnsavedSettingsChanges() {
    const formDirty = ['general', 'workflow', 'email', 'files'].includes(activeSettingsCategory) && settingsFormDirty;
    const workflowDirty = activeSettingsCategory === 'workflow' && (
        (typeof stageTemplateDirty !== 'undefined' && stageTemplateDirty)
        || (typeof stageOrderDirty !== 'undefined' && stageOrderDirty)
    );
    const notifChannelsDirty = activeSettingsCategory === 'channels'
        && typeof isNotificationChannelsDraftDirty === 'function'
        && isNotificationChannelsDraftDirty();
    return formDirty || workflowDirty || notifChannelsDirty;
}

function setSettingsCategory(key) {
    const next = normalizeSettingsCategory(key);
    if (hasUnsavedSettingsChanges()) {
        if (next === activeSettingsCategory) {
            closeSettingsCategoryDrawer();
            return true;
        }
        const notifOnlyDirty = activeSettingsCategory === 'channels'
            && !settingsFormDirty
            && typeof isNotificationChannelsDraftDirty === 'function'
            && isNotificationChannelsDraftDirty();
        toast(
            notifOnlyDirty
                ? '请先保存即时通知设置再切换分类'
                : (activeSettingsCategory === 'email' ? '请先保存邮件提醒设置再切换分类' : '请先保存当前设置再切换分类'),
            'warning'
        );
        return false;
    }
    if (typeof stopDeviceAdmissionPanelPolling === 'function' && next !== 'device-access') {
        stopDeviceAdmissionPanelPolling();
    }
    const previousFocus = document.activeElement;
    const fromChoice = previousFocus?.matches?.('[data-notification-choice]');
    const fromDrawer = previousFocus?.closest?.('#settingsCategoryDrawer');
    const fromNav = previousFocus?.matches?.('.settings-nav [data-settings-category]');
    activeSettingsCategory = next;
    closeSettingsCategoryDrawer({restoreFocus: false});
    renderSettingsView();
    if (fromChoice) document.querySelector('[data-notification-choice][aria-pressed="true"]')?.focus({preventScroll:true});
    if (fromDrawer) document.querySelector('.settings-mobile-trigger')?.focus({preventScroll:true});
    if (fromNav) document.querySelector('.settings-nav [aria-selected="true"]')?.focus({preventScroll:true});
    return true;
}

function openSettingsCategoryDrawer(trigger) {
    const drawer = document.getElementById('settingsCategoryDrawer');
    if (!drawer) return;
    settingsDrawerReturnFocus = trigger || null;
    drawer.classList.add('open');
    const first = drawer.querySelectorAll('button')[0] || document.querySelector('.settings-category-button');
    if (first) first.focus();
}

function closeSettingsCategoryDrawer({restoreFocus = true} = {}) {
    const drawer = document.getElementById('settingsCategoryDrawer');
    if (drawer) drawer.classList.remove('open');
    if (restoreFocus && settingsDrawerReturnFocus) settingsDrawerReturnFocus.focus();
    settingsDrawerReturnFocus = null;
}

function handleSettingsCategoryDrawerKeydown(event) {
    const drawer = document.getElementById('settingsCategoryDrawer');
    if (!drawer || !drawer.classList.contains('open')) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeSettingsCategoryDrawer();
        return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...drawer.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
    }
}

function renderSettingsCategoryButtons(extraClass = '') {
    return getVisibleSettingsCategories().map(category => {
        const selected = category.key === settingsNavigationKey();
        const pending = category.key === 'device-access'
            ? Math.max(0, Number(typeof deviceAdmissionState !== 'undefined' ? deviceAdmissionState.summary?.pending || 0 : 0) || 0)
            : 0;
        const badge = category.key === 'device-access'
            ? `<span class="settings-category-badge" aria-label="${pending} 个待审批设备" ${pending ? '' : 'hidden'}>${pending}</span>`
            : '';
        return `<button type="button" data-settings-category="${category.key}" class="settings-category-button ${extraClass} ${selected ? 'active' : ''}" role="tab" aria-selected="${selected}" onclick="setSettingsCategory('${category.key}')"><span aria-hidden="true"><span data-ui-icon="${escHtml(category.icon)}"></span></span>${category.label}${badge}</button>`;
    }).join('');
}

function settingsNavigationKey() {
    return ['email', 'channels'].includes(activeSettingsCategory) ? 'notifications' : activeSettingsCategory;
}

function renderNotificationChoices() {
    if (typeof currentIsAdmin === 'undefined' || !currentIsAdmin) return '';
    const choices = [['email', '邮件提醒'], ['channels', '群机器人与即时通知']];
    return `<div class="nc-channel-choices" role="group" aria-label="通知方式">${choices.map(([key, name]) =>
        `<button type="button" data-notification-choice="${key}" aria-pressed="${activeSettingsCategory===key}" onclick="setSettingsCategory('${key}')">${name}</button>`
    ).join('')}</div>`;
}

function renderSettingsNavigationShell(panels) {
    activeSettingsCategory = normalizeSettingsCategory(activeSettingsCategory);
    const category = getVisibleSettingsCategories().find(item => item.key === settingsNavigationKey());
    return `<div class="settings-shell">
      <aside class="settings-nav" role="tablist" aria-label="设置分类">${renderSettingsCategoryButtons()}</aside>
      <main class="settings-category-content">
        <button type="button" class="settings-mobile-trigger" aria-haspopup="dialog" onclick="openSettingsCategoryDrawer(this)"><span><span data-ui-icon="${escHtml(category.icon)}"></span></span>${category.label}<b>选择分类</b></button>
        <div class="settings-category-heading"><span><span data-ui-icon="${escHtml(category.icon)}"></span></span><div><h2>${category.label}</h2><p>${category.key === 'about' ? '查看系统版本、更新记录及相关信息' : '按分类集中管理相关设置。'}</p></div></div>
        <div class="settings-page" role="tabpanel" aria-label="${category.label}" oninput="markSettingsFormDirty(event)" onchange="markSettingsFormDirty(event)">
          ${category.key === 'notifications' ? renderNotificationChoices() : ''}
          ${panels[activeSettingsCategory] || ''}
        </div>
      </main>
      <div id="settingsCategoryDrawer" class="settings-category-drawer" role="dialog" aria-modal="true" aria-label="选择设置分类" onkeydown="handleSettingsCategoryDrawerKeydown(event)" onclick="if(event.target===this)closeSettingsCategoryDrawer()">
        <div class="settings-category-drawer-panel"><div class="settings-category-drawer-head"><strong>设置分类</strong><button type="button" aria-label="关闭" onclick="closeSettingsCategoryDrawer()">×</button></div><nav role="tablist">${renderSettingsCategoryButtons('settings-category-drawer-button')}</nav></div>
      </div>
    </div>`;
}
