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
