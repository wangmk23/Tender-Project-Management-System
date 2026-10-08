/* ── 项目管理系统 SPA ── */
const STAGES = [
    {key:'plan_received',name:'计划接收',icon:'📥',group:'前期',order:1},
    {key:'doc_prepare',name:'文件编制',icon:'📝',group:'前期',order:2},
    {key:'doc_review',name:'文件审核',icon:'🔍',group:'前期',order:3},
    {key:'doc_finalized',name:'文件定稿',icon:'✅',group:'前期',order:4},
    {key:'agreement_signed',name:'委托协议签定',icon:'📋',group:'前期',order:5},
    {key:'announcement',name:'公告发布',icon:'📢',group:'中期',order:6},
    {key:'registration_end',name:'报名截止',icon:'⏰',group:'中期',order:7},
    {key:'bid_opening',name:'开标',icon:'🎯',group:'中期',order:8},
    {key:'evaluation',name:'评标',icon:'📊',group:'中期',order:9},
    {key:'result_announced',name:'结果公示',icon:'📣',group:'后期',order:10},
    {key:'winning_notice',name:'中标通知书',icon:'🏆',group:'后期',order:11},
    {key:'service_fee',name:'服务费到账',icon:'💰',group:'后期',order:12},
    {key:'deposit_refund',name:'保证金退还',icon:'💳',group:'后期',order:13},
    {key:'archived',name:'资料整理归档',icon:'📦',group:'收尾',order:14},
];
const STAGE_KEYS = STAGES.map(s=>s.key);
const STAGE_NAME_CN = {};
STAGES.forEach(s=>{STAGE_NAME_CN[s.key]=s.name});

const METHODS = ['公开招标','竞争性磋商','竞争性谈判','邀请招标','网上竞价','单一来源','遴选','直选'];

let allProjects = [];
let currentProject = null;
const projectById = new Map();
const projectSearchById = new Map();
const projectOrderById = new Map();
const purchaserUnitByName = new Map();
const projectDetailCache = new Map();
const projectDetailRequests = new Map();
const projectDetailRequestVersions = new Map();
const PROJECT_PREFETCH_LIMIT = 3;
const projectPrefetchQueue = [];
const projectPrefetchQueued = new Set();
let projectPrefetchActive = 0;
let projectPrefetchGeneration = 0;
let projectSelectionVersion = 0;
let projectNavigationVersion = 0;
let projectEditVersion = 0;

function isApplicationTextInput(target) {
    return Boolean(target?.isContentEditable || target?.closest?.(
        'input,textarea,select,[contenteditable]:not([contenteditable="false"]),[role="textbox"]'
    ));
}

function isEditingApplicationForm() {
    return isApplicationTextInput(document.activeElement);
}
let currentEditingProjectId = null;
let editingStageKey = null;
let calendarYear = new Date().getFullYear();
let calendarMonth = new Date().getMonth() + 1;
let calendarSelectedDate = '';
let calendarEventsByDate = new Map();
let sidebarFilter = 'all';
let sidebarManageMode = false;
let selectedProjectIds = new Set();
let currentIsAdmin = false;
let systemInfo = null;
let systemSettings = null;
const activeUploads = new Set();

const VIEW_CACHE_TTL_MS = 30000;
const viewDataCache = new Map();
const viewDataRequests = new Map();
const viewDataRequestVersions = new Map();

function readViewCache(key, now = Date.now()) {
    const entry = viewDataCache.get(key);
    if (!entry) return null;
    return {...entry, fresh: now - entry.savedAt <= VIEW_CACHE_TTL_MS};
}

function writeViewCache(key, value, savedAt = Date.now()) {
    const entry = {value, savedAt};
    viewDataCache.set(key, entry);
    return entry;
}

function invalidateViewCache(prefix) {
    const keys = new Set([
        ...viewDataCache.keys(),
        ...viewDataRequests.keys(),
        ...viewDataRequestVersions.keys(),
    ]);
    for (const key of keys) {
        if (key === prefix || key.startsWith(prefix)) {
            viewDataCache.delete(key);
            viewDataRequests.delete(key);
            viewDataRequestVersions.set(key, (viewDataRequestVersions.get(key) || 0) + 1);
        }
    }
}

function invalidateProjectDerivedState(projectId) {
    const key = Number(projectId);
    if (projectId !== undefined && projectId !== null && Number.isFinite(key)) {
        projectDetailCache.delete(key);
        projectDetailRequests.delete(key);
        projectDetailRequestVersions.set(
            key,
            (projectDetailRequestVersions.get(key) || 0) + 1,
        );
    }
    invalidateViewCache('dashboard');
    invalidateViewCache('calendar:');
    invalidateViewCache('procure');
    invalidateViewCache('purchaser-board');
    if (typeof purchaserBoardData !== 'undefined') purchaserBoardData = null;
    if (typeof purchaserUnitByName !== 'undefined') purchaserUnitByName.clear();
    if (typeof sidebarRenderSignature !== 'undefined') sidebarRenderSignature = '';
    if (typeof markSidebarDataChanged === 'function') markSidebarDataChanged();
    if (typeof invalidateCommandCenterData === 'function') invalidateCommandCenterData();
    if (typeof invalidateChartBoardData === 'function') invalidateChartBoardData();
}

function invalidateProjectViews() {
    invalidateProjectDerivedState();
}

function requestViewData(key, loader, {force = false} = {}) {
    if (!force && viewDataRequests.has(key)) return viewDataRequests.get(key);
    const version = (viewDataRequestVersions.get(key) || 0) + 1;
    viewDataRequestVersions.set(key, version);
    let request;
    try {
        request = Promise.resolve(loader());
    } catch (error) {
        request = Promise.reject(error);
    }
    request = request.then(
        value => ({value, accepted: viewDataRequestVersions.get(key) === version}),
        error => {
            if (viewDataRequestVersions.get(key) !== version) {
                return {error, accepted: false};
            }
            throw error;
        },
    ).finally(() => {
        if (viewDataRequests.get(key) === request) viewDataRequests.delete(key);
    });
    viewDataRequests.set(key, request);
    return request;
}

function isLoopbackHost(hostname = window.location.hostname) {
    const host = String(hostname || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    return host === 'localhost' || host === '127.0.0.1' || host === '::1';
}

function isDesktopApp() {
    return !!(systemInfo && systemInfo.is_desktop && isLoopbackHost());
}

const THEME_OPTIONS = [
    {key:'default', name:'默认浅色', desc:'清爽、耐看，适合日常办公'},
    {key:'blue', name:'清爽蓝', desc:'更明确的蓝色主调'},
    {key:'green', name:'护眼绿', desc:'低饱和背景，长时间查看更舒服'},
    {key:'dark', name:'暗色', desc:'夜间或低光环境使用'}
];

function applyTheme(theme) {
    const key = THEME_OPTIONS.some(t => t.key === theme) ? theme : 'default';
    document.documentElement.dataset.theme = key;
    localStorage.setItem('pm_theme', key);
}

function initTheme() {
    applyTheme(localStorage.getItem('pm_theme') || 'default');
}

// ── API Helper ──
async function localFetch(url, options = {}) {
    const parsed = new URL(url, window.location.origin);
    const isLocalApi = parsed.origin === window.location.origin
        && (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/'));
    if (!isLocalApi) throw new Error('Local API request rejected');
    return fetch(url, {...options, credentials: 'same-origin'});
}

async function apiForm(url, formData) {
    const headers = {Accept: 'application/json'};
    if (window.CSRF_TOKEN) headers['X-CSRFToken'] = window.CSRF_TOKEN;
    const response = await localFetch(url, {method: 'POST', headers, body: formData});
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
    return result;
}

async function api(method, url, body) {
    const normalizedMethod = String(method || '').toUpperCase();
    let requestBody = body;
    const projectUpdate = String(url).match(/^\/api\/projects\/(\d+)\/?$/);
    const stageUpdate = String(url).match(/^\/api\/projects\/(\d+)\/stages\/([^/]+)\/?$/);
    const selectedProject = projectUpdate
        ? (Number(projectUpdate[1]) === Number(currentProject?.id) ? currentProject : projectById.get(Number(projectUpdate[1])))
        : null;
    if (['PUT', 'DELETE'].includes(normalizedMethod) && projectUpdate
        && requestBody?.record_version === undefined && selectedProject?.record_version !== undefined) {
        requestBody = {...(requestBody || {}), record_version: selectedProject.record_version};
    } else if (normalizedMethod === 'PUT' && stageUpdate
        && Number(stageUpdate[1]) === Number(currentProject?.id)
        && requestBody?.record_version === undefined) {
        const stage = (currentProject.stages || []).find(item => item.key === decodeURIComponent(stageUpdate[2]));
        if (stage) requestBody = {...(requestBody || {}), record_version: stage.record_version};
    } else if (normalizedMethod === 'POST' && String(url) === '/api/batch/advance-stage'
        && Array.isArray(requestBody?.project_ids) && requestBody.stage_key) {
        const recordVersions = {};
        requestBody.project_ids.forEach(projectId => {
            const project = Number(projectId) === Number(currentProject?.id) ? currentProject : projectById.get(Number(projectId));
            const stage = (project?.stages || []).find(item => item.key === requestBody.stage_key);
            if (stage?.record_version !== undefined) recordVersions[String(projectId)] = stage.record_version;
        });
        requestBody = {...requestBody, record_versions: recordVersions};
    }
    const doRequest = async (retried) => {
        const headers = {Accept: 'application/json'};
        const opts = {method: normalizedMethod, headers, credentials: 'same-origin'};
        if (normalizedMethod !== 'GET' && window.CSRF_TOKEN) {
            headers['X-CSRFToken'] = window.CSRF_TOKEN;
        }
        if (requestBody !== undefined) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(requestBody);
        }
        const response = await localFetch(url, opts);
        const result = await response.json().catch(() => ({}));
        // CSRF 过期（400+“请求已过期”）时自动刷新 token 重试一次
        if (!response.ok && !retried && response.status === 400
            && result && /请求已过期/.test(result.error || '')) {
            try {
                const refreshed = await refreshAttachmentCsrfToken();
                if (refreshed) return doRequest(true);
            } catch (e) { /* 刷新失败则走正常错误路径 */ }
        }
        if (!response.ok) {
            const requestError = new Error(
                result.error || (response.status === 409 ? '发生编辑冲突：该内容已被其他成员修改，请重新加载' : `HTTP ${response.status}`)
            );
            requestError.error_code = result.code || result.error_code || null;
            requestError.status = response.status;
            throw requestError;
        }
        return result;
    };
    const result = await doRequest(false);
    const projectMatch = String(url || '').match(/^\/api\/projects(?:\/(\d+))?(?:\/|$)/);
    if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(normalizedMethod)) {
        if (projectMatch) {
            const affectedProjectId = projectMatch[1] ?? result?.id;
            invalidateProjectDerivedState(affectedProjectId);
            const deletesProject = normalizedMethod === 'DELETE'
                && /^\/api\/projects\/\d+\/?$/.test(String(url || ''));
            if (deletesProject && typeof cancelProjectPrefetch === 'function') {
                cancelProjectPrefetch(affectedProjectId);
            } else if (
                affectedProjectId != null
                && typeof queueProjectDetailPrefetch === 'function'
            ) {
                queueProjectDetailPrefetch(affectedProjectId, {front: true});
            }
        } else if (
            String(url || '').startsWith('/api/batch/advance-stage')
            && Array.isArray(body?.project_ids)
        ) {
            body.project_ids.forEach(projectId => {
                invalidateProjectDerivedState(projectId);
                if (typeof queueProjectDetailPrefetch === 'function') {
                    queueProjectDetailPrefetch(projectId, {front: true});
                }
            });
        }
    }
    return result;
}

// ── Toast & Loading ──
function uiStateMarkup(kind, message, options) {
    options = options || {};
    const states = {
        loading: {label: '加载中', role: 'status', live: 'polite', busy: true},
        empty: {label: '暂无内容', role: 'status', live: 'polite'},
        warning: {label: '需要注意', role: 'status', live: 'polite'},
        error: {label: '操作未完成', role: 'alert', live: 'assertive'},
        saving: {label: '正在保存', role: 'status', live: 'polite', busy: true},
        success: {label: '操作已完成', role: 'status', live: 'polite'},
    };
    const state = states[kind] || states.warning;
    const safeKind = states[kind] ? kind : 'warning';
    const compact = options.compact ? ' ui-state-compact' : '';
    const busy = state.busy ? ' aria-busy="true"' : '';
    const action = options.actionLabel
        ? `<button type="button" class="btn btn-secondary btn-sm ui-state-action">${escHtml(options.actionLabel)}</button>`
        : '';
    return `<div class="ui-state ui-state-${safeKind}${compact}" role="${state.role}" aria-live="${state.live}"${busy}>
        <span class="ui-state-indicator" aria-hidden="true"></span>
        <div class="ui-state-copy"><strong>${state.label}</strong><p>${escHtml(message || state.label)}</p></div>
        ${action}
    </div>`;
}

function toast(msg, type='info') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    if (typeof window !== 'undefined' && window.PMIcons) window.PMIcons.label(el, msg, ({success:'✅',warning:'⚠️',error:'❌',info:'ℹ️'})[type] || 'ℹ️');
    const state = ['success', 'warning', 'error'].includes(type) ? type : 'info';
    el.className = `toast ${state} show`;
    clearTimeout(el._timer);
    el._timer = setTimeout(()=>el.classList.remove('show'), 2500);
}

// ── 全局 Loading 状态 ──
function showLoading(msg='加载中...') {
    let loader = document.getElementById('globalLoader');
    if (!loader) {
        loader = document.createElement('div');
        loader.id = 'globalLoader';
        loader.innerHTML = `<div class="loader-spinner"></div><div class="loader-text">${escHtml(msg)}</div>`;
        document.body.appendChild(loader);
    }
    loader.querySelector('.loader-text').textContent = msg;
    loader.classList.add('show');
}
function hideLoading() {
    const loader = document.getElementById('globalLoader');
    if (loader) loader.classList.remove('show');
}

// ── 视图级 Loading ──
function showViewLoading(containerId) {
    const el = document.getElementById(containerId);
    if (el) el.innerHTML = uiStateMarkup('loading', '正在读取内容');
}

function renderViewSkeleton(containerId, label = '正在准备内容...') {
    const el = document.getElementById(containerId);
    if (!el || el.childElementCount || el.textContent.trim()) return;
    el.innerHTML = `<div class="view-skeleton" role="status" aria-live="polite">
        <span></span><span></span><span></span><small>${escHtml(label)}</small>
    </div>`;
}

function renderViewLoadError(containerId, message, retry, error) {
    const el = document.getElementById(containerId);
    if (!el) return;
    el.innerHTML = uiStateMarkup('error', message, {actionLabel: '重试'});
    if (error?.message) {
        const detail = `${error.status ? `HTTP ${error.status}：` : ''}${error.message}`.slice(0, 500);
        el.querySelector('.ui-state-copy')?.insertAdjacentHTML('beforeend',
            `<details class="view-error-detail"><summary>查看错误详情</summary><p>${escHtml(detail)}</p></details>`);
    }
    el.querySelector('button')?.addEventListener('click', retry);
}

// ── Mobile-safe Confirm Dialog (替代原生 confirm，手机端 WebView 不可靠) ──
function confirmDialog(title, message, okText='确定', okCls='btn-primary') {
    return new Promise(resolve => {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMsg').textContent = message;
        const okBtn = document.getElementById('confirmOk');
        okBtn.textContent = okText;
        okBtn.className = 'btn ' + okCls;
        const ov = document.getElementById('confirmOverlay');
        const dlg = document.getElementById('confirmDialog');
        const cancelBtn = document.getElementById('confirmCancel');
        ov.classList.add('open');
        dlg.classList.add('open');
        const done = (res) => {
            ov.classList.remove('open');
            dlg.classList.remove('open');
            ov.removeEventListener('click', onOverlay);
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
            releaseDialogFocus(dlg);
            resolve(res);
        };
        const onOverlay = (e) => { if (e.target === ov) done(false); };
        const onCancel = () => done(false);
        const onOk = () => done(true);
        ov.addEventListener('click', onOverlay);
        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
        activateDialogFocus(dlg, onCancel);
    });
}

// ── Reason Dialog (输入流标/废标原因，返回 {ok, value}) ──
function reasonDialog(title, label, placeholder, okText='确定', okCls='btn-primary', initial='') {
    return new Promise(resolve => {
        document.getElementById('reasonTitle').textContent = title;
        document.getElementById('reasonLabel').textContent = label;
        const ta = document.getElementById('reasonInput');
        ta.value = initial || '';
        ta.placeholder = placeholder || '';
        const okBtn = document.getElementById('reasonOk');
        okBtn.textContent = okText;
        okBtn.className = 'btn ' + okCls;
        const ov = document.getElementById('reasonOverlay');
        const dlg = document.getElementById('reasonDialog');
        const cancelBtn = document.getElementById('reasonCancel');
        ov.classList.add('open');
        dlg.classList.add('open');
        const done = (ok, val) => {
            ov.classList.remove('open');
            dlg.classList.remove('open');
            ov.removeEventListener('click', onOverlay);
            cancelBtn.removeEventListener('click', onCancel);
            okBtn.removeEventListener('click', onOk);
            releaseDialogFocus(dlg);
            resolve({ok, value: val});
        };
        const onOverlay = (e) => { if (e.target === ov) done(false, ''); };
        const onCancel = () => done(false, '');
        const onOk = () => done(true, ta.value.trim());
        ov.addEventListener('click', onOverlay);
        cancelBtn.addEventListener('click', onCancel);
        okBtn.addEventListener('click', onOk);
        activateDialogFocus(dlg, onCancel);
    });
}


// ── Sidebar toggle (mobile) ──
function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarBackdrop').classList.toggle('open');
}
function closeSidebar() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarBackdrop').classList.remove('open');
}
// ── Format Date ──
function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function stageKeyToken(value) {
    return encodeURIComponent(String(value ?? '')).replace(/'/g, '%27');
}

function stageKeyFromToken(value) {
    try { return decodeURIComponent(String(value ?? '')); }
    catch (_) { return ''; }
}

function stageApiSegment(value) {
    return stageKeyToken(value);
}

function projectStageDefinition(stageOrKey, project = currentProject) {
    const supplied = stageOrKey && typeof stageOrKey === 'object' ? stageOrKey : null;
    const key = String(supplied?.key || supplied?.stage_key || stageOrKey || '');
    const snapshot = supplied || (project?.stages || []).find(row =>
        String(row?.key || row?.stage_key || '') === key
    );
    const method = String(project?.method || '');
    const saved = (systemSettings?.stage_templates?.[method] || []).find(row =>
        String(row?.id || row?.key || '') === key
    );
    const legacy = (Array.isArray(STAGES) ? STAGES : []).find(row => String(row?.key || '') === key);
    const legacyModuleByStage = {
        doc_prepare: 'responsible_person', doc_review: 'responsible_person',
        announcement: 'clarification', registration_end: 'registration',
        bid_opening: 'bid_opening', evaluation: 'evaluation',
        result_announced: 'result_publication', winning_notice: 'winning_notice',
        service_fee: 'service_fee', deposit_refund: 'deposit_refund', archived: 'archive',
    };
    const rawModules = snapshot?.modules || saved?.modules;
    const modules = Array.isArray(rawModules)
        ? ['common', ...rawModules.map(String).filter((value, index, rows) => value !== 'common' && rows.indexOf(value) === index)]
        : ['common', 'checklist', ...(legacyModuleByStage[key] ? [legacyModuleByStage[key]] : [])];
    return {
        key,
        name: String(snapshot?.name || saved?.name || legacy?.name || STAGE_NAME_CN?.[key] || key),
        icon: String(snapshot?.icon || saved?.icon || legacy?.icon || '•'),
        modules,
    };
}

function stageHasModule(stageOrKey, moduleId, project = currentProject) {
    return projectStageDefinition(stageOrKey, project).modules.includes(String(moduleId));
}

// 根据项目快照返回阶段名；旧网上竞价项目仍兼容「成交通知书」。
function stageName(key, method, project = currentProject) {
    const definition = projectStageDefinition(key, project);
    const hasConfiguredName = (project?.stages || []).some(row =>
        String(row?.key || row?.stage_key || '') === String(key) && row?.name
    ) || (systemSettings?.stage_templates?.[String(method)] || []).some(row =>
        String(row?.id || row?.key || '') === String(key) && row?.name
    );
    if (!hasConfiguredName && key === 'winning_notice' && method === '网上竞价') return '成交通知书';
    return definition.name;
}

// 金额简短显示：>=10000 显示 X.XX 万，否则显示 ¥X,XXX 元
function formatMoneyShort(amount) {
    if (amount === null || amount === undefined || amount === '') return '';
    const n = Number(amount);
    if (Number.isNaN(n)) return String(amount);
    if (n >= 10000) return `¥${(n/10000).toFixed(2)}万`;
    return `¥${n.toLocaleString()}元`;
}

// 单个中标结果摘要：金额/折扣率
function formatBidInfo(bid) {
    if (!bid) return '';
    if (bid.winning_amount) return formatMoneyShort(bid.winning_amount);
    if (bid.discount_rate) return bid.discount_rate;
    return '';
}

// 项目级中标摘要：优先按包显示，否则取项目级结果
function formatBidSummary(p) {
    const lots = p.lots || [];
    const bids = p.bid_results || [];
    if (lots.length && bids.length) {
        const lotBids = lots.map(l => {
            const b = bids.find(x => x.lot_id === l.id);
            return b ? `${escHtml(l.lot_number)}:${escHtml(formatBidInfo(b))}` : `${escHtml(l.lot_number)}:无`;
        }).filter(Boolean);
        if (lotBids.length) return lotBids.join(' · ');
    }
    if (bids.length) {
        const first = bids[0];
        return `${formatBidInfo(first)}${first.winning_supplier ? ' · ' + escHtml(winningSupplierLabel(p, first)) : ''}`;
    }
    return '';
}

function getProgressColor(pct) {
    if (pct >= 100) return '#22c55e';
    if (pct >= 60) return '#4f46e5';
    if (pct >= 30) return '#f59e0b';
    return '#ef4444';
}


function dateOnly(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}
function parseISODate(iso) {
    if (!iso) return null;
    const parts = String(iso).split('-').map(Number);
    if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
    return new Date(parts[0], parts[1] - 1, parts[2]);
}

// ── Safe planned_at helpers ──
function plannedDate(s) {
    return (s && s.planned_at) ? s.planned_at.slice(0, 10) : null;
}
function plannedTime(s) {
    return (s && s.planned_at && s.planned_at.includes('T')) ? s.planned_at.slice(11, 16) : '';
}

function daysUntil(iso) {
    const d = parseISODate(iso);
    if (!d) return null;
    return Math.round((dateOnly(d) - dateOnly(new Date())) / 86400000);
}

function stageTiming(s) {
    if (!s || s.completed || s.skipped || !plannedDate(s)) return {cls:'', label:''};
    const diff = daysUntil(plannedDate(s));
    if (diff === null) return {cls:'', label:''};
    if (diff < 0) return {cls:'overdue', label:`逾期${Math.abs(diff)}天`};
    if (diff === 0) return {cls:'today', label:'今天到期'};
    if (diff <= 7) return {cls:'soon', label:`${diff}天后`};
    const timePart = plannedTime(s);
    const timeSuffix = timePart ? ` ${timePart}` : '';

    return {cls:'planned', label:`计划${formatDate(plannedDate(s))}${timeSuffix}`};
}
function projectOpenStages(p) {
    return (p.stages || []).filter(s => !s.completed && !s.skipped && plannedDate(s));
}
function projectHasOverdue(p) {
    return projectOpenStages(p).some(s => daysUntil(plannedDate(s)) < 0);
}
function projectHasSoon(p) {
    return projectOpenStages(p).some(s => {
        const d = daysUntil(plannedDate(s));
        return d !== null && d >= 0 && d <= 7;
    });
}

function supplierRiskStateOf(p) {
    const snapshot = p?.lot_supplier_state;
    if (!snapshot || snapshot.blocked_reason) return null;
    const flowed = Number(snapshot.flowed_count || 0);
    const total = Number(snapshot.total_count || 0);
    const warning = Number(snapshot.warning_count || 0);
    if (flowed > 0 && (!total || flowed < total)) {
        return {cls:'partial-liubiao', text:`部分包流标·${flowed}/${total || flowed}`, icon:'🚫'};
    }
    if (warning > 0) {
        const hasRealLots = (snapshot.items || []).some(item => item.lot_id != null);
        return {cls:'liubiao-warning', text:hasRealLots ? `流标预警·${warning}个包` : '流标预警', icon:'⚠️'};
    }
    return null;
}

function supplierRiskBadgeHtml(p) {
    const state = supplierRiskStateOf(p);
    if (!state) return '';
    return `<span class="supplier-risk-badge ${state.cls}" title="采购包供应商数量风险"><span data-ui-icon="${escHtml(state.icon)}"></span> ${escHtml(state.text)}</span>`;
}

function renderSupplierRiskBanner(p) {
    const snapshot = p?.lot_supplier_state;
    if (!snapshot || snapshot.blocked_reason) return '';
    const risks = (snapshot.items || []).filter(item => item.status === 'warning' && Number(item.missing_count || 0) > 0);
    if (!risks.length) return '';
    const days = Number(snapshot.days_remaining);
    const deadlineText = days === 0
        ? '报名今天截止'
        : `距离报名截止还有${Number.isFinite(days) ? days : '-'}天`;
    const details = risks.slice(0, 3).map(item => {
        const label = item.lot_id == null
            ? '项目整体'
            : `${item.lot_number || ''} ${item.lot_name || '未命名包'}`.trim();
        return `${escHtml(label)}还差${Number(item.missing_count || 0)}家`;
    });
    if (risks.length > 3) details.push(`另有${risks.length - 3}个包`);
    const hasRealLots = risks.some(item => item.lot_id != null);
    const summary = hasRealLots ? `${risks.length}个包报名供应商不足` : '项目报名供应商不足';
    return `<button type="button" class="supplier-risk-banner" data-command-action="open-stage" data-stage-key="registration_end">
        <strong><span data-ui-icon='⚠️'></span> ${summary}，${deadlineText}。</strong>
        <span>${details.join('，')}。</span>
    </button>`;
}

function renderLotSupplierRows(p) {
    const snapshot = p?.lot_supplier_state;
    const items = snapshot?.items || [];
    if (snapshot?.blocked_reason) {
        const ids = snapshot.unassigned_registration_ids || [];
        return `<div class="supplier-risk-blocked"><strong><span data-ui-icon='⚠️'></span> ${escHtml(snapshot.blocked_reason)}</strong><span>请逐条编辑并选择所属采购包：</span>${ids.map(id => id == null ? '' : `<button type="button" class="btn btn-xs btn-secondary" onclick="showRegistrationForm(${Number(id)})">报名记录 #${Number(id)}</button>`).join('')}</div>`;
    }
    if (!items.length) return '';
    const statusText = {warning:'流标预警', liubiao:'已流标', active:'正常'};
    return `<div class="lot-supplier-summary" id="lotSupplierSummary">
        <div class="lot-supplier-summary-head"><strong>采购包供应商统计</strong><small>按报名主体计数</small></div>
        <div class="lot-supplier-summary-list">${items.map(item => {
            const label = item.lot_id == null
                ? '项目整体'
                : `${item.lot_number || ''} ${item.lot_name || '未命名包'}`.trim();
            const state = statusText[item.status] || '正常';
            const missing = item.status === 'warning' && Number(item.missing_count || 0) > 0
                ? `<small class="lot-supplier-missing">还差${Number(item.missing_count)}家</small>`
                : '';
            const adminActions = typeof currentIsAdmin !== 'undefined' && currentIsAdmin && item.lot_id != null
                ? `<span class="lot-supplier-actions"><button type="button" class="btn btn-xs btn-secondary" onclick="showLotRuleForm(${Number(item.lot_id)})">包规则</button>${item.status === 'liubiao' ? `<button type="button" class="btn btn-xs btn-secondary" onclick="showRestoreLotForm(${Number(item.lot_id)})">撤销流标</button><button type="button" class="btn btn-xs btn-primary" onclick="showReprocurementForm(${Number(item.lot_id)})">重新采购</button>` : ''}</span>`
                : '';
            return `<div class="lot-supplier-row ${escHtml(item.status || 'active')}">
                <span>${escHtml(label)}</span>
                <strong>${Number(item.registration_count || 0)}/${Number(item.required_count || 0)}家</strong>
                ${missing}
                <em>${state}</em>
                ${adminActions}
            </div>`;
        }).join('')}</div>
    </div>`;
}

function projectStatusInfo(p) {
    if (p.is_terminated) {
        const t = p.terminated_type || '';
        if (t === 'liubiao') return {cls:'liubiao', text:'流标', icon:'🚫'};
        if (t === 'feibiao') return {cls:'feibiao', text:'废标', icon:'⛔'};
        return {cls:'terminated', text:'已终止', icon:'⛔'};
    }
    const challenge = challengeStateOf(p);
    if (challenge === '投诉中') return {cls:'complaint', text:'投诉中', icon:'❗'};
    if (challenge === '质疑中') return {cls:'challenge', text:'质疑中', icon:'⚠️'};
    const supplierRisk = supplierRiskStateOf(p);
    if (supplierRisk) return supplierRisk;
    if (p.progress >= 100) return {cls:'done', text:'已完成', icon:'✅'};
    if (projectHasOverdue(p)) return {cls:'overdue', text:'有逾期', icon:'🔴'};
    if (projectHasSoon(p)) return {cls:'soon', text:'7天内', icon:'🟠'};
    return {cls:'active', text:'进行中', icon:'🔵'};
}
// ── 质疑/投诉特殊状态 ──
function challengeStateOf(p) {
    if (p.challenge_state) return p.challenge_state;   // 后端已计算
    const cs = (p.complaints || []);
    let hasComplaint = false, hasChallenge = false;
    for (const c of cs) {
        if (c.status === '已解决' || c.status === '已办结') continue;
        if (c.complaint_type === '投诉') hasComplaint = true;
        else if (c.complaint_type === '质疑') hasChallenge = true;
        if (c.status === '已转投诉') hasComplaint = true;
    }
    if (hasComplaint) return '投诉中';
    if (hasChallenge) return '质疑中';
    return null;
}
function challengeBadgeHtml(p) {
    const st = challengeStateOf(p);
    if (!st) return '';
    if (st === '投诉中') return `<span class="challenge-badge complaint" title="该项目存在投诉，需重点关注"><span data-ui-icon='❗'></span> 投诉中</span>`;
    return `<span class="challenge-badge challenge" title="该项目存在未解决的质疑"><span data-ui-icon='⚠️'></span> 质疑中</span>`;
}
function collectScheduleItems(projects, mode='all') {
    const items = [];
    projects.filter(p => !p.is_terminated && p.progress < 100).forEach(p => {
        (p.stages || []).forEach(s => {
            if (s.completed || s.skipped || !plannedDate(s)) return;
            const diff = daysUntil(plannedDate(s));
            if (diff === null) return;
            if (mode === 'overdue' && diff >= 0) return;
            if (mode === 'upcoming' && (diff < 0 || diff > 7)) return;
            items.push({project:p, stage:s, diff});
        });
    });
    return items.sort((a,b) => a.diff - b.diff || a.project.number.localeCompare(b.project.number));
}
function renderScheduleList(items, emptyText) {
    if (!items.length) return `<div class="compact-empty">${emptyText}</div>`;
    return items.slice(0, 10).map(item => {
        const timing = item.diff < 0 ? `逾期 ${Math.abs(item.diff)} 天` : (item.diff === 0 ? '今天' : `${item.diff} 天后`);
        const cls = item.diff < 0 ? 'overdue' : (item.diff === 0 ? 'today' : 'soon');
        return `<div class="schedule-item ${cls}" onclick="selectProject(${item.project.id})">
            <div class="schedule-main"><span class="ci-number">${escHtml(item.project.number)}</span> ${escHtml(item.project.name)}</div>
            <div class="schedule-sub"><span data-ui-icon="${escHtml(item.stage.icon)}"></span> ${escHtml(item.stage.name)} · ${formatDate(plannedDate(item.stage))} · ${timing}</div>
        </div>`;
    }).join('') + (items.length > 10 ? `<div style="font-size:12px;color:var(--text3);padding:6px 8px">... 共${items.length}项</div>` : '');
}

function projectColor(p) {
    if (p.is_terminated) {
        const t = p.terminated_type || '';
        if (t === 'liubiao') return '#ef4444';
        if (t === 'feibiao') return '#f59e0b';
        return '#6b7280';
    }
    if (projectHasOverdue(p)) return '#ef4444';
    if (projectHasSoon(p)) return '#f59e0b';
    return getProgressColor(p.progress);
}

function toggleCheckboxById(id) {
    const el = document.getElementById(id);
    if (el && !el.disabled) el.checked = !el.checked;
}

// ── View Switching ──
// 主动驱动视图入场动画：每次切换（含项目内切换不同项目）都重播一次，
// 不依赖被动 CSS（被动 CSS 在容器已 active 时不会重播），也不被 reduced-motion 误杀。
function playViewEnter(viewEl) {
    if (!viewEl) return;
    viewEl.classList.remove('view-switch-in');
    void viewEl.offsetWidth; // 强制 reflow 以重启 CSS 动画
    viewEl.classList.add('view-switch-in');
    setTimeout(() => viewEl.classList.remove('view-switch-in'), 420);
}
function switchView(name) {
    projectNavigationVersion += 1;
    if (name !== 'dashboard' && typeof cleanupCommandCenterMotion === 'function') cleanupCommandCenterMotion();
    if (name === 'chart-board') ensureChartBoardWorkspace();
    else if (typeof cleanupChartBoardLifecycle === 'function') cleanupChartBoardLifecycle();
    if (name === 'purchasers') ensurePurchaserBoardWorkspace();
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
    const activeNav = document.querySelector(`.nav-item[data-view="${name}"]`);
    activeNav?.classList.add('active');
    activeNav?.scrollIntoView?.({block: 'nearest'});
    document.getElementById('sidebarSettingsBtn')?.classList.toggle('active', name === 'settings');
    if (name === 'dashboard') loadDashboard();
    if (name === 'calendar') loadCalendar();
    if (name === 'procure') loadProcureBoard();
    if (name === 'purchasers') loadPurchaserBoard();
    if (name === 'chart-board') refreshChartBoard();
    if (name === 'settings') loadSettingsView();
    playViewEnter(document.getElementById('view-' + name));
}

function switchProjectTab(name) {
    projectNavigationVersion += 1;
    document.querySelectorAll('#projectTabs .tab').forEach(t=>t.classList.remove('active'));
    document.querySelector(`#projectTabs .tab[data-tab="${name}"]`).classList.add('active');
    document.querySelectorAll('.project-tab').forEach(t=>t.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    ensureProjectTabRendered(name);
}

// ── Modal / Slide ──
const dialogFocusStack = [];
let dialogFocusListenersReady = false;

function topManagedDialog() {
    if (document.getElementById('commandPalette')?.classList.contains('open')) return null;
    return [...dialogFocusStack].reverse().find(entry => entry.container.isConnected
        && entry.container.classList.contains('open')) || null;
}

function dialogControls(container) {
    return [...container.querySelectorAll('button, input, select, textarea, a[href], [tabindex], [contenteditable]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length
            && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[inert]'));
}

function focusDialogStart(container) {
    const controls = dialogControls(container);
    const target = controls.find(node => node.matches('input:not([type="checkbox"]):not([type="radio"]),select,textarea'))
        || controls[0] || container;
    target.focus({preventScroll: true});
}

function handleDialogFocus(event) {
    const entry = topManagedDialog();
    if (!entry) return;
    const container = entry.container;
    if (event.type === 'focusin') {
        if (!container.contains(event.target)) focusDialogStart(container);
        return;
    }
    if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        entry.close();
        return;
    }
    if (event.key !== 'Tab') return;
    const controls = dialogControls(container);
    const index = controls.indexOf(document.activeElement);
    if (!controls.length || index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        ((event.shiftKey ? controls.at(-1) : controls[0]) || container).focus({preventScroll: true});
    }
}

function activateDialogFocus(container, close) {
    if (!dialogFocusStack.some(entry => entry.container === container)) {
        dialogFocusStack.push({container, close, returnFocus: document.activeElement});
    }
    container.setAttribute('role', 'dialog');
    container.setAttribute('aria-modal', 'true');
    container.setAttribute('tabindex', '-1');
    if (!dialogFocusListenersReady) {
        document.addEventListener('keydown', handleDialogFocus, true);
        document.addEventListener('focusin', handleDialogFocus, true);
        dialogFocusListenersReady = true;
    }
    focusDialogStart(container);
}

function releaseDialogFocus(container) {
    const index = dialogFocusStack.findIndex(entry => entry.container === container);
    if (index < 0) return;
    const [entry] = dialogFocusStack.splice(index, 1);
    const next = topManagedDialog();
    if (next && !next.container.contains(entry.returnFocus)) focusDialogStart(next.container);
    else if (!focusSafely(entry.returnFocus)) focusFallback(container);
}

function resetModalState({wide = false, sharedFooter = false} = {}) {
    const overlay = document.getElementById('modalOverlay');
    const modal = document.getElementById('modal');
    const title = document.getElementById('modalTitle');
    const body = document.getElementById('modalBody');
    const footer = document.getElementById('modalFooter');
    if (wide) modal.classList.add('modal-wide');
    else modal.classList.remove('modal-wide');
    title.textContent = '';
    body.innerHTML = '';
    body.scrollTop = 0;
    if (footer) {
        footer.innerHTML = '';
        footer.style.display = sharedFooter ? 'flex' : 'none';
    }
    return {overlay, modal, title, body, footer};
}
function showModal(modalTitle, html, onSave) {
    const {overlay, modal, title, body, footer} = resetModalState({sharedFooter: Boolean(onSave)});
    title.textContent = modalTitle;
    body.innerHTML = html;
    if (onSave) {
        footer.innerHTML = '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="modalSaveBtn">保存</button>';
        document.getElementById('modalSaveBtn').onclick = async function() {
            this.disabled = true;
            this.setAttribute('aria-busy', 'true');
            this.classList.add('ui-state-saving');
            this.textContent = '保存中...';
            try { var result = await onSave(); if (result !== false) {} }
            catch(e) { toast('❌ ' + e.message, 'error'); }
            this.disabled = false;
            this.removeAttribute('aria-busy');
            this.classList.remove('ui-state-saving');
            this.textContent = '保存';
        };
    }
    overlay.classList.add('open');
    modal.classList.add('open');
    body.scrollTop = 0;
    modal.setAttribute('aria-labelledby', 'modalTitle');
    activateDialogFocus(modal, closeModal);
}
function closeModal() {
    document.getElementById('modalOverlay').classList.remove('open');
    document.getElementById('modal').classList.remove('open');
    resetModalState();
    releaseDialogFocus(document.getElementById('modal'));
}
function openSlide(title, html) {
    const titleElement = document.getElementById('slideTitle');
    titleElement.textContent = title;
    if (typeof window !== 'undefined' && window.PMIcons) window.PMIcons.label(titleElement, title);
    document.getElementById('slideBody').innerHTML = html;
    document.getElementById('slideBackdrop').classList.add('open');
    document.getElementById('slidePanel').classList.add('command-context-panel');
    document.getElementById('slidePanel').classList.add('open');
}
function closeSlide() {
    document.getElementById('slideBackdrop').classList.remove('open');
    document.getElementById('slidePanel').classList.remove('open');
}
// ── 自绘彩色界面图标：显示层保留业务字段中的原始图标值 ──
(() => {
    'use strict';
    const shapes = {
        inbox: '<path fill="var(--icon-soft)" d="M5 5h14l3 10v5H2v-5z"/><path d="M5 5h14l3 10v5H2v-5l3-10zM2 15h6l2 3h4l2-3h6"/><path d="M12 3v9m-3-3 3 3 3-3"/>',
        document: '<path fill="var(--icon-soft)" d="M5 2h9l5 5v15H5z"/><path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h6"/>',
        edit: '<path fill="var(--icon-soft)" d="M4 4h13v16H4z"/><path d="M10 4H4v16h15v-8"/><path fill="var(--icon-accent)" d="m10 12 9-9 3 3-9 9-4 1z"/><path d="m10 12 9-9 3 3-9 9-4 1z"/>',
        search: '<circle cx="10" cy="10" r="7" fill="var(--icon-soft)"/><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
        check: '<rect x="2" y="2" width="20" height="20" rx="6" fill="var(--icon-main)" stroke="none"/><path d="m7 12 3 3 7-7" stroke="var(--icon-contrast)"/>',
        clipboard: '<rect x="4" y="4" width="16" height="18" rx="3" fill="var(--icon-soft)"/><rect x="4" y="4" width="16" height="18" rx="3"/><rect x="8" y="2" width="8" height="5" rx="2" fill="var(--icon-accent)"/><path d="M8 12h8M8 17h5"/>',
        announcement: '<path fill="var(--icon-soft)" d="M3 9h5l12-5v16L8 15H3z"/><path d="M3 9h5l12-5v16L8 15H3zM8 9v6m1 1 2 6H7l-2-7"/><path d="M23 9v6" stroke="var(--icon-accent)"/>',
        clock: '<circle cx="12" cy="13" r="9" fill="var(--icon-soft)"/><circle cx="12" cy="13" r="9"/><path d="M12 8v5l4 2M4 2 1 5M20 2l3 3"/>',
        target: '<circle cx="11" cy="13" r="9" fill="var(--icon-soft)"/><circle cx="11" cy="13" r="9"/><circle cx="11" cy="13" r="5"/><path d="m11 13 9-9m-1-3v4h4" stroke="var(--icon-accent)"/>',
        chart: '<rect x="3" y="13" width="4" height="8" rx="1" fill="var(--icon-main)" stroke="none"/><rect x="10" y="8" width="4" height="13" rx="1" fill="var(--icon-accent)" stroke="none"/><rect x="17" y="3" width="4" height="18" rx="1" fill="var(--icon-soft)"/><path d="M2 22h20"/>',
        trophy: '<path fill="var(--icon-soft)" d="M6 3h12v8a6 6 0 0 1-12 0z"/><path d="M6 3h12v8a6 6 0 0 1-12 0zM6 5H2v3a5 5 0 0 0 5 5M18 5h4v3a5 5 0 0 1-5 5M12 17v4M7 22h10"/><path d="m12 6 1 2 3 .5-2 2 .5 2.5-2.5-1.5L9.5 13l.5-2.5-2-2 3-.5z" fill="var(--icon-accent)" stroke="none"/>',
        money: '<path fill="var(--icon-soft)" d="m9 3 3 1 3-1 2 4-2 3c7 6 7 12-3 12S2 16 9 10L7 7z"/><path d="m9 3 3 1 3-1 2 4-2 3c7 6 7 12-3 12S2 16 9 10L7 7zM9 10h6m-5 3 2 2 2-2m-2 2v4m-2-2h4"/>',
        card: '<rect x="2" y="5" width="20" height="15" rx="4" fill="var(--icon-soft)"/><rect x="2" y="5" width="20" height="15" rx="4"/><path d="M2 10h20M6 16h4"/><path d="M15 16h3" stroke="var(--icon-accent)"/>',
        archive: '<path fill="var(--icon-soft)" d="m3 7 9-5 9 5v13l-9 3-9-3z"/><path d="m3 7 9-5 9 5v13l-9 3-9-3zM3 7l9 5 9-5M12 12v11"/><path d="m7 4 9 5v5" stroke="var(--icon-accent)"/>',
        warning: '<path fill="var(--icon-soft)" d="M10 3a2 2 0 0 1 4 0l9 17H1z"/><path d="M10 3a2 2 0 0 1 4 0l9 17H1zM12 8v6m0 3v1"/>',
        stop: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="10"/><path d="m5 5 14 14"/>',
        close: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)" stroke="none"/><path d="m8 8 8 8m0-8-8 8"/>',
        dot: '<circle cx="12" cy="12" r="7" fill="var(--icon-main)" stroke="none"/><circle cx="10" cy="10" r="2" fill="var(--icon-accent)" stroke="none"/>',
        people: '<circle cx="9" cy="7" r="4" fill="var(--icon-soft)"/><path d="M2 21v-3a7 7 0 0 1 14 0v3z" fill="var(--icon-soft)"/><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M18 4a4 4 0 0 1 0 8m1 3a5 5 0 0 1 3 5"/>',
        person: '<circle cx="12" cy="7" r="5" fill="var(--icon-soft)"/><path d="M3 22v-3a9 9 0 0 1 18 0v3z" fill="var(--icon-soft)"/><circle cx="12" cy="7" r="5"/><path d="M3 22v-3a9 9 0 0 1 18 0v3"/>',
        handshake: '<path fill="var(--icon-soft)" d="m2 8 5-3 5 2 5-2 5 3-3 10-6 4-9-6z"/><path d="m2 8 5-3 5 2 5-2 5 3-3 10-6 4-9-6zM12 7l-5 5 3 2 4-3 5 7m-7-4 4 4m-7-1 4 4"/>',
        help: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 4v.1"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="3" fill="var(--icon-soft)"/><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 10h18M8 2v5m8-5v5M8 14h2m4 0h2m-8 4h2"/>',
        folder: '<path fill="var(--icon-soft)" d="M2 5h8l3 3h9v13H2z"/><path d="M2 5h8l3 3h9v13H2z"/><path d="M2 11h20" stroke="var(--icon-accent)"/>',
        book: '<path fill="var(--icon-soft)" d="M5 2h15v20H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z"/><path d="M5 2h15v20H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM6 2v20M10 8h6m-6 4h5"/>',
        eye: '<path fill="var(--icon-soft)" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="var(--icon-accent)"/>',
        trash: '<path fill="var(--icon-soft)" d="m5 7 1 15h12l1-15z"/><path d="M3 7h18M8 7V3h8v4m-11 0 1 15h12l1-15M10 11v7m4-7v7"/>',
        refresh: '<path d="M21 8a9 9 0 0 0-16-4L2 7m0-5v5h5M3 16a9 9 0 0 0 16 4l3-3m0 5v-5h-5"/><circle cx="12" cy="12" r="3" fill="var(--icon-accent)" stroke="none"/>',
        mail: '<rect x="2" y="5" width="20" height="15" rx="3" fill="var(--icon-soft)"/><rect x="2" y="5" width="20" height="15" rx="3"/><path d="m3 7 9 7 9-7"/>',
        bolt: '<path fill="var(--icon-accent)" d="M14 1 3 14h7L9 23l12-14h-8z"/><path d="M14 1 3 14h7L9 23l12-14h-8z"/>',
        lock: '<rect x="4" y="10" width="16" height="12" rx="4" fill="var(--icon-soft)"/><rect x="4" y="10" width="16" height="12" rx="4"/><path d="M7 10V7a5 5 0 0 1 10 0v3m-5 5v3"/>',
        image: '<rect x="2" y="3" width="20" height="18" rx="3" fill="var(--icon-soft)"/><rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="8" cy="8" r="2" fill="var(--icon-accent)" stroke="none"/><path d="m3 18 6-6 4 4 4-6 5 8"/>',
        clip: '<path d="m8 14 8-8a3 3 0 0 1 4 4L9 21a5 5 0 0 1-7-7L13 3a7 7 0 0 1 10 10L12 24"/>',
        pin: '<path fill="var(--icon-soft)" d="M5 9a7 7 0 0 1 14 0c0 5-7 13-7 13S5 14 5 9z"/><path d="M5 9a7 7 0 0 1 14 0c0 5-7 13-7 13S5 14 5 9z"/><circle cx="12" cy="9" r="2" fill="var(--icon-accent)"/>',
        chat: '<path fill="var(--icon-soft)" d="M3 3h18v14H9l-6 5z"/><path d="M3 3h18v14H9l-6 5zM7 8h10m-10 4h7"/>',
        computer: '<rect x="2" y="3" width="20" height="14" rx="3" fill="var(--icon-soft)"/><rect x="2" y="3" width="20" height="14" rx="3"/><path d="M12 17v4m-5 1h10"/><path d="M6 7h12" stroke="var(--icon-accent)"/>',
        settings: '<path fill="var(--icon-soft)" d="m9 2-1 4-4 1-2 4 3 3v4l4 3 3-2 4 2 4-3v-4l2-3-2-4-4-1-1-4z"/><path d="m9 2-1 4-4 1-2 4 3 3v4l4 3 3-2 4 2 4-3v-4l2-3-2-4-4-1-1-4z"/><circle cx="12" cy="12" r="4" fill="var(--icon-accent)"/>',
        bell: '<path fill="var(--icon-soft)" d="M5 10a7 7 0 0 1 14 0v6l3 3H2l3-3z"/><path d="M5 10a7 7 0 0 1 14 0v6l3 3H2l3-3zM9 22h6M12 1v2"/>',
        shield: '<path fill="var(--icon-soft)" d="m12 2 9 4v7c0 5-9 10-9 10S3 18 3 13V6z"/><path d="m12 2 9 4v7c0 5-9 10-9 10S3 18 3 13V6z"/><path d="m8 12 3 3 5-6"/>',
        building: '<rect x="4" y="2" width="16" height="20" rx="2" fill="var(--icon-soft)"/><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h1m6 0h1M8 10h1m6 0h1M8 14h1m6 0h1M10 22v-4h4v4"/>',
        palette: '<path fill="var(--icon-soft)" d="M12 2a10 10 0 1 0 0 20h2c2 0 2-3 0-4-2-2 0-4 3-4h3c5-6-2-12-8-12z"/><path d="M12 2a10 10 0 1 0 0 20h2c2 0 2-3 0-4-2-2 0-4 3-4h3c5-6-2-12-8-12z"/><path d="M7 8h.1M12 6h.1M17 8h.1" stroke="var(--icon-accent)" stroke-width="3"/>',
        hourglass: '<path fill="var(--icon-soft)" d="M5 2h14v4l-7 6 7 6v4H5v-4l7-6-7-6z"/><path d="M5 2h14v4l-7 6 7 6v4H5v-4l7-6-7-6z"/><path d="m8 19 4-4 4 4" fill="var(--icon-accent)"/>',
        rocket: '<path fill="var(--icon-soft)" d="M8 16C7 7 14 2 22 2c0 8-5 15-14 14z"/><path d="M8 16C7 7 14 2 22 2c0 8-5 15-14 14zM8 10H3l-2 7h7m6-1v5l-7 2v-7M5 19l-3 3"/><circle cx="16" cy="8" r="2" fill="var(--icon-accent)"/>',
        compass: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="10"/><path fill="var(--icon-accent)" d="m16 8-2 6-6 2 2-6z"/><path d="m16 8-2 6-6 2 2-6z"/>',
        ruler: '<path fill="var(--icon-soft)" d="m2 16 14-14 6 6L8 22z"/><path d="m2 16 14-14 6 6L8 22zM13 5l3 3m-6 0 2 2m-5 1 3 3"/>',
        undo: '<path d="m8 4-6 6 6 6M2 10h12a7 7 0 0 1 0 14"/>',
        download: '<path fill="var(--icon-soft)" d="M3 15h18v7H3z"/><path d="M12 2v13m-5-5 5 5 5-5M3 15v7h18v-7"/>',
        circle: '<circle cx="12" cy="12" r="9" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="9"/>',
        menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
        chevron: '<path d="m8 4 8 8-8 8"/>',
        plus: '<rect x="2" y="2" width="20" height="20" rx="6" fill="var(--icon-soft)" stroke="none"/><path d="M12 6v12M6 12h12"/>',
    };
    const entries = [
        ['📥','inbox','blue'],['📝✏','edit','blue'],['🔍','search','blue'],['✅✓','check','green'],['📋','clipboard','indigo'],['📢📣','announcement','rose'],['⏰','clock','amber'],['🎯','target','rose'],['📊📈','chart','blue'],['🏆🎉','trophy','amber'],['💰','money','amber'],['💳','card','teal'],['📦','archive','amber'],['⚠❗','warning','amber'],['🚫⛔','stop','rose'],['❌','close','rose'],['✕×','close','neutral'],['🔴','dot','rose'],['🟠','dot','amber'],['🔵','dot','blue'],['👥','people','indigo'],['👤','person','indigo'],['🤝','handshake','teal'],['❓ℹ','help','blue'],['📅','calendar','indigo'],['📁','folder','amber'],['📘📖','book','blue'],['📕','book','rose'],['📙','book','amber'],['📄','document','blue'],['👁','eye','teal'],['🗑','trash','rose'],['🔄🔁♻','refresh','teal'],['✉','mail','indigo'],['⚡','bolt','amber'],['🔒','lock','indigo'],['🖼','image','teal'],['📎','clip','blue'],['📌📍','pin','rose'],['🏷','document','amber'],['💬','chat','teal'],['💻🖥','computer','blue'],['🔧⚙','settings','indigo'],['🔔','bell','amber'],['🛡','shield','teal'],['🏢','building','blue'],['🎨','palette','rose'],['⏳','hourglass','amber'],['🚀','rocket','rose'],['🧭','compass','blue'],['📏','ruler','amber'],['↩↶','undo','neutral'],['☰','menu','neutral'],['▸▶','chevron','neutral'],['+','plus','inherit'],
    ];
    entries.push(['⬇','download','blue']);
    entries.push(['⭕','circle','neutral']);
    const icons = new Map();
    for (const [glyphs, name, tone] of entries) for (const glyph of glyphs) icons.set(glyph, {name, tone});
    function icon(glyph) {
        const found = icons.get(String(glyph).replace(/\uFE0F/g,''));
        if (!found) return null;
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('class', 'pm-icon pm-icon--' + found.tone);
        svg.setAttribute('viewBox','0 0 24 24');
        svg.setAttribute('aria-hidden','true');
        svg.setAttribute('focusable','false');
        svg.dataset.icon = found.name;
        svg.innerHTML = shapes[found.name];
        return svg;
    }
    function decorateSlot(slot) {
        if (slot.closest('svg,.logo,[data-ui-content],[data-preserve-text],.luckysheet,.doc-preview-body')) return;
        const value=slot.getAttribute('data-ui-icon');
        if(slot.dataset.pmRendered===value) return;
        slot.dataset.pmRendered=value;
        const image=icon(value);
        slot.replaceChildren();
        if(image) {slot.append(image);slot.setAttribute('aria-hidden','true');}
        else {slot.textContent=value;slot.removeAttribute('aria-hidden');}
    }
    function preview(select) {
        if (select.closest('.logo,[data-ui-content],[data-preserve-text],.luckysheet') || select.multiple || select.size>1 || !select.options.length) return;
        const iconOnly=select.matches('[data-stage-template-field="icon"]');
        if (!iconOnly && !Array.from(select.options).some(option=>leadingIcon(option.label))) {
            const existing=select.parentElement;
            if(existing.classList.contains('pm-icon-select-wrap')){existing.before(select);existing.remove();select.classList.remove('pm-icon-select');}
            return;
        }
        let wrap=select.parentElement;
        if (!wrap.classList.contains('pm-icon-select-wrap')) {
            wrap=document.createElement('span');wrap.className='pm-icon-select-wrap';select.before(wrap);wrap.append(select);
            const display=document.createElement('span');display.className='pm-icon-select-preview';display.setAttribute('aria-hidden','true');wrap.append(display);
            select.classList.add('pm-icon-select');
        }
        const display=wrap.querySelector('.pm-icon-select-preview');
        const value=select.options[select.selectedIndex]?.label || select.value;
        label(display,value,iconOnly?select.value:'');
    }
    function render(root) {
        if (!root || ![1,9,11].includes(root.nodeType)) return;
        if(root.nodeType===1 && root.closest('svg,input,textarea,select,option,.logo,[data-ui-content],[data-preserve-text]')) {if(root.tagName==='SELECT')preview(root);return;}
        if(root.nodeType===1 && root.hasAttribute('data-ui-icon'))decorateSlot(root);
        root.querySelectorAll?.('[data-ui-icon]').forEach(decorateSlot);
        root.querySelectorAll?.('select').forEach(preview);
    }
    const css = `
[data-ui-icon]{display:inline-flex;align-items:center;vertical-align:-3px}[data-ui-icon]>.pm-icon{display:block}
.pm-icon { --icon-main:#416da7;--icon-soft:#dce9fa;--icon-accent:#93b9e8;--icon-contrast:#fff;display:inline-block;width:18px;height:18px;min-width:18px;overflow:visible;vertical-align:-3px;fill:none;stroke:var(--icon-main);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;flex-shrink:0; }
.pm-icon--blue{--icon-main:#3468b0;--icon-soft:#dceafe;--icon-accent:#91b9f2}
.pm-icon--indigo{--icon-main:#6b58ab;--icon-soft:#eae4fa;--icon-accent:#b9a8e6}
.pm-icon--teal{--icon-main:#237c76;--icon-soft:#d9f1ea;--icon-accent:#8acbb7}
.pm-icon--green{--icon-main:#278354;--icon-soft:#def3e5;--icon-accent:#99d8ad}
.pm-icon--amber{--icon-main:#a86b22;--icon-soft:#fff0cd;--icon-accent:#f2c362}
.pm-icon--rose{--icon-main:#ae526b;--icon-soft:#f9e0e8;--icon-accent:#e99db2}
.pm-icon--neutral,.pm-icon--inherit{--icon-main:currentColor;--icon-soft:transparent;--icon-accent:currentColor}
:root[data-theme="dark"] .pm-icon{--icon-contrast:#11241b}
:root[data-theme="dark"] .pm-icon--blue{--icon-main:#93b9f2;--icon-soft:#263f60;--icon-accent:#517fb8}
:root[data-theme="dark"] .pm-icon--indigo{--icon-main:#c4b6eb;--icon-soft:#3d3259;--icon-accent:#8f79c1}
:root[data-theme="dark"] .pm-icon--teal{--icon-main:#8dd7c1;--icon-soft:#1c4840;--icon-accent:#4e9e88}
:root[data-theme="dark"] .pm-icon--green{--icon-main:#8bd4a8;--icon-soft:#244834;--icon-accent:#51a171}
:root[data-theme="dark"] .pm-icon--amber{--icon-main:#efc26b;--icon-soft:#504022;--icon-accent:#b99345}
:root[data-theme="dark"] .pm-icon--rose{--icon-main:#efa9bf;--icon-soft:#52303e;--icon-accent:#b66e89}
.btn-primary .pm-icon--inherit{--icon-main:currentColor}
.current-title [data-ui-icon]>.pm-icon{width:22px;height:22px;min-width:22px;vertical-align:-4px}
.mini-status .pm-icon,.task-card .btn .pm-icon,.status-badge .pm-icon{width:14px;height:14px;min-width:14px;vertical-align:-2px}
.pm-icon-select-wrap{position:relative;display:block;min-width:0}.pm-icon-select-wrap:after{content:"";position:absolute;right:13px;top:calc(50% - 4px);width:6px;height:6px;border-right:1.6px solid var(--text2,#68768a);border-bottom:1.6px solid var(--text2,#68768a);transform:rotate(45deg);pointer-events:none}.pm-icon-select-wrap>select{display:block;width:100%;color:transparent!important;appearance:none}.pm-icon-select-preview{position:absolute;inset:0 30px 0 12px;display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;color:var(--text);font:inherit;pointer-events:none}.pm-icon-select-preview .pm-icon{width:20px;height:20px;min-width:20px;max-width:20px;max-height:20px;overflow:hidden}.pm-icon-select-wrap:has(select:disabled){opacity:.65}
`;
    function start() {
        if (!document.getElementById('pm-icon-styles')) {const style=document.createElement('style');style.id='pm-icon-styles';style.textContent=css;document.head.append(style);}
        render(document.body);
        const pending=new Set();let scheduled=false;
        const observer=new MutationObserver(records=>{
            for (const record of records) {
                if(record.target.nodeType===1 && record.target.closest('svg.pm-icon,.pm-icon-select-preview,#pm-icon-styles'))continue;
                const select=record.target.nodeType===1?record.target.closest('select'):record.target.parentElement?.closest('select');
                if(select)pending.add(select);
                if(record.type==='attributes')pending.add(record.target);
                else record.addedNodes.forEach(node=>{if(node.nodeType===1 && node.matches('svg.pm-icon,.pm-icon-select-preview,#pm-icon-styles'))return;pending.add(node);});
            }
            if(!pending.size || scheduled)return;scheduled=true;
            queueMicrotask(()=>{scheduled=false;const roots=[...pending];pending.clear();roots.forEach(render);});
        });
        observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-ui-icon','selected','label','value']});
        document.addEventListener('change',event=>{if(event.target.tagName==='SELECT')preview(event.target);});
        window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    }
    function leadingIcon(text) {
        const match=/^([\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFFℹ][\uFE0F]?)\s+/u.exec(String(text));
        return match && icon(match[1]) ? match : null;
    }
    function label(element,text,defaultGlyph='') {
        const value=String(text);const leading=leadingIcon(value);
        const image=icon(leading?.[1] || defaultGlyph);
        if(!image){element.textContent=value;return;}
        const suffix=leading?value.slice(leading[0].length):defaultGlyph===value?'':value;
        element.replaceChildren(image,document.createTextNode(suffix?' '+suffix:''));
    }
    window.PMIcons={render,create:icon,label,glyphs:[...icons.keys()],names:[...new Set(entries.map(e=>e[1]))]};
    if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
// ── Load & Render Projects ──
let sidebarDataVersion = 0;
let sidebarRenderSignature = '';
let sidebarMethodFilter = '';

const sidebarProjectNumberCollator = new Intl.Collator('zh-CN', {
    numeric: true,
    sensitivity: 'base',
});

function normalizeSidebarSortDirection(value) {
    return value === 'desc' ? 'desc' : 'asc';
}

function validSidebarProjectNumber(value) {
    return /\d/.test(String(value || '').trim());
}

function sortSidebarProjects(projects, direction) {
    const normalized = normalizeSidebarSortDirection(direction);
    return (projects || [])
        .map((project, index) => ({project, index}))
        .sort((left, right) => {
            const leftNumber = String(left.project?.number || '').trim();
            const rightNumber = String(right.project?.number || '').trim();
            const leftValid = validSidebarProjectNumber(leftNumber);
            const rightValid = validSidebarProjectNumber(rightNumber);
            if (leftValid !== rightValid) return leftValid ? -1 : 1;
            if (!leftValid) return left.index - right.index;
            const compared = sidebarProjectNumberCollator.compare(leftNumber, rightNumber);
            if (compared) return normalized === 'desc' ? -compared : compared;
            return left.index - right.index;
        })
        .map(item => item.project);
}

const SIDEBAR_SORT_STORAGE_KEY = 'projectSidebarSortDirection';

function readSidebarSortDirection() {
    try {
        return normalizeSidebarSortDirection(localStorage.getItem(SIDEBAR_SORT_STORAGE_KEY));
    } catch (_) {
        return 'asc';
    }
}

let sidebarSortDirection = readSidebarSortDirection();

function setSidebarSortDirection(value) {
    sidebarSortDirection = normalizeSidebarSortDirection(value);
    try {
        localStorage.setItem(SIDEBAR_SORT_STORAGE_KEY, sidebarSortDirection);
    } catch (_) {
        // Storage can be unavailable in hardened browser profiles; sorting still works in memory.
    }
    const select = document.getElementById('sidebarProjectSort');
    if (select) select.value = sidebarSortDirection;
    sidebarRenderSignature = '';
    renderSidebar();
}

function ensureSidebarSortControl() {
    const manageButton = document.getElementById('sidebarManageBtn');
    if (!manageButton?.parentNode || typeof document.createElement !== 'function') return null;
    let select = document.getElementById('sidebarProjectSort');
    if (!select) {
        select = document.createElement('select');
        select.id = 'sidebarProjectSort';
        select.className = 'btn btn-secondary btn-sm';
        select.setAttribute('aria-label', '项目编号排序');
        select.innerHTML = '<option value="asc">编号升序</option><option value="desc">编号降序</option>';
        select.addEventListener('change', event => setSidebarSortDirection(event.target.value));
        manageButton.parentNode.insertBefore(select, manageButton);
    }
    select.value = sidebarSortDirection;
    return select;
}

function setSidebarMethodFilter(value) {
    sidebarMethodFilter = String(value || '');
    sidebarRenderSignature = '';
    renderSidebar();
}

function ensureSidebarMethodFilter() {
    const searchInput = document.getElementById('searchInput');
    if (!searchInput?.parentElement || typeof document.createElement !== 'function') return null;
    let select = document.getElementById('sidebarMethodSelect');
    if (!select) {
        select = document.createElement('select');
        select.id = 'sidebarMethodSelect';
        select.className = 'sidebar-method-filter';
        select.setAttribute('aria-label', '采购方式筛选');
        select.addEventListener('change', event => setSidebarMethodFilter(event.target.value));
        searchInput.parentElement.appendChild(select);
    }
    const methods = [...new Set([
        ...(typeof METHODS !== 'undefined' ? METHODS : []),
        ...(allProjects || []).map(project => String(project.method || '')).filter(Boolean),
    ])];
    select.innerHTML = '<option value="">全部采购方式</option>' + methods.map(method => `<option value="${escHtml(method)}">${escHtml(method)}</option>`).join('');
    select.value = sidebarMethodFilter;
    return select;
}

function projectSearchText(project) {
    return [project?.number, project?.name, project?.purchaser, project?.method]
        .map(value => String(value || ''))
        .join(' ')
        .toLocaleLowerCase();
}

function rebuildProjectIndexes(projects) {
    projectById.clear();
    projectSearchById.clear();
    projectOrderById.clear();
    (projects || []).forEach((project, index) => {
        if (!project || project.id == null) return;
        const key = Number(project.id);
        projectById.set(key, project);
        projectSearchById.set(key, projectSearchText(project));
        projectOrderById.set(key, index);
    });
}

function markSidebarDataChanged() {
    sidebarDataVersion += 1;
}

async function loadAllProjects() {
    allProjects = await api('GET', '/api/projects');
    rebuildProjectIndexes(allProjects);
    invalidateProjectDerivedState();
    renderSidebar();
    scheduleActiveProjectPrefetch(allProjects);
}

function renderSidebar() {
    const list = document.getElementById('projectList');
    const methodFilter = typeof sidebarMethodFilter === 'string' ? sidebarMethodFilter : '';
    const q = (document.getElementById('searchInput')?.value || '').toLocaleLowerCase();
    const selectedKey = sidebarManageMode
        ? Array.from(selectedProjectIds).sort((left, right) => Number(left) - Number(right)).join(',')
        : '';
    const renderSignature = [
        sidebarDataVersion,
        currentProject ? Number(currentProject.id) : '',
        q,
        sidebarFilter,
        methodFilter,
        sidebarSortDirection,
        sidebarManageMode ? 1 : 0,
        selectedKey,
    ].join('|');
    if (renderSignature === sidebarRenderSignature) {
        updateManageUI();
        return;
    }
    const structureSignature = [sidebarDataVersion, q, sidebarFilter, methodFilter,
        sidebarSortDirection, sidebarManageMode ? 1 : 0, selectedKey].join('|');
    if (list._structureSignature === structureSignature && typeof list.querySelector === 'function') {
        list.querySelector('.sidebar-project.active')?.classList.remove('active');
        if (currentProject) list.querySelector(`[data-project-id="${Number(currentProject.id)}"]`)?.classList.add('active');
        sidebarRenderSignature = renderSignature;
        updateManageUI();
        return;
    }
    ensureSidebarSortControl();
    ensureSidebarMethodFilter();
    list._structureSignature = structureSignature;
    sidebarRenderSignature = renderSignature;
    list.innerHTML = sortSidebarProjects(allProjects, sidebarSortDirection).map(p => {
        const active = currentProject && currentProject.id === p.id ? 'active' : '';
        const color = projectColor(p);
        const closedLabel = p.is_terminated ? (p.terminated_type === 'liubiao' ? '流标' : p.terminated_type === 'feibiao' ? '废标' : '终止') : '';
        const retenderBadge = ((p.terminated_type === 'feibiao' || p.terminated_type === 'liubiao') && p.second_tender)
            ? `<span class="mini-retender" title="前往二次/重新招标项目" onclick="event.stopPropagation();goToSecondTender(${p.second_tender.id})">↪重新招标</span>`
            : '';
        const pct = p.is_terminated ? closedLabel : p.progress + '%';
        const pctCls = p.progress >= 100 ? 'done' : '';
        const status = projectStatusInfo(p);
        const supplierRiskBadge = challengeBadgeHtml(p) && typeof supplierRiskBadgeHtml === 'function'
            ? supplierRiskBadgeHtml(p)
            : '';
        const matchesSearch = (projectSearchById.get(Number(p.id)) || '').includes(q);
        const matchesMethod = !methodFilter || String(p.method || '') === methodFilter;
        const matchesFilter = sidebarFilter === 'all'
            || (sidebarFilter === 'active' && !p.is_terminated && p.progress < 100)
            || (sidebarFilter === 'done' && !p.is_terminated && p.progress >= 100)
            || (sidebarFilter === 'terminated' && p.is_terminated)
            || (sidebarFilter === 'liubiao' && p.terminated_type === 'liubiao')
            || (sidebarFilter === 'feibiao' && p.terminated_type === 'feibiao')
            || (sidebarFilter === 'overdue' && projectHasOverdue(p))
            || (sidebarFilter === 'soon' && projectHasSoon(p));
        const hidden = matchesSearch && matchesFilter && matchesMethod ? '' : 'display:none';
        const checked = selectedProjectIds.has(p.id) ? 'checked' : '';
        const manageCheckbox = sidebarManageMode ? `<input type="checkbox" class="project-select-cb" data-pid="${p.id}" ${checked} onclick="event.stopPropagation();toggleProjectSelection(${p.id})" style="margin-right:8px;cursor:pointer">` : '';
        return `<div class="sidebar-project ${active}" data-project-id="${p.id}" role="button" tabindex="0" style="${hidden}" onclick="${sidebarManageMode ? `toggleProjectSelection(${p.id})` : `selectProject(${p.id})`}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
            ${manageCheckbox}
            <span class="project-badge" style="background:${color}"></span>
            <div class="project-info">
                <div class="project-number">${escHtml(p.number)} <span class="mini-status ${status.cls}"><span data-ui-icon="${escHtml(status.icon)}"></span> ${status.text}</span>${retenderBadge}${supplierRiskBadge}</div>
                <div class="project-name">${escHtml(p.name)}</div>
            </div>
            <span class="project-pct ${pctCls}">${pct}</span>
        </div>`;
    }).join('');
    if (typeof applyStableVisualSemantics === 'function') applyStableVisualSemantics(list);
    updateManageUI();
}

function setSidebarFilter(filter) {
    sidebarFilter = filter;
    document.querySelectorAll('.filter-chip').forEach(btn => btn.classList.toggle('active', btn.dataset.filter === filter));
    renderSidebar();
}

// ── Sidebar Project Manage Mode (批量管理) ──
function toggleManageMode() {
    sidebarManageMode = !sidebarManageMode;
    if (!sidebarManageMode) selectedProjectIds.clear();
    renderSidebar();
}

function toggleProjectSelection(pid) {
    if (selectedProjectIds.has(pid)) selectedProjectIds.delete(pid);
    else selectedProjectIds.add(pid);
    updateManageUI();
    // 同步复选框状态（因为整个行点击也会触发）
    const cb = document.querySelector(`.project-select-cb[data-pid="${pid}"]`);
    if (cb) cb.checked = selectedProjectIds.has(pid);
}

function updateManageUI() {
    const manageBtn = document.getElementById('sidebarManageBtn');
    const newBtn = document.getElementById('sidebarNewProjectBtn');
    const delBtn = document.getElementById('sidebarBatchDeleteBtn');
    if (manageBtn) manageBtn.textContent = sidebarManageMode ? '完成' : '管理';
    if (manageBtn) manageBtn.classList.toggle('btn-primary', sidebarManageMode);
    if (manageBtn) manageBtn.classList.toggle('btn-secondary', !sidebarManageMode);
    if (newBtn) newBtn.style.display = sidebarManageMode ? 'none' : '';
    if (delBtn) {
        delBtn.style.display = sidebarManageMode && selectedProjectIds.size > 0 ? '' : 'none';
        delBtn.innerHTML = `<span data-ui-icon="🗑️"></span> 删除选中项目 (${selectedProjectIds.size})`;
    }
}

async function batchDeleteProjects() {
    if (!currentIsAdmin) { toast('❌ 只有管理员可以批量删除项目', 'error'); return; }
    const ids = Array.from(selectedProjectIds);
    if (!ids.length) { toast('⚠️ 请先选择项目', 'warning'); return; }
    if (!await confirmDialog('批量删除项目', `确定删除选中的 ${ids.length} 个项目？此操作不可恢复！`, '删除', 'btn-danger')) return;
    showLoading(`正在删除 ${ids.length} 个项目...`);
    try {
        let success = 0;
        for (const pid of ids) {
            try {
                await api('DELETE', `/api/projects/${pid}`);
                dropProjectDetail(pid);
                success++;
            } catch (e) {
                console.error('删除项目失败', pid, e);
            }
        }
        selectedProjectIds.clear();
        sidebarManageMode = false;
        hideLoading();
        toast(`🗑️ 已删除 ${success}/${ids.length} 个项目`, success === ids.length ? 'success' : 'warning');
        currentProject = null;
        renderSidebar();
        await loadAllProjects();
        switchView('dashboard');
    } catch(e) {
        hideLoading();
        toast('❌ 批量删除失败：' + e.message, 'error');
    }
}

function filterProjects() {
    renderSidebar();
}

function storeProjectDetail(project, options = {}) {
    if (!project || project.id == null) return project;
    const key = Number(project.id);
    projectDetailCache.set(key, project);
    const index = allProjects.findIndex(item => Number(item.id) === key);
    if (index >= 0) allProjects[index] = {...allProjects[index], ...project};
    else if (options.prepend) {
        allProjects.unshift(project);
        for (const [projectId, order] of projectOrderById) {
            projectOrderById.set(projectId, order + 1);
        }
    } else allProjects.push(project);
    const indexedProject = index >= 0 ? allProjects[index] : project;
    if (typeof projectById !== 'undefined') projectById.set(key, indexedProject);
    if (typeof projectSearchById !== 'undefined') {
        projectSearchById.set(key, projectSearchText(indexedProject));
    }
    if (typeof projectOrderById !== 'undefined') {
        projectOrderById.set(key, index >= 0 ? index : (options.prepend ? 0 : allProjects.length - 1));
    }
    if (typeof markSidebarDataChanged === 'function') markSidebarDataChanged();
    return project;
}

function requestProjectDetail(pid, options = {}) {
    const key = Number(pid);
    if (!options.force && projectDetailRequests.has(key)) {
        return projectDetailRequests.get(key);
    }
    const version = (projectDetailRequestVersions.get(key) || 0) + 1;
    projectDetailRequestVersions.set(key, version);
    let pending;
    pending = api('GET', `/api/projects/${key}`)
        .then(project => {
            const accepted = projectDetailRequestVersions.get(key) === version;
            if (accepted) storeProjectDetail(project);
            return {project, accepted};
        })
        .finally(() => {
            if (projectDetailRequests.get(key) === pending) {
                projectDetailRequests.delete(key);
            }
        });
    projectDetailRequests.set(key, pending);
    return pending;
}

function isActiveProjectSummary(project) {
    return Boolean(project)
        && !project.is_terminated
        && Number(project.progress || 0) < 100;
}

function cancelProjectPrefetch(projectId) {
    const key = Number(projectId);
    projectPrefetchQueued.delete(key);
    for (let index = projectPrefetchQueue.length - 1; index >= 0; index -= 1) {
        if (projectPrefetchQueue[index].id === key) projectPrefetchQueue.splice(index, 1);
    }
}

function drainProjectPrefetchQueue(generation = projectPrefetchGeneration) {
    while (projectPrefetchActive < PROJECT_PREFETCH_LIMIT && projectPrefetchQueue.length) {
        const item = projectPrefetchQueue.shift();
        projectPrefetchQueued.delete(item.id);
        if (item.generation !== generation || generation !== projectPrefetchGeneration) continue;
        if (projectDetailCache.has(item.id) || projectDetailRequests.has(item.id)) continue;
        projectPrefetchActive += 1;
        requestProjectDetail(item.id)
            .catch(error => console.error('项目详情预缓存失败', item.id, error))
            .finally(() => {
                projectPrefetchActive = Math.max(0, projectPrefetchActive - 1);
                drainProjectPrefetchQueue(projectPrefetchGeneration);
            });
    }
}

function queueProjectDetailPrefetch(projectId, options = {}) {
    const key = Number(projectId);
    if (!Number.isFinite(key)
        || projectDetailCache.has(key)
        || projectDetailRequests.has(key)
        || projectPrefetchQueued.has(key)) return false;
    const item = {id: key, generation: projectPrefetchGeneration};
    if (options.front) projectPrefetchQueue.unshift(item);
    else projectPrefetchQueue.push(item);
    projectPrefetchQueued.add(key);
    drainProjectPrefetchQueue(projectPrefetchGeneration);
    return true;
}

function scheduleActiveProjectPrefetch(projects) {
    projectPrefetchGeneration += 1;
    projectPrefetchQueue.length = 0;
    projectPrefetchQueued.clear();
    let scheduled = 0;
    for (const project of projects || []) {
        if (scheduled >= 6) break;
        if (isActiveProjectSummary(project) && queueProjectDetailPrefetch(project.id)) scheduled += 1;
    }
    drainProjectPrefetchQueue(projectPrefetchGeneration);
}

function promoteProjectPrefetch(projectId) {
    const key = Number(projectId);
    const index = projectPrefetchQueue.findIndex(item => item.id === key);
    if (index > 0) {
        const [item] = projectPrefetchQueue.splice(index, 1);
        projectPrefetchQueue.unshift(item);
    }
    drainProjectPrefetchQueue(projectPrefetchGeneration);
}

function dropProjectDetail(pid) {
    const key = Number(pid);
    if (typeof cancelProjectPrefetch === 'function') cancelProjectPrefetch(key);
    projectDetailCache.delete(key);
    projectDetailRequests.delete(key);
    projectDetailRequestVersions.set(
        key,
        (projectDetailRequestVersions.get(key) || 0) + 1,
    );
    let removedIndex = -1;
    if (typeof allProjects !== 'undefined') {
        const cachedIndex = typeof projectOrderById !== 'undefined'
            ? projectOrderById.get(key)
            : undefined;
        if (
            Number.isInteger(cachedIndex)
            && Number(allProjects[cachedIndex]?.id) === key
        ) {
            removedIndex = cachedIndex;
        } else {
            removedIndex = allProjects.findIndex(project => Number(project.id) === key);
        }
        if (removedIndex >= 0) allProjects.splice(removedIndex, 1);
    }
    if (typeof projectById !== 'undefined') projectById.delete(key);
    if (typeof projectSearchById !== 'undefined') projectSearchById.delete(key);
    if (typeof projectOrderById !== 'undefined') projectOrderById.delete(key);
    if (removedIndex >= 0 && typeof projectOrderById !== 'undefined') {
        for (let index = removedIndex; index < allProjects.length; index += 1) {
            projectOrderById.set(Number(allProjects[index].id), index);
        }
    }
    if (removedIndex >= 0 && typeof markSidebarDataChanged === 'function') {
        markSidebarDataChanged();
    }
}

let dirtyProjectTabs = new Set(['board', 'timeline', 'tasks', 'info', 'attachments']);

function activeProjectTabName() {
    return document.querySelector('#projectTabs .tab.active')?.dataset.tab || 'board';
}

function invalidateProjectTabRenders(preserveTab) {
    dirtyProjectTabs = new Set(['board', 'timeline', 'tasks', 'info', 'attachments'].filter(name => name !== preserveTab));
}

function ensureProjectTabRendered(name) {
    if (!currentProject || !dirtyProjectTabs.has(name)) return;
    const render = {board: renderBoard, timeline: renderTimeline, tasks: renderTasks,
        info: renderInfo, attachments: renderAttachments}[name];
    if (render) {
        render();
        dirtyProjectTabs.delete(name);
    }
}

function renderProjectDetail(project, resetTab = false) {
    if (typeof captureProjectInfoDraft === 'function') captureProjectInfoDraft();
    currentProject = project;
    switchView('project');
    renderSidebar();
    renderProjectTopbar();
    invalidateProjectTabRenders();
    if (resetTab) switchProjectTab('board');
    else ensureProjectTabRendered(activeProjectTabName());
}

// ── Select Project (缓存先显示，后台刷新) ──
async function selectProject(pid) {
    if (typeof releaseAttachmentPreviewResources === 'function') {
        releaseAttachmentPreviewResources();
    }
    const key = Number(pid);
    promoteProjectPrefetch(key);
    const selectionVersion = ++projectSelectionVersion;
    const cached = projectDetailCache.get(key)
        || (currentProject && Number(currentProject.id) === key ? currentProject : null);

    if (cached) {
        renderProjectDetail(cached, true);
    } else if (!currentProject) {
        showViewLoading('boardContent');
        showViewLoading('timelineContent');
        showViewLoading('tasksContent');
        showViewLoading('infoContent');
        showViewLoading('attachmentsContent');
    } else {
        // Keep the previous form intact until first-load navigation succeeds.
        toast('正在加载项目详情…', 'info');
    }

    const navigationVersion = projectNavigationVersion;
    const editVersion = projectEditVersion;
    try {
        const result = await requestProjectDetail(key);
        if (!result.accepted || selectionVersion !== projectSelectionVersion
            || navigationVersion !== projectNavigationVersion
            || editVersion !== projectEditVersion
            || (cached && isEditingApplicationForm())) return false;
        renderProjectDetail(result.project, !cached);
        return Number(currentProject?.id) === key;
    } catch (error) {
        if (selectionVersion !== projectSelectionVersion
            || navigationVersion !== projectNavigationVersion
            || editVersion !== projectEditVersion) return false;
        if (cached) {
            console.error('后台刷新项目详情失败', key, error);
            toast('⚠️ 最新数据刷新失败，当前显示缓存', 'warning');
            return Number(currentProject?.id) === key;
        }
        toast('❌ 加载项目失败：' + error.message, 'error');
        if (allProjects.length) switchView('dashboard');
        return false;
    }
}

// ── Render Project Topbar ──
function renderProjectTopbar() {
    const p = currentProject;
    document.getElementById('projectName').textContent = p.name || '';
    document.getElementById('projectMeta').innerHTML = `
        <span>编号：${escHtml(p.number)}</span>
        <span>采购人：${escHtml(p.purchaser)}</span>
        <span>方式：${escHtml(p.method)}</span>
        <span>预算：${escHtml(p.budget)}</span>
        ${p.no_deposit ? '<span>无需保证金</span>' : ''}
        <span class="project-status-pill ${projectStatusInfo(p).cls}"><span data-ui-icon="${escHtml(projectStatusInfo(p).icon)}"></span> ${projectStatusInfo(p).text}</span>
        ${p.is_terminated ? `<span style="color:var(--text2)"><span data-ui-icon="${escHtml(projectStatusInfo(p).icon)}"></span> ${projectStatusInfo(p).text}</span>` : ''}
        ${challengeBadgeHtml(p) && typeof supplierRiskBadgeHtml === 'function' ? supplierRiskBadgeHtml(p) : ''}
        ${(p.terminated_type === 'feibiao' || p.terminated_type === 'liubiao') && p.second_tender ? `<span class="retender-pill" onclick="goToSecondTender(${p.second_tender.id})" title="点击跳转到二次/重新招标项目">↪ 二次/重新招标：${escHtml(p.second_tender.number)}</span>` : ''}
    `;
    const fill = document.getElementById('progressFill');
    const txt = document.getElementById('progressText');
    fill.style.width = p.progress + '%';
    fill.classList.toggle('done', p.progress >= 100);
    txt.textContent = p.progress + '% · ' + p.current_stage_name;
    mountProjectWorkspace(p);
    const attachmentBadge = document.getElementById('attachmentBadge');
    if (attachmentBadge) {
        const count = (p.attachments || []).length;
        attachmentBadge.textContent = count || '';
        attachmentBadge.style.display = count ? '' : 'none';
    }
}

// ── 阶段卡片附加信息摘要 ──
function stageCardSummary(s, p) {
    const parts = [];
    const regs = p.registrations || [];
    const bids = p.bid_results || [];
    const lots = p.lots || [];
    const invoices = p.service_fee_invoices || [];
    const refunds = p.deposit_refunds || [];

    if (stageHasModule(s, 'clarification', p) && s.completed_date) {
        parts.push(`<span style="color:var(--primary)"><span data-ui-icon='📢'></span> ${formatDate(s.completed_date)} 已发布</span>`);
    }
    if (stageHasModule(s, 'registration', p) && regs.length) {
        parts.push(`<span style="color:var(--success);font-weight:600"><span data-ui-icon='📝'></span> ${regs.length} 家供应商已报名</span>`);
    }
    if ((stageHasModule(s, 'bid_opening', p) || stageHasModule(s, 'evaluation', p)) && plannedDate(s)) {
        const t = plannedTime(s);
        parts.push(`<span style="color:var(--primary)"><span data-ui-icon="${escHtml(stageHasModule(s, 'bid_opening', p)?'🎯':'📊')}"></span> ${formatDate(plannedDate(s))}${t?' '+t:''}</span>`);
    }
    if (stageHasModule(s, 'responsible_person', p)) {
        const owner = s.responsible_person || (s.key === 'doc_prepare' ? p.prepare_owner : s.key === 'doc_review' ? p.review_owner : '');
        if (owner) parts.push(`<span style="color:var(--text2)"><span data-ui-icon='👤'></span> ${s.key === 'doc_prepare' ? '编制' : s.key === 'doc_review' ? '审核' : '负责人'}：${escHtml(owner)}</span>`);
    }
    if (stageHasModule(s, 'result_publication', p) && bids.length) {
        const summary = formatBidSummary(p);
        if (summary) parts.push(`<span style="color:var(--success);font-weight:600"><span data-ui-icon='🏆'></span> ${summary}</span>`);
    }
    if (stageHasModule(s, 'result_publication', p)) {
        const cs = challengeStateOf(p);
        if (cs === '投诉中') parts.push(`<span class="challenge-badge complaint"><span data-ui-icon='❗'></span> 投诉中</span>`);
        else if (cs === '质疑中') parts.push(`<span class="challenge-badge challenge"><span data-ui-icon='⚠️'></span> 质疑中</span>`);
    }
    if (stageHasModule(s, 'winning_notice', p) && bids.length) {
        const summary = formatBidSummary(p);
        if (summary) parts.push(`<span style="color:var(--success);font-weight:600"><span data-ui-icon="${escHtml(p.method==='网上竞价'?'🤝':'🏆')}"></span> ${summary}</span>`);
    }
    if (stageHasModule(s, 'service_fee', p) && invoices.length) {
        const total = invoices.reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
        parts.push(`<span style="color:var(--warning);font-weight:600">合计 ${formatMoneyShort(total)}</span>`);
    }
    if (stageHasModule(s, 'deposit_refund', p) && refunds.length) {
        const total = refunds.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
        parts.push(`<span style="color:var(--primary);font-weight:600">已退 ${formatMoneyShort(total)}</span>`);
    }

    return parts.length ? `<div class="stage-card-summary">${parts.join('')}</div>` : '';
}

// ── Render Board (看板) ──
function renderBoard() {
    const p = currentProject;
    const stages = orderProjectStages(p.stages).filter(stage => !stage.template_removed);
    const cols = [
        {key:'pending', name:'待办', stages:[]},
        {key:'active', name:'进行中', stages:[]},
        {key:'done', name:'已完成', stages:[]},
    ];
    stages.forEach(s => {
        if (s.skipped) cols[2].stages.push(s);
        else if (s.completed) cols[2].stages.push(s);
        else if (s.key === p.current_stage_key) cols[1].stages.push(s);
        else cols[0].stages.push(s);
    });

    const current = stages.find(s => s.key === p.current_stage_key)
        || stages.find(s => !s.completed && !s.skipped);
    const nextIdx = current ? stages.findIndex(s => s.key === current.key) + 1 : -1;
    const nextStage = nextIdx > 0 ? stages.slice(nextIdx).find(s => !s.completed && !s.skipped) : null;
    const currentTiming = stageTiming(current || {});

    // ── 批量操作栏 ──
    let batchBar = '';
    if (stages.some(s => !s.completed && !s.skipped)) {
        batchBar = `<div style="display:flex;align-items:center;gap:8px;margin-bottom:14px;padding:10px 14px;background:var(--primary-light);border-radius:var(--radius-sm)">
            <span style="font-size:13px;font-weight:600;color:var(--primary)"><span data-ui-icon='⚡'></span> 批量操作：</span>
            <button class="btn btn-sm btn-primary" onclick="enterBatchMode()">批量完成</button>
            <button class="btn btn-sm btn-secondary" onclick="batchSetPlannedDate()">批量设计划日期</button>
        </div>`;
    }

    // ── 批量模式工具栏（默认隐藏）──
    let batchToolbar = '';
    batchToolbar = `<div id="batchToolbar" style="display:none;margin-bottom:14px;padding:12px;background:var(--warning-light);border:1px solid var(--warning);border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">
            <span style="font-weight:600;color:var(--warning)"><span data-ui-icon='✏️'></span> 批量模式 - 勾选要操作的阶段</span>
            <button class="btn btn-sm btn-secondary" onclick="exitBatchMode()">取消</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-success" onclick="batchCompleteSelected()">完成选中项</button>
            <button class="btn btn-sm btn-secondary" onclick="batchSelectAll()">全选待办</button>
            <span id="batchCount" style="font-size:12px;color:var(--text2);align-self:center">已选：0</span>
        </div>
    </div>`;

    const currentDefinition = current ? projectStageDefinition(current, p) : null;
    const nextDefinition = nextStage ? projectStageDefinition(nextStage, p) : null;
    const summary = current ? `<div class="current-stage-card ${currentTiming.cls}">
        <div><div class="current-label">当前阶段</div><div class="current-title"><span data-ui-icon="${escHtml(currentDefinition.icon)}"></span> ${escHtml(currentDefinition.name)}</div></div>
        <div class="current-meta">
            <span>${plannedDate(current) ? '计划：' + formatDate(plannedDate(current)) : '未设置计划日期'}</span>
            ${currentTiming.label ? `<span class="timing-badge ${currentTiming.cls}">${currentTiming.label}</span>` : ''}
            ${nextStage ? `<span>下一步：<span data-ui-icon="${escHtml(nextDefinition.icon)}"></span> ${escHtml(nextDefinition.name)}</span>` : ''}
            ${challengeBadgeHtml(p)}
        </div>
    </div>` : '';

    const container = document.getElementById('boardContent');
    const boardHtml = cols.map(col => {
        const cards = col.stages.map(s => {
            const isSkipped = s.skipped;
            const timing = stageTiming(s);
            let cls = isSkipped ? 'task-card task-skipped task-done' : (s.completed ? 'task-card task-done' : `task-card ${timing.cls}`);
            if (stageHasModule(s, 'result_publication', p) && challengeStateOf(p)) cls += ' task-challenge';
            const dateStr = isSkipped ? '<span data-ui-icon="⚠️"></span> 不适用' : (s.completed_date ? formatDate(s.completed_date) : (plannedDate(s) ? '计划:'+formatDate(plannedDate(s)) : '未设置计划日期'));

            // ── 批量模式复选框（仅待办阶段显示）──
            let checkbox = '';
            if (!s.completed && !s.skipped) {
                checkbox = `<input type="checkbox" class="batch-cb" data-key="${escHtml(s.key)}" onclick="event.stopPropagation()" style="margin-right:6px;cursor:pointer;display:none">`;
            }

            const definition = projectStageDefinition(s, p);
            const displayName = definition.name;
            const keyToken = stageKeyToken(s.key);
            return `<div class="${cls}" data-stage-key="${escHtml(s.key)}" onclick="openStageSlide(stageKeyFromToken('${keyToken}'))">
                ${checkbox}
                <div class="task-title"><span data-ui-icon="${escHtml(definition.icon)}"></span> ${escHtml(displayName)}${isSkipped ? ' <span style="font-size:11px;color:var(--text3)">(不适用)</span>' : ''}</div>
                <div class="task-detail">${dateStr} ${timing.label ? `<span class="timing-badge ${timing.cls}">${timing.label}</span>` : ''}</div>
                ${stageCardSummary(s, p)}
                <div class="task-actions">
                    ${isSkipped ? "<span style=\"font-size:11px;color:var(--text3)\"><span data-ui-icon='⚠️'></span> 已跳过</span>" :
                    `<button class="btn btn-sm ${s.completed ? 'btn-secondary' : 'btn-success'}" onclick="event.stopPropagation();toggleStage(stageKeyFromToken('${keyToken}'))">
                        ${s.completed ? '<span data-ui-icon="↩"></span> 撤销' : '<span data-ui-icon="✅"></span> 完成'}
                    </button>`}
                </div>
            </div>`;
        }).join('');
        return `<div class="board-col">
            <h3>${col.name} (${col.stages.length})</h3>
            <div class="board-col-body">${cards || '<div style="font-size:12px;color:var(--text3);padding:12px 0">暂无</div>'}</div>
        </div>`;
    }).join('');
    container.innerHTML = batchBar + batchToolbar + summary + `<div class="board-columns">${boardHtml}</div>`;
}

// ── Batch Operations (批量操作) ──
let batchMode = false;

function enterBatchMode() {
    batchMode = true;
    document.getElementById('batchToolbar').style.display = '';
    // 显示所有待办卡片的复选框
    document.querySelectorAll('.batch-cb').forEach(cb => cb.style.display = 'inline-block');
    toast('✏️ 已进入批量模式，请勾选要操作的阶段', 'info');
}
function exitBatchMode() {
    batchMode = false;
    document.getElementById('batchToolbar').style.display = 'none';
    // 隐藏所有复选框并取消选中
    document.querySelectorAll('.batch-cb').forEach(cb => { cb.style.display = 'none'; cb.checked = false; });
    updateBatchCount();
}
function getSelectedKeys() {
    return [...document.querySelectorAll('.batch-cb:checked')].map(cb => cb.dataset.key);
}
function updateBatchCount() {
    const countEl = document.getElementById('batchCount');
    if (countEl) countEl.textContent = `已选：${getSelectedKeys().length}`;
}
// 监听复选框变化
document.addEventListener('change', e => {
    if (e.target.classList.contains('batch-cb')) updateBatchCount();
});

async function batchCompleteSelected() {
    const keys = getSelectedKeys();
    if (!keys.length) { toast('⚠️ 请先选择至少一个阶段', 'warning'); return; }
    if (!await confirmDialog('批量完成', `确定完成选中的 ${keys.length} 个阶段？`, '批量完成', 'btn-success')) return;

    showLoading(`正在完成 ${keys.length} 个阶段...`);
    try {
        const today = todayISO();
        for (const key of keys) {
            await api('PUT', `/api/projects/${currentProject.id}/stages/${stageApiSegment(key)}`, {
                completed: true,
                completed_date: today
            });
        }
        hideLoading();
        toast(`✅ 已完成 ${keys.length} 个阶段`, 'success');
        exitBatchMode();
        await refreshProject();
    } catch(e) {
        hideLoading();
        toast('❌ ' + e.message, 'error');
    }
}

function batchSelectAll() {
    document.querySelectorAll('.batch-cb').forEach(cb => cb.checked = true);
    updateBatchCount();
}

async function batchSetPlannedDate() {
    // 弹出阶段选择 + 逐个设日期的面板
    const p = currentProject;
    if (!p) return;

    const pendingStages = p.stages.filter(s => !s.completed && !s.skipped && !s.template_removed);

    if (pendingStages.length === 0) {
        toast('没有待设置计划日期的阶段', 'warning');
        return;
    }

    const today = todayISO();

    const html = `
    <div style="margin-bottom:12px;font-size:13px;color:var(--text2)">
        勾选要设置的阶段，填写计划日期。可批量填充起始日期+间隔天数。需要时分的阶段保留原时间，未设置时默认 09:00，可逐项修改。
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        <label style="font-size:12px;color:var(--text3)">快速填充：</label>
        <input type="date" id="batchStartDate" value="${today}" style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px">
        <label style="font-size:12px;color:var(--text3)">间隔</label>
        <input type="number" id="batchInterval" value="7" min="1" max="90" style="width:50px;padding:4px;border:1px solid var(--border);border-radius:4px;font-size:13px">
        <span style="font-size:12px;color:var(--text3)">天</span>
        <button class="btn btn-sm btn-secondary" onclick="fillBatchDates()">填充</button>
    </div>
    <div id="batchDateList" style="max-height:300px;overflow-y:auto">
        ${pendingStages.map(s => {
            const definition = projectStageDefinition(s, p);
            const timed = ['registration','bid_opening','evaluation','auto_completion'].some(moduleId => stageHasModule(s, moduleId, p));
            const planned = String(s.planned_at || plannedDate(s) || '').replace(' ', 'T');
            const date = planned.slice(0, 10);
            const initialValue = !planned ? '' : !timed ? date
                : planned.includes('T') ? planned.slice(0, 16) : `${date}T09:00`;
            return `
            <label style="display:flex;align-items:center;gap:10px;padding:8px;border-radius:6px;cursor:pointer;font-size:13px"
                   onmouseover="this.style.background='var(--surface2)'"
                   onmouseout="this.style.background='transparent'">
                <input type="checkbox" class="bd-cb" data-key="${escHtml(s.key)}" checked style="width:16px;height:16px">
                <span style="flex:1;font-weight:600"><span data-ui-icon="${escHtml(definition.icon)}"></span> ${escHtml(definition.name)}</span>
                <input type="${timed ? 'datetime-local' : 'date'}" class="bd-at" data-key="${escHtml(s.key)}" value="${escHtml(initialValue)}"
                       style="padding:4px 8px;border:1px solid var(--border);border-radius:4px;font-size:13px;${timed ? 'width:200px' : 'width:140px'}">
            </label>
        `; }).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-primary btn-block" data-dialog-submit onclick="doBatchSetDateV2()">保存日期</button>
        <button class="btn btn-secondary btn-block" onclick="closeModal()">取消</button>
    </div>`;
    showModal('批量设置计划日期', html);
}

function fillBatchDates() {
    const startDate = document.getElementById('batchStartDate').value;
    const interval = parseInt(document.getElementById('batchInterval').value) || 7;
    if (!startDate) return;

    const start = new Date(startDate + 'T00:00:00Z');
    if (Number.isNaN(start.getTime())) return;
    let filled = 0;
    const checkedCbs = [...document.querySelectorAll('.bd-cb:checked')];

    checkedCbs.forEach((cb, i) => {
        const key = cb.dataset.key;
        const dateInput = [...document.querySelectorAll('.bd-at')].find(input => input.dataset.key === key);
        if (dateInput) {
            const d = new Date(start);
            d.setUTCDate(d.getUTCDate() + i * interval);
            const date = d.toISOString().slice(0, 10);
            const time = dateInput.value.includes('T') ? dateInput.value.split('T')[1] : '09:00';
            dateInput.value = dateInput.type === 'datetime-local' ? `${date}T${time}` : date;
            if (dateInput.value && dateInput.checkValidity()) filled += 1;
        }
    });
    toast(`已填充 ${filled} 个阶段（间隔${interval}天）`, 'info');
}

async function doBatchSetDateV2() {
    const items = [...document.querySelectorAll('.bd-cb:checked')].map(cb => {
        const key = cb.dataset.key;
        const atInput = [...document.querySelectorAll('.bd-at')].find(input => input.dataset.key === key);
        return { key, planned_at: atInput ? atInput.value : '' };
    }).filter(item => item.planned_at);

    if (items.length === 0) {
        toast('请至少为一个阶段设置日期', 'warning');
        return;
    }

    showLoading(`正在设置 ${items.length} 个阶段的计划日期...`);
    try {
        for (const item of items) {
            await api('PUT', `/api/projects/${currentProject.id}/stages/${stageApiSegment(item.key)}`, { planned_at: item.planned_at });
        }
        hideLoading();
        toast(`✅ 已设置 ${items.length} 个阶段的计划日期`, 'success');
        closeModal();
        await refreshProject();
    } catch(e) {
        hideLoading();
        toast('❌ ' + e.message, 'error');
    }
}

// ════════════════════════════════════════
// ── 跨项目批量推进阶段 ──
// ════════════════════════════════════════
let _baMode = 'stage'; // 'stage' | 'project'

function batchAdvanceStageDefinitions(method) {
    const templates = normalizeClientStageTemplates(systemSettings?.stage_templates, systemSettings || {});
    const rows = templates[String(method)] || [];
    return rows.map(stage => ({key: stage.id, name: stage.name, icon: stage.icon || '•'}));
}

function batchAdvanceCandidates(method, stageKey, projects = allProjects) {
    return (projects || []).filter(project => {
        if (project.is_terminated || String(project.method || '') !== String(method || '')) return false;
        const stage = (project.stages || []).find(row => String(row.stage_key || row.key || '') === String(stageKey));
        return Boolean(stage && !stage.completed && !stage.skipped && !stage.template_removed);
    });
}

function ensureBatchMethodControl() {
    let select = document.getElementById('batchMethodSelect');
    if (select) return select;
    const stageSelect = document.getElementById('batchStageSelect');
    if (!stageSelect?.parentElement || typeof document.createElement !== 'function') return null;
    const field = document.createElement('div');
    field.className = 'batch-method-field';
    field.innerHTML = '<label for="batchMethodSelect">采购方式</label><select id="batchMethodSelect" onchange="onBatchMethodChange()"></select>';
    stageSelect.parentElement.insertBefore(field, stageSelect.parentElement.firstChild);
    return document.getElementById('batchMethodSelect');
}

function onBatchMethodChange() {
    const method = document.getElementById('batchMethodSelect')?.value || '';
    const select = document.getElementById('batchStageSelect');
    if (!select) return;
    select.innerHTML = batchAdvanceStageDefinitions(method).map(stage =>
        `<option value="${escHtml(stage.key)}">${escHtml(stage.icon)} ${escHtml(stage.name)}</option>`
    ).join('');
    onBatchStageChange();
}

function prepareBatchAdvanceDialog() {
    const dlg = document.getElementById('batchAdvanceDialog');
    const title = dlg.querySelector('.modal-header h3');
    title.id = 'batchAdvanceTitle';
    dlg.setAttribute('aria-labelledby', title.id);
    document.getElementById('baModeStage').parentElement.classList.add('batch-advance-modes');
    document.getElementById('baListLabel').parentElement.classList.add('batch-advance-list-heading');
    const footer = document.getElementById('batchAdvanceCancel').parentElement;
    footer.classList.add('modal-footer', 'batch-advance-footer');
    if (footer.parentElement !== dlg) dlg.appendChild(footer);
    if (!dlg.querySelector('.batch-advance-close')) {
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn-icon batch-advance-close';
        close.setAttribute('aria-label', '关闭批量推进');
        close.textContent = '×';
        close.onclick = closeBatchAdvanceDialog;
        title.parentElement.appendChild(close);
    }
    ['batchStageSelect', 'batchProjectSelect', 'batchDateInput'].forEach(id => {
        const field = document.getElementById(id);
        if (field.previousElementSibling?.tagName === 'LABEL') field.previousElementSibling.htmlFor = id;
    });
    document.getElementById('batchAdvanceCount').setAttribute('aria-live', 'polite');
}

function switchBAMode(mode) {
    _baMode = mode;
    document.getElementById('baModeStage').setAttribute('aria-pressed', String(mode === 'stage'));
    document.getElementById('baModeProject').setAttribute('aria-pressed', String(mode === 'project'));
    document.getElementById('baModeStage').classList.toggle('active', mode === 'stage');
    document.getElementById('baModeProject').classList.toggle('active', mode === 'project');
    document.getElementById('baPanelStage').style.display = mode === 'stage' ? '' : 'none';
    document.getElementById('baPanelProject').style.display = mode === 'project' ? '' : 'none';
    document.getElementById('baListLabel').textContent = mode === 'stage' ? '待推进项目' : '待推进阶段';
    if (mode === 'stage') onBatchStageChange(); else onBatchProjectChange();
}

function openBatchAdvanceDialog() {
    prepareBatchAdvanceDialog();
    // 先选采购方式，再列出该方式的模板阶段。
    const methodSelect = ensureBatchMethodControl();
    if (methodSelect) {
        const activeMethods = new Set(allProjects.filter(project => !project.is_terminated).map(project => String(project.method || '')));
        methodSelect.innerHTML = clientProcurementMethods().map(method =>
            `<option value="${escHtml(method)}" ${activeMethods.has(method) ? '' : 'disabled'}>${escHtml(method)}</option>`
        ).join('');
        const firstAvailable = clientProcurementMethods().find(method => activeMethods.has(method));
        if (firstAvailable) methodSelect.value = firstAvailable;
    }
    onBatchMethodChange();

    // 填充项目下拉
    const psel = document.getElementById('batchProjectSelect');
    const active = allProjects.filter(p => !p.is_terminated);
    psel.innerHTML = '<option value="">-- 选择项目 --</option>' +
        active.map(p => `<option value="${p.id}">${escHtml(p.number)} ${escHtml(p.name)} (${p.progress}%)</option>`).join('');

    document.getElementById('batchDateInput').value = new Date().toISOString().slice(0, 10);

    const ov = document.getElementById('batchAdvanceOverlay');
    const dlg = document.getElementById('batchAdvanceDialog');
    ov.classList.add('open');
    dlg.classList.add('open');

    // 默认按阶段
    switchBAMode('stage');

    document.getElementById('batchAdvanceCancel').onclick = closeBatchAdvanceDialog;
    document.getElementById('batchAdvanceOk').onclick = doBatchAdvance;
    ov.onclick = (e) => { if (e.target === ov) closeBatchAdvanceDialog(); };
    dlg.querySelector('.modal-body').scrollTop = 0;
    activateDialogFocus(dlg, closeBatchAdvanceDialog);
}

function closeBatchAdvanceDialog() {
    document.getElementById('batchAdvanceOverlay').classList.remove('open');
    document.getElementById('batchAdvanceDialog').classList.remove('open');
    releaseDialogFocus(document.getElementById('batchAdvanceDialog'));
}

/** 按阶段：选阶段→列出项目 */
function onBatchStageChange() {
    const stageKey = document.getElementById('batchStageSelect').value;
    const method = document.getElementById('batchMethodSelect')?.value || '';
    const listEl = document.getElementById('batchProjectList');
    const candidates = batchAdvanceCandidates(method, stageKey);

    if (candidates.length === 0) {
        listEl.innerHTML = "<div style=\"text-align:center;color:var(--text3);padding:20px;font-size:13px\"><span data-ui-icon='🎉'></span> 没有需要推进的项目</div>";
        document.getElementById('batchAdvanceCount').textContent = '';
        document.getElementById('batchAdvanceOk').disabled = true;
        return;
    }

    document.getElementById('batchAdvanceOk').disabled = false;
    listEl.innerHTML = candidates.map(p => {
        const st = (p.stages || []).find(s => String(s.stage_key || s.key || '') === String(stageKey));
        const ps = st && plannedDate(st) ? formatDate(plannedDate(st)) : '未设置';
        return `<label class="batch-advance-row">
            <input type="checkbox" class="ba-cb" value="${p.id}" checked style="width:18px;height:18px;cursor:pointer">
            <div style="flex:1;min-width:0">
                <div style="font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(p.name)}</div>
                <div style="font-size:11px;color:var(--text3)">${escHtml(p.number)} · 计划: ${ps}</div>
            </div>
        </label>`;
    }).join('');
    _bindBACount();
}

/** 按项目：选项目→列出阶段 */
function onBatchProjectChange() {
    const pid = parseInt(document.getElementById('batchProjectSelect').value);
    const listEl = document.getElementById('batchProjectList');
    if (!pid) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">请先选择项目</div>';
        document.getElementById('batchAdvanceOk').disabled = true;
        document.getElementById('batchAdvanceCount').textContent = '';
        return;
    }

    const p = projectById.get(pid);
    if (!p || p.is_terminated) {
        listEl.innerHTML = '<div style="text-align:center;color:var(--text3);padding:20px;font-size:13px">项目不存在或已终止</div>';
        document.getElementById('batchAdvanceOk').disabled = true;
        return;
    }

    const pending = orderProjectStages(p.stages).filter(s => !s.completed && !s.skipped && !s.template_removed);
    if (pending.length === 0) {
        listEl.innerHTML = "<div style=\"text-align:center;color:var(--text3);padding:20px;font-size:13px\"><span data-ui-icon='🎉'></span> 该项目所有阶段已完成</div>";
        document.getElementById('batchAdvanceOk').disabled = true;
        document.getElementById('batchAdvanceCount').textContent = '';
        return;
    }

    document.getElementById('batchAdvanceOk').disabled = false;
    listEl.innerHTML = pending.map(s => {
        const stageKey = String(s.key || s.stage_key || '');
        const definition = projectStageDefinition(s, p);
        const name = definition.name;
        const icon = definition.icon;
        const ps = plannedDate(s) ? formatDate(plannedDate(s)) : '未设置';
        return `<label class="batch-advance-row">
            <input type="checkbox" class="ba-cb" data-stage="${escHtml(stageKey)}" checked style="width:18px;height:18px;cursor:pointer">
            <div style="flex:1;min-width:0">
                <div style="font-weight:600;color:var(--text)"><span data-ui-icon="${escHtml(icon)}"></span> ${escHtml(name)}</div>
                <div style="font-size:11px;color:var(--text3)">计划: ${ps}</div>
            </div>
        </label>`;
    }).join('');
    _bindBACount();
}

function _bindBACount() {
    document.querySelectorAll('.ba-cb').forEach(cb => cb.addEventListener('change', updateBatchAdvanceCount));
    updateBatchAdvanceCount();
}

function updateBatchAdvanceCount() {
    const checked = document.querySelectorAll('.ba-cb:checked').length;
    const total = document.querySelectorAll('.ba-cb').length;
    const label = _baMode === 'stage' ? '个项目' : '个阶段';
    document.getElementById('batchAdvanceCount').textContent = `已选 ${checked} / ${total} ${label}`;
}

function batchAdvanceSelectAll() {
    document.querySelectorAll('.ba-cb').forEach(cb => cb.checked = true);
    updateBatchAdvanceCount();
}
function batchAdvanceSelectNone() {
    document.querySelectorAll('.ba-cb').forEach(cb => cb.checked = false);
    updateBatchAdvanceCount();
}

async function doBatchAdvance() {
    const completedDate = document.getElementById('batchDateInput').value;
    let projectIds, stageKey, confirmMsg;

    if (_baMode === 'stage') {
        stageKey = document.getElementById('batchStageSelect').value;
        projectIds = [...document.querySelectorAll('.ba-cb:checked')].map(cb => parseInt(cb.value));
        const method = document.getElementById('batchMethodSelect')?.value || '';
        const stageName = batchAdvanceStageDefinitions(method).find(stage => stage.key === stageKey)?.name || stageKey;
        confirmMsg = `将“${method}”下 ${projectIds.length} 个项目的「${stageName}」阶段标记为完成？\n完成日期：${completedDate || '今天'}`;
    } else {
        const pid = parseInt(document.getElementById('batchProjectSelect').value);
        projectIds = [pid];
        const stageKeys = [...document.querySelectorAll('.ba-cb:checked')].map(cb => cb.dataset.stage);
        stageKey = stageKeys.join(',');
        const p = projectById.get(pid);
        confirmMsg = `将项目「${p ? p.name : ''}」的 ${stageKeys.length} 个阶段标记为完成？\n完成日期：${completedDate || '今天'}`;
    }

    if (!projectIds.length || !stageKey) {
        toast('请至少选择一项', 'warning');
        return;
    }

    // 按项目模式需要逐个推进每个阶段
    if (_baMode === 'project') {
        const keys = stageKey.split(',');
        if (!await confirmDialog('确认批量推进', confirmMsg, '确认推进', 'btn-success')) return;
        showLoading('正在批量推进...');
        let success = 0, skipped = [];
        try {
            for (const k of keys) {
                const result = await api('POST', '/api/batch/advance-stage', {
                    stage_key: k,
                    project_ids: projectIds,
                    completed_date: completedDate || undefined
                });
                success += result.advanced_count || 0;
                skipped.push(...(result.skipped || []));
            }
            hideLoading();
            closeBatchAdvanceDialog();
            await loadAllProjects();
            await loadDashboard({force: true});
            const msg = `成功推进 ${success} 个阶段${skipped.length ? `；${skipped.length} 个因必检项或状态不符被跳过` : ''}`;
            toast(msg, success ? 'success' : 'warning');
        } catch(e) {
            hideLoading();
            toast('❌ 推进失败：' + e.message, 'error');
        }
        return;
    }

    // 按阶段模式
    if (!await confirmDialog('确认批量推进', confirmMsg, '确认推进', 'btn-success')) return;
    try {
        showLoading('正在批量推进...');
        const result = await api('POST', '/api/batch/advance-stage', {
            stage_key: stageKey,
            project_ids: projectIds,
            completed_date: completedDate || undefined
        });
        hideLoading();
        closeBatchAdvanceDialog();
        await loadAllProjects();
        await loadDashboard({force: true});
        let msg = `✅ 成功推进 ${result.advanced_count} 个项目`;
        if (result.skipped && result.skipped.length > 0) {
            msg += `；跳过 ${result.skipped.length} 个：${result.skipped.join('、')}`;
        }
        toast(msg, result.advanced_count > 0 ? 'success' : 'warning');
    } catch(e) {
        hideLoading();
        toast('❌ 批量推进失败：' + e.message, 'error');
    }
}


// ── Render Timeline (进度) ──
function renderTimeline() {
    const p = currentProject;
    const container = document.getElementById('timelineContent');
    const stages = orderProjectStages(p.stages).filter(stage => !stage.template_removed);
    let doneCount = 0;
    const totalStages = stages.filter(s => !s.skipped).length || 1;
    let completedCount = stages.filter(s => s.completed || s.skipped).length;
    let html = '<div class="timeline-container"><div class="timeline-line"></div>';
    stages.forEach((s, i) => {
        const isSkipped = s.skipped;
        const isDone = s.completed;
        const isActive = !isSkipped && s.key === p.current_stage_key;
        const dotCls = isSkipped ? 'timeline-dot done' : (isDone ? 'timeline-dot done' : (isActive ? 'timeline-dot active' : 'timeline-dot'));
        const planStr = plannedDate(s) ? '<span data-ui-icon="📅"></span> ' + formatDate(plannedDate(s)) : '';
        const statusText = isSkipped ? '<span data-ui-icon="⚠️"></span> 不适用' : (isDone ? '<span data-ui-icon="✅"></span> ' + formatDate(s.completed_date) : (isActive ? '<span data-ui-icon="🔵"></span> 进行中' + (planStr ? ' · ' + planStr : '') : '<span data-ui-icon="⏳"></span> ' + (planStr || '待办')));
        const statusCls = isDone ? 'done-text' : '';
        if (isDone || isSkipped) doneCount++;
        const definition = projectStageDefinition(s, p);
        const displayName = definition.name;
        const cs = stageHasModule(s, 'result_publication', p) ? challengeStateOf(p) : null;
        const challengeCls = cs ? (cs === '投诉中' ? 'tl-challenge-complaint' : 'tl-challenge') : '';
        const challengeRow = cs ? `<div class="tl-challenge-badge ${cs==='投诉中'?'complaint':'challenge'}"><span data-ui-icon="${cs==='投诉中'?'❗':'⚠️'}"></span> ${cs==='投诉中'?'投诉处理中':'质疑处理中'}</div>` : '';
        html += `<div class="timeline-node ${challengeCls}">
            <div class="${dotCls}"><span data-ui-icon="${escHtml(definition.icon)}"></span></div>
            <div class="timeline-content" onclick="openStageSlide(stageKeyFromToken('${stageKeyToken(s.key)}'))">
                <h4>${escHtml(displayName)}${isSkipped ? ' <span style="font-size:11px;color:var(--text3)">(不适用)</span>' : ''}</h4>
                <div class="tl-status ${statusCls}">${statusText}</div>
                ${s.notes ? `<div class="tl-notes">${escHtml(s.notes)}</div>` : ''}
                ${challengeRow}
            </div>
        </div>`;
    });
    html += '</div>';

    const pct = p.progress;
    const color = getProgressColor(pct);
    html = `<div style="margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <div style="flex:1;height:8px;background:var(--surface2);border-radius:4px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:4px;transition:width .4s"></div>
        </div>
        <span style="font-weight:700;font-size:18px;color:${color}">${pct}%</span>
        <span style="font-size:13px;color:var(--text2)">${doneCount}/${stages.length} 阶段完成 (${stages.filter(s=>s.skipped).length}个不适用)</span>
    </div>` + html;

    container.innerHTML = html;
}

// ── Render Tasks (任务) ──
function renderTasks() {
    const p = currentProject;
    const container = document.getElementById('tasksContent');
    const stages = orderProjectStages(p.stages).filter(stage => !stage.template_removed);
    let html = '<table class="tasks-table"><thead><tr><th>阶段</th><th>状态</th><th>计划日期</th><th>完成日期</th><th>备注</th><th>操作</th></tr></thead><tbody>';
    stages.forEach(s => {
        const isSkipped = s.skipped;
        const tagCls = isSkipped ? 'stage-tag done' : (s.completed ? 'stage-tag done' : 'stage-tag');
        const tagText = isSkipped ? '<span data-ui-icon="⚠️"></span> 不适用' : (s.completed ? '<span data-ui-icon="✅"></span> 已完成' : '<span data-ui-icon="⏳"></span> 待办');
        const definition = projectStageDefinition(s, p);
        const displayName = definition.name;
        html += `<tr>
            <td><span data-ui-icon="${escHtml(definition.icon)}"></span> ${escHtml(displayName)}${isSkipped ? ' <span style="font-size:11px;color:var(--text3)">(不适用)</span>' : ''}</td>
            <td><span class="${tagCls}">${tagText}</span></td>
            <td>${isSkipped ? '—' : (plannedDate(s) ? formatDate(plannedDate(s)) : '—')}</td>
            <td>${isSkipped ? '—' : (s.completed_date ? formatDate(s.completed_date) : '—')}</td>
            <td>${s.notes ? escHtml(s.notes) : '—'}</td>
            <td>
                ${isSkipped ? "<span style=\"font-size:11px;color:var(--text3)\"><span data-ui-icon='⚠️'></span> 已跳过</span>" :
                `<button class="btn btn-sm ${s.completed ? 'btn-secondary' : 'btn-success'}" onclick="toggleStage(stageKeyFromToken('${stageKeyToken(s.key)}'))">${s.completed ? '撤销' : '完成'}</button>
                <button class="btn btn-sm btn-secondary" onclick="openStageSlide(stageKeyFromToken('${stageKeyToken(s.key)}'))">编辑</button>`}
            </td>
        </tr>`;
    });
    html += '</tbody></table>';
    container.innerHTML = html;
}

// ═════════════════════════════════════
// ── 附件管理 (Attachments) ──
// ═════════════════════════════════════

function renderAttachments() {
    const p = currentProject;
    if (!p) return;

    const container = document.getElementById('attachmentsContent');
    if (!container) return;

    const attachments = p.attachments || [];
    const count = attachments.length;

    // 更新Tab徽章
    const badge = document.getElementById('attachmentBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    let html = `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:15px;font-weight:600;color:var(--text)">
            <span data-ui-icon='📎'></span> 项目资料 (${count}个文件)
        </h3>
        <button class="btn btn-primary btn-sm" onclick="showUploadDialog()">上传文件</button>
        ${count > 1 ? '<button class="btn btn-danger btn-sm" onclick="batchDeleteAttachments()">批量删除</button>' : ''}
    </div>

    <!-- 批量删除工具栏（默认隐藏） -->
    ${count > 0 ? `
    <div id="attachmentBatchBar" style="display:none;margin-bottom:14px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-weight:600;color:var(--danger)"><span data-ui-icon='✏️'></span> 批量删除模式 - 勾选要删除的文件</span>
            <button class="btn btn-sm btn-secondary" onclick="exitBatchDeleteMode()">取消</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-danger" onclick="doBatchDelete()">删除选中项</button>
            <button class="btn btn-sm btn-secondary" onclick="selectAllAttachments()">全选</button>
            <span id="attachSelectCount" style="font-size:12px;color:var(--text2);align-self:center">已选：0</span>
        </div>
    </div>` : ''}
    <div id="uploadArea"
         style="border:2px dashed var(--border);border-radius:var(--radius);padding:30px;text-align:center;margin-bottom:20px;cursor:pointer;transition:border-color .2s,background .2s"
         ondrop="handleFileDrop(event)"
         ondragover="handleDragOver(event)"
         ondragleave="handleDragLeave(event)"
         onclick="document.getElementById('fileInput').click()">
        <div style="font-size:40px;margin-bottom:10px"><span data-ui-icon='📁'></span></div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">拖拽文件到此处上传</div>
        <div style="font-size:12px;color:var(--text3)">或点击选择文件（支持多选）</div>
        <div style="display:inline-flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text3)">
            <span><span data-ui-icon='📏'></span> 单个最大 1GB</span>
            <span><span data-ui-icon='📄'></span> 支持 PDF/Word/Excel/PPT/图片/压缩包等</span>
            <span><span data-ui-icon='🔒'></span> 安全存储，自动重命名</span>
        </div>
        <input type="file" id="fileInput" multiple style="display:none"
               accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.gif,.bmp,.webp,.zip,.rar,.7z,.csv,.json,.xml"
               onchange="handleFilesSelected(this.files)">
    </div>

    <!-- 上传进度条 -->
    <div id="uploadProgress" style="display:none;margin-bottom:16px;background:var(--surface2);border-radius:var(--radius-sm);overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;font-size:13px">
            <span>正在上传...</span>
            <span><span id="uploadPercent">0%</span>
                <button type="button" class="btn btn-danger btn-xs" style="margin-left:10px"
                        onclick="abortActiveUploads()">取消上传</button>
            </span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:0 2px 2px 0;position:relative">
            <div id="progressBarFill" style="height:100%;background:var(--primary);width:0%;transition:width .3s;border-radius:2px"></div>
        </div>
    </div>

    <!-- 附件列表 -->
    <div class="attachments-list" id="attachmentsList">
    `;

    if (count === 0) {
        html += uiStateMarkup('empty', '暂无附件，上传第一个文件开始整理项目资料。');
    } else {
        html += '<div class="attachment-grid">';
        attachments.forEach(att => {
            // 根据类型显示不同图标和颜色
            let icon = '📄';
            let typeClass = '';
            let typeTag = '';

            if (att.is_image) {
                icon = '🖼️'; typeClass = 'type-image'; typeTag = '图片';
            } else if (att.is_pdf) {
                icon = '📕'; typeClass = 'type-pdf'; typeTag = 'PDF';
            } else if (['doc','docx'].includes(att.extension)) {
                icon = '📘'; typeClass = 'type-doc'; typeTag = 'Word';
            } else if (['xls','xlsx'].includes(att.extension)) {
                icon = '📊'; typeClass = 'type-excel'; typeTag = 'Excel';
            } else if (['ppt','pptx'].includes(att.extension)) {
                icon = '📙'; typeClass = 'type-ppt'; typeTag = 'PPT';
            } else if (['zip','rar','7z'].includes(att.extension)) {
                icon = '📦'; typeClass = 'type-zip'; typeTag = '压缩包';
            }

            const sizeDisplay = att.file_size > 1024*1024
                ? (att.file_size / (1024*1024)).toFixed(2) + ' MB'
                : (att.file_size > 1024
                    ? (att.file_size / 1024).toFixed(1) + ' KB'
                    : att.file_size + ' B');

            html += `
            <div class="attachment-card ${typeClass}" data-id="${att.id}">
                <input type="checkbox" class="attach-cb" data-id="${att.id}"
                       style="display:none;cursor:pointer;margin-right:8px"
                       onclick="event.stopPropagation()">
                <div class="ac-icon"><span data-ui-icon="${escHtml(icon)}"></span></div>
                <div class="ac-info">
                    <div class="ac-name-wrapper">
                        <span class="ac-name" title="${escHtml(att.filename)}">${escHtml(att.filename)}</span>
                    </div>
                    <div class="ac-meta">
                        <span class="ac-size">${sizeDisplay}</span>
                        <span>${typeTag ? typeTag.toUpperCase() : att.extension.toUpperCase()}</span>
                        <span>${formatDateTimeShort(att.uploaded_at)}</span>
                    </div>
                    ${att.description ? `<div class="ac-desc" title="${escHtml(att.description)}"><span data-ui-icon='📝'></span> ${escHtml(att.description)}</div>` : ''}
                </div>
                <div class="ac-actions">
                    <button class="btn-icon" onclick="renameAttachment(${att.id})" title="重命名"><span data-ui-icon='✏️'></span></button>
                    ${att.is_image ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="预览图片"><span data-ui-icon='👁️'></span></button>` : ''}
                    ${att.is_pdf ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="查看PDF"><span data-ui-icon='📖'></span></button>` : ''}
                    ${['doc','docx'].includes(att.extension) ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="预览Word"><span data-ui-icon='📘'></span></button>` : ''}
                    ${['xls','xlsx'].includes(att.extension) ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="预览Excel"><span data-ui-icon='📊'></span></button>` : ''}
                    <button class="btn-icon" onclick="downloadAttachment(${att.id})" title="下载到本地"><span data-ui-icon="⬇"></span></button>
                    <button class="btn-icon danger-btn" onclick="deleteAttachment(${att.id})" title="删除此文件"><span data-ui-icon='🗑️'></span></button>
                </div>
            </div>`;
        });
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}


// ── 文件拖拽处理 ──
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--primary)';
    e.currentTarget.style.background = 'var(--primary-light)';
}
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--border)';
    e.currentTarget.style.background = 'transparent';
}
async function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--border)';
    e.currentTarget.style.background = 'transparent';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        await uploadFiles(files);
    }
}
async function handleFilesSelected(files) {
    if (files.length > 0) {
        await uploadFiles(files);
        // 清空input，允许重复选择同一文件
        document.getElementById('fileInput').value = '';
    }
}

// ── 文件上传核心函数（支持大文件） ──
function abortActiveUploads() {
    let aborted = 0;
    for (const request of activeUploads) {
        if (!request.candidateOwned || request.settled) continue;
        if (!request.xhr || request.xhr.readyState <= 0 || request.xhr.readyState >= 4) continue;
        request.explicitlyCancelled = true;
        request.xhr.abort();
        aborted += 1;
    }
    return aborted;
}

async function refreshAttachmentCsrfToken() {
    const response = await localFetch('/api/csrf-refresh');
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.csrf_token) {
        throw new Error('请求已过期，请刷新页面后重试');
    }
    window.CSRF_TOKEN = result.csrf_token;
    return result.csrf_token;
}

async function uploadFiles(fileList) {
    if (!currentProject) return;
    const projectId = currentProject.id;
    const navigationVersion = typeof projectNavigationVersion === 'undefined' ? 0 : projectNavigationVersion;

    // 预检查：过滤过大文件
    const limitMb = await getAttachmentUploadLimitMb();
    const MAX_SIZE = attachmentUploadLimitBytes();
    const validFiles = [];
    const oversizedFiles = [];

    for (let i = 0; i < fileList.length; i++) {
        if (fileList[i].size > MAX_SIZE) {
            oversizedFiles.push({
                name: fileList[i].name,
                sizeBytes: fileList[i].size,
            });
        } else {
            validFiles.push(fileList[i]);
        }
    }

    if (oversizedFiles.length > 0) {
        const msg = oversizedFiles.map(file =>
            `⚠️ ${file.name} (${(file.sizeBytes / (1024 * 1024)).toFixed(1)}MB 超过${limitMb}MB限制)`,
        ).join('；');
        toast(`部分文件太大无法上传：${msg}`, 'warning');
    }

    if (validFiles.length === 0) {
        if (oversizedFiles.length > 0) return;
        toast('没有可上传的文件', 'warning');
        return;
    }

    showUploadProgress(true, 0);

    // XHR 直接发送 FormData，浏览器会流式传输 File，不转 base64/整块内存。
    const doUpload = () => {
        const formData = new FormData();
        for (let i = 0; i < validFiles.length; i++) formData.append('files', validFiles[i]);
        formData.append('description', '');

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const registry = typeof activeUploads !== 'undefined' ? activeUploads : new Set();
            const request = {
                xhr,
                candidateOwned: true,
                ownerProjectId: Number(projectId),
                settled: false,
                explicitlyCancelled: false,
            };
            registry.add(request);

            const finish = callback => value => {
                if (request.settled) return;
                request.settled = true;
                registry.delete(request);
                callback(value);
            };
            const succeed = finish(resolve);
            const fail = finish(reject);

            xhr.upload.addEventListener('progress', e => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    showUploadProgress(true, percent);
                }
            });

            xhr.addEventListener('load', () => {
                let result = {};
                try { result = JSON.parse(xhr.responseText || '{}'); } catch (error) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        fail(new Error('服务器响应解析失败'));
                        return;
                    }
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    succeed(result);
                    return;
                }
                if (xhr.status === 413) {
                    fail(new Error(`文件太大！最大允许 ${limitMb}MB`));
                    return;
                }

                const csrfCode = result.code === 'csrf_expired' || result.code === 'csrf_invalid';
                const csrfFailure = (xhr.status === 400 || xhr.status === 403)
                    && (csrfCode || !result.code);
                const error = new Error(
                    result.error || (csrfFailure
                        ? '请求已过期，请刷新页面后重试'
                        : `上传失败 (HTTP ${xhr.status})`),
                );
                // 只有服务器同时明确证明未接收业务数据时，才允许换 token 后重发一次。
                error.csrfRetrySafe = (xhr.status === 400 || xhr.status === 403)
                    && csrfCode
                    && result.upload_accepted === false
                    && xhr.getResponseHeader('X-Upload-Accepted') === '0';
                fail(error);
            });
            xhr.addEventListener('error', () => fail(new Error('网络错误，请检查网络连接')));
            xhr.addEventListener('abort', () => {
                const error = new Error('上传已取消');
                error.cancelled = request.explicitlyCancelled;
                fail(error);
            });
            xhr.timeout = 15 * 60 * 1000; // 15分钟
            xhr.ontimeout = () => fail(new Error('上传超时，请检查网络或压缩文件后再试'));
            xhr.open('POST', `/api/projects/${projectId}/attachments`);
            xhr.withCredentials = true;
            xhr.setRequestHeader('X-CSRFToken', window.CSRF_TOKEN || '');
            xhr.send(formData);
        });
    };

    try {
        let result;
        try {
            result = await doUpload();
        } catch (error) {
            // 普通写失败绝不自动重试；只放行一次经服务器证明安全的 CSRF 更新。
            if (!error.csrfRetrySafe || typeof refreshAttachmentCsrfToken !== 'function') throw error;
            await refreshAttachmentCsrfToken();
            result = await doUpload();
        }

        const detail = storeProjectDetail(await api('GET', `/api/projects/${projectId}`));
        if(currentProject?.id===projectId && navigationVersion===(typeof projectNavigationVersion==='undefined'?0:projectNavigationVersion)){currentProject=detail;renderAttachments();}

        const errors = Array.isArray(result.errors) ? result.errors : [];
        const uploadedCount = Array.isArray(result.uploaded)
            ? result.uploaded.length
            : Math.max(0, validFiles.length - errors.length);
        if (uploadedCount > 0) toast(`✅ 成功上传 ${uploadedCount} 个文件`, 'success');
        if (errors.length > 0) {
            const reasons = errors.map((item, index) => {
                if (typeof item === 'string') return item;
                const filename = item.filename || item.name || validFiles[index]?.name || `文件${index + 1}`;
                return `${filename}：${item.error || item.reason || '上传失败'}`;
            });
            toast(`部分文件未上传：${reasons.join('；')}`, 'warning');
        }
    } catch(e) {
        console.error('上传失败:', e);
        toast((e.cancelled ? '上传已取消：' : '❌ 上传失败：') + e.message, e.cancelled ? 'warning' : 'error');
    } finally {
        showUploadProgress(false);
    }
}

function showUploadProgress(show, percent = 0) {
    const el = document.getElementById('uploadProgress');
    if (!el) return;
    el.style.display = show ? '' : 'none';
    if (show) {
        const fill = document.getElementById('progressBarFill');
        const text = document.getElementById('uploadPercent');
        if (fill) fill.style.width = percent + '%';
        if (text) text.textContent = percent + '%';
    }
}

function showUploadDialog() {
    document.getElementById('fileInput')?.click();
}

// ── 附件操作函数 ──
async function downloadAttachment(aid) {
    try {
        if (!isDesktopApp()) {
            const a = document.createElement('a');
            a.href = `/api/attachments/${aid}/download`;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast('已交给浏览器下载', 'success');
            return;
        }
        showLoading('正在保存文件...');
        const result = await api('POST', `/api/attachments/${aid}/save-local`, {});
        hideLoading();
        showModal('下载完成', `
            <div class="export-result">
                <div class="export-result-icon"><span data-ui-icon='✓'></span></div>
                <div>
                    <h4>${escHtml(result.filename || '附件文件')}</h4>
                    <p>已保存到：</p>
                    <code>${escHtml(result.path || '')}</code>
                </div>
            </div>
            <button class="btn btn-primary btn-block" onclick="closeModal()">知道了</button>
        `);
    } catch(e) {
        hideLoading();
        toast('❌ 下载失败：' + e.message, 'error');
    }
}

async function openAttachmentLocal(aid) {
    try {
        if (!isDesktopApp()) {
            window.open(`/api/attachments/${aid}/view`, '_blank');
            return;
        }
        showLoading('正在打开文件...');
        const result = await api('POST', `/api/attachments/${aid}/save-local?open=1`, {});
        hideLoading();
        toast(result.opened ? '已用系统默认程序打开' : '文件已保存', 'success');
    } catch(e) {
        hideLoading();
        toast('❌ 打开失败：' + e.message, 'error');
    }
}

// ═══════════════════════════════════════════════
// ── 文档预览系统 (PDF/Word/Excel) ──
// ═══════════════════════════════════════════════

let _previewState = {
    type: '',          // 'pdf' | 'word' | 'excel' | 'image'
    fileId: null,
    fileName: '',
    pdfDoc: null,
    pageNum: 1,
    totalPages: 0,
    scale: 0,
    rendering: false,
    objectUrls: new Set(),
    luckysheetCreated: false,
    pdfLoadingTask: null,
    sessionVersion: 0
};
let _previewSessionVersion = 0;
const _cancelledPdfLoadingTasks = new WeakSet();
let _pdfShortcutBound = false;
let _pdfKeydownHandler = null;
let _pdfWheelHandler = null;
let _previewReturnFocus = null;

function isAttachmentPreviewSessionCurrent(sessionVersion) {
    return Number.isInteger(sessionVersion)
        && sessionVersion === _previewSessionVersion
        && sessionVersion === _previewState.sessionVersion;
}

function cancelPdfLoadingTask(loadingTask) {
    if (!loadingTask || (typeof loadingTask !== 'object' && typeof loadingTask !== 'function')) return;
    if (_cancelledPdfLoadingTasks.has(loadingTask)) return;
    _cancelledPdfLoadingTasks.add(loadingTask);
    if (typeof loadingTask.destroy !== 'function') return;
    try {
        const cancellation = loadingTask.destroy();
        if (cancellation && typeof cancellation.catch === 'function') {
            cancellation.catch(error => console.error('取消 PDF 加载失败', error));
        }
    } catch (error) {
        console.error('取消 PDF 加载失败', error);
    }
}

/**
 * 打开文档预览（统一入口）
 * @param {number} aid - 附件ID
 */
async function viewAttachment(aid) {

    const att = findAttachmentById(aid);
    if (!att) {
        toast('❌ 找不到该附件', 'error');
        return;
    }
    if (localStorage.getItem('pm_preview_in_app') === '0') {
        openAttachmentLocal(aid);
        return;
    }

    const ext = (att.extension || '').toLowerCase();
    let fileType = '';

    // 判断文件类型（SVG 可携带脚本，禁止内联预览，改为下载/系统打开）
    if (ext === 'svg') {
        openAttachmentLocal(aid);
        return;
    }
    if (att.is_image || ['png','jpg','jpeg','gif','bmp','webp'].includes(ext)) fileType = 'image';
    else if (ext === 'pdf') fileType = 'pdf';
    else if (['doc', 'docx'].includes(ext)) fileType = 'word';
    else if (['xls', 'xlsx'].includes(ext)) fileType = 'excel';
    else {
        openAttachmentLocal(aid);
        return;
    }

    // 打开预览模态框
    try {
        openDocPreview(att, fileType, aid);
    } catch(e) {
        console.error('打开预览失败:', e);
        toast('❌ 预览失败：' + e.message, 'error');
    }
}

/**
 * 打开文档预览模态框
 */
function openDocPreview(att, fileType, aid) {

    const overlay = document.getElementById('docPreviewOverlay');
    if (!overlay) {
        console.error('❌ 找不到预览模态框元素 #docPreviewOverlay');
        toast('❌ 预览组件未加载', 'error');
        return;
    }

    if (!overlay.classList.contains('open')) _previewReturnFocus = document.activeElement;
    releaseAttachmentPreviewResources();
    const sessionVersion = ++_previewSessionVersion;

    const fileNameEl = document.getElementById('previewFileName');
    const fileBadge = document.getElementById('previewFileType');
    const loadingEl = document.getElementById('previewLoading');

    // 设置文件信息
    if (fileNameEl) fileNameEl.textContent = att.filename;
    if (fileBadge) {
        fileBadge.textContent = fileType.toUpperCase();
        fileBadge.className = `doc-pt-badge ${fileType}`;
    }

    // 重置状态
    _previewState = {
        type: fileType,
        fileId: aid,
        fileName: att.filename,
        pdfDoc: null,
        pageNum: 1,
        totalPages: 0,
        scale: 0,
        rendering: false,
        objectUrls: new Set(),
        luckysheetCreated: false,
        pdfLoadingTask: null,
        sessionVersion
    };

    // 显示对应的容器
    const pdfContainer = document.getElementById('pdfViewerContainer');
    const imageContainer = document.getElementById('imageViewerContainer');
    const docxContainer = document.getElementById('docxViewerContainer');
    const excelContainer = document.getElementById('excelViewerContainer');

    if (pdfContainer) pdfContainer.style.display = fileType === 'pdf' ? '' : 'none';
    if (imageContainer) imageContainer.style.display = fileType === 'image' ? '' : 'none';
    if (docxContainer) docxContainer.style.display = fileType === 'word' ? '' : 'none';
    if (excelContainer) excelContainer.style.display = fileType === 'excel' ? '' : 'none';

    // 显示/隐藏PDF缩放控制
    const showPdfControls = fileType === 'pdf';
    ['btnZoomIn', 'btnZoomOut'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = !showPdfControls; el.style.display = showPdfControls ? '' : 'none'; }
    });
    const zoomSelect = document.getElementById('pdfZoomSelect');
    if (zoomSelect) { zoomSelect.style.display = showPdfControls ? '' : 'none'; zoomSelect.value = 'fit'; }
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) pageInfo.textContent = '';

    // 重置加载状态
    if (loadingEl) {
        loadingEl.style.display = '';
        loadingEl.innerHTML = '<div class="spinner"></div><div>正在加载文档...</div>';
    }

    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '附件预览');
    overlay.tabIndex = -1;
    overlay.onkeydown = event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDocPreview(); }
    };
    // 显示模态框
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden'; // 防止背景滚动
    if (typeof activateDialogFocus === 'function') activateDialogFocus(overlay, closeDocPreview);
    else overlay.focus();

    // 根据类型加载预览
    if (fileType === 'image') {
        loadImagePreview(aid, att.filename, sessionVersion);
    } else if (fileType === 'pdf') {
        loadPDFPreview(aid, sessionVersion);
    } else if (fileType === 'word') {
        loadWordPreview(aid, sessionVersion);
    } else if (fileType === 'excel') {
        loadExcelPreview(aid, sessionVersion);
    }
}

/**
 * 统一释放附件预览所有的浏览器资源。可重复调用且只释放一次。
 */
function releaseAttachmentPreviewResources() {
    _previewSessionVersion += 1;
    if (_previewState.luckysheetCreated && typeof luckysheet !== 'undefined') {
        _previewState.luckysheetCreated = false;
        try { luckysheet.destroy(); } catch (error) { console.error('释放 Excel 预览失败', error); }
    }

    for (const objectUrl of (_previewState.objectUrls || [])) {
        try { URL.revokeObjectURL(objectUrl); } catch (error) { console.error('释放预览地址失败', error); }
    }
    if (_previewState.objectUrls?.clear) _previewState.objectUrls.clear();

    const overlay = document.getElementById('docPreviewOverlay');
    if (overlay && _pdfKeydownHandler) {
        overlay.removeEventListener('keydown', _pdfKeydownHandler);
        _pdfKeydownHandler = null;
    }
    if (overlay && _pdfWheelHandler) {
        overlay.removeEventListener('wheel', _pdfWheelHandler, {passive: false});
        _pdfWheelHandler = null;
    }
    _pdfShortcutBound = false;

    for (const id of [
        'pdfViewerContainer', 'imageViewerContainer',
        'docxViewerContainer', 'excelViewerContainer',
    ]) {
        const container = document.getElementById(id);
        if (container) container.innerHTML = '';
    }

    const pdfLoadingTask = _previewState.pdfLoadingTask;
    const pdfDoc = _previewState.pdfDoc;
    _previewState.pdfLoadingTask = null;
    _previewState.pdfDoc = null;
    _previewState.sessionVersion = 0;
    if (pdfLoadingTask) {
        cancelPdfLoadingTask(pdfLoadingTask);
    } else if (pdfDoc && typeof pdfDoc.destroy === 'function') {
        try { pdfDoc.destroy(); } catch (error) { console.error('释放 PDF 预览失败', error); }
    }
    _previewState.type = '';
    _previewState.fileId = null;
    _previewState.fileName = '';
    _previewState.pageNum = 1;
    _previewState.totalPages = 0;
    _previewState.rendering = false;
}

/** 关闭文档预览 */
function retryDocPreview() {
    const attachment = findAttachmentById(_previewState.fileId);
    if (attachment) openDocPreview(attachment, _previewState.type, _previewState.fileId);
}

function closeDocPreview() {
    releaseAttachmentPreviewResources();
    const overlay = document.getElementById('docPreviewOverlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (typeof releaseDialogFocus === 'function') releaseDialogFocus(overlay);
    else if (_previewReturnFocus?.isConnected) _previewReturnFocus.focus();
    _previewReturnFocus = null;
}

function findAttachmentById(aid) {
    const id = Number(aid);
    const direct = (currentProject?.attachments || []).find(a => Number(a.id) === id);
    if (direct) return direct;
    for (const r of (currentProject?.registrations || [])) {
        const found = (r.attachments || []).find(a => Number(a.id) === id);
        if (found) return found;
    }
    for (const c of (currentProject?.complaints || [])) {
        const found = (c.attachments || []).find(a => Number(a.id) === id);
        if (found) return found;
    }
    return null;
}

function loadImagePreview(aid, filename, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const loadingEl = document.getElementById('previewLoading');
    const container = document.getElementById('imageViewerContainer');
    container.innerHTML = '';
    const img = document.createElement('img');
    img.alt = filename || '图片预览';
    img.src = `/api/attachments/${aid}/view`;
    img.onload = () => {
        if (isAttachmentPreviewSessionCurrent(sessionVersion)) loadingEl.style.display = 'none';
    };
    img.onerror = () => {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        loadingEl.innerHTML = `
            <div class="preview-error">
                <div class="preview-error-title">图片加载失败</div>
                <button class="btn btn-secondary btn-sm" onclick="retryDocPreview()">重试</button> <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()">下载文件</button>
            </div>`;
    };
    container.appendChild(img);
}


// ────────────────────────────────────────
// PDF 预览 (使用 pdf.js)
// ────────────────────────────────────────

function loadPdfJsLibrary() {
    return import('/static/libs/pdfjs/pdf.min.mjs');
}

async function loadPDFPreview(aid, sessionVersion = _previewState.sessionVersion) {
    try {
        const pdfjsLib = await loadPdfJsLibrary();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 设置worker路径
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/libs/pdfjs/pdf.worker.min.mjs';

        // 获取文件URL
        const url = `/api/attachments/${aid}/view`;

        // 加载PDF文档
        const loadingTask = pdfjsLib.getDocument(url);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) {
            cancelPdfLoadingTask(loadingTask);
            return;
        }
        _previewState.pdfLoadingTask = loadingTask;
        const pdfDoc = await loadingTask.promise;
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) {
            cancelPdfLoadingTask(loadingTask);
            return;
        }
        _previewState.pdfDoc = pdfDoc;

        _previewState.totalPages = _previewState.pdfDoc.numPages;
        updatePageInfo();

        // 渲染全部页面（垂直排列）
        await renderAllPDFPages(sessionVersion);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 隐藏加载状态
        document.getElementById('previewLoading').style.display = 'none';

        // 绑定键盘和滚轮快捷键（只绑一次）
        bindPdfShortcuts();

    } catch(error) {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        const loadingTask = _previewState.pdfLoadingTask;
        _previewState.pdfLoadingTask = null;
        cancelPdfLoadingTask(loadingTask);
        console.error('PDF加载失败:', error);
        document.getElementById('previewLoading').innerHTML =
            '<div class="preview-error">PDF 加载失败<br><small>' + escHtml(error && error.message) + '</small><p><button class="btn btn-secondary" onclick="retryDocPreview()">重试</button> <button class="btn btn-primary" onclick="downloadPreviewFile()">下载文件</button></p></div>';
    }
}

/** 设备像素比，解决高清屏模糊 */
function getDPR() { return window.devicePixelRatio || 1; }

/**
 * 渲染所有PDF页面（垂直连续排列）
 * 每个canvas使用DPR缩放保证清晰度
 */
async function renderAllPDFPages(sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion) || !_previewState.pdfDoc) return;
    _previewState.rendering = true;

    const container = document.getElementById('pdfViewerContainer');
    container.innerHTML = '';  // 清空

    const dpr = getDPR();
    const scale = _previewState.scale || 1;
    // 容器宽度（减去padding），最小保底值防止除零
    const containerWidth = Math.max(container.clientWidth - 32, 200);

    try {
        for (let i = 1; i <= _previewState.totalPages; i++) {
            const page = await _previewState.pdfDoc.getPage(i);
            if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
            const finalScale = _previewState.scale === 0 ? containerWidth / page.getViewport({scale: 1}).width : scale;
            if (i === 1) _previewState.actualScale = finalScale;
            const fitViewport = page.getViewport({ scale: finalScale });

            // 创建canvas（DPR倍尺寸）
            const canvas = document.createElement('canvas');
            canvas.id = `pdf-page-${i}`;
            canvas.style.cssText =
                'display:block;margin:8px auto;border-radius:4px;box-shadow:0 2px 12px rgba(0,0,0,.3)';
            canvas.width = Math.round(fitViewport.width * dpr);
            canvas.height = Math.round(fitViewport.height * dpr);
            canvas.style.width = `${Math.round(fitViewport.width)}px`;
            canvas.style.height = `${Math.round(fitViewport.height)}px`;

            // 页码标签
            if (_previewState.totalPages > 1) {
                const label = document.createElement('div');
                label.textContent = `— 第 ${i} / ${_previewState.totalPages} 页 —`;
                label.style.cssText = 'text-align:center;color:var(--text2);font-size:11px;margin:4px 0';
                container.appendChild(label);
            }

            container.appendChild(canvas);

            // 高清渲染
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            const renderTask = page.render({
                canvasContext: ctx,
                viewport: fitViewport
            });
            await renderTask.promise;
            if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        }

        if (isAttachmentPreviewSessionCurrent(sessionVersion)) _previewState.rendering = false;
    } catch(e) {
        if (isAttachmentPreviewSessionCurrent(sessionVersion)) {
            _previewState.rendering = false;
            console.error('渲染失败:', e);
        }
    }
}

/** 重新渲染（缩放变化后调用） */
async function reRenderPDF() {
    if (!_previewState.pdfDoc || _previewState.rendering) return;
    const sessionVersion = _previewState.sessionVersion;
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    // 滚动位置记忆
    const container = document.getElementById('pdfViewerContainer');
    const scrollH = (container && container.scrollHeight - container.clientHeight) || 0;
    const scrollTopRatio = scrollH > 0 ? container.scrollTop / scrollH : 0;

    await renderAllPDFPages(sessionVersion);
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

    // 尽量恢复滚动位置（防止超出范围）
    if (container) {
        requestAnimationFrame(() => {
            if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
            const newH = container.scrollHeight - container.clientHeight;
            container.scrollTop = newH > 0 ? Math.min(scrollTopRatio * newH, newH) : 0;
        });
    }
}

// ── 缩放控制 ──
function previewZoomOut() {
    previewSetScale(Math.max(0.25, (_previewState.scale || _previewState.actualScale || 1) - 0.25));
}
function previewZoomIn() {
    previewSetScale(Math.min(5, (_previewState.scale || _previewState.actualScale || 1) + 0.25));
}
function previewSetScale(value) {
    if (_previewState.rendering) return;
    _previewState.scale = value === 'fit' ? 0 : Math.min(5, Math.max(0.25, parseFloat(value) || 1));
    const select = document.getElementById('pdfZoomSelect');
    if (select) select.value = _previewState.scale === 0 ? 'fit' : String(_previewState.scale);
    reRenderPDF();
}

// ── 翻页（垂直模式下保留按钮兼容，但主要靠滚动）──
function previewPrevPage() {
    scrollToPdfPage(_previewState.pageNum - 1);
}
function previewNextPage() {
    scrollToPdfPage(_previewState.pageNum + 1);
}

/** 跳转到指定页 */
function scrollToPdfPage(pageNum) {
    if (pageNum < 1) pageNum = 1;
    if (pageNum > _previewState.totalPages) pageNum = _previewState.totalPages;
    _previewState.pageNum = pageNum;
    updatePageInfo();

    const canvas = document.getElementById(`pdf-page-${pageNum}`);
    if (canvas) {
        canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function updatePageInfo() {
    const el = document.getElementById('pageInfo');
    if (el) el.textContent = `${_previewState.totalPages} 页`;
}

// ── 键盘 & 滚轮快捷键 ──
function bindPdfShortcuts() {
    if (_pdfShortcutBound) return;
    _pdfShortcutBound = true;

    const overlay = document.getElementById('docPreviewOverlay');

    // 键盘快捷键
    _pdfKeydownHandler = function(e) {
        if (_previewState.type !== 'pdf') return;
        // Ctrl+/-/0 缩放
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+') { e.preventDefault(); previewZoomIn(); return; }
            if (e.key === '-') { e.preventDefault(); previewZoomOut(); return; }
            if (e.key === '0') { e.preventDefault(); _previewState.scale = 1; reRenderPDF(); return; }
        }
    };
    overlay.addEventListener('keydown', _pdfKeydownHandler);

    // Ctrl+滚轮缩放
    _pdfWheelHandler = function(e) {
        if (_previewState.type !== 'pdf' || (!e.ctrlKey && !e.metaKey)) return;
        e.preventDefault();
        if (e.deltaY < 0) previewZoomIn();
        else previewZoomOut();
    };
    overlay.addEventListener('wheel', _pdfWheelHandler, {passive: false});
}


// ────────────────────────────────────────
// Word/DOCX 预览 (使用 docx-preview)
// ────────────────────────────────────────

async function loadWordPreview(aid, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const loadingEl = document.getElementById('previewLoading');
    const container = document.getElementById('docxViewerContainer');

    try {
        // ── 检查库 ──
        if (typeof docx === 'undefined') {
            throw new Error('Word预览库未加载，请刷新页面重试');
        }
        container.innerHTML = '';

        // ── 获取文件（带凭证）──
        const url = `/api/attachments/${aid}/view`;
        const response = await localFetch(url);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 检查是否被重定向到登录页
        const ct = response.headers.get('content-type') || '';
        if (!response.ok || ct.includes('text/html')) {
            if (ct.includes('text/html')) {
                throw new Error('登录已过期，请刷新页面后重新预览');
            }
            throw new Error('下载失败 (HTTP ' + response.status + ')');
        }

        const blob = await response.blob();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        if (blob.size === 0) throw new Error('文件为空');

        // ── 关键检测：判断是否为有效的 ZIP (docx) ──
        // 读取前4字节: ZIP文件以 PK\x03\x04 开头 (0x504B0304)
        const headerBytes = await blob.slice(0, 4).arrayBuffer();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        const headerView = new Uint8Array(headerBytes);
        const isZip = headerView[0] === 0x50 && headerView[1] === 0x4B &&
                      headerView[2] === 0x03 && headerView[3] === 0x04;

        if (!isZip) {
            console.warn('[Word] ⚠️ 不是标准 docx (ZIP) 格式，可能是旧版 .doc');
            // 不是 docx → 显示友好提示，引导下载
            loadingEl.innerHTML =
                `<div style="padding:40px 20px;text-align:center;color:var(--text)">

                    <div style="font-size:16px;font-weight:600;margin-bottom:10px">此文档无法在线预览</div>
                    <div style="font-size:13px;color:var(--text2);margin-bottom:6px">该文件可能是 <b>旧版 Word (.doc)</b> 或其他格式</div>
                    <div style="font-size:12px;color:var(--text2);margin-bottom:24px">
                        在线预览仅支持 .docx 格式（Word 2007+）<br>
                        旧版 .doc 需要下载后用 Word 打开
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()"
                            style="padding:10px 24px;font-size:14px">
                        下载文件查看
                    </button>
                </div>`;
            return; // 不报错，直接退出
        }

        // ── 渲染 docx ──
        const options = {
            className: 'docx-viewer',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true
        };

        // 先渲染到脱离 DOM 的容器，旧会话即使延迟完成也无法污染当前预览。
        const stagingContainer = document.createElement('div');
        await docx.renderAsync(blob, stagingContainer, null, options);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        container.innerHTML = stagingContainer.innerHTML;
        loadingEl.style.display = 'none';

    } catch(error) {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        console.error('❌ Word文档加载失败:', error);
        loadingEl.innerHTML =
            `<div style="color:#ef4444;padding:20px;text-align:center">

                <div style="font-weight:bold;margin-bottom:8px">Word文档加载失败</div>
                <div style="font-size:12px;color:var(--text2);margin-bottom:12px;word-break:break-all">${escHtml(error && error.message)}</div>
                <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()" style="margin-top:12px">下载文件</button>
            </div>`;
    }
}


// ────────────────────────────────────────
// Excel/XLSX 预览 (使用 Luckysheet + xlsx)
// ────────────────────────────────────────

async function loadExcelPreview(aid, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const loadingEl = document.getElementById('previewLoading');
    const container = document.getElementById('excelViewerContainer');

    try {
        // 检查库是否加载
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel解析库未加载，请刷新页面重试');
        }
        if (typeof luckysheet === 'undefined') {
            throw new Error('Excel预览库未加载，请刷新页面重试');
        }
        container.innerHTML = '<div id="luckysheet" style="width:100%;height:100%;min-height:240px"></div>';

        // 获取文件
        const response = await localFetch(`/api/attachments/${aid}/view`);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        if (!response.ok || (response.headers.get('content-type') || '').includes('text/html')) throw new Error('文件无法读取或登录已过期，请重新登录后重试');
        const arrayBuffer = await response.arrayBuffer();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 使用xlsx解析
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // 转换为Luckysheet格式
        const luckysheetData = [];

        workbook.SheetNames.forEach((sheetName, index) => {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

            // Luckysheet数据格式
            const luckysheetSheet = {
                name: sheetName,
                index: index,
                order: index,
                celldata: [],
                config: {},
                row: jsonData.length || 10,
                column: jsonData.length > 0 ? Math.max(...jsonData.map(row => row.length), 10) : 10
            };

            // 转换单元格数据
            jsonData.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if (cell !== undefined && cell !== '') {
                        luckysheetSheet.celldata.push({
                            r: r,
                            c: c,
                            v: {
                                v: cell,
                                ct: { fa: 'General', t: typeof cell === 'number' ? 'n' : 's' }
                            }
                        });
                    }
                });
            });

            luckysheetSheet.config.merge = {};
            // sheet_to_json starts at the used range, so merges need the same origin.
            const origin = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s : {r: 0, c: 0};
            for (const merge of (sheet['!merges'] || [])) {
                const r = merge.s.r - origin.r;
                const c = merge.s.c - origin.c;
                if (r < 0 || c < 0) continue;
                luckysheetSheet.config.merge[`${r}_${c}`] = {
                    r, c,
                    rs: merge.e.r - merge.s.r + 1, cs: merge.e.c - merge.s.c + 1
                };
            }
            luckysheetData.push(luckysheetSheet);
        });

        // 初始化Luckysheet
        const options = {
            container: 'luckysheet',
            title: _previewState.fileName.replace(/\.(xls|xlsx)$/i, ''),
            lang: 'zh',
            data: luckysheetData,
            plugins: [],
            showtoolbar: false,
            showinfobar: false,
            showsheetbar: true,
            enableAddRow: false,   // 只读模式
            enableAddBackTop: false,
            userInfo: false,
            showstatisticBar: false,
            forceCalculation: true,
            hook: {
                cellUpdatedBefore: function(r, c, value, isRefresh) {
                    return false; // 禁止编辑
                },
                cellDragBefore: function(r, c, r2, c2) {
                    return false; // 禁止拖拽
                }
            }
        };

        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        luckysheet.create(options);
        _previewState.luckysheetCreated = true;
        // 隐藏加载状态
        loadingEl.style.display = 'none';

    } catch(error) {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        console.error('❌ Excel加载失败:', error);
        loadingEl.innerHTML =
            `<div style="color:#ef4444;padding:20px;text-align:center">

                <div style="font-weight:bold;margin-bottom:8px">Excel文件加载失败</div>
                <div style="font-size:12px;color:var(--text2)">${escHtml(error && error.message)}</div>
                <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()" style="margin-top:12px">
                    下载文件查看
                </button>
            </div>`;
    }
}


/**
 * 下载当前预览的原始文件
 */
function downloadPreviewFile() {
    if (_previewState.fileId) {
        downloadAttachment(_previewState.fileId);
    }
}

function openPreviewFile() {
    if (_previewState.fileId) {
        openAttachmentLocal(_previewState.fileId);
    }
}


// ESC键关闭预览
document.addEventListener('keydown', function(e) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && document.getElementById('docPreviewOverlay').classList.contains('open')) {
        if (typeof topManagedDialog === 'function' && topManagedDialog()?.container !== document.getElementById('docPreviewOverlay')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        closeDocPreview();
    }
});
window.addEventListener('pagehide', releaseAttachmentPreviewResources);


// ── 附件重命名（弹窗式，扩展名锁定） ──
function renameAttachment(aid) {
    const projectId=currentProject?.id;
    const navigationVersion=typeof projectNavigationVersion==='undefined'?0:projectNavigationVersion;
    const att = (currentProject?.attachments || []).find(a => a.id === aid);
    if (!att) return;

    const currentName = att.filename;
    // 分离文件名和扩展名
    const dotIndex = currentName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? currentName.substring(0, dotIndex) : currentName;
    const ext = dotIndex > 0 ? currentName.substring(dotIndex) : '';  // 包含点号，如 ".pdf"

    document.getElementById('renameInput').value = baseName;
    document.getElementById('renameExtHint').textContent = ext
        ? `文件格式将保持为：${ext.toUpperCase()} （不可更改）`
        : '该文件没有扩展名';

    // 存储附件ID和原始扩展名到闭包或元素上
    document.getElementById('renameDialog').dataset.aid = aid;
    document.getElementById('renameDialog').dataset.ext = ext;

    const ov = document.getElementById('renameOverlay');
    const dlg = document.getElementById('renameDialog');
    const inputEl = document.getElementById('renameInput');
    const okBtn = document.getElementById('renameOk');
    const cancelBtn = document.getElementById('renameCancel');

    ov.classList.add('open');
    dlg.classList.add('open');

    // 自动聚焦并选中全部文本
    setTimeout(() => {
        inputEl.focus();
        inputEl.select();
    }, 100);

    const done = () => {
        ov.classList.remove('open');
        dlg.classList.remove('open');
        ov.removeEventListener('click', onOverlay);
        cancelBtn.removeEventListener('click', onCancel);
        okBtn.removeEventListener('click', onOk);
        inputEl.removeEventListener('keydown', onKeydown);
    };

    const onOverlay = (e) => { if (e.target === ov) done(); };
    const onCancel = () => done();
    const onKeydown = (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
        if (e.key === 'Escape') done();
    };
    const onOk = async () => {
        let newName = inputEl.value.trim();
        if (!newName) {
            toast('❌ 文件名不能为空', 'error');
            inputEl.focus();
            return;
        }
        // 强制追加原始扩展名
        if (ext) newName = newName + ext;
        done();

        try {
            const result = await api('PUT', `/api/attachments/${aid}`, { filename: newName });
            const detail=storeProjectDetail(await api('GET', `/api/projects/${projectId}`));
            if(currentProject?.id===projectId && navigationVersion===(typeof projectNavigationVersion==='undefined'?0:projectNavigationVersion)){currentProject=detail;renderAttachments();}
            toast(`✅ 已重命名为：${result.filename}`, 'success');
        } catch(e) {
            toast('❌ 重命名失败：' + e.message, 'error');
        }
    };

    ov.addEventListener('click', onOverlay);
    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
    inputEl.addEventListener('keydown', onKeydown);
}


async function deleteAttachment(aid) {
    const att = (currentProject?.attachments || []).find(item => item.id === aid);
    const fileName = att?.filename || '该附件';
    const confirmed = await confirmDialog(
        '删除附件',
        `确定删除「${fileName}」？此操作不可恢复。`,
        '删除',
        'btn-danger',
    );
    if (!confirmed) return;

    showLoading('正在删除...');
    try {
        await api('DELETE', `/api/attachments/${aid}`);
        toast(`🗑️ 已删除：${fileName}`, 'success');
        await refreshProject();
        if (editingStageKey) openStageSlide(editingStageKey);
    }
    catch (error) {
        console.error('删除附件失败:', error);
        toast(`❌ 删除失败：${error.message}`, 'error');
    }
    finally {
        hideLoading();
    }
}
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
                <span class="close-reason-tag"><span data-ui-icon="${p.terminated_type === 'liubiao' ? '🚫' : '🟠'}"></span> ${p.terminated_type === 'liubiao' ? '流标原因' : '废标原因'}</span>
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
                    <span class="toggle-label" id="stageCompletedLabel">${s.completed && !s.skipped ? '<span data-ui-icon="✅"></span> 已完成' : '<span data-ui-icon="⏳"></span> 待办'}</span>
                </div>
            </div>
            <div style="margin-top:8px">
                <div class="toggle-row" style="margin-top:8px" onclick="toggleSkipFromRow()">
                    <div class="toggle-switch">
                        <input type="checkbox" id="stageSkipped" onclick="event.stopPropagation(); syncSkipStage()" ${s.skipped ? 'checked' : ''}>
                        <span class="toggle-slider toggle-warning"></span>
                    </div>
                    <span class="toggle-label" id="stageSkippedLabel">${s.skipped ? '<span data-ui-icon="⚠️"></span> 已跳过' : '不适用此阶段'}</span>
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
            if(stageHasModule(s,"registration",p))h+=`<div class="biz-sec"><div class="biz-bar"><span>供应商报名</span><span style="display:inline-flex;gap:6px;align-items:center"><select id="regExportScope" class="mini-select" style="width:110px;height:24px;font-size:12px"><option value="current">当前项目</option><option value="all">全部项目</option></select><button class="btn btn-xs" onclick="exportRegistrations()">导出</button><button class="btn btn-xs" onclick="showRegistrationImportDialog()">导入</button></span><button class="btn btn-xs btn-primary" aria-label="新增供应商报名" onclick="showRegistrationForm()">+</button></div><div class="biz-body">${(p.registrations||[]).length?p.registrations.map(r=>{const m=r.registration_method||'线上报名';const isOnline=m==='线上报名';const mTag=`<span style="font-size:11px;padding:1px 6px;border-radius:8px;margin-right:4px;${isOnline?'background:#e6f4ea;color:#1a7f37':'background:#e8f0fe;color:#1a56c4'}">${isOnline?'线上报名':'现场报名/线下报名'}</span>`;const atts=(r.attachments||[]);const attHtml=atts.length?`<div class="biz-attach">${atts.map(a=>`<span class="att-chip"><span data-ui-icon='📎'></span> ${escHtml(a.filename)} <a href="javascript:void(0)" onclick="downloadAttachment(${a.id})" title="下载"><span data-ui-icon="⬇"></span></a>${(a.is_image||a.is_pdf||['doc','docx','xls','xlsx'].includes(a.extension||''))?`<a href="javascript:void(0)" onclick="viewAttachment(${a.id})" title="预览"><span data-ui-icon='👁'></span></a>`:''}<a href="javascript:void(0)" onclick="deleteAttachment(${a.id})" title="删除" style="color:var(--danger)"><span data-ui-icon='🗑'></span></a></span>`).join('')}</div>`:'';return `<div class="biz-row"><span>${mTag}${escHtml(r.company_name)} ${r.lot_number?"["+escHtml(r.lot_number)+"]":""}</span><a href="javascript:void(0)" onclick="showRegistrationForm(${r.id})">编辑</a> <a href="javascript:void(0)" onclick="deleteRegistration(${r.id})" style="color:var(--danger)">删除</a></div>${registrationMemberSummaryHtml(r)}${attHtml}${typeof renderOnlineRegistrationSlot === 'function' ? renderOnlineRegistrationSlot(r,p) : ''}`;}).join(""):"<div class=\"biz-none\">暂无报名记录</div>"}</div></div>`;
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
    if (cl) window.PMIcons.label(cl, skipped ? '⏳ 待办' : (document.getElementById('stageCompleted').checked ? '✅ 已完成' : '⏳ 待办'));
    if (sl) window.PMIcons.label(sl, skipped ? '⚠️ 已跳过' : '不适用此阶段');
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
    if (cl) window.PMIcons.label(cl, cb.checked ? '✅ 已完成' : '⏳ 待办');
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
// ── Dashboard（缓存先显示，后台刷新） ──
async function loadDashboard({force = false} = {}) {
    const key = 'dashboard';
    let cached = readViewCache(key);
    if (cached && !force) {
        try { renderDashboard(cached.value.stats, cached.value.projects); }
        catch (error) { console.error('总览缓存显示失败，重新读取', error); invalidateViewCache(key); cached = null; force = true; }
    }
    if (!cached) renderViewSkeleton('dashboardContent', '正在准备总览...');
    if (cached?.fresh && !force) return cached.value;
    try {
        const result = await requestViewData(key, async () => {
            const [stats, projects] = await Promise.all([
                api('GET', '/api/stats'),
                allProjects.length ? Promise.resolve(allProjects) : api('GET', '/api/projects'),
            ]);
            return {stats, projects};
        }, {force});
        if (!result.accepted) return cached?.value || null;
        const value = result.value;
        const {stats, projects} = value;
        if (!allProjects.length && projects.length) {
            allProjects = projects;
            rebuildProjectIndexes(allProjects);
            markSidebarDataChanged();
            renderSidebar();
        }
        renderDashboard(stats, projects);
        writeViewCache(key, value);
        return value;
    } catch(e) {
        console.error('总览数据刷新失败', e);
        if (cached) toast('总览数据刷新失败，已保留当前内容', 'warning');
        else renderViewLoadError('dashboardContent', '总览加载失败', () => loadDashboard({force: true}), e);
        return cached?.value || null;
    }
}

function renderDashboard(stats, projects) {
    const model = commandCenterModel(projects, stats, new Date());
    const dashboardContent = document.getElementById('dashboardContent');
    dashboardContent.innerHTML = renderCommandCenterDashboard(model);
    if (dashboardContent.closest('.view')?.classList.contains('active')) {
        initializeCommandCenterMotion(dashboardContent);
    }
}

function renderLegacyDashboard(stats, projects) {

    const activeProjects = projects.filter(p => !p.is_terminated);
    const inProgressProjects = activeProjects.filter(p => p.progress < 100);
    const completedProjects = activeProjects.filter(p => p.progress >= 100);
    const overdueItems = collectScheduleItems(projects, 'overdue');
    const upcomingItems = collectScheduleItems(projects, 'upcoming');
    const exportYears = [...new Set(projects.map(p => p.year).filter(Boolean))].sort((a, b) => String(b).localeCompare(String(a)));
    const defaultExportYear = localStorage.getItem('pm_default_export_year') || '';

    let html = `<div class="stats-row">
        <div class="stat-card"><div class="stat-icon"><span data-ui-icon='📊'></span></div><div class="stat-value">${stats.total}</div><div class="stat-label">项目总数</div></div>
        <div class="stat-card"><div class="stat-icon"><span data-ui-icon='🔄'></span></div><div class="stat-value">${stats.in_progress}</div><div class="stat-label">进行中</div></div>
        <div class="stat-card"><div class="stat-icon"><span data-ui-icon='🔴'></span></div><div class="stat-value danger-text">${overdueItems.length}</div><div class="stat-label">逾期事项</div></div>
        <div class="stat-card"><div class="stat-icon"><span data-ui-icon='🟠'></span></div><div class="stat-value warning-text">${upcomingItems.length}</div><div class="stat-label">未来7天</div></div>
        <div class="stat-card"><div class="stat-icon"><span data-ui-icon='🚫'></span></div><div class="stat-value danger-text">${stats.liubiao}</div><div class="stat-label">流标</div></div>
        <div class="stat-card"><div class="stat-icon"><span data-ui-icon='⛔'></span></div><div class="stat-value warning-text">${stats.feibiao}</div><div class="stat-label">废标</div></div>
    </div>
    <div class="dashboard-actions">
        <button class="btn btn-primary btn-sm" onclick="openBatchAdvanceDialog()">批量推进阶段</button>
        <select id="exportYearSelect" class="mini-select" title="选择导出年份">
            <option value="">全部年份</option>
            ${exportYears.map(y => `<option value="${escHtml(String(y))}" ${String(y) === defaultExportYear ? 'selected' : ''}>${escHtml(String(y))}</option>`).join('')}
        </select>
        <button class="btn btn-secondary btn-sm" onclick="exportData()">导出项目</button>
        <button class="btn btn-secondary btn-sm" onclick="showProjectImportDialog()">导入项目</button>
    </div>`;

    // ── 可视化统计图表 (SVG环形图 + 状态分布) ──
    const total = stats.total;
    const completed = stats.completed;
    const inProgress = stats.in_progress;
    const liubiao = stats.liubiao || 0;
    const feibiao = stats.feibiao || 0;

    if (total > 0) {
        // 简单的状态分布条
        const statusData = [
            {label: '已完成', count: completed, color: '#22c55e', pct: Math.round(completed/total*100)},
            {label: '进行中', count: inProgress, color: '#2563eb', pct: Math.round(inProgress/total*100)},
            {label: '流标', count: liubiao, color: '#ef4444', pct: Math.round(liubiao/total*100)},
            {label: '废标', count: feibiao, color: '#f59e0b', pct: Math.round(feibiao/total*100)},
        ].filter(d => d.count > 0);

        // SVG环形图
        let cumulativePct = 0;
        const radius = 50;
        const circumference = 2 * Math.PI * radius;
        const svgParts = statusData.map((d, i) => {
            const startPct = cumulativePct;
            cumulativePct += d.pct;
            const startAngle = (startPct / 100) * 360 - 90;  // -90使起点在顶部
            const endAngle = (cumulativePct / 100) * 360 - 90;
            const largeArc = (d.pct > 50) ? 1 : 0;

            const x1 = 70 + radius * Math.cos(startAngle * Math.PI / 180);
            const y1 = 70 + radius * Math.sin(startAngle * Math.PI / 180);
            const x2 = 70 + radius * Math.cos(endAngle * Math.PI / 180);
            const y2 = 70 + radius * Math.sin(endAngle * Math.PI / 180);

            return `<path d="M 70,70 L ${x1},${y1} A ${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z" fill="${d.color}" opacity="0.85">
                <title>${d.label}: ${d.count}项 (${d.pct}%)</title>
            </path>`;
        }).join('');

        html += `<div class="dash-card" style="margin-bottom:16px">
            <h3><span data-ui-icon='📊'></span> 项目状态分布</h3>
            <div style="display:flex;align-items:center;gap:24px;flex-wrap:wrap;padding:10px 0">
                <div style="position:relative;width:140px;height:140px;flex-shrink:0">
                    <svg viewBox="0 0 140 140" width="140" height="140" style="transform:rotate(-90deg)">
                        <circle cx="70" cy="70" r="${radius}" fill="none" stroke="#f0f2f5" stroke-width="28"/>
                        ${svgParts}
                        <circle cx="70" cy="70" r="${radius-20}" fill="white"/>
                    </svg>
                    <div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);text-align:center">
                        <div style="font-size:24px;font-weight:700;color:var(--text)">${total}</div>
                        <div style="font-size:11px;color:var(--text3)">项目总数</div>
                    </div>
                </div>
                <div style="flex:1;min-width:160px">
                    ${statusData.map(d => `
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:13px">
                            <span style="width:14px;height:14px;border-radius:3px;background:${d.color};flex-shrink:0"></span>
                            <span style="flex:1">${d.label}</span>
                            <span style="font-weight:600">${d.count}</span>
                            <span style="color:var(--text3);min-width:40px;text-align:right">${d.pct}%</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>`;
    }

    html += `<div class="dash-grid dash-grid-main">
        <div class="dash-card alert-card ${overdueItems.length ? 'has-alert' : ''}">
            <h3><span data-ui-icon='🔴'></span> 逾期事项</h3>
            ${renderScheduleList(overdueItems, '暂无逾期事项')}
        </div>
        <div class="dash-card alert-card">
            <h3><span data-ui-icon='🟠'></span> 未来 7 天事项</h3>
            ${renderScheduleList(upcomingItems, '未来 7 天暂无计划事项')}
        </div>
    </div>`;

    const totalRegistrations = projects.reduce((sum, p) => sum + (p.registration_count ?? ((p.registrations && p.registrations.length) || 0)), 0);
    html += `<div class="dash-grid">
        <div class="dash-card">
            <h3><span data-ui-icon='📈'></span> 各阶段项目分布</h3>
            ${stats.stage_counts.map(sc => {
                const pct = stats.in_progress > 0 ? (sc.count / stats.in_progress * 100) : 0;
                const color = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#65a30d','#ca8a04','#dc2626','#db2777','#9333ea','#6366f1','#0ea5e9','#14b8a6','#84cc16'][STAGE_KEYS.indexOf(sc.key)] || '#6366f1';
                let extraBadge = '';
                if (sc.key === 'registration_end' && totalRegistrations > 0) extraBadge = `<span style="margin-left:6px;font-size:11px;color:var(--success);font-weight:600">(${totalRegistrations}家报名)</span>`;
                if (sc.key === 'result_announced') {
                    const bidCount = projects.reduce((sum, p) => sum + ((p.bid_results && p.bid_results.length) || 0), 0);
                    if (bidCount > 0) extraBadge = `<span style="margin-left:6px;font-size:11px;color:var(--success);font-weight:600">(${bidCount}家中标)</span>`;
                }
                if (sc.key === 'winning_notice') {
                    const noticeCount = projects.reduce((sum, p) => sum + (p.notice_delivery_count ?? ((p.notice_deliveries && p.notice_deliveries.length) || 0)), 0);
                    if (noticeCount > 0) extraBadge = `<span style="margin-left:6px;font-size:11px;color:var(--success);font-weight:600">(${noticeCount}家通知)</span>`;
                }
                if (sc.key === 'service_fee') {
                    const feeTotal = projects.reduce((sum, p) => sum + (p.service_fee_total ?? ((p.service_fee_invoices || []).reduce((s, i) => s + (Number(i.amount) || 0), 0))), 0);
                    if (feeTotal > 0) extraBadge = `<span style="margin-left:6px;font-size:11px;color:var(--warning);font-weight:600">(合计${formatMoneyShort(feeTotal)})</span>`;
                }
                return `<div class="stage-bar">
                    <span class="bar-label"><span data-ui-icon="${escHtml(sc.icon)}"></span> ${escHtml(sc.name)}${extraBadge}</span>
                    <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${color}"></div></div>
                    <span class="bar-count">${sc.count}</span>
                </div>`;
            }).join('')}
        </div>
        <div>
            <div class="dash-card" style="margin-bottom:16px">
                <h3><span data-ui-icon='🔄'></span> 进行中的项目</h3>
                ${inProgressProjects.length === 0 ? '<div class="compact-empty">暂无进行中的项目</div>' :
                    `<div class="dash-list-scroll">${inProgressProjects.map(p => {
                        const status = projectStatusInfo(p);
                        return `<div class="compact-item" onclick="selectProject(${p.id})">
                            <span class="ci-number">${escHtml(p.number)}</span>
                            ${escHtml(p.name)} <span class="mini-status ${status.cls}"><span data-ui-icon="${escHtml(status.icon)}"></span> ${status.text}</span>
                            <span style="float:right;color:${getProgressColor(p.progress)};font-weight:600">${p.progress}%</span>
                        </div>`;
                    }).join('')}</div>`}
            </div>
            <div class="dash-card">
                <h3><span data-ui-icon='✅'></span> 已完成的项目</h3>
                ${completedProjects.length === 0 ? '<div class="compact-empty">暂无已完成的项目</div>' :
                    `<div class="dash-list-scroll">${completedProjects.map(p => 
                        `<div class="compact-item" onclick="selectProject(${p.id})">
                            <span class="ci-number">${escHtml(p.number)}</span>
                            ${escHtml(p.name)}
                        </div>`
                    ).join('')}</div>`}
            </div>
        </div>
    </div>`;

    document.getElementById('dashboardContent').innerHTML = html;
}

// ── 采购方式看板 (按采购方式分类的项目看板) ──
const PROCURE_KNOWN = ['公开招标','邀请招标','竞争性磋商','竞争性谈判','网上竞价','遴选','单一来源','直选','简易工程'];
const PROCURE_ICON = {
    '公开招标':'🏷️', '邀请招标':'✉️', '竞争性磋商':'🤝', '竞争性谈判':'💬',
    '网上竞价':'💻', '遴选':'🏆', '单一来源':'🎯', '直选':'📌', '简易工程':'🔧', '未设置':'❓'
};
const PROCURE_COLOR = {
    '公开招标':'#2563eb', '邀请招标':'#7c3aed', '竞争性磋商':'#0891b2',
    '竞争性谈判':'#db2777', '网上竞价':'#ea580c', '遴选':'#ca8a04',
    '单一来源':'#16a34a', '直选':'#64748b', '简易工程':'#65a30d', '未设置':'#6b7280'
};
let procureBoardYear = '';

function procureBoardYears(projects) {
    return [...new Set(projects.map(project => project.year).filter(year => year !== null && year !== undefined && year !== ''))]
        .sort((left, right) => {
            const numericDifference = Number(right) - Number(left);
            return Number.isNaN(numericDifference)
                ? String(right).localeCompare(String(left), 'zh-CN', {numeric: true})
                : numericDifference;
        });
}

function sortProcureBoardProjects(projects) {
    return projects.slice().sort((left, right) => {
        const yearDifference = Number(right.year || 0) - Number(left.year || 0);
        if (yearDifference) return yearDifference;
        return String(right.number || '').localeCompare(String(left.number || ''), 'zh-CN', {numeric: true});
    });
}

function setProcureBoardYear(value) {
    procureBoardYear = String(value || '');
    renderProcureBoard(allProjects);
}

function scrollProcureBoard(direction) {
    const scroller = document.getElementById('procureBoardScroller');
    if (!scroller) return;
    const columns = [...scroller.querySelectorAll('.board-col')];
    if (!columns.length) return;
    const current = scroller.scrollLeft;
    const selected = scroller.querySelector('.board-col.is-active');
    let index = columns.indexOf(selected);
    if (index < 0) index = columns.findIndex(column => column.offsetLeft >= current - 8);
    if (index < 0) index = columns.length - 1;
    const targetIndex = Math.max(0, Math.min(columns.length - 1, index + (direction < 0 ? -1 : 1)));
    const target = columns[targetIndex];
    setActiveProcureBoardColumn(scroller, target);
    scroller.scrollTo({left: target.offsetLeft, behavior: 'smooth'});
}

function setActiveProcureBoardColumn(scroller, column) {
    if (!scroller || !column) return;
    [...scroller.children].forEach(item => item.classList?.toggle('is-active', item === column));
}

function initializeProcureBoardScroller(scroller) {
    if (!scroller || scroller.dataset.interactionsReady === '1') return;
    scroller.dataset.interactionsReady = '1';
    const firstColumn = scroller.querySelector('.board-col');
    if (firstColumn) setActiveProcureBoardColumn(scroller, firstColumn);
    scroller.addEventListener('click', event => {
        const column = event.target.closest?.('.board-col');
        if (column) setActiveProcureBoardColumn(scroller, column);
    });
    scroller.addEventListener('wheel', event => {
        if (Math.abs(event.deltaX) > Math.abs(event.deltaY) || !event.deltaY) return;
        const pointedColumn = event.target.closest?.('.board-col');
        if (pointedColumn) setActiveProcureBoardColumn(scroller, pointedColumn);
        const activeColumn = pointedColumn || scroller.querySelector('.board-col.is-active');
        const body = activeColumn?.querySelector?.('.board-col-body');
        if (!body || body.scrollHeight <= body.clientHeight) return;
        const before = body.scrollTop;
        body.scrollTop += event.deltaY;
        if (body.scrollTop !== before) event.preventDefault();
    }, {passive: false});

    let drag = null;
    scroller.addEventListener('pointerdown', event => {
        if (event.button !== 0 || event.target.closest('.procure-card,button,select,a,input,label')) return;
        drag = {pointerId: event.pointerId, startX: event.clientX, startLeft: scroller.scrollLeft};
        scroller.setPointerCapture?.(event.pointerId);
        scroller.classList.add('is-dragging');
    });
    scroller.addEventListener('pointermove', event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        scroller.scrollLeft = drag.startLeft - (event.clientX - drag.startX);
    });
    const finishDrag = event => {
        if (!drag || drag.pointerId !== event.pointerId) return;
        scroller.releasePointerCapture?.(event.pointerId);
        drag = null;
        scroller.classList.remove('is-dragging');
    };
    scroller.addEventListener('pointerup', finishDrag);
    scroller.addEventListener('pointercancel', finishDrag);
}

async function loadProcureBoard() {
    showViewLoading('procureBoardContent');
    try {
        const projects = allProjects.length ? allProjects : await api('GET', '/api/projects');
        if (!allProjects.length && projects.length) {
            allProjects = projects;
            rebuildProjectIndexes(allProjects);
            markSidebarDataChanged();
            renderSidebar();
        }
        renderProcureBoard(projects);
    } catch(e) {
        document.getElementById('procureBoardContent').innerHTML = `<div style="text-align:center;padding:40px;color:var(--danger)"><span data-ui-icon='❌'></span> 加载失败：${escHtml(e.message)}<br><button class="btn btn-secondary" onclick="loadProcureBoard()" style="margin-top:12px">重试</button></div>`;
    }
}

function procureCard(p) {
    const st = projectStatusInfo(p);
    const stageStr = p.current_stage_key ? projectStageDefinition(p.current_stage_key, p).name : '—';
    const isTerm = p.is_terminated;
    return `<div class="procure-card ${isTerm ? 'procure-card-term' : ''}" onclick="selectProject(${p.id})">
        <div class="pc-number">${escHtml(p.number)}</div>
        <div class="pc-name">${escHtml(p.name)}</div>
        <div class="pc-meta">
            <span class="mini-status ${st.cls}"><span data-ui-icon="${escHtml(st.icon)}"></span> ${st.text}</span>
            <span class="pc-progress" style="color:${getProgressColor(p.progress)}">${p.progress}%</span>
        </div>
        <div class="pc-stage"><span data-ui-icon='📍'></span> ${escHtml(stageStr)}</div>
        ${p.second_tender ? `<div class="pc-retender">↪ 二次招标：${escHtml(p.second_tender.number)}</div>` : ''}
    </div>`;
}

function renderProcureBoard(projects) {
    const years = procureBoardYears(projects);
    if (procureBoardYear && !years.some(year => String(year) === procureBoardYear)) procureBoardYear = '';
    const filteredProjects = sortProcureBoardProjects(projects.filter(project => !procureBoardYear || String(project.year) === procureBoardYear));
    // 按采购方式分组
    const groups = {};
    filteredProjects.forEach(p => {
        const m = (p.method || '').trim() || '未设置';
        (groups[m] = groups[m] || []).push(p);
    });
    // 列顺序：已知方式（仅显示有数据的）→ 其他未知方式 → 未设置
    const presentKnown = PROCURE_KNOWN.filter(m => groups[m] && groups[m].length);
    const others = Object.keys(groups).filter(m => !PROCURE_KNOWN.includes(m) && m !== '未设置');
    const order = [...presentKnown, ...others, ...(groups['未设置'] && groups['未设置'].length ? ['未设置'] : [])];

    const total = filteredProjects.length;
    const summary = `<div class="procure-summary">
        <span class="procure-chip procure-chip-all"><span data-ui-icon='📊'></span> 项目总数 <b>${total}</b></span>
        ${order.map(m => `<span class="procure-chip" style="border-color:${PROCURE_COLOR[m] || '#6b7280'}">
            <span class="method-dot" style="background:${PROCURE_COLOR[m] || '#6b7280'}"></span><span data-ui-icon="${escHtml(PROCURE_ICON[m] || '❓')}"></span> ${escHtml(m)} <b>${groups[m].length}</b>
        </span>`).join('')}
    </div>`;

    const cols = order.map(m => {
        const list = groups[m];
        const color = PROCURE_COLOR[m] || '#6b7280';
        const icon = PROCURE_ICON[m] || '❓';
        return `<div class="board-col" tabindex="0">
            <h3><span class="method-dot" style="background:${color}"></span><span data-ui-icon="${escHtml(icon)}"></span> ${escHtml(m)} <span class="col-count">${list.length}</span></h3>
            <div class="board-col-body">${list.map(procureCard).join('') || '<div class="col-empty">暂无项目</div>'}</div>
        </div>`;
    }).join('');

    const yearOptions = years.map(year => `<option value="${escHtml(String(year))}" ${String(year) === procureBoardYear ? 'selected' : ''}>${escHtml(String(year))}年</option>`).join('');
    const toolbar = `<div class="procure-board-toolbar">
        ${summary}
        <div class="procure-board-controls">
            <label for="procureBoardYearSelect">年份</label>
            <select id="procureBoardYearSelect" class="mini-select" onchange="setProcureBoardYear(this.value)">
                <option value="">全部年份</option>${yearOptions}
            </select>
        </div>
    </div>`;
    const empty = '<div class="empty-state" style="min-width:100%">该年份暂无项目</div>';
    const target = document.getElementById('procureBoardContent');
    target.innerHTML = toolbar + `<div class="procure-board-frame">
        <button class="procure-scroll-button procure-scroll-prev" type="button" title="上一栏" aria-label="上一栏" onclick="scrollProcureBoard(-1)">‹</button>
        <div id="procureBoardScroller" class="board-columns procure-board-scroll" tabindex="0">${cols || empty}</div>
        <button class="procure-scroll-button procure-scroll-next" type="button" title="下一栏" aria-label="下一栏" onclick="scrollProcureBoard(1)">›</button>
    </div>`;
    initializeProcureBoardScroller(document.getElementById('procureBoardScroller'));
}

// ── Calendar（月视图缓存） ──
function calendarCacheKey(year, month) {
    return `calendar:${year}-${String(month).padStart(2, '0')}`;
}

function calendarDefaultDate(data, year, month, preferredDate = '', today = todayISO()) {
    const datedCells = (data?.cells || []).filter(cell => !cell.empty && cell.date_str);
    if (!datedCells.length) return '';
    const monthPrefix = `${year}-${String(month).padStart(2, '0')}-`;
    if (preferredDate.startsWith(monthPrefix) && datedCells.some(cell => cell.date_str === preferredDate)) {
        return preferredDate;
    }
    if (today.startsWith(monthPrefix) && datedCells.some(cell => cell.date_str === today)) return today;
    return (datedCells.find(cell => (cell.events || []).length)?.date_str || datedCells[0].date_str);
}

function calendarAgendaHtml(dateStr, events = []) {
    if (!dateStr) return '<div class="calendar-agenda-empty">请选择日期查看项目节点</div>';
    const parts = dateStr.split('-').map(Number);
    const date = new Date(parts[0], parts[1] - 1, parts[2]);
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const title = `${parts[1]}月${parts[2]}日`;
    const subtitle = Number.isNaN(date.getTime()) ? '' : weekdays[date.getDay()];
    const header = `<div class="calendar-agenda-head">
        <div><strong>${title}</strong><span>${subtitle}</span></div>
        <span class="calendar-agenda-count">${events.length} 个节点</span>
    </div>`;
    if (!events.length) {
        return `${header}<div class="calendar-agenda-empty"><span><span data-ui-icon='✓'></span></span><strong>当天暂无项目节点</strong><small>可以选择其他有提示点的日期查看</small></div>`;
    }
    const items = events.map(event => {
        const projectId = Number(event.project_id);
        const canOpen = Number.isFinite(projectId);
        const stageName = escHtml(event.stage_name || '项目节点');
        const projectName = escHtml(event.project_name || event.name || '未命名项目');
        const projectNumber = escHtml(event.number || '');
        const icon = escHtml(event.icon || '📌');
        const time = event.planned_time ? `<time>${escHtml(event.planned_time)}</time>` : '<time>全天</time>';
        let statusClass = 'pending';
        if (event.skipped) statusClass = 'skipped';
        else if (event.completed) statusClass = 'done';
        return `<button type="button" class="calendar-agenda-item ${statusClass}" ${canOpen ? `onclick="selectProject(${projectId})"` : 'disabled'}>
            <span class="calendar-agenda-time">${time}<i></i></span>
            <span class="calendar-agenda-copy"><strong><span><span data-ui-icon="${escHtml(icon)}"></span></span>${stageName}</strong><span>${projectName}</span>${projectNumber ? `<small>${projectNumber}</small>` : ''}</span>
            <span class="calendar-agenda-arrow" aria-hidden="true">›</span>
        </button>`;
    }).join('');
    return `${header}<div class="calendar-agenda-list">${items}</div>`;
}

function selectCalendarDay(dateStr) {
    if (!calendarEventsByDate.has(dateStr)) return;
    calendarSelectedDate = dateStr;
    document.querySelectorAll('.calendar-cell[data-calendar-date]').forEach(cell => {
        const selected = cell.dataset.calendarDate === dateStr;
        cell.classList.toggle('selected', selected);
        cell.setAttribute('aria-pressed', selected ? 'true' : 'false');
    });
    const agenda = document.getElementById('calendarAgenda');
    if (agenda) agenda.innerHTML = calendarAgendaHtml(dateStr, calendarEventsByDate.get(dateStr) || []);
}

async function loadCalendar({force = false} = {}) {
    const requestedYear = calendarYear;
    const requestedMonth = calendarMonth;
    const key = calendarCacheKey(requestedYear, requestedMonth);
    let cached = readViewCache(key);
    document.getElementById('calendarTitle').textContent = `${requestedYear}年 ${requestedMonth}月`;
    if (cached && !force) {
        try { renderCalendar(cached.value, requestedYear, requestedMonth); }
        catch (error) { console.error('日历缓存显示失败，重新读取', error); invalidateViewCache(key); cached = null; force = true; }
    }
    if (!cached) renderViewSkeleton('calendarContent', '正在准备日历...');
    if (cached?.fresh && !force) return cached.value;
    try {
        const result = await requestViewData(key, () => (
            api('GET', `/api/calendar?year=${requestedYear}&month=${requestedMonth}`)
        ), {force});
        if (!result.accepted) return cached?.value || null;
        const data = result.value;
        if (calendarYear === requestedYear && calendarMonth === requestedMonth) {
            renderCalendar(data, requestedYear, requestedMonth);
        }
        writeViewCache(key, data);
        return data;
    } catch (error) {
        if (calendarYear !== requestedYear || calendarMonth !== requestedMonth) {
            return cached?.value || null;
        }
        console.error('日历数据刷新失败', error);
        if (cached) toast('日历数据刷新失败，已保留当前内容', 'warning');
        else renderViewLoadError('calendarContent', '日历加载失败', () => loadCalendar({force: true}), error);
        return cached?.value || null;
    }
}

function renderCalendar(data, year = calendarYear, month = calendarMonth) {
    if (calendarYear !== year || calendarMonth !== month) return;

    const weeks = [];
    let week = [];
    data.cells.forEach((c, i) => {
        week.push(c);
        if (week.length === 7 || i === data.cells.length - 1) {
            weeks.push(week);
            week = [];
        }
    });

    const today = todayISO();
    calendarEventsByDate = new Map(
        (data.cells || []).filter(cell => !cell.empty && cell.date_str)
            .map(cell => [cell.date_str, cell.events || []]),
    );
    calendarSelectedDate = calendarDefaultDate(data, year, month, calendarSelectedDate, today);
    let html = `<div class="calendar-layout"><div class="calendar-grid">
        <div class="calendar-weekdays">${data.weekday_names.map(d => `<span>${d}</span>`).join('')}</div>`;
    weeks.forEach(w => {
        html += '<div class="calendar-row">';
        w.forEach(c => {
            if (c.empty) {
                html += '<div class="calendar-cell empty"></div>';
            } else {
                const isToday = c.date_str === today;
                const isSelected = c.date_str === calendarSelectedDate;
                const events = c.events || [];
                const dots = events.slice(0, 3).map(event => {
                    let cls = 'pending';
                    if (event.skipped) cls = 'skipped';
                    else if (event.completed) cls = 'done';
                    return `<i class="${cls}"></i>`;
                }).join('');
                const count = events.length > 3 ? `<small>+${events.length - 3}</small>` : '';
                const cellEvents = events.slice(0, 3).map(event => {
                    let cls = 'pending';
                    if (event.skipped) cls = 'skipped';
                    else if (event.completed) cls = 'done';
                    const time = event.planned_time ? `<time>${escHtml(event.planned_time)}</time>` : '';
                    return `<span class="calendar-cell-event ${cls}"><i><span data-ui-icon="${escHtml(event.icon || '📌')}"></span></i>${time}<b>${escHtml(event.stage_name || '项目节点')}</b></span>`;
                }).join('');
                const label = `${c.day}日，${events.length ? `${events.length}个项目节点` : '无项目节点'}`;
                html += `<button type="button" class="calendar-cell${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${events.length ? ' has-events' : ''}"
                    data-calendar-date="${c.date_str}" aria-label="${label}" aria-pressed="${isSelected ? 'true' : 'false'}" onclick="selectCalendarDay('${c.date_str}')">
                    <span class="day-num">${c.day}</span>
                    <span class="calendar-cell-events">${cellEvents}${events.length > 3 ? `<small>还有 ${events.length - 3} 个节点</small>` : ''}</span>
                    <span class="calendar-event-dots">${dots}${count}</span>
                </button>`;
            }
        });
        html += '</div>';
    });
    html += `</div><aside class="calendar-agenda" id="calendarAgenda">${calendarAgendaHtml(calendarSelectedDate, calendarEventsByDate.get(calendarSelectedDate) || [])}</aside></div>`;
    document.getElementById('calendarContent').innerHTML = html;
}

function prevMonth() {
    calendarMonth--;
    if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; }
    loadCalendar();
}
function nextMonth() {
    calendarMonth++;
    if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; }
    loadCalendar();
}
function goToday() {
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth() + 1;
    calendarSelectedDate = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    loadCalendar();
}
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
    const html=`<div class="modal-form"><div class="form-grid-2"><div class="form-group"><label>类型</label><select id="clarType">${['澄清','更正','答疑','延期公告','其他'].map(v=>`<option ${x&&x.clarification_type===v?'selected':''}>${v}</option>`).join('')}</select></div><div class="form-group"><label>关联包号</label><select id="clarLot">${lotOptions}</select></div></div><div class="form-group"><label>标题 *</label><input id="clarTitle" value="${escHtml(x?x.title:'')}"></div><div class="form-group"><label>内容摘要</label><textarea id="clarContent" rows="3">${escHtml(x?x.content:'')}</textarea></div><div class="form-group"><label>发布日期</label><input type="date" id="clarPublish" value="${x&&x.publish_date?x.publish_date:''}"></div><label class="toggle-row" onclick="toggleClarDeadlineFields(event)"><div class="toggle-switch"><input type="checkbox" id="clarAffects" ${x&&x.affects_deadline?'checked':''} onclick="event.stopPropagation();toggleClarDeadlineFields(event)"><span class="toggle-slider"></span></div><span class="toggle-label">影响投标/开标截止时间</span></label><div id="clarDeadlineFields" style="display:${x&&x.affects_deadline?'grid':'none'}" class="form-grid-2"><div class="form-group"><label>原截止时间</label><input type="datetime-local" id="clarOriginal" value="${x&&x.original_deadline?x.original_deadline:(opening&&opening.planned_at||'')}"></div><div class="form-group"><label>调整后时间</label><input type="datetime-local" id="clarNew" value="${x&&x.new_deadline?x.new_deadline:''}"><small>保存后同步更新开标计划时间</small></div></div><div class="form-group"><label>已通知供应商/通知范围</label><textarea id="clarNotified" rows="2" placeholder="可填写全部报名供应商或具体单位">${escHtml(x?x.notified_suppliers:'')}</textarea></div><div class="form-group"><label>附件</label><input type="file" id="clarFiles" multiple accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.rar,.eml"></div><div class="form-group"><label>备注</label><textarea id="clarNotes" rows="2">${escHtml(x?x.notes:'')}</textarea></div></div>`;
    showModal(id?'编辑澄清/更正':'新增澄清/更正',html,async()=>{const affects=document.getElementById('clarAffects').checked;const data={clarification_type:document.getElementById('clarType').value,lot_id:document.getElementById('clarLot').value||null,title:document.getElementById('clarTitle').value.trim(),content:document.getElementById('clarContent').value.trim(),publish_date:document.getElementById('clarPublish').value||null,affects_deadline:affects,original_deadline:affects?(document.getElementById('clarOriginal').value||null):null,new_deadline:affects?(document.getElementById('clarNew').value||null):null,notified_suppliers:document.getElementById('clarNotified').value.trim(),notes:document.getElementById('clarNotes').value.trim()};if(!data.title){toast('请填写标题','warning');return false;}if(affects&&!data.new_deadline){toast('请填写调整后时间','warning');return false;}const saved=savedId?await api('PUT',`/api/projects/${p.id}/clarifications/${savedId}`,data):await api('POST',`/api/projects/${p.id}/clarifications`,data);savedId=saved.id || savedId;const files=document.getElementById('clarFiles').files;if(files.length)await uploadClarificationFiles(savedId,files,p.id);if(currentProject?.id!==p.id)return;closeModal();await refreshProject();reopenStageModule('clarification');});
}
function toggleClarDeadlineFields(evt){const cb=document.getElementById('clarAffects');if(evt&&evt.target!==cb)cb.checked=!cb.checked;document.getElementById('clarDeadlineFields').style.display=cb.checked?'grid':'none';}
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
// ── Procurement Command Center ──
function commandStageDate(stage) {
    if (!stage) return '';
    return stage.planned_at || stage.planned_datetime || stage.planned_date || '';
}

function commandDateOnly(value) {
    if (!value) return null;
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
}

function commandDateOrdinal(value) {
    if (!value) return null;
    const text = typeof value === 'string' ? value : String(value);
    if (text.length < 10 || text.charCodeAt(4) !== 45 || text.charCodeAt(7) !== 45) return null;
    const y0 = text.charCodeAt(0) - 48;
    const y1 = text.charCodeAt(1) - 48;
    const y2 = text.charCodeAt(2) - 48;
    const y3 = text.charCodeAt(3) - 48;
    const m0 = text.charCodeAt(5) - 48;
    const m1 = text.charCodeAt(6) - 48;
    const d0 = text.charCodeAt(8) - 48;
    const d1 = text.charCodeAt(9) - 48;
    if ([y0, y1, y2, y3, m0, m1, d0, d1].some(digit => digit < 0 || digit > 9)) return null;
    let year = y0 * 1000 + y1 * 100 + y2 * 10 + y3;
    const month = m0 * 10 + m1;
    const day = d0 * 10 + d1;
    if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (day > daysInMonth[month - 1]) return null;
    year -= month <= 2 ? 1 : 0;
    const era = Math.floor(year / 400);
    const yearOfEra = year - era * 400;
    const monthPrime = month + (month > 2 ? -3 : 9);
    const dayOfYear = Math.floor((153 * monthPrime + 2) / 5) + day - 1;
    return era * 146097 + yearOfEra * 365 + Math.floor(yearOfEra / 4)
        - Math.floor(yearOfEra / 100) + dayOfYear;
}

function commandTodayOrdinal(now) {
    const month = now.getMonth() + 1;
    const value = `${String(now.getFullYear()).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    return commandDateOrdinal(value);
}

function commandDayDifference(value, now = new Date(), todayOrdinal = commandTodayOrdinal(now)) {
    const targetOrdinal = commandDateOrdinal(value);
    return targetOrdinal === null ? null : targetOrdinal - todayOrdinal;
}

function commandDeadline(value) {
    if (!value) return null;
    const match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!match || commandDateOrdinal(match[0]) === null) return null;
    const hasTime = match[4] !== undefined;
    const hour = hasTime ? Number(match[4]) : 23;
    const minute = hasTime ? Number(match[5]) : 59;
    const second = hasTime && match[6] !== undefined ? Number(match[6]) : hasTime ? 0 : 59;
    if (hour > 23 || minute > 59 || second > 59) return null;
    const date = new Date(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        hour,
        minute,
        second,
        hasTime ? 0 : 999,
    );
    return Number.isNaN(date.getTime()) ? null : date;
}

function commandCountdownParts(value, now = new Date()) {
    const deadline = commandDeadline(value);
    if (!deadline) return null;
    const delta = deadline.getTime() - now.getTime();
    const overdue = delta < 0;
    let secondsRemaining = Math.floor(Math.abs(delta) / 1000);
    const days = Math.floor(secondsRemaining / 86400);
    secondsRemaining -= days * 86400;
    const hours = Math.floor(secondsRemaining / 3600);
    secondsRemaining -= hours * 3600;
    const minutes = Math.floor(secondsRemaining / 60);
    const seconds = secondsRemaining - minutes * 60;
    return {overdue, days, hours, minutes, seconds};
}

function commandCountdownLabel(parts) {
    if (!parts) return '尚未设置计划时间';
    const prefix = parts.overdue ? '已逾期' : '距离计划节点';
    return `${prefix} ${parts.days} 天 ${parts.hours} 小时 ${parts.minutes} 分 ${parts.seconds} 秒`;
}

let commandCenterModelCache = {
    projects: null,
    version: null,
    dateKey: '',
    timeKey: '',
    statsKey: '',
    model: null,
};

function invalidateCommandCenterData() {
    commandCenterModelCache = {
        projects: null,
        version: null,
        dateKey: '',
        timeKey: '',
        statsKey: '',
        model: null,
    };
    if (typeof commandSearchCache !== 'undefined') {
        commandSearchCache = {projects: null, version: null, entries: null};
    }
}

function rankCommandActions(projects, now = new Date()) {
    const todayOrdinal = commandTodayOrdinal(now);
    const dateOrdinals = new Map();
    const actionsByDay = new Map();
    const orderedProjects = (projects || [])
        .filter(project => !project.is_terminated && Number(project.progress || 0) < 100)
        .slice()
        .sort((left, right) => {
            const leftNumber = String(left.number || '');
            const rightNumber = String(right.number || '');
            return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
        });
    orderedProjects.forEach(project => {
        (project.stages || []).forEach(stage => {
            const plannedAt = commandStageDate(stage);
            if (stage.completed || stage.skipped || !plannedAt) return;
            if (!dateOrdinals.has(plannedAt)) dateOrdinals.set(plannedAt, commandDateOrdinal(plannedAt));
            const targetOrdinal = dateOrdinals.get(plannedAt);
            if (targetOrdinal === null) return;
            const plannedText = String(plannedAt);
            const hasTime = plannedText.length > 10;
            const deadline = hasTime ? commandDeadline(plannedText) : null;
            if (hasTime && !deadline) return;
            const days = targetOrdinal - todayOrdinal;
            const overdueByTime = days === 0 && deadline && deadline.getTime() < now.getTime();
            const urgency = overdueByTime || days < 0 ? 'overdue' : days === 0 ? 'today' : days <= 7 ? 'soon' : 'later';
            const bucket = actionsByDay.get(days) || [];
            bucket.push({
                projectId: project.id,
                projectNumber: project.number || '',
                projectName: project.name || '',
                stageKey: stage.key || stage.stage_key || '',
                stageName: stage.name || '',
                plannedAt,
                deadlineAt: deadline ? deadline.getTime() : Number.POSITIVE_INFINITY,
                days,
                urgency,
            });
            if (!actionsByDay.has(days)) actionsByDay.set(days, bucket);
        });
    });
    const actions = [];
    Array.from(actionsByDay.keys()).sort((left, right) => left - right).forEach(days => {
        const bucket = actionsByDay.get(days);
        bucket.sort((left, right) => {
            const urgencyOrder = {overdue: 0, today: 1, soon: 2, later: 3};
            const urgencyDifference = urgencyOrder[left.urgency] - urgencyOrder[right.urgency];
            if (urgencyDifference) return urgencyDifference;
            return left.deadlineAt - right.deadlineAt;
        });
        actions.push(...bucket);
    });
    return actions;
}

function commandCenterInsights(projects, actions = null) {
    const source = projects || [];
    const ranked = actions || rankCommandActions(source);
    const methods = {};
    const stageCounts = {};
    const overdueIds = new Set(
        ranked.filter(item => item.urgency === 'overdue').map(item => item.projectId),
    );
    source.forEach(project => {
        const method = String(project.method || '未设置');
        methods[method] = (methods[method] || 0) + 1;
        if (!project.is_terminated && Number(project.progress || 0) < 100) {
            const stage = project.current_stage_key || 'unassigned';
            stageCounts[stage] = (stageCounts[stage] || 0) + 1;
        }
    });
    return {
        methods,
        stageCounts,
        riskProjects: source.filter(project => (
            overdueIds.has(project.id)
            || project.challenge_state === '质疑中'
            || project.challenge_state === '投诉中'
        )),
    };
}

function projectIsUnopened(project, settings = (typeof systemSettings !== 'undefined' ? systemSettings : null)) {
    if (!project || project.is_terminated || Number(project.progress || 0) >= 100) return false;
    let openingStageId = '';
    const method = String(project.method || '');
    if (settings?.stage_templates && typeof normalizeClientStageTemplates === 'function') {
        const templates = normalizeClientStageTemplates(settings.stage_templates, settings);
        const definition = (templates[method] || []).find(stage => (stage.modules || []).includes('bid_opening'));
        openingStageId = String(definition?.id || '');
    }
    const openingStage = (project.stages || []).find(stage => {
        const key = String(stage.stage_key || stage.key || '');
        return (openingStageId && key === openingStageId) || (stage.modules || []).includes('bid_opening');
    });
    return Boolean(openingStage && !openingStage.completed && !openingStage.skipped && !openingStage.template_removed);
}

function commandCenterModel(projects, stats, now = new Date()) {
    const source = projects || [];
    const version = typeof sidebarDataVersion === 'number' ? sidebarDataVersion : source;
    const dateKey = [
        now.getFullYear(),
        String(now.getMonth() + 1).padStart(2, '0'),
        String(now.getDate()).padStart(2, '0'),
    ].join('-');
    const timeKey = `${dateKey}T${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
    const statsKey = [stats?.total ?? '', stats?.in_progress ?? '', stats?.completed ?? ''].join('|');
    if (
        commandCenterModelCache.projects === source
        && commandCenterModelCache.version === version
        && commandCenterModelCache.dateKey === dateKey
        && commandCenterModelCache.timeKey === timeKey
        && commandCenterModelCache.statsKey === statsKey
    ) {
        return commandCenterModelCache.model;
    }
    const active = source.filter(project => (
        !project.is_terminated && Number(project.progress || 0) < 100
    ));
    const completed = source.filter(project => (
        !project.is_terminated && Number(project.progress || 0) >= 100
    ));
    const unopenedProjects = active.filter(project => projectIsUnopened(project));
    const actions = rankCommandActions(source, now);
    const model = {
        metrics: {
            total: Number(stats?.total ?? source.length),
            active: Number(stats?.in_progress ?? active.length),
            overdue: actions.filter(item => item.urgency === 'overdue').length,
            dueSoon: actions.filter(item => item.urgency === 'soon' || item.urgency === 'today').length,
            completed: Number(stats?.completed ?? completed.length),
            unopened: unopenedProjects.length,
        },
        actions,
        activeProjects: active,
        unopenedProjects,
        insights: commandCenterInsights(source, actions),
    };
    commandCenterModelCache = {projects: source, version, dateKey, timeKey, statsKey, model};
    return model;
}

function commandUrgencyLabel(item) {
    if (item.urgency === 'overdue') return `逾期 ${Math.abs(item.days)} 天`;
    if (item.urgency === 'today') return '今天到期';
    if (item.urgency === 'soon') return `${item.days} 天后到期`;
    return `计划 ${item.plannedAt}`;
}

function renderPriorityAction(item) {
    return `<button type="button" class="command-action-row urgency-${item.urgency}" data-command-action="open-project-stage" data-project-id="${escHtml(String(item.projectId ?? ''))}" data-stage-key="${escHtml(String(item.stageKey ?? ''))}">
        <span class="command-action-signal" aria-hidden="true"></span>
        <span class="command-action-copy">
            <strong>${escHtml(item.stageName || '待处理阶段')}</strong>
            <small>${escHtml(item.projectNumber)} · ${escHtml(item.projectName)}</small>
        </span>
        <span class="command-action-time">${escHtml(commandUrgencyLabel(item))}</span>
        <span class="command-action-arrow" aria-hidden="true">→</span>
    </button>`;
}

function renderInsightBreakdown(insights) {
    const methodEntries = Object.entries(insights.methods).sort((left, right) => right[1] - left[1]);
    const methodMax = Math.max(1, ...methodEntries.map(entry => entry[1]));
    return `<div class="command-insight-list">
        ${methodEntries.slice(0, 6).map(([name, count]) => `<button type="button" class="command-insight-row" data-command-action="switch-view" data-view="procure" aria-label="${escHtml(`${name}：${count} 个项目`)}">
            <span>${escHtml(name)}</span>
            <i><b style="width:${Math.round(count / methodMax * 100)}%"></b></i>
            <strong class="command-insight-count">${count}</strong>
        </button>`).join('') || '<div class="command-empty">暂无采购方式数据</div>'}
    </div>`;
}

// 有效关键节点：未删除/未取消/未完成/未关闭，时间可解析，且未过期（过期节点不再进入轮播队列）。
// 返回按截止时间升序排列的节点列表。
function collectKeyNodes(projects, now = new Date()) {
    const collected = [];
    (projects || []).forEach(project => {
        if (!project || project.is_terminated || Number(project.progress || 0) >= 100) return;
        (project.stages || []).forEach(stage => {
            if (!stage) return;
            const isGone = stage.deleted || stage.is_deleted || stage.cancelled || stage.is_cancelled;
            if (isGone || stage.completed || stage.skipped) return;
            const status = String(stage.status || stage.state || '');
            if (status === 'completed' || status === 'closed' || status === 'cancelled' || status === 'deleted') return;
            const plannedAt = commandStageDate(stage);
            const deadline = commandDeadline(plannedAt);
            if (!deadline) {
                if (typeof console !== 'undefined' && console.warn) {
                    console.warn(`[倒计时] 忽略无法解析的计划时间: ${String(plannedAt || '(空)')} (项目 ${project.name || project.id}, 阶段 ${stage.name || stage.key || ''})`);
                }
                return;
            }
            if (deadline.getTime() - now.getTime() < 0) return;
            collected.push({
                projectId: project.id,
                projectName: project.name || '',
                projectNumber: project.number || '',
                stageKey: stage.key || stage.stage_key || '',
                stageName: stage.name || '',
                plannedAt,
                delta: deadline.getTime() - now.getTime(),
            });
        });
    });
    collected.sort((left, right) => left.delta - right.delta);
    return collected;
}

function pickNearestKeyNode(projects, now = new Date()) {
    return collectKeyNodes(projects, now)[0] || null;
}

function renderNearestNodeCountdown(node, now = new Date()) {
    if (!node) return '<div class="command-node-empty">暂无待处理关键节点</div>';
    const parts = commandCountdownParts(node.plannedAt, now);
    const overdue = parts ? parts.overdue : false;
    if (!parts) return '<div class="command-node-empty">暂无待处理关键节点</div>';
    // 未逾期：显示真实剩余时间（可能正在减少）；逾期：按需求固定为 00:00:00 + “已逾期”
    const display = overdue
        ? {days: 0, hours: 0, minutes: 0, seconds: 0}
        : {days: parts.days, hours: parts.hours, minutes: parts.minutes, seconds: parts.seconds};
    const countdown = `<strong class="${overdue ? 'is-overdue' : ''}" role="timer" aria-label="${escHtml(commandCountdownLabel(parts))}"><b data-countdown-unit="days">${display.days}</b><small>天</small><b data-countdown-unit="hours">${String(display.hours).padStart(2, '0')}</b><small>时</small><b data-countdown-unit="minutes">${String(display.minutes).padStart(2, '0')}</b><small>分</small><b data-countdown-unit="seconds">${String(display.seconds).padStart(2, '0')}</b><small>秒</small></strong>`;
    const overdueBadge = overdue ? '<span class="command-node-status is-overdue">已逾期</span>' : '';
    return `<div class="command-node-countdown" data-command-deadline="${escHtml(String(node.plannedAt ?? ''))}" data-command-node-project="${escHtml(String(node.projectId ?? ''))}" data-command-node-stage="${escHtml(String(node.stageKey ?? ''))}">
        <div class="command-node-time">${countdown}${overdueBadge}</div>
        <div class="command-node-meta">
            <strong class="command-node-name" title="${escHtml(node.projectName || '')}">${escHtml(node.projectName || '未命名项目')}</strong>
            <span class="command-node-number">${escHtml(node.projectNumber || '—')}</span>
        </div>
        <span class="command-node-watermark" aria-hidden="true">${escHtml(node.stageName || '')}</span>
    </div>`;
}

function renderActiveProjectList(projects, emptyText = '暂无进行中项目') {
    const source = projects || [];
    if (!source.length) return `<div class="command-empty">${escHtml(emptyText)}</div>`;
    const groups = new Map();
    source.forEach(project => {
        const method = String(project.method || '未设置');
        if (!groups.has(method)) groups.set(method, []);
        groups.get(method).push(project);
    });
    const preferred = typeof METHODS !== 'undefined' ? METHODS : [];
    const order = [...preferred.filter(method => groups.has(method)), ...[...groups.keys()].filter(method => !preferred.includes(method))];
    let remaining = 12;
    const rows = order.map(method => {
        const items = groups.get(method).slice(0, remaining);
        remaining -= items.length;
        if (!items.length) return '';
        return `<section class="command-project-group"><h4><span>${escHtml(method)}</span><b>${groups.get(method).length}</b></h4>${items.map(p => `<button type="button" class="command-project-row" data-command-action="select-project" data-project-id="${escHtml(String(p.id ?? ''))}" title="点击查看项目详情">
        <span class="command-project-dot" style="background:${escHtml(projectColor(p))}"></span>
        <span class="command-project-copy"><strong>${escHtml(p.name || '未命名项目')}</strong><small>${escHtml(p.number || '—')} · ${escHtml(p.method || '未设置')} · ${Number(p.progress || 0)}%</small></span>
        <i aria-hidden="true">→</i>
    </button>`).join('')}</section>`;
    }).join('');
    const more = source.length > 12
        ? `<button type="button" class="command-project-more" data-command-action="switch-view" data-view="procure">查看全部 ${source.length} 个项目 →</button>`
        : '';
    return rows + more;
}

function renderCommandCenterDashboard(model, now = new Date()) {
    const queue = model.actions.slice(0, 6);
    const riskProjects = model.insights.riskProjects.slice(0, 5);
    const unopenedProjects = model.unopenedProjects || [];
    const focus = pickNearestKeyNode(typeof allProjects !== 'undefined' ? allProjects : [], now);
    return `<div class="command-dashboard command-dashboard-enter">
        <header class="command-page-intro">
            <div>
                <h2>采购项目总览</h2>
                <p>查看待办事项、项目进度和临近节点。</p>
            </div>
            <div class="command-page-actions">
                <button class="btn btn-secondary" data-command-action="batch-advance">批量推进</button>
                <button class="btn btn-secondary" data-command-action="import-projects">导入项目</button>
                <button class="btn btn-secondary" data-command-action="export">导出项目</button>
                <button class="btn btn-primary" data-command-action="new-project">＋ 新建项目</button>
            </div>
        </header>

        <section class="command-overview-grid">
            <article class="command-node-card" data-command-node-card>
                <i class="command-node-accent" aria-hidden="true"></i>
                <header class="command-node-head">
                    <div class="command-node-title"><span class="command-node-dot" aria-hidden="true"></span>最近关键节点倒计时</div>
                    <div class="command-node-head-right">
                        ${focus ? `<span class="command-node-tag" title="${escHtml(focus.stageName || '')}">${escHtml(focus.stageName || '关键节点')}</span>` : ''}
                        <button type="button" class="command-node-next" data-command-node-next title="切换到下一个关键节点" ${focus ? '' : 'disabled'}>下一个 →</button>
                    </div>
                </header>
                <div class="command-node-body">${renderNearestNodeCountdown(focus, new Date())}</div>
            </article>
            <div class="command-metric-grid">
                <button type="button" class="command-metric" data-command-action="switch-view" data-view="procure"><span>进行中</span><strong>${model.metrics.active}</strong></button>
                <button type="button" class="command-metric info" data-command-action="switch-view" data-view="procure"><span>未开标项目</span><strong>${model.metrics.unopened}</strong></button>
                <button type="button" class="command-metric warning" data-command-action="switch-view" data-view="calendar"><span>7 天内节点</span><strong>${model.metrics.dueSoon}</strong></button>
                <button type="button" class="command-metric danger" data-command-action="switch-view" data-view="calendar"><span>逾期事项</span><strong>${model.metrics.overdue}</strong></button>
                <button type="button" class="command-metric positive" data-command-action="switch-view" data-view="procure"><span>已完成</span><strong>${model.metrics.completed}</strong></button>
            </div>
        </section>

        <section class="command-content-grid">
            <article class="command-panel command-project-panel">
                <div class="command-panel-head"><div><span>进行中项目</span><small>点击任意项目进入详情</small></div><b>${model.activeProjects.length}</b></div>
                <div class="command-project-list">${renderActiveProjectList(model.activeProjects)}</div>
            </article>
            <article class="command-panel command-project-panel command-unopened-panel">
                <div class="command-panel-head"><div><span>未开标项目</span><small>按采购方式分类，点击任意项目进入详情</small></div><b>${unopenedProjects.length}</b></div>
                <div class="command-project-list">${renderActiveProjectList(unopenedProjects, '暂无未开标项目')}</div>
            </article>
            <article class="command-panel command-action-queue">
                <div class="command-panel-head"><div><span>待办节点</span><small>按紧急程度自动排序</small></div></div>
                <div class="command-action-list">${queue.map(renderPriorityAction).join('') || '<div class="command-empty">暂无待处理计划节点</div>'}</div>
            </article>
            <article class="command-panel command-risk-panel">
                <div class="command-panel-head"><div><span>风险事项</span><small>逾期、质疑与投诉</small></div><b>${riskProjects.length}</b></div>
                <div class="command-risk-list">${riskProjects.map(project => `<button type="button" data-command-action="select-project" data-project-id="${escHtml(String(project.id ?? ''))}">
                    <span class="command-risk-dot"></span><span><strong>${escHtml(project.name)}</strong><small>${escHtml(project.number || '')} · ${escHtml(project.challenge_state || '存在逾期节点')}</small></span><i>→</i>
                </button>`).join('') || '<div class="command-empty command-empty-positive">未发现高优先级风险</div>'}</div>
            </article>
            <article class="command-panel command-insight-panel">
                <div class="command-panel-head"><div><span>采购方式分布</span><small>点击进入项目中心</small></div><b>${model.metrics.total}</b></div>
                ${renderInsightBreakdown(model.insights)}
            </article>
        </section>
    </div>`;
}

function buildProjectNextActions(project, currentStage) {
    if (!project || project.is_terminated || Number(project.progress || 0) >= 100) return [];
    const actions = [];
    if (currentStage) {
        actions.push({
            kind: 'complete-stage',
            stageKey: currentStage.key || currentStage.stage_key || '',
            label: `处理${currentStage.name || '当前阶段'}`,
        });
        if (!commandStageDate(currentStage)) {
            actions.push({
                kind: 'schedule-stage',
                stageKey: currentStage.key || currentStage.stage_key || '',
                label: '设置计划日期',
            });
        }
    }
    return actions.slice(0, 3);
}

function projectRiskSummary(project, now = new Date()) {
    const risks = [];
    if (project?.challenge_state) risks.push(project.challenge_state);
    const overdue = (project?.stages || []).filter(stage => (
        !stage.completed && !stage.skipped
        && commandDayDifference(commandStageDate(stage), now) < 0
    )).length;
    if (overdue) risks.push(`${overdue} 个逾期节点`);
    if (!project?.prepare_owner && !project?.review_owner) risks.push('关键负责人待补充');
    return risks;
}

function projectWorkspaceModel(project) {
    const stages = orderProjectStages(project?.stages);
    const currentStage = stages.find(stage => (
        (stage.key || stage.stage_key) === project?.current_stage_key
    )) || stages.find(stage => !stage.completed && !stage.skipped) || null;
    return {
        project,
        stages,
        currentStage,
        nextActions: buildProjectNextActions(project, currentStage),
        risk: projectRiskSummary(project),
    };
}

function renderProjectIdentity(project) {
    const status = project.is_terminated ? '已关闭' : Number(project.progress || 0) >= 100 ? '已完成' : '进行中';
    return `<div class="project-command-identity">
        <div>
            <h2>${escHtml(project.name || '')}</h2>
            <p>${escHtml(project.number || '')} · ${escHtml(project.method || '未设置采购方式')} · ${escHtml(project.purchaser || '未设置采购人')}</p>
        </div>
        <div class="project-command-progress">
            <span>${escHtml(status)}</span><strong>${Number(project.progress || 0)}%</strong>
            <i><b style="width:${Math.max(0, Math.min(100, Number(project.progress || 0)))}%"></b></i>
        </div>
    </div>`;
}

function renderStageRail(model) {
    const currentKey = model.currentStage?.key || model.currentStage?.stage_key || '';
    return `<div class="project-stage-rail" aria-label="项目阶段轨道">
        ${model.stages.map((stage, index) => {
            const key = stage.key || stage.stage_key || '';
            const state = stage.skipped ? 'skipped' : stage.completed ? 'done' : key === currentKey ? 'current' : 'pending';
            return `<button type="button" class="project-stage-node ${state}" data-command-action="open-stage" data-stage-key="${escHtml(String(key))}" title="${escHtml(stage.name || '')}">
                <span>${stage.completed ? '✓' : stage.skipped ? '–' : index + 1}</span>
                <small>${escHtml(stage.name || '')}</small>
            </button>`;
        }).join('')}
    </div>`;
}

function renderProjectActionStrip(model) {
    const riskText = model.risk.length ? model.risk.join(' · ') : '当前未发现高优先级风险';
    return `<div class="project-command-summary">
        <div class="project-command-now">
            <span>当前行动</span>
            <strong>${escHtml(model.currentStage?.name || '项目已完成')}</strong>
            <small>${escHtml(riskText)}</small>
        </div>
        <div class="project-command-actions">
            ${model.nextActions.map((action, index) => `<button type="button" class="btn ${index === 0 ? 'btn-primary' : 'btn-secondary'}" data-command-action="${action.stageKey ? 'open-stage' : 'switch-project-tab'}" ${action.stageKey ? `data-stage-key="${escHtml(String(action.stageKey))}"` : 'data-tab="tasks"'}>${escHtml(action.label)}</button>`).join('')}
            <button type="button" class="btn btn-secondary project-overview-toggle" data-command-action="toggle-project-overview" aria-expanded="false">展开概览</button>
        </div>
    </div>`;
}

function toggleProjectQuickOverview(control) {
    const body = control?.closest?.('.project-command-workspace')?.querySelector?.('.project-quick-overview');
    if (!body) return false;
    const expanded = control.getAttribute('aria-expanded') !== 'true';
    control.setAttribute('aria-expanded', String(expanded));
    control.textContent = expanded ? '收起概览' : '展开概览';
    body.hidden = !expanded;
    return expanded;
}

function mountProjectWorkspace(project) {
    const tabs = document.getElementById('projectTabs');
    if (!tabs?.parentNode) return;
    let workspace = document.getElementById('commandProjectWorkspace');
    if (!workspace) {
        workspace = document.createElement('section');
        workspace.id = 'commandProjectWorkspace';
        workspace.className = 'project-command-workspace';
        tabs.parentNode.insertBefore(workspace, tabs);
    }
    const model = projectWorkspaceModel(project);
    const supplierRiskBanner = typeof renderSupplierRiskBanner === 'function' ? renderSupplierRiskBanner(project) : '';
    const supplierRows = typeof renderLotSupplierRows === 'function' ? renderLotSupplierRows(project) : '';
    workspace.innerHTML = `${renderProjectActionStrip(model)}<div class="project-quick-overview" hidden>${supplierRiskBanner}${renderStageRail(model)}${supplierRows}</div>`;
    if (typeof applyStableVisualSemantics === 'function') applyStableVisualSemantics(workspace);
}

let commandPaletteReturnFocus = null;
let commandSearchCache = {projects: null, version: null, entries: null};

function trapModalFocus(event, container) {
    if (event.key !== 'Tab') return;
    const controls = Array.from(container.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
    ));
    if (!controls.length) return;
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (controls.length === 1
        || (event.shiftKey && document.activeElement === first)
        || (!event.shiftKey && document.activeElement === last)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
    }
}

function focusSafely(target) {
    if (!target || typeof target.focus !== 'function' || target.isConnected === false) return false;
    for (let node = target; node; node = node.parentElement) {
        if (
            node.isConnected === false
            || node.disabled === true
            || node.hidden === true
            || node.inert === true
            || node.hasAttribute?.('disabled')
            || node.hasAttribute?.('hidden')
            || node.hasAttribute?.('inert')
            || node.getAttribute?.('aria-disabled') === 'true'
            || node.getAttribute?.('aria-hidden') === 'true'
        ) return false;
        if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
            const style = window.getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') {
                return false;
            }
        }
    }
    try {
        target.focus();
    } catch (error) {
        return false;
    }
    return document.activeElement === target;
}

function focusFallback(excludedOverlay = null) {
    const selector = 'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])';
    const overlay = document.getElementById('commandPalette');
    if (overlay && overlay !== excludedOverlay && overlay.classList.contains('open')) {
        const controls = Array.from(overlay.querySelectorAll?.(selector) || []);
        if (controls.some(control => focusSafely(control))) return true;
    }
    if (focusSafely(document.querySelector?.('.nav-item.active'))) return true;
    const focusTemporary = target => {
        if (!target) return false;
        const hadTabIndex = target.hasAttribute?.('tabindex') || false;
        if (!hadTabIndex) target.setAttribute?.('tabindex', '-1');
        const focused = focusSafely(target);
        if (!hadTabIndex) target.removeAttribute?.('tabindex');
        return focused;
    };
    if (focusTemporary(document.querySelector?.('.view.active'))) return true;
    return focusTemporary(document.getElementById('app'));
}

function enhancePrimaryNavigation() {
    document.querySelector('.command-global-rail')?.remove();
    const versionBadge = document.querySelector('.logo span');
    versionBadge?.remove();
    document.querySelector('#view-dashboard > .view-header')?.remove();
}

function ensureCommandPalette() {
    if (document.getElementById('commandPalette')) return;
    const overlay = document.createElement('div');
    overlay.id = 'commandPalette';
    overlay.className = 'command-palette-overlay';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.innerHTML = `
        <section class="command-palette" role="dialog" aria-modal="true" aria-label="搜索与命令">
            <div class="command-palette-search">
                <span aria-hidden="true">⌕</span>
                <input id="commandPaletteInput" autocomplete="off" placeholder="搜索项目、编号、采购人或命令" aria-label="搜索项目或命令">
                <kbd>Esc</kbd>
            </div>
            <div id="commandPaletteResults" class="command-palette-results"></div>
            <button class="command-palette-close" type="button" aria-label="关闭命令面板">关闭</button>
        </section>`;
    overlay.addEventListener('click', event => {
        if (event.target === overlay || event.target.closest('.command-palette-close')) {
            closeCommandPalette();
            return;
        }
        const item = event.target.closest('[data-command-entry]');
        if (!item) return;
        runCommandPaletteEntry(item.dataset.commandType, item.dataset.commandValue);
    });
    overlay.querySelector('input').addEventListener('input', event => {
        filterCommandPalette(event.target.value);
    });
    overlay.addEventListener('keydown', event => trapModalFocus(event, overlay));
    document.body.appendChild(overlay);
}

function commandPaletteEntries() {
    const commands = [
        {type: 'view', value: 'dashboard', title: '打开项目总览', meta: '工作区'},
        {type: 'view', value: 'procure', title: '打开项目中心', meta: '工作区'},
        {type: 'view', value: 'calendar', title: '打开采购日历', meta: '工作区'},
        {type: 'import', value: 'projects', title: '导入项目', meta: '操作'},
        {type: 'new', value: 'project', title: '新建项目', meta: '操作'},
    ];
    const projectSource = typeof allProjects === 'undefined' ? [] : allProjects;
    const projects = commandSearchIndex(projectSource).map(entry => ({
        type: 'project',
        value: String(entry.project.id),
        title: entry.project.name || '',
        meta: `${entry.project.number || ''} · ${entry.project.purchaser || '未设置采购人'}`,
    }));
    return [...commands, ...projects];
}

function commandSearchIndex(projects) {
    const source = projects || [];
    const version = typeof sidebarDataVersion === 'number' ? sidebarDataVersion : source;
    if (commandSearchCache.projects === source && commandSearchCache.version === version) {
        return commandSearchCache.entries;
    }
    const entries = source.map(project => ({
        project,
        normalized: projectSearchById.get(Number(project.id)) || projectSearchText(project),
    }));
    commandSearchCache = {projects: source, version, entries};
    return entries;
}

function filterCommandPalette(query = '') {
    const results = document.getElementById('commandPaletteResults');
    if (!results) return [];
    const normalized = String(query).trim().toLocaleLowerCase();
    const matches = commandPaletteEntries().filter(entry => (
        !normalized || `${entry.title} ${entry.meta}`.toLocaleLowerCase().includes(normalized)
    )).slice(0, 12);
    results.innerHTML = matches.length ? matches.map((entry, index) => `
        <button type="button" class="command-palette-item ${index === 0 ? 'active' : ''}"
            data-command-entry data-command-type="${entry.type}" data-command-value="${escHtml(entry.value)}">
            <span><strong>${escHtml(entry.title)}</strong><small>${escHtml(entry.meta)}</small></span>
            <kbd>↵</kbd>
        </button>`).join('') : '<div class="command-palette-empty">没有匹配的项目或命令</div>';
    return matches;
}

function runCommandPaletteEntry(type, value) {
    closeCommandPalette();
    if (type === 'project') selectProject(Number(value));
    else if (type === 'view') switchView(value);
    else if (type === 'new') showNewProjectModal();
    else if (type === 'import') showProjectImportDialog();
}

function openCommandPalette(query = '') {
    ensureCommandPalette();
    const overlay = document.getElementById('commandPalette');
    const input = document.getElementById('commandPaletteInput');
    if (!overlay.classList.contains('open')) commandPaletteReturnFocus = document.activeElement;
    overlay.classList.add('open');
    overlay.setAttribute('aria-hidden', 'false');
    input.value = query;
    filterCommandPalette(query);
    input.focus();
}

function closeCommandPalette() {
    const overlay = document.getElementById('commandPalette');
    if (!overlay?.classList.contains('open')) return;
    const shouldRestoreFocus = typeof overlay.contains !== 'function'
        || overlay.contains(document.activeElement);
    overlay.classList.remove('open');
    overlay.setAttribute('aria-hidden', 'true');
    if (shouldRestoreFocus && !focusSafely(commandPaletteReturnFocus)) focusFallback(overlay);
    commandPaletteReturnFocus = null;
}

let commandFocusRotationTimer = null;
let commandCountdownTimer = null;
let commandCarouselTimer = null;
let commandCarouselPaused = false;
let commandMotionPreference = null;

// 获取当前卡片展示的有效节点列表（按截止时间升序）。
// 优先使用卡片自身的缓存（避免每次 tick 全量重算）；无缓存时重新收集。
function cardNodeList(card, now) {
    if (!card || !card.__nodeList || !card.__nodeList.length) {
        card.__nodeList = collectKeyNodes(typeof allProjects !== 'undefined' ? allProjects : [], now);
    }
    return card.__nodeList;
}

// 从卡片当前展示的节点反查其在列表中的下标；找不到则回退到列表第一项。
function cardCurrentIndex(card, now) {
    const nodes = cardNodeList(card, now);
    if (!nodes.length) return -1;
    const projectId = card.getAttribute('data-command-node-project');
    const stageKey = card.getAttribute('data-command-node-stage');
    const index = nodes.findIndex(node => (
        String(node.projectId ?? '') === String(projectId ?? '')
        && String(node.stageKey ?? '') === String(stageKey ?? '')
    ));
    return index >= 0 ? index : 0;
}

// 将轮播切换到指定下标的节点；切换时刷新节点列表、卡片内容和头部标签/按钮状态。
function showCommandNode(card, index, now = new Date()) {
    const nodes = collectKeyNodes(typeof allProjects !== 'undefined' ? allProjects : [], now);
    card.__nodeList = nodes;
    if (!nodes.length) {
        card.__node = null;
        card.removeAttribute('data-command-node-project');
        card.removeAttribute('data-command-node-stage');
        const body = card.querySelector('.command-node-body');
        if (body) {
            body.setAttribute('data-rendered', 'empty');
            body.innerHTML = '<div class="command-node-empty">暂无待处理关键节点</div>';
        }
        const tag = card.querySelector('.command-node-tag');
        if (tag) tag.remove();
        const nextBtn = card.querySelector('[data-command-node-next]');
        if (nextBtn) nextBtn.setAttribute('disabled', '');
        return;
    }
    const safeIndex = ((Number(index) % nodes.length) + nodes.length) % nodes.length;
    const node = nodes[safeIndex];
    card.__node = node;
    card.setAttribute('data-command-node-project', String(node.projectId ?? ''));
    card.setAttribute('data-command-node-stage', String(node.stageKey ?? ''));
    const body = card.querySelector('.command-node-body');
    if (body) {
        body.setAttribute('data-rendered', 'node');
        body.innerHTML = renderNearestNodeCountdown(node, now);
    }
    const tag = card.querySelector('.command-node-tag');
    if (tag) {
        tag.textContent = node.stageName || '关键节点';
        tag.title = node.stageName || '';
        tag.classList.remove('is-overdue');
    }
    const nextBtn = card.querySelector('[data-command-node-next]');
    if (nextBtn) nextBtn.removeAttribute('disabled');
    card.classList.add('is-switching');
    requestAnimationFrame(() => card.classList.remove('is-switching'));
    card.dataset.commandNodeIndex = String(safeIndex);
}

// 自动轮播与「下一个」按钮共用的切换入口：总是切到列表中的下一项（循环回第一项），
// 并重置完整的 8 秒轮播计时。基于实时收集的有效节点，避免缓存列表中的过期节点。
function switchToNextNode(root, now = new Date()) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const card = scope.querySelector?.('[data-command-node-card]');
    if (!card) return;
    const nodes = collectKeyNodes(typeof allProjects !== 'undefined' ? allProjects : [], now);
    card.__nodeList = nodes;
    if (nodes.length < 2) return;
    const nextIndex = (cardCurrentIndex(card, now) + 1) % nodes.length;
    showCommandNode(card, nextIndex, now);
    resetCommandCarousel(root);
}

// 重置（并重启）8 秒自动轮播计时。每次手动点击/切换节点后必须调用，保证完整 8 秒周期。
function resetCommandCarousel(root = document) {
    if (commandCarouselTimer) clearInterval(commandCarouselTimer);
    commandCarouselTimer = null;
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const card = scope.querySelector?.('[data-command-node-card]');
    if (!card) return;
    const nodes = cardNodeList(card, new Date());
    if (nodes.length < 2 || commandCarouselPaused) return;
    if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    commandCarouselTimer = setInterval(() => {
        if (commandCarouselPaused) return;
        const now = new Date();
        const fresh = collectKeyNodes(typeof allProjects !== 'undefined' ? allProjects : [], now);
        if (fresh.length < 2) {
            // 有效节点不足两个（含当前节点已到期被剔除的情况）：刷新展示并等待
            card.__nodeList = fresh;
            if (fresh.length === 0) showCommandNode(card, 0, now);
            else if (!card.__node || !fresh.some(node => (
                String(node.projectId ?? '') === String(card.__node.projectId ?? '')
                && String(node.stageKey ?? '') === String(card.__node.stageKey ?? '')
            ))) {
                showCommandNode(card, 0, now);
            }
            return;
        }
        const nextIndex = (cardCurrentIndex(card, now) + 1) % fresh.length;
        showCommandNode(card, nextIndex, now);
    }, 8000);
}

function updateNearestNodeCountdown(root = document, now = new Date()) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const card = scope.querySelector?.('[data-command-node-card]');
    if (!card) return;
    const projectIdAttr = card.getAttribute('data-command-node-project');
    const stageKeyAttr = card.getAttribute('data-command-node-stage');
    let node = card.__node;
    if (!(projectIdAttr && stageKeyAttr) || !node) {
        node = pickNearestKeyNode(typeof allProjects !== 'undefined' ? allProjects : [], now);
    }
    if (!node) {
        card.__node = null;
        card.removeAttribute('data-command-node-project');
        card.removeAttribute('data-command-node-stage');
        const body = card.querySelector('.command-node-body');
        if (body && body.getAttribute('data-rendered') !== 'empty') {
            body.setAttribute('data-rendered', 'empty');
            body.innerHTML = '<div class="command-node-empty">暂无待处理关键节点</div>';
        }
        const tag = card.querySelector('.command-node-tag');
        if (tag) tag.remove();
        const nextBtn = card.querySelector('[data-command-node-next]');
        if (nextBtn) nextBtn.setAttribute('disabled', '');
        return;
    }
    const changed = projectIdAttr !== String(node.projectId ?? '') || stageKeyAttr !== String(node.stageKey ?? '');
    card.__node = node;
    card.setAttribute('data-command-node-project', String(node.projectId ?? ''));
    card.setAttribute('data-command-node-stage', String(node.stageKey ?? ''));
    if (changed) {
        const body = card.querySelector('.command-node-body');
        if (body) {
            body.setAttribute('data-rendered', 'node');
            body.innerHTML = renderNearestNodeCountdown(node, now);
        }
        const tag = card.querySelector('.command-node-tag');
        if (tag) {
            tag.textContent = node.stageName || '关键节点';
            tag.title = node.stageName || '';
        }
    }
    updateCommandCountdown(card, now);
    // 节点已到期：按实时时间判断（delta 是收集时的快照，不可靠），
    // 到期后立即从有效列表剔除，并切换到下一个未到期节点
    const deadline = commandDeadline(node.plannedAt);
    if (deadline && deadline.getTime() - now.getTime() <= 0) {
        const fresh = collectKeyNodes(typeof allProjects !== 'undefined' ? allProjects : [], now);
        card.__nodeList = fresh;
        showCommandNode(card, 0, now);
    }
}

function updateCommandCountdown(root = document, now = new Date()) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('[data-command-deadline]').forEach(node => {
        const parts = commandCountdownParts(node.dataset.commandDeadline, now);
        if (!parts) return;
        node.classList.toggle('is-overdue', parts.overdue);
        node.classList.toggle('is-upcoming', !parts.overdue);
        const label = node.querySelector('.command-countdown-label');
        if (label) label.textContent = parts.overdue ? '已逾期' : '剩余时间';
        const values = {
            days: String(parts.days),
            hours: String(parts.hours).padStart(2, '0'),
            minutes: String(parts.minutes).padStart(2, '0'),
            seconds: String(parts.seconds).padStart(2, '0'),
        };
        Object.entries(values).forEach(([unit, value]) => {
            const target = node.querySelector(`[data-countdown-unit="${unit}"]`);
            if (!target || target.textContent === value) return;
            target.textContent = value;
            target.classList.remove('is-ticking');
            if (!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
                void target.offsetWidth;
                target.classList.add('is-ticking');
            }
        });
        node.setAttribute('aria-label', commandCountdownLabel(parts));
        // 节点标签：逾期时红色
        const tag = node.closest('.command-node-card')?.querySelector?.('.command-node-tag');
        if (tag) tag.classList.toggle('is-overdue', parts.overdue);
        // 逾期：停止显示负数，改为 00:00:00 与“已逾期”
        const timeWrap = node.querySelector('.command-node-time');
        const status = node.querySelector('.command-node-status');
        if (parts.overdue) {
            if (timeWrap) timeWrap.classList.add('is-overdue');
            if (status && !status.textContent.includes('已逾期')) status.textContent = '已逾期';
        } else if (timeWrap) {
            timeWrap.classList.remove('is-overdue');
            const existingStatus = node.querySelector('.command-node-status');
            if (existingStatus) existingStatus.remove();
        }
    });
}

function setCommandFocusSlide() { return undefined; }

function startCommandFocusRotation() { return undefined; }

function cleanupCommandCenterMotion() {
    if (commandCountdownTimer) clearInterval(commandCountdownTimer);
    if (commandFocusRotationTimer) clearInterval(commandFocusRotationTimer);
    if (commandCarouselTimer) clearInterval(commandCarouselTimer);
    commandCountdownTimer = null;
    commandFocusRotationTimer = null;
    commandCarouselTimer = null;
    commandCarouselPaused = false;
}

function syncCommandMotionPreference() {
    const dashboard = document.getElementById('dashboardContent');
    if (!dashboard?.closest?.('.view')?.classList?.contains('active')) return;
    if (commandMotionPreference?.matches) {
        if (commandCarouselTimer) clearInterval(commandCarouselTimer);
        commandCarouselTimer = null;
    } else {
        resetCommandCarousel(dashboard);
    }
}

function initializeCommandCenterMotion(root = document) {
    cleanupCommandCenterMotion();
    const now = new Date();
    updateNearestNodeCountdown(root, now);
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const card = scope.querySelector?.('[data-command-node-card]');
    if (card) {
        card.__nodeList = collectKeyNodes(typeof allProjects !== 'undefined' ? allProjects : [], now);
        const nextBtn = card.querySelector('[data-command-node-next]');
        if (nextBtn && !card.__nodeList.length) nextBtn.setAttribute('disabled', '');
        // 悬停暂停/恢复仅作用于 8 秒自动轮播；1 秒倒计时始终运行。
        // 移出时重置完整 8 秒计时，保证每次恢复后都有完整观察周期。
        if (card.dataset.commandMotionListeners !== '1') {
            card.dataset.commandMotionListeners = '1';
            card.addEventListener('mouseenter', () => { commandCarouselPaused = true; });
            card.addEventListener('mouseleave', () => {
                commandCarouselPaused = false;
                resetCommandCarousel(root);
            });
        }
    }
    if (root?.querySelector?.('[data-command-deadline]')) {
        commandCountdownTimer = setInterval(() => updateNearestNodeCountdown(root), 1000);
    }
    resetCommandCarousel(root);
}

function applyStableVisualSemantics(root = document) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    scope.querySelectorAll('.view-header-actions, .command-page-actions, .project-command-actions, .settings-actions')
        .forEach(node => node.classList.add('stable-primary-actions'));
    scope.querySelectorAll('.nav-item, .sidebar-project').forEach(node => {
        node.setAttribute('role', 'button');
        node.setAttribute('tabindex', '0');
        if (node.hasAttribute('onkeydown')) {
            node.dataset.stableKeyboard = '1';
            return;
        }
        if (node.dataset.stableKeyboard === '1') return;
        node.dataset.stableKeyboard = '1';
        node.addEventListener('keydown', event => {
            if (event.key !== 'Enter' && event.key !== ' ') return;
            event.preventDefault();
            node.click();
        });
    });
    const hamburger = document.getElementById('hamburger');
    if (hamburger) {
        hamburger.setAttribute('aria-label', '打开项目导航');
        hamburger.setAttribute('aria-controls', 'sidebar');
    }
}

function openCommandAction(projectId, stageKey) {
    return Promise.resolve(selectProject(projectId)).then(selected => {
        if (!selected) return false;
        if (stageKey) openStageSlide(stageKey);
        return true;
    });
}

function dispatchCommandAction(control) {
    const action = control?.dataset?.commandAction;
    if (action === 'open-project-stage') {
        return openCommandAction(control.dataset.projectId, control.dataset.stageKey);
    }
    if (action === 'open-stage') return openStageSlide(control.dataset.stageKey);
    if (action === 'select-project') return selectProject(control.dataset.projectId);
    if (action === 'switch-view') return switchView(control.dataset.view);
    if (action === 'batch-advance') return openBatchAdvanceDialog();
    if (action === 'import-projects') return showProjectImportDialog();
    if (action === 'export') return exportData();
    if (action === 'new-project') return showNewProjectModal();
    if (action === 'switch-project-tab') return switchProjectTab(control.dataset.tab);
    if (action === 'toggle-project-overview') return toggleProjectQuickOverview(control);
    return undefined;
}

function installCommandActionDelegation(root = document) {
    root.addEventListener('click', event => {
        // 「下一个 →」按钮：切到下一节点并重置完整 8 秒轮播
        const nextBtn = event.target?.closest?.('[data-command-node-next]');
        if (nextBtn) {
            switchToNextNode(root);
            return;
        }
        const control = event.target?.closest?.('[data-command-action]');
        if (control) {
            dispatchCommandAction(control);
            return;
        }
        // 最近关键节点倒计时卡片：点击整卡 → 跳转所属项目详情
        const nodeCard = event.target?.closest?.('[data-command-node-card]');
        if (nodeCard && !event.target?.closest?.('button, a, [data-command-action]')) {
            const projectId = nodeCard.getAttribute('data-command-node-project') || nodeCard.__node?.projectId;
            if (projectId) {
                selectProject(Number(projectId)).then(selected => {
                    const stageKey = nodeCard.getAttribute('data-command-node-stage') || nodeCard.__node?.stageKey;
                    if (selected && stageKey && typeof openStageSlide === 'function') {
                        openStageSlide(stageKey);
                    }
                });
            }
            return;
        }
    });
}

function enhanceApplicationShell() {
    if (document.documentElement.dataset.commandCenterShell === '1') return;
    document.documentElement.dataset.commandCenterShell = '1';
    document.getElementById('app')?.classList.add('command-center-app');
    document.getElementById('sidebar')?.classList.add('command-project-rail');
    installCommandActionDelegation(document);
    globalThis.addEventListener?.('pagehide', cleanupCommandCenterMotion);
    commandMotionPreference = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)') || null;
    commandMotionPreference?.addEventListener?.('change', syncCommandMotionPreference);
    document.addEventListener?.('visibilitychange', () => {
        const dashboard = document.getElementById('dashboardContent');
        if (document.hidden) cleanupCommandCenterMotion();
        else if (dashboard?.closest?.('.view')?.classList?.contains('active')) initializeCommandCenterMotion(dashboard);
    });
    enhancePrimaryNavigation();
    ensureCommandPalette();
    applyStableVisualSemantics(document);
}
// ── Hardened Chart Board ──
'use strict';

const CHART_BOARD_CANCELLED = Symbol('chart-board-cancelled');
const chartBoardTimers = new Map();
let chartBoardData = null;
let chartBoardPending = null;
let chartBoardGeneration = 0;
let chartActivityPending = null;
let chartActivityGeneration = 0;
const chartActivityState = {
    items: [],
    nextCursor: null,
    filters: {userId: '', projectId: '', action: ''},
    loaded: false,
    loading: false,
    error: '',
};

const CHART_ACTIVITY_ACTIONS = [
    ['project.create', '新增项目'],
    ['project.update', '修改项目'],
    ['project.delete', '删除项目'],
    ['project.terminate', '终止项目'],
    ['project.restore', '恢复项目'],
    ['stage.complete', '完成阶段'],
    ['stage.undo', '撤销阶段完成'],
    ['stage.schedule', '修改阶段计划'],
    ['stage.batch_advance', '批量推进阶段'],
    ['registration.create', '新增报名登记'],
    ['registration.update', '修改报名登记'],
    ['registration.delete', '删除报名登记'],
    ['attachment.upload', '上传附件'],
    ['attachment.update', '修改附件'],
    ['attachment.delete', '删除附件'],
    ['clarification.create', '新增澄清更正'],
    ['complaint.create', '新增质疑投诉'],
    ['archive.bulk_update', '批量核验归档资料'],
];

function chartSafeText(value) {
    try {
        if (value === null || value === undefined) return '';
        return String(value);
    } catch (_) {
        return '';
    }
}

function chartEscape(value) {
    return chartSafeText(value).replace(/[&<>'"]/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
    })[character]);
}

function chartNumber(value) {
    try {
        const number = Number(value);
        return Number.isFinite(number) ? number : 0;
    } catch (_) {
        return 0;
    }
}

function safeRatio(value, total) {
    const numerator = chartNumber(value);
    const denominator = chartNumber(total);
    return denominator > 0 && numerator >= 0 ? numerator / denominator : 0;
}

function chartDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function chartDayOrdinal(value) {
    const date = chartDate(value);
    if (!date) return null;
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
}

function chartCountRows(counts) {
    return [...counts.entries()]
        .map(([name, count]) => ({name, count}))
        .sort((left, right) => right.count - left.count
            || right.name.localeCompare(left.name, 'zh-CN'));
}

function chartMonthRanges(now) {
    const current = chartDate(now) || new Date();
    const ranges = [];
    for (let offset = 5; offset >= 0; offset -= 1) {
        const start = new Date(current.getFullYear(), current.getMonth() - offset, 1);
        const next = new Date(start.getFullYear(), start.getMonth() + 1, 1);
        ranges.push({
            month: `${start.getMonth() + 1}月`,
            start: start.getTime(),
            next: next.getTime(),
        });
    }
    return ranges;
}

function buildChartBoardData(projects, now = new Date()) {
    const source = Array.isArray(projects) ? projects : [];
    const current = chartDate(now) || new Date();
    const today = chartDayOrdinal(current);
    const monthRanges = chartMonthRanges(current);
    const ordinalCache = new Map();
    const cachedOrdinal = value => {
        if (!value) return null;
        const key = chartSafeText(value);
        if (ordinalCache.has(key)) return ordinalCache.get(key);
        const ordinal = chartDayOrdinal(value);
        ordinalCache.set(key, ordinal);
        return ordinal;
    };
    const monthlyTrend = monthRanges.map(range => ({
        month: range.month,
        created: 0,
        completed: 0,
    }));
    const methods = new Map();
    let active = 0;
    let completed = 0;
    let terminated = 0;
    let overdue = 0;
    let dueSoon = 0;
    let challenged = 0;

    for (const rawProject of source) {
        const project = rawProject || {};
        const progress = chartNumber(project.progress);
        const isTerminated = Boolean(project.is_terminated);
        const isCompleted = !isTerminated && progress >= 100;
        const isActive = !isTerminated && !isCompleted;
        if (isActive) active += 1;
        if (isCompleted) completed += 1;
        if (isTerminated) terminated += 1;

        const method = chartSafeText(project.method || project.procurement_method || '未设置');
        methods.set(method, (methods.get(method) || 0) + 1);

        const createdAt = chartDate(project.created_at || project.createdAt);
        const completedAt = chartDate(project.completed_at || project.completedAt);
        for (let index = 0; index < monthRanges.length; index += 1) {
            const range = monthRanges[index];
            if (createdAt && createdAt.getTime() >= range.start && createdAt.getTime() < range.next) {
                monthlyTrend[index].created += 1;
            }
            if (isCompleted && completedAt
                && completedAt.getTime() >= range.start && completedAt.getTime() < range.next) {
                monthlyTrend[index].completed += 1;
            }
        }

        let projectOverdue = Boolean(project.is_overdue || project.overdue);
        let projectSoon = Boolean(project.due_soon || project.is_due_soon);
        if (isActive && Array.isArray(project.stages)) {
            for (const stage of project.stages) {
                if (!stage || stage.completed || stage.skipped) continue;
                const planned = cachedOrdinal(
                    stage.planned_at || stage.plannedAt || stage.planned_date,
                );
                if (planned === null) continue;
                const remaining = planned - today;
                if (remaining < 0) projectOverdue = true;
                else if (remaining <= 7) projectSoon = true;
            }
        }
        if (isActive && projectOverdue) overdue += 1;
        if (isActive && !projectOverdue && projectSoon) dueSoon += 1;
        if (isActive && (
            chartSafeText(project.challenge_state).trim()
            || chartNumber(project.open_complaint_count || project.complaint_count) > 0
        )) challenged += 1;
    }

    return {
        kpis: {total: source.length, active, overdue, completed},
        monthlyTrend,
        statusDistribution: [
            {name: '进行中', count: active},
            {name: '已完成', count: completed},
            {name: '已终止', count: terminated},
        ].filter(item => item.count > 0),
        methodDistribution: chartCountRows(methods),
        riskDistribution: [
            {name: '逾期', count: overdue},
            {name: '7天内', count: dueSoon},
            {name: '质疑投诉', count: challenged},
            {name: '已终止', count: terminated},
        ].filter(item => item.count > 0),
    };
}

function renderChartKpis(kpis) {
    const cards = [
        ['项目总数', kpis.total, '全部项目'],
        ['进行中', kpis.active, '当前执行项目'],
        ['逾期事项', kpis.overdue, '需要立即处理'],
        ['已完成', kpis.completed, '累计完成项目'],
    ];
    return `<div class="cb-kpis">${cards.map(([label, value, hint], index) => `
        <article class="cb-kpi cb-kpi-${index + 1}">
            <span>${chartEscape(label)}</span><strong>${chartNumber(value)}</strong><small>${chartEscape(hint)}</small>
        </article>`).join('')}</div>`;
}

function renderTrendChart(rows) {
    const maximum = Math.max(1, ...rows.flatMap(row => [row.created, row.completed]));
    const xAt = index => 40 + index * 84;
    const yAt = value => 184 - safeRatio(value, maximum) * 130;
    const createdPoints = rows.map((row, index) => `${xAt(index)},${yAt(row.created)}`).join(' ');
    const completedPoints = rows.map((row, index) => `${xAt(index)},${yAt(row.completed)}`).join(' ');
    const labels = rows.map((row, index) => `<text x="${xAt(index)}" y="214" text-anchor="middle">${chartEscape(row.month)}</text>`).join('');
    const dots = rows.map((row, index) => `
        <circle cx="${xAt(index)}" cy="${yAt(row.created)}" r="4" class="cb-trend-created"><title>${chartEscape(row.month)} 新增 ${chartNumber(row.created)}</title></circle>
        <circle cx="${xAt(index)}" cy="${yAt(row.completed)}" r="4" class="cb-trend-completed"><title>${chartEscape(row.month)} 完成 ${chartNumber(row.completed)}</title></circle>`).join('');
    return `<article class="cb-panel cb-trend" data-chart-type="six-month-trend">
        <header><div><h3>近 6 个月项目趋势</h3><p>新增与完成项目数量</p></div><div class="cb-legend"><span>新增</span><span>完成</span></div></header>
        <svg viewBox="0 0 500 230" role="img" aria-label="近六个月项目新增与完成趋势">
            <line x1="40" y1="184" x2="460" y2="184" class="cb-axis"></line>
            <polyline points="${createdPoints}" class="cb-line cb-line-created"></polyline>
            <polyline points="${completedPoints}" class="cb-line cb-line-completed"></polyline>
            ${dots}${labels}
        </svg>
    </article>`;
}

function renderDistribution(title, type, rows) {
    if (!rows.length) {
        return `<article class="cb-panel cb-distribution" data-chart-type="${type}"><header><h3>${chartEscape(title)}</h3></header><p class="cb-chart-empty">暂无数据</p></article>`;
    }
    const maximum = Math.max(1, ...rows.map(row => chartNumber(row.count)));
    return `<article class="cb-panel cb-distribution" data-chart-type="${type}">
        <header><h3>${chartEscape(title)}</h3></header>
        <ol>${rows.map((row, index) => `
            <li><div><span><i class="cb-swatch cb-swatch-${index % 4 + 1}"></i>${chartEscape(row.name)}</span><strong>${chartNumber(row.count)}</strong></div>
            <b><i style="width:${Math.max(2, safeRatio(row.count, maximum) * 100).toFixed(2)}%"></i></b></li>`).join('')}</ol>
    </article>`;
}

function chartActivityUrl(filters = {}, cursor = null) {
    const query = new URLSearchParams({project_activity_view: 'recent', limit: '30'});
    if (cursor) query.set('before_id', chartSafeText(cursor));
    if (filters.userId) query.set('user_id', chartSafeText(filters.userId));
    if (filters.projectId) query.set('project_id', chartSafeText(filters.projectId));
    if (filters.action) query.set('action', chartSafeText(filters.action));
    return `/api/settings?${query.toString()}`;
}

function chartSelectOptions(rows, selected, placeholder) {
    const seen = new Set();
    const options = rows.filter(row => {
        const key = chartSafeText(row.value);
        if (!key || seen.has(key)) return false;
        seen.add(key);
        return true;
    });
    return `<option value="">${chartEscape(placeholder)}</option>${options.map(row => {
        const value = chartSafeText(row.value);
        return `<option value="${chartEscape(value)}" ${value === chartSafeText(selected) ? 'selected' : ''}>${chartEscape(row.label)}</option>`;
    }).join('')}`;
}

function renderActivityFilters() {
    const actorOptions = chartActivityState.items.map(item => ({
        value: item.user_id,
        label: item.actor_label || item.username || `用户 ${item.user_id}`,
    }));
    const projectOptions = (Array.isArray(allProjects) ? allProjects : []).map(project => ({
        value: project.id,
        label: `${project.number || ''} ${project.name || ''}`.trim(),
    }));
    const actionOptions = CHART_ACTIVITY_ACTIONS.map(([value, label]) => ({value, label}));
    return `<div class="cb-activity-filters">
        <label><span>用户</span><select data-cb-filter="userId">${chartSelectOptions(actorOptions, chartActivityState.filters.userId, '全部用户')}</select></label>
        <label><span>项目</span><select data-cb-filter="projectId">${chartSelectOptions(projectOptions, chartActivityState.filters.projectId, '全部项目')}</select></label>
        <label><span>操作</span><select data-cb-filter="action">${chartSelectOptions(actionOptions, chartActivityState.filters.action, '全部操作')}</select></label>
    </div>`;
}

function renderActivityRows() {
    if (chartActivityState.loading && !chartActivityState.items.length) {
        return '<div class="cb-activity-state" role="status">正在读取操作记录…</div>';
    }
    if (chartActivityState.error && !chartActivityState.items.length) {
        return `<div class="cb-activity-state cb-activity-error" role="alert">操作记录加载失败：${chartEscape(chartActivityState.error)}</div>`;
    }
    if (!chartActivityState.items.length) {
        return '<div class="cb-activity-state" role="status">暂无符合条件的操作记录</div>';
    }
    return chartActivityState.items.map(item => {
        const project = item.project || {};
        const changes = Array.isArray(item.changes) ? item.changes.slice(0, 3) : [];
        const changeText = changes.map(change => `${chartSafeText(change.field)}：${chartSafeText(change.before)} → ${chartSafeText(change.after)}`).join('；');
        const created = chartDate(item.created_at);
        const createdText = created ? created.toLocaleString('zh-CN') : chartSafeText(item.created_at);
        return `<article class="cb-activity-item" data-activity-id="${chartEscape(item.id)}">
            <div class="cb-activity-dot" aria-hidden="true"></div>
            <div class="cb-activity-copy">
                <div><strong>${chartEscape(item.label || item.action)}</strong><time>${chartEscape(createdText)}</time></div>
                <p>${chartEscape(project.number || '已删除项目')} · ${chartEscape(project.name || '项目名称不可用')}</p>
                ${changeText ? `<small title="${chartEscape(changeText)}">${chartEscape(changeText)}</small>` : ''}
                <span>${chartEscape(item.actor_label || item.username || '未知用户')}</span>
            </div>
        </article>`;
    }).join('');
}

function renderActivityPanel() {
    const more = chartActivityState.nextCursor
        ? '<button type="button" class="cb-load-more" data-cb-activity-action="more">加载更多</button>'
        : '';
    return `<aside class="cb-activity" aria-label="项目操作记录">
        <header><div><h3>项目操作记录</h3><p>成功写入项目的数据变更</p></div></header>
        ${renderActivityFilters()}
        <div class="cb-activity-list">${renderActivityRows()}</div>
        ${chartActivityState.error && chartActivityState.items.length ? `<p class="cb-inline-error">操作记录加载失败：${chartEscape(chartActivityState.error)}</p>` : ''}
        ${more}
    </aside>`;
}

function renderChartBoard(data) {
    const container = document.getElementById('chartBoardContent');
    if (!container) return;
    chartBoardData = data || buildChartBoardData([], new Date());
    const safeData = chartBoardData;
    container.innerHTML = `<section class="chart-board-shell">
        <header class="cb-header"><div><h2>项目数据看板</h2><p>项目进度、风险与操作动态</p></div></header>
        ${renderChartKpis(safeData.kpis || {total: 0, active: 0, overdue: 0, completed: 0})}
        <div class="cb-board-grid">
            <main class="cb-analysis">
                ${renderTrendChart(safeData.monthlyTrend || [])}
                <div class="cb-supporting">
                    ${renderDistribution('项目状态', 'status-distribution', safeData.statusDistribution || [])}
                    ${renderDistribution('采购方式', 'method-distribution', safeData.methodDistribution || [])}
                    ${renderDistribution('风险提醒', 'risk-distribution', safeData.riskDistribution || [])}
                </div>
            </main>
            ${renderActivityPanel()}
        </div>
    </section>`;
}

function renderChartActivityOnly() {
    const container = document.getElementById('chartBoardContent');
    const previousList = container?.querySelector?.('.cb-activity-list');
    const scrollTop = previousList?.scrollTop || 0;
    renderChartBoard(chartBoardData || buildChartBoardData(allProjects, new Date()));
    const nextList = container?.querySelector?.('.cb-activity-list');
    if (nextList) nextList.scrollTop = scrollTop;
}

async function loadChartActivity({reset = false} = {}) {
    if (chartActivityPending && !reset) return chartActivityPending;
    if (!reset && chartActivityState.loaded && !chartActivityState.nextCursor) return false;
    if (reset) {
        chartActivityGeneration += 1;
        chartActivityState.items = [];
        chartActivityState.nextCursor = null;
        chartActivityState.error = '';
        chartActivityPending = null;
    }
    const generation = chartActivityGeneration;
    const cursor = reset ? null : chartActivityState.nextCursor;
    chartActivityState.loading = true;
    renderChartActivityOnly();
    let request;
    request = api('GET', chartActivityUrl(chartActivityState.filters, cursor))
        .then(result => {
            if (generation !== chartActivityGeneration) return false;
            const incoming = Array.isArray(result?.items) ? result.items : [];
            const existingIds = new Set(chartActivityState.items.map(item => chartSafeText(item.id)));
            for (const item of incoming) {
                const key = chartSafeText(item?.id);
                if (key && !existingIds.has(key)) {
                    chartActivityState.items.push(item);
                    existingIds.add(key);
                }
            }
            chartActivityState.nextCursor = result?.next_cursor || null;
            chartActivityState.loaded = true;
            chartActivityState.error = '';
            return true;
        })
        .catch(error => {
            if (generation !== chartActivityGeneration) return false;
            chartActivityState.error = chartSafeText(error?.message || error || '未知错误');
            return false;
        })
        .finally(() => {
            if (generation === chartActivityGeneration) {
                chartActivityState.loading = false;
                renderChartActivityOnly();
            }
            if (chartActivityPending === request) chartActivityPending = null;
        });
    chartActivityPending = request;
    return request;
}

function updateChartActivityFilter(name, value) {
    if (!Object.hasOwn(chartActivityState.filters, name)) return Promise.resolve(false);
    chartActivityState.filters[name] = chartSafeText(value);
    return loadChartActivity({reset: true});
}

function ensureChartBoardWorkspace() {
    if (!document.querySelector('.nav-item[data-view="chart-board"]')) {
        const procureNav = document.querySelector('.nav-item[data-view="procure"]');
        if (procureNav) {
            const nav = document.createElement('div');
            nav.className = 'nav-item';
            nav.dataset.view = 'chart-board';
            nav.setAttribute('role', 'button');
            nav.setAttribute('tabindex', '0');
            nav.innerHTML = '<span class="nav-icon" aria-hidden="true">▥</span><span>图表看板</span>';
            nav.addEventListener('click', () => {
                switchView('chart-board');
                if (typeof closeSidebar === 'function') closeSidebar();
            });
            nav.addEventListener('keydown', event => {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                nav.click();
            });
            procureNav.insertAdjacentElement('afterend', nav);
        }
    }
    if (!document.getElementById('view-chart-board')) {
        const procureView = document.querySelector('#view-procure')
            || document.getElementById('view-procure');
        if (procureView) {
            const view = document.createElement('div');
            view.id = 'view-chart-board';
            view.className = 'view';
            view.innerHTML = '<div id="chartBoardContent"></div>';
            procureView.insertAdjacentElement('afterend', view);
        }
    }
}

function scheduleChartBoardWork(work) {
    return new Promise((resolve, reject) => {
        const timerId = setTimeout(() => {
            if (!chartBoardTimers.has(timerId)) return;
            chartBoardTimers.delete(timerId);
            try { resolve(work()); } catch (error) { reject(error); }
        }, 0);
        chartBoardTimers.set(timerId, resolve);
    });
}

function cancelScheduledChartBoardWork() {
    for (const [timerId, resolve] of chartBoardTimers) {
        clearTimeout(timerId);
        chartBoardTimers.delete(timerId);
        resolve(CHART_BOARD_CANCELLED);
    }
}

function invalidateChartBoardData() {
    chartBoardGeneration += 1;
    chartActivityGeneration += 1;
    cancelScheduledChartBoardWork();
    chartBoardData = null;
    chartBoardPending = null;
    chartActivityPending = null;
    chartActivityState.loading = false;
    chartActivityState.loaded = false;
    chartActivityState.nextCursor = null;
}

function cleanupChartBoardLifecycle() {
    chartBoardGeneration += 1;
    chartActivityGeneration += 1;
    cancelScheduledChartBoardWork();
    chartBoardPending = null;
    chartActivityPending = null;
    chartActivityState.loading = false;
}

function refreshChartBoard({force = false} = {}) {
    ensureChartBoardWorkspace();
    const target = document.getElementById('chartBoardContent');
    if (!target) return Promise.resolve(false);
    if (chartBoardData && !force) {
        renderChartBoard(chartBoardData);
        if (!chartActivityState.loaded && !chartActivityState.loading) {
            loadChartActivity({reset: true});
        }
        return Promise.resolve(true);
    }
    if (chartBoardPending && !force) return chartBoardPending;
    if (force) {
        chartBoardGeneration += 1;
        cancelScheduledChartBoardWork();
    }
    const generation = chartBoardGeneration;
    const projects = Array.isArray(allProjects) ? allProjects : [];
    const request = scheduleChartBoardWork(() => buildChartBoardData(projects, new Date()))
        .then(data => {
            if (data === CHART_BOARD_CANCELLED || generation !== chartBoardGeneration) return false;
            renderChartBoard(data);
            if (!chartActivityState.loaded && !chartActivityState.loading) {
                loadChartActivity({reset: true});
            }
            return true;
        })
        .catch(error => {
            if (generation !== chartBoardGeneration) return false;
            target.innerHTML = `<div class="cb-board-error" role="alert">图表加载失败：${chartEscape(error?.message)}</div>`;
            return false;
        })
        .finally(() => {
            if (chartBoardPending === request) chartBoardPending = null;
        });
    chartBoardPending = request;
    return request;
}

function installChartBoardInteractions() {
    const root = document.documentElement;
    if (root.dataset.chartBoardInteractions === '1') return;
    root.dataset.chartBoardInteractions = '1';
    document.addEventListener('click', event => {
        const control = event.target?.closest?.('[data-cb-activity-action]');
        if (!control) return;
        if (control.dataset.cbActivityAction === 'more') loadChartActivity();
    });
    document.addEventListener('change', event => {
        const control = event.target?.closest?.('[data-cb-filter]');
        if (!control) return;
        updateChartActivityFilter(control.dataset.cbFilter, control.value);
    });
}

function installChartBoardShell() {
    ensureChartBoardWorkspace();
    installChartBoardInteractions();
}
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
// ── External platform bidding ledger ──
const ONLINE_BIDDING_STEPS = [
    ['plan_received', '接收项目', '📥', [], 'received', '项目基本信息与委托资料已核对'],
    ['online_documents', '文件编制与确认', '📝', ['responsible_person'], 'document_confirmed', '编制、核对、定稿连续办理；退回修改仍在本阶段'],
    ['agreement_signed', '签订委托协议', '📋', [], 'agreement_signed', '文件确认无误后签订委托协议，上传协议附件'],
    ['announcement', '平台发布', '📢', ['clarification'], 'announcement_done', '登记外部平台公告、报名截止时间与竞价时段'],
    ['registration_end', '报名与审核', '👥', ['registration'], 'roster_locked', '逐家审核报名资料；报名截止后确认最终参竞名单'],
    ['online_quotation', '一次报价竞价', '⏳', [], 'verified', '外部平台一次报价，最低价成交；全部报完或到截止时间结束，需核对平台结果'],
    ['result_announced', '成交结果公示', '🏆', ['result_publication'], 'publication_done', '核对最低价供应商后在平台公示，登记公示凭证'],
    ['online_fee_notice', '服务费与成交通知书', '💰', ['service_fee', 'winning_notice'], 'notice_delivered', '先确认服务费到账，再签发、送达成交通知书'],
    ['archived', '资料归档', '📦', ['archive'], 'archive_checked', '核对文件、协议、公告、审核资料、报价、公示、收费和通知书后归档'],
];


function onlineBiddingTemplate() {
    return ONLINE_BIDDING_STEPS.map(([id,name,icon,modules])=>({id,name,icon,modules:['common','checklist',...modules,...(id==='online_quotation'?['online_bidding']:[])]}));
}

function hasInlineOnlineBidding(project) {
    return project?.method === '网上竞价' && project.online_bidding_enabled === true && (project.stages || []).some(s=>s.key==='online_quotation' || (s.modules || []).includes('online_bidding'));
}

const onlineBiddingDrafts = new Map();
function onlineBiddingDraftControls(host) {
    return [...host.querySelectorAll('input,select'),...document.querySelectorAll('[data-online-review] input,[data-online-review] select')];
}
function captureOnlineBiddingDraft(host) {
    if(!host.onlineState)return;
    const values={};
    onlineBiddingDraftControls(host).forEach((el,i)=>{values[el.id || `control-${i}`]=el.value;});
    onlineBiddingDrafts.set(`${host.dataset.projectId}:${host.dataset.stageKey}`,{values,saved:host.onlineState.saved});
}
function discardOnlineBiddingDraft() {
    const host=document.getElementById('onlineBiddingInline');
    if(!host?.onlineState || host.onlineSaving)return;
    onlineBiddingDrafts.delete(`${host.dataset.projectId}:${host.dataset.stageKey}`);
    openStageSlide(host.dataset.stageKey);
}

function onlineBiddingStageKind(stage, project) {
    if (!hasInlineOnlineBidding(project)) return '';
    const known={plan_received:'',online_documents:'',doc_prepare:'',doc_review:'',doc_finalized:'',agreement_signed:'',archived:'',announcement:'announcement',registration_end:'registration',online_quotation:'quotation',result_announced:'publication',online_fee_notice:'fee',service_fee:'fee',winning_notice:'notice'};
    if (Object.prototype.hasOwnProperty.call(known,stage.key)) return known[stage.key];
    const modules=stage.modules || [];
    if(modules.includes('registration'))return 'registration';
    if(modules.includes('service_fee'))return 'fee';
    if(modules.includes('winning_notice'))return 'notice';
    if(modules.includes('result_publication') || modules.includes('bid_results'))return 'publication';
    if(modules.includes('online_bidding'))return 'quotation';
    return '';
}

function renderOnlineBiddingInline(stage,project) {
    const kind=onlineBiddingStageKind(stage,project);
    if(!kind)return '';
    return `<div id="onlineBiddingInline" data-stage-key="${escHtml(stage.key)}" data-project-id="${Number(project.id)}" data-kind="${kind}" aria-live="polite"><p>正在读取本阶段业务信息…</p></div>`;
}

function renderOnlineRegistrationSlot(registration,project) {
    return hasInlineOnlineBidding(project) ? `<div data-online-review="${Number(registration.id)}"></div>` : '';
}

async function loadOnlineBiddingInline(stage,project) {
    const host=document.getElementById('onlineBiddingInline');
    if(!host)return;
    const pid=project.id, key=stage.key, kind=onlineBiddingStageKind(stage,project);
    try {
        const saved=await api('GET',`/api/projects/${pid}/online-bidding`);
        if(!host.isConnected || currentProject?.id!==pid || editingStageKey!==key)return;
        host.onlineState={saved,project,key,kind};
        const d=saved.data || {};
        const field=(name,label,type='text')=>`<div class="form-group"><label for="ob_${name}">${label}</label><input id="ob_${name}" data-ob-field="${name}" type="${type}" maxlength="2000" value="${escHtml(d[name] || '')}"></div>`;
        const card=(title,body)=>`<section class="stage-business-card"><h3>${title}</h3>${body}</section>`;
        let html='';
        if(kind==='announcement')html=card('平台发布',field('platform','发布平台')+field('announcement_url','平台公告链接','url')+field('registration_end','报名截止时间','datetime-local'));
        if(kind==='registration')html=field('registration_end','报名截止时间','datetime-local')+'<p>在下方报名记录中审核资料。完成本阶段时检查全部报名是否已处理。</p>';
        if(kind==='quotation'){
            html=card('竞价时段',onlineBiddingSummaryHtml(saved.summary,project)+`<div class="form-grid-2">${field('start_at','竞价开始（北京时间）','datetime-local')}${field('end_at','竞价截止（北京时间）','datetime-local')}</div><button type="button" class="btn btn-sm" onclick="fillOnlineBiddingHours()">填入所选日期 09:00—12:00</button><p>报价在外部平台完成，可事后补录；未报价留空。完成本阶段即确认已核对平台结果。</p>`);
            html+='<section class="stage-business-card"><h3>供应商报价</h3>';
            html+=(project.registrations || []).map(r=>{
                const row=(d.records || []).find(x=>x.registration_id===r.id) || {};
                return `<fieldset data-online-quote="${Number(r.id)}" style="border:1px solid var(--border-light);border-radius:8px;padding:12px;margin:10px 0"><legend>${escHtml(r.company_name)} ${escHtml(r.lot_number || '')}</legend><div class="form-grid-2"><div class="form-group"><label for="ob_amount_${r.id}">报价金额（元）</label><input id="ob_amount_${r.id}" data-ob-amount inputmode="decimal" value="${escHtml(row.amount || '')}"></div><div class="form-group"><label for="ob_quote_${r.id}">平台实际报价时间</label><input id="ob_quote_${r.id}" data-ob-quoted-at type="datetime-local" step="1" value="${escHtml(row.quoted_at || '')}"></div></div></fieldset>`;
            }).join('') || '<p>暂无报名供应商，请先在报名阶段登记。</p>';
            html+='</section>';
            html+=card('结果核对',field('ended_at' ,'平台实际结束时间','datetime-local')+`<div class="form-group"><label for="ob_end_reason">结束原因</label><select id="ob_end_reason" data-ob-field="end_reason"><option value="">请选择</option><option value="all_quoted" ${d.end_reason==='all_quoted'?'selected':''}>全部合格供应商已报价</option><option value="deadline" ${d.end_reason==='deadline'?'selected':''}>到截止时间</option></select></div>`+field('evidence','平台结果凭证（编号、链接或附件名称）'));
        }
        if(kind==='publication'){
            html=card('成交结果公示',onlineBiddingSummaryHtml(saved.summary,project)+field('publication_url','公示链接','url')+field('publication_date','公示完成日期','date'));
            html+=(saved.summary.lots || []).filter(lot=>(lot.quotes || []).filter(r=>r.amount===lot.amount).length>1).map(lot=>{
                const r=(d.resolutions || []).find(r=>r.lot_id===lot.lot_id) || {};
                return `<fieldset data-ob-resolution="${lot.lot_id==null?'':Number(lot.lot_id)}"><legend>并列最低价：按平台结果处理</legend><label>平台确定的供应商<select data-ob-resolution-winner><option value="">待处理</option>${lot.quotes.filter(q=>q.amount===lot.amount).map(q=>`<option value="${q.registration_id}" ${r.registration_id===q.registration_id?'selected':''}>${escHtml(q.company_name)}</option>`).join('')}</select></label><label>处理依据<input data-ob-resolution-note value="${escHtml(r.note || '')}"></label></fieldset>`;
            }).join('');
        }
        if(kind==='fee')html=field('fee_date','实际到账日期','date')+field('fee_reference','到账凭证（编号或附件名称）')+'<p>填写到账信息后，使用原通知书模块登记签发及送达。发票和金额仍在原收费记录中管理。</p>';
        if(kind==='notice')html='<p>按下方原通知书记录登记签发与送达，收件供应商与成交结果保持一致。</p>';
        if(saved.stale)html='<p role="alert">报名或采购包已变更，请重新核对报价结果。</p>'+html;
        if(d.verified && ['registration','quotation','publication'].includes(kind))html+=field('correction_reason','更正已核对资料时填写原因');
        html+=`<details><summary>本阶段办理记录</summary>${(saved.history || []).filter(h=>(h.reason || '').includes(key)).slice(0,10).map(h=>`<p>${escHtml(h.recorded_at)} · ${escHtml(h.actor)} · ${escHtml(h.reason)}</p>`).join('') || '<p>暂无本阶段记录</p>'}</details>`;
        host.innerHTML=html;
        if(kind==='registration')document.querySelectorAll('[data-online-review]').forEach(slot=>{
            const r=(d.records || []).find(r=>r.registration_id===Number(slot.dataset.onlineReview)) || {};
            slot.innerHTML=`<div class="form-grid-2"><div class="form-group"><label for="ob_review_${slot.dataset.onlineReview}">报名审核</label><select id="ob_review_${slot.dataset.onlineReview}" data-ob-review>${[['pending','待审核'],['supplement','需补正'],['approved','通过'],['rejected','不通过']].map(([v,l])=>`<option value="${v}" ${r.review===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="form-group"><label for="ob_note_${slot.dataset.onlineReview}">审核意见（补正/不通过必填）</label><input id="ob_note_${slot.dataset.onlineReview}" data-ob-review-note maxlength="2000" value="${escHtml(r.review_note || '')}"></div></div>`;
        });
        const draft=onlineBiddingDrafts.get(`${pid}:${key}`);
        if(draft) {
            onlineBiddingDraftControls(host).forEach((el,i)=>{const name=el.id || `control-${i}`;if(Object.prototype.hasOwnProperty.call(draft.values,name))el.value=draft.values[name];});
            // Keep the draft's revision so concurrent updates produce a conflict.
            host.onlineState.saved=draft.saved;
            if(draft.saved.revision!==saved.revision)host.insertAdjacentHTML('afterbegin','<p role="alert">其他阶段或用户已更新资料。当前保留了未保存内容，请先复制需要保留的信息，再读取最新资料重新核对。</p><button type="button" class="btn btn-sm" onclick="discardOnlineBiddingDraft()">放弃本阶段草稿，读取最新资料</button>');
        }
        onlineBiddingDraftControls(host).forEach(el=>{
            el.addEventListener('input',()=>captureOnlineBiddingDraft(host));
            el.addEventListener('change',()=>captureOnlineBiddingDraft(host));
        });
    }catch(error){if(host.isConnected)host.innerHTML=`<p role="alert">${escHtml(error.message || '读取失败，请重新打开阶段')}</p>`;}
}

async function saveOnlineBiddingInline(stageData) {
    const host=document.getElementById('onlineBiddingInline');
    if(!host)return;
    const state=host.onlineState;
    if(!state)throw new Error('本阶段业务信息尚未读取完成，请稍后重试');
    if(host.onlineSaving)throw new Error('正在保存，请稍候');
    const {saved,project,key,kind}=state;
    if(currentProject?.id!==project.id || editingStageKey!==key)throw new Error('项目已切换，请重新打开阶段');
    const data=JSON.parse(JSON.stringify(saved.data || {}));
    // Archiving uses the existing stage and checklist, not a second ledger flag.
    data.archive_checked=false;
    const reason=host.querySelector('[data-ob-field="correction_reason"]')?.value.trim() || '';
    host.querySelectorAll('[data-ob-field]').forEach(el=>{if(el.dataset.obField!=='correction_reason')data[el.dataset.obField]=el.value.trim();});
    data.records=(project.registrations || []).map(r=>({...((data.records || []).find(row=>row.registration_id===r.id) || {registration_id:r.id,review:'pending',review_note:'',amount:'',quoted_at:''})}));
    if(kind==='registration')document.querySelectorAll('[data-online-review]').forEach(el=>{
        const r=data.records.find(r=>r.registration_id===Number(el.dataset.onlineReview));
        if(r && el.querySelector('[data-ob-review]')){r.review=el.querySelector('[data-ob-review]').value;r.review_note=el.querySelector('[data-ob-review-note]').value.trim();}
    });
    if(kind==='quotation')host.querySelectorAll('[data-online-quote]').forEach(el=>{
        const r=data.records.find(r=>r.registration_id===Number(el.dataset.onlineQuote));
        if(r){r.amount=el.querySelector('[data-ob-amount]').value.trim();r.quoted_at=el.querySelector('[data-ob-quoted-at]').value;}
    });
    if(kind==='publication')data.resolutions=[...host.querySelectorAll('[data-ob-resolution]')].filter(el=>el.querySelector('[data-ob-resolution-winner]').value).map(el=>({lot_id:el.dataset.obResolution===''?null:Number(el.dataset.obResolution),registration_id:Number(el.querySelector('[data-ob-resolution-winner]').value),note:el.querySelector('[data-ob-resolution-note]').value.trim()}));
    const flag={announcement:'announcement_done',registration:'roster_locked',quotation:'verified',publication:'publication_done',fee:'notice_delivered',notice:'notice_delivered'}[kind];
    if(flag)data[flag]=Boolean(stageData.completed && !stageData.skipped);
    if(kind==='fee')data.fee_received=Boolean(data.fee_date && data.fee_reference);
    if(kind==='fee' || kind==='notice'){
        const notices=project.notice_deliveries || [];
        data.notice_date=notices.map(n=>n.pickup_date).filter(Boolean).sort().pop() || '';
        data.notice_reference=notices.length?'已关联原通知书领取/送达记录':'';
        if(key==='service_fee') {data.notice_delivered=Boolean(saved.data?.notice_delivered); data.fee_received=Boolean(stageData.completed && data.fee_date && data.fee_reference);}
    }
    if(JSON.stringify(data)===JSON.stringify(saved.data || {})) {
        onlineBiddingDrafts.delete(`${project.id}:${key}`);
        return;
    }
    host.onlineSaving=true;
    const controls=onlineBiddingDraftControls(host);
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>{el.disabled=true;});
    try{
        const response=await api('PUT',`/api/projects/${project.id}/online-bidding`,{revision:saved.revision,data,reason:reason || `阶段 ${key} 保存业务资料`,stage_key:key});
        state.saved=response;
        onlineBiddingDrafts.delete(`${project.id}:${key}`);
    }finally{host.onlineSaving=false;controls.forEach((el,i)=>{el.disabled=disabled[i];});}
}

function fillOnlineBiddingHours() {
    const start=document.getElementById('ob_start_at'),end=document.getElementById('ob_end_at');
    const date=(start?.value || end?.value || '').slice(0,10);
    if(!date){toast('请先选择竞价日期','warning');return;}
    start.value=`${date}T09:00`;end.value=`${date}T12:00`;
    captureOnlineBiddingDraft(document.getElementById('onlineBiddingInline'));
}
async function prepareOnlineBidResultForm() {
    const p = currentProject;
    try {
        const ledger = await api('GET', `/api/projects/${p.id}/online-bidding`);
        if (currentProject?.id !== p.id) return;
        const result = (ledger.summary?.lots || []).find(lot => lot.winner && !(p.bid_results || []).some(existing => existing.lot_id === lot.lot_id));
        showBidResultForm(null, result ? {lot_id:result.lot_id, winning_supplier:result.winner, winning_amount:result.amount} : null);
    } catch (error) { toast(error.message || '竞价结果读取失败', 'error'); }
}

function onlineBiddingSummaryHtml(summary, project) {
    const lots = summary.lots || [];
    return `<div role="status"><strong>${escHtml(summary.status)}</strong> · 已登记报价 ${Number(summary.quoted || 0)} / ${Number(summary.eligible || 0)} 家${summary.verified ? '（已核对）' : '（仅登记进度）'}</div>${lots.map(lot => {
        const definition = (project.lots || []).find(item => item.id === lot.lot_id);
        return `<div class="biz-sec"><div class="biz-bar"><b>${escHtml(definition ? `${definition.lot_number} ${definition.lot_name}` : '项目报价')}</b><span>${escHtml(lot.status)}</span></div><div class="biz-body">${lot.winner ? `<p><strong>最低价供应商：${escHtml(lot.winner)}　¥${escHtml(lot.amount)}</strong></p>` : ''}${(lot.quotes || []).map((r, index) => `<div class="biz-row"><span>${index + 1}. ${escHtml(r.company_name)}</span><span>¥${escHtml(r.amount)} · ${escHtml(r.quoted_at)}</span></div>`).join('') || '<p>暂无有效报价</p>'}</div></div>`;
    }).join('')}`;
}
// ── Theme-aware single-select popup; native fields remain the data source ──
(() => {
    let current = null;
    const eligible = el => el instanceof HTMLSelectElement && !el.matches(':disabled') && !el.multiple && el.size <= 1 && !el.closest('.luckysheet');
    function close() {
        if (!current) return;
        const {select, popup, observer, attributes} = current;
        current = null;
        observer.disconnect();
        popup.remove();
        for (const [name, value] of attributes) {
            if (value === null) select.removeAttribute(name);
            else select.setAttribute(name, value);
        }
    }
    function activate(index) {
        const s = current;
        if (!s || !s.items.length) return;
        s.active = Math.max(0, Math.min(index, s.items.length - 1));
        s.items.forEach((item, i) => item.element.classList.toggle('active', i === s.active));
        const item = s.items[s.active];
        s.select.setAttribute('aria-activedescendant', item.element.id);
        item.element.scrollIntoView({block:'nearest'});
    }
    function choose() {
        if (!current || !current.items.length) return close();
        const {select, items, active} = current;
        const index = items[active].index;
        const option = select.options[index];
        if (!eligible(select) || !option || option.disabled || option.parentElement.disabled || option.hidden) return close();
        const changed = select.selectedIndex !== index;
        close();
        select.selectedIndex = index;
        if (changed) {
            select.dispatchEvent(new Event('input', {bubbles:true}));
            select.dispatchEvent(new Event('change', {bubbles:true}));
        }
    }
    function open(select) {
        close();
        const popup = document.createElement('div');
        popup.className = 'themed-select-popup';
        popup.id = 'themedSelectPopup';
        popup.setAttribute('role', 'listbox');
        popup.setAttribute('aria-label', select.getAttribute('aria-label') || select.labels?.[0]?.textContent || '选项');
        const items = [];
        let group = null;
        Array.from(select.options).forEach((option, index) => {
            if (option.hidden || option.parentElement.hidden) return;
            const parent = option.parentElement;
            if (parent.tagName === 'OPTGROUP' && parent !== group) {
                group = parent;
                const heading = document.createElement('div');
                heading.className = 'themed-select-group';
                heading.textContent = parent.label;
                popup.appendChild(heading);
            }
            const el = document.createElement('div');
            el.className = 'themed-select-option';
            el.id = 'themedSelectOption' + index;
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', String(option.selected));
            el.textContent = option.label;
            if (window.PMIcons && !select.closest('[data-ui-content],[data-preserve-text],.logo')) {
                window.PMIcons.label(el,option.label,select.matches('[data-stage-template-field="icon"]')?option.label.trim():'');
                el.setAttribute('aria-label',option.label);
            }
            if (option.disabled || parent.disabled) el.setAttribute('aria-disabled', 'true');
            else {
                const position = items.length;
                items.push({element:el, index, label:option.label});
                el.addEventListener('pointermove', () => activate(position));
                el.addEventListener('click', () => { activate(position); choose(); });
            }
            popup.appendChild(el);
        });
        popup.addEventListener('mousedown', event => event.preventDefault());
        document.body.appendChild(popup);
        const attributes = ['aria-expanded','aria-controls','aria-activedescendant'].map(name => [name,select.getAttribute(name)]);
        const observer = new MutationObserver(records => {
            if (!select.isConnected || !eligible(select) || !select.getClientRects().length || records.some(record => select.contains(record.target))) close();
        });
        current = {select, popup, items, active:0, observer, attributes, search:'', typedAt:0};
        select.focus({preventScroll:true});
        select.setAttribute('aria-expanded', 'true');
        select.setAttribute('aria-controls', popup.id);
        const rect = select.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 160), innerWidth - 16);
        popup.style.width = width + 'px';
        popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
        const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
        const upwards = below < 220 && above > below;
        popup.style.maxHeight = Math.max(40, Math.min(320, upwards ? above : below)) + 'px';
        if (upwards) popup.style.bottom = (innerHeight - rect.top + 4) + 'px';
        else popup.style.top = (rect.bottom + 4) + 'px';
        activate(Math.max(0, items.findIndex(item => item.index === select.selectedIndex)));
        observer.observe(document.body, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['disabled','class','hidden','selected','label','value']});
    }
    document.addEventListener('mousedown', event => {
        if (event.button !== 0) return;
        if (eligible(event.target)) {
            event.preventDefault();
            const same = current?.select === event.target;
            close();
            if (!same) open(event.target);
        } else if (current && !current.popup.contains(event.target)) close();
    }, true);
    window.addEventListener('keydown', event => {
        const select = event.target;
        if (!current) {
            if (eligible(select) && ['ArrowDown','ArrowUp','Enter',' ','F4'].includes(event.key)) {
                event.preventDefault(); event.stopImmediatePropagation(); open(select);
            }
            return;
        }
        if (event.key === 'Tab') { choose(); return; }
        if (select !== current.select) { close(); return; }
        event.stopImmediatePropagation();
        if (event.key === 'Escape' || event.key === 'F4' || (event.altKey && event.key === 'ArrowUp')) { event.preventDefault(); close(); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
        else if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','PageDown','PageUp'].includes(event.key)) {
            event.preventDefault();
            const step = event.key === 'PageDown' ? 8 : event.key === 'PageUp' ? -8 : ['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1;
            activate(event.key === 'Home' ? 0 : event.key === 'End' ? current.items.length - 1 : current.active + step);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            const now = Date.now();
            current.search = (now - current.typedAt > 700 ? '' : current.search) + event.key.toLocaleLowerCase();
            current.typedAt = now;
            const index = current.items.findIndex(item => item.label.toLocaleLowerCase().startsWith(current.search));
            if (index >= 0) activate(index);
        }
    }, true);
    document.addEventListener('focusin', event => { if (current && event.target !== current.select) close(); });
    document.addEventListener('scroll', event => { if (current && !current.popup.contains(event.target)) close(); }, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
})();
// ── 采购人分类看板 (按单位性质分类的采购人看板) ──
let purchaserBoardData = null;
const purchaserWorkspace = {query:'', category:'', selected:'', projectQuery:'', year:'', status:'', sort:'active', directoryScroll:0, projectScroll:0};

function ensurePurchaserBoardWorkspace() {
    if (!document.querySelector('.nav-item[data-view="purchasers"]')) {
        const procureNav = document.querySelector('.nav-item[data-view="procure"]');
        if (procureNav) {
            const nav = document.createElement('div');
            nav.className = 'nav-item';
            nav.dataset.view = 'purchasers';
            nav.setAttribute('role', 'button');
            nav.setAttribute('tabindex', '0');
            nav.innerHTML = "<span class=\"nav-icon\"><span data-ui-icon='🏢'></span></span><span>按采购人分类</span>";
            nav.onclick = () => switchView('purchasers');
            nav.onkeydown = event => {
                if (event.key === 'Enter' || event.key === ' ') switchView('purchasers');
            };
            procureNav.insertAdjacentElement('afterend', nav);
        }
    }
    if (!document.getElementById('view-purchasers')) {
        const procureView = document.getElementById('view-procure');
        if (procureView) {
            const view = document.createElement('div');
            view.id = 'view-purchasers';
            view.className = 'view';
            view.innerHTML = `
                <div class="view-header">
                    <div><h2>按采购人分类</h2><p>搜索采购人，快速查找项目</p></div>
                </div>
                <div id="purchaserBoardContent"></div>`;
            procureView.insertAdjacentElement('afterend', view);
        }
    }
}

async function loadPurchaserBoard(force=false) {
    ensurePurchaserBoardWorkspace();
    const target = document.getElementById('purchaserBoardContent');
    if (!target) return;
    const key = 'purchaser-board';
    let cached = readViewCache(key);
    let cachedValue = cached?.value || purchaserBoardData;
    if (cachedValue && !force) {
        try { renderPurchaserBoard(cachedValue); }
        catch (error) { console.error('采购人缓存显示失败，重新读取', error); invalidateViewCache(key); cached = null; cachedValue = null; purchaserBoardData = null; force = true; }
    }
    if (cached?.fresh && !force) return;
    if (!cachedValue) showViewLoading('purchaserBoardContent');
    try {
        const result = await requestViewData(
            key,
            () => api('GET', '/api/settings?purchaser_board_view=bootstrap'),
            {force},
        );
        if (!result.accepted) return;
        renderPurchaserBoard(result.value);
        purchaserBoardData = result.value;
        writeViewCache(key, purchaserBoardData);
    } catch(e) {
        if (cachedValue) {
            toast('最新采购人分类刷新失败，当前显示缓存', 'warning');
            return;
        }
        renderViewLoadError('purchaserBoardContent', '采购人分类加载失败', () => loadPurchaserBoard(true), e);
    }
}

function purchaserCategoryColor(category) {
    const color = category && String(category.color || '').trim();
    return /^#[0-9a-f]{6}$/i.test(color) ? color : '#6b7280';
}

function rebuildPurchaserUnitIndex(data) {
    purchaserUnitByName.clear();
    for (const group of data?.groups || []) {
        for (const unit of group.units || []) {
            if (unit?.name) purchaserUnitByName.set(unit.name, unit);
        }
    }
}

function purchaserTextMatches(text, query) {
    return String(query || '').trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
        .every(word => String(text || '').toLocaleLowerCase().includes(word));
}

function purchaserVisibleUnits() {
    return (purchaserBoardData?.groups || []).flatMap(group => {
        const categoryKey = group.category ? String(group.category.id) : 'unclassified';
        if (purchaserWorkspace.category && purchaserWorkspace.category !== categoryKey) return [];
        return (group.units || []).filter(unit => purchaserTextMatches(unit.name, purchaserWorkspace.query))
            .map(unit => ({unit,group}));
    }).sort((a,b) => String(b.unit.recent_project || '').localeCompare(String(a.unit.recent_project || ''))
        || String(a.unit.name).localeCompare(String(b.unit.name),'zh-CN',{numeric:true}));
}

function purchaserProjectStatus(project) {
    return project.is_terminated ? (project.terminated_type || 'terminated') : Number(project.progress) >= 100 ? 'done' : 'active';
}

function purchaserUnitProjects(unit) {
    return [...new Set(unit?.project_ids || [])].map(id => projectById.get(Number(id))).filter(Boolean);
}

function purchaserFilteredProjects(projects) {
    return projects.filter(p => purchaserTextMatches([p.name,p.number].join(' '),purchaserWorkspace.projectQuery)
        && (!purchaserWorkspace.year || String(p.year) === purchaserWorkspace.year)
        && (!purchaserWorkspace.status || (purchaserWorkspace.status === 'terminated' ? Boolean(p.is_terminated) : purchaserProjectStatus(p) === purchaserWorkspace.status)))
        .sort((a,b) => {
            if (purchaserWorkspace.sort === 'active') {
                const activity = Number(purchaserProjectStatus(a) !== 'active') - Number(purchaserProjectStatus(b) !== 'active');
                if (activity) return activity;
            }
            return String(b.number || '').localeCompare(String(a.number || ''),'zh-CN',{numeric:true}) || Number(b.id)-Number(a.id);
        });
}

function resetPurchaserProjectFilters() {
    Object.assign(purchaserWorkspace,{projectQuery:'',year:'',status:'',sort:'active',projectScroll:0});
}

function renderPurchaserBoard(data) {
    const target = document.getElementById('purchaserBoardContent');
    if (!target) return;
    purchaserBoardData = data;
    rebuildPurchaserUnitIndex(data);
    const groups = Array.isArray(data.groups) ? data.groups : [];
    const admin = Boolean(currentIsAdmin && data.is_admin);
    if (purchaserWorkspace.category && !groups.some(g => (g.category ? String(g.category.id) : 'unclassified') === purchaserWorkspace.category)) purchaserWorkspace.category = '';
    const shellHTML = `<div class="purchaser-board-shell purchaser-search-workspace">
        <section class="purchaser-directory" aria-label="采购人目录">
            <header class="purchaser-directory-header"><h3>采购人 <small>${purchaserUnitByName.size} 家</small></h3>${admin ? '<button class="btn btn-secondary btn-sm admin-control" onclick="showPurchaserCategoryManager()">分类管理</button>' : ''}</header>
            <div class="purchaser-directory-filters"><label for="purchaserUnitQuery">搜索采购人</label><input id="purchaserUnitQuery" type="search" placeholder="输入采购人名称" value="${escHtml(purchaserWorkspace.query)}" oninput="setPurchaserDirectoryFilter('query',this.value)">
                <label for="purchaserUnitCategory">单位分类</label><select id="purchaserUnitCategory" onchange="setPurchaserDirectoryFilter('category',this.value)"><option value="">全部分类</option>${groups.map(g => `<option value="${escHtml(g.category ? String(g.category.id) : 'unclassified')}">${escHtml(g.name)}（${(g.units || []).length}）</option>`).join('')}</select>
            </div><div id="purchaserDirectoryCount" class="purchaser-result-count" aria-live="polite"></div>
            <div id="purchaserUnitResults" class="purchaser-directory-results" onscroll="purchaserWorkspace.directoryScroll=this.scrollTop"></div>
        </section><section id="purchaserProjectPane" class="purchaser-project-pane" aria-label="采购人项目"></section>
    </div>`;
    if (!target.querySelector('.purchaser-search-workspace')) target.innerHTML = shellHTML;
    else {
        const fresh = document.createElement('div');fresh.innerHTML = shellHTML;
        target.querySelector('.purchaser-directory-header').innerHTML = fresh.querySelector('.purchaser-directory-header').innerHTML;
        const category = document.getElementById('purchaserUnitCategory');
        const options = fresh.querySelector('#purchaserUnitCategory').innerHTML;
        if (category.innerHTML !== options) category.innerHTML = options;
    }
    document.getElementById('purchaserUnitCategory').value = purchaserWorkspace.category;
    const queryInput = document.getElementById('purchaserUnitQuery');
    if (queryInput.value !== purchaserWorkspace.query) queryInput.value = purchaserWorkspace.query;
    renderPurchaserDirectoryResults();
    if (typeof applyStableVisualSemantics === 'function') applyStableVisualSemantics(target);
}

function renderPurchaserDirectoryResults() {
    const target = document.getElementById('purchaserUnitResults');
    if (!target) return;
    const units = purchaserVisibleUnits();
    if (!units.some(({unit}) => unit.name === purchaserWorkspace.selected)) {
        purchaserWorkspace.selected = units[0]?.unit.name || '';
        resetPurchaserProjectFilters();
    }
    document.getElementById('purchaserDirectoryCount').textContent = `显示 ${units.length} / ${purchaserUnitByName.size} 家`;
    target.innerHTML = units.map(({unit,group}) => {
        const date = String(unit.recent_project || '').match(/^\d{4}-\d{2}-\d{2}/)?.[0];
        return `<button type="button" class="purchaser-unit-open purchaser-directory-item ${unit.name === purchaserWorkspace.selected ? 'selected' : ''}" aria-pressed="${unit.name === purchaserWorkspace.selected}" data-purchaser-name="${escHtml(unit.name)}" style="--purchaser-category-color:${purchaserCategoryColor(group.category)}" onclick="openPurchaserProjects(this.dataset.purchaserName)">
            <span class="purchaser-unit-name">${escHtml(unit.name)}</span><span class="purchaser-directory-meta"><span>${escHtml(group.name)}</span><b>${Number(unit.project_count) || 0} 个项目</b></span>${date ? `<span class="purchaser-recent-date">最近项目 ${date}</span>` : ''}</button>`;
    }).join('') || '<div class="purchaser-empty"><p>没有匹配的采购人</p><button class="btn btn-secondary btn-sm" onclick="clearPurchaserDirectoryFilters()">清除筛选</button></div>';
    target.scrollTop = purchaserWorkspace.directoryScroll;
    renderPurchaserProjectPane();
}

function setPurchaserDirectoryFilter(key,value) {
    if (!['query','category'].includes(key)) return;
    purchaserWorkspace[key] = String(value || '');
    purchaserWorkspace.directoryScroll = 0;
    renderPurchaserDirectoryResults();
}

function clearPurchaserDirectoryFilters() {
    Object.assign(purchaserWorkspace,{query:'',category:'',directoryScroll:0});
    document.getElementById('purchaserUnitQuery').value = '';
    document.getElementById('purchaserUnitCategory').value = '';
    renderPurchaserDirectoryResults();
}

function openPurchaserProjects(name) {
    const unit = purchaserUnitByName.get(name);
    if (!unit) { toast('找不到该采购人单位', 'error'); return; }
    if (purchaserWorkspace.selected !== name) {
        purchaserWorkspace.selected = name;
        resetPurchaserProjectFilters();
    }
    document.querySelectorAll('#purchaserUnitResults .purchaser-unit-open').forEach(el => {
        const selected = el.dataset.purchaserName === name;
        el.classList.toggle('selected',selected);el.setAttribute('aria-pressed',String(selected));
    });
    renderPurchaserProjectPane();
    if (typeof matchMedia === 'function' && matchMedia('(max-width:760px)').matches) document.getElementById('purchaserProjectPane')?.scrollIntoView({block:'start'});
}

function renderPurchaserProjectPane() {
    const target = document.getElementById('purchaserProjectPane');
    if (!target) return;
    const unit = purchaserUnitByName.get(purchaserWorkspace.selected);
    if (!unit) { target.innerHTML = '<div class="purchaser-empty">选择采购人查看项目</div>';return; }
    const projects = purchaserUnitProjects(unit);
    const years = [...new Set(projects.map(p => String(p.year || '')).filter(Boolean))].sort((a,b) => b.localeCompare(a,'zh-CN',{numeric:true}));
    if (purchaserWorkspace.year && !years.includes(purchaserWorkspace.year)) purchaserWorkspace.year = '';
    const group = (purchaserBoardData.groups || []).find(g => (g.units || []).some(u => u.name === unit.name));
    const paneHTML = `<header class="purchaser-project-heading"><div><h3>${escHtml(unit.name)}</h3><p>${escHtml(group?.name || '未分类')} · ${projects.length} 个项目${Number(unit.project_count) > projects.length ? `（登记 ${Number(unit.project_count)} 个）` : ''}</p></div>${currentIsAdmin && purchaserBoardData.is_admin ? '<button class="btn btn-secondary btn-sm admin-control" id="purchaserMoveCurrent">移动分类</button>' : ''}</header>
        <div class="purchaser-project-filters"><div class="purchaser-project-search"><label for="purchaserProjectQuery">搜索项目</label><input type="search" id="purchaserProjectQuery" placeholder="项目名称或编号" value="${escHtml(purchaserWorkspace.projectQuery)}" oninput="setPurchaserProjectFilter('query',this.value)"></div>
        <div><label for="purchaserProjectYear">年份</label><select id="purchaserProjectYear" onchange="setPurchaserProjectFilter('year',this.value)"><option value="">全部年份</option>${years.map(year=>`<option value="${escHtml(year)}">${escHtml(year)}年</option>`).join('')}</select></div>
        <div><label for="purchaserProjectStatus">状态</label><select id="purchaserProjectStatus" onchange="setPurchaserProjectFilter('status',this.value)"><option value="">全部状态</option><option value="active">进行中</option><option value="done">已完成</option><option value="terminated">已关闭（含流标、废标）</option></select></div>
        <div><label for="purchaserProjectSort">排序</label><select id="purchaserProjectSort" onchange="setPurchaserProjectFilter('sort',this.value)"><option value="active">进行中优先</option><option value="number">编号倒序</option></select></div></div>
        <div id="purchaserProjectCount" class="purchaser-result-count" aria-live="polite"></div><div id="purchaserProjectResults" class="purchaser-project-results" onscroll="purchaserWorkspace.projectScroll=this.scrollTop"></div>`;
    if (target.dataset.unitName !== unit.name || !target.querySelector('#purchaserProjectQuery')) {
        target.innerHTML = paneHTML;target.dataset.unitName = unit.name;
    } else {
        const fresh = document.createElement('div');fresh.innerHTML = paneHTML;
        target.querySelector('.purchaser-project-heading').innerHTML = fresh.querySelector('.purchaser-project-heading').innerHTML;
        const year = document.getElementById('purchaserProjectYear'),options = fresh.querySelector('#purchaserProjectYear').innerHTML;
        if (year.innerHTML !== options) year.innerHTML = options;
    }
    const move = document.getElementById('purchaserMoveCurrent');if (move) move.onclick = () => showMovePurchaser(unit.name);
    document.getElementById('purchaserProjectYear').value = purchaserWorkspace.year;
    document.getElementById('purchaserProjectStatus').value = purchaserWorkspace.status;
    document.getElementById('purchaserProjectSort').value = purchaserWorkspace.sort;
    const queryInput = document.getElementById('purchaserProjectQuery');
    if (queryInput.value !== purchaserWorkspace.projectQuery) queryInput.value = purchaserWorkspace.projectQuery;
    renderPurchaserProjectResults();
}

function renderPurchaserProjectResults() {
    const target = document.getElementById('purchaserProjectResults');if (!target) return;
    const projects = purchaserUnitProjects(purchaserUnitByName.get(purchaserWorkspace.selected));
    const filtered = purchaserFilteredProjects(projects);
    document.getElementById('purchaserProjectCount').textContent = `显示 ${filtered.length} / ${projects.length} 个项目`;
    target.innerHTML = filtered.map(project => {
        const status = projectStatusInfo(project),stage = project.current_stage_key ? projectStageDefinition(project.current_stage_key,project).name : '—';
        return `<article class="purchaser-project-row" data-project-id="${Number(project.id)}"><button type="button" class="purchaser-project-open" onclick="selectProject(${Number(project.id)})">
            <span class="purchaser-project-identity"><span class="pc-number">${escHtml(project.number)}</span><strong>${escHtml(project.name)}</strong><span class="purchaser-project-stage">${escHtml(project.method || '未设置采购方式')} · ${escHtml(stage)}</span></span><span class="purchaser-project-state"><span class="mini-status ${status.cls}"><span data-ui-icon="${escHtml(status.icon)}"></span> ${status.text}</span><span style="color:${getProgressColor(project.progress)}">${Number(project.progress) || 0}%</span></span></button>
            ${project.second_tender ? `<button type="button" class="purchaser-retender-link" data-retender-id="${Number(project.second_tender.id) || 0}">↪ 二次招标：${escHtml(project.second_tender.number)}</button>` : ''}</article>`;
    }).join('') || `<div class="purchaser-empty"><p>${projects.length ? '没有匹配的项目' : '暂无可显示项目'}</p>${projects.length ? '<button class="btn btn-secondary btn-sm" onclick="clearPurchaserProjectFilters()">清除项目筛选</button>' : ''}</div>`;
    target.querySelectorAll('.purchaser-retender-link').forEach(button => { button.onclick = () => { if (Number(button.dataset.retenderId)) selectProject(Number(button.dataset.retenderId)); }; });
    target.scrollTop = purchaserWorkspace.projectScroll;
}

function setPurchaserProjectFilter(key,value) {
    const field = key === 'query' ? 'projectQuery' : key;
    if (!['projectQuery','year','status','sort'].includes(field)) return;
    purchaserWorkspace[field] = String(value || '');purchaserWorkspace.projectScroll = 0;
    renderPurchaserProjectResults();
}

function clearPurchaserProjectFilters() {
    resetPurchaserProjectFilters();renderPurchaserProjectPane();
}

function showPurchaserCategoryManager() {
    if (!currentIsAdmin || !purchaserBoardData?.is_admin) return;
    const categories = purchaserBoardData.categories || [];
    const rows = categories.map(category => `<div class="purchaser-category-row">
        <span class="method-dot" style="background:${purchaserCategoryColor(category)}"></span>
        <b>${escHtml(category.name)}</b><span class="muted-text">排序 ${Number(category.sort_order) || 0}</span>
        <button class="btn btn-secondary btn-sm" onclick="editPurchaserCategory(${category.id})">编辑</button>
        <button class="btn btn-danger btn-sm" onclick="deactivatePurchaserCategory(${category.id})">停用</button>
    </div>`).join('');
    showModal('采购人分类管理', `<div class="purchaser-category-manager">
        <button class="btn btn-primary btn-sm" onclick="editPurchaserCategory()">+ 新增分类</button>
        ${rows || '<div class="col-empty">还没有自定义分类</div>'}
        <div class="settings-note">"未分类"为系统固定分组，无需维护。系统已按单位名称自动识别性质分类。</div>
    </div>`);
}

function editPurchaserCategory(categoryId=null) {
    const category = (purchaserBoardData?.categories || []).find(item => Number(item.id) === Number(categoryId));
    showModal(category ? '编辑采购人分类' : '新增采购人分类', `<div class="modal-form">
        <div class="form-group"><label>分类名称</label><input id="purchaserCategoryName" maxlength="40" value="${escHtml(category?.name || '')}"></div>
        <div class="form-group"><label>标识颜色</label><input id="purchaserCategoryColor" type="color" value="${purchaserCategoryColor(category)}"></div>
        <div class="form-group"><label>显示顺序</label><input id="purchaserCategoryOrder" type="number" value="${Number(category?.sort_order) || 0}"></div>
    </div>`, async () => {
        const name = document.getElementById('purchaserCategoryName').value.trim();
        if (!name) { toast('请输入分类名称', 'warning'); return false; }
        await api('PATCH', '/api/settings', {
            purchaser_board_action: 'upsert_category',
            id: category?.id,
            name,
            color: document.getElementById('purchaserCategoryColor').value,
            sort_order: Number(document.getElementById('purchaserCategoryOrder').value) || 0,
        });
        closeModal();
        await loadPurchaserBoard(true);
        toast('采购人分类已保存', 'success');
    });
}

async function deactivatePurchaserCategory(categoryId) {
    const category = (purchaserBoardData?.categories || []).find(item => Number(item.id) === Number(categoryId));
    if (!category || !await confirmDialog('停用分类', `确定停用"${category.name}"？`, '停用', 'btn-danger')) return;
    try {
        await api('PATCH', '/api/settings', {purchaser_board_action: 'deactivate_category', id: categoryId});
        closeModal();
        await loadPurchaserBoard(true);
        toast('分类已停用', 'success');
    } catch(e) {
        toast('❌ ' + e.message, 'error');
    }
}

function showMovePurchaser(name) {
    if (!currentIsAdmin || !purchaserBoardData?.is_admin) return;
    const categories = purchaserBoardData.categories || [];
    const currentGroup = (purchaserBoardData.groups || []).find(group => (group.units || []).some(unit => unit.name === name));
    const currentId = currentGroup?.category?.id ?? '';
    const options = ['<option value="">未分类</option>', ...categories.map(category => `<option value="${category.id}" ${Number(category.id) === Number(currentId) ? 'selected' : ''}>${escHtml(category.name)}</option>`)].join('');
    showModal('移动采购人分类', `<div class="modal-form">
        <p class="purchaser-moving-name">${escHtml(name)}</p>
        <div class="form-group"><label>目标分类</label><select id="purchaserMoveCategory">${options}</select></div>
    </div>`, async () => {
        const raw = document.getElementById('purchaserMoveCategory').value;
        await api('PATCH', '/api/settings', {
            purchaser_board_action: 'move_purchaser',
            purchaser_name: name,
            category_id: raw === '' ? null : Number(raw),
        });
        closeModal();
        await loadPurchaserBoard(true);
        toast('采购人单位分类已更新', 'success');
    });
}

// ── Init (带全局Loading) ──
async function init() {
    document.title = '项目管理系统';
    enhanceApplicationShell();
    installChartBoardShell();
    ensurePurchaserBoardWorkspace();
    showLoading('正在加载项目数据...');
    try {
        currentIsAdmin = (window.CURRENT_USER || {}).is_admin || false;
        const [info] = await Promise.all([
            systemInfo ? Promise.resolve(systemInfo) : api('GET', '/api/system-info'),
            loadAllProjects(),
        ]);
        systemInfo = info;
        const license = systemInfo.license || {};
        if (license.expires_at) {
            const days = Math.ceil((new Date(license.expires_at + 'T23:59:59') - new Date()) / 86400000);
            if (days <= 30) toast(days < 0 ? '授权已到期，当前为只读模式' : `授权将在 ${days} 天后到期`, 'warning');
        }
        const manageBtn = document.getElementById('sidebarManageBtn');
        if (manageBtn) manageBtn.style.display = currentIsAdmin ? '' : 'none';
        if (typeof startDeviceAdmissionSummaryPolling === 'function') startDeviceAdmissionSummaryPolling();
        hideLoading();
        playViewEnter(document.querySelector('.view.active'));
        loadDashboard().finally(prefetchCommonViews);
    } catch(e) {
        hideLoading();
        toast('❌ 初始化失败：' + e.message, 'error');
    }
}

// ── 数据导出 ──
async function exportData() {
    try {
        showLoading('正在生成Excel...');
        const year = document.getElementById('exportYearSelect')?.value || '';
        const saveMode = isDesktopApp() ? 'save=1' : 'download=1';
        const url = `/api/export?${saveMode}${year ? `&year=${encodeURIComponent(year)}` : ''}`;
        const resp = await localFetch(url);
        if (!resp.ok) {
            const err = await resp.json().catch(() => ({ error: `HTTP ${resp.status}` }));
            throw new Error(err.error || '导出失败');
        }
        if (!isDesktopApp()) {
            const blob = await resp.blob();
            const objectUrl = URL.createObjectURL(blob);
            const cd = resp.headers.get('Content-Disposition') || '';
            let filename = `项目列表_${year || '全部年份'}_${new Date().toISOString().slice(0,10)}.xlsx`;
            const utf8m = cd.match(/filename\*=UTF-8''(.+)$/);
            const fm = cd.match(/filename="([^"]+)"/);
            if (utf8m) filename = decodeURIComponent(utf8m[1]);
            else if (fm) filename = fm[1];
            // 文件名白名单净化：剥离路径分隔符与控制字符，防止任意路径/命令注入
            filename = String(filename).replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+/, '').slice(0, 200) || '项目列表.xlsx';
            const a = document.createElement('a');
            a.href = objectUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
            hideLoading();
            toast('已交给浏览器下载', 'success');
            return;
        }
        const result = await resp.json();
        hideLoading();
        showModal('导出成功', `
            <div class="export-result">
                <div class="export-result-icon"><span data-ui-icon='✓'></span></div>
                <div>
                    <h4>${escHtml(result.filename || '项目列表.xlsx')}</h4>
                    <p>已保存到文件保存位置：</p>
                    <code>${escHtml(result.path || '')}</code>
                    <p class="muted-text">筛选年份：${result.year ? escHtml(result.year) : '全部年份'}；项目数：${result.count ?? '-'}</p>
                </div>
            </div>
            <button class="btn btn-primary btn-block" onclick="closeModal()">知道了</button>
        `);
    } catch(e) {
        hideLoading();
        toast('❌ 导出失败：' + e.message, 'error');
    }
}

// ── Touch Gesture Support (触摸手势支持) ──
let touchStartTime = 0;
let touchStartX = 0;
let touchStartY = 0;
let touchedElement = null;

// 长按检测（用于显示更多选项）
document.addEventListener('touchstart', e => {
    if (!e.touches || e.touches.length !== 1) return;
    touchStartTime = Date.now();
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchedElement = e.target.closest('.sidebar-project, .task-card, .compact-item, .calendar-event');
}, {passive: true});

document.addEventListener('touchend', e => {
    if (!touchedElement) return;
    const holdTime = Date.now() - touchStartTime;

    // 长按超过500ms触发
    if (holdTime > 500 && Math.abs(touchStartX - e.changedTouches[0].clientX) < 15 &&
        Math.abs(touchStartY - e.changedTouches[0].clientY) < 15) {
        onLongPress(touchedElement);
        // 阻止后续click事件
        e.preventDefault();
    }

    touchedElement = null;
}, {passive: true});

function onLongPress(el) {
    // 项目列表长按：显示快捷菜单
    if (el.classList.contains('sidebar-project')) {
        const projectId = el.getAttribute('onclick')?.match(/\d+/)?.[0];
        if (projectId) {
            const p = projectById.get(Number(projectId));
            if (p) {
                const status = projectStatusInfo(p);
                showModal(`项目：${p.name}`, `
                    <div style="padding:8px 0">
                        <div style="font-size:14px;color:var(--text2);margin-bottom:12px">${escHtml(p.number)} · <span data-ui-icon="${escHtml(status.icon)}"></span> ${status.text} · ${p.progress}%</div>
                        <button class="btn btn-primary btn-block" onclick="closeModal();selectProject(${p.id})">打开详情</button>
                        ${p.progress < 100 && !p.is_terminated ?
                            `<button class="btn btn-success btn-block" style="margin-top:8px" onclick="closeModal();selectProject(${p.id});setTimeout(()=>openStageSlide(stageKeyFromToken('${stageKeyToken(p.current_stage_key)}')),300)"><span data-ui-icon='✅'></span> 编辑当前阶段</button>` : ''}
                    </div>
                `);
            }
        }
    }
    // 看板卡片长同：直接打开编辑
    else if (el.classList.contains('task-card')) {
        const stageKey = el.dataset.stageKey;
        if (stageKey) openStageSlide(stageKey);
    }
}

// 检测是否为触摸设备
function isTouchDevice() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
}

// 延迟到当前脚本（整段 bundle）同步求值完成后再启动，避免顶层 `let`
// 声明位于本文件之后的模块（如 09-command-center.js 的 commandMotionPreference）
// 尚未初始化就进入 init()，从而触发 temporal dead zone 报错并中断初始化
// （该报错会让动态的「按采购人分类 / 图表看板」侧栏入口无法插入）。
if (typeof document !== 'undefined' && document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    setTimeout(init, 0);
}

for (const eventName of ['input', 'change', 'compositionstart']) {
    document.addEventListener(eventName, event => {
        if (!event.target?.closest?.('.sidebar') && isApplicationTextInput(event.target)) {
            projectEditVersion += 1;
        }
    }, true);
}

document.addEventListener('keydown', e => {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openCommandPalette();
        return;
    }
    // Close only the top layer, preserving forms underneath it.
    if (e.key === 'Escape') {
        if (document.getElementById('commandPalette')?.classList.contains('open')) {
            closeCommandPalette();
            return;
        }
        const dialog = topManagedDialog();
        if (dialog) {
            e.preventDefault();
            dialog.close();
            return;
        }
        closeCommandPalette();
        closeModal();
        closeSlide();
        const userMenu = document.getElementById('userMenu');
        if (userMenu?.classList.contains('open')) userMenu.classList.remove('open');
        return;
    }

    const activeDialog = topManagedDialog();
    if (activeDialog) {
        if ((e.ctrlKey || e.metaKey) && ['e', 's', 'n'].includes(e.key.toLowerCase())) {
            e.preventDefault();
            if (e.key.toLowerCase() === 'e' && activeDialog.container.id === 'modal') {
                const saveBtn = activeDialog.container.querySelector('#modalSaveBtn, #npCreateBtn, [data-dialog-submit]');
                if (saveBtn && !saveBtn.disabled) saveBtn.click();
            }
        }
        return;
    }

    // ── Ctrl+E / Cmd+E: 快速保存(当有表单打开时) ──
    if ((e.ctrlKey || e.metaKey) && e.key === 'e') {
        e.preventDefault();
        // 尝试保存当前打开的编辑面板
        if (document.getElementById('slidePanel').classList.contains('open') && editingStageKey) {
            saveStageAndClose();
        } else if (document.getElementById('modal').classList.contains('open')) {
            // 如果是新建/编辑项目模态框，尝试保存
            const saveBtn = document.querySelector('#modalBody .btn-primary');
            if (saveBtn) saveBtn.click();
        }
        return;
    }

    // ── Ctrl+N / Cmd+N: 新建项目 ──
    if ((e.ctrlKey || e.metaKey) && e.key === 'n') {
        e.preventDefault();
        showNewProjectModal();
        return;
    }

    // ── Ctrl+S / Cmd+S: 保存当前信息页(防止浏览器默认保存) ──
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        // 如果当前在项目信息tab，触发保存
        if (currentProject && document.getElementById('view-project').classList.contains('active')
            && document.getElementById('tab-info').classList.contains('active')
            && !document.getElementById('slidePanel').classList.contains('open')) {
            saveProjectInfo();
        }
        return;
    }

    // ── 数字键1-4: 切换项目Tab(看板/进度/任务/信息) ──
    if (currentProject && !e.isComposing && !e.ctrlKey && !e.metaKey && !e.altKey &&
        !isApplicationTextInput(e.target) &&
        !document.querySelector('.modal-overlay.open,.slide-panel.open,#docPreviewOverlay.open') &&
        document.getElementById('view-project').classList.contains('active')) {
        const tabMap = {'1': 'board', '2': 'timeline', '3': 'tasks', '4': 'info'};
        if (tabMap[e.key]) {
            switchProjectTab(tabMap[e.key]);
            return;
        }
    }
});

window.addEventListener('pagehide', cleanupChartBoardLifecycle);
