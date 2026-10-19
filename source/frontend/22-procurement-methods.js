// ── Stable procurement method catalog and themed management ──
let procurementCatalogRequest=null;
let procurementForm=null;
let procurementManagerSelection=null;
let procurementNeedsRefresh=false;
let procurementRefreshPending=null;
let procurementMutationBusy=false;
function procurementCatalog(){return (typeof systemSettings!=='undefined'?systemSettings?.procurement_catalog:null) || {revision:0,methods:[],common_stages:[]};}
async function loadProcurementCatalog({refresh=false}={}){
    if(!refresh&&procurementCatalog().methods.length)return procurementCatalog();
    if(!procurementCatalogRequest)procurementCatalogRequest=api('GET','/api/procurement-methods').then(value=>{if(Number.isInteger(value.revision)&&value.revision<procurementCatalog().revision)return procurementCatalog();systemSettings=systemSettings||{};systemSettings.procurement_catalog=value;return value;}).finally(()=>{procurementCatalogRequest=null;});
    return procurementCatalogRequest;
}
function procurementMethodOptions({purpose='create',project=null}={}){
    const current=project?.procurement?.method_id;
    return procurementCatalog().methods.filter(m=>purpose==='history'||(m.enabled&&m.user_owned!==false)||(purpose==='change'&&m.id===current));
}
function procurementDisplayName(m,catalog=procurementCatalog()){const same=catalog.methods.filter(x=>x.name===m.name&&x.user_owned!==false).sort((a,b)=>String(a.id)<String(b.id)?-1:String(a.id)>String(b.id)?1:0);return same.length>1?`${m.name}（配置 ${Math.max(1,same.findIndex(x=>x.id===m.id)+1)}）`:m.name;}
function procurementMethodLabel(m){return procurementDisplayName(m)+(m.enabled?'':' · 已停用');}
function procurementProjectKey(p){return p?.procurement?.method_id||`legacy:${p?.method||''}`;}
function procurementProjectLabel(p){return p?.method||p?.procurement?.name_snapshot||'未设置';}
function procurementSelectOptions(project=null,purpose='create'){
    const current=project?.procurement?.method_id;
    let rows=procurementMethodOptions({purpose,project});
    return (!current&&project?`<option value="">${escHtml(project.method||'未设置')}（保留历史）</option>`:`<option value="">${rows.length?'请选择采购方式':'请先创建或启用采购方式'}</option>`)+rows.map(m=>`<option value="${escHtml(m.id)}" ${m.id===current?'selected':''}>${escHtml(procurementMethodLabel(m))}</option>`).join('');
}
function procurementSelectionPayload(id,project=null){return id?{procurement_method_id:id}:{...(project?{method:project.method}:{procurement_method_id:''})};}
function procurementReorderedIds(catalog,visible,id,delta){const ids=catalog.methods.map(m=>m.id);const at=visible.indexOf(id),next=at+delta;if(at<0||next<0||next>=visible.length)return ids;const a=ids.indexOf(id),b=ids.indexOf(visible[next]);[ids[a],ids[b]]=[ids[b],ids[a]];return ids;}
function procurementManagerRows(catalog){return catalog.methods.filter(m=>m.user_owned!==false);}
function canMoveProcurementRow(rows,index,delta){return !!rows[index+delta];}
function procurementOverview(m,rows,catalog,edit){
    if(!m)return '<section data-procurement-overview class="procurement-overview"><p class="muted-text">暂无采购方式，请先新增。</p></section>';
    const stages=m.template_mode==='common'?catalog.common_stages:m.stages||[],i=rows.findIndex(x=>x.id===m.id);
    return `<section data-procurement-overview data-method-id-detail="${escHtml(m.id)}" class="procurement-overview"><header class="procurement-overview-head"><div><h3>${escHtml(procurementDisplayName(m,catalog))} <span class="procurement-status">${procurementAvailability(m,catalog)}</span></h3><p>${stages.length} 个阶段 · ${m.template_mode==='common'?'通用默认流程':'独立流程'} · ${m.quantity_rule.mode==='unfixed'?'不固定最低数量':`配置最低 ${m.quantity_rule.minimum} 家`}</p></div><div class="procurement-overview-edit"><button type="button" class="btn btn-primary btn-sm" onclick="showProcurementMethodForm('${m.id}',{view:'flow'})">${edit?'编辑流程':'查看流程'}</button><button type="button" class="btn btn-secondary btn-sm" onclick="showProcurementMethodForm('${m.id}')">${edit?'基本设置':'查看设置'}</button></div></header><p class="settings-note">${edit?'点击阶段可定位编辑。':''}默认流程仅用于后续新项目，已有项目保留原阶段和完成记录。</p><div class="procurement-overview-tools"><small>${m.reference_count||0} 个项目或采购包引用</small>${edit?`<div class="procurement-method-actions"><button class="btn btn-secondary btn-sm" onclick="moveProcurementMethod('${m.id}',-1)" ${canMoveProcurementRow(rows,i,-1)?'':'disabled'}>上移</button><button class="btn btn-secondary btn-sm" onclick="moveProcurementMethod('${m.id}',1)" ${canMoveProcurementRow(rows,i,1)?'':'disabled'}>下移</button><button class="btn btn-secondary btn-sm" onclick="toggleProcurementMethod('${m.id}')">${m.enabled?'停用':'启用'}</button><button class="btn btn-danger btn-sm" onclick="deleteProcurementMethod('${m.id}')" ${m.reference_count?'disabled title="已有项目引用，请通过停用处理"':''}>删除</button></div>`:''}</div><ol class="procurement-stage-overview">${stages.map((stage,index)=>`<li><button type="button" data-overview-stage="${escHtml(stage.id)}" onclick="showProcurementMethodForm('${m.id}',{view:'flow',stageId:'${escHtml(stage.id)}'})"><span class="stage-order-position">${index+1}</span><span data-ui-icon="${escHtml(stage.icon||'📌')}"></span><span class="procurement-stage-copy"><strong>${escHtml(stage.name)}</strong><small>${escHtml(stageEditorModuleNames(stage))}</small></span><span class="procurement-stage-open" aria-hidden="true">›</span></button></li>`).join('')||'<li>暂无阶段，请编辑流程补充。</li>'}</ol>${m.notes?`<details class="procurement-method-notes"><summary>备注</summary><p>${escHtml(m.notes)}</p></details>`:''}</section>`;
}
function renderProcurementMethodManager(catalog=procurementCatalog()){
    const rows=procurementManagerRows(catalog),edit=currentIsAdmin===true;
    const selected=rows.find(m=>m.id===procurementManagerSelection)||rows[0];procurementManagerSelection=selected?.id||null;
    return `<section class="settings-card settings-card-wide procurement-manager"><div class="settings-card-head"><div><h2>采购方式与流程</h2><p>自行新增和维护采购方式。选择阶段进入编辑，默认流程只影响新项目。</p></div>${edit?'<button type="button" class="btn btn-primary btn-sm" onclick="showProcurementMethodForm()">新增采购方式</button>':''}</div>
    <div id="procurementRefreshStatus" class="procurement-refresh-status" role="status" ${procurementNeedsRefresh?'':'hidden'}>${procurementRefreshNotice()}</div><div class="procurement-workspace" data-procurement-workspace><nav class="procurement-method-list" aria-label="采购方式">${rows.map((m,i)=>`<article class="procurement-method-row" data-method-id="${escHtml(m.id)}"><button type="button" class="procurement-method-select" aria-pressed="${m.id===selected?.id}" aria-controls="procurementOverviewPanel" onclick="selectProcurementManagerMethod('${m.id}')"><strong>${escHtml(procurementDisplayName(m,catalog))}</strong><small>${m.template_mode==='common'?'通用默认流程':'独立流程'} · ${(m.template_mode==='common'?catalog.common_stages:m.stages||[]).length} 阶段 · ${procurementAvailability(m,catalog)}</small></button></article>`).join('')||'<p class="muted-text">暂无采购方式。</p>'}</nav><div id="procurementOverviewPanel">${procurementOverview(selected,rows,catalog,edit)}</div></div>
    <div class="settings-actions"><button class="btn btn-secondary btn-sm" onclick="showCommonProcurementFlow()">${edit?'编辑':'查看'}通用默认流程</button><button class="btn btn-secondary btn-sm" onclick="showGuaranteeDefaults()">新项目保证金退还规则</button></div></section>`;
}
function selectProcurementManagerMethod(id){
    const cat=procurementCatalog(),rows=procurementManagerRows(cat),selected=rows.find(m=>m.id===id);if(!selected)return;
    procurementManagerSelection=id;const host=document.getElementById('procurementOverviewPanel'),list=document.querySelector('.procurement-method-list');
    if(!host||!list){refreshProcurementManager();return;}
    const item=[...list.querySelectorAll('[data-method-id]')].find(e=>e.dataset.methodId===id)?.querySelector('.procurement-method-select');
    list.querySelectorAll('[data-method-id]').forEach(row=>row.querySelector('.procurement-method-select')?.setAttribute('aria-pressed',String(row.dataset.methodId===id)));
    host.innerHTML=procurementOverview(selected,rows,cat,currentIsAdmin===true);window.PMIcons?.render?.(host);globalThis.PMForms?.enhance?.(host);setProcurementMutationBusy(procurementMutationBusy);
    if(item){const a=item.getBoundingClientRect(),b=list.getBoundingClientRect();if(a.top<b.top)list.scrollTop-=b.top-a.top;else if(a.bottom>b.bottom)list.scrollTop+=a.bottom-b.bottom;item.focus({preventScroll:true});}
}
function refreshProcurementManager(){const host=document.getElementById('catalogManagerHost');if(host){host.innerHTML=renderProcurementMethodManager();window.PMIcons?.render?.(host);globalThis.PMForms?.enhance?.(host);setProcurementMutationBusy(procurementMutationBusy);}if(typeof ensureSidebarMethodFilter==='function')ensureSidebarMethodFilter();}
function procurementRefreshNotice(){return '内容已保存，列表暂未刷新。<button type="button" class="btn btn-secondary btn-sm" onclick="retryProcurementCatalogRefresh(this)">重试刷新</button>';}
function acceptProcurementResponse(result,{deletedId=null}={}){
    if(!result)return;const cat=procurementCatalog();
    if(Array.isArray(result.methods)&&Array.isArray(result.common_stages)){systemSettings.procurement_catalog=result;procurementNeedsRefresh=false;return;}
    if(result.method){const index=cat.methods.findIndex(m=>m.id===result.method.id),old=cat.methods[index];const method={reference_count:0,...old,...result.method,user_owned:true};if(index<0)cat.methods.push(method);else cat.methods[index]=method;}
    if(deletedId)cat.methods=cat.methods.filter(m=>m.id!==deletedId);
    if(Number.isInteger(result.revision))cat.revision=result.revision;
}
function showProcurementRefreshWarning(){procurementNeedsRefresh=true;const host=document.getElementById('procurementRefreshStatus');if(host){host.hidden=false;host.innerHTML=procurementRefreshNotice();}}
async function retryProcurementCatalogRefresh(button){
    if(procurementRefreshPending)return procurementRefreshPending;
    const form=procurementForm;if(button){button.disabled=true;button.setAttribute('aria-busy','true');}
    procurementRefreshPending=(async()=>{try{await loadProcurementCatalog({refresh:true});procurementNeedsRefresh=false;refreshProcurementManager();if(isProcurementFormActive(form)&&form.needsRefresh){form.needsRefresh=false;const status=document.getElementById('pmSaveStatus');status.hidden=false;status.textContent='已保存，列表已刷新。';}return true;}catch(e){showProcurementRefreshWarning();toast('内容已保存，列表暂未刷新，请稍后重试。','warning');return false;}})();
    try{return await procurementRefreshPending;}finally{procurementRefreshPending=null;if(button){button.disabled=false;button.removeAttribute('aria-busy');}}
}
async function procurementMutation(fn,options={}){
    if(procurementMutationBusy)return false;setProcurementMutationBusy(true);
    try{
        let saved;try{saved=await fn();}catch(e){toast(e.message,'error');return false;}
        acceptProcurementResponse(saved,options);refreshProcurementManager();
        if(!saved?.methods){try{await loadProcurementCatalog({refresh:true});procurementNeedsRefresh=false;refreshProcurementManager();}catch(e){showProcurementRefreshWarning();toast('内容已保存，列表暂未刷新，请稍后重试。','warning');return true;}}
        toast('已保存','success');return true;
    }finally{setProcurementMutationBusy(false);}
}
function setProcurementMutationBusy(busy){
    procurementMutationBusy=busy;const host=document.getElementById('catalogManagerHost');if(!host)return;
    host.setAttribute('aria-busy',String(busy));host.querySelectorAll('.procurement-method-actions button').forEach(button=>{if(busy){if(!('pmWasDisabled' in button.dataset))button.dataset.pmWasDisabled=String(button.disabled);button.disabled=true;}else if('pmWasDisabled' in button.dataset){button.disabled=button.dataset.pmWasDisabled==='true';delete button.dataset.pmWasDisabled;}});
}
async function moveProcurementMethod(id,delta){if(!currentIsAdmin)return false;const cat=procurementCatalog();const visible=procurementManagerRows(cat).map(m=>m.id);return procurementMutation(()=>api('POST','/api/procurement-methods/reorder',{ids:procurementReorderedIds(cat,visible,id,delta),revision:cat.revision}));}
async function toggleProcurementMethod(id){if(!currentIsAdmin)return false;const m=procurementCatalog().methods.find(m=>m.id===id);return procurementMutation(()=>api('PATCH','/api/procurement-methods/'+id,{revision:m.revision,enabled:!m.enabled}));}
async function deleteProcurementMethod(id){const m=procurementCatalog().methods.find(m=>m.id===id);if(!currentIsAdmin||m.reference_count)return false;if(!await confirmDialog('删除采购方式',`删除“${m.name}”？已有项目引用的方式只能停用。`,'删除','btn-danger'))return false;return procurementMutation(()=>api('DELETE','/api/procurement-methods/'+id,{revision:m.revision}),{deletedId:id});}
function showProcurementMethodForm(id=null,{view='settings',stageId=null}={}){
    const existing=procurementCatalog().methods.find(m=>m.id===id);
    const m=existing||{name:'',enabled:true,quantity_rule:{mode:'unfixed',minimum:null},notes:'',exceptions:[],template_mode:'common',stages:[]};
    const form=procurementForm={id,saving:false,closed:false,revision:existing?m.revision:procurementCatalog().revision,exceptions:JSON.parse(JSON.stringify(m.exceptions||[])),stageState:createStageEditorState(m.template_mode==='independent'?m.stages:procurementCatalog().common_stages),baseline:null,view};
    const html=`<div class="procurement-form" id="pmForm"><div id="pmFormError" class="form-error" role="alert" tabindex="-1" hidden></div><div id="pmSaveStatus" class="settings-note" role="status" hidden></div><div class="procurement-form-tabs" role="group" aria-label="采购方式编辑内容"><button type="button" class="btn btn-secondary" data-pm-view="settings" aria-controls="pmSettingsPanel" onclick="switchProcurementFormView('settings')">基本设置</button><button type="button" class="btn btn-secondary" data-pm-view="flow" aria-controls="pmFlowPanel" onclick="switchProcurementFormView('flow')">流程阶段</button></div><span id="pmDraftStatus" class="procurement-draft-status" role="status"></span><aside id="pmIdentityConflict" class="procurement-identity-conflict" role="status" hidden></aside><section id="pmSettingsPanel" class="procurement-settings-panel" aria-label="采购方式基本设置"><div class="form-group"><label for="pmName">采购方式名称 *</label><input id="pmName" maxlength="60" value="${escHtml(m.name)}"></div><div class="form-group"><label for="pmQuantityMode">默认供应商数量规则</label><select id="pmQuantityMode" onchange="syncProcurementForm()"><option value="unfixed" ${m.quantity_rule.mode==='unfixed'?'selected':''}>不固定最低数量</option><option value="fixed" ${m.quantity_rule.mode==='fixed'?'selected':''}>配置最低数量</option></select></div><div class="form-group" id="pmMinimumGroup"><label for="pmMinimum">配置最低数量（家）</label><input type="text" inputmode="numeric" id="pmMinimum" value="${m.quantity_rule.minimum??''}"><small>仅作业务预警；不直接判定法定最低数量或自动流标。</small></div><details><summary>例外情形及说明</summary><div id="pmExceptions"></div>${currentIsAdmin?'<button type="button" class="btn btn-secondary btn-sm" onclick="addProcurementException()">新增例外</button>':''}</details><div class="procurement-flow-summary"><strong>新项目默认流程</strong><p id="pmBasicFlowSummary"></p><button type="button" class="btn btn-secondary btn-sm" onclick="switchProcurementFormView('flow')">${currentIsAdmin?'编辑流程':'查看流程'}</button></div><div class="form-group"><label for="pmNotes">备注</label><textarea id="pmNotes" maxlength="2000">${escHtml(m.notes)}</textarea></div><label class="procurement-check"><input type="checkbox" id="pmEnabled" ${m.enabled?'checked':''}>启用此采购方式</label></section><section id="pmFlowPanel" aria-label="新项目默认流程"><div class="procurement-flow-head"><div><h3 id="pmFlowHeading">${escHtml(m.name||'新采购方式')} · 默认流程</h3><p id="pmFlowContext" class="procurement-flow-context"></p><p class="settings-note">保存只影响后续新建项目。选择阶段后，可直接修改名称、图标和业务模块。</p></div><label class="procurement-template-choice" for="pmTemplateMode">流程来源<select id="pmTemplateMode" onchange="syncProcurementForm()"><option value="common" ${m.template_mode==='common'?'selected':''}>使用通用默认流程</option><option value="independent" ${m.template_mode==='independent'?'selected':''}>使用独立流程</option></select></label></div><p id="pmFlowRelation" class="settings-note"></p><div id="pmCommonFlow" class="procurement-common-flow"></div><div id="pmStages"></div></section></div>`;
    showModal(existing?'编辑采购方式':'新增采购方式',html,currentIsAdmin?saveProcurementMethodForm:null,{wide:view==='flow',saveLabel:view==='flow'?'保存流程':'保存采购方式',beforeClose:()=>confirmProcurementFormClose(form)});
    form.root=document.getElementById('pmForm');
    form.root.addEventListener('input',()=>{globalThis.PMForms?.clearErrors?.(form.root);form.root.querySelectorAll('[aria-invalid]').forEach(e=>e.removeAttribute('aria-invalid'));syncProcurementFormIdentity();});form.root.addEventListener('change',e=>{if(e.target.matches('[data-exception-field=mode]'))syncProcurementExceptionMode(e.target);syncProcurementFormIdentity();});
    if(!currentIsAdmin)document.querySelectorAll('#pmForm input,#pmForm select,#pmForm textarea,#pmForm details button').forEach(el=>el.disabled=true);
    renderProcurementExceptions();syncProcurementForm();switchProcurementFormView(view);form.baseline=procurementFormSignature();syncProcurementFormIdentity();if(stageId)focusProcurementStage(stageId);
}
function procurementFormSignature(){
    const fields=['pmName','pmQuantityMode','pmMinimum','pmNotes','pmEnabled','pmTemplateMode'];
    return JSON.stringify({fields:fields.map(id=>{const el=document.getElementById(id);return [id,el?.type==='checkbox'?el.checked:el?.value];}),exceptions:collectProcurementExceptions(),stages:procurementForm?.stageState.rows});
}
function switchProcurementFormView(view){
    if(!procurementForm)return;procurementForm.view=view==='flow'?'flow':'settings';const flow=procurementForm.view==='flow';
    document.getElementById('pmSettingsPanel').hidden=flow;document.getElementById('pmFlowPanel').hidden=!flow;
    document.querySelectorAll('[data-pm-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pmView===procurementForm.view)));
    document.getElementById('modal')?.classList.toggle('modal-wide',flow);document.getElementById('modal')?.classList.toggle('procurement-flow-modal',flow);
    const title=document.getElementById('modalTitle');if(title)title.textContent=flow?((currentIsAdmin?'编辑流程 · ':'查看流程 · ')+(document.getElementById('pmName').value.trim()||'新采购方式')):procurementForm.id?'编辑采购方式':'新增采购方式';
    const save=document.getElementById('modalSaveBtn');if(save&&!save.disabled)save.textContent=flow?'保存流程':'保存采购方式';
    syncProcurementFormIdentity();document.getElementById('modalBody').scrollTop=0;
    const summary=document.getElementById('pmBasicFlowSummary');if(summary)summary.textContent=(document.getElementById('pmTemplateMode').value==='common'?'通用默认流程':'独立流程')+' · '+(document.getElementById('pmTemplateMode').value==='common'?procurementCatalog().common_stages:procurementForm.stageState.rows).length+' 个阶段';
}
function isProcurementFormActive(form){return !!form&&!form.closed&&procurementForm===form&&document.getElementById('pmForm')===form.root;}
async function confirmProcurementFormClose(form=procurementForm){
    if(!isProcurementFormActive(form))return true;
    const allowed=form.saving?await confirmDialog('离开正在保存的窗口','保存请求已发出，离开不会撤销已提交的内容；本窗口尚未提交的修改将被放弃。','离开窗口'):
        procurementFormSignature()===form.baseline||await confirmDialog('放弃未保存内容','采购方式的修改尚未保存，是否放弃？','放弃修改');
    if(allowed)form.closed=true;return allowed;
}
function focusProcurementField(target,message){
    switchProcurementFormView('settings');const field=typeof target==='string'?document.getElementById(target):target;if(!field)return;
    let details=field.closest('details');while(details){details.open=true;details=details.parentElement?.closest('details');}
    if(message&&globalThis.PMForms?.showErrors){globalThis.PMForms.showErrors(procurementForm.root,{[field.id]:message});document.getElementById('pmFormError').hidden=true;}
    else {field.setAttribute('aria-invalid','true');field.focus();field.scrollIntoView?.({block:'nearest'});}
}
function procurementIdentityConflict(){
    const name=document.getElementById('pmName')?.value.trim(),current=procurementCatalog().methods.find(m=>m.id===procurementForm?.id);
    return current?.name===name?null:procurementManagerRows(procurementCatalog()).find(m=>m.id!==procurementForm?.id&&m.name===name);
}
function syncProcurementFormIdentity(){
    if(!procurementForm||!document.getElementById('pmForm'))return;
    const name=document.getElementById('pmName').value.trim()||'新采购方式';
    document.getElementById('pmFlowHeading').textContent=name+' · 默认流程';
    document.getElementById('pmFlowContext').textContent='默认流程只用于后续新项目';
    const dirty=procurementForm.baseline!==null&&procurementFormSignature()!==procurementForm.baseline;
    document.getElementById('pmDraftStatus').textContent=dirty?'有未保存的修改':'';
    const conflict=procurementIdentityConflict(),host=document.getElementById('pmIdentityConflict');host.hidden=!conflict;
    if(!conflict){host.innerHTML='';document.getElementById('pmName').removeAttribute('aria-invalid');return;}
    const currentRows=document.getElementById('pmTemplateMode').value==='common'?procurementCatalog().common_stages:procurementForm.stageState.rows;
    const existingRows=conflict.template_mode==='common'?procurementCatalog().common_stages:conflict.stages||[];
    const list=rows=>`<ol>${rows.map(r=>`<li>${escHtml(r.name)}</li>`).join('')||'<li>暂无阶段</li>'}</ol>`;
    host.innerHTML=`<strong>已存在同名方式，请修改名称后保存</strong><p>停用会保留名称。可修改当前名称，或返回列表更名现有方式；不会自动合并或覆盖项目。</p><p>现有同名方式：${escHtml(conflict.name)} · ${conflict.enabled?'启用':'已停用'} · ${conflict.reference_count||0} 处引用。</p><details><summary>对比当前流程与现有同名方式流程</summary><div class="procurement-conflict-comparison"><section><h4>正在编辑的流程</h4>${list(currentRows)}</section><section><h4>现有同名方式流程</h4>${list(existingRows)}</section></div></details><div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="focusProcurementField('pmName')">修改当前名称</button></div>`;
}
function renderCommonFlowConsumers(){
    const consumers=procurementCatalog().methods.filter(m=>m.template_mode==='common'&&m.user_owned!==false);if(!consumers.length)return '';
    return `<details class="procurement-common-consumers" data-common-consumers><summary>共用该通用流程的采购方式（${consumers.length}）</summary><ul>${consumers.map(m=>`<li>${escHtml(procurementDisplayName(m))}${m.enabled?'':' · 已停用'}</li>`).join('')||'<li>暂无采购方式引用</li>'}</ul></details>`;
}
function syncProcurementForm(){
    if(!procurementForm)return;document.getElementById('pmMinimumGroup').hidden=document.getElementById('pmQuantityMode').value!=='fixed';
    const independent=document.getElementById('pmTemplateMode').value==='independent',host=document.getElementById('pmStages'),common=document.getElementById('pmCommonFlow');
    host.hidden=!independent;common.hidden=independent;
    document.getElementById('pmFlowRelation').textContent=independent?'独立副本只修改当前采购方式；已有项目保留原记录。':'通用流程为共享模板，只用于后续新项目，已有项目记录不变。';
    if(independent)refreshSharedStageEditor('method');
    else {host.innerHTML='';const stages=procurementCatalog().common_stages;common.innerHTML=`<header class="procurement-common-head"><div><h4>通用默认流程 <span>${stages.length} 个阶段</span></h4><p>当前为只读预览。复制后可单独调整此采购方式，通用模板保持原样。</p></div>${currentIsAdmin?'<button type="button" class="btn btn-primary" onclick="useIndependentProcurementFlow()">复制为独立流程并编辑</button>':''}</header><ol class="procurement-common-preview">${stages.map((s,index)=>`<li data-common-stage="${escHtml(s.id)}" tabindex="-1"><span class="stage-order-position">${index+1}</span><span data-ui-icon="${escHtml(s.icon||'📌')}"></span><span class="procurement-stage-copy"><strong>${escHtml(s.name)}</strong><small>${escHtml(stageEditorModuleNames(s))}</small></span></li>`).join('')}</ol>${renderCommonFlowConsumers()}`;window.PMIcons?.render?.(common);}

}
async function useIndependentProcurementFlow(){
    const form=procurementForm;if(!currentIsAdmin||!isProcurementFormActive(form)||form.saving)return false;
    const common=procurementCatalog().common_stages,signature=procurementFormSignature();
    if(JSON.stringify(form.stageState.rows)!==JSON.stringify(common)){
        if(!await confirmDialog('复制通用流程','当前存在不同的独立流程草稿。复制会替换该草稿；取消可保留并通过流程来源返回独立流程。','复制并替换草稿'))return false;
        if(!isProcurementFormActive(form)||form.saving||signature!==procurementFormSignature())return false;
        form.stageState=createStageEditorState(common);form.stageState.dirty=true;
    }
    document.getElementById('pmTemplateMode').value='independent';syncProcurementForm();syncProcurementFormIdentity();return true;
}
function renderProcurementExceptions(){
    const h=document.getElementById('pmExceptions');if(!h)return;
    h.innerHTML=procurementForm.exceptions.map((e,i)=>`<fieldset class="procurement-exception" data-exception-index="${i}" ${currentIsAdmin?'':'disabled'}><legend>例外 ${i+1}</legend><label>情形名称<input id="pmExceptionTitle${i}" data-exception-field="title" maxlength="60" value="${escHtml(e.title)}"></label><label>适用说明<textarea id="pmExceptionDescription${i}" data-exception-field="description" maxlength="2000">${escHtml(e.description)}</textarea></label><label>数量规则<select data-exception-field="mode" onchange="syncProcurementExceptionMode(this)"><option value="unfixed" ${e.quantity_rule.mode==='unfixed'?'selected':''}>不固定最低数量</option><option value="fixed" ${e.quantity_rule.mode==='fixed'?'selected':''}>配置最低数量</option></select></label><label data-exception-minimum ${e.quantity_rule.mode==='fixed'?'':'hidden'}>最低数量<input id="pmExceptionMinimum${i}" type="text" inputmode="numeric" data-exception-field="minimum" value="${e.quantity_rule.minimum??''}"></label><label class="procurement-check"><input type="checkbox" data-exception-field="enabled" ${e.enabled?'checked':''}>启用</label>${currentIsAdmin?`<button type="button" class="btn btn-secondary btn-sm" onclick="removeProcurementException(${i})">移除例外</button>`:''}</fieldset>`).join('');
}
function syncProcurementExceptionMode(field){const row=field.closest('[data-exception-index]');if(row)row.querySelector('[data-exception-minimum]').hidden=field.value!=='fixed';}
function collectProcurementExceptions(){return [...document.querySelectorAll('[data-exception-index]')].map((el,i)=>{const field=k=>el.querySelector(`[data-exception-field="${k}"]`);const mode=field('mode').value;return {...(procurementForm.exceptions[i].id?{id:procurementForm.exceptions[i].id}:{}),title:field('title').value.trim(),description:field('description').value.trim(),enabled:field('enabled').checked,quantity_rule:{mode,minimum:mode==='fixed'?Number(field('minimum').value):null}};});}
function addProcurementException(){if(!currentIsAdmin)return;procurementForm.exceptions=collectProcurementExceptions();if(procurementForm.exceptions.length>=20){toast('最多20条例外','warning');return;}procurementForm.exceptions.push({title:'',description:'',enabled:true,quantity_rule:{mode:'unfixed',minimum:null}});renderProcurementExceptions();syncProcurementFormIdentity();}
function removeProcurementException(i){if(!currentIsAdmin)return;procurementForm.exceptions=collectProcurementExceptions();procurementForm.exceptions.splice(i,1);renderProcurementExceptions();syncProcurementFormIdentity();}
function validateProcurementForm(value){
    const invalid=(message,field)=>{throw Object.assign(new Error(message),{field});};
    if(!value.name||value.name.length>60)invalid('请填写60字以内的采购方式名称','pmName');
    if(value.notes.length>2000)invalid('备注不能超过2000字','pmNotes');
    if(value.quantity_rule.mode==='fixed'&&(!Number.isInteger(value.quantity_rule.minimum)||value.quantity_rule.minimum<1||value.quantity_rule.minimum>99))invalid('配置最低数量须为1至99的整数','pmMinimum');
    value.exceptions.forEach((e,i)=>{if(!e.title||e.title.length>60)invalid(`请填写例外 ${i+1} 的情形名称（60字以内）`,'pmExceptionTitle'+i);if(!e.description||e.description.length>2000)invalid(`请填写例外 ${i+1} 的适用说明（2000字以内）`,'pmExceptionDescription'+i);if(e.quantity_rule.mode==='fixed'&&(!Number.isInteger(e.quantity_rule.minimum)||e.quantity_rule.minimum<1||e.quantity_rule.minimum>99))invalid(`例外 ${i+1} 的最低数量须为1至99的整数`,'pmExceptionMinimum'+i);});
}
async function saveProcurementMethodForm(){
    const form=procurementForm;if(!currentIsAdmin||!isProcurementFormActive(form)||form.saving)return false;
    const err=document.getElementById('pmFormError'),status=document.getElementById('pmSaveStatus'),submittedSignature=procurementFormSignature();err.hidden=true;
    if(form.savedSignature===submittedSignature){
        if(form.needsRefresh&&!await retryProcurementCatalogRefresh())return false;
        if(!isProcurementFormActive(form))return true;if(procurementFormSignature()!==submittedSignature)return false;closeModal();return true;
    }
    globalThis.PMForms?.clearErrors?.(form.root);
    try{
        const mode=document.getElementById('pmQuantityMode').value;
        const value={name:document.getElementById('pmName').value.trim(),enabled:document.getElementById('pmEnabled').checked,quantity_rule:{mode,minimum:mode==='fixed'?Number(document.getElementById('pmMinimum').value):null},notes:document.getElementById('pmNotes').value,exceptions:collectProcurementExceptions(),template_mode:document.getElementById('pmTemplateMode').value,revision:form.revision};
        if(value.template_mode==='independent')value.stages=JSON.parse(JSON.stringify(form.stageState.rows));
        validateProcurementForm(value);
        if(procurementIdentityConflict()){syncProcurementFormIdentity();throw Object.assign(new Error('已存在同名采购方式，请处理名称；原流程草稿已保留。'),{field:'pmName'});}
        form.saving=true;status.hidden=false;status.textContent='正在保存。离开窗口不会撤销已提交内容。';
        const saved=await api(form.id?'PATCH':'POST','/api/procurement-methods'+(form.id?'/'+form.id:''),value);
        acceptProcurementResponse({...saved,method:{...value,...saved.method}});
        if(isProcurementFormActive(form)){form.id=saved.method.id;form.revision=saved.method.revision;form.savedSignature=submittedSignature;form.baseline=submittedSignature;procurementManagerSelection=form.id;}
        refreshProcurementManager();
        try{await loadProcurementCatalog({refresh:true});procurementNeedsRefresh=false;refreshProcurementManager();}
        catch(e){showProcurementRefreshWarning();if(isProcurementFormActive(form)){form.needsRefresh=true;status.hidden=false;status.innerHTML=procurementRefreshNotice();syncProcurementFormIdentity();return false;}toast('内容已保存，列表暂未刷新。','warning');return true;}
        if(!isProcurementFormActive(form))return true;form.needsRefresh=false;
        if(procurementFormSignature()!==submittedSignature){err.hidden=false;err.textContent='提交的内容已保存，保存期间的新修改仍在表单中，请继续保存。';syncProcurementFormIdentity();return false;}
        form.saving=false;closeModal();toast('采购方式已保存','success');return true;
    }catch(e){
        if(isProcurementFormActive(form)){err.hidden=false;err.textContent=e.message;if(e.field)focusProcurementField(e.field,e.message);else err.focus?.();}
        return false;
    }finally{form.saving=false;if(isProcurementFormActive(form))status.hidden=!form.needsRefresh;}
}
function syncNewProjectMethod(){const select=document.getElementById('npMethod'),host=document.getElementById('npFlowPreview');if(!select||!host)return;const m=procurementCatalog().methods.find(m=>m.id===select.value);host.textContent=m?`${m.template_mode==='common'?'通用':'独立'}流程：${(m.template_mode==='independent'?m.stages:procurementCatalog().common_stages).map(s=>s.name).join(' → ')}`:'请先选择已启用的采购方式，可在系统设置中自行新增。';}
function isOnlineProcurementProject(p){return p?.procurement?.builtin_kind==='网上竞价'||p?.online_bidding_enabled===true||(p?.stages||[]).some(s=>(s.modules||[]).includes('online_bidding'))||(!p?.procurement&&p?.method==='网上竞价');}

function focusProcurementStage(id){const form=procurementForm;if(!form)return;const independent=document.getElementById('pmTemplateMode').value==='independent';if(form.stageState.rows.some(s=>s.id===id))form.stageState.selectedId=id;if(independent){selectStageEditorStage('method',id);stageEditorHost('method')?.querySelector('[data-flow-select][aria-pressed="true"]')?.scrollIntoView?.({block:'nearest'});}else{const row=[...document.querySelectorAll('.procurement-common-preview li')].find(e=>e.dataset.commonStage===id);row?.setAttribute('aria-current','step');row?.scrollIntoView?.({block:'nearest'});row?.focus();}}

function procurementAvailability(m){return m.enabled?'启用':'已停用';}
