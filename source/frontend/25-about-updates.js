// ── About-only GitHub release checking; no downloads or installation ──
const aboutUpdates = {
    source: null, sourceLoading: false, sourceError: '', version: '', checking: false,
    result: null, checkError: '', checkedAt: '', logs: [], logLoading: false,
    logError: '', logPage: 0, logHasMore: false, logsOpened: false,
};
const ABOUT_RELEASE_TIMEOUT_MS = 10000;

function aboutNumericVersion(value) {
    const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-(?:public|compat))?(?:\+[A-Za-z0-9.-]+)?$/i);
    if (!match) return null;
    return match.slice(1, 4).map(part => BigInt(part));
}

function compareAboutVersions(local, remote) {
    const a = aboutNumericVersion(local), b = aboutNumericVersion(remote);
    if (!a || !b) throw new Error('版本号格式无法识别，暂时不能判断是否需要更新');
    for (let i = 0; i < 3; i++) {
        if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1;
    }
    return 0;
}

function validAboutSource(source) {
    return source?.configured === true
        && /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(source.owner || '')
        && /^[A-Za-z0-9_.-]{1,100}$/.test(source.repository || '')
        && !['.', '..'].includes(source.repository);
}

function aboutReleaseUrl(tag) {
    const source = aboutUpdates.source;
    if (!validAboutSource(source) || typeof tag !== 'string' || !tag || tag.length > 128 || /[\x00-\x1f\x7f]/.test(tag)) return '';
    // Never use an arbitrary html_url supplied by a remote release body.
    return `https://github.com/${source.owner}/${source.repository}/releases/tag/${encodeURIComponent(tag)}`;
}

async function aboutGithubRequest(path, signal) {
    const source = aboutUpdates.source;
    if (!validAboutSource(source)) throw new Error('尚未配置更新源');
    const base = `https://api.github.com/repos/${source.owner}/${source.repository}`;
    const response = await fetch(base + path, {signal, credentials: 'omit', cache: 'no-store',
        headers: {Accept: 'application/vnd.github+json'}, redirect: 'error'});
    if (!response.ok) {
        const limited = response.status === 429 || (response.status === 403 && response.headers.get('X-RateLimit-Remaining') === '0');
        const error = new Error(limited ? 'GitHub 请求次数已达限制，请稍后重试'
            : response.status === 403 ? 'GitHub 拒绝访问，请稍后重试'
            : response.status >= 500 ? 'GitHub 服务暂时不可用，请稍后重试'
            : `GitHub 接口请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        throw error;
    }
    try { return await response.json(); }
    catch (_) { throw new Error('GitHub 返回了无法识别的数据，请稍后重试'); }
}

async function aboutWithTimeout(action) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ABOUT_RELEASE_TIMEOUT_MS);
    try { return await action(controller.signal); }
    catch (error) {
        if (controller.signal.aborted || error.name === 'AbortError') throw new Error('请求超时，请检查网络后重试');
        if (error instanceof TypeError) throw new Error('无法连接 GitHub，请检查网络连接后重试');
        throw error;
    } finally { clearTimeout(timer); }
}

async function initializeAboutPanel(info) {
    aboutUpdates.version = typeof info?.version === 'string' ? info.version.trim() : '';
    if (aboutUpdates.source || aboutUpdates.sourceLoading) { renderAboutUpdateState(); return; }
    aboutUpdates.sourceLoading = true;
    aboutUpdates.sourceError = '';
    renderAboutUpdateState();
    try {
        const data = await aboutWithTimeout(async signal => {
            const response = await localFetch('/api/software-updates/source', {signal, headers: {Accept: 'application/json'}});
            if (!response.ok) throw new Error('更新源信息读取失败，请重试');
            return response.json();
        });
        aboutUpdates.source = validAboutSource(data) ? data : {configured: false};
    } catch (error) { aboutUpdates.sourceError = error.message || '更新源信息读取失败，请重试'; }
    finally { aboutUpdates.sourceLoading = false; renderAboutUpdateState(); }
}

function aboutReleaseSummary(data) {
    if (!data || typeof data !== 'object' || data.draft === true || data.prerelease === true
        || !aboutNumericVersion(data.tag_name)) throw new Error('没有可识别的正式发布版本，请前往 GitHub 查看');
    return {tag: data.tag_name, date: typeof data.published_at === 'string' ? data.published_at : '',
        body: typeof data.body === 'string' ? data.body.slice(0, 30000) : '', truncated: typeof data.body === 'string' && data.body.length > 30000};
}

async function explainAboutMissingRelease(signal) {
    try {
        const repo = await aboutGithubRequest('', signal);
        if (repo.private === true) throw new Error('更新源为私有仓库，无法匿名检查；请配置公开发布源');
    } catch (error) {
        if (error.status === 404) throw new Error('更新源不可访问：仓库不存在或为私有仓库，当前仅支持公开发布源');
        throw error;
    }
    throw new Error('暂时没有可用的正式发布版本');
}

async function checkSoftwareUpdates() {
    if (aboutUpdates.checking || aboutUpdates.sourceLoading) return;
    if (!aboutUpdates.source) await initializeAboutPanel({version: aboutUpdates.version});
    if (!validAboutSource(aboutUpdates.source)) { renderAboutUpdateState(); return; }
    aboutUpdates.checking = true;
    aboutUpdates.checkError = '';
    aboutUpdates.result = null;
    renderAboutUpdateState();
    try {
        const release = await aboutWithTimeout(async signal => {
            try { return aboutReleaseSummary(await aboutGithubRequest('/releases/latest', signal)); }
            catch (error) { if (error.status === 404) return explainAboutMissingRelease(signal); throw error; }
        });
        const comparison = compareAboutVersions(aboutUpdates.version, release.tag);
        aboutUpdates.result = {release, status: comparison < 0 ? 'available' : comparison === 0 ? 'current' : 'ahead'};
        aboutUpdates.checkedAt = new Date().toLocaleString('zh-CN', {hour12: false});
    } catch (error) { aboutUpdates.checkError = error.message || '检查更新失败，请稍后重试'; }
    finally { aboutUpdates.checking = false; renderAboutUpdateState(); }
}

async function loadSoftwareChangelog(more = false) {
    if (aboutUpdates.logLoading || aboutUpdates.sourceLoading) return;
    if (!aboutUpdates.source) await initializeAboutPanel({version: aboutUpdates.version});
    if (!validAboutSource(aboutUpdates.source)) { renderAboutUpdateState(); return; }
    const page = more ? aboutUpdates.logPage + 1 : 1;
    aboutUpdates.logLoading = true; aboutUpdates.logError = ''; aboutUpdates.logsOpened = true;
    renderAboutUpdateState();
    try {
        const data = await aboutWithTimeout(async signal => {
            try { return await aboutGithubRequest(`/releases?per_page=10&page=${page}`, signal); }
            catch (error) { if (error.status === 404) return explainAboutMissingRelease(signal); throw error; }
        });
        if (!Array.isArray(data)) throw new Error('GitHub 返回的更新日志格式不正确');
        const logs = data.filter(item => item && !item.draft && !item.prerelease && aboutNumericVersion(item.tag_name))
            .map(aboutReleaseSummary);
        aboutUpdates.logs = more ? [...aboutUpdates.logs, ...logs.filter(x => !aboutUpdates.logs.some(old => old.tag === x.tag))] : logs;
        aboutUpdates.logPage = page; aboutUpdates.logHasMore = data.length === 10;
    } catch (error) { aboutUpdates.logError = error.message || '更新日志读取失败，请稍后重试'; }
    finally { aboutUpdates.logLoading = false; renderAboutUpdateState(); }
}

function aboutReleaseLink(release) {
    const url = aboutReleaseUrl(release.tag);
    return url ? `<a class="btn btn-primary btn-sm" href="${escHtml(url)}" target="_blank" rel="noopener noreferrer" data-release-tag="${escHtml(release.tag)}" onclick="openSoftwareRelease(event,this)">前往下载</a>` : '';
}

function aboutReleaseMarkup(release, download = true) {
    const parsedDate = new Date(release.date);
    const date = release.date && !Number.isNaN(parsedDate.valueOf()) ? parsedDate.toLocaleDateString('zh-CN') : '发布日期未提供';
    return `<article class="about-release"><div class="about-release-heading"><strong>${escHtml(release.tag)}</strong><time>${escHtml(date)}</time></div>
      <div class="about-release-notes">${escHtml(release.body || '此版本尚未填写更新说明')}</div>
      ${release.truncated ? '<p class="settings-note">内容较长，可前往发布页面查看完整说明。</p>' : ''}
      ${download ? aboutReleaseLink(release) : ''}</article>`;
}

function renderAboutUpdateState() {
    // A pending request can finish after navigation or after the document was disposed.
    if (typeof document === 'undefined' || !document?.getElementById) return;
    const status = document.getElementById('aboutUpdateStatus');
    if (!status) return;
    const source = aboutUpdates.source;
    const configured = validAboutSource(source);
    let message = '尚未检查更新';
    if (aboutUpdates.sourceLoading) message = '正在读取更新源…';
    else if (aboutUpdates.sourceError) message = aboutUpdates.sourceError;
    else if (!configured) message = '尚未配置更新源';
    else if (!aboutNumericVersion(aboutUpdates.version)) message = '当前版本信息尚未就绪，请重新读取系统信息后再检查';
    else if (aboutUpdates.checking) message = '正在检查更新…';
    else if (aboutUpdates.checkError) message = aboutUpdates.checkError;
    else if (aboutUpdates.result?.status === 'available') message = `发现新版本 ${aboutUpdates.result.release.tag}`;
    else if (aboutUpdates.result?.status === 'current') message = '当前已是最新版本';
    else if (aboutUpdates.result?.status === 'ahead') message = `当前版本高于最新发布版本 ${aboutUpdates.result.release.tag}`;
    status.textContent = message;
    status.dataset.state = aboutUpdates.checkError || aboutUpdates.sourceError ? 'error' : aboutUpdates.result?.status || 'idle';
    status.setAttribute('aria-busy', String(aboutUpdates.checking || aboutUpdates.sourceLoading));
    const check = document.getElementById('aboutCheckUpdate');
    if (check) {
        check.disabled = aboutUpdates.checking || aboutUpdates.sourceLoading || (!!source && !configured) || !aboutNumericVersion(aboutUpdates.version);
        check.textContent = aboutUpdates.checking ? '正在检查…' : '检查更新';
    }
    const sourceLabel = document.getElementById('aboutUpdateSource');
    if (sourceLabel) sourceLabel.textContent = configured ? `GitHub · ${source.owner}/${source.repository}` : '';
    const checked = document.getElementById('aboutLastChecked');
    if (checked) checked.textContent = aboutUpdates.checkedAt ? `上次成功检查：${aboutUpdates.checkedAt}` : '';
    const detail = document.getElementById('aboutUpdateDetail');
    if (detail) detail.innerHTML = aboutUpdates.result?.status === 'available' ? aboutReleaseMarkup(aboutUpdates.result.release) +
        '<p class="settings-note">当前发布源提供公开版。已有授权部署请使用与原授权兼容的升级包，下载前核对发布说明。</p>' : '';
    const logButton = document.getElementById('aboutViewChangelog');
    if (logButton) { logButton.disabled = aboutUpdates.logLoading || aboutUpdates.sourceLoading || (!!source && !configured); logButton.textContent = aboutUpdates.logLoading ? '正在读取…' : aboutUpdates.logError ? '重新读取更新日志' : '查看更新日志'; }
    const logs = document.getElementById('aboutChangelog');
    if (logs) {
        logs.setAttribute('aria-busy', String(aboutUpdates.logLoading));
        const empty = aboutUpdates.logsOpened && !aboutUpdates.logLoading && !aboutUpdates.logError && !aboutUpdates.logs.length;
        logs.innerHTML = (aboutUpdates.logError ? `<p class="about-update-error" role="status">${escHtml(aboutUpdates.logError)}</p>` : '') +
            (empty ? '<p class="settings-note">暂无可用的版本更新记录。</p>' : '') +
            aboutUpdates.logs.map(release => aboutReleaseMarkup(release)).join('') +
            (aboutUpdates.logHasMore ? `<button type="button" class="btn btn-secondary btn-sm" onclick="loadSoftwareChangelog(true)" ${aboutUpdates.logLoading ? 'disabled' : ''}>加载更早版本</button>` : '');
    }
}

async function openSoftwareRelease(event, link) {
    const expected = aboutReleaseUrl(link.dataset.releaseTag);
    if (!expected || link.href !== expected) { event.preventDefault(); return; }
    if (typeof isDesktopApp !== 'function' || !isDesktopApp()) return;
    event.preventDefault();
    if (link.dataset.opening === 'true') return;
    link.parentElement?.querySelector('.about-download-error')?.remove();
    link.dataset.opening = 'true'; link.setAttribute('aria-disabled', 'true');
    try { await api('POST', '/api/software-updates/open-release', {tag: link.dataset.releaseTag}); }
    catch (error) {
        const message = error.message || '无法打开默认浏览器，请复制发布链接后手动打开';
        toast(message, 'error');
        const hint = document.createElement('p');
        hint.className = 'settings-note about-download-error'; hint.setAttribute('role', 'status');
        hint.textContent = `${message}：${expected}`;
        link.parentElement?.appendChild(hint);
    }
    finally { delete link.dataset.opening; link.removeAttribute('aria-disabled'); }
}
