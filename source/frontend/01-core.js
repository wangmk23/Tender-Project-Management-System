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
    if(globalThis.PMUiPrefs){globalThis.PMUiPrefs.apply();return;}
    applyTheme(localStorage.getItem('pm_theme') || 'default');
}

// ── API Helper ──
let applicationAccessMode = 'unknown', applicationAccessObserver = null;
function assertApplicationWritable() {
    if (!['read_only', 'blocked'].includes(applicationAccessMode)) return;
    const error = new Error(applicationAccessMode === 'read_only' ? '当前为只读状态，不能保存修改；请先更新授权状态。' : '当前授权不可用，不能保存修改；请先核对授权。');
    error.status = 423;error.error_code = 'APPLICATION_READ_ONLY';throw error;
}
function refreshApplicationAccessControls() {
    if (!['read_only', 'blocked'].includes(applicationAccessMode)) return;
    document.querySelectorAll('button,input[type="file"],[role="button"]').forEach(node => {
        const action = node.dataset.commandAction || '';
        const code = node.getAttribute('onclick') || '';
        const writes = node.id === 'sidebarNewProjectBtn' || node.id === 'sidebarBatchDeleteBtn' || node.type === 'file'
            || ['new-project','import-projects','batch-advance'].includes(action)
            || /(?:^|[;{}])\s*(?:save\w*|delete\w*|remove\w*|toggleStage|completeStage|doCompleteStage|batchCompleteSelected|doBatch\w*|terminateProject)\s*\(/i.test(code);
        if (!writes) return;
        if ('disabled' in node && !node.disabled) {node.dataset.accessDisabled = '1';node.disabled = true;}
        else if (!('disabled' in node)) {node.dataset.accessDisabled = '1';node.setAttribute('aria-disabled', 'true');}
    });
}
function syncApplicationAccess(value) {
    const status = value?.license || value || {};
    if (!['full','read_only','blocked'].includes(status.mode)) return;
    applicationAccessMode = status.mode;
    const limited = status.mode !== 'full';
    if (!limited) {
        document.getElementById('appAccessBanner')?.remove();
        applicationAccessObserver?.disconnect();applicationAccessObserver = null;
        document.querySelectorAll('[data-access-disabled]').forEach(node => {if ('disabled' in node) node.disabled = false;node.removeAttribute('aria-disabled');delete node.dataset.accessDisabled;});
        return;
    }
    let host = document.getElementById('appAccessBanner');
    if (!host) {
        const parent = document.querySelector('#app > .main');if (!parent) return;
        host = document.createElement('section');host.id = 'appAccessBanner';host.className = 'app-access-banner';host.setAttribute('role', 'status');parent.prepend(host);
    }
    host.innerHTML = `<strong>${status.mode === 'read_only' ? '当前为只读状态' : '当前授权不可用'}</strong><p>${escHtml(status.message || '请核对授权状态后继续办理。')}</p><button type="button" class="btn btn-secondary btn-sm">刷新授权状态</button>`;
    host.querySelector('button').onclick = () => refreshApplicationAccess(true);
    refreshApplicationAccessControls();
    if (!applicationAccessObserver && typeof MutationObserver === 'function') {
        applicationAccessObserver = new MutationObserver(refreshApplicationAccessControls);
        applicationAccessObserver.observe(document.body, {childList: true, subtree: true});
    }
}
async function refreshApplicationAccess(notify = false) {
    try {const value = await api('GET', '/api/license/status');syncApplicationAccess(value);return value;}
    catch(error) {if (notify) toast('授权状态尚未刷新：' + error.message, 'warning');return null;}
}

async function localFetch(url, options = {}) {
    const parsed = new URL(url, window.location.origin);
    const isLocalApi = parsed.origin === window.location.origin
        && (parsed.pathname === '/api' || parsed.pathname.startsWith('/api/'));
    if (!isLocalApi) throw new Error('Local API request rejected');
    const {timeoutMs = 0, readBody = null, ...fetchOptions} = options;
    const controller = timeoutMs && typeof AbortController === 'function' ? new AbortController() : null;
    const parentSignal = fetchOptions.signal;
    let timedOut = false;
    const onAbort = () => controller?.abort();
    if (parentSignal?.aborted) onAbort();
    else parentSignal?.addEventListener('abort', onAbort, {once: true});
    const timer = controller ? setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs) : null;
    let abortListener = null;
    const aborted = controller ? new Promise((_, reject) => {
        abortListener = () => {const error = new Error('请求已取消');error.name = 'AbortError';reject(error);};
        if (controller.signal.aborted) abortListener();
        else controller.signal.addEventListener('abort', abortListener, {once: true});
    }) : null;
    try {
        const operation = (async () => {
            const response = await fetch(url, {...fetchOptions, signal: controller?.signal || parentSignal, credentials: 'same-origin'});
            return readBody ? {response, result: await readBody(response)} : response;
        })();
        return await (aborted ? Promise.race([operation, aborted]) : operation);
    } catch (error) {
        if (!timedOut) throw error;
        const timeout = new Error('请求超时，结果尚未确认，请刷新核实后再重试');
        timeout.error_code = 'REQUEST_TIMEOUT';
        throw timeout;
    } finally {
        if (timer !== null) clearTimeout(timer);
        parentSignal?.removeEventListener('abort', onAbort);
        if (abortListener) controller.signal.removeEventListener('abort', abortListener);
    }
}

async function readApiJsonResponse(response) {
    if (response.ok && [204, 205].includes(response.status)) return {};
    const type = response.headers?.get?.('content-type');
    if (type !== undefined && !/\bjson\b/i.test(type || '')) {
        const isLogin = response.status === 401 || (response.redirected && /\/login(?:[/?#]|$)/.test(response.url || '')) || response.status === 200;
        const error = new Error(isLogin ? '登录可能已过期，请刷新页面重新登录' : `服务暂时无法返回数据（HTTP ${response.status}），请稍后重试`);
        error.status = response.status;
        error.error_code = isLogin ? 'SESSION_EXPIRED' : 'INVALID_API_RESPONSE';
        throw error;
    }
    try { return await response.json(); }
    catch (_) {
        const error = new Error('服务器返回的数据格式不正确，请刷新后重试');
        error.status = response.status;
        error.error_code = 'INVALID_API_RESPONSE';
        throw error;
    }
}

function isCsrfFailure(status, result) {
    return [400, 403].includes(status) && /请求已过期|csrf/i.test(`${result?.error || ''} ${result?.code || result?.error_code || ''}`);
}

function formatUploadErrors(errors, files = []) {
    return (Array.isArray(errors) ? errors : []).map((item, index) => {
        if (typeof item === 'string') return item;
        const name = item?.filename || item?.name || files[index]?.name || `文件 ${index + 1}`;
        const reason = item?.error || item?.reason || item?.message;
        return `${name}：${typeof reason === 'string' ? reason : '服务器未提供明确失败原因'}`;
    });
}

async function apiForm(url, formData) {
    if (typeof assertApplicationWritable === 'function') assertApplicationWritable();
    const send = async retried => {
    const headers = {Accept: 'application/json'};
    if (window.CSRF_TOKEN) headers['X-CSRFToken'] = window.CSRF_TOKEN;
    const {response, result} = await localFetch(url, {method: 'POST', headers, body: formData, timeoutMs: 900000, readBody: readApiJsonResponse});
    if (!response.ok && !retried && isCsrfFailure(response.status, result)
        && typeof refreshAttachmentCsrfToken === 'function') {
        try { if (await refreshAttachmentCsrfToken()) return send(true); } catch (_) { /* report original rejection */ }
    }
    if (!response.ok) {
        if (response.status === 423 && typeof syncApplicationAccess === 'function') syncApplicationAccess({mode: 'read_only', message: result.error});
        const error = new Error(result.error || `HTTP ${response.status}`);
        error.errors = result.errors;
        error.status = response.status;
        error.details = result;
        throw error;
    }
    return result;
    };
    return send(false);
}

async function api(method, url, body) {
    const normalizedMethod = String(method || '').toUpperCase();
    if (!['GET','HEAD','OPTIONS'].includes(normalizedMethod) && typeof assertApplicationWritable === 'function') assertApplicationWritable();
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
    const responseProjectId = Number((projectUpdate || stageUpdate)?.[1] || 0);
    const responseBaselines = new Map((responseProjectId ? [currentProject, projectById.get(responseProjectId)] : [])
        .filter(project => Number(project?.id) === responseProjectId)
        .map(project => [project, {version: project.record_version, stages: new Map((project.stages || []).map(stage => [stage.key || stage.stage_key, stage.record_version]))}]));
    const doRequest = async (retried) => {
        const headers = {Accept: 'application/json'};
        // Large complete-list responses can legitimately exceed the ordinary
        // read budget. Keep the entire fetch and JSON body bounded together.
        const completeListRead = normalizedMethod === 'GET'
            && new URL(url, window.location.origin).pathname === '/api/projects';
        const opts = {method: normalizedMethod, headers, credentials: 'same-origin', timeoutMs: completeListRead ? 90000 : 20000};
        if (normalizedMethod !== 'GET' && window.CSRF_TOKEN) {
            headers['X-CSRFToken'] = window.CSRF_TOKEN;
        }
        if (requestBody !== undefined) {
            headers['Content-Type'] = 'application/json';
            opts.body = JSON.stringify(requestBody);
        }
        const {response, result} = await localFetch(url, {...opts, readBody: readApiJsonResponse});
        // Only an explicit pre-acceptance CSRF rejection may replay a mutation.
        if (!response.ok && !retried && isCsrfFailure(response.status, result)) {
            try {
                const refreshed = await refreshAttachmentCsrfToken();
                if (refreshed) return doRequest(true);
            } catch (e) { /* 刷新失败则走正常错误路径 */ }
        }
        if (!response.ok) {
            if (response.status === 423 && typeof syncApplicationAccess === 'function') syncApplicationAccess({mode: 'read_only', message: result.error});
            const requestError = new Error(
                result.error || (response.status === 409 ? '发生编辑冲突：该内容已被其他成员修改，请重新加载' : `HTTP ${response.status}`)
            );
            requestError.error_code = result.code || result.error_code || null;
            requestError.status = response.status;
            requestError.details = result;
            throw requestError;
        }
        return result;
    };
    const result = await doRequest(false);
    if (['POST', 'PUT', 'PATCH'].includes(normalizedMethod) && result?.record_version !== undefined) {
        responseBaselines.forEach((baseline, project) => {
            if (Number(result.id) !== Number(project.id)) return;
            const provenBase = baseline.version !== undefined && project.record_version === baseline.version
                && result.record_version_base === baseline.version;
            if (projectUpdate && provenBase) {Object.assign(project, result);return;}
            if (!stageUpdate) return;
            const key = decodeURIComponent(stageUpdate[2]);
            const local = (project.stages || []).find(stage => (stage.key || stage.stage_key) === key);
            const saved = (result.stages || []).find(stage => (stage.key || stage.stage_key) === key);
            if (local && saved && local.record_version === baseline.stages.get(key)) Object.assign(local, saved);
            if (provenBase) project.record_version = result.record_version;
        });
    }
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
    if (!el) return () => {};
    const token = (el._toastVersion || 0) + 1;
    el._toastVersion = token;
    el.textContent = msg;
    if (typeof window !== 'undefined' && window.PMIcons) window.PMIcons.label(el, msg, ({success:'✅',warning:'⚠️',error:'❌',info:'ℹ️',loading:'🔄'})[type] || 'ℹ️');
    const state = ['success', 'warning', 'error'].includes(type) ? type : 'info';
    el.className = `toast ${state}${type === 'loading' ? ' loading' : ''} show`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    el.setAttribute('aria-busy', String(type === 'loading'));
    clearTimeout(el._timer);
    const dismiss = () => {
        if (el._toastVersion !== token) return;
        el.classList.remove('show');
        el.setAttribute('aria-busy', 'false');
        clearTimeout(el._timer);
    };
    el._timer = type === 'loading' ? null : setTimeout(dismiss, 2500);
    return dismiss;
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


// CSS collapses navigation on phones and narrow desktop/tablet windows.
let sidebarViewport = null;
function initializeSidebarAccessibility() {
    if (sidebarViewport) return;
    sidebarViewport = globalThis.matchMedia?.('(max-width: 1180px)');
    sidebarViewport?.addEventListener?.('change', syncSidebarAccessibility);
    syncSidebarAccessibility();
}
function syncSidebarAccessibility() {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const collapsed = !!sidebarViewport?.matches;
    if (!collapsed && sidebar.classList.contains('open')) closeSidebar({restoreFocus: false});
    const open = collapsed && sidebar.classList.contains('open');
    const hidesFocus = collapsed && !open && sidebar.contains(document.activeElement);
    sidebar.inert = collapsed && !open;
    if (collapsed && !open) sidebar.setAttribute('aria-hidden', 'true');
    else sidebar.removeAttribute('aria-hidden');
    document.getElementById('hamburger')?.setAttribute('aria-expanded', String(open));
    document.querySelector('#app > .main')?.toggleAttribute('inert', open);
    if (!open) {
        sidebar.removeAttribute('role');
        sidebar.removeAttribute('aria-modal');
    }
    if (hidesFocus) document.getElementById('hamburger')?.focus({preventScroll: true});
}
function toggleSidebar() {
    initializeSidebarAccessibility();
    const sidebar = document.getElementById('sidebar');
    if (!sidebar || !sidebarViewport?.matches) return;
    if (sidebar.classList.contains('open')) return closeSidebar();
    sidebar.classList.add('open');
    document.getElementById('sidebarBackdrop')?.classList.add('open');
    syncSidebarAccessibility();
    activateDialogFocus(sidebar, closeSidebar);
}
function closeSidebar({restoreFocus = true} = {}) {
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return;
    const wasOpen = sidebar.classList.contains('open');
    const ownsFocus = sidebar.contains(document.activeElement);
    sidebar.classList.remove('open');
    document.getElementById('sidebarBackdrop')?.classList.remove('open');
    // Clear main.inert before restoring the hamburger's focus.
    syncSidebarAccessibility();
    if (wasOpen) releaseDialogFocus(sidebar, {restoreFocus: restoreFocus && ownsFocus});
}
// ── Format Date ──
function formatDate(iso) {
    if (!iso) return '';
    if(typeof formatDisplayDate==='function')return formatDisplayDate(String(iso).slice(0,10));
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
    return pct >= 100 ? 'var(--status-success)' : 'var(--primary)';
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
    if (!viewEl || (typeof effectiveMotionPreference==='function'&&effectiveMotionPreference()!=='normal')) return;
    viewEl.classList.remove('view-switch-in');
    void viewEl.offsetWidth; // 强制 reflow 以重启 CSS 动画
    viewEl.classList.add('view-switch-in');
    setTimeout(() => viewEl.classList.remove('view-switch-in'), 420);
}
function switchView(name, options = null) {
    const changed = !document.getElementById('view-' + name)?.classList.contains('active');
    projectNavigationVersion += 1;
    if (name !== 'settings' && typeof stopDeviceAdmissionPanelPolling === 'function') stopDeviceAdmissionPanelPolling();
    if (name !== 'dashboard' && typeof cleanupCommandCenterMotion === 'function') cleanupCommandCenterMotion();
    if (name === 'chart-board') ensureChartBoardWorkspace();
    else if (typeof cleanupChartBoardLifecycle === 'function') cleanupChartBoardLifecycle();
    if (name === 'purchasers') ensurePurchaserBoardWorkspace();
    document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
    document.getElementById('view-' + name).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n=>{
        n.classList.remove('active');
        n.removeAttribute('aria-current');
    });
    const activeNav = document.querySelector(`.nav-item[data-view="${name}"]`);
    activeNav?.classList.add('active');
    activeNav?.setAttribute('aria-current', 'page');
    activeNav?.scrollIntoView?.({block: 'nearest'});
    document.getElementById('sidebarSettingsBtn')?.classList.toggle('active', name === 'settings');
    if (name === 'settings') document.getElementById('sidebarSettingsBtn')?.setAttribute('aria-current', 'page');
    else document.getElementById('sidebarSettingsBtn')?.removeAttribute('aria-current');
    if(options?.load!==false){
    if (name === 'dashboard') loadDashboard();
    if (name === 'calendar') loadCalendar();
    if (name === 'procure') loadProcureBoard();
    if (name === 'purchasers') loadPurchaserBoard();
    if (name === 'chart-board') refreshChartBoard();
    if (name === 'settings') loadSettingsView();
    }
    playViewEnter(document.getElementById('view-' + name));
    if (changed) {
        closeSidebar({restoreFocus: false});
        const target = document.querySelector(`#view-${name} h1`) || document.getElementById('view-' + name);
        target.setAttribute('tabindex', '-1');
        target.focus({preventScroll: true});
    }
}

function switchProjectTab(name) {
    const tabs = [...document.querySelectorAll('#projectTabs .tab')];
    const selected = tabs.find(tab => tab.dataset.tab === name);
    if (!selected) return false;
    projectNavigationVersion += 1;
    tabs.forEach(tab => {
        const active = tab === selected;
        tab.classList.toggle('active', active);
        tab.setAttribute('aria-selected', String(active));
        tab.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll('.project-tab').forEach(t=>t.classList.remove('active'));
    document.getElementById('tab-' + name).classList.add('active');
    ensureProjectTabRendered(name);
    return true;
}

function handleProjectTabKeydown(event) {
    if (event.isComposing || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    const tab = event.target.closest?.('#projectTabs .tab');
    if (!tab) return;
    const tabs = [...document.querySelectorAll('#projectTabs .tab')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    event.preventDefault();
    switchProjectTab(tabs[next].dataset.tab);
    tabs[next].focus({preventScroll: true});
}

function installProjectTabKeyboard() {
    const tabs = document.getElementById('projectTabs');
    if (!tabs || tabs.dataset.keyboardBound === '1') return;
    tabs.dataset.keyboardBound = '1';
    tabs.addEventListener('keydown', handleProjectTabKeydown);
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
    const closedDetails = [...container.querySelectorAll('details:not([open])')];
    return [...container.querySelectorAll('button, input, select, textarea, summary, a[href], [tabindex], [contenteditable]')]
        .filter(node => !node.disabled && node.tabIndex >= 0 && node.getClientRects().length
            && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[inert]')
            && !closedDetails.some(details =>
                details.contains(node) && !details.querySelector(':scope > summary')?.contains(node)));
}

function focusDialogStart(container) {
    const controls = dialogControls(container);
    const target = controls.find(node => node.matches('input:not([type="checkbox"]):not([type="radio"]),select,textarea'))
        || controls[0] || container;
    for (const candidate of [target, ...controls.filter(node => node !== target), container]) {
        candidate.focus({preventScroll: true});
        if (document.activeElement === candidate) break;
    }
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

function releaseDialogFocus(container, {restoreFocus = true} = {}) {
    const index = dialogFocusStack.findIndex(entry => entry.container === container);
    if (index < 0) return;
    const [entry] = dialogFocusStack.splice(index, 1);
    if (!restoreFocus) return;
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
function showModal(modalTitle, html, onSave, options = {}) {
    closeModal.beforeClose = options.beforeClose || null;
    const {overlay, modal, title, body, footer} = resetModalState({wide: options.wide === true, sharedFooter: Boolean(onSave)});
    title.textContent = modalTitle;
    body.innerHTML = html;
    if (onSave) {
        const saveLabel = String(options.saveLabel || '保存');
        const busyLabel = String(options.busyLabel || '保存中...');
        footer.innerHTML = '<button class="btn btn-secondary" onclick="closeModal()">取消</button><button class="btn btn-primary" id="modalSaveBtn">保存</button>';
        document.getElementById('modalSaveBtn').textContent = saveLabel;
        document.getElementById('modalSaveBtn').onclick = async function() {
            this.disabled = true;
            this.setAttribute('aria-busy', 'true');
            this.classList.add('ui-state-saving');
            this.textContent = busyLabel;
            try { var result = await onSave(); if (result !== false) {} }
            catch(e) { toast('❌ ' + e.message, 'error'); }
            this.disabled = false;
            this.removeAttribute('aria-busy');
            this.classList.remove('ui-state-saving');
            this.textContent = this.dataset?.idleLabel || saveLabel;
            if (typeof refreshApplicationAccessControls === 'function') refreshApplicationAccessControls();
        };
    }
    overlay.classList.add('open');
    modal.classList.add('open');
    globalThis.PMDateTime?.refresh();
    globalThis.PMForms?.enhance(body);
    body.scrollTop = 0;
    modal.setAttribute('aria-labelledby', 'modalTitle');
    activateDialogFocus(modal, closeModal);
}
function closeModal() {
    if(closeModal.pending)return;
    if(closeModal.beforeClose){
        const guard=closeModal.beforeClose;closeModal.pending=true;
        Promise.resolve(guard()).then(allowed=>{if(allowed&&closeModal.beforeClose===guard){closeModal.beforeClose=null;closeModal.pending=false;closeModal();}}).catch(e=>toast(e.message,'error')).finally(()=>{closeModal.pending=false;});
        return;
    }
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
    globalThis.PMDateTime?.refresh();
    globalThis.PMForms?.enhance(document.getElementById('slideBody'));
    document.getElementById('slidePanel').setAttribute('aria-labelledby', 'slideTitle');
    activateDialogFocus(document.getElementById('slidePanel'), closeSlide);
}
function closeSlide() {
    if (typeof restoreDeadlineReturnContext === 'function' && restoreDeadlineReturnContext()) return;
    document.getElementById('slideBackdrop').classList.remove('open');
    document.getElementById('slidePanel').classList.remove('open');
    releaseDialogFocus(document.getElementById('slidePanel'));
}
