'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/templates/workspace.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/g, '');
const source = ['01-core.js', '02-projects.js', '04-project-workflow.js', '11-stage-settings.js', '22-procurement-methods.js', '23-project-flow-editor.js']
    .map(name => fs.readFileSync(path.join(root, 'source/frontend', name), 'utf8')).join('\n');
function preview(overrides = {}) {
    return {mode:'method', method:{id:'online', name:'合成竞价', revision:2}, base_fingerprint:'checked-flow',
        stages:[{id:'start', name:'保留阶段'}, {id:'quote', name:'新竞价阶段'}],
        diff:{added:[{id:'quote', name:'新竞价阶段'}], updated:[], removed:[{id:'open', name:'旧开标阶段'}]},
        archived_history:[{id:'open', name:'旧开标阶段', skipped:true}],
        preserved_completed:[{id:'start', name:'保留阶段', completed:true}], blocked:[], requires_confirmation:true, ...overrides};
}
function setup(t) {
    const dom = new JSDOM(html, {url:'http://localhost', runScripts:'outside-only'});
    t.after(() => {dom.window.syncApplicationAccess({mode:'full'});dom.window.close();});
    const w = dom.window, d = w.document;
    w.eval(source + `\nwindow.seedSync=p=>{currentProject=p;allProjects=[p];systemSettings={procurement_catalog:{methods:[{id:'online',name:'合成竞价',enabled:true},{id:'tender',name:'合成招标',enabled:true}]}};};window.syncRun=code=>eval(code);`);
    const p = {id:1, name:'合成项目', number:'SYN-001', purchaser:'合成采购人', method:'合成竞价', procurement:{method_id:'online'},
        record_version:'project-v1', year:2026, budget:'100', lots:[], notes:'', progress:0, current_stage_key:'start',
        stages:[{key:'start', name:'保留阶段', modules:['common'], completed:true, completed_date:'2026-10-20'}]};
    w.seedSync(p); w.toast = () => {}; w.refreshProject = async () => {};
    w.renderInfo();
    const calls = [], confirmations = [];
    w.api = async (method, url, body) => {calls.push({method,url,body}); return method === 'POST' ? preview() : {...p, record_version:'project-v2'};};
    w.confirmDialog = async (...args) => {confirmations.push(args); return true;};
    return {w, d, p, calls, confirmations};
}
function change(d, w, id, value) {d.getElementById(id).value = value; d.getElementById(id).dispatchEvent(new w.Event('input', {bubbles:true}));}
function deferred() {let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve};}

test('same-method ordinary info save preserves a custom workflow without preview or sync intent', async t => {
    const {w,d,calls,confirmations} = setup(t); change(d,w,'infoName','普通字段修改');
    await w.saveProjectInfo();
    assert.deepEqual(calls.map(c => c.method), ['PUT']); assert.equal(confirmations.length, 0);
    assert.equal(calls[0].body.name, '普通字段修改'); assert.equal(calls[0].body.record_version, 'project-v1');
    assert.equal('sync_method_flow' in calls[0].body, false); assert.equal('method_flow_fingerprint' in calls[0].body, false);
});
test('explicit sync previews the selected method, confirms history and sends fingerprint with the info draft', async t => {
    const {w,d,calls,confirmations} = setup(t); change(d,w,'infoNotes','保留草稿');
    await w.saveProjectInfo({syncMethodFlow:true});
    assert.deepEqual(calls.map(c => c.method), ['POST','PUT']);
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0].body)), {mode:'method', procurement_method_id:'online'});
    assert.equal(calls[1].body.sync_method_flow, true); assert.equal(calls[1].body.method_flow_fingerprint, 'checked-flow');
    assert.equal(calls[1].body.notes, '保留草稿'); assert.match(confirmations[0][1], /新增.*1|1.*新增/);
    assert.match(confirmations[0][1], /历史.*1|1.*历史/); assert.match(confirmations[0][1], /跳过/); assert.match(confirmations[0][1], /待处理|待办/);
    assert.ok([...d.querySelectorAll('button')].some(b => /同步所选方式流程/.test(b.textContent)));
});
test('a changed method is previewed before ordinary save and acknowledged with its fingerprint', async t => {
    const {w,d,calls,confirmations} = setup(t); change(d,w,'infoMethod','tender');
    await w.saveProjectInfo(); assert.deepEqual(calls.map(c => c.method), ['POST','PUT']);
    assert.equal(calls[0].body.procurement_method_id,'tender'); assert.equal(calls[1].body.procurement_method_id,'tender');
    assert.equal(calls[1].body.method_flow_fingerprint,'checked-flow'); assert.equal('sync_method_flow' in calls[1].body,false); assert.equal(confirmations.length,1);
});
test('explicit sync still confirms when the preview has no historical changes', async t => {
    const {w,calls,confirmations} = setup(t); w.api = async (method,url,body) => {calls.push({method,url,body});return method==='POST'?preview({requires_confirmation:false}):{};};
    await w.saveProjectInfo({syncMethodFlow:true}); assert.equal(confirmations.length,1); assert.equal(calls.length,2);
});
test('a cancelled sync sends no PUT and retains typed draft', async t => {
    const {w,d,calls} = setup(t); change(d,w,'infoNotes','取消后继续编辑'); w.confirmDialog = async () => false;
    await w.saveProjectInfo({syncMethodFlow:true}); assert.deepEqual(calls.map(c => c.method),['POST']);
    assert.equal(d.getElementById('infoNotes').value,'取消后继续编辑'); assert.equal(w.syncRun('projectInfoDrafts.get(1).infoNotes'),'取消后继续编辑');
});
test('blocked method preview exposes persistent dependency reasons and never confirms or writes', async t => {
    const {w,d,calls,confirmations} = setup(t);
    w.api = async (method,url,body) => {calls.push({method,url,body});return preview({blocked:[{stage_key:'open',reasons:[{kind:'notes',label:'仍有阶段备注'}]}]});};
    await w.saveProjectInfo({syncMethodFlow:true}); assert.deepEqual(calls.map(c => c.method),['POST']); assert.equal(confirmations.length,0);
    const error = d.getElementById('infoSaveError'); assert.ok(error); assert.equal(error.hidden,false); assert.match(error.textContent,/旧开标阶段.*仍有阶段备注/);
});
for (const during of ['preview','confirmation']) {
    for (const movement of ['edit','revert','project','tab','rerender']) {
        test(`${movement} during ${during} prevents an old preview from submitting`, async t => {
            const {w,d,p,calls} = setup(t), gate = deferred(), confirming = deferred();
            if (during==='preview') w.api = (method,url,body) => {calls.push({method,url,body});return gate.promise;};
            else w.confirmDialog = () => {confirming.resolve(); return gate.promise;};
            const pending = w.saveProjectInfo({syncMethodFlow:true});
            if (during==='confirmation') await confirming.promise;
            if (movement==='edit' || movement==='revert') {change(d,w,'infoName','新草稿');if (movement==='revert') change(d,w,'infoName',p.name);}
            else if (movement==='project') w.seedSync({...p,id:2});
            else if (movement==='tab') w.syncRun('projectNavigationVersion++');
            else w.renderInfo();
            gate.resolve(during==='preview'?preview():true); await pending;
            assert.equal(calls.filter(c=>c.method==='PUT').length,0);
            if (movement==='edit') assert.equal(d.getElementById('infoName').value,'新草稿');
        });
    }
}
test('concurrent save gestures share one preview and one write and restore save controls', async t => {
    const {w,d,calls} = setup(t), gate = deferred();
    w.api = (method,url,body) => {calls.push({method,url,body});return method==='POST'?gate.promise:Promise.resolve({record_version:'project-v2'});};
    const first = w.saveProjectInfo({syncMethodFlow:true}), second = w.saveProjectInfo();
    assert.equal(calls.length,1); gate.resolve(preview()); await Promise.all([first,second]);
    assert.deepEqual(calls.map(c=>c.method),['POST','PUT']); assert.equal(d.querySelector('[data-project-info-save]').disabled,false);
});
for (const status of [403,409,500]) test(`write failure ${status} keeps the draft and never blindly repeats a mutation`, async t => {
    const {w,d,calls} = setup(t); change(d,w,'infoNotes','错误后保留');
    w.api = async (method,url,body) => {calls.push({method,url,body});if(method==='POST')return preview();throw Object.assign(new Error(status===409?'流程已变化，请重新预览':'保存失败'),{status,details:{code:status===409?'FLOW_CHANGED':'DENIED'}});};
    await w.saveProjectInfo({syncMethodFlow:true}); assert.deepEqual(calls.map(c=>c.method),['POST','PUT']);
    assert.equal(d.getElementById('infoNotes').value,'错误后保留'); assert.equal(d.getElementById('infoSaveError').hidden,false);
});
test('edits typed after the PUT retain their draft without refreshing the page', async t => {
    const {w,d} = setup(t), gate = deferred(); let refreshed = 0; w.refreshProject=async()=>refreshed++;
    w.api=()=>gate.promise; const pending=w.saveProjectInfo();change(d,w,'infoNotes','提交后新输入');gate.resolve({record_version:'project-v2'});await pending;
    assert.equal(refreshed,0);assert.equal(d.getElementById('infoNotes').value,'提交后新输入');assert.equal(w.syncRun('projectInfoDrafts.get(1).infoNotes'),'提交后新输入');
});
test('save completion respects newly read-only access and an authorization refresh can restore controls', async t => {
    const {w,d} = setup(t); const gate = deferred();
    w.api=()=>gate.promise;const pending=w.saveProjectInfo();w.syncApplicationAccess({mode:'read_only'});
    gate.resolve({record_version:'project-v2'});await pending;
    assert.ok([...d.querySelectorAll('[data-project-info-save]')].every(button=>button.disabled));
    w.syncApplicationAccess({mode:'full'});assert.ok([...d.querySelectorAll('[data-project-info-save]')].every(button=>!button.disabled));
});
test('a 423 failure cannot re-enable save controls and initially disabled controls stay disabled', async t => {
    const {w,d} = setup(t);const button=d.querySelector('[data-project-info-save]');button.disabled=true;
    w.api=async()=>{w.syncApplicationAccess({mode:'read_only'});throw Object.assign(new Error('授权只读'),{status:423});};
    await w.saveProjectInfo();assert.ok([...d.querySelectorAll('[data-project-info-save]')].every(node=>node.disabled));
    w.syncApplicationAccess({mode:'full'});assert.equal(button.disabled,true);
});
test('a delayed method preview has visible loading feedback and clears it after cancellation', async t => {
    const {w,d} = setup(t), gate=deferred();w.api=()=>gate.promise;w.confirmDialog=async()=>false;
    const pending=w.saveProjectInfo({syncMethodFlow:true});const status=d.getElementById('infoSaveStatus');assert.ok(status);assert.equal(status.hidden,false);assert.match(status.textContent,/预览/);
    gate.resolve(preview());await pending;assert.equal(status.hidden,true);
});
test('timeline and tasks show archived completion and manual skip history as escaped read-only rows with dates', t => {
    const {w,d,p} = setup(t);
    p.stages.push({key:'old_done',name:'旧阶段<img src=x onerror=alert(1)>',icon:'<svg onload=alert(1)>',template_removed:true,completed:true,completed_at:'2026-10-21T09:40:00',planned_at:'2026-10-20',notes:'<script>wrong()</script>'},
        {key:'old_skip',name:'旧开标',template_removed:true,skipped:true,completed_date:'2026-10-22',notes:'人工跳过'},
        {key:'old_pending',name:'不应出现的未完成历史',template_removed:true});
    for (const [render,id] of [['renderTimeline','timelineContent'],['renderTasks','tasksContent']]) {
        w[render]();const history=d.getElementById(id).querySelector('[data-method-flow-history]'); assert.ok(history);
        assert.match(history.textContent,/只读/);assert.match(history.textContent,/旧开标.*已跳过/s);assert.match(history.textContent,/2026-10-21.*09:40/s);assert.match(history.textContent,/2026-10-22/);
        assert.match(history.textContent,/旧阶段<img/);assert.match(history.textContent,/<script>wrong/);assert.doesNotMatch(history.textContent,/不应出现的未完成历史/);
        assert.equal(history.querySelectorAll('button,input,select,textarea,[onclick],script,img,svg').length,0);
    }
});

test('method sync confirmation and read-only history support four themes, keyboard and phone widths', {timeout:60000}, async () => {
    const {chromium} = require('playwright');
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless:true, ...(fs.existsSync(edge) ? {executablePath:edge} : {})});
    const cleanHtml = html.replace(/<link\b[^>]*>/g, '');
    const css = fs.readFileSync(path.join(root, 'src/static/style.css'), 'utf8').replace(/^\uFEFF/, '');
    const browserSource = fs.readFileSync(path.join(root, 'source/frontend/00-icons.js'), 'utf8') + '\n' + source
        + '\n' + fs.readFileSync(path.join(root, 'source/frontend/09-command-center.js'), 'utf8');
    const output = process.env.PM_METHOD_FLOW_UI_OUTPUT;
    if (output) fs.mkdirSync(output, {recursive:true});
    const results = [];
    try {
        for (const theme of ['default', 'blue', 'green', 'dark']) for (const width of [1366, 375]) {
            const page = await browser.newPage({viewport:{width, height:900}, reducedMotion:'reduce'});
            page.setDefaultTimeout(5000);
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.setContent(cleanHtml);
            await page.addStyleTag({content:css});
            await page.addScriptTag({content:browserSource});
            await page.evaluate(({theme, result}) => {
                document.documentElement.dataset.theme = theme;
                document.querySelectorAll('.view,.project-tab').forEach(el => el.classList.remove('active'));
                document.getElementById('view-project').classList.add('active');
                document.getElementById('tab-info').classList.add('active');
                currentProject = {id:1, name:'合成流程同步项目', number:'SYN-001', method:'合成竞价', procurement:{method_id:'online'},
                    record_version:'v1', year:2026, lots:[], progress:0, stages:[{key:'start', name:'保留阶段', modules:['common']},
                        {key:'open', name:'旧开标', icon:'📦', template_removed:true, skipped:true, completed_date:'2026-10-22', notes:'人工跳过'}]};
                allProjects = [currentProject];
                systemSettings = {procurement_catalog:{methods:[{id:'online', name:'合成竞价', enabled:true}]}};
                window.syncCalls = [];
                api = async (method, url, body) => {syncCalls.push({method, url, body}); return method === 'POST' ? result : {...currentProject, record_version:'v2'};};
                toast = () => {}; refreshProject = async () => {}; renderInfo(); PMIcons.render(document.body);
            }, {theme, result:preview()});
            await page.getByRole('button', {name:'同步所选方式流程', exact:true}).click();
            await page.locator('#confirmDialog.open').waitFor();
            const bounds = await page.locator('#confirmDialog').evaluate(el => {const r = el.getBoundingClientRect(); return {left:r.left, right:r.right, top:r.top, bottom:r.bottom};});
            assert.ok(bounds.left >= 0 && bounds.right <= width && bounds.top >= 0 && bounds.bottom <= 900, `${theme} ${width} dialog bounds`);
            assert.match(await page.locator('#confirmMsg').textContent(), /人工跳过/);
            if (output && ((theme === 'default' && width === 1366) || (theme === 'dark' && width === 375)))
                await page.screenshot({path:path.join(output, `${theme}-${width}-confirm.png`), fullPage:true});
            await page.locator('#confirmCancel').click();
            await page.waitForFunction(() => !document.querySelector('[data-project-info-save]').disabled);
            assert.equal(await page.evaluate(() => syncCalls.filter(call => call.method === 'PUT').length), 0);
            await page.getByRole('button', {name:'同步所选方式流程', exact:true}).click();
            await page.locator('#confirmDialog.open').waitFor();
            await page.locator('#confirmOk').focus(); await page.keyboard.press('Enter');
            await page.waitForFunction(() => syncCalls.some(call => call.method === 'PUT'));
            assert.equal(await page.evaluate(() => syncCalls.find(call => call.method === 'PUT').body.method_flow_fingerprint), 'checked-flow');
            await page.evaluate(() => {
                document.getElementById('tab-info').classList.remove('active');document.getElementById('tab-tasks').classList.add('active');
                renderTasks();PMIcons.render(document.body);
                document.getAnimations().forEach(animation => {try {animation.finish();} catch (_) {}});
            });
            assert.equal(await page.locator('[data-method-flow-history] button').count(), 0);
            assert.match(await page.locator('[data-method-flow-history]').textContent(), /2026-10-22.*人工跳过/s);
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${theme} ${width} page overflow`);
            assert.deepEqual(errors, []);
            if (output && theme === 'dark' && width === 375) await page.screenshot({path:path.join(output, 'dark-375-history.png'), fullPage:true});
            results.push({theme, width, confirmedWithKeyboard:true, cancelledWithoutWrite:true, historyReadOnly:true, noPageOverflow:true});
            await page.close();
        }
        if (output) fs.writeFileSync(path.join(output, 'browser-result.json'), JSON.stringify(results, null, 2));
    } finally {await browser.close();}
});
