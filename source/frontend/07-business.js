// ── 批量删除附件 ──
let batchDeleteMode = false;

function batchDeleteAttachments() {
    batchDeleteMode = true;
    document.getElementById('attachmentBatchBar').style.display = '';
    // 显示所有复选框
    document.querySelectorAll('.attach-cb').forEach(cb => cb.style.display = 'inline-block');
    toast('✏️ 已进入批量删除模式，请勾选要删除的文件', 'info');
}

function exitBatchDeleteMode() {
    batchDeleteMode = false;
    document.getElementById('attachmentBatchBar').style.display = 'none';
    document.querySelectorAll('.attach-cb').forEach(cb => { cb.style.display = 'none'; cb.checked = false; });
    updateAttachSelectCount();
}

function getSelectedAttachments() {
    return [...document.querySelectorAll('.attach-cb:checked')].map(cb => parseInt(cb.dataset.id));
}

function updateAttachSelectCount() {
    const countEl = document.getElementById('attachSelectCount');
    if (countEl) countEl.textContent = `已选：${getSelectedAttachments().length}`;
}

function selectAllAttachments() {
    document.querySelectorAll('.attach-cb').forEach(cb => cb.checked = true);
    updateAttachSelectCount();
}

async function doBatchDelete() {
    const ids = getSelectedAttachments();
    if (!ids.length) { toast('⚠️ 请先选择至少一个文件', 'warning'); return; }

    const names = ids.map(id => {
        const att = (currentProject?.attachments || []).find(a => a.id === id);
        return escHtml(att?.filename || `文件${id}`);
    }).join('<br>');

    if (!await confirmDialog('批量删除确认',
        `确定要删除以下 ${ids.length} 个文件吗？<br><br>${names}<br><br><b style="color:var(--danger)"><span data-ui-icon='⚠️'></span> 此操作不可恢复！</b>`,
        `删除 (${ids.length}个)`, 'btn-danger')) return;

    showLoading(`正在删除 ${ids.length} 个文件...`);
    try {
        let successCount = 0;
        let failedCount = 0;

        for (const aid of ids) {
            try {
                await api('DELETE', `/api/attachments/${aid}`);
                successCount++;
            }
            catch (error) {
                failedCount++;
            }
        }

        exitBatchDeleteMode();
        await refreshProject();

        if (failedCount > 0) {
            toast(`✅ 删除成功 ${successCount}，失败 ${failedCount}个`, 'warning');
        } else {
            toast(`🗑️ 成功删除 ${successCount} 个文件`, 'success');
        }
    }
    catch (error) {
        toast('❌ 删除失败：' + error.message, 'error');
    }
    finally {
        hideLoading();
    }
}

// 监听附件复选框变化
document.addEventListener('change', e => {
    if (e.target.classList.contains('attach-cb')) updateAttachSelectCount();
});




// ═══════════════════════════════════════════════════════
// ── v21: 业务表单函数 ──
// ═══════════════════════════════════════════════════════

function showLotForm(id) {
    const p = currentProject;
    const lot = id ? (p.lots || []).find(l => l.id === id) : null;
    const html = `<div class="modal-form">
        <div class="form-group"><label>包号</label><input id="lotNumber" value="${escHtml(lot ? lot.lot_number : '')}"></div>
        <div class="form-group"><label>包名</label><input id="lotName" value="${escHtml(lot ? lot.lot_name : '')}"></div>
        <div class="form-group"><label>预算 (元)</label><input type="number" id="lotBudget" value="${lot && lot.budget ? lot.budget : ''}" placeholder="无具体预算"></div>
        <div class="form-group"><label>备注</label><textarea id="lotNotes" rows="2">${escHtml(lot ? lot.notes : '')}</textarea></div>
    </div>`;
    showModal(id ? '编辑包' : '新增包', html, async () => {
        const data = { lot_number: document.getElementById('lotNumber').value.trim(), lot_name: document.getElementById('lotName').value.trim(), budget: document.getElementById('lotBudget').value || null, notes: document.getElementById('lotNotes').value.trim() };
        if (!data.lot_number || !data.lot_name) { toast('包号和包名不能为空', 'warning'); return false; }
        if (id) { await api('PUT', '/api/projects/'+p.id+'/lots/'+id, data); }
        else { await api('POST', '/api/projects/'+p.id+'/lots', data); }
        closeModal(); await refreshProject();
        if (document.getElementById('slidePanel')?.classList.contains('open')) reopenBidResultStage();
    });
}
async function deleteLot(id) { if(await confirmDialog('删除包/标段','确定删除该包/标段？','删除','btn-danger')){await api('DELETE','/api/projects/'+currentProject.id+'/lots/'+id);await refreshProject();} }

function validateManualLotFlowPayload(data) {
    if (!data.lot_id) return '请选择采购包';
    if (!Number.isInteger(data.response_count) || data.response_count < 0) return '实际响应家数必须为大于等于0的整数';
    if (!String(data.reason || '').trim()) return '请填写流标原因';
    return '';
}

function validateRestoreLotPayload(data) {
    return String(data.reason || '').trim() ? '' : '请填写撤销原因';
}

function reprocurementPayload(sourceLot, procurementMethod) {
    return {
        reprocurement_source_lot_id: sourceLot.id,
        lot_number: sourceLot.lot_number,
        lot_name: sourceLot.lot_name,
        budget: sourceLot.budget ?? null,
        notes: sourceLot.notes || '',
        procurement_method: procurementMethod,
    };
}

function lotById(lotId) {
    return (currentProject?.lots || []).find(lot => Number(lot.id) === Number(lotId));
}

function showManualLotFlowForm(lotId = null) {
    const p = currentProject;
    const states = p?.lot_supplier_state?.items || [];
    const available = states.filter(item => item.lot_id != null && item.status !== 'liubiao');
    if (!available.length) { toast('当前没有可标记流标的采购包', 'warning'); return; }
    const html = `<div class="modal-form">
        <div class="form-group"><label>采购包 *</label><select id="manualFlowLot"><option value="">请选择采购包</option>${available.map(item => `<option value="${item.lot_id}" ${Number(lotId) === Number(item.lot_id) ? 'selected' : ''}>${escHtml(`${item.lot_number || ''} ${item.lot_name || '未命名包'}`.trim())}</option>`).join('')}</select></div>
        <div class="form-group"><label>实际投标响应家数 *</label><input id="manualFlowCount" type="number" min="0" step="1"></div>
        <div class="form-group"><label>流标原因 *</label><textarea id="manualFlowReason" rows="3" placeholder="请说明投标响应供应商不足情况"></textarea></div>
        <div class="settings-note warning">此操作仅记录投标响应不足，不触发自动预警邮件。</div>
    </div>`;
    showModal('标记采购包流标', html, async () => {
        const payload = {
            lot_id: Number(document.getElementById('manualFlowLot').value) || null,
            response_count: Number(document.getElementById('manualFlowCount').value),
            reason: document.getElementById('manualFlowReason').value.trim(),
        };
        const error = validateManualLotFlowPayload(payload);
        if (error) { toast(error, 'warning'); return false; }
        if (!await confirmDialog('确认采购包流标', '确认按投标响应不足将该采购包标记为流标？', '确认流标', 'btn-warning')) return false;
        await api('PUT', `/api/projects/${p.id}/lots/${payload.lot_id}`, {lot_action: 'manual_liubiao', response_count: payload.response_count, reason: payload.reason});
        closeModal(); await refreshProject(); reopenStageModule('bid_opening');
    });
}

function showRestoreLotForm(lotId) {
    const lot = lotById(lotId);
    if (!lot) { toast('未找到采购包', 'error'); return; }
    showModal('撤销采购包流标', `<div class="modal-form"><p>${escHtml(`${lot.lot_number || ''} ${lot.lot_name || '未命名包'}`.trim())}</p><div class="form-group"><label>撤销原因 *</label><textarea id="restoreLotReason" rows="3"></textarea></div></div>`, async () => {
        const payload = {reason: document.getElementById('restoreLotReason').value.trim()};
        const error = validateRestoreLotPayload(payload);
        if (error) { toast(error, 'warning'); return false; }
        await api('PUT', `/api/projects/${currentProject.id}/lots/${lotId}`, {lot_action: 'restore', reason: payload.reason});
        closeModal(); await refreshProject();
    });
}

function showLotRuleForm(lotId) {
    const item = (currentProject?.lot_supplier_state?.items || []).find(value => Number(value.lot_id) === Number(lotId));
    if (!item) { toast('未找到采购包规则', 'error'); return; }
    const currentOverride = item.minimum_supplier_override ?? '';
    const html = `<div class="modal-form">
        <p>${escHtml(`${item.lot_number || ''} ${item.lot_name || '未命名包'}`.trim())}</p>
        <div class="form-group"><label>最低供应商数量</label><input id="lotRuleMinimum" type="number" min="1" max="99" step="1" value="${escHtml(currentOverride)}" placeholder="留空则使用采购方式默认值 ${Number(item.required_count || 0)}"></div>
        <div class="form-group"><label>调整依据</label><textarea id="lotRuleBasis" rows="3">${escHtml(item.override_basis || '')}</textarea></div>
    </div>`;
    showModal('采购包供应商规则', html, async () => {
        const raw = document.getElementById('lotRuleMinimum').value;
        const minimum = raw === '' ? null : Number(raw);
        const basis = document.getElementById('lotRuleBasis').value.trim();
        if (minimum !== null && (!Number.isInteger(minimum) || minimum < 1 || minimum > 99)) { toast('最低数量必须为1至99的整数', 'warning'); return false; }
        if (minimum !== null && !basis) { toast('调整包级规则必须填写依据', 'warning'); return false; }
        await api('PUT', `/api/projects/${currentProject.id}/lots/${lotId}`, {lot_action: 'save_rule', minimum_supplier_override: minimum, override_basis: basis});
        closeModal(); await refreshProject();
    });
}

function showReprocurementForm(lotId) {
    const sourceLot = lotById(lotId);
    if (!sourceLot) { toast('未找到来源采购包', 'error'); return; }
    const html = `<div class="modal-form">
        <div class="form-group"><label>包号</label><input id="reprocLotNumber" value="${escHtml(sourceLot.lot_number || '')}"></div>
        <div class="form-group"><label>包名</label><input id="reprocLotName" value="${escHtml(sourceLot.lot_name || '')}"></div>
        <div class="form-group"><label>预算（元）</label><input id="reprocLotBudget" type="number" value="${sourceLot.budget ?? ''}"></div>
        <div class="form-group"><label>新采购方式</label><select id="reprocMethod">${METHODS.map(method => `<option value="${escHtml(method)}" ${method === currentProject.method ? 'selected' : ''}>${escHtml(method)}</option>`).join('')}</select></div>
        <div class="form-group"><label>备注</label><textarea id="reprocNotes" rows="2">${escHtml(sourceLot.notes || '')}</textarea></div>
        <div class="settings-note">新轮次不会复制原采购包的供应商报名记录。</div>
    </div>`;
    showModal('重新采购该包', html, async () => {
        const payload = reprocurementPayload(sourceLot, document.getElementById('reprocMethod').value);
        payload.lot_number = document.getElementById('reprocLotNumber').value.trim();
        payload.lot_name = document.getElementById('reprocLotName').value.trim();
        payload.budget = document.getElementById('reprocLotBudget').value || null;
        payload.notes = document.getElementById('reprocNotes').value.trim();
        if (!payload.lot_number || !payload.lot_name) { toast('包号和包名不能为空', 'warning'); return false; }
        await api('POST', `/api/projects/${currentProject.id}/lots`, payload);
        closeModal(); await refreshProject();
    });
}

function registrationSupplierLabel(registration) {
    const lead = String(registration?.company_name || '').trim();
    if (!lead || registration?.bidder_type !== 'consortium') return lead;
    const seen = new Set([lead.toLocaleLowerCase()]);
    const members = (Array.isArray(registration?.consortium_members) ? registration.consortium_members : [])
        .map(member => String(typeof member === 'string' ? member : (member?.company_name || '')).trim())
        .filter(name => {
            const key = name.toLocaleLowerCase();
            if (!name || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    return members.length ? `${lead}（联合体：${members.join('、')}）` : lead;
}

function winningSupplierLabel(project, bidResult) {
    const winner = String(bidResult?.winning_supplier || '').trim();
    if (!winner) return '';
    const selectedLot = String(bidResult?.lot_id || '');
    const registration = (project?.registrations || []).find(item => {
        if (String(item?.company_name || '').trim() !== winner) return false;
        return !selectedLot || String(item?.lot_id || '') === selectedLot;
    });
    return registration ? registrationSupplierLabel(registration) : winner;
}

function eligibleBidRegistrations(project, lotId) {
    const selectedLot = String(lotId || '');
    const seen = new Set();
    return (project?.registrations || []).filter(registration => {
        if (selectedLot && String(registration.lot_id || '') !== selectedLot) return false;
        const name = String(registration.company_name || '').trim();
        const key = name.toLocaleLowerCase();
        if (!name || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function bidSupplierOptionsHtml(lotId, selectedSupplier = '') {
    const registrations = eligibleBidRegistrations(currentProject, lotId);
    if (!registrations.length) return '<option value="" disabled selected>暂无已报名供应商</option>';
    const selected = String(selectedSupplier || '');
    return '<option value="">请选择已报名供应商</option>' + registrations.map(registration => {
        const name = String(registration.company_name || '').trim();
        const label = registrationSupplierLabel(registration);
        return `<option value="${escHtml(name)}" ${name === selected ? 'selected' : ''}>${escHtml(label)}</option>`;
    }).join('');
}

function refreshBidSupplierOptions(selectedSupplier = '') {
    const lotId = document.getElementById('bidLotId')?.value || '';
    const select = document.getElementById('bidSupplier');
    if (!select) return;
    const registrations = eligibleBidRegistrations(currentProject, lotId);
    select.innerHTML = bidSupplierOptionsHtml(lotId, selectedSupplier || select.value);
    select.disabled = registrations.length === 0;
    const guidance = document.getElementById('bidSupplierGuidance');
    if (guidance) guidance.style.display = registrations.length ? 'none' : '';
}

function eligibleNoticeBidResults(project, lotId) {
    const selectedLot = String(lotId || '');
    const seen = new Set();
    return (project?.bid_results || []).filter(result => {
        if (selectedLot && String(result?.lot_id || '') !== selectedLot) return false;
        const supplier = String(result?.winning_supplier || '').trim();
        const key = supplier.toLocaleLowerCase();
        if (!supplier || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function noticeWinnerOptionsHtml(lotId, selectedSupplier = '') {
    const results = eligibleNoticeBidResults(currentProject, lotId);
    const requested = String(selectedSupplier || '').trim();
    const available = results.some(result => String(result.winning_supplier || '').trim() === requested);
    const selected = available ? requested : (!requested && results.length === 1
        ? String(results[0].winning_supplier || '').trim()
        : requested);
    if (!results.length && !selected) {
        return '<option value="" disabled selected>暂无中标或成交供应商</option>';
    }
    let html = results.length > 1 ? '<option value="">请选择中标或成交供应商</option>' : '';
    if (selected && !available) {
        html += `<option value="${escHtml(selected)}" selected>${escHtml(selected)}（历史记录）</option>`;
    }
    html += results.map(result => {
        const supplier = String(result.winning_supplier || '').trim();
        const lot = (currentProject?.lots || []).find(item => String(item.id) === String(result.lot_id || ''));
        const lotLabel = !lotId && lot ? ` [${lot.lot_number || lot.lot_name || ''}]` : '';
        const label = `${winningSupplierLabel(currentProject, result)}${lotLabel}`;
        return `<option value="${escHtml(supplier)}" ${supplier === selected ? 'selected' : ''}>${escHtml(label)}</option>`;
    }).join('');
    return html;
}

function refreshNoticeWinnerOptions(selectedSupplier = '') {
    const lotId = document.getElementById('noticeLotId')?.value || '';
    const select = document.getElementById('noticeSupplier');
    if (!select) return;
    const results = eligibleNoticeBidResults(currentProject, lotId);
    select.innerHTML = noticeWinnerOptionsHtml(lotId, selectedSupplier);
    select.disabled = results.length === 0 && !selectedSupplier;
    const guidance = document.getElementById('noticeSupplierGuidance');
    if (guidance) guidance.style.display = results.length ? 'none' : '';
}

function showBidResultForm(id, suggestion) {
    const p = currentProject;
    if (!id && suggestion === undefined && hasInlineOnlineBidding(p)) {
        return prepareOnlineBidResultForm();
    }
    const bid = id ? (p.bid_results || []).find(b => b.id === id) : suggestion || null;
    const lotOptions = '<option value="">整体项目</option>' + (p.lots || []).map(l => `<option value="${l.id}" ${bid && bid.lot_id === l.id ? 'selected' : ''}>${escHtml(l.lot_number)} ${escHtml(l.lot_name)}</option>`).join('');
    const isOnline = p.method === '网上竞价';
    const html = `<div class="modal-form">
        <div class="form-group"><label>所属包</label><select id="bidLotId" onchange="refreshBidSupplierOptions()">${lotOptions}</select></div>
        <div class="form-group"><label>${isOnline?'成交':'中标'}供应商 *</label><select id="bidSupplier" ${eligibleBidRegistrations(p, bid?.lot_id || '').length ? '' : 'disabled'}>${bidSupplierOptionsHtml(bid?.lot_id || '', bid ? bid.winning_supplier : '')}</select></div>
        <div id="bidSupplierGuidance" class="settings-note warning" style="display:${eligibleBidRegistrations(p, bid?.lot_id || '').length ? 'none' : ''}">当前范围暂无报名供应商，请先添加供应商报名后再登记${isOnline?'成交':'中标'}结果。</div>
        <div class="form-group"><label>${isOnline?'成交':'中标'}金额 (元)</label><input type="number" id="bidAmount" value="${bid && bid.winning_amount ? bid.winning_amount : ''}" placeholder="无具体预算"></div>
        <div class="form-group"><label>折扣率</label><input id="bidDiscount" value="${escHtml(bid ? bid.discount_rate : '')}" placeholder="如: 95%"></div>
        <div class="form-group">
            <label>入围供应商库</label>
            <div class="toggle-row" onclick="document.getElementById('bidShortlisted').click()">
                <div class="toggle-switch">
                    <input type="checkbox" id="bidShortlisted" ${bid && bid.is_shortlisted ? 'checked' : ''} onclick="event.stopPropagation()" onchange="window.PMIcons.label(document.getElementById('bidShortlistedLabel'), this.checked ? '✅ 已入围' : '⭕ 未入围')">
                    <span class="toggle-slider toggle-success"></span>
                </div>
                <span class="toggle-label" id="bidShortlistedLabel">${bid && bid.is_shortlisted ? '<span data-ui-icon="✅"></span> 已入围' : '<span data-ui-icon="⭕"></span> 未入围'}</span>
            </div>
        </div>
        <div class="form-group"><label>备注</label><textarea id="bidNotes" rows="2">${escHtml(bid ? bid.notes : '')}</textarea></div>
    </div>`;
    showModal(id ? `编辑${isOnline?'成交':'中标'}结果` : `新增${isOnline?'成交':'中标'}结果`, html, async () => {
        const data = { lot_id: document.getElementById('bidLotId').value || null, winning_supplier: document.getElementById('bidSupplier').value.trim(), winning_amount: document.getElementById('bidAmount').value || null, discount_rate: document.getElementById('bidDiscount').value.trim(), is_shortlisted: document.getElementById('bidShortlisted').checked, notes: document.getElementById('bidNotes').value.trim() };
        if (!eligibleBidRegistrations(p, data.lot_id).length) { toast('请先添加供应商报名，再登记中标或成交结果', 'warning'); return false; }
        if (!data.winning_supplier) { toast('请选择已报名供应商', 'warning'); return false; }
        if (id) { await api('PUT', '/api/projects/'+p.id+'/bid-results/'+id, data); }
        else { await api('POST', '/api/projects/'+p.id+'/bid-results', data); }
        closeModal(); await refreshProject(); reopenBidResultStage();
    });
}
async function deleteBidResult(id) { if(await confirmDialog('删除结果','确定删除该中标/成交结果？','删除','btn-danger')){await api('DELETE','/api/projects/'+currentProject.id+'/bid-results/'+id);await refreshProject();} }

function normalizeConsortiumMembers(members) {
    return (Array.isArray(members) ? members : []).map(member => ({
        company_name: String(typeof member === 'string' ? member : (member?.company_name || '')).trim(),
    }));
}

function validateRegistrationPayload(data, requiresLot = false) {
    if (requiresLot && !data.lot_id) return '多包项目的报名必须选择所属包';
    if (!['standalone', 'consortium'].includes(data.bidder_type)) return '投标主体类型无效';
    data.company_name = String(data.company_name || '').trim();
    if (!data.company_name) return data.bidder_type === 'consortium' ? '请填写联合体牵头单位' : '请填写公司名称';
    if (data.company_name.length > 200) return '公司名称不能超过200个字符';
    if (data.bidder_type === 'standalone') {
        data.consortium_members = [];
        return '';
    }
    data.consortium_members = normalizeConsortiumMembers(data.consortium_members);
    if (!data.consortium_members.length) return '联合体至少需要一个成员单位';
    if (data.consortium_members.length > 20) return '联合体成员不能超过20个';
    const leadKey = data.company_name.toLocaleLowerCase();
    const seen = new Set();
    for (const member of data.consortium_members) {
        if (!member.company_name) return '成员单位名称不能为空';
        if (member.company_name.length > 200) return '成员单位名称不能超过200个字符';
        const key = member.company_name.toLocaleLowerCase();
        if (key === leadKey) return '成员单位不能与牵头单位相同';
        if (seen.has(key)) return '成员单位名称不能重复';
        seen.add(key);
    }
    return '';
}

function renderConsortiumMemberRows(members) {
    return normalizeConsortiumMembers(members).map((member, index, all) => `<div class="consortium-member-row">
        <input type="text" maxlength="200" value="${escHtml(member.company_name)}" data-member-index="${index}" aria-label="联合体成员单位 ${index + 1}">
        <div class="consortium-member-actions">
            <button type="button" class="btn btn-xs" data-consortium-action="up" data-member-index="${index}" ${index === 0 ? 'disabled' : ''} title="上移">↑</button>
            <button type="button" class="btn btn-xs" data-consortium-action="down" data-member-index="${index}" ${index === all.length - 1 ? 'disabled' : ''} title="下移">↓</button>
            <button type="button" class="btn btn-xs btn-danger" data-consortium-action="remove" data-member-index="${index}" title="删除成员">删除</button>
        </div>
    </div>`).join('');
}

function registrationMemberSummaryHtml(registration) {
    if ((registration?.bidder_type || 'standalone') !== 'consortium') return '';
    const names = normalizeConsortiumMembers(registration.consortium_members)
        .map(member => member.company_name).filter(Boolean);
    if (!names.length) return '';
    return `<div class="registration-consortium-summary">联合体成员：${names.map(escHtml).join('、')}</div>`;
}

let _registrationMemberDraft = [];

function registrationLotOptions(project, registration) {
    const lots = project?.lots || [];
    const leading = lots.length > 1
        ? '<option value="">请选择采购包</option>'
        : '<option value="">整体项目</option>';
    return leading + lots.map(lot => `<option value="${lot.id}" ${registration && Number(registration.lot_id) === Number(lot.id) ? 'selected' : ''}>${escHtml(lot.lot_number)} ${escHtml(lot.lot_name)}</option>`).join('');
}

function showRegistrationForm(id) {
    const p = currentProject;
    const r = id ? (p.registrations || []).find(x => x.id === id) : null;
    const bidderType = r && r.bidder_type === 'consortium' ? 'consortium' : 'standalone';
    _registrationMemberDraft = normalizeConsortiumMembers(r?.consortium_members).map(member => member.company_name);
    if (bidderType === 'consortium' && !_registrationMemberDraft.length) _registrationMemberDraft.push('');
    const lotOptions = registrationLotOptions(p, r);
    const regMethod = r ? (r.registration_method || '线上报名') : '线上报名';
    const isOnline = regMethod === '线上报名';
    const html = `<div class="modal-form" id="registrationForm">
        <div class="form-group"><label>所属包</label><select id="regLotId">${lotOptions}</select></div>
        <div class="form-group"><label>投标主体类型</label><select id="regBidderType"><option value="standalone" ${bidderType === 'standalone' ? 'selected' : ''}>单独投标</option><option value="consortium" ${bidderType === 'consortium' ? 'selected' : ''}>联合体投标</option></select></div>
        <div class="form-group"><label id="regCompanyLabel">${bidderType === 'consortium' ? '联合体牵头单位' : '公司名称'} *</label><input id="regCompany" maxlength="200" value="${escHtml(r ? r.company_name : '')}"></div>
        <div class="consortium-members" id="regConsortiumWrap" style="display:${bidderType === 'consortium' ? 'block' : 'none'}">
            <div class="consortium-members-head"><label>联合体成员 *</label><button type="button" class="btn btn-xs btn-primary" data-consortium-action="add">+ 添加成员单位</button></div>
            <div id="regConsortiumRows">${renderConsortiumMemberRows(_registrationMemberDraft)}</div>
            <small>仅登记成员单位名称；联系人、电话、邮箱和附件由牵头单位统一登记。最多20个成员。</small>
        </div>
        <div class="form-group"><label>报名方式</label><select id="regMethod" onchange="document.getElementById('regAttachWrap').style.display=this.value==='线上报名'?'block':'none'"><option value="现场报名/线下报名" ${regMethod==='现场报名/线下报名'||regMethod==='现场报名'||regMethod==='线下报名'?'selected':''}>现场报名/线下报名</option><option value="线上报名" ${regMethod==='线上报名'?'selected':''}>线上报名（需上传扫描件）</option></select></div>
        <div class="form-group"><label>公司地址</label><input id="regAddress" value="${escHtml(r ? r.company_address : '')}"></div>
        <div class="form-group"><label>法定代表人</label><input id="regLegal" value="${escHtml(r ? r.legal_representative : '')}"></div>
        <div class="form-group"><label>投标负责人</label><input id="regManager" value="${escHtml(r ? r.bid_manager : '')}"></div>
        <div class="form-group"><label>手机号</label><input id="regPhone" value="${escHtml(r ? r.manager_phone : '')}"></div>
        <div class="form-group"><label>电子邮箱</label><input type="email" id="regEmail" value="${escHtml(r ? r.manager_email : '')}"></div>
        <div class="form-group"><label>获取日期</label><input type="date" id="regDate" value="${r && r.acquisition_date ? r.acquisition_date : ''}"></div>
        <div class="form-group"><label>备注</label><textarea id="regNotes" rows="2">${escHtml(r ? r.notes : '')}</textarea></div>
        <div id="regAttachWrap" style="display:${isOnline ? 'block' : 'none'}">
        <div class="form-group"><label>报名登记资料（扫描件附件）</label><input type="file" id="regFiles" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.rar"></div>
        ${id && (r.attachments||[]).length ? `<div class="form-group"><label>已上传附件</label><div class="file-chips">${(r.attachments||[]).map(a=>`<span class="chip"><span data-ui-icon='📎'></span> ${escHtml(a.filename)} <a href="javascript:void(0)" onclick="downloadAttachment(${a.id})">下载</a></span>`).join('')}</div></div>` : ''}
        </div>
    </div>`;
    showModal(id ? '编辑报名' : '新增报名', html, async () => {
        const selectedType = document.getElementById('regBidderType').value;
        const data = { bidder_type: selectedType, consortium_members: selectedType === 'consortium' ? _registrationMemberDraft.map(company_name => ({company_name})) : [], lot_id: document.getElementById('regLotId').value || null, company_name: document.getElementById('regCompany').value.trim(), registration_method: document.getElementById('regMethod').value, company_address: document.getElementById('regAddress').value.trim(), legal_representative: document.getElementById('regLegal').value.trim(), bid_manager: document.getElementById('regManager').value.trim(), manager_phone: document.getElementById('regPhone').value.trim(), manager_email: document.getElementById('regEmail').value.trim(), acquisition_date: document.getElementById('regDate').value || null, notes: document.getElementById('regNotes').value.trim() };
        const validationError = validateRegistrationPayload(data, (p.lots || []).length > 1);
        if (validationError) { toast(validationError, 'warning'); return false; }
        let regId = id;
        if (id) { await api('PUT', '/api/projects/'+p.id+'/registrations/'+id, data); }
        else { const res = await api('POST', '/api/projects/'+p.id+'/registrations', data); regId = res.id; }
        const fileInput = document.getElementById('regFiles');
        if (fileInput && fileInput.files && fileInput.files.length) {
            await uploadRegistrationFiles(p.id, regId, fileInput.files);
        }
        closeModal(); await refreshProject(); reopenStageModule('registration');
    });
    const form = document.getElementById('registrationForm');
    if (!form) return;
    const renderDraft = () => {
        document.getElementById('regConsortiumRows').innerHTML = renderConsortiumMemberRows(_registrationMemberDraft);
    };
    const syncType = () => {
        const consortium = document.getElementById('regBidderType').value === 'consortium';
        if (consortium && !_registrationMemberDraft.length) _registrationMemberDraft.push('');
        document.getElementById('regCompanyLabel').textContent = consortium ? '联合体牵头单位 *' : '公司名称 *';
        document.getElementById('regConsortiumWrap').style.display = consortium ? 'block' : 'none';
        if (consortium) renderDraft();
    };
    form.addEventListener('change', event => {
        if (event.target.id === 'regBidderType') syncType();
    });
    form.addEventListener('input', event => {
        if (!event.target.matches('[data-member-index]') || event.target.tagName !== 'INPUT') return;
        _registrationMemberDraft[Number(event.target.dataset.memberIndex)] = event.target.value;
    });
    form.addEventListener('click', event => {
        const button = event.target.closest('[data-consortium-action]');
        if (!button) return;
        const action = button.dataset.consortiumAction;
        const index = Number(button.dataset.memberIndex);
        if (action === 'add') {
            if (_registrationMemberDraft.length >= 20) { toast('联合体成员不能超过20个', 'warning'); return; }
            _registrationMemberDraft.push('');
        } else if (action === 'remove' && Number.isInteger(index)) {
            _registrationMemberDraft.splice(index, 1);
        } else if (action === 'up' && index > 0) {
            [_registrationMemberDraft[index - 1], _registrationMemberDraft[index]] = [_registrationMemberDraft[index], _registrationMemberDraft[index - 1]];
        } else if (action === 'down' && index < _registrationMemberDraft.length - 1) {
            [_registrationMemberDraft[index + 1], _registrationMemberDraft[index]] = [_registrationMemberDraft[index], _registrationMemberDraft[index + 1]];
        }
        renderDraft();
    });
}
async function deleteRegistration(id) { if(await confirmDialog('删除报名记录','确定删除该报名记录？','删除','btn-danger')){await api('DELETE','/api/projects/'+currentProject.id+'/registrations/'+id);await refreshProject();reopenStageModule('registration');} }

async function exportRegistrations() {
    try {
        const scopeEl = document.getElementById('regExportScope');
        const scope = scopeEl ? scopeEl.value : 'current';
        const pid = currentProject ? currentProject.id : '';
        let url;
        if (scope === 'all') {
            const year = document.getElementById('exportYearSelect')?.value || '';
            url = `/api/projects/${pid}/registrations?export=1&scope=all${year ? '&year=' + encodeURIComponent(year) : ''}`;
        } else if (pid) {
            url = `/api/projects/${pid}/registrations?export=1&scope=current`;
        } else {
            toast('暂无可导出的报名记录', 'warning');
            return;
        }
        if (isDesktopApp()) {
            showLoading('正在生成Excel...');
            const result = await api('GET', `${url}&save=1`);
            hideLoading();
            showModal('导出成功', `
                <div class="export-result">
                    <div class="export-result-icon"><span data-ui-icon='✓'></span></div>
                    <div>
                        <h4>${escHtml(result.filename || '供应商报名.xlsx')}</h4>
                        <p>已保存到文件保存位置：</p>
                        <code>${escHtml(result.path || '')}</code>
                        <p class="muted-text">报名记录数：${result.count ?? '-'}</p>
                    </div>
                </div>
                <button class="btn btn-primary btn-block" onclick="closeModal()">知道了</button>
            `);
        } else {
            window.open(url, '_blank');
        }
    } catch(e) {
        hideLoading();
        toast('❌ 导出失败：' + e.message, 'error');
    }
}

function downloadImportTemplate(kind) {
    const projectQuery = kind === 'registrations' && currentProject?.id
        ? `&project_id=${encodeURIComponent(currentProject.id)}`
        : '';
    const url = `/api/import/templates?kind=${kind}${projectQuery}${isDesktopApp() ? '&save=1' : ''}`;
    if (isDesktopApp()) {
        api('GET', url).then(result => {
            toast(`模板已保存：${result.path || result.filename}`, 'success');
        }).catch(e => toast('❌ 模板下载失败：' + e.message, 'error'));
    } else {
        window.open(url, '_blank');
    }
}

function formatImportErrors(errors, limit = 50) {
    const source = Array.isArray(errors) ? errors : [];
    const normalized = source.map(error => {
        const sheet = String(error?.sheet || '数据');
        const row = Number.isFinite(Number(error?.row)) ? Number(error.row) : '-';
        const column = String(error?.column || '').trim();
        const message = String(error?.msg || '未知错误');
        const location = `${sheet} 第${row}行${column ? ` · ${column}列` : ''}`;
        return {sheet, row, column, message, text: `${location}：${message}`};
    });
    const visible = normalized.slice(0, Math.max(1, Number(limit) || 50));
    const remaining = Math.max(0, normalized.length - visible.length);
    return {
        total: normalized.length,
        text: normalized.map(item => item.text).join('\n'),
        html: `<div class="import-error-list">${visible.map(item => `<div class="import-error-row"><b>${escHtml(item.sheet)} · 第${escHtml(item.row)}行${item.column ? ` · ${escHtml(item.column)}列` : ''}</b><span>${escHtml(item.message)}</span></div>`).join('')}${remaining ? `<p class="muted-text">另有 ${remaining} 条未在列表中展示，请复制下方完整明细。</p>` : ''}</div>`,
    };
}

function showImportErrorDetails(errors) {
    const details = formatImportErrors(errors);
    showModal('导入失败明细', `${details.html}
        <div class="form-group" style="margin-top:12px"><label>完整明细（可复制）</label>
        <textarea rows="8" readonly>${escHtml(details.text)}</textarea></div>
        <button class="btn btn-primary btn-block" onclick="closeModal()">知道了</button>`);
}

function showProjectImportDialog() {
    showModal('导入项目', `
        <div class="modal-form">
            <p class="biz-none" style="color:var(--text3)">选择完整模板批量导入项目与分包。项目编号、项目名称为必填，负责人、采购方式、预算、年度、保证金和备注为可选。<a href="javascript:void(0)" onclick="downloadImportTemplate('projects')"><span data-ui-icon='📄'></span> 下载导入模板</a></p>
            <div class="form-group"><label>选择文件</label><input type="file" id="projectImportFile" accept=".xlsx"></div>
        </div>
    `, async () => {
        const fileEl = document.getElementById('projectImportFile');
        if (!fileEl || !fileEl.files.length) { toast('请选择要导入的文件', 'warning'); return false; }
        const fd = new FormData();
        fd.append('file', fileEl.files[0]);
        try {
            const result = await apiForm('/api/import/projects', fd);
            closeModal();
            toast(`✅ 导入完成：新增 ${result.success} 条${result.updated !== undefined ? `，补全 ${result.updated} 条，忽略 ${result.ignored} 条` : ''}，失败 ${result.failed} 条`, result.failed ? 'warning' : 'success');
            if (result.failed && (result.errors || []).length) {
                showImportErrorDetails(result.errors);
            }
            await loadAllProjects();
            loadDashboard({force: true});
        } catch(e) {
            toast('❌ 导入失败：' + e.message, 'error');
            return false;
        }
    });
}

function showRegistrationImportDialog() {
    const p = currentProject;
    if (!p) return;
    showModal('导入供应商报名', `
        <div class="modal-form">
            <p class="biz-none" style="color:var(--text3)">当前项目：${escHtml(p.name || p.number)}。模板支持单独投标、联合体成员、所属包、报名方式及全部联系人字段；公司名称或联合体牵头单位为必填。<a href="javascript:void(0)" onclick="downloadImportTemplate('registrations')"><span data-ui-icon='📄'></span> 下载导入模板</a></p>
            <div class="form-group"><label>选择文件</label><input type="file" id="registrationImportFile" accept=".xlsx"></div>
        </div>
    `, async () => {
        const fileEl = document.getElementById('registrationImportFile');
        if (!fileEl || !fileEl.files.length) { toast('请选择要导入的文件', 'warning'); return false; }
        const fd = new FormData();
        fd.append('file', fileEl.files[0]);
        try {
            const result = await apiForm(`/api/projects/${p.id}/registrations/import`, fd);
            closeModal();
            toast(`✅ 导入完成：新增 ${result.success} 条${result.updated !== undefined ? `，补全 ${result.updated} 条，忽略 ${result.ignored} 条` : ''}，失败 ${result.failed} 条`, result.failed ? 'warning' : 'success');
            if (result.failed && (result.errors || []).length) {
                showImportErrorDetails(result.errors);
            }
            await refreshProject();
            reopenStageModule('registration');
        } catch(e) {
            toast('❌ 导入失败：' + e.message, 'error');
            return false;
        }
    });
}

async function uploadRegistrationFiles(pid, regId, fileList) {
    if (!regId) return;
    const limitMb = await getAttachmentUploadLimitMb();
    const MAX = attachmentUploadLimitBytes();
    const valid = [];
    for (const f of fileList) {
        if (f.size > MAX) { toast(`⚠️ ${f.name} 超过${limitMb}MB限制`, 'warning'); }
        else { valid.push(f); }
    }
    if (!valid.length) return;
    const fd = new FormData();
    for (const f of valid) { fd.append('files', f); }
    fd.append('registration_id', regId);
    fd.append('description', '报名登记资料');
    try {
        const result = await apiForm('/api/projects/'+pid+'/attachments', fd);
        if (result.errors && result.errors.length) { toast('部分附件未上传：' + result.errors.join('；'), 'warning'); }
        else { toast('报名登记资料已上传', 'success'); }
    } catch (e) { toast('附件上传失败：' + e.message, 'error'); }
}

function showNoticeForm(id) {
    const p = currentProject;
    const n = id ? (p.notice_deliveries || []).find(x => x.id === id) : null;
    const lotOptions = '<option value="">整体项目</option>' + (p.lots || []).map(l => `<option value="${l.id}" ${n && n.lot_id === l.id ? 'selected' : ''}>${escHtml(l.lot_number)} ${escHtml(l.lot_name)}</option>`).join('');
    const isMail = n && n.delivery_method === '邮寄';
    const html = `<div class="modal-form">
        <div class="form-group"><label>所属包</label><select id="noticeLotId" onchange="refreshNoticeWinnerOptions()">${lotOptions}</select></div>
        <div class="form-group"><label>供应商 *</label><select id="noticeSupplier" ${eligibleNoticeBidResults(p, n?.lot_id || '').length || n?.supplier_name ? '' : 'disabled'}>${noticeWinnerOptionsHtml(n?.lot_id || '', n?.supplier_name || '')}</select></div>
        <div id="noticeSupplierGuidance" class="settings-note warning" style="display:${eligibleNoticeBidResults(p, n?.lot_id || '').length ? 'none' : ''}">当前范围暂无中标或成交供应商，请先在前面阶段登记中标或成交结果。</div>
        <div class="form-group"><label>领取方式</label><select id="noticeMethod" onchange="document.getElementById('noticeMailFields').style.display=this.value==='邮寄'?'block':'none'"><option value="现场" ${n && n.delivery_method === '现场' ? 'selected' : ''}>现场领取</option><option value="邮寄" ${n && n.delivery_method === '邮寄' ? 'selected' : ''}>邮寄</option></select></div>
        <div id="noticeMailFields" style="display:${isMail ? 'block' : 'none'}">
            <div class="form-group"><label>邮寄地址</label><input id="noticeAddress" value="${escHtml(n ? n.mailing_address : '')}"></div>
            <div class="form-group"><label>收件人</label><input id="noticeContact" value="${escHtml(n ? n.contact_name : '')}"></div>
            <div class="form-group"><label>电话</label><input id="noticePhone" value="${escHtml(n ? n.contact_phone : '')}"></div>
        </div>
        <div class="form-group"><label>领取/寄出日期</label><input type="date" id="noticePickupDate" value="${n && n.pickup_date ? n.pickup_date : ''}"></div>
        <div class="form-group"><label>备注</label><textarea id="noticeNotes" rows="2">${escHtml(n ? n.notes : '')}</textarea></div>
    </div>`;
    showModal(id ? '编辑通知书' : '新增通知书', html, async () => {
        var data = { lot_id: document.getElementById('noticeLotId').value || null, supplier_name: document.getElementById('noticeSupplier').value.trim(), delivery_method: document.getElementById('noticeMethod').value, pickup_date: document.getElementById('noticePickupDate').value || null, notes: document.getElementById('noticeNotes').value.trim() };
        if (!data.supplier_name) { toast('请选择前面阶段的中标或成交供应商', 'warning'); return false; }
        if (data.delivery_method === '邮寄') { data.mailing_address = document.getElementById('noticeAddress').value.trim(); data.contact_name = document.getElementById('noticeContact').value.trim(); data.contact_phone = document.getElementById('noticePhone').value.trim(); }
        if (id) { await api('PUT', '/api/projects/'+p.id+'/notice-deliveries/'+id, data); }
        else { await api('POST', '/api/projects/'+p.id+'/notice-deliveries', data); }
        closeModal(); await refreshProject(); reopenStageModule('winning_notice');
    });
}
async function deleteNotice(id) { if(await confirmDialog('删除通知书记录','确定删除该通知书领取/寄出记录？','删除','btn-danger')){await api('DELETE','/api/projects/'+currentProject.id+'/notice-deliveries/'+id);await refreshProject();} }

function showInvoiceForm(id) {
    const p = currentProject;
    const inv = id ? (p.service_fee_invoices || []).find(x => x.id === id) : null;
    const lotOptions = '<option value="">整体项目</option>' + (p.lots || []).map(l => `<option value="${l.id}" ${inv && inv.lot_id === l.id ? 'selected' : ''}>${escHtml(l.lot_number)} ${escHtml(l.lot_name)}</option>`).join('');
    const html = `<div class="modal-form">
        <div class="form-group"><label>所属包</label><select id="invLotId">${lotOptions}</select></div>
        <div class="form-group"><label>发票号码</label><input id="invNumber" value="${escHtml(inv ? inv.invoice_number : '')}"></div>
        <div class="form-group"><label>开票日期</label><input type="date" id="invDate" value="${inv && inv.invoice_date ? inv.invoice_date : ''}"></div>
        <div class="form-group"><label>金额 (元)</label><input type="number" id="invAmount" value="${inv && inv.amount ? inv.amount : ''}"></div>
        <div class="form-group"><label>备注</label><textarea id="invNotes" rows="2">${escHtml(inv ? inv.notes : '')}</textarea></div>
    </div>`;
    showModal(id ? '编辑发票' : '新增发票', html, async () => {
        const data = { lot_id: document.getElementById('invLotId').value || null, invoice_number: document.getElementById('invNumber').value.trim(), invoice_date: document.getElementById('invDate').value || null, amount: document.getElementById('invAmount').value || null, notes: document.getElementById('invNotes').value.trim() };
        if (id) { await api('PUT', '/api/projects/'+p.id+'/service-fee-invoices/'+id, data); }
        else { await api('POST', '/api/projects/'+p.id+'/service-fee-invoices', data); }
        closeModal(); await refreshProject(); reopenStageModule('service_fee');
    });
}
async function deleteInvoice(id) { if(await confirmDialog('删除发票记录','确定删除该服务费发票记录？','删除','btn-danger')){await api('DELETE','/api/projects/'+currentProject.id+'/service-fee-invoices/'+id);await refreshProject();} }

function renderClarificationSection(p){
    const list=p.announcement_clarifications||[];
    const rows=list.map(x=>{const atts=(x.attachments||[]).map(a=>`<span class="att-chip">${escHtml(a.filename)} <a href="javascript:void(0)" onclick="viewAttachment(${a.id})">预览</a> <a href="javascript:void(0)" onclick="downloadAttachment(${a.id})">下载</a></span>`).join('');return `<div class="biz-row clarification-row"><div><b>${escHtml(x.clarification_type)} · ${escHtml(x.title)}</b>${x.lot_number?` <small>[${escHtml(x.lot_number)}]</small>`:''}<p>${x.publish_date||'未填写发布日期'}${x.affects_deadline&&x.new_deadline?` · 截止时间调整为 ${escHtml(x.new_deadline.replace('T',' '))}`:''}</p>${atts?`<div class="biz-attach">${atts}</div>`:''}</div><div><a href="javascript:void(0)" onclick="showClarificationForm(${x.id})">编辑</a> <a href="javascript:void(0)" onclick="deleteClarification(${x.id})" style="color:var(--danger)">删除</a></div></div>`}).join('')||'<div class="biz-none">暂无澄清或更正记录</div>';
    return `<div class="biz-sec"><div class="biz-bar"><span>公告澄清与更正</span><button class="btn btn-xs btn-primary" aria-label="新增澄清或更正" onclick="showClarificationForm()">+</button></div><div class="biz-body">${rows}</div></div>`;
}
function showClarificationForm(id){
    let savedId=id;
    const p=currentProject,x=id?(p.announcement_clarifications||[]).find(v=>v.id===id):null;
    const lotOptions='<option value="">整体项目</option>'+(p.lots||[]).map(l=>`<option value="${l.id}" ${x&&x.lot_id===l.id?'selected':''}>${escHtml(l.lot_number)} ${escHtml(l.lot_name)}</option>`).join('');
    const opening=(p.stages||[]).find(s=>!s.template_removed&&stageHasModule(s,'bid_opening',p));
    const html=`<div class="modal-form"><div class="form-grid-2"><div class="form-group"><label>类型</label><select id="clarType">${['澄清','更正','答疑','延期公告','其他'].map(v=>`<option ${x&&x.clarification_type===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="form-group"><label>关联包号</label><select id="clarLot">${lotOptions}</select></div></div><div class="form-group"><label>标题 *</label><input id="clarTitle" value="${escHtml(x?x.title:'')}"></div><div class="form-group"><label>内容摘要</label><textarea id="clarContent" rows="3">${escHtml(x?x.content:'')}</textarea></div><div class="form-group"><label>发布日期</label><input type="date" id="clarPublish" value="${x&&x.publish_date?x.publish_date:''}"></div><label class="toggle-row"><div class="toggle-switch"><input type="checkbox" id="clarAffects" ${x&&x.affects_deadline?'checked':''} onchange="toggleClarDeadlineFields()"><span class="toggle-slider"></span></div><span class="toggle-label">影响投标/开标截止时间</span></label><div id="clarDeadlineFields" style="display:${x&&x.affects_deadline?'grid':'none'}" class="form-grid-2"><div class="form-group"><label>原截止时间</label><input type="datetime-local" id="clarOriginal" value="${x&&x.original_deadline?x.original_deadline:(opening&&opening.planned_at||'')}"></div><div class="form-group"><label>调整后时间</label><input type="datetime-local" id="clarNew" value="${x&&x.new_deadline?x.new_deadline:''}"><small>保存后同步更新开标计划时间</small></div></div><div class="form-group"><label>已通知供应商/通知范围</label><textarea id="clarNotified" rows="2" placeholder="可填写全部报名供应商或具体单位">${escHtml(x?x.notified_suppliers:'')}</textarea></div><div class="form-group"><label>附件</label><input type="file" id="clarFiles" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.rar,.eml"></div><div class="form-group"><label>备注</label><textarea id="clarNotes" rows="2">${escHtml(x?x.notes:'')}</textarea></div></div>`;
    showModal(id?'编辑澄清/更正':'新增澄清/更正',html,async()=>{const affects=document.getElementById('clarAffects').checked;const data={clarification_type:document.getElementById('clarType').value,lot_id:document.getElementById('clarLot').value||null,title:document.getElementById('clarTitle').value.trim(),content:document.getElementById('clarContent').value.trim(),publish_date:document.getElementById('clarPublish').value||null,affects_deadline:affects,original_deadline:affects?(document.getElementById('clarOriginal').value||null):null,new_deadline:affects?(document.getElementById('clarNew').value||null):null,notified_suppliers:document.getElementById('clarNotified').value.trim(),notes:document.getElementById('clarNotes').value.trim()};if(!data.title){toast('请填写标题','warning');return false;}if(affects&&!data.new_deadline){toast('请填写调整后时间','warning');return false;}const saved=savedId?await api('PUT',`/api/projects/${p.id}/clarifications/${savedId}`,data):await api('POST',`/api/projects/${p.id}/clarifications`,data);savedId=saved.id || savedId;const files=document.getElementById('clarFiles').files;if(files.length)await uploadClarificationFiles(savedId,files,p.id);if(currentProject?.id!==p.id)return;closeModal();await refreshProject();reopenStageModule('clarification');});
}
function toggleClarDeadlineFields(){const cb=document.getElementById('clarAffects');document.getElementById('clarDeadlineFields').style.display=cb.checked?'grid':'none';}
async function uploadClarificationFiles(id,files,projectId=currentProject.id){const fd=new FormData();[...files].forEach(f=>fd.append('files',f));return apiForm(`/api/projects/${projectId}/clarifications/${id}/attachments`,fd);}
async function deleteClarification(id){if(!await confirmDialog('删除澄清/更正','确定删除该记录及其附件？','删除','btn-danger'))return;await api('DELETE',`/api/projects/${currentProject.id}/clarifications/${id}`);await refreshProject();reopenStageModule('clarification');}

// ── 质疑/投诉模块（结果公示阶段内，附件式）──
function renderComplaintSection(p) {
    const list = (p.complaints || []);
    const rows = list.length ? list.map(c => {
        const typeTag = c.complaint_type === '投诉'
            ? `<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#fdecec;color:#c0392b">投诉</span>`
            : `<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#fff4e5;color:#b9770e">质疑</span>`;
        const statusTag = complaintStatusTag(c.status);
        const lotTag = c.lot_number ? `<span style="font-size:11px;color:var(--text3)">[${escHtml(c.lot_number)} ${escHtml(c.lot_name)}]</span>` : '';
        const targetText = (c.targets || []).map(t => `${t.object_type}：${t.object_name || t.matter || '未填写'}`).join('；') || c.challenged_party || '—';
        const issueCount = (c.issues || []).length;
        const eventCount = (c.events || []).length;
        const atts = (c.attachments || []);
        const attHtml = atts.length ? `<div class="biz-attach">${atts.map(a => `<span class="att-chip"><span data-ui-icon='📎'></span> ${escHtml(a.filename)} <a href="javascript:void(0)" onclick="downloadAttachment(${a.id})" title="下载"><span data-ui-icon="⬇"></span></a>${(a.is_image||a.is_pdf||['doc','docx','xls','xlsx'].includes(a.extension||''))?`<a href="javascript:void(0)" onclick="viewAttachment(${a.id})" title="预览"><span data-ui-icon='👁'></span></a>`:''}<a href="javascript:void(0)" onclick="deleteAttachment(${a.id})" title="删除" style="color:var(--danger)"><span data-ui-icon='🗑'></span></a></span>`).join('')}</div>` : '';
        const actions = ['已解决','已办结'].includes(c.status)
            ? `<a href="javascript:void(0)" onclick="showComplaintForm(${c.id})">编辑</a> <a href="javascript:void(0)" onclick="deleteComplaint(${c.id})" style="color:var(--danger)">删除</a>`
            : `<a href="javascript:void(0)" onclick="showComplaintForm(${c.id})">编辑</a> <a href="javascript:void(0)" onclick="resolveComplaint(${c.id})" style="color:var(--success)">标记已解决</a> <a href="javascript:void(0)" onclick="escalateComplaint(${c.id})" style="color:var(--danger)">转为投诉</a> <a href="javascript:void(0)" onclick="deleteComplaint(${c.id})" style="color:var(--danger)">删除</a>`;
        return `<div class="biz-row" style="flex-direction:column;align-items:stretch;gap:4px">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap"><b>${typeTag} ${statusTag}</b> <span class="tag">${escHtml(c.challenge_category || '采购结果质疑')}</span> ${lotTag}</div>
            <div style="font-size:12px">质疑方：<b>${escHtml(c.challenger || c.company_name || '—')}</b></div>
            <div style="font-size:12px">质疑对象：<b>${escHtml(targetText)}</b></div>
            <div style="font-size:12px;color:var(--text3)">${issueCount} 个质疑事项 · ${eventCount} 条办理记录${c.reply_deadline ? ` · 答复期限 ${escHtml(c.reply_deadline)}` : ''}</div>
            ${attHtml}
            <div style="margin-top:2px"><a href="javascript:void(0)" onclick="showComplaintProcess(${c.id})"><b>查看办理过程</b></a>　${actions}</div>
        </div>`;
    }).join('') : "<div class=\"biz-none\">暂无质疑/投诉</div>";
    return `<div class="biz-sec"><div class="biz-bar"><span>质疑与投诉</span><button class="btn btn-xs btn-primary" aria-label="新增质疑或投诉" onclick="showComplaintForm()">+</button></div><div class="biz-body">${rows}</div></div>`;
}

function complaintStatusTag(status) {
    const map = {
        '待审查': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#fff4e5;color:#b9770e">待审查</span>',
        '已受理': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#e8f0fe;color:#1a56c4">已受理</span>',
        '不予受理': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#eee;color:#666">不予受理</span>',
        '处理中': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#fff4e5;color:#b9770e">处理中</span>',
        '待处理': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#fff4e5;color:#b9770e">待处理</span>',
        '已答复': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#e8f0fe;color:#1a56c4">已答复</span>',
        '已解决': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#e6f4ea;color:#1a7f37">已解决</span>',
        '已办结': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#e6f4ea;color:#1a7f37">已办结</span>',
        '已转投诉': '<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#fdecec;color:#c0392b">已转投诉</span>',
    };
    return map[status] || `<span style="font-size:11px;padding:1px 6px;border-radius:8px;background:#eee;color:#666">${escHtml(status||'')}</span>`;
}

function showComplaintForm(id) {
    const p = currentProject;
    const c = id ? (p.complaints || []).find(x => x.id === id) : null;
    const lotOptions = '<option value="">— 整体项目/不指定 —</option>' + (p.lots || []).map(l => `<option value="${l.id}" ${c && c.lot_id === l.id ? 'selected' : ''}>${escHtml(l.lot_number)} ${escHtml(l.lot_name)}</option>`).join('');
    const html = `<div class="modal-form">
        <div class="form-grid-2"><div class="form-group"><label>记录类型</label><select id="compType"><option value="质疑" ${!c || c.complaint_type === '质疑' ? 'selected' : ''}>质疑</option><option value="投诉" ${c && c.complaint_type === '投诉' ? 'selected' : ''}>投诉</option></select></div>
        <div class="form-group"><label>质疑类别</label><select id="compCategory">${['采购文件质疑','采购过程质疑','采购结果质疑','其他'].map(x=>`<option ${(!c&&x==='采购结果质疑')||(c&&c.challenge_category===x)?'selected':''}>${x}</option>`).join('')}</select></div></div>
        <div class="form-group"><label>关联包/标段</label><select id="compLotId">${lotOptions}</select></div>
        <div class="form-group"><label>质疑人名称 *</label><input id="compChallenger" value="${escHtml(c ? (c.challenger || c.company_name) : '')}" placeholder="填写提出质疑的单位或个人"></div>
        <div class="form-grid-2"><div class="form-group"><label>联系人</label><input id="compContactName" value="${escHtml(c ? c.contact_name : '')}"></div><div class="form-group"><label>联系方式</label><input id="compContactInfo" value="${escHtml(c ? c.contact_info : '')}"></div></div>
        <div class="form-grid-2"><div class="form-group"><label>收到日期</label><input type="date" id="compSubmitDate" value="${c && c.submit_date ? c.submit_date : ''}"></div><div class="form-group"><label>答复截止日期</label><input type="date" id="compReplyDeadline" value="${c && c.reply_deadline ? c.reply_deadline : ''}"></div></div>
        <div class="form-group"><label>事项摘要</label><textarea id="compContent" rows="2">${escHtml(c ? c.content : '')}</textarea></div>
        <div class="form-group"><label>质疑请求</label><textarea id="compRequests" rows="2">${escHtml(c ? c.requests : '')}</textarea></div>
        <div class="form-subhead"><span>质疑对象</span><button type="button" class="btn btn-xs" onclick="addComplaintTargetRow()">+ 添加对象</button></div><div id="compTargets"></div>
        <div class="form-subhead"><span>质疑事项明细</span><button type="button" class="btn btn-xs" onclick="addComplaintIssueRow()">+ 添加事项</button></div><div id="compIssues"></div>
        <div class="form-group"><label>质疑函/材料附件（可多份）</label><input type="file" id="compFiles" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.rar" style="padding:6px">
            ${c ? `<div id="compAttList" style="margin-top:6px">${renderComplaintAttChips(c)}</div>` : ''}
        </div>
        <div class="form-group"><label>最终答复/处理意见</label><textarea id="compReply" rows="2">${escHtml(c ? c.reply_content : '')}</textarea></div>
        <div class="form-grid-2"><div class="form-group"><label>答复日期</label><input type="date" id="compReplyDate" value="${c && c.reply_date ? c.reply_date : ''}"></div><div class="form-group"><label>办理状态</label><select id="compStatus">${['待审查','已受理','不予受理','处理中','已答复','已办结','已转投诉','已解决'].map(s=>`<option value="${s}" ${c && c.status===s?'selected':''}>${s}</option>`).join('')}</select></div></div>
        <div class="form-group"><label>备注</label><textarea id="compNotes" rows="2">${escHtml(c ? c.notes : '')}</textarea></div>
    </div>`;
    showModal(id ? '编辑质疑/投诉' : '新增质疑/投诉', html, async () => {
        const data = {
            complaint_type: document.getElementById('compType').value,
            challenge_category: document.getElementById('compCategory').value,
            lot_id: document.getElementById('compLotId').value || null,
            challenger: document.getElementById('compChallenger').value.trim(),
            contact_name: document.getElementById('compContactName').value.trim(),
            contact_info: document.getElementById('compContactInfo').value.trim(),
            content: document.getElementById('compContent').value.trim(),
            requests: document.getElementById('compRequests').value.trim(),
            submit_date: document.getElementById('compSubmitDate').value || null,
            reply_deadline: document.getElementById('compReplyDeadline').value || null,
            reply_content: document.getElementById('compReply').value.trim(),
            reply_date: document.getElementById('compReplyDate').value || null,
            status: document.getElementById('compStatus').value,
            notes: document.getElementById('compNotes').value.trim(),
            targets: collectComplaintTargets(), issues: collectComplaintIssues()
        };
        if (!data.challenger) { toast('请填写质疑方', 'warning'); return false; }
        var createdId = id;
        if (id) { await api('PUT', '/api/projects/'+p.id+'/complaints/'+id, data); }
        else { var result = await api('POST', '/api/projects/'+p.id+'/complaints', data); createdId = result.id; }
        // 上传多份附件
        var fileInput = document.getElementById('compFiles');
        if (fileInput && fileInput.files && fileInput.files.length) {
            await uploadComplaintFiles(p.id, createdId, fileInput.files);
        }
        closeModal(); await refreshProject(); reopenStageModule('result_publication');
    });
    setTimeout(() => {
        const targets = c && c.targets && c.targets.length ? c.targets : (c && c.challenged_party ? [{object_type:'供应商',object_name:c.challenged_party,lot_id:c.lot_id}] : []);
        const issues = c && c.issues ? c.issues : [];
        targets.forEach(addComplaintTargetRow); issues.forEach(addComplaintIssueRow);
        if (!targets.length) addComplaintTargetRow();
    }, 0);
}
function renderComplaintAttChips(c) {
    const atts = (c.attachments || []);
    if (!atts.length) return '<div style="font-size:11px;color:var(--text3)">暂无附件</div>';
    return atts.map(a => `<span class="chip"><span data-ui-icon='📎'></span> ${escHtml(a.filename)} <a href="javascript:void(0)" onclick="downloadAttachment(${a.id})">下载</a> <a href="javascript:void(0)" onclick="deleteAttachment(${a.id})" style="color:var(--danger)">删除</a></span>`).join('');
}
function complaintLotOptions(selected) {
    return '<option value="">整体项目</option>' + (currentProject.lots || []).map(l => `<option value="${l.id}" ${String(selected||'')===String(l.id)?'selected':''}>${escHtml(l.lot_number)} ${escHtml(l.lot_name)}</option>`).join('');
}
function addComplaintTargetRow(item={}) {
    const box = document.getElementById('compTargets'); if (!box) return;
    const row = document.createElement('div'); row.className = 'complaint-editor-row target-row';
    row.innerHTML = `<button type="button" class="row-remove" onclick="this.parentElement.remove()" title="删除">×</button>
      <div class="form-grid-2"><select class="target-type">${['采购人','招标代理机构','供应商','评审相关','采购文件','采购程序','采购结果','其他'].map(x=>`<option ${item.object_type===x?'selected':''}>${x}</option>`).join('')}</select><input class="target-name" placeholder="对象名称" value="${escHtml(item.object_name||'')}"></div>
      <div class="form-grid-2"><select class="target-lot">${complaintLotOptions(item.lot_id)}</select><input type="date" class="target-deadline" value="${item.response_deadline||''}" title="要求回复日期"></div>
      <textarea class="target-matter" rows="2" placeholder="涉及事项">${escHtml(item.matter||'')}</textarea><label class="inline-check"><input type="checkbox" class="target-needs" ${item.needs_statement?'checked':''}> 需要该对象提供说明材料</label>`;
    box.appendChild(row);
}
function collectComplaintTargets() {
    return [...document.querySelectorAll('#compTargets .target-row')].map(r=>({object_type:r.querySelector('.target-type').value,object_name:r.querySelector('.target-name').value.trim(),lot_id:r.querySelector('.target-lot').value||null,response_deadline:r.querySelector('.target-deadline').value||null,matter:r.querySelector('.target-matter').value.trim(),needs_statement:r.querySelector('.target-needs').checked}));
}
function addComplaintIssueRow(item={}) {
    const box = document.getElementById('compIssues'); if (!box) return;
    const row = document.createElement('div'); row.className = 'complaint-editor-row issue-row';
    row.innerHTML = `<button type="button" class="row-remove" onclick="this.parentElement.remove()" title="删除">×</button>
      <div class="form-grid-2"><input class="issue-title" placeholder="事项标题" value="${escHtml(item.title||'')}"><select class="issue-lot">${complaintLotOptions(item.lot_id)}</select></div>
      <input class="issue-target" placeholder="对应质疑对象" value="${escHtml(item.target_name||'')}"><textarea class="issue-content" rows="2" placeholder="具体内容">${escHtml(item.content||'')}</textarea>
      <details><summary>依据与处理结论</summary><textarea class="issue-facts" rows="2" placeholder="事实依据">${escHtml(item.facts||'')}</textarea><textarea class="issue-basis" rows="2" placeholder="法律或采购文件依据">${escHtml(item.legal_basis||'')}</textarea><textarea class="issue-opinion" rows="2" placeholder="处理意见">${escHtml(item.handling_opinion||'')}</textarea><div class="form-grid-2"><select class="issue-conclusion">${['待认定','成立','不成立','部分成立','不予处理'].map(x=>`<option ${item.conclusion===x?'selected':''}>${x}</option>`).join('')}</select><label class="inline-check"><input type="checkbox" class="issue-affects" ${item.affects_result?'checked':''}> 影响采购结果</label></div></details>`;
    box.appendChild(row);
}
function collectComplaintIssues() {
    return [...document.querySelectorAll('#compIssues .issue-row')].map(r=>({title:r.querySelector('.issue-title').value.trim(),lot_id:r.querySelector('.issue-lot').value||null,target_name:r.querySelector('.issue-target').value.trim(),content:r.querySelector('.issue-content').value.trim(),facts:r.querySelector('.issue-facts').value.trim(),legal_basis:r.querySelector('.issue-basis').value.trim(),handling_opinion:r.querySelector('.issue-opinion').value.trim(),conclusion:r.querySelector('.issue-conclusion').value,affects_result:r.querySelector('.issue-affects').checked}));
}
async function uploadComplaintFiles(pid, cid, fileList) {
    const limitMb = await getAttachmentUploadLimitMb();
    const MAX = attachmentUploadLimitBytes();
    const valid = [];
    for (const f of fileList) {
        if (f.size > MAX) { toast(`⚠️ ${f.name} 超过${limitMb}MB限制`, 'warning'); }
        else valid.push(f);
    }
    if (!valid.length) return;
    const fd = new FormData();
    for (const f of valid) fd.append('files', f);
    fd.append('complaint_id', cid);
    fd.append('description', '质疑/投诉材料');
    try {
        const result = await apiForm('/api/projects/'+pid+'/attachments', fd);
        if (result.errors && result.errors.length) toast('部分附件未上传：' + result.errors.join('；'), 'warning');
        else toast('质疑材料已上传', 'success');
    } catch (e) { toast('附件上传失败：' + e.message, 'error'); }
}
function showComplaintProcess(cid) {
    const c = (currentProject.complaints || []).find(x=>x.id===cid); if (!c) return;
    const issues = (c.issues || []).map((x,i)=>`<div class="process-issue"><b>${i+1}. ${escHtml(x.title||'未命名事项')}</b><span>${escHtml(x.conclusion||'待认定')}${x.affects_result?' · 影响采购结果':''}</span><p>${escHtml(x.handling_opinion||x.content||'暂无处理意见')}</p></div>`).join('') || '<div class="biz-none">暂无事项明细</div>';
    const events = (c.events || []).map(e=>`<div class="process-event"><div class="process-dot"></div><div class="process-event-main"><div><b>${escHtml(e.event_type)}</b><span>${escHtml((e.event_time||'').replace('T',' '))}</span></div><p>${escHtml(e.sender||'—')} → ${escHtml(e.recipient||'—')}${e.handler?`　办理人：${escHtml(e.handler)}`:''}</p><p>${escHtml(e.summary||'暂无摘要')}</p>${e.deadline?`<small>期限：${escHtml(e.deadline)} · ${escHtml(e.status)}</small>`:''}${renderProcessAttachments(e.attachments||[])}<div><a href="javascript:void(0)" onclick="showComplaintEventForm(${cid},${e.id})">编辑</a>　<a href="javascript:void(0)" style="color:var(--danger)" onclick="deleteComplaintEvent(${cid},${e.id})">删除</a></div></div></div>`).join('') || '<div class="biz-none">暂无办理记录</div>';
    showModal('质疑办理详情', `<div class="complaint-process"><div class="process-summary"><b>${escHtml(c.challenger||'—')}</b><span>${escHtml(c.challenge_category||'')}</span><p>${escHtml(c.content||'暂无摘要')}</p></div><div class="form-subhead"><span>质疑事项及结论</span></div>${issues}<div class="form-subhead"><span>办理时间线</span><button class="btn btn-xs btn-primary" type="button" onclick="showComplaintEventForm(${cid})">+ 添加过程</button></div>${events}</div>`, null, '关闭');
}
function renderProcessAttachments(atts) {
    if (!atts.length) return '';
    return `<div class="biz-attach">${atts.map(a=>`<span class="att-chip">${escHtml(a.filename)} <a href="javascript:void(0)" onclick="viewAttachment(${a.id})">预览</a> <a href="javascript:void(0)" onclick="downloadAttachment(${a.id})">下载</a></span>`).join('')}</div>`;
}
function showComplaintEventForm(cid, eid) {
    const projectId = currentProject.id;
    const navigationVersion = typeof projectNavigationVersion === 'undefined' ? 0 : projectNavigationVersion;
    let savedEventId = eid || null;
    const c=(currentProject.complaints||[]).find(x=>x.id===cid); const e=eid?(c.events||[]).find(x=>x.id===eid):null;
    const now=new Date(); now.setMinutes(now.getMinutes()-now.getTimezoneOffset());
    const html=`<div class="modal-form"><div class="form-grid-2"><div class="form-group"><label>节点类型</label><select id="eventType">${['收到质疑材料','材料审查','要求补正','收到补正材料','转交采购人','转交代理机构内部处理','转交相关供应商','转交评审相关人员','收到说明或证明材料','内部研究/法律审核','形成答复意见','采购人确认','发出质疑答复','质疑人反馈','转投诉','办结','其他'].map(x=>`<option ${e&&e.event_type===x?'selected':''}>${x}</option>`).join('')}</select></div><div class="form-group"><label>发生时间</label><input type="datetime-local" id="eventTime" value="${e?e.event_time:now.toISOString().slice(0,16)}"></div></div><div class="form-grid-2"><div class="form-group"><label>发起方</label><input id="eventSender" value="${escHtml(e?e.sender:'')}"></div><div class="form-group"><label>接收方</label><input id="eventRecipient" value="${escHtml(e?e.recipient:'')}"></div></div><div class="form-group"><label>办理人</label><input id="eventHandler" value="${escHtml(e?e.handler:'')}"></div><div class="form-group"><label>内容摘要</label><textarea id="eventSummary" rows="3">${escHtml(e?e.summary:'')}</textarea></div><div class="form-grid-2"><div class="form-group"><label>回复/办理期限</label><input type="date" id="eventDeadline" value="${e&&e.deadline?e.deadline:''}"></div><div class="form-group"><label>状态</label><select id="eventStatus">${['待处理','处理中','已完成'].map(x=>`<option ${e&&e.status===x?'selected':''}>${x}</option>`).join('')}</select></div></div><div class="form-group"><label>节点附件</label><input type="file" id="eventFiles" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.rar,.eml"></div>${e?renderProcessAttachments(e.attachments||[]):''}</div>`;
    showModal(e?'编辑办理过程':'添加办理过程',html,async()=>{
        const data={event_type:document.getElementById('eventType').value,event_time:document.getElementById('eventTime').value,sender:document.getElementById('eventSender').value.trim(),recipient:document.getElementById('eventRecipient').value.trim(),handler:document.getElementById('eventHandler').value.trim(),summary:document.getElementById('eventSummary').value.trim(),deadline:document.getElementById('eventDeadline').value||null,status:document.getElementById('eventStatus').value};
        const files = [...document.getElementById('eventFiles').files];
        const event = savedEventId
            ? await api('PUT', `/api/projects/${projectId}/complaints/${cid}/events/${savedEventId}`, data)
            : await api('POST', `/api/projects/${projectId}/complaints/${cid}/events`, data);
        savedEventId = event.id || savedEventId;
        if (files.length) {
            try { await uploadComplaintEventFiles(cid, savedEventId, files, projectId); }
            catch (error) { throw new Error('办理记录已保存，附件上传失败；请在当前窗口重试：' + error.message); }
        }
        if (currentProject?.id === projectId && navigationVersion === (typeof projectNavigationVersion === 'undefined' ? 0 : projectNavigationVersion)) {
            closeModal(); await refreshProject(); showComplaintProcess(cid);
        }
    });
}
async function uploadComplaintEventFiles(cid,eid,files,projectId=currentProject.id){const fd=new FormData();[...files].forEach(f=>fd.append('files',f));return apiForm(`/api/projects/${projectId}/complaints/${cid}/events/${eid}/attachments`,fd);}
async function deleteComplaintEvent(cid,eid){if(!await confirmDialog('删除办理记录','确定删除这条办理记录及其附件？','删除','btn-danger'))return;await api('DELETE',`/api/projects/${currentProject.id}/complaints/${cid}/events/${eid}`);await refreshProject();showComplaintProcess(cid);}
async function deleteComplaint(id) {
    if(!await confirmDialog('删除质疑/投诉','确定删除该质疑/投诉记录？相关附件将一并删除。','删除','btn-danger'))return;
    await api('DELETE','/api/projects/'+currentProject.id+'/complaints/'+id);
    await refreshProject();
    reopenStageModule('result_publication');
}
async function resolveComplaint(id) {
    if(!await confirmDialog('标记已解决','确定将该质疑/投诉标记为「已解决」？项目将恢复正常状态。','标记已解决','btn-success'))return;
    await api('POST','/api/projects/'+currentProject.id+'/complaints/'+id+'/set-status',{action:'resolve'});
    toast('✅ 已标记为已解决','success');
    await refreshProject();
    reopenStageModule('result_publication');
}
async function escalateComplaint(id) {
    if(!await confirmDialog('转为投诉','确定将该质疑「转为投诉」？项目将进入投诉处理状态。','转为投诉','btn-danger'))return;
    await api('POST','/api/projects/'+currentProject.id+'/complaints/'+id+'/set-status',{action:'escalate'});
    toast('❗ 已转为投诉','info');
    await refreshProject();
    reopenStageModule('result_publication');
}
// 采购方存档资料寄出开关（资料整理归档阶段）
function renderArchiveCatalogSection(p){
    const items=p.archive_catalog||[], applicable=items.filter(x=>x.applicable), done=applicable.filter(x=>x.complete).length;
    const groups={};items.forEach(x=>(groups[x.category]||(groups[x.category]=[])).push(x));
    const groupHtml=Object.entries(groups).map(([category,list])=>`<div class="archive-group"><h4>${escHtml(category)}</h4>${list.map(x=>`<div class="archive-item ${!x.applicable?'muted':x.complete?'complete':''}"><input type="checkbox" class="archive-batch-check" value="${x.id}" onclick="updateArchiveSelectionCount()" aria-label="选择${escHtml(x.document_name)}"><div><b>${escHtml(x.document_name)}</b><p>${!x.applicable?'不适用':[x.has_original?'原件':'',x.has_scan?'扫描件':'',x.agency_copies?`代理留存${x.agency_copies}份`:'',x.purchaser_copies?`采购人${x.purchaser_copies}份`:'',x.transferred?'已移交':''].filter(Boolean).join(' · ')||'待核验'}${x.missing_reason?` · 缺失：${escHtml(x.missing_reason)}`:''}</p></div><div><button class="icon-text-btn" onclick="showArchiveCatalogForm(${x.id})">核验</button>${x.is_custom?`<button class="icon-text-btn danger" onclick="deleteArchiveCatalogItem(${x.id})">删除</button>`:''}</div></div>`).join('')}</div>`).join('');
    return `<div class="biz-sec"><div class="biz-bar"><span>归档资料目录　${done}/${applicable.length}</span><button class="btn btn-xs btn-primary" onclick="showArchiveCatalogForm()">+ 自定义资料</button></div><div class="archive-progress"><span style="width:${applicable.length?Math.round(done/applicable.length*100):100}%"></span></div><div class="archive-bulk-bar"><label><input type="checkbox" id="archiveSelectAll" onchange="toggleAllArchiveItems(this.checked)"> 全选</label><span id="archiveSelectedCount">已选 0 项</span><button class="btn btn-xs btn-primary" onclick="showBulkArchiveForm()">批量核验</button></div><div class="biz-body archive-catalog">${groupHtml}</div></div><div class="biz-sec"><div class="biz-bar"><span>采购方存档资料移交</span></div><div class="biz-body"><div class="toggle-row" onclick="toggleProcurementArchive()"><div class="toggle-switch"><input type="checkbox" id="procArchiveSent" ${p.procurement_archive_sent?'checked':''} onclick="event.stopPropagation();toggleProcurementArchive()"><span class="toggle-slider toggle-success"></span></div><span class="toggle-label">${p.procurement_archive_sent?'已移交采购方存档资料':'尚未移交采购方存档资料'}</span>${p.procurement_archive_sent_date?`<small>${p.procurement_archive_sent_date}</small>`:''}</div></div></div>`;
}
function selectedArchiveIds(){return [...document.querySelectorAll('.archive-batch-check:checked')].map(x=>Number(x.value));}
function updateArchiveSelectionCount(){const all=[...document.querySelectorAll('.archive-batch-check')],selected=all.filter(x=>x.checked);const text=document.getElementById('archiveSelectedCount');if(text)text.textContent=`已选 ${selected.length} 项`;const master=document.getElementById('archiveSelectAll');if(master){master.checked=all.length>0&&selected.length===all.length;master.indeterminate=selected.length>0&&selected.length<all.length;}}
function toggleAllArchiveItems(checked){document.querySelectorAll('.archive-batch-check').forEach(x=>x.checked=checked);updateArchiveSelectionCount();}
function showBulkArchiveForm(){
    const ids=selectedArchiveIds();if(!ids.length){toast('请先勾选需要核验的资料','warning');return;}
    const option=(id,label)=>`<div class="form-group"><label>${label}</label><select id="${id}"><option value="">保持原值</option><option value="true">是</option><option value="false">否</option></select></div>`;
    const html=`<div class="modal-form"><div class="bulk-selection-note">将批量核验 <b>${ids.length}</b> 项资料，保持原值的字段不会被修改。</div><div class="form-grid-2">${option('bulkApplicable','本项目适用')}${option('bulkOriginal','有原件')}${option('bulkScan','有扫描件')}${option('bulkTransferred','已移交采购人')}<div class="form-group"><label>代理机构留存份数</label><input type="number" min="0" id="bulkAgencyCopies" placeholder="留空保持原值"></div><div class="form-group"><label>采购人留存份数</label><input type="number" min="0" id="bulkPurchaserCopies" placeholder="留空保持原值"></div></div><div class="form-group"><label>统一缺失原因</label><input id="bulkMissingReason" placeholder="留空保持原值；输入“清空”可清除已有原因"></div></div>`;
    showModal('批量核验归档资料',html,async()=>{const parseSelect=id=>{const v=document.getElementById(id).value;return v===''?null:v==='true';};const data={ids,applicable:parseSelect('bulkApplicable'),has_original:parseSelect('bulkOriginal'),has_scan:parseSelect('bulkScan'),transferred:parseSelect('bulkTransferred'),agency_copies:document.getElementById('bulkAgencyCopies').value,purchaser_copies:document.getElementById('bulkPurchaserCopies').value};const reason=document.getElementById('bulkMissingReason').value.trim();if(reason)data.missing_reason=reason==='清空'?'':reason;const changed=Object.prototype.hasOwnProperty.call(data,'missing_reason')||Object.entries(data).some(([k,v])=>k!=='ids'&&v!==null&&v!=='');if(!changed){toast('请选择至少一个需要修改的字段','warning');return false;}const result=await api('PUT',`/api/projects/${currentProject.id}/archive-catalog/bulk`,data);toast(`已批量核验 ${result.updated} 项资料`,'success');closeModal();await refreshProject();reopenStageModule('archive');});
}
function showArchiveCatalogForm(id){
    const item=id?(currentProject.archive_catalog||[]).find(x=>x.id===id):null;
    const html=`<div class="modal-form">${!item?`<div class="form-grid-2"><div class="form-group"><label>资料类别</label><input id="archiveCategory" value="其他资料"></div><div class="form-group"><label>资料名称</label><input id="archiveName"></div></div>`:`<h3 style="font-size:16px">${escHtml(item.document_name)}</h3><p style="color:var(--text3);margin-bottom:12px">${escHtml(item.category)}</p><label class="inline-check"><input type="checkbox" id="archiveApplicable" ${item.applicable?'checked':''}> 本项目适用</label><div class="archive-check-grid"><label><input type="checkbox" id="archiveOriginal" ${item.has_original?'checked':''}> 有原件</label><label><input type="checkbox" id="archiveScan" ${item.has_scan?'checked':''}> 有扫描件</label><label><input type="checkbox" id="archiveTransferred" ${item.transferred?'checked':''}> 已移交采购人</label></div><div class="form-grid-2"><div class="form-group"><label>代理机构留存份数</label><input type="number" min="0" id="archiveAgencyCopies" value="${item.agency_copies||0}"></div><div class="form-group"><label>采购人留存份数</label><input type="number" min="0" id="archivePurchaserCopies" value="${item.purchaser_copies||0}"></div></div><div class="form-group"><label>缺失原因</label><textarea id="archiveMissing" rows="2">${escHtml(item.missing_reason||'')}</textarea></div><div class="form-group"><label>备注</label><textarea id="archiveItemNotes" rows="2">${escHtml(item.notes||'')}</textarea></div>`}</div>`;
    showModal(item?'核验归档资料':'添加自定义归档资料',html,async()=>{if(!item){const name=document.getElementById('archiveName').value.trim();if(!name){toast('请填写资料名称','warning');return false;}await api('POST',`/api/projects/${currentProject.id}/archive-catalog`,{category:document.getElementById('archiveCategory').value.trim(),document_name:name});}else{await api('PUT',`/api/projects/${currentProject.id}/archive-catalog/${id}`,{applicable:document.getElementById('archiveApplicable').checked,has_original:document.getElementById('archiveOriginal').checked,has_scan:document.getElementById('archiveScan').checked,transferred:document.getElementById('archiveTransferred').checked,agency_copies:document.getElementById('archiveAgencyCopies').value,purchaser_copies:document.getElementById('archivePurchaserCopies').value,missing_reason:document.getElementById('archiveMissing').value.trim(),notes:document.getElementById('archiveItemNotes').value.trim()});}closeModal();await refreshProject();reopenStageModule('archive');});
}
async function deleteArchiveCatalogItem(id){if(!await confirmDialog('删除归档项','确定删除这个自定义归档项？','删除','btn-danger'))return;await api('DELETE',`/api/projects/${currentProject.id}/archive-catalog/${id}`);await refreshProject();reopenStageModule('archive');}
async function toggleProcurementArchive() {
    const p = currentProject;
    if (!p) return;
    const val = !p.procurement_archive_sent;
    try {
        await api('PUT','/api/projects/'+p.id,{procurement_archive_sent: val});
        toast(val ? '✅ 已标记寄出采购方存档资料' : '↩️ 已撤销寄出标记','success');
        await refreshProject();
        reopenStageModule('archive');
    } catch(e) { toast('❌ '+e.message,'error'); }
}

function showArchiveForm(id) {
    const p = currentProject;
    const a = id ? (p.archive_deliveries || []).find(x => x.id === id) : null;
    const html = `<div class="modal-form">
        <div class="form-group"><label>采购人/接收方</label><input id="arcRecipient" value="${escHtml(a ? a.recipient : '')}"></div>
        <div class="form-group"><label>地址</label><input id="arcAddress" value="${escHtml(a ? a.address : '')}"></div>
        <div class="form-group"><label>联系人</label><input id="arcContact" value="${escHtml(a ? a.contact : '')}"></div>
        <div class="form-group"><label>电话</label><input id="arcPhone" value="${escHtml(a ? a.phone : '')}"></div>
        <div class="form-group"><label>寄出日期</label><input type="date" id="arcSentDate" value="${a && a.sent_date ? a.sent_date : ''}"></div>
        <div class="form-group"><label>快递单号</label><input id="arcTracking" value="${escHtml(a ? a.tracking_number : '')}"></div>
        <div class="form-group"><label>备注</label><textarea id="arcNotes" rows="2">${escHtml(a ? a.notes : '')}</textarea></div>
    </div>`;
    showModal(id ? '编辑存档寄出' : '新增存档寄出', html, async () => {
        const data = { recipient: document.getElementById('arcRecipient').value.trim(), address: document.getElementById('arcAddress').value.trim(), contact: document.getElementById('arcContact').value.trim(), phone: document.getElementById('arcPhone').value.trim(), sent_date: document.getElementById('arcSentDate').value || null, tracking_number: document.getElementById('arcTracking').value.trim(), notes: document.getElementById('arcNotes').value.trim() };
        if (id) { await api('PUT', '/api/projects/'+p.id+'/archive-deliveries/'+id, data); }
        else { await api('POST', '/api/projects/'+p.id+'/archive-deliveries', data); }
        closeModal(); await refreshProject();
    });
}
async function deleteArchive(id) { if(await confirmDialog('删除存档寄出记录','确定删除该存档寄出记录？','删除','btn-danger')){await api('DELETE','/api/projects/'+currentProject.id+'/archive-deliveries/'+id);await refreshProject();} }
function prefetchCommonViews() {
    const run = () => {
        loadCalendar();
        loadSettingsView();
    };
    if (typeof window.requestIdleCallback === 'function') {
        window.requestIdleCallback(run, {timeout: 1200});
    } else {
        setTimeout(run, 150);
    }
}
