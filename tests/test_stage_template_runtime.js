'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'source', 'frontend', '01-core.js'), 'utf8');
const workflow = fs.readFileSync(path.join(root, 'source', 'frontend', '04-project-workflow.js'), 'utf8');
const projects = fs.readFileSync(path.join(root, 'source', 'frontend', '02-projects.js'), 'utf8');
const business = fs.readFileSync(path.join(root, 'source', 'frontend', '07-business.js'), 'utf8');

function extractFunction(source, name) {
    const functionStart = source.indexOf(`function ${name}(`);
    assert.notEqual(functionStart, -1, `${name} must exist`);
    const asyncStart = source.lastIndexOf('async ', functionStart);
    const start = asyncStart >= 0 && asyncStart + 6 === functionStart ? asyncStart : functionStart;
    const bodyStart = source.indexOf('{', source.indexOf(')', functionStart));
    let depth = 0;
    let quote = '';
    let escaped = false;
    for (let index = bodyStart; index < source.length; index += 1) {
        const character = source[index];
        if (escaped) { escaped = false; continue; }
        if (character === '\\') { escaped = true; continue; }
        if (quote) { if (character === quote) quote = ''; continue; }
        if (character === '"' || character === "'" || character === '`') { quote = character; continue; }
        if (character === '{') depth += 1;
        if (character === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to extract ${name}`);
}

function projectWithStages(stages) {
    return {
        id: 7,
        method: '公开招标',
        is_terminated: false,
        stages,
        registrations: [],
        bid_results: [],
        lots: [],
        notice_deliveries: [],
        service_fee_invoices: [],
        lot_supplier_state: {items: []},
    };
}

function load(project) {
    const state = {slide: '', modal: '', apiCalls: [], refreshes: 0};
    const sandbox = {
        STAGES: [{key: 'legacy', name: '旧阶段', icon: '•'}],
        STAGE_NAME_CN: {legacy: '旧阶段'},
        systemSettings: {
            stage_templates: {
                '公开招标': [{id: 'saved', name: '设置模板', icon: '⚙️', modules: ['common']}],
            },
        },
        currentProject: project,
        editingStageKey: null,
        event: {stopPropagation() {}},
        escHtml: value => String(value ?? ''),
        todayISO: () => '2026-09-01',
        document: {getElementById: id => ({value: id === 'completeDate' ? '2026-09-01' : ''})},
        api: async (method, url, payload) => { state.apiCalls.push({method, url, payload}); return {}; },
        refreshProject: async () => { state.refreshes += 1; },
        closeModal() {},
        renderStageChecklist: () => '<section>阶段检查清单</section>',
        renderClarificationSection: () => '<section>澄清答疑</section>',
        renderComplaintSection: () => '<section>质疑投诉</section>',
        renderArchiveCatalogSection: () => '<section>采购方存档资料移交</section>',
        winningSupplierLabel: () => '',
        registrationMemberSummaryHtml: () => '',
        openSlide(title, html) { state.slide = `${title}\n${html}`; },
        showModal(title, html) { state.modal = `${title}\n${html}`; },
        toast() {},
        stageKeyToken: value => encodeURIComponent(String(value ?? '')).replace(/'/g, '%27'),
        stageKeyFromToken(value) {
            try { return decodeURIComponent(String(value ?? '')); } catch (_) { return ''; }
        },
        stageApiSegment: value => encodeURIComponent(String(value ?? '')).replace(/'/g, '%27'),
    };
    vm.createContext(sandbox);
    vm.runInContext(`
        ${extractFunction(core, 'projectStageDefinition')}
        ${extractFunction(core, 'stageHasModule')}
        ${extractFunction(core, 'stageName')}
        ${extractFunction(workflow, 'completeStage')}
        ${extractFunction(workflow, 'doCompleteStage')}
        ${extractFunction(workflow, 'openStageSlide')}
        ${extractFunction(workflow, 'saveStageFromSlide')}
        ${extractFunction(workflow, 'saveStageAndClose')}
    `, sandbox);
    return {sandbox, state};
}

test('stage venues follow opening and evaluation modules, including custom stages', () => {
    for (const [module, id, label] of [['bid_opening', 'stageOpeningLocation', '开标地点'], ['evaluation', 'stageEvaluationLocation', '评标地点']]) {
        const {sandbox, state} = load(projectWithStages([{key:'custom',name:'阶段',modules:[module]}]));
        sandbox.openStageSlide('custom');
        assert.ok(state.slide.includes(`id="${id}"`));
        assert.ok(state.slide.includes(label));
        assert.ok(!state.slide.includes(module === 'bid_opening' ? 'id="stageEvaluationLocation"' : 'id="stageOpeningLocation"'));
    }
});

test('venue fields save separately and failed saves keep the draft open', async () => {
    const {sandbox, state} = load(projectWithStages([{key:'opening',modules:['bid_opening']}]));
    sandbox.editingStageKey='opening';
    const fields={stageSkipped:{checked:false},stageCompleted:{checked:false},stageCompletedDate:{value:''},stagePlannedAt:{value:''},stageNotes:{value:'备注'},stageOpeningLocation:{value:' 一楼会议室 '}};
    sandbox.document.getElementById=id=>fields[id] || null;
    await sandbox.saveStageFromSlide();
    assert.equal(state.apiCalls[0].payload.opening_location,'一楼会议室');
    assert.equal(state.apiCalls[0].payload.evaluation_location,undefined);
    assert.equal(state.apiCalls[0].payload.notes,'备注');
    let closed=false;
    sandbox.closeSlide=()=>{closed=true;};
    sandbox.api=async()=>{throw new Error('保存失败');};
    await sandbox.saveStageAndClose();
    assert.equal(closed,false);
    assert.equal(state.refreshes,0);
});

test('project snapshot metadata wins over saved templates and fixed stages', () => {
    const project = projectWithStages([
        {key: 'custom-open', name: '专属开标', icon: '🧭', modules: ['common', 'bid_opening']},
    ]);
    const {sandbox} = load(project);

    assert.deepEqual(
        JSON.parse(JSON.stringify(sandbox.projectStageDefinition('custom-open', project))),
        {key: 'custom-open', name: '专属开标', icon: '🧭', modules: ['common', 'bid_opening']},
    );
    assert.equal(sandbox.stageHasModule('custom-open', 'bid_opening', project), true);
});

test('custom stage opens and completes without a fixed STAGES definition', async () => {
    const project = projectWithStages([
        {key: 'custom-open', name: '专属开标', icon: '🧭', modules: ['common', 'bid_opening'], completed: false, skipped: false},
    ]);
    const {sandbox, state} = load(project);

    assert.doesNotThrow(() => sandbox.openStageSlide('custom-open'));
    assert.match(state.slide, /🧭/);
    assert.match(state.slide, /专属开标/);
    assert.match(state.slide, /采购包投标响应处理/);
    assert.doesNotThrow(() => sandbox.completeStage('custom-open'));
    assert.match(state.modal, /🧭/);
    assert.match(state.modal, /专属开标/);
    await sandbox.doCompleteStage('custom-open');
    assert.deepEqual(JSON.parse(JSON.stringify(state.apiCalls)), [{
        method: 'PUT',
        url: '/api/projects/7/stages/custom-open',
        payload: {completed: true, completed_date: '2026-09-01'},
    }]);
    assert.equal(state.refreshes, 1);
});

test('business sections and checklist follow module ids rather than legacy keys', () => {
    const project = projectWithStages([
        {key: 'phase-a', name: '报名阶段', icon: 'A', modules: ['common', 'registration']},
        {key: 'phase-b', name: '公示阶段', icon: 'B', modules: ['common', 'result_publication']},
        {key: 'phase-c', name: '归档阶段', icon: 'C', modules: ['common', 'archive']},
        {key: 'phase-d', name: '清单阶段', icon: 'D', modules: ['common', 'checklist'], checklist: []},
    ]);
    const {sandbox, state} = load(project);

    sandbox.openStageSlide('phase-a');
    assert.match(state.slide, /供应商报名/);
    assert.doesNotMatch(state.slide, /中标结果/);
    assert.doesNotMatch(state.slide, /阶段检查清单/);
    sandbox.openStageSlide('phase-b');
    assert.match(state.slide, /中标结果/);
    sandbox.openStageSlide('phase-c');
    assert.match(state.slide, /采购方存档资料移交/);
    sandbox.openStageSlide('phase-d');
    assert.match(state.slide, /阶段检查清单/);
});

test('auto completion module uses an exact planned date and time', () => {
    const project = projectWithStages([
        {key: 'custom-auto', name: '自动阶段', icon: '⏱', modules: ['common', 'auto_completion'], completed: false, skipped: false},
    ]);
    const {sandbox, state} = load(project);

    sandbox.openStageSlide('custom-auto');

    assert.match(state.slide, /计划日期时间（到时自动完成）/);
    assert.match(state.slide, /type="datetime-local" id="stagePlannedAt"/);
});

test('online auction result module renders results independently of notice pickup and complaints', () => {
    const project = projectWithStages([
        {key:'after-quote',name:'报价截止后',modules:['common','bid_results']},
        {key:'notice',name:'领取通知书',modules:['common','winning_notice']},
    ]);
    project.method = '网上竞价';
    const {sandbox,state} = load(project);
    sandbox.openStageSlide('after-quote');
    assert.match(state.slide, /成交结果/);
    assert.match(state.slide, /showBidResultForm\(\)/);
    assert.match(state.slide, /暂无成交结果/);
    assert.doesNotMatch(state.slide, /\$\{/);
    assert.doesNotMatch(state.slide, /showNoticeForm|质疑投诉/);
    sandbox.openStageSlide('notice');
    assert.match(state.slide, /成交通知书领取/);
    assert.doesNotMatch(state.slide, /showBidResultForm/);
});

test('saving results reopens the current result stage and supports legacy publication stages', () => {
    const project = projectWithStages([
        {key:'results',modules:['bid_results']},
        {key:'publication',modules:['result_publication']},
        {key:'removed',modules:['bid_results'],template_removed:true},
    ]);
    const {sandbox,state} = load(project);
    vm.runInContext(`${extractFunction(workflow,'stageKeyForModule')}\n${extractFunction(workflow,'reopenBidResultStage')}`, sandbox);
    for (const key of ['results','publication']) {
        sandbox.editingStageKey = key;
        assert.equal(sandbox.reopenBidResultStage(),key);
    }
    sandbox.editingStageKey = 'removed';
    assert.equal(sandbox.reopenBidResultStage(),'results');
    project.stages = project.stages.filter(stage => stage.key === 'publication');
    assert.equal(sandbox.reopenBidResultStage(),'publication');
    assert.match(extractFunction(business,'showBidResultForm'), /reopenBidResultStage\(\)/);
});

test('business actions reopen the stage that owns their configured module', () => {
    assert.match(workflow, /function reopenStageModule\(/);
    assert.doesNotMatch(
        business,
        /openStageSlide\(['"](?:registration_end|result_announced|announcement|archived)['"]\)/,
    );
    for (const moduleId of ['registration', 'result_publication', 'clarification', 'archive']) {
        assert.match(business, new RegExp(`reopenStageModule\\(['"]${moduleId}['"]\\)`));
    }
    assert.doesNotMatch(business, /\.find\(s=>s\.key===['"]bid_opening['"]\)/);
    assert.match(business, /stageHasModule\(s,['"]bid_opening['"],p\)/);
});

test('removed historical stages stay out of normal timeline and task consumers', () => {
    const timeline = extractFunction(projects, 'renderTimeline');
    const tasks = extractFunction(projects, 'renderTasks');
    assert.match(timeline, /template_removed/);
    assert.match(tasks, /template_removed/);
});

test('notice empty states use the correct text for all procurement methods', () => {
    for(const method of ['公开招标','竞争性磋商','竞争性谈判','邀请招标','网上竞价','单一来源','遴选','直选']) {
        const project=projectWithStages([{key:'custom-notice',modules:['winning_notice']}]);
        project.method=method;
        const {sandbox,state}=load(project);
        sandbox.openStageSlide('custom-notice');
        assert.match(state.slide,method==='网上竞价'?/暂无成交通知书/:/暂无中标通知书/);
        assert.doesNotMatch(state.slide,/\$\{/);
    }
});

test('notice and invoice saves refresh their configured stage panel', async () => {
    for(const [name,module] of [['showNoticeForm','winning_notice'],['showInvoiceForm','service_fee']]) {
        const project=projectWithStages([{key:'custom',modules:[module]}]);
        const {sandbox,state}=load(project);
        let save;const reopened=[];
        sandbox.showModal=(title,html,callback)=>{save=callback;};
        sandbox.reopenStageModule=id=>reopened.push(id);
        sandbox.eligibleNoticeBidResults=()=>[];
        sandbox.noticeWinnerOptionsHtml=()=>'';
        sandbox.document.getElementById=id=>({value:id==='noticeSupplier'?'已中标供应商':''});
        vm.runInContext(extractFunction(business,name),sandbox);
        sandbox[name]();await save();
        assert.deepEqual(reopened,[module]);
        assert.equal(state.refreshes,1);
    }
});


test('concurrent identical stage saves share one request and changed fields queue', async()=>{
    const {sandbox,state}=load(projectWithStages([{key:'opening',modules:['bid_opening']}]));
    sandbox.editingStageKey='opening';
    const fields={stageSkipped:{checked:false},stageCompleted:{checked:false},stageCompletedDate:{value:''},stagePlannedAt:{value:''},stageNotes:{value:'first'}};
    sandbox.document.getElementById=id=>fields[id] || null;
    let release;
    sandbox.api=async(method,url,payload)=>{state.apiCalls.push({method,url,payload});if(state.apiCalls.length===1)await new Promise(r=>release=r);return {};};
    const first=sandbox.saveStageFromSlide();
    const duplicate=sandbox.saveStageFromSlide();
    assert.equal(state.apiCalls.length,1);
    fields.stageNotes.value='latest';
    const changed=sandbox.saveStageFromSlide();
    release();
    await Promise.all([first,duplicate,changed]);
    assert.equal(state.apiCalls.length,2);
    assert.equal(state.apiCalls[1].payload.notes,'latest');
});
