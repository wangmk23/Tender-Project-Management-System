// ── Electronic public tender: cutoff counts, then original opening roster and quotes ──
let electronicCutoffTimer=null;
const electronicRequests=new Map();
const electronicDrafts=new Map();
function electronicStageKind(s,p=currentProject){if(!s||!isElectronicTender(p))return null;return stageHasModule(s,'registration',p)?'registration':stageHasModule(s,'bid_opening',p)?'opening':null;}
async function loadElectronicTender(p){
    if(!electronicRequests.has(p.id))electronicRequests.set(p.id,api('GET',`/api/projects/${p.id}/electronic-tender`).finally(()=>electronicRequests.delete(p.id)));
    const state=await electronicRequests.get(p.id);p.electronic_tender=state;return state;
}
function electronicDeadlinePassed(e){return Boolean(e?.cutoff&&(e.after_cutoff||Date.now()>=Date.parse(e.cutoff)));}
function electronicCutoffLabel(e){return e?.cutoff?new Date(e.cutoff).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false}):'尚未设置，请先填写本阶段计划时间';}
function renderElectronicRegistration(p){
    const e=p.electronic_tender||{},ready=electronicDeadlinePassed(e),scopes=(p.lots||[]).length?p.lots:[{id:null,lot_name:'整体项目'}];
    const draft=electronicDrafts.get(`${p.id}:registration`);
    const rows=scopes.map(l=>{
        const key=l.id??'';
        const saved=(e.results||[]).find(x=>x.lot_id===(l.id??null))?.meets_minimum;
        const previous=saved==null?'':String(saved);
        const selected=draft?.values[key]??previous;
        return `<div class="form-group"><label for="electronicResult${key}">${escHtml([l.lot_number,l.lot_name||'整体项目'].filter(Boolean).join(' '))} · 报名有效性</label>
            <select id="electronicResult${key}" data-electronic-count="${key}" data-saved-value="${previous}" data-account-permission="edit_projects" ${ready?'':'disabled'}>
            <option value="" ${selected===''?'selected':''}>待确认</option>
            <option value="true" ${selected==='true'?'selected':''}>有效（达到最低参与要求）</option>
            <option value="false" ${selected==='false'?'selected':''}>无效（未达到最低参与要求）</option></select></div>`;
    }).join('');
    return `<section class="biz-sec electronic-tender-section" data-electronic-registration="${Number(p.id)}"><div class="biz-bar"><span>报名有效性</span></div><div class="biz-body"><p data-electronic-cutoff>报名截止（北京时间）：${escHtml(electronicCutoffLabel(e))}</p><p data-electronic-availability>${ready?'请按平台结果确认是否达到最低供应商参与要求。':'报名截止后核对平台结果。'}</p>${rows}<div data-electronic-error role="alert" hidden></div><button type="button" class="btn btn-primary" data-electronic-count-save data-account-permission="edit_projects" ${ready?'':'hidden'} onclick="saveElectronicRegistration()">确认结果并完成报名阶段</button></div></section>`;
}
function renderElectronicOpening(p){
    const e=p.electronic_tender||{},quotes=e.quotes||{},draft=electronicDrafts.get(`${p.id}:opening`);
    const closed=new Set(e.closed_lot_ids||(p.lot_supplier_state?.items||[]).filter(x=>x.status==='liubiao').map(x=>x.lot_id));
    const rows=(p.registrations||[]).map(r=>{
        const inactive=closed.has(r.lot_id);
        const amount=inactive?`<div>原投标报价：${escHtml(quotes[r.id]||'未登记')} ${quotes[r.id]?'元':''}<p class="tg-muted">采购包已流标，历史记录只读保留。</p></div>`:
            `<label>投标报价（元）<input type="text" inputmode="decimal" data-account-permission="edit_projects" data-electronic-quote="${Number(r.id)}" data-saved-value="${escHtml(quotes[r.id]??'')}" value="${escHtml(draft?.values[r.id]??quotes[r.id]??'')}" placeholder="未登记时留空"></label>`;
        return `<div class="electronic-quote-row"><div><strong>${escHtml(r.company_name)}</strong><div class="tg-muted">${escHtml(r.lot_number||'整体项目')}</div>${inactive?'':`<button type="button" class="btn btn-sm btn-secondary" data-account-permission="edit_projects" onclick="showRegistrationForm(${Number(r.id)})">编辑公司信息</button>`}</div>${amount}</div>`;
    }).join('');
    const editable=(p.registrations||[]).some(r=>!closed.has(r.lot_id));
    return `<section class="biz-sec electronic-tender-section" data-electronic-opening="${Number(p.id)}"><div class="biz-bar"><span>解密供应商与报价</span><div class="tg-actions"><button type="button" class="btn btn-sm" data-account-permission="edit_projects" onclick="showRegistrationImportDialog()">导入供应商</button><button type="button" class="btn btn-primary btn-sm" data-account-permission="edit_projects" onclick="showRegistrationForm()">登记供应商</button></div></div><div class="biz-body"><p class="tg-muted">在省网解密后，使用原供应商表单登记公司资料并填写报价，再核对下方实际参与及有效性。报价不自动确定中标人。</p>${rows||'<div class="biz-none">请登记解密后取得的具体供应商信息。</div>'}<div data-electronic-error role="alert" hidden></div>${editable?'<button type="button" class="btn btn-primary btn-sm" data-account-permission="edit_projects" onclick="saveElectronicQuotes()">保存报价</button>':''}</div></section>`;
}

function electronicError(message,error=null,kind=null){const node=document.querySelector('#slideBody [data-electronic-error]');if(node){node.hidden=false;node.className='settings-note warning';node.textContent=message;node.tabIndex=-1;node.focus({preventScroll:true});node.scrollIntoView?.({block:'nearest'});if(error?.status===409&&kind){const b=document.createElement('button');b.type='button';b.className='btn btn-secondary btn-sm';b.textContent='重新读取并核对草稿';const pid=currentProject.id;b.onclick=()=>reviewElectronicDraft(pid,kind);node.append(document.createElement('br'),b);}}else toast(message,'error');}
function initElectronicCutoff({rebind=true}={}){
    if(rebind)initElectronicDrafts();
    clearTimeout(electronicCutoffTimer);const p=currentProject,host=document.querySelector('[data-electronic-registration]');if(!p||!host)return;
    const e=p.electronic_tender||{},ready=electronicDeadlinePassed(e);
    host.querySelectorAll('[data-electronic-count]').forEach(el=>el.disabled=!ready);
    const button=host.querySelector('[data-electronic-count-save]');if(button)button.hidden=!ready;
    const message=host.querySelector('[data-electronic-availability]');if(message&&ready)message.textContent='报名已截止，请核对后确认有效性。';
    if(!ready&&e.cutoff)electronicCutoffTimer=setTimeout(()=>{if(currentProject?.id===p.id&&host.isConnected)initElectronicCutoff({rebind:false});},Math.min(60000,Math.max(100,Date.parse(e.cutoff)-Date.now()+50)));
}
async function saveElectronicRegistration(){
    if(saveElectronicRegistration.pending)return false;
    const p=currentProject,host=document.querySelector('[data-electronic-registration]');if(!p||!host||String(p.id)!==host.dataset.electronicRegistration)return false;
    const results=[];
    for(const field of host.querySelectorAll('[data-electronic-count]')){
        if(!['true','false'].includes(field.value)){electronicError('请先核对各采购包的报名有效性。');return false;}
        results.push({lot_id:field.dataset.electronicCount?Number(field.dataset.electronicCount):null,meets_minimum:field.value==='true'});
    }
    const shortages=results.filter(x=>!x.meets_minimum);
    const labels=shortages.map(x=>(p.lots||[]).find(l=>l.id===x.lot_id)?.lot_number||'整体项目');
    if(shortages.length&&!await confirmDialog('未达到最低参与要求，确认流标',labels.join('、')+' 将标记为流标。'))return false;
    if(currentProject?.id!==p.id||!host.isConnected)return false;
    saveElectronicRegistration.pending=true;captureElectronicDrafts();const e=host.electronicState||p.electronic_tender;const fields=[...host.querySelectorAll('[data-electronic-count]')];fields.forEach(el=>el.disabled=true);
    try{
        const result=await api('PUT',`/api/projects/${p.id}/electronic-tender/registration`,{revision:e.revision,record_version:e.record_version,results,confirm_shortage:shortages.length>0});
        p.electronic_tender=result;electronicDrafts.delete(`${p.id}:registration`);fields.forEach(el=>el.dataset.savedValue=el.value.trim());host.electronicState=result;if(currentProject?.id===p.id&&host.isConnected){closeSlide();await refreshProject();toast(shortages.length?'已登记报名有效性并标记流标':'报名有效性已登记，开标阶段再登记供应商与报价','success');}return true;
    }catch(error){if(currentProject?.id===p.id&&host.isConnected)electronicError(error.message,error,'registration');return false;}finally{saveElectronicRegistration.pending=false;fields.forEach(el=>el.disabled=!electronicDeadlinePassed(e));}
}
async function saveElectronicQuotes({silent=false}={}){
    const p=currentProject,host=document.querySelector('[data-electronic-opening]');if(!p||!host||String(p.id)!==host.dataset.electronicOpening)return true;
    const fields=[...host.querySelectorAll('[data-electronic-quote]')],quotes=fields.map(el=>({registration_id:Number(el.dataset.electronicQuote),amount:el.value.trim()}));
    if(!fields.some(el=>el.value.trim()!==el.dataset.savedValue))return true;
    if(saveElectronicQuotes.pending)return false;
    captureElectronicDrafts();const e=host.electronicState||p.electronic_tender;saveElectronicQuotes.pending=true;fields.forEach(el=>el.readOnly=true);
    try{
        const result=await api('PUT',`/api/projects/${p.id}/electronic-tender/quotes`,{revision:e.revision,record_version:e.record_version,quotes});
        p.electronic_tender=result;host.electronicState=result;electronicDrafts.delete(`${p.id}:opening`);
        if(currentProject?.id===p.id&&host.isConnected){fields.forEach((el,i)=>{const value=result.quotes[quotes[i].registration_id]??'';if(el.value.trim()===quotes[i].amount)el.value=value;el.dataset.savedValue=value;});if(!silent)toast('报价已保存','success');}return true;
    }catch(error){if(currentProject?.id===p.id&&host.isConnected)electronicError(error.message,error,'opening');return false;}finally{saveElectronicQuotes.pending=false;fields.forEach(el=>el.readOnly=false);}
}

function captureElectronicDrafts(){
    for(const kind of ['registration','opening']){
        const host=document.querySelector(`[data-electronic-${kind}]`),e=host?.electronicState;if(!host||!e||host.closest('#slidePanel')?.classList.contains('open')===false)continue;
        const pid=host.dataset[kind==='registration'?'electronicRegistration':'electronicOpening'];
        const attr=kind==='registration'?'electronicCount':'electronicQuote',fields=[...host.querySelectorAll(kind==='registration'?'[data-electronic-count]':'[data-electronic-quote]')];
        const key=`${pid}:${kind}`;
        if(fields.some(el=>el.value.trim()!==el.dataset.savedValue)){
            const previous=electronicDrafts.get(key)||{revision:e.revision,record_version:e.record_version};
            electronicDrafts.set(key,{...previous,values:Object.fromEntries(fields.map(el=>[el.dataset[attr],el.value]))});
        }else electronicDrafts.delete(key);
    }
}
function initElectronicDrafts(){
    const p=currentProject;if(!p?.electronic_tender)return;
    for(const kind of ['registration','opening']){
        const host=document.querySelector(`[data-electronic-${kind}="${p.id}"]`);if(!host)continue;
        const draft=electronicDrafts.get(`${p.id}:${kind}`);
        host.electronicState=draft?{...p.electronic_tender,revision:draft.revision,record_version:draft.record_version}:p.electronic_tender;
        host.querySelectorAll('[data-electronic-count],[data-electronic-quote]').forEach(el=>el.oninput=captureElectronicDrafts);
    }
}
function adoptElectronicOwnStageVersion(pid,version){
    if(!version)return;
    document.querySelectorAll(`[data-electronic-registration="${pid}"],[data-electronic-opening="${pid}"]`).forEach(host=>{if(host.electronicState)host.electronicState.record_version=version;});
    for(const kind of ['registration','opening']){const draft=electronicDrafts.get(`${pid}:${kind}`);if(draft)draft.record_version=version;}
}
async function refreshElectronicCutoffAfterStageSave(p,key){
    if(electronicStageKind(p.stages?.find(s=>s.key===key),p)!=='registration')return;
    const host=document.querySelector(`[data-electronic-registration="${p.id}"]`);
    if(!host)return;
    const bound=host.electronicState;
    try{
        const latest=await api('GET',`/api/projects/${p.id}/electronic-tender`);
        if(currentProject?.id!==p.id||editingStageKey!==key||!host.isConnected)return;
        currentProject.electronic_tender=latest;
        // A read after our stage save may observe another window's write. Keep
        // the form's baseline; only its own successful write may advance it.
        host.electronicState={...latest,revision:bound?.revision??latest.revision,record_version:bound?.record_version??latest.record_version};
        const label=host.querySelector('[data-electronic-cutoff]');
        if(label)label.textContent='报名截止（北京时间）：'+electronicCutoffLabel(latest);
        initElectronicCutoff({rebind:false});
    }catch(error){if(currentProject?.id===p.id&&host.isConnected)electronicError('阶段计划已保存，报名状态读取失败，请重新打开本阶段核对：'+error.message);}
}
async function reviewElectronicDraft(pid,kind){
    const key=editingStageKey;if(currentProject?.id!==pid)return;
    try{
        const latest=await api('GET',`/api/projects/${pid}/electronic-tender`);
        if(currentProject?.id!==pid||editingStageKey!==key)return;
        if(!latest.enabled){electronicError('项目已不再使用电子标，请保留草稿并返回项目核对。');return;}
        const draft=electronicDrafts.get(`${pid}:${kind}`);
        if(!draft){
            await refreshProject();
            if(currentProject?.id!==pid||editingStageKey!==key)return;
            currentProject.electronic_tender=latest;openStageSlide(key);return;
        }
        const resultLabel=value=>({true:'有效',false:'无效'}[String(value)]||'待确认');
        const rows=Object.entries(draft.values).map(([id,value])=>kind==='registration'?`${id?'采购包'+id:'整体项目'}：最新${resultLabel(latest.results.find(x=>String(x.lot_id??'')===id)?.meets_minimum)}，草稿${resultLabel(value)}`:`${currentProject.registrations?.find(r=>String(r.id)===id)?.company_name||'供应商'+id}：最新${latest.quotes[id]||'未登记'}元，草稿${value||'未填写'}元`);
        if(!await confirmDialog('重新核对电子标资料',rows.join('；')+'。保留这些草稿，重新读取当前项目后继续核对？此操作不会提交写入。'))return;
        if(currentProject?.id!==pid||editingStageKey!==key)return;
        draft.revision=latest.revision;draft.record_version=latest.record_version;
        await refreshProject();if(currentProject?.id!==pid)return;currentProject.electronic_tender=latest;openStageSlide(key);
    }catch(error){if(currentProject?.id===pid)electronicError(error.message);}
}
