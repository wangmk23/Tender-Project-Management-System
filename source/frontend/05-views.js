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

let procureBoardLoadPromise = null;

async function loadProcureBoard() {
    if (procureBoardLoadPromise) return procureBoardLoadPromise;
    procureBoardLoadPromise = refreshProcureBoard();
    try {
        return await procureBoardLoadPromise;
    } finally {
        procureBoardLoadPromise = null;
    }
}

async function refreshProcureBoard() {
    showViewLoading('procureBoardContent');
    try {
        let projects = allProjects;
        if (!projects.length) {
            const result = await requestViewData('procure', () => api('GET', '/api/projects'));
            if (!result.accepted) return;
            projects = allProjects.length ? allProjects : result.value;
        }
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
        const m = procurementProjectKey(p);
        (groups[m] = groups[m] || []).push(p);
    });
    const preferred=procurementCatalog().methods.map(m=>m.id);
    const order=[...preferred.filter(m=>groups[m]),...Object.keys(groups).filter(m=>!preferred.includes(m))];
    const methodLabel=m=>procurementProjectLabel(groups[m][0]);
    const methodStyle=m=>groups[m][0].procurement?.builtin_kind||groups[m][0].method;

    const total = filteredProjects.length;
    const summary = `<div class="procure-summary">
        <span class="procure-chip procure-chip-all"><span data-ui-icon='📊'></span> 项目总数 <b>${total}</b></span>
        ${order.map(m => `<span class="procure-chip" style="border-color:${PROCURE_COLOR[methodStyle(m)] || '#6b7280'}">
            <span class="method-dot" style="background:${PROCURE_COLOR[methodStyle(m)] || '#6b7280'}"></span><span data-ui-icon="${escHtml(PROCURE_ICON[methodStyle(m)] || '📋')}"></span> ${escHtml(methodLabel(m))} <b>${groups[m].length}</b>
        </span>`).join('')}
    </div>`;

    const cols = order.map(m => {
        const list = groups[m];
        const color = PROCURE_COLOR[methodStyle(m)] || '#6b7280';
        const icon = PROCURE_ICON[methodStyle(m)] || '📋';
        return `<div class="board-col" tabindex="0">
            <h3><span class="method-dot" style="background:${color}"></span><span data-ui-icon="${escHtml(icon)}"></span> ${escHtml(methodLabel(m))} <span class="col-count">${list.length}</span></h3>
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

function calendarEventMetadata(event) {
    if(event.kind==='business_deadline') return {name:event.stage_name||event.title||'业务期限',icon:'🗓'};
    if(event.kind==='deposit_refund') return {name:event.stage_name||'保证金退还截止',icon:'💳'};
    const key = String(event.stage_key || event.key || event.stage_name || '');
    const project = (typeof projectById !== 'undefined' ? projectById.get(Number(event.project_id)) : null)
        || (typeof allProjects !== 'undefined' ? allProjects.find(row => Number(row.id) === Number(event.project_id)) : null);
    const snapshot = (project?.stages || []).find(row => String(row.key || row.stage_key || '') === key);
    const method = String(project?.method || event.method || '');
    const settings = typeof systemSettings !== 'undefined' ? systemSettings || {} : {};
    const templates = settings.stage_templates && typeof normalizeClientStageTemplates === 'function'
        ? normalizeClientStageTemplates(settings.stage_templates, settings) : settings.stage_templates || {};
    let saved = (templates[method] || []).find(row => String(row.id || row.key || '') === key);
    if (!saved && !method) {
        const matches = Object.values(templates).flat().filter(row => String(row.id || row.key || '') === key);
        const identities = new Set(matches.map(row => JSON.stringify([row.name, row.icon])));
        if (identities.size === 1) saved = matches[0];
    }
    const online = typeof onlineBiddingTemplate === 'function' && (!method || method === '网上竞价')
        ? onlineBiddingTemplate().find(row => row.id === key) : null;
    const legacy = typeof STAGES !== 'undefined' && Array.isArray(STAGES) ? STAGES.find(row => String(row.key) === key) : null;
    const definition = typeof projectStageDefinition === 'function' ? projectStageDefinition(snapshot || key, project || {method}) : {};
    const eventName = event.stage_name && String(event.stage_name) !== key ? event.stage_name : '';
    const definitionName = definition.name && String(definition.name) !== key ? definition.name : '';
    const eventIcon = event.icon && !['📌', '•'].includes(event.icon) ? event.icon : '';
    const definitionIcon = definition.icon && definition.icon !== '•' ? definition.icon : '';
    return {
        name: String(snapshot?.name || eventName || saved?.name || definitionName || legacy?.name || online?.name || event.stage_name || '项目节点'),
        icon: String(snapshot?.icon || eventIcon || saved?.icon || definitionIcon || legacy?.icon || online?.icon || event.icon || '📌'),
    };
}

async function openCalendarStage(projectId, stageKey) {
    const id = Number(projectId), key = String(stageKey || '');
    if (!Number.isSafeInteger(id) || id <= 0 || !key) {
        toast('此日历节点缺少项目或阶段信息，请刷新日历后重试', 'warning');
        return false;
    }
    try {
        const selected = await selectProject(id, {preserveViewOnFailure:true});
        if (!selected || Number(currentProject?.id) !== id) return false;
        const project = currentProject;
        const stage = (project.stages || []).find(row => String(row.key || row.stage_key || '') === key);
        if (!stage || stage.deleted || stage.is_deleted) {
            toast('此阶段已移除，请刷新日历查看最新安排', 'warning');
            return false;
        }
        if (stage.template_removed || stage.disabled || stage.is_disabled || stage.enabled === false || project.is_terminated) {
            const definition = projectStageDefinition(stage, project);
            openSlide(`阶段记录 - ${definition.name || key}`, `<section class="stage-editor-history"><p class="settings-note">此阶段已停用、移出流程或项目已关闭，以下为保留记录。</p><dl><dt>状态</dt><dd>${stage.skipped ? '已跳过' : stage.completed ? '已完成' : '待办'}</dd><dt>计划时间</dt><dd>${escHtml(stage.planned_at || '未设置')}</dd><dt>完成时间</dt><dd>${escHtml(stage.completed_at || stage.completed_date || '未设置')}</dd><dt>阶段备注</dt><dd>${escHtml(stage.notes || '无')}</dd></dl></section>`);
            return true;
        }
        await openStageSlide(key);
        return Number(currentProject?.id) === id && editingStageKey === key
            && document.getElementById('slidePanel').classList.contains('open');
    } catch (error) {
        toast('打开日历阶段失败，请重试：' + error.message, 'error');
        return false;
    }
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
        const canOpen = Number.isSafeInteger(projectId) && projectId > 0;
        const metadata = calendarEventMetadata(event);
        const stageName = escHtml(metadata.name);
        const projectName = escHtml(event.project_name || event.name || '未命名项目');
        const projectNumber = escHtml(event.number || event.project_number || '');
        const icon = metadata.icon;
        const time = event.planned_time ? `<time>${escHtml(event.planned_time)}</time>` : '<time>全天</time>';
        let statusClass = 'pending';
        if (event.skipped) statusClass = 'skipped';
        else if (event.completed) statusClass = 'done';
        const guaranteeId=Number(event.registration_id||String(event.event_id||'').split(':')[2])||null;
        const guaranteeAction=event.guarantee_action==='review'||String(event.event_id||'').endsWith(':review_at')?'review':'refund';
        const action=event.kind==='business_deadline' ? `showBusinessDeadlines(${projectId},'${String(event.stage_key||'').replace(/[^A-Za-z0-9_-]/g,'')}', '${String(event.deadline_item_id||event.item_id||'').replace(/[^A-Za-z0-9_-]/g,'')}')` : event.kind==='deposit_refund' ? `openCalendarGuarantee(${projectId},${guaranteeId},'${guaranteeAction}')` : `openCalendarStage(${projectId},this.dataset.stageKey)`;
        const detail=event.kind==='deposit_refund' ? `<small>${escHtml(event.supplier_name||'')} · 待退 ${escHtml(event.balance||'')} 元${event.estimated?' · 按阶段计划预估':''}${event.needs_recheck?' · 期限待复核':''}</small>` : '';
        return `<button type="button" class="calendar-agenda-item ${statusClass}" data-stage-key="${escHtml(event.stage_key || event.key || event.stage_name || '')}" ${canOpen ? `onclick="${action}"` : 'disabled'}>
            <span class="calendar-agenda-time">${time}<i></i></span>
            <span class="calendar-agenda-copy"><strong><span><span data-ui-icon="${escHtml(icon)}"></span></span>${stageName}</strong><span>${projectName}</span>${projectNumber ? `<small>${projectNumber}</small>` : ''}${detail}</span>
            <span class="calendar-agenda-arrow" aria-hidden="true">›</span>
        </button>`;
    }).join('');
    return `${header}<div class="calendar-agenda-list">${items}</div>`;
}

let calendarKeyboardNavigation = null;

function selectCalendarDay(dateStr) {
    if (!calendarEventsByDate.has(dateStr)) return;
    calendarSelectedDate = dateStr;
    document.querySelectorAll('.calendar-cell[data-calendar-date]').forEach(cell => {
        const selected = cell.dataset.calendarDate === dateStr;
        cell.classList.toggle('selected', selected);
        cell.setAttribute('aria-pressed', selected ? 'true' : 'false');
        cell.tabIndex = selected ? 0 : -1;
    });
    const agenda = document.getElementById('calendarAgenda');
    if (agenda) agenda.innerHTML = calendarAgendaHtml(dateStr, calendarEventsByDate.get(dateStr) || []);
}

function handleCalendarDayKey(event, dateStr) {
    if (event.altKey || event.ctrlKey || event.metaKey || !calendarEventsByDate.has(dateStr)) return;
    const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const [year, month, day] = dateStr.split('-').map(Number);
    const target = new Date(year, month - 1, day);
    if (event.key === 'PageUp' || event.key === 'PageDown') {
        const amount = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1);
        target.setDate(1);
        target.setMonth(target.getMonth() + amount);
        target.setDate(Math.min(day, new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()));
    } else if (event.key === 'Home' || event.key === 'End') {
        const weekStart = typeof readUiPreferences === 'function' && readUiPreferences().weekStart === 1 ? 1 : 0;
        const offset = (target.getDay() - weekStart + 7) % 7;
        const rowDay = day + (event.key === 'Home' ? -offset : 6 - offset);
        target.setDate(Math.max(1, Math.min(rowDay, new Date(year, month, 0).getDate())));
    } else {
        target.setDate(day + ({ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7})[event.key]);
    }
    const targetDate = `${target.getFullYear()}-${String(target.getMonth() + 1).padStart(2, '0')}-${String(target.getDate()).padStart(2, '0')}`;
    if (target.getFullYear() === calendarYear && target.getMonth() + 1 === calendarMonth) {
        if (!calendarEventsByDate.has(targetDate)) return;
        selectCalendarDay(targetDate);
        document.querySelector(`.calendar-cell[data-calendar-date="${targetDate}"]`)?.focus();
        return;
    }
    calendarKeyboardNavigation = {date: targetDate, origin: document.activeElement};
    calendarSelectedDate = targetDate;
    calendarYear = target.getFullYear();
    calendarMonth = target.getMonth() + 1;
    loadCalendar();
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
    const content = document.getElementById('calendarContent');
    const active = document.activeElement;
    const focusedDate = content.contains(active) ? active.dataset?.calendarDate : '';
    const pendingFocus = calendarKeyboardNavigation;
    const restoreDate = pendingFocus && (active === pendingFocus.origin || active === document.body) ? pendingFocus.date : focusedDate;
    if(typeof layoutCalendarCells==='function')data=layoutCalendarCells(data,readUiPreferences().weekStart);

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
    const holidayNote=data.holiday_calendar?.confirmed ? `${year}年国家放假调休安排` : '该年度国家放假调休安排未确认';
    let html = `<div class="calendar-holiday-toolbar"><span>${holidayNote}</span><div class="calendar-holiday-legend"><span class="holiday-key">休 · 放假</span><span class="makeup-key">班 · 调休补班</span><button type="button" class="btn btn-xs btn-secondary" onclick="showHolidayCalendarSettings()">安排与更新</button></div></div><div class="calendar-layout"><div class="calendar-grid">
        <div class="calendar-weekdays">${data.weekday_names.map(d => `<span>${d}</span>`).join('')}</div>`;
    weeks.forEach(w => {
        html += '<div class="calendar-row">';
        w.forEach(c => {
            if (c.empty) {
                html += '<div class="calendar-cell empty"></div>';
            } else {
                const isToday = c.date_str === today;
                const isSelected = c.date_str === calendarSelectedDate;
                const holiday=(typeof readUiPreferences!=='function'||readUiPreferences().holidayDisplay)?c.holiday||{}:{};
                const holidayClass=holiday.confirmed ? (holiday.status==='holiday'?' holiday-rest':holiday.label==='班'?' holiday-makeup':holiday.status==='weekend'?' holiday-weekend':'') : '';
                const holidayBadge=holiday.confirmed && holiday.label ? `<span class="calendar-holiday-mark" title="${escHtml(holiday.name||'')}">${escHtml(holiday.label)}</span>` : '';
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
                    const metadata = calendarEventMetadata(event);
                    return `<span class="calendar-cell-event ${cls}"><i><span data-ui-icon="${escHtml(metadata.icon)}"></span></i>${time}<b>${escHtml(metadata.name)}</b></span>`;
                }).join('');
                const holidayDescription=[holiday.festival_name,holiday.label==='休'?'放假':holiday.label==='班'?'调休补班':''].filter(Boolean).join('，');
                const label = `${year}年${month}月${c.day}日，${isToday ? '今天，' : ''}${holidayDescription?`${holidayDescription}，`:''}${events.length ? `${events.length}个项目节点` : '无项目节点'}`;
                html += `<button type="button" class="calendar-cell${holidayClass}${isToday ? ' today' : ''}${isSelected ? ' selected' : ''}${events.length ? ' has-events' : ''}"
                    data-calendar-date="${c.date_str}" tabindex="${isSelected ? '0' : '-1'}" aria-label="${escHtml(label)}" aria-pressed="${isSelected ? 'true' : 'false'}"${isToday ? ' aria-current="date"' : ''} onclick="selectCalendarDay('${c.date_str}')" onkeydown="handleCalendarDayKey(event,'${c.date_str}')">
                    <span class="day-num">${c.day}</span>${holidayBadge}${holiday.confirmed&&holiday.festival_name?`<span class="calendar-holiday-name">${escHtml(holiday.festival_name)}</span>`:''}
                    <span class="calendar-cell-events">${cellEvents}${events.length > 3 ? `<small>还有 ${events.length - 3} 个节点</small>` : ''}</span>
                    <span class="calendar-event-dots">${dots}${count}</span>
                </button>`;
            }
        });
        html += '</div>';
    });
    html += `</div><aside class="calendar-agenda" id="calendarAgenda">${calendarAgendaHtml(calendarSelectedDate, calendarEventsByDate.get(calendarSelectedDate) || [])}</aside></div>`;
    content.innerHTML = html;
    if (restoreDate && calendarEventsByDate.has(restoreDate)) {
        content.querySelector(`.calendar-cell[data-calendar-date="${restoreDate}"]`)?.focus({preventScroll: !pendingFocus});
    }
    calendarKeyboardNavigation = null;
}

function prevMonth() {
    calendarKeyboardNavigation = null;
    calendarMonth--;
    if (calendarMonth < 1) { calendarMonth = 12; calendarYear--; }
    loadCalendar();
}
function nextMonth() {
    calendarKeyboardNavigation = null;
    calendarMonth++;
    if (calendarMonth > 12) { calendarMonth = 1; calendarYear++; }
    loadCalendar();
}
function goToday() {
    calendarKeyboardNavigation = null;
    const now = new Date();
    calendarYear = now.getFullYear();
    calendarMonth = now.getMonth() + 1;
    calendarSelectedDate = `${calendarYear}-${String(calendarMonth).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    loadCalendar();
}
