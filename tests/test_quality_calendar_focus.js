'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), acorn = require('acorn');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, 'source/frontend', name), 'utf8');
function definitions(source, names) {
    const nodes = acorn.parse(source, {ecmaVersion: 'latest'}).body;
    return names.map(name => { const node = nodes.find(n => n.type === 'FunctionDeclaration' && n.id.name === name); assert.ok(node, name); return source.slice(node.start, node.end); }).join('\n');
}

test('real stage editor keeps initial focus, traps Tab, closes with Escape and returns to its trigger', async () => {
    const {chromium} = require('playwright');
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    try {
        for (const theme of ['default', 'dark', 'blue', 'green']) for (const width of [390, 1366]) {
            const page = await browser.newPage({viewport: {width, height: 900}});
            await page.setContent(`<style>${fs.readFileSync(path.join(root, 'src/static/style.css'), 'utf8')}</style><button id="trigger" onclick="openStageSlide('custom')">处理阶段</button><div id="slideBackdrop"></div><section id="slidePanel" class="slide-panel"><header><h2 id="slideTitle"></h2><button onclick="closeSlide()">关闭</button></header><div id="slideBody"></div></section>`);
            await page.addScriptTag({content: `const dialogFocusStack=[];let dialogFocusListenersReady=false;let editingStageKey=null;
                ${definitions(read('01-core.js'), ['topManagedDialog','dialogControls','focusDialogStart','handleDialogFocus','activateDialogFocus','releaseDialogFocus','openSlide','closeSlide','escHtml'])}
                ${definitions(read('09-command-center.js'), ['focusSafely','focusFallback'])}
                ${definitions(read('04-project-workflow.js'), ['openStageSlide'])}
                ${definitions(read('02-projects.js'), ['stageTimestampParts'])}
                window.currentProject={id:1,method:'自定义',stages:[{key:'custom',name:'自定义阶段',icon:'📋',notes:''}]};
                window.stageHasModule=()=>false;window.projectStageDefinition=s=>s;window.isOnlineProcurementProject=()=>false;`});
            await page.addScriptTag({content: read('17-datetime-picker.js')});
            await page.addScriptTag({content: read('20-form-accessibility.js')});
            await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
            await page.locator('#trigger').focus(); await page.keyboard.press('Enter');
            await page.waitForFunction(() => document.querySelector('.pm-datetime-trigger'));
            const state = await page.evaluate(() => ({active: document.activeElement.outerHTML.slice(0,200), controls:dialogControls(document.getElementById('slidePanel')).map(el=>[el.id,el.tagName,Boolean(el.closest('details:not([open])'))])}));
            assert.equal(await page.locator('#slidePanel').evaluate(el => el.contains(document.activeElement)), true, `${theme}/${width} initial focus ${JSON.stringify(state)}`);
            await page.keyboard.press('Shift+Tab');
            assert.equal(await page.locator('#slidePanel').evaluate(el => el.contains(document.activeElement)), true);
            await page.locator('#slidePanel .stage-editor-actions button').focus(); await page.keyboard.press('Tab');
            assert.equal(await page.locator('#slidePanel').evaluate(el => el.contains(document.activeElement)), true);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#slidePanel').evaluate(el => el.classList.contains('open')), false);
            assert.equal(await page.evaluate(() => document.activeElement.id), 'trigger');
            await page.close();
        }
    } finally { await browser.close(); }
});

test('empty planned times stay quiet and repeated malformed times produce bounded diagnostics', () => {
    const warnings = [], context = vm.createContext({console: {warn: message => warnings.push(message)}});
    vm.runInContext(read('09-command-center.js'), context);
    const project = {id: 1, stages: [{key:'empty'}, {key:'null',planned_at:null}, {key:'blank',planned_at:'   '}]};
    for (let i=0;i<100;i++) context.collectKeyNodes([project]);
    assert.equal(warnings.length, 0, 'no plan is a valid business state');
    project.stages = [{key:'bad', planned_at:'not-a-date'}];
    for (let i=0;i<100;i++) context.collectKeyNodes([project]);
    assert.equal(warnings.length, 1, 'same bad stage/value is diagnosed once');
    assert.match(warnings[0], /not-a-date/);
    for(let i=0;i<200;i++) context.collectKeyNodes([{id:i,stages:[{key:'bad',planned_at:`bad-${i}`}]}]);
    assert.ok(warnings.length <= 21, 'many distinct malformed values cannot flood the console');
});

function calendarHarness() {
    const {JSDOM} = require('jsdom');
    const dom = new JSDOM('<main id="agenda"></main><div id="slideBackdrop"></div><section id="slidePanel"><h2 id="slideTitle"></h2><div id="slideBody"></div></section>', {runScripts:'dangerously'});
    const w = dom.window, pending = [], notices = [];
    Object.assign(w, {currentProject:null, projectSelectionVersion:0, projectNavigationVersion:0, projectEditVersion:0,
        projectDetailCache:new Map(), allProjects:[], editingStageKey:null, promoteProjectPrefetch(){},
        requestProjectDetail(id){return new Promise((resolve,reject)=>pending.push({id,resolve,reject}));},
        renderProjectDetail(project){w.currentProject=project;}, showViewLoading(){}, switchView(name){w.currentView=name;},
        toast(message,type){notices.push({message,type});}, isEditingApplicationForm:()=>false,
        stageHasModule:()=>false, projectStageDefinition:s=>typeof s==='object'?s:{name:s},
        isOnlineProcurementProject:()=>false, activateDialogFocus(){}, releaseDialogFocus(){}, console:{error(){}},
    });
    w.eval(definitions(read('01-core.js'), ['escHtml','openSlide','closeSlide']));
    w.eval(definitions(read('02-projects.js'), ['selectProject','stageTimestampParts']));
    w.eval(definitions(read('04-project-workflow.js'), ['openStageSlide']));
    w.eval(read('05-views.js'));
    return {dom,w,pending,notices};
}

test('calendar ordinary event awaits project loading and opens the exact key including custom characters', async () => {
    const {dom,w,pending,notices} = calendarHarness();
    try {
        const key = '历史审核\'中文';
        w.document.getElementById('agenda').innerHTML=w.calendarAgendaHtml('2026-10-19',[{project_id:2,stage_key:key,stage_name:'历史审核'}]);
        w.document.querySelector('.calendar-agenda-item').click();
        assert.equal(w.document.getElementById('slidePanel').classList.contains('open'),false,'wait for fresh project data');
        assert.equal(pending[0].id,2);
        pending[0].resolve({accepted:true,project:{id:2,stages:[{key,name:'历史审核',completed:true,notes:''}]}});
        await new Promise(resolve=>setImmediate(resolve));
        assert.equal(w.document.getElementById('slidePanel').classList.contains('open'),true);
        assert.equal(w.editingStageKey,key);
        assert.equal(w.document.getElementById('stageCompleted').checked,true);
        const again=w.openCalendarStage(2,key);
        pending[1].resolve({accepted:true,project:{id:2,stages:[{key,name:'历史审核',notes:''}]}});
        assert.equal(await again,true,'current project also opens its precise stage: '+JSON.stringify(notices));
    } finally {dom.window.close();}
});

test('calendar failed load remains retryable and stale, deleted and disabled stage events cannot edit another stage', async () => {
    const {dom,w,pending,notices} = calendarHarness();
    try {
        w.allProjects=[{id:2}];w.currentView='calendar';
        const failed=w.openCalendarStage(2,'wanted'); pending[0].reject(new Error('offline'));
        assert.equal(await failed,false);
        assert.equal(w.currentView,'calendar','failed load keeps the calendar retry entry visible');
        const retry=w.openCalendarStage(2,'wanted'); pending[1].resolve({accepted:true,project:{id:2,stages:[{key:'wanted',name:'审核',notes:''}]}});
        assert.equal(await retry,true,JSON.stringify(notices));
        for(const stage of [null,{key:'wanted',deleted:true},{key:'wanted',disabled:true},{key:'wanted',template_removed:true,completed:true,notes:'保留历史说明'}]) {
            w.document.getElementById('slidePanel').classList.remove('open');
            w.document.getElementById('slideBody').innerHTML='';
            const result=w.openCalendarStage(3,'wanted'); pending.at(-1).resolve({accepted:true,project:{id:3,stages:stage?[stage]:[]}});
            await result;
            assert.equal(w.document.querySelector('#stageCompleted'),null,'unavailable stages never get an editable form');
            if(stage?.template_removed) assert.match(w.document.getElementById('slideBody').textContent,/保留历史说明/);
        }
        assert.ok(notices.length>=3,'unavailable destinations have visible feedback');
        const first=w.openCalendarStage(4,'first'),second=w.openCalendarStage(5,'second');
        pending.at(-1).resolve({accepted:true,project:{id:5,stages:[{key:'second',name:'第二阶段',notes:''}]}}); await second;
        pending.at(-2).resolve({accepted:true,project:{id:4,stages:[{key:'first',name:'第一阶段',notes:''}]}}); await first;
        assert.equal(w.currentProject.id,5); assert.equal(w.editingStageKey,'second');
    } finally {dom.window.close();}
});

test('calendar preserves supplier guarantee and business deadline destinations and rejects missing project IDs', () => {
    const {dom,w} = calendarHarness();
    try {
        const routed=[];w.openCalendarGuarantee=(...args)=>routed.push(['guarantee',...args]);w.showBusinessDeadlines=(...args)=>routed.push(['deadline',...args]);
        w.document.getElementById('agenda').innerHTML=w.calendarAgendaHtml('2026-10-19',[
            {kind:'deposit_refund',project_id:2,registration_id:17,guarantee_action:'review'},
            {kind:'business_deadline',project_id:3,stage_key:'review',deadline_item_id:'item-4'},
            {stage_key:'orphan'}, {project_id:null,stage_key:'orphan'}, {project_id:0,stage_key:'orphan'},
        ]);
        const buttons=w.document.querySelectorAll('.calendar-agenda-item');buttons[0].click();buttons[1].click();
        assert.deepEqual(routed,[['guarantee',2,17,'review'],['deadline',3,'review','item-4']]);
        for(const button of [...buttons].slice(2))assert.equal(button.disabled,true);
    } finally {dom.window.close();}
});
