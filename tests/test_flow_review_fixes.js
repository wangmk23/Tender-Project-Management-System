const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const setup=require('./procurement_ui_harness.cjs');
const wait=()=>new Promise(r=>setTimeout(r,0));
function project(){return {id:1,stages:[{key:'a',name:'原项目阶段',modules:['common']}]};}
test('F01 late method response cannot rebind a newer form or redirect its next save',async()=>{
 const w=setup();let release;const writes=[];w.api=async(method,url,value)=>{if(method==='PATCH'){writes.push({url,value:JSON.parse(JSON.stringify(value))});if(writes.length===1)return new Promise(r=>release=()=>r({method:{id:'one',revision:2}}));return {method:{id:'two',revision:2}};}return w.systemSettings.procurement_catalog;};
 w.showProcurementMethodForm('one');w.document.getElementById('pmNotes').value='A提交';const a=w.saveProcurementMethodForm();
 w.showProcurementMethodForm('two');w.document.getElementById('pmName').value='B新名称';w.document.getElementById('pmNotes').value='B草稿';release();await a;
 assert.equal(w.document.getElementById('pmName').value,'B新名称');await w.saveProcurementMethodForm();
 assert.equal(writes[1].url,'/api/procurement-methods/two');assert.equal(writes[1].value.notes,'B草稿');assert.equal(writes[1].value.revision,1);
});
test('F01 pending-save close explains that leaving cannot cancel the submitted request',async()=>{
 const w=setup();let finish;w.api=method=>method==='PATCH'?new Promise(r=>finish=r):Promise.resolve(w.systemSettings.procurement_catalog);w.showProcurementMethodForm('one');w.document.getElementById('pmNotes').value='提交';const pending=w.saveProcurementMethodForm();
 let message='';w.confirmDialog=async(title,text)=>{message=title+text;return false;};assert.equal(await w.confirmProcurementFormClose(),false);assert.match(message,/已提交|已发出/);assert.match(message,/不会撤销|不能撤销/);
 finish({method:{id:'one',revision:2}});await pending;
});
test('F01 a failed request from a closed form cannot place its error in the next dialog',async()=>{
 const w=setup();let reject;w.api=()=>new Promise((r,j)=>reject=j);w.showProcurementMethodForm('one');const pending=w.saveProcurementMethodForm();
 w.showProcurementMethodForm('two');reject(new Error('A失败'));await pending;assert.equal(w.document.getElementById('pmFormError').hidden,true);
});
test('F02 project commit keeps later typed draft and requires a fresh preview',async()=>{
 const w=setup();w.api=async()=>project();await w.showProjectWorkflowEditor(1);
 w.api=async()=>({base_fingerprint:'base',diff:{added:[],updated:[],removed:[]},blocked:[]});await w.previewProjectWorkflow();
 let finish,submitted;w.api=(method,url,value)=>{submitted=JSON.parse(JSON.stringify(value));return new Promise(r=>finish=r);};let closed=false;w.closeModal=()=>closed=true;
 const pending=w.commitProjectWorkflow();const input=w.document.querySelector('[data-flow-name]');input.value='后来输入';w.stageEditorField(input,'project','a','name');
 finish({project:project()});await pending;assert.equal(closed,false);assert.equal(input.value,'后来输入');assert.equal(submitted.stages[0].name,'原项目阶段');assert.equal(w.document.getElementById('flowCommit').disabled,true);assert.match(w.document.getElementById('flowError').textContent,/新修改/);
});
test('F02 project commit arriving in another dialog leaves that dialog open',async()=>{
 const w=setup();w.api=async()=>project();await w.showProjectWorkflowEditor(1);w.api=async()=>({base_fingerprint:'base',diff:{added:[],updated:[],removed:[]},blocked:[]});await w.previewProjectWorkflow();
 let finish;w.api=()=>new Promise(r=>finish=r);const pending=w.commitProjectWorkflow();w.showProcurementMethodForm('two');let closed=false;w.closeModal=()=>closed=true;
 finish({project:project()});await pending;assert.equal(closed,false);assert.ok(w.document.getElementById('pmName'));
});
test('F03 legacy pending method can save its workflow without classifying or changing history',async()=>{
 const w=setup(),old=w.systemSettings.procurement_catalog.methods[2];old.stages=[{id:'a',name:'旧流程',modules:['common']}];w.showProcurementMethodForm('old',{view:'flow'});
 let value;w.api=async(method,url,payload)=>{if(method==='PATCH'){value=payload;return {method:{id:'old',revision:2}};}return w.systemSettings.procurement_catalog;};
 const input=w.document.querySelector('[data-flow-name]');input.value='维护旧流程';w.stageEditorField(input,'method','a','name');assert.equal(await w.saveProcurementMethodForm(),true);assert.equal(value.stages[0].name,'维护旧流程');assert.equal('regime' in value,false);
});
test('F03 new method with missing name focuses its visible required field',async()=>{
 const w=setup();w.showProcurementMethodForm(null,{view:'flow'});assert.equal(await w.saveProcurementMethodForm(),false);
 assert.equal(w.document.getElementById('pmSettingsPanel').hidden,false);assert.equal(w.document.activeElement.id,'pmName');
});
test('F04 same-regime duplicate is explained before write and offers comparison and a manual rename path',async()=>{
 const w=setup(),cat=w.systemSettings.procurement_catalog;w.showProcurementMethodForm('old');w.document.getElementById('pmName').value='同名';
 let writes=0;w.api=async()=>{writes++;return cat;};assert.equal(await w.saveProcurementMethodForm(),false);assert.equal(writes,0);
 const panel=w.document.getElementById('pmIdentityConflict');assert.equal(panel.hidden,false);assert.match(panel.textContent,/停用会保留名称/);assert.match(panel.textContent,/当前.*流程|正在编辑/);assert.match(panel.textContent,/现有.*流程|同名方式/);assert.equal(w.document.getElementById('pmName').value,'同名');
 assert.ok(panel.querySelector('button'));assert.equal(cat.methods[0].name,'同名');
});
test('F05 flow heading follows draft name regime and unsaved state',()=>{
 const w=setup();w.showProcurementMethodForm('one');w.document.getElementById('pmName').value='草稿新名称';w.switchProcurementFormView('flow');
 assert.match(w.document.getElementById('pmFlowHeading').textContent,/草稿新名称/);assert.match(w.document.getElementById('pmFlowContext').textContent,/后续新项目/);assert.match(w.document.getElementById('pmDraftStatus').textContent,/未保存/);
});
test('F05 adding a stage updates the overall unsaved indicator without typing',()=>{
 const w=setup();w.showProcurementMethodForm('old',{view:'flow'});assert.equal(w.document.getElementById('pmDraftStatus').textContent,'');
 w.stageEditorAction('method','add');assert.match(w.document.getElementById('pmDraftStatus').textContent,/未保存/);
});
test('U01 stage icon choices show named SVG previews with stored glyph unchanged',async()=>{
 const w=setup();require('node:vm').runInContext(fs.readFileSync('source/frontend/00-icons.js','utf8'),require('node:vm').createContext(w));w.showCommonProcurementFlow();w.PMIcons.render(w.document.body);
 const select=w.document.querySelector('[data-flow-icon]');assert.ok(select);assert.equal(select.value,'📥');assert.ok(select.parentElement.querySelector('svg'));assert.match(select.options[0].textContent,/接收/);
 await wait();w.close();
});
test('U02 shared-flow usage lists consumers and independent-flow explanation stays separate',()=>{
 const w=setup();w.showProcurementMethodForm('one',{view:'flow'});const usage=w.document.querySelector('[data-common-consumers]');assert.ok(usage);assert.match(usage.textContent,/同名/);assert.doesNotMatch(usage.textContent,/企业及国有企业/);assert.match(w.document.getElementById('pmFlowPanel').textContent,/共享/);
 w.useIndependentProcurementFlow();assert.match(w.document.getElementById('pmFlowRelation').textContent,/只修改当前采购方式/);
});
