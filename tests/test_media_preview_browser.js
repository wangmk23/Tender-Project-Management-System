'use strict';

// Isolated synthetic HTTP fixtures; this does not launch a packaged app or read any project database.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {chromium} = require('playwright');
const acorn = require('acorn');
const {assemble, composeStyles} = require('../tools/build_frontend');
const root = path.join(__dirname, '..');
const state = path.join(root, '.codex/module-state/media-ui');
const productionVendor = path.join(root, 'src/project_manager/static/libs/videojs/10.2.0');
const vendor = process.env.VIDEOJS_TEST_VENDOR || (fs.existsSync(productionVendor) ? productionVendor : path.join(state, 'vendor/package'));
const evidence = process.env.MEDIA_UI_EVIDENCE || path.join(state, 'evidence');
const workspace = fs.readFileSync(path.join(root, 'src/templates/workspace.html'), 'utf8');
const preview = workspace.slice(workspace.indexOf('<div class="doc-preview-overlay"'), workspace.indexOf('<!-- ═══ 文档预览库'));
const attachmentSource = fs.readFileSync(path.join(root, 'source/frontend/03-attachments.js'), 'utf8');
const core = fs.readFileSync(path.join(root, 'source/frontend/01-core.js'), 'utf8');
const ast = acorn.parse(core, {ecmaVersion: 'latest'});
const focusNames = ['topManagedDialog', 'dialogControls', 'focusDialogStart', 'handleDialogFocus', 'activateDialogFocus', 'releaseDialogFocus'];
const focusSource = focusNames.map(name => {
    const node = ast.body.find(item => item.type === 'FunctionDeclaration' && item.id.name === name);
    assert.ok(node, name); return core.slice(node.start, node.end);
}).join('\n');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'source/frontend/manifest.json'), 'utf8'));
let css = composeStyles(fs.readFileSync(path.join(root, 'src/static/style.css'), 'utf8'), manifest.styles.map(item => fs.readFileSync(path.join(root, item.file), 'utf8')));
const mediaCss = path.join(root, 'src/project_manager/static/css/media-preview.css');
if (fs.existsSync(mediaCss) && !manifest.styles.some(item => item.file.endsWith('/media-preview.css'))) css += fs.readFileSync(mediaCss, 'utf8');

const fixtureScript = `let currentProject = {id: 1, attachments: [
 {id:1, filename:'合成演示—现场说明与方案核对.webm', extension:'webm'},
 {id:2, filename:'合成演示—现场会议录音.wav', extension:'wav'},
 {id:3, filename:'合成演示—图片.png', extension:'png'},
 {id:4, filename:'合成演示—兼容播放.mkv', extension:'mkv'}]};
const dialogFocusStack=[];let dialogFocusListenersReady=false;
function focusSafely(node){if(!node?.isConnected)return false;node.focus();return true;}
function focusFallback(){document.getElementById('triggerVideo').focus();}
function escHtml(value){return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
function readUiPreferences(){return {preview:true};}
function toast(){};
async function readApiJsonResponse(response){return response.json();}
async function localFetch(url,options){const response=await fetch(url,options);return {response,result:await response.json()};}
${fs.readFileSync(path.join(root, 'source/frontend/00-icons.js'), 'utf8')}\n${focusSource}\n${attachmentSource}`;
const html = `<!doctype html><html lang="zh-CN" data-theme="light" data-ui-size="standard"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><p>合成 HTTP 交互验证，非成品或真机验收</p><button id="triggerVideo" onclick="viewAttachment(1)">查看合成视频</button><button id="triggerAudio" onclick="viewAttachment(2)">查看合成录音</button><button id="triggerImage" onclick="viewAttachment(3)">查看合成图片</button><button id="triggerHls" onclick="viewAttachment(4)">查看合成兼容流</button>${preview}<script src="/fixture.js"></script></body></html>`;
acorn.parse(fixtureScript, {ecmaVersion:'latest'});

function wav() {
    const rate = 8000, samples = rate * 30, buffer = Buffer.alloc(44 + samples * 2);
    buffer.write('RIFF'); buffer.writeUInt32LE(buffer.length - 8, 4); buffer.write('WAVEfmt ', 8);
    buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(rate, 24); buffer.writeUInt32LE(rate * 2, 28); buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34); buffer.write('data', 36); buffer.writeUInt32LE(samples * 2, 40);
    // Quiet synthetic tone; no recording or user audio is used.
    for (let i = 0; i < samples; i++) buffer.writeInt16LE(Math.round(200 * Math.sin(i * Math.PI * 2 * 220 / rate)), 44 + i * 2);
    return buffer;
}

let server, browser, origin;
const requests = [];
test.before(async () => {
    assert.ok(fs.existsSync(path.join(vendor, 'video.js')), 'Set VIDEOJS_TEST_VENDOR to the complete official @videojs/cdn@10.2.0 directory');
    fs.mkdirSync(evidence, {recursive: true});
    const audio = wav();
    server = http.createServer((req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1'); requests.push(url.pathname + url.search);
        if (url.pathname === '/fixture.css') {res.setHeader('Content-Type', 'text/css'); return res.end(css);}
        if (url.pathname === '/fixture.js') {res.setHeader('Content-Type', 'text/javascript; charset=utf-8'); return res.end(fixtureScript);}
        if (url.pathname.startsWith('/static/libs/videojs/10.2.0/')) {
            const name = url.pathname.slice('/static/libs/videojs/10.2.0/'.length);
            const file = path.resolve(vendor, name);
            if (!file.startsWith(path.resolve(vendor) + path.sep) || !fs.existsSync(file)) {res.statusCode = 404; return res.end();}
            res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : 'text/javascript');
            return res.end(fs.readFileSync(file));
        }
        const metadata = url.pathname.match(/^\/api\/attachments\/(\d+)\/media$/);
        if (metadata) {
            const id = Number(metadata[1]); res.setHeader('Content-Type', 'application/json');
            if (id === 4) return res.end(JSON.stringify({status:'ready',kind:'video',filename:'合成演示',duration:6,
                native_suggested:url.searchParams.get('profile') !== 'original',mime_type:'application/vnd.apple.mpegurl',url:'/api/attachments/4/media/compatible/index.m3u8'}));
            return res.end(JSON.stringify({status:'ready', kind:id === 2 ? 'audio' : 'video', filename:'合成演示', duration:30,
                native_suggested:true, mime_type:id === 2 ? 'audio/wav' : 'video/webm', url:`/api/attachments/${id}/media/stream?profile=original`}));
        }
        const hls = url.pathname.match(/^\/api\/attachments\/4\/media\/compatible\/(index\.m3u8|segment\d{3}\.ts)$/);
        if (hls) {res.setHeader('Content-Type', hls[1].endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t');return res.end(fs.readFileSync(path.join(state,'hls',hls[1])));}
        if (/\/media\/stream$/.test(url.pathname)) {
            const isAudio = url.pathname.includes('/2/');
            const file = path.join(state, 'synthetic.webm');
            const data = isAudio ? audio : fs.readFileSync(file);
            res.setHeader('Content-Type', isAudio ? 'audio/wav' : 'video/webm'); res.setHeader('Accept-Ranges', 'bytes');
            const range = req.headers.range?.match(/bytes=(\d+)-(\d*)/);
            if (range) {const start = Number(range[1]), end = range[2] ? Number(range[2]) : data.length - 1;
                res.statusCode = 206; res.setHeader('Content-Range', `bytes ${start}-${end}/${data.length}`);
                res.setHeader('Content-Length', end - start + 1); return res.end(data.subarray(start, end + 1));}
            res.setHeader('Content-Length', data.length); return res.end(data);
        }
        if (url.pathname === '/api/attachments/3/view') {res.setHeader('Content-Type', 'image/svg+xml');return res.end('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#dce8f8"/></svg>');}
        res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(html);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${server.address().port}`;
    browser = await chromium.launch({executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true});
    // Generate a tiny local VP8 video with the test browser, avoiding any external media/dependencies.
    if (!fs.existsSync(path.join(state, 'synthetic.webm'))) {
        const page = await browser.newPage(); await page.goto(origin);
        const encoded = await page.evaluate(async () => {
            const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
            const context = canvas.getContext('2d'); const stream = canvas.captureStream(10);
            const recorder = new MediaRecorder(stream, {mimeType:'video/webm;codecs=vp8'}); const parts = [];
            recorder.ondataavailable = event => parts.push(event.data);
            const done = new Promise(resolve => {recorder.onstop = resolve;}); recorder.start();
            for (let i = 0; i < 20; i++) {context.fillStyle='#172b4d';context.fillRect(0,0,640,360);context.fillStyle='#fff';context.font='28px sans-serif';context.fillText('合成演示 · 无真实记录',130,178); await new Promise(resolve=>setTimeout(resolve,100));}
            recorder.stop(); await done; stream.getTracks().forEach(track=>track.stop());
            const blob = new Blob(parts, {type:'video/webm'}); const bytes = new Uint8Array(await blob.arrayBuffer());
            return btoa(String.fromCharCode(...bytes));
        });
        fs.writeFileSync(path.join(state, 'synthetic.webm'), Buffer.from(encoded, 'base64')); await page.close();
    }
});
test.after(async () => {await browser?.close(); await new Promise(resolve => server ? server.close(resolve) : resolve());});

async function open(page, kind) {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.goto(origin); await page.click(kind === 'audio' ? '#triggerAudio' : '#triggerVideo');
    await page.waitForSelector(`${kind}-skin media-container`, {state:'attached', timeout:8000}).catch(async error => {
        throw new Error(`${error.message}\n${await page.locator('#mediaViewerContainer').textContent()}\n${errors.join('\n')}\n${requests.slice(-8).join('\n')}`);
    }); await page.waitForTimeout(250);
}
async function deepFocus(page) {
    return page.evaluate(() => {let element=document.activeElement;while(element?.shadowRoot?.activeElement) element=element.shadowRoot.activeElement;return {tag:element?.localName, role:element?.getAttribute('role'), label:element?.getAttribute('aria-label')};});
}

test('real v10 controls remain reachable by Tab and Shift+Tab through the modal shadow roots', async () => {
    const page = await browser.newPage();
    try {
        await open(page, 'audio');
        const seen = [];
        for (let i = 0; i < 15; i++) {seen.push(await deepFocus(page));await page.keyboard.press('Tab');}
        assert.ok(seen.some(item => item.tag === 'media-play-button'), JSON.stringify(seen));
        assert.ok(seen.some(item => item.role === 'slider' && /跳|定位|进度|Seek/.test(item.label)), JSON.stringify(seen));
        await page.locator('media-time-slider [role="slider"]').focus(); await page.keyboard.press('Shift+Tab');
        assert.notEqual((await deepFocus(page)).tag, 'body');
        assert.equal(await page.locator('#docPreviewOverlay').evaluate(node => node.classList.contains('open')), true);
        assert.match(await page.locator('media-play-button').getAttribute('aria-label'), /播放/);
    } finally {await page.close();}
});

test('real v10 speed menu consumes Escape before the preview dialog', async () => {
    const page = await browser.newPage();
    try {
        await open(page, 'audio');
        await page.locator('media-playback-rate-button').click();
        await page.waitForFunction(() => document.querySelector('audio-skin').shadowRoot.querySelector('media-menu').open);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#docPreviewOverlay').evaluate(node => node.classList.contains('open')), true);
        assert.equal(await page.locator('media-menu').evaluate(node => node.open), false);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#docPreviewOverlay').evaluate(node => node.classList.contains('open')), false);
    } finally {await page.close();}
});

test('real v10 fullscreen Escape exits fullscreen before the next Escape closes the preview', async () => {
    const page = await browser.newPage();
    try {
        await open(page, 'video'); await page.locator('media-fullscreen-button').click();
        await page.waitForFunction(() => !!document.fullscreenElement);
        await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.fullscreenElement);
        assert.equal(await page.locator('#docPreviewOverlay').evaluate(node => node.classList.contains('open')), true);
        await page.keyboard.press('Escape');
        assert.equal(await page.locator('#docPreviewOverlay').evaluate(node => node.classList.contains('open')), false);
    } finally {await page.close();}
});

test('ordinary image preview retains its Tab wrap, Escape and trigger restoration', async () => {
    const page = await browser.newPage();
    try {
        await page.goto(origin);await page.click('#triggerImage');await page.waitForSelector('#imageViewerContainer img');
        await page.locator('.doc-pt-close').focus();await page.keyboard.press('Tab');
        assert.match((await deepFocus(page)).label, /系统默认程序/);
        await page.keyboard.press('Escape');assert.equal((await deepFocus(page)).tag, 'button');
        assert.equal(await page.evaluate(() => document.activeElement.id), 'triggerImage');
    } finally {await page.close();}
});

test('the native audio adapter plays, pauses, seeks and mutes using the actual v10 scoped keyboard controls', async () => {
    const page = await browser.newPage();
    try {
        await open(page, 'audio');
        await page.locator('media-play-button').click();
        await page.waitForFunction(() => document.querySelector('audio').currentTime > .1);
        await page.locator('media-container').focus();await page.keyboard.press('k');
        assert.equal(await page.locator('audio').evaluate(node => node.paused), true);
        const before = await page.locator('audio').evaluate(node => node.currentTime);
        await page.keyboard.press('ArrowRight');
        assert.ok(await page.locator('audio').evaluate((node,before) => node.currentTime > before + 1, before));
        await page.keyboard.press('m');assert.equal(await page.locator('audio').evaluate(node => node.muted), true);
        await page.locator('.doc-pt-close').click();
        assert.equal(await page.locator('audio').count(), 0);
        assert.equal(await page.evaluate(() => document.activeElement.id), 'triggerAudio');
    } finally {await page.close();}
});

test('390px touch emulation can play audio and choose a rate without a hover interaction', async () => {
    const page = await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
    try {
        await open(page,'audio');await page.locator('media-play-button').tap();
        await page.waitForFunction(()=>!document.querySelector('audio').paused);
        await page.locator('media-playback-rate-button').tap();
        await page.locator('media-menu-radio-item').filter({hasText:/\b1\.5\b/}).tap();
        assert.equal(await page.locator('audio').evaluate(node=>node.playbackRate),1.5);
        await page.locator('.doc-pt-close').tap();
        assert.equal(await page.locator('audio-player').count(),0);
    } finally {await page.close();}
});

test('saved text sizes scale captions and controls while narrow audio stays within its viewport', async () => {
    const page=await browser.newPage({viewport:{width:390,height:844}});
    try {
        await open(page,'audio');const measured=[];
        for(const size of ['small','standard','large']) {
            await page.evaluate(size=>document.documentElement.dataset.uiSize=size,size);
            measured.push(await page.evaluate(()=>({title:parseFloat(getComputedStyle(document.querySelector('.media-preview-caption h2')).fontSize),
                button:document.querySelector('audio-skin').shadowRoot.querySelector('media-play-button').getBoundingClientRect().width,
                scroll:document.documentElement.scrollWidth})));
        }
        assert.ok(measured[2].title>measured[1].title);
        assert.ok(measured[2].button>measured[1].button);
        assert.ok(measured.every(item=>item.scroll<=390 && item.button>=44));
    } finally {await page.close();}
});

test('preparing and error states stay accessible and an explicit retry performs only a metadata read', async () => {
    const page=await browser.newPage({viewport:{width:390,height:844}});const retryReads=[];
    try {
        await page.route('**/api/attachments/1/media?*',route=>{
            const url=new URL(route.request().url());
            if(url.searchParams.get('retry')==='1'){retryReads.push(route.request().method());return route.continue();}
            return route.fulfill({json:{status:'preparing',kind:'video',progress:35,message:'合成演示：仅本机准备兼容播放版本。'}});
        });
        await page.goto(origin);await page.click('#triggerVideo');await page.waitForSelector('progress');
        assert.equal(await page.locator('#mediaViewerContainer').getAttribute('aria-busy'),'true');
        assert.equal(await page.locator('progress').getAttribute('value'),'35');
        await page.screenshot({path:path.join(evidence,'preparing-390.png'),animations:'disabled'});
        await page.locator('.doc-pt-close').click();
        await page.unroute('**/api/attachments/1/media?*');
        await page.route('**/api/attachments/1/media?*',route=>{
            const url=new URL(route.request().url());
            if(url.searchParams.get('retry')==='1'){retryReads.push(route.request().method());return route.continue();}
            return route.fulfill({json:{status:'error',message:{reason:'synthetic error object'}}});
        });
        await page.click('#triggerVideo');await page.waitForSelector('[data-media-action="retry"]');
        assert.doesNotMatch(await page.locator('#mediaViewerContainer').innerText(),/\[object Object\]/);
        assert.equal(await page.locator('#mediaViewerContainer').getAttribute('aria-busy'),'false');
        await page.screenshot({path:path.join(evidence,'error-retry-390.png'),animations:'disabled'});
        await page.locator('[data-media-action="retry"]').click();await page.waitForSelector('video-player video',{state:'attached'});
        assert.deepEqual(retryReads,['GET']);
    } finally {await page.close();}
});

test('the actual v10 HLS adapter plays a local synthetic HLS playlist and tears down on switch', async t => {
    if (!fs.existsSync(path.join(state,'hls/index.m3u8'))) return t.skip('Generate a local synthetic HLS fixture; no engine or media is downloaded by this test');
    const page = await browser.newPage();
    try {
        page.setDefaultTimeout(8000);
        await page.goto(origin); await page.click('#triggerHls');await page.waitForSelector('hlsjs-video', {state:'attached'});
        await page.locator('media-play-button').click();
        await page.waitForFunction(() => document.querySelector('hlsjs-video').currentTime > .1);
        await page.locator('media-container').focus();await page.keyboard.press('k');
        assert.equal(await page.locator('hlsjs-video').evaluate(node=>node.paused), true);
        await page.locator('hlsjs-video').evaluate(node=>node.currentTime=3);
        await page.waitForFunction(()=>document.querySelector('hlsjs-video').currentTime>=3);
        assert.match(await page.locator('.media-preview-caption p').innerText(), /兼容/);
        await page.screenshot({path:path.join(evidence,'hls-compatible-1440.png')});
        const old = await page.locator('hlsjs-video').elementHandle();
        await page.evaluate(()=>viewAttachment(2));await page.waitForSelector('audio-player audio', {state:'attached'});
        assert.equal(await old.evaluate(node=>node.isConnected), false);
        assert.equal(await old.evaluate(node=>node.hasAttribute('src')), false);
        assert.ok(requests.some(value=>value.endsWith('segment000.ts')));
        await page.locator('.doc-pt-close').click();
    } finally {await page.close();}
});

test('the complete manifest keeps media controls, custom icons and project-switch cleanup working', async () => {
    const bundle = assemble(path.join(root, 'source/frontend'), manifest).toString('utf8');
    const fullHtml = workspace.replace(/{{ current_user_id \| tojson }}/g,'1').replace(/{{ current_username \| tojson }}/g,'"合成验证"')
        .replace(/{{ current_is_admin \| tojson }}/g,'false').replace(/{{ csrf_token \| tojson }}/g,'"synthetic"');
    const projects = [1,2].map(id=>({id,name:`合成项目${id}`,number:`SYN-${id}`,year:2026,method:'公开招标',purchaser:'合成单位',progress:0,
        stages:[],lots:[],suppliers:[],registrations:[],complaints:[],activity:[],attachments:[{id:2,filename:'合成录音.wav',extension:'wav',file_size:1000}]}));
    for (const width of [1440,390]) {
        const page = await browser.newPage({viewport:{width,height:844}});const errors=[],outbound=[];
        page.setDefaultTimeout(8000);page.on('pageerror',error=>errors.push(error.message));
        await page.route('**/*',route=>{
            const url=new URL(route.request().url());
            if(url.origin!==origin){outbound.push(url.origin);return route.abort();}
            if(url.pathname==='/complete')return route.fulfill({contentType:'text/html; charset=utf-8',body:fullHtml});
            if(url.pathname==='/static/app.js')return route.fulfill({contentType:'text/javascript; charset=utf-8',body:bundle});
            if(url.pathname==='/static/style.css')return route.fulfill({contentType:'text/css',body:css});
            if(url.pathname.startsWith('/static/libs/videojs/'))return route.continue();
            if(url.pathname.startsWith('/static/'))return route.fulfill({body:''});
            if(url.pathname.startsWith('/api/attachments/'))return route.continue();
            if(url.pathname==='/api/projects')return route.fulfill({json:projects});
            if(/^\/api\/projects\/\d+$/.test(url.pathname))return route.fulfill({json:projects[Number(url.pathname.split('/').pop())-1]});
            if(url.pathname==='/api/stats')return route.fulfill({json:{total:2,in_progress:2,completed:0}});
            if(url.pathname==='/api/system-info')return route.fulfill({json:{is_admin:false,is_desktop:false,license:{}}});
            if(url.pathname.startsWith('/api/'))return route.fulfill({json:{methods:[]}});
            return route.continue();
        });
        try {
            await page.goto(origin+'/complete',{waitUntil:'networkidle'});
            await page.evaluate(async()=>{await selectProject(1);switchProjectTab('attachments');});
            await page.getByRole('button',{name:'预览音频',exact:true}).click();
            await page.waitForSelector('audio-skin media-play-button');
            assert.equal(await page.locator('.doc-pt-right .pm-icon').count(),3);
            const seen=[];for(let i=0;i<12;i++){seen.push(await deepFocus(page));await page.keyboard.press('Tab');}
            assert.ok(seen.some(item=>item.tag==='media-play-button'));
            await page.evaluate(()=>selectProject(2));
            assert.equal(await page.locator('audio-player').count(),0);
            assert.equal(await page.locator('#docPreviewOverlay').evaluate(node=>node.classList.contains('open')),false);
            assert.deepEqual(errors,[]);assert.deepEqual(outbound,[]);
        } finally {await page.close();}
    }
});

test('four themes at 1440 and 390 preserve readable, bounded media controls and original actions', async () => {
    const metrics = [];
    for (const theme of ['default','dark','blue','green']) for (const width of [1440,390]) for (const kind of ['video','audio']) {
        const page = await browser.newPage({viewport:{width,height:width === 390 ? 844 : 900}});
        try {
            await open(page, kind);await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
            const measured = await page.evaluate(() => {
                const skin = document.querySelector('video-skin,audio-skin'); const button = skin.shadowRoot.querySelector('media-play-button');
                const toolbar = [...document.querySelectorAll('.doc-pt-right button')].map(node => ({width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height,label:node.getAttribute('aria-label')}));
                const controls=[...skin.shadowRoot.querySelectorAll('[role="button"]')].filter(node=>!node.disabled && node.getClientRects().length && getComputedStyle(node).visibility!=='hidden').map(node=>({tag:node.localName,label:node.getAttribute('aria-label'),width:node.getBoundingClientRect().width,height:node.getBoundingClientRect().height}));
                return {width:innerWidth, scroll:document.documentElement.scrollWidth, playerWidth:skin.getBoundingClientRect().width, button:button.getBoundingClientRect().toJSON(), toolbar, controls,
                    heading:document.querySelector('.media-preview-caption h2').getBoundingClientRect().toJSON()};
            });
            metrics.push({theme,width,kind,...measured});
            assert.ok(measured.scroll <= width, JSON.stringify(measured));
            assert.ok(measured.playerWidth <= width, JSON.stringify(measured));
            if (width === 390) {
                assert.ok(measured.button.height >= 44 && measured.button.width >= 44, JSON.stringify(measured.button));
                assert.ok(measured.toolbar.every(item => item.height >= 44 && item.width >= 44));
                assert.ok(measured.controls.every(item => item.height >= 44 && item.width >= 44),JSON.stringify(measured.controls));
            }
            await page.screenshot({path:path.join(evidence, `${theme}-${width}-${kind}.png`), fullPage:true});
        } finally {await page.close();}
    }
    fs.writeFileSync(path.join(evidence, 'layout-metrics.json'), JSON.stringify(metrics,null,2));
});
