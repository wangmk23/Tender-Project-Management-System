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
    return project?.method === '网上竞价' && project.online_bidding_enabled === true && (project.stages || []).some(s=>s.key==='online_quotation' || (s.modules || []).includes('online_bidding'));
}

const onlineBiddingDrafts = new Map();
function onlineBiddingDraftControls(host) {
    return [...host.querySelectorAll('input,select'),...document.querySelectorAll('[data-online-review] input,[data-online-review] select')];
}
function captureOnlineBiddingDraft(host) {
    if(!host.onlineState)return;
    const values={};
    onlineBiddingDraftControls(host).forEach((el,i)=>{values[el.id || `control-${i}`]=el.value;});
    onlineBiddingDrafts.set(`${host.dataset.projectId}:${host.dataset.stageKey}`,{values,saved:host.onlineState.saved});
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

async function loadOnlineBiddingInline(stage,project) {
    const host=document.getElementById('onlineBiddingInline');
    if(!host)return;
    const pid=project.id, key=stage.key, kind=onlineBiddingStageKind(stage,project);
    try {
        const saved=await api('GET',`/api/projects/${pid}/online-bidding`);
        if(!host.isConnected || currentProject?.id!==pid || editingStageKey!==key)return;
        host.onlineState={saved,project,key,kind};
        const d=saved.data || {};
        const field=(name,label,type='text')=>`<div class="form-group"><label for="ob_${name}">${label}</label><input id="ob_${name}" data-ob-field="${name}" type="${type}" maxlength="2000" value="${escHtml(d[name] || '')}"></div>`;
        const card=(title,body)=>`<section class="stage-business-card"><h3>${title}</h3>${body}</section>`;
        let html='';
        if(kind==='announcement')html=card('平台发布',field('platform','发布平台')+field('announcement_url','平台公告链接','url')+field('registration_end','报名截止时间','datetime-local'));
        if(kind==='registration')html=field('registration_end','报名截止时间','datetime-local')+'<p>在下方报名记录中审核资料。完成本阶段时检查全部报名是否已处理。</p>';
        if(kind==='quotation'){
            html=card('竞价时段',onlineBiddingSummaryHtml(saved.summary,project)+`<div class="form-grid-2">${field('start_at','竞价开始（北京时间）','datetime-local')}${field('end_at','竞价截止（北京时间）','datetime-local')}</div><button type="button" class="btn btn-sm" onclick="fillOnlineBiddingHours()">填入所选日期 09:00—12:00</button><p>报价在外部平台完成，可事后补录；未报价留空。完成本阶段即确认已核对平台结果。</p>`);
            html+='<section class="stage-business-card"><h3>供应商报价</h3>';
            html+=(project.registrations || []).map(r=>{
                const row=(d.records || []).find(x=>x.registration_id===r.id) || {};
                return `<fieldset data-online-quote="${Number(r.id)}" style="border:1px solid var(--border-light);border-radius:8px;padding:12px;margin:10px 0"><legend>${escHtml(r.company_name)} ${escHtml(r.lot_number || '')}</legend><div class="form-grid-2"><div class="form-group"><label for="ob_amount_${r.id}">报价金额（元）</label><input id="ob_amount_${r.id}" data-ob-amount inputmode="decimal" value="${escHtml(row.amount || '')}"></div><div class="form-group"><label for="ob_quote_${r.id}">平台实际报价时间</label><input id="ob_quote_${r.id}" data-ob-quoted-at type="datetime-local" step="1" value="${escHtml(row.quoted_at || '')}"></div></div></fieldset>`;
            }).join('') || '<p>暂无报名供应商，请先在报名阶段登记。</p>';
            html+='</section>';
            html+=card('结果核对',field('ended_at' ,'平台实际结束时间','datetime-local')+`<div class="form-group"><label for="ob_end_reason">结束原因</label><select id="ob_end_reason" data-ob-field="end_reason"><option value="">请选择</option><option value="all_quoted" ${d.end_reason==='all_quoted'?'selected':''}>全部合格供应商已报价</option><option value="deadline" ${d.end_reason==='deadline'?'selected':''}>到截止时间</option></select></div>`+field('evidence','平台结果凭证（编号、链接或附件名称）'));
        }
        if(kind==='publication'){
            html=card('成交结果公示',onlineBiddingSummaryHtml(saved.summary,project)+field('publication_url','公示链接','url')+field('publication_date','公示完成日期','date'));
            html+=(saved.summary.lots || []).filter(lot=>(lot.quotes || []).filter(r=>r.amount===lot.amount).length>1).map(lot=>{
                const r=(d.resolutions || []).find(r=>r.lot_id===lot.lot_id) || {};
                return `<fieldset data-ob-resolution="${lot.lot_id==null?'':Number(lot.lot_id)}"><legend>并列最低价：按平台结果处理</legend><label>平台确定的供应商<select data-ob-resolution-winner><option value="">待处理</option>${lot.quotes.filter(q=>q.amount===lot.amount).map(q=>`<option value="${q.registration_id}" ${r.registration_id===q.registration_id?'selected':''}>${escHtml(q.company_name)}</option>`).join('')}</select></label><label>处理依据<input data-ob-resolution-note value="${escHtml(r.note || '')}"></label></fieldset>`;
            }).join('');
        }
        if(kind==='fee')html=field('fee_date','实际到账日期','date')+field('fee_reference','到账凭证（编号或附件名称）')+'<p>填写到账信息后，使用原通知书模块登记签发及送达。发票和金额仍在原收费记录中管理。</p>';
        if(kind==='notice')html='<p>按下方原通知书记录登记签发与送达，收件供应商与成交结果保持一致。</p>';
        if(saved.stale)html='<p role="alert">报名或采购包已变更，请重新核对报价结果。</p>'+html;
        if(d.verified && ['registration','quotation','publication'].includes(kind))html+=field('correction_reason','更正已核对资料时填写原因');
        html+=`<details><summary>本阶段办理记录</summary>${(saved.history || []).filter(h=>(h.reason || '').includes(key)).slice(0,10).map(h=>`<p>${escHtml(h.recorded_at)} · ${escHtml(h.actor)} · ${escHtml(h.reason)}</p>`).join('') || '<p>暂无本阶段记录</p>'}</details>`;
        host.innerHTML=html;
        if(kind==='registration')document.querySelectorAll('[data-online-review]').forEach(slot=>{
            const r=(d.records || []).find(r=>r.registration_id===Number(slot.dataset.onlineReview)) || {};
            slot.innerHTML=`<div class="form-grid-2"><div class="form-group"><label for="ob_review_${slot.dataset.onlineReview}">报名审核</label><select id="ob_review_${slot.dataset.onlineReview}" data-ob-review>${[['pending','待审核'],['supplement','需补正'],['approved','通过'],['rejected','不通过']].map(([v,l])=>`<option value="${v}" ${r.review===v?'selected':''}>${l}</option>`).join('')}</select></div><div class="form-group"><label for="ob_note_${slot.dataset.onlineReview}">审核意见（补正/不通过必填）</label><input id="ob_note_${slot.dataset.onlineReview}" data-ob-review-note maxlength="2000" value="${escHtml(r.review_note || '')}"></div></div>`;
        });
        const draft=onlineBiddingDrafts.get(`${pid}:${key}`);
        if(draft) {
            onlineBiddingDraftControls(host).forEach((el,i)=>{const name=el.id || `control-${i}`;if(Object.prototype.hasOwnProperty.call(draft.values,name))el.value=draft.values[name];});
            // Keep the draft's revision so concurrent updates produce a conflict.
            host.onlineState.saved=draft.saved;
            if(draft.saved.revision!==saved.revision)host.insertAdjacentHTML('afterbegin','<p role="alert">其他阶段或用户已更新资料。当前保留了未保存内容，请先复制需要保留的信息，再读取最新资料重新核对。</p><button type="button" class="btn btn-sm" onclick="discardOnlineBiddingDraft()">放弃本阶段草稿，读取最新资料</button>');
        }
        onlineBiddingDraftControls(host).forEach(el=>{
            el.addEventListener('input',()=>captureOnlineBiddingDraft(host));
            el.addEventListener('change',()=>captureOnlineBiddingDraft(host));
        });
    }catch(error){if(host.isConnected)host.innerHTML=`<p role="alert">${escHtml(error.message || '读取失败，请重新打开阶段')}</p>`;}
}

async function saveOnlineBiddingInline(stageData) {
    const host=document.getElementById('onlineBiddingInline');
    if(!host)return;
    const state=host.onlineState;
    if(!state)throw new Error('本阶段业务信息尚未读取完成，请稍后重试');
    if(host.onlineSaving)throw new Error('正在保存，请稍候');
    const {saved,project,key,kind}=state;
    if(currentProject?.id!==project.id || editingStageKey!==key)throw new Error('项目已切换，请重新打开阶段');
    const data=JSON.parse(JSON.stringify(saved.data || {}));
    // Archiving uses the existing stage and checklist, not a second ledger flag.
    data.archive_checked=false;
    const reason=host.querySelector('[data-ob-field="correction_reason"]')?.value.trim() || '';
    host.querySelectorAll('[data-ob-field]').forEach(el=>{if(el.dataset.obField!=='correction_reason')data[el.dataset.obField]=el.value.trim();});
    data.records=(project.registrations || []).map(r=>({...((data.records || []).find(row=>row.registration_id===r.id) || {registration_id:r.id,review:'pending',review_note:'',amount:'',quoted_at:''})}));
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
    if(flag)data[flag]=Boolean(stageData.completed && !stageData.skipped);
    if(kind==='fee')data.fee_received=Boolean(data.fee_date && data.fee_reference);
    if(kind==='fee' || kind==='notice'){
        const notices=project.notice_deliveries || [];
        data.notice_date=notices.map(n=>n.pickup_date).filter(Boolean).sort().pop() || '';
        data.notice_reference=notices.length?'已关联原通知书领取/送达记录':'';
        if(key==='service_fee') {data.notice_delivered=Boolean(saved.data?.notice_delivered); data.fee_received=Boolean(stageData.completed && data.fee_date && data.fee_reference);}
    }
    if(JSON.stringify(data)===JSON.stringify(saved.data || {})) {
        onlineBiddingDrafts.delete(`${project.id}:${key}`);
        return;
    }
    host.onlineSaving=true;
    const controls=onlineBiddingDraftControls(host);
    const disabled=controls.map(el=>el.disabled);
    controls.forEach(el=>{el.disabled=true;});
    try{
        const response=await api('PUT',`/api/projects/${project.id}/online-bidding`,{revision:saved.revision,data,reason:reason || `阶段 ${key} 保存业务资料`,stage_key:key});
        state.saved=response;
        onlineBiddingDrafts.delete(`${project.id}:${key}`);
    }finally{host.onlineSaving=false;controls.forEach((el,i)=>{el.disabled=disabled[i];});}
}

function fillOnlineBiddingHours() {
    const start=document.getElementById('ob_start_at'),end=document.getElementById('ob_end_at');
    const date=(start?.value || end?.value || '').slice(0,10);
    if(!date){toast('请先选择竞价日期','warning');return;}
    start.value=`${date}T09:00`;end.value=`${date}T12:00`;
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

function onlineBiddingSummaryHtml(summary, project) {
    const lots = summary.lots || [];
    return `<div role="status"><strong>${escHtml(summary.status)}</strong> · 已登记报价 ${Number(summary.quoted || 0)} / ${Number(summary.eligible || 0)} 家${summary.verified ? '（已核对）' : '（仅登记进度）'}</div>${lots.map(lot => {
        const definition = (project.lots || []).find(item => item.id === lot.lot_id);
        return `<div class="biz-sec"><div class="biz-bar"><b>${escHtml(definition ? `${definition.lot_number} ${definition.lot_name}` : '项目报价')}</b><span>${escHtml(lot.status)}</span></div><div class="biz-body">${lot.winner ? `<p><strong>最低价供应商：${escHtml(lot.winner)}　¥${escHtml(lot.amount)}</strong></p>` : ''}${(lot.quotes || []).map((r, index) => `<div class="biz-row"><span>${index + 1}. ${escHtml(r.company_name)}</span><span>¥${escHtml(r.amount)} · ${escHtml(r.quoted_at)}</span></div>`).join('') || '<p>暂无有效报价</p>'}</div></div>`;
    }).join('')}`;
}
