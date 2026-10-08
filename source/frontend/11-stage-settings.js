// ── Configurable global stage workflow ──
let stageOrderDraft = null;
let stageOrderDirty = false;
let stageOrderSaving = false;
let draggedStageOrderKey = '';

function defaultClientStageOrder() {
    return STAGES.map(stage => String(stage.key));
}

function normalizeClientStageOrder(raw) {
    const defaults = defaultClientStageOrder();
    if (!Array.isArray(raw)
        || raw.length !== defaults.length
        || raw.some(value => typeof value !== 'string')
        || new Set(raw).size !== raw.length
        || raw.some(key => !defaults.includes(key))) {
        return defaults;
    }
    return [...raw];
}

function getOrderedStages() {
    const order = normalizeClientStageOrder(systemSettings?.stage_order);
    const byKey = new Map(STAGES.map(stage => [String(stage.key), stage]));
    return order.map(key => byKey.get(key));
}

function orderProjectStages(stages) {
    const rows = [...(Array.isArray(stages) ? stages : [])];
    const hasOrder = row => row?.order !== null && row?.order !== '' && Number.isFinite(Number(row?.order));
    if (!rows.some(hasOrder)) return rows;
    return rows
        .map((row, index) => ({row, index}))
        .sort((left, right) => {
            const leftOrder = hasOrder(left.row) ? Number(left.row.order) : Number.MAX_SAFE_INTEGER;
            const rightOrder = hasOrder(right.row) ? Number(right.row.order) : Number.MAX_SAFE_INTEGER;
            return leftOrder - rightOrder || left.index - right.index;
        })
        .map(entry => entry.row);
}

function beginStageOrderDraft(settings = systemSettings || {}) {
    if (!stageOrderDirty || !Array.isArray(stageOrderDraft)) {
        stageOrderDraft = normalizeClientStageOrder(settings.stage_order);
        stageOrderDirty = false;
    }
    return [...stageOrderDraft];
}

function getStageOrderDraft() {
    return [...beginStageOrderDraft()];
}

function refreshStageOrderEditor() {
    const container = document.getElementById('stageOrderCardHost');
    if (container) container.innerHTML = renderStageOrderCard(systemSettings || {}, currentIsAdmin);
}

function moveStageOrder(key, delta) {
    beginStageOrderDraft();
    const index = stageOrderDraft.indexOf(String(key));
    const destination = index + Number(delta || 0);
    if (index < 0 || destination < 0 || destination >= stageOrderDraft.length) return false;
    [stageOrderDraft[index], stageOrderDraft[destination]] = [
        stageOrderDraft[destination], stageOrderDraft[index],
    ];
    stageOrderDirty = true;
    refreshStageOrderEditor();
    return true;
}

function reorderStageDraft(sourceKey, targetKey) {
    beginStageOrderDraft();
    const sourceIndex = stageOrderDraft.indexOf(String(sourceKey));
    const targetIndex = stageOrderDraft.indexOf(String(targetKey));
    if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return false;
    const [moved] = stageOrderDraft.splice(sourceIndex, 1);
    stageOrderDraft.splice(targetIndex, 0, moved);
    stageOrderDirty = true;
    refreshStageOrderEditor();
    return true;
}

function resetStageOrderDraft() {
    stageOrderDraft = defaultClientStageOrder();
    stageOrderDirty = true;
    refreshStageOrderEditor();
}

function handleStageOrderDragStart(event) {
    draggedStageOrderKey = String(event.currentTarget?.dataset?.stageOrderKey || '');
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', draggedStageOrderKey);
    }
}

function handleStageOrderDragOver(event) {
    event.preventDefault();
    event.currentTarget?.classList?.add('drag-target');
}

function handleStageOrderDragLeave(event) {
    event.currentTarget?.classList?.remove('drag-target');
}

function handleStageOrderDrop(event) {
    event.preventDefault();
    event.currentTarget?.classList?.remove('drag-target');
    const sourceKey = event.dataTransfer?.getData('text/plain') || draggedStageOrderKey;
    const targetKey = event.currentTarget?.dataset?.stageOrderKey || '';
    reorderStageDraft(sourceKey, targetKey);
    draggedStageOrderKey = '';
}

async function refreshStageOrderConsumers() {
    try {
        if (typeof loadAllProjects === 'function') await loadAllProjects();
        if (typeof currentProject !== 'undefined' && currentProject) {
            if (typeof dropProjectDetail === 'function') dropProjectDetail(currentProject.id);
            if (typeof refreshProject === 'function') await refreshProject();
        }
    } catch (error) {
        if (typeof console !== 'undefined' && console.error) {
            console.error('刷新阶段顺序相关视图失败', error);
        }
        toast('阶段顺序已保存，部分视图刷新失败，请重新打开项目', 'warning');
    }
}

async function saveStageOrder(button) {
    if (!currentIsAdmin || stageOrderSaving) {
        if (!currentIsAdmin) toast('只有管理员可以修改阶段顺序', 'error');
        return false;
    }
    beginStageOrderDraft();
    stageOrderSaving = true;
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', {
            stage_order: [...stageOrderDraft],
        });
        const savedOrder = normalizeClientStageOrder(
            result?.settings?.stage_order || stageOrderDraft,
        );
        if (systemSettings) systemSettings.stage_order = savedOrder;
        stageOrderDraft = [...savedOrder];
        stageOrderDirty = false;
        await refreshStageOrderConsumers();
        toast(result?.message || '阶段顺序已保存', 'success');
        if (typeof renderSettingsView === 'function') renderSettingsView();
        return true;
    } catch (error) {
        toast(error?.message || '阶段顺序保存失败', 'error');
        refreshStageOrderEditor();
        return false;
    } finally {
        stageOrderSaving = false;
        if (button) button.disabled = false;
    }
}

function renderStageOrderCard(settings, editable) {
    beginStageOrderDraft(settings || {});
    const byKey = new Map(STAGES.map(stage => [String(stage.key), stage]));
    const disabled = editable ? '' : 'disabled';
    const rows = stageOrderDraft.map((key, index) => {
        const stage = byKey.get(key) || {key, name: key, icon: '•'};
        return `<li class="stage-order-row" draggable="${editable ? 'true' : 'false'}" data-stage-order-key="${escHtml(key)}" ondragstart="handleStageOrderDragStart(event)" ondragover="handleStageOrderDragOver(event)" ondragleave="handleStageOrderDragLeave(event)" ondrop="handleStageOrderDrop(event)">
          <span class="stage-order-position">${index + 1}</span>
          <span class="stage-order-handle" aria-hidden="true">⋮⋮</span>
          <span class="stage-order-icon"><span data-ui-icon="${escHtml(stage.icon || '•')}"></span></span>
          <strong>${escHtml(stage.name || key)}</strong>
          <span class="stage-order-actions">
            <button type="button" class="btn btn-secondary btn-sm" onclick="moveStageOrder('${escHtml(key)}',-1)" ${index === 0 || !editable ? 'disabled' : ''} aria-label="上移 ${escHtml(stage.name || key)}">上移</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="moveStageOrder('${escHtml(key)}',1)" ${index === stageOrderDraft.length - 1 || !editable ? 'disabled' : ''} aria-label="下移 ${escHtml(stage.name || key)}">下移</button>
          </span>
        </li>`;
    }).join('');
    return `<section class="settings-card settings-card-wide stage-order-card">
      <div class="settings-card-head"><div><h2>阶段顺序</h2><p>保存后将改变所有项目的真实流程、当前阶段、下一阶段、提醒与导出顺序。</p></div></div>
      <ol class="stage-order-list">${rows}</ol>
      <div class="settings-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="resetStageOrderDraft()" ${disabled}>恢复默认</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="saveStageOrder(this)" ${disabled}>保存阶段顺序</button>
        ${stageOrderDirty ? '<span class="stage-order-unsaved">有未保存的调整</span>' : ''}
      </div>
      ${editable ? '' : '<div class="settings-note warning">只有管理员可以修改阶段顺序。</div>'}
    </section>`;
}

// ── Procurement-method stage templates ──
let stageTemplateDraft = null;
let stageTemplateMethod = '';
let stageTemplateDirty = false;
let stageTemplateSaving = false;
const expandedStageTemplateIds = new Set();

const STAGE_ICON_OPTIONS = ['📥', '📋', '📝', '📢', '📅', '👥', '✅', '🔍', '🎯', '🤝', '🏆', '📄', '💰', '💳', '📦', '📌', '⚙️', '🔔', '⏳', '🚀'];

function clientProcurementMethods() {
    return Array.isArray(METHODS) ? METHODS.map(String) : [];
}

function legacyClientStageModules(stageKey) {
    const moduleByStage = {
        doc_prepare: 'responsible_person',
        doc_review: 'responsible_person',
        announcement: 'clarification',
        registration_end: 'registration',
        bid_opening: 'bid_opening',
        evaluation: 'evaluation',
        result_announced: 'result_publication',
        winning_notice: 'winning_notice',
        service_fee: 'service_fee',
        deposit_refund: 'deposit_refund',
        archived: 'archive',
    };
    const autoCompletion = ['registration_end', 'bid_opening', 'evaluation'].includes(stageKey);
    return ['common', 'checklist', ...(moduleByStage[stageKey] ? [moduleByStage[stageKey]] : []), ...(autoCompletion ? ['auto_completion'] : [])];
}

function defaultClientStageTemplates(settings = systemSettings || {}) {
    const order = normalizeClientStageOrder(settings.stage_order);
    const byKey = new Map(STAGES.map(stage => [String(stage.key), stage]));
    return Object.fromEntries(clientProcurementMethods().map(method => [method, method === '网上竞价' && typeof onlineBiddingTemplate === 'function' ? onlineBiddingTemplate() : order.map(key => {
        const stage = byKey.get(key) || {key, name: key, icon: '•'};
        return {id: key, name: String(stage.name || key), icon: String(stage.icon || '•'), modules: legacyClientStageModules(key)};
    })]));
}

function normalizeClientStageTemplates(raw, settings = systemSettings || {}) {
    const fallback = defaultClientStageTemplates(settings);
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fallback;
    const methods = clientProcurementMethods();
    if (methods.some(method => !Array.isArray(raw[method]) || !raw[method].length)) return fallback;
    const result = {};
    for (const method of methods) {
        const ids = new Set();
        result[method] = raw[method].map((row, index) => {
            const id = String(row?.id || `stage_${index + 1}`).trim();
            if (!id || ids.has(id)) return null;
            ids.add(id);
            const modules = Array.isArray(row?.modules) ? row.modules.map(String) : [];
            return {
                id,
                name: String(row?.name || id).trim(),
                icon: String(row?.icon || '•').trim() || '•',
                modules: ['common', ...modules.filter((value, position) => value !== 'common' && modules.indexOf(value) === position)],
            };
        });
        if (result[method].some(row => !row || !row.name)) return fallback;
    }
    return result;
}

function beginStageTemplateDraft(settings = systemSettings || {}) {
    if (!stageTemplateDraft || !stageTemplateDirty) {
        stageTemplateDraft = normalizeClientStageTemplates(settings.stage_templates, settings);
        stageTemplateDraft = JSON.parse(JSON.stringify(stageTemplateDraft));
        if (!clientProcurementMethods().includes(stageTemplateMethod)) {
            stageTemplateMethod = clientProcurementMethods()[0] || '';
        }
        stageTemplateDirty = false;
    }
    return stageTemplateDraft;
}

function getCurrentStageTemplateDraft() {
    beginStageTemplateDraft();
    return stageTemplateDraft[stageTemplateMethod] || [];
}

function refreshStageTemplateEditor() {
    const container = document.getElementById('stageOrderCardHost');
    if (container) container.innerHTML = renderStageTemplateCard(systemSettings || {}, currentIsAdmin);
}

function selectStageTemplateMethod(method) {
    beginStageTemplateDraft();
    if (!clientProcurementMethods().includes(String(method))) return false;
    stageTemplateMethod = String(method);
    refreshStageTemplateEditor();
    return true;
}

function createStageTemplateId() {
    return `stage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function addStageTemplateDraft() {
    const id = createStageTemplateId();
    getCurrentStageTemplateDraft().push({id, name: '新阶段', icon: '📌', modules: ['common']});
    expandedStageTemplateIds.add(id);
    stageTemplateDirty = true;
    refreshStageTemplateEditor();
}

function removeStageTemplateDraft(id) {
    const rows = getCurrentStageTemplateDraft();
    if (rows.length <= 1) {
        toast('每种采购方式至少保留一个阶段', 'error');
        return false;
    }
    stageTemplateDraft[stageTemplateMethod] = rows.filter(row => row.id !== String(id));
    expandedStageTemplateIds.delete(String(id));
    stageTemplateDirty = true;
    refreshStageTemplateEditor();
    return true;
}

function moveStageTemplateDraft(id, delta) {
    const rows = getCurrentStageTemplateDraft();
    const index = rows.findIndex(row => row.id === String(id));
    const destination = index + Number(delta || 0);
    if (index < 0 || destination < 0 || destination >= rows.length) return false;
    [rows[index], rows[destination]] = [rows[destination], rows[index]];
    stageTemplateDirty = true;
    refreshStageTemplateEditor();
    return true;
}

function updateStageTemplateDraft(id, field, value) {
    const row = getCurrentStageTemplateDraft().find(item => item.id === String(id));
    if (!row || !['name', 'icon'].includes(field)) return false;
    row[field] = String(value ?? '');
    stageTemplateDirty = true;
    return true;
}

function toggleStageTemplateModule(id, moduleId, checked) {
    const row = getCurrentStageTemplateDraft().find(item => item.id === String(id));
    if (!row || moduleId === 'common') return false;
    const modules = new Set(row.modules || ['common']);
    if (checked) modules.add(String(moduleId)); else modules.delete(String(moduleId));
    row.modules = ['common', ...[...modules].filter(value => value !== 'common')];
    stageTemplateDirty = true;
    refreshStageTemplateEditor();
    return true;
}

function toggleStageTemplateExpanded(id) {
    const normalized = String(id || '');
    if (expandedStageTemplateIds.has(normalized)) expandedStageTemplateIds.delete(normalized);
    else expandedStageTemplateIds.add(normalized);
    refreshStageTemplateEditor();
}

function resetCurrentStageTemplateDraft() {
    beginStageTemplateDraft();
    stageTemplateDraft[stageTemplateMethod] = JSON.parse(JSON.stringify(defaultClientStageTemplates()[stageTemplateMethod]));
    stageTemplateDirty = true;
    expandedStageTemplateIds.clear();
    refreshStageTemplateEditor();
}

function stageTemplateValidationError() {
    for (const method of clientProcurementMethods()) {
        const rows = stageTemplateDraft?.[method];
        if (!Array.isArray(rows) || !rows.length) return `${method}至少保留一个阶段`;
        const ids = new Set();
        for (const row of rows) {
            if (!String(row.name || '').trim()) return `${method}存在未填写名称的阶段`;
            if (ids.has(row.id)) return `${method}存在重复的阶段标识`;
            ids.add(row.id);
        }
    }
    return '';
}

async function saveStageTemplates(button) {
    if (!currentIsAdmin || stageTemplateSaving) return false;
    beginStageTemplateDraft();
    const validationError = stageTemplateValidationError();
    if (validationError) {
        toast(validationError, 'error');
        return false;
    }
    stageTemplateSaving = true;
    if (button) button.disabled = true;
    const submitted = JSON.parse(JSON.stringify(stageTemplateDraft));
    const submittedSignature = JSON.stringify(submitted);
    try {
        const result = await api('PATCH', '/api/settings', {stage_templates: submitted});
        const saved = normalizeClientStageTemplates(result?.settings?.stage_templates || submitted, result?.settings || systemSettings);
        systemSettings.stage_templates = saved;
        if (result?.settings?.stage_module_catalog) systemSettings.stage_module_catalog = result.settings.stage_module_catalog;
        const editedDuringSave = JSON.stringify(stageTemplateDraft) !== submittedSignature;
        if (!editedDuringSave) stageTemplateDraft = JSON.parse(JSON.stringify(saved));
        stageTemplateDirty = editedDuringSave;
        toast(result?.message || '阶段模板已保存', 'success');
        refreshStageTemplateEditor();
        return true;
    } catch (error) {
        toast(error?.message || '阶段模板保存失败', 'error');
        return false;
    } finally {
        stageTemplateSaving = false;
        if (button) button.disabled = false;
    }
}

async function syncCurrentStageTemplate(button) {
    if (!currentIsAdmin || stageTemplateDirty) {
        toast(stageTemplateDirty ? '请先保存模板，再同步现有项目' : '只有管理员可以同步模板', 'error');
        return false;
    }
    const method = stageTemplateMethod;
    const scope = method === '网上竞价' ? '仅同步启用新竞价流程的项目，旧项目保持原样。' : '历史阶段会保留。';
    if (!await confirmDialog(`同步“${method}”模板到现有项目？${scope}`)) return false;
    if (button) button.disabled = true;
    try {
        const result = await api('PATCH', '/api/settings', {stage_template_sync_method: method});
        for (const project of (typeof allProjects === 'undefined' ? [] : allProjects)) {
            if (project.method === method && typeof invalidateProjectDerivedState === 'function') {
                invalidateProjectDerivedState(project.id);
            }
        }
        try {
            if (typeof loadAllProjects === 'function') await loadAllProjects();
            if (typeof currentProject !== 'undefined' && currentProject?.method === method
                && typeof refreshProject === 'function') await refreshProject();
        } catch (error) {
            toast('模板已同步，但视图刷新失败，请重新加载项目列表', 'warning');
            return true;
        }
        toast(result?.message || '现有项目同步完成', 'success');
        return true;
    } catch (error) {
        toast(error?.message || '同步失败', 'error');
        return false;
    } finally {
        if (button) button.disabled = false;
    }
}

function handleStageTemplateMethod(event) {
    selectStageTemplateMethod(event.currentTarget?.dataset?.stageTemplateMethod || '');
}

async function handleStageTemplateAction(event) {
    const control = event.currentTarget;
    const id = control?.closest?.('[data-stage-template-id]')?.dataset?.stageTemplateId || '';
    const action = control?.dataset?.stageTemplateAction || '';
    if (action === 'expand') toggleStageTemplateExpanded(id);
    if (action === 'up') moveStageTemplateDraft(id, -1);
    if (action === 'down') moveStageTemplateDraft(id, 1);
    if (action === 'delete') removeStageTemplateDraft(id);
}

function handleStageTemplateField(event) {
    const input = event.currentTarget;
    const id = input?.closest?.('[data-stage-template-id]')?.dataset?.stageTemplateId || '';
    updateStageTemplateDraft(id, input?.dataset?.stageTemplateField || '', input?.value || '');
}

function handleStageTemplateModule(event) {
    const input = event.currentTarget;
    const id = input?.closest?.('[data-stage-template-id]')?.dataset?.stageTemplateId || '';
    toggleStageTemplateModule(id, input?.dataset?.stageTemplateModule || '', input?.checked === true);
}

function renderStageTemplateCard(settings, editable) {
    beginStageTemplateDraft(settings || {});
    const catalog = Array.isArray(settings?.stage_module_catalog) ? settings.stage_module_catalog : [];
    const disabled = editable ? '' : 'disabled';
    const methods = clientProcurementMethods();
    const methodTabs = methods.map(method => `
      <button type="button" class="stage-template-method ${method === stageTemplateMethod ? 'active' : ''}" data-stage-template-method="${escHtml(method)}" onclick="handleStageTemplateMethod(event)">${escHtml(method)}</button>`).join('');
    const stageRows = getCurrentStageTemplateDraft().map((stage, index, rows) => {
        const expanded = expandedStageTemplateIds.has(stage.id);
        const moduleNames = (stage.modules || []).map(moduleId => (
            catalog.find(item => String(item.id) === String(moduleId))?.name || moduleId
        ));
        const moduleChecks = catalog.map(module => {
            const moduleId = String(module.id);
            const checked = moduleId === 'common' || (stage.modules || []).includes(moduleId);
            return `<label class="stage-template-module ${checked ? 'selected' : ''}"><input type="checkbox" data-stage-template-module="${escHtml(moduleId)}" ${checked ? 'checked' : ''} ${moduleId === 'common' || !editable ? 'disabled' : ''} onchange="handleStageTemplateModule(event)"><span class="stage-template-module-copy"><span class="stage-template-module-name">${escHtml(module.name || moduleId)}</span>${module.singleton ? '<small>唯一</small>' : ''}</span></label>`;
        }).join('');
        const icons = [...new Set([stage.icon, ...STAGE_ICON_OPTIONS])].map(icon => `<option value="${escHtml(icon)}" ${icon === stage.icon ? 'selected' : ''}>${escHtml(icon)}</option>`).join('');
        return `<li class="stage-template-row ${expanded ? 'expanded' : ''}" data-stage-template-id="${escHtml(stage.id)}">
          <div class="stage-template-summary">
            <span class="stage-order-position">${index + 1}</span>
            <span class="stage-template-icon"><span data-ui-icon="${escHtml(stage.icon || '•')}"></span></span>
            <div class="stage-template-copy"><strong>${escHtml(stage.name || '未命名阶段')}</strong><small>${escHtml(moduleNames.join(' · '))}</small></div>
            <div class="stage-order-actions">
              <button type="button" class="btn btn-secondary btn-sm" data-stage-template-action="up" onclick="handleStageTemplateAction(event)" ${index === 0 || !editable ? 'disabled' : ''}>上移</button>
              <button type="button" class="btn btn-secondary btn-sm" data-stage-template-action="down" onclick="handleStageTemplateAction(event)" ${index === rows.length - 1 || !editable ? 'disabled' : ''}>下移</button>
              <button type="button" class="btn btn-secondary btn-sm" data-stage-template-action="expand" onclick="handleStageTemplateAction(event)">${expanded ? '收起' : '编辑'}</button>
              <button type="button" class="btn btn-danger btn-sm" data-stage-template-action="delete" onclick="handleStageTemplateAction(event)" ${rows.length <= 1 || !editable ? 'disabled' : ''}>删除</button>
            </div>
          </div>
          ${expanded ? `<div class="stage-template-editor">
            <label><span>阶段名称</span><input maxlength="60" value="${escHtml(stage.name)}" data-stage-template-field="name" oninput="handleStageTemplateField(event)" ${disabled}></label>
            <label class="stage-template-icon-field"><span>图标</span><select class="stage-template-icon-input" data-stage-template-field="icon" onchange="handleStageTemplateField(event)" ${disabled}>${icons}</select></label>
            <div class="stage-template-module-picker"><strong>选择模块（可多选）</strong><div>${moduleChecks}</div></div>
          </div>` : ''}
        </li>`;
    }).join('');
    return `<section class="settings-card settings-card-wide stage-template-card">
      <div class="settings-card-head"><div><h2>阶段模板</h2><p>按采购方式分别配置。新项目自动使用当前模板；已有项目仅在手动同步后更新，历史资料不会删除。</p><p>登记中标或成交供应商、金额，请选择“中标/成交结果”；“中标或成交通知书”用于记录通知书领取。</p></div></div>
      <div class="stage-template-methods">${methodTabs}</div>
      <ol class="stage-template-list">${stageRows}</ol>
      <div class="settings-actions stage-template-actions">
        <button type="button" class="btn btn-secondary btn-sm" onclick="addStageTemplateDraft()" ${disabled}>+ 新增阶段</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="resetCurrentStageTemplateDraft()" ${disabled}>恢复当前方式默认</button>
        <button type="button" class="btn btn-primary btn-sm" onclick="saveStageTemplates(this)" ${disabled}>保存模板</button>
        <button type="button" class="btn btn-secondary btn-sm" onclick="syncCurrentStageTemplate(this)" ${disabled}>同步现有项目</button>
        ${stageTemplateDirty ? '<span class="stage-order-unsaved">有未保存的调整</span>' : ''}
      </div>
      ${editable ? '' : '<div class="settings-note warning">只有管理员可以修改和同步阶段模板。</div>'}
    </section>`;
}
