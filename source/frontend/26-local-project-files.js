// ── Local project-folder workspace ──
// Files remain on the application host; this view shows only bounded metadata.
let localFilesRequestId = 0;
function localFolderRoute(pid, suffix = '') {
    return `/api/projects/${Number(pid)}/local-folder${suffix}`;
}
function localFileViewActive(pid) {
    return Number(currentProject?.id) === Number(pid)
        && document.getElementById('tab-local-files')?.classList.contains('active');
}
function localFileEscape(value) {
    return typeof escHtml === 'function' ? escHtml(String(value ?? ''))
        : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function localFileButton(label, action, allowed = true) {
    const disabled = allowed ? '' : ' disabled';
    return `<button type="button" class="btn btn-secondary" data-local-action="${action}"${disabled}>${localFileEscape(label)}</button>`;
}
async function renderLocalProjectFiles() {
    const pid = currentProject?.id;
    const panel = document.getElementById('localFilesContent');
    if (!pid || !panel) return;
    const requestId = ++localFilesRequestId;
    panel.innerHTML = '<p class="local-files-hint">正在读取文件夹关联信息…</p>';
    try {
        const info = await api('GET', localFolderRoute(pid));
        if (requestId !== localFilesRequestId || !localFileViewActive(pid)) return;
        const canManage = info.can_manage && hasAccountPermission('admin');
        const buttons = info.linked
            ? `${localFileButton('扫描目录', 'scan')}${localFileButton('打开文件夹（主机）', 'open', canManage && info.can_open_here)}${localFileButton('修改关联', 'edit', canManage)}${localFileButton('取消关联', 'unlink', canManage)}`
            : `${localFileButton('关联现有文件夹', 'edit', canManage)}${localFileButton('创建标准文件夹', 'create', canManage)}`;
        panel.innerHTML = `<section class="local-files-workspace">
            <h3>本地项目文件夹</h3>
            <p class="local-files-hint">此功能独立于系统附件。仅管理主机目录的关联信息，绝不自动移动、覆盖或删除文件。</p>
            <div class="local-files-status"><strong>${info.linked ? '已关联' : '尚未关联'}</strong>
            <span>${info.linked ? (info.exists ? '目录可访问' : '目录暂不可访问') : '请使用主机客户端配置'}</span></div>
            <label class="local-files-label">项目文件夹路径</label>
            <div class="local-files-path">${localFileEscape(info.path || '未设置')}</div>
            <div class="local-files-actions">${buttons}</div>
            ${!canManage ? '<p class="local-files-hint">更改关联、创建目录和打开主机资源管理器仅限系统主机上的管理员账号。</p>' : ''}
            <div id="localFilesScanResult" aria-live="polite"></div>
        </section>`;
        panel.querySelectorAll('[data-local-action]').forEach(button => button.addEventListener('click', () =>
            handleLocalFileAction(button.dataset.localAction, pid, info)));
    } catch (error) {
        if (requestId !== localFilesRequestId || !localFileViewActive(pid)) return;
        panel.innerHTML = `<p role="alert">文件夹关联信息读取失败：${localFileEscape(error.message)}</p>
            ${localFileButton('重试', 'retry')}`;
        panel.querySelector('[data-local-action="retry"]')?.addEventListener('click', renderLocalProjectFiles);
    }
}
async function handleLocalFileAction(action, pid, info) {
    if (!localFileViewActive(pid)) return;
    const canManage = info.can_manage && hasAccountPermission('admin');
    const result = document.getElementById('localFilesScanResult');
    if (action === 'scan') {
        if (result) result.textContent = '正在扫描目录…';
        try {
            const scan = await api('GET', localFolderRoute(pid, '/scan'));
            if (!localFileViewActive(pid) || !result) return;
            const stages = (scan.stages || []).map(item => `<li>${item.exists ? '✓' : '—'} ${localFileEscape(item.name)}</li>`).join('');
            const examples = (scan.examples || []).map(item => `<tr><td>${localFileEscape(item.name)}</td><td>${localFileEscape(item.relative_directory)}</td><td>${Number(item.size || 0).toLocaleString('zh-CN')}</td></tr>`).join('');
            result.innerHTML = `<h4>扫描结果</h4>
                <p>文件 ${Number(scan.files || 0)} 个，文件夹 ${Number(scan.directories || 0)} 个，文件体积约 ${(Number(scan.bytes || 0) / 1048576).toFixed(2)} MB。</p>
                ${scan.truncated ? '<p role="status">已达到扫描上限（1500 项），结果并非完整清单。</p>' : ''}
                ${scan.errors ? `<p role="status">部分条目读取失败：${Number(scan.errors)} 项。</p>` : ''}
                ${scan.skipped_links ? `<p role="status">跳过符号链接或联接点：${Number(scan.skipped_links)} 项。</p>` : ''}
                <h4>标准目录检查</h4><ul class="local-files-stages">${stages}</ul>
                <h4>文件样本（最多100个）</h4>
                <div class="local-files-table-wrap"><table class="tasks-table"><thead><tr><th>文件名称</th><th>所在子目录</th><th>字节数</th></tr></thead><tbody>${examples}</tbody></table></div>`;
        } catch (error) {
            if (result && localFileViewActive(pid)) result.textContent = '扫描失败：' + error.message;
        }
        return;
    }
    if (!canManage) return toast('请在系统主机使用管理员账号操作', 'warning');
    if (action === 'open') {
        try { await api('POST', localFolderRoute(pid, '/open'), {}); toast('已向主机资源管理器发出打开请求', 'success'); }
        catch (error) { toast('打开失败：' + error.message, 'error'); }
        return;
    }
    if (action === 'unlink') {
        if (!await confirmDialog('取消文件夹关联', '只取消系统内的关联记录，不会删除磁盘上的文件夹和资料。', '取消关联')) return;
        try {
            await api('PUT', localFolderRoute(pid), {path: ''});
            toast('已取消关联，磁盘文件未改变', 'success');
            renderLocalProjectFiles();
        } catch (error) {toast('取消关联失败：' + error.message, 'error');}
        return;
    }
    if (action === 'edit') {
        showModal('关联项目文件夹', `<p>请输入系统主机可访问的绝对路径。不会复制、移动或修改原文件。</p>
            <label for="localFolderPathInput">文件夹路径</label>
            <input id="localFolderPathInput" class="form-control" type="text" style="width:100%" autocomplete="off" placeholder="D:\\\\项目资料\\\\项目名称">
            <p class="local-files-hint">路径属于系统服务器所在电脑；远程访问者的磁盘路径不一定相同。</p>`);
        const input = document.getElementById('localFolderPathInput');
        if (input) input.value = info.path || '';
        const footer = document.getElementById('modalFooter');
        if (footer) {
            footer.style.display = 'flex';
            footer.innerHTML = '<button type="button" class="btn btn-secondary" id="localFolderCancel">取消</button><button type="button" class="btn btn-primary" id="localFolderSave">保存关联</button>';
            document.getElementById('localFolderCancel')?.addEventListener('click', closeModal);
            document.getElementById('localFolderSave')?.addEventListener('click', async () => {
                const value = document.getElementById('localFolderPathInput')?.value || '';
                if (!value.trim()) return toast('若需取消关联，请使用“取消关联”按钮', 'warning');
                try {
                    await api('PUT', localFolderRoute(pid), {path: value});
                    closeModal(); toast('关联已保存', 'success'); if (localFileViewActive(pid)) renderLocalProjectFiles();
                } catch (error) {toast('关联失败：' + error.message, 'error');}
            });
        }
        return;
    }
    if (action === 'create') {
        showModal('创建标准项目目录', `<p>仅在你指定的父级文件夹下新建项目目录和九个标准子目录，不修改现有目录。</p>
            <label for="localFolderParentInput">父级文件夹（必须已存在）</label>
            <input id="localFolderParentInput" type="text" style="width:100%" placeholder="D:\\\\招标项目" autocomplete="off">
            <p class="local-files-hint">遇到同名目录将拒绝创建，不覆盖原有资料。</p>`);
        const footer = document.getElementById('modalFooter');
        if (footer) {
            footer.style.display = 'flex';
            footer.innerHTML = '<button type="button" class="btn btn-secondary" id="localFolderCreateCancel">取消</button><button type="button" class="btn btn-primary" id="localFolderCreateSave">创建</button>';
            document.getElementById('localFolderCreateCancel')?.addEventListener('click', closeModal);
            document.getElementById('localFolderCreateSave')?.addEventListener('click', async () => {
                const parent_path = document.getElementById('localFolderParentInput')?.value || '';
                if (!parent_path.trim()) return toast('请填写父级目录', 'warning');
                try {
                    await api('POST', localFolderRoute(pid, '/create'), {parent_path});
                    closeModal(); toast('项目文件夹已创建并关联', 'success');
                    if (localFileViewActive(pid)) renderLocalProjectFiles();
                } catch (error) {toast('创建失败：' + error.message, 'error');}
            });
        }
    }
}
