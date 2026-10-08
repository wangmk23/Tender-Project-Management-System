// ── New Project Modal ──
function showNewProjectModal() {
    if (window._newProjectCreatePending) return;
    currentEditingProjectId = null;
    const now = new Date();
    const year = now.getFullYear();
    const prefix = `PRJ-${year}-`;
    const maximum = allProjects.reduce((highest, project) => {
        const number = String(project.number || '').trim();
        if (Number(project.year) !== year || !number.startsWith(prefix)) return highest;
        const suffix = number.slice(prefix.length);
        const value = Number(suffix);
        return /^\d+$/.test(suffix) && Number.isSafeInteger(value)
            ? Math.max(highest, value) : highest;
    }, 0);
    const seq = String(maximum + 1).padStart(3, '0');
    const autoNumber = `PRJ-${year}-${seq}`;
    window._newProjectLots = [];
    window._newProjectCreatedProject = null;

    const html = `
        <div class="form-group"><label>项目编号</label><input id="npNumber" value="${autoNumber}"></div>
        <div class="form-group"><label>项目名称 *</label><input id="npName" placeholder="请输入项目名称"></div>
        <div class="form-group"><label>采购人</label><input id="npPurchaser" placeholder="采购人名称"></div>
        <div class="form-group"><label>文件编制负责人</label><input id="npPrepareOwner" placeholder="编制人姓名"></div>
        <div class="form-group"><label>文件审核负责人</label><input id="npReviewOwner" placeholder="审核人姓名"></div>
        <div class="form-group"><label>采购方式</label>
            <select id="npMethod">${METHODS.map(m=>`<option value="${m}">${m}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>预算金额</label><input id="npBudget" placeholder="如：100万"></div>
        <div class="form-group"><label>年度</label><input id="npYear" type="number" value="${year}"></div>
        <div class="form-group">
            <div class="toggle-row" onclick="toggleCheckboxById('npNoDeposit')">
            <div class="toggle-switch">
                <input type="checkbox" id="npNoDeposit" onclick="event.stopPropagation()">
                <span class="toggle-slider toggle-warning"></span>
            </div>
            <span class="toggle-label">无需投标保证金</span>
        </div>
        </div>
        <div class="form-group">
            <label class="toggle-row" for="npMultiPack">
            <div class="toggle-switch">
                <input type="checkbox" id="npMultiPack" onchange="toggleMultiPack()">
                <span class="toggle-slider toggle-success"></span>
            </div>
            <span class="toggle-label">分包项目</span>
        </label>
        </div>
        <div id="packEditor" style="display:none;border:1px solid var(--border);border-radius:var(--radius);padding:10px;background:var(--surface2)">
            <div style="display:flex;gap:6px;margin-bottom:8px;align-items:flex-end">
                <div style="flex:2"><label style="font-size:10px;color:var(--text3)">包名</label><input id="packName" placeholder="如: 医疗设备" style="width:100%;padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:4px"></div>
                <div style="flex:1"><label style="font-size:10px;color:var(--text3)">预算(元)</label><input id="packBudget" type="text" placeholder="可不填" style="width:100%;padding:5px 8px;font-size:12px;border:1px solid var(--border);border-radius:4px"></div>
                <button id="packAddBtn" class="btn btn-xs btn-primary" onclick="addPackItem()">+ 添加</button>
            </div>
            <div id="packList" style="font-size:12px;color:var(--text2)"></div>
        </div>
        <button id="npCreateBtn" class="btn btn-primary btn-block" onclick="createProject()">创建项目</button>
    `;
    showModal('新建项目', html);
}

function toggleMultiPack() {
    var cb = document.getElementById('npMultiPack');
    document.getElementById('packEditor').style.display = cb.checked ? 'block' : 'none';
}
function addPackItem() {
    if (window._newProjectCreatePending || window._newProjectCreatedProject) return;
    var name = document.getElementById('packName').value.trim();
    var budget = document.getElementById('packBudget').value.trim();
    if (!name) { toast('请填写包名', 'warning'); return; }
    var nextNum = window._newProjectLots.length + 1;
    window._newProjectLots.push({lot_number: '包'+nextNum, lot_name:name, budget:budget || null});
    document.getElementById('packName').value = '';
    document.getElementById('packBudget').value = '';
    renderPackList();
}
function removePackItem(idx) {
    if (window._newProjectCreatePending || window._newProjectCreatedProject) return;
    window._newProjectLots.splice(idx, 1);
    for (var i = 0; i < window._newProjectLots.length; i++) {
        window._newProjectLots[i].lot_number = '包' + (i + 1);
    }
    renderPackList();
}
function renderPackList() {
    var list = document.getElementById('packList');
    if (!list) return;
    const locked = Boolean(window._newProjectCreatedProject);
    if (!window._newProjectLots.length) {
        list.innerHTML = '<div style="padding:4px;color:var(--text3);font-style:italic">暂未添加包</div>';
        return;
    }
    list.innerHTML = window._newProjectLots.map(function(l, i) {
        var budgetStr = l.budget ? ' - ¥' + Number(l.budget).toLocaleString() : '';
        const action = locked ? '<span style="color:var(--text2);font-size:11px">待创建</span>'
            : '<a href="javascript:void(0)" onclick="removePackItem(' + i + ')" style="color:var(--danger);font-size:11px;text-decoration:none"><span data-ui-icon="✕"></span> 删除</a>';
    return '<div class="pack-draft-row"><span><strong>' + escHtml(l.lot_number) + '</strong> ' + escHtml(l.lot_name) + '<span style="color:var(--text2);font-size:11px">' + budgetStr + '</span></span>' + action + '</div>';
    }).join('');
}



async function createProject() {
    if (window._newProjectCreatePending) return;
    const data = {
        number: document.getElementById('npNumber').value.trim(),
        name: document.getElementById('npName').value.trim(),
        purchaser: document.getElementById('npPurchaser').value.trim(),
        method: document.getElementById('npMethod').value,
        budget: document.getElementById('npBudget').value.trim(),
        prepare_owner: document.getElementById('npPrepareOwner').value.trim(),
        review_owner: document.getElementById('npReviewOwner').value.trim(),
        year: parseInt(document.getElementById('npYear').value) || 2026,
        no_deposit: document.getElementById('npNoDeposit').checked,
    };
    if (!data.name || !data.number) {
        toast('❌ 项目编号和名称不能为空', 'error');
        return;
    }
    const draftLots = window._newProjectLots || [];
    const lots = document.getElementById('npMultiPack')?.checked === false ? [] : draftLots.slice();
    const resuming = Boolean(window._newProjectCreatedProject);
    const createButton = document.getElementById('npCreateBtn');
    if (createButton) createButton.disabled = true;
    window._newProjectCreatePending = true;
    try {
        let p = window._newProjectCreatedProject;
        if (!p) {
            p = await api('POST', '/api/projects', data);
            window._newProjectCreatedProject = p;
            storeProjectDetail(p, {prepend: true});
            if (!lots.length) closeModal();
            renderSidebar();
            selectProject(p.id);
            if (lots.length) {
                for (const id of ['npNumber', 'npName', 'npPurchaser', 'npMethod', 'npBudget',
                    'npPrepareOwner', 'npReviewOwner', 'npYear', 'npNoDeposit', 'npMultiPack',
                    'packName', 'packBudget', 'packAddBtn']) {
                    const field = document.getElementById(id);
                    if (field) field.disabled = true;
                }
            }
        }
        let checklistInitError = null;
        try {
            await initializeProjectChecklistDefaults(p.id);
        } catch (error) {
            checklistInitError = error;
        }
        for (const lot of lots) {
            await api('POST', '/api/projects/' + p.id + '/lots', lot);
            const index = draftLots.indexOf(lot);
            if (index >= 0) draftLots.splice(index, 1);
        }
        if (window._newProjectLots === draftLots) window._newProjectLots = [];
        window._newProjectCreatedProject = null;
        if (lots.length || resuming) closeModal();
        toast(
            checklistInitError
                ? '⚠️ 项目已创建，但检查清单默认项初始化失败：' + checklistInitError.message
                : '✅ 项目创建成功',
            checklistInitError ? 'warning' : 'success',
        );
        const detailResult = await requestProjectDetail(p.id, {force: true});
        if (
            detailResult.accepted
            && Number(currentProject?.id) === Number(p.id)
            && document.getElementById('view-project')?.classList.contains('active')
        ) {
            renderProjectDetail(detailResult.project, false);
        }
    } catch(e) {
        if (window._newProjectCreatedProject && draftLots.length) {
            renderPackList();
            if (createButton) createButton.textContent = '重试创建剩余采购包';
            toast('⚠️ 项目已创建，尚有 ' + draftLots.length + ' 个采购包未完成。请重试创建剩余采购包：' + e.message, 'warning');
        } else {
            toast('❌ ' + e.message, 'error');
        }
    } finally {
        window._newProjectCreatePending = false;
        if (createButton) createButton.disabled = false;
    }
}

function editCurrentProject() {
    if (!currentProject) return;
    const p = currentProject;
    const html = `
        <div class="form-group"><label>项目编号</label><input id="epNumber" value="${escHtml(p.number)}"></div>
        <div class="form-group"><label>项目名称</label><input id="epName" value="${escHtml(p.name)}"></div>
        <div class="form-group"><label>采购人</label><input id="epPurchaser" value="${escHtml(p.purchaser)}"></div>
        <div class="form-group"><label>文件编制负责人</label><input id="epPrepareOwner" value="${escHtml(p.prepare_owner)}" placeholder="编制人姓名"></div>
        <div class="form-group"><label>文件审核负责人</label><input id="epReviewOwner" value="${escHtml(p.review_owner)}" placeholder="审核人姓名"></div>
        <div class="form-group"><label>采购方式</label>
            <select id="epMethod">${METHODS.map(m=>`<option value="${m}" ${p.method===m?'selected':''}>${m}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>预算金额</label><input id="epBudget" value="${escHtml(p.budget)}"></div>
        <div class="form-group"><label>年度</label><input id="epYear" type="number" value="${p.year}"></div>
        <div class="form-group"><label>备注</label><textarea id="epNotes" rows="3">${escHtml(p.notes)}</textarea></div>
        <div class="toggle-row" onclick="toggleCheckboxById('epNoDeposit')">
            <div class="toggle-switch">
                <input type="checkbox" id="epNoDeposit" onclick="event.stopPropagation()" ${p.no_deposit ? 'checked' : ''}>
                <span class="toggle-slider toggle-warning"></span>
            </div>
            <span class="toggle-label">无需投标保证金</span>
        </div>
        <button class="btn btn-primary btn-block" data-dialog-submit onclick="saveEditProject()">保存修改</button>
        ${currentIsAdmin ? '<button class="btn btn-danger btn-block" style="margin-top:8px" onclick="deleteCurrentProject()">删除项目</button>' : ''}
    `;
    showModal('编辑项目', html);
}

async function saveEditProject() {
    if (!currentProject) return;
    const data = {
        number: document.getElementById('epNumber').value.trim(),
        name: document.getElementById('epName').value.trim(),
        purchaser: document.getElementById('epPurchaser').value.trim(),
        method: document.getElementById('epMethod').value,
        budget: document.getElementById('epBudget').value.trim(),
        prepare_owner: document.getElementById('epPrepareOwner').value.trim(),
        review_owner: document.getElementById('epReviewOwner').value.trim(),
        year: parseInt(document.getElementById('epYear').value) || 2026,
        notes: document.getElementById('epNotes').value,
        no_deposit: document.getElementById('epNoDeposit').checked,
    };
    try {
        await api('PUT', `/api/projects/${currentProject.id}`, data);
        toast('✅ 保存成功', 'success');
        closeModal();
        await refreshProject();
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

async function deleteCurrentProject() {
    if (!currentProject) return;
    if (!await confirmDialog('删除项目', `确定删除项目「${currentProject.name}」？此操作不可恢复！`, '删除', 'btn-danger')) return;
    try {
        const deletedProjectId = Number(currentProject.id);
        await api('DELETE', `/api/projects/${deletedProjectId}`);
        dropProjectDetail(deletedProjectId);
        toast('🗑️ 项目已删除', 'info');
        closeModal();
        currentProject = null;
        renderSidebar();
        await loadAllProjects();
        switchView('dashboard');
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

// ── Init ──
function logout() {
    if (typeof stopDeviceAdmissionSummaryPolling === 'function') stopDeviceAdmissionSummaryPolling();
    if (typeof stopDeviceAdmissionPanelPolling === 'function') stopDeviceAdmissionPanelPolling();
    window.location.href = "/logout";
}

// ── Settings / Theme ──
let settingsFormDirty = false;

function markSettingsFormDirty() {
    settingsFormDirty = true;
}

function settingsCacheKey() {
    return 'settings';
}

function cacheCurrentSettingsView() {
    if (!systemInfo || !systemSettings) return null;
    invalidateViewCache(settingsCacheKey());
    return writeViewCache(settingsCacheKey(), {systemInfo, systemSettings});
}

async function loadSettingsView({force = false} = {}) {
    const el = document.getElementById('settingsContent');
    if (!el) return;
    const key = settingsCacheKey();
    let cached = readViewCache(key);
    if (cached && !force) {
        try {
            systemInfo = cached.value.systemInfo;
            systemSettings = cached.value.systemSettings;
            renderSettingsView();
        } catch (error) {
            console.error('设置缓存显示失败，重新读取', error);
            invalidateViewCache(key);
            cached = null;
            force = true;
        }
    }
    if (!cached) {
        renderViewSkeleton('settingsContent', '正在准备设置...');
    }
    if (cached?.fresh && !force) return cached.value;
    try {
        const result = await requestViewData(key, async () => {
            const [infoResult, settings] = await Promise.all([
                (systemInfo && !systemInfo._loadError && !force ? Promise.resolve(systemInfo) : api('GET', '/api/system-info'))
                    .then(value => ({value}), error => ({error})),
                api('GET', '/api/settings'),
            ]);
            const info = infoResult.error
                ? {...(systemInfo || {is_desktop: !!settings.is_desktop}), _loadError: infoResult.error.message || '系统信息读取失败'}
                : infoResult.value;
            return {systemInfo: info, systemSettings: settings};
        }, {force});
        if (!result.accepted) return cached?.value || null;
        const value = result.value;
        systemInfo = value.systemInfo;
        systemSettings = value.systemSettings;
        if (!settingsFormDirty) renderSettingsView();
        writeViewCache(key, value);
        return value;
    } catch(e) {
        console.error('设置数据刷新失败', e);
        if (cached) toast('设置刷新失败，已保留当前内容', 'warning');
        else renderViewLoadError('settingsContent', '设置加载失败', () => loadSettingsView({force: true}), e);
        return cached?.value || null;
    }
}

function renderAutoStartCard(desktop, isAdmin, enabled, startupError = '') {
    if (!desktop || !isAdmin) return '';
    return `
      <section class="settings-card settings-card-wide">
        <div class="settings-card-head">
          <div>
            <h2>桌面端启动</h2>
            <p>管理这台主机登录 Windows 后的启动方式。</p>
          </div>
        </div>
        <label class="setting-toggle">
          <input id="autoStartToggle" type="checkbox" ${enabled ? 'checked' : ''} ${startupError ? 'disabled' : ''}
                 onchange="setAutoStart(this.checked, this)">
          <span></span>
          <div>
            <strong>开机自动启动</strong>
            <small>${startupError ? escHtml(startupError) : '登录 Windows 后静默启动并驻留系统托盘。'}</small>
          </div>
        </label>
      </section>`;
}

function renderAboutCard() {
    return `<section class="settings-card settings-card-wide settings-about-card">
      <div class="settings-card-head">
        <div><h2>关于系统</h2><p>采购项目管理系统</p></div>
      </div>
      <div class="settings-list">
        <div><span>基础版本</span><strong>5.8.12</strong></div>
        <div><span>构建日期</span><strong>2026-07-29</strong></div>
      </div>
    </section>`;
}

const SMTP_PROVIDER_PRESETS = Object.freeze({
    qq: Object.freeze({host: 'smtp.qq.com', port: 465, security: 'ssl'}),
    '163': Object.freeze({host: 'smtp.163.com', port: 465, security: 'ssl'}),
    '126': Object.freeze({host: 'smtp.126.com', port: 465, security: 'ssl'}),
    gmail: Object.freeze({host: 'smtp.gmail.com', port: 465, security: 'ssl'}),
    outlook: Object.freeze({host: 'smtp-mail.outlook.com', port: 587, security: 'starttls', auth: 'oauth2'}),
    aliyunEnterprise: Object.freeze({host: 'smtp.qiye.aliyun.com', port: 465, security: 'ssl'}),
    tencentEnterprise: Object.freeze({host: 'smtp.exmail.qq.com', port: 465, security: 'ssl'}),
});

function detectSmtpProvider(settings = {}) {
    const host = String(settings.smtp_host || '').trim().toLowerCase();
    const port = Number(settings.smtp_port || 0);
    const security = String(settings.smtp_security || 'ssl').trim().toLowerCase();
    return Object.entries(SMTP_PROVIDER_PRESETS).find(([, preset]) => (
        preset.host === host && preset.port === port && preset.security === security
    ))?.[0] || 'custom';
}

function applySmtpProvider(providerKey) {
    const preset = SMTP_PROVIDER_PRESETS[providerKey];
    if (!preset) return;
    const host = document.getElementById('smtpHost');
    const port = document.getElementById('smtpPort');
    const security = document.getElementById('smtpSecurity');
    if (host) host.value = preset.host;
    if (port) port.value = String(preset.port);
    if (security) security.value = preset.security;
    syncSmtpProviderGuidance(providerKey);
}

function syncSmtpProviderGuidance(providerKey) {
    const guidance = document.getElementById('smtpProviderGuidance');
    if (guidance) guidance.style.display = providerKey === 'outlook' ? '' : 'none';
}

const REMINDER_EVENT_META = Object.freeze({
    daily_stage: {label: '每日阶段提醒', fields: ['project_number', 'project_name', 'purchaser', 'method', 'year', 'stage_name', 'planned_at', 'registration_count']},
    project_create: {label: '项目新建', fields: ['project_number', 'project_name', 'purchaser', 'method', 'year', 'event_at', 'progress']},
    project_complete: {label: '项目完成', fields: ['project_number', 'project_name', 'purchaser', 'method', 'year', 'event_at', 'progress']},
    supplier_shortage: {label: '供应商不足', fields: ['project_number', 'project_name', 'purchaser', 'method', 'year', 'lot_identity', 'supplier_count', 'supplier_minimum', 'supplier_missing', 'registration_deadline']},
});
const REMINDER_FIELD_LABELS = Object.freeze({
    project_number: '项目编号', project_name: '项目名称', purchaser: '采购人', method: '采购方式', year: '年度',
    stage_name: '阶段名称', planned_at: '计划时间', registration_count: '报名家数', event_at: '事件时间',
    progress: '当前进度', lot_identity: '采购包', supplier_count: '当前供应商数', supplier_minimum: '最低要求数',
    supplier_missing: '缺少数量', registration_deadline: '报名截止时间',
});
const REMINDER_SAFE_STATUS_LABELS = Object.freeze({
    SMTP_AUTH_FAILED: '邮箱账号或授权码验证失败', SMTP_TLS_FAILED: '邮件加密连接失败',
    SMTP_CONNECTION_FAILED: '无法连接邮件服务器', SMTP_SEND_FAILED: '邮件发送失败',
    STATE_INVALID: '提醒状态需要重新初始化', STATE_WRITE_FAILED: '提醒状态保存失败', CONFIG_INVALID: '提醒配置不完整',
});
let recipientGroupDraft = null;

function currentRecipientGroups() {
    return (systemSettings?.reminder_recipient_groups || []).map((group, index) => ({
        ...group,
        enabled: group.enabled !== false,
        order: index,
        recipients: [...(group.recipients || [])],
        event_types: [...(group.event_types || [])],
        content_fields: {...(group.content_fields || {})},
    }));
}

function createRecipientGroupId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `group-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function renderRecipientDuplicateWarning(group, groups = currentRecipientGroups()) {
    const matched = new Map();
    groups.filter(item => item.enabled !== false).forEach(item => {
        (item.recipients || []).forEach(rawEmail => {
            const email = String(rawEmail || '').trim().toLowerCase();
            if (!email) return;
            const entry = matched.get(email) || {groups: [], mergedFields: new Set(), prefix: item.subject_prefix || ''};
            entry.groups.push(item.name || '未命名组');
            Object.entries(item.content_fields || {}).filter(([, enabled]) => enabled).forEach(([field]) => entry.mergedFields.add(field));
            matched.set(email, entry);
        });
    });
    const duplicates = [...new Set((group.recipients || []).map(value => String(value).trim().toLowerCase()))]
        .map(email => [email, matched.get(email)])
        .filter(([, entry]) => entry && entry.groups.length > 1);
    if (!duplicates.length) return '';
    return `<div class="recipient-duplicate-warning"><strong>重复邮箱合并提示</strong>${duplicates.map(([email, entry]) =>
        `<p>${escHtml(email)} 同时属于 ${entry.groups.map(escHtml).join('、')}。同一邮箱最终只发送一封；内容字段合并为 ${[...entry.mergedFields].map(field => escHtml(REMINDER_FIELD_LABELS[field] || field)).join('、')}，并使用首个匹配组的主题前缀“${escHtml(entry.prefix || '无')}”。</p>`
    ).join('')}</div>`;
}

function renderRecipientGroupRows(groups, editable) {
    if (!groups.length) return '<div class="recipient-group-empty">尚未建立收件组。请新增一个组并选择提醒类型。</div>';
    return groups.map((group, index) => `<div class="recipient-group-row ${group.enabled === false ? 'is-disabled' : ''}">
      <button class="recipient-group-main" onclick="openRecipientGroupDrawer('${escHtml(group.id)}')">
        <strong>${escHtml(group.name)}</strong><small>${group.recipients.length} 个邮箱 · ${escHtml(group.subject_prefix ? `前缀：${group.subject_prefix}` : '无主题前缀')}</small>
        <span class="recipient-event-badges">${group.event_types.map(type => `<i>${escHtml(REMINDER_EVENT_META[type]?.label || type)}</i>`).join('') || '<i>未选择类型</i>'}</span>
      </button>
      <div class="recipient-group-actions">
        <button class="btn btn-xs btn-secondary" onclick="moveRecipientGroup('${escHtml(group.id)}',-1)" ${!editable || index === 0 ? 'disabled' : ''} title="上移">↑</button>
        <button class="btn btn-xs btn-secondary" onclick="moveRecipientGroup('${escHtml(group.id)}',1)" ${!editable || index === groups.length - 1 ? 'disabled' : ''} title="下移">↓</button>
        <button class="btn btn-xs btn-secondary" onclick="copyRecipientGroup('${escHtml(group.id)}')" ${editable ? '' : 'disabled'}>复制</button>
        <button class="btn btn-xs btn-secondary" onclick="toggleRecipientGroup('${escHtml(group.id)}')" ${editable ? '' : 'disabled'}>${group.enabled === false ? '启用' : '停用'}</button>
        <button class="btn btn-xs btn-danger" onclick="deleteRecipientGroup('${escHtml(group.id)}')" ${editable ? '' : 'disabled'}>删除</button>
      </div>
    </div>`).join('');
}

function renderReminderRuntimeStatus(settings) {
    const statuses = settings.reminder_runtime_status || {};
    return Object.entries(REMINDER_EVENT_META).map(([type, meta]) => {
        const status = statuses[type] || {};
        const error = status.error_code ? (REMINDER_SAFE_STATUS_LABELS[status.error_code] || '运行异常') : '正常';
        return `<div class="reminder-runtime-row"><strong>${meta.label}</strong><span>待发送 ${Number(status.pending_count || 0)}</span><span>最近检查 ${escHtml(status.last_check_at || '尚未检查')}</span><span class="${status.error_code ? 'status-error' : ''}">${escHtml(error)}</span></div>`;
    }).join('');
}

function reminderStageDefinitions(settings = systemSettings || {}) {
    if (!settings.stage_templates) return getOrderedStages();
    const definitions = [];
    const seen = new Set();
    for (const method of clientProcurementMethods()) {
        for (const stage of normalizeClientStageTemplates(settings.stage_templates, settings)[method] || []) {
            if (seen.has(stage.id)) continue;
            seen.add(stage.id);
            definitions.push({key: stage.id, name: stage.name, icon: stage.icon});
        }
    }
    return definitions;
}

function renderLegacyReminderSettingsCard(settings = systemSettings || {}) {
    const editable = isDesktopApp() && currentIsAdmin;
    const disabled = editable ? '' : 'disabled';
    const reminderStages = reminderStageDefinitions(settings);
    const enabledStages = new Set(settings.reminder_stage_keys || reminderStages.map(stage => stage.key));
    const content = settings.reminder_content || {};
    const status = settings.reminder_status || {};
    const selectedProvider = detectSmtpProvider(settings);
    const contentOptions = [
        ['project_number', '项目编号'],
        ['project_name', '项目名称'],
        ['purchaser', '采购人'],
        ['stage_name', '节点名称'],
        ['planned_at', '计划时间'],
        ['registration_count', '报名家数'],
    ];
    const weekdayLabels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
    const activeWeekdays = new Set(settings.reminder_weekdays || [1, 2, 3, 4, 5, 6, 7]);
    const advanceDays = Number(settings.reminder_advance_days || 0);
    return `<section class="settings-card settings-card-wide reminder-settings-card">
      <div class="settings-card-head">
        <div><h2>邮件提醒</h2><p>每天到达设定时间后，汇总发送当天（及提前 N 天）计划完成的采购流程节点。</p></div>
        <label class="setting-toggle reminder-master-toggle">
          <input id="reminderEnabled" type="checkbox" ${settings.reminder_enabled ? 'checked' : ''} ${disabled}>
          <span></span><div><strong>启用自动提醒</strong><small>默认每天上午 09:00</small></div>
        </label>
      </div>
      <div class="reminder-option-section reminder-account-section">
        <strong>邮箱账号与服务器</strong>
        <div class="reminder-settings-grid reminder-account-grid">
        <div class="setting-field"><label>邮箱服务商</label><select id="smtpProvider" onchange="applySmtpProvider(this.value)" ${disabled}>
          <option value="qq" ${selectedProvider === 'qq' ? 'selected' : ''}>QQ / Foxmail</option>
          <option value="163" ${selectedProvider === '163' ? 'selected' : ''}>163 邮箱</option>
          <option value="126" ${selectedProvider === '126' ? 'selected' : ''}>126 邮箱</option>
          <option value="gmail" ${selectedProvider === 'gmail' ? 'selected' : ''}>Gmail</option>
          <option value="outlook" ${selectedProvider === 'outlook' ? 'selected' : ''}>Outlook/Hotmail</option>
          <option value="aliyunEnterprise" ${selectedProvider === 'aliyunEnterprise' ? 'selected' : ''}>阿里企业邮箱</option>
          <option value="tencentEnterprise" ${selectedProvider === 'tencentEnterprise' ? 'selected' : ''}>腾讯企业邮箱</option>
          <option value="custom" ${selectedProvider === 'custom' ? 'selected' : ''}>自定义</option>
        </select></div>
        <div class="setting-field"><label>SMTP 服务器</label><input id="smtpHost" value="${escHtml(settings.smtp_host || '')}" placeholder="smtp.example.com" ${disabled}></div>
        <div class="setting-field"><label>端口</label><input id="smtpPort" type="number" min="1" max="65535" value="${Number(settings.smtp_port || 465)}" ${disabled}></div>
        <div class="setting-field"><label>加密方式</label><select id="smtpSecurity" ${disabled}><option value="ssl" ${settings.smtp_security !== 'starttls' ? 'selected' : ''}>SSL</option><option value="starttls" ${settings.smtp_security === 'starttls' ? 'selected' : ''}>STARTTLS</option></select></div>
        <div class="setting-field"><label>登录账号</label><input id="smtpUsername" value="${escHtml(settings.smtp_username || '')}" autocomplete="username" ${disabled}></div>
        <div class="setting-field"><label>发件邮箱</label><input id="smtpSender" type="email" value="${escHtml(settings.smtp_sender || '')}" ${disabled}></div>
        <div class="setting-field reminder-password-field"><label>SMTP 密码 / 授权码</label><input id="smtpPassword" type="password" autocomplete="new-password" value="" placeholder="${settings.smtp_password_configured ? '密码已安全保存；留空表示不修改' : '请输入 SMTP 密码或授权码'}" ${disabled}></div>
        </div>
      </div>
      <div class="reminder-option-section reminder-schedule-section">
        <strong>发送安排</strong>
        <div class="reminder-settings-grid reminder-schedule-grid">
          <div class="setting-field"><label>发送时间</label><input id="reminderTime" type="time" value="${escHtml(settings.reminder_time || '09:00')}" ${disabled}></div>
          <div class="setting-field"><label>提前提醒天数</label><input id="reminderAdvanceDays" type="number" min="0" max="30" value="${advanceDays}" aria-describedby="reminderAdvanceHint" ${disabled}></div>
          <small id="reminderAdvanceHint" class="reminder-field-hint">0 = 仅提醒当天到期；3 = 提前 3 天开始提醒</small>
          <div class="setting-field reminder-recipient-field"><label>收件邮箱</label><textarea id="reminderRecipients" rows="3" placeholder="多个邮箱用逗号或换行分隔" ${disabled}>${escHtml((settings.reminder_recipients || []).join('\n'))}</textarea></div>
        </div>
      </div>
      <div class="reminder-option-section">
        <strong>邮件主题</strong><small>可用占位符：{date}（日期）、{count}（节点数）</small>
        <div class="setting-field"><input id="reminderSubject" type="text" maxlength="120" value="${escHtml(settings.reminder_subject || '采购执行提醒：{date} 共 {count} 个节点')}" ${disabled}></div>
      </div>
      <div class="reminder-option-section">
        <strong>提醒星期</strong><small>仅在工作日发送，或自定义提醒日</small>
        <div class="reminder-stage-grid">${weekdayLabels.map((label, idx) => `<label><input type="checkbox" data-reminder-weekday value="${idx + 1}" ${activeWeekdays.has(idx + 1) ? 'checked' : ''} ${disabled}><span>${label}</span></label>`).join('')}</div>
      </div>
      <div id="smtpProviderGuidance" class="settings-note warning" style="display:${selectedProvider === 'outlook' ? '' : 'none'}">Outlook/Hotmail 当前要求 OAuth2 现代身份验证，不能使用本页 SMTP 密码测试；请先改用支持授权码的邮箱服务商。</div>
      <div class="reminder-option-section">
        <strong>提醒节点</strong><small>默认选择全部设置了计划时间的流程节点</small>
        <div class="reminder-stage-grid">${reminderStages.map(stage => `<label><input type="checkbox" data-reminder-stage value="${escHtml(stage.key)}" ${enabledStages.has(stage.key) ? 'checked' : ''} ${disabled}><span>${escHtml(stage.name)}</span></label>`).join('')}</div>
      </div>
      <div class="reminder-option-section">
        <strong>邮件内容</strong><small>供应商信息只发送报名家数，不发送名单</small>
        <div class="reminder-content-grid">${contentOptions.map(([key, label]) => `<label><input type="checkbox" data-reminder-content value="${key}" ${content[key] !== false ? 'checked' : ''} ${disabled}><span>${label}</span></label>`).join('')}</div>
      </div>
      <div class="reminder-option-section">
        <strong>项目事件提醒</strong><small>新建项目或项目完成时自动发送邮件，每次检测间隔约 1 分钟</small>
        <div class="reminder-event-grid">
          <label class="setting-toggle reminder-event-toggle">
            <input id="eventReminderCreateEnabled" type="checkbox" ${settings.event_reminder_create_enabled ? 'checked' : ''} ${disabled}>
            <span></span><div><strong>新建项目提醒</strong><small>检测到新项目时发送邮件</small></div>
          </label>
          <label class="setting-toggle reminder-event-toggle">
            <input id="eventReminderCompleteEnabled" type="checkbox" ${settings.event_reminder_complete_enabled ? 'checked' : ''} ${disabled}>
            <span></span><div><strong>项目完成提醒</strong><small>项目归档完成时发送邮件</small></div>
          </label>
        </div>
      </div>
      <div class="reminder-status-grid">
        <div><span>密码状态</span><strong>${settings.smtp_password_configured ? '已安全保存' : '未配置'}</strong></div>
        <div><span>最近检查</span><strong>${escHtml(status.last_check_at || '尚未检查')}</strong></div>
        <div><span>最近成功</span><strong>${escHtml(status.last_success_at || '尚未发送')}</strong></div>
        <div><span>最近状态</span><strong class="${status.last_error ? 'status-error' : ''}">${escHtml(status.last_error || '正常')}</strong></div>
      </div>
      <div class="settings-actions">
        <button class="btn btn-primary btn-sm" onclick="saveReminderSettings(this)" ${disabled}>保存邮件提醒</button>
        <button class="btn btn-secondary btn-sm" onclick="previewReminderEmail(this)" ${disabled}>预览邮件内容</button>
        <button class="btn btn-secondary btn-sm" onclick="sendReminderTestEmail(this)" ${disabled}>发送测试邮件</button>
      </div>
      <div id="reminderPreviewPanel" class="reminder-preview-panel" style="display:none">
        <strong>邮件预览</strong>
        <div class="reminder-preview-field"><label>主题</label><pre id="reminderPreviewSubject"></pre></div>
        <div class="reminder-preview-field"><label>正文</label><pre id="reminderPreviewBody"></pre></div>
      </div>
      ${editable ? '' : '<div class="settings-note warning">只能由管理员在桌面主机本机修改或测试邮件提醒。</div>'}
    </section>`;
}

function renderReminderSettingsCard(settings = systemSettings || {}) {
    const editable = isDesktopApp() && currentIsAdmin;
    const groups = currentRecipientGroups();
    const groupSection = `<div class="reminder-option-section recipient-groups-section">
      <div class="recipient-group-section-head"><div><strong>收件组</strong><small>不同邮箱可以订阅不同提醒；同一邮箱命中多个组时自动合并。</small></div>
        <button class="btn btn-primary btn-sm" onclick="openRecipientGroupDrawer(null)" ${editable && groups.length < 20 ? '' : 'disabled'}>+ 新增收件组</button>
      </div>
      <div class="recipient-group-list">${renderRecipientGroupRows(groups, editable)}</div>
    </div>`;
    const runtimeSection = `<div class="reminder-option-section reminder-runtime-section"><strong>运行状态</strong><small>仅显示安全状态码，不展示邮件服务器的原始响应。</small>
      <div class="reminder-runtime-list">${renderReminderRuntimeStatus(settings)}</div>
    </div>`;
    return renderLegacyReminderSettingsCard(settings)
        .replace('<h2>邮件提醒</h2>', '<h2>发件服务</h2>')
        .replace('<div class="reminder-status-grid">', `${groupSection}${runtimeSection}<div class="reminder-status-grid legacy-reminder-status">`);
}

function renderSupplierMinimumSettingsCard(settings = systemSettings || {}, editable = currentIsAdmin) {
    const defaults = {
        '公开招标': 3, '竞争性磋商': 3, '竞争性谈判': 3, '邀请招标': 3,
        '网上竞价': 3, '单一来源': 1, '遴选': 3, '直选': 1,
    };
    const values = {...defaults, ...(settings.supplier_minimums || {})};
    const disabled = editable ? '' : 'disabled';
    return `<section class="settings-card settings-card-wide supplier-minimum-settings-card">
      <div class="settings-card-head">
        <div><h2>采购方式供应商最低数量</h2><p>用于报名截止前预警及截止时按采购包自动流标；采购包可单独覆盖并填写依据。</p></div>
      </div>
      <div class="supplier-minimum-grid">${METHODS.map(method => `<label>
        <span>${escHtml(method)}</span>
        <input type="number" min="1" max="99" step="1" data-supplier-minimum="${escHtml(method)}" value="${Number(values[method])}" ${disabled}>
        <small>家</small>
      </label>`).join('')}</div>
      <div class="settings-actions"><button class="btn btn-primary btn-sm" onclick="saveSupplierMinimumSettings(this)" ${disabled}>保存供应商数量规则</button></div>
      ${editable ? '' : '<div class="settings-note warning">只有管理员可以修改供应商最低数量规则。</div>'}
    </section>`;
}

function collectSupplierMinimumSettings() {
    return Object.fromEntries(
        [...document.querySelectorAll('[data-supplier-minimum]')]
            .map(input => [input.dataset.supplierMinimum, Number(input.value)]),
    );
}

async function saveSupplierMinimumSettings(button) {
    const values = collectSupplierMinimumSettings();
    if (Object.values(values).some(value => !Number.isInteger(value) || value < 1 || value > 99)) {
        toast('供应商最低数量必须为1至99的整数', 'warning');
        return;
    }
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', {supplier_minimums: values});
        systemSettings = await api('GET', '/api/settings');
        cacheCurrentSettingsView();
        renderSettingsView();
        toast(result.message || '供应商数量规则已保存', 'success');
    } catch (error) {
        if (button) button.disabled = false;
        toast(error.message || '供应商数量规则保存失败', 'error');
    }
}

let attachmentUploadLimitMb = null;

function normalizeAttachmentUploadLimitMb(value) {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 2048) {
        throw new Error('附件上传上限必须为 1 至 2048 之间的整数');
    }
    return parsed;
}

async function getAttachmentUploadLimitMb(force = false) {
    if (!force && Number.isInteger(attachmentUploadLimitMb)) return attachmentUploadLimitMb;
    const result = await api('GET', '/api/settings/upload-limit');
    attachmentUploadLimitMb = normalizeAttachmentUploadLimitMb(result.max_file_size_mb);
    if (systemSettings) systemSettings.max_file_size_mb = attachmentUploadLimitMb;
    if (systemInfo) systemInfo.max_file_size_mb = attachmentUploadLimitMb;
    return attachmentUploadLimitMb;
}

function attachmentUploadLimitBytes() {
    return (Number.isInteger(attachmentUploadLimitMb) ? attachmentUploadLimitMb : 1024) * 1024 * 1024;
}

async function saveAttachmentUploadLimit(button) {
    const input = document.getElementById('attachmentUploadLimitInput');
    let value;
    try {
        value = normalizeAttachmentUploadLimitMb(input && input.value);
    } catch (error) {
        toast(error.message, 'warning');
        if (input) input.focus();
        return;
    }
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings/upload-limit', {max_file_size_mb: value});
        attachmentUploadLimitMb = normalizeAttachmentUploadLimitMb(result.max_file_size_mb);
        if (systemSettings) systemSettings.max_file_size_mb = attachmentUploadLimitMb;
        if (systemInfo) systemInfo.max_file_size_mb = attachmentUploadLimitMb;
        cacheCurrentSettingsView();
        renderSettingsView();
        toast(result.message || '附件上传上限已保存', 'success');
    } catch (error) {
        if (button) button.disabled = false;
        toast(error.message || '附件上传上限保存失败', 'error');
    }
}

async function exportDataRecoveryKey(button) {
    if (!currentIsAdmin) return;
    if (button) button.disabled = true;
    try {
        const result = await api('POST', '/api/data-recovery/save', {});
        if (!result.saved || !result.path) throw new Error('服务器未确认保存成功，请重试');
        showModal('恢复密钥已保存', `
            <p>文件已写入设置中的导出目录：</p>
            <p class="recovery-saved-path" style="overflow-wrap:anywhere;user-select:text;padding:12px;background:var(--surface-subtle);border-radius:8px">${escHtml(result.path)}</p>
            <p>请将此文件复制到安全位置，与数据备份分开保存。</p>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">关闭</button>
                <button class="btn btn-primary" onclick="openExportFolder()">打开保存文件夹</button>
            </div>`);
    } catch (error) {
        toast(error.message || '保存恢复密钥失败', 'error');
    } finally {
        if (button) button.disabled = false;
    }
}

async function bindDataRecoveryKey(button) {
    const input = document.getElementById('dataRecoveryKeyInput');
    const recoveryKey = String(input?.value || '').trim();
    if (!recoveryKey) {
        toast('请先输入数据恢复密钥', 'warning');
        input?.focus();
        return;
    }
    if (button) button.disabled = true;
    try {
        await api('POST', '/api/data-recovery/bind', {recovery_key: recoveryKey});
        if (systemInfo) systemInfo.recovery_key_ready = true;
        cacheCurrentSettingsView();
        renderSettingsView();
        toast('恢复密钥已验证并绑定到当前电脑', 'success');
    } catch (error) {
        toast(error.message || '恢复密钥验证失败', 'error');
        input?.focus();
    } finally {
        if (input) input.value = '';
        if (button) button.disabled = false;
    }
}

function renderSettingsView() {
    const currentTheme = document.documentElement.dataset.theme || 'default';
    const compact = localStorage.getItem('pm_compact_mode') === '1';
    const defaultExportYear = localStorage.getItem('pm_default_export_year') || '';
    const previewInApp = localStorage.getItem('pm_preview_in_app') !== '0';
    const info = systemInfo || {};
    const settings = systemSettings || {};
    const desktop = isDesktopApp();
    const autoStartCard = renderAutoStartCard(desktop, currentIsAdmin, settings.startup_enabled === true, settings.startup_error || '');
    const adminTip = currentIsAdmin ? '' : '<div class="settings-note warning">只有管理员可以修改主机端设置。</div>';
    const brandSettingsCard = currentIsAdmin ? `
        <section class="settings-card settings-card-wide">
          <div class="settings-card-head">
            <div>
              <h2>登录页显示</h2>
              <p>设置系统名称下方的副标题，最多 60 个字符。</p>
            </div>
          </div>
          <div class="setting-field">
            <label>副标题</label>
            <div class="setting-path-row">
              <input id="loginSubtitleInput" maxlength="60" value="${escHtml(settings.login_subtitle || '采购项目管理系统')}" placeholder="请输入登录页副标题">
              <button class="btn btn-primary btn-sm" onclick="saveLoginSubtitle()">保存</button>
            </div>
          </div>
        </section>` : '';
    const saveSettingsCard = desktop && currentIsAdmin ? `
        <section class="settings-card settings-card-wide">
          <div class="settings-card-head">
            <div>
              <h2>文件保存设置</h2>
              <p>这里修改的是主机电脑的保存位置，项目导出和附件下载都会保存到这里。</p>
            </div>
          </div>
          <div class="setting-field">
            ${settings.configured_export_folder && settings.configured_export_folder !== settings.export_folder ? '<p role="status" style="color:var(--warning)">原保存目录不可用，当前使用 EXE 旁的 exports。请确认或重新选择文件夹并保存。</p>' : ''}
            <label>文件保存位置</label>
            <div class="setting-path-row">
              <input id="exportFolderInput" value="${escHtml(settings.export_folder || info.export_folder || '')}" ${currentIsAdmin ? '' : 'disabled'}>
              <button class="btn btn-primary btn-sm" onclick="saveExportFolder()" ${currentIsAdmin ? '' : 'disabled'}>保存</button>
            </div>
          </div>
          <div class="settings-actions">
            <button class="btn btn-secondary btn-sm" onclick="chooseExportFolder(this)" ${currentIsAdmin ? '' : 'disabled'}>选择文件夹</button>
            <button class="btn btn-secondary btn-sm" onclick="setExportFolderPreset('program')" ${currentIsAdmin ? '' : 'disabled'}>恢复默认（EXE 下 exports）</button>
            <button class="btn btn-secondary btn-sm" onclick="openExportFolder()" ${currentIsAdmin ? '' : 'disabled'}>打开保存目录</button>
          </div>
          ${adminTip}
        </section>` : !desktop ? `
        <section class="settings-card settings-card-wide">
          <div class="settings-card-head">
            <div>
              <h2>网页端下载</h2>
              <p>网页端导出和附件下载交给浏览器处理，文件会进入浏览器默认下载位置。</p>
            </div>
          </div>
          <div class="settings-note">
            如果需要修改下载位置，请在浏览器设置中调整；系统不会读取或修改访问电脑的本地磁盘路径。
          </div>
        </section>` : '';
    const uploadLimitCard = desktop && currentIsAdmin ? `
        <section class="settings-card settings-card-wide">
          <div class="settings-card-head"><div>
            <h2>附件上传上限</h2>
            <p>设置单个附件允许上传的最大容量，保存后立即生效。</p>
          </div></div>
          <div class="setting-field attachment-limit-setting">
            <label>单文件上限（MB）</label>
            <div class="setting-path-row">
              <input id="attachmentUploadLimitInput" type="number" min="1" max="2048" step="1" value="${Number(settings.max_file_size_mb || info.max_file_size_mb || 1024)}">
              <button class="btn btn-primary btn-sm" onclick="saveAttachmentUploadLimit(this)">保存</button>
            </div>
            <small>允许输入 1 至 2048 的整数。</small>
          </div>
        </section>` : '';
    const dataCard = desktop && currentIsAdmin && !info._loadError ? `
        <section class="settings-card settings-card-wide settings-data-card">
          <div class="settings-card-head">
            <div>
              <h2>数据与附件</h2>
              <p>这台运行桌面版的电脑就是主机，所有人上传的数据都保存在这里。</p>
            </div>
          </div>
          <div class="settings-list">
            <div><span>数据库加密</span><strong>${escHtml(info.database_encryption || '未启用')}</strong></div>
            <div><span>附件加密</span><strong>${escHtml(info.attachment_encryption || '未启用')}</strong></div>
            <div><span>备份计划</span><strong>${escHtml(info.backup_schedule || '')}</strong></div>
            <div><span>恢复密钥</span><strong>${info.recovery_key_ready ? '已就绪' : '未就绪'}</strong></div>
            <div><span>最近备份</span><code title="${escHtml(info.latest_backup || '')}">${escHtml(info.latest_backup || '程序将在每日 13:00 自动生成')}</code></div>
            <div><span>授权单位</span><strong>${escHtml((info.license||{}).organization || '未填写')}</strong></div>
            <div><span>授权期限</span><strong>${escHtml((info.license||{}).expires_at || '永久')}</strong></div>
            <div><span>单文件上限</span><strong>${info.max_file_size_mb || 1024} MB</strong></div>
          </div>
          <div class="setting-field recovery-export-panel">
            <label>换机与数据恢复</label>
            <p>在旧电脑生成当前数据的恢复密钥文件。每次生成对应同一份数据，不会更换加密密钥。</p>
            <button class="btn btn-primary btn-sm" onclick="exportDataRecoveryKey(this)">生成并保存恢复密钥</button>
            <small>保存到上方设置的导出目录，成功后显示完整路径。</small>
            <ol><li>生成密钥文件，单独保存到安全位置。</li><li>完全退出旧电脑程序后，复制完整数据目录及附件目录到新电脑，不能只复制 EXE。</li><li>在新电脑启动程序，出现数据恢复窗口时，粘贴密钥文件内容完成恢复。</li></ol>
            <small>密钥用于解密数据库与附件，不替代软件许可证；浏览器设备授权迁移请使用“设备准入”中的授权迁移。</small>
          </div>
          <div class="setting-field data-recovery-setting">
            <label>在当前电脑绑定数据恢复密钥</label>
            <div class="setting-path-row">
              <input id="dataRecoveryKeyInput" type="password" autocomplete="off" spellcheck="false" placeholder="粘贴恢复密钥或恢复密钥文件内容">
              <button class="btn btn-primary btn-sm" onclick="bindDataRecoveryKey(this)">验证并绑定</button>
            </div>
            <small>仅在主机电脑本机可用；密钥只用于本次验证，不会以明文保存。</small>
          </div>
          <details class="settings-details">
            <summary>查看技术信息</summary>
            <div class="settings-list">
              <div><span>程序目录</span><code title="${escHtml(info.base_dir || '')}">${escHtml(info.base_dir || '')}</code></div>
              <div><span>数据目录</span><code title="${escHtml(info.data_dir || '')}">${escHtml(info.data_dir || '')}</code></div>
              <div><span>数据库</span><code title="${escHtml(info.database_path || '')}">${escHtml(info.database_path || '')}</code></div>
              <div><span>附件目录</span><code title="${escHtml(info.upload_folder || '')}">${escHtml(info.upload_folder || '')}</code></div>
              <div><span>备份目录</span><code title="${escHtml(info.backup_folder || '')}">${escHtml(info.backup_folder || '')}</code></div>
              <div><span>设置文件</span><code title="${escHtml(settings.settings_path || info.settings_path || '')}">${escHtml(settings.settings_path || info.settings_path || '')}</code></div>
            </div>
          </details>
        </section>` : !desktop ? `
        <section class="settings-card settings-card-wide settings-lan-card">
          <div class="settings-card-head">
            <div>
              <h2>网页端说明</h2>
              <p>当前只是通过浏览器访问主机服务，本机不会保存系统数据库和附件原件。</p>
            </div>
          </div>
          <div class="settings-list">
            <div><span>当前地址</span><code>${escHtml(info.current_url || location.origin)}</code></div>
            <div><span>下载方式</span><strong>浏览器默认下载</strong></div>
            <div><span>单文件上限</span><strong>${info.max_file_size_mb || 1024} MB</strong></div>
          </div>
          <div class="settings-note">
            上传的附件和项目数据会保存到运行桌面版的主机电脑；网页端电脑只负责访问和下载。
          </div>
        </section>` : '';
    const themeCard = `
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <h2>主题</h2>
              <p>主题只保存在当前访问设备上，不影响其他电脑。</p>
            </div>
          </div>
          <div class="theme-grid">
            ${THEME_OPTIONS.map(t => `
              <button class="theme-option ${currentTheme === t.key ? 'active' : ''}" onclick="setTheme('${t.key}')">
                <span class="theme-swatch theme-${t.key}"></span>
                <span class="theme-text">
                  <strong>${t.name}</strong>
                  <small>${t.desc}</small>
                </span>
              </button>`).join('')}
          </div>
        </section>`;
    const generalCard = `
        <section class="settings-card">
          <div class="settings-card-head">
            <div>
              <h2>常规</h2>
              <p>${desktop ? '桌面端和局域网访问' : '网页访问'}的基础偏好。</p>
            </div>
          </div>
          <label class="setting-toggle">
            <input type="checkbox" ${compact ? 'checked' : ''} onchange="setCompactMode(this.checked)">
            <span></span>
            <div>
              <strong>紧凑显示</strong>
              <small>减少列表和卡片留白，适合项目较多时使用。</small>
            </div>
          </label>
          <label class="setting-toggle">
            <input type="checkbox" ${previewInApp ? 'checked' : ''} onchange="setPreviewMode(this.checked)">
            <span></span>
            <div>
              <strong>内置预览</strong>
              <small>${desktop ? '支持图片、PDF、Word、Excel 在系统内预览；关闭后用系统默认程序打开。' : '支持图片、PDF、Word、Excel 在系统内预览；关闭后用浏览器新标签打开。'}</small>
            </div>
          </label>
          <div class="setting-field">
            <label>默认导出年份</label>
            <select id="defaultExportYear" onchange="setDefaultExportYear(this.value)">
              <option value="">全部年份</option>
              ${[...new Set(allProjects.map(p => p.year).filter(Boolean))].sort((a,b)=>String(b).localeCompare(String(a))).map(y => `<option value="${escHtml(String(y))}" ${String(y) === defaultExportYear ? 'selected' : ''}>${escHtml(String(y))}</option>`).join('')}
            </select>
          </div>
        </section>`;
    const lanCard = `
        <section class="settings-card settings-card-wide settings-lan-card">
          <div class="settings-card-head">
            <div>
              <h2>局域网访问</h2>
              <p>其他电脑不需要安装，打开主机地址即可访问。</p>
            </div>
          </div>
          <div class="settings-list">
            <div><span>当前访问地址</span><code>${escHtml(info.current_url || location.origin)}</code></div>
            <div><span>主机 IP</span><strong>${escHtml(info.lan_ip || '未获取')}</strong></div>
            <div><span>局域网地址</span><code>${escHtml(info.lan_url || `http://主机IP:${info.lan_port || 5001}`)}</code></div>
          </div>
        </section>`;
    const panels = {
        general: `${themeCard}${generalCard}${brandSettingsCard}`,
        workflow: `<div id="stageOrderCardHost" class="settings-card-host-wide">${settings.stage_templates ? renderStageTemplateCard(settings, currentIsAdmin) : renderStageOrderCard(settings, currentIsAdmin)}</div>${renderSupplierMinimumSettingsCard(settings, currentIsAdmin)}`,
        email: renderReminderSettingsCard(settings),
        files: `${saveSettingsCard}${uploadLimitCard}${dataCard}`,
        system: `${autoStartCard}${lanCard}`,
        'device-access': currentIsAdmin ? `<div id="deviceAdmissionPanelHost" class="settings-card-host-wide">${renderDeviceAdmissionPanel()}</div>` : '',
        about: renderAboutCard(),
    };
    const infoWarning = info._loadError
        ? uiStateMarkup('warning', '系统信息暂时无法读取，其他设置可继续使用。', {actionLabel: '重新读取'}) : '';
    document.getElementById('settingsContent').innerHTML = infoWarning + renderSettingsNavigationShell(panels);
    if (info._loadError) document.querySelector('#settingsContent .ui-state-action')?.addEventListener('click', () => loadSettingsView({force: true}));
    if (currentIsAdmin && activeSettingsCategory === 'device-access') startDeviceAdmissionPanelPolling();
    else if (typeof stopDeviceAdmissionPanelPolling === 'function') stopDeviceAdmissionPanelPolling();
    settingsFormDirty = false;
}

function collectReminderSettings() {
    return {
        reminder_enabled: document.getElementById('reminderEnabled')?.checked === true,
        reminder_time: document.getElementById('reminderTime')?.value || '09:00',
        reminder_subject: (document.getElementById('reminderSubject')?.value || '').trim(),
        reminder_advance_days: Number(document.getElementById('reminderAdvanceDays')?.value || 0),
        reminder_weekdays: [...document.querySelectorAll('[data-reminder-weekday]:checked')]
            .map(input => Number(input.value)),
        smtp_host: (document.getElementById('smtpHost')?.value || '').trim(),
        smtp_port: Number(document.getElementById('smtpPort')?.value || 0),
        smtp_security: document.getElementById('smtpSecurity')?.value || 'ssl',
        smtp_username: (document.getElementById('smtpUsername')?.value || '').trim(),
        smtp_sender: (document.getElementById('smtpSender')?.value || '').trim(),
        smtp_password: document.getElementById('smtpPassword')?.value || '',
        reminder_recipients: (document.getElementById('reminderRecipients')?.value || '')
            .split(/[;,\n]+/).map(value => value.trim()).filter(Boolean),
        reminder_stage_keys: [...document.querySelectorAll('[data-reminder-stage]:checked')]
            .map(input => input.value),
        reminder_content: Object.fromEntries(
            [...document.querySelectorAll('[data-reminder-content]')]
                .map(input => [input.value, input.checked]),
        ),
        event_reminder_create_enabled: document.getElementById('eventReminderCreateEnabled')?.checked === true,
        event_reminder_complete_enabled: document.getElementById('eventReminderCompleteEnabled')?.checked === true,
        reminder_recipient_groups: currentRecipientGroups(),
    };
}

function openRecipientGroupDrawer(groupId) {
    const groups = currentRecipientGroups();
    const source = groups.find(group => group.id === groupId);
    recipientGroupDraft = source ? JSON.parse(JSON.stringify(source)) : {
        id: createRecipientGroupId(), name: '', enabled: true, order: groups.length, recipients: [],
        event_types: ['daily_stage'], content_fields: {project_number: true, project_name: true, stage_name: true, planned_at: true},
        subject_prefix: '',
    };
    const applicableFields = [...new Set(recipientGroupDraft.event_types.flatMap(type => REMINDER_EVENT_META[type]?.fields || []))];
    const previousDrawer = document.getElementById('recipientGroupDrawerOverlay');
    previousDrawer?.remove();
    if (previousDrawer) releaseDialogFocus(previousDrawer);
    const overlay = document.createElement('div');
    overlay.id = 'recipientGroupDrawerOverlay';
    overlay.className = 'recipient-group-drawer-overlay open';
    overlay.innerHTML = `<button class="recipient-group-drawer-backdrop" onclick="closeRecipientGroupDrawer()" aria-label="关闭"></button>
      <aside class="recipient-group-drawer" role="dialog" aria-modal="true" aria-label="编辑收件组">
        <div class="recipient-group-drawer-head"><div><strong>${source ? '编辑收件组' : '新增收件组'}</strong><small>最多 20 个组，每组最多 20 个邮箱</small></div><button class="btn btn-icon" onclick="closeRecipientGroupDrawer()"><span data-ui-icon='✕'></span></button></div>
        <div class="recipient-group-drawer-body">
          <div class="setting-field"><label>组名</label><input id="recipientGroupName" maxlength="40" value="${escHtml(recipientGroupDraft.name)}" placeholder="例如：项目负责人"></div>
          <div class="setting-field"><label>收件邮箱</label><textarea id="recipientGroupEmails" rows="5" placeholder="每行一个邮箱">${escHtml(recipientGroupDraft.recipients.join('\n'))}</textarea><small>邮箱不区分大小写，重复地址会自动合并。</small></div>
          <div class="setting-field"><label>主题前缀</label><input id="recipientGroupPrefix" maxlength="30" value="${escHtml(recipientGroupDraft.subject_prefix || '')}" placeholder="例如：风险"></div>
          <div class="recipient-drawer-section"><strong>提醒类型</strong><div class="recipient-drawer-checks">${Object.entries(REMINDER_EVENT_META).map(([type, meta]) => `<label><input type="checkbox" data-recipient-event value="${type}" ${recipientGroupDraft.event_types.includes(type) ? 'checked' : ''} onchange="refreshRecipientGroupDrawerFields()"><span>${meta.label}</span></label>`).join('')}</div></div>
          <div class="recipient-drawer-section"><strong>邮件内容字段</strong><div id="recipientGroupFieldChecks" class="recipient-drawer-checks">${renderRecipientGroupFieldChecks(applicableFields, recipientGroupDraft.content_fields)}</div></div>
          <div id="recipientDuplicateWarning">${renderRecipientDuplicateWarning(recipientGroupDraft, groups.map(group => group.id === recipientGroupDraft.id ? recipientGroupDraft : group))}</div>
          <div id="recipientGroupPreview" class="reminder-preview-panel" style="display:none"><strong>邮件预览</strong><div class="reminder-preview-field"><label>主题</label><pre data-preview-subject></pre></div><div class="reminder-preview-field"><label>正文</label><pre data-preview-body></pre></div></div>
        </div>
        <div class="recipient-group-drawer-actions"><button class="btn btn-secondary" onclick="previewRecipientGroup('${escHtml(recipientGroupDraft.id)}')">预览</button><button class="btn btn-secondary" data-group-test onclick="sendRecipientGroupTest('${escHtml(recipientGroupDraft.id)}')">发送测试</button><button class="btn btn-primary" onclick="saveRecipientGroupDraft()">保存收件组</button></div>
      </aside>`;
    document.body.appendChild(overlay);
    activateDialogFocus(overlay, closeRecipientGroupDrawer);
}

function renderRecipientGroupFieldChecks(fields, selected) {
    return fields.map(field => `<label><input type="checkbox" data-recipient-field value="${field}" ${selected[field] ? 'checked' : ''}><span>${escHtml(REMINDER_FIELD_LABELS[field] || field)}</span></label>`).join('');
}

function refreshRecipientGroupDrawerFields() {
    if (!recipientGroupDraft) return;
    const selectedEvents = [...document.querySelectorAll('[data-recipient-event]:checked')].map(input => input.value);
    const selectedFields = new Set([...document.querySelectorAll('[data-recipient-field]:checked')].map(input => input.value));
    const fields = [...new Set(selectedEvents.flatMap(type => REMINDER_EVENT_META[type]?.fields || []))];
    const target = document.getElementById('recipientGroupFieldChecks');
    if (target) target.innerHTML = renderRecipientGroupFieldChecks(fields, Object.fromEntries(fields.map(field => [field, selectedFields.has(field)])));
}

function closeRecipientGroupDrawer() {
    const overlay = document.getElementById('recipientGroupDrawerOverlay');
    overlay?.remove();
    if (overlay) releaseDialogFocus(overlay);
    recipientGroupDraft = null;
}

function collectRecipientGroupDraft() {
    const recipients = (document.getElementById('recipientGroupEmails')?.value || '').split(/[;,\n]+/).map(value => value.trim().toLowerCase()).filter(Boolean);
    return {
        ...recipientGroupDraft,
        name: (document.getElementById('recipientGroupName')?.value || '').trim(),
        recipients: [...new Set(recipients)],
        subject_prefix: (document.getElementById('recipientGroupPrefix')?.value || '').trim(),
        event_types: [...document.querySelectorAll('[data-recipient-event]:checked')].map(input => input.value),
        content_fields: Object.fromEntries([...document.querySelectorAll('[data-recipient-field]')].map(input => [input.value, input.checked])),
    };
}

function validateRecipientGroupDraft(group) {
    if (!group.name || group.name.length > 40) return '组名长度必须为 1 至 40 个字符';
    if (group.recipients.length > 20) return '每组最多允许 20 个邮箱';
    if (group.subject_prefix.length > 30 || /[\r\n]/.test(group.subject_prefix)) return '主题前缀最多 30 个字符且不能换行';
    if (group.recipients.some(email => !/^[^\s<>@,;:]+@[^\s<>@,;:]+\.[^\s<>@,;:]+$/.test(email))) return '邮箱格式不正确';
    if (group.enabled && !group.recipients.length) return '启用的收件组至少需要一个邮箱';
    if (group.enabled && !group.event_types.length) return '启用的收件组至少需要一种提醒类型';
    if (group.enabled && !Object.values(group.content_fields).some(Boolean)) return '启用的收件组至少需要一个适用内容字段';
    return '';
}

async function persistRecipientGroups(update, successMessage) {
    const previous=persistRecipientGroups.pending || Promise.resolve();
    const job=previous.catch(()=>{}).then(async()=>{
        const groups=update(currentRecipientGroups());
        if(!groups)return;
        const normalized=groups.map((group,index)=>({...group,order:index}));
        const result=await api('PATCH','/api/settings',{...collectReminderSettings(),reminder_recipient_groups:normalized});
        // Preserve the successful write even if the subsequent refresh fails.
        systemSettings={...systemSettings,...(result.settings || {}),reminder_recipient_groups:normalized};
        try {systemSettings=await api('GET','/api/settings');}
        catch(error){toast('收件组已保存，设置刷新失败，可稍后刷新','warning');}
        cacheCurrentSettingsView();
        renderSettingsView();
        toast(result.message || successMessage,'success');
    });
    persistRecipientGroups.pending=job;
    try {return await job;} finally {if(persistRecipientGroups.pending===job)persistRecipientGroups.pending=null;}
}

async function saveRecipientGroupDraft() {
    const group=collectRecipientGroupDraft();
    const error=validateRecipientGroupDraft(group);
    if(error)return toast(error,'warning');
    try {
        await persistRecipientGroups(groups=>{
            const index=groups.findIndex(item=>item.id===group.id);
            if(index>=0)groups[index]=group;else groups.push(group);
            if(groups.length>20)throw new Error('最多允许 20 个收件组');
            return groups;
        },'收件组已保存');
        closeRecipientGroupDrawer();
    }catch(error){toast(error.message || '收件组保存失败','error');}
}

async function copyRecipientGroup(groupId) {
    try {await persistRecipientGroups(groups=>{
        const source=groups.find(group=>group.id===groupId);
        if(!source)return null;
        if(groups.length>=20)throw new Error('最多允许 20 个收件组');
        groups.push({...JSON.parse(JSON.stringify(source)),id:createRecipientGroupId(),name:`${source.name}（副本）`.slice(0,40)});
        return groups;
    },'收件组已复制');}catch(error){toast(error.message || '复制失败','error');}
}

async function moveRecipientGroup(groupId, delta) {
    try {await persistRecipientGroups(groups=>{
        const index=groups.findIndex(group=>group.id===groupId),target=index+Number(delta);
        if(index<0 || target<0 || target>=groups.length)return null;
        [groups[index],groups[target]]=[groups[target],groups[index]];
        return groups;
    },'收件组顺序已更新');}catch(error){toast(error.message || '排序失败','error');}
}

async function toggleRecipientGroup(groupId) {
    try {await persistRecipientGroups(groups=>{
        const group=groups.find(item=>item.id===groupId);
        if(!group)return null;
        group.enabled=!group.enabled;
        const error=validateRecipientGroupDraft(group);
        if(error)throw new Error(error);
        return groups;
    },'收件组状态已更新');}catch(error){toast(error.message || '状态更新失败','error');}
}

async function deleteRecipientGroup(groupId) {
    if(!confirm('确定删除这个收件组吗？'))return;
    try {await persistRecipientGroups(groups=>groups.filter(group=>group.id!==groupId),'收件组已删除');}
    catch(error){toast(error.message || '删除失败','error');}
}

async function previewRecipientGroup(groupId) {
    const draft = recipientGroupDraft ? collectRecipientGroupDraft() : currentRecipientGroups().find(group => group.id === groupId);
    const error = draft && validateRecipientGroupDraft(draft);
    if (!draft || error) return toast(error || '收件组不存在', 'warning');
    const groups = currentRecipientGroups();
    const index = groups.findIndex(group => group.id === draft.id);
    if (index >= 0) groups[index] = draft; else groups.push(draft);
    try {
        const result = await api('PATCH', '/api/settings', {...collectReminderSettings(), reminder_recipient_groups: groups, reminder_action: 'preview_group', reminder_group_id: draft.id, reminder_event_type: draft.event_types[0]});
        const panel = document.getElementById('recipientGroupPreview');
        if (panel && result.preview) {
            panel.querySelector('[data-preview-subject]').textContent = result.preview.subject || '';
            panel.querySelector('[data-preview-body]').textContent = result.preview.body || '';
            panel.style.display = '';
        }
        toast(result.message || '邮件预览已生成', 'success');
    } catch (error_) { toast(error_.message || '邮件预览生成失败', 'error'); }
}

async function sendRecipientGroupTest(groupId) {
    const button = document.querySelector('[data-group-test]');
    const draft = recipientGroupDraft ? collectRecipientGroupDraft() : currentRecipientGroups().find(group => group.id === groupId);
    const error = draft && validateRecipientGroupDraft(draft);
    if (!draft || error) return toast(error || '收件组不存在', 'warning');
    const groups = currentRecipientGroups();
    const index = groups.findIndex(group => group.id === draft.id);
    if (index >= 0) groups[index] = draft; else groups.push(draft);
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', {...collectReminderSettings(), reminder_recipient_groups: groups, reminder_action: 'send_group_test', reminder_group_id: draft.id, reminder_event_type: draft.event_types[0]});
        toast(result.message || '测试邮件已发送', 'success');
    } catch (error_) {
        toast(error_.error_code === 'TEST_EMAIL_RATE_LIMITED' ? '操作过于频繁，请 60 秒后重试' : (error_.message || '测试邮件发送失败'), 'error');
    } finally { if (button) button.disabled = false; }
}

async function saveReminderSettings(button) {
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', collectReminderSettings());
        systemSettings = await api('GET', '/api/settings');
        cacheCurrentSettingsView();
        renderSettingsView();
        toast(result.message || '邮件提醒设置已保存', 'success');
    } catch (error) {
        if (button) button.disabled = false;
        toast(error.message || '邮件提醒设置保存失败', 'error');
    }
}

async function previewReminderEmail(button) {
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', {
            ...collectReminderSettings(),
            reminder_action: 'preview',
        });
        systemSettings = await api('GET', '/api/settings');
        cacheCurrentSettingsView();
        renderSettingsView();
        const panel = document.getElementById('reminderPreviewPanel');
        const subjectEl = document.getElementById('reminderPreviewSubject');
        const bodyEl = document.getElementById('reminderPreviewBody');
        if (result.preview) {
            if (subjectEl) subjectEl.textContent = result.preview.subject || '';
            if (bodyEl) bodyEl.textContent = result.preview.body || '';
            if (panel) panel.style.display = '';
        }
        toast(result.message || '邮件预览已生成', 'success');
    } catch (error) {
        if (button) button.disabled = false;
        toast(error.message || '邮件预览生成失败', 'error');
    }
}

async function sendReminderTestEmail(button) {
    const selectedProvider = document.getElementById('smtpProvider')?.value || 'custom';
    if (selectedProvider === 'outlook') {
        toast('Outlook/Hotmail 需要 OAuth2 现代身份验证，当前不能使用 SMTP 密码发送测试邮件', 'warning');
        return;
    }
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', {
            ...collectReminderSettings(),
            reminder_action: 'send_test',
        });
        systemSettings = await api('GET', '/api/settings');
        cacheCurrentSettingsView();
        renderSettingsView();
        const requeued = Number(result.requeued_failed_reminders || 0);
        toast(
            requeued > 0
                ? `测试邮件已发送，已重新排队 ${requeued} 条有效阶段提醒`
                : (result.message || '测试邮件已发送'),
            'success',
        );
    } catch (error) {
        if (button) button.disabled = false;
        toast(error.message || '测试邮件发送失败', 'error');
    }
}

function setTheme(theme) {
    applyTheme(theme);
    renderSettingsView();
    toast('主题已切换', 'success');
}

async function saveLoginSubtitle() {
    if (!currentIsAdmin) return toast('只有管理员可以修改登录页副标题', 'error');
    const value = (document.getElementById('loginSubtitleInput')?.value || '').trim();
    if (!value) return toast('副标题不能为空', 'warning');
    try {
        await api('PATCH', '/api/settings', { login_subtitle: value });
        systemSettings = await api('GET', '/api/settings');
        cacheCurrentSettingsView();
        renderSettingsView();
        toast('登录页副标题已更新', 'success');
    } catch (e) {
        toast(e.message || '保存失败', 'error');
    }
}

function setCompactMode(enabled) {
    localStorage.setItem('pm_compact_mode', enabled ? '1' : '0');
    document.documentElement.classList.toggle('compact-mode', enabled);
    toast(enabled ? '已开启紧凑显示' : '已关闭紧凑显示', 'success');
}

function setPreviewMode(enabled) {
    localStorage.setItem('pm_preview_in_app', enabled ? '1' : '0');
    toast(enabled ? '已开启内置预览' : '已关闭内置预览', 'success');
}

function setDefaultExportYear(year) {
    localStorage.setItem('pm_default_export_year', year || '');
    const select = document.getElementById('exportYearSelect');
    if (select) select.value = year || '';
    toast('默认导出年份已保存', 'success');
}

async function setAutoStart(enabled, input) {
    const previous = !enabled;
    if (input) input.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', {startup_enabled: enabled});
        systemSettings = await api('GET', '/api/settings');
        if (typeof cacheCurrentSettingsView === 'function') cacheCurrentSettingsView();
        renderSettingsView();
        toast(result.message || (enabled ? '已开启开机自动启动' : '已关闭开机自动启动'), 'success');
    } catch (e) {
        if (input) {
            input.checked = previous;
            input.disabled = false;
        }
        toast(e.message || '开机启动设置保存失败', 'error');
    }
}

async function chooseExportFolder(button) {
    if (button) button.disabled = true;
    try {
        const result = await api('POST', '/api/settings/choose-export-folder', {});
        if (result.path) {
            document.getElementById('exportFolderInput').value = result.path;
            await saveExportFolder(result.path);
        }
    } catch (error) { toast(error.message || '选择文件夹失败', 'error'); }
    finally { if (button) button.disabled = false; }
}

async function saveExportFolder(path) {
    const input = document.getElementById('exportFolderInput');
    const exportFolder = path || input?.value || '';
    try {
        const result = await api('PATCH', '/api/settings', { export_folder: exportFolder });
        systemSettings = await api('GET', '/api/settings');
        systemInfo = await api('GET', '/api/system-info');
        cacheCurrentSettingsView();
        renderSettingsView();
        toast(result.message || '设置已保存', 'success');
    } catch(e) {
        toast('❌ 保存失败：' + e.message, 'error');
    }
}

function setExportFolderPreset(type) {
    const settings = systemSettings || {};
    const target = type === 'program' ? settings.program_export_folder : settings.desktop_export_folder;
    if (target) {
        const input = document.getElementById('exportFolderInput');
        if (input) input.value = target;
    }
}

async function openExportFolder() {
    try {
        const result = await api('POST', '/api/settings/open-export-folder', {});
        toast(result.message || '已打开保存目录', 'success');
    } catch(e) {
        toast('❌ 打开失败：' + e.message, 'error');
    }
}

function initDisplayPreferences() {
    initTheme();
    document.documentElement.classList.toggle('compact-mode', localStorage.getItem('pm_compact_mode') === '1');
}


// ── Current User / User Management ──
function initUserUI() {
    const u = window.CURRENT_USER || {id:0, username:'', is_admin:false};
    document.getElementById('userName').textContent = u.username || '';
    document.getElementById('menuUserName').textContent = u.username || '';
    document.getElementById('menuUserRole').textContent = u.is_admin ? '管理员' : '普通用户';
    document.getElementById('menuUserMgmt').style.display = u.is_admin ? '' : 'none';
}

function toggleUserMenu(e) {
    e.stopPropagation();
    const m = document.getElementById('userMenu');
    if (m.classList.toggle('open')) {
        document.addEventListener('click', closeUserMenuOutside);
    } else {
        document.removeEventListener('click', closeUserMenuOutside);
    }
}
function closeUserMenuOutside(e) {
    const m = document.getElementById('userMenu');
    const b = document.getElementById('userBtn');
    if (!m.contains(e.target) && !b.contains(e.target)) {
        m.classList.remove('open');
        document.removeEventListener('click', closeUserMenuOutside);
    }
}

// ── Change Password (self) ──
function openChangePassword() {
    document.getElementById('userMenu').classList.remove('open');
    const {overlay, modal, title, body} = resetModalState();
    title.textContent = '修改密码';
    body.innerHTML = `
      <div class="form-group"><label>当前密码</label><input type="password" id="cpOld" placeholder="请输入当前密码" autocomplete="current-password"></div>
      <div class="form-group"><label>新密码</label><input type="password" id="cpNew" placeholder="至少 8 位" autocomplete="new-password"></div>
      <div class="form-group"><label>确认新密码</label><input type="password" id="cpNew2" placeholder="再次输入新密码" autocomplete="new-password"></div>
      <div class="form-group" style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        <button class="btn btn-primary" data-dialog-submit onclick="submitChangePassword()">保存</button>
      </div>`;
    overlay.classList.add('open');
    modal.classList.add('open');
    activateDialogFocus(modal, closeModal);
}
async function submitChangePassword() {
    const oldP = document.getElementById('cpOld').value;
    const newP = document.getElementById('cpNew').value;
    const newP2 = document.getElementById('cpNew2').value;
    if (!oldP || !newP) { toast('请填写完整', 'error'); return; }
    if (newP.length < 8) { toast('密码至少 8 位', 'error'); return; }
    if (newP !== newP2) { toast('两次输入的新密码不一致', 'error'); return; }
    try {
        await api('POST', '/api/me/change-password', {old_password: oldP, new_password: newP});
        toast('✅ 密码已修改，请牢记新密码', 'success');
        closeModal();
    } catch(e) { toast('❌ ' + e.message, 'error'); }
}

// ── User Management (admin) ──
let userManagementUsers = [];

async function openUserManagement() {
    document.getElementById('userMenu').classList.remove('open');
    const {overlay, modal, title, body} = resetModalState({wide: true});
    title.textContent = '用户管理';
    body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--text2)">加载中…</div>';
    overlay.classList.add('open');
    modal.classList.add('open');
    activateDialogFocus(modal, closeModal);
    try {
        userManagementUsers = await api('GET', '/api/users');
        renderUserList();
    } catch(e) {
        document.getElementById('modalBody').innerHTML = '<p style="color:var(--danger)">'+escHtml(e.message)+'</p>';
    }
}
function renderUserList() {
    const users = userManagementUsers || [];
    const curId = (window.CURRENT_USER||{}).id;
    const keyword = (document.getElementById('userSearchInput')?.value || '').trim().toLowerCase();
    const filtered = users.filter(u => {
        const hay = `${u.username || ''} ${u.display_name || ''} ${u.is_admin ? '管理员' : '普通用户'} ${u.is_active ? '启用' : '禁用'}`.toLowerCase();
        return !keyword || hay.includes(keyword);
    });
    const total = users.length;
    const active = users.filter(u => u.is_active).length;
    const admins = users.filter(u => u.is_admin).length;
    let rows = filtered.map(u => `
      <div class="user-row-item">
        <div class="user-row-main">
          <div class="user-row-name">
            ${escHtml(u.display_name || u.username)}
            <span class="user-row-uname">@${escHtml(u.username)}</span>
            ${u.id === curId ? '<span class="tag tag-current">当前账号</span>' : ''}
          </div>
          <div class="user-row-tags">
            ${u.is_admin ? '<span class="tag tag-admin">管理员</span>' : '<span class="tag">普通用户</span>'}
            ${u.is_active ? '<span class="tag tag-on">启用</span>' : '<span class="tag tag-off">已禁用</span>'}
          </div>
        </div>
        <div class="user-row-actions">
          <button class="btn btn-secondary btn-sm" onclick="toggleUserActive(${u.id})" ${u.id===curId ? 'disabled' : ''}>${u.is_active ? '禁用' : '启用'}</button>
          <button class="btn btn-secondary btn-sm" onclick="showUserForm(${u.id})">编辑</button>
          <button class="btn btn-secondary btn-sm" onclick="resetUserPassword(${u.id})">重置密码</button>
          <button class="btn btn-danger btn-sm" onclick="deleteUser(${u.id})" ${u.id===curId ? 'disabled' : ''}>删除</button>
        </div>
      </div>`).join('');
    document.getElementById('modalBody').innerHTML = `
      <div class="user-admin-panel">
        <div class="user-admin-toolbar">
          <div class="user-admin-stats">
            <span>用户 ${total}</span>
            <span>启用 ${active}</span>
            <span>管理员 ${admins}</span>
          </div>
          <button class="btn btn-primary" onclick="showUserForm(0)">＋ 新增用户</button>
        </div>
        <input class="user-search-input" id="userSearchInput" placeholder="搜索账号、姓名、角色或状态..." value="${escHtml(keyword)}" oninput="renderUserList()">
        <div class="user-list">${rows || '<div class="user-empty">没有匹配的用户</div>'}</div>
      </div>`;
    const search = document.getElementById('userSearchInput');
    if (search) {
        search.focus();
        search.setSelectionRange(search.value.length, search.value.length);
    }
}
function showUserForm(uid) {
    const isEdit = !!uid;
    const u = isEdit ? userManagementUsers.find(x => x.id === uid) : null;
    const {title, body} = resetModalState();
    title.textContent = isEdit ? '编辑用户' : '新增用户';
    body.innerHTML = `
      <input type="hidden" id="ufId" value="${uid||0}">
      <div class="form-group"><label>账号（登录名）</label><input type="text" id="ufUsername" placeholder="2-32位，字母/数字/._-" value="${escHtml(u?.username || '')}"></div>
      <div class="form-group"><label>显示名（可选）</label><input type="text" id="ufDisplayName" placeholder="如：张三" value="${escHtml(u?.display_name || '')}"></div>
      <div class="form-group"><label>${isEdit ? '重置密码（留空则不修改）' : '密码'}（至少 8 位）</label><input type="password" id="ufPassword" placeholder="${isEdit ? '留空则不修改' : '设置密码'}" autocomplete="new-password"></div>
      <div class="form-group" style="display:flex;gap:18px;flex-wrap:wrap">
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" id="ufAdmin" ${u?.is_admin ? 'checked' : ''}> 管理员</label>
        <label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" id="ufActive" ${!isEdit || u?.is_active ? 'checked' : ''}> 启用</label>
      </div>
      <div class="form-group" style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn btn-secondary" onclick="openUserManagement()">取消</button>
        <button class="btn btn-primary" data-dialog-submit onclick="saveUser()">保存</button>
      </div>`;
    if (u?.id === (window.CURRENT_USER||{}).id) {
        document.getElementById('ufAdmin').disabled = true;
        document.getElementById('ufActive').disabled = true;
        document.getElementById('ufAdmin').parentElement.title = '不能取消自己的管理员权限';
        document.getElementById('ufActive').parentElement.title = '不能禁用自己的账号';
    }
    activateDialogFocus(document.getElementById('modal'), closeModal);
}
async function saveUser() {
    const id = parseInt(document.getElementById('ufId').value, 10) || 0;
    const payload = {
        username: document.getElementById('ufUsername').value.trim(),
        display_name: document.getElementById('ufDisplayName').value.trim(),
        password: document.getElementById('ufPassword').value,
        is_admin: document.getElementById('ufAdmin').checked,
        is_active: document.getElementById('ufActive').checked,
    };
    if (!payload.username) { toast('账号不能为空', 'error'); return; }
    try {
        if (id) { await api('PUT', '/api/users/'+id, payload); }
        else { await api('POST', '/api/users', payload); }
        toast('✅ 已保存', 'success');
        openUserManagement();
    } catch(e) { toast('❌ ' + e.message, 'error'); }
}
async function deleteUser(uid) {
    if (!(await confirmDialog('删除用户', '确定删除该用户？此操作不可恢复。', '删除', 'btn-danger'))) return;
    try {
        await api('DELETE', '/api/users/'+uid);
        toast('🗑️ 已删除', 'info');
        openUserManagement();
    } catch(e) { toast('❌ ' + e.message, 'error'); }
}
async function toggleUserActive(uid) {
    const u = userManagementUsers.find(x => x.id === uid);
    if (!u) return;
    const action = u.is_active ? '禁用' : '启用';
    if (u.is_active && !(await confirmDialog(`${action}用户`, `确定${action}「${u.display_name || u.username}」？`, action, 'btn-warning'))) return;
    try {
        await api('PUT', '/api/users/'+uid, {is_active: !u.is_active});
        toast(`已${action}`, 'success');
        userManagementUsers = await api('GET', '/api/users');
        renderUserList();
    } catch(e) { toast('❌ ' + e.message, 'error'); }
}
async function resetUserPassword(uid) {
    const res = await reasonDialog('重置密码', '为该用户设置新密码（至少 8 位）：', '新密码');
    if (!res.ok) return;
    const p = (res.value||'').trim();
    if (p.length < 8) { toast('密码至少 8 位', 'error'); return; }
    try {
        await api('POST', '/api/users/'+uid+'/reset-password', {password: p});
        toast('✅ 密码已重置', 'success');
    } catch(e) { toast('❌ ' + e.message, 'error'); }
}

initDisplayPreferences();
initUserUI();
