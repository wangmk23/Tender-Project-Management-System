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
            <span><span data-ui-icon='📄'></span> 支持文档、图片、音视频及压缩包</span>
            <span><span data-ui-icon='🔒'></span> 安全存储，自动重命名</span>
        </div>
        <input type="file" id="fileInput" multiple style="display:none"
               accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.png,.jpg,.jpeg,.gif,.bmp,.webp,.zip,.rar,.7z,.csv,.json,.xml,.mp4,.m4v,.mov,.mkv,.webm,.avi,.wmv,.mpeg,.mpg,.ts,.mts,.m2ts,.3gp,.flv,.vob,.ogv,.mp3,.m4a,.aac,.wav,.flac,.ogg,.oga,.opus,.wma,.aiff,.aif,.amr,.au,.mka,.ac3,.dts"
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

            const mediaKind = attachmentMediaKind(att);
            if (mediaKind) {
                icon = '📎'; typeClass = `type-${mediaKind}`; typeTag = mediaKind === 'video' ? '视频' : '音频';
            } else if (att.is_image) {
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
                    ${mediaKind ? `<button class="btn-icon" onclick="viewAttachment(${att.id})" title="预览${mediaKind === 'video' ? '视频' : '音频'}" aria-label="预览${mediaKind === 'video' ? '视频' : '音频'}"><span data-ui-icon='👁️'></span></button>` : ''}
                    <button class="btn-icon" onclick="downloadAttachment(${att.id})" title="下载到本地"><span data-ui-icon="⬇"></span></button>
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
    const {response, result} = await localFetch('/api/csrf-refresh', {
        method: 'POST', headers: {Accept: 'application/json'},
        timeoutMs: 20000, readBody: readApiJsonResponse,
    });
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

        const errors = Array.isArray(result.errors) ? result.errors : [];
        const uploadedCount = Array.isArray(result.uploaded)
            ? result.uploaded.length
            : Math.max(0, validFiles.length - errors.length);
        if (uploadedCount > 0) toast(`✅ 成功上传 ${uploadedCount} 个文件`, 'success');
        if (errors.length > 0) {
            const reasons = formatUploadErrors(errors, validFiles);
            toast(`部分文件未上传：${reasons.join('；')}`, 'warning');
        }
        try {
            const detail = storeProjectDetail(await api('GET', `/api/projects/${projectId}`));
            if(currentProject?.id===projectId && navigationVersion===(typeof projectNavigationVersion==='undefined'?0:projectNavigationVersion)){currentProject=detail;renderAttachments();}
        } catch (error) {
            toast('上传结果已返回，但附件列表刷新失败，请刷新列表核对，避免重复上传。', 'warning');
            showAttachmentRefreshWarning(projectId, navigationVersion);
        }
    } catch(e) {
        console.error('上传失败:', e);
        toast((e.cancelled ? '上传已取消：' : '❌ 上传失败：') + e.message, e.cancelled ? 'warning' : 'error');
    } finally {
        showUploadProgress(false);
    }
}

function showAttachmentRefreshWarning(projectId, navigationVersion) {
    if (currentProject?.id !== projectId || navigationVersion !== (typeof projectNavigationVersion === 'undefined' ? 0 : projectNavigationVersion)) return;
    const parent = document.getElementById('attachmentsContent');
    if (!parent || typeof document.createElement !== 'function') return;
    parent.querySelector('.attachment-refresh-warning')?.remove();
    const host = document.createElement('div');host.className = 'attachment-refresh-warning';host.setAttribute('role', 'alert');
    host.innerHTML = '<p>上传结果已返回，附件列表尚未刷新。请先刷新核对，避免重复上传。</p><button type="button" class="btn btn-secondary">刷新附件列表</button>';
    parent.prepend(host);
    host.querySelector('button').onclick = async function() {
        this.disabled = true;
        try {
            const detail = storeProjectDetail(await api('GET', `/api/projects/${projectId}`));
            if (currentProject?.id === projectId && navigationVersion === projectNavigationVersion) {currentProject = detail;renderAttachments();}
        } catch(error) {toast('列表仍未刷新，请稍后重试：' + error.message, 'warning');}
        finally {if (this.isConnected) this.disabled = false;}
    };
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
// ── 统一附件预览 (图片 / PDF / Word / Excel / 音视频) ──
// ═══════════════════════════════════════════════

let _previewState = {
    type: '',          // 'pdf' | 'word' | 'excel' | 'image' | 'video' | 'audio'
    fileId: null,
    fileName: '',
    pageNum: 1,
    totalPages: 0,
    objectUrls: new Set(),
    luckysheetCreated: false,
    sessionVersion: 0,
    media: null
};
let _previewSessionVersion = 0;
let _previewReturnFocus = null;

function isAttachmentPreviewSessionCurrent(sessionVersion) {
    return Number.isInteger(sessionVersion)
        && sessionVersion === _previewSessionVersion
        && sessionVersion === _previewState.sessionVersion;
}

// Only selects the preview UI. The authenticated server checks actual file content and codec support.
function attachmentMediaKind(attachment) {
    const ext = String(attachment?.extension || '').replace(/^\./, '').toLowerCase();
    if (['mp4','m4v','mov','mkv','webm','avi','wmv','mpeg','mpg','ts','mts','m2ts','3gp','flv','vob','ogv'].includes(ext)) return 'video';
    if (['mp3','m4a','aac','wav','flac','ogg','oga','opus','wma','aiff','aif','amr','au','mka','ac3','dts'].includes(ext)) return 'audio';
    return '';
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
    if (typeof readUiPreferences==='function'?!readUiPreferences().preview:localStorage.getItem('pm_preview_in_app') === '0') {
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
    else if (attachmentMediaKind(att)) fileType = attachmentMediaKind(att);
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
        fileBadge.textContent = fileType === 'video' ? '视频' : fileType === 'audio' ? '音频' : fileType.toUpperCase();
        fileBadge.className = `doc-pt-badge ${fileType}`;
    }

    // 重置状态
    _previewState = {
        type: fileType,
        fileId: aid,
        fileName: att.filename,
        pageNum: 1,
        totalPages: 0,
        objectUrls: new Set(),
        luckysheetCreated: false,
        sessionVersion,
        media: null
    };

    // 显示对应的容器
    const pdfContainer = document.getElementById('pdfViewerContainer');
    const imageContainer = document.getElementById('imageViewerContainer');
    const docxContainer = document.getElementById('docxViewerContainer');
    const excelContainer = document.getElementById('excelViewerContainer');
    const mediaContainer = document.getElementById('mediaViewerContainer');
    const isMedia = fileType === 'video' || fileType === 'audio';
    overlay.classList.toggle('is-media-preview', isMedia);
    overlay.dataset.previewType = fileType;

    if (pdfContainer) pdfContainer.style.display = fileType === 'pdf' ? '' : 'none';
    if (imageContainer) imageContainer.style.display = fileType === 'image' ? '' : 'none';
    if (docxContainer) docxContainer.style.display = fileType === 'word' ? '' : 'none';
    if (excelContainer) excelContainer.style.display = fileType === 'excel' ? '' : 'none';
    if (mediaContainer) mediaContainer.style.display = isMedia ? '' : 'none';

    // 重置加载状态
    if (loadingEl) {
        loadingEl.style.display = isMedia ? 'none' : '';
        loadingEl.innerHTML = '<div class="spinner"></div><div>正在加载文档...</div>';
    }

    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', `附件预览：${att.filename || ''}`);
    overlay.tabIndex = -1;
    overlay.onkeydown = event => {
        if (event.isComposing || event.keyCode === 229 || event.defaultPrevented) return;
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
    } else if (isMedia) {
        loadMediaPreview(aid, fileType, sessionVersion);
    }
}

/**
 * 统一释放附件预览所有的浏览器资源。可重复调用且只释放一次。
 */
function releaseAttachmentPreviewResources() {
    _previewSessionVersion += 1;
    releasePdfReader();
    if (_previewState.media && typeof releaseMediaPreviewResources === 'function') releaseMediaPreviewResources();
    if (_previewState.luckysheetCreated && typeof luckysheet !== 'undefined') {
        _previewState.luckysheetCreated = false;
        try { luckysheet.destroy(); } catch (error) { console.error('释放 Excel 预览失败', error); }
    }

    for (const objectUrl of (_previewState.objectUrls || [])) {
        try { URL.revokeObjectURL(objectUrl); } catch (error) { console.error('释放预览地址失败', error); }
    }
    if (_previewState.objectUrls?.clear) _previewState.objectUrls.clear();

    for (const id of [
        'pdfViewerContainer', 'imageViewerContainer',
        'docxViewerContainer', 'excelViewerContainer', 'mediaViewerContainer',
    ]) {
        const container = document.getElementById(id);
        if (container) container.innerHTML = '';
    }

    _previewState.sessionVersion = 0;
    _previewState.type = '';
    _previewState.fileId = null;
    _previewState.fileName = '';
    _previewState.pageNum = 1;
    _previewState.totalPages = 0;
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

// Video.js 10 custom elements are deliberately lazy and version-pinned. Native video/audio need no media plugin.
const _mediaPlayerLibraries = new Map();
async function loadMediaPlayerLibrary(kind, hls = false) {
    const key = `${kind}:${hls}`;
    if (!_mediaPlayerLibraries.has(key)) {
        const loading = (async () => {
            // The 10.2.0 CDN video entry registers <media-i18n>; audio.js alone does not register that provider.
            const entries = [import('/static/libs/videojs/10.2.0/locales/zh-CN.js'),
                import('/static/libs/videojs/10.2.0/i18n.js'), import('/static/libs/videojs/10.2.0/video.js')];
            if (kind === 'audio') entries.push(import('/static/libs/videojs/10.2.0/audio.js'));
            if (hls) entries.push(import('/static/libs/videojs/10.2.0/media/hlsjs-video.js'));
            await Promise.all(entries);
        })().catch(error => { _mediaPlayerLibraries.delete(key); throw error; });
        _mediaPlayerLibraries.set(key, loading);
    }
    return _mediaPlayerLibraries.get(key);
}

function isMediaPreviewCurrent(media) {
    return !!media && _previewState.media === media && isAttachmentPreviewSessionCurrent(media.sessionVersion);
}

function disposeMediaPreviewPlayer(media) {
    for (const cleanup of media.listeners || []) cleanup();
    media.listeners = [];
    const element = media.element;
    media.element = null;
    if (element) {
        try { element.pause?.(); } catch (_) { /* detached or unsupported source */ }
        element.removeAttribute('src');
        element.querySelectorAll('source').forEach(source => source.remove());
        try { element.load?.(); } catch (_) { /* clearing an unloaded source */ }
    }
    // Disconnecting the v10 media custom element destroys its HLS adapter and player controllers.
    media.root?.remove();
    media.root = null;
}

function releaseMediaPreviewResources() {
    const media = _previewState.media;
    if (!media) return;
    _previewState.media = null;
    if (media.pollTimer !== null) clearTimeout(media.pollTimer);
    media.pollTimer = null;
    if (media.heartbeatTimer !== null) clearTimeout(media.heartbeatTimer);
    media.heartbeatTimer = null;
    media.request?.abort();
    media.request = null;
    const fullscreen = document.fullscreenElement;
    if (fullscreen && document.getElementById('mediaViewerContainer')?.contains(fullscreen)) {
        try { document.exitFullscreen?.().catch(() => {}); } catch (_) { /* browser is already leaving fullscreen */ }
    }
    disposeMediaPreviewPlayer(media);
}

function mediaPreviewText(value, fallback) {
    return typeof value === 'string' && value.trim() ? value.trim().slice(0, 500) : fallback;
}

function showMediaPreviewStatus(media, status, message, progress = null) {
    if (!isMediaPreviewCurrent(media)) return;
    const container = document.getElementById('mediaViewerContainer');
    if (!container) return;
    const failed = status === 'error';
    if (media.heartbeatTimer !== null) clearTimeout(media.heartbeatTimer);
    media.heartbeatTimer = null;
    const title = failed ? '暂时无法播放' : status === 'queued' ? '正在排队' : '正在准备播放';
    const detail = mediaPreviewText(message, failed ? '请重试，或下载原件后用本机播放器打开。' : '仅在本机处理附件，请稍候。');
    const percent = typeof progress === 'number' && Number.isFinite(progress) ? Math.max(0, Math.min(100, Math.round(progress))) : null;
    const statusKey = `${status}:${detail}:${percent}`;
    if (media.statusKey === statusKey) return;
    media.statusKey = statusKey;
    disposeMediaPreviewPlayer(media);
    container.className = `media-preview-container media-kind-${media.kind}`;
    container.setAttribute('aria-busy', failed ? 'false' : 'true');
    container.innerHTML = `<section class="media-preview-status${failed ? ' is-error' : ''}">
        <span class="media-preview-status-icon" aria-hidden="true">${failed ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v6m0 3v1"/></svg>' : '<span class="spinner"></span>'}</span>
        <h2>${title}</h2><p role="status" aria-live="polite">${escHtml(detail)}</p>
        ${percent !== null && !failed ? `<progress max="100" value="${percent}" aria-label="播放版本准备进度">${percent}%</progress><small>${percent}%</small>` : ''}
        <div class="media-preview-status-actions">${failed ? '<button type="button" class="btn btn-primary" data-media-action="retry">重试播放</button>' : ''}<button type="button" class="btn btn-secondary" data-media-action="download">下载原件</button></div>
        <small>原始附件始终保留${failed ? '，无需重新上传。' : '。关闭预览可停止等待。'}</small>
    </section>`;
    const retry = container.querySelector('[data-media-action="retry"]');
    retry?.addEventListener('click', () => {
        if (!isMediaPreviewCurrent(media)) return;
        media.pollCount = 0;
        requestMediaPreview(media, media.profile, true);
    });
    container.querySelector('[data-media-action="download"]')?.addEventListener('click', () => {
        if (isMediaPreviewCurrent(media)) downloadAttachment(media.aid);
    });
}

function loadMediaPreview(aid, kind, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const media = {
        aid: Number(aid), kind, sessionVersion, profile: 'original', fallbackUsed: false,
        pollTimer: null, heartbeatTimer: null, pollCount: 0, request: null, element: null, root: null, listeners: [], statusKey: '',
    };
    _previewState.media = media;
    // Prepare static controls alongside decryption/probing; this does not start playback.
    loadMediaPlayerLibrary(kind).catch(() => {});
    requestMediaPreview(media, 'original');
}

async function requestMediaPreview(media, profile, retry = false) {
    if (!isMediaPreviewCurrent(media)) return;
    if (media.pollTimer !== null) clearTimeout(media.pollTimer);
    media.pollTimer = null;
    media.request?.abort();
    const request = new AbortController();
    media.request = request;
    const profileChanged = media.profile !== profile;
    media.profile = profile;
    if (profileChanged && profile === 'compatible') loadMediaPlayerLibrary(media.kind, media.kind === 'video').catch(() => {});
    if (!media.statusKey || profileChanged || retry) {
        showMediaPreviewStatus(media, 'preparing', profile === 'compatible' ? '正在准备兼容播放版本，仅在本机处理，不会修改原件。' : '正在读取附件播放信息…');
    }
    try {
        const {response, result} = await localFetch(`/api/attachments/${media.aid}/media?profile=${profile}${retry ? '&retry=1' : ''}`, {
            method: 'GET', headers: {Accept: 'application/json'}, credentials: 'same-origin',
            signal: request.signal, timeoutMs: 20000, readBody: readApiJsonResponse,
        });
        if (!isMediaPreviewCurrent(media) || media.request !== request) return;
        if (!response.ok) {
            throw new Error(response.status === 401 ? '登录已过期，请重新登录后打开附件。' : mediaPreviewText(result?.message || result?.error, '无法读取附件，请确认访问权限后重试。'));
        }
        if (!result || !['queued', 'preparing', 'ready', 'error'].includes(result.status)) throw new Error('播放信息暂时不可用，请重试。');
        if (result.status === 'error') throw new Error(mediaPreviewText(result.message, '播放版本准备失败，请重试或下载原件。'));
        if (result.status === 'queued' || result.status === 'preparing') {
            showMediaPreviewStatus(media, result.status, result.message, result.progress);
            if (++media.pollCount >= 400) {
                showMediaPreviewStatus(media, 'error', '准备耗时较长，请点击重试检查进度，或下载原件。');
                return;
            }
            media.pollTimer = setTimeout(() => {
                media.pollTimer = null;
                if (isMediaPreviewCurrent(media)) return requestMediaPreview(media, profile);
            }, Math.min(1500, media.pollCount * 250));
            return;
        }
        if (!['video', 'audio'].includes(result.kind)) throw new Error('附件未识别为可播放的音视频，请下载原件查看。');
        media.kind = result.kind;
        if (profile === 'original' && result.native_suggested === false) {
            media.fallbackUsed = true;
            media.pollCount = 0;
            return requestMediaPreview(media, 'compatible');
        }
        await mountMediaPreview(media, result);
    } catch (error) {
        if (!isMediaPreviewCurrent(media) || media.request !== request || request.signal.aborted) return;
        showMediaPreviewStatus(media, 'error', mediaPreviewText(error?.message, '网络暂时不可用，请重试或下载原件。'));
    } finally {
        if (media.request === request) media.request = null;
    }
}

function mediaPreviewStreamUrl(media, value) {
    if (typeof value !== 'string') throw new Error('播放地址不可用，请重试。');
    const url = new URL(value, window.location.origin);
    if (url.origin !== window.location.origin || url.username || url.password
        || !url.pathname.startsWith(`/api/attachments/${media.aid}/media/`)) {
        throw new Error('播放地址不可用，请重试。');
    }
    return url.pathname + url.search;
}

async function mountMediaPreview(media, result) {
    const url = mediaPreviewStreamUrl(media, result.url);
    const hls = /\.m3u8(?:\?|$)/i.test(url) || /mpegurl/i.test(result.mime_type || '');
    if (hls && media.kind !== 'video') throw new Error('音频播放版本不可用，请重试。');
    await loadMediaPlayerLibrary(media.kind, hls);
    if (!isMediaPreviewCurrent(media)) return;
    const container = document.getElementById('mediaViewerContainer');
    if (!container) return;
    disposeMediaPreviewPlayer(media);
    container.innerHTML = '';
    container.className = `media-preview-container media-kind-${media.kind}`;
    container.setAttribute('aria-busy', 'false');
    _previewState.type = media.kind;
    const badge = document.getElementById('previewFileType');
    if (badge) { badge.textContent = media.kind === 'audio' ? '音频' : '视频'; badge.className = `doc-pt-badge ${media.kind}`; }
    const overlay = document.getElementById('docPreviewOverlay');
    if (overlay) overlay.dataset.previewType = media.kind;
    const root = document.createElement('section');
    root.className = 'media-preview-stage';
    const heading = document.createElement('div');
    heading.className = 'media-preview-caption';
    const name = document.createElement('h2');
    name.textContent = _previewState.fileName;
    heading.appendChild(name);
    const note = document.createElement('p');
    note.textContent = media.profile === 'compatible' ? '兼容播放版本 · 原件保留，可随时下载' : '原始附件 · 点击播放后开始';
    heading.appendChild(note);
    const i18n = document.createElement('media-i18n');
    i18n.lang = 'zh-CN';
    const player = document.createElement(`${media.kind}-player`);
    const skin = document.createElement(`${media.kind}-skin`);
    skin.setAttribute('aria-label', media.kind === 'audio' ? '音频播放器' : '视频播放器');
    const element = document.createElement(hls ? 'hlsjs-video' : media.kind);
    element.setAttribute('preload', 'metadata');
    element.setAttribute('playsinline', '');
    element.setAttribute('aria-label', _previewState.fileName || '附件播放');
    element.setAttribute('src', url);
    skin.appendChild(element);
    player.appendChild(skin);
    i18n.appendChild(player);
    root.append(heading, i18n);
    const hint = document.createElement('p');
    hint.className = 'media-preview-hint';
    hint.textContent = '聚焦播放器后：空格 / K 播放或暂停，← → 跳转，M 静音；Esc 退出全屏或关闭预览。';
    root.appendChild(hint);
    media.root = root;
    media.element = element;
    const onError = () => {
        if (!isMediaPreviewCurrent(media) || media.element !== element) return;
        const code = element.error?.code;
        if (media.profile === 'original' && !media.fallbackUsed && [3, 4].includes(code)) {
            media.fallbackUsed = true;
            media.pollCount = 0;
            requestMediaPreview(media, 'compatible');
        } else {
            showMediaPreviewStatus(media, 'error', code === 2 ? '读取播放流失败，请检查网络后重试。' : '此播放版本暂时无法解码，请重试或下载原件。');
        }
    };
    element.addEventListener('error', onError);
    media.listeners.push(() => element.removeEventListener('error', onError));
    container.appendChild(root);
    scheduleMediaPreviewHeartbeat(media);
}

function scheduleMediaPreviewHeartbeat(media) {
    if (!isMediaPreviewCurrent(media) || !media.element) return;
    if (media.heartbeatTimer !== null) clearTimeout(media.heartbeatTimer);
    media.heartbeatTimer = setTimeout(async () => {
        media.heartbeatTimer = null;
        if (!isMediaPreviewCurrent(media) || !media.element) return;
        const request = new AbortController();
        media.request = request;
        try {
            // Touch the private cache while paused too; a transient read failure never tears down buffered playback.
            await localFetch(`/api/attachments/${media.aid}/media?profile=${media.profile}`, {
                method:'GET', headers:{Accept:'application/json'}, credentials:'same-origin',
                signal:request.signal, timeoutMs:20000, readBody:readApiJsonResponse,
            });
        } catch (_) { /* The player remains usable; its own stream errors expose the retry action. */ }
        finally {
            if (media.request === request) media.request = null;
            if (isMediaPreviewCurrent(media) && media.element) scheduleMediaPreviewHeartbeat(media);
        }
    }, 30000);
}

// Walk the rendered order, including v10's open shadow roots and assigned media slots.
function mediaPreviewComposedElements(root) {
    const elements = [];
    const visit = node => {
        if (node.nodeType === 1) elements.push(node);
        const children = node.localName === 'slot' ? node.assignedElements({flatten: true}) : null;
        for (const child of children?.length ? children : (node.shadowRoot || node).children || []) visit(child);
    };
    visit(root);
    return elements;
}

function handleMediaPreviewDialogKeydown(event, dialog) {
    const media = _previewState.media;
    if (!isMediaPreviewCurrent(media) || !media.root || dialog.id !== 'docPreviewOverlay') return false;
    const elements = mediaPreviewComposedElements(dialog);
    if (event.key === 'Escape') {
        const fullscreen = document.fullscreenElement;
        if (fullscreen && (media.root.contains(fullscreen) || elements.includes(fullscreen))) {
            event.preventDefault(); event.stopPropagation();
            try { document.exitFullscreen?.().catch(() => {}); } catch (_) { /* already exited */ }
            return true;
        }
        const popup = elements.slice().reverse().find(node =>
            ['media-menu-content', 'media-menu', 'media-volume-popover'].includes(node.localName) && node.open === true && typeof node.close === 'function');
        if (popup) {
            event.preventDefault(); event.stopPropagation();
            popup.close('escape');
            return true;
        }
        return false;
    }
    if (event.key !== 'Tab') return false;
    const controls = elements.filter(node => node.matches('button,input,select,textarea,summary,a[href],[tabindex],[contenteditable]')
        && !node.disabled && node.tabIndex >= 0 && node.getClientRects().length
        && getComputedStyle(node).visibility !== 'hidden' && !node.closest('[inert],[hidden],[aria-hidden="true"]'));
    let active = document.activeElement;
    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
    const index = controls.indexOf(active);
    if (!controls.length || index < 0 || (event.shiftKey ? index === 0 : index === controls.length - 1)) {
        event.preventDefault();
        ((event.shiftKey ? controls.at(-1) : controls[0]) || dialog).focus({preventScroll: true});
    }
    // Interior Tab stays native: sliders, roving menu focus and slot ordering remain owned by v10.
    return true;
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
// PDF 阅读：官方 viewer 负责按需渲染、目录、查找、页码及打印。
function releasePdfReader() {
    const reader = _previewState.pdfReader;
    if (!reader) return;
    _previewState.pdfReader = null;
    window.removeEventListener('message', reader.onMessage);
    clearTimeout(reader.timeout);
    reader.frame.src = 'about:blank';
    reader.frame.remove();
}

function loadPDFPreview(aid, sessionVersion = _previewState.sessionVersion) {
    if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
    const container = document.getElementById('pdfViewerContainer');
    const loading = document.getElementById('previewLoading');
    if (!container || !loading) return;
    const frame = document.createElement('iframe');
    frame.id = 'pdfReaderFrame';
    frame.title = 'PDF 阅读器：' + _previewState.fileName;
    frame.tabIndex = 0;
    frame.setAttribute('referrerpolicy', 'same-origin');
    const file = `/api/attachments/${encodeURIComponent(aid)}/download?preview=1`;
    frame.src = '/static/pdf-reader/index.html?file=' + encodeURIComponent(file) + '&session=' + sessionVersion;
    const reader = {frame, onMessage: null, timeout: null};
    const fail = () => {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        clearTimeout(reader.timeout);
        loading.style.display = '';
        loading.innerHTML = '<div class="preview-error">PDF 加载失败，请重试或下载原件。<p><button class="btn btn-secondary" onclick="retryDocPreview()">重试</button> <button class="btn btn-primary" onclick="downloadPreviewFile()">下载文件</button></p></div>';
    };
    reader.onMessage = event => {
        if (!isAttachmentPreviewSessionCurrent(sessionVersion) || event.origin !== window.location.origin
            || event.source !== frame.contentWindow || event.data?.type !== 'pm-pdf-reader'
            || event.data.session !== String(sessionVersion)) return;
        if (event.data.event === 'ready') {
            clearTimeout(reader.timeout);
            _previewState.totalPages = Number(event.data.pages) || 0;
            loading.style.display = 'none';
        } else if (event.data.event === 'page') {
            _previewState.pageNum = Number(event.data.page) || 1;
        } else if (event.data.event === 'error') fail();
        else if (event.data.event === 'close') closeDocPreview();
    };
    _previewState.pdfReader = reader;
    window.addEventListener('message', reader.onMessage);
    reader.timeout = setTimeout(fail, 45000);
    container.replaceChildren(frame);
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
        const maxBytes = 16 * 1024 * 1024;
        const limitError = () => new Error('文件超出在线预览范围，请下载文件查看（最大16MB、20个工作表、每表2000行/200列、共10万个单元格）');
        if (Number(response.headers?.get('content-length')) > maxBytes) {
            if (response.body?.cancel) await response.body.cancel();
            throw limitError();
        }
        let arrayBuffer;
        if (response.body?.getReader) {
            const reader = response.body.getReader();
            const chunks = [];
            let length = 0;
            try {
                while (true) {
                    const chunk = await reader.read();
                    if (chunk.done) break;
                    length += chunk.value.byteLength;
                    if (length > maxBytes || !isAttachmentPreviewSessionCurrent(sessionVersion)) {
                        await reader.cancel();
                        if (length > maxBytes) throw limitError();
                        return;
                    }
                    chunks.push(chunk.value);
                }
            } finally { reader.releaseLock(); }
            const bytes = new Uint8Array(length);
            let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            arrayBuffer = bytes.buffer;
        } else {
            arrayBuffer = await response.arrayBuffer();
        }
        if (!isAttachmentPreviewSessionCurrent(sessionVersion)) return;
        if (arrayBuffer.byteLength > maxBytes) throw limitError();

        // Check ZIP directory sizes before the parser expands XLSX content.
        const zipBytes = new Uint8Array(arrayBuffer);
        if (zipBytes[0] === 0x50 && zipBytes[1] === 0x4b) {
            const directory = new DataView(arrayBuffer);
            let end = -1;
            for (let i = zipBytes.length - 22; i >= Math.max(0, zipBytes.length - 65557); i--) {
                if (directory.getUint32(i, true) === 0x06054b50) { end = i; break; }
            }
            if (end < 0) throw new Error('Excel压缩目录不完整，请下载文件查看');
            const count = directory.getUint16(end + 10, true);
            const directorySize = directory.getUint32(end + 12, true);
            let position = directory.getUint32(end + 16, true);
            if (count > 2000 || directorySize > 2 * 1024 * 1024 || position + directorySize > end
                || directory.getUint16(end + 4, true) || directory.getUint16(end + 6, true)) throw limitError();
            const directoryEnd = position + directorySize;
            let expanded = 0;
            for (let i = 0; i < count; i++) {
                if (position + 46 > directoryEnd || directory.getUint32(position, true) !== 0x02014b50) throw limitError();
                const compressed = directory.getUint32(position + 20, true);
                const size = directory.getUint32(position + 24, true);
                expanded += size;
                if (size > maxBytes || expanded > 32 * 1024 * 1024 || size > Math.max(1, compressed) * 1000) throw limitError();
                position += 46 + directory.getUint16(position + 28, true)
                    + directory.getUint16(position + 30, true) + directory.getUint16(position + 32, true);
                if (position > directoryEnd) throw limitError();
            }
            if (position !== directoryEnd) throw limitError();
        }

        // 使用xlsx解析
        const workbook = XLSX.read(arrayBuffer, { type: 'array', sheetRows: 2001, bookFiles: true,
            cellFormula: false, cellHTML: false, bookVBA: false });
        if (workbook.SheetNames.length > 20) throw limitError();
        // SheetJS drops the range entirely when every populated XLSX row is
        // beyond sheetRows. Inspect bounded source XML so that case is explicit.
        for (const [path, entry] of Object.entries(workbook.files || {})) {
            if (!/\/worksheets\/[^/]+\.xml$/i.test(path)) continue;
            const bytes = entry.content;
            let xml = '';
            for (let offset = 0; offset < bytes.length; offset += 8192) {
                xml += String.fromCharCode(...bytes.slice(offset, offset + 8192));
            }
            xml = xml.replace(/\0/g, '');
            for (const match of xml.matchAll(/<row\b[^>]*\br=["'](\d+)["']/g)) {
                if (Number(match[1]) > 2000) throw limitError();
            }
        }
        let totalCells = 0;
        for (const name of workbook.SheetNames) {
            const sheet = workbook.Sheets[name];
            const ref = sheet['!fullref'] || sheet['!ref'];
            if (!ref) continue;
            const range = XLSX.utils.decode_range(ref);
            const rows = range.e.r - range.s.r + 1;
            const columns = range.e.c - range.s.c + 1;
            totalCells += rows * columns;
            if (range.e.r >= 2000 || rows > 2000 || columns > 200 || totalCells > 100000) throw limitError();
            for (const merge of (sheet['!merges'] || [])) {
                if (merge.e.r > range.e.r || merge.e.c > range.e.c
                    || merge.s.r < range.s.r || merge.s.c < range.s.c) throw limitError();
            }
        }

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
            forceCalculation: false,
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
