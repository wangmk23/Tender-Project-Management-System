// ── Load & Render Projects ──
let sidebarDataVersion = 0;
let sidebarRenderSignature = '';
let sidebarMethodFilter = '';
let sidebarPage = 0, sidebarPageFilter = '', sidebarLastSelection = null;
const SIDEBAR_PAGE_SIZE = 100;

function setSidebarPage(page) {
    sidebarPage = Math.max(0, Number(page) || 0);
    sidebarRenderSignature = '';
    renderSidebar();
    const list = document.getElementById('projectList');
    if (list) {list.scrollTop = 0;list.tabIndex = -1;list.focus({preventScroll: true});}
}

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
    if(typeof updateUiPreference==='function'){updateUiPreference('sort',value==='asc'?'number_asc':value==='desc'?'number_desc':value);return;}
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
        select.setAttribute('aria-label', '侧栏项目排序');
        select.innerHTML = typeof readUiPreferences==='function'?'<option value="active_first">进行中优先</option><option value="number_asc">编号升序</option><option value="number_desc">编号降序</option><option value="progress_asc">进度升序</option><option value="progress_desc">进度降序</option><option value="next_plan">最近待办计划</option>':'<option value="asc">编号升序</option><option value="desc">编号降序</option>';
        select.addEventListener('change', event => setSidebarSortDirection(event.target.value));
        manageButton.parentNode.insertBefore(select, manageButton);
    }
    select.value = typeof readUiPreferences==='function'?readUiPreferences().sort:sidebarSortDirection;
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
    const methods = new Map();
    (allProjects||[]).forEach(p=>methods.set(procurementProjectKey(p),procurementProjectLabel(p)));
    procurementMethodOptions().forEach(m=>{if(!methods.has(m.id))methods.set(m.id,procurementMethodLabel(m));});
    select.innerHTML = '<option value="">全部采购方式</option>' + [...methods].map(([id,label])=>`<option value="${escHtml(id)}">${escHtml(label)}</option>`).join('');
    select.value = sidebarMethodFilter;
    return select;
}

function projectSearchText(project) {
    const status = project && typeof projectStatusInfo === 'function' ? projectStatusInfo(project).text
        : project?.is_terminated ? '已关闭' : Number(project?.progress || 0)>=100 ? '已完成' : '进行中';
    return [project?.number, project?.name, project?.purchaser, project?.method, status, project?.current_stage_name]
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
    const projects = await api('GET', '/api/projects');
    if (!Array.isArray(projects)) throw new Error('项目列表数据格式不正确，请刷新后重试');
    allProjects = projects;
    rebuildProjectIndexes(allProjects);
    invalidateProjectDerivedState();
    renderSidebar();
    scheduleActiveProjectPrefetch(allProjects);
}

function renderSidebar() {
    const list = document.getElementById('projectList');
    const methodFilter = typeof sidebarMethodFilter === 'string' ? sidebarMethodFilter : '';
    const q = (document.getElementById('searchInput')?.value || '').trim().toLocaleLowerCase();
    const selectedKey = sidebarManageMode
        ? Array.from(selectedProjectIds).sort((left, right) => Number(left) - Number(right)).join(',')
        : '';
    const preferenceSignature=globalThis.PMUiPrefs?JSON.stringify(readUiPreferences()):'';
    // Data revisions invalidate rendered rows, while only a changed user
    // filter resets navigation. Background detail prefetch must keep the page.
    const pageFilter = [q, sidebarFilter, methodFilter, sidebarSortDirection, preferenceSignature].join('|');
    if (pageFilter !== sidebarPageFilter) {sidebarPage = 0;sidebarPageFilter = pageFilter;}
    const projects = (typeof sortUiProjects === 'function' ? sortUiProjects(allProjects) : sortSidebarProjects(allProjects, sidebarSortDirection)).filter(p => {
        const filter = sidebarFilter === 'all'
            || (sidebarFilter === 'active' && !p.is_terminated && p.progress < 100)
            || (sidebarFilter === 'done' && !p.is_terminated && p.progress >= 100)
            || (sidebarFilter === 'terminated' && p.is_terminated)
            || (sidebarFilter === 'liubiao' && p.terminated_type === 'liubiao')
            || (sidebarFilter === 'feibiao' && p.terminated_type === 'feibiao')
            || (sidebarFilter === 'overdue' && projectHasOverdue(p))
            || (sidebarFilter === 'soon' && projectHasSoon(p));
        return filter && (!methodFilter || procurementProjectKey(p) === methodFilter)
            && (projectSearchById.get(Number(p.id)) || '').includes(q);
    });
    const selected = Number(currentProject?.id) || null;
    if (selected !== sidebarLastSelection) {
        const index = projects.findIndex(p => Number(p.id) === selected);
        if (index >= 0) sidebarPage = Math.floor(index / SIDEBAR_PAGE_SIZE);
        sidebarLastSelection = selected;
    }
    const pages = Math.max(1, Math.ceil(projects.length / SIDEBAR_PAGE_SIZE));
    sidebarPage = Math.min(sidebarPage, pages - 1);
    const renderSignature = [
        preferenceSignature, sidebarDataVersion,
        currentProject ? Number(currentProject.id) : '',
        q,
        sidebarFilter,
        methodFilter,
        sidebarSortDirection,
        sidebarManageMode ? 1 : 0,
        selectedKey, sidebarPage,
    ].join('|');
    if (renderSignature === sidebarRenderSignature) {
        updateManageUI();
        return;
    }
    const structureSignature = [preferenceSignature,sidebarDataVersion, q, sidebarFilter, methodFilter,
        sidebarSortDirection, sidebarManageMode ? 1 : 0, selectedKey, sidebarPage].join('|');
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
    list.innerHTML = projects.slice(sidebarPage * SIDEBAR_PAGE_SIZE, (sidebarPage + 1) * SIDEBAR_PAGE_SIZE).map(p => {
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
        const matchesMethod = !methodFilter || procurementProjectKey(p) === methodFilter;
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
        const accessibleName = [p.number, p.name, status.text].filter(Boolean).join(' · ');
        return `<div class="sidebar-project ${active}" data-project-id="${p.id}" role="button" tabindex="0" title="${escHtml(accessibleName)}" aria-label="${escHtml(accessibleName)}" style="${hidden}" onclick="${sidebarManageMode ? `toggleProjectSelection(${p.id})` : `selectProject(${p.id})`}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}">
            ${manageCheckbox}
            <span class="project-badge" style="background:${color}"></span>
            <div class="project-info">
                <div class="project-number">${typeof readUiPreferences==='function'?'<span class="sidebar-number-value">'+escHtml(p.number)+'</span>':escHtml(p.number)} <span class="mini-status ${status.cls}"><span data-ui-icon="${escHtml(status.icon)}"></span> ${status.text}</span>${p.business_deadline_summary?.overdue ? `<span class="mini-status deadline-risk">期限逾期 ${Number(p.business_deadline_summary.overdue)} 项</span>` : ''}${retenderBadge}${supplierRiskBadge}</div>
                <div class="project-name">${escHtml(p.name)}</div>
                ${typeof renderUiSidebarExtras==='function'?renderUiSidebarExtras(p):''}
            </div>
            <span class="project-pct ${pctCls}">${pct}</span>
        </div>`;
    }).join('') + (pages > 1 ? `<div class="sidebar-list-pager" role="group" aria-label="项目列表分页"><button type="button" class="btn btn-xs btn-secondary" onclick="setSidebarPage(${sidebarPage - 1})" ${sidebarPage === 0 ? 'disabled' : ''} aria-label="上一页项目">上一页</button><span role="status">${sidebarPage + 1}/${pages} 页 · 共 ${projects.length} 项</span><button type="button" class="btn btn-xs btn-secondary" onclick="setSidebarPage(${sidebarPage + 1})" ${sidebarPage + 1 === pages ? 'disabled' : ''} aria-label="下一页项目">下一页</button></div>` : '');
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
    if (manageBtn) manageBtn.textContent = sidebarManageMode ? '退出管理' : '批量管理';
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

async function refreshBusinessDeadlineOverview(pid) {
    try {
        const result = await requestProjectDetail(pid, {force: true});
        if (!result.accepted) return;
        const project = result.project;
        if (Number(currentProject?.id) === Number(pid)) {
            currentProject.business_deadline_summary = project.business_deadline_summary;
            currentProject.business_deadline_alerts = project.business_deadline_alerts;
            renderProjectTopbar();
        }
        invalidateViewCache('dashboard');
        if (typeof invalidateCommandCenterData === 'function') invalidateCommandCenterData();
        renderSidebar();
    } catch (error) {toast('期限已保存，但总览提示尚未刷新，请重新读取核对。', 'warning');}
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
async function selectProject(pid, {preserveViewOnFailure=false} = {}) {
    document.getElementById('projectLoadError')?.remove();
    if (typeof releaseAttachmentPreviewResources === 'function') {
        releaseAttachmentPreviewResources();
    }
    const key = Number(pid);
    promoteProjectPrefetch(key);
    const selectionVersion = ++projectSelectionVersion;
    const cached = projectDetailCache.get(key)
        || (currentProject && Number(currentProject.id) === key ? currentProject : null);
    let dismissLoading = null;

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
        dismissLoading = toast('正在加载项目详情…', 'loading');
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
            showProjectLoadError(key, error);
            return Number(currentProject?.id) === key;
        }
        toast('❌ 加载项目失败：' + error.message, 'error');
        showProjectLoadError(key, error);
        return false;
    } finally {
        if (typeof dismissLoading === 'function') dismissLoading();
    }
}

function showProjectLoadError(pid, error) {
    const parent = document.querySelector?.('#app > .main');
    if (!parent) return;
    const host = document.createElement('section');
    host.id = 'projectLoadError';
    host.setAttribute('role', 'alert');
    parent.prepend(host);
    const name = projectById.get(Number(pid))?.name || `项目 ${pid}`;
    renderViewLoadError(host.id, `${name} 加载失败，当前内容已保留。`, () => selectProject(pid, {preserveViewOnFailure: true}), error);
}

// ── Render Project Topbar ──
function projectBudgetDisplay(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '未设置';
    const raw = String(value).trim();
    const decimal = raw.match(/^([+-]?)(\d+)(?:\.(\d*))?$/);
    if (!decimal) return raw;
    const integer = decimal[2].replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decimal[1] + integer + '.' + (decimal[3] || '').padEnd(2, '0') + ' 元';
}

function renderProjectTopbar() {
    const p = currentProject;
    document.getElementById('projectName').textContent = p.name || '';
    document.getElementById('projectMeta').innerHTML = `
        <span>编号：${escHtml(p.number)}</span>
        <span>采购人：${escHtml(p.purchaser)}</span>
        <span>方式：${escHtml(p.method)}</span>
        <span>预算：${escHtml(projectBudgetDisplay(p.budget))}</span>
        ${p.no_deposit ? '<span>无需保证金</span>' : ''}
        <span class="project-status-pill ${projectStatusInfo(p).cls}"><span data-ui-icon="${escHtml(projectStatusInfo(p).icon)}"></span> ${projectStatusInfo(p).text}</span>
        ${p.business_deadline_summary?.overdue ? `<span class="project-status-pill deadline-risk">期限逾期 ${Number(p.business_deadline_summary.overdue)} 项</span>` : ''}
        ${p.is_terminated ? `<span style="color:var(--text2)"><span data-ui-icon="${escHtml(projectStatusInfo(p).icon)}"></span> ${projectStatusInfo(p).text}</span>` : ''}
        ${challengeBadgeHtml(p) && typeof supplierRiskBadgeHtml === 'function' ? supplierRiskBadgeHtml(p) : ''}
        ${(p.terminated_type === 'feibiao' || p.terminated_type === 'liubiao') && p.second_tender ? `<span class="retender-pill" onclick="goToSecondTender(${p.second_tender.id})" title="点击跳转到二次/重新招标项目">↪ 二次/重新招标：${escHtml(p.second_tender.number)}</span>` : ''}
    `;
    const fill = document.getElementById('progressFill');
    const txt = document.getElementById('progressText');
    fill.style.width = p.progress + '%';
    fill.classList.toggle('done', p.progress >= 100);
    txt.textContent = p.progress + '%';
    txt.setAttribute('aria-label', `项目进度 ${p.progress}%`);
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
        parts.push(`<span style="color:var(--primary)"><span data-ui-icon='📢'></span> ${stageDateTimeText(s.completed_at || s.completed_date)} 已发布</span>`);
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
        if (summary) parts.push(`<span style="color:var(--success);font-weight:600"><span data-ui-icon="${escHtml(isOnlineProcurementProject(p)?'🤝':'🏆')}"></span> ${summary}</span>`);
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
// 阶段时间是本地业务时间，直接保留用户选择的日期与时分。
function stageTimestampParts(value) {
    const raw = String(value || '').trim().replace(' ', 'T');
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
    return {date:match?.[1] || '', time:match?.[2] || ''};
}

function stageLocalMinuteNow() {
    const now = new Date();
    const pad = value => String(value).padStart(2,'0');
    return `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function stageDateTimePairValue(dateId, timeId, label, requireTime = false) {
    const dateInput = document.getElementById(dateId);
    const timeInput = document.getElementById(timeId);
    const date = dateInput?.value || '';
    const time = timeInput?.value || '';
    if ((dateInput?.checkValidity && !dateInput.checkValidity()) || (timeInput?.checkValidity && !timeInput.checkValidity())) throw new Error(`${label}格式不正确`);
    if (!date && time) throw new Error(`请填写${label}的日期`);
    if (requireTime && (!date || !time)) throw new Error(`请填写${label}的日期和时分`);
    return date ? `${date}${time ? 'T'+time : ''}` : null;
}

function stagePlanValue(value, stage) {
    const selected = stageTimestampParts(value);
    const original = stageTimestampParts(stage?.planned_at);
    return value && stage?.planned_at && selected.date===original.date && selected.time===original.time
        ? stage.planned_at : value;
}

function stageDateTimeText(value) {
    const raw = String(value || '').trim().replace(' ', 'T');
    const parts = raw.match(/^(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?/);
    return parts ? `${formatDate(parts[1])}${parts[2] ? ' '+parts[2] : ''}` : '';
}

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

    // ── 批量操作栏 ──
    let batchBar = '';
    if (stages.some(s => !s.completed && !s.skipped)) {
        batchBar = `<details class="board-tools"><summary><span data-ui-icon="⚡"></span> 批量操作</summary><div class="board-tools-actions">
            <button class="btn btn-sm btn-primary" onclick="enterBatchMode()">批量完成</button>
            <button class="btn btn-sm btn-secondary" onclick="batchSetPlannedDate()">批量设计划日期</button>
        </div></details>`;
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

    const container = document.getElementById('boardContent');
    const boardHtml = cols.map(col => {
        const cards = col.stages.map(s => {
            const isSkipped = s.skipped;
            const timing = stageTiming(s);
            let cls = isSkipped ? 'task-card task-skipped task-done' : (s.completed ? 'task-card task-done' : `task-card ${timing.cls}`);
            if (stageHasModule(s, 'result_publication', p) && challengeStateOf(p)) cls += ' task-challenge';
            const dateStr = isSkipped ? '<span data-ui-icon="⚠️"></span> 不适用' : (s.completed_date ? stageDateTimeText(s.completed_at || s.completed_date) : (plannedDate(s) ? '计划:'+stageDateTimeText(s.planned_at) : '未设置计划时间'));

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
                <div class="task-title"><button type="button" class="task-open-btn" aria-label="处理阶段：${escHtml(displayName)}" onclick="event.stopPropagation();openStageSlide(stageKeyFromToken('${keyToken}'))"><span data-ui-icon="${escHtml(definition.icon)}"></span> ${escHtml(displayName)}</button>${isSkipped ? ' <span class="task-skipped-label">(不适用)</span>' : ''}</div>
                <div class="task-detail">${dateStr} ${timing.label ? `<span class="timing-badge ${timing.cls}">${timing.label}</span>` : ''}</div>
                ${stageCardSummary(s, p)}
                <div class="task-actions">
                    ${isSkipped ? "<span style=\"font-size:11px;color:var(--text3)\"><span data-ui-icon='⚠️'></span> 已跳过</span>" :
                    `<button class="btn btn-sm ${s.completed ? 'btn-secondary' : 'btn-success'}" data-stage-toggle="${keyToken}" onclick="event.stopPropagation();toggleStage(stageKeyFromToken('${keyToken}'))">
                        ${s.completed ? '<span data-ui-icon="↩"></span> 撤销完成' : '<span data-ui-icon="✅"></span> 完成'}
                    </button>`}
                </div>
            </div>`;
        }).join('');
        return `<div class="board-col" data-board-state="${col.key}">
            <h3>${col.name} (${col.stages.length})</h3>
            <div class="board-col-body">${cards || '<div style="font-size:12px;color:var(--text3);padding:12px 0">暂无</div>'}</div>
        </div>`;
    }).join('');
    container.innerHTML = batchBar + batchToolbar + `<div class="board-columns">${boardHtml}</div>`;
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
    const pid = currentProject.id, outcome = {success: 0, skipped: [], errors: []};
    try {
        const completedAt = stageLocalMinuteNow();
        for (const key of keys) {
            try { await api('PUT', `/api/projects/${pid}/stages/${stageApiSegment(key)}`, {
                completed: true,
                completed_date: completedAt.slice(0,10),
                completed_at: completedAt
            }); outcome.success++; } catch(error) {outcome.errors.push(`${key}：${error.message}`);}
        }
        exitBatchMode();
        if (currentProject?.id === pid) await refreshProject();
    } catch(e) { outcome.warning = '操作已返回，但刷新失败：' + e.message; }
    finally { hideLoading(); }
    presentBatchOutcome('阶段批量完成结果', outcome, '个阶段');
}

function presentBatchOutcome(title, outcome, unit) {
    const errors = outcome.errors || [], skipped = outcome.skipped || [];
    const message = `成功 ${outcome.success || 0} ${unit}；失败 ${errors.length}；跳过 ${skipped.length}`;
    toast(message, errors.length || skipped.length || outcome.warning ? (outcome.success ? 'warning' : 'error') : 'success');
    if (errors.length || skipped.length || outcome.warning) {
        showModal(title, `<section class="batch-outcome"><p role="status">${escHtml(message)}</p>${outcome.warning ? `<p>${escHtml(outcome.warning)}</p>` : ''}${errors.length ? `<h4>未完成项目</h4><ul>${errors.map(item => `<li>${escHtml(typeof item === 'string' ? item : JSON.stringify(item))}</li>`).join('')}</ul>` : ''}${skipped.length ? `<h4>跳过事项</h4><ul>${skipped.map(item => `<li>${escHtml(typeof item === 'string' ? item : JSON.stringify(item))}</li>`).join('')}</ul>` : ''}</section>`);
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
        勾选阶段，填写计划日期和时分。快速填充保留已有时分，空白时分使用下方设置。原记录仅有日期时可保留。
    </div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center">
        <label style="font-size:12px;color:var(--text3)">快速填充：</label>
        <div class="stage-minute-pair" style="flex:1 1 220px;max-width:260px"><input type="date" id="batchStartDate" aria-label="快速填充起始时间" value="${today}"><input type="time" id="batchStartTime" step="60" aria-label="快速填充时分" value="09:00"></div>
        <label style="font-size:12px;color:var(--text3)">间隔</label>
        <input type="number" id="batchInterval" value="7" min="1" max="90" style="width:50px;padding:4px;border:1px solid var(--border);border-radius:4px;font-size:13px">
        <span style="font-size:12px;color:var(--text3)">天</span>
        <button class="btn btn-sm btn-secondary" onclick="fillBatchDates()">填充</button>
    </div>
    <div id="batchDateList" style="max-height:300px;overflow-y:auto">
        ${pendingStages.map(s => {
            const definition = projectStageDefinition(s, p);
            const planned = stageTimestampParts(s.planned_at || plannedDate(s));
            return `
            <div class="batch-plan-row" style="padding:8px;border-radius:6px;font-size:13px"
                   onmouseover="this.style.background='var(--surface2)'"
                   onmouseout="this.style.background='transparent'">
                <label style="display:flex;align-items:center;gap:8px;flex:1;cursor:pointer"><input type="checkbox" class="bd-cb" data-key="${escHtml(s.key)}" checked style="width:16px;height:16px"><span style="font-weight:600"><span data-ui-icon="${escHtml(definition.icon)}"></span> ${escHtml(definition.name)}</span></label>
                <div class="stage-minute-pair"><input type="date" class="bd-at" data-key="${escHtml(s.key)}" aria-label="${escHtml(definition.name)}计划日期" value="${escHtml(planned.date)}"><input type="time" class="bd-time" step="60" data-key="${escHtml(s.key)}" aria-label="${escHtml(definition.name)}计划时分" value="${escHtml(planned.time)}"></div>
            </div>
        `; }).join('')}
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
        <button class="btn btn-primary btn-block" data-dialog-submit onclick="doBatchSetDateV2()">保存计划时间</button>
        <button class="btn btn-secondary btn-block" onclick="closeModal()">取消</button>
    </div>`;
    showModal('批量设置计划时间', html);
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
            const timeInput = [...document.querySelectorAll('.bd-time')].find(input => input.dataset.key === key);
            const time = timeInput?.value || (dateInput.value.includes('T') ? dateInput.value.split('T')[1] : (document.getElementById('batchStartTime')?.value || '09:00'));
            dateInput.value = dateInput.type === 'datetime-local' ? `${date}T${time}` : date;
            if (timeInput) timeInput.value = time;
            if (dateInput.value && dateInput.checkValidity()) filled += 1;
        }
    });
    window.PMDateTime?.refresh();
    toast(`已填充 ${filled} 个阶段（间隔${interval}天）`, 'info');
}

async function doBatchSetDateV2() {
    let items;
    try { items = [...document.querySelectorAll('.bd-cb:checked')].map(cb => {
        const key = cb.dataset.key;
        const atInput = [...document.querySelectorAll('.bd-at')].find(input => input.dataset.key === key);
        const timeInput = [...document.querySelectorAll('.bd-time')].find(input => input.dataset.key === key);
        const date = atInput?.value || '', time = timeInput?.value || '';
        if ((!date && time) || (atInput?.checkValidity && !atInput.checkValidity()) || (timeInput?.checkValidity && !timeInput.checkValidity())) throw new Error('请填写有效的计划日期和时分');
        const selected = date ? `${date}${time ? 'T'+time : ''}` : '';
        return { key, planned_at: stagePlanValue(selected,currentProject?.stages?.find(stage=>stage.key===key)) };
    }).filter(item => item.planned_at); } catch(error) {toast(error.message,'warning');return;}

    if (items.length === 0) {
        toast('请至少为一个阶段设置日期', 'warning');
        return;
    }

    showLoading(`正在设置 ${items.length} 个阶段的计划日期...`);
    const pid = currentProject.id, outcome = {success: 0, skipped: [], errors: []};
    try {
        for (const item of items) {
            try {await api('PUT', `/api/projects/${pid}/stages/${stageApiSegment(item.key)}`, { planned_at: item.planned_at });outcome.success++;}
            catch (error) {outcome.errors.push(`${item.key}：${error.message}`);}
        }
        closeModal();
        if (currentProject?.id === pid) await refreshProject();
    } catch(e) {outcome.warning = '计划已提交，但刷新失败：' + e.message;}
    finally {hideLoading();}
    presentBatchOutcome('批量计划设置结果', outcome, '个阶段');
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

function batchAdvancePendingStages(project) {
    if (!project || project.is_terminated || Number(project.progress || 0) >= 100) return [];
    return (project.stages || []).filter(stage =>
        String(stage.stage_key || stage.key || '') && !stage.completed && !stage.skipped && !stage.template_removed);
}

function batchAdvanceProjectCandidates(projects = allProjects) {
    return (projects || []).filter(project => batchAdvancePendingStages(project).length > 0);
}

function batchAdvanceCandidates(method, stageKey, projects = allProjects) {
    return (projects || []).filter(project => {
        if (project.is_terminated || String(project.method || '') !== String(method || '')) return false;
        return batchAdvancePendingStages(project).some(row => String(row.stage_key || row.key || '') === String(stageKey));
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
    const date = document.getElementById('batchDateInput');
    if (!document.getElementById('batchTimeInput')) {
        const label = date.previousElementSibling;
        if (label?.tagName==='LABEL') label.textContent = '完成时间';
        const pair = document.createElement('div');
        pair.className = 'stage-minute-pair';
        date.parentElement.insertBefore(pair,date);
        pair.appendChild(date);
        const time = document.createElement('input');
        time.type = 'time'; time.id = 'batchTimeInput'; time.step = '60';
        time.setAttribute('aria-label','完成时分');
        pair.appendChild(time);
    }
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
        const activeMethods = new Set(batchAdvanceProjectCandidates().map(project => String(project.method || '')));
        methodSelect.innerHTML = clientProcurementMethods().map(method =>
            `<option value="${escHtml(method)}" ${activeMethods.has(method) ? '' : 'disabled'}>${escHtml(method)}</option>`
        ).join('');
        const firstAvailable = clientProcurementMethods().find(method => activeMethods.has(method));
        if (firstAvailable) methodSelect.value = firstAvailable;
    }
    onBatchMethodChange();

    // 填充项目下拉
    const psel = document.getElementById('batchProjectSelect');
    const active = batchAdvanceProjectCandidates();
    psel.innerHTML = '<option value="">-- 选择项目 --</option>' +
        active.map(p => `<option value="${p.id}">${escHtml(p.number)} ${escHtml(p.name)} (${p.progress}%)</option>`).join('');

    const now = stageTimestampParts(stageLocalMinuteNow());
    document.getElementById('batchDateInput').value = now.date;
    document.getElementById('batchTimeInput').value = now.time;

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

    const pending = orderProjectStages(batchAdvancePendingStages(p));
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
    document.getElementById('batchAdvanceOk').disabled = checked === 0;
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
    let completedAt;
    try {completedAt=stageDateTimePairValue('batchDateInput','batchTimeInput','完成时间',true);}
    catch(error){toast(error.message,'warning');return;}
    const completedDate = completedAt.slice(0,10);
    let projectIds, stageKey, confirmMsg;

    if (_baMode === 'stage') {
        stageKey = document.getElementById('batchStageSelect').value;
        projectIds = [...document.querySelectorAll('.ba-cb:checked')].map(cb => parseInt(cb.value));
        const method = document.getElementById('batchMethodSelect')?.value || '';
        const stageName = batchAdvanceStageDefinitions(method).find(stage => stage.key === stageKey)?.name || stageKey;
        confirmMsg = `将“${method}”下 ${projectIds.length} 个项目的「${stageName}」阶段标记为完成？\n完成时间：${completedAt.replace('T',' ')}`;
    } else {
        const pid = parseInt(document.getElementById('batchProjectSelect').value);
        projectIds = [pid];
        const stageKeys = [...document.querySelectorAll('.ba-cb:checked')].map(cb => cb.dataset.stage);
        stageKey = stageKeys.join(',');
        const p = projectById.get(pid);
        confirmMsg = `将项目「${p ? p.name : ''}」的 ${stageKeys.length} 个阶段标记为完成？\n完成时间：${completedAt.replace('T',' ')}`;
    }

    if (!projectIds.length || !stageKey) {
        toast('请至少选择一项', 'warning');
        return;
    }

    if (!await confirmDialog('确认批量推进', confirmMsg, '确认推进', 'btn-success')) return;
    if (doBatchAdvance.busy) return;
    doBatchAdvance.busy = true;
    const button = document.getElementById('batchAdvanceOk');
    if (button) {button.disabled = true;button.setAttribute('aria-busy', 'true');}
    const outcome = {success: 0, skipped: [], errors: []};
    showLoading('正在批量推进...');
    try {
        const keys = _baMode === 'project' ? stageKey.split(',') : [stageKey];
        for (const key of keys) {
            try {
                const result = await api('POST', '/api/batch/advance-stage', {
                    stage_key: key, project_ids: projectIds, completed_date: completedDate, completed_at: completedAt,
                });
                outcome.success += Number(result.advanced_count) || 0;
                outcome.skipped.push(...(Array.isArray(result.skipped) ? result.skipped : []));
                outcome.errors.push(...(Array.isArray(result.errors) ? result.errors : []));
            } catch (error) {outcome.errors.push(`${key}：${error.message}`);}
        }
        closeBatchAdvanceDialog();
        try {
            await loadAllProjects();
            if (projectIds.some(id => Number(id) === Number(currentProject?.id))) await refreshProject();
            await loadDashboard({force: true});
        } catch (error) {outcome.warning = '提交结果已返回，但列表刷新失败：' + error.message;}
        presentBatchOutcome('批量推进结果', outcome, _baMode === 'project' ? '个阶段' : '个项目');
    } finally {
        hideLoading();
        doBatchAdvance.busy = false;
        if (button) {button.disabled = false;button.removeAttribute('aria-busy');}
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
        const planStr = plannedDate(s) ? '<span data-ui-icon="📅"></span> ' + stageDateTimeText(s.planned_at) : '';
        const statusText = isSkipped ? '<span data-ui-icon="⚠️"></span> 不适用' : (isDone ? '<span data-ui-icon="✅"></span> ' + stageDateTimeText(s.completed_at || s.completed_date) : (isActive ? '<span data-ui-icon="🔵"></span> 进行中' + (planStr ? ' · ' + planStr : '') : '<span data-ui-icon="⏳"></span> ' + (planStr || '待办')));
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
    const currentKey = p.is_terminated || Number(p.progress || 0) >= 100 ? '' : String(p.current_stage_key || '');
    let html = '<p id="taskTableScrollHint" class="task-table-scroll-hint">左右滑动可查看完成时间、备注和操作。</p><div class="task-table-scroll" role="region" tabindex="0" aria-label="项目阶段任务表" aria-describedby="taskTableScrollHint"><table class="tasks-table"><thead><tr><th>阶段</th><th>状态</th><th>计划时间</th><th>完成时间</th><th>备注</th><th>操作</th></tr></thead><tbody>';
    stages.forEach(s => {
        const isSkipped = s.skipped;
        const isActive = !isSkipped && !s.completed && currentKey && String(s.key || s.stage_key || '') === currentKey;
        const tagCls = isSkipped || s.completed ? 'stage-tag done' : isActive ? 'stage-tag active' : 'stage-tag';
        const tagText = isSkipped ? '<span data-ui-icon="⚠️"></span> 不适用' : s.completed ? '<span data-ui-icon="✅"></span> 已完成' : isActive ? '<span data-ui-icon="🔵"></span> 进行中' : '<span data-ui-icon="⏳"></span> 待办';
        const definition = projectStageDefinition(s, p);
        const displayName = definition.name;
        html += `<tr>
            <td><span data-ui-icon="${escHtml(definition.icon)}"></span> ${escHtml(displayName)}${isSkipped ? ' <span style="font-size:11px;color:var(--text3)">(不适用)</span>' : ''}</td>
            <td><span class="${tagCls}">${tagText}</span></td>
            <td>${isSkipped ? '—' : (plannedDate(s) ? stageDateTimeText(s.planned_at) : '—')}</td>
            <td>${isSkipped ? '—' : (s.completed_date ? stageDateTimeText(s.completed_at || s.completed_date) : '—')}</td>
            <td>${s.notes ? escHtml(s.notes) : '—'}</td>
            <td>
                ${isSkipped ? "<span style=\"font-size:11px;color:var(--text3)\"><span data-ui-icon='⚠️'></span> 已跳过</span>" :
                `<button class="btn btn-sm ${s.completed ? 'btn-secondary' : 'btn-success'}" data-stage-toggle="${stageKeyToken(s.key)}" onclick="toggleStage(stageKeyFromToken('${stageKeyToken(s.key)}'))">${s.completed ? '撤销完成' : '完成'}</button>
                <button class="btn btn-sm btn-secondary" onclick="openStageSlide(stageKeyFromToken('${stageKeyToken(s.key)}'))">编辑</button>`}
            </td>
        </tr>`;
    });
    html += '</tbody></table></div>';
    container.innerHTML = html;
}

// ═════════════════════════════════════
