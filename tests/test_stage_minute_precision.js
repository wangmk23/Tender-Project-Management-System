'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const {JSDOM} = require(process.env.PM_JSDOM_MODULE || 'jsdom');

function harness(stage = {}) {
    const dom = new JSDOM('<div id="slideOverlay"></div><div id="slidePanel"><div id="slideTitle"></div><div id="slideBody"></div></div><div id="modalOverlay"></div><div id="modal"><div id="modalTitle"></div><div id="modalBody"></div><div id="modalFooter"></div></div><div id="boardContent"></div><div id="timelineContent"></div><div id="tasksContent"></div>');
    const document = dom.window.document;
    const context = {window:dom.window, document, console, setTimeout, clearTimeout,
        getComputedStyle:dom.window.getComputedStyle.bind(dom.window), cleanupChartBoardLifecycle(){},
        focusSafely(){return false;}, focusFallback(){}};
    vm.createContext(context);require('./install_procurement_contract.cjs')(context);
    for (const file of ['01-core.js','02-projects.js','04-project-workflow.js','11-stage-settings.js']) {
        vm.runInContext(fs.readFileSync(path.join(__dirname,'../source/frontend',file),'utf8'),context);
    }
    const calls = [], messages = [];
    context.api = async (method,url,payload) => {calls.push({method,url,payload}); return {};};
    context.toast = (message) => messages.push(message);
    context.openSlide = (_title, html) => {document.getElementById('slideBody').innerHTML = html;};
    context.showModal = (_title, html) => {document.getElementById('modalBody').innerHTML = html;};
    context.closeModal = () => {};
    context.refreshProject = async () => {};
    vm.runInContext('currentProject={id:1,method:"公开招标",is_terminated:false,progress:50,current_stage_key:"custom",stages:[],registrations:[],lots:[],bid_results:[],complaints:[]};',context);
    context.stage = {key:'custom',name:'虚构阶段',icon:'•',modules:['common'],completed:false,skipped:false,notes:'',...stage};
    vm.runInContext('currentProject.stages=[stage]',context);
    return {context, document, calls, messages};
}

test('every stage editor exposes separate date and minute controls with existing precision', () => {
    const {context,document}=harness({completed:true,completed_date:'2026-10-12',completed_at:'2026-10-12T14:37',planned_at:'2026-10-13T09:28:00'});
    context.openStageSlide('custom');
    assert.equal(document.getElementById('stageCompletedTime')?.value,'14:37');
    assert.equal(document.getElementById('stageCompletedTime')?.step,'60');
    assert.equal(document.getElementById('stagePlannedAt')?.value,'2026-10-13');
    assert.equal(document.getElementById('stagePlannedTime')?.value,'09:28');
});

test('historical date-only completion saves notes without fabricating midnight', async () => {
    const {context,document,calls}=harness({completed:true,completed_date:'2026-10-10',completed_at:null,planned_at:null});
    context.openStageSlide('custom');
    assert.equal(document.getElementById('stageCompletedTime')?.value,'');
    document.getElementById('stageNotes').value='仅备注';
    await context.saveStageFromSlide();
    assert.equal(calls[0].payload.completed_date,'2026-10-10');
    assert.equal(calls[0].payload.completed_at,null);
});

test('notes and responsible-person edits preserve untouched planned seconds and fractions', async () => {
    const original='2026-10-13T09:28:02.123';
    const {context,document,calls}=harness({modules:['common','responsible_person'],planned_at:original});
    context.openStageSlide('custom');
    document.getElementById('stageNotes').value='仅改备注';
    document.getElementById('stageResponsiblePerson').value='虚构负责人';
    await context.saveStageFromSlide();
    assert.equal(calls[0].payload.planned_at,original);
    document.getElementById('stagePlannedTime').value='09:29';
    await context.saveStageFromSlide();
    assert.equal(calls[1].payload.planned_at,'2026-10-13T09:29');
});

test('batch plan save preserves existing seconds when date and minute are unchanged', async () => {
    const original='2026-10-13T09:28:02.123';
    const {context,calls}=harness({planned_at:original});
    await context.batchSetPlannedDate();
    context.showLoading=()=>{};context.hideLoading=()=>{};
    await context.doBatchSetDateV2();
    assert.equal(calls[0].payload.planned_at,original);
});

test('saved edit sends local date and minute values for all modules', async () => {
    const {context,document,calls}=harness();
    context.openStageSlide('custom');
    document.getElementById('stageCompleted').checked=true;
    document.getElementById('stageCompletedDate').value='2026-10-12';
    assert.ok(document.getElementById('stageCompletedTime'),'completion minute input must exist');
    document.getElementById('stageCompletedTime').value='14:37';
    document.getElementById('stagePlannedAt').value='2026-10-13';
    document.getElementById('stagePlannedTime').value='09:28';
    await context.saveStageFromSlide();
    assert.equal(calls[0].payload.completed_at,'2026-10-12T14:37');
    assert.equal(calls[0].payload.planned_at,'2026-10-13T09:28');
});

test('time without a date prevents writing other edited fields', async () => {
    const {context,document,calls}=harness();
    context.openStageSlide('custom');
    assert.ok(document.getElementById('stagePlannedTime'),'planning minute input must exist');
    document.getElementById('stagePlannedTime').value='09:28';
    document.getElementById('stageNotes').value='不得保存';
    assert.equal(await context.saveStageFromSlide(),false);
    assert.equal(calls.length,0);
});

test('quick completion uses chosen minute instead of date only', async () => {
    const {context,document,calls}=harness();
    context.completeStage('custom');
    assert.ok(document.getElementById('completeTime'),'quick completion minute input must exist');
    document.getElementById('completeDate').value='2026-10-12';
    document.getElementById('completeTime').value='14:37';
    await context.doCompleteStage('custom');
    assert.equal(calls[0].payload.completed_at,'2026-10-12T14:37');
});

test('board progress and task table show completion and planned minutes', () => {
    const {context,document}=harness({completed:true,completed_date:'2026-10-12',completed_at:'2026-10-12T14:37',planned_at:'2026-10-13T09:28'});
    context.stageCardSummary=()=>'';
    context.challengeBadgeHtml=()=>'';
    context.challengeStateOf=()=>null;
    context.renderBoard();context.renderTimeline();context.renderTasks();
    for(const id of ['boardContent','timelineContent','tasksContent'])assert.match(document.getElementById(id).textContent,/14:37/);
    assert.match(document.getElementById('tasksContent').textContent,/09:28/);
});

test('batch plan editor preserves date-only history and offers minutes for every stage', async () => {
    const {context,document}=harness({planned_at:'2026-10-13T09:28'});
    await context.batchSetPlannedDate();
    assert.equal(document.querySelector('.bd-at')?.value,'2026-10-13');
    assert.equal(document.querySelector('.bd-time')?.value,'09:28');
    assert.equal(document.querySelector('.bd-time')?.step,'60');
});

test('batch planning fills chosen default time and submits a precise schedule', async () => {
    const {context,document,calls}=harness({planned_at:null});
    await context.batchSetPlannedDate();
    document.getElementById('batchStartDate').value='2026-10-13';
    document.getElementById('batchStartTime').value='08:42';
    context.showLoading=()=>{};context.hideLoading=()=>{};
    context.fillBatchDates();
    assert.equal(document.querySelector('.bd-at').value,'2026-10-13');
    assert.equal(document.querySelector('.bd-time').value,'08:42');
    await context.doBatchSetDateV2();
    assert.equal(calls[0].payload.planned_at,'2026-10-13T08:42');
});

test('cross-project batch dialog provides one minute input and posts selected minute', async () => {
    const {context,document,calls}=harness();
    document.body.insertAdjacentHTML('beforeend', '<div id="batchAdvanceOverlay"></div><div id="batchAdvanceDialog"><div class="modal-header"><h3>批量推进</h3></div><div><div><button id="baModeStage"></button><button id="baModeProject"></button></div><label>采购方式</label><select id="batchMethodSelect"><option value="公开招标">公开招标</option></select><label>阶段</label><select id="batchStageSelect"><option value="custom">虚构阶段</option></select><label>项目</label><select id="batchProjectSelect"></select><label>完成日期</label><input id="batchDateInput" type="date"><div><label id="baListLabel"></label></div><div id="batchAdvanceCount"></div><input class="ba-cb" type="checkbox" value="1" checked><div><button id="batchAdvanceCancel"></button><button id="batchAdvanceOk"></button></div></div></div>');
    context.prepareBatchAdvanceDialog();context.prepareBatchAdvanceDialog();
    assert.equal(document.querySelectorAll('#batchTimeInput').length,1);
    assert.equal(document.getElementById('batchTimeInput').step,'60');
    document.getElementById('batchDateInput').value='2026-10-12';
    document.getElementById('batchTimeInput').value='14:37';
    context.confirmDialog=async()=>true;context.showLoading=()=>{};context.hideLoading=()=>{};
    context.loadAllProjects=async()=>{};context.loadDashboard=async()=>{};context.closeBatchAdvanceDialog=()=>{};
    await context.doBatchAdvance();
    assert.equal(calls[0].url,'/api/batch/advance-stage');
    assert.equal(calls[0].payload.completed_at,'2026-10-12T14:37');
    assert.equal(calls[0].payload.completed_date,'2026-10-12');
});

test('loading feedback clears on success, rejected response and request failure', async () => {
    for (const outcome of ['success','rejected','failure']) {
        const {context}=harness();
        let dismissals=0, loadingType='';
        context.toast=(_message,type)=>{if(type==='loading'){loadingType=type;return()=>{dismissals++;};}};
        context.promoteProjectPrefetch=()=>{};context.renderProjectDetail=()=>{};
        context.switchView=()=>{};
        context.requestProjectDetail=async()=>{if(outcome==='failure')throw new Error('synthetic offline');return {accepted:outcome==='success',project:{id:2}};};
        await context.selectProject(2);
        assert.equal(loadingType,'loading');assert.equal(dismissals,1);
    }
});
