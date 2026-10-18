// ── Shared stage editor and protected individual project workflow ──
let projectFlowForm=null;
let commonFlowForm=null;
function createStageEditorState(rows){const copy=JSON.parse(JSON.stringify(rows||[]));return {rows:copy,selectedId:copy[0]?.id||null,dirty:false};}
function stageEditorMutate(state,action,id){
    const i=state.rows.findIndex(s=>s.id===id);let changed=false;
    if(action==='add'){
        const row={id:'stage_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,7),name:'新增阶段',icon:'📌',modules:['common','checklist']};
        state.rows.push(row);state.selectedId=row.id;changed=true;
    }else if(action==='remove'&&i>=0&&state.rows.length>1){
        state.rows.splice(i,1);if(state.selectedId===id)state.selectedId=state.rows[Math.min(i,state.rows.length-1)].id;changed=true;
    }else if(['up','down'].includes(action)&&i>=0){
        const j=i+(action==='up'?-1:1);if(j>=0&&j<state.rows.length){[state.rows[i],state.rows[j]]=[state.rows[j],state.rows[i]];changed=true;}
    }
    if(changed)state.dirty=true;return state;
}
function stageEditorOwner(owner){return owner==='method'?procurementForm?.stageState:owner==='common'?commonFlowForm?.state:projectFlowForm?.state;}
function stageEditorHost(owner){return document.getElementById(owner==='method'?'pmStages':owner==='common'?'commonFlowStages':'projectFlowStages');}
function selectStageEditorStage(owner,id){
    const state=stageEditorOwner(owner);if(!state?.rows.some(s=>s.id===id))return;state.selectedId=id;
    refreshSharedStageEditor(owner);stageEditorHost(owner)?.querySelector('[data-flow-select][aria-pressed="true"]')?.focus({preventScroll:true});
}
function stageEditorAction(owner,action,id){
    const state=stageEditorOwner(owner);if(!state||(owner!=='project'&&!currentIsAdmin))return;
    const before=JSON.stringify(state.rows);stageEditorMutate(state,action,id);refreshSharedStageEditor(owner);
    const host=stageEditorHost(owner);
    if(action==='add')host?.querySelector('[data-flow-name]')?.focus();
    else host?.querySelector('[data-flow-select][aria-pressed="true"]')?.focus({preventScroll:true});
    if(owner==='project'&&before!==JSON.stringify(state.rows))invalidateProjectFlowPreview();
    if(owner==='method')syncProcurementFormIdentity();
}
function stageEditorModuleNames(row){const catalog=systemSettings?.stage_module_catalog||[];return (row.modules||[]).map(id=>catalog.find(m=>m.id===id)?.name||id).join(' · ');}
function stageEditorField(input,owner,id,field){
    const state=stageEditorOwner(owner),row=state?.rows.find(s=>s.id===id);if(!row||(owner!=='project'&&!currentIsAdmin))return;
    if(field==='module'){const module=input.dataset.module;if(module==='common')return;row.modules=input.checked?[...new Set([...row.modules,module])]:row.modules.filter(x=>x!==module);}
    else row[field]=input.value;
    state.dirty=true;const host=stageEditorHost(owner),entry=[...(host?.querySelectorAll('[data-flow-stage]')||[])].find(e=>e.dataset.flowStage===id);
    if(entry){entry.querySelector('[data-flow-label]').textContent=row.name||'未命名阶段';entry.querySelector('[data-flow-modules]').textContent=stageEditorModuleNames(row);if(field==='icon')entry.querySelector('[data-ui-icon]')?.setAttribute('data-ui-icon',row.icon);}
    const dirty=host?.querySelector('[data-flow-dirty]');if(dirty)dirty.textContent='有未保存的修改';
    if(owner==='project')invalidateProjectFlowPreview();
}
function refreshSharedStageEditor(owner){
    const host=stageEditorHost(owner);if(!host)return;
    const scroll=host.querySelector('.shared-stage-list')?.scrollTop||0;
    host.innerHTML=renderStageEditor(stageEditorOwner(owner),{owner,editable:owner==='project'||currentIsAdmin});
    const list=host.querySelector('.shared-stage-list');if(list)list.scrollTop=scroll;
    window.PMIcons?.render?.(host);globalThis.PMForms?.enhance?.(host);
}
function renderStageEditor(state,{editable=true,owner='project'}={}){
    const catalog=systemSettings?.stage_module_catalog||[];
    const selected=state.rows.find(s=>s.id===state.selectedId)||state.rows[0];state.selectedId=selected?.id||null;
    const i=state.rows.indexOf(selected),detailId=owner+'StageDetail';
    return `<div class="shared-stage-editor"><div class="shared-stage-toolbar"><strong>流程阶段 <span>${state.rows.length}</span></strong><span class="shared-stage-dirty" data-flow-dirty role="status">${state.dirty?'有未保存的修改':'选择阶段即可查看和编辑'}</span>${editable?`<button type="button" data-flow-add class="btn btn-primary btn-sm" onclick="stageEditorAction('${owner}','add')">新增阶段</button>`:''}</div><div class="shared-stage-workspace"><nav class="shared-stage-navigation" aria-label="流程阶段"><ol class="shared-stage-list">${state.rows.map((s,index)=>`<li data-flow-stage="${escHtml(s.id)}"><button type="button" data-flow-select="${escHtml(s.id)}" aria-pressed="${s.id===state.selectedId}" aria-controls="${detailId}" onclick="selectStageEditorStage('${owner}','${escHtml(s.id)}')"><span class="stage-order-position">${index+1}</span><span data-ui-icon="${escHtml(s.icon||'📌')}"></span><span class="shared-stage-copy"><strong data-flow-label>${escHtml(s.name||'未命名阶段')}</strong><small data-flow-modules>${escHtml(stageEditorModuleNames(s))}</small></span></button></li>`).join('')}</ol></nav><section class="shared-stage-detail" id="${detailId}" aria-label="阶段编辑">${selected?`<div class="shared-stage-detail-head"><strong>第 ${i+1} 阶段 · ${editable?'编辑阶段':'查看阶段'}</strong>${editable?`<div class="shared-stage-actions"><button type="button" class="btn btn-secondary btn-sm" onclick="stageEditorAction('${owner}','up','${escHtml(selected.id)}')" ${i===0?'disabled':''}>上移</button><button type="button" class="btn btn-secondary btn-sm" onclick="stageEditorAction('${owner}','down','${escHtml(selected.id)}')" ${i===state.rows.length-1?'disabled':''}>下移</button><button type="button" class="btn btn-secondary btn-sm" onclick="stageEditorAction('${owner}','remove','${escHtml(selected.id)}')" ${state.rows.length<2?'disabled':''}>移除</button></div>`:''}</div><div class="shared-stage-fields"><label>阶段名称<input data-flow-name maxlength="60" value="${escHtml(selected.name)}" oninput="stageEditorField(this,'${owner}','${escHtml(selected.id)}','name')" ${editable?'':'disabled'}></label><label>图标<select data-flow-icon aria-label="阶段图标" onchange="stageEditorField(this,'${owner}','${escHtml(selected.id)}','icon')" ${editable?'':'disabled'}>${[...new Set([selected.icon||'📌',...STAGE_ICON_OPTIONS])].map(icon=>`<option value="${escHtml(icon)}" ${selected.icon===icon?'selected':''}>${escHtml(window.PMIcons?.describe?.(icon)||icon)}</option>`).join('')}</select></label><fieldset class="shared-stage-modules"><legend>业务模块</legend>${catalog.map(m=>`<label><input type="checkbox" data-module="${escHtml(m.id)}" ${(selected.modules||[]).includes(m.id)?'checked':''} ${!editable||m.id==='common'?'disabled':''} onchange="stageEditorField(this,'${owner}','${escHtml(selected.id)}','module')">${escHtml(m.name)}${m.singleton?'（唯一）':''}</label>`).join('')}</fieldset><p class="settings-note shared-stage-module-note">通用阶段信息始终保留。业务模块决定本阶段可登记的业务内容；保存时会检查模块的唯一性及依赖。</p></div>`:'<p class="settings-note">暂无阶段，请先新增阶段。</p>'}</section></div></div>`;
}
function showCommonProcurementFlow(){
    const form={state:createStageEditorState(procurementCatalog().common_stages),revision:procurementCatalog().revision,saving:false,closed:false};commonFlowForm=form;
    showModal('通用默认流程',`<p class="settings-note">这是共享模板，引用它的采购方式在后续新建项目时采用此流程，已有项目保持原记录。</p>${renderCommonFlowConsumers()}<div id="flowError" role="alert" class="form-error" hidden></div><div id="commonFlowStages">${renderStageEditor(form.state,{owner:'common',editable:currentIsAdmin})}</div>`,currentIsAdmin?async()=>{
        if(!isFlowFormActive(form,'common')||form.saving)return false;const signature=JSON.stringify(form.state.rows);form.saving=true;
        try{
            await api('PUT','/api/procurement-common-flow',{stages:JSON.parse(signature),revision:form.revision});
            await loadProcurementCatalog({refresh:true});if(!isFlowFormActive(form,'common'))return true;
            form.revision=procurementCatalog().revision;
            if(JSON.stringify(form.state.rows)!==signature){showFlowError('提交的流程已保存，保存期间的新修改仍在编辑器中，请继续保存。');return false;}
            form.state.dirty=false;form.saving=false;closeModal();refreshProcurementManager();toast('通用默认流程已保存','success');return true;
        }catch(e){if(isFlowFormActive(form,'common'))showFlowError(e.message);return false;}finally{form.saving=false;}
    }:null,{wide:true,saveLabel:'保存流程',beforeClose:()=>confirmFlowFormClose(form,'common')});form.host=document.getElementById('commonFlowStages');
}
function showFlowError(message){const e=document.getElementById('flowError');if(e){e.hidden=false;e.textContent=message;}else toast(message,'error');}
function isFlowFormActive(form,owner){return !!form&&!form.closed&&(owner==='common'?commonFlowForm:projectFlowForm)===form&&stageEditorHost(owner)===form.host;}
async function confirmFlowFormClose(form,owner){
    if(!isFlowFormActive(form,owner))return true;
    const allowed=form.saving?await confirmDialog('离开正在保存的窗口','保存请求已发出，离开不会撤销已提交的内容；本窗口尚未提交的修改将被放弃。','离开窗口'):
        !form.state.dirty||await confirmDialog('放弃流程调整','尚有未保存的流程调整，是否放弃？','放弃修改');
    if(allowed)form.closed=true;return allowed;
}
async function showProjectWorkflowEditor(projectId){
    showModal('调整本项目流程','<p role="status">正在读取项目流程…</p>');const loading=document.getElementById('modalBody').firstElementChild;
    try{
        const p=await api('GET',`/api/projects/${projectId}`);if(document.getElementById('modalBody').firstElementChild!==loading)return false;
        const form=projectFlowForm={id:p.id,state:createStageEditorState((p.stages||[]).filter(s=>!s.template_removed).map(s=>({id:s.key||s.id,name:s.name,icon:s.icon||'📌',modules:s.modules||legacyClientStageModules(s.key)}))),preview:null,saving:false,closed:false};
        showModal('调整本项目流程',`<p class="settings-note">仅调整本项目。已完成阶段和有业务依赖的阶段受保护；请先预览影响，再确认保存。</p><div id="flowError" class="form-error" role="alert" hidden></div><div id="projectFlowStages">${renderStageEditor(form.state)}</div><section id="flowPreview" aria-live="polite"></section><div class="settings-actions"><button class="btn btn-secondary" onclick="previewProjectWorkflow(this)">预览调整</button><button id="flowCommit" class="btn btn-primary" onclick="commitProjectWorkflow(this)" disabled>确认保存</button></div>`,null,{wide:true,beforeClose:()=>confirmFlowFormClose(form,'project')});
        form.host=document.getElementById('projectFlowStages');return true;
    }catch(e){if(document.getElementById('modalBody').firstElementChild===loading)showFlowError(e.message);return false;}
}
function invalidateProjectFlowPreview(){if(projectFlowForm)projectFlowForm.preview=null;const b=document.getElementById('flowCommit');if(b)b.disabled=true;const h=document.getElementById('flowPreview');if(h)h.textContent='内容已修改，请重新预览。';}
async function previewProjectWorkflow(button){
    const form=projectFlowForm;if(!isFlowFormActive(form,'project')||form.saving)return false;
    if(button)button.disabled=true;const signature=JSON.stringify(form.state.rows),stages=JSON.parse(signature);
    try{
        const result=await api('POST',`/api/projects/${form.id}/workflow/preview`,{stages});
        if(!isFlowFormActive(form,'project'))return false;
        if(JSON.stringify(form.state.rows)!==signature){invalidateProjectFlowPreview();return false;}
        form.preview=result;document.getElementById('flowPreview').innerHTML=`<h3>调整影响</h3>${['added','updated','removed'].map((k,i)=>`<p>${['新增','调整','移除'][i]} ${result.diff[k].length} 个阶段：${escHtml(result.diff[k].map(s=>s.name).join('、')||'无')}</p>`).join('')}${result.blocked.map(x=>`<p class="form-error">${escHtml(form.state.rows.find(s=>s.id===x.stage_key)?.name||x.stage_key)}：${escHtml(x.reasons.map(r=>r.label).join('、'))}</p>`).join('')}`;
        document.getElementById('flowCommit').disabled=result.blocked.length>0;return true;
    }catch(e){if(isFlowFormActive(form,'project'))showFlowError(e.message);return false;}finally{if(button)button.disabled=false;}
}
async function commitProjectWorkflow(button){
    const form=projectFlowForm;if(!isFlowFormActive(form,'project')||form.saving)return false;
    if(button)button.disabled=true;
    try{
        if(!form.preview)throw new Error('请重新预览后保存');
        const signature=JSON.stringify(form.state.rows),stages=JSON.parse(signature),fingerprint=form.preview.base_fingerprint;form.saving=true;
        const result=await api('POST',`/api/projects/${form.id}/workflow/commit`,{stages,base_fingerprint:fingerprint});
        dropProjectDetail(form.id);storeProjectDetail(result.project);if(typeof invalidateViewCaches==='function')invalidateViewCaches();
        if(!isFlowFormActive(form,'project'))return true;
        form.preview=null;
        if(JSON.stringify(form.state.rows)!==signature){form.state.dirty=true;invalidateProjectFlowPreview();showFlowError('提交的流程已保存，保存期间的新修改仍在编辑器中，请重新预览后继续保存。');return false;}
        form.state.dirty=false;form.saving=false;closeModal();await refreshProject();toast('本项目流程已更新','success');return true;
    }catch(e){if(isFlowFormActive(form,'project')){showFlowError(e.message);if(e.status===409)invalidateProjectFlowPreview();}return false;}
    finally{form.saving=false;if(button&&isFlowFormActive(form,'project'))button.disabled=!form.preview;}
}
async function loadStageQuantityCard(project,stage){const host=document.getElementById('stageQuantityCard');if(!host)return;try{const data=await api('GET',`/api/projects/${project.id}/supplier-quantity?stage_key=${encodeURIComponent(stage.key)}`);if(Number(currentProject?.id)!==Number(project.id)||!document.getElementById('stageQuantityCard'))return;host.innerHTML=data.items.filter(x=>x.applicable).map((x,i)=>`<div class="quantity-review-card"><strong>${escHtml(x.lot_name||'整体项目')} · ${escHtml({registered:'报名数量',submitted:'已提交并接收',valid:'有效投标数量'}[x.phase]||'供应商数量')}</strong><p>${x.status==='pending'?'参与及有效性名单尚未确认，请先核对本阶段名单。':x.required_count==null?'不固定最低数量':`实际 ${x.actual_count} 家，配置最低 ${x.required_count} 家`}</p>${x.status==='shortage'?`<label>继续推进原因<input id="quantityReason${i}" maxlength="2000"></label>${(x.exceptions||[]).filter(e=>e.enabled).length?`<label>适用例外（可选）<select id="quantityException${i}"><option value="">按当前规则人工确认</option>${x.exceptions.filter(e=>e.enabled).map(e=>`<option value="${escHtml(e.id)}">${escHtml(e.title)}：${escHtml(e.description)}</option>`).join('')}</select></label>`:''}<button class="btn btn-secondary btn-sm" data-quantity-index="${i}">确认本次数量并继续</button>`:x.status==='confirmed'?'<small>本次数量已人工确认</small>':''}</div>`).join('');host.querySelectorAll('[data-quantity-index]').forEach(b=>b.onclick=async()=>{const i=Number(b.dataset.quantityIndex),x=data.items.filter(x=>x.applicable)[i];b.disabled=true;try{await api('POST',`/api/projects/${project.id}/supplier-quantity/confirm`,{stage_key:stage.key,lot_id:x.lot_id,fingerprint:x.fingerprint,reason:document.getElementById('quantityReason'+i).value,exception_id:document.getElementById('quantityException'+i)?.value||null});await loadStageQuantityCard(project,stage);}catch(e){toast(e.message,'error');b.disabled=false;}});}catch(e){host.textContent='数量检查暂时不可用：'+e.message;}}
