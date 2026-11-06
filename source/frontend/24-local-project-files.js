// ── Project scoped local folder index; host operations require server capabilities ──
const localProjectFilesViews = new Map();
let localProjectFilesMount = null;

function localFilesNavigationVersion() {
    return typeof projectNavigationVersion === 'undefined' ? 0 : projectNavigationVersion;
}
function localFilesView(pid) {
    if (!localProjectFilesViews.has(pid)) localProjectFilesViews.set(pid, {
        selected: 'system', state: null, entries: null, parent: '', query: '', search: '', offset: 0,
        path: '', unlink: false, error: '', notice: '', busy: false, uncertain: false, loading: false,
        entriesGeneration: 0, stateGeneration: 0, scanGeneration: 0, timer: null, polls: 0,
    });
    return localProjectFilesViews.get(pid);
}
function mountLocalProjectFiles(container, pid) {
    if (localProjectFilesMount) clearTimeout(localProjectFilesMount.view.timer);
    const view = localFilesView(pid);
    const system = document.createElement('section');
    system.id = 'systemAttachmentsPanel'; system.setAttribute('aria-label', '系统附件');
    while (container.firstChild) system.appendChild(container.firstChild);
    const nav = document.createElement('nav'); nav.className = 'local-files-tabs'; nav.setAttribute('aria-label', '附件来源');
    nav.innerHTML = '<button type="button" class="btn btn-sm btn-secondary" data-source="system">系统附件</button><button type="button" class="btn btn-sm btn-secondary" data-source="local">本地文件</button>';
    const panel = document.createElement('section'); panel.id = 'localProjectFiles'; panel.className = 'local-files'; panel.setAttribute('aria-label', '本地文件');
    container.append(nav, system, panel);
    localProjectFilesMount = {pid, view, panel, nav, system, version: localFilesNavigationVersion()};
    nav.addEventListener('click', event => {
        const source = event.target.closest('[data-source]');
        if (source) selectLocalFilesSource(source.dataset.source);
    });
    panel.addEventListener('click', localFilesClick);
    panel.addEventListener('input', localFilesInput);
    panel.addEventListener('keydown', event => {
        if (event.key === 'Enter' && event.target.name === 'local_query') {event.preventDefault(); localFilesSearch(localProjectFilesMount);}
        if (event.key === 'Escape') {view.unlink = false; renderLocalProjectFiles();}
    });
    selectLocalFilesSource(view.selected);
}
function localFilesActive(context) {
    return context === localProjectFilesMount && context.pid === currentProject?.id
        && context.version === localFilesNavigationVersion() && context.panel.isConnected && context.view.selected === 'local';
}
function selectLocalFilesSource(source) {
    const context = localProjectFilesMount;
    if (!context) return;
    context.view.selected = source;
    context.system.hidden = source !== 'system'; context.panel.hidden = source !== 'local';
    context.nav.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.source === source)));
    clearTimeout(context.view.timer);
    if (source === 'local') {renderLocalProjectFiles(); localFilesRefresh(context, 'initial');}
}
function localFilesButton(action, label, disabled = false) {
    const writes = ['choose','associate','unlink-confirm','cancel-scan','open','open-current'].includes(action);
    return `<button type="button" class="btn btn-sm btn-secondary" data-action="${action}" ${writes ? 'data-local-files-write' : ''} ${disabled ? 'disabled' : ''}>${label}</button>`;
}
function localFilesField(name, label, value) {
    return `<label class="local-files-field">${label}<input class="form-control" name="${name}" value="${escHtml(value)}"></label>`;
}
function localFilesContentUrl(context, item, mode) {
    const revision = context.view.entries?.revision ?? context.view.state.revision;
    const binding = context.view.entries?.binding ?? context.view.state.binding ?? '';
    const query = new URLSearchParams({path:item.path, revision:String(revision), binding, mode});
    return `/api/projects/${context.pid}/local-files/content?${query}`;
}

function localFilesTime(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return new Date(value * 1000).toLocaleString('zh-CN', {hour12:false});
    }
    return value || '—';
}

function localFilesRowActions(context, item, index) {
    if (item.type !== 'file') return '';
    const preview = item.preview_kind
        ? `<button type="button" class="btn btn-sm btn-secondary" data-action="preview-file" data-file-index="${index}" aria-label="${escHtml(`预览 ${item.name}`)}">预览</button>`
        : '';
    const download = context.view.state.capabilities.download
        ? `<a class="btn btn-sm btn-secondary" data-local-download href="${escHtml(localFilesContentUrl(context, item, 'download'))}" download="${escHtml(item.name)}" aria-label="${escHtml(`下载 ${item.name}`)}">下载</a>`
        : '';
    return preview || download ? `<div class="local-files-row-actions">${preview}${download}</div>` : '';
}
function renderLocalProjectFiles() {
    const context = localProjectFilesMount;
    if (!context || !localFilesActive(context)) return;
    const v = context.view, s = v.state, host = !!s?.capabilities?.manage;
    const focus = context.panel.contains(document.activeElement) ? document.activeElement : null;
    const focusName = focus?.name, focusAction = focus?.dataset?.action, focusParent = focus?.dataset?.parent, start = focus?.selectionStart, end = focus?.selectionEnd;
    const b = (action, label, disabled = false) => localFilesButton(action, label, v.busy || disabled);
    let html = `<header class="local-files-header"><div><h3><span data-ui-icon="📁"></span> ${escHtml(s?.linked ? s.label || '项目文件夹' : '本地项目文件')}</h3><p>浏览和搜索现有资料，支持只读预览及按权限下载。</p></div>${s?.linked ? b('refresh', '刷新文件', v.loading) : ''}</header>`;
    if (v.error) html += `<p role="alert" class="local-files-error">${escHtml(v.error)} ${b('refresh', '重试读取')}</p>`;
    if (v.notice) html += `<p role="status">${escHtml(v.notice)}</p>`;
    if (v.busy) html += '<p role="status">正在处理，请稍候…</p>';
    if (host && v.uncertain) html += b('recover', '已核对状态，恢复手动操作');
    if (!s) html += '<p role="status">正在读取关联与缓存…</p>';
    else {
        const statuses = {unlinked:'尚未关联',available:'目录可用',moved:'目录已移动，已定位',missing:'目录失联，请检查磁盘或重新关联',replaced:'目录已替换，需明确重新关联',unsupported:'目录追踪不可用，请核对位置'};
        html += `<p class="local-files-status">${escHtml(statuses[s.status] || s.status)}</p>`;
        if (host && s.path) html += `<p class="local-files-path">${escHtml(s.path)}</p>`;
        if (host) {
            html += '<div class="local-files-toolbar">';
            if (s.linked) html += `${s.capabilities.open ? b('open','打开文件夹') : ''}${b('unlink','解除关联',v.uncertain)}`;
            html += '</div>';
            html += `<details class="local-files-association" ${!s.linked || v.path ? 'open' : ''}><summary>${s.linked ? '重新关联（含跨盘归档）' : '关联现有文件夹'}</summary><p>选择或粘贴主机文件夹路径，核对后确认。重新关联不会搬动原文件。</p>${localFilesField('association_path','主机文件夹路径',v.path)}<div class="local-files-toolbar">${b('choose','选择文件夹')}${b('associate','确认关联',!v.path.trim() || v.uncertain)}</div></details>`;
        } else if (!s.linked) html += '<p>请由主机管理员关联项目文件夹。</p>';
        if (v.unlink && host) html += `<div class="local-files-confirm" role="group" aria-label="解除关联确认"><p>只解除系统关联与索引，磁盘上的所有资料均保留。</p>${b('unlink-confirm','确认解除关联')}${b('dismiss','取消')}</div>`;
        if (s.linked) {
            const scan = s.scan || {}, active = ['queued','scanning'].includes(scan.state);
            const states = {idle:'目录尚未索引',queued:'正在准备目录',scanning:'正在读取文件和子文件夹',complete:'索引已更新',partial:'部分结果',cancelled:'扫描已取消',error:'索引更新失败'};
            const snapshot = s.cache || scan;
            const counts = snapshot.finished_at && (s.cache || snapshot.complete || scan.state === 'partial')
                ? ` · ${Number(snapshot.files || 0)} 个文件、${Number(snapshot.folders || 0)} 个文件夹 · ${escHtml(localFilesTime(snapshot.finished_at))}` : '';
            html += `<div class="local-files-scan" role="status">${escHtml(states[scan.state] || '正在读取目录')}${counts}${active && host ? b('cancel-scan','取消扫描') : ''}</div>`;
            if (scan.errors?.length || scan.skipped_links?.length) html += '<p>有目录无法读取或已跳过链接。已有文件索引可继续查看。</p>';
            const crumbs = v.parent.split('/').filter(Boolean);
            const crumbsHtml = ['项目根目录', ...crumbs].map((part,i) => i === crumbs.length
                ? `<span aria-current="location" tabindex="-1">${escHtml(part)}</span>`
                : `<button type="button" class="btn btn-sm btn-secondary" data-parent="${escHtml(crumbs.slice(0,i).join('/'))}">${escHtml(part)}</button>`).join('');
            html += `<nav class="local-files-breadcrumb" aria-label="目录位置">${crumbs.length ? b('up','上一级') : ''}${crumbsHtml}</nav>`;
            html += `<div class="local-files-toolbar">${localFilesField('local_query','搜索项目内的文件或文件夹',v.query)}${b('search','搜索')}${v.search ? b('clear-search','清除搜索') : ''}${s.capabilities.open && host && v.parent ? b('open-current','在主机打开当前文件夹') : ''}</div>`;
            const entries = v.entries?.parent === v.parent && v.entries?.query === v.search && v.entries?.offset === v.offset ? v.entries : null;
            const items = entries?.items || [];
            html += `<div class="local-files-list" aria-label="${v.search ? '搜索结果' : '当前文件夹内容'}" aria-busy="${v.loading || active}">`;
            html += items.map((item,index)=>{
                const name = escHtml(item.name);
                const itemLabel = item.type==='directory'
                    ? `<button type="button" class="local-files-directory" data-parent="${escHtml(item.path)}"><span data-ui-icon="📁"></span>${name}</button>`
                    : `<span><span data-ui-icon="📄"></span> ${name}</span>`;
                const location = v.search ? `<small class="local-files-location">${escHtml(item.path.split('/').slice(0,-1).join(' / ') || '项目根目录')}</small>` : '';
                return `<div class="local-files-row"><div>${itemLabel}${location}</div><span>${item.type==='directory' ? '文件夹' : '文件'}</span><span>${item.type==='file' ? `${Number(item.size || 0).toLocaleString()} B` : '—'}</span><time>${escHtml(localFilesTime(item.modified))}</time>${localFilesRowActions(context,item,index)}</div>`;
            }).join('') || `<p>${v.loading || active ? '正在读取目录…' : scan.state !== 'complete' && !s.cache ? '暂未取得目录内容，可以刷新文件。' : v.search ? '未找到匹配的文件或文件夹。' : '此文件夹为空。'}</p>`;
            html += '</div>';
            if (entries?.total > 100 || v.offset) html += `<div class="local-files-toolbar">${b('previous','上一页',v.offset===0 || v.loading)}<span>第 ${Math.floor(v.offset/100)+1} 页 · ${Number(entries?.total || 0)} 项</span>${b('next','下一页',!entries?.has_more || v.loading)}</div>`;
        }
    }
    context.panel.innerHTML = html;
    if (focusName) {
        const target = Array.from(context.panel.querySelectorAll('input')).find(input=>input.name===focusName);
        if (target) {target.focus({preventScroll:true}); if (start !== null) target.setSelectionRange(start,end);}
    }
    else if (focusAction) context.panel.querySelector(`[data-action="${focusAction}"]:not(:disabled)`)?.focus({preventScroll:true});
}
function localFilesInput(event) {
    const v = localProjectFilesMount.view, input = event.target;
    if (input.name === 'association_path') v.path = input.value;
    if (input.name === 'local_query') v.query = input.value;
    const associate = localProjectFilesMount.panel.querySelector('[data-action="associate"]');
    if (associate) associate.disabled = v.busy || v.uncertain || !v.path.trim();
}
function localFilesSearch(context) {
    context.view.search = context.view.query.trim();
    return localFilesLoadEntries(context, true);
}
function localFilesBrowse(context, parent) {
    const view = context.view;
    view.parent=parent; view.query=''; view.search='';
    return localFilesLoadEntries(context, true);
}
async function localFilesRefresh(context, indexMode = '') {
    if (!localFilesActive(context)) return;
    const v = context.view, generation = ++context.view.stateGeneration;
    const scanGeneration = v.scanGeneration;
    try {
        const state = await api('GET', `/api/projects/${context.pid}/local-files?view=browser`);
        if (!localFilesActive(context) || generation !== v.stateGeneration || scanGeneration !== v.scanGeneration) return;
        if (v.state && v.state.revision !== state.revision) {v.entriesGeneration++; v.entries=null; v.parent=''; v.query=''; v.search=''; v.offset=0;}
        v.state=state; renderLocalProjectFiles();
        if (state.linked) await localFilesLoadEntries(context, false, indexMode);
        if (generation === v.stateGeneration && scanGeneration === v.scanGeneration) localFilesPoll(context);
        return true;
    } catch(error) {if (localFilesActive(context) && generation === v.stateGeneration) {v.error=error.message || '缓存读取失败，可重试'; renderLocalProjectFiles();}}
}
async function localFilesLoadEntries(context, reset = false, indexMode = '') {
    if (!localFilesActive(context) || !context.view.state?.linked) return;
    const v=context.view;
    if (reset) v.offset=0;
    const generation=++v.entriesGeneration, revision=v.state.revision, scanGeneration=v.scanGeneration;
    const {parent, search:query, offset} = v;
    const params = new URLSearchParams({parent,q:query,offset:String(offset),limit:'100'});
    if (indexMode) params.set('index', indexMode);
    v.loading=true; renderLocalProjectFiles();
    try {
        const result=await api('GET',`/api/projects/${context.pid}/local-files/entries?${params}`);
        if (!localFilesActive(context) || revision!==v.state.revision) return;
        if (result.revision === revision && result.scan && scanGeneration === v.scanGeneration) {
            v.state.scan=result.scan;
            v.polls=0;
        }
        if (generation!==v.entriesGeneration) return;
        if (result.revision!==revision) {v.error='目录关联已变化，请刷新文件'; return;}
        v.entries={...result, parent, query, offset};
    } catch(error) {
        if(localFilesActive(context) && generation===v.entriesGeneration) {
            v.error=`${error.message || '目录读取失败'}。可以刷新文件重试。`;
        }
    } finally {
        if (generation===v.entriesGeneration) {
            v.loading=false;
            if (localFilesActive(context)) renderLocalProjectFiles();
        }
    }
}
function localFilesPoll(context) {
    const v=context.view;
    clearTimeout(v.timer);
    if (!localFilesActive(context) || !['queued','scanning'].includes(v.state?.scan?.state)) return;
    if (++v.polls>150) {v.notice='已停止自动查询，可刷新文件查看结果。'; renderLocalProjectFiles(); return;}
    v.timer=setTimeout(async()=>{
        if (!localFilesActive(context)) return;
        const revision=v.state.revision, scanGeneration=v.scanGeneration;
        try {
            const result=await api('GET',`/api/projects/${context.pid}/local-files/scan`);
            if (!localFilesActive(context) || revision!==v.state.revision || scanGeneration!==v.scanGeneration) return;
            v.state.scan=result.scan; renderLocalProjectFiles();
            if (!['queued','scanning'].includes(result.scan.state)) await localFilesRefresh(context);
            else localFilesPoll(context);
        } catch(error) {if(localFilesActive(context)){v.error='读取索引进度失败，已有结果仍可查看。请刷新文件重试。'; renderLocalProjectFiles();}}
    }, 2000);
}
async function localFilesClick(event) {
    const context=localProjectFilesMount;
    if (!localFilesActive(context)) return;
    const download = event.target.closest('a[data-local-download]');
    if (download) {
        event.preventDefault();
        try {
            await downloadLocalFile(download.getAttribute('href'), download.download, () => localFilesActive(context));
        } catch (error) {
            if (localFilesActive(context)) {
                context.view.error = error.message;
                renderLocalProjectFiles();
            }
        }
        return;
    }
    const v=context.view, target=event.target.closest('button');
    if (!target || target.disabled) return;
    if (target.dataset.parent!==undefined) {await localFilesBrowse(context, target.dataset.parent); return;}
    const action=target.dataset.action;
    if (action === 'preview-file') {
        const item = v.entries?.items?.[Number(target.dataset.fileIndex)];
        if (item?.type !== 'file' || !item.preview_kind) return;
        openDocPreview({filename:item.name}, item.preview_kind, null, {
            contentUrl:localFilesContentUrl(context,item,'preview'),
            downloadUrl:v.state.capabilities.download ? localFilesContentUrl(context,item,'download') : '',
        });
        return;
    }
    if (['refresh','search','clear-search','up','previous','next','dismiss','unlink'].includes(action)) {
        if(action==='refresh'){v.error=''; v.polls=0; await localFilesRefresh(context, 'refresh');}
        if(action==='search') await localFilesSearch(context);
        if(action==='clear-search'){v.query=''; await localFilesSearch(context);}
        if(action==='up') await localFilesBrowse(context, v.parent.split('/').slice(0,-1).join('/'));
        if(action==='previous' || action==='next'){v.offset=Math.max(0,v.offset+(action==='next'?100:-100)); await localFilesLoadEntries(context);}
        if(action==='dismiss'){v.unlink=false; renderLocalProjectFiles();}
        if(action==='unlink'){v.unlink=true; renderLocalProjectFiles();}
        return;
    }
    if (v.busy || !v.state?.capabilities?.manage) return;
    if (action === 'recover') {
        const refreshed = await localFilesRefresh(context);
        if (localFilesActive(context) && refreshed) {v.uncertain=false; v.error=''; v.notice='已恢复手动操作。'; renderLocalProjectFiles();}
        return;
    }
    if (v.uncertain && ['associate','unlink-confirm'].includes(action)) return;
    v.busy=true; v.error=''; renderLocalProjectFiles();
    v.stateGeneration++;
    if (['cancel-scan','associate','unlink-confirm'].includes(action)) {v.scanGeneration++; clearTimeout(v.timer);}
    const url=`/api/projects/${context.pid}/local-files`, revision=v.state.revision;
    try {
        let result;
        if (action==='choose') {
            result=await api('POST',`${url}/choose`,{});
            if (localFilesActive(context) && !result.cancelled) v.path=result.path;
        } else if (action==='associate') {
            result=await api('PUT',`${url}/association`,{path:v.path.trim(),expected_revision:revision});
            if(localFilesActive(context)){v.state=result; v.entries=null; v.parent=''; v.offset=0; v.path=''; v.query=''; v.search=''; v.notice='已关联项目文件夹。'; await localFilesRefresh(context, 'initial');}
        } else if (action==='unlink-confirm') {
            result=await api('DELETE',`${url}/association`,{expected_revision:revision});
            if(localFilesActive(context)){v.state=result; v.entriesGeneration++; v.entries=null; v.unlink=false; clearTimeout(v.timer);}
        } else if (action==='cancel-scan') {
            result=await api('POST',`${url}/scan/cancel`,{expected_revision:revision,task_id:v.state.scan?.task_id});
            if(localFilesActive(context)){
                v.state.scan=result.scan; clearTimeout(v.timer); v.notice='已请求取消扫描，已有成功缓存保留。';
                v.polls = 0;
                if (['queued','scanning'].includes(result.scan?.state)) localFilesPoll(context);
            }
        } else if (action==='open' || action==='open-current') {
            result=await api('POST',`${url}/open`,{expected_revision:revision,relative_path:action==='open-current'?v.parent:''});
            if(localFilesActive(context)){
                v.notice=result.message || '已请求在主机打开目录';
                await localFilesRefresh(context);
            }
        }
    } catch(error) {
        if(localFilesActive(context)) {
            if (error.status===409) {await localFilesRefresh(context); v.error='关联发生冲突，已尝试重新读取。输入的路径已保留，请核对后确认。';}
            else if (!error.status && action==='associate') {
                v.uncertain=true;
                await localFilesRefresh(context);
                v.error='关联结果未确认，已尝试重新读取。请核对主机目录及当前状态，再恢复手动操作。';
            } else v.error=error.message || '操作失败，草稿已保留';
        }
    } finally {v.busy=false; if(localFilesActive(context))renderLocalProjectFiles();}
}
