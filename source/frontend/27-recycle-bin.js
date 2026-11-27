// ── Recycle bin management (soft-deleted projects, attachments, complaints, clarifications) ──
'use strict';

const recycleBinState = {
    loading: false,
    loaded: false,
    error: '',
    items: [],
    total: 0,
    page: 1,
    pageSize: 30,
    type: 'all',
    query: '',
    counts: {all: 0, project: 0, attachment: 0, complaint: 0, clarification: 0},
    retentionDays: 30,
    canEmpty: false,
    busyId: null,
    savingRetention: false,
};

const RECYCLE_BIN_TYPE_LABELS = Object.freeze({
    all: '全部',
    project: '项目',
    attachment: '附件',
    complaint: '质疑/投诉',
    clarification: '澄清/更正',
});

function formatRecycleBytes(bytes) {
    const n = Number(bytes || 0);
    if (!Number.isFinite(n) || n <= 0) return '0 B';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRecycleTime(value) {
    if (!value) return '-';
    const text = String(value).replace('T', ' ');
    return text.length > 16 ? text.slice(0, 16) : text;
}

function recycleBinMetaSummary(item) {
    const snap = item?.snapshot || {};
    const parts = [];
    if (item.entity_type === 'project') {
        if (snap.purchaser) parts.push(`采购人：${snap.purchaser}`);
        if (snap.year) parts.push(`${snap.year}年`);
        if (snap.method) parts.push(snap.method);
        if (snap.attachment_count) parts.push(`${snap.attachment_count} 个附件（${formatRecycleBytes(snap.attachment_bytes)}）`);
    } else {
        const projLabel = [snap.project_number, snap.project_name].filter(Boolean).join(' · ');
        if (projLabel) parts.push(`所属项目：${projLabel}`);
        if (item.entity_type === 'attachment' && snap.file_size) parts.push(formatRecycleBytes(snap.file_size));
        if (item.entity_type === 'complaint' && snap.status) parts.push(`状态：${snap.status}`);
        if (item.entity_type === 'clarification' && snap.publish_date) parts.push(`发布：${snap.publish_date}`);
    }
    if (item.deleted_by_name) parts.push(`操作人：${item.deleted_by_name}`);
    if (item.deleted_at) parts.push(`删除于 ${formatRecycleTime(item.deleted_at)}`);
    if (item.delete_reason) parts.push(`原因：${item.delete_reason}`);
    return parts.join(' · ');
}

function renderRecycleBinRetentionBadge(item) {
    if (item.purge_after == null || item.days_remaining == null) {
        return '<span class="rb-badge rb-badge-neutral">长期保留</span>';
    }
    const days = Number(item.days_remaining);
    if (days <= 0) return '<span class="rb-badge rb-badge-danger">即将清理</span>';
    if (days <= 5) return `<span class="rb-badge rb-badge-warn">剩余 ${days} 天</span>`;
    return `<span class="rb-badge rb-badge-neutral">剩余 ${days} 天</span>`;
}

function renderRecycleBinResultsHtml() {
    const st = recycleBinState;
    if (st.loading && !st.loaded) {
        return '<div class="rb-empty" role="status">正在读取回收站记录…</div>';
    }
    if (st.error) {
        return `<div class="rb-error" role="alert">${escHtml(st.error)} <button type="button" class="btn btn-sm btn-secondary" onclick="loadRecycleBinPanel({force:true})">重试</button></div>`;
    }
    if (!st.items.length) {
        return `<div class="rb-empty">${st.query || st.type !== 'all' ? '当前筛选条件下没有回收站记录。' : '回收站为空，删除的项目、附件、质疑或澄清记录会先保留在这里，可随时恢复。'}</div>`;
    }
    const totalPages = Math.max(1, Math.ceil(st.total / st.pageSize));
    return `
      <div class="rb-list" role="list">
        ${st.items.map(item => {
            const busy = st.busyId === item.id;
            const typeLabel = RECYCLE_BIN_TYPE_LABELS[item.entity_type] || item.entity_type;
            const parentWarn = item.parent_project_deleted
                ? '<div class="rb-parent-warn">所属项目仍在回收站，请先恢复所属项目</div>' : '';
            return `<article class="rb-item" role="listitem">
              <div class="rb-item-main">
                <div class="rb-item-head">
                  <span class="rb-type-tag rb-type-${escHtml(item.entity_type)}">${escHtml(typeLabel)}</span>
                  <strong class="rb-item-title">${escHtml(item.display_title || '未命名记录')}</strong>
                  ${renderRecycleBinRetentionBadge(item)}
                </div>
                <div class="rb-item-meta">${escHtml(recycleBinMetaSummary(item))}</div>
                ${parentWarn}
              </div>
              <div class="rb-item-actions">
                ${item.can_restore ? `<button type="button" class="btn btn-sm btn-secondary" ${busy || item.parent_project_deleted ? 'disabled' : ''} onclick="restoreRecycleBinItem(${item.id})">${busy ? '处理中…' : '恢复'}</button>` : ''}
                ${item.can_purge ? `<button type="button" class="btn btn-sm btn-danger btn-quiet-danger" ${busy ? 'disabled' : ''} onclick="purgeRecycleBinItem(${item.id})">彻底删除</button>` : ''}
              </div>
            </article>`;
        }).join('')}
      </div>
      ${totalPages > 1 ? `<div class="rb-pager">
        <span>共 ${st.total} 条 · 第 ${st.page} / ${totalPages} 页</span>
        <div class="rb-pager-actions">
          <button type="button" class="btn btn-sm btn-secondary" ${st.page <= 1 ? 'disabled' : ''} onclick="setRecycleBinPage(${st.page - 1})">上一页</button>
          <button type="button" class="btn btn-sm btn-secondary" ${st.page >= totalPages ? 'disabled' : ''} onclick="setRecycleBinPage(${st.page + 1})">下一页</button>
        </div>
      </div>` : ''}`;
}

function renderColdArchiveSettingsCard() {
    const isAdmin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
    if (!isAdmin) return '';
    const winVal = typeof systemSettings !== 'undefined' && systemSettings?.cold_archive_active_years != null
        ? systemSettings.cold_archive_active_years
        : 2;
    return `<section class="settings-card settings-card-wide" aria-label="项目列表与年度归档">
      <div class="rb-header">
        <div>
          <h2>项目列表与年度归档</h2>
          <p class="settings-note">多年积累大量历史项目时，默认按活跃年度窗口折叠已完结和已终止的早期项目以加速首屏加载，进行中的项目永不折叠。</p>
        </div>
      </div>
      <div class="rb-retention-bar">
        <label for="coldArchiveActiveYears">活跃年度窗口（年）</label>
        <input type="number" id="coldArchiveActiveYears" data-immediate-setting min="0" max="10" step="1" value="${escHtml(String(winVal))}" aria-describedby="coldArchiveHint">
        <button type="button" class="btn btn-sm btn-secondary" onclick="saveColdArchiveWindow()">保存归档策略</button>
        <span id="coldArchiveHint" class="rb-retention-hint">默认近 2 年为活跃年度；更早年份的已完结/已终止项目自动折叠（填 0 关闭）</span>
      </div>
    </section>`;
}

function renderRecycleBinCard() {
    const st = recycleBinState;
    const isAdmin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
    const tabs = ['all', 'project', 'attachment', 'complaint', 'clarification'].map(key => {
        const active = st.type === key;
        const count = Number(st.counts?.[key] || 0);
        return `<button type="button" class="rb-filter-chip ${active ? 'active' : ''}" data-rb-type="${key}" role="tab" aria-selected="${active}" onclick="setRecycleBinType('${key}')">${RECYCLE_BIN_TYPE_LABELS[key]} <span class="rb-chip-count">${count}</span></button>`;
    }).join('');

    return `<section id="recycleBinShell" class="settings-card settings-card-wide rb-card" aria-label="回收站管理">
      <div class="rb-header">
        <div>
          <h2>回收站 <span id="rbTotalPill" class="rb-total-pill">${Number(st.counts?.all || 0)}</span></h2>
          <p class="settings-note">删除项目、附件、质疑和澄清记录时会先移入回收站并保留原文件，到期或确认彻底删除后才释放磁盘空间。</p>
        </div>
        <div class="rb-header-actions">
          <button type="button" id="rbRefreshBtn" class="btn btn-sm btn-secondary" onclick="loadRecycleBinPanel({force:true})" ${st.loading ? 'disabled' : ''}>刷新</button>
          ${isAdmin ? `<button type="button" id="rbEmptyBtn" class="btn btn-sm btn-danger btn-quiet-danger" ${st.counts.all > 0 ? '' : 'hidden'} onclick="emptyRecycleBin()">清空回收站</button>` : ''}
        </div>
      </div>
      ${isAdmin ? `<div class="rb-retention-bar">
        <label for="recycleRetentionDays">自动保留天数</label>
        <input type="number" id="recycleRetentionDays" data-immediate-setting min="0" max="365" step="1" value="${escHtml(String(st.retentionDays))}" aria-describedby="recycleRetentionHint">
        <button type="button" id="rbSaveRetentionBtn" class="btn btn-sm btn-secondary" ${st.savingRetention ? 'disabled' : ''} onclick="saveRecycleBinRetention()">${st.savingRetention ? '保存中…' : '保存保留策略'}</button>
        <span id="recycleRetentionHint" class="rb-retention-hint">填写 1–365 天，填 0 表示不自动清理</span>
      </div>` : ''}
      <div class="rb-toolbar">
        <div class="rb-filter-tabs" role="tablist" aria-label="按记录类型筛选回收站">${tabs}</div>
        <div class="rb-search-wrap">
          <input type="search" id="recycleBinSearchInput" data-immediate-setting placeholder="搜索编号、名称、文件名或操作人…" aria-label="搜索回收站" value="${escHtml(st.query)}" oninput="onRecycleBinSearchInput(this.value)">
        </div>
      </div>
      <div id="recycleBinResults">${renderRecycleBinResultsHtml()}</div>
    </section>`;
}

function mountRecycleBinCard({syncRetentionInput = false} = {}) {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') return;
    try {
        const host = document.getElementById('recycleBinHost');
        if (!host) return;
        const shell = host.querySelector('#recycleBinShell');
        if (!shell) {
            host.innerHTML = renderRecycleBinCard();
            return;
        }
        const st = recycleBinState;
        const isAdmin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
        const totalPill = shell.querySelector('#rbTotalPill');
        if (totalPill) totalPill.textContent = String(Number(st.counts?.all || 0));
        const refreshBtn = shell.querySelector('#rbRefreshBtn');
        if (refreshBtn) refreshBtn.disabled = Boolean(st.loading);
        const emptyBtn = shell.querySelector('#rbEmptyBtn');
        if (emptyBtn) emptyBtn.hidden = !(isAdmin && Number(st.counts?.all || 0) > 0);
        const saveRetBtn = shell.querySelector('#rbSaveRetentionBtn');
        if (saveRetBtn) {
            saveRetBtn.disabled = Boolean(st.savingRetention);
            saveRetBtn.textContent = st.savingRetention ? '保存中…' : '保存保留策略';
        }
        if (syncRetentionInput) {
            const retInput = shell.querySelector('#recycleRetentionDays');
            if (retInput && document.activeElement !== retInput) {
                retInput.value = String(st.retentionDays);
            }
        }
        shell.querySelectorAll('.rb-filter-chip[data-rb-type]').forEach(btn => {
            const key = btn.getAttribute('data-rb-type');
            const active = st.type === key;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
            const cnt = btn.querySelector('.rb-chip-count');
            if (cnt) cnt.textContent = String(Number(st.counts?.[key] || 0));
        });
        const resultsEl = shell.querySelector('#recycleBinResults');
        if (resultsEl) resultsEl.innerHTML = renderRecycleBinResultsHtml();
    } catch (_) {}
}

let recycleBinSearchTimer = null;
function onRecycleBinSearchInput(value) {
    recycleBinState.query = String(value || '').trim();
    recycleBinState.page = 1;
    clearTimeout(recycleBinSearchTimer);
    recycleBinSearchTimer = setTimeout(() => {
        void loadRecycleBinPanel({force: true});
    }, 220);
}

function setRecycleBinType(type) {
    recycleBinState.type = type || 'all';
    recycleBinState.page = 1;
    mountRecycleBinCard();
    void loadRecycleBinPanel({force: true});
}

function setRecycleBinPage(page) {
    recycleBinState.page = Math.max(1, Number(page) || 1);
    void loadRecycleBinPanel({force: true});
}

async function loadRecycleBinPanel({force = false} = {}) {
    if (recycleBinState.loading && !force) return;
    const isInitial = !recycleBinState.loaded;
    recycleBinState.loading = true;
    recycleBinState.error = '';
    mountRecycleBinCard();
    try {
        const params = new URLSearchParams({
            type: recycleBinState.type || 'all',
            page: String(recycleBinState.page || 1),
            page_size: String(recycleBinState.pageSize || 30),
        });
        if (recycleBinState.query) params.set('q', recycleBinState.query);
        const res = await api('GET', `/api/recycle-bin?${params.toString()}`);
        recycleBinState.items = Array.isArray(res?.items) ? res.items : [];
        recycleBinState.total = Number(res?.total || 0);
        recycleBinState.counts = res?.counts || {all: 0, project: 0, attachment: 0, complaint: 0, clarification: 0};
        recycleBinState.retentionDays = Number(res?.retention_days ?? 30);
        recycleBinState.canEmpty = Boolean(res?.can_empty);
        recycleBinState.loaded = true;
    } catch (err) {
        recycleBinState.error = err?.message || '读取回收站失败';
    } finally {
        recycleBinState.loading = false;
        mountRecycleBinCard({syncRetentionInput: isInitial});
    }
}

async function saveRecycleBinRetention() {
    const input = document.getElementById('recycleRetentionDays');
    const raw = input ? Number(input.value) : recycleBinState.retentionDays;
    if (!Number.isInteger(raw) || raw < 0 || raw > 365) {
        toast('保留天数须为 0 至 365 的整数', 'warning');
        return;
    }
    recycleBinState.savingRetention = true;
    mountRecycleBinCard();
    try {
        await api('PATCH', '/api/settings', {recycle_bin_retention_days: raw});
        recycleBinState.retentionDays = raw;
        toast(raw === 0 ? '已设为长期保留（不自动清理）' : `回收站自动保留天数已更新为 ${raw} 天`, 'success');
    } catch (err) {
        toast(err?.message || '保存保留策略失败', 'error');
    } finally {
        recycleBinState.savingRetention = false;
        mountRecycleBinCard({syncRetentionInput: true});
    }
}

async function saveColdArchiveWindow() {
    const input = document.getElementById('coldArchiveActiveYears');
    const raw = input ? Number(input.value) : 2;
    if (!Number.isInteger(raw) || raw < 0 || raw > 10) {
        toast('活跃年度窗口须为 0 至 10 的整数', 'warning');
        return;
    }
    try {
        await api('PATCH', '/api/settings', {cold_archive_active_years: raw});
        if (typeof systemSettings === 'object' && systemSettings) {
            systemSettings.cold_archive_active_years = raw;
        }
        toast(raw === 0 ? '已关闭年度冷归档折叠' : `年度冷归档窗口已更新为近 ${raw} 年`, 'success');
        if (typeof refreshProjectYearSummary === 'function') {
            await refreshProjectYearSummary();
        }
    } catch (err) {
        toast(err?.message || '保存归档策略失败', 'error');
    }
}

function promptRecycleNumberConflict(itemId, originalNumber) {
    const safeOrig = escHtml(originalNumber || '');
    showModal(
        '项目编号已被占用',
        `<p class="rb-conflict-hint">原编号 <strong>${safeOrig}</strong> 已被其他现有项目使用。请输入一个新编号以恢复该项目：</p>
         <div class="form-group">
           <label for="rbRestoreNewNumber">新项目编号</label>
           <input type="text" id="rbRestoreNewNumber" value="${safeOrig}-恢复" autocomplete="off">
         </div>
         <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
           <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
           <button type="button" class="btn btn-primary" data-dialog-submit onclick="confirmRestoreWithNewNumber(${itemId})">确认恢复</button>
         </div>`
    );
    setTimeout(() => document.getElementById('rbRestoreNewNumber')?.focus(), 40);
}

async function confirmRestoreWithNewNumber(itemId) {
    const input = document.getElementById('rbRestoreNewNumber');
    const newNumber = String(input?.value || '').trim();
    if (!newNumber) {
        toast('请输入新的项目编号', 'warning');
        return;
    }
    closeModal();
    await restoreRecycleBinItem(itemId, newNumber);
}

async function restoreRecycleBinItem(itemId, newNumber = '') {
    recycleBinState.busyId = itemId;
    mountRecycleBinCard();
    try {
        const body = newNumber ? {new_number: newNumber} : {};
        const res = await api('POST', `/api/recycle-bin/${itemId}/restore`, body);
        toast(res?.message || '已恢复', 'success');
        if (typeof invalidateViewCache === 'function') invalidateViewCache();
        if (typeof loadAllProjects === 'function') {
            try { await loadAllProjects(); } catch (_) {}
        }
        await loadRecycleBinPanel({force: true});
    } catch (err) {
        const payload = err?.details || err?.payload || {};
        const code = err?.error_code || payload?.code;
        if (err?.status === 409 && code === 'number_conflict') {
            promptRecycleNumberConflict(itemId, payload.original_number || '');
        } else {
            toast(err?.message || '恢复失败', 'error');
        }
    } finally {
        recycleBinState.busyId = null;
        mountRecycleBinCard();
    }
}

async function purgeRecycleBinItem(itemId) {
    const item = recycleBinState.items.find(row => row.id === itemId);
    const label = item?.display_title || '该记录';
    const ok = await confirmDialog(
        '彻底删除确认',
        `确定彻底删除「${label}」吗？\n\n此操作将永久清除数据库记录与对应附件物理文件，无法再恢复。`,
        '彻底删除',
        'btn-danger'
    );
    if (!ok) return;
    recycleBinState.busyId = itemId;
    mountRecycleBinCard();
    try {
        const res = await api('DELETE', `/api/recycle-bin/${itemId}`);
        toast(res?.message || '已彻底删除', 'success');
        await loadRecycleBinPanel({force: true});
    } catch (err) {
        toast(err?.message || '彻底删除失败', 'error');
    } finally {
        recycleBinState.busyId = null;
        mountRecycleBinCard();
    }
}

async function emptyRecycleBin() {
    const total = Number(recycleBinState.counts?.all || 0);
    if (!total) return;
    const ok = await confirmDialog(
        '清空回收站',
        `确定清空回收站中的全部 ${total} 条记录吗？\n\n所有已删除项目及其物理附件将被永久移除，不可撤销。`,
        '确认清空',
        'btn-danger'
    );
    if (!ok) return;
    recycleBinState.loading = true;
    mountRecycleBinCard();
    try {
        const res = await api('POST', '/api/recycle-bin/empty', {});
        toast(res?.message || '回收站已清空', 'success');
        await loadRecycleBinPanel({force: true});
    } catch (err) {
        toast(err?.message || '清空回收站失败', 'error');
    } finally {
        recycleBinState.loading = false;
        mountRecycleBinCard();
    }
}
