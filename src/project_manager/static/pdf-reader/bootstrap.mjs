// First-party adapter for the unmodified Mozilla PDF.js 6.4.299 legacy generic viewer.
const base = '/static/libs/pdfjs-reader/6.4.299/';
const query = new URLSearchParams(location.search);
const session = query.get('session') || '';
let disposed = false;
let observer;
function notify(type, extra = {}) {
    if (!disposed && parent !== window) parent.postMessage({type: 'pm-pdf-reader', event: type, session, ...extra}, location.origin);
}
function syncTheme() {
    const host = parent.document.documentElement;
    const style = parent.getComputedStyle(host);
    document.documentElement.dataset.theme = host.dataset.theme || 'light';
    document.documentElement.dataset.uiSize = host.dataset.uiSize || 'standard';
    for (const [name, token] of Object.entries({surface:'--surface-raised',background:'--canvas',text:'--text',muted:'--text2',border:'--border',accent:'--primary'})) {
        const value = style.getPropertyValue(token).trim();
        if (value) document.documentElement.style.setProperty('--pm-' + name, value);
    }
}
try {
    const file = new URL(query.get('file') || '', location.origin);
    const localFile = /^\/api\/projects\/\d+\/local-files\/content$/.test(file.pathname)
        && file.searchParams.get('mode') === 'preview';
    const attachment = /^\/api\/attachments\/\d+\/(view|download)$/.test(file.pathname);
    if (file.origin !== location.origin || file.username || file.password || (!attachment && !localFile)) {
        throw new Error('无效的附件地址');
    }
    if (localFile) {
        const mayDownload = query.get('localDownload') === '1';
        for (const id of ['downloadButton', 'secondaryDownload']) {
            const button = document.getElementById(id);
            if (!mayDownload) button.style.setProperty('display', 'none', 'important');
            button.addEventListener('click', event => {
                event.preventDefault();
                event.stopImmediatePropagation();
                if (mayDownload) notify('download');
            }, true);
        }
    }
    syncTheme();
    if (parent !== window) {
        observer = new MutationObserver(syncTheme);
        observer.observe(parent.document.documentElement, {attributes:true, attributeFilter:['data-theme','data-ui-size','style']});
    }
    parent.document.addEventListener('webviewerloaded', function configure(event) {
        if (event.detail?.source !== window) return;
        parent.document.removeEventListener('webviewerloaded', configure);
        const options = window.PDFViewerApplicationOptions;
        for (const [name,value] of Object.entries({disablePreferences:true,disableHistory:true,defaultUrl:'',
            enableScripting:false,enablePermissions:true,annotationEditorMode:-1,annotationMode:1,enableXfa:false,
            enableAltTextModelDownload:false,enableGuessAltText:false,enableSignatureEditor:false,
            enableMerge:false,enableSplit:false,enableComment:false,enableAutoLinking:false,
            externalLinkTarget:2,externalLinkRel:'noopener noreferrer nofollow',
            localeProperties:{lang:'zh-CN'},defaultZoomValue:'page-width',viewOnLoad:1,sidebarViewOnLoad:0,
            cMapUrl:base+'web/cmaps/',standardFontDataUrl:base+'web/standard_fonts/',
            wasmUrl:base+'web/wasm/',iccUrl:base+'web/iccs/',imageResourcesPath:base+'web/images/',
            workerSrc:base+'build/pdf.worker.mjs'})) options.set(name,value);
        const app = window.PDFViewerApplication;
        // A PDF OpenAction or dormant print script must never initiate printing.
        app._initializeAutoPrint = async () => {};
        app.initializedPromise.then(() => {
            let ready = false;
            const markReady = () => {
                if (!ready && app.isInitialViewSet && document.querySelector('.page canvas')) {
                    ready = true;
                    notify('ready',{pages:app.pagesCount});
                }
            };
            app.pdfLinkService.externalLinkEnabled = false;
            app.eventBus.on('pagerendered', markReady);
            app.eventBus.on('pagechanging', ({pageNumber}) => { markReady(); notify('page',{page:pageNumber}); });
            app.eventBus.on('pagesloaded', () => { markReady(); });
            app.eventBus.on('documenterror', () => notify('error',{message:'PDF 加载失败，请重试或下载原件'}));
            app.eventBus.on('outlineloaded', ({outlineCount}) => {
                const empty = document.getElementById('pmOutlineEmpty');
                empty.hidden = !!outlineCount;
                if (outlineCount) app.viewsManager.switchView(2);
            });
        });
    });
    await import(base + 'build/pdf.mjs');
    await import(base + 'web/viewer.mjs');
    document.addEventListener('keydown', event => {
        if (event.isComposing || event.defaultPrevented) return;
        if ((event.ctrlKey || event.metaKey) && ['o','s'].includes(event.key.toLowerCase())) {
            event.preventDefault(); event.stopImmediatePropagation(); return;
        }
        if (event.key !== 'Escape') return;
        const app = window.PDFViewerApplication;
        if (document.querySelector('dialog[open]')) return;
        if (app.findBar?.opened) {
            app.findBar.close();
            document.getElementById('viewFindButton').focus();
        } else if (app.viewsManager?.isOpen && innerWidth <= 840) {
            app.viewsManager.close();
            document.getElementById('viewsManagerToggleButton').focus();
        } else notify('close');
        event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    // Keep this reader bound to its authenticated original attachment.
    for (const type of ['drop','dragover']) document.addEventListener(type, event => {
        event.preventDefault(); event.stopImmediatePropagation();
    }, true);
    document.addEventListener('click', event => {
        const link = event.target.closest?.('a[href]');
        if (link && new URL(link.href, location.href).origin !== location.origin) {
            event.preventDefault(); event.stopImmediatePropagation();
        }
    }, true);
} catch (error) {
    notify('error',{message:'PDF 阅读器暂不可用，请重试或下载原件'});
    document.body.textContent = 'PDF 阅读器暂不可用，请返回重试或下载原件。';
}
window.addEventListener('pagehide', () => {disposed = true; observer?.disconnect(); window.PDFViewerApplication?.close().catch(() => {});}, {once:true});
