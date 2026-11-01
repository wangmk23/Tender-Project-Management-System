'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source/frontend/03-attachments.js'), 'utf8');
const workspace = fs.readFileSync(path.join(root, 'src/templates/workspace.html'), 'utf8');
const preview = workspace.slice(workspace.indexOf('<div class="doc-preview-overlay"'), workspace.indexOf('<!-- ═══ 文档预览库'));
const ready = (id = 1, extra = {}) => ({status: 'ready', kind: 'video', filename: '合成视频.mp4', native_suggested: true,
    mime_type: 'video/mp4', duration: 12, url: `/api/attachments/${id}/media/stream?profile=original`, ...extra});
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(responses = []) {
    const dom = new JSDOM(`<button id="trigger">查看合成附件</button><div id="attachmentsContent"></div>${preview}`, {
        url: 'http://127.0.0.1:59994/', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const w = dom.window;
    const requests = [], timers = new Map(), paused = [], loaded = [], external = [];
    let timerId = 0;
    w.setTimeout = callback => {timers.set(++timerId, callback); return timerId;};
    w.clearTimeout = id => timers.delete(id);
    w.HTMLMediaElement.prototype.pause = function () {paused.push(this);};
    w.HTMLMediaElement.prototype.load = function () {loaded.push(this);};
    Object.assign(w, {
        currentProject: {id: 1, attachments: [{id: 1, filename: '合成视频.mp4', extension: 'mp4', file_size: 400},
            {id: 2, filename: '合成录音.flac', extension: 'flac', file_size: 500}]},
        readUiPreferences: () => ({preview: true}),
        escHtml: str => String(str).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
        formatDateTimeShort: () => '合成日期', toast() {}, uiStateMarkup: () => '',
        localFetch: async (url, options) => {
            requests.push({url, options});
            const value = responses.shift();
            if (value instanceof Error) throw value;
            const result = typeof value === 'function' ? await value(options) : value;
            return {response: {ok: true, status: 200}, result};
        },
        readApiJsonResponse: response => response.json(),
    });
    w.eval(`${source}\nloadMediaPlayerLibrary = async () => {};\nopenAttachmentLocal = id => window.externalCalls.push(id);\nwindow.previewTest = {getState: () => _previewState};`);
    w.externalCalls = external;
    w.document.getElementById('trigger').focus();
    return {w, dom, requests, timers, paused, loaded, external, async poll() {
        const entry = [...timers.entries()][0]; assert.ok(entry, 'must schedule a read-only poll');
        timers.delete(entry[0]); await entry[1](); await tick();
    }, close() {w.closeDocPreview(); dom.window.close();}};
}

test('media types enter the existing preview and respect the external-open preference', async () => {
    const h = harness([ready()]);
    await h.w.viewAttachment(1); await tick();
    assert.equal(h.w.previewTest.getState().type, 'video');
    assert.equal(h.w.document.querySelectorAll('video-player video').length, 1);
    assert.equal(h.external.length, 0);
    h.w.readUiPreferences = () => ({preview: false});
    await h.w.viewAttachment(2);
    assert.deepEqual(h.external, [2]);
    assert.equal(h.requests.length, 1);
    h.close();
});

test('player initialization begins while metadata is still preparing', async () => {
    let finish;
    const h = harness([() => new Promise(resolve => {finish = resolve;})]);
    const calls = [];
    h.w.loadMediaPlayerLibrary = async (kind, hls) => {calls.push({kind, hls});};
    await h.w.viewAttachment(1); await tick();
    assert.equal(h.requests.length, 1);
    assert.ok(calls.some(call => call.kind === 'video' && !call.hls), 'warm the idle player before metadata finishes');
    finish(ready()); await tick();
    h.close();
});

test('independent player module imports start together and preserve failure retry', async () => {
    const {parse} = require('acorn');
    const vm = require('node:vm');
    const node = parse(source, {ecmaVersion:'latest'}).body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'loadMediaPlayerLibrary');
    const calls = [];
    const pending = [];
    const sandbox = {importModule: path => {calls.push(path); return new Promise(resolve => pending.push(resolve));}, Map};
    vm.runInNewContext(`const _mediaPlayerLibraries = new Map(); ${source.slice(node.start,node.end).replaceAll('import(', 'importModule(')}; result = loadMediaPlayerLibrary('video', true);`, sandbox);
    await tick();
    assert.equal(calls.length, 4, 'four independent entries must overlap rather than serialize');
    pending.forEach(resolve => resolve()); await sandbox.result;
});

test('queued metadata is polled without mutation; original ready mounts an idle inline video', async () => {
    const h = harness([{status: 'queued', kind: 'video', message: '等待处理', progress: null}, ready()]);
    await h.w.viewAttachment(1); await tick();
    assert.match(h.w.document.getElementById('mediaViewerContainer').textContent, /排队|等待/);
    await h.poll();
    const media = h.w.document.querySelector('video-player video');
    assert.ok(media); assert.equal(media.autoplay, false); assert.ok(media.hasAttribute('playsinline'));
    assert.equal(media.preload, 'metadata');
    assert.deepEqual(h.requests.map(r => r.options.method), ['GET', 'GET']);
    assert.ok(h.requests.every(r => r.url.endsWith('profile=original')));
    assert.equal(h.timers.size, 1, 'ready media keeps its private cache alive');
    h.close();
});

test('unsupported original switches once to compatible HLS, then mounts the v10 adapter', async () => {
    const h = harness([ready(1, {native_suggested: false}), {status: 'preparing', kind: 'video', progress: 25},
        ready(1, {url: '/api/attachments/1/media/compatible/index.m3u8', mime_type: 'application/vnd.apple.mpegurl'})]);
    await h.w.viewAttachment(1); await tick();
    assert.match(h.w.document.getElementById('mediaViewerContainer').textContent, /兼容|准备/);
    await h.poll();
    assert.ok(h.w.document.querySelector('video-player hlsjs-video'));
    assert.deepEqual(h.requests.map(r => new URL(r.url, h.w.location.origin).searchParams.get('profile')), ['original', 'compatible', 'compatible']);
    h.close();
});

test('a decoding error requests compatibility once; compatibility failure offers a read-only retry', async () => {
    const h = harness([ready(), ready(1, {url: '/api/attachments/1/media/stream?profile=compatible'})]);
    await h.w.viewAttachment(1); await tick();
    const media = h.w.document.querySelector('video');
    Object.defineProperty(media, 'error', {value: {code: 3}});
    media.dispatchEvent(new h.w.Event('error')); await tick();
    const compatible = h.w.document.querySelector('video');
    Object.defineProperty(compatible, 'error', {value: {code: 4}});
    compatible.dispatchEvent(new h.w.Event('error')); await tick();
    assert.equal(h.requests.length, 2);
    assert.match(h.w.document.getElementById('mediaViewerContainer').textContent, /重试/);
    assert.ok(h.w.document.querySelector('[data-media-action="retry"]'));
    assert.ok(h.w.document.querySelector('[data-media-action="download"]'));
    h.close();
});

test('network errors and object-shaped messages stay readable without an automatic transcode loop', async () => {
    const h = harness([{status: 'error', message: {error: 'unexpected object'}}]);
    await h.w.viewAttachment(1); await tick();
    const text = h.w.document.getElementById('mediaViewerContainer').textContent;
    assert.doesNotMatch(text, /\[object Object\]/);
    assert.match(text, /重试|暂时无法/);
    assert.equal(h.requests.length, 1); assert.equal(h.timers.size, 0);
    h.close();
});

test('closing aborts an unfinished read and prevents late results from mounting', async () => {
    let finish;
    const h = harness([() => new Promise(resolve => {finish = resolve;})]);
    await h.w.viewAttachment(1); await tick();
    h.w.closeDocPreview();
    assert.equal(h.requests[0].options.signal.aborted, true);
    finish(ready()); await tick();
    assert.equal(h.w.document.querySelectorAll('video-player, audio-player').length, 0);
    assert.equal(h.timers.size, 0);
    assert.equal(h.w.document.activeElement.id, 'trigger');
    h.close();
});

test('a fast switch invalidates a late player import and retains only the new audio session', async () => {
    const h = harness([ready(), ready(2, {kind: 'audio', mime_type: 'audio/mp4'})]);
    let finish;
    h.w.loadMediaPlayerLibrary = () => new Promise(resolve => {finish = resolve;});
    await h.w.viewAttachment(1); await tick();
    h.w.loadMediaPlayerLibrary = async () => {};
    await h.w.viewAttachment(2); await tick();
    finish(); await tick();
    assert.equal(h.w.document.querySelectorAll('video-player').length, 0);
    assert.equal(h.w.document.querySelectorAll('audio-player audio').length, 1);
    assert.equal(h.w.previewTest.getState().fileId, 2);
    h.close();
});

test('cleanup pauses, clears the source and load, and removes the player and poll exactly once', async () => {
    const h = harness([ready()]);
    await h.w.viewAttachment(1); await tick();
    const media = h.w.document.querySelector('video');
    h.w.releaseAttachmentPreviewResources(); h.w.releaseAttachmentPreviewResources();
    assert.equal(h.paused.filter(value => value === media).length, 1);
    assert.equal(h.loaded.filter(value => value === media).length, 1);
    assert.equal(media.hasAttribute('src'), false);
    assert.equal(media.isConnected, false); assert.equal(h.timers.size, 0);
    h.close();
});

test('ready streams reject a remote URL or another attachment identity', async () => {
    for (const url of ['https://example.com/movie.mp4', '/api/attachments/999/media/stream', 'javascript:alert(1)']) {
        const h = harness([ready(1, {url})]);
        await h.w.viewAttachment(1); await tick();
        assert.equal(h.w.document.querySelectorAll('video, hlsjs-video').length, 0);
        assert.match(h.w.document.getElementById('mediaViewerContainer').textContent, /重试/);
        h.close();
    }
});

test('project and complaint attachment cards expose the media preview entry', () => {
    const h = harness();
    h.w.renderAttachments();
    assert.match(h.w.document.getElementById('attachmentsContent').innerHTML, /预览视频/);
    assert.match(h.w.document.getElementById('attachmentsContent').innerHTML, /预览音频/);
    assert.match(h.w.document.getElementById('fileInput').accept, /\.mp4/);
    const business = fs.readFileSync(path.join(root, 'source/frontend/07-business.js'), 'utf8');
    assert.match(business, /attachmentMediaKind\(a\)/);
    h.close();
});

test('ready keepalive reads do not rebuild the player, tolerate a temporary failure, and stop on close', async () => {
    const h = harness([ready(), new Error('offline'), ready()]);
    await h.w.viewAttachment(1); await tick();
    const player = h.w.document.querySelector('video');
    await h.poll();
    assert.equal(h.w.document.querySelector('video'), player);
    await h.poll();
    assert.equal(h.w.document.querySelector('video'), player);
    assert.equal(h.requests.length, 3);
    assert.ok(h.requests.every(r => !r.url.includes('retry=')));
    h.close(); assert.equal(h.timers.size, 0);
});

test('explicit retry clears only the failed profile cache and never re-uploads an attachment', async () => {
    const h = harness([{status:'error', message:'暂时失败'}, ready()]);
    await h.w.viewAttachment(1); await tick();
    h.w.document.querySelector('[data-media-action="retry"]').click(); await tick();
    assert.equal(h.requests[1].options.method, 'GET');
    assert.equal(new URL(h.requests[1].url, h.w.location.origin).searchParams.get('retry'), '1');
    assert.equal(new URL(h.requests[1].url, h.w.location.origin).searchParams.get('profile'), 'original');
    h.close();
});

test('server-probed audio kind controls the badge and compact player even in a video container extension', async () => {
    const h = harness([ready(1,{kind:'audio',mime_type:'audio/mp4'})]);
    await h.w.viewAttachment(1);await tick();
    assert.equal(h.w.previewTest.getState().type,'audio');
    assert.equal(h.w.document.getElementById('previewFileType').textContent,'音频');
    assert.ok(h.w.document.querySelector('audio-player audio'));
    h.close();
});

test('legacy camera and lossless audio containers enter the capability check without claiming native decoding', () => {
    const h=harness();
    for(const extension of ['MTS','vob','ogv']) assert.equal(h.w.attachmentMediaKind({extension}),'video');
    for(const extension of ['au','mka','ac3','dts']) assert.equal(h.w.attachmentMediaKind({extension}),'audio');
    h.w.renderAttachments();const accepted=h.w.document.getElementById('fileInput').accept;
    for(const extension of ['mts','vob','ogv','au','mka','ac3','dts']) assert.ok(accepted.split(',').includes('.'+extension));
    h.close();
});
