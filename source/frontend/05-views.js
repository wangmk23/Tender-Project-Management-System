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
