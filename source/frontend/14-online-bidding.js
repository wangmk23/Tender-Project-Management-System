// ── External platform bidding ledger ──
const ONLINE_BIDDING_STEPS = [
    ['plan_received', '接收项目', '📥', [], 'received', '项目基本信息与委托资料已核对'],
    ['online_documents', '文件编制与确认', '📝', ['responsible_person'], 'document_confirmed', '编制、核对、定稿连续办理；退回修改仍在本阶段'],
    ['agreement_signed', '签订委托协议', '📋', [], 'agreement_signed', '文件确认无误后签订委托协议，上传协议附件'],
    ['announcement', '平台发布', '📢', ['clarification'], 'announcement_done', '登记外部平台公告、报名截止时间与竞价时段'],
    ['registration_end', '报名与审核', '👥', ['registration'], 'roster_locked', '逐家审核报名资料；报名截止后确认最终参竞名单'],
    ['online_quotation', '一次报价竞价', '⏳', [], 'verified', '外部平台一次报价，最低价成交；全部报完或到截止时间结束，需核对平台结果'],
    ['result_announced', '成交结果公示', '🏆', ['result_publication'], 'publication_done', '核对最低价供应商后在平台公示，登记公示凭证'],
    ['online_fee_notice', '服务费与成交通知书', '💰', ['service_fee', 'winning_notice'], 'notice_delivered', '先确认服务费到账，再签发、送达成交通知书'],
    ['archived', '资料归档', '📦', ['archive'], 'archive_checked', '核对文件、协议、公告、审核资料、报价、公示、收费和通知书后归档'],
];


function onlineBiddingTemplate() {
    return ONLINE_BIDDING_STEPS.map(([id,name,icon,modules])=>({id,name,icon,modules:['common','checklist',...modules,...(id==='online_quotation'?['online_bidding']:[])]}));
}

function hasInlineOnlineBidding(project) {
    return project?.online_bidding_enabled === true && (project.stages || []).some(s=>!s.template_removed && (s.key==='online_quotation' || (s.modules || []).includes('online_bidding')));
}

const onlineBiddingDrafts = new Map();
function onlineBiddingDraftControls(host) {
    return [...host.querySelectorAll('input,select'),...document.querySelectorAll('[data-online-review] input,[data-online-review] select')];
}
function captureOnlineBiddingDraft(host) {
    if(!host.onlineState)return;
    const values={};
    onlineBiddingDraftControls(host).forEach((el,i)=>{values[el.id || `control-${i}`]=el.value;});
    onlineBiddingDrafts.set(`${host.dataset.projectId}:${host.dataset.stageKey}`,{values,saved:host.onlineState.saved,correctionInProgress:!!host.onlineState.correctionInProgress});
}
function discardOnlineBiddingDraft() {
    const host=document.getElementById('onlineBiddingInline');
    if(!host?.onlineState || host.onlineSaving)return;
    onlineBiddingDrafts.delete(`${host.dataset.projectId}:${host.dataset.stageKey}`);
    openStageSlide(host.dataset.stageKey);
}

function onlineBiddingStageKind(stage, project) {
    if (!hasInlineOnlineBidding(project)) return '';
    const known={plan_received:'',online_documents:'',doc_prepare:'',doc_review:'',doc_finalized:'',agreement_signed:'',archived:'',announcement:'announcement',registration_end:'registration',online_quotation:'quotation',result_announced:'publication',online_fee_notice:'fee',service_fee:'fee',winning_notice:'notice'};
    if (Object.prototype.hasOwnProperty.call(known,stage.key)) return known[stage.key];
    const modules=stage.modules || [];
    if(modules.includes('registration'))return 'registration';
    if(modules.includes('service_fee'))return 'fee';
    if(modules.includes('winning_notice'))return 'notice';
    if(modules.includes('result_publication') || modules.includes('bid_results'))return 'publication';
    if(modules.includes('online_bidding'))return 'quotation';
    return '';
}

function renderOnlineBiddingInline(stage,project) {
    const kind=onlineBiddingStageKind(stage,project);
    if(!kind)return '';
    return `<div id="onlineBiddingInline" data-stage-key="${escHtml(stage.key)}" data-project-id="${Number(project.id)}" data-kind="${kind}" aria-live="polite"><p>正在读取本阶段业务信息…</p></div>`;
}

function renderOnlineRegistrationSlot(registration,project) {
    return hasInlineOnlineBidding(project) ? `<div data-online-review="${Number(registration.id)}"></div>` : '';
}

function onlineBiddingNoticeIssues(project) {
    const notices=project.notice_deliveries || [];
    if(!notices.length)return ['请登记成交通知书领取／送达记录，并填写领取／寄出日期'];
    const lots=project.lots?.length?project.lots:[{id:null,lot_name:'整体项目'}];
    const issues=[];
    for(const lot of lots) {
        const label=lot.lot_name || lot.lot_number || '采购包';
        const rows=notices.filter(n=>(n.lot_id ?? null)===lot.id);
        const winner=(project.bid_results || []).find(r=>(r.lot_id ?? null)===lot.id)?.winning_supplier;
        if(!rows.length)issues.push(`${label}：请登记通知书领取／送达记录`);
        else if(rows.some(n=>!n.pickup_date))issues.push(`${label}：请补齐通知书领取／寄出日期`);
        if(rows.length && (!winner || rows.some(n=>n.supplier_name!==winner)))issues.push(`${label}：通知书供应商须与成交供应商一致`);
    }
    if(notices.some(n=>!lots.some(l=>l.id===(n.lot_id ?? null))))issues.push('通知书包含不匹配的采购包，请核对');
    return issues;
}

function onlineBiddingFeeStatusHtml(data,project,key) {
    const noticeIssues=onlineBiddingNoticeIssues(project);
    const feeConfirmed=!!(data.fee_received && data.fee_date && data.fee_reference);
    const noticeStatus=!(project.notice_deliveries || []).length?'未登记':noticeIssues.length?'资料待补齐':data.notice_delivered?'已确认':'已登记，待完成阶段确认';
    return `<section class="online-fee-progress" aria-label="收费与通知书办理状态"><h3>办理核对</h3><dl><div><dt>成交结果公示</dt><dd>${data.publication_done?'已确认':'待确认'}</dd></div><div><dt>服务费到账</dt><dd>${feeConfirmed?'已确认':'待确认'}</dd></div>${key==='service_fee'?'':`<div><dt>成交通知书</dt><dd>${noticeStatus}</dd></div>`}</dl><p role="status">${!feeConfirmed?'填写实际到账日期和凭证后，点击下方“保存并确认到账”。':key==='service_fee'?'到账信息已保存，可确认完成收费阶段。':noticeIssues.length?escHtml(noticeIssues.join('；')):'到账和通知书资料已齐备，可将阶段设为已完成后保存。'}</p></section>`;
}

function focusOnlineBiddingNotices() {
    const button=document.querySelector('#slideBody button[aria-label="新增通知书领取记录"]');
    if(button){button.closest('.biz-sec')?.scrollIntoView({block:'nearest',behavior:'auto'});button.focus();}
}

async function saveOnlineBiddingFee() {
    const host=document.getElementById('onlineBiddingInline'),state=host?.onlineState;
    if(!state || state.kind!=='fee' || host.onlineSaving)return;
    const {project,key}=state;
    if(currentProject?.id!==project.id || editingStageKey!==key)return;
    try {
        for(const [field,label] of [['fee_date','实际到账日期'],['fee_reference','到账凭证']]) {
            if(!host.querySelector(`[data-ob-field="${field}"]`)?.value.trim()) {
                showOnlineBiddingSaveError(host,`请填写${label}后确认到账`,field);return;
            }
        }
        await saveOnlineBiddingInline({}, {feeOnly:true});
        if(document.getElementById('onlineBiddingInline')!==host || currentProject?.id!==project.id || editingStageKey!==key)return;
        toast('服务费到账信息已保存；可继续登记、核对通知书。','success');
    } catch(error) {toast(error.message || '到账确认未保存，草稿已保留','error');}
}

async function loadOnlineBiddingInline(stage,project) {
    const host=document.getElementById('onlineBiddingInline');
    if(!host)return;
    const pid=project.id, key=stage.key, kind=onlineBiddingStageKind(stage,project);
    try {
        const saved=await api('GET',`/api/projects/${pid}/online-bidding`);
        if(!host.isConnected || currentProject?.id!==pid || editingStageKey!==key)return;
        host.onlineState={saved,project,key,kind};
        const d=saved.data || {};
        const field=(name,label,type='text')=>`<div class="form-group"><label for="ob_${name}">${label}</label><input id="ob_${name}" data-ob-field="${name}" type="${type}" ${type==='datetime-local'?'step="1"':''} maxlength="2000" value="${escHtml(d[name] || '')}"></div>`;
        const card=(title,body)=>`<section class="stage-business-card"><h3>${title}</h3>${body}</section>`;
        let html='';
        if(kind==='announcement')html=card('平台发布',field('platform','发布平台')+field('announcement_url','平台公告链接','url')+field('registration_end','报名截止时间','datetime-local'));
        if(kind==='registration')html=field('registration_end','报名截止时间','datetime-local')+'<p>在下方报名记录中审核资料。完成本阶段时检查全部报名是否已处理。</p>';
        if(kind==='quotation'){
            html=(!d.roster_locked?'<p role="status">报名审核的参竞名单尚未确认，请先在“报名与审核”阶段完成审核并保存为已完成；上方实际参与名单的确认是另一项核对。</p>':'')+card('竞价时段',`<p class="online-quote-progress">${escHtml(saved.summary?.status || '待登记')} · 已登记 ${Number(saved.summary?.quoted || 0)} / ${Number(saved.summary?.eligible || 0)} 家</p><div class="form-grid-2">${field('start_at','竞价开始（北京时间）','datetime-local')}${field('end_at','竞价截止（北京时间）','datetime-local')}</div><button type="button" class="btn btn-sm" data-account-permission="edit_projects" onclick="fillOnlineBiddingHours()">填入所选日期 09:00—12:00</button><p>报价在外部平台完成，可事后补录；未报价留空。核对完成前可先保存草稿。</p>`);
            html+='<section class="stage-business-card"><h3>供应商报价</h3><table class="online-quote-table"><thead><tr><th scope="col">供应商 / 采购包</th><th scope="col">报价金额（元）</th><th scope="col">平台实际报价时间</th></tr></thead><tbody>';
            html+=(project.registrations || []).map(r=>{
                const row=(d.records || []).find(x=>x.registration_id===r.id) || {};
                const disabled=row.review && row.review!=='approved'?'disabled':'';
                return `<tr data-online-quote="${Number(r.id)}"><th scope="row"><strong>${escHtml(r.company_name)}</strong>${r.lot_number?`<small>${escHtml(r.lot_number)}</small>`:''}<small>${escHtml(({approved:'审核通过',rejected:'审核不通过',supplement:'待补正'})[row.review] || '待审核')}</small></th><td><label class="sr-only" for="ob_amount_${r.id}">${escHtml(r.company_name)}报价金额（元）</label><input id="ob_amount_${r.id}" data-ob-amount inputmode="decimal" value="${escHtml(row.amount || '')}" ${disabled}></td><td><label class="sr-only" for="ob_quote_${r.id}">${escHtml(r.company_name)}平台实际报价时间</label><input id="ob_quote_${r.id}" data-ob-quoted-at type="datetime-local" step="1" value="${escHtml(row.quoted_at || '')}" ${disabled}></td></tr>`;
            }).join('') || '<tr><td colspan="3">暂无报名供应商，请先在报名阶段登记。</td></tr>';
            html+='</tbody></table></section>';
            html+=card('结果核对',field('ended_at' ,'平台实际结束时间','datetime-local')+`<div class="form-group"><label for="ob_end_reason">结束原因</label><select id="ob_end_reason" data-ob-field="end_reason"><option value="">请选择</option><option value="all_quoted" ${d.end_reason==='all_quoted'?'selected':''}>全部合格供应商已报价</option><option value="deadline" ${d.end_reason==='deadline'?'selected':''}>到截止时间</option></select></div>`+field('evidence','平台结果凭证（编号、链接或附件名称）'));
        }
        if(kind==='publication'){
            html=card('成交结果公示',onlineBiddingSummaryHtml(saved.summary,project,{compact:true})+field('publication_url','公示链接','url')+field('publication_date','公示完成日期','date'));
            html+=(saved.summary.lots || []).filter(lot=>(lot.quotes || []).filter(r=>r.amount===lot.amount).length>1).map(lot=>{
                const r=(d.resolutions || []).find(r=>r.lot_id===lot.lot_id) || {};
                return `<fieldset data-ob-resolution="${lot.lot_id==null?'':Number(lot.lot_id)}"><legend>并列最低价：按平台结果处理</legend><label>平台确定的供应商<select data-ob-resolution-winner><option value="">待处理</option>${lot.quotes.filter(q=>q.amount===lot.amount).map(q=>`<option value="${q.registration_id}" ${r.registration_id===q.registration_id?'selected':''}>${escHtml(q.company_name)}</option>`).join('')}</select></label><label>处理依据<input data-ob-resolution-note value="${escHtml(r.note || '')}"></label></fieldset>`;
            }).join('');
        }
        if(kind==='fee')html=`<div data-ob-fee-status>${onlineBiddingFeeStatusHtml(d,project,key)}</div>`+field('fee_date','实际到账日期','date')+field('fee_reference','到账凭证（编号或附件名称）')+`<div class="online-fee-actions"><button type="button" class="btn btn-primary" data-ob-confirm-fee data-account-permission="edit_projects" onclick="saveOnlineBiddingFee()">保存并确认到账</button>${key==='service_fee'?'':'<button type="button" class="btn btn-secondary" onclick="focusOnlineBiddingNotices()">查看／登记通知书</button>'}</div><p>先保存到账信息，再到下方通知书记录登记领取／寄出日期。两项齐备后，将本阶段设为已完成并保存。发票和金额仍在原收费记录中管理。</p>`;
        if(kind==='notice')html=`<div data-ob-fee-status>${onlineBiddingFeeStatusHtml(d,project,key)}</div><p>按下方通知书记录登记签发与送达，填写领取／寄出日期，收件供应商与成交结果保持一致。</p>`;
        if(saved.stale)html='<p role="alert">报名或采购包已变更，请重新核对报价结果。</p>'+html;
        if((d.verified && ['registration','quotation','publication'].includes(kind)) || kind==='quotation' && (project.bid_results || []).length)html+=field('correction_reason','更正已核对资料时填写原因');
        html+=`<details><summary>本阶段办理记录</summary>${(saved.history || []).filter(h=>(h.reason || '').includes(key)).slice(0,10).map(h=>`<p>${escHtml(h.recorded_at)} · ${escHtml(h.actor)} · ${escHtml(h.reason)}</p>`).join('') || '<p>暂无本阶段记录</p>'}</details>`;
        host.innerHTML=html;
        if(kind==='registration')document.querySelectorAll('[data-online-review]').forEach(slot=>{
            const r=(d.records || []).find(r=>r.registration_id===Number(slot.dataset.onlineReview)) || {};
            slot.innerHTML=`<div class="form-grid-2"><div class="form-group"><label for="ob_review_${slot.dataset.onlineReview}">报名审核</label><select id="ob_review_${slot.dataset.onlineReview}" data-ob-review>${[['pending','待审核'],['supplement','需补正'],['approved','通过'],['rejected','不通过']].map(([v,l])=>`<option value="${v}" ${r.review===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="form-group"><label for="ob_note_${slot.dataset.onlineReview}">审核意见（补正/不通过必填）</label><input id="ob_note_${slot.dataset.onlineReview}" data-ob-review-note maxlength="2000" value="${escHtml(r.review_note || '')}"></div></div>`;
        });
        const draft=onlineBiddingDrafts.get(`${pid}:${key}`);
        globalThis.PMDateTime?.refresh();
        if(draft) {
            onlineBiddingDraftControls(host).forEach((el,i)=>{const name=el.id || `control-${i}`;if(Object.prototype.hasOwnProperty.call(draft.values,name))el.value=draft.values[name];});
            // Keep the draft's revision so concurrent updates produce a conflict.
            host.onlineState.saved=draft.saved;
            host.onlineState.correctionInProgress=draft.correctionInProgress;
            if(draft.saved.revision!==saved.revision)host.insertAdjacentHTML('afterbegin','<p role="alert">其他阶段或用户已更新资料。当前保留了未保存内容，请先复制需要保留的信息，再读取最新资料重新核对。</p><button type="button" class="btn btn-sm" onclick="discardOnlineBiddingDraft()">放弃本阶段草稿，读取最新资料</button>');
        }
        globalThis.PMDateTime?.refresh();
        onlineBiddingDraftControls(host).forEach(el=>{
            el.addEventListener('input',()=>captureOnlineBiddingDraft(host));
            el.addEventListener('change',()=>captureOnlineBiddingDraft(host));
        });
    }catch(error){if(host.isConnected)host.innerHTML=`<p role="alert">${escHtml(error.message || '读取失败，请重新打开阶段')}</p>`;}
}

function onlineBiddingCompletionIssues(data) {
    const issues=[];
    if(!data.roster_locked)issues.push({message:'请先在“报名与审核”阶段完成审核并确认参竞名单（实际参与名单确认不能替代报名审核）'});
    for(const [field,label] of [['start_at','竞价开始时间'],['end_at','竞价截止时间'],['ended_at','平台实际结束时间'],['end_reason','平台结束原因'],['evidence','平台结果凭证']]) {
        if(!data[field])issues.push({field,message:`请填写${label}`});
    }
    return issues;
}

function showOnlineBiddingSaveError(host,message,field) {
    let alert=host.querySelector('[data-ob-save-error]');
    if(!alert){alert=document.createElement('p');alert.dataset.obSaveError='true';alert.setAttribute('role','alert');alert.tabIndex=-1;host.prepend(alert);}
    alert.textContent=message;
    const input=field?host.querySelector(`[data-ob-field="${field}"]`):null;
    const target=input?.hidden?input.closest('.pm-temporal-field')?.querySelector('.pm-datetime-trigger'):input;
    (target || alert).focus();
    (target || alert).scrollIntoView?.({block:'nearest'});
}

function readOnlineBiddingData(host,stageData,{draft=false,feeOnly=false}={}) {
    const {saved,project,key,kind}=host.onlineState;
    const data=JSON.parse(JSON.stringify(saved.data || {}));
    // Archiving uses the existing stage and checklist, not a second ledger flag.
    if(!feeOnly)data.archive_checked=false;
    const reason=host.querySelector('[data-ob-field="correction_reason"]')?.value.trim() || '';
    host.querySelectorAll('[data-ob-field]').forEach(el=>{if(el.dataset.obField!=='correction_reason')data[el.dataset.obField]=el.value.trim();});
    if(feeOnly)return {data:{...data,fee_received:Boolean(data.fee_date && data.fee_reference)},reason};
    data.lot_ids=(project.lots || []).map(lot=>lot.id);
    data.records=(project.registrations || []).map(r=>({...((data.records || []).find(row=>row.registration_id===r.id) || {review:'pending',review_note:'',amount:'',quoted_at:''}),registration_id:r.id,company_name:r.company_name,lot_id:r.lot_id??null}));
    if(kind==='registration')document.querySelectorAll('[data-online-review]').forEach(el=>{
        const r=data.records.find(r=>r.registration_id===Number(el.dataset.onlineReview));
        if(r && el.querySelector('[data-ob-review]')){r.review=el.querySelector('[data-ob-review]').value;r.review_note=el.querySelector('[data-ob-review-note]').value.trim();}
    });
    if(kind==='quotation')host.querySelectorAll('[data-online-quote]').forEach(el=>{
        const r=data.records.find(r=>r.registration_id===Number(el.dataset.onlineQuote));
        if(r){r.amount=el.querySelector('[data-ob-amount]').value.trim();r.quoted_at=el.querySelector('[data-ob-quoted-at]').value;}
    });
    if(kind==='publication')data.resolutions=[...host.querySelectorAll('[data-ob-resolution]')].filter(el=>el.querySelector('[data-ob-resolution-winner]').value).map(el=>({lot_id:el.dataset.obResolution===''?null:Number(el.dataset.obResolution),registration_id:Number(el.querySelector('[data-ob-resolution-winner]').value),note:el.querySelector('[data-ob-resolution-note]').value.trim()}));
    const flag={announcement:'announcement_done',registration:'roster_locked',quotation:'verified',publication:'publication_done',fee:'notice_delivered',notice:'notice_delivered'}[kind];
    if(flag)data[flag]=draft?Boolean(saved.data?.[flag]):Boolean(stageData.completed && !stageData.skipped);
    if(kind==='fee')data.fee_received=Boolean(data.fee_date && data.fee_reference);
    if(kind==='fee' || kind==='notice'){
        const notices=project.notice_deliveries || [];
        data.notice_date=notices.map(n=>n.pickup_date).filter(Boolean).sort().pop() || '';
        data.notice_reference=notices.length?'已关联原通知书领取/送达记录':'';
        if(key==='service_fee') {data.notice_delivered=Boolean(saved.data?.notice_delivered); data.fee_received=Boolean(stageData.completed && data.fee_date && data.fee_reference);}
    }
    return {data,reason};
}

async function saveOnlineBiddingInline(stageData,options={}) {
    const host=document.getElementById('onlineBiddingInline');
    if(!host)return;
    const state=host.onlineState;
    if(!state)throw new Error('本阶段业务信息尚未读取完成，请稍后重试');
    if(host.onlineSaving)throw new Error('正在保存，请稍候');
    const {saved,project,key,kind}=state;
    if(currentProject?.id!==project.id || editingStageKey!==key)throw new Error('项目已切换，请重新打开阶段');
    const {data,reason}=readOnlineBiddingData(host,stageData,options);
    if(['fee','notice'].includes(kind) && key!=='service_fee' && data.notice_delivered && !options.feeOnly) {
        const issues=[...(!data.fee_received?['请先保存并确认服务费到账']:[]),...onlineBiddingNoticeIssues(project)];
        if(issues.length) {
            captureOnlineBiddingDraft(host);
            const message=issues.join('；');showOnlineBiddingSaveError(host,message);throw new Error(message);
        }
    }
    const correctionFields=['records','start_at','end_at','registration_end','ended_at','end_reason','evidence'];
    if(kind==='quotation' && (saved.data?.verified || state.correctionInProgress || (project.bid_results || []).length)
        && correctionFields.some(field=>JSON.stringify(data[field])!==JSON.stringify(saved.data?.[field])) && !reason) {
        captureOnlineBiddingDraft(host);
        const message='请填写更正原因，再保存已核对资料的修改';
        showOnlineBiddingSaveError(host,message,'correction_reason');throw new Error(message);
    }
    if(kind==='quotation' && data.verified) {
        const issues=onlineBiddingCompletionIssues(data);
        if(issues.length) {
            captureOnlineBiddingDraft(host);
            const message=issues.map(issue=>issue.message).join('；');
            showOnlineBiddingSaveError(host,message,issues[0].field);
            throw new Error(message);
        }
    }
    if(JSON.stringify(data)===JSON.stringify(saved.data || {})) {
        onlineBiddingDrafts.delete(`${project.id}:${key}`);
        return;
    }
    host.onlineSaving=true;
    const controls=[...onlineBiddingDraftControls(host),...host.querySelectorAll('button')];
    const disabled=controls.map(el=>el.disabled);
    controls.forEach((el,i)=>{el.dataset.operationBusy='1';el.dataset.operationWasDisabled=disabled[i]?'1':'0';el.disabled=true;});
    try{
        const response=await api('PUT',`/api/projects/${project.id}/online-bidding`,{revision:saved.revision,data,reason:reason || `阶段 ${key} 保存业务资料`,stage_key:key});
        state.saved=response;
        const status=host.querySelector('[data-ob-fee-status]');
        if(status)status.innerHTML=onlineBiddingFeeStatusHtml(response.data || {},project,key);
        host.querySelector('[data-ob-save-error]')?.remove();
        onlineBiddingDrafts.delete(`${project.id}:${key}`);
    }catch(error){
        captureOnlineBiddingDraft(host);
        showOnlineBiddingSaveError(host,error.message || '业务资料保存失败，请重试');
        throw error;
    }finally{host.onlineSaving=false;controls.forEach((el,i)=>{delete el.dataset.operationBusy;delete el.dataset.operationWasDisabled;el.disabled=disabled[i] || !!el.dataset.accountDisabled || !!el.dataset.accessDisabled;});}

}

async function reopenOnlineBiddingInline(stageData) {
    const host=document.getElementById('onlineBiddingInline'),state=host?.onlineState;
    if(!state || state.kind!=='quotation')throw new Error('竞价资料尚未读取完成，请重新打开阶段');
    if(host.onlineSaving)throw new Error('正在核对或保存，请稍候');
    const {saved,project,key}=state;
    const live=()=>host.isConnected && document.getElementById('onlineBiddingInline')===host && currentProject?.id===project.id && editingStageKey===key;
    if(!live())return false;
    captureOnlineBiddingDraft(host);
    const reason=host.querySelector('[data-ob-field="correction_reason"]')?.value.trim() || '';
    const reject=message=>{showOnlineBiddingSaveError(host,message,!reason?'correction_reason':undefined);throw new Error(message);};
    if(!reason)reject('请填写更正原因，再撤销竞价核对');
    if(saved.data?.notice_delivered)reject('请先将成交通知书及后续已完成阶段改为待办并撤销后续确认，再撤销竞价核对');
    if(saved.data?.fee_received)reject('已有服务费到账确认，请先核实后续收费记录及更正影响，再撤销竞价核对');
    if(saved.data?.publication_done)reject('请先将“成交结果公示”及后续已完成阶段改为待办并撤销公示确认，再撤销竞价核对');
    if(stageData.record_version===undefined || !Number.isInteger(saved.revision))reject('缺少当前阶段或台账版本，请读取最新资料后重试');
    host.onlineSaving=true;
    const controls=[...new Set([...onlineBiddingDraftControls(host),...host.closest('.stage-editor')?.querySelectorAll('input,select,textarea,button') || []])];
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>{el.dataset.operationBusy='1';el.disabled=true;});
    try {
        const response=await api('POST',`/api/projects/${project.id}/online-bidding/reopen`,{revision:saved.revision,stage_key:key,stage_record_version:stageData.record_version,reason});
        if(!response?.ok)throw new Error('撤销结果未能识别，请读取最新状态核对后再操作');
        state.saved={...saved,data:{...saved.data,verified:false},revision:response.revision};state.correctionInProgress=true;host.onlineConfirmed=false;
        const stage=project.stages.find(s=>s.key===key);
        if(stage)Object.assign(stage,{completed:false,skipped:false,completed_date:null,completed_at:null});
        // Only the saved facts were revoked. The current quote inputs remain a draft.
        captureOnlineBiddingDraft(host);
        if(live()) {
            host.querySelector('[data-ob-save-error]')?.remove();
            try {
                await refreshProject();
                if(live())openStageSlide(key);
                toast('已撤销竞价核对；原成交记录保留，报价草稿可继续更正。','success');
            }catch(error){showOnlineBiddingSaveError(host,'核对已撤销，页面刷新失败；草稿继续保留，请先重新加载最新状态：'+error.message);}
        }
        return true;
    }catch(error){
        if(live()){captureOnlineBiddingDraft(host);showOnlineBiddingSaveError(host,error.message || '撤销核对失败，原状态与草稿已保留');}
        throw error;
    }finally{host.onlineSaving=false;controls.forEach((el,i)=>{delete el.dataset.operationBusy;el.disabled=disabled[i] || !!el.dataset.accountDisabled || !!el.dataset.accessDisabled;});}
}

function onlineBiddingResultPreview(data,project) {
    const cents=value=>{
        if(!/^\d{1,12}(?:\.\d{1,2})?$/.test(String(value)))throw new Error('报价须为大于零、最多两位小数的金额');
        const [whole,fraction='']=String(value).split('.');
        const result=BigInt(whole)*100n+BigInt(fraction.padEnd(2,'0'));
        if(result<=0n)throw new Error('报价须大于零');
        return result;
    };
    const lots=(project.lots || []).length?project.lots.map(l=>l.id):[null];
    return lots.map(lotId=>{
        const quotes=data.records.filter(r=>r.review==='approved' && (r.lot_id??project.registrations?.find(x=>x.id===r.registration_id)?.lot_id??null)===lotId && r.amount)
            .map(r=>({...r,cents:cents(r.amount)})).sort((a,b)=>a.cents<b.cents?-1:a.cents>b.cents?1:0);
        if(!quotes.length)throw new Error('存在无有效报价的采购包，请核实平台处理结果后再完成竞价');
        let winners=quotes.filter(r=>r.cents===quotes[0].cents);
        const resolution=(data.resolutions || []).find(r=>r.lot_id===lotId && r.note?.trim());
        if(winners.length>1 && resolution)winners=winners.filter(r=>r.registration_id===resolution.registration_id);
        if(winners.length!==1)throw new Error('存在最低价并列，请先按平台规则处理，不能自动确定成交供应商');
        const row=winners[0],lot=(project.lots || []).find(l=>l.id===lotId);
        return `${lot?`${lot.lot_number} ${lot.lot_name}`:'整体项目'}：${row.company_name || project.registrations?.find(r=>r.id===row.registration_id)?.company_name || ''} · ¥${row.amount}`;
    });
}

async function confirmOnlineBiddingInline(stageData) {
    const host=document.getElementById('onlineBiddingInline'),state=host?.onlineState;
    if(!state || state.kind!=='quotation')throw new Error('竞价资料尚未读取完成，请重新打开阶段');
    if(host.onlineSaving)throw new Error('正在核对或保存，请稍候');
    if(host.onlineConfirmed)throw new Error('竞价确认已提交，请读取最新状态后继续');
    const {saved,project,key}=state;
    const live=()=>host.isConnected && document.getElementById('onlineBiddingInline')===host && currentProject?.id===project.id && editingStageKey===key;
    if(!live())return false;
    const {data,reason}=readOnlineBiddingData(host,{...stageData,completed:true,skipped:false});
    captureOnlineBiddingDraft(host);
    let preview;
    try {
        const issues=onlineBiddingCompletionIssues(data);
        if(issues.length){showOnlineBiddingSaveError(host,issues.map(x=>x.message).join('；'),issues[0].field);throw new Error(issues.map(x=>x.message).join('；'));}
        preview=onlineBiddingResultPreview(data,project);
        if(stageData.record_version===undefined || !Number.isInteger(saved.revision))throw new Error('缺少当前阶段或台账版本，请读取最新资料后重试');
    }catch(error){showOnlineBiddingSaveError(host,error.message);throw error;}
    host.onlineSaving=true;
    const controls=[...new Set([...onlineBiddingDraftControls(host),...host.closest('.stage-editor')?.querySelectorAll('input,select,textarea,button') || []])];
    const formSignature=()=>JSON.stringify(controls.map(el=>[el.id,el.value,el.type==='checkbox'?el.checked:null]));
    const signature=formSignature();
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>{el.dataset.operationBusy='1';el.disabled=true;});
    try {
        if(!await confirmDialog('核对平台结果并完成竞价',`${preview.join('\n')}\n平台依据：${data.evidence}\n确认后登记成交结果并完成本阶段。`, '确认成交并完成'))return false;
        if(!live())return false;
        if(signature!==formSignature())throw new Error('草稿已变化，请重新核对成交摘要后再提交');
        const response=await api('POST',`/api/projects/${project.id}/online-bidding/confirm`,{revision:saved.revision,stage_key:key,stage_record_version:stageData.record_version,data,stage_data:{notes:stageData.notes || '',planned_at:stageData.planned_at || null,completed_date:stageData.completed_date || null,completed_at:stageData.completed_at || null},reason:reason || '核对平台结果并完成竞价'});
        if(!response?.ok)throw new Error('确认结果未能识别，请读取最新状态核对后再操作');
        state.saved={...saved,data,revision:response.revision};host.onlineConfirmed=true;
        onlineBiddingDrafts.delete(`${project.id}:${key}`);
        if(live())host.querySelector('[data-ob-save-error]')?.remove();
        return true;
    }catch(error){
        if(live()){captureOnlineBiddingDraft(host);showOnlineBiddingSaveError(host,error.message || '竞价确认失败，草稿已保留');}
        throw error;
    }finally{host.onlineSaving=false;controls.forEach((el,i)=>{delete el.dataset.operationBusy;el.disabled=disabled[i] || !!el.dataset.accountDisabled || !!el.dataset.accessDisabled;});}
}

async function confirmOnlineBiddingStage() {
    const pid=currentProject?.id,key=editingStageKey;
    const host=document.getElementById('onlineBiddingInline');
    if(!host?.onlineState || host.onlineSaving)return;
    document.getElementById('stageCompleted').checked=true;
    if(!document.getElementById('stageCompletedDate').value){
        const now=stageTimestampParts(stageLocalMinuteNow());
        document.getElementById('stageCompletedDate').value=now.date;document.getElementById('stageCompletedTime').value=now.time;
    }
    if(!await saveStageFromSlide())return;
    if(currentProject?.id!==pid || editingStageKey!==key)return;
    closeSlide();
    try {await refreshProject();}catch(error){toast('竞价已确认，页面刷新失败，请手动刷新核对最新状态：'+error.message,'warning');}
}

async function saveOnlineBiddingStageDraft() {
    if(await saveStageFromSlide({onlineDraft:true}))toast('竞价草稿已保存','success');
}

function fillOnlineBiddingHours() {
    const start=document.getElementById('ob_start_at'),end=document.getElementById('ob_end_at');
    const date=(start?.value || end?.value || '').slice(0,10);
    if(!date){toast('请先选择竞价日期','warning');return;}
    start.value=`${date}T09:00`;end.value=`${date}T12:00`;
    globalThis.PMDateTime?.refresh();
    captureOnlineBiddingDraft(document.getElementById('onlineBiddingInline'));
}
async function prepareOnlineBidResultForm() {
    const p = currentProject;
    try {
        const ledger = await api('GET', `/api/projects/${p.id}/online-bidding`);
        if (currentProject?.id !== p.id) return;
        const result = (ledger.summary?.lots || []).find(lot => lot.winner && !(p.bid_results || []).some(existing => existing.lot_id === lot.lot_id));
        showBidResultForm(null, result ? {lot_id:result.lot_id, winning_supplier:result.winner, winning_amount:result.amount} : null);
    } catch (error) { toast(error.message || '竞价结果读取失败', 'error'); }
}

function onlineBiddingSummaryHtml(summary={}, project, {compact=false}={}) {
    const lots = summary.lots || [];
    return `<div role="status"><strong>${escHtml(summary.status)}</strong> · 已登记报价 ${Number(summary.quoted || 0)} / ${Number(summary.eligible || 0)} 家${summary.verified ? '（已核对）' : '（仅登记进度）'}</div>${lots.map(lot => {
        const definition = (project.lots || []).find(item => item.id === lot.lot_id);
        return `<div class="biz-sec"><div class="biz-bar"><b>${escHtml(definition ? `${definition.lot_number} ${definition.lot_name}` : '项目报价')}</b><span>${escHtml(lot.status)}</span></div><div class="biz-body">${lot.winner ? `<p><strong>最低价供应商：${escHtml(lot.winner)}　¥${escHtml(lot.amount)}</strong></p>` : ''}${compact?'':(lot.quotes || []).map((r, index) => `<div class="biz-row"><span>${index + 1}. ${escHtml(r.company_name)}</span><span>¥${escHtml(r.amount)} · ${escHtml(r.quoted_at)}</span></div>`).join('') || '<p>暂无有效报价</p>'}</div></div>`;
    }).join('')}`;
}
