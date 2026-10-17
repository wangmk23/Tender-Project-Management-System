'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const acorn = require('acorn');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const core = read('source/frontend/01-core.js');
const projects = read('source/frontend/02-projects.js');
const workspace = read('src/templates/workspace.html');
function definitions(source, names) {
    const nodes = acorn.parse(source, {ecmaVersion:'latest'}).body;
    return names.map(name => {
        const node = nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === name);
        assert.ok(node, `expected ${name} to implement the reviewed behavior`);
        return source.slice(node.start, node.end);
    }).join('\n');
}
function page() {
    const dom = new JSDOM(workspace, {runScripts:'outside-only', url:'http://127.0.0.1/'});
    dom.window.projectNavigationVersion = 0;
    dom.window.renderedTabs = [];
    dom.window.ensureProjectTabRendered = name => dom.window.renderedTabs.push(name);
    return dom;
}

test('project tabs expose named native controls and linked content panels', () => {
    const dom = page(), d = dom.window.document;
    try {
        assert.equal(d.getElementById('projectTabs').getAttribute('role'), 'tablist');
        for (const tab of d.querySelectorAll('#projectTabs .tab')) {
            assert.equal(tab.tagName, 'BUTTON');
            assert.equal(tab.getAttribute('role'), 'tab');
            const panel = d.getElementById(tab.getAttribute('aria-controls'));
            assert.ok(panel);
            assert.equal(panel.getAttribute('aria-labelledby'), tab.id);
        }
    } finally { dom.window.close(); }
});

test('project tab arrow, Home and End keys switch and focus the matching tab only once', () => {
    const dom = page(), w = dom.window, d = w.document;
    try {
        if(!w.procurementSelectOptions)w.eval(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));w.eval(fs.readFileSync(require('node:path').join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));if(!w.procurementSelectOptions)w.eval(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));w.eval(definitions(core, ['switchProjectTab','handleProjectTabKeydown','installProjectTabKeyboard']));
        w.installProjectTabKeyboard();w.installProjectTabKeyboard();
        const keys = ['ArrowRight','End','ArrowLeft','Home','ArrowLeft'];
        const expected = ['timeline','attachments','info','board','attachments'];
        d.querySelector('#projectTabs .tab').focus();
        for (let i=0;i<keys.length;i++) {
            d.activeElement.dispatchEvent(new w.KeyboardEvent('keydown',{key:keys[i],bubbles:true,cancelable:true}));
            assert.equal(d.activeElement.dataset.tab, expected[i]);
            assert.equal(d.querySelector('#projectTabs [aria-selected="true"]').dataset.tab, expected[i]);
            assert.equal(d.querySelectorAll('#projectTabs [tabindex="0"]').length,1);
        }
        assert.deepEqual(Array.from(w.renderedTabs),expected);
        assert.equal(w.switchProjectTab('nonexistent'),false,'invalid tab must preserve the active view');
    } finally { w.close(); }
});

test('modal custom action names survive pending saves and validation failure', async () => {
    const dom = page(), w = dom.window, d = w.document;
    try {
        w.activateDialogFocus=()=>{};w.toast=()=>{};w.closeModal=()=>{};
        if(!w.procurementSelectOptions)w.eval(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));w.eval(definitions(core,['resetModalState','showModal']));
        let resolve;
        w.showModal('登记退款','<p>全额退还</p>',()=>new Promise(done=>resolve=done),{saveLabel:'确认已全额退还',busyLabel:'登记中…'});
        const button=d.getElementById('modalSaveBtn');
        assert.equal(button.textContent,'确认已全额退还');
        const pending=button.onclick();
        assert.equal(button.disabled,true);assert.equal(button.textContent,'登记中…');
        resolve(false);await pending;
        assert.equal(button.disabled,false);assert.equal(button.textContent,'确认已全额退还');
        assert.equal(button.hasAttribute('aria-busy'),false);
    } finally {w.close();}
});

test('board keeps one current-action summary and exposes compact batch disclosure plus explicit stage buttons', () => {
    const dom=page(),w=dom.window,d=w.document;
    try {
        if(!w.procurementSelectOptions)w.eval(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));w.eval(definitions(core,['escHtml','stageKeyToken','stageKeyFromToken']));
        if(!w.procurementSelectOptions)w.eval(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));w.eval(definitions(projects,['renderBoard']));
        w.currentProject={current_stage_key:'review',stages:[{key:'review',name:'审核 <文件>',completed:false},{key:'done',name:'接收',completed:true}]};
        w.orderProjectStages=stages=>stages;
        w.stageTiming=()=>({cls:'',label:''});w.stageHasModule=()=>false;
        w.plannedDate=()=>'';w.challengeBadgeHtml=()=>'';w.stageCardSummary=()=>'';
        w.projectStageDefinition=s=>({name:s.name,icon:'📁'});
        w.renderBoard();
        assert.equal(d.querySelectorAll('.current-stage-card').length,0,'the current-action strip owns the full summary');
        const batch=d.querySelector('details.board-tools');assert.ok(batch);assert.equal(batch.open,false);
        assert.match(batch.querySelector('summary').textContent,/批量操作/);
        const open=d.querySelector('.task-open-btn');assert.ok(open);assert.equal(open.tagName,'BUTTON');
        assert.match(open.getAttribute('aria-label'),/审核 <文件>/);
        assert.equal(d.querySelector('[data-board-state="active"]').querySelectorAll('.task-open-btn').length,1);
        assert.equal(d.querySelectorAll('.batch-cb').length,1);
    } finally {w.close();}
});

test('project no-deposit checkbox and its row each save one intentional change', () => {
    const dom = new JSDOM('<div id="infoContent"></div>',{runScripts:'dangerously',url:'http://127.0.0.1/'});
    const w=dom.window,d=w.document, saved=[];
    try {
        const workflow=read('source/frontend/04-project-workflow.js');
        if(!w.procurementSelectOptions)w.eval(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));w.eval(definitions(core,['escHtml']));
        if(!w.procurementSelectOptions)w.eval(fs.readFileSync(path.join(__dirname,'../source/frontend/22-procurement-methods.js'),'utf8'));w.eval(definitions(workflow,['renderInfo','toggleDepositRow']));
        w.currentProject={id:1,name:'采购项目',number:'SIM-1',purchaser:'采购人',method:'公开招标',lots:[]};
        w.METHODS=['公开招标'];w.projectInfoDrafts=new Map();w.projectInfoFieldIds=[];
        w.captureProjectInfoDraft=()=>{};w.readProjectInfoValues=()=>({});
        w.saveNoDeposit=()=>saved.push(d.getElementById('infoNoDeposit').checked);
        w.renderInfo();
        const checkbox=d.getElementById('infoNoDeposit');
        checkbox.click();
        assert.equal(checkbox.checked,true);
        assert.deepEqual(saved,[true]);
        d.querySelector('.toggle-label').click();
        assert.equal(checkbox.checked,false);
        assert.deepEqual(saved,[true,false]);
    } finally {w.close();}
});

test('stage sheet immediately accepts keyboard focus in normal and reduced motion', async () => {
    const {chromium}=require('playwright');
    const edge=process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
    try {
        for (const reducedMotion of ['reduce','no-preference']) {
            const p=await browser.newPage({reducedMotion});
            await p.setContent('<style>'+read('src/static/style.css')+'</style><button id="trigger">处理阶段</button><div id="slideBackdrop"></div><section id="slidePanel" class="slide-panel"><header><h2 id="slideTitle"></h2><button id="close">关闭</button></header><div id="slideBody"></div></section>');
            await p.addScriptTag({content:'const dialogFocusStack=[];let dialogFocusListenersReady=false;'+definitions(core,['topManagedDialog','dialogControls','focusDialogStart','handleDialogFocus','activateDialogFocus','openSlide','closeSlide'])});
            const result=await p.evaluate(()=>{document.getElementById('trigger').focus();openSlide('编辑阶段','<label for="owner">负责人</label><input id="owner">');const sheet=document.getElementById('slidePanel');return {inside:sheet.contains(document.activeElement),visible:getComputedStyle(sheet).visibility};});
            assert.equal(result.visible,'visible',reducedMotion);assert.equal(result.inside,true,reducedMotion);
            await p.keyboard.press('Tab');
            assert.equal(await p.locator('#slidePanel').evaluate(e=>e.contains(document.activeElement)),true);
            await p.close();
        }
    } finally {await browser.close();}
});
