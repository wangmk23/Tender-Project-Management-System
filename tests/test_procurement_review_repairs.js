const test=require('node:test'),assert=require('node:assert/strict');
const setup=require('./procurement_ui_harness.cjs');
const clone=x=>JSON.parse(JSON.stringify(x));
function fillException(w){w.addProcurementException();const f=k=>w.document.querySelector(`[data-exception-field="${k}"]`);f('title').value='经确认的例外';f('description').value='由管理员核对适用情形';return f;}
test('successful create with failed refresh retries only the read and keeps the saved identity',async()=>{
 const w=setup();w.showProcurementMethodForm();w.document.getElementById('pmName').value='已保存方式';const writes=[];let fail=true;
 w.api=async(method,url,value)=>{if(method!=='GET'){writes.push({method,url,value:clone(value)});return {method:{...value,id:'saved',revision:2},revision:2};}if(fail)throw Error('刷新失败');return w.systemSettings.procurement_catalog;};
 assert.equal(await w.saveProcurementMethodForm(),false);assert.match(w.document.getElementById('pmSaveStatus').textContent,/已保存.*刷新/);assert.equal(w.document.getElementById('pmFormError').hidden,true);
 fail=false;assert.equal(await w.saveProcurementMethodForm(),true);assert.equal(writes.length,1);
});
test('edits after acknowledged create use PATCH and latest revision even when refresh fails',async()=>{
 const w=setup();w.showProcurementMethodForm();w.document.getElementById('pmName').value='已保存方式';let writes=[];
 w.api=async(method,url,value)=>{if(method==='GET')throw Error('离线');writes.push({method,url,value:clone(value)});return {method:{...value,id:'saved',revision:2+writes.length},revision:2+writes.length};};
 await w.saveProcurementMethodForm();w.document.getElementById('pmNotes').value='第二次输入';await w.saveProcurementMethodForm();
 assert.equal(writes[1].method,'PATCH');assert.equal(writes[1].url,'/api/procurement-methods/saved');assert.equal(writes[1].value.revision,3);
});
test('pending refresh never discards later typed draft',async()=>{
 const w=setup();w.showProcurementMethodForm('one');let reject;w.api=async(method,url,value)=>method==='GET'?new Promise((r,j)=>reject=j):{method:{...value,id:'one',revision:2},revision:2};
 const pending=w.saveProcurementMethodForm();await new Promise(r=>setTimeout(r,0));w.document.getElementById('pmNotes').value='刷新期间继续输入';reject(Error('断网'));await pending;
 assert.equal(w.document.getElementById('pmNotes').value,'刷新期间继续输入');assert.match(w.document.getElementById('pmDraftStatus').textContent,/未保存/);
});
test('mutation acknowledges successful write even if the following refresh fails',async()=>{
 const w=setup();const messages=[];w.toast=(msg,type)=>messages.push({msg,type});w.api=async()=>{throw Error('刷新失败')};
 assert.equal(await w.procurementMutation(async()=>({})),true);assert.match(messages.at(-1).msg,/已保存.*刷新/);assert.notEqual(messages.at(-1).type,'error');
});
test('read-only exceptions have no editable fields and reject add and remove actions',()=>{
 const w=setup();w.systemSettings.procurement_catalog.methods[0].exceptions=[{id:'x',title:'已核对例外',description:'说明',enabled:true,quantity_rule:{mode:'unfixed',minimum:null}}];w.currentIsAdmin=false;w.showProcurementMethodForm('one');
 assert.equal(w.document.querySelectorAll('#pmExceptions input:not(:disabled),#pmExceptions select:not(:disabled),#pmExceptions textarea:not(:disabled),#pmExceptions button:not(:disabled)').length,0);
 w.removeProcurementException(0);w.addProcurementException();assert.equal(w.document.querySelectorAll('[data-exception-index]').length,1);
});
test('exception add/remove update dirty feedback and unfixed mode hides the irrelevant minimum',()=>{
 const w=setup();w.showProcurementMethodForm();w.addProcurementException();assert.match(w.document.getElementById('pmDraftStatus').textContent,/未保存/);
 assert.equal(w.document.querySelector('[data-exception-minimum]').hidden,true);w.removeProcurementException(0);assert.equal(w.document.getElementById('pmDraftStatus').textContent,'');
});
test('invalid quantity switches back from flow to the visible input without any request',async()=>{
 for(const value of ['', '0','100','1.5','abc']){const w=setup();w.showProcurementMethodForm();w.document.getElementById('pmName').value='数量验证';w.document.getElementById('pmQuantityMode').value='fixed';w.document.getElementById('pmMinimum').value=value;w.syncProcurementForm();w.switchProcurementFormView('flow');let calls=0;w.api=async()=>calls++;
 assert.equal(await w.saveProcurementMethodForm(),false);assert.equal(calls,0);assert.equal(w.document.getElementById('pmSettingsPanel').hidden,false);assert.equal(w.document.activeElement.id,'pmMinimum');assert.equal(w.document.activeElement.getAttribute('aria-invalid'),'true');w.close();}
});
test('invalid exception expands its disclosure focuses the exact field and preserves other draft',async()=>{
 const w=setup();w.showProcurementMethodForm();w.document.getElementById('pmName').value='例外校验';fillException(w)('description').value='';w.document.getElementById('pmNotes').value='保留备注';w.switchProcurementFormView('flow');let calls=0;w.api=async()=>calls++;
 assert.equal(await w.saveProcurementMethodForm(),false);assert.equal(calls,0);const field=w.document.querySelector('[data-exception-field="description"]');assert.equal(w.document.activeElement,field);assert.ok(field.closest('details').open);assert.equal(w.document.getElementById('pmNotes').value,'保留备注');
});
test('exception mode changes hide minimum without replacing active fields',()=>{
 const w=setup();w.showProcurementMethodForm();const f=fillException(w),field=f('mode');field.value='fixed';field.dispatchEvent(new w.Event('change',{bubbles:true}));assert.equal(w.document.querySelector('[data-exception-minimum]').hidden,false);assert.equal(f('mode'),field);assert.equal(f('description').value,'由管理员核对适用情形');
});
test('same-name configuration label is stable across method reorder',()=>{
 const w=setup(),m=w.systemSettings.procurement_catalog.methods[0],label=w.procurementMethodLabel(m);w.systemSettings.procurement_catalog.methods.reverse();assert.equal(w.procurementMethodLabel(m),label);
});
test('selecting method preserves navigation DOM and only swaps the overview',()=>{
 const w=setup(),host=w.document.getElementById('catalogManagerHost');host.innerHTML=w.renderProcurementMethodManager();const list=host.querySelector('.procurement-method-list'),button=host.querySelector('[data-method-id="two"] button');w.selectProcurementManagerMethod('two');
 assert.ok(button.isConnected);assert.equal(host.querySelector('.procurement-method-list'),list);assert.equal(button.getAttribute('aria-pressed'),'true');assert.equal(host.querySelector('[data-method-id="one"] button').getAttribute('aria-pressed'),'false');assert.equal(host.querySelector('[data-method-id-detail]').dataset.methodIdDetail,'two');
});
test('management actions appear before long stage preview with referenced deletion disabled',()=>{
 const w=setup(),host=w.document.getElementById('catalogManagerHost');host.innerHTML=w.renderProcurementMethodManager();const action=host.querySelector('.procurement-method-actions'),stages=host.querySelector('.procurement-stage-overview');
 assert.ok(action.compareDocumentPosition(stages)&w.Node.DOCUMENT_POSITION_FOLLOWING);assert.ok([...action.querySelectorAll('button')].find(b=>b.textContent==='删除').disabled);
});
test('common flow uses acknowledged catalog and does not misreport a successful write as refresh failure',async()=>{
 const w=setup();w.showCommonProcurementFlow();const cat=clone(w.systemSettings.procurement_catalog);cat.revision=2;let reads=0;w.api=async(method)=>{if(method==='PUT')return cat;reads++;throw Error('刷新失败')};
 assert.equal(await w.savedCallback(),true);assert.equal(reads,0);assert.equal(w.systemSettings.procurement_catalog.revision,2);
});
test('a repeated management click while a write is pending cannot submit a second mutation',async()=>{
 const w=setup();let finish,writes=0;const cat=clone(w.systemSettings.procurement_catalog);w.api=async()=>cat;
 const first=w.procurementMutation(()=>{writes++;return new Promise(r=>finish=r)});const second=await w.procurementMutation(async()=>{writes++;return cat});assert.equal(second,false);assert.equal(writes,1);finish(cat);assert.equal(await first,true);
});
