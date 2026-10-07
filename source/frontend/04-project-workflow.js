// ── 时间格式化辅助 ──
function parseAttachmentTimestamp(value) {
    if (value === null || value === undefined || value === '') return null;
    const raw = String(value).trim();
    const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}Z`;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateTimeShort(value) {
    if (value === null || value === undefined || value === '') return '';
    const parsed = parseAttachmentTimestamp(value);
    if (!parsed) return String(value);
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Shanghai',
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(parsed).map(part => [part.type, part.value]));
    return `${Number(parts.month)}/${Number(parts.day)} ${parts.hour}:${parts.minute}`;
}


// 信息页草稿只保存在当前会话，按项目隔离，不自动写入服务器。
const projectInfoDrafts = new Map();
const projectInfoFieldIds = ['infoName', 'infoNumber', 'infoPurchaser', 'infoPrepareOwner',
    'infoReviewOwner', 'infoMethod', 'infoBudget', 'infoYear', 'infoNoDeposit', 'infoNotes', 'infoSecondTender'];
let renderedProjectInfoId = null;
let projectInfoBaseline = null;

function readProjectInfoValues() {
    const values = {};
    for (const id of projectInfoFieldIds) {
        const input = document.getElementById(id);
        if (input) values[id] = input.type === 'checkbox' ? input.checked : input.value;
    }
    return values;
}

function captureProjectInfoDraft() {
    if (renderedProjectInfoId === null || !projectInfoBaseline || !document.getElementById('infoName')) return;
    const values = readProjectInfoValues();
    if (JSON.stringify(values) === JSON.stringify(projectInfoBaseline)) projectInfoDrafts.delete(renderedProjectInfoId);
    else projectInfoDrafts.set(renderedProjectInfoId, values);
    const notice = document.getElementById('infoDraftNotice');
    if (notice) notice.hidden = !projectInfoDrafts.has(renderedProjectInfoId);
}

function discardProjectInfoDraft() {
    projectInfoDrafts.delete(Number(currentProject.id));
    renderedProjectInfoId = null;
    renderInfo();
}

function clearSavedProjectInfoDraft(projectId, submittedValues) {
    const key = Number(projectId);
    const submitted = JSON.stringify(submittedValues);
    if (renderedProjectInfoId === key) {
        projectInfoBaseline = submittedValues;
        captureProjectInfoDraft();
    } else if (JSON.stringify(projectInfoDrafts.get(key)) === submitted) {
        projectInfoDrafts.delete(key);
    }
}

// ── Render Info (信息) ──
function renderInfo() {
    captureProjectInfoDraft();
    const p = currentProject;
    const container = document.getElementById('infoContent');
    const lots = p.lots || [];
    const lotsHtml = lots.length ? lots.map(l => `
        <div class="info-lot-row">
            <div class="info-lot-main">
                <strong>${escHtml(l.lot_number || '')}</strong>
                <span>${escHtml(l.lot_name || '')}</span>
                ${l.budget ? `<em>¥${Number(l.budget).toLocaleString()}</em>` : ''}
                ${l.notes ? `<small>${escHtml(l.notes)}</small>` : ''}
            </div>
            <div class="info-lot-actions">
                <button class="btn btn-sm btn-secondary" onclick="showLotForm(${l.id})">编辑</button>
                <button class="btn btn-sm btn-danger" onclick="deleteLot(${l.id})">删除</button>
            </div>
        </div>
    `).join('') : '<div class="info-lot-empty">暂无包/标段</div>';

    container.innerHTML = `<div class="info-form">
        <div id="infoDraftNotice" class="muted" hidden>未保存草稿已在本次会话中保留，切换项目后可继续编辑。<button type="button" class="btn btn-sm btn-secondary" onclick="discardProjectInfoDraft()">放弃草稿</button></div>
        ${p.second_tender_source ? `
        <div class="retender-source-banner">
            ↩️ 本项目是 <strong>${escHtml(p.second_tender_source.number)}</strong> 的二次/重新招标项目
            <button class="btn btn-secondary btn-sm" onclick="goToSecondTender(${p.second_tender_source.id})">查看来源项目</button>
        </div>` : ''}
        <div class="form-group"><label>项目名称</label><input id="infoName" value="${escHtml(p.name)}"></div>
        <div class="form-group"><label>项目编号</label><input id="infoNumber" value="${escHtml(p.number)}"></div>
        <div class="form-group"><label>采购人</label><input id="infoPurchaser" value="${escHtml(p.purchaser)}"></div>
        <div class="form-group"><label>文件编制负责人</label><input id="infoPrepareOwner" value="${escHtml(p.prepare_owner)}" placeholder="编制人姓名"></div>
        <div class="form-group"><label>文件审核负责人</label><input id="infoReviewOwner" value="${escHtml(p.review_owner)}" placeholder="审核人姓名"></div>
        <div class="form-group"><label>采购方式</label>
            <select id="infoMethod">${METHODS.map(m=>`<option value="${m}" ${p.method===m?'selected':''}>${m}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>预算金额</label><input id="infoBudget" value="${escHtml(p.budget)}"></div>
        <div class="form-group"><label>年度</label><input id="infoYear" type="number" value="${p.year}"></div>
        <div class="form-group">
            <div class="toggle-row" onclick="toggleDepositRow()">
            <div class="toggle-switch">
                <input type="checkbox" id="infoNoDeposit" ${p.no_deposit ? 'checked' : ''}>
                <span class="toggle-slider toggle-warning"></span>
            </div>
            <span class="toggle-label">无需投标保证金</span>
            <span class="toggle-desc">自动跳过"保证金退还"</span>
        </div>
        </div>
        <div class="form-group">
            <div class="info-section-head">
                <label>包/标段</label>
                <button class="btn btn-sm btn-primary" onclick="showLotForm()">+ 添加包/标段</button>
            </div>
            <div class="info-lot-list">${lotsHtml}</div>
        </div>
        <div class="form-group"><label>备注</label><textarea id="infoNotes">${escHtml(p.notes)}</textarea></div>
        ${(p.is_terminated && (p.terminated_type === 'liubiao' || p.terminated_type === 'feibiao')) ? `
        <div class="close-reason-box ${p.terminated_type}">
            <div class="close-reason-head">
                <span class="close-reason-tag">${p.terminated_type === 'liubiao' ? '🚫 流标原因' : '🟠 废标原因'}</span>
                <button class="btn btn-secondary btn-sm" onclick="editCloseReason()">修改</button>
            </div>
            <div class="close-reason-text">${p.terminated_reason ? escHtml(p.terminated_reason) : '<span class="muted">(未填写原因)</span>'}</div>
        </div>` : ''}
        ${(p.is_terminated && (p.terminated_type === 'liubiao' || p.terminated_type === 'feibiao')) ? `
        <div class="retender-box">
            <div class="retender-head">
                <span class="retender-tag"><span data-ui-icon='🔁'></span> 二次/重新招标关联</span>
                <span class="retender-hint">可选：关联重新招标的新项目，便于从本项目一键跳转</span>
            </div>
            <div class="form-group" style="margin:8px 0">
                <label>关联二次/重新招标项目</label>
                <select id="infoSecondTender">
                    <option value="0">— 不关联（本项目无二次/重新招标）—</option>
                    ${allProjects.filter(x => x.id !== p.id).map(x => `<option value="${x.id}" ${p.second_tender_id === x.id ? 'selected' : ''}>${escHtml(x.number)} · ${escHtml(x.name)}</option>`).join('')}
                </select>
            </div>
            ${p.second_tender ? `<button class="btn btn-primary btn-sm" onclick="goToSecondTender(${p.second_tender.id})">前往二次/重新招标项目（${escHtml(p.second_tender.number)}）</button>` : ''}
        </div>` : ''}
        <div class="form-group" style="display:flex;flex-wrap:wrap;gap:8px">
            <button class="btn btn-primary" onclick="saveProjectInfo()">保存</button>
            <button class="btn btn-secondary" onclick="refreshProject()">刷新</button>
            ${p.is_terminated ? `
                <button class="btn btn-success" onclick="reopenProject()">恢复进行中</button>
                ${p.terminated_type !== 'liubiao' ? `<button class="btn btn-warning" onclick="setCloseType('liubiao')">改为流标</button>` : ''}
                ${p.terminated_type !== 'feibiao' ? `<button class="btn btn-warning" onclick="setCloseType('feibiao')">改为废标</button>` : ''}
            ` : `
                <button class="btn btn-danger" onclick="setCloseType('terminated')">终止项目</button>
                <button class="btn btn-warning" onclick="setCloseType('liubiao')">标记流标</button>
                <button class="btn btn-warning" onclick="setCloseType('feibiao')">标记废标</button>
            `}
        </div>
    </div>`;
    renderedProjectInfoId = Number(p.id);
    projectInfoBaseline = readProjectInfoValues();
    const draft = projectInfoDrafts.get(renderedProjectInfoId);
    if (draft) {
        for (const [id, value] of Object.entries(draft)) {
            const input = document.getElementById(id);
            if (!input) continue;
            if (input.type === 'checkbox') input.checked = value;
            else input.value = value;
        }
    }
    for (const id of projectInfoFieldIds) {
        const input = document.getElementById(id);
        if (!input) continue;
        input.addEventListener('input', captureProjectInfoDraft);
        input.addEventListener('change', captureProjectInfoDraft);
    }
    captureProjectInfoDraft();
}

// ── Save Project Info ──
async function saveProjectInfo() {
    const p = currentProject;
    const submittedValues = readProjectInfoValues();
    const editVersion = projectEditVersion;
    const navigationVersion = projectNavigationVersion;
    const data = {
        number: document.getElementById('infoNumber').value,
        name: document.getElementById('infoName').value,
        purchaser: document.getElementById('infoPurchaser').value,
        prepare_owner: document.getElementById('infoPrepareOwner').value,
        review_owner: document.getElementById('infoReviewOwner').value,
        method: document.getElementById('infoMethod').value,
        budget: document.getElementById('infoBudget').value,
        year: parseInt(document.getElementById('infoYear').value) || 2026,
        notes: document.getElementById('infoNotes').value,
        no_deposit: document.getElementById('infoNoDeposit').checked,
        second_tender_id: document.getElementById('infoSecondTender') ? (parseInt(document.getElementById('infoSecondTender').value) || 0) : undefined,
    };
    try {
        await api('PUT', `/api/projects/${p.id}`, data);
        clearSavedProjectInfoDraft(p.id, submittedValues);
        toast('✅ 保存成功', 'success');
        if (Number(currentProject?.id) === Number(p.id)
            && editVersion === projectEditVersion
            && navigationVersion === projectNavigationVersion) await refreshProject();
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

// ── Close Project (终止 / 流标 / 废标) ──
async function setCloseType(type) {
    if (!currentProject) return;
    const labelMap = {terminated: '终止', liubiao: '流标', feibiao: '废标'};
    const label = labelMap[type] || '关闭';
    let reason = '';
    if (type === 'liubiao' || type === 'feibiao') {
        const r = await reasonDialog(
            `标记${label}`,
            `请填写${label}原因（建议填写，便于后续统计）：`,
            type === 'liubiao' ? '例如：有效投标人不足3家 / 供应商弃标' : '例如：采购需求变更 / 预算取消',
            '确定标记',
            'btn-warning'
        );
        if (!r.ok) return;
        reason = r.value;
    } else if (!await confirmDialog('操作确认', `确定将项目标记为「${label}」？`, '确定', 'btn-warning')) {
        return;
    }
    try {
        await api('PUT', `/api/projects/${currentProject.id}`, {is_terminated: true, terminated_type: type, terminated_reason: reason});
        toast(`已标记为${label}`, 'info');
        await refreshProject();
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

// ── Edit 流标/废标原因 ──
async function editCloseReason() {
    if (!currentProject) return;
    const t = currentProject.terminated_type;
    const label = t === 'liubiao' ? '流标' : '废标';
    const r = await reasonDialog(`修改${label}原因`, `修改${label}原因：`, '请输入原因', '保存', 'btn-primary', currentProject.terminated_reason || '');
    if (!r.ok) return;
    try {
        await api('PUT', `/api/projects/${currentProject.id}`, {terminated_reason: r.value});
        toast('✅ 原因已更新', 'success');
        await refreshProject();
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

// ── Reopen Project ──
async function reopenProject() {
    if (!await confirmDialog('恢复项目', '确定恢复为进行中？恢复后流标/废标原因将被清空。', '恢复', 'btn-success')) return;
    try {
        await api('PUT', `/api/projects/${currentProject.id}`, {is_terminated: false});
        toast('♻️ 已恢复为进行中', 'success');
        await refreshProject();
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

// ── Jump to linked second-tender / source project ──
function goToSecondTender(pid) {
    if (!pid) return;
    selectProject(pid);
}

// ── Toggle Stage (Quick Complete) ──
async function toggleStage(key) {
    const p = currentProject;
    const s = p.stages.find(st => st.key === key);
    if (!s) return;
    try {
        const newVal = !s.completed;
        if (newVal) {
            completeStage(key);
        } else {
            await api('PUT', `/api/projects/${p.id}/stages/${stageApiSegment(key)}`, {completed: false});
            toast(`↩ ${projectStageDefinition(s, p).name} 已撤销`, 'info');
            await refreshProject();
        }
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

function completeStage(key) {
    const p = currentProject;
    const s = p.stages.find(st => st.key === key);
    if (!s || s.completed) return;
    if (typeof onlineBiddingStageKind === 'function' && onlineBiddingStageKind(s,p)) {
        openStageSlide(key);
        return;
    }
    const sd = projectStageDefinition(s, p);
    const html = `
        <div style="text-align:center;font-size:48px;margin-bottom:8px"><span data-ui-icon="${escHtml(sd.icon)}"></span></div>
        <h2 style="text-align:center;font-size:20px;margin-bottom:8px">${escHtml(sd.name)}</h2>
        <p style="text-align:center;color:var(--text2);font-size:13px;margin-bottom:20px">请选择完成日期</p>
        <div class="modal-date-wrap">
            <label>完成日期</label>
            <input type="date" id="completeDate" value="${todayISO()}">
        </div>
        <div style="display:flex;gap:8px;margin-top:20px">
            <button class="btn btn-primary btn-block" data-dialog-submit onclick="doCompleteStage(stageKeyFromToken('${stageKeyToken(key)}'))">确认完成</button>
            <button class="btn btn-secondary" onclick="closeModal()">取消</button>
        </div>
    `;
    showModal('完成阶段', html);
}

async function doCompleteStage(key) {
    const dateVal = document.getElementById('completeDate').value;
    if (!currentProject) return;
    try {
        await api('PUT', `/api/projects/${currentProject.id}/stages/${stageApiSegment(key)}`, {
            completed: true,
            completed_date: dateVal || todayISO()
        });
        toast(`✅ ${projectStageDefinition(key, currentProject).name} 已完成`, 'success');
        closeModal();
        await refreshProject();
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

function getRequiredStageChecklistItems(project) {
    const stages = project && Array.isArray(project.stages) ? project.stages : [];
    return stages.flatMap(stage => Array.isArray(stage.checklist) ? stage.checklist : [])
        .filter(item => item && item.required === true);
}

async function setProjectStageChecklistOptional(project) {
    const items = getRequiredStageChecklistItems(project);
    for (const item of items) {
        await api('PUT', `/api/projects/${project.id}/stage-checklist/${item.id}`, {required:false});
    }
    return items.length;
}

async function initializeProjectChecklistDefaults(projectId) {
    const project = await api('GET', `/api/projects/${projectId}`);
    return setProjectStageChecklistOptional(project);
}

async function migrateAllStageChecklistDefaults(projects = allProjects) {
    const result = {projects_scanned:0, items_updated:0, failures:[]};
    for (const summary of projects) {
        result.projects_scanned += 1;
        try {
            const project = await api('GET', `/api/projects/${summary.id}`);
            result.items_updated += await setProjectStageChecklistOptional(project);
        } catch (error) {
            result.failures.push({project_id:summary.id, error:error.message});
        }
    }
    return result;
}
window.migrateAllStageChecklistDefaults = migrateAllStageChecklistDefaults;

function renderStageChecklist(stage) {
    const items = stage.checklist || [];
    if(!items.length)return `<div class="stage-checklist-empty"><button type="button" class="btn btn-sm" onclick="addChecklistItem()">+ 添加阶段检查项</button></div>`;
    const done = items.filter(x=>x.completed).length;
    const requiredPending = items.filter(x=>x.required && !x.completed).length;
    const rows = items.map(item=>`<div class="checklist-row ${item.completed?'done':''}"><label><input type="checkbox" ${item.completed?'checked':''} onchange="toggleStageChecklist(${item.id},this.checked)"><span>${escHtml(item.title)}</span>${item.required?'<b title="完成阶段前必须勾选">必检</b>':'<small>可选</small>'}</label><div><button class="icon-text-btn" onclick="editChecklistItem(${item.id})" title="设置">设置</button>${item.is_custom?`<button class="icon-text-btn danger" onclick="deleteChecklistItem(${item.id})" title="删除">删除</button>`:''}</div></div>`).join('');
    return `<div class="stage-checklist"><div class="form-subhead"><span>阶段检查清单 <small>${done}/${items.length}${requiredPending?` · ${requiredPending}项必检未完成`:''}</small></span><button type="button" class="btn btn-xs" onclick="addChecklistItem()">+ 添加</button></div>${rows||'<div class="biz-none">暂无检查项</div>'}</div>`;
}
async function toggleStageChecklist(id,completed){await api('PUT',`/api/projects/${currentProject.id}/stage-checklist/${id}`,{completed});await refreshProject();openStageSlide(editingStageKey);}
function addChecklistItem(){showModal('添加检查项',`<div class="modal-form"><div class="form-group"><label>检查内容</label><input id="checkTitle"></div><label class="inline-check"><input type="checkbox" id="checkRequired"> 设为必检项</label></div>`,async()=>{const title=document.getElementById('checkTitle').value.trim();if(!title){toast('请填写检查内容','warning');return false;}await api('POST',`/api/projects/${currentProject.id}/stage-checklist`,{stage_key:editingStageKey,title,required:document.getElementById('checkRequired').checked});closeModal();await refreshProject();openStageSlide(editingStageKey);});}
function editChecklistItem(id){const s=currentProject.stages.find(x=>x.key===editingStageKey);const item=(s.checklist||[]).find(x=>x.id===id);if(!item)return;showModal('检查项设置',`<div class="modal-form">${item.is_custom?`<div class="form-group"><label>检查内容</label><input id="checkEditTitle" value="${escHtml(item.title)}"></div>`:`<p>${escHtml(item.title)}</p>`}<label class="inline-check"><input type="checkbox" id="checkEditRequired" ${item.required?'checked':''}> 阶段完成前必须检查</label><div class="form-group"><label>备注</label><textarea id="checkEditNotes" rows="2">${escHtml(item.notes||'')}</textarea></div></div>`,async()=>{const data={required:document.getElementById('checkEditRequired').checked,notes:document.getElementById('checkEditNotes').value.trim()};if(item.is_custom)data.title=document.getElementById('checkEditTitle').value.trim();await api('PUT',`/api/projects/${currentProject.id}/stage-checklist/${id}`,data);closeModal();await refreshProject();openStageSlide(editingStageKey);});}
async function deleteChecklistItem(id){if(!await confirmDialog('删除检查项','确定删除这个自定义检查项？','删除','btn-danger'))return;await api('DELETE',`/api/projects/${currentProject.id}/stage-checklist/${id}`);await refreshProject();openStageSlide(editingStageKey);}

function stageKeyForModule(moduleId, project = currentProject) {
    const stages = project && Array.isArray(project.stages) ? project.stages : [];
    const active = stages.filter(stage => !stage.template_removed && stageHasModule(stage, moduleId, project));
    const editing = active.find(stage => stage.key === editingStageKey);
    return (editing || active[0])?.key || null;
}

function reopenStageModule(moduleId) {
    const key = stageKeyForModule(moduleId);
    if (key) openStageSlide(key);
    return key;
}

function reopenBidResultStage() {
    const stages = (currentProject?.stages || []).filter(stage => !stage.template_removed);
    const hasResults = stage => stageHasModule(stage, 'bid_results', currentProject) || stageHasModule(stage, 'result_publication', currentProject);
    const editing = stages.find(stage => stage.key === editingStageKey && hasResults(stage));
    const key = editing?.key || stageKeyForModule('bid_results') || stageKeyForModule('result_publication');
    if (key) openStageSlide(key);
    return key;
}

// ── Open Stage Slide ──
function openStageSlide(key) {
function renderStagePublicationLink(stage, project) {
    const kind=typeof onlineBiddingStageKind==='function'?onlineBiddingStageKind(stage,project):'';
    if(['announcement','publication'].includes(kind))return '';
    const applies=stage.key==='announcement' || stage.key==='result_announced' || stageHasModule(stage,'result_publication',project) || /公示|公告/.test(stage.name || '') || stage.publication_url;
    if(!applies)return '';
    return `<section class="stage-business-card"><h3>公告与公示</h3><div class="form-group"><label for="stagePublicationUrl">公告 / 公示链接</label><input type="url" id="stagePublicationUrl" onchange="saveStageFromSlide()" maxlength="2000" value="${escHtml(stage.publication_url || '')}" placeholder="https://…"><p class="stage-field-hint">登记外部平台发布地址，随本阶段一同保存。</p></div></section>`;
}


    const p = currentProject;
    if (p.is_terminated) {
        const label = p.terminated_type === 'liubiao' ? '流标' : p.terminated_type === 'feibiao' ? '废标' : '终止';
        toast(`项目已${label}，无法编辑阶段（如需继续，请先「恢复进行中」）`, 'error');
        return;
    }
    const s = p.stages.find(st => st.key === key);
    if (!s) return;
    const sd = projectStageDefinition(s, p);
    editingStageKey = key;
    const displayName = escHtml(sd.name);
    const hasTimedPlanning = ['registration','bid_opening','evaluation','auto_completion'].some(moduleId => stageHasModule(s, moduleId, p));
    const html = `
        <div class="form-group">
            <label>状态</label>
            <div>
                <div class="toggle-row" onclick="toggleStageCompleted()">
                    <div class="toggle-switch">
                        <input type="checkbox" id="stageCompleted" onclick="event.stopPropagation(); syncStageCompleted()" ${s.completed && !s.skipped ? 'checked' : ''} ${s.skipped ? 'disabled' : ''}>
                        <span class="toggle-slider toggle-success"></span>
                    </div>
                    <span class="toggle-label" id="stageCompletedLabel">${s.completed && !s.skipped ? '✅ 已完成' : '⏳ 待办'}</span>
                </div>
            </div>
            <div style="margin-top:8px">
                <div class="toggle-row" style="margin-top:8px" onclick="toggleSkipFromRow()">
                    <div class="toggle-switch">
                        <input type="checkbox" id="stageSkipped" onclick="event.stopPropagation(); syncSkipStage()" ${s.skipped ? 'checked' : ''}>
                        <span class="toggle-slider toggle-warning"></span>
                    </div>
                    <span class="toggle-label" id="stageSkippedLabel">${s.skipped ? '⚠️ 已跳过' : '不适用此阶段'}</span>
                    <span class="toggle-desc">${stageHasModule(s, 'deposit_refund', p) ? '无需保证金时可跳过' : '不适用时可跳过'}</span>
                </div>
            </div>
        </div>
        <div class="stage-date-grid"><div class="form-group">
            <label>完成日期</label>
            <input type="date" id="stageCompletedDate" value="${s.completed_date || todayISO()}" onchange="saveStageFromSlide()" ${s.skipped ? 'disabled' : ''}>
        </div>
        <div class="form-group">
            <label for="stagePlannedAt">计划${hasTimedPlanning ? (stageHasModule(s, 'auto_completion', p) ? '日期时间（到时自动完成）' : '日期时间') : '日期'}</label>
            <input type="${hasTimedPlanning ? 'datetime-local' : 'date'}" id="stagePlannedAt" value="${s.planned_at || ''}" onchange="saveStageFromSlide()">
        </div>
        </div>
        ${stageHasModule(s, 'bid_opening', p) ? `<div class="form-group"><label for="stageOpeningLocation">开标地点</label><input id="stageOpeningLocation" maxlength="500" value="${escHtml(s.opening_location || '')}" placeholder="请输入开标地点" onchange="saveStageFromSlide()"></div>` : ''}
        ${stageHasModule(s, 'evaluation', p) ? `<div class="form-group"><label for="stageEvaluationLocation">评标地点</label><input id="stageEvaluationLocation" maxlength="500" value="${escHtml(s.evaluation_location || '')}" placeholder="请输入评标地点" onchange="saveStageFromSlide()"></div>` : ''}
        <details class="stage-optional-notes" ${s.notes?'open':''}><summary>${s.notes?'阶段备注':'添加备注（选填）'}</summary><div class="form-group">
            <label for="stageNotes" class="sr-only">阶段备注</label>
            <textarea id="stageNotes" rows="2" onchange="saveStageFromSlide()">${escHtml(s.notes)}</textarea>
        </div></details>
        ${stageHasModule(s, 'responsible_person', p) ? `<div class="form-group"><label>${key==='doc_prepare'?'文件编制负责人':key==='doc_review'?'文件审核负责人':'负责人'}</label><input id="stageResponsiblePerson" value="${escHtml(s.responsible_person || '')}" placeholder="负责人姓名" onchange="saveStageFromSlide()"></div>` : ''}
        ${stageHasModule(s, 'checklist', p) ? renderStageChecklist(s) : ''}
        ${renderStagePublicationLink(s,p)}
        ${p.method === '网上竞价' && typeof renderOnlineBiddingInline === 'function' ? renderOnlineBiddingInline(s, p) : ''}
        ${(()=>{
            var h="";
            if(stageHasModule(s,"clarification",p))h+=renderClarificationSection(p);
            if(stageHasModule(s,"bid_opening",p))h+=`<div class="biz-sec"><div class="biz-bar"><span>采购包投标响应处理</span><button class="btn btn-xs btn-warning" onclick="showManualLotFlowForm()">投标响应不足，标记包流标</button></div><div class="biz-body">${(p.lot_supplier_state?.items||[]).filter(item=>item.lot_id!=null).map(item=>`<div class="biz-row"><span>${escHtml(`${item.lot_number||''} ${item.lot_name||'未命名包'}`.trim())}　${Number(item.registration_count||0)}/${Number(item.required_count||0)}家　${item.status==='liubiao'?'已流标':item.status==='warning'?'流标预警':'正常'}</span>${item.status!=='liubiao'?`<a href="javascript:void(0)" onclick="showManualLotFlowForm(${item.lot_id})">标记流标</a>`:''}</div>`).join('')||'<div class="biz-none">暂无采购包</div>'}</div></div>`;
            if(stageHasModule(s,"registration",p))h+=`<div class="biz-sec"><div class="biz-bar"><span>供应商报名</span><span style="display:inline-flex;gap:6px;align-items:center"><select id="regExportScope" class="mini-select" style="width:110px;height:24px;font-size:12px"><option value="current">当前项目</option><option value="all">全部项目</option></select><button class="btn btn-xs" onclick="exportRegistrations()">导出</button><button class="btn btn-xs" onclick="showRegistrationImportDialog()">导入</button></span><button class="btn btn-xs btn-primary" aria-label="新增供应商报名" onclick="showRegistrationForm()">+</button></div><div class="biz-body">${(p.registrations||[]).length?p.registrations.map(r=>{const m=r.registration_method||'线上报名';const isOnline=m==='线上报名';const mTag=`<span style="font-size:11px;padding:1px 6px;border-radius:8px;margin-right:4px;${isOnline?'background:#e6f4ea;color:#1a7f37':'background:#e8f0fe;color:#1a56c4'}">${isOnline?'线上报名':'现场报名/线下报名'}</span>`;const atts=(r.attachments||[]);const attHtml=atts.length?`<div class="biz-attach">${atts.map(a=>`<span class="att-chip"><span data-ui-icon='📎'></span> ${escHtml(a.filename)} <a href="javascript:void(0)" onclick="downloadAttachment(${a.id})" title="下载">⬇</a>${(a.is_image||a.is_pdf||['doc','docx','xls','xlsx'].includes(a.extension||''))?`<a href="javascript:void(0)" onclick="viewAttachment(${a.id})" title="预览"><span data-ui-icon='👁'></span></a>`:''}<a href="javascript:void(0)" onclick="deleteAttachment(${a.id})" title="删除" style="color:var(--danger)"><span data-ui-icon='🗑'></span></a></span>`).join('')}</div>`:'';return `<div class="biz-row"><span>${mTag}${escHtml(r.company_name)} ${r.lot_number?"["+escHtml(r.lot_number)+"]":""}</span><a href="javascript:void(0)" onclick="showRegistrationForm(${r.id})">编辑</a> <a href="javascript:void(0)" onclick="deleteRegistration(${r.id})" style="color:var(--danger)">删除</a></div>${registrationMemberSummaryHtml(r)}${attHtml}${typeof renderOnlineRegistrationSlot === 'function' ? renderOnlineRegistrationSlot(r,p) : ''}`;}).join(""):"<div class=\"biz-none\">暂无报名记录</div>"}</div></div>`;
            if(stageHasModule(s,"bid_results",p)||stageHasModule(s,"result_publication",p))h+=`<div class="biz-sec"><div class="biz-bar"><span>项目包/标段</span><button class="btn btn-xs btn-primary" aria-label="新增项目包或标段" onclick="showLotForm()">+</button></div><div class="biz-body">${(p.lots||[]).length?p.lots.map(l=>`<div class="biz-row"><span>${escHtml(l.lot_number)} ${escHtml(l.lot_name)} ${l.budget?"¥"+l.budget.toLocaleString():""}</span><a href="javascript:void(0)" onclick="showLotForm(${l.id})">编辑</a></div>`).join(""):"<div class=\"biz-none\">暂无包/标段</div>"}</div><div class="biz-sec"><div class="biz-bar"><span>${p.method==='网上竞价'?'成交结果':'中标结果'}</span><button class="btn btn-xs btn-primary" aria-label="新增中标或成交结果" onclick="showBidResultForm()">+</button></div><div class="biz-body">${(p.bid_results||[]).length?p.bid_results.map(b=>`<div class="biz-row"><span>${escHtml(winningSupplierLabel(p, b))} ${b.lot_number?"["+escHtml(b.lot_number)+"]":""} ${b.winning_amount?"¥"+b.winning_amount.toLocaleString():escHtml(b.discount_rate||"")} ${b.is_shortlisted?"[入围]":""}</span><a href="javascript:void(0)" onclick="showBidResultForm(${b.id})">编辑</a></div>`).join(""):`<div class="biz-none">暂无${p.method==='网上竞价'?'成交':'中标'}结果</div>`}</div></div></div>`;
            if(stageHasModule(s,"winning_notice",p))h+=`<div class="biz-sec"><div class="biz-bar"><span>${p.method==='网上竞价'?'成交通知书领取':'中标通知书领取'}</span><button class="btn btn-xs btn-primary" aria-label="新增通知书领取记录" onclick="showNoticeForm()">+</button></div><div class="biz-body">${(p.notice_deliveries||[]).length?p.notice_deliveries.map(n=>`<div class="biz-row"><span>${escHtml(n.supplier_name)} ${n.lot_number?"["+escHtml(n.lot_number)+"]":""} <b>${escHtml(n.delivery_method || '')}</b></span><a href="javascript:void(0)" onclick="showNoticeForm(${n.id})">编辑</a></div>`).join(""):`<div class="biz-none">暂无${p.method==='网上竞价'?'成交通知书':'中标通知书'}</div>`}</div></div>`;
            if(stageHasModule(s,"service_fee",p))h+=`<div class="biz-sec"><div class="biz-bar"><span>服务费发票</span><button class="btn btn-xs btn-primary" aria-label="新增服务费发票" onclick="showInvoiceForm()">+</button></div><div class="biz-body">${(p.service_fee_invoices||[]).length?p.service_fee_invoices.map(i=>`<div class="biz-row"><span>${escHtml(i.invoice_number||"发票")} ${i.lot_number?"["+escHtml(i.lot_number)+"]":""} ${i.amount?"¥"+i.amount.toLocaleString():""}</span><a href="javascript:void(0)" onclick="showInvoiceForm(${i.id})">编辑</a></div>`).join(""):"<div class=\"biz-none\">暂无发票</div>"}</div></div>`;
            if(stageHasModule(s,"archive",p))h+=renderArchiveCatalogSection(p);
            if(stageHasModule(s,"result_publication",p))h+=renderComplaintSection(p);
            return h?`<div style="margin-top:12px;padding-top:8px;border-top:1px solid var(--border-light)">${h}</div>`:"";
        })()}
    `;
    openSlide(`${sd.icon} 编辑阶段 - ${sd.name}`, `<div class="stage-editor">${html}<div class="stage-editor-actions"><button class="btn btn-primary btn-block" onclick="saveStageAndClose()">保存并关闭</button></div></div>`);
    if (p.method === '网上竞价' && typeof loadOnlineBiddingInline === 'function') loadOnlineBiddingInline(s,p);
}

async function saveStageFromSlide() {
    if (!currentProject || !editingStageKey) return false;
    if (currentProject.is_terminated) { toast('项目已关闭，无法保存阶段', 'error'); return false; }
    const isSkipped = document.getElementById('stageSkipped').checked;
    const data = {
        completed: isSkipped ? true : document.getElementById('stageCompleted').checked,
        completed_date: isSkipped ? todayISO() : (document.getElementById('stageCompletedDate').value || null),
        planned_at: document.getElementById('stagePlannedAt').value || null,
        skipped: isSkipped,
        notes: document.getElementById('stageNotes').value,
    };
    if (stageHasModule(editingStageKey, 'responsible_person', currentProject)) {
        const el = document.getElementById('stageResponsiblePerson');
        if (el) data.responsible_person = el.value;
    }
    for (const [id, field] of [['stageOpeningLocation', 'opening_location'], ['stageEvaluationLocation', 'evaluation_location'], ['stagePublicationUrl', 'publication_url']]) {
        const el = document.getElementById(id);
        if (el) data[field] = el.value.trim();
    }
    const pid=currentProject.id, key=editingStageKey;
    const fields=[...(document.querySelectorAll?.('#onlineBiddingInline input,#onlineBiddingInline select,[data-online-review] input,[data-online-review] select') || [])].map(el=>[el.id,el.value]);
    const signature=JSON.stringify([pid,key,data,fields]);
    const active=saveStageFromSlide.active;
    if(active) {
        if(active.signature===signature)return active.promise;
        await active.promise;
        if(currentProject?.id!==pid || editingStageKey!==key)return false;
        return saveStageFromSlide();
    }
    const job={signature};
    saveStageFromSlide.active=job;
    job.promise=(async()=>{
        try {
            if(typeof saveOnlineBiddingInline === 'function') await saveOnlineBiddingInline(data);
            await api('PUT', `/api/projects/${pid}/stages/${stageApiSegment(key)}`, data);
            return true;
        } catch(e) {
            toast('❌ ' + e.message, 'error');
            return false;
        }
    })();
    try{return await job.promise;}finally{if(saveStageFromSlide.active===job)saveStageFromSlide.active=null;}
}

// 先确保备注保存完成，再关闭并刷新，避免 GET 与 PUT 竞态导致备注“消失”
async function saveStageAndClose() {
    const pid=currentProject?.id, key=editingStageKey;
    if (!await saveStageFromSlide()) return;
    if(currentProject?.id!==pid || editingStageKey!==key)return;
    closeSlide();
    await refreshProject();
}

function toggleSkipStage() {
    const skipped = document.getElementById('stageSkipped').checked;
    document.getElementById('stageCompleted').disabled = skipped;
    document.getElementById('stageCompletedDate').disabled = skipped;
    const cl = document.getElementById('stageCompletedLabel');
    const sl = document.getElementById('stageSkippedLabel');
    if (cl) cl.textContent = skipped ? '⏳ 待办' : (document.getElementById('stageCompleted').checked ? '✅ 已完成' : '⏳ 待办');
    if (sl) sl.textContent = skipped ? '⚠️ 已跳过' : '不适用此阶段';
    saveStageFromSlide();
}
function toggleStageCompleted() {
    const cb = document.getElementById('stageCompleted');
    if (cb.disabled) return;
    cb.checked = !cb.checked;
    syncStageCompleted();
}
function syncStageCompleted() {
    const cb = document.getElementById('stageCompleted');
    const cl = document.getElementById('stageCompletedLabel');
    if (cl) cl.textContent = cb.checked ? '✅ 已完成' : '⏳ 待办';
    saveStageFromSlide();
}
function toggleSkipFromRow() {
    const cb = document.getElementById('stageSkipped');
    cb.checked = !cb.checked;
    syncSkipStage();
}
function syncSkipStage() {
    toggleSkipStage();
}

// ── Save No Deposit toggle ──
function toggleDepositRow() {
    const cb = document.getElementById('infoNoDeposit');
    cb.checked = !cb.checked;
    saveNoDeposit();
}
async function saveNoDeposit() {
    if (!currentProject) return;
    const val = document.getElementById('infoNoDeposit').checked;
    try {
        await api('PUT', '/api/projects/' + currentProject.id, {no_deposit: val});
        toast(val ? '⚠️ 已设为无需保证金' : '恢复正常保证金模式', 'info');
        await refreshProject();
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

// ── Refresh Project ──
// 安全渲染：单个视图渲染失败不影响其他视图（避免一个 render 抛错中断进度/看板刷新）
function safeRender(name, fn) {
    try { fn(); }
    catch (e) { console.error('[render] ' + name + ' 失败:', e); }
}

async function refreshProject() {
    if (currentProject) {
        const projectId = Number(currentProject.id);
        const navigationVersion = projectNavigationVersion;
        const editVersion = projectEditVersion;
        const result = await requestProjectDetail(projectId);
        if (!result.accepted) return;
        if (Number(currentProject?.id) === projectId
            && navigationVersion === projectNavigationVersion) {
            currentProject = result.project;
            const preserveForm = editVersion !== projectEditVersion || isEditingApplicationForm();
            invalidateProjectTabRenders(preserveForm ? activeProjectTabName() : undefined);
            if (!preserveForm) {
                safeRender('侧边栏', renderSidebar);
                safeRender('顶部进度条', renderProjectTopbar);
                safeRender('当前详情', () => ensureProjectTabRendered(activeProjectTabName()));
            }
        }
    }
    if (typeof invalidateProjectViews === 'function') invalidateProjectViews();
    const dash = document.getElementById('view-dashboard');
    if (dash && dash.classList.contains('active')) {
        loadDashboard({force: true});
    }
}
