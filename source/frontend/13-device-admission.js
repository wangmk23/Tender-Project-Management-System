// ── Admin-only device admission settings ──
const deviceAdmissionState = {
    summary: null,
    requests: [],
    rejected: [],
    devices: [],
    observed: [],
    keyring: null,
    loading: false,
    error: '',
    summaryTimer: null,
    panelTimer: null,
    summaryPromise: null,
    panelPromise: null,
    busyIds: new Set(),
};

function deviceAdmissionIsAdmin() {
    return typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
}

function deviceAdmissionNumber(value) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function deviceAdmissionDate(value) {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString('zh-CN', {hour12: false});
}

function refreshDeviceAdmissionBadge() {
    if (typeof document === 'undefined' || typeof document.querySelector !== 'function') return;
    const badge = document.querySelector('[data-settings-category="device-access"] .settings-category-badge');
    if (!badge) return;
    const pending = deviceAdmissionNumber(deviceAdmissionState.summary?.pending);
    badge.textContent = String(pending);
    badge.setAttribute('aria-label', `${pending} 个待审批设备`);
    badge.hidden = pending === 0;
}

async function loadDeviceAdmissionSummary() {
    if (!deviceAdmissionIsAdmin()) return null;
    if (deviceAdmissionState.summaryPromise) return deviceAdmissionState.summaryPromise;
    deviceAdmissionState.summaryPromise = api('GET', '/api/device-access/summary')
        .then(result => {
            deviceAdmissionState.summary = result || {};
            refreshDeviceAdmissionBadge();
            return result;
        })
        .catch(error => {
            deviceAdmissionState.error = error.message || '设备准入状态加载失败';
            return null;
        })
        .finally(() => { deviceAdmissionState.summaryPromise = null; });
    return deviceAdmissionState.summaryPromise;
}

async function loadDeviceAdmissionPanel() {
    if (!deviceAdmissionIsAdmin()) return null;
    if (deviceAdmissionState.panelPromise) return deviceAdmissionState.panelPromise;
    deviceAdmissionState.loading = deviceAdmissionState.requests.length === 0
        && deviceAdmissionState.devices.length === 0 && deviceAdmissionState.observed.length === 0;
    deviceAdmissionState.error = '';
    deviceAdmissionState.panelPromise = Promise.all([
        api('GET', '/api/device-access/requests?status=pending'),
        api('GET', '/api/device-access/requests?status=rejected'),
        api('GET', '/api/device-access/devices'),
        api('GET', '/api/device-access/observed-devices'),
        api('GET', '/api/device-access/keyring/status').catch(() => null),
    ]).then(([pending, rejected, devices, observed, keyring]) => {
        deviceAdmissionState.requests = Array.isArray(pending?.requests) ? pending.requests : [];
        deviceAdmissionState.rejected = Array.isArray(rejected?.requests) ? rejected.requests : [];
        deviceAdmissionState.devices = Array.isArray(devices?.devices) ? devices.devices : [];
        deviceAdmissionState.observed = Array.isArray(observed?.devices) ? observed.devices : [];
        deviceAdmissionState.keyring = keyring && typeof keyring === 'object' ? keyring : null;
        return loadDeviceAdmissionSummary();
    }).catch(error => {
        deviceAdmissionState.error = error.message || '设备准入数据加载失败';
        return null;
    }).finally(() => {
        deviceAdmissionState.loading = false;
        deviceAdmissionState.panelPromise = null;
        const host = typeof document !== 'undefined' ? document.getElementById('deviceAdmissionPanelHost') : null;
        if (host && deviceAdmissionIsAdmin()) {
            const migration = host.querySelector?.('.device-access-migration[open]');
            const focused = migration?.contains(document.activeElement) ? document.activeElement : null;
            host.innerHTML = renderDeviceAdmissionPanel();
            if (migration) {
                const replacement = host.querySelector('.device-access-migration');
                if (replacement) {
                    migration.querySelector('.device-keyring-status').innerHTML = replacement.querySelector('.device-keyring-status').innerHTML;
                    replacement.replaceWith(migration);
                } else {
                    host.querySelector('.device-access-panel')?.append(migration);
                }
                focused?.focus({preventScroll: true});
            }
        }
    });
    return deviceAdmissionState.panelPromise;
}

function startDeviceAdmissionSummaryPolling() {
    stopDeviceAdmissionSummaryPolling();
    if (!deviceAdmissionIsAdmin()) return;
    loadDeviceAdmissionSummary();
    deviceAdmissionState.summaryTimer = setInterval(loadDeviceAdmissionSummary, 60000);
}

function stopDeviceAdmissionSummaryPolling() {
    if (deviceAdmissionState.summaryTimer) clearInterval(deviceAdmissionState.summaryTimer);
    deviceAdmissionState.summaryTimer = null;
}

function startDeviceAdmissionPanelPolling() {
    stopDeviceAdmissionPanelPolling();
    if (!deviceAdmissionIsAdmin()) return;
    loadDeviceAdmissionPanel();
    deviceAdmissionState.panelTimer = setInterval(() => {
        const host = typeof document !== 'undefined' ? document.getElementById('deviceAdmissionPanelHost') : null;
        if (!host || (typeof activeSettingsCategory !== 'undefined' && activeSettingsCategory !== 'device-access')) {
            stopDeviceAdmissionPanelPolling();
            return;
        }
        loadDeviceAdmissionPanel();
    }, 15000);
}

function stopDeviceAdmissionPanelPolling() {
    if (deviceAdmissionState.panelTimer) clearInterval(deviceAdmissionState.panelTimer);
    deviceAdmissionState.panelTimer = null;
}

function renderDeviceRequestCard(item, rejected = false) {
    const id = deviceAdmissionNumber(item?.id);
    return `<article class="device-access-card">
      <div class="device-access-card-head"><strong>${escHtml(item?.device_label || '未命名设备')}</strong><span class="device-access-status ${rejected ? 'rejected' : 'pending'}">${rejected ? '已拒绝' : '待审批'}</span></div>
      <dl class="device-access-meta">
        <div><dt>申请人</dt><dd>${escHtml(item?.applicant || '—')}</dd></div>
        <div><dt>来源地址</dt><dd>${escHtml(item?.last_ip || item?.first_ip || '—')}</dd></div>
        <div><dt>申请时间</dt><dd>${escHtml(deviceAdmissionDate(item?.created_at))}</dd></div>
        <div><dt>${rejected ? '拒绝理由' : '申请事由'}</dt><dd>${escHtml(rejected ? item?.reject_reason || '—' : item?.reason || '—')}</dd></div>
      </dl>
      ${rejected ? '' : `<div class="device-access-actions">
        <button type="button" class="btn btn-primary btn-sm" data-device-action="approve" data-device-id="${id}">批准</button>
        <button type="button" class="btn btn-secondary btn-sm" data-device-action="reject" data-device-id="${id}">拒绝</button>
      </div>`}
    </article>`;
}

function renderApprovedDeviceCard(item) {
    const id = deviceAdmissionNumber(item?.id);
    const revoked = Boolean(item?.revoked_at);
    const enabled = Boolean(item?.enabled) && !revoked;
    return `<article class="device-access-card">
      <div class="device-access-card-head"><strong>${escHtml(item?.label || '未命名设备')}</strong><span class="device-access-status ${revoked ? 'rejected' : enabled ? 'enabled' : 'disabled'}">${revoked ? '已撤销' : enabled ? '已启用' : '已停用'}</span></div>
      <dl class="device-access-meta">
        <div><dt>使用人</dt><dd>${escHtml(item?.applicant || '—')}</dd></div>
        <div><dt>最近地址</dt><dd>${escHtml(item?.last_ip || '—')}</dd></div>
        <div><dt>最近访问</dt><dd>${escHtml(deviceAdmissionDate(item?.last_seen_at))}</dd></div>
        <div><dt>授权到期</dt><dd>${escHtml(deviceAdmissionDate(item?.expires_at))}</dd></div>
      </dl>
      ${revoked ? '' : `<div class="device-access-actions">
        <button type="button" class="btn btn-secondary btn-sm" data-device-action="${enabled ? 'disable' : 'enable'}" data-device-id="${id}">${enabled ? '停用' : '恢复'}</button>
        <button type="button" class="btn btn-danger btn-sm" data-device-action="revoke" data-device-id="${id}">永久撤销</button>
      </div>`}
    </article>`;
}

function renderObservedDeviceCard(item) {
    const online = Boolean(item?.online);
    return `<article class="device-access-card device-access-observed-card">
      <div class="device-access-card-head"><strong>${escHtml(item?.client_label || '未知浏览器')}</strong><span class="device-access-status ${online ? 'enabled' : 'disabled'}">${online ? '在线' : '离线'}</span></div>
      <dl class="device-access-meta">
        <div><dt>最近地址</dt><dd>${escHtml(item?.last_ip || '—')}</dd></div>
        <div><dt>登录账号</dt><dd>${escHtml(item?.last_username || '未登录')}</dd></div>
        <div><dt>首次连接</dt><dd>${escHtml(deviceAdmissionDate(item?.first_seen_at))}</dd></div>
        <div><dt>最近连接</dt><dd>${escHtml(deviceAdmissionDate(item?.last_seen_at))}</dd></div>
        <div><dt>活跃次数</dt><dd>${deviceAdmissionNumber(item?.activity_count)}</dd></div>
      </dl>
    </article>`;
}

function renderDeviceAdmissionPanel() {
    if (!deviceAdmissionIsAdmin()) {
        return '<section class="settings-card settings-card-wide"><p>只有管理员可以查看设备准入。</p></section>';
    }
    const summary = deviceAdmissionState.summary || {};
    const pending = deviceAdmissionNumber(summary.pending ?? deviceAdmissionState.requests.length);
    const empty = (title, description) => `<div class="device-access-empty"><span aria-hidden="true">○</span><strong>${title}</strong><p>${description}</p></div>`;
    const keyring = deviceAdmissionState.keyring;
    const enabled = Boolean(summary.admission_enabled);
    const migrationCard = keyring ? `<details class="settings-card device-access-section device-access-migration">
        <summary class="device-migration-heading"><span><strong>授权迁移</strong><span class="device-migration-description">仅换电脑时使用，保留原浏览器的设备授权</span></span><span class="device-keyring-status">${keyring.ready ? '已就绪' : '未就绪'}<span class="device-migration-chevron" aria-hidden="true">⌄</span></span></summary>
        <p class="device-migration-notice">在旧电脑生成迁移码，再到新电脑导入。迁移后请保持原访问地址，并保留浏览器 Cookie。</p>
        <div class="device-migration-grid">
          <div class="device-migration-block"><div class="device-migration-step"><span>1</span><h3>旧电脑 · 生成迁移码</h3></div><p>使用当前电脑的授权信息生成，然后复制到新电脑。</p><label for="deviceMigrationCodeOutput">生成的迁移码</label><input class="device-migration-input" id="deviceMigrationCodeOutput" type="password" readonly autocomplete="off" placeholder="生成后显示在这里"><div class="device-migration-actions"><button type="button" class="btn btn-primary btn-sm" data-device-action="migration-export">生成设备授权迁移码</button><button type="button" class="btn btn-secondary btn-sm" data-device-action="migration-copy">复制</button><button type="button" class="btn btn-secondary btn-sm" data-device-action="migration-clear">清空</button></div><details class="device-migration-advanced"><summary>使用历史备份（可选）</summary><label for="deviceMigrationBackupFile">原电脑的设备授权备份</label><input id="deviceMigrationBackupFile" type="file" accept=".dpapi,application/octet-stream"></details></div>
          <div class="device-migration-block"><div class="device-migration-step"><span>2</span><h3>新电脑 · 导入迁移码</h3></div><p>粘贴旧电脑生成的迁移码，已撤销或停用的设备仍保持原状态。</p><label for="deviceMigrationCodeInput">迁移码</label><div class="device-migration-secret"><input class="device-migration-input" id="deviceMigrationCodeInput" type="password" maxlength="8192" autocomplete="off" placeholder="粘贴旧电脑生成的迁移码"><button type="button" class="btn btn-secondary btn-sm" data-device-action="migration-toggle">显示</button></div><div class="device-migration-actions"><button type="button" class="btn btn-primary btn-sm" data-device-action="migration-import">导入设备授权迁移码</button></div></div>
        </div>
      </details>` : '';
    return `<div class="device-access-panel">
      <section class="settings-card device-access-section device-access-config">
        <div class="settings-card-head"><div><h2>设备准入开关</h2><p>${enabled ? '已开启：新浏览器必须提交申请并经管理员批准。' : '已关闭：局域网设备无需申请即可登录，系统仍会记录连接信息。'}</p></div>
          <button type="button" class="device-admission-toggle ${enabled ? 'enabled' : ''}" role="switch" aria-checked="${enabled}" data-device-action="toggle-admission" data-device-enabled="${enabled ? '0' : '1'}"><span></span>${enabled ? '已开启' : '已关闭'}</button>
        </div>
        <p class="device-access-config-note">关闭时无需申请；重新开启后，未获授权的浏览器仍需申请。</p>
      </section>
      <div class="device-access-summary" aria-label="设备准入概况">
        <div><span>待审批</span><strong>${pending}</strong></div>
        <div><span>等待领取</span><strong>${deviceAdmissionNumber(summary.approved_waiting)}</strong></div>
        <div><span>已授权设备</span><strong>${deviceAdmissionNumber(summary.devices ?? deviceAdmissionState.devices.length)}</strong></div>
        <div><span>当前启用</span><strong>${deviceAdmissionNumber(summary.enabled)}</strong></div>
        <div><span>已连接设备</span><strong>${deviceAdmissionNumber(summary.observed ?? deviceAdmissionState.observed.length)}</strong></div>
      </div>
      <div class="device-access-live" aria-live="polite" ${deviceAdmissionState.loading || deviceAdmissionState.error ? '' : 'hidden'}>${deviceAdmissionState.loading ? '正在加载设备准入数据…' : escHtml(deviceAdmissionState.error || '')}</div>
      <section class="settings-card device-access-section device-access-pending"><div class="settings-card-head"><div><h2>待审批申请 <span class="device-section-count">${pending}</span></h2><p>核对申请人和来源地址，确认后批准访问。</p></div><button type="button" class="btn btn-secondary btn-sm" data-device-action="refresh">刷新</button></div><div class="device-access-grid">${deviceAdmissionState.requests.length ? deviceAdmissionState.requests.map(item => renderDeviceRequestCard(item)).join('') : empty('暂无待审批申请', '新设备提交申请后，会显示在这里。')}</div></section>
      <section class="settings-card device-access-section device-access-observed"><div class="settings-card-head"><div><h2>已连接设备 <span class="device-section-count">${deviceAdmissionState.observed.length}</span></h2><p>准入关闭期间的连接记录，可查看浏览器、地址和登录账号。</p></div></div><div class="device-access-grid">${deviceAdmissionState.observed.length ? deviceAdmissionState.observed.map(renderObservedDeviceCard).join('') : empty('暂无连接记录', '准入关闭时，局域网浏览器访问后会自动记录。')}</div></section>
      <section class="settings-card device-access-section device-access-approved"><div class="settings-card-head"><div><h2>已授权设备 <span class="device-section-count">${deviceAdmissionState.devices.length}</span></h2><p>停用后可以恢复；永久撤销后需重新申请。</p></div></div><div class="device-access-grid">${deviceAdmissionState.devices.length ? deviceAdmissionState.devices.map(renderApprovedDeviceCard).join('') : empty('暂无已授权设备', '开启准入并批准申请后，在这里管理设备授权。')}</div></section>
      <section class="settings-card device-access-section device-access-rejected"><div class="settings-card-head"><div><h2>最近拒绝</h2><p>保留最近的拒绝记录，便于核对。</p></div></div><div class="device-access-grid">${deviceAdmissionState.rejected.length ? deviceAdmissionState.rejected.slice(0, 20).map(item => renderDeviceRequestCard(item, true)).join('') : empty('暂无拒绝记录', '被拒绝的申请会显示在这里。')}</div></section>
      ${migrationCard}
    </div>`;
}

async function runDeviceAdmissionWrite(key, operation, successMessage) {
    if (!deviceAdmissionIsAdmin() || deviceAdmissionState.busyIds.has(key)) return false;
    deviceAdmissionState.busyIds.add(key);
    try {
        await operation();
        toast(successMessage, 'success');
        await loadDeviceAdmissionPanel();
        return true;
    } catch (error) {
        toast(error.message || '设备准入操作失败', 'error');
        return false;
    } finally {
        deviceAdmissionState.busyIds.delete(key);
    }
}

async function setDeviceAdmissionEnabled(enabled) {
    const next = Boolean(enabled);
    if (next && typeof confirm === 'function' && !confirm('开启后，未获授权的浏览器将立即需要申请。确定开启吗？')) return false;
    return runDeviceAdmissionWrite('config', () => api('PATCH', '/api/device-access/config', {enabled: next}), next ? '设备准入已开启' : '设备准入已关闭');
}

async function approveDeviceRequest(id, label) {
    const value = String(label ?? '').trim();
    if (!value) return false;
    return runDeviceAdmissionWrite(`request:${id}`, () => api('POST', `/api/device-access/requests/${deviceAdmissionNumber(id)}/approve`, {label: value}), '设备申请已批准');
}

async function rejectDeviceRequest(id, reason) {
    const value = String(reason ?? '').trim();
    if (!value) { toast('请填写拒绝理由', 'warning'); return false; }
    return runDeviceAdmissionWrite(`request:${id}`, () => api('POST', `/api/device-access/requests/${deviceAdmissionNumber(id)}/reject`, {reason: value}), '设备申请已拒绝');
}

async function setApprovedDeviceEnabled(id, enabled) {
    const action = enabled ? 'enable' : 'disable';
    return runDeviceAdmissionWrite(`device:${id}`, () => api('POST', `/api/device-access/devices/${deviceAdmissionNumber(id)}/${action}`, {}), enabled ? '设备已恢复' : '设备已停用');
}

async function revokeApprovedDevice(id) {
    if (typeof confirm === 'function' && !confirm('永久撤销后此设备必须重新申请，确定继续吗？')) return false;
    return runDeviceAdmissionWrite(`device:${id}`, () => api('DELETE', `/api/device-access/devices/${deviceAdmissionNumber(id)}`, {}), '设备授权已永久撤销');
}

async function generateDeviceMigrationCode(file) {
    if (!deviceAdmissionIsAdmin()) return false;
    try {
        let result;
        if (file) {
            const form = new FormData();
            form.append('key_file', file);
            result = await apiForm('/api/device-access/keyring/export', form);
        } else {
            result = await api('POST', '/api/device-access/keyring/export', {});
        }
        const output = document.getElementById('deviceMigrationCodeOutput');
        if (output) output.value = String(result?.migration_code || '');
        toast('设备授权迁移码已生成，请立即复制到新电脑', 'success');
        return true;
    } catch (error) {
        toast(error.message || '设备授权迁移码生成失败', 'error');
        return false;
    }
}

async function importDeviceMigrationCode() {
    if (!deviceAdmissionIsAdmin()) return false;
    const input = document.getElementById('deviceMigrationCodeInput');
    const value = String(input?.value || '').trim();
    if (!value) {
        toast('请输入设备授权迁移码', 'warning');
        return false;
    }
    try {
        const result = await api('POST', '/api/device-access/keyring/import', {migration_code: value});
        if (result?.status) deviceAdmissionState.keyring = result.status;
        toast('设备授权迁移完成，原浏览器可直接刷新验证', 'success');
        return true;
    } catch (error) {
        toast(error.message || '设备授权迁移失败', 'error');
        return false;
    } finally {
        if (input) input.value = '';
    }
}

async function copyDeviceMigrationCode() {
    const output = document.getElementById('deviceMigrationCodeOutput');
    const value = String(output?.value || '');
    if (!value) return false;
    try {
        await navigator.clipboard.writeText(value);
        toast('迁移码已复制', 'success');
        return true;
    } catch (error) {
        output.type = 'text';
        output.select?.();
        toast('请手动复制迁移码', 'warning');
        return false;
    }
}

function openDeviceAdmissionDecision(id, action) {
    const requestItem = deviceAdmissionState.requests.find(item => deviceAdmissionNumber(item.id) === deviceAdmissionNumber(id));
    if (!requestItem) return;
    const approve = action === 'approve';
    showModal(approve ? '批准设备申请' : '拒绝设备申请', `
      <div class="setting-field"><label>${approve ? '设备备注' : '拒绝理由'}</label><input id="deviceAdmissionDecisionInput" maxlength="${approve ? 40 : 200}" value="${approve ? escHtml(requestItem.device_label || '') : ''}"></div>
      <div class="settings-actions"><button type="button" class="btn btn-secondary" data-device-action="cancel-decision">取消</button><button type="button" class="btn ${approve ? 'btn-primary' : 'btn-danger'}" data-device-action="confirm-${action}" data-device-id="${deviceAdmissionNumber(id)}">确认</button></div>
    `);
}

function installDeviceAdmissionActions() {
    if (typeof document === 'undefined' || typeof document.addEventListener !== 'function' || document.__deviceAdmissionActionsInstalled) return;
    document.__deviceAdmissionActionsInstalled = true;
    document.addEventListener('click', async event => {
        const button = event.target.closest?.('[data-device-action]');
        if (!button) return;
        const action = button.dataset.deviceAction;
        const id = deviceAdmissionNumber(button.dataset.deviceId);
        if (action === 'refresh') return loadDeviceAdmissionPanel();
        if (action === 'toggle-admission') return setDeviceAdmissionEnabled(button.dataset.deviceEnabled === '1');
        if (action === 'migration-export') {
            const file = document.getElementById('deviceMigrationBackupFile')?.files?.[0] || null;
            return generateDeviceMigrationCode(file);
        }
        if (action === 'migration-import') return importDeviceMigrationCode();
        if (action === 'migration-copy') return copyDeviceMigrationCode();
        if (action === 'migration-clear') {
            const output = document.getElementById('deviceMigrationCodeOutput');
            if (output) output.value = '';
            return;
        }
        if (action === 'migration-toggle') {
            const input = document.getElementById('deviceMigrationCodeInput');
            if (!input) return;
            input.type = input.type === 'password' ? 'text' : 'password';
            button.textContent = input.type === 'password' ? '显示' : '隐藏';
            return;
        }
        if (action === 'approve' || action === 'reject') return openDeviceAdmissionDecision(id, action);
        if (action === 'cancel-decision') return closeModal();
        if (action === 'confirm-approve' || action === 'confirm-reject') {
            const value = document.getElementById('deviceAdmissionDecisionInput')?.value || '';
            const ok = action === 'confirm-approve'
                ? await approveDeviceRequest(id, value)
                : await rejectDeviceRequest(id, value);
            if (ok) closeModal();
            return;
        }
        if (action === 'disable') return setApprovedDeviceEnabled(id, false);
        if (action === 'enable') return setApprovedDeviceEnabled(id, true);
        if (action === 'revoke') return revokeApprovedDevice(id);
    });
}

installDeviceAdmissionActions();
