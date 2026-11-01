'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const acorn = require('acorn');
const {composeStyles} = require('../tools/build_frontend');
const root = path.resolve(__dirname, '..');
const evidence = process.env.PDF_UI_EVIDENCE || path.join(root,'.codex/module-state/pdf-ui/evidence');
const workspace = fs.readFileSync(path.join(root,'src/templates/workspace.html'),'utf8');
const preview = workspace.slice(workspace.indexOf('<div class="doc-preview-overlay"'),workspace.indexOf('<!-- ═══ 文档预览库'));
const core = fs.readFileSync(path.join(root,'source/frontend/01-core.js'),'utf8');
const ast = acorn.parse(core,{ecmaVersion:'latest'});
const focusSource = ['topManagedDialog','dialogControls','focusDialogStart','handleDialogFocus','activateDialogFocus','releaseDialogFocus'].map(name=>{
    const node = ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);return core.slice(node.start,node.end);
}).join('\n');
const attachmentSource = fs.readFileSync(path.join(root,'source/frontend/03-attachments.js'),'utf8');
const script = `let currentProject={id:1,attachments:[{id:269,filename:'合成采购文件—269页.pdf',extension:'pdf'},{id:3,filename:'扫描件—无文本无书签.pdf',extension:'pdf'},{id:4,filename:'合成错误文件.pdf',extension:'pdf'}]};
const dialogFocusStack=[];let dialogFocusListenersReady=false;
function focusSafely(n){if(n?.isConnected){n.focus();return true;}return false;}
function focusFallback(){document.getElementById('openPdf').focus();}
function escHtml(v){return String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
function readUiPreferences(){return {preview:true};}function toast(){}
${fs.readFileSync(path.join(root,'source/frontend/00-icons.js'),'utf8')}\n${focusSource}\n${attachmentSource}`;
const manifest = JSON.parse(fs.readFileSync(path.join(root,'source/frontend/manifest.json'),'utf8'));
acorn.parse(script,{ecmaVersion:'latest'});
let css = composeStyles(fs.readFileSync(path.join(root,'src/static/style.css'),'utf8'),manifest.styles.map(item=>fs.readFileSync(path.join(root,item.file),'utf8')));
const outerCss = path.join(root,'src/project_manager/static/css/pdf-reader.css');
if(fs.existsSync(outerCss)) css += fs.readFileSync(outerCss,'utf8');
const html = `<!doctype html><html lang="zh-CN" data-theme="light" data-ui-size="standard"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><label>业务搜索<input id="businessSearch"></label><button id="openPdf" onclick="viewAttachment(269)">查看合成PDF</button>${preview}<script src="/fixture.js"></script></body></html>`;

function fixture(pages = 3, {scan=false,autoPrint=false}={}) {
    const objects = [], add = value => {objects.push(value); return objects.length;};
    add('<< /Type /Catalog /Pages 2 0 R /Outlines 4 0 R >>'); add('');
    add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    add(''); const outline = add(''); const children = [];
    for (let page = 1; page <= pages; page++) {
        const content = scan ? '0.8 g 40 500 500 240 re f' : `BT /F1 18 Tf 40 740 Td (ProjectNeedle synthetic page ${page}) Tj /F2 18 Tf 0 -40 Td <91C78D2D65874EF6> Tj ET`;
        const stream = add(`<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`);
        children.push(add(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 CJKFONT 0 R >> >> /Contents ${stream} 0 R >>`));
    }
    objects[1] = `<< /Type /Pages /Kids [${children.map(id => `${id} 0 R`).join(' ')}] /Count ${pages} >>`;
    objects[3] = `<< /Type /Outlines /First ${outline} 0 R /Last ${outline} 0 R /Count 1 >>`;
    objects[outline - 1] = `<< /Title (Final section) /Parent 4 0 R /Dest [${children.at(-1)} 0 R /Fit] >>`;
    if(scan) objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
    if(autoPrint) objects[0] = '<< /Type /Catalog /Pages 2 0 R /OpenAction << /S /Named /N /Print >> >>';
    const cid = add('<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >>');
    const cjk = add(`<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [${cid} 0 R] >>`);
    for(let i=0;i<objects.length;i++) objects[i]=objects[i].replace('CJKFONT',String(cjk));
    let pdf = '%PDF-1.4\n'; const offsets = [0];
    objects.forEach((object, i) => {offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;});
    const start = Buffer.byteLength(pdf);
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(n => `${String(n).padStart(10,'0')} 00000 n \n`).join('');
    return Buffer.from(pdf + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
}

let server, browser, origin;
test.before(async () => {
    assert.ok(fs.existsSync(path.join(root, 'src/project_manager/static/pdf-reader/index.html')), 'Professional PDF reader shell is required');
    server = http.createServer((request, response) => {
        const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
        if(pathname==='/fixture'){response.setHeader('Content-Type','text/html');return response.end(html);}
        if(pathname==='/fixture.js'){response.setHeader('Content-Type','text/javascript');return response.end(script);}
        if(pathname==='/fixture.css'){response.setHeader('Content-Type','text/css');return response.end(css);}
        if(pathname==='/favicon.ico'){response.statusCode=204;return response.end();}
        if (/^\/api\/attachments\/\d+\/(view|download)$/.test(pathname)) {response.setHeader('Content-Type','application/pdf'); return response.end(pathname.includes('/4/')?Buffer.from('invalid PDF'):fixture(pathname.includes('/269/') ? 269 : 3,{scan:pathname.includes('/3/'),autoPrint:pathname.includes('/5/')}));}
        const file = path.resolve(root, 'src/project_manager', '.' + decodeURIComponent(pathname));
        if (!file.startsWith(path.join(root,'src/project_manager') + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {response.statusCode = 404; return response.end();}
        response.setHeader('Content-Type', ({'.mjs':'text/javascript','.js':'text/javascript','.html':'text/html','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.ftl':'text/plain','.svg':'image/svg+xml'})[path.extname(file)] || 'application/octet-stream');
        response.end(fs.readFileSync(file));
    });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve)); origin = `http://127.0.0.1:${server.address().port}`;
    fs.mkdirSync(evidence,{recursive:true});
    const explicitBrowser = process.env.PM_BROWSER_EXECUTABLE;
    if (explicitBrowser && !fs.existsSync(explicitBrowser)) throw new Error('PM_BROWSER_EXECUTABLE does not exist: ' + explicitBrowser);
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const executablePath = explicitBrowser || (fs.existsSync(edge) ? edge : undefined);
    browser = await chromium.launch({headless:true, ...(executablePath ? {executablePath} : {})});
});
test.after(async () => {await browser?.close(); if (server) {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}});

test('real PDF reader exposes Chinese bookmarks, page navigation, text search and bounded canvases', {timeout:45000}, async () => {
    const page = await browser.newPage({viewport:{width:1440,height:900}}); const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    try {
        await page.goto(origin+'/static/pdf-reader/index.html?file='+encodeURIComponent(origin+'/api/attachments/269/view'));
        await page.waitForFunction(() => window.PDFViewerApplication?.pagesCount===269 && PDFViewerApplication.isInitialViewSet && document.querySelector('.page canvas'), null, {timeout:15000});
        assert.equal(await page.evaluate(() => PDFViewerApplicationOptions.get('enableScripting')), false);
        await page.locator('#pageNumber').fill('269'); await page.locator('#pageNumber').press('Enter');
        await page.waitForFunction(() => PDFViewerApplication.page===269 && document.querySelector('.page[data-page-number="269"] canvas'),null,{timeout:8000});
        assert.ok(await page.locator('.page canvas').count() < 20, '269 pages must not allocate 269 canvases');
        await page.locator('#viewFindButton').click(); await page.locator('#findInput').fill('ProjectNeedle');
        await page.waitForFunction(() => PDFViewerApplication.findController.pageMatches.reduce((n,m)=>n+m.length,0)===269);
        await page.locator('#scaleSelect').selectOption('1.5');
        await page.waitForFunction(()=>PDFViewerApplication.pdfViewer.currentScale===1.5);
        await page.locator('#scaleSelect').selectOption('page-width');
        await page.waitForFunction(()=>PDFViewerApplication.pdfViewer.currentScaleValue==='page-width');
        await page.waitForFunction(() => document.querySelector('.textLayer .highlight'));
        const before = await page.evaluate(() => PDFViewerApplication.page); await page.locator('#findNextButton').click();
        await page.waitForFunction(p => PDFViewerApplication.page!==p,before);
        await page.locator('#findInput').press('Escape');
        await page.evaluate(() => PDFViewerApplication.viewsManager.switchView(2,true));
        await page.getByRole('link',{name:'Final section',exact:true}).click();
        await page.waitForFunction(() => PDFViewerApplication.page===269);
        await page.locator('#viewFindButton').click();await page.locator('#findInput').fill('采购');
        await page.waitForFunction(() => PDFViewerApplication.findController.pageMatches.reduce((n,m)=>n+m.length,0)===269);
        assert.ok((await page.locator('#viewFindButton').getAttribute('title')).includes('查找'));
        assert.deepEqual(errors,[]);
    } finally {await page.close();}
});

async function openParent(page,id=269) {
    await page.goto(origin+'/fixture');
    await page.locator('#openPdf').focus();
    await page.evaluate(id=>viewAttachment(id),id);
    const frame=page.frameLocator('#pdfReaderFrame');
    await frame.locator('.page canvas').first().waitFor({timeout:15000});
    await page.waitForFunction(()=>document.getElementById('previewLoading').style.display==='none');
    return frame;
}

test('parent owns authenticated iframe, ignores stale messages, and releases on replacement/close', {timeout:30000},async()=>{
    const page=await browser.newPage();
    try {
        await openParent(page);
        assert.match(await page.locator('#pdfReaderFrame').getAttribute('src'),/download%3Fpreview%3D1/);
        await page.evaluate(()=>{
            const source=document.getElementById('pdfReaderFrame').contentWindow;
            const data={type:'pm-pdf-reader',event:'error',session:String(_previewState.sessionVersion)};
            for(const mismatch of [{origin:'https://example.invalid',source},{origin:location.origin,source:window},{origin:location.origin,source,data:{...data,session:'wrong'}}]) {
                window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source,data,...mismatch}));
            }
        });
        assert.equal(await page.locator('#previewLoading').isVisible(),false,'untrusted reader messages cannot replace the active preview');
        await page.evaluate(()=>{window.oldFrame=document.getElementById('pdfReaderFrame').contentWindow;window.oldSession=_previewState.sessionVersion;window.oldHandler=_previewState.pdfReader.onMessage;viewAttachment(3);});
        const frame=page.frameLocator('#pdfReaderFrame');
        await frame.locator('.page canvas').first().waitFor();
        assert.equal(await frame.locator('.page').count(),3);
        await page.evaluate(()=>window.dispatchEvent(new MessageEvent('message',{origin:location.origin,source:oldFrame,data:{type:'pm-pdf-reader',event:'close',session:String(oldSession)}})));
        await page.evaluate(()=>oldHandler({origin:location.origin,source:oldFrame,data:{type:'pm-pdf-reader',event:'close',session:String(oldSession)}}));
        assert.equal(await page.locator('#docPreviewOverlay').evaluate(el=>el.classList.contains('open')),true);
        await page.locator('[aria-label="关闭附件预览"]').click();
        assert.equal(await page.locator('#pdfReaderFrame').count(),0);
        assert.equal(await page.evaluate(()=>_previewState.type),'');
        assert.equal(await page.locator('#openPdf').evaluate(el=>el===document.activeElement),true);
    }finally{await page.close();}
});

test('PDF failure offers explicit retry and original download', {timeout:30000},async()=>{
    const page=await browser.newPage();
    try{
        await page.goto(origin+'/fixture');await page.evaluate(()=>viewAttachment(4));
        await page.locator('#previewLoading .preview-error').waitFor({timeout:15000});
        assert.ok(await page.getByRole('button',{name:'重试',exact:true}).isVisible());
        assert.ok(await page.getByRole('button',{name:'下载文件',exact:true}).isVisible());
        const previous=await page.evaluate(()=>_previewState.sessionVersion);
        await page.getByRole('button',{name:'重试',exact:true}).click();
        assert.ok(await page.evaluate(()=>_previewState.sessionVersion)>previous);
    }finally{await page.close();}
});

test('empty outline and scan search explain the original PDF limitations', {timeout:30000},async()=>{
    const page=await browser.newPage();
    try{
        const frame=await openParent(page,3);
        await frame.locator('#viewsManagerToggleButton').click();
        await frame.locator('#pmOutlineEmpty').waitFor();
        assert.match(await frame.locator('#pmOutlineEmpty').innerText(),/没有书签/);
        await frame.locator('#viewsManagerToggleButton').click();
        await frame.locator('#viewFindButton').click();await frame.locator('#findInput').fill('ProjectNeedle');
        await frame.locator('#pmSearchHint').waitFor();
        assert.match(await frame.locator('#pmSearchHint').innerText(),/OCR/);
    }finally{await page.close();}
});

test('iframe shortcuts close search first, prepare printing on user action and restore focus', {timeout:30000},async()=>{
    const page=await browser.newPage();
    await page.addInitScript(()=>{window.print=()=>{window.__printCalls=(window.__printCalls||0)+1;window.__printedPages=[...document.querySelectorAll('#printContainer .printedPage img')].map(img=>img.complete&&img.naturalWidth>0);};});
    try{
        const frame=await openParent(page,3);
        await frame.locator('#pageNumber').focus();await page.keyboard.press('Control+f');
        await frame.locator('#findInput').waitFor({state:'visible'});
        await frame.locator('#findInput').press('Escape');
        assert.equal(await page.locator('#docPreviewOverlay').evaluate(el=>el.classList.contains('open')),true);
        assert.equal(await frame.locator('#findbar').isVisible(),false);
        await frame.locator('#printButton').click();
        await page.waitForFunction(()=>document.getElementById('pdfReaderFrame').contentWindow.__printCalls===1,null,{timeout:8000});
        assert.deepEqual(await frame.locator('body').evaluate(()=>window.__printedPages),[true,true,true]);
        await page.waitForFunction(()=>!document.getElementById('pdfReaderFrame').contentWindow.PDFViewerApplication.printService);
        await frame.locator('#pageNumber').press('Control+p');
        await page.waitForFunction(()=>document.getElementById('pdfReaderFrame').contentWindow.__printCalls===2,null,{timeout:8000});
        await page.waitForFunction(()=>!document.getElementById('pdfReaderFrame').contentWindow.PDFViewerApplication.printService);
        await frame.locator('#pageNumber').press('Escape');
        await page.locator('#pdfReaderFrame').waitFor({state:'detached'});
        assert.equal(await page.locator('#openPdf').evaluate(el=>el===document.activeElement),true);
    }finally{await page.close();}
});

test('reader blocks automatic PDF printing, local-open shortcuts and remote file input', {timeout:30000},async()=>{
    const page=await browser.newPage();const external=[];
    await page.addInitScript(()=>{window.print=()=>{window.__printCalls=(window.__printCalls||0)+1;};});
    page.on('request',request=>{if(!request.url().startsWith(origin))external.push(request.url());});
    try{
        await page.goto(origin+'/static/pdf-reader/index.html?file='+encodeURIComponent('/api/attachments/5/download?preview=1'));
        await page.waitForFunction(()=>window.PDFViewerApplication?.pdfViewer.pageViewsReady&&PDFViewerApplication.isInitialViewSet);
        await page.evaluate(async()=>{await PDFViewerApplication.pdfDocument.getOpenAction();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));});
        assert.equal(await page.evaluate(()=>window.__printCalls||0),0,'PDF OpenAction must not print');
        assert.equal(await page.evaluate(()=>PDFViewerApplicationOptions.get('annotationEditorMode')),-1);
        assert.equal(await page.evaluate(()=>PDFViewerApplicationOptions.get('enableXfa')),false);
        assert.equal(await page.evaluate(()=>PDFViewerApplicationOptions.get('annotationMode')),1);
        assert.equal(await page.locator('#downloadButton').isVisible(),false);
        const prevented=await page.evaluate(()=>{const event=new KeyboardEvent('keydown',{key:'o',ctrlKey:true,bubbles:true,cancelable:true});document.dispatchEvent(event);return event.defaultPrevented;});
        assert.equal(prevented,true);
        await page.goto(origin+'/static/pdf-reader/index.html?file='+encodeURIComponent('https://example.invalid/private.pdf'));
        await page.getByText('PDF 阅读器暂不可用，请返回重试或下载原件。',{exact:true}).waitFor();
        assert.deepEqual(external,[]);
    }finally{await page.close();}
});

test('Tab enters the iframe and returns to outer controls without reaching the business form', {timeout:30000},async()=>{
    const page=await browser.newPage();
    try{
        const frame=await openParent(page,3);
        await page.locator('[aria-label="关闭附件预览"]').focus();await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(()=>document.activeElement.id),'pdfReaderFrame');
        await frame.locator('#viewsManagerToggleButton').focus();await page.keyboard.press('Shift+Tab');
        assert.equal(await page.locator('[aria-label="关闭附件预览"]').evaluate(el=>el===document.activeElement),true);
        await page.locator('[aria-label="关闭附件预览"]').click();
        await page.locator('#businessSearch').focus();await page.keyboard.press('Control+f');
        assert.equal(await page.locator('#pdfReaderFrame').count(),0);
    }finally{await page.close();}
});

test('four themes and desktop/mobile widths keep navigation, search and printing reachable', {timeout:60000},async()=>{
    const page=await browser.newPage();
    try{
        for(const width of [1440,390])for(const theme of ['light','dark','blue','green']){
            await page.setViewportSize({width,height:900});const frame=await openParent(page,269);
            await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.dataset.uiSize='large';},theme);
            await frame.locator('#pageNumber').fill('20');await frame.locator('#pageNumber').press('Enter');
            await frame.locator('#next').click();
            assert.equal(await frame.locator('#pageNumber').inputValue(),'21');
            await page.waitForFunction(()=>_previewState.pageNum===21);
            for(const selector of ['#viewFindButton','#printButton','#pageNumber','#viewsManagerToggleButton']){
                const box=await frame.locator(selector).boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width+1,`${theme}/${width} ${selector} must fit`);
            }
            assert.equal(await frame.locator('html').getAttribute('data-theme'),theme);
            await frame.locator('#viewFindButton').click();await frame.locator('#findInput').fill('采购');
            await frame.locator('.textLayer .highlight').first().waitFor();
            const findBounds = await frame.locator('#findbar').evaluate(panel => {
                const rect=panel.getBoundingClientRect();const hint=document.getElementById('pmSearchHint').getBoundingClientRect();
                return {left:rect.left,right:rect.right,bottom:rect.bottom,hintBottom:hint.bottom,width:innerWidth};
            });
            assert.ok(findBounds.left>=0&&findBounds.right<=findBounds.width+1,`${theme}/${width} find panel must fit`);
            assert.ok(findBounds.hintBottom<=findBounds.bottom+1,`${theme}/${width} find hint must stay inside its panel`);
            await page.screenshot({path:path.join(evidence,`pdf-${theme}-${width}.png`)});
        }
    }finally{await page.close();}
});

module.exports = {fixture};
