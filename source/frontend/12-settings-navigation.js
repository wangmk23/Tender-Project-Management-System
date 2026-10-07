// ── Categorized settings navigation ──
const SETTINGS_CATEGORIES = Object.freeze([
    Object.freeze({key: 'general', label: '常规与外观', icon: '🎨'}),
    Object.freeze({key: 'workflow', label: '项目流程', icon: '🧭'}),
    Object.freeze({key: 'email', label: '邮件提醒', icon: '✉️'}),
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
    return getVisibleSettingsCategories().some(category => category.key === key) ? key : 'general';
}

function getActiveSettingsCategory() {
    return activeSettingsCategory;
}

function setSettingsCategory(key) {
    const next = normalizeSettingsCategory(key);
    if (activeSettingsCategory === 'email' && next !== 'email' && settingsFormDirty) {
        toast('请先保存邮件提醒设置再切换分类', 'warning');
        return false;
    }
    if (typeof stopDeviceAdmissionPanelPolling === 'function' && next !== 'device-access') {
        stopDeviceAdmissionPanelPolling();
    }
    activeSettingsCategory = next;
    closeSettingsCategoryDrawer({restoreFocus: false});
    renderSettingsView();
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
        const selected = category.key === activeSettingsCategory;
        const pending = category.key === 'device-access'
            ? Math.max(0, Number(typeof deviceAdmissionState !== 'undefined' ? deviceAdmissionState.summary?.pending || 0 : 0) || 0)
            : 0;
        const badge = category.key === 'device-access'
            ? `<span class="settings-category-badge" aria-label="${pending} 个待审批设备" ${pending ? '' : 'hidden'}>${pending}</span>`
            : '';
        return `<button type="button" data-settings-category="${category.key}" class="settings-category-button ${extraClass} ${selected ? 'active' : ''}" role="tab" aria-selected="${selected}" onclick="setSettingsCategory('${category.key}')"><span aria-hidden="true"><span data-ui-icon="${escHtml(category.icon)}"></span></span>${category.label}${badge}</button>`;
    }).join('');
}

function renderSettingsNavigationShell(panels) {
    activeSettingsCategory = normalizeSettingsCategory(activeSettingsCategory);
    const category = getVisibleSettingsCategories().find(item => item.key === activeSettingsCategory);
    return `<div class="settings-shell">
      <aside class="settings-nav" role="tablist" aria-label="设置分类">${renderSettingsCategoryButtons()}</aside>
      <main class="settings-category-content">
        <button type="button" class="settings-mobile-trigger" aria-haspopup="dialog" onclick="openSettingsCategoryDrawer(this)"><span><span data-ui-icon="${escHtml(category.icon)}"></span></span>${category.label}<b>选择分类</b></button>
        <div class="settings-category-heading"><span><span data-ui-icon="${escHtml(category.icon)}"></span></span><div><h2>${category.label}</h2><p>按分类集中管理相关设置。</p></div></div>
        <div class="settings-page" role="tabpanel" oninput="markSettingsFormDirty()" onchange="markSettingsFormDirty()">${panels[activeSettingsCategory] || ''}</div>
      </main>
      <div id="settingsCategoryDrawer" class="settings-category-drawer" role="dialog" aria-modal="true" aria-label="选择设置分类" onkeydown="handleSettingsCategoryDrawerKeydown(event)" onclick="if(event.target===this)closeSettingsCategoryDrawer()">
        <div class="settings-category-drawer-panel"><div class="settings-category-drawer-head"><strong>设置分类</strong><button type="button" aria-label="关闭" onclick="closeSettingsCategoryDrawer()">×</button></div><nav role="tablist">${renderSettingsCategoryButtons('settings-category-drawer-button')}</nav></div>
      </div>
    </div>`;
}
