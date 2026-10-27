'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');
const root = path.join(__dirname, '..');
const source = ['01-core.js','02-projects.js','04-project-workflow.js','05-views.js','09-command-center.js',
    '10-chart-board.js','11-stage-settings.js','22-procurement-methods.js','23-project-flow-editor.js','24-ui-preferences.js']
    .map(file => fs.readFileSync(path.join(root, 'source/frontend', file), 'utf8')).join('\n');
const html = fs.readFileSync(path.join(root, 'src/templates/workspace.html'), 'utf8').replace(/<script\b[\s\S]*?<\/script>/g, '');
function setup(t) {
    const dom = new JSDOM(html, {url: 'http://localhost', runScripts: 'outside-only'});
    t.after(() => dom.window.close());
    const w = dom.window;
    w.matchMedia = () => ({matches: false, addEventListener(){}});
    w.eval(source + '\nwindow.seedReview = (p,key=null) => {currentProject=p; allProjects=[p];systemSettings={};editingStageKey=key;};');
    return {w, d:w.document};
}
test('node and project KPIs show their different units without changing either count', t => {
    const {w,d} = setup(t);
    const projects = [{id:1,name:'合成项目',number:'SIM-1',progress:0,method:'公开招标',stages:[
        {key:'a',name:'节点一',planned_at:'2026-10-01T09:00:00'},
        {key:'b',name:'节点二',planned_at:'2026-10-02T09:00:00'}]}];
    const before = JSON.stringify(projects);
    const model = w.commandCenterModel(projects,null,new Date('2026-10-26T10:00:00'));
    assert.equal(model.metrics.overdue,2);
    d.getElementById('dashboardContent').innerHTML=w.renderCommandCenterDashboard(model);
    const overdue=d.querySelector('[data-metric="overdue"]');
    assert.match(overdue.textContent,/逾期节点/);
    assert.match(overdue.textContent,/2\s*个节点/);
    assert.match(d.querySelector('.command-node-head').textContent,/下一个关键节点/);
    assert.match(d.querySelector('.command-node-card').textContent,/2\s*个逾期节点/);
    assert.equal(d.querySelector('.command-node-empty').textContent,'暂无未到期计划节点','overdue work is not described as no pending work');
    assert.equal(w.commandMetricList(model,'overdue').unit,'个节点');
    d.getElementById('dashboardContent').innerHTML=w.renderChartKpis({total:1,active:1,overdue:1,completed:0});
    assert.match(d.querySelector('.cb-kpi-3').textContent,/逾期项目\s*1\s*个项目/);
    assert.equal(JSON.stringify(projects),before);
    d.getElementById('dashboardContent').innerHTML=w.renderDistribution('风险提醒','risk-distribution',[{name:'7天内',count:1}]);
    assert.equal(d.querySelector('li').dataset.status,'due-soon','risk styling follows meaning when earlier categories are empty');
});
test('quantity errors are readable and retryable, do not confirm a quantity or mutate project state', async t => {
    const {w,d}=setup(t);
    const project={id:1,stages:[{key:'opening'}]};w.seedReview(project);
    const host=d.createElement('div');host.id='stageQuantityCard';d.body.append(host);
    const requests=[];w.api=async(method,url)=>{requests.push([method,url]);return {};};
    await w.loadStageQuantityCard(project,project.stages[0]);
    assert.match(host.textContent,/暂时无法核对供应商数量/);
    assert.doesNotMatch(host.textContent,/filter|undefined|TypeError/);
    const retry=host.querySelector('button');assert.equal(retry?.textContent,'重试数量检查');
    w.api=async(method,url)=>{requests.push([method,url]);return {items:[{applicable:true,lot_name:'整体项目',phase:'valid',status:'pending'}]};};
    retry.click();await new Promise(resolve=>setImmediate(resolve));
    assert.match(host.textContent,/名单尚未确认/);
    assert.equal(requests.length,2);assert(requests.every(([method])=>method==='GET'));
    assert.equal(JSON.stringify(project),'{"id":1,"stages":[{"key":"opening"}]}');
});
test('an old quantity response never overwrites a newly opened stage', async t => {
    const {w,d}=setup(t);const project={id:1,stages:[{key:'a'},{key:'b'}]};w.seedReview(project);
    const host=d.createElement('div');host.id='stageQuantityCard';d.body.append(host);
    let finish;w.api=()=>new Promise(resolve=>{finish=resolve;});
    const old=w.loadStageQuantityCard(project,project.stages[0]);
    host.remove();const fresh=d.createElement('div');fresh.id=host.id;fresh.textContent='新阶段';d.body.append(fresh);
    finish({items:[{applicable:true,phase:'valid',status:'pending'}]});await old;
    assert.equal(fresh.textContent,'新阶段');
});
test('quantity responses resolving out of order cannot replace the current stage in the same host', async t => {
    const {w,d}=setup(t);const project={id:1,stages:[{key:'a'},{key:'b'}]};w.seedReview(project);
    const host=d.createElement('div');host.id='stageQuantityCard';d.body.append(host);
    const pending=[];w.api=()=>new Promise(resolve=>pending.push(resolve));
    const old=w.loadStageQuantityCard(project,project.stages[0]);
    const current=w.loadStageQuantityCard(project,project.stages[1]);
    pending[1]({items:[{applicable:true,lot_name:'新阶段',status:'pending'}]});await current;
    pending[0]({items:[{applicable:true,lot_name:'旧阶段',status:'pending'}]});await old;
    assert.match(host.textContent,/新阶段/);assert.doesNotMatch(host.textContent,/旧阶段/);
});
test('undo requires confirmation and cancellation leaves the completed stage untouched', async t => {
    const {w}=setup(t);const project={id:1,stages:[{key:'a',name:'编制',completed:true}]};w.seedReview(project);
    const calls=[];w.api=async(...args)=>{calls.push(args);};w.refreshProject=async()=>{};w.toast=()=>{};
    let title;w.confirmDialog=async value=>{title=value;return false;};
    await w.toggleStage('a');assert.equal(title,'撤销阶段完成');assert.equal(calls.length,0);
    w.confirmDialog=async()=>true;await w.toggleStage('a');
    assert.equal(calls.length,1);assert.equal(calls[0][0],'PUT');assert.equal(calls[0][2].completed,false);
});
test('undo from the stage drawer also preserves completion time when cancelled', async t => {
    const {w,d}=setup(t);const project={id:1,stages:[{key:'a',name:'编制',completed:true}]};w.seedReview(project,'a');
    d.body.insertAdjacentHTML('beforeend','<input type="checkbox" id="stageCompleted"><span id="stageCompletedLabel"></span><input id="stageCompletedDate" value="2026-10-01"><input id="stageCompletedTime" value="09:30">');
    w.PMIcons={label:(el,text)=>{el.textContent=text;}};
    let saved=0;w.saveStageFromSlide=()=>{saved++;};w.confirmDialog=async()=>false;
    await w.syncStageCompleted();
    assert.equal(saved,0);assert.equal(d.getElementById('stageCompleted').checked,true);
    assert.equal(d.getElementById('stageCompletedDate').value,'2026-10-01');
    assert.equal(d.getElementById('stageCompletedTime').value,'09:30');
    d.getElementById('stageCompleted').checked=false;w.confirmDialog=async()=>true;
    await w.syncStageCompleted();assert.equal(saved,1);assert.equal(d.getElementById('stageCompletedDate').value,'');
});
