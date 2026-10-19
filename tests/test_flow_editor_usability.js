const test=require('node:test');
const assert=require('node:assert/strict');
const setup=require('./procurement_ui_harness.cjs');
function openFlow(){
  const w=setup();const cat=w.systemSettings.procurement_catalog;
  cat.methods[0].template_mode='independent';
  cat.methods[0].stages=[{id:'a',name:'需求核对',icon:'📥',modules:['common']},{id:'b',name:'报名',icon:'📦',modules:['common','checklist']}];
  w.showProcurementMethodForm('one',{view:'flow'});return w;
}
test('catalog exposes separate basic settings and workflow entry',()=>{
  const w=setup();const host=w.document.getElementById('catalogManagerHost');host.innerHTML=w.renderProcurementMethodManager();
  const row=host.querySelector('[data-procurement-overview]');
  assert.match(row.textContent,/基本设置/);assert.match(row.textContent,/编辑流程/);
});
test('flow opens with first stage fields visible and selection does not mark draft dirty',()=>{
  const w=openFlow();assert.equal(w.document.getElementById('pmSettingsPanel').hidden,true);
  assert.equal(w.document.getElementById('pmFlowPanel').hidden,false);
  assert.equal(w.document.querySelector('[data-flow-name]').value,'需求核对');
  assert.equal(w.document.querySelector('[data-flow-name]').closest('details'),null);
  const before=w.procurementFormSignature();w.selectStageEditorStage('method','b');
  assert.equal(w.document.querySelector('[data-flow-name]').value,'报名');
  assert.equal(w.procurementFormSignature(),before);
});
test('rename selection reorder and basic tab switching retain unsaved stage and basic fields',()=>{
  const w=openFlow();const input=w.document.querySelector('[data-flow-name]');input.value='需求确认';w.stageEditorField(input,'method','a','name');
  assert.equal(w.document.querySelector('[data-flow-stage="a"] [data-flow-label]').textContent,'需求确认');
  w.switchProcurementFormView('settings');w.document.getElementById('pmName').value='草稿方式';
  w.switchProcurementFormView('flow');w.selectStageEditorStage('method','b');w.stageEditorAction('method','up','b');
  assert.equal(w.document.querySelector('[data-flow-name]').value,'报名');
  w.selectStageEditorStage('method','a');assert.equal(w.document.querySelector('[data-flow-name]').value,'需求确认');
  assert.equal(w.document.getElementById('pmName').value,'草稿方式');
  assert.match(w.document.querySelector('[data-flow-dirty]').textContent,/未保存/);
});
test('new stage is immediately editable and removing selected stage selects its neighbor',()=>{
  const w=openFlow();w.stageEditorAction('method','add');assert.equal(w.document.querySelector('[data-flow-name]').value,'新增阶段');
  const id=w.document.querySelector('[data-flow-select][aria-pressed="true"]').dataset.flowSelect;
  w.stageEditorAction('method','remove',id);assert.equal(w.document.querySelector('[data-flow-name]').value,'报名');
});
test('workflow save persists independent stages and conflicts keep selected draft',async()=>{
  const w=openFlow();w.selectStageEditorStage('method','b');const input=w.document.querySelector('[data-flow-name]');input.value='报名登记';w.stageEditorField(input,'method','b','name');
  let submitted;w.api=async(method,url,value)=>{if(method==='PATCH'){submitted=JSON.parse(JSON.stringify(value));throw Object.assign(new Error('版本冲突，请保留草稿'),{status:409});}return w.systemSettings.procurement_catalog;};
  assert.equal(await w.saveProcurementMethodForm(),false);assert.equal(submitted.stages[1].name,'报名登记');
  assert.equal(w.document.querySelector('[data-flow-name]').value,'报名登记');
  assert.match(w.document.getElementById('pmFormError').textContent,/冲突/);
});
test('common flow is read-only in method editor until explicitly copied and leaves catalog untouched',()=>{
  const w=setup();w.showProcurementMethodForm('one',{view:'flow'});
  assert.equal(w.document.querySelector('[data-flow-name]'),null);
  w.document.getElementById('pmTemplateMode').value='independent';w.syncProcurementForm();
  const input=w.document.querySelector('[data-flow-name]');input.value='方式独立阶段';w.stageEditorField(input,'method','a','name');
  assert.equal(w.systemSettings.procurement_catalog.common_stages[0].name,'开始');
});
test('read-only workflow has no editable fields or mutation controls',()=>{
  const w=setup();w.currentIsAdmin=false;w.showProcurementMethodForm('one',{view:'flow'});
  assert.equal(w.document.querySelector('[data-flow-name]:not(:disabled)'),null);
  assert.equal(w.document.querySelector('[data-flow-add]'),null);
  assert.equal(w.document.querySelector('[data-pm-view="settings"]').disabled,false);
  assert.equal(w.document.querySelector('[data-pm-view="flow"]').disabled,false);
});
test('preview arriving after a stage edit cannot enable saving a stale project preview',async()=>{
  const w=setup();w.api=async()=>({id:1,stages:[{key:'a',name:'开始',modules:['common']}]});await w.showProjectWorkflowEditor(1);
  let resolve;w.api=()=>new Promise(r=>resolve=r);const pending=w.previewProjectWorkflow();
  const input=w.document.querySelector('[data-flow-name]');input.value='预览期间修改';w.stageEditorField(input,'project','a','name');
  resolve({base_fingerprint:'old',diff:{added:[],updated:[],removed:[]},blocked:[]});await pending;
  assert.equal(w.document.getElementById('flowCommit').disabled,true);
  assert.match(w.document.getElementById('flowPreview').textContent,/重新预览/);
});
test('common template edits made during saving remain in editor and require another save',async()=>{
  const w=setup();w.showCommonProcurementFlow();let finish;let closed=false;w.closeModal=()=>closed=true;
  w.api=(method)=>method==='PUT'?new Promise(r=>finish=r):Promise.resolve(w.systemSettings.procurement_catalog);
  const saving=w.savedCallback();const input=w.document.querySelector('[data-flow-name]');input.value='保存期间的新修改';w.stageEditorField(input,'common','a','name');
  finish({});await saving;assert.equal(closed,false);assert.equal(input.value,'保存期间的新修改');
  assert.match(w.document.getElementById('flowError').textContent,/新修改/);
});
