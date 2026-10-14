// ── 有效投标与保证金退还期限 ──
const TG_LABELS = {
    pending:'待确认', absent:'未参加', no_documents:'未提交文件', rejected:'文件未接收', submitted:'已提交并接收',
    valid:'有效投标', invalid:'无效投标', unknown:'缴纳情况待确认', unpaid:'未缴纳', paid:'已缴纳',
    review:'待核实', rule:'按规则处理', hold:'暂缓处理', waiting:'等待起算', due:'今日到期', overdue:'已逾期', returned:'已退清',
    winner:'中标供应商', nonwinner:'未中标供应商', exception:'异常投标供应商'
};
function tgLabel(value) { return TG_LABELS[value] || value || '待确认'; }
function tgLot(p,id) { const l=(p.lots||[]).find(x=>String(x.id)===String(id)); return l ? `${l.lot_number||''} ${l.lot_name||'采购包'}`.trim() : '整体项目'; }
async function loadTenderGuarantee(project=currentProject) {
    if (!project?.id) return null;
    const ledger=await api('GET',`/api/projects/${project.id}/tender-guarantee`);
    if (!ledger || !ledger.data) throw new Error('参与与保证金数据加载失败');
    project.tender_guarantee=ledger;
    return ledger;
}
function tenderEligibleRegistration(project,registration,lotId) {
    const ledger=project?.tender_guarantee;
    const sameLot=String(registration?.lot_id??'')===String(lotId??'');
    if (!ledger || ledger.policy?.strict_results===false) return !lotId || sameLot;
    const row=(ledger.data?.records||[]).find(r=>String(r.registration_id)===String(registration?.id));
    return Boolean(sameLot && ledger.data?.confirmed && !ledger.data?.stale && !ledger.summary?.stale && row?.participation==='submitted' && row.validity==='valid');
}
function tgStatus(text,kind) { return `<span class="tg-status tg-status-${['valid','invalid','pending','hold','review','returned','overdue'].includes(kind)?kind:'pending'}">${escHtml(text)}</span>`; }
function renderParticipationSection(p,s) {
    const ledger=p?.tender_guarantee;
    if (!ledger) return '<div class="settings-note warning">参与名单尚未加载，请重新打开阶段。</div>';
    const rows=(p.registrations||[]).map(r=>{const x=(ledger.data.records||[]).find(v=>String(v.registration_id)===String(r.id))||{};
        return `<div class="tg-roster-row"><div><strong>${escHtml(r.company_name)}</strong><div class="tg-muted">${escHtml(tgLot(p,r.lot_id))}</div></div><div>${tgStatus(tgLabel(x.participation),x.participation)} ${tgStatus(tgLabel(x.validity),x.validity)}<div class="tg-muted">${escHtml(tgLabel(x.deposit_status||'unknown'))}${x.deposit_status==='paid'?` · 实缴 ¥${escHtml(x.deposit_amount)} · 已退 ¥${escHtml(x.refunded_amount||'0')}`:''}</div>${x.reason?`<div class="tg-muted">${escHtml(x.reason)}</div>`:''}</div><button class="btn btn-sm btn-secondary" onclick="showTenderSupplierForm(${Number(r.id)})">核对登记</button></div>`;
    }).join('');
    return `<section class="tg-section"><div class="tg-heading"><h4>实际参与与有效投标</h4>${tgStatus(ledger.data.stale?'名单发生变化，请重新核对':ledger.data.confirmed?'名单已确认':'名单待确认',ledger.data.confirmed&&!ledger.data.stale?'valid':'pending')}</div><p class="tg-muted">逐一核对实际参与、文件接收和有效性；报名记录不会自动成为有效投标。</p>${ledger.policy?.strict_results===false?'<div class="settings-note">历史已完成结果保留原供应商选项，登记不会改写既有结果。</div>':''}${rows||'<div class="empty-state">暂无报名记录</div>'}${rows?'<button class="btn btn-primary btn-sm" onclick="confirmTenderRoster()">确认已核对参与名单</button>':''}</section>`;
}
function renderGuaranteeSection(p) {
    const l=p?.tender_guarantee;
    if (!l) return '<div class="settings-note warning">保证金数据尚未加载，请重新打开阶段。</div>';
    const cards=(l.items||[]).map(x=>`<article class="tg-deadline-card"><div class="tg-heading"><strong>${escHtml(x.supplier_name)}</strong>${tgStatus(x.status==='pending'?'待退还':tgLabel(x.status),x.status)}</div><div class="tg-muted">${escHtml(tgLot(p,x.lot_id))} · ${escHtml(tgLabel(x.scope))}</div><div class="tg-balance">待退余额 ¥${escHtml(x.balance)}</div><div>退还截止：${escHtml((x.deadline||'待确认').replace('T',' '))}</div>${x.deadline&&x.status!=='returned'?`<div class="tg-countdown" data-refund-deadline="${escHtml(x.deadline)}">${typeof refundCountdown==='function'?escHtml(refundCountdown(x.deadline)):''}</div>`:''}${x.overdue?'<div class="danger-text">已超过退还截止日</div>':''}${x.review_at?`<div>复核日期：${escHtml(x.review_at)}</div>`:''}<p class="tg-muted">${escHtml(x.basis||'实际起算依据待确认')}</p>${x.needs_recheck?`<div class="settings-note warning">起算依据已变化，保留原截止日待复核${x.proposed_deadline?`；拟调整为 ${escHtml(x.proposed_deadline.replace('T',' '))}`:''}。</div>`:''}<button class="btn btn-sm btn-secondary" onclick="showTenderSupplierForm(${Number(x.registration_id)})">登记退款与处理</button></article>`).join('');
    const rules=(l.data.rules||[]).map(r=>`<button class="btn btn-sm btn-secondary" data-tg-rule="${escHtml(r.id)}" onclick="showGuaranteeRuleForm(this.dataset.tgRule)">${escHtml(tgLot(p,r.lot_id))} · ${escHtml(tgLabel(r.scope))} · ${r.enabled?'已启用':'未启用'}</button>`).join('');
    return `<section class="tg-section"><div class="tg-heading"><h4>保证金退还期限</h4><button class="btn btn-sm btn-secondary" onclick="showGuaranteeRuleForm()">新增期限规则</button></div><p class="tg-muted">已缴款项独立跟踪；无效投标、暂缓处理和项目完成仍保留待退余额。</p><div class="tg-rule-list">${rules}${(l.items||[]).some(x=>x.needs_recheck)?'<button class="btn btn-sm btn-primary" onclick="showGuaranteeRecalculation()">复核期限调整</button>':''}</div>${l.summary?.mail_failed?`<div class="settings-note warning">${Number(l.summary.mail_failed)} 条邮件投递失败，请核对邮箱配置。<button class="btn btn-xs btn-secondary" onclick="retryGuaranteeMail()">重新排队</button></div>`:''}<div class="tg-deadline-grid">${cards||'<div class="empty-state">暂无已确认缴纳记录。请在参与名单中核对实际缴纳情况。</div>'}</div></section>`;
}
function tgInput(id,label,value='',type='text',attrs='') { return `<div class="form-group"><label for="${id}">${label}</label><input id="${id}" type="${type}" value="${escHtml(value)}" ${attrs}></div>`; }
function tgSelect(id,label,values,value) { return `<div class="form-group"><label for="${id}">${label}</label><select id="${id}">${values.map(x=>`<option value="${escHtml(x)}" ${x===value?'selected':''}>${escHtml(tgLabel(x))}</option>`).join('')}</select></div>`; }
function tgValue(id) { return document.getElementById(id).value.trim(); }
function tgAuditForm(l) { return tgInput('tgAuditReason',l.revision?'修改原因（必填）':'登记说明（可选）'); }
async function tgReady(p) { try { return await loadTenderGuarantee(p); } catch(e) {toast(e.message,'error'); return null;} }
async function tgSave(p,l,data,reason,flags={}) {
    if (l.revision && !reason) {toast('请填写修改原因，保留核对记录','warning');return false;}
    const stage=typeof editingStageKey!=='undefined'?editingStageKey:null;
    await api('PUT',`/api/projects/${p.id}/tender-guarantee`,{revision:l.revision,data,reason,...flags});
    closeModal();
    if (typeof currentProject!=='undefined' && String(currentProject?.id)===String(p.id)) {
        await refreshProject();
        if (stage && typeof openStageSlide==='function') await openStageSlide(stage);
    }
    return true;
}
async function showTenderSupplierForm(regId) {
    const p=currentProject,l=await tgReady(p); if(!l)return;
    const snapshot=(l.data.records||[]).find(x=>String(x.registration_id)===String(regId)); const r=(p.registrations||[]).find(x=>String(x.id)===String(regId))||(snapshot?{id:regId,company_name:snapshot.supplier_name_snapshot||'历史供应商',lot_id:snapshot.lot_id_snapshot}:null); if(!r){toast('报名记录已变化，请重新打开阶段','warning');return;}
    const row=(l.data.records||[]).find(x=>String(x.registration_id)===String(regId))||{};
    showModal('参与与保证金登记',`<div class="modal-form tg-form"><p><strong>${escHtml(r.company_name)}</strong> · ${escHtml(tgLot(p,r.lot_id))}</p><div class="form-row">${tgSelect('tgParticipation','实际参加与文件接收',['pending','absent','no_documents','rejected','submitted'],row.participation||'pending')}${tgSelect('tgValidity','投标有效性',['pending','valid','invalid'],row.validity||'pending')}</div>${tgInput('tgReason','未参加、文件未接收或无效原因',row.reason)}<div class="form-row">${tgSelect('tgDepositStatus','实际缴纳情况',['unknown','unpaid','paid'],row.deposit_status||'unknown')}${tgInput('tgDepositAmount','实际缴纳金额（元）',row.deposit_amount||'0','number','min="0" step="0.01"')}${tgInput('tgRefundedAmount','累计已退金额（元）',row.refunded_amount||'0','number','min="0" step="0.01"')}</div>${tgSelect('tgHandling','处理方式',['review','rule','hold'],row.handling||'review')}${tgInput('tgHandlingReason','处理说明（暂缓必填）',row.handling_reason)}${tgInput('tgReviewAt','复核日期（暂缓必填）',row.review_at,'date')}<div class="settings-note">手动期限须同时填写实际起算日和调整依据；暂缓不会隐藏原截止日。</div>${tgInput('tgManualStart','手动实际起算日',row.manual_start_at,'date')}${tgInput('tgManualDeadline','手动退还截止',row.manual_deadline,'datetime-local')}${tgInput('tgManualBasis','手动期限依据',row.manual_basis)}<details><summary>更正误录缴款</summary><p class="tg-muted">仅用于更正误录缴款，正常退还请填写已退金额。</p><label class="inline-check"><input type="checkbox" id="tgCashCorrection"> 我已核对财务凭据，确认更正误录缴款</label>${tgInput('tgCashBasis','误录更正依据',row.cash_correction_basis)}</details>${tgAuditForm(l)}</div>`,async()=>{
        const x={registration_id:Number(r.id),participation:tgValue('tgParticipation'),validity:tgValue('tgValidity'),reason:tgValue('tgReason'),deposit_status:tgValue('tgDepositStatus'),deposit_amount:tgValue('tgDepositAmount'),refunded_amount:tgValue('tgRefundedAmount'),handling:tgValue('tgHandling'),handling_reason:tgValue('tgHandlingReason'),review_at:tgValue('tgReviewAt'),manual_start_at:tgValue('tgManualStart'),manual_deadline:tgValue('tgManualDeadline'),manual_basis:tgValue('tgManualBasis')};
        if(x.validity==='valid'&&x.participation!=='submitted'){toast('只有已提交并接收文件才能确认有效投标','warning');return false;}
        if((x.validity==='invalid'||['absent','no_documents','rejected'].includes(x.participation))&&!x.reason){toast('请填写实际参与或无效原因','warning');return false;}
        if(!x.deposit_amount||!x.refunded_amount||!Number.isFinite(Number(x.deposit_amount))||!Number.isFinite(Number(x.refunded_amount))||Number(x.deposit_amount)<0||Number(x.refunded_amount)<0||Number(x.refunded_amount)>Number(x.deposit_amount)|| (x.deposit_status==='paid'?Number(x.deposit_amount)<=0:Number(x.deposit_amount)!==0)){toast('请核对实缴金额、已退金额与缴纳情况','warning');return false;}
        if(x.handling==='hold'&&(!x.handling_reason||!x.review_at)){toast('暂缓处理须填写原因及复核日期','warning');return false;}
        if(x.manual_deadline&&(!x.manual_start_at||!x.manual_basis||x.manual_deadline.slice(0,10)<x.manual_start_at)){toast('请核对手动起算日、截止日与调整依据','warning');return false;}
        const correction=document.getElementById('tgCashCorrection').checked;
        x.cash_correction_basis=tgValue('tgCashBasis');
        if(correction&&!x.cash_correction_basis){toast('请填写误录缴款更正依据','warning');return false;}
        const data=JSON.parse(JSON.stringify(l.data));delete data.stale;
        data.records=(data.records||[]).filter(v=>String(v.registration_id)!==String(r.id));data.records.push(x);
        // Any actual participation correction needs another explicit roster confirmation.
        if(['participation','validity','reason'].some(k=>(row[k]|| (k==='reason'?'':'pending'))!==x[k])) data.confirmed=false;
        return tgSave(p,l,data,tgValue('tgAuditReason'),{confirm_cash_correction:correction});
    });
}
async function confirmTenderRoster() {
    const p=currentProject,l=await tgReady(p);if(!l)return;
    showModal('确认实际参与名单',`<div class="modal-form"><div class="settings-note warning">请逐一核对当前采购包、实际参与、文件接收及有效性。确认不会自动将待确认记录变为有效投标。</div>${tgAuditForm(l)}</div>`,async()=>{
        const data=JSON.parse(JSON.stringify(l.data));delete data.stale;data.confirmed=true;
        return tgSave(p,l,data,tgValue('tgAuditReason'),{confirm_roster:true});
    });
}
async function showGuaranteeRuleForm(ruleId) {
    const p=currentProject,l=await tgReady(p);if(!l)return;
    const row=(l.data.rules||[]).find(x=>x.id===ruleId)||{id:`rule_${Date.now()}`,scope:'nonwinner',enabled:false,days:5,day_kind:'workday',cutoff:'17:00',remind_days:1};
    showModal('保证金退还规则',`<div class="modal-form tg-form"><div class="settings-note">规则默认关闭。请依据实际采购文件核对起算节点与期限，确认后再启用。</div><div class="form-group"><label for="tgRuleLot">适用采购包</label><select id="tgRuleLot"><option value="">整体项目</option>${(p.lots||[]).map(x=>`<option value="${Number(x.id)}" ${String(x.id)===String(row.lot_id)?'selected':''}>${escHtml(tgLot(p,x.id))}</option>`).join('')}</select></div>${tgSelect('tgRuleScope','适用对象',['winner','nonwinner','exception'],row.scope)}<div class="form-group"><label for="tgRuleStage">实际起算阶段</label><select id="tgRuleStage"><option value="">使用手动实际起算日</option>${(p.stages||[]).map(x=>`<option value="${escHtml(x.key)}" ${x.key===row.start_stage_key?'selected':''}>${escHtml(x.name||x.stage_name||x.key)}</option>`).join('')}</select></div><div class="settings-note warning">委托协议不等同于采购合同。选择阶段后按实际完成日期起算；改期或撤销需复核。</div>${tgInput('tgRuleManualStart','手动实际起算日（选择阶段时请留空）',row.manual_start_at,'date')}<div class="form-row">${tgInput('tgRuleDays','期限天数（1–365）',row.days,'number','min="1" max="365" step="1"')}<div class="form-group"><label for="tgRuleDayKind">计算方式</label><select id="tgRuleDayKind"><option value="calendar" ${row.day_kind==='calendar'?'selected':''}>自然日</option><option value="workday" ${row.day_kind==='workday'?'selected':''}>工作日（含调休补班）</option></select></div></div><div class="form-row">${tgInput('tgRuleCutoff','截止时分',row.cutoff,'time')}${tgInput('tgRuleRemind','提前提醒天数（0–365）',row.remind_days,'number','min="0" max="365" step="1"')}</div><label class="inline-check"><input type="checkbox" id="tgRuleEnabled" ${row.enabled?'checked':''}> 已核对实际依据，启用规则</label>${tgAuditForm(l)}</div>`,async()=>{
        const x={id:row.id,lot_id:tgValue('tgRuleLot')?Number(tgValue('tgRuleLot')):null,scope:tgValue('tgRuleScope'),enabled:document.getElementById('tgRuleEnabled').checked,start_stage_key:tgValue('tgRuleStage'),manual_start_at:tgValue('tgRuleManualStart'),days:Number(tgValue('tgRuleDays')),day_kind:tgValue('tgRuleDayKind'),cutoff:tgValue('tgRuleCutoff'),remind_days:Number(tgValue('tgRuleRemind'))};
        if(!Number.isInteger(x.days)||x.days<1||x.days>365||!Number.isInteger(x.remind_days)||x.remind_days<0||x.remind_days>365){toast('请填写有效的期限与提前提醒天数','warning');return false;}
        if(x.enabled&&Boolean(x.start_stage_key)===Boolean(x.manual_start_at)){toast('启用规则须选择一个实际起算阶段或日期','warning');return false;}
        const data=JSON.parse(JSON.stringify(l.data));delete data.stale;data.rules=(data.rules||[]).filter(v=>v.id!==x.id);data.rules.push(x);
        return tgSave(p,l,data,tgValue('tgAuditReason'));
    });
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
        showModal('新项目保证金退还规则',`<div class="modal-form"><div class="settings-note">仅影响之后创建的新项目；现有项目和已完成阶段保持原规则。供应商实际缴款仍须逐一确认。</div><div class="form-group"><label>采购方式</label><select onchange="showGuaranteeDefaults(this.value)">${methods.map(m=>`<option ${m===method?'selected':''}>${escHtml(m)}</option>`).join('')}</select></div>${rows.map((r,i)=>`<section class="tg-section"><h4>${escHtml(tgLabel(r.scope))}</h4><label class="inline-check"><input id="gdEnabled${i}" type="checkbox" ${r.enabled?'checked':''} ${editable?'':'disabled'}> 已核对依据，供新项目启用</label><div class="form-group"><label>实际起算阶段</label><select id="gdStage${i}"><option value="">请选择阶段</option>${config.templates[method].map(s=>`<option value="${escHtml(s.id)}" ${s.id===r.start_stage_key?'selected':''}>${escHtml(s.name)}</option>`).join('')}</select></div><div class="form-row">${tgInput('gdDays'+i,'期限天数',r.days,'number','min="1" max="365" step="1"')}<div class="form-group"><label>计算方式</label><select id="gdKind${i}"><option value="calendar" ${r.day_kind==='calendar'?'selected':''}>自然日</option><option value="workday" ${r.day_kind==='workday'?'selected':''}>国家安排的工作日</option></select></div></div><div class="form-row">${tgInput('gdCutoff'+i,'截止时分（可留空）',r.cutoff,'time')}${tgInput('gdRemind'+i,'提前提醒天数',r.remind_days,'number','min="0" max="365" step="1"')}</div></section>`).join('')}<p class="tg-muted">委托协议不是采购合同；请按实际业务依据选择阶段。日历未覆盖的年度不能估算工作日期限。</p></div>`,editable?async()=>{
            const rules=rows.map((r,i)=>({...r,enabled:document.getElementById('gdEnabled'+i).checked,start_stage_key:tgValue('gdStage'+i),days:Number(tgValue('gdDays'+i)),day_kind:tgValue('gdKind'+i),cutoff:tgValue('gdCutoff'+i),remind_days:Number(tgValue('gdRemind'+i))}));
            const result=await api('PUT','/api/tender-guarantee/defaults',{method,rules});closeModal();toast(result.message,'success');
        }:null);
    }catch(error){toast(error.message,'error');}
}

async function retryGuaranteeMail(){const p=currentProject;showModal("重试保证金邮件",`<p>仅重试当前仍有效的提醒。网络中断时邮件可能已被服务器接收，请核实后再重试。</p>`,async()=>{const result=await api("POST",`/api/projects/${p.id}/tender-guarantee/retry-mail`,{});closeModal();toast(result.message,"success");await refreshProject();});}
