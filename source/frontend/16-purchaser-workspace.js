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
            nav.innerHTML = '<span class="nav-icon">🏢</span><span>按采购人分类</span>';
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
            <span class="purchaser-project-identity"><span class="pc-number">${escHtml(project.number)}</span><strong>${escHtml(project.name)}</strong><span class="purchaser-project-stage">${escHtml(project.method || '未设置采购方式')} · ${escHtml(stage)}</span></span><span class="purchaser-project-state"><span class="mini-status ${status.cls}">${status.icon} ${status.text}</span><span style="color:${getProgressColor(project.progress)}">${Number(project.progress) || 0}%</span></span></button>
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

