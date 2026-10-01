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
