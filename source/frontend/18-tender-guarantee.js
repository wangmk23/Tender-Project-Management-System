// ── 有效投标与保证金退还期限 ──
const TG_LABELS = {
    pending:'待确认', absent:'未参加', no_documents:'未提交文件', rejected:'文件未接收', submitted:'已提交并接收',
    valid:'有效投标', invalid:'无效投标', unknown:'缴纳情况待确认', unpaid:'未缴纳', paid:'已缴纳',
    review:'待核实', rule:'按规则处理', hold:'暂缓处理', waiting:'等待起算', estimated:'计划预估', due:'今日到期', overdue:'已逾期', returned:'已退清',
    winner:'中标供应商', nonwinner:'未中标供应商', exception:'未参加或无效但已缴', unconfirmed:'参与或结果待确认'
};
function tgLabel(value) { return TG_LABELS[value] || value || '待确认'; }
function tgLot(p,id) { const l=(p.lots||[]).find(x=>String(x.id)===String(id)); return l ? `${l.lot_number||''} ${l.lot_name||'采购包'}`.trim() : id==null?'整体项目':`历史采购包 #${id}`; }
const tenderLedgerRequests=new Map();
async function loadTenderGuarantee(project=currentProject,{force=false}={}) {
    if(!project?.id)return null;
    if(!force&&project.tender_guarantee?.data)return project.tender_guarantee;
    const key=Number(project.id);
    if(!tenderLedgerRequests.has(key)){
        const pending=api('GET',`/api/projects/${key}/tender-guarantee`).finally(()=>{if(tenderLedgerRequests.get(key)===pending)tenderLedgerRequests.delete(key);});
        tenderLedgerRequests.set(key,pending);
    }
    const ledger=await tenderLedgerRequests.get(key);
    if(!ledger?.data)throw new Error('参与与保证金数据加载失败');
    project.tender_guarantee=ledger;return ledger;
}
function tgExpectedAmount(p,lotId){const amounts=p.tender_guarantee?.data?.amounts||[];return amounts.find(x=>String(x.lot_id??'')===String(lotId??''))?.amount??amounts.find(x=>x.lot_id===null)?.amount??'';}
function tgInsufficient(p,row,lotId){const expected=tgExpectedAmount(p,lotId);return !p.no_deposit&&p.tender_guarantee?.policy?.strict_results!==false&&expected!==''&&['paid','unpaid'].includes(row?.deposit_status)&&Number(row.deposit_amount||0)<Number(expected);}
function renderDocumentAmountSummary(p){
    const amount=tgExpectedAmount(p,null);
    return `<section class="project-guarantee-summary"><div><strong>保证金金额</strong><p class="tg-muted">${p.no_deposit?'本项目无需投标保证金':(amount?'每家 ¥'+escHtml(amount):'尚未设置')+' · 分包可单独设置'}</p></div>${p.no_deposit?'':'<button type="button" class="btn btn-sm btn-secondary" onclick="showGuaranteeAmountForm()">设置金额</button>'}</section>`;
}
function tenderEligibleRegistration(project,registration,lotId) {
    const ledger=project?.tender_guarantee;
    const sameLot=String(registration?.lot_id??'')===String(lotId??'');
    if (!ledger || ledger.policy?.strict_results===false) return !lotId || sameLot;
    const row=(ledger.data?.records||[]).find(r=>String(r.registration_id)===String(registration?.id));
    return Boolean(sameLot && ledger.data?.confirmed && !ledger.data?.stale && !ledger.summary?.stale && row?.participation==='submitted' && row.validity==='valid' && !tgInsufficient(project,row,lotId));
}
function tgStatus(text,kind) { return `<span class="tg-status tg-status-${['valid','invalid','pending','hold','review','returned','overdue'].includes(kind)?kind:'pending'}">${escHtml(text)}</span>`; }
function renderParticipationSection(p,s) {
    const ledger=p?.tender_guarantee;
    if (!ledger) return '<div class="settings-note warning">参与名单尚未加载，请重新打开阶段。</div>';
    const rows=(p.registrations||[]).map(r=>{const x=(ledger.data.records||[]).find(v=>String(v.registration_id)===String(r.id))||{};
        const outstanding=x.deposit_status==='paid'&&Number(x.deposit_amount)>Number(x.refunded_amount||0);
        const cash=p.no_deposit?(outstanding?`<div class="tg-muted">历史缴款待退 ¥${(Number(x.deposit_amount)-Number(x.refunded_amount||0)).toFixed(2)}</div>`:''):`<div class="tg-muted">${escHtml(tgLabel(x.deposit_status||'unknown'))}${x.deposit_status==='paid'?` · 实缴 ¥${escHtml(x.deposit_amount)} · 已退 ¥${escHtml(x.refunded_amount||'0')}`:''}</div>`;
        const action=p.no_deposit?(outstanding?`<button class="btn btn-sm btn-secondary" onclick="showGuaranteeRefundForm(${Number(r.id)})">处理历史退款</button>`:''):`<button class="btn btn-sm btn-secondary" onclick="showGuaranteePaymentForm(${Number(r.id)})">登记缴款</button>`;
        return `<div class="tg-roster-row"><div><strong>${escHtml(r.company_name)}</strong><div class="tg-muted">${escHtml(tgLot(p,r.lot_id))}</div></div><div>${tgStatus(tgLabel(x.participation),x.participation)} ${x.participation==='submitted'?(tgInsufficient(p,x,r.lot_id)?tgStatus('保证金不足额','invalid'):tgStatus(tgLabel(x.validity),x.validity)):''}${cash}${x.reason?`<div class="tg-muted">${escHtml(x.reason)}</div>`:''}</div><div class="tg-actions"><button class="btn btn-sm btn-secondary" onclick="showTenderSupplierForm(${Number(r.id)})">核对参与</button>${action}</div></div>`;
    }).join('');
    return `<section class="tg-section"><div class="tg-heading"><h4>实际参与与有效投标</h4>${p.no_deposit?'':'<button class="btn btn-sm btn-secondary" onclick="showGuaranteeAmountForm()">保证金金额</button>'}${tgStatus(ledger.data.stale?'名单发生变化，请重新核对':ledger.data.confirmed?'名单已确认':'名单待确认',ledger.data.confirmed&&!ledger.data.stale?'valid':'pending')}</div><p class="tg-muted">逐一核对实际参与、文件接收和有效性；报名记录不会自动成为有效投标。</p>${ledger.policy?.strict_results===false?'<div class="settings-note">历史已完成结果保留原供应商选项，登记不会改写既有结果。</div>':''}${rows||'<div class="empty-state">暂无报名记录</div>'}${rows?'<button class="btn btn-primary btn-sm" onclick="confirmTenderRoster()">确认已核对参与名单</button>':''}</section>`;
}
function tgRuleGroup(l,lot,scope){return (l.data.rules||[]).filter(r=>(r.lot_id??null)===(lot??null)&&r.scope===scope);}
function tgPrimaryRule(rows){return rows.find(r=>r.enabled)||rows.at(-1);}
function tgRuleSummary(p,r){
    const stage=(p.stages||[]).find(s=>s.key===r.start_stage_key);
    const anchor=r.manual_start_at?`${r.manual_start_at}起算`:stage?(stage.name||stage.key):'未选择有效起算阶段';
    return `${anchor} · ${r.days??5}${r.day_kind==='calendar'?'个自然日':'个工作日'}${r.cutoff?` · ${r.cutoff}截止`:''}`;
}
function tgNextActionHtml(x){
    if(!x.next_action||x.status==='returned')return '';
    const labels={rule:x.issue_code==='rule_disabled'?'启用对应退还规则':'设置对应退还规则',participation:'核对实际参与',result:'核对并完成结果阶段',stage:'查看起算阶段',resume:'核实后按规则处理',recalculate:'复核期限调整',special:'核对特殊处理'};
    return `<button type="button" class="btn btn-sm btn-secondary" data-guarantee-next="${escHtml(x.next_action)}" data-registration="${Number(x.registration_id)}" data-scope="${escHtml(x.scope||'')}" data-lot="${x.lot_id==null?'':Number(x.lot_id)}" onclick="tgFollowGuaranteeAction(Number(this.dataset.registration))">${escHtml(labels[x.next_action]||'查看处理依据')}</button>`;
}
async function tgFollowGuaranteeAction(id){
    const p=currentProject,l=await tgReady(p);if(!l)return;
    const x=(l.items||[]).find(i=>Number(i.registration_id)===Number(id));if(!x)return;
    if(x.next_action==='rule')return showGuaranteeRuleForm(null,{lot_id:x.lot_id??null,scope:x.scope});
    if(x.next_action==='participation')return showTenderSupplierForm(id);
    if(x.next_action==='result'){
        const stage=(p.stages||[]).find(s=>['result_publication','bid_results'].some(m=>(s.modules||[]).includes(m))||['result_announced','online_result_announced'].includes(s.key));
        if(stage){closeModal();return openStageSlide(stage.key);}
        toast('未找到结果阶段，请在项目流程中核对结果公示阶段配置','warning');return;
    }
    if(x.next_action==='resume')return showGuaranteeResumeForm(id);
    if(x.next_action==='recalculate')return showGuaranteeRecalculation();
    if(x.next_action==='stage'&&x.start_stage_key&&(p.stages||[]).some(s=>s.key===x.start_stage_key)){
        closeModal();return openStageSlide(x.start_stage_key);
    }
    return showGuaranteeSpecialForm(id);
}
async function showGuaranteeRules(){
    const p=currentProject,l=await tgReady(p);if(!l)return;
    const lots=[null,...new Set([...(p.lots||[]).map(x=>x.id),...(l.data.rules||[]).map(r=>r.lot_id).filter(x=>x!=null)])];
    const rows=lots.map(lot=>`<section class="tg-rules-group"><h4>${escHtml(tgLot(p,lot))}</h4>${['nonwinner','winner','exception'].map(scope=>{
        const group=tgRuleGroup(l,lot,scope),r=tgPrimaryRule(group),old=group.filter(x=>x!==r);
        return `<article class="tg-rule-row" data-rule-group="${lot==null?'whole':Number(lot)}:${scope}"><div class="tg-rule-row-head"><div><strong>${escHtml(tgLabel(scope))}</strong><span class="tg-muted">${r?(r.enabled?'已启用':'未启用'):'未设置'}</span></div><button type="button" class="btn btn-sm ${r?'btn-secondary':'btn-primary'}" data-rule-id="${escHtml(r?.id||'')}" data-lot="${lot==null?'':Number(lot)}" data-scope="${scope}" onclick="showGuaranteeRuleForm(this.dataset.ruleId||null,{lot_id:this.dataset.lot?Number(this.dataset.lot):null,scope:this.dataset.scope})">${r?'编辑规则':'设置规则'}</button></div><p class="tg-muted">${r?escHtml(tgRuleSummary(p,r)):'设置并启用后，按该类别计算退还日期。'}</p>${old.length?`<details><summary>历史停用记录（${old.length}条）</summary><p class="tg-muted">原记录保留；不重复参与计算。可核对后移除停用配置，缴退记录与审计历史保留。</p>${old.map(o=>`<div class="tg-rule-history"><span>${escHtml(tgRuleSummary(p,o))}</span><button type="button" class="btn btn-xs btn-secondary" data-rule-id="${escHtml(o.id)}" onclick="tgRemoveDisabledRule(this.dataset.ruleId)">移除此停用记录</button></div>`).join('')}</details>`:''}</article>`;
    }).join('')}</section>`).join('');
    showModal('保证金退还规则',`<div class="modal-form tg-form"><p class="settings-note">每个采购包、每类供应商管理一条规则。再次设置会编辑原规则；未启用的规则不计算退还日期。</p><p class="tg-muted">实际完成日期优先；阶段未完成时按计划日期在日历显示预计截止。原确认期限有变化时先复核。</p>${rows}</div>`);
}
async function tgRemoveDisabledRule(id){
    const p=currentProject,l=await tgReady(p);if(!l)return;const row=(l.data.rules||[]).find(r=>r.id===id);
    if(!row||row.enabled){toast('只能移除已停用的规则','warning');return;}
    if(!await confirmDialog('移除历史停用规则','仅移除此停用配置；保留已缴、已退金额和审计历史。','移除'))return;
    const data=JSON.parse(JSON.stringify(l.data));delete data.stale;data.rules=data.rules.filter(r=>r.id!==id);
    try{await tgSave(p,l,data,'移除历史停用退还规则');return showGuaranteeRules();}
    catch(error){toast(error.message||'移除未成功，原记录保留','error');}
}
var tgGuaranteeScope = 'all';
function tgSetGuaranteeScope(scope) {
    tgGuaranteeScope=scope;
    const section=document.querySelector('[data-guarantee-section]');
    if(section)section.outerHTML=renderGuaranteeSection(currentProject);
}
function renderGuaranteeSection(p) {
    const l=p?.tender_guarantee;
    if(!l)return '<div class="settings-note warning">保证金数据尚未加载，请重新打开阶段。</div>';
    const all=l.items||[], scopes=['all','nonwinner','winner','exception','unconfirmed'];
    const chosen=scopes.includes(tgGuaranteeScope)?tgGuaranteeScope:'all';
    const list=chosen==='all'?all:all.filter(x=>x.scope===chosen);
    const tabs=scopes.map(k=>`<button type="button" role="tab" aria-selected="${k===chosen}" class="tg-scope-tab ${k===chosen?'active':''}" onclick="tgSetGuaranteeScope('${k}')">${k==='all'?'全部':escHtml(tgLabel(k))}<span>${k==='all'?all.length:all.filter(x=>x.scope===k).length}</span></button>`).join('');
    const cards=list.map(x=>{
        const status=x.status==='pending'?'待退还':x.issue_code==='rule_disabled'?'规则未启用':x.issue_code==='rule_missing'?'未设置规则':tgLabel(x.status);
        const date=x.deadline?`退还截止：${escHtml(x.deadline.replace('T',' '))}`:x.estimated_deadline?`预计退还截止：${escHtml(x.estimated_deadline.replace('T',' '))}`:'退还截止：尚未生成';
        return `<article class="tg-deadline-card"><div class="tg-heading"><strong>${escHtml(x.supplier_name)}</strong>${tgStatus(status,x.status)}</div><div class="tg-muted">${escHtml(tgLot(p,x.lot_id))} · ${escHtml(tgLabel(x.scope||'unconfirmed'))}</div><div class="tg-balance">待退余额 ¥${escHtml(x.balance)}</div><div>${date}</div>${x.deadline&&x.status!=='returned'?`<div class="tg-countdown" data-refund-deadline="${escHtml(x.deadline)}">${typeof refundCountdown==='function'?escHtml(refundCountdown(x.deadline)):''}</div>`:''}<p class="tg-muted">${escHtml(x.status_detail||x.basis||'')}</p>${x.review_at?`<div>复核日期：${escHtml(x.review_at)}</div>`:''}${x.needs_recheck?`<div class="settings-note warning">保留原截止日，调整待复核${x.proposed_deadline?`：${escHtml(x.proposed_deadline.replace('T',' '))}`:''}。</div>`:''}<div class="tg-actions">${tgNextActionHtml(x)}${x.status!=='returned'?`<button class="btn btn-sm btn-primary" onclick="showGuaranteeRefundForm(${Number(x.registration_id)})">登记退款</button>`:''}<button class="btn btn-sm btn-secondary" onclick="showGuaranteeSpecialForm(${Number(x.registration_id)})">特殊处理</button></div></article>`;
    }).join('');
    const groups=new Map();for(const r of l.data.rules||[]){const key=`${r.lot_id??'whole'}:${r.scope}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
    const primary=[...groups.values()].map(tgPrimaryRule),duplicates=(l.data.rules||[]).length-primary.length;
    const rules=primary.map(r=>`<button type="button" class="btn btn-sm btn-secondary" data-tg-rule="${escHtml(r.id)}" onclick="showGuaranteeRuleForm(this.dataset.tgRule)">${escHtml(tgLot(p,r.lot_id))} · ${escHtml(tgLabel(r.scope))} · ${r.enabled?'已启用':'未启用'}</button>`).join('');
    return `<section class="tg-section" data-guarantee-section><div class="tg-heading"><div><h4>保证金退还</h4><p class="tg-muted">实际完成日期优先；未完成时按计划日期预估。</p></div><div class="tg-actions"><button class="btn btn-sm btn-secondary" onclick="showGuaranteeAmountForm()">保证金金额</button><button class="btn btn-sm btn-secondary" onclick="showGuaranteeRules()">设置退还规则</button></div></div><div class="tg-rule-list">${rules}${duplicates?`<button type="button" class="btn btn-sm btn-secondary" onclick="showGuaranteeRules()">查看${duplicates}条历史停用记录</button>`:''}${all.some(x=>x.needs_recheck)?'<button class="btn btn-sm btn-primary" onclick="showGuaranteeRecalculation()">复核期限调整</button>':''}</div><div class="tg-scope-tabs" role="tablist" aria-label="保证金供应商分类">${tabs}</div>${l.summary?.mail_failed?`<div class="settings-note warning">${Number(l.summary.mail_failed)} 条邮件投递失败。<button class="btn btn-xs btn-secondary" onclick="retryGuaranteeMail()">重新排队</button></div>`:''}<div class="tg-deadline-grid">${cards||'<div class="empty-state">此分类暂无已确认缴纳记录。</div>'}</div></section>`;
}

function tgInput(id,label,value='',type='text',attrs='') { const money=type==='number'&&/金额|保证金/.test(label);return `<div class="form-group"><label for="${id}">${label}</label><input id="${id}" type="${money?'text':type}" ${money?'inputmode="decimal"':''} value="${escHtml(value)}" ${attrs}></div>`; }
function tgSelect(id,label,values,value) { return `<div class="form-group"><label for="${id}">${label}</label><select id="${id}">${values.map(x=>`<option value="${escHtml(x)}" ${x===value?'selected':''}>${escHtml(tgLabel(x))}</option>`).join('')}</select></div>`; }
function tgValue(id) { return document.getElementById(id)?.value.trim()||''; }
function tgAuditForm(l) { return tgInput('tgAuditReason','特殊调整说明（必填）'); }
async function tgReady(p) { try { return await loadTenderGuarantee(p); } catch(e) {toast(e.message,'error'); return null;} }
async function tgSave(p,l,data,reason,flags={}) {
    const stage=typeof editingStageKey!=='undefined'&&document.getElementById('slidePanel')?.classList.contains('open')?editingStageKey:null;
    await api('PUT',`/api/projects/${p.id}/tender-guarantee`,{revision:l.revision,data,reason,...flags});
    closeModal();
    if (typeof currentProject!=='undefined' && String(currentProject?.id)===String(p.id)) {
        await refreshProject();
        if (stage && typeof openStageSlide==='function') await openStageSlide(stage);
    }
    return true;
}
function tgSupplierContext(p,l,regId){
    const stored=(l.data.records||[]).find(x=>String(x.registration_id)===String(regId));
    const r=(p.registrations||[]).find(x=>String(x.id)===String(regId))||(stored?{id:regId,company_name:stored.supplier_name_snapshot||'历史供应商',lot_id:stored.lot_id_snapshot}:null);
    if(!r){toast('报名记录已变化，请重新打开阶段','warning');return null;}
    const row={registration_id:Number(r.id),participation:'pending',validity:'pending',reason:'',deposit_status:'unknown',deposit_amount:'0',refunded_amount:'0',handling:'rule',handling_reason:'',review_at:'',manual_start_at:'',manual_deadline:'',manual_basis:'',...stored};
    return {r,row};
}
function tgReplaceRecord(l,row){const data=JSON.parse(JSON.stringify(l.data));delete data.stale;data.records=(data.records||[]).filter(x=>String(x.registration_id)!==String(row.registration_id));data.records.push(row);return data;}
function tgSupplierHeading(p,r){return `<div class="tg-supplier-heading"><strong>${escHtml(r.company_name)}</strong><div class="tg-muted">${escHtml(tgLot(p,r.lot_id))}</div></div>`;}
async function showGuaranteeResumeForm(regId){
    const p=currentProject,l=await tgReady(p);if(!l)return;const context=tgSupplierContext(p,l,regId);if(!context)return;
    const {r,row}=context;
    showModal('确认本次复核',`<div class="modal-form tg-form">${tgSupplierHeading(p,r)}<p>确认已经核实，可以继续按项目退还规则办理。</p><p class="tg-muted">将取消本次暂缓复核日，保留实缴、已退金额和原期限。未设置规则或期限仍有变化时，相关待核实事项继续保留，不会自动标记退款。</p></div>`,async()=>tgSave(p,l,tgReplaceRecord(l,{...row,handling:'rule',handling_reason:'',review_at:''}),'复核已核实，恢复按项目规则办理'));
}
function showGuaranteeCalendarTask(regId,action='review'){
    const p=currentProject,l=p.tender_guarantee,context=tgSupplierContext(p,l,regId);if(!context)return;
    const {r,row}=context,item=(l.items||[]).find(x=>String(x.registration_id)===String(regId));
    if(!item){toast('此供应商当前没有保证金待处理记录','warning');return;}
    const estimated=!!item.estimated_deadline&&!item.deadline;
    const reason=estimated?'这是计划预估安排；阶段完成后将按实际完成日期计算正式截止日。该预计日期不作为实际逾期或退款邮件依据。':item.needs_recheck?'起算条件或期限已变化，需要核对原截止日与拟调整日期。':row.handling==='hold'?`此前暂缓处理：${row.handling_reason||'待核实'}。请核实目前是否可以退还。`:!item.deadline?(item.status_detail||'尚未生成退还截止日，请先核对实际缴款、结果和项目退还规则。'):action==='review'?'已到此前设置的复核日期，请核实是否已退款、可以退款或仍需暂缓。':'已到保证金退还提醒日期，请核实实际退款情况。';
    const detail=item.status_detail&&item.status_detail!==reason?item.status_detail:'';
    const basis=!estimated&&item.basis&&item.basis!==detail&&item.basis!==reason?item.basis:'';
    const resume=['hold','review'].includes(row.handling)&&item.next_action!=='resume';
    showModal(estimated?'查看预计退还安排':action==='review'?'处理保证金复核':'处理保证金退还',`<div class="modal-form tg-form">${tgSupplierHeading(p,r)}<div class="tg-cash-summary"><span>实缴<strong>¥${escHtml(row.deposit_amount)}</strong></span><span>已退<strong>¥${escHtml(row.refunded_amount)}</strong></span><span>待退<strong>¥${escHtml(item.balance)}</strong></span></div><div class="settings-note${estimated?'':' warning'}">${escHtml(reason)}</div>${basis?`<p class="tg-muted">当前记录：${escHtml(basis)}</p>`:''}<p>${estimated?'预计退还截止':'退还截止'}：${escHtml((item.deadline||item.estimated_deadline||'尚未生成').replace('T',' '))}</p>${detail?`<p>${escHtml(detail)}</p>`:''}${tgNextActionHtml(item)}${item.proposed_deadline?`<p>拟调整截止：${escHtml(item.proposed_deadline.replace('T',' '))}</p>`:''}${item.status==='returned'?'<p>已退清，无需继续处理。</p>':`<p class="tg-muted">按实际情况选择操作；打开页面不会自动确认复核或退款。</p><div class="tg-actions"><button class="btn btn-primary" onclick="showGuaranteeRefundForm(${Number(regId)})">已退款，登记退款</button>${item.needs_recheck&&item.next_action!=='recalculate'?'<button class="btn btn-secondary" onclick="showGuaranteeRecalculation()">核对期限变化</button>':''}${!item.deadline&&!estimated&&item.next_action!=='rule'?'<button class="btn btn-secondary" onclick="showGuaranteeRules()">设置退还规则</button>':''}<button class="btn btn-secondary" onclick="showGuaranteeSpecialForm(${Number(regId)})">仍需暂缓或特殊处理</button>${resume?`<button class="btn btn-secondary" onclick="showGuaranteeResumeForm(${Number(regId)})">已核实，按规则处理</button>`:''}</div>`}</div>`);
}
function syncTenderValidity(){
    const participation=document.getElementById('tgParticipation'),validity=document.getElementById('tgValidity');
    if(!participation||!validity)return;
    const applicable=participation.value==='submitted';
    validity.closest('.form-group').hidden=!applicable;
    validity.disabled=!applicable;
    if(!applicable)validity.value='pending';
}
async function showTenderSupplierForm(regId){
    const p=currentProject,l=await tgReady(p);if(!l)return;const context=tgSupplierContext(p,l,regId);if(!context)return;const {r,row}=context;
    showModal('核对实际参与',`<div class="modal-form tg-form">${tgSupplierHeading(p,r)}<div class="form-row">${tgSelect('tgParticipation','参加及文件接收',['pending','absent','no_documents','rejected','submitted'],row.participation)}${tgSelect('tgValidity','投标有效性',['pending','valid','invalid'],row.validity)}</div>${tgInput('tgReason','未参加、未提交、文件未接收或无效时填写原因',row.reason)}<p class="tg-muted">仅对已提交并接收的文件核对投标有效性；缴款情况仍须独立登记。</p></div>`,async()=>{
        const participation=tgValue('tgParticipation');
        const x={...row,participation,validity:participation==='submitted'?tgValue('tgValidity'):'pending',reason:tgValue('tgReason')};
        if(x.validity==='valid'&&x.participation!=='submitted'){toast('只有已提交并接收文件才能确认有效投标','warning');return false;}
        if((x.validity==='invalid'||['absent','no_documents','rejected'].includes(x.participation))&&!x.reason){toast('请填写实际参与或无效原因','warning');return false;}
        const data=tgReplaceRecord(l,x);if(['participation','validity','reason'].some(k=>row[k]!==x[k]))data.confirmed=false;
        return tgSave(p,l,data,'核对实际参与与文件接收');
    });
    document.getElementById('tgParticipation')?.addEventListener('change',syncTenderValidity);
    syncTenderValidity();
}
async function showGuaranteeAmountForm(){
    if(currentProject?.no_deposit){toast('本项目无需投标保证金','info');return;}
    const p=currentProject,l=await tgReady(p);if(!l)return;const lots=[{id:null},...(p.lots||[])];
    showModal('保证金金额',`<div class="modal-form tg-form"><p class="tg-muted">按采购文件设置，每家登记已缴时自动带入。修改这里不会改变已登记的实缴金额。</p>${lots.map((r,i)=>tgInput('tgExpected'+i,escHtml(tgLot(p,r.id)),(l.data.amounts||[]).find(x=>String(x.lot_id??'')===String(r.id??''))?.amount||'','text','inputmode="decimal" placeholder="未设置"')).join('')}</div>`,async()=>{
        const data=JSON.parse(JSON.stringify(l.data));delete data.stale;
        const amounts=lots.filter((r,i)=>tgValue('tgExpected'+i)!=='').map(r=>({lot_id:r.id,amount:tgValue('tgExpected'+lots.indexOf(r))}));
        if(amounts.some(x=>!Number.isFinite(Number(x.amount))||Number(x.amount)<0)){toast('请输入有效金额','warning');return false;}
        // Preserve historic lot configuration outside the current editor.
        data.amounts=[...(data.amounts||[]).filter(x=>!lots.some(r=>r.id===x.lot_id)),...amounts];
        return tgSave(p,l,data,'设置采购保证金金额');
    });
}
async function showGuaranteePaymentForm(regId){
    if(currentProject?.no_deposit){toast('本项目无需投标保证金','info');return;}
    const p=currentProject,l=await tgReady(p);if(!l)return;const context=tgSupplierContext(p,l,regId);if(!context)return;const {r,row}=context;
    const expected=tgExpectedAmount(p,r.lot_id);
    const paid=row.deposit_status==='paid';
    showModal('登记保证金缴款',`<div class="modal-form tg-form">${tgSupplierHeading(p,r)}<div class="settings-note">文件要求：${expected?'¥'+escHtml(expected):'尚未设置'}。须核实实际到账；不足额默认不参加，足额后仍须核对文件接收和有效性。</div>${tgSelect('tgDepositStatus','实际缴纳情况',['unknown','unpaid','paid'],row.deposit_status)}${tgInput('tgDepositAmount','实际缴纳金额（元）',paid?row.deposit_amount:expected,'number',`min="0" step="0.01" ${paid?'readonly':''}`)}${paid?'<p class="tg-muted">已登记实缴金额。更正误录请使用“特殊处理”；正常退款请使用“登记退款”。</p>':''}</div>`,async()=>{
        const status=tgValue('tgDepositStatus'),amount=status==='paid'?tgValue('tgDepositAmount'):'0';
        if(paid&&(status!==row.deposit_status||Number(amount)!==Number(row.deposit_amount))){toast('请在特殊处理中更正已登记缴款','warning');return false;}
        if(status==='paid'&&(!amount||!Number.isFinite(Number(amount))||Number(amount)<=0)){toast('请填写实际到账金额','warning');return false;}
        const x={...row,deposit_status:status,deposit_amount:amount};
        const insufficient=!p.no_deposit&&l.policy?.strict_results!==false&&expected!==''&&['paid','unpaid'].includes(status)&&Number(amount)<Number(expected);
        if(insufficient)Object.assign(x,{participation:'absent',validity:'pending',reason:`保证金不足额缴纳（应缴 ${Number(expected).toFixed(2)} 元，实缴 ${Number(amount).toFixed(2)} 元），按未参加处理`});
        const data=tgReplaceRecord(l,x);if(insufficient)data.confirmed=false;
        return tgSave(p,l,data,'登记保证金实际缴款');
    });
}
async function showGuaranteeRefundForm(regId){
    const p=currentProject,l=await tgReady(p);if(!l)return;const context=tgSupplierContext(p,l,regId);if(!context)return;const {r,row}=context;
    const balance=Math.round((Number(row.deposit_amount)-Number(row.refunded_amount))*100)/100;
    if(row.deposit_status!=='paid'||balance<=0){toast('没有可登记的待退余额','warning');return;}
    showModal('登记保证金全额退还',`<div class="modal-form tg-form">${tgSupplierHeading(p,r)}<div class="tg-cash-summary"><span>实缴<strong>¥${escHtml(row.deposit_amount)}</strong></span><span>已退<strong>¥${escHtml(row.refunded_amount)}</strong></span><span>本次全额退还<strong>¥${balance.toFixed(2)}</strong></span></div><p>确认已将待退余额全额退还给该供应商？</p><p class="tg-muted">仅在实际退款完成后确认。历史已退金额、实缴金额和期限记录保留。</p></div>`,async()=>{
        const x={...row,refunded_amount:Number(row.deposit_amount).toFixed(2)};
        return tgSave(p,l,tgReplaceRecord(l,x),'登记保证金全额退款');
    },{saveLabel:'确认已全额退还',busyLabel:'登记中…'});
}
async function showGuaranteeSpecialForm(regId){
    const p=currentProject,l=await tgReady(p);if(!l)return;const context=tgSupplierContext(p,l,regId);if(!context)return;const {r,row}=context;
    showModal('保证金特殊处理',`<div class="modal-form tg-form">${tgSupplierHeading(p,r)}<p class="tg-muted">仅在暂缓、单独改期或更正误录时使用。普通退款不用填写这里。</p>${tgSelect('tgHandling','处理方式',['rule','review','hold'],row.handling)}<details ${row.handling==='hold'?'open':''}><summary>暂缓说明与复核日期</summary>${tgInput('tgHandlingReason','暂缓原因',row.handling_reason)}${tgInput('tgReviewAt','复核日期',row.review_at,'date')}</details><details ${row.manual_deadline?'open':''}><summary>手动调整退还期限</summary>${tgInput('tgManualStart','实际起算日',row.manual_start_at,'date')}${tgInput('tgManualDeadline','退还截止',row.manual_deadline,'datetime-local')}${tgInput('tgManualBasis','调整依据',row.manual_basis,'text','placeholder="例如：按采购人书面通知调整，通知日期……"')}</details><details><summary>更正误录缴款</summary><p class="tg-muted">正常退款不要减少实缴金额。更正会保留原记录。</p><label class="inline-check"><input type="checkbox" id="tgCashCorrection"> 已核对财务凭据，确认更正误录</label>${tgSelect('tgDepositStatus','更正后的缴纳情况',['unknown','unpaid','paid'],row.deposit_status)}${tgInput('tgDepositAmount','更正后的实缴金额',row.deposit_amount,'number','min="0" step="0.01"')}${tgInput('tgRefundedAmount','更正后的累计已退金额',row.refunded_amount,'number','min="0" step="0.01"')}${tgInput('tgCashBasis','更正依据',row.cash_correction_basis||'','text','placeholder="例如：原登记金额误录，已核对到账回单"')}</details>${tgAuditForm(l)}</div>`,async()=>{
        const correction=document.getElementById('tgCashCorrection').checked;
        const x={...row,handling:tgValue('tgHandling'),handling_reason:tgValue('tgHandlingReason'),review_at:tgValue('tgReviewAt'),manual_start_at:tgValue('tgManualStart'),manual_deadline:tgValue('tgManualDeadline'),manual_basis:tgValue('tgManualBasis')};
        if(correction)Object.assign(x,{deposit_status:tgValue('tgDepositStatus'),deposit_amount:tgValue('tgDepositAmount'),refunded_amount:tgValue('tgRefundedAmount'),cash_correction_basis:tgValue('tgCashBasis')});
        const reason=tgValue('tgAuditReason');if(!reason){toast('请填写特殊调整说明','warning');return false;}
        return tgSave(p,l,tgReplaceRecord(l,x),reason,{confirm_cash_correction:correction});
    });
}
async function confirmTenderRoster() {
    const p=currentProject,l=await tgReady(p);if(!l)return;
    showModal('确认实际参与名单',`<div class="modal-form"><div class="settings-note warning">请逐一核对当前采购包、实际参与、文件接收及有效性。确认不会自动将待确认记录变为有效投标。</div></div>`,async()=>{
        const data=JSON.parse(JSON.stringify(l.data));delete data.stale;data.confirmed=true;
        return tgSave(p,l,data,'确认已核对参与名单',{confirm_roster:true});
    });
}
async function showGuaranteeRuleForm(ruleId,target={}) {
    const p=currentProject,l=await tgReady(p);if(!l)return;
    const scope=['winner','nonwinner','exception'].includes(target.scope)?target.scope:'nonwinner',lot=target.lot_id??null;
    const existing=(l.data.rules||[]).find(x=>x.id===ruleId)||tgPrimaryRule(tgRuleGroup(l,lot,scope));
    const row=existing||{id:`rule_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,lot_id:lot,scope,enabled:false,days:5,day_kind:'workday',cutoff:'17:00',remind_days:1};
    const historicLot=row.lot_id!=null&&!(p.lots||[]).some(x=>x.id===row.lot_id)?`<option value="${Number(row.lot_id)}" selected>${escHtml(tgLot(p,row.lot_id))}</option>`:'';
    const stageOptions=(p.stages||[]).map(x=>`<option value="${escHtml(x.key)}" ${x.key===row.start_stage_key?'selected':''}>${escHtml(x.name||x.stage_name||x.key)}</option>`).join('');
    const missing=row.start_stage_key&&!(p.stages||[]).some(x=>x.key===row.start_stage_key)?`<option value="${escHtml(row.start_stage_key)}" selected>原起算阶段已移除，请重选</option>`:'';
    showModal(`${existing?'编辑':'设置'}退还规则 · ${tgLabel(row.scope)}`,`<div class="modal-form tg-form"><div class="settings-note">${existing?'正在编辑已保存的规则，保存会更新原规则，不会新增一条。':'规则默认关闭，请核对依据后勾选启用。'}保存后立即生效，计划预估和正式截止会在日历分别标明。</div><div class="form-group"><label for="tgRuleLot">适用采购包</label><select id="tgRuleLot"><option value="">整体项目</option>${(p.lots||[]).map(x=>`<option value="${Number(x.id)}" ${String(x.id)===String(row.lot_id)?'selected':''}>${escHtml(tgLot(p,x.id))}</option>`).join('')}${historicLot}</select></div>${tgSelect('tgRuleScope','适用对象',['winner','nonwinner','exception'],row.scope)}<div class="form-group"><label for="tgRuleStage">起算阶段</label><select id="tgRuleStage"><option value="">使用手动实际起算日</option>${stageOptions}${missing}</select></div><div class="settings-note">阶段已完成：按实际完成日期顺延。未完成但已排计划：按计划日期预估；完成后再按实际日期计算。两种日期都没有时会提示补充。委托协议不等同于采购合同，请按实际文件选择依据。</div>${tgInput('tgRuleManualStart','手动实际起算日（选择阶段时请留空）',row.manual_start_at,'date')}<div class="form-row">${tgInput('tgRuleDays','期限天数（1–365）',row.days,'number','min="1" max="365" step="1"')}<div class="form-group"><label for="tgRuleDayKind">计算方式</label><select id="tgRuleDayKind"><option value="calendar" ${row.day_kind==='calendar'?'selected':''}>自然日</option><option value="workday" ${row.day_kind==='workday'?'selected':''}>工作日（含调休补班）</option></select></div></div><div class="form-row">${tgInput('tgRuleCutoff','截止时分',row.cutoff,'time')}${tgInput('tgRuleRemind','提前提醒天数（0–365）',row.remind_days,'number','min="0" max="365" step="1"')}</div><label class="inline-check"><input type="checkbox" id="tgRuleEnabled" ${row.enabled?'checked':''}> 已核对依据，启用本条规则</label><p class="tg-muted">未勾选时仅保存配置，不生成退还日期。</p></div>`,async()=>{
        const x={id:row.id,lot_id:tgValue('tgRuleLot')?Number(tgValue('tgRuleLot')):null,scope:tgValue('tgRuleScope'),enabled:document.getElementById('tgRuleEnabled').checked,start_stage_key:tgValue('tgRuleStage'),manual_start_at:tgValue('tgRuleManualStart'),days:Number(tgValue('tgRuleDays')),day_kind:tgValue('tgRuleDayKind'),cutoff:tgValue('tgRuleCutoff'),remind_days:Number(tgValue('tgRuleRemind'))};
        if(!Number.isInteger(x.days)||x.days<1||x.days>365||!Number.isInteger(x.remind_days)||x.remind_days<0||x.remind_days>365){toast('请填写有效的期限与提前提醒天数','warning');return false;}
        if(x.enabled&&Boolean(x.start_stage_key)===Boolean(x.manual_start_at)){toast('启用规则须选择一个起算阶段或实际日期','warning');return false;}
        const duplicate=tgPrimaryRule(tgRuleGroup(l,x.lot_id,x.scope).filter(v=>v.id!==x.id));
        if(!existing&&duplicate){toast('该范围已有规则，请返回管理页编辑原规则','warning');return false;}
        const data=JSON.parse(JSON.stringify(l.data));delete data.stale;
        const index=(data.rules||[]).findIndex(v=>v.id===x.id);if(index>=0)data.rules[index]=x;else (data.rules??=[]).push(x);
        await tgSave(p,l,data,`${existing?'编辑':'设置'}${tgLabel(x.scope)}保证金退还规则`);
        toast(x.enabled?'退还规则已保存并启用；日期已同步日历':'规则已保存但未启用，不计算退还日期','success');return true;
    },{saveLabel:'保存规则',busyLabel:'保存中…'});
    if(existing||Object.keys(target).length){document.getElementById('tgRuleLot').disabled=true;document.getElementById('tgRuleScope').disabled=true;}
}

async function showGuaranteeRecalculation() {
    const p=currentProject,l=await tgReady(p);if(!l)return;
    const changed=(l.items||[]).filter(x=>x.needs_recheck);
    showModal('复核保证金期限调整',`<div class="modal-form"><div class="settings-note warning">确认后按当前实际起算依据重新计算期限。请逐一核对以下调整，填写复核依据。</div>${changed.map(x=>`<p><strong>${escHtml(x.supplier_name)}</strong> · ${escHtml(tgLot(p,x.lot_id))}<br>原截止：${escHtml(x.deadline||'无')}<br>拟调整：${escHtml(x.proposed_deadline||'待确认')}<br>${escHtml(x.basis||'')}</p>`).join('')}${tgAuditForm(l)}</div>`,async()=>{
        const reason=tgValue('tgAuditReason');if(!reason){toast('请填写期限复核依据','warning');return false;}
        const data=JSON.parse(JSON.stringify(l.data));delete data.stale;
        return tgSave(p,l,data,reason,{accept_recalculation:true});
    });
}

async function showGuaranteeDefaults(method) {
    try {
        const config=await api('GET','/api/tender-guarantee/defaults');
        const methods=Object.keys(config.templates||{});method=methods.includes(method)?method:methods[0];
        if(!method){toast('请先保存采购方式阶段模板','warning');return;}
        const rows=['winner','nonwinner','exception'].map(scope=>(config.rules[method]||[]).find(r=>r.scope===scope)||{id:'default_'+scope,scope,lot_id:null,enabled:false,days:5,day_kind:'workday',cutoff:'',remind_days:1,start_stage_key:'',manual_start_at:''});
        const editable=Boolean(window.CURRENT_USER?.is_admin);
        showModal('新项目保证金退还规则',`<div class="modal-form"><div class="settings-note">仅影响之后创建的新项目；现有项目和已完成阶段保持原规则。供应商实际缴款仍须逐一确认。</div><div class="form-group"><label>采购方式</label><select onchange="showGuaranteeDefaults(this.value)">${methods.map(m=>`<option value="${escHtml(m)}" ${m===method?'selected':''}>${escHtml(config.methods?.find(x=>x.id===m)?procurementMethodLabel(config.methods.find(x=>x.id===m)):m)}</option>`).join('')}</select></div>${rows.map((r,i)=>`<section class="tg-section"><h4>${escHtml(tgLabel(r.scope))}</h4><label class="inline-check"><input id="gdEnabled${i}" type="checkbox" ${r.enabled?'checked':''} ${editable?'':'disabled'}> 已核对依据，供新项目启用</label><div class="form-group"><label>实际起算阶段</label><select id="gdStage${i}"><option value="">请选择阶段</option>${config.templates[method].map(s=>`<option value="${escHtml(s.id)}" ${s.id===r.start_stage_key?'selected':''}>${escHtml(s.name)}</option>`).join('')}</select></div><div class="form-row">${tgInput('gdDays'+i,'期限天数',r.days,'number','min="1" max="365" step="1"')}<div class="form-group"><label>计算方式</label><select id="gdKind${i}"><option value="calendar" ${r.day_kind==='calendar'?'selected':''}>自然日</option><option value="workday" ${r.day_kind==='workday'?'selected':''}>国家安排的工作日</option></select></div></div><div class="form-row">${tgInput('gdCutoff'+i,'截止时分（可留空）',r.cutoff,'time')}${tgInput('gdRemind'+i,'提前提醒天数',r.remind_days,'number','min="0" max="365" step="1"')}</div></section>`).join('')}<p class="tg-muted">委托协议不是采购合同；请按实际业务依据选择阶段。日历未覆盖的年度不能估算工作日期限。</p></div>`,editable?async()=>{
            const rules=rows.map((r,i)=>({...r,enabled:document.getElementById('gdEnabled'+i).checked,start_stage_key:tgValue('gdStage'+i),days:Number(tgValue('gdDays'+i)),day_kind:tgValue('gdKind'+i),cutoff:tgValue('gdCutoff'+i),remind_days:Number(tgValue('gdRemind'+i))}));
            const result=await api('PUT','/api/tender-guarantee/defaults',{method,rules,revision:config.methods?.find(x=>x.id===method)?.revision});if(typeof loadProcurementCatalog==='function')await loadProcurementCatalog({refresh:true});closeModal();toast(result.message,'success');
        }:null);
    }catch(error){toast(error.message,'error');}
}

async function retryGuaranteeMail(){const p=currentProject;showModal("重试保证金邮件",`<p>仅重试当前仍有效的提醒。网络中断时邮件可能已被服务器接收，请核实后再重试。</p>`,async()=>{const result=await api("POST",`/api/projects/${p.id}/tender-guarantee/retry-mail`,{});closeModal();toast(result.message,"success");await refreshProject();});}
