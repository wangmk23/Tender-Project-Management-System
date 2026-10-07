// ── 附件管理 (Attachments) ──
// ═════════════════════════════════════

function renderAttachments() {
    const p = currentProject;
    if (!p) return;

    const container = document.getElementById('attachmentsContent');
    if (!container) return;

    const attachments = p.attachments || [];
    const count = attachments.length;

    // 更新Tab徽章
    const badge = document.getElementById('attachmentBadge');
    if (badge) {
        if (count > 0) {
            badge.textContent = count;
            badge.style.display = '';
        } else {
            badge.style.display = 'none';
        }
    }

    let html = `
    <div style="margin-bottom:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap">
        <h3 style="margin:0;font-size:15px;font-weight:600;color:var(--text)">
            <span data-ui-icon='📎'></span> 项目资料 (${count}个文件)
        </h3>
        <button class="btn btn-primary btn-sm" onclick="showUploadDialog()">上传文件</button>
        ${count > 1 ? '<button class="btn btn-danger btn-sm" onclick="batchDeleteAttachments()">批量删除</button>' : ''}
    </div>

    <!-- 批量删除工具栏（默认隐藏） -->
    ${count > 0 ? `
    <div id="attachmentBatchBar" style="display:none;margin-bottom:14px;padding:10px 14px;background:#fef2f2;border:1px solid #fecaca;border-radius:var(--radius-sm)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <span style="font-weight:600;color:var(--danger)"><span data-ui-icon='✏️'></span> 批量删除模式 - 勾选要删除的文件</span>
            <button class="btn btn-sm btn-secondary" onclick="exitBatchDeleteMode()">取消</button>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button class="btn btn-sm btn-danger" onclick="doBatchDelete()">删除选中项</button>
            <button class="btn btn-sm btn-secondary" onclick="selectAllAttachments()">全选</button>
            <span id="attachSelectCount" style="font-size:12px;color:var(--text2);align-self:center">已选：0</span>
        </div>
    </div>` : ''}
    <div id="uploadArea"
         style="border:2px dashed var(--border);border-radius:var(--radius);padding:30px;text-align:center;margin-bottom:20px;cursor:pointer;transition:border-color .2s,background .2s"
         ondrop="handleFileDrop(event)"
         ondragover="handleDragOver(event)"
         ondragleave="handleDragLeave(event)"
         onclick="document.getElementById('fileInput').click()">
        <div style="font-size:40px;margin-bottom:10px"><span data-ui-icon='📁'></span></div>
        <div style="font-size:14px;font-weight:600;color:var(--text);margin-bottom:6px">拖拽文件到此处上传</div>
        <div style="font-size:12px;color:var(--text3)">或点击选择文件（支持多选）</div>
        <div style="display:inline-flex;gap:12px;margin-top:10px;font-size:11px;color:var(--text3)">
            <span><span data-ui-icon='📏'></span> 单个最大 1GB</span>
            <span><span data-ui-icon='📄'></span> 支持 PDF/Word/Excel/PPT/图片/压缩包等</span>
            <span><span data-ui-icon='🔒'></span> 安全存储，自动重命名</span>
        </div>
        <input type="file" id="fileInput" multiple style="display:none"
               accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.gif,.bmp,.webp,.zip,.rar,.7z,.csv,.json,.xml"
               onchange="handleFilesSelected(this.files)">
    </div>

    <!-- 上传进度条 -->
    <div id="uploadProgress" style="display:none;margin-bottom:16px;background:var(--surface2);border-radius:var(--radius-sm);overflow:hidden">
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;font-size:13px">
            <span>正在上传...</span>
            <span><span id="uploadPercent">0%</span>
                <button type="button" class="btn btn-danger btn-xs" style="margin-left:10px"
                        onclick="abortActiveUploads()">取消上传</button>
            </span>
        </div>
        <div style="height:4px;background:var(--border);border-radius:0 2px 2px 0;position:relative">
            <div id="progressBarFill" style="height:100%;background:var(--primary);width:0%;transition:width .3s;border-radius:2px"></div>
        </div>
    </div>

    <!-- 附件列表 -->
    <div class="attachments-list" id="attachmentsList">
    `;

    if (count === 0) {
        html += uiStateMarkup('empty', '暂无附件，上传第一个文件开始整理项目资料。');
    } else {
        html += '<div class="attachment-grid">';
        attachments.forEach(att => {
            // 根据类型显示不同图标和颜色
            let icon = '📄';
            let typeClass = '';
            let typeTag = '';

            if (att.is_image) {
                icon = '🖼️'; typeClass = 'type-image'; typeTag = '图片';
            } else if (att.is_pdf) {
                icon = '📕'; typeClass = 'type-pdf'; typeTag = 'PDF';
            } else if (['doc','docx'].includes(att.extension)) {
                icon = '📘'; typeClass = 'type-doc'; typeTag = 'Word';
            } else if (['xls','xlsx'].includes(att.extension)) {
                icon = '📊'; typeClass = 'type-excel'; typeTag = 'Excel';
            } else if (['ppt','pptx'].includes(att.extension)) {
                icon = '📙'; typeClass = 'type-ppt'; typeTag = 'PPT';
            } else if (['zip','rar','7z'].includes(att.extension)) {
                icon = '📦'; typeClass = 'type-zip'; typeTag = '压缩包';
            }

            const sizeDisplay = att.file_size > 1024*1024
                ? (att.file_size / (1024*1024)).toFixed(2) + ' MB'
                : (att.file_size > 1024
                    ? (att.file_size / 1024).toFixed(1) + ' KB'
                    : att.file_size + ' B');

            html += `
            <div class="attachment-card ${typeClass}" data-id="${att.id}">
                <input type="checkbox" class="attach-cb" data-id="${att.id}"
                       style="display:none;cursor:pointer;margin-right:8px"
                       onclick="event.stopPropagation()">
                <div class="ac-icon"><span data-ui-icon="${escHtml(icon)}"></span></div>
                <div class="ac-info">
                    <div class="ac-name-wrapper">
                        <span class="ac-name" title="${escHtml(att.filename)}">${escHtml(att.filename)}</span>
                    </div>
                    <div class="ac-meta">
                        <span class="ac-size">${sizeDisplay}</span>
                        <span>${typeTag ? typeTag.toUpperCase() : att.extension.toUpperCase()}</span>
                        <span>${formatDateTimeShort(att.uploaded_at)}</span>
                    </div>
                    ${att.description ? `<div class="ac-desc" title="${escHtml(att.description)}"><span data-ui-icon='📝'></span> ${escHtml(att.description)}</div>` : ''}
                </div>
                <div class="ac-actions">
                    <button class="btn-icon" onclick="renameAttachment(${att.id})" title="重命名"><span data-ui-icon='✏️'></span></button>
                    ${att.is_image ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="预览图片"><span data-ui-icon='👁️'></span></button>` : ''}
                    ${att.is_pdf ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="查看PDF"><span data-ui-icon='📖'></span></button>` : ''}
                    ${['doc','docx'].includes(att.extension) ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="预览Word"><span data-ui-icon='📘'></span></button>` : ''}
                    ${['xls','xlsx'].includes(att.extension) ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="预览Excel"><span data-ui-icon='📊'></span></button>` : ''}
                    <button class="btn-icon" onclick="downloadAttachment(${att.id})" title="下载到本地">⬇️</button>
                    <button class="btn-icon danger-btn" onclick="deleteAttachment(${att.id})" title="删除此文件"><span data-ui-icon='🗑️'></span></button>
                </div>
            </div>`;
        });
        html += '</div>';
    }

    html += '</div>';
    container.innerHTML = html;
}


// ── 文件拖拽处理 ──
function handleDragOver(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--primary)';
    e.currentTarget.style.background = 'var(--primary-light)';
}
function handleDragLeave(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--border)';
    e.currentTarget.style.background = 'transparent';
}
async function handleFileDrop(e) {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.style.borderColor = 'var(--border)';
    e.currentTarget.style.background = 'transparent';

    const files = e.dataTransfer.files;
    if (files.length > 0) {
        await uploadFiles(files);
    }
}
async function handleFilesSelected(files) {
    if (files.length > 0) {
        await uploadFiles(files);
        // 清空input，允许重复选择同一文件
        document.getElementById('fileInput').value = '';
    }
}

// ── 文件上传核心函数（支持大文件） ──
function abortActiveUploads() {
    let aborted = 0;
    for (const request of activeUploads) {
        if (!request.candidateOwned || request.settled) continue;
        if (!request.xhr || request.xhr.readyState <= 0 || request.xhr.readyState >= 4) continue;
        request.explicitlyCancelled = true;
        request.xhr.abort();
        aborted += 1;
    }
    return aborted;
}

async function refreshAttachmentCsrfToken() {
    const response = await localFetch('/api/csrf-refresh');
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.csrf_token) {
        throw new Error('请求已过期，请刷新页面后重试');
    }
    window.CSRF_TOKEN = result.csrf_token;
    return result.csrf_token;
}

async function uploadFiles(fileList) {
    if (!currentProject) return;
    const projectId = currentProject.id;
    const navigationVersion = typeof projectNavigationVersion === 'undefined' ? 0 : projectNavigationVersion;

    // 预检查：过滤过大文件
    const limitMb = await getAttachmentUploadLimitMb();
    const MAX_SIZE = attachmentUploadLimitBytes();
    const validFiles = [];
    const oversizedFiles = [];

    for (let i = 0; i < fileList.length; i++) {
        if (fileList[i].size > MAX_SIZE) {
            oversizedFiles.push({
                name: fileList[i].name,
                sizeBytes: fileList[i].size,
            });
        } else {
            validFiles.push(fileList[i]);
        }
    }

    if (oversizedFiles.length > 0) {
        const msg = oversizedFiles.map(file =>
            `⚠️ ${file.name} (${(file.sizeBytes / (1024 * 1024)).toFixed(1)}MB 超过${limitMb}MB限制)`,
        ).join('；');
        toast(`部分文件太大无法上传：${msg}`, 'warning');
    }

    if (validFiles.length === 0) {
        if (oversizedFiles.length > 0) return;
        toast('没有可上传的文件', 'warning');
        return;
    }

    showUploadProgress(true, 0);

    // XHR 直接发送 FormData，浏览器会流式传输 File，不转 base64/整块内存。
    const doUpload = () => {
        const formData = new FormData();
        for (let i = 0; i < validFiles.length; i++) formData.append('files', validFiles[i]);
        formData.append('description', '');

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            const registry = typeof activeUploads !== 'undefined' ? activeUploads : new Set();
            const request = {
                xhr,
                candidateOwned: true,
                ownerProjectId: Number(projectId),
                settled: false,
                explicitlyCancelled: false,
            };
            registry.add(request);

            const finish = callback => value => {
                if (request.settled) return;
                request.settled = true;
                registry.delete(request);
                callback(value);
            };
            const succeed = finish(resolve);
            const fail = finish(reject);

            xhr.upload.addEventListener('progress', e => {
                if (e.lengthComputable) {
                    const percent = Math.round((e.loaded / e.total) * 100);
                    showUploadProgress(true, percent);
                }
            });

            xhr.addEventListener('load', () => {
                let result = {};
                try { result = JSON.parse(xhr.responseText || '{}'); } catch (error) {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        fail(new Error('服务器响应解析失败'));
                        return;
                    }
                }
                if (xhr.status >= 200 && xhr.status < 300) {
                    succeed(result);
                    return;
                }
                if (xhr.status === 413) {
                    fail(new Error(`文件太大！最大允许 ${limitMb}MB`));
                    return;
                }

                const csrfCode = result.code === 'csrf_expired' || result.code === 'csrf_invalid';
                const csrfFailure = (xhr.status === 400 || xhr.status === 403)
                    && (csrfCode || !result.code);
                const error = new Error(
                    result.error || (csrfFailure
                        ? '请求已过期，请刷新页面后重试'
                        : `上传失败 (HTTP ${xhr.status})`),
                );
                // 只有服务器同时明确证明未接收业务数据时，才允许换 token 后重发一次。
                error.csrfRetrySafe = (xhr.status === 400 || xhr.status === 403)
                    && csrfCode
                    && result.upload_accepted === false
                    && xhr.getResponseHeader('X-Upload-Accepted') === '0';
                fail(error);
            });
            xhr.addEventListener('error', () => fail(new Error('网络错误，请检查网络连接')));
            xhr.addEventListener('abort', () => {
                const error = new Error('上传已取消');
                error.cancelled = request.explicitlyCancelled;
                fail(error);
            });
            xhr.timeout = 15 * 60 * 1000; // 15分钟
            xhr.ontimeout = () => fail(new Error('上传超时，请检查网络或压缩文件后再试'));
            xhr.open('POST', `/api/projects/${projectId}/attachments`);
            xhr.withCredentials = true;
            xhr.setRequestHeader('X-CSRFToken', window.CSRF_TOKEN || '');
            xhr.send(formData);
        });
    };

    try {
        let result;
        try {
            result = await doUpload();
        } catch (error) {
            // 普通写失败绝不自动重试；只放行一次经服务器证明安全的 CSRF 更新。
            if (!error.csrfRetrySafe || typeof refreshAttachmentCsrfToken !== 'function') throw error;
            await refreshAttachmentCsrfToken();
            result = await doUpload();
        }

        const detail = storeProjectDetail(await api('GET', `/api/projects/${projectId}`));
        if(currentProject?.id===projectId && navigationVersion===(typeof projectNavigationVersion==='undefined'?0:projectNavigationVersion)){currentProject=detail;renderAttachments();}

        const errors = Array.isArray(result.errors) ? result.errors : [];
        const uploadedCount = Array.isArray(result.uploaded)
            ? result.uploaded.length
            : Math.max(0, validFiles.length - errors.length);
        if (uploadedCount > 0) toast(`✅ 成功上传 ${uploadedCount} 个文件`, 'success');
        if (errors.length > 0) {
            const reasons = errors.map((item, index) => {
                if (typeof item === 'string') return item;
                const filename = item.filename || item.name || validFiles[index]?.name || `文件${index + 1}`;
                return `${filename}：${item.error || item.reason || '上传失败'}`;
            });
            toast(`部分文件未上传：${reasons.join('；')}`, 'warning');
        }
    } catch(e) {
        console.error('上传失败:', e);
        toast((e.cancelled ? '上传已取消：' : '❌ 上传失败：') + e.message, e.cancelled ? 'warning' : 'error');
    } finally {
        showUploadProgress(false);
    }
}

function showUploadProgress(show, percent = 0) {
    const el = document.getElementById('uploadProgress');
    if (!el) return;
    el.style.display = show ? '' : 'none';
    if (show) {
        const fill = document.getElementById('progressBarFill');
        const text = document.getElementById('uploadPercent');
        if (fill) fill.style.width = percent + '%';
        if (text) text.textContent = percent + '%';
    }
}

function showUploadDialog() {
    document.getElementById('fileInput')?.click();
}

// ── 附件操作函数 ──
async function downloadAttachment(aid) {
    try {
        if (!isDesktopApp()) {
            const a = document.createElement('a');
            a.href = `/api/attachments/${aid}/download`;
            a.download = '';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            toast('已交给浏览器下载', 'success');
            return;
        }
        showLoading('正在保存文件...');
        const result = await api('POST', `/api/attachments/${aid}/save-local`, {});
        hideLoading();
        showModal('下载完成', `
            <div class="export-result">
                <div class="export-result-icon"><span data-ui-icon='✓'></span></div>
                <div>
                    <h4>${escHtml(result.filename || '附件文件')}</h4>
                    <p>已保存到：</p>
                    <code>${escHtml(result.path || '')}</code>
                </div>
            </div>
            <button class="btn btn-primary btn-block" onclick="closeModal()">知道了</button>
        `);
    } catch(e) {
        hideLoading();
        toast('❌ 下载失败：' + e.message, 'error');
    }
}

async function openAttachmentLocal(aid) {
    try {
        if (!isDesktopApp()) {
            window.open(`/api/attachments/${aid}/view`, '_blank');
            return;
        }
        showLoading('正在打开文件...');
        const result = await api('POST', `/api/attachments/${aid}/save-local?open=1`, {});
        hideLoading();
        toast(result.opened ? '已用系统默认程序打开' : '文件已保存', 'success');
    } catch(e) {
        hideLoading();
        toast('❌ 打开失败：' + e.message, 'error');
    }
}

// ═══════════════════════════════════════════════
// ── 文档预览系统 (PDF/Word/Excel) ──
// ═══════════════════════════════════════════════

let _previewState = {
    type: '',          // 'pdf' | 'word' | 'excel' | 'image'
    fileId: null,
    fileName: '',
    pdfDoc: null,
    pageNum: 1,
    totalPages: 0,
    scale: 0,
    rendering: false,
    objectUrls: new Set(),
    luckysheetCreated: false,
    pdfLoadingTask: null,
    sessionVersion: 0
};
let _previewSessionVersion = 0;
const _cancelledPdfLoadingTasks = new WeakSet();
let _pdfShortcutBound = false;
let _pdfKeydownHandler = null;
let _pdfWheelHandler = null;
let _previewReturnFocus = null;

function isAttachmentPreviewSessionCurrent(sessionVersion) {
    return Number.isInteger(sessionVersion)
        && sessionVersion === _previewSessionVersion
        && sessionVersion === _previewState.sessionVersion;
}

function cancelPdfLoadingTask(loadingTask) {
    if (!loadingTask || (typeof loadingTask !== 'object' && typeof loadingTask !== 'function')) return;
    if (_cancelledPdfLoadingTasks.has(loadingTask)) return;
    _cancelledPdfLoadingTasks.add(loadingTask);
    if (typeof loadingTask.destroy !== 'function') return;
    try {
        const cancellation = loadingTask.destroy();
        if (cancellation && typeof cancellation.catch === 'function') {
            cancellation.catch(error => console.error('取消 PDF 加载失败', error));
        }
    } catch (error) {
        console.error('取消 PDF 加载失败', error);
    }
}

/**
 * 打开文档预览（统一入口）
 * @param {number} aid - 附件ID
 */
async function viewAttachment(aid) {

    const att = findAttachmentById(aid);
    if (!att) {
        toast('❌ 找不到该附件', 'error');
        return;
    }
    if (localStorage.getItem('pm_preview_in_app') === '0') {
        openAttachmentLocal(aid);
        return;
    }

    const ext = (att.extension || '').toLowerCase();
    let fileType = '';

    // 判断文件类型（SVG 可携带脚本，禁止内联预览，改为下载/系统打开）
    if (ext === 'svg') {
        openAttachmentLocal(aid);
        return;
    }
    if (att.is_image || ['png','jpg','jpeg','gif','bmp','webp'].includes(ext)) fileType = 'image';
    else if (ext === 'pdf') fileType = 'pdf';
    else if (['doc', 'docx'].includes(ext)) fileType = 'word';
    else if (['xls', 'xlsx'].includes(ext)) fileType = 'excel';
    else {
        openAttachmentLocal(aid);
        return;
    }

    // 打开预览模态框
    try {
        openDocPreview(att, fileType, aid);
    } catch(e) {
        console.error('打开预览失败:', e);
        toast('❌ 预览失败：' + e.message, 'error');
    }
}

/**
 * 打开文档预览模态框
 */
function openDocPreview(att, fileType, aid) {

    const overlay = document.getElementById('docPreviewOverlay');
    if (!overlay) {
        console.error('❌ 找不到预览模态框元素 #docPreviewOverlay');
        toast('❌ 预览组件未加载', 'error');
        return;
    }

    if (!overlay.classList.contains('open')) _previewReturnFocus = document.activeElement;
    releaseAttachmentPreviewResources();
    const sessionVersion = ++_previewSessionVersion;

    const fileNameEl = document.getElementById('previewFileName');
    const fileBadge = document.getElementById('previewFileType');
    const loadingEl = document.getElementById('previewLoading');

    // 设置文件信息
    if (fileNameEl) fileNameEl.textContent = att.filename;
    if (fileBadge) {
        fileBadge.textContent = fileType.toUpperCase();
        fileBadge.className = `doc-pt-badge ${fileType}`;
    }

    // 重置状态
    _previewState = {
        type: fileType,
        fileId: aid,
        fileName: att.filename,
        pdfDoc: null,
        pageNum: 1,
        totalPages: 0,
        scale: 0,
        rendering: false,
        objectUrls: new Set(),
        luckysheetCreated: false,
        pdfLoadingTask: null,
        sessionVersion
    };

    // 显示对应的容器
    const pdfContainer = document.getElementById('pdfViewerContainer');
    const imageContainer = document.getElementById('imageViewerContainer');
    const docxContainer = document.getElementById('docxViewerContainer');
    const excelContainer = document.getElementById('excelViewerContainer');

    if (pdfContainer) pdfContainer.style.display = fileType === 'pdf' ? '' : 'none';
    if (imageContainer) imageContainer.style.display = fileType === 'image' ? '' : 'none';
    if (docxContainer) docxContainer.style.display = fileType === 'word' ? '' : 'none';
    if (excelContainer) excelContainer.style.display = fileType === 'excel' ? '' : 'none';

    // 显示/隐藏PDF缩放控制
    const showPdfControls = fileType === 'pdf';
    ['btnZoomIn', 'btnZoomOut'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.disabled = !showPdfControls; el.style.display = showPdfControls ? '' : 'none'; }
    });
    const zoomSelect = document.getElementById('pdfZoomSelect');
    if (zoomSelect) { zoomSelect.style.display = showPdfControls ? '' : 'none'; zoomSelect.value = 'fit'; }
    const pageInfo = document.getElementById('pageInfo');
    if (pageInfo) pageInfo.textContent = '';

    // 重置加载状态
    if (loadingEl) {
        loadingEl.style.display = '';
        loadingEl.innerHTML = '<div class="spinner"></div><div>正在加载文档...</div>';
    }

    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', '附件预览');
    overlay.tabIndex = -1;
    overlay.onkeydown = event => {
        if (event.isComposing || event.keyCode === 229) return;
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeDocPreview(); }
    };
    // 显示模态框
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden'; // 防止背景滚动
    if (typeof activateDialogFocus === 'function') activateDialogFocus(overlay, closeDocPreview);
    else overlay.focus();

    // 根据类型加载预览
    if (fileType === 'image') {
        loadImagePreview(aid, att.filename, sessionVersion);
    } else if (fileType === 'pdf') {
        loadPDFPreview(aid, sessionVersion);
    } else if (fileType === 'word') {
        loadWordPreview(aid, sessionVersion);
    } else if (fileType === 'excel') {
        loadExcelPreview(aid, sessionVersion);
    }
}

/**
 * 统一释放附件预览所有的浏览器资源。可重复调用且只释放一次。
 */
function releaseAttachmentPreviewResources() {
    _previewSessionVersion += 1;
    if (_previewState.luckysheetCreated && typeof luckysheet !== 'undefined') {
        _previewState.luckysheetCreated = false;
        try { luckysheet.destroy(); } catch (error) { console.error('释放 Excel 预览失败', error); }
    }

    for (const objectUrl of (_previewState.objectUrls || [])) {
        try { URL.revokeObjectURL(objectUrl); } catch (error) { console.error('释放预览地址失败', error); }
    }
    if (_previewState.objectUrls?.clear) _previewState.objectUrls.clear();

    const overlay = document.getElementById('docPreviewOverlay');
    if (overlay && _pdfKeydownHandler) {
        overlay.removeEventListener('keydown', _pdfKeydownHandler);
        _pdfKeydownHandler = null;
    }
    if (overlay && _pdfWheelHandler) {
        overlay.removeEventListener('wheel', _pdfWheelHandler, {passive: false});
        _pdfWheelHandler = null;
    }
    _pdfShortcutBound = false;

    for (const id of [
        'pdfViewerContainer', 'imageViewerContainer',
        'docxViewerContainer', 'excelViewerContainer',
    ]) {
        const container = document.getElementById(id);
        if (container) container.innerHTML = '';
    }

    const pdfLoadingTask = _previewState.pdfLoadingTask;
    const pdfDoc = _previewState.pdfDoc;
    _previewState.pdfLoadingTask = null;
    _previewState.pdfDoc = null;
    _previewState.sessionVersion = 0;
    if (pdfLoadingTask) {
        cancelPdfLoadingTask(pdfLoadingTask);
    } else if (pdfDoc && typeof pdfDoc.destroy === 'function') {
        try { pdfDoc.destroy(); } catch (error) { console.error('释放 PDF 预览失败', error); }
    }
    _previewState.type = '';
    _previewState.fileId = null;
    _previewState.fileName = '';
    _previewState.pageNum = 1;
    _previewState.totalPages = 0;
    _previewState.rendering = false;
}

/** 关闭文档预览 */
function retryDocPreview() {
    const attachment = findAttachmentById(_previewState.fileId);
    if (attachment) openDocPreview(attachment, _previewState.type, _previewState.fileId);
}

function closeDocPreview() {
    releaseAttachmentPreviewResources();
    const overlay = document.getElementById('docPreviewOverlay');
    if (overlay) overlay.classList.remove('open');
    document.body.style.overflow = '';
    if (typeof releaseDialogFocus === 'function') releaseDialogFocus(overlay);
    else if (_previewReturnFocus?.isConnected) _previewReturnFocus.focus();
    _previewReturnFocus = null;
}

function findAttachmentById(aid) {
    const id = Number(aid);
    const direct = (currentProject?.attachments || []).find(a => Number(a.id) === id);
    if (direct) return direct;
    for (const r of (currentProject?.registrations || [])) {
        const found = (r.attachments || []).find(a => Number(a.id) === id);
        if (found) return found;
    }
    for (const c of (currentProject?.complaints || [])) {
        const found = (c.attachments || []).find(a => Number(a.id) === id);
        if (found) return found;
    }
    return null;
}

function loadImagePreview(aid, filename, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const loadingEl = document.getElementById('previewLoading');
    const container = document.getElementById('imageViewerContainer');
    container.innerHTML = '';
    const img = document.createElement('img');
    img.alt = filename || '图片预览';
    img.src = `/api/attachments/${aid}/view`;
    img.onload = () => {
        if (isAttachmentPreviewSessionCurrent(sessionVersion)) loadingEl.style.display = 'none';
    };
    img.onerror = () => {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        loadingEl.innerHTML = `
            <div class="preview-error">
                <div class="preview-error-title">图片加载失败</div>
                <button class="btn btn-secondary btn-sm" onclick="retryDocPreview()">重试</button> <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()">下载文件</button>
            </div>`;
    };
    container.appendChild(img);
}


// ────────────────────────────────────────
// PDF 预览 (使用 pdf.js)
// ────────────────────────────────────────

function loadPdfJsLibrary() {
    return import('/static/libs/pdfjs/pdf.min.mjs');
}

async function loadPDFPreview(aid, sessionVersion = _previewState.sessionVersion) {
    try {
        const pdfjsLib = await loadPdfJsLibrary();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 设置worker路径
        pdfjsLib.GlobalWorkerOptions.workerSrc = '/static/libs/pdfjs/pdf.worker.min.mjs';

        // 获取文件URL
        const url = `/api/attachments/${aid}/view`;

        // 加载PDF文档
        const loadingTask = pdfjsLib.getDocument(url);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) {
            cancelPdfLoadingTask(loadingTask);
            return;
        }
        _previewState.pdfLoadingTask = loadingTask;
        const pdfDoc = await loadingTask.promise;
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) {
            cancelPdfLoadingTask(loadingTask);
            return;
        }
        _previewState.pdfDoc = pdfDoc;

        _previewState.totalPages = _previewState.pdfDoc.numPages;
        updatePageInfo();

        // 渲染全部页面（垂直排列）
        await renderAllPDFPages(sessionVersion);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 隐藏加载状态
        document.getElementById('previewLoading').style.display = 'none';

        // 绑定键盘和滚轮快捷键（只绑一次）
        bindPdfShortcuts();

    } catch(error) {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        const loadingTask = _previewState.pdfLoadingTask;
        _previewState.pdfLoadingTask = null;
        cancelPdfLoadingTask(loadingTask);
        console.error('PDF加载失败:', error);
        document.getElementById('previewLoading').innerHTML =
            '<div class="preview-error">PDF 加载失败<br><small>' + escHtml(error && error.message) + '</small><p><button class="btn btn-secondary" onclick="retryDocPreview()">重试</button> <button class="btn btn-primary" onclick="downloadPreviewFile()">下载文件</button></p></div>';
    }
}

/** 设备像素比，解决高清屏模糊 */
function getDPR() { return window.devicePixelRatio || 1; }

/**
 * 渲染所有PDF页面（垂直连续排列）
 * 每个canvas使用DPR缩放保证清晰度
 */
async function renderAllPDFPages(sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion) || !_previewState.pdfDoc) return;
    _previewState.rendering = true;

    const container = document.getElementById('pdfViewerContainer');
    container.innerHTML = '';  // 清空

    const dpr = getDPR();
    const scale = _previewState.scale || 1;
    // 容器宽度（减去padding），最小保底值防止除零
    const containerWidth = Math.max(container.clientWidth - 32, 200);

    try {
        for (let i = 1; i <= _previewState.totalPages; i++) {
            const page = await _previewState.pdfDoc.getPage(i);
            if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
            const finalScale = _previewState.scale === 0 ? containerWidth / page.getViewport({scale: 1}).width : scale;
            if (i === 1) _previewState.actualScale = finalScale;
            const fitViewport = page.getViewport({ scale: finalScale });

            // 创建canvas（DPR倍尺寸）
            const canvas = document.createElement('canvas');
            canvas.id = `pdf-page-${i}`;
            canvas.style.cssText =
                'display:block;margin:8px auto;border-radius:4px;box-shadow:0 2px 12px rgba(0,0,0,.3)';
            canvas.width = Math.round(fitViewport.width * dpr);
            canvas.height = Math.round(fitViewport.height * dpr);
            canvas.style.width = `${Math.round(fitViewport.width)}px`;
            canvas.style.height = `${Math.round(fitViewport.height)}px`;

            // 页码标签
            if (_previewState.totalPages > 1) {
                const label = document.createElement('div');
                label.textContent = `— 第 ${i} / ${_previewState.totalPages} 页 —`;
                label.style.cssText = 'text-align:center;color:var(--text2);font-size:11px;margin:4px 0';
                container.appendChild(label);
            }

            container.appendChild(canvas);

            // 高清渲染
            const ctx = canvas.getContext('2d');
            ctx.scale(dpr, dpr);
            const renderTask = page.render({
                canvasContext: ctx,
                viewport: fitViewport
            });
            await renderTask.promise;
            if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        }

        if (isAttachmentPreviewSessionCurrent(sessionVersion)) _previewState.rendering = false;
    } catch(e) {
        if (isAttachmentPreviewSessionCurrent(sessionVersion)) {
            _previewState.rendering = false;
            console.error('渲染失败:', e);
        }
    }
}

/** 重新渲染（缩放变化后调用） */
async function reRenderPDF() {
    if (!_previewState.pdfDoc || _previewState.rendering) return;
    const sessionVersion = _previewState.sessionVersion;
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    // 滚动位置记忆
    const container = document.getElementById('pdfViewerContainer');
    const scrollH = (container && container.scrollHeight - container.clientHeight) || 0;
    const scrollTopRatio = scrollH > 0 ? container.scrollTop / scrollH : 0;

    await renderAllPDFPages(sessionVersion);
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

    // 尽量恢复滚动位置（防止超出范围）
    if (container) {
        requestAnimationFrame(() => {
            if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
            const newH = container.scrollHeight - container.clientHeight;
            container.scrollTop = newH > 0 ? Math.min(scrollTopRatio * newH, newH) : 0;
        });
    }
}

// ── 缩放控制 ──
function previewZoomOut() {
    previewSetScale(Math.max(0.25, (_previewState.scale || _previewState.actualScale || 1) - 0.25));
}
function previewZoomIn() {
    previewSetScale(Math.min(5, (_previewState.scale || _previewState.actualScale || 1) + 0.25));
}
function previewSetScale(value) {
    if (_previewState.rendering) return;
    _previewState.scale = value === 'fit' ? 0 : Math.min(5, Math.max(0.25, parseFloat(value) || 1));
    const select = document.getElementById('pdfZoomSelect');
    if (select) select.value = _previewState.scale === 0 ? 'fit' : String(_previewState.scale);
    reRenderPDF();
}

// ── 翻页（垂直模式下保留按钮兼容，但主要靠滚动）──
function previewPrevPage() {
    scrollToPdfPage(_previewState.pageNum - 1);
}
function previewNextPage() {
    scrollToPdfPage(_previewState.pageNum + 1);
}

/** 跳转到指定页 */
function scrollToPdfPage(pageNum) {
    if (pageNum < 1) pageNum = 1;
    if (pageNum > _previewState.totalPages) pageNum = _previewState.totalPages;
    _previewState.pageNum = pageNum;
    updatePageInfo();

    const canvas = document.getElementById(`pdf-page-${pageNum}`);
    if (canvas) {
        canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
}

function updatePageInfo() {
    const el = document.getElementById('pageInfo');
    if (el) el.textContent = `${_previewState.totalPages} 页`;
}

// ── 键盘 & 滚轮快捷键 ──
function bindPdfShortcuts() {
    if (_pdfShortcutBound) return;
    _pdfShortcutBound = true;

    const overlay = document.getElementById('docPreviewOverlay');

    // 键盘快捷键
    _pdfKeydownHandler = function(e) {
        if (_previewState.type !== 'pdf') return;
        // Ctrl+/-/0 缩放
        if (e.ctrlKey || e.metaKey) {
            if (e.key === '=' || e.key === '+') { e.preventDefault(); previewZoomIn(); return; }
            if (e.key === '-') { e.preventDefault(); previewZoomOut(); return; }
            if (e.key === '0') { e.preventDefault(); _previewState.scale = 1; reRenderPDF(); return; }
        }
    };
    overlay.addEventListener('keydown', _pdfKeydownHandler);

    // Ctrl+滚轮缩放
    _pdfWheelHandler = function(e) {
        if (_previewState.type !== 'pdf' || (!e.ctrlKey && !e.metaKey)) return;
        e.preventDefault();
        if (e.deltaY < 0) previewZoomIn();
        else previewZoomOut();
    };
    overlay.addEventListener('wheel', _pdfWheelHandler, {passive: false});
}


// ────────────────────────────────────────
// Word/DOCX 预览 (使用 docx-preview)
// ────────────────────────────────────────

async function loadWordPreview(aid, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const loadingEl = document.getElementById('previewLoading');
    const container = document.getElementById('docxViewerContainer');

    try {
        // ── 检查库 ──
        if (typeof docx === 'undefined') {
            throw new Error('Word预览库未加载，请刷新页面重试');
        }
        container.innerHTML = '';

        // ── 获取文件（带凭证）──
        const url = `/api/attachments/${aid}/view`;
        const response = await localFetch(url);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 检查是否被重定向到登录页
        const ct = response.headers.get('content-type') || '';
        if (!response.ok || ct.includes('text/html')) {
            if (ct.includes('text/html')) {
                throw new Error('登录已过期，请刷新页面后重新预览');
            }
            throw new Error('下载失败 (HTTP ' + response.status + ')');
        }

        const blob = await response.blob();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        if (blob.size === 0) throw new Error('文件为空');

        // ── 关键检测：判断是否为有效的 ZIP (docx) ──
        // 读取前4字节: ZIP文件以 PK\x03\x04 开头 (0x504B0304)
        const headerBytes = await blob.slice(0, 4).arrayBuffer();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        const headerView = new Uint8Array(headerBytes);
        const isZip = headerView[0] === 0x50 && headerView[1] === 0x4B &&
                      headerView[2] === 0x03 && headerView[3] === 0x04;

        if (!isZip) {
            console.warn('[Word] ⚠️ 不是标准 docx (ZIP) 格式，可能是旧版 .doc');
            // 不是 docx → 显示友好提示，引导下载
            loadingEl.innerHTML =
                `<div style="padding:40px 20px;text-align:center;color:var(--text)">

                    <div style="font-size:16px;font-weight:600;margin-bottom:10px">此文档无法在线预览</div>
                    <div style="font-size:13px;color:var(--text2);margin-bottom:6px">该文件可能是 <b>旧版 Word (.doc)</b> 或其他格式</div>
                    <div style="font-size:12px;color:var(--text2);margin-bottom:24px">
                        在线预览仅支持 .docx 格式（Word 2007+）<br>
                        旧版 .doc 需要下载后用 Word 打开
                    </div>
                    <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()"
                            style="padding:10px 24px;font-size:14px">
                        下载文件查看
                    </button>
                </div>`;
            return; // 不报错，直接退出
        }

        // ── 渲染 docx ──
        const options = {
            className: 'docx-viewer',
            inWrapper: true,
            ignoreWidth: false,
            ignoreHeight: false,
            ignoreFonts: false,
            breakPages: true,
            experimental: false,
            trimXmlDeclaration: true,
            useBase64URL: true,
            renderHeaders: true,
            renderFooters: true,
            renderFootnotes: true,
            renderEndnotes: true
        };

        // 先渲染到脱离 DOM 的容器，旧会话即使延迟完成也无法污染当前预览。
        const stagingContainer = document.createElement('div');
        await docx.renderAsync(blob, stagingContainer, null, options);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        container.innerHTML = stagingContainer.innerHTML;
        loadingEl.style.display = 'none';

    } catch(error) {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        console.error('❌ Word文档加载失败:', error);
        loadingEl.innerHTML =
            `<div style="color:#ef4444;padding:20px;text-align:center">

                <div style="font-weight:bold;margin-bottom:8px">Word文档加载失败</div>
                <div style="font-size:12px;color:var(--text2);margin-bottom:12px;word-break:break-all">${escHtml(error && error.message)}</div>
                <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()" style="margin-top:12px">下载文件</button>
            </div>`;
    }
}


// ────────────────────────────────────────
// Excel/XLSX 预览 (使用 Luckysheet + xlsx)
// ────────────────────────────────────────

async function loadExcelPreview(aid, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const loadingEl = document.getElementById('previewLoading');
    const container = document.getElementById('excelViewerContainer');

    try {
        // 检查库是否加载
        if (typeof XLSX === 'undefined') {
            throw new Error('Excel解析库未加载，请刷新页面重试');
        }
        if (typeof luckysheet === 'undefined') {
            throw new Error('Excel预览库未加载，请刷新页面重试');
        }
        container.innerHTML = '<div id="luckysheet" style="width:100%;height:100%;min-height:240px"></div>';

        // 获取文件
        const response = await localFetch(`/api/attachments/${aid}/view`);
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        if (!response.ok || (response.headers.get('content-type') || '').includes('text/html')) throw new Error('文件无法读取或登录已过期，请重新登录后重试');
        const arrayBuffer = await response.arrayBuffer();
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;

        // 使用xlsx解析
        const workbook = XLSX.read(arrayBuffer, { type: 'array' });

        // 转换为Luckysheet格式
        const luckysheetData = [];

        workbook.SheetNames.forEach((sheetName, index) => {
            const sheet = workbook.Sheets[sheetName];
            const jsonData = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: false });

            // Luckysheet数据格式
            const luckysheetSheet = {
                name: sheetName,
                index: index,
                order: index,
                celldata: [],
                config: {},
                row: jsonData.length || 10,
                column: jsonData.length > 0 ? Math.max(...jsonData.map(row => row.length), 10) : 10
            };

            // 转换单元格数据
            jsonData.forEach((row, r) => {
                row.forEach((cell, c) => {
                    if (cell !== undefined && cell !== '') {
                        luckysheetSheet.celldata.push({
                            r: r,
                            c: c,
                            v: {
                                v: cell,
                                ct: { fa: 'General', t: typeof cell === 'number' ? 'n' : 's' }
                            }
                        });
                    }
                });
            });

            luckysheetSheet.config.merge = {};
            // sheet_to_json starts at the used range, so merges need the same origin.
            const origin = sheet['!ref'] ? XLSX.utils.decode_range(sheet['!ref']).s : {r: 0, c: 0};
            for (const merge of (sheet['!merges'] || [])) {
                const r = merge.s.r - origin.r;
                const c = merge.s.c - origin.c;
                if (r < 0 || c < 0) continue;
                luckysheetSheet.config.merge[`${r}_${c}`] = {
                    r, c,
                    rs: merge.e.r - merge.s.r + 1, cs: merge.e.c - merge.s.c + 1
                };
            }
            luckysheetData.push(luckysheetSheet);
        });

        // 初始化Luckysheet
        const options = {
            container: 'luckysheet',
            title: _previewState.fileName.replace(/\.(xls|xlsx)$/i, ''),
            lang: 'zh',
            data: luckysheetData,
            plugins: [],
            showtoolbar: false,
            showinfobar: false,
            showsheetbar: true,
            enableAddRow: false,   // 只读模式
            enableAddBackTop: false,
            userInfo: false,
            showstatisticBar: false,
            forceCalculation: true,
            hook: {
                cellUpdatedBefore: function(r, c, value, isRefresh) {
                    return false; // 禁止编辑
                },
                cellDragBefore: function(r, c, r2, c2) {
                    return false; // 禁止拖拽
                }
            }
        };

        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        luckysheet.create(options);
        _previewState.luckysheetCreated = true;
        // 隐藏加载状态
        loadingEl.style.display = 'none';

    } catch(error) {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        console.error('❌ Excel加载失败:', error);
        loadingEl.innerHTML =
            `<div style="color:#ef4444;padding:20px;text-align:center">

                <div style="font-weight:bold;margin-bottom:8px">Excel文件加载失败</div>
                <div style="font-size:12px;color:var(--text2)">${escHtml(error && error.message)}</div>
                <button class="btn btn-primary btn-sm" onclick="downloadPreviewFile()" style="margin-top:12px">
                    下载文件查看
                </button>
            </div>`;
    }
}


/**
 * 下载当前预览的原始文件
 */
function downloadPreviewFile() {
    if (_previewState.fileId) {
        downloadAttachment(_previewState.fileId);
    }
}

function openPreviewFile() {
    if (_previewState.fileId) {
        openAttachmentLocal(_previewState.fileId);
    }
}


// ESC键关闭预览
document.addEventListener('keydown', function(e) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape' && document.getElementById('docPreviewOverlay').classList.contains('open')) {
        if (typeof topManagedDialog === 'function' && topManagedDialog()?.container !== document.getElementById('docPreviewOverlay')) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        closeDocPreview();
    }
});
window.addEventListener('pagehide', releaseAttachmentPreviewResources);


// ── 附件重命名（弹窗式，扩展名锁定） ──
function renameAttachment(aid) {
    const projectId=currentProject?.id;
    const navigationVersion=typeof projectNavigationVersion==='undefined'?0:projectNavigationVersion;
    const att = (currentProject?.attachments || []).find(a => a.id === aid);
    if (!att) return;

    const currentName = att.filename;
    // 分离文件名和扩展名
    const dotIndex = currentName.lastIndexOf('.');
    const baseName = dotIndex > 0 ? currentName.substring(0, dotIndex) : currentName;
    const ext = dotIndex > 0 ? currentName.substring(dotIndex) : '';  // 包含点号，如 ".pdf"

    document.getElementById('renameInput').value = baseName;
    document.getElementById('renameExtHint').textContent = ext
        ? `文件格式将保持为：${ext.toUpperCase()} （不可更改）`
        : '该文件没有扩展名';

    // 存储附件ID和原始扩展名到闭包或元素上
    document.getElementById('renameDialog').dataset.aid = aid;
    document.getElementById('renameDialog').dataset.ext = ext;

    const ov = document.getElementById('renameOverlay');
    const dlg = document.getElementById('renameDialog');
    const inputEl = document.getElementById('renameInput');
    const okBtn = document.getElementById('renameOk');
    const cancelBtn = document.getElementById('renameCancel');

    ov.classList.add('open');
    dlg.classList.add('open');

    // 自动聚焦并选中全部文本
    setTimeout(() => {
        inputEl.focus();
        inputEl.select();
    }, 100);

    const done = () => {
        ov.classList.remove('open');
        dlg.classList.remove('open');
        ov.removeEventListener('click', onOverlay);
        cancelBtn.removeEventListener('click', onCancel);
        okBtn.removeEventListener('click', onOk);
        inputEl.removeEventListener('keydown', onKeydown);
    };

    const onOverlay = (e) => { if (e.target === ov) done(); };
    const onCancel = () => done();
    const onKeydown = (e) => {
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter') { e.preventDefault(); onOk(); }
        if (e.key === 'Escape') done();
    };
    const onOk = async () => {
        let newName = inputEl.value.trim();
        if (!newName) {
            toast('❌ 文件名不能为空', 'error');
            inputEl.focus();
            return;
        }
        // 强制追加原始扩展名
        if (ext) newName = newName + ext;
        done();

        try {
            const result = await api('PUT', `/api/attachments/${aid}`, { filename: newName });
            const detail=storeProjectDetail(await api('GET', `/api/projects/${projectId}`));
            if(currentProject?.id===projectId && navigationVersion===(typeof projectNavigationVersion==='undefined'?0:projectNavigationVersion)){currentProject=detail;renderAttachments();}
            toast(`✅ 已重命名为：${result.filename}`, 'success');
        } catch(e) {
            toast('❌ 重命名失败：' + e.message, 'error');
        }
    };

    ov.addEventListener('click', onOverlay);
    cancelBtn.addEventListener('click', onCancel);
    okBtn.addEventListener('click', onOk);
    inputEl.addEventListener('keydown', onKeydown);
}


async function deleteAttachment(aid) {
    const att = (currentProject?.attachments || []).find(item => item.id === aid);
    const fileName = att?.filename || '该附件';
    const confirmed = await confirmDialog(
        '删除附件',
        `确定删除「${fileName}」？此操作不可恢复。`,
        '删除',
        'btn-danger',
    );
    if (!confirmed) return;

    showLoading('正在删除...');
    try {
        await api('DELETE', `/api/attachments/${aid}`);
        toast(`🗑️ 已删除：${fileName}`, 'success');
        await refreshProject();
        if (editingStageKey) openStageSlide(editingStageKey);
    }
    catch (error) {
        console.error('删除附件失败:', error);
        toast(`❌ 删除失败：${error.message}`, 'error');
    }
    finally {
        hideLoading();
    }
}
