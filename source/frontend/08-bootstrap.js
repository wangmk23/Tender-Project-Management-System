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
