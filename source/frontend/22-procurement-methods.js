// ── Stable procurement method catalog and themed management ──
var PROCUREMENT_REGIMES = Object.freeze({government_procurement:'政府采购',mandatory_construction_bidding:'依法必须招标的工程建设项目',enterprise:'企业及国有企业自主采购',collective:'集体经济组织采购',other:'其他采购'});
let procurementCatalogRequest=null;
let procurementManagerRegime='all';
let procurementForm=null;
let procurementManagerSelection=null;
function procurementCatalog(){return (typeof systemSettings!=='undefined'?systemSettings?.procurement_catalog:null) || {revision:0,methods:[],common_stages:[]};}
async function loadProcurementCatalog({refresh=false}={}){
    if(!refresh&&procurementCatalog().methods.length)return procurementCatalog();
    if(!procurementCatalogRequest)procurementCatalogRequest=api('GET','/api/procurement-methods').then(value=>{systemSettings=systemSettings||{};systemSettings.procurement_catalog=value;return value;}).finally(()=>{procurementCatalogRequest=null;});
    return procurementCatalogRequest;
}
function procurementMethodOptions({purpose='create',project=null,regime=null}={}){
    const current=project?.procurement?.method_id;
    return procurementCatalog().methods.filter(m=>(!regime||m.regime===regime)&&(purpose==='history'||(m.enabled&&m.regime)||(purpose==='change'&&m.id===current)));
}
function procurementMethodLabel(m){return `${m.name} · ${PROCUREMENT_REGIMES[m.regime]||'待确认制度'}${m.enabled?'':' · 已停用'}`;}
function procurementProjectKey(p){return p?.procurement?.method_id||`legacy:${p?.method||''}`;}
function procurementProjectLabel(p){const r=p?.procurement;return r?`${p.method||r.name_snapshot} · ${PROCUREMENT_REGIMES[r.regime]||'待确认制度'}`:p?.method||'未设置';}
function procurementSelectOptions(project=null,purpose='create'){
    const current=project?.procurement?.method_id;
    let rows=procurementMethodOptions({purpose,project});
    return (!current&&project?`<option value="">${escHtml(project.method||'未设置')}（保留历史）</option>`:'<option value="">请选择采购方式</option>')+rows.map(m=>`<option value="${escHtml(m.id)}" ${m.id===current?'selected':''}>${escHtml(procurementMethodLabel(m))}</option>`).join('');
}
function procurementSelectionPayload(id,project=null){return id?{procurement_method_id:id}:{...(project?{method:project.method}:{procurement_method_id:''})};}
function renderProcurementReference(method){
    const ref=method?.reference_preset;if(!ref)return '';
    const links=(ref.sources||[]).map(source=>{try{const url=new URL(source.url);if(url.protocol!=='https:'||!url.hostname.endsWith('.gov.cn'))return '';return `<a href="${escHtml(url.href)}" target="_blank" rel="noopener noreferrer">${escHtml(source.title)}</a>`;}catch{return '';}}).filter(Boolean).join('');
    return `<details class="procurement-reference"><summary>${ref.kind==='national_reference'?'国家参考预设':'通用管理参考'}${ref.customized?' · 已调整':''}</summary><p>${escHtml(ref.scope||'')}</p>${ref.customized?'<small>已由管理员调整；以下为初始参考依据，当前配置请结合实际核对。</small>':''}<small>依据核对日期：${escHtml(ref.checked_on||'')}；未加入地方规则。</small><div class="procurement-reference-links">${links}</div></details>`;
}
function procurementReorderedIds(catalog,visible,id,delta){const ids=catalog.methods.map(m=>m.id);const at=visible.indexOf(id),next=at+delta;if(at<0||next<0||next>=visible.length)return ids;const a=ids.indexOf(id),b=ids.indexOf(visible[next]);[ids[a],ids[b]]=[ids[b],ids[a]];return ids;}
function procurementManagerRows(catalog){const rows=catalog.methods.filter(m=>procurementManagerRegime==='all'||(procurementManagerRegime==='pending'?!m.regime:m.regime===procurementManagerRegime));if(procurementManagerRegime==='all'){const order=Object.keys(PROCUREMENT_REGIMES);rows.sort((a,b)=>(a.regime?order.indexOf(a.regime):order.length)-(b.regime?order.indexOf(b.regime):order.length));}return rows;}
function canMoveProcurementRow(rows,index,delta){const next=rows[index+delta];return !!next&&next.regime===rows[index].regime;}
function procurementOverview(m,rows,catalog,edit){
    if(!m)return '<section data-procurement-overview class="procurement-overview"><p class="muted-text">暂无采购方式，请先新增。</p></section>';
    const stages=m.template_mode==='common'?catalog.common_stages:m.stages||[],i=rows.findIndex(x=>x.id===m.id);
    return `<section data-procurement-overview data-method-id-detail="${escHtml(m.id)}" class="procurement-overview"><header class="procurement-overview-head"><div><p class="procurement-flow-context">${escHtml(PROCUREMENT_REGIMES[m.regime]||'待确认制度 · 保留原配置')}</p><h3>${escHtml(m.name)} <span class="procurement-status">${m.enabled?'启用':'已停用'}</span></h3><p>${stages.length} 个阶段 · ${m.template_mode==='common'?'通用默认流程':'独立流程'} · ${m.quantity_rule.mode==='unfixed'?'不固定最低数量':`配置最低 ${m.quantity_rule.minimum} 家`}</p></div><div class="procurement-overview-edit"><button type="button" class="btn btn-primary btn-sm" onclick="showProcurementMethodForm('${m.id}',{view:'flow'})">${edit?'编辑流程':'查看流程'}</button><button type="button" class="btn btn-secondary btn-sm" onclick="showProcurementMethodForm('${m.id}')">${edit?'基本设置':'查看设置'}</button></div></header><p class="settings-note">${edit?'点击阶段可定位编辑。':''}默认流程仅用于后续新项目，已有项目保留原阶段和完成记录。</p><ol class="procurement-stage-overview">${stages.map((stage,index)=>`<li><button type="button" data-overview-stage="${escHtml(stage.id)}" onclick="showProcurementMethodForm('${m.id}',{view:'flow',stageId:'${escHtml(stage.id)}'})"><span class="stage-order-position">${index+1}</span><span data-ui-icon="${escHtml(stage.icon||'📌')}"></span><span class="procurement-stage-copy"><strong>${escHtml(stage.name)}</strong><small>${escHtml(stageEditorModuleNames(stage))}</small></span><span class="procurement-stage-open" aria-hidden="true">›</span></button></li>`).join('')||'<li>暂无阶段，请编辑流程补充。</li>'}</ol>${renderProcurementReference(m)}${m.notes?`<details class="procurement-method-notes"><summary>备注</summary><p>${escHtml(m.notes)}</p></details>`:''}<small>${m.reference_count||0} 个项目或采购包引用</small>${edit?`<div class="procurement-method-actions"><button class="btn btn-secondary btn-sm" onclick="moveProcurementMethod('${m.id}',-1)" ${canMoveProcurementRow(rows,i,-1)?'':'disabled'}>上移</button><button class="btn btn-secondary btn-sm" onclick="moveProcurementMethod('${m.id}',1)" ${canMoveProcurementRow(rows,i,1)?'':'disabled'}>下移</button><button class="btn btn-secondary btn-sm" onclick="toggleProcurementMethod('${m.id}')">${m.enabled?'停用':'启用'}</button><button class="btn btn-danger btn-sm" onclick="deleteProcurementMethod('${m.id}')" ${m.reference_count?'disabled title="已有项目引用，请通过停用处理"':''}>删除</button></div>`:''}</section>`;
}
function renderProcurementMethodManager(catalog=procurementCatalog()){
    const rows=procurementManagerRows(catalog),edit=currentIsAdmin===true;
    const selected=rows.find(m=>m.id===procurementManagerSelection)||rows[0];procurementManagerSelection=selected?.id||null;
    return `<section class="settings-card settings-card-wide procurement-manager"><div class="settings-card-head"><div><h2>采购方式与流程</h2><p>按制度查看采购方式，选择阶段进入编辑。默认流程只影响新项目。</p></div>${edit?'<button type="button" class="btn btn-primary btn-sm" onclick="showProcurementMethodForm()">新增采购方式</button>':''}</div>
    <label class="procurement-filter">适用制度<select aria-label="筛选采购制度" onchange="selectProcurementManagerRegime(this.value)">${[['all','全部制度'],...Object.entries(PROCUREMENT_REGIMES),['pending','待确认制度 · 原配置']].map(([key,label])=>`<option value="${key}" ${key===procurementManagerRegime?'selected':''}>${label}</option>`).join('')}</select></label>
    ${catalog.preset_summary?.capacity_pending?`<p class="settings-note">尚有 ${catalog.preset_summary.capacity_pending} 项参考预设未添加，现有配置已保留。</p>`:''}
    <div class="procurement-workspace" data-procurement-workspace><nav class="procurement-method-list" aria-label="采购方式">${rows.map((m,i)=>`${procurementManagerRegime==='all'&&(i===0||rows[i-1].regime!==m.regime)?`<h3 class="procurement-regime-heading">${escHtml(PROCUREMENT_REGIMES[m.regime]||'待确认制度 · 保留原配置')}</h3>`:''}<article class="procurement-method-row" data-method-id="${escHtml(m.id)}"><button type="button" class="procurement-method-select" aria-pressed="${m.id===selected?.id}" aria-controls="procurementOverviewPanel" onclick="selectProcurementManagerMethod('${m.id}')"><strong>${escHtml(m.name)}</strong><small>${m.template_mode==='common'?'通用默认流程':'独立流程'} · ${(m.template_mode==='common'?catalog.common_stages:m.stages||[]).length} 阶段 · ${m.enabled?'启用':'已停用'}</small></button></article>`).join('')||'<p class="muted-text">暂无采购方式。</p>'}</nav><div id="procurementOverviewPanel">${procurementOverview(selected,rows,catalog,edit)}</div></div>
    <div class="settings-actions"><button class="btn btn-secondary btn-sm" onclick="showCommonProcurementFlow()">${edit?'编辑':'查看'}通用默认流程</button><button class="btn btn-secondary btn-sm" onclick="showGuaranteeDefaults()">新项目保证金退还规则</button></div></section>`;
}
function selectProcurementManagerMethod(id){const scroll=document.querySelector('.procurement-method-list')?.scrollTop||0;procurementManagerSelection=id;refreshProcurementManager();const list=document.querySelector('.procurement-method-list');if(list)list.scrollTop=scroll;const item=document.querySelector(`[data-method-id="${id}"] .procurement-method-select`);if(item&&list){const a=item.getBoundingClientRect(),b=list.getBoundingClientRect();if(a.top<b.top)list.scrollTop-=b.top-a.top;else if(a.bottom>b.bottom)list.scrollTop+=a.bottom-b.bottom;}item?.focus({preventScroll:true});}
function refreshProcurementManager(){const host=document.getElementById('catalogManagerHost');if(host){host.innerHTML=renderProcurementMethodManager();window.PMIcons?.render?.(host);globalThis.PMForms?.enhance?.(host);}if(typeof ensureSidebarMethodFilter==='function')ensureSidebarMethodFilter();}
function selectProcurementManagerRegime(value){procurementManagerRegime=value;refreshProcurementManager();}
async function procurementMutation(fn){try{await fn();await loadProcurementCatalog({refresh:true});refreshProcurementManager();toast('已保存','success');return true;}catch(e){toast(e.message,'error');return false;}}
async function moveProcurementMethod(id,delta){if(!currentIsAdmin)return false;const cat=procurementCatalog(),target=cat.methods.find(m=>m.id===id);const visible=procurementManagerRows(cat).filter(m=>m.regime===target?.regime).map(m=>m.id);return procurementMutation(()=>api('POST','/api/procurement-methods/reorder',{ids:procurementReorderedIds(cat,visible,id,delta),revision:cat.revision}));}
async function toggleProcurementMethod(id){if(!currentIsAdmin)return false;const m=procurementCatalog().methods.find(m=>m.id===id);return procurementMutation(()=>api('PATCH','/api/procurement-methods/'+id,{revision:m.revision,enabled:!m.enabled}));}
async function deleteProcurementMethod(id){const m=procurementCatalog().methods.find(m=>m.id===id);if(!currentIsAdmin||m.reference_count)return false;if(!await confirmDialog('删除采购方式',`删除“${m.name}”？已有项目引用的方式只能停用。`,'删除','btn-danger'))return false;return procurementMutation(()=>api('DELETE','/api/procurement-methods/'+id,{revision:m.revision}));}
function showProcurementMethodForm(id=null,{view='settings',stageId=null}={}){
    const existing=procurementCatalog().methods.find(m=>m.id===id);
    const m=existing||{name:'',regime:'',enabled:true,quantity_rule:{mode:'unfixed',minimum:null},notes:'',exceptions:[],template_mode:'common',stages:[]};
    const form=procurementForm={id,legacyPending:!!existing&&!m.regime,saving:false,closed:false,revision:existing?m.revision:procurementCatalog().revision,exceptions:JSON.parse(JSON.stringify(m.exceptions||[])),stageState:createStageEditorState(m.template_mode==='independent'?m.stages:procurementCatalog().common_stages),baseline:null,view};
    const html=`<div class="procurement-form" id="pmForm"><div id="pmFormError" class="form-error" role="alert" tabindex="-1" hidden></div><div id="pmSaveStatus" class="settings-note" role="status" hidden></div><div class="procurement-form-tabs" role="group" aria-label="采购方式编辑内容"><button type="button" class="btn btn-secondary" data-pm-view="settings" aria-controls="pmSettingsPanel" onclick="switchProcurementFormView('settings')">基本设置</button><button type="button" class="btn btn-secondary" data-pm-view="flow" aria-controls="pmFlowPanel" onclick="switchProcurementFormView('flow')">流程阶段</button></div><span id="pmDraftStatus" class="procurement-draft-status" role="status"></span><aside id="pmIdentityConflict" class="procurement-identity-conflict" role="status" hidden></aside><section id="pmSettingsPanel" class="procurement-settings-panel" aria-label="采购方式基本设置">${renderProcurementReference(m)}<div class="form-group"><label for="pmName">采购方式名称 *</label><input id="pmName" maxlength="60" value="${escHtml(m.name)}"></div><div class="form-group"><label for="pmRegime">适用采购制度${form.legacyPending?'（新项目使用前确认）':' *'}</label><select id="pmRegime"><option value="">请选择适用制度</option>${Object.entries(PROCUREMENT_REGIMES).map(([key,label])=>`<option value="${key}" ${key===m.regime?'selected':''}>${label}</option>`).join('')}</select>${!m.regime&&existing?'<small>旧方式可以保持待确认并维护流程；确认制度后才可用于新项目。分类不会自动改写历史项目。</small>':''}</div><div class="form-group"><label for="pmQuantityMode">默认供应商数量规则</label><select id="pmQuantityMode" onchange="syncProcurementForm()"><option value="unfixed" ${m.quantity_rule.mode==='unfixed'?'selected':''}>不固定最低数量</option><option value="fixed" ${m.quantity_rule.mode==='fixed'?'selected':''}>配置最低数量</option></select></div><div class="form-group" id="pmMinimumGroup"><label for="pmMinimum">配置最低数量（家）</label><input type="text" inputmode="numeric" id="pmMinimum" value="${m.quantity_rule.minimum??''}"><small>仅作业务预警；不直接判定法定最低数量或自动流标。</small></div><details><summary>例外情形及说明</summary><div id="pmExceptions"></div><button class="btn btn-secondary btn-sm" onclick="addProcurementException()">新增例外</button></details><div class="procurement-flow-summary"><strong>新项目默认流程</strong><p id="pmBasicFlowSummary"></p><button type="button" class="btn btn-secondary btn-sm" onclick="switchProcurementFormView('flow')">${currentIsAdmin?'编辑流程':'查看流程'}</button></div><div class="form-group"><label for="pmNotes">备注</label><textarea id="pmNotes" maxlength="2000">${escHtml(m.notes)}</textarea></div><label class="procurement-check"><input type="checkbox" id="pmEnabled" ${m.enabled?'checked':''}>启用此采购方式</label></section><section id="pmFlowPanel" aria-label="新项目默认流程"><div class="procurement-flow-head"><div><h3 id="pmFlowHeading">${escHtml(m.name||'新采购方式')} · 默认流程</h3><p id="pmFlowContext" class="procurement-flow-context"></p><p class="settings-note">保存只影响后续新建项目。选择阶段后，可直接修改名称、图标和业务模块。</p></div><label class="procurement-template-choice" for="pmTemplateMode">流程来源<select id="pmTemplateMode" onchange="syncProcurementForm()"><option value="common" ${m.template_mode==='common'?'selected':''}>使用通用默认流程</option><option value="independent" ${m.template_mode==='independent'?'selected':''}>使用独立流程</option></select></label></div><p id="pmFlowRelation" class="settings-note"></p><div id="pmCommonFlow" class="procurement-common-flow"></div><div id="pmLegacyCopy"></div><div id="pmStages"></div></section></div>`;
    showModal(existing?'编辑采购方式':'新增采购方式',html,currentIsAdmin?saveProcurementMethodForm:null,{wide:view==='flow',saveLabel:view==='flow'?'保存流程':'保存采购方式',beforeClose:()=>confirmProcurementFormClose(form)});
    form.root=document.getElementById('pmForm');
    form.root.addEventListener('input',syncProcurementFormIdentity);form.root.addEventListener('change',syncProcurementFormIdentity);
    if(!currentIsAdmin)document.querySelectorAll('#pmForm input,#pmForm select,#pmForm textarea,#pmForm details button').forEach(el=>el.disabled=true);
    renderProcurementExceptions();syncProcurementForm();switchProcurementFormView(view);form.baseline=procurementFormSignature();syncProcurementFormIdentity();renderLegacyProcurementCopy();if(stageId)focusProcurementStage(stageId);
}
function procurementFormSignature(){
    const fields=['pmName','pmRegime','pmQuantityMode','pmMinimum','pmNotes','pmEnabled','pmTemplateMode'];
    return JSON.stringify({fields:fields.map(id=>{const el=document.getElementById(id);return [id,el?.type==='checkbox'?el.checked:el?.value];}),exceptions:collectProcurementExceptions(),stages:procurementForm?.stageState.rows});
}
function switchProcurementFormView(view){
    if(!procurementForm)return;procurementForm.view=view==='flow'?'flow':'settings';const flow=procurementForm.view==='flow';
    document.getElementById('pmSettingsPanel').hidden=flow;document.getElementById('pmFlowPanel').hidden=!flow;
    document.querySelectorAll('[data-pm-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.pmView===procurementForm.view)));
    document.getElementById('modal')?.classList.toggle('modal-wide',flow);document.getElementById('modal')?.classList.toggle('procurement-flow-modal',flow);
    const title=document.getElementById('modalTitle');if(title)title.textContent=flow?((currentIsAdmin?'编辑流程 · ':'查看流程 · ')+(document.getElementById('pmName').value.trim()||'新采购方式')):procurementForm.id?'编辑采购方式':'新增采购方式';
    renderLegacyProcurementCopy();const save=document.getElementById('modalSaveBtn');if(save&&!save.disabled)save.textContent=flow?'保存流程':'保存采购方式';
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
function focusProcurementField(id){switchProcurementFormView('settings');const field=document.getElementById(id);field?.setAttribute('aria-invalid','true');field?.focus();}
function procurementIdentityConflict(){
    const name=document.getElementById('pmName')?.value.trim(),regime=document.getElementById('pmRegime')?.value;
    return regime&&procurementCatalog().methods.find(m=>m.id!==procurementForm?.id&&m.regime===regime&&m.name===name);
}
function syncProcurementFormIdentity(){
    if(!procurementForm||!document.getElementById('pmForm'))return;
    const name=document.getElementById('pmName').value.trim()||'新采购方式',regime=document.getElementById('pmRegime').value;
    document.getElementById('pmFlowHeading').textContent=name+' · 默认流程';
    document.getElementById('pmFlowContext').textContent=PROCUREMENT_REGIMES[regime]||'待确认制度 · 可维护原流程';
    const dirty=procurementForm.baseline!==null&&procurementFormSignature()!==procurementForm.baseline;
    document.getElementById('pmDraftStatus').textContent=dirty?'有未保存的修改':'';
    const conflict=procurementIdentityConflict(),host=document.getElementById('pmIdentityConflict');host.hidden=!conflict;
    renderLegacyProcurementCopy();if(!conflict){host.innerHTML='';document.getElementById('pmName').removeAttribute('aria-invalid');return;}
    const currentRows=document.getElementById('pmTemplateMode').value==='common'?procurementCatalog().common_stages:procurementForm.stageState.rows;
    const existingRows=conflict.template_mode==='common'?procurementCatalog().common_stages:conflict.stages||[];
    const list=rows=>`<ol>${rows.map(r=>`<li>${escHtml(r.name)}</li>`).join('')||'<li>暂无阶段</li>'}</ol>`;
    host.innerHTML=`<strong>该制度下已有同名方式，保存前需处理名称</strong><p>停用仍会保留名称，不能消除同名冲突。可手动修改当前名称，或返回列表另行更名现有方式；不会自动合并、覆盖或迁移历史项目。</p><p>现有同名方式：${escHtml(conflict.name)} · ${escHtml(PROCUREMENT_REGIMES[conflict.regime])} · ${conflict.enabled?'启用':'已停用'} · ${conflict.reference_count||0} 处引用。</p><details><summary>对比当前流程与现有同名方式流程</summary><div class="procurement-conflict-comparison"><section><h4>正在编辑的流程</h4>${list(currentRows)}</section><section><h4>现有同名方式流程</h4>${list(existingRows)}</section></div></details><div class="settings-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="focusProcurementField('pmName')">修改当前名称</button>${procurementForm.legacyPending?'<button type="button" class="btn btn-secondary btn-sm" onclick="keepLegacyProcurementFlow()">保留待确认并维护旧流程</button>':''}</div>`;
}
function keepLegacyProcurementFlow(){if(!currentIsAdmin||!procurementForm?.legacyPending)return;document.getElementById('pmRegime').value='';syncProcurementFormIdentity();switchProcurementFormView('flow');document.getElementById('pmFormError').hidden=true;}
function renderCommonFlowConsumers(){
    const consumers=procurementCatalog().methods.filter(m=>m.template_mode==='common');
    return `<details class="procurement-common-consumers" data-common-consumers><summary>共用该通用流程的采购方式（${consumers.length}）</summary><ul>${consumers.map(m=>`<li>${escHtml(m.name)} · ${escHtml(PROCUREMENT_REGIMES[m.regime]||'待确认制度')}${m.enabled?'':' · 已停用'}</li>`).join('')||'<li>暂无采购方式引用</li>'}</ul></details>`;
}
function syncProcurementForm(){
    if(!procurementForm)return;document.getElementById('pmMinimumGroup').hidden=document.getElementById('pmQuantityMode').value!=='fixed';
    const independent=document.getElementById('pmTemplateMode').value==='independent',host=document.getElementById('pmStages'),common=document.getElementById('pmCommonFlow');
    host.hidden=!independent;common.hidden=independent;
    document.getElementById('pmFlowRelation').textContent=independent?'独立副本只修改当前采购方式；已有项目保留原记录。':'通用流程是共享模板，修改后用于引用方式的后续新项目；已有项目保持原记录。';
    if(independent)refreshSharedStageEditor('method');
    else {host.innerHTML='';common.innerHTML=`<p class="settings-note">当前沿用共享的通用默认流程。如需仅调整此采购方式，请改用独立流程；通用模板会保持原样。</p><ol class="procurement-common-preview">${procurementCatalog().common_stages.map(s=>`<li data-common-stage="${escHtml(s.id)}" tabindex="0">${escHtml(s.name)}</li>`).join('')}</ol>${renderCommonFlowConsumers()}${currentIsAdmin?'<button type="button" class="btn btn-secondary" onclick="useIndependentProcurementFlow()">改为独立流程并编辑</button>':''}`;}
}
function useIndependentProcurementFlow(){if(!currentIsAdmin)return;document.getElementById('pmTemplateMode').value='independent';syncProcurementForm();syncProcurementFormIdentity();}
function renderProcurementExceptions(){const h=document.getElementById('pmExceptions');if(!h)return;h.innerHTML=procurementForm.exceptions.map((e,i)=>`<fieldset class="procurement-exception" data-exception-index="${i}"><legend>例外 ${i+1}</legend><label>情形名称<input data-exception-field="title" maxlength="80" value="${escHtml(e.title)}"></label><label>适用说明<textarea data-exception-field="description" maxlength="2000">${escHtml(e.description)}</textarea></label><label>数量规则<select data-exception-field="mode"><option value="unfixed" ${e.quantity_rule.mode==='unfixed'?'selected':''}>不固定最低数量</option><option value="fixed" ${e.quantity_rule.mode==='fixed'?'selected':''}>配置最低数量</option></select></label><label>最低数量（固定模式必填）<input type="text" inputmode="numeric" data-exception-field="minimum" value="${e.quantity_rule.minimum??''}"></label><label><input type="checkbox" data-exception-field="enabled" ${e.enabled?'checked':''}>启用</label><button class="btn btn-secondary btn-sm" onclick="removeProcurementException(${i})">移除例外</button></fieldset>`).join('');}
function collectProcurementExceptions(){return [...document.querySelectorAll('[data-exception-index]')].map((el,i)=>{const field=k=>el.querySelector(`[data-exception-field="${k}"]`);const mode=field('mode').value;return {...(procurementForm.exceptions[i].id?{id:procurementForm.exceptions[i].id}:{}),title:field('title').value.trim(),description:field('description').value.trim(),enabled:field('enabled').checked,quantity_rule:{mode,minimum:mode==='fixed'?Number(field('minimum').value):null}};});}
function addProcurementException(){procurementForm.exceptions=collectProcurementExceptions();if(procurementForm.exceptions.length>=20){toast('最多20条例外','warning');return;}procurementForm.exceptions.push({title:'',description:'',enabled:true,quantity_rule:{mode:'unfixed',minimum:null}});renderProcurementExceptions();}
function removeProcurementException(i){procurementForm.exceptions=collectProcurementExceptions();procurementForm.exceptions.splice(i,1);renderProcurementExceptions();}
async function saveProcurementMethodForm(){
    const form=procurementForm;if(!currentIsAdmin||!isProcurementFormActive(form)||form.saving)return false;
    const err=document.getElementById('pmFormError'),status=document.getElementById('pmSaveStatus'),submittedSignature=procurementFormSignature();err.hidden=true;
    try{
        const mode=document.getElementById('pmQuantityMode').value,regime=document.getElementById('pmRegime').value;
        const value={name:document.getElementById('pmName').value.trim(),enabled:document.getElementById('pmEnabled').checked,quantity_rule:{mode,minimum:mode==='fixed'?Number(document.getElementById('pmMinimum').value):null},notes:document.getElementById('pmNotes').value,exceptions:collectProcurementExceptions(),template_mode:document.getElementById('pmTemplateMode').value,revision:form.revision};
        if(regime)value.regime=regime;
        if(value.template_mode==='independent')value.stages=JSON.parse(JSON.stringify(form.stageState.rows));
        if(!value.name)throw Object.assign(new Error('请填写采购方式名称'),{field:'pmName'});
        if(!regime&&!form.legacyPending)throw Object.assign(new Error('请先选择适用采购制度'),{field:'pmRegime'});
        if(procurementIdentityConflict()){syncProcurementFormIdentity();throw Object.assign(new Error('同一采购制度内已有同名方式，请按上方对比说明处理名称；原流程草稿已保留。'),{field:'pmName'});}
        form.saving=true;status.hidden=false;status.textContent='正在保存。离开窗口不会撤销已提交内容。';
        const saved=await api(form.id?'PATCH':'POST','/api/procurement-methods'+(form.id?'/'+form.id:''),value);
        await loadProcurementCatalog({refresh:true});refreshProcurementManager();
        if(!isProcurementFormActive(form))return true;
        form.id=saved.method.id;form.revision=saved.method.revision;
        if(Object.prototype.hasOwnProperty.call(saved.method,'regime'))form.legacyPending=saved.method.regime==null;
        if(procurementFormSignature()!==submittedSignature){form.baseline=submittedSignature;err.hidden=false;err.textContent='提交的内容已保存，保存期间的新修改仍在表单中，请继续保存。';syncProcurementFormIdentity();return false;}
        form.baseline=procurementFormSignature();form.saving=false;closeModal();toast('采购方式已保存','success');return true;
    }catch(e){
        if(isProcurementFormActive(form)){err.hidden=false;err.textContent=e.message;if(e.field)focusProcurementField(e.field);else err.focus?.();}
        return false;
    }finally{form.saving=false;if(isProcurementFormActive(form))status.hidden=true;}
}
function syncNewProjectMethod(){const select=document.getElementById('npMethod'),host=document.getElementById('npFlowPreview');if(!select||!host)return;const m=procurementCatalog().methods.find(m=>m.id===select.value);host.textContent=m?`${m.template_mode==='common'?'通用':'独立'}流程：${(m.template_mode==='independent'?m.stages:procurementCatalog().common_stages).map(s=>s.name).join(' → ')}`:'请先选择采购方式，未确认制度或已停用的方式不用于新项目。';}
function isOnlineProcurementProject(p){return p?.procurement?.builtin_kind==='网上竞价'||p?.online_bidding_enabled===true||(p?.stages||[]).some(s=>(s.modules||[]).includes('online_bidding'))||(!p?.procurement&&p?.method==='网上竞价');}

// Explicit copy into the current draft. Source configuration and projects never change.
function procurementLegacySource(){const name=document.getElementById('pmName')?.value.trim();return procurementCatalog().methods.find(m=>!m.regime&&m.name===name&&m.id!==procurementForm?.id);}
function renderLegacyProcurementCopy(){const host=document.getElementById('pmLegacyCopy');if(!host)return;const source=procurementLegacySource();host.hidden=!source||!document.getElementById('pmRegime')?.value||!currentIsAdmin;host.innerHTML=host.hidden?'':`<details class="procurement-legacy-copy"><summary>沿用之前保存的“${escHtml(source.name)}”流程</summary><p>可将待确认制度下的同名原流程复制到当前草稿；保存后只修改当前采购方式，各制度的副本独立。</p><button type="button" class="btn btn-secondary btn-sm" onclick="copyLegacyProcurementFlow()">复制原有流程到当前草稿</button></details>`;}
async function copyLegacyProcurementFlow(){const form=procurementForm,source=procurementLegacySource();if(!currentIsAdmin||!source||!isProcurementFormActive(form)||form.saving||!document.getElementById('pmRegime').value)return false;const signature=procurementFormSignature();if(!await confirmDialog('复制原有流程',`将“${source.name} · 待确认制度”的阶段复制到当前草稿？当前阶段草稿将被替换，保存前可取消。原配置及已有项目不变。`,'复制到草稿'))return false;if(!isProcurementFormActive(form)||form.saving||signature!==procurementFormSignature())return false;const stages=source.template_mode==='common'?procurementCatalog().common_stages:source.stages;if(!stages?.length){toast('原流程暂无阶段，未替换当前草稿','warning');return false;}form.stageState=createStageEditorState(stages);form.stageState.dirty=true;document.getElementById('pmTemplateMode').value='independent';syncProcurementForm();syncProcurementFormIdentity();return true;}
function focusProcurementStage(id){const form=procurementForm;if(!form)return;const independent=document.getElementById('pmTemplateMode').value==='independent';if(form.stageState.rows.some(s=>s.id===id))form.stageState.selectedId=id;if(independent){selectStageEditorStage('method',id);stageEditorHost('method')?.querySelector('[data-flow-select][aria-pressed="true"]')?.scrollIntoView?.({block:'nearest'});}else{const row=[...document.querySelectorAll('.procurement-common-preview li')].find(e=>e.dataset.commonStage===id);row?.scrollIntoView?.({block:'nearest'});row?.focus();}}
