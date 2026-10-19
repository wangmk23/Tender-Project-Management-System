'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source/frontend/25-about-updates.js'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'source/frontend/06-admin.js'), 'utf8');
const about = acorn.parse(admin, {ecmaVersion:'latest'}).body.find(n => n.type === 'FunctionDeclaration' && n.id.name === 'renderAboutCard');
const configured = {configured:true, owner:'example', repository:'manager'};
const release = (tag = 'v5.8.43-public', body = '新增\n- 更新检查') => ({tag_name:tag, body, published_at:'2026-10-19T07:00:00Z', draft:false, prerelease:false});
const response = (data, status = 200, headers = {}) => ({ok:status >= 200 && status < 300, status,
    headers:{get:key => headers[key] || null}, json:async () => data});

async function setup(t, options = {}) {
    const dom = new JSDOM('<main id="page"></main>', {url:'http://localhost:5001', runScripts:'outside-only'});
    t.after(() => dom.window.close());
    const w = dom.window;
    w.escHtml = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
    w.localFetch = options.localFetch || (async () => response(options.config || configured));
    w.fetch = options.fetch || (async () => response(release()));
    w.isDesktopApp = () => options.serverDesktop !== false;
    if (options.desktop !== false) w.pywebview = {api:{}};
    w.toast = () => {};
    w.eval(admin.slice(about.start, about.end));
    w.eval(source + "\nglobalThis.__aboutTestState = aboutUpdates;");
    w.systemInfo = {version:options.version || 'v5.8.42'};
    w.document.getElementById('page').innerHTML = w.renderAboutCard(w.systemInfo);
    await w.initializeAboutPanel({version:options.version || 'v5.8.42'});
    return w;
}

test('numeric comparison handles 9/10, edition suffixes and large components', async t => {
    const w = await setup(t);
    assert.equal(w.compareAboutVersions('v5.8.9', 'v5.8.10-public'), -1);
    assert.equal(w.compareAboutVersions('v5.8.42', 'v5.8.42-public'), 0);
    assert.equal(w.compareAboutVersions('v6.0.0', 'v5.99.99'), 1);
    assert.equal(w.compareAboutVersions('v5.8.9007199254740993', 'v5.8.9007199254740992'), 1);
    assert.throws(() => w.compareAboutVersions('unknown', 'v5.8.42'));
});

test('an unconfigured source is explicit and never fetches GitHub', async t => {
    let calls = 0;
    const w = await setup(t, {config:{configured:false}, fetch:async () => { calls++; throw new Error('unexpected'); }});
    await w.checkSoftwareUpdates();
    assert.equal(calls, 0);
    assert.equal(w.document.getElementById('aboutUpdateStatus').textContent, '尚未配置更新源');
    assert.equal(w.document.getElementById('aboutCheckUpdate').disabled, true);
});

test('new release shows notes and a configured repository link, safely escaping content', async t => {
    let request;
    const w = await setup(t, {fetch:async (url, options) => {request = {url, options};return response({...release(undefined, '<img src=x onerror=alert(1)>'),html_url:'javascript:alert(1)'});}});
    await w.checkSoftwareUpdates();
    assert.match(w.document.getElementById('aboutUpdateStatus').textContent, /发现新版本/);
    const link = w.document.querySelector('#aboutUpdateDetail a');
    assert.equal(link.href, 'https://github.com/example/manager/releases/tag/v5.8.43-public');
    assert.equal(w.document.querySelector('img'), null);
    assert.match(w.document.getElementById('aboutUpdateDetail').textContent, /<img/);
    assert.equal(request.options.credentials, 'omit');
    assert.equal(request.options.headers.Authorization, undefined);
});

test('same release and locally newer release do not offer an update', async t => {
    const w = await setup(t, {fetch:async () => response(release('v5.8.42-public'))});
    await w.checkSoftwareUpdates();
    assert.equal(w.document.getElementById('aboutUpdateStatus').textContent, '当前已是最新版本');
    w.fetch = async () => response(release('v5.8.41-public'));
    await w.checkSoftwareUpdates();
    assert.match(w.document.getElementById('aboutUpdateStatus').textContent, /当前版本高于最新发布版本/);
    assert.equal(w.document.querySelector('#aboutUpdateDetail a'), null);
});

test('in-flight check disables the button and deduplicates repeated clicks', async t => {
    let finish, calls = 0;
    const w = await setup(t, {fetch:() => {calls++;return new Promise(resolve => {finish=resolve;});}});
    const checking = w.checkSoftwareUpdates();
    assert.equal(w.document.getElementById('aboutCheckUpdate').disabled, true);
    await w.checkSoftwareUpdates();
    assert.equal(calls, 1);
    finish(response(release()));await checking;
    assert.equal(w.document.getElementById('aboutCheckUpdate').disabled, false);
});

test('offline check reports the network failure and leaves software information intact', async t => {
    const w = await setup(t, {fetch:async () => {throw new domTypeError();}});
    function domTypeError() { return new w.TypeError('Failed to fetch'); }
    await w.checkSoftwareUpdates();
    assert.match(w.document.getElementById('aboutUpdateStatus').textContent, /无法连接 GitHub/);
    assert.match(w.document.querySelector('.settings-about-card').textContent, /v5.8.42/);
    assert.equal(w.document.getElementById('aboutCheckUpdate').disabled, false);
});

test('timeout cancels the request and restores the button', async t => {
    const w = await setup(t);
    let expire;
    w.setTimeout = fn => {expire=fn;return 1;};w.clearTimeout = () => {};
    w.fetch = (_url, options) => new Promise((_resolve,reject) => options.signal.addEventListener('abort', () => reject(new w.DOMException('aborted','AbortError'))));
    const checking = w.checkSoftwareUpdates();expire();await checking;
    assert.match(w.document.getElementById('aboutUpdateStatus').textContent, /请求超时/);
    assert.equal(w.document.getElementById('aboutCheckUpdate').disabled, false);
});

test('no release differs from a private or missing repository', async t => {
    const w = await setup(t, {fetch:async url => url.endsWith('/releases/latest') ? response({},404) : response({private:false})});
    await w.checkSoftwareUpdates();assert.match(w.document.getElementById('aboutUpdateStatus').textContent,/没有可用的正式发布版本/);
    w.fetch=async()=>response({},404);await w.checkSoftwareUpdates();
    assert.match(w.document.getElementById('aboutUpdateStatus').textContent,/仓库不存在或为私有仓库/);
});

test('rate limit, server failure and malformed versions produce explicit messages', async t => {
    const w = await setup(t, {fetch:async () => response({},403,{'X-RateLimit-Remaining':'0'})});
    await w.checkSoftwareUpdates();assert.match(w.document.getElementById('aboutUpdateStatus').textContent,/次数已达限制/);
    w.fetch=async()=>response({},503);await w.checkSoftwareUpdates();assert.match(w.document.getElementById('aboutUpdateStatus').textContent,/暂时不可用/);
    w.fetch=async()=>response(release('not-a-version'));await w.checkSoftwareUpdates();assert.match(w.document.getElementById('aboutUpdateStatus').textContent,/没有可识别/);
});

test('changelog paginates, excludes drafts/prereleases, and keeps prior content on network failure', async t => {
    const w = await setup(t, {fetch:async () => response(Array.from({length:10},(_,i)=>release(`v5.8.${40-i}-public`)))});
    await w.loadSoftwareChangelog();assert.equal(w.document.querySelectorAll('#aboutChangelog article').length,10);
    assert.match(w.document.getElementById('aboutChangelog').textContent,/加载更早版本/);
    w.fetch=async()=>response([release('v5.8.30-public'),{...release('v5.8.29-public'),draft:true},{...release('v5.8.28-public'),prerelease:true}]);
    await w.loadSoftwareChangelog(true);assert.equal(w.document.querySelectorAll('#aboutChangelog article').length,11);
    w.fetch=async()=>{throw new w.TypeError('offline');};await w.loadSoftwareChangelog();
    assert.equal(w.document.querySelectorAll('#aboutChangelog article').length,11);
    assert.match(w.document.getElementById('aboutChangelog').textContent,/无法连接 GitHub/);
});

test('empty changelog and a failing configuration endpoint do not break the About page', async t => {
    const w = await setup(t, {fetch:async()=>response([])});
    await w.loadSoftwareChangelog();assert.match(w.document.getElementById('aboutChangelog').textContent,/暂无可用/);
    w.__aboutTestState.source=null;w.localFetch=async()=>response({},500);
    await w.initializeAboutPanel({version:'v5.8.42'});
    assert.match(w.document.getElementById('aboutUpdateStatus').textContent,/更新源信息读取失败/);
    assert.equal(w.document.querySelectorAll('.settings-about-layout section').length,3);
});

test('only desktop links can request the default browser', async t => {
    const w = await setup(t);await w.checkSoftwareUpdates();
    const link=w.document.querySelector('#aboutUpdateDetail a');let prevented=0,request;
    const event={preventDefault:()=>prevented++};
    w.api=async (...args)=>{request=args;return {opened:true};};
    await w.openSoftwareRelease(event,link);assert.equal(prevented,1);
    assert.equal(request[0],'POST');assert.equal(request[1],'/api/software-updates/open-release');
    link.href='https://other.invalid/';await w.openSoftwareRelease(event,link);assert.equal(prevented,2);
});

test('browser visits hide updates and logs and never read the source or GitHub, even on localhost', async t => {
    let calls=0;
    const w=await setup(t,{desktop:false,localFetch:async()=>{calls++;return response(configured);},fetch:async()=>{calls++;return response(release());}});
    assert.equal(w.document.querySelectorAll('.settings-about-layout>section').length,1);
    assert.match(w.document.querySelector('.settings-about-card').textContent,/v5.8.42/);
    assert.equal(w.document.getElementById('aboutCheckUpdate'),null);
    assert.equal(w.document.getElementById('aboutViewChangelog'),null);
    await w.checkSoftwareUpdates();await w.loadSoftwareChangelog();
    assert.equal(calls,0);
});

test('late native bridge reveals the desktop controls without changing other settings', async t => {
    const w=await setup(t,{desktop:false});
    w.pywebview={api:{}};w.dispatchEvent(new w.Event('pywebviewready'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(w.document.querySelectorAll('.settings-about-layout>section').length,3);
    assert.equal(w.document.getElementById('aboutUpdateStatus').textContent,'尚未检查更新');
});

test('native bridge alone cannot enable updates for a non-desktop or LAN context', async t => {
    const w=await setup(t,{serverDesktop:false});
    assert.equal(w.document.getElementById('aboutCheckUpdate'),null);
    assert.equal(w.isAboutDesktopClient(),false);
});
