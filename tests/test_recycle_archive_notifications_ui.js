'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const {JSDOM} = require('jsdom');

const root = path.resolve(__dirname, '..');
const escHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));

function loadFrontendSlice(files, html, extraGlobals = {}) {
    const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`, {url: 'http://127.0.0.1:5001/'});
    Object.defineProperty(dom.window.document, 'hidden', {value: false, configurable: true});
    const ctx = {
        window: dom.window,
        document: dom.window.document,
        localStorage: dom.window.localStorage,
        Event: dom.window.Event,
        URLSearchParams,
        Intl,
        setTimeout,
        clearTimeout,
        setInterval: () => 1,
        clearInterval: () => {},
        console,
        escHtml,
        toast: () => {},
        showModal: () => {},
        closeModal: () => {},
        confirmDialog: async () => true,
        currentIsAdmin: true,
        systemSettings: {cold_archive_active_years: 2},
        ...extraGlobals,
    };
    vm.createContext(ctx);
    for (const file of files) {
        const src = fs.readFileSync(path.join(root, file), 'utf8');
        vm.runInContext(src, ctx, {filename: file});
    }
    return {dom, ctx};
}

test('a late metric detail request preserves a subsequently opened dialog', async () => {
    for (const failed of [false, true]) {
        const {ctx, dom} = loadFrontendSlice(['source/frontend/09-command-center.js'],
            '<div id="modalOverlay" class="open"><div id="modal"><div id="modalBody"></div></div></div>');
        const doc = dom.window.document;
        let finish;
        ctx.showModal = (_title, html) => { doc.getElementById('modalBody').innerHTML = html; };
        ctx.ensureFullBusinessProjects = () => new Promise((resolve, reject) => {
            finish = () => failed ? reject(new Error('测试读取失败')) : resolve([]);
        });
        vm.runInContext('commandDashboardModel = {isAggregated:true}', ctx);
        ctx.openCommandMetricList('active');
        ctx.showModal('另一个表单', '<input id="unsaved" value="尚未保存的内容">');
        finish();
        await new Promise(resolve => setTimeout(resolve, 0));
        assert.equal(doc.getElementById('unsaved')?.value, '尚未保存的内容');
        dom.window.close();
    }
});

test('recycle bin card renders items, marks immediate controls, and prompts on 409 number_conflict', async () => {
    const modalCalls = [];
    const apiCalls = [];
    const {dom, ctx} = loadFrontendSlice(
        ['source/frontend/27-recycle-bin.js'],
        '<div id="recycleBinHost"></div>',
        {
            showModal: (title, html) => modalCalls.push({title, html}),
            api: async (method, url, body) => {
                apiCalls.push({method, url, body});
                if (method === 'GET' && url.startsWith('/api/recycle-bin')) {
                    return {
                        total: 1,
                        retention_days: 30,
                        can_empty: true,
                        counts: {all: 1, project: 1, attachment: 0, complaint: 0, clarification: 0},
                        items: [{
                            id: 7,
                            entity_type: 'project',
                            entity_id: 42,
                            project_id: 42,
                            display_title: '2026-001 · 示例项目',
                            snapshot: {original_number: '2026-001', purchaser: '单位A', year: '2026', method: '公开招标', attachment_count: 2, attachment_bytes: 2048},
                            deleted_by_name: 'admin',
                            delete_reason: '误删',
                            deleted_at: '2026-11-24T10:00:00',
                            purge_after: '2026-12-24T10:00:00',
                            days_remaining: 30,
                            parent_project_deleted: false,
                            can_restore: true,
                            can_purge: true,
                        }],
                    };
                }
                if (method === 'POST' && url === '/api/recycle-bin/7/restore' && !body?.new_number) {
                    const err = new Error('原项目编号已被占用');
                    err.status = 409;
                    err.error_code = 'number_conflict';
                    err.details = {code: 'number_conflict', original_number: '2026-001'};
                    throw err;
                }
                return {ok: true, message: '已恢复'};
            },
        }
    );

    await ctx.loadRecycleBinPanel({force: true});
    const doc = dom.window.document;
    assert.match(doc.getElementById('recycleBinHost').textContent, /2026-001 · 示例项目/);
    // Cold archive window setting must NOT be mixed inside recycle bin card
    assert.equal(doc.getElementById('coldArchiveActiveYears'), null);
    // All inputs in recycle bin card carry data-immediate-setting so they never dirty unrelated settings forms
    for (const input of doc.querySelectorAll('#recycleBinHost input')) {
        assert.equal(input.hasAttribute('data-immediate-setting'), true);
    }
    // Partial refresh preserves search input focus and unsaved retention days draft
    const searchInput = doc.getElementById('recycleBinSearchInput');
    const retentionInput = doc.getElementById('recycleRetentionDays');
    retentionInput.value = '45';
    searchInput.focus();
    assert.equal(doc.activeElement, searchInput);
    await ctx.loadRecycleBinPanel({force: true});
    assert.equal(doc.getElementById('recycleBinSearchInput'), searchInput);
    assert.equal(doc.activeElement, searchInput);
    assert.equal(doc.getElementById('recycleRetentionDays').value, '45');

    await ctx.restoreRecycleBinItem(7);
    assert.equal(modalCalls.length, 1);
    assert.equal(modalCalls[0].title, '项目编号已被占用');
    assert.match(modalCalls[0].html, /2026-001-恢复/);
});

test('notification center preserves focus across async load, supports Escape & load-more, and opens openStageSlide', async () => {
    const selectedProjects = [];
    const openedStages = [];
    const readCalls = [];
    const {dom, ctx} = loadFrontendSlice(
        ['source/frontend/28-notifications.js'],
        '<div id="app"><button id="userBtn" type="button">账号</button></div>',
        {
            selectProject: async pid => { selectedProjects.push(pid); },
            openStageSlide: key => { openedStages.push(key); },
            api: async (method, url) => {
                if (url === '/api/notifications/unread-count') {
                    return {unread_count: 3, urgent_unread_count: 1, latest_id: 9};
                }
                if (url.startsWith('/api/notifications?')) {
                    const page = new URL(`http://x${url}`).searchParams.get('page');
                    if (page === '2') {
                        return {
                            total: 2,
                            unread_count: 3,
                            urgent_unread_count: 1,
                            items: [{
                                id: 10,
                                category: 'guarantee',
                                category_label: '保证金退还与复核',
                                severity: 'warning',
                                title: '第2页提醒',
                                summary: '',
                                project_id: 100,
                                target: {view: 'project', project_id: 100, tab: 'board'},
                                created_at: '2026-11-23T09:00:00',
                                read: false,
                            }],
                        };
                    }
                    return {
                        total: 2,
                        unread_count: 3,
                        urgent_unread_count: 1,
                        items: [{
                            id: 9,
                            category: 'stage_due',
                            category_label: '阶段节点提醒',
                            severity: 'urgent',
                            title: '【今日到期】演示项目 · 开标',
                            summary: '项目编号：2026-009',
                            project_id: 99,
                            target: {view: 'project', project_id: 99, tab: 'board', stage_key: 'bid_opening'},
                            created_at: '2026-11-24T09:00:00',
                            read: false,
                        }],
                    };
                }
                if (method === 'POST' && url === '/api/notifications/9/read') {
                    readCalls.push(9);
                    return {ok: true};
                }
                return {ok: true};
            },
        }
    );

    ctx.initNotificationCenter();
    await new Promise(r => setTimeout(r, 15));
    const doc = dom.window.document;
    const bell = doc.getElementById('notifBellBtn');
    const badge = doc.getElementById('notifBellBadge');
    assert.ok(bell);
    assert.equal(badge.hidden, false);
    assert.equal(badge.textContent, '3');
    assert.equal(badge.classList.contains('is-urgent'), true);
    assert.match(bell.getAttribute('aria-label'), /3 条未读/);

    ctx.openNotificationDrawer(bell);
    const closeBtn = doc.getElementById('notifCloseBtn');
    assert.equal(doc.activeElement, closeBtn);
    await new Promise(r => setTimeout(r, 15));
    const drawer = doc.getElementById('notificationDrawer');
    assert.equal(drawer.hidden, false);
    assert.match(drawer.textContent, /演示项目 · 开标/);
    // Focus stays inside drawer after async data load (not dropped to BODY!)
    assert.equal(doc.activeElement, closeBtn);
    // Load more pagination keeps button intact during request, appends page 2, and moves focus to first newly appended item
    const loadMoreBtn = doc.getElementById('notifLoadMoreBtn');
    assert.ok(loadMoreBtn);
    loadMoreBtn.focus();
    assert.equal(doc.activeElement, loadMoreBtn);
    await ctx.loadNotificationList({force: true, append: true});
    assert.match(drawer.textContent, /第2页提醒/);
    const firstNewItemBtn = doc.querySelector('#notifList [data-notif-id="10"] .notif-item-btn');
    assert.ok(firstNewItemBtn);
    assert.equal(doc.activeElement, firstNewItemBtn);

    // Escape closes drawer via document listener even if focus is anywhere
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    assert.equal(drawer.hidden, true);

    // Opening a notification target marks it read, navigates to project, and opens openStageSlide
    ctx.openNotificationDrawer(bell);
    await new Promise(r => setTimeout(r, 15));
    await ctx.openNotificationTarget(9);
    await new Promise(r => setTimeout(r, 160));
    assert.deepEqual(selectedProjects, [99]);
    assert.deepEqual(openedStages, ['bid_opening']);
    assert.deepEqual(readCalls, [9]);
});

test('notification channels card blocks save before load, isolates toggle drafts from webhook sub-buttons, and guards category switch', async () => {
    let modalClosed = 0;
    const putPayloads = [];
    let releaseGet = null;
    let shouldFailPut = false;
    const {dom, ctx} = loadFrontendSlice(
        ['source/frontend/12-settings-navigation.js', 'source/frontend/28-notifications.js'],
        '<div id="notificationChannelsHost"></div><div id="modalHost"></div>',
        {
            settingsFormDirty: false,
            renderSettingsView: () => {},
            showModal: (_title, html) => {
                dom.window.document.getElementById('modalHost').innerHTML = html;
            },
            closeModal: () => { modalClosed += 1; },
            api: async (method, url, body) => {
                if (method === 'GET' && url === '/api/notifications/channels') {
                    await new Promise(resolve => { releaseGet = resolve; });
                    return {
                        is_desktop: true,
                        categories: [{key: 'stage_due', label: '阶段节点提醒'}, {key: 'guarantee', label: '保证金退还与复核'}],
                        recent_deliveries: [{id: 1, channel_type: 'wecom', title: '开标提醒', status: 'sent', sent_at: '2026-11-24T09:00:00', last_error: ''}],
                        config: {
                            in_app_enabled: true,
                            desktop_popup_enabled: true,
                            quiet_hours_enabled: true,
                            quiet_start: '22:00',
                            quiet_end: '08:00',
                            webhooks: [{
                                id: 'wh-1',
                                name: '招标业务群',
                                type: 'wecom',
                                enabled: true,
                                has_webhook_url: true,
                                webhook_url_masked: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/se…****9988',
                                has_secret: false,
                                event_types: ['stage_due', 'guarantee'],
                            }],
                        },
                    };
                }
                if (method === 'POST' && url.endsWith('/test')) {
                    return {ok: true, message: '测试成功'};
                }
                if (method === 'PUT' && url === '/api/notifications/channels') {
                    if (shouldFailPut) throw new Error('Webhook 域名不在允许范围内');
                    putPayloads.push(body);
                    return {
                        config: {
                            in_app_enabled: body.in_app_enabled ?? true,
                            desktop_popup_enabled: body.desktop_popup_enabled ?? true,
                            quiet_hours_enabled: body.quiet_hours_enabled ?? true,
                            quiet_start: body.quiet_start ?? '22:00',
                            quiet_end: body.quiet_end ?? '08:00',
                            webhooks: body.webhooks ?? [{
                                id: 'wh-1',
                                name: '招标业务群',
                                type: 'wecom',
                                enabled: true,
                                has_webhook_url: true,
                                webhook_url_masked: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/se…****9988',
                                has_secret: false,
                                event_types: ['stage_due', 'guarantee'],
                            }],
                        },
                    };
                }
                return {ok: true};
            },
        }
    );

    // 1. Before initial GET completes, Save & Add buttons MUST be disabled and calling save MUST NOT emit PUT webhooks: []
    const loadPromise = ctx.loadNotificationChannelsPanel();
    const doc = dom.window.document;
    assert.equal(doc.getElementById('ncSaveTogglesBtn').disabled, true);
    assert.equal(doc.getElementById('ncAddWebhookBtn').disabled, true);
    const earlyOk = await ctx.saveNotificationToggleSettings();
    assert.equal(earlyOk, false);
    assert.equal(putPayloads.length, 0);

    // Complete initial GET
    releaseGet();
    await loadPromise;

    const host = doc.getElementById('notificationChannelsHost');
    assert.equal(doc.getElementById('ncSaveTogglesBtn').disabled, false);
    assert.match(host.textContent, /招标业务群/);
    assert.match(host.textContent, /\*\*\*\*9988/);
    assert.match(host.textContent, /最近投递记录/);
    for (const input of host.querySelectorAll('input')) {
        assert.equal(input.hasAttribute('data-immediate-setting'), true);
    }

    // 2. Mutate unsaved quiet start time and open <details>, then run testNotificationChannel -> drafts & details stay intact
    const qStart = doc.getElementById('ncQuietStart');
    const details = host.querySelector('.nc-deliveries');
    qStart.value = '21:30';
    ctx.onNotificationToggleDraftInput();
    details.open = true;
    await ctx.testNotificationChannel('wh-1');
    assert.equal(doc.getElementById('ncQuietStart').value, '21:30');
    assert.equal(host.querySelector('.nc-deliveries').open, true);
    assert.match(doc.getElementById('ncTestStatus').textContent, /测试成功/);

    // 3. Toggling a webhook sends ONLY {webhooks} (never silently saving unsaved 21:30 draft!) and keeps draft dirty
    await ctx.toggleWebhookEnabled('wh-1');
    assert.equal(putPayloads.length, 1);
    assert.equal('quiet_start' in putPayloads[0], false);
    assert.equal(Array.isArray(putPayloads[0].webhooks), true);
    assert.equal(doc.getElementById('ncQuietStart').value, '21:30');
    assert.equal(ctx.isNotificationChannelsDraftDirty(), true);

    // 4. Leaving 'channels' category while toggle draft is dirty MUST be blocked
    ctx.setSettingsCategory('channels');
    assert.equal(ctx.setSettingsCategory('files'), false);

    // 5. Explicitly saving toggles sends ONLY toggle fields (omitting 'webhooks') and clears dirty
    await ctx.saveNotificationToggleSettings();
    assert.equal(putPayloads.length, 2);
    assert.equal('webhooks' in putPayloads[1], false);
    assert.equal(putPayloads[1].quiet_start, '21:30');
    assert.equal(ctx.isNotificationChannelsDraftDirty(), false);

    // 6. Failed webhook editor save keeps modal open with user input intact
    shouldFailPut = true;
    ctx.openWebhookEditor();
    doc.getElementById('ncWhName').value = '错误域名群';
    doc.getElementById('ncWhUrl').value = 'https://evil.example.com/hook';
    await ctx.submitWebhookEditor('');
    assert.equal(modalClosed, 0);
    assert.equal(doc.getElementById('ncWhUrl').value, 'https://evil.example.com/hook');
    assert.match(doc.getElementById('ncWhEditorError').textContent, /不在允许范围内/);
});

test('sidebar cold-start uses server pagination for both cold-archived and same-year 3000-project datasets and preserves allProjects on remote search', async () => {
    const calls = [];
    const {dom, ctx} = loadFrontendSlice(
        ['source/frontend/02-projects.js'],
        `<div class="sidebar-search"><input id="searchInput" value=""></div>
         <div class="sidebar-section-title"><button id="sidebarManageBtn"></button></div>
         <div id="projectList"></div>`,
        {
            allProjects: [],
            currentProject: null,
            sidebarFilter: 'all',
            sidebarManageMode: false,
            selectedProjectIds: new Set(),
            projectById: new Map(),
            projectSearchById: new Map(),
            projectOrderById: new Map(),
            PROJECT_PREFETCH_LIMIT: 0,
            PROJECT_PREFETCH_CONCURRENCY: 1,
            PROJECT_DETAIL_CACHE_TTL_MS: 60000,
            projectPrefetchGeneration: 0,
            projectPrefetchQueue: [],
            projectPrefetchQueued: new Set(),
            projectPrefetchActive: 0,
            projectDetailCache: new Map(),
            projectDetailRequests: new Map(),
            projectPrefetchTimer: null,
            invalidateProjectDerivedState: () => {},
            scheduleActiveProjectPrefetch: () => {},
            updateManageUI: () => {},
            procurementProjectKey: p => p.method || '',
            procurementProjectLabel: p => p.method || '',
            procurementMethodOptions: () => [],
            procurementMethodLabel: m => m.name || '',
            projectColor: () => '#2563eb',
            projectStatusInfo: () => ({text: '进行中', cls: 'active', icon: '•'}),
            challengeBadgeHtml: () => '',
            api: async (method, url) => {
                calls.push(url);
                if (url === '/api/projects/years-summary') {
                    return {
                        active_years_window: 2,
                        cutoff_year: 2025,
                        total_count: 3000,
                        active_scope_count: 500,
                        cold_archived_count: 2500,
                        years: [
                            {year: '2026', total: 260, in_progress: 120, completed: 140, terminated: 0, is_cold_year: false},
                            {year: '2025', total: 240, in_progress: 10, completed: 230, terminated: 0, is_cold_year: false},
                            {year: '2023', total: 2500, in_progress: 0, completed: 2500, terminated: 0, is_cold_year: true},
                        ],
                    };
                }
                if (url.includes('q=2023-OLD')) {
                    return [{id: 999, number: '2023-OLD', name: '历史冷归档项目', purchaser: '单位B', method: '公开招标', year: '2023', progress: 100, is_terminated: false, stages: []}];
                }
                return {
                    items: [{id: 1, number: '2026-001', name: '热数据项目', purchaser: '单位A', method: '公开招标', year: '2026', progress: 40, is_terminated: false, stages: []}],
                    total: 500,
                    page: 1,
                    page_size: 100,
                    has_more: true,
                };
            },
        }
    );

    await ctx.loadAllProjects();
    await new Promise(r => setTimeout(r, 20));
    const doc = dom.window.document;
    // Cold start MUST fetch years-summary first and then directly load paginated page 1 with sort!
    assert.equal(calls.length, 2);
    assert.equal(calls[0], '/api/projects/years-summary');
    assert.match(calls[1], /^\/api\/projects\?year=active&compact=1&paginated=1&page=1&page_size=100/);
    const yearSelect = doc.getElementById('sidebarYearSelect');
    assert.ok(yearSelect);
    assert.equal(yearSelect.hidden, false);
    assert.equal(yearSelect.value, 'active');
    assert.match(doc.getElementById('projectList').textContent, /1\/5 页 · 共 500 项/);
    assert.match(doc.getElementById('projectList').textContent, /已折叠 2500 个历史冷归档项目/);
    assert.equal(dom.window.localStorage.getItem('pmHasColdArchive'), '1');
    // Server-paginated sidebar page MUST NOT overwrite global allProjects!
    assert.equal(ctx.allProjects.length, 0);
    assert.equal(vm.runInContext('sidebarPageProjects.length', ctx), 1);

    // Cross-year search displays cold-archived match WITHOUT overwriting sidebarPageProjects or global allProjects
    doc.getElementById('searchInput').value = '2023-OLD';
    await ctx.searchAcrossAllYears();
    assert.equal(ctx.allProjects.length, 0);
    assert.equal(vm.runInContext('sidebarPageProjects.length', ctx), 1);
    assert.equal(vm.runInContext('sidebarPageProjects[0].number', ctx), '2026-001');
    assert.match(doc.getElementById('projectList').textContent, /2023-OLD/);

    // Clearing search restores active list cleanly
    ctx.clearSidebarSearch();
    assert.match(doc.getElementById('projectList').textContent, /2026-001/);
    assert.doesNotMatch(doc.getElementById('projectList').textContent, /2023-OLD/);

    // Also verify 3000 same-year projects (0 cold-archived) STILL uses server pagination on cold start!
    const syCalls = [];
    const sy = loadFrontendSlice(
        ['source/frontend/02-projects.js'],
        `<div class="sidebar-search"><input id="searchInput" value=""></div>
         <div class="sidebar-section-title"><button id="sidebarManageBtn"></button></div>
         <div id="projectList"></div>`,
        {
            allProjects: [], currentProject: null, sidebarFilter: 'all', sidebarManageMode: false,
            selectedProjectIds: new Set(), projectById: new Map(), projectSearchById: new Map(), projectOrderById: new Map(),
            PROJECT_PREFETCH_LIMIT: 0, PROJECT_PREFETCH_CONCURRENCY: 1, PROJECT_DETAIL_CACHE_TTL_MS: 60000,
            projectPrefetchGeneration: 0, projectPrefetchQueue: [], projectPrefetchQueued: new Set(), projectPrefetchActive: 0,
            projectDetailCache: new Map(), projectDetailRequests: new Map(), projectPrefetchTimer: null,
            invalidateProjectDerivedState: () => {}, scheduleActiveProjectPrefetch: () => {}, updateManageUI: () => {},
            procurementProjectKey: p => p.method || '', procurementProjectLabel: p => p.method || '',
            procurementMethodOptions: () => [], procurementMethodLabel: m => m.name || '',
            projectColor: () => '#2563eb', projectStatusInfo: () => ({text: '进行中', cls: 'active', icon: '•'}),
            challengeBadgeHtml: () => '',
            api: async (_method, url) => {
                syCalls.push(url);
                if (url === '/api/projects/years-summary') {
                    return {
                        active_years_window: 2, cutoff_year: 2025,
                        total_count: 3000, active_scope_count: 3000, cold_archived_count: 0,
                        years: [{year: '2026', total: 3000, in_progress: 3000, completed: 0, terminated: 0, is_cold_year: false}],
                    };
                }
                return {
                    items: [{id: 1, number: '2026-0001', name: '当年项目', purchaser: '单位A', method: '公开招标', year: '2026', progress: 30, is_terminated: false, stages: []}],
                    total: 3000, page: 1, page_size: 100, has_more: true,
                };
            },
        }
    );
    await sy.ctx.loadAllProjects();
    assert.equal(syCalls.length, 2);
    assert.equal(syCalls[0], '/api/projects/years-summary');
    assert.match(syCalls[1], /^\/api\/projects\?year=all&compact=1&paginated=1&page=1&page_size=100/);
    assert.match(sy.dom.window.document.getElementById('projectList').textContent, /1\/30 页 · 共 3000 项/);
});

test('sidebar pagination isolates business views (procure board & batch advance), passes server sort, and ignores stale out-of-order responses', async () => {
    const all300 = Array.from({length: 300}, (_, idx) => {
        const n = idx + 1;
        return {
            id: n,
            number: `P${String(n).padStart(4, '0')}`,
            name: `合成项目${n}`,
            purchaser: '单位S',
            method: n % 2 === 0 ? '公开招标' : '竞争性磋商',
            year: '2026',
            progress: 20,
            is_terminated: false,
            current_stage_key: 'notice',
            stages: [{key: 'notice', stage_key: 'notice', name: '发布公告', completed: false, skipped: false, template_removed: false}],
        };
    });
    const pendingByPage = new Map();
    const apiUrls = [];

    const {dom, ctx} = loadFrontendSlice(
        ['source/frontend/02-projects.js', 'source/frontend/05-views.js'],
        `<div class="sidebar-search"><input id="searchInput" value=""></div>
         <div class="sidebar-section-title"><button id="sidebarManageBtn"></button></div>
         <div id="projectList"></div>
         <div id="procureBoardContent"></div>`,
        {
            allProjects: [], currentProject: null, sidebarFilter: 'all', sidebarManageMode: false,
            selectedProjectIds: new Set(), projectById: new Map(), projectSearchById: new Map(), projectOrderById: new Map(),
            PROJECT_PREFETCH_LIMIT: 0, PROJECT_PREFETCH_CONCURRENCY: 1, PROJECT_DETAIL_CACHE_TTL_MS: 60000,
            projectPrefetchGeneration: 0, projectPrefetchQueue: [], projectPrefetchQueued: new Set(), projectPrefetchActive: 0,
            projectDetailCache: new Map(), projectDetailRequests: new Map(), projectPrefetchTimer: null,
            invalidateProjectDerivedState: () => {}, scheduleActiveProjectPrefetch: () => {}, updateManageUI: () => {},
            showViewLoading: () => {},
            requestViewData: async (_key, fn) => ({accepted: true, value: await fn()}),
            procurementCatalog: () => ({methods: [{id: '公开招标', name: '公开招标'}, {id: '竞争性磋商', name: '竞争性磋商'}]}),
            procurementProjectKey: p => p.method || '', procurementProjectLabel: p => p.method || '',
            procurementMethodOptions: () => [], procurementMethodLabel: m => m.name || '',
            projectStageDefinition: () => ({name: '发布公告'}),
            getProgressColor: () => '#2563eb',
            projectColor: () => '#2563eb', projectStatusInfo: () => ({text: '进行中', cls: 'active', icon: '•'}),
            challengeBadgeHtml: () => '',
            api: async (_method, url) => {
                apiUrls.push(url);
                if (url === '/api/projects/years-summary') {
                    return {
                        active_years_window: 2, cutoff_year: 2025,
                        total_count: 300, active_scope_count: 300, cold_archived_count: 0,
                        years: [{year: '2026', total: 300, in_progress: 300, completed: 0, terminated: 0, is_cold_year: false}],
                    };
                }
                if (url === '/api/projects?year=all&compact=1') {
                    return all300.slice();
                }
                const u = new URL(`http://x${url}`);
                const page = Number(u.searchParams.get('page') || 1);
                const sort = u.searchParams.get('sort') || 'number_asc';
                const sorted = sort === 'number_desc' ? all300.slice().reverse() : all300.slice();
                const start = (page - 1) * 100;
                const payload = {items: sorted.slice(start, start + 100), total: 300, page, page_size: 100, has_more: page < 3, sort};
                if (pendingByPage.has(page)) {
                    const deferred = pendingByPage.get(page);
                    pendingByPage.delete(page);
                    await deferred.promise;
                }
                return payload;
            },
        }
    );

    // 1. Cold start loads ONLY page 1 (100 items) into sidebarPageProjects; allProjects stays empty
    await ctx.loadAllProjects();
    assert.equal(vm.runInContext('sidebarPageProjects.length', ctx), 100);
    assert.equal(ctx.allProjects.length, 0);

    // 2. Opening procurement board fetches full 300 projects on demand (NOT truncated to 100!)
    await ctx.loadProcureBoard();
    const doc = dom.window.document;
    assert.equal(ctx.allProjects.length, 300);
    assert.match(doc.getElementById('procureBoardContent').textContent, /项目总数\s*300/);

    // 3. Switching sidebar sort to desc passes sort=number_desc to server -> Page 1 starts at P0300, Page 2 starts at P0200
    ctx.setSidebarSortDirection('desc');
    await new Promise(r => setTimeout(r, 20));
    assert.equal(vm.runInContext('sidebarPageProjects[0].number', ctx), 'P0300');
    assert.equal(vm.runInContext('sidebarPageProjects[99].number', ctx), 'P0201');
    // Flipping to page 2 does NOT truncate or mutate allProjects (procure board still has all 300 items!)
    ctx.setSidebarPage(1);
    await new Promise(r => setTimeout(r, 20));
    assert.equal(vm.runInContext('sidebarPageProjects[0].number', ctx), 'P0200');
    assert.equal(ctx.allProjects.length, 300);
    assert.match(doc.getElementById('procureBoardContent').textContent, /项目总数\s*300/);

    // 4. Out-of-order async responses: Page 2 delayed, Page 3 resolves first, then Page 2 arrives late -> MUST stay on Page 3!
    let resolveSlowPage2 = null;
    pendingByPage.set(2, {promise: new Promise(resolve => { resolveSlowPage2 = resolve; })});
    ctx.setSidebarPage(1); // triggers slow page=2
    ctx.setSidebarPage(2); // triggers fast page=3
    await new Promise(r => setTimeout(r, 20));
    assert.equal(vm.runInContext('sidebarServerPagination.page', ctx), 3);
    assert.equal(vm.runInContext('sidebarPageProjects[0].number', ctx), 'P0100');
    // Now release the stale page=2 response -> MUST be ignored!
    resolveSlowPage2();
    await new Promise(r => setTimeout(r, 20));
    assert.equal(vm.runInContext('sidebarServerPagination.page', ctx), 3);
    assert.equal(vm.runInContext('sidebarPageProjects[0].number', ctx), 'P0100');
    assert.match(doc.getElementById('projectList').textContent, /3\/3 页 · 共 300 项/);
});

test('CSS [hidden] rules actually hide clean dirty badge & last-page load-more in real Chromium, and 390px deliveries summary >= 44px', async () => {
    const {chromium} = require('playwright');
    const styleCss = fs.readFileSync(path.join(root, 'src/static/style.css'), 'utf8');
    const browser = await chromium.launch();
    try {
        const page = await browser.newPage({viewport: {width: 390, height: 844}});
        await page.setContent(`<!doctype html><html><head><style>${styleCss}</style></head><body>
            <section class="settings-card settings-card-wide nc-card">
                <h2>即时通知与群机器人 Webhook <span id="ncDraftDirtyBadge" class="rb-badge rb-badge-warn" hidden>有未保存修改</span></h2>
                <div id="ncTestStatus" class="nc-test-status" hidden>状态</div>
                <details class="nc-deliveries"><summary id="ncDelSummary">最近投递记录（1 条）</summary><div>row</div></details>
            </section>
            <div class="notif-drawer">
                <div id="notifLoadMoreWrap" class="notif-load-more" hidden><button type="button">加载更多（剩余 0 条）</button></div>
            </div>
        </body></html>`);
        const metrics = await page.evaluate(() => {
            const dirtyStyle = getComputedStyle(document.getElementById('ncDraftDirtyBadge'));
            const loadMoreStyle = getComputedStyle(document.getElementById('notifLoadMoreWrap'));
            const testStatusStyle = getComputedStyle(document.getElementById('ncTestStatus'));
            const summaryRect = document.getElementById('ncDelSummary').getBoundingClientRect();
            return {
                dirtyDisplay: dirtyStyle.display,
                loadMoreDisplay: loadMoreStyle.display,
                testStatusDisplay: testStatusStyle.display,
                summaryHeight: summaryRect.height,
            };
        });
        assert.equal(metrics.dirtyDisplay, 'none', 'Clean dirty badge with [hidden] must have computed display:none');
        assert.equal(metrics.loadMoreDisplay, 'none', 'Last-page load-more wrap with [hidden] must have computed display:none');
        assert.equal(metrics.testStatusDisplay, 'none', 'Hidden test status banner must have computed display:none');
        assert.ok(metrics.summaryHeight >= 44, `390px deliveries summary tap target must be >= 44px, got ${metrics.summaryHeight}px`);
    } finally {
        await browser.close();
    }
});

test('default dashboard startup uses aggregated summary (no 3000-item full download) and empty year scope does not fall back to allProjects', async () => {
    const apiUrls = [];
    const full300 = Array.from({length: 300}, (_, idx) => ({
        id: idx + 1,
        number: `2022-OLD-${String(idx + 1).padStart(3, '0')}`,
        name: `历史归档项目${idx + 1}`,
        purchaser: '单位H',
        method: '公开招标',
        year: '2022',
        progress: 100,
        is_terminated: false,
        stages: [],
    }));
    const {dom, ctx} = loadFrontendSlice(
        ['source/frontend/02-projects.js', 'source/frontend/05-views.js', 'source/frontend/09-command-center.js'],
        `<div class="sidebar-search"><input id="searchInput" value=""></div>
         <div class="sidebar-section-title"><button id="sidebarManageBtn"></button></div>
         <div id="projectList"></div>
         <div class="view active"><div id="dashboardContent"></div></div>
         <div id="procureBoardContent"></div>`,
        {
            allProjects: [], currentProject: null, sidebarFilter: 'all', sidebarManageMode: false,
            selectedProjectIds: new Set(), projectById: new Map(), projectSearchById: new Map(), projectOrderById: new Map(),
            PROJECT_PREFETCH_LIMIT: 0, PROJECT_PREFETCH_CONCURRENCY: 1, PROJECT_DETAIL_CACHE_TTL_MS: 60000,
            projectPrefetchGeneration: 0, projectPrefetchQueue: [], projectPrefetchQueued: new Set(), projectPrefetchActive: 0,
            projectDetailCache: new Map(), projectDetailRequests: new Map(), projectPrefetchTimer: null,
            invalidateProjectDerivedState: () => {}, scheduleActiveProjectPrefetch: () => {}, updateManageUI: () => {},
            showViewLoading: () => {},
            readViewCache: () => null, writeViewCache: () => {}, invalidateViewCache: () => {},
            renderViewSkeleton: () => {}, renderViewLoadError: () => {},
            requestViewData: async (_key, fn) => ({accepted: true, value: await fn()}),
            procurementCatalog: () => ({methods: [{id: '公开招标', name: '公开招标'}]}),
            procurementProjectKey: p => p.method || '', procurementProjectLabel: p => p.method || '',
            procurementMethodOptions: () => [], procurementMethodLabel: m => m.name || '',
            projectStageDefinition: () => ({name: '发布公告'}),
            getProgressColor: () => '#2563eb',
            projectColor: () => '#2563eb', projectStatusInfo: () => ({text: '已完成', cls: 'done', icon: '•'}),
            challengeBadgeHtml: () => '',
            api: async (_method, url) => {
                apiUrls.push(url);
                if (url === '/api/projects/years-summary') {
                    return {
                        active_years_window: 2, cutoff_year: 2025,
                        total_count: 300, active_scope_count: 0, cold_archived_count: 300,
                        years: [{year: '2022', total: 300, in_progress: 0, completed: 300, terminated: 0, is_cold_year: true}],
                    };
                }
                if (url === '/api/projects/dashboard-summary') {
                    return {
                        aggregated: true,
                        stats: {total: 300, completed: 300, in_progress: 0, liubiao: 0, feibiao: 0},
                        metrics: {total: 300, active: 0, unopened: 0, dueSoon: 0, overdue: 0, completed: 300},
                        actions_total: 0, actions: [], key_nodes: [], active_projects: [], active_method_counts: {},
                        insights: {methods: {'公开招标': 300}, stageCounts: {}, riskProjects: []},
                        deadline_overview: {total: 0, overdue: 0, dueSoon: 0, review: 0, alerts: 0, items: [], unavailable: false},
                    };
                }
                if (url === '/api/projects?year=all&compact=1') {
                    return full300.slice();
                }
                if (url.startsWith('/api/projects?year=active&compact=1') && !url.includes('paginated=1')) {
                    return [];
                }
                if (url.includes('paginated=1')) {
                    return {items: full300.slice(0, 100), total: 300, page: 1, page_size: 100, has_more: true, sort: 'number_asc'};
                }
                return [];
            },
        }
    );

    // 1. Cold start (auto scope) + default Dashboard -> MUST use /api/projects/dashboard-summary, NOT year=all&compact=1!
    await ctx.loadAllProjects();
    await ctx.loadDashboard();
    assert.ok(apiUrls.includes('/api/projects/dashboard-summary'), `Expected dashboard-summary call, got: ${apiUrls}`);
    assert.equal(apiUrls.includes('/api/projects?year=all&compact=1'), false, 'Default dashboard startup must NOT download full unpaginated list');
    assert.match(dom.window.document.getElementById('dashboardContent').textContent, /300/);

    // 2. Switch to 'all' (paginated 300 items) and open Procurement Board on demand -> loads full allProjects (300 items)
    await ctx.setSidebarYearScope('all');
    await ctx.loadProcureBoard();
    assert.equal(apiUrls.includes('/api/projects?year=all&compact=1'), true);
    assert.equal(ctx.allProjects.length, 300);

    // 3. Switch sidebar year scope from 'all' to 'active' (0 active items, API returns []) ->
    // sidebar MUST render 0 projects + empty scope prompt, NEVER falling back to full allProjects!
    await ctx.setSidebarYearScope('active');
    const doc = dom.window.document;
    assert.equal(doc.querySelectorAll('#projectList .sidebar-project').length, 0, 'Empty year scope must NOT fall back to allProjects');
    assert.match(doc.getElementById('projectList').textContent, /当前范围暂无项目/);
});

test('Round-5 UI: pre-filtered task buckets, cold-start command palette remote search, and metric modal full upgrade after returning to cached dashboard', async () => {
    const active300 = Array.from({length: 300}, (_, idx) => ({
        id: idx + 1,
        number: `2026-ACT-${String(idx + 1).padStart(4, '0')}`,
        name: `活跃项目${idx + 1}`,
        purchaser: '单位M',
        method: '公开招标',
        year: '2026',
        progress: 30,
        is_terminated: false,
        current_stage_key: 'notice',
        current_stage_name: '发布公告',
        stages: [{key: 'notice', stage_key: 'notice', name: '发布公告', completed: false, skipped: false, template_removed: false}],
    }));
    const overdue120 = Array.from({length: 120}, (_, idx) => ({
        projectId: 1, projectNumber: '2026-ACT-0001', projectName: '活跃项目1',
        stageKey: `ov_${idx}`, stageName: `逾期节点${idx}`, responsiblePerson: '张三',
        plannedAt: '2026-11-01T09:00', deadlineAt: 1, days: -20, urgency: 'overdue',
    }));
    const tomorrowNode = {
        projectId: 2, projectNumber: '2026-ACT-0002', projectName: '活跃项目2',
        stageKey: 'bid_opening', stageName: '明日开标节点', responsiblePerson: '李四',
        plannedAt: '2026-11-26T10:00', deadlineAt: 2, days: 1, urgency: 'soon',
    };
    const dashboardSummaryPayload = {
        aggregated: true,
        stats: {total: 300, completed: 0, in_progress: 300, liubiao: 0, feibiao: 0},
        metrics: {total: 300, active: 300, unopened: 300, dueSoon: 1, overdue: 121, completed: 0},
        actions_total: 122,
        actions: overdue120, // truncated at 120 overdue items
        task_buckets: {
            all: {count: 122, items: overdue120.slice(0, 6)},
            overdue: {count: 121, items: overdue120.slice(0, 6)},
            today: {count: 0, items: []},
            soon: {count: 1, items: [tomorrowNode]},
        },
        key_nodes: [],
        active_projects: active300.slice(0, 24), // 24 preview items
        active_method_counts: {'公开招标': 300},
        insights: {methods: {'公开招标': 300}, stageCounts: {notice: 300}, riskProjects: []},
        deadline_overview: {total: 0, overdue: 0, dueSoon: 0, review: 0, alerts: 0, items: [], unavailable: false},
    };

    let viewCacheVal = null;
    const {dom, ctx} = loadFrontendSlice(
        ['source/frontend/02-projects.js', 'source/frontend/05-views.js', 'source/frontend/09-command-center.js'],
        `<div class="sidebar-search"><input id="searchInput" value=""></div>
         <div class="sidebar-section-title"><button id="sidebarManageBtn"></button></div>
         <div id="projectList"></div>
         <div class="view active"><div id="dashboardContent"></div></div>
         <div id="procureBoardContent"></div>
         <div id="modalOverlay" class="modal-overlay"><div id="modal" class="modal"><div id="modalTitle"></div><div id="modalBody"></div></div></div>`,
        {
            allProjects: [], currentProject: null, sidebarFilter: 'all', sidebarManageMode: false,
            selectedProjectIds: new Set(), projectById: new Map(), projectSearchById: new Map(), projectOrderById: new Map(),
            PROJECT_PREFETCH_LIMIT: 0, PROJECT_PREFETCH_CONCURRENCY: 1, PROJECT_DETAIL_CACHE_TTL_MS: 60000,
            projectPrefetchGeneration: 0, projectPrefetchQueue: [], projectPrefetchQueued: new Set(), projectPrefetchActive: 0,
            projectDetailCache: new Map(), projectDetailRequests: new Map(), projectPrefetchTimer: null,
            invalidateProjectDerivedState: () => {}, scheduleActiveProjectPrefetch: () => {}, updateManageUI: () => {},
            showViewLoading: () => {},
            readViewCache: () => viewCacheVal ? {value: viewCacheVal, fresh: true} : null,
            writeViewCache: (_k, v) => { viewCacheVal = v; },
            invalidateViewCache: () => { viewCacheVal = null; },
            renderViewSkeleton: () => {}, renderViewLoadError: () => {},
            requestViewData: async (_key, fn) => ({accepted: true, value: await fn()}),
            showModal: (title, html) => {
                dom.window.document.getElementById('modalOverlay').classList.add('open');
                dom.window.document.getElementById('modalTitle').textContent = title;
                dom.window.document.getElementById('modalBody').innerHTML = html;
            },
            procurementCatalog: () => ({methods: [{id: '公开招标', name: '公开招标'}]}),
            procurementProjectKey: p => p.method || '', procurementProjectLabel: p => p.method || '',
            procurementMethodOptions: () => [], procurementMethodLabel: m => m.name || '',
            projectStageDefinition: () => ({name: '发布公告'}),
            getProgressColor: () => '#2563eb',
            projectColor: () => '#2563eb', projectStatusInfo: () => ({text: '进行中', cls: 'active', icon: '•'}),
            challengeBadgeHtml: () => '',
            api: async (_method, url) => {
                if (url === '/api/projects/years-summary') {
                    return {
                        active_years_window: 2, cutoff_year: 2025,
                        total_count: 300, active_scope_count: 300, cold_archived_count: 0,
                        years: [{year: '2026', total: 300, in_progress: 300, completed: 0, terminated: 0, is_cold_year: false}],
                    };
                }
                if (url === '/api/projects/dashboard-summary') {
                    return dashboardSummaryPayload;
                }
                if (url === '/api/projects?year=all&compact=1') {
                    return active300.slice();
                }
                if (url.includes('q=2026-ACT-0299')) {
                    return {items: [active300[298]], total: 1, page: 1, page_size: 20, has_more: false};
                }
                return {items: active300.slice(0, 100), total: 300, page: 1, page_size: 100, has_more: true, sort: 'number_asc'};
            },
        }
    );

    const doc = dom.window.document;
    await ctx.loadAllProjects();
    await ctx.loadDashboard();

    // 1. P2①: Clicking '7 天内' filter with 121 overdue + 1 tomorrow MUST display that 1 tomorrow node (not 0!)
    ctx.filterCommandTasks('soon');
    const taskAreaText = doc.getElementById('commandTaskArea').textContent;
    assert.match(taskAreaText, /1 个节点/);
    assert.match(taskAreaText, /明日开标节点/);

    // 2. P2②: Right after cold start (allProjects still []), Command Palette searches backend on demand and finds item #299!
    ctx.openCommandPalette('2026-ACT-0299');
    await new Promise(r => setTimeout(r, 130));
    assert.match(doc.getElementById('commandPaletteResults').textContent, /活跃项目299/);
    ctx.closeCommandPalette();

    // 3. P2③: Enter Procurement Board (loads full 300 items), return to cached Dashboard, click '进行中 300' ->
    // MUST display ALL 300 rows (NOT the 24-row aggregated preview)!
    await ctx.loadProcureBoard();
    assert.equal(ctx.allProjects.length, 300);
    await ctx.loadDashboard(); // hits cached dashboard value!
    ctx.openCommandMetricList('active');
    assert.match(doc.querySelector('[data-metric-summary]').textContent, /显示 300 \/ 300 个项目/);
    assert.equal(doc.querySelectorAll('.command-metric-result').length, 300);
});
