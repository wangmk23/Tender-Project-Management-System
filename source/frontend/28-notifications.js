// ── Multi-channel notification center (in-app drawer, desktop tray, WeCom/DingTalk/Feishu webhooks) ──
'use strict';

const notificationCenterState = {
    open: false,
    loading: false,
    loadingMore: false,
    loaded: false,
    scanning: false,
    error: '',
    scope: 'all',
    page: 1,
    pageSize: 30,
    items: [],
    total: 0,
    unreadCount: 0,
    urgentUnreadCount: 0,
    latestId: 0,
    timer: null,
    unsupported: false,
    returnFocus: null,
    docKeyHandler: null,
};

const notificationChannelsState = {
    loading: false,
    loaded: false,
    loadFailed: false,
    saving: false,
    mutatingWebhook: false,
    testingId: '',
    error: '',
    isDesktop: false,
    deliveriesOpen: false,
    config: {
        in_app_enabled: true,
        desktop_popup_enabled: true,
        quiet_hours_enabled: false,
        quiet_start: '22:00',
        quiet_end: '08:00',
        webhooks: [],
    },
    savedToggles: {
        in_app_enabled: true,
        desktop_popup_enabled: true,
        quiet_hours_enabled: false,
        quiet_start: '22:00',
        quiet_end: '08:00',
    },
    draftToggles: {
        in_app_enabled: true,
        desktop_popup_enabled: true,
        quiet_hours_enabled: false,
        quiet_start: '22:00',
        quiet_end: '08:00',
    },
    categories: [
        {key: 'stage_due', label: '阶段节点提醒'},
        {key: 'guarantee', label: '保证金退还与复核'},
        {key: 'deadline', label: '法定业务期限'},
        {key: 'supplier_shortage', label: '供应商数量不足预警'},
    ],
    recentDeliveries: [],
    editingWebhook: null,
};

const WEBHOOK_TYPE_LABELS = Object.freeze({
    wecom: '企业微信',
    dingtalk: '钉钉',
    feishu: '飞书',
});

const SEVERITY_LABELS = Object.freeze({
    urgent: '紧急',
    warning: '提醒',
    info: '常规',
});

function syncNotificationBellOffset() {
    const userBtn = document.getElementById('userBtn');
    const bell = document.getElementById('notifBellBtn');
    if (!userBtn || !bell) return;
    const w = Math.max(64, Math.ceil(userBtn.getBoundingClientRect?.().width || userBtn.offsetWidth || 86));
    document.documentElement.style.setProperty('--notif-user-width', `${w}px`);
}

function ensureNotificationShell() {
    if (typeof document === 'undefined' || !document.body) return;
    const appRoot = document.getElementById('app') || document.body;
    const userBtn = document.getElementById('userBtn');
    if (!document.getElementById('notifBellBtn') && userBtn) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.id = 'notifBellBtn';
        btn.className = 'notif-bell-btn';
        btn.setAttribute('aria-label', '消息通知');
        btn.setAttribute('aria-haspopup', 'dialog');
        btn.setAttribute('aria-expanded', 'false');
        btn.setAttribute('aria-controls', 'notificationDrawer');
        btn.title = '消息通知中心';
        btn.innerHTML = `<svg class="notif-bell-icon" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path><path d="M13.73 21a2 2 0 0 1-3.46 0"></path></svg><span id="notifBellBadge" class="notif-bell-badge" hidden>0</span>`;
        btn.addEventListener('click', () => toggleNotificationDrawer(btn));
        userBtn.parentNode.insertBefore(btn, userBtn);
        syncNotificationBellOffset();
        window.addEventListener('resize', syncNotificationBellOffset);
    }
    if (!document.getElementById('notificationDrawer')) {
        const backdrop = document.createElement('div');
        backdrop.id = 'notificationDrawerBackdrop';
        backdrop.className = 'notif-drawer-backdrop';
        backdrop.hidden = true;
        backdrop.addEventListener('click', () => closeNotificationDrawer());

        const drawer = document.createElement('aside');
        drawer.id = 'notificationDrawer';
        drawer.className = 'notif-drawer';
        drawer.setAttribute('role', 'dialog');
        drawer.setAttribute('aria-modal', 'true');
        drawer.setAttribute('aria-label', '消息通知中心');
        drawer.hidden = true;
        drawer.addEventListener('keydown', handleNotificationDrawerKeydown);
        drawer.innerHTML = renderNotificationDrawerInner();

        appRoot.appendChild(backdrop);
        appRoot.appendChild(drawer);
    }
}

function updateNotificationBellBadge() {
    const btn = document.getElementById('notifBellBtn');
    const badge = document.getElementById('notifBellBadge');
    const unread = Math.max(0, Number(notificationCenterState.unreadCount || 0));
    const urgent = Math.max(0, Number(notificationCenterState.urgentUnreadCount || 0));
    if (badge) {
        badge.hidden = unread <= 0;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.classList.toggle('is-urgent', urgent > 0);
    }
    if (btn) {
        btn.setAttribute('aria-label', unread > 0 ? `消息通知，${unread} 条未读` : '消息通知');
        btn.setAttribute('aria-expanded', String(Boolean(notificationCenterState.open)));
    }
    syncNotificationBellOffset();
}

function renderNotificationItemHtml(item) {
    const sev = item.severity || 'info';
    const sevLabel = SEVERITY_LABELS[sev] || '常规';
    const timeText = String(item.created_at || '').replace('T', ' ').slice(0, 16);
    return `<article class="notif-item ${item.read ? 'is-read' : 'is-unread'} notif-sev-${escHtml(sev)}" data-notif-id="${Number(item.id)}" role="listitem">
      <button type="button" class="notif-item-btn" onclick="openNotificationTarget(${item.id})">
        <div class="notif-item-head">
          <span class="notif-sev-tag notif-sev-tag-${escHtml(sev)}">${escHtml(sevLabel)}</span>
          <span class="notif-cat-tag">${escHtml(item.category_label || '通知')}</span>
          <time class="notif-time">${escHtml(timeText)}</time>
        </div>
        <div class="notif-item-title">${escHtml(item.title || '')}</div>
        ${item.summary ? `<div class="notif-item-summary">${escHtml(item.summary)}</div>` : ''}
      </button>
      ${!item.read ? `<button type="button" class="notif-read-btn" aria-label="标为已读" title="标为已读" onclick="markNotificationRead(${item.id})">已读</button>` : ''}
    </article>`;
}

function renderNotificationDrawerBodyHtml() {
    const st = notificationCenterState;
    const isAdmin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
    if (st.loading && !st.loaded) {
        return '<div class="notif-empty" role="status">正在加载通知…</div>';
    }
    if (st.error) {
        return `<div class="notif-error" role="alert">${escHtml(st.error)} <button type="button" class="btn btn-sm btn-secondary" onclick="loadNotificationList({force:true})">重试</button></div>`;
    }
    if (!st.items.length) {
        const emptyMsg = st.scope === 'unread'
            ? '暂无未读消息。'
            : st.scope === 'urgent'
                ? '暂无紧急提醒。'
                : (isAdmin ? '暂无通知消息，点击「立即检查」扫描最新到期节点。' : '暂无通知消息。');
        return `<div class="notif-empty">${emptyMsg}</div>`;
    }
    const remaining = Math.max(0, Number(st.total || 0) - st.items.length);
    return `<div id="notifList" class="notif-list" role="list">${st.items.map(renderNotificationItemHtml).join('')}</div>
      <div id="notifLoadMoreWrap" class="notif-load-more" ${remaining > 0 ? '' : 'hidden'}>
        <button type="button" id="notifLoadMoreBtn" class="btn btn-sm btn-secondary" ${st.loadingMore ? 'disabled' : ''} onclick="loadMoreNotifications()">${st.loadingMore ? '加载中…' : `加载更多（剩余 ${remaining} 条）`}</button>
      </div>`;
}

function renderNotificationDrawerInner() {
    const st = notificationCenterState;
    const isAdmin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
    const scopes = [
        ['all', '全部'],
        ['unread', `未读 (${Number(st.unreadCount || 0)})`],
        ['urgent', '紧急'],
    ];
    return `
      <div class="notif-drawer-head">
        <div>
          <h2>消息通知</h2>
          <p id="notifDrawerSub" class="notif-drawer-sub">${st.unreadCount > 0 ? `${st.unreadCount} 条未读` : '所有消息均已处理'}</p>
        </div>
        <button type="button" id="notifCloseBtn" class="btn-icon notif-close-btn" aria-label="关闭消息通知" onclick="closeNotificationDrawer()"><span data-ui-icon="✕"></span></button>
      </div>
      <div class="notif-drawer-bar">
        <div class="notif-scope-tabs" role="tablist" aria-label="筛选消息">
          ${scopes.map(([key, label]) => `<button type="button" class="notif-scope-tab ${st.scope === key ? 'active' : ''}" data-notif-scope="${key}" role="tab" aria-selected="${st.scope === key}" onclick="setNotificationScope('${key}')">${escHtml(label)}</button>`).join('')}
        </div>
        <div class="notif-bar-actions">
          <button type="button" id="notifScanBtn" class="btn btn-xs btn-secondary" ${st.scanning || st.loading ? 'disabled' : ''} onclick="${isAdmin ? 'scanNotificationsNow()' : 'loadNotificationList({force:true})'}">${isAdmin ? (st.scanning ? '检查中…' : '立即检查') : (st.loading ? '刷新中…' : '刷新')}</button>
          <button type="button" id="notifReadAllBtn" class="btn btn-xs btn-secondary" ${st.unreadCount > 0 ? '' : 'hidden'} onclick="markAllNotificationsRead()">全部已读</button>
        </div>
      </div>
      <div id="notifDrawerBody" class="notif-drawer-body">${renderNotificationDrawerBodyHtml()}</div>
    `;
}

function mountNotificationDrawer() {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') return;
    try {
        const drawer = document.getElementById('notificationDrawer');
        if (!drawer) {
            updateNotificationBellBadge();
            return;
        }
        const bodyEl = drawer.querySelector('#notifDrawerBody');
        if (!bodyEl) {
            drawer.innerHTML = renderNotificationDrawerInner();
            updateNotificationBellBadge();
            return;
        }
        const st = notificationCenterState;
        const isAdmin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
        const subEl = drawer.querySelector('#notifDrawerSub');
        if (subEl) subEl.textContent = st.unreadCount > 0 ? `${st.unreadCount} 条未读` : '所有消息均已处理';
        drawer.querySelectorAll('.notif-scope-tab[data-notif-scope]').forEach(tab => {
            const key = tab.getAttribute('data-notif-scope');
            const active = st.scope === key;
            tab.classList.toggle('active', active);
            tab.setAttribute('aria-selected', String(active));
            if (key === 'unread') tab.textContent = `未读 (${Number(st.unreadCount || 0)})`;
        });
        const scanBtn = drawer.querySelector('#notifScanBtn');
        if (scanBtn) {
            scanBtn.disabled = Boolean(st.scanning || st.loading);
            scanBtn.textContent = isAdmin
                ? (st.scanning ? '检查中…' : '立即检查')
                : (st.loading ? '刷新中…' : '刷新');
            scanBtn.setAttribute('onclick', isAdmin ? 'scanNotificationsNow()' : 'loadNotificationList({force:true})');
        }
        const readAllBtn = drawer.querySelector('#notifReadAllBtn');
        if (readAllBtn) {
            const hideReadAll = !(st.unreadCount > 0);
            if (hideReadAll && document.activeElement === readAllBtn) {
                drawer.querySelector('#notifCloseBtn')?.focus();
            }
            readAllBtn.hidden = hideReadAll;
        }
        bodyEl.innerHTML = renderNotificationDrawerBodyHtml();
        updateNotificationBellBadge();
    } catch (_) {}
}

function toggleNotificationDrawer(trigger) {
    if (notificationCenterState.open) closeNotificationDrawer();
    else openNotificationDrawer(trigger);
}

function openNotificationDrawer(trigger) {
    ensureNotificationShell();
    notificationCenterState.open = true;
    notificationCenterState.returnFocus = trigger || document.getElementById('notifBellBtn');
    const backdrop = document.getElementById('notificationDrawerBackdrop');
    const drawer = document.getElementById('notificationDrawer');
    if (backdrop) backdrop.hidden = false;
    if (drawer) {
        drawer.hidden = false;
        mountNotificationDrawer();
        if (typeof activateDialogFocus === 'function') {
            activateDialogFocus(drawer, () => closeNotificationDrawer());
        } else {
            const firstBtn = drawer.querySelector('button:not([disabled]):not([hidden])');
            if (firstBtn) firstBtn.focus();
        }
        if (!notificationCenterState.docKeyHandler) {
            notificationCenterState.docKeyHandler = event => {
                if (event.key === 'Escape' && notificationCenterState.open) {
                    event.preventDefault();
                    closeNotificationDrawer();
                }
            };
            document.addEventListener('keydown', notificationCenterState.docKeyHandler);
        }
    }
    void loadNotificationList({force: true});
}

function closeNotificationDrawer({restoreFocus = true} = {}) {
    notificationCenterState.open = false;
    const backdrop = document.getElementById('notificationDrawerBackdrop');
    const drawer = document.getElementById('notificationDrawer');
    if (notificationCenterState.docKeyHandler) {
        document.removeEventListener('keydown', notificationCenterState.docKeyHandler);
        notificationCenterState.docKeyHandler = null;
    }
    if (backdrop) backdrop.hidden = true;
    if (drawer) drawer.hidden = true;
    updateNotificationBellBadge();
    if (drawer && typeof releaseDialogFocus === 'function') {
        releaseDialogFocus(drawer, {restoreFocus});
    } else if (restoreFocus && notificationCenterState.returnFocus?.focus) {
        notificationCenterState.returnFocus.focus();
    }
    notificationCenterState.returnFocus = null;
}

function handleNotificationDrawerKeydown(event) {
    if (!notificationCenterState.open) return;
    if (event.key === 'Escape') {
        event.preventDefault();
        closeNotificationDrawer();
    }
}

function setNotificationScope(scope) {
    notificationCenterState.scope = scope || 'all';
    notificationCenterState.page = 1;
    mountNotificationDrawer();
    void loadNotificationList({force: true});
}

async function pollNotificationUnreadCount() {
    if (notificationCenterState.unsupported || (typeof document !== 'undefined' && document.hidden)) return;
    try {
        const res = await api('GET', '/api/notifications/unread-count');
        if (!res || typeof res !== 'object') return;
        const prevLatest = notificationCenterState.latestId;
        notificationCenterState.unreadCount = Number(res.unread_count || 0);
        notificationCenterState.urgentUnreadCount = Number(res.urgent_unread_count || 0);
        notificationCenterState.latestId = Number(res.latest_id || 0);
        updateNotificationBellBadge();
        if (prevLatest > 0 && notificationCenterState.latestId > prevLatest && notificationCenterState.open) {
            void loadNotificationList({force: true});
        }
    } catch (err) {
        if (err?.status === 404) {
            notificationCenterState.unsupported = true;
            stopNotificationPolling();
        }
    }
}

async function loadNotificationList({force = false, append = false} = {}) {
    if (append) {
        if (notificationCenterState.loadingMore || notificationCenterState.loading) return;
        notificationCenterState.loadingMore = true;
        // Preserve focus on #notifLoadMoreBtn while loading — do NOT replace #notifDrawerBody!
        const loadBtn = document.getElementById('notifLoadMoreBtn');
        if (loadBtn) {
            loadBtn.disabled = true;
            loadBtn.textContent = '加载中…';
        }
    } else {
        if (notificationCenterState.loading && !force) return;
        notificationCenterState.loading = true;
        notificationCenterState.page = 1;
        notificationCenterState.error = '';
        mountNotificationDrawer();
    }
    let appendedItems = [];
    try {
        const nextPage = append ? (notificationCenterState.page + 1) : 1;
        const params = new URLSearchParams({
            scope: notificationCenterState.scope || 'all',
            page: String(nextPage),
            page_size: String(notificationCenterState.pageSize || 30),
        });
        const res = await api('GET', `/api/notifications?${params.toString()}`);
        const incoming = Array.isArray(res?.items) ? res.items : [];
        if (append) {
            const seen = new Set(notificationCenterState.items.map(it => it.id));
            incoming.forEach(it => {
                if (!seen.has(it.id)) {
                    notificationCenterState.items.push(it);
                    appendedItems.push(it);
                }
            });
            notificationCenterState.page = nextPage;
        } else {
            notificationCenterState.items = incoming;
            notificationCenterState.page = 1;
        }
        notificationCenterState.total = Number(res?.total || 0);
        notificationCenterState.unreadCount = Number(res?.unread_count || 0);
        notificationCenterState.urgentUnreadCount = Number(res?.urgent_unread_count || 0);
        notificationCenterState.loaded = true;
        notificationCenterState.error = '';
    } catch (err) {
        if (append) {
            toast(err?.message || '加载更多消息失败', 'error');
        } else {
            notificationCenterState.error = err?.message || '读取消息通知失败';
        }
    } finally {
        notificationCenterState.loading = false;
        notificationCenterState.loadingMore = false;
        if (append) {
            const drawer = document.getElementById('notificationDrawer');
            const listEl = drawer?.querySelector('#notifList');
            const wrapEl = drawer?.querySelector('#notifLoadMoreWrap');
            const loadBtn = drawer?.querySelector('#notifLoadMoreBtn');
            const remaining = Math.max(0, Number(notificationCenterState.total || 0) - notificationCenterState.items.length);
            if (listEl) {
                if (appendedItems.length) {
                    listEl.insertAdjacentHTML('beforeend', appendedItems.map(renderNotificationItemHtml).join(''));
                }
                if (wrapEl) wrapEl.hidden = remaining <= 0;
                if (loadBtn) {
                    loadBtn.disabled = false;
                    loadBtn.textContent = `加载更多（剩余 ${remaining} 条）`;
                }
                // Move focus cleanly to first newly appended notification so keyboard users continue reading seamlessly
                if (appendedItems.length) {
                    const firstNewBtn = listEl.querySelector(`[data-notif-id="${Number(appendedItems[0].id)}"] .notif-item-btn`);
                    if (firstNewBtn && typeof firstNewBtn.focus === 'function') firstNewBtn.focus();
                } else if (remaining <= 0 && document.activeElement === loadBtn) {
                    drawer.querySelector('#notifCloseBtn')?.focus();
                }
                updateNotificationBellBadge();
            } else {
                mountNotificationDrawer();
            }
        } else {
            mountNotificationDrawer();
        }
    }
}

function loadMoreNotifications() {
    void loadNotificationList({force: true, append: true});
}

async function markNotificationRead(nid) {
    try {
        await api('POST', `/api/notifications/${nid}/read`, {});
        const item = notificationCenterState.items.find(row => row.id === nid);
        if (item && !item.read) {
            item.read = true;
            notificationCenterState.unreadCount = Math.max(0, notificationCenterState.unreadCount - 1);
            if (item.severity === 'urgent') {
                notificationCenterState.urgentUnreadCount = Math.max(0, notificationCenterState.urgentUnreadCount - 1);
            }
        }
        mountNotificationDrawer();
    } catch (err) {
        toast(err?.message || '操作失败', 'error');
    }
}

async function markAllNotificationsRead() {
    try {
        await api('POST', '/api/notifications/read-all', {});
        notificationCenterState.items.forEach(item => { item.read = true; });
        notificationCenterState.unreadCount = 0;
        notificationCenterState.urgentUnreadCount = 0;
        mountNotificationDrawer();
        toast('已将全部消息标为已读', 'success');
    } catch (err) {
        toast(err?.message || '操作失败', 'error');
    }
}

async function scanNotificationsNow() {
    notificationCenterState.scanning = true;
    mountNotificationDrawer();
    try {
        const res = await api('POST', '/api/notifications/scan', {});
        const created = Number(res?.created || 0);
        toast(created > 0 ? `检查完成，新增 ${created} 条提醒` : '检查完成，暂无新增到期提醒', 'info');
        await loadNotificationList({force: true});
    } catch (err) {
        toast(err?.message || '扫描提醒失败', 'error');
    } finally {
        notificationCenterState.scanning = false;
        mountNotificationDrawer();
    }
}

const VALID_PROJECT_TABS = Object.freeze(['board', 'timeline', 'tasks', 'info', 'attachments']);

async function openNotificationTarget(nid) {
    const item = notificationCenterState.items.find(row => row.id === nid);
    if (!item) return;
    if (!item.read) void markNotificationRead(nid);
    closeNotificationDrawer({restoreFocus: false});
    const target = item.target || {};
    const pid = Number(target.project_id || item.project_id || 0);
    if (pid > 0 && typeof selectProject === 'function') {
        await selectProject(pid);
        let tab = String(target.tab || 'board');
        let stageKey = String(target.stage_key || '');
        // Legacy fallback: map nonexistent 'registrations' tab to the board + registration stage slide
        if (tab === 'registrations') {
            tab = 'board';
            if (!stageKey) stageKey = 'registration_end';
        }
        if (!VALID_PROJECT_TABS.includes(tab)) tab = 'board';
        if (typeof switchProjectTab === 'function') {
            switchProjectTab(tab);
        }
        if (stageKey && typeof openStageSlide === 'function') {
            setTimeout(() => {
                try { openStageSlide(stageKey); } catch (_) {}
            }, 120);
        }
    }
}

function initNotificationCenter() {
    ensureNotificationShell();
    void pollNotificationUnreadCount();
    if (!notificationCenterState.timer) {
        notificationCenterState.timer = setInterval(() => {
            void pollNotificationUnreadCount();
        }, 60000);
    }
}

function stopNotificationPolling() {
    if (notificationCenterState.timer) {
        clearInterval(notificationCenterState.timer);
        notificationCenterState.timer = null;
    }
}

// ── Admin settings: Instant channels (Desktop tray + WeCom/DingTalk/Feishu Webhooks) ──

function _extractToggleSnapshot(cfg) {
    return {
        in_app_enabled: Boolean(cfg?.in_app_enabled ?? true),
        desktop_popup_enabled: Boolean(cfg?.desktop_popup_enabled ?? true),
        quiet_hours_enabled: Boolean(cfg?.quiet_hours_enabled ?? false),
        quiet_start: String(cfg?.quiet_start || '22:00'),
        quiet_end: String(cfg?.quiet_end || '08:00'),
    };
}

function isNotificationChannelsDraftDirty() {
    const st = notificationChannelsState;
    if (!st.loaded) return false;
    const a = st.savedToggles || {};
    const b = st.draftToggles || {};
    return Boolean(a.in_app_enabled) !== Boolean(b.in_app_enabled)
        || Boolean(a.desktop_popup_enabled) !== Boolean(b.desktop_popup_enabled)
        || Boolean(a.quiet_hours_enabled) !== Boolean(b.quiet_hours_enabled)
        || String(a.quiet_start || '22:00') !== String(b.quiet_start || '22:00')
        || String(a.quiet_end || '08:00') !== String(b.quiet_end || '08:00');
}

function onNotificationToggleDraftInput() {
    readNotificationToggleInputs();
    const badge = document.getElementById('ncDraftDirtyBadge');
    if (badge) badge.hidden = !isNotificationChannelsDraftDirty();
    const range = document.getElementById('ncQuietRange');
    if (range) range.hidden = !notificationChannelsState.draftToggles.quiet_hours_enabled;
}

function renderNotificationChannelsCard() {
    const isAdmin = typeof currentIsAdmin !== 'undefined' && currentIsAdmin === true;
    if (!isAdmin) return '';
    const st = notificationChannelsState;
    const ready = Boolean(st.loaded);
    const controlsDisabled = !ready || st.saving || st.loading;
    const webhookActionsDisabled = !ready || st.saving || st.mutatingWebhook || st.loading;
    const draft = st.draftToggles || _extractToggleSnapshot(st.config);
    const webhooks = Array.isArray(st.config?.webhooks) ? st.config.webhooks : [];
    const dirty = isNotificationChannelsDraftDirty();

    let webhookRows = '';
    if (!ready) {
        webhookRows = st.loadFailed
            ? `<div class="rb-error" role="alert"><span>${escHtml(st.error || '读取通知通道配置失败')}</span><button type="button" class="btn btn-sm btn-secondary" onclick="loadNotificationChannelsPanel()">重试读取</button></div>`
            : '<div class="nc-empty" role="status">正在读取即时通知与群机器人配置…</div>';
    } else if (webhooks.length) {
        webhookRows = webhooks.map(wh => {
            const typeLabel = WEBHOOK_TYPE_LABELS[wh.type] || wh.type;
            const testing = st.testingId === wh.id;
            const evLabels = (wh.event_types || []).map(k => (st.categories.find(c => c.key === k)?.label || k)).join('、');
            return `<article class="nc-wh-item">
              <div class="nc-wh-main">
                <div class="nc-wh-head">
                  <span class="nc-type-badge nc-type-${escHtml(wh.type)}">${escHtml(typeLabel)}</span>
                  <strong>${escHtml(wh.name)}</strong>
                  <span class="nc-status-pill ${wh.enabled ? 'is-on' : 'is-off'}">${wh.enabled ? '已启用' : '已停用'}</span>
                </div>
                <div class="nc-wh-meta">${escHtml(wh.webhook_url_masked || '已加密保存地址')}${wh.has_secret ? ' · 已配置加签密钥' : ''}</div>
                <div class="nc-wh-meta">订阅：${escHtml(evLabels || '默认到期提醒')}</div>
              </div>
              <div class="nc-wh-actions">
                <div class="nc-wh-group nc-wh-group-primary">
                  <button type="button" class="btn btn-xs btn-secondary" data-nc-test-btn="${escHtml(wh.id)}" data-idle-label="测试" ${testing || webhookActionsDisabled ? 'disabled' : ''} onclick="testNotificationChannel('${escHtml(wh.id)}')">${testing ? '发送中…' : '测试'}</button>
                  <button type="button" class="btn btn-xs btn-secondary" ${webhookActionsDisabled ? 'disabled' : ''} onclick="openWebhookEditor('${escHtml(wh.id)}')">编辑</button>
                </div>
                <div class="nc-wh-group nc-wh-group-danger">
                  <button type="button" class="btn btn-xs btn-secondary" ${webhookActionsDisabled ? 'disabled' : ''} onclick="toggleWebhookEnabled('${escHtml(wh.id)}')">${wh.enabled ? '停用' : '启用'}</button>
                  <button type="button" class="btn btn-xs btn-danger btn-quiet-danger" ${webhookActionsDisabled ? 'disabled' : ''} onclick="removeWebhookChannel('${escHtml(wh.id)}')">删除</button>
                </div>
              </div>
            </article>`;
        }).join('');
    } else {
        webhookRows = '<div class="nc-empty">尚未添加群机器人。请先在工作群创建机器人，再用其 Webhook 地址添加通道。</div>';
    }

    const deliveriesHtml = ready && st.recentDeliveries.length
        ? `<details class="nc-deliveries" ${st.deliveriesOpen ? 'open' : ''} ontoggle="notificationChannelsState.deliveriesOpen=this.open"><summary>最近投递记录（${st.recentDeliveries.length} 条）</summary>
            <div class="nc-delivery-list">${st.recentDeliveries.map(d => {
                const statusMap = {sent: '已发送', pending: '待重试', failed: '发送失败', skipped: '已跳过'};
                return `<div class="nc-delivery-row">
                  <span class="nc-del-status nc-del-${escHtml(d.status)}">${escHtml(statusMap[d.status] || d.status)}</span>
                  <span class="nc-del-title">${escHtml(d.title || '')}</span>
                  <span class="nc-del-meta">${escHtml(WEBHOOK_TYPE_LABELS[d.channel_type] || d.channel_type)} · ${escHtml(String(d.sent_at || d.created_at || '').replace('T', ' ').slice(0, 16))}${d.last_error ? ` · ${escHtml(d.last_error)}` : ''}</span>
                </div>`;
            }).join('')}</div>
          </details>`
        : '';

    return `<section class="settings-card settings-card-wide nc-card" aria-label="群机器人通道">
      <div class="nc-header">
        <div><h2>群机器人通道</h2><p class="nc-subtitle">将订阅的项目提醒推送到企业微信、钉钉或飞书工作群。</p></div>
        <button type="button" id="ncAddWebhookBtn" class="btn btn-sm btn-primary" ${webhookActionsDisabled ? 'disabled' : ''} onclick="openWebhookEditor()">添加群机器人</button>
      </div>
      ${ready && st.error ? `<div class="rb-error" role="alert">${escHtml(st.error)}</div>` : ''}
      <div id="ncTestStatus" class="nc-test-status" role="status" aria-live="polite" hidden></div>
      <div class="nc-wh-list">${webhookRows}</div>
      ${deliveriesHtml || (ready ? '<p class="nc-subtitle">暂无群机器人投递记录</p>' : '')}
    </section>
    <section class="settings-card settings-card-wide nc-card nc-local" aria-label="即时提醒设置">
      <div class="nc-header"><h2>消息中心与桌面提醒 <span id="ncDraftDirtyBadge" class="rb-badge rb-badge-warn" ${dirty ? '' : 'hidden'}>有未保存修改</span></h2></div>
      <div class="nc-toggles-grid">
        <label class="nc-check-option"><input type="checkbox" id="ncInAppEnabled" data-immediate-setting ${draft.in_app_enabled ? 'checked' : ''} ${controlsDisabled ? 'disabled' : ''} onchange="onNotificationToggleDraftInput()"><span>启用右上角站内消息中心</span></label>
        <div class="nc-desktop-row">
          <label class="nc-check-option"><input type="checkbox" id="ncDesktopPopupEnabled" data-immediate-setting ${draft.desktop_popup_enabled ? 'checked' : ''} ${controlsDisabled ? 'disabled' : ''} onchange="onNotificationToggleDraftInput()"><span>启用 Windows 托盘原生气泡通知（超过 2 条自动汇总）</span></label>
          <button type="button" class="btn btn-xs btn-secondary" data-nc-test-btn="desktop" data-idle-label="测试托盘气泡" ${!ready || st.testingId === 'desktop' ? 'disabled' : ''} onclick="testNotificationChannel('desktop')">${st.testingId === 'desktop' ? '发送中…' : '测试托盘气泡'}</button>
        </div>
        <div class="nc-quiet-row">
          <label class="nc-check-option"><input type="checkbox" id="ncQuietHoursEnabled" data-immediate-setting ${draft.quiet_hours_enabled ? 'checked' : ''} ${controlsDisabled ? 'disabled' : ''} onchange="onNotificationToggleDraftInput()"><span>启用免打扰（桌面与群推送）</span></label>
          <div class="nc-quiet-range" id="ncQuietRange" ${draft.quiet_hours_enabled ? '' : 'hidden'}>
          <input type="time" id="ncQuietStart" data-immediate-setting aria-label="免打扰开始时间" value="${escHtml(draft.quiet_start || '22:00')}" ${controlsDisabled ? 'disabled' : ''} oninput="onNotificationToggleDraftInput()" onchange="onNotificationToggleDraftInput()">
          <span>至</span>
          <input type="time" id="ncQuietEnd" data-immediate-setting aria-label="免打扰结束时间" value="${escHtml(draft.quiet_end || '08:00')}" ${controlsDisabled ? 'disabled' : ''} oninput="onNotificationToggleDraftInput()" onchange="onNotificationToggleDraftInput()">
          </div>
        </div>
      </div>
      <button type="button" id="ncSaveTogglesBtn" class="btn btn-sm btn-primary" ${controlsDisabled ? 'disabled' : ''} onclick="saveNotificationToggleSettings()">${st.saving ? '保存中…' : '保存提醒设置'}</button>
    </section>`;
}

function mountNotificationChannelsCard() {
    if (typeof document === 'undefined' || !document || typeof document.getElementById !== 'function') return;
    try {
        const host = document.getElementById('notificationChannelsHost');
        if (!host) return;
        const prevDetails = host.querySelector('.nc-deliveries');
        if (prevDetails) {
            notificationChannelsState.deliveriesOpen = Boolean(prevDetails.open);
        }
        host.innerHTML = renderNotificationChannelsCard();
    } catch (_) {}
}

async function loadNotificationChannelsPanel() {
    if (typeof currentIsAdmin === 'undefined' || !currentIsAdmin) return;
    const hadLoaded = Boolean(notificationChannelsState.loaded);
    const keepDraft = hadLoaded && isNotificationChannelsDraftDirty();
    notificationChannelsState.loading = true;
    notificationChannelsState.loadFailed = false;
    notificationChannelsState.error = '';
    mountNotificationChannelsCard();
    try {
        const res = await api('GET', '/api/notifications/channels');
        if (res?.config) {
            notificationChannelsState.config = res.config;
            notificationChannelsState.savedToggles = _extractToggleSnapshot(res.config);
            if (!keepDraft) {
                notificationChannelsState.draftToggles = _extractToggleSnapshot(res.config);
            }
        }
        if (Array.isArray(res?.categories)) notificationChannelsState.categories = res.categories;
        notificationChannelsState.recentDeliveries = Array.isArray(res?.recent_deliveries) ? res.recent_deliveries : [];
        notificationChannelsState.isDesktop = Boolean(res?.is_desktop);
        notificationChannelsState.loaded = true;
        notificationChannelsState.loadFailed = false;
    } catch (err) {
        notificationChannelsState.error = err?.message || '读取通知通道配置失败';
        if (!hadLoaded) notificationChannelsState.loadFailed = true;
    } finally {
        notificationChannelsState.loading = false;
        mountNotificationChannelsCard();
    }
}

function readNotificationToggleInputs() {
    const draft = notificationChannelsState.draftToggles;
    const inApp = document.getElementById('ncInAppEnabled');
    const desktop = document.getElementById('ncDesktopPopupEnabled');
    const quiet = document.getElementById('ncQuietHoursEnabled');
    const qStart = document.getElementById('ncQuietStart');
    const qEnd = document.getElementById('ncQuietEnd');
    if (inApp) draft.in_app_enabled = inApp.checked;
    if (desktop) draft.desktop_popup_enabled = desktop.checked;
    if (quiet) draft.quiet_hours_enabled = quiet.checked;
    if (qStart && qStart.value) draft.quiet_start = qStart.value;
    if (qEnd && qEnd.value) draft.quiet_end = qEnd.value;
}

async function saveNotificationToggleSettings() {
    if (!notificationChannelsState.loaded) {
        toast('通知通道配置尚未加载完成，请稍候或先重试读取', 'warning');
        return false;
    }
    readNotificationToggleInputs();
    notificationChannelsState.saving = true;
    notificationChannelsState.error = '';
    mountNotificationChannelsCard();
    try {
        // Send ONLY toggle/quiet-hours settings — omit 'webhooks' so server preserves existing bots & DPAPI secrets
        const d = notificationChannelsState.draftToggles;
        const payload = {
            in_app_enabled: Boolean(d.in_app_enabled),
            desktop_popup_enabled: Boolean(d.desktop_popup_enabled),
            quiet_hours_enabled: Boolean(d.quiet_hours_enabled),
            quiet_start: d.quiet_start || '22:00',
            quiet_end: d.quiet_end || '08:00',
        };
        const res = await api('PUT', '/api/notifications/channels', payload);
        if (res?.config) {
            notificationChannelsState.config = res.config;
            notificationChannelsState.savedToggles = _extractToggleSnapshot(res.config);
            notificationChannelsState.draftToggles = _extractToggleSnapshot(res.config);
        }
        notificationChannelsState.recentDeliveries = Array.isArray(res?.recent_deliveries) ? res.recent_deliveries : notificationChannelsState.recentDeliveries;
        toast('即时通知设置已保存', 'success');
        return true;
    } catch (err) {
        notificationChannelsState.error = err?.message || '保存即时通知设置失败';
        toast(notificationChannelsState.error, 'error');
        return false;
    } finally {
        notificationChannelsState.saving = false;
        mountNotificationChannelsCard();
    }
}

async function saveWebhookListOnly(nextWebhooks) {
    if (!notificationChannelsState.loaded) {
        toast('通知通道配置尚未加载完成，请稍候或先重试读取', 'warning');
        return false;
    }
    // Capture any unsaved toggle draft before re-rendering, WITHOUT submitting it!
    readNotificationToggleInputs();
    notificationChannelsState.mutatingWebhook = true;
    notificationChannelsState.error = '';
    mountNotificationChannelsCard();
    try {
        // Send ONLY {webhooks} — omit global toggles so unsaved quiet-hours drafts are NEVER silently committed
        const res = await api('PUT', '/api/notifications/channels', {webhooks: nextWebhooks});
        if (res?.config) {
            notificationChannelsState.config = res.config;
            notificationChannelsState.savedToggles = _extractToggleSnapshot(res.config);
        }
        notificationChannelsState.recentDeliveries = Array.isArray(res?.recent_deliveries) ? res.recent_deliveries : notificationChannelsState.recentDeliveries;
        toast('群机器人配置已更新', 'success');
        return true;
    } catch (err) {
        notificationChannelsState.error = err?.message || '保存群机器人配置失败';
        toast(notificationChannelsState.error, 'error');
        return false;
    } finally {
        notificationChannelsState.mutatingWebhook = false;
        mountNotificationChannelsCard();
    }
}

async function saveNotificationChannelsConfig(overrideWebhooks = null) {
    if (Array.isArray(overrideWebhooks)) {
        return saveWebhookListOnly(overrideWebhooks);
    }
    return saveNotificationToggleSettings();
}

function openWebhookEditor(channelId = '') {
    if (!notificationChannelsState.loaded) {
        toast('通知通道配置尚未加载完成，请稍候或先重试读取', 'warning');
        return;
    }
    readNotificationToggleInputs();
    const existing = (notificationChannelsState.config.webhooks || []).find(item => item.id === channelId) || null;
    const selectedEvents = new Set(existing?.event_types || ['stage_due', 'guarantee', 'deadline', 'supplier_shortage']);
    const checks = notificationChannelsState.categories.map(cat =>
        `<label class="nc-check-option"><input type="checkbox" class="nc-ev-cb" value="${escHtml(cat.key)}" ${selectedEvents.has(cat.key) ? 'checked' : ''}><span>${escHtml(cat.label)}</span></label>`
    ).join('');
    const selectOptions = (values, current) => Object.entries(values).map(([key,label]) =>
        `<option value="${escHtml(key)}" ${key===current?'selected':''}>${escHtml(label)}</option>`).join('');
    showModal(
        existing ? '编辑群机器人通道' : '添加群机器人通道',
        `<div class="nc-editor"><div id="ncWhEditorError" class="rb-error" role="alert" hidden style="margin-bottom:10px"></div>
         <div class="nc-editor-layout"><div class="nc-editor-form"><fieldset><legend>工作群连接</legend><div class="form-group">
           <label for="ncWhName">通道名称</label>
           <input type="text" id="ncWhName" value="${escHtml(existing?.name || '')}" placeholder="例如：招标业务总群（企微）">
         </div>
         <div class="form-group">
           <label for="ncWhType">平台类型</label>
           <select id="ncWhType" onchange="updateWebhookPlatformFields()">
             <option value="wecom" ${(existing?.type || 'wecom') === 'wecom' ? 'selected' : ''}>企业微信群机器人</option>
             <option value="dingtalk" ${existing?.type === 'dingtalk' ? 'selected' : ''}>钉钉群机器人</option>
             <option value="feishu" ${existing?.type === 'feishu' ? 'selected' : ''}>飞书群机器人</option>
           </select>
         </div>
         <div class="form-group">
           <label for="ncWhUrl">Webhook 地址（HTTPS）</label>
           <input type="url" id="ncWhUrl" value="" placeholder="${existing?.has_webhook_url ? '留空保持已加密保存的地址' : 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...'}" autocomplete="off">
         </div>
         <div class="form-group" id="ncWhSigning">
           <label for="ncWhSecret">加签密钥 Secret（可选，钉钉/飞书推荐）</label>
           <input type="password" id="ncWhSecret" value="" placeholder="${existing?.has_secret ? '留空保持已加密保存的密钥' : '未开启加签可留空'}" autocomplete="new-password">
         </div>
         <details class="nc-advanced" ${existing?.allow_custom_host ? 'open' : ''}><summary>高级连接设置</summary><label class="nc-check-option"><input type="checkbox" id="ncWhCustomHost" ${existing?.allow_custom_host ? 'checked' : ''}><span>允许自定义私有化部署域名（仍强制 HTTPS 且禁止回环与链路本地地址）</span></label></details></fieldset>
         <fieldset><legend>订阅提醒事件</legend>
           <div class="nc-event-grid">${checks}</div>
         </fieldset>
         <fieldset><legend>发送规则</legend><div class="nc-rule-grid form-group">
           <label>新提醒的级别<select id="ncWhSeverity">${selectOptions({info:'所有级别',warning:'预警和紧急',urgent:'仅紧急'},existing?.min_severity || 'info')}</select></label>
           <label>允许投递的日期<select id="ncWhDays">${selectOptions({daily:'每天',weekdays:'周一至周五',weekends:'周六和周日'},existing?.delivery_days || 'daily')}</select></label></div>
           <small>允许日期以外的提醒顺延投递，同时遵循免打扰时段。</small></fieldset>
         <fieldset oninput="scheduleGroupPreview()" onchange="scheduleGroupPreview()"><legend>群消息内容</legend><div class="nc-rule-grid form-group">
           <label>消息样式<select id="ncWhStyle">${selectOptions({detail:'明细卡片',compact:'精简摘要'},existing?.message_style || 'detail')}</select></label>
           <label>标题前缀<input id="ncWhPrefix" maxlength="24" placeholder="例如：采购一部" value="${escHtml(existing?.title_prefix || '')}"></label></div>
           <div class="nc-event-grid"><label class="nc-check-option"><input type="checkbox" id="ncWhCategory" ${existing?.show_category!==false?'checked':''}>事件类别</label>
           <label class="nc-check-option"><input type="checkbox" id="ncWhTime" ${existing?.show_time!==false?'checked':''}>提醒产生时间</label></div></fieldset></div>
         <aside class="nc-sample form-group"><label for="ncWhSample">群消息预览</label>
           <select id="ncWhSample" onchange="scheduleGroupPreview()">${selectOptions(Object.fromEntries(notificationChannelsState.categories.map(c=>[c.key,c.label])),[...selectedEvents][0])}</select>
           <article id="ncWhPreview" aria-live="polite">正在生成示例…</article><small>示例数据 · 实际排版随群平台调整</small></aside></div>
         <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:16px">
           <button type="button" class="btn btn-secondary" onclick="closeModal()">取消</button>
           <button type="button" id="ncWhSubmitBtn" class="btn btn-primary" data-dialog-submit onclick="submitWebhookEditor('${escHtml(existing?.id || '')}')">保存通道</button>
         </div></div>`, null, {wide:true}
    );
    updateWebhookPlatformFields();
    scheduleGroupPreview();
}

function updateWebhookPlatformFields() {
    const type = document.getElementById('ncWhType')?.value || 'wecom';
    const url = document.getElementById('ncWhUrl');
    const examples = {wecom:'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=…',dingtalk:'https://oapi.dingtalk.com/robot/send?access_token=…',feishu:'https://open.feishu.cn/open-apis/bot/v2/hook/…'};
    if (url && !url.placeholder.includes('留空')) url.placeholder = examples[type];
    const signing = document.getElementById('ncWhSigning');
    if (signing) signing.hidden = type === 'wecom';
}

function groupMessagePreferences() {
    const input = id => document.getElementById(id);
    return {message_style:input('ncWhStyle').value, title_prefix:input('ncWhPrefix').value.trim(),
        show_category:input('ncWhCategory').checked, show_time:input('ncWhTime').checked,
        min_severity:input('ncWhSeverity').value, delivery_days:input('ncWhDays').value};
}

let groupPreviewTimer, groupPreviewRevision = 0;
function scheduleGroupPreview() {
    clearTimeout(groupPreviewTimer);
    const revision = ++groupPreviewRevision;
    const host = document.getElementById('ncWhPreview');
    if (!host) return;
    groupPreviewTimer = setTimeout(async () => {
        if (!host.isConnected) return;
        try {
            const message = await api('POST','/api/notifications/channels/preview',{
                ...groupMessagePreferences(), category:document.getElementById('ncWhSample').value});
            if (!host.isConnected || revision!==groupPreviewRevision) return;
            const rows = message.details.map(v=>escHtml(v));
            const detailRows = message.details.map(value=>{
                const colon=value.indexOf('：');
                return colon>0 && colon<=12
                    ? `<p><b>${escHtml(value.slice(0,colon))}</b>　${escHtml(value.slice(colon+1))}</p>`
                    : `<p>${escHtml(value)}</p>`;
            });
            host.innerHTML = `<strong>${escHtml(message.title)}</strong><div>${message.style==='compact'?rows.join(' · '):detailRows.join('')}</div>${message.meta.length?`<footer>${message.meta.map(v=>escHtml(v)).join(' · ')}</footer>`:''}`;
        } catch(error) {
            if (host.isConnected && revision===groupPreviewRevision) host.textContent = error.message || '暂时无法生成预览';
        }
    },160);
}

function _setWebhookEditorError(message) {
    const box = document.getElementById('ncWhEditorError');
    if (!box) return;
    if (message) {
        box.textContent = message;
        box.hidden = false;
    } else {
        box.textContent = '';
        box.hidden = true;
    }
}

async function submitWebhookEditor(existingId) {
    if (!notificationChannelsState.loaded) {
        toast('通知通道配置尚未加载完成，请稍候或先重试读取', 'warning');
        return;
    }
    const name = String(document.getElementById('ncWhName')?.value || '').trim();
    const type = String(document.getElementById('ncWhType')?.value || 'wecom').trim();
    const webhookUrl = String(document.getElementById('ncWhUrl')?.value || '').trim();
    const secret = String(document.getElementById('ncWhSecret')?.value || '').trim();
    const allowCustomHost = Boolean(document.getElementById('ncWhCustomHost')?.checked);
    const eventTypes = [...document.querySelectorAll('.nc-ev-cb:checked')].map(el => el.value);
    if (!eventTypes.length) {
        _setWebhookEditorError('请至少选择一种提醒事件');
        return;
    }
    if (!name) {
        _setWebhookEditorError('请填写通道名称');
        toast('请填写通道名称', 'warning');
        return;
    }
    if (!existingId && !webhookUrl) {
        _setWebhookEditorError('请填写 Webhook 地址');
        toast('请填写 Webhook 地址', 'warning');
        return;
    }
    _setWebhookEditorError('');

    const list = (notificationChannelsState.config.webhooks || []).map(item => ({...item}));
    const entry = {
        id: existingId || `wh-${Date.now().toString(36)}`,
        name,
        type,
        enabled: true,
        allow_custom_host: allowCustomHost,
        event_types: eventTypes,
        ...groupMessagePreferences(),
    };
    if (webhookUrl) entry.webhook_url = webhookUrl;
    if (secret) entry.secret = secret;

    const idx = list.findIndex(item => item.id === entry.id);
    if (idx >= 0) {
        entry.enabled = list[idx].enabled;
        list[idx] = entry;
    } else {
        list.push(entry);
    }
    const submitBtn = document.getElementById('ncWhSubmitBtn');
    if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = '保存中…';
    }
    const ok = await saveWebhookListOnly(list);
    if (ok) {
        closeModal();
    } else {
        if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.textContent = '保存通道';
        }
        _setWebhookEditorError(notificationChannelsState.error || '保存通道失败，请检查地址或网络后重试');
    }
}

async function toggleWebhookEnabled(channelId) {
    if (!notificationChannelsState.loaded) return;
    const list = (notificationChannelsState.config.webhooks || []).map(item =>
        item.id === channelId ? {...item, enabled: !item.enabled} : {...item}
    );
    await saveWebhookListOnly(list);
}

async function removeWebhookChannel(channelId) {
    if (!notificationChannelsState.loaded) return;
    const target = (notificationChannelsState.config.webhooks || []).find(item => item.id === channelId);
    const ok = await confirmDialog('删除群机器人', `确定删除群机器人「${target?.name || channelId}」吗？`, '删除', 'btn-danger');
    if (!ok) return;
    const list = (notificationChannelsState.config.webhooks || []).filter(item => item.id !== channelId);
    await saveWebhookListOnly(list);
}

async function testNotificationChannel(channelId) {
    // Update only the target test button and inline status — never re-render the card so unsaved drafts and <details open> stay intact
    notificationChannelsState.testingId = channelId;
    const host = document.getElementById('notificationChannelsHost');
    const btn = host?.querySelector(`[data-nc-test-btn="${channelId}"]`);
    const idleLabel = btn?.getAttribute('data-idle-label') || (channelId === 'desktop' ? '测试托盘气泡' : '测试');
    const statusBox = host?.querySelector('#ncTestStatus');
    if (btn) {
        btn.disabled = true;
        btn.textContent = '发送中…';
    }
    try {
        const res = await api('POST', `/api/notifications/channels/${encodeURIComponent(channelId)}/test`, {});
        const msg = res?.message || '测试通知已发送';
        if (statusBox) {
            statusBox.className = 'nc-test-status is-success';
            statusBox.textContent = msg;
            statusBox.hidden = false;
        }
        toast(msg, 'success');
    } catch (err) {
        const msg = err?.message || '测试发送失败';
        if (statusBox) {
            statusBox.className = 'nc-test-status is-error';
            statusBox.textContent = msg;
            statusBox.hidden = false;
        }
        toast(msg, 'error');
    } finally {
        notificationChannelsState.testingId = '';
        if (btn) {
            btn.disabled = false;
            btn.textContent = idleLabel;
        }
    }
}
