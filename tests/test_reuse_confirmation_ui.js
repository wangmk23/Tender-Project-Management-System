'use strict';
// Synthetic DOM + API boundary: verifies user-visible state and submitted audit facts.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function setup(t){
    const dom=new JSDOM('<main></main><div id="stageQuantityCard"></div>');t.after(()=>dom.window.close());
    const calls=[],notices=[];
    const row={registration_id:7,participation:'submitted',validity:'valid',deposit_status:'paid',deposit_amount:'120',refunded_amount:'0',handling:'rule',handling_reason:'',review_at:'',manual_start_at:'',manual_deadline:'',manual_basis:''};
    const project={id:9,lots:[],registrations:[{id:7,company_name:'合成供应商',lot_id:null}],stages:[{key:'opening',name:'开标'},{key:'evaluation',name:'评标'},{key:'publication',name:'结果公示'}],tender_guarantee:{revision:3,data:{confirmed:true,records:[row],rules:[]},summary:{},policy:{strict_results:true}}};
    const c=vm.createContext({document:dom.window.document,currentProject:project,escHtml:x=>String(x??'').replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])),toast:(...args)=>notices.push(args),showModal:(title,html,save)=>{c.title=title;dom.window.document.querySelector('main').innerHTML=html;c.save=save;},api:async(method,url,body)=>{calls.push({method,url,body});return {items:c.quantityItems||[]};},closeModal:()=>{},refreshProject:async()=>{},onlineBiddingStageKind:()=>'',editingStageKey:null});
    c.window=c;for(const f of ['04-project-workflow.js','18-tender-guarantee.js','23-project-flow-editor.js'])vm.runInContext(fs.readFileSync(__dirname+'/../source/frontend/'+f,'utf8'),c);c.refreshProject=async()=>{};
    return {c,d:dom.window.document,calls,notices,row,project};
}
const decision={source_stage_key:'opening',phase:'submitted',reason:'采购人书面同意两家继续 <核验>',actor:'核对员 <甲>',created_at:'2026-11-04T01:02:03+00:00'};
function quantity(c,extra={}){c.quantityItems=[{applicable:true,status:'shortage',phase:'valid',lot_id:null,actual_count:2,required_count:3,fingerprint:'current-valid-token',...extra}];}
test('same-phase confirmed decision shows source, reason, actor and time without another confirmation',async t=>{
    const {c,d,calls,project}=setup(t);quantity(c,{status:'confirmed',decision_reused:true,decision:{...decision,source_stage_key:'evaluation',phase:'valid'}});
    await c.loadStageQuantityCard(project,project.stages[2]);const host=d.querySelector('#stageQuantityCard');
    assert.match(host.textContent,/沿用/);assert.match(host.textContent,/评标/);assert.match(host.textContent,/有效投标数量/);assert.match(host.textContent,/采购人书面同意两家继续 <核验>/);assert.match(host.textContent,/核对员 <甲>/);assert.match(host.textContent,/2026-11-04/);
    assert.equal(host.querySelector('input'),null);assert.equal(host.querySelector('[data-quantity-index]'),null);assert.equal(calls.filter(x=>x.method==='POST').length,0);assert.equal(host.querySelectorAll('核验,甲').length,0);
});
test('cross-phase suggestion prefills editable reason but requires an explicit current-phase POST',async t=>{
    const {c,d,calls,project}=setup(t);quantity(c,{suggested_decision:decision});await c.loadStageQuantityCard(project,project.stages[1]);
    const reason=d.querySelector('#quantityReason0');assert.equal(reason.value,decision.reason);assert.match(d.querySelector('#stageQuantityCard').textContent,/开标/);assert.match(d.querySelector('#stageQuantityCard').textContent,/已提交并接收/);assert.match(d.querySelector('#stageQuantityCard').textContent,/仍须|仍需/);assert.equal(calls.filter(x=>x.method==='POST').length,0);
    reason.value='已重新核对当前有效性，继续推进';await d.querySelector('[data-quantity-index]').onclick();const post=calls.find(x=>x.method==='POST');
    assert.equal(post.body.stage_key,'evaluation');assert.equal(post.body.fingerprint,'current-valid-token');assert.equal(post.body.reason,reason.value);assert.equal(post.body.exception_id,null);
});
test('pending roster never exposes a suggestion as an actionable quantity confirmation',async t=>{
    const {c,d,calls,project}=setup(t);quantity(c,{status:'pending',suggested_decision:decision});await c.loadStageQuantityCard(project,project.stages[1]);assert.equal(d.querySelector('#quantityReason0'),null);assert.equal(d.querySelector('[data-quantity-index]'),null);assert.equal(calls.filter(x=>x.method==='POST').length,0);
});
test('ordinary shortage stays blank, and missing source stage falls back to its saved key',async t=>{
    const {c,d,project}=setup(t);quantity(c);await c.loadStageQuantityCard(project,project.stages[0]);assert.equal(d.querySelector('#quantityReason0').value,'');quantity(c,{status:'confirmed',decision:{...decision,source_stage_key:'removed-stage'}});await c.loadStageQuantityCard(project,project.stages[0]);assert.match(d.querySelector('#stageQuantityCard').textContent,/removed-stage/);
});
test('opening another stage without a suggestion clears the previous DOM reason and disables its old action',async t=>{
    const {c,d,calls,project}=setup(t);quantity(c,{suggested_decision:decision});await c.loadStageQuantityCard(project,project.stages[0]);const oldButton=d.querySelector('[data-quantity-index]');d.querySelector('#quantityReason0').value='上一阶段草稿';quantity(c);await c.loadStageQuantityCard(project,project.stages[1]);assert.equal(d.querySelector('#quantityReason0').value,'');await oldButton.onclick();assert.equal(calls.filter(x=>x.method==='POST').length,0);
});
test('a late suggestion from another project cannot populate the active quantity form',async t=>{
    const {c,d,project}=setup(t);let finish;c.api=()=>new Promise(resolve=>finish=resolve);const pending=c.loadStageQuantityCard(project,project.stages[0]);c.currentProject={...project,id:10};finish({items:[{applicable:true,status:'shortage',phase:'submitted',suggested_decision:decision}]});await pending;assert.equal(d.querySelector('#quantityReason0'),null);assert.doesNotMatch(d.querySelector('#stageQuantityCard').textContent,/采购人书面同意/);
});
test('stale-token rejection retains editable current reason and does not claim confirmation',async t=>{
    const {c,d,calls,project,notices}=setup(t);quantity(c,{suggested_decision:decision});await c.loadStageQuantityCard(project,project.stages[1]);c.api=async(method,url,body)=>{calls.push({method,url,body});throw Object.assign(new Error('事实已变化，请重新核对'),{status:409});};const button=d.querySelector('[data-quantity-index]');await button.onclick();assert.equal(button.disabled,false);assert.equal(d.querySelector('#quantityReason0').value,decision.reason);assert.match(notices.at(-1)[0],/事实已变化/);assert.doesNotMatch(d.querySelector('#stageQuantityCard').textContent,/已沿用数量确认/);
});
test('confirmed roster is collapsed with a secondary recheck action in ordinary stages',t=>{
    const {c,d,project}=setup(t);d.querySelector('main').innerHTML=c.renderParticipationSection(project,{key:'evaluation'});const disclosure=d.querySelector('details.online-participation');assert.ok(disclosure);assert.equal(disclosure.open,false);const recheck=d.querySelector('[onclick="confirmTenderRoster()"]');assert.equal(recheck.textContent,'重新核对');assert.ok(recheck.classList.contains('btn-secondary'));assert.doesNotMatch(recheck.className,/btn-primary/);
});
test('unconfirmed and stale rosters retain the visible primary confirmation flow',t=>{
    const {c,d,project}=setup(t);for(const data of [{confirmed:false},{confirmed:true,stale:true}]){Object.assign(project.tender_guarantee.data,data);d.querySelector('main').innerHTML=c.renderParticipationSection(project,{});assert.equal(d.querySelector('details.online-participation'),null);assert.equal(d.querySelector('[onclick="confirmTenderRoster()"]').textContent,'确认已核对参与名单');assert.ok(d.querySelector('[onclick="confirmTenderRoster()"]').classList.contains('btn-primary'));}
});
test('manual deadline basis supplies audit prose and supplementary text remains optional',async t=>{
    const {c,d,calls}=setup(t);await c.showGuaranteeSpecialForm(7);d.querySelector('#tgManualStart').value='2026-11-01';d.querySelector('#tgManualDeadline').value='2026-11-08T17:00';d.querySelector('#tgManualBasis').value='采购人书面通知改期';await c.save();const put=calls.find(x=>x.method==='PUT');assert.ok(put);assert.match(put.body.reason,/调整退还期限.*采购人书面通知改期/);assert.equal(put.body.confirm_cash_correction,false);assert.equal(put.body.data.records[0].manual_basis,'采购人书面通知改期');
});
test('hold basis supplies its own audit prose and preserves original cash',async t=>{
    const {c,d,calls}=setup(t);await c.showGuaranteeSpecialForm(7);d.querySelector('#tgHandling').value='hold';d.querySelector('#tgHandlingReason').value='待核对财务凭据';d.querySelector('#tgReviewAt').value='2026-11-10';await c.save();const put=calls.find(x=>x.method==='PUT');assert.ok(put);assert.match(put.body.reason,/暂缓处理.*待核对财务凭据/);assert.equal(put.body.data.records[0].deposit_amount,'120');
});
test('checked cash correction uses newly supplied basis and optional supplement in one audit entry',async t=>{
    const {c,d,calls,row}=setup(t);row.cash_correction_basis='上一次凭据';await c.showGuaranteeSpecialForm(7);assert.equal(d.querySelector('#tgCashBasis').value,'');d.querySelector('#tgCashCorrection').checked=true;d.querySelector('#tgDepositAmount').value='110';d.querySelector('#tgCashBasis').value='到账回单核实原金额误录';d.querySelector('#tgAuditReason').value='已与财务核实';await c.save();const put=calls.find(x=>x.method==='PUT');assert.ok(put);assert.equal(put.body.confirm_cash_correction,true);assert.match(put.body.reason,/更正误录缴款.*到账回单核实原金额误录/);assert.match(put.body.reason,/已与财务核实/);assert.equal(put.body.data.records[0].deposit_amount,'110');
});
test('combined operations record each relevant basis instead of discarding one',async t=>{
    const {c,d,calls}=setup(t);await c.showGuaranteeSpecialForm(7);d.querySelector('#tgHandling').value='hold';d.querySelector('#tgHandlingReason').value='等待财务复核';d.querySelector('#tgReviewAt').value='2026-11-10';d.querySelector('#tgManualStart').value='2026-11-01';d.querySelector('#tgManualDeadline').value='2026-11-08T17:00';d.querySelector('#tgManualBasis').value='书面通知改期';await c.save();const reason=calls.find(x=>x.method==='PUT')?.body.reason||'';assert.match(reason,/等待财务复核/);assert.match(reason,/书面通知改期/);
});
test('unchanged old hold basis does not justify clearing a manual deadline',async t=>{
    const {c,d,calls,row}=setup(t);Object.assign(row,{handling:'hold',handling_reason:'此前待核实',review_at:'2026-11-10',manual_start_at:'2026-11-01',manual_deadline:'2026-11-08T17:00',manual_basis:'原手动依据'});await c.showGuaranteeSpecialForm(7);d.querySelector('#tgManualStart').value='';d.querySelector('#tgManualDeadline').value='';await c.save();assert.equal(calls.filter(x=>x.method==='PUT').length,0);d.querySelector('#tgAuditReason').value='原单独期限已撤回';await c.save();assert.equal(calls.find(x=>x.method==='PUT').body.reason,'原单独期限已撤回');
});
test('manual deadline still requires its own basis even when audit supplement is supplied',async t=>{
    const {c,d,calls}=setup(t);await c.showGuaranteeSpecialForm(7);d.querySelector('#tgManualStart').value='2026-11-01';d.querySelector('#tgManualDeadline').value='2026-11-08T17:00';d.querySelector('#tgAuditReason').value='不能代替改期依据';await c.save();assert.equal(calls.filter(x=>x.method==='PUT').length,0);assert.equal(d.activeElement.id,'tgManualBasis');assert.equal(d.querySelector('#tgManualBasis').closest('details').open,true);
});
test('hold still requires reason and review date, independent of supplementary audit text',async t=>{
    const {c,d,calls}=setup(t);await c.showGuaranteeSpecialForm(7);d.querySelector('#tgHandling').value='hold';d.querySelector('#tgAuditReason').value='不能代替暂缓依据';await c.save();assert.equal(calls.filter(x=>x.method==='PUT').length,0);d.querySelector('#tgHandlingReason').value='核对回单';await c.save();assert.equal(calls.filter(x=>x.method==='PUT').length,0);
});
test('missing enhanced review date reveals its section and focuses the visible date control',async t=>{
    const {c,d,calls}=setup(t);await c.showGuaranteeSpecialForm(7);d.querySelector('#tgHandling').value='hold';d.querySelector('#tgHandlingReason').value='待核对回单';const field=d.querySelector('#tgReviewAt'),pair=d.createElement('div');pair.className='pm-temporal-field';field.before(pair);pair.append(field);field.hidden=true;pair.insertAdjacentHTML('beforeend','<button type="button" class="pm-datetime-trigger">选择复核日期</button>');await c.save();assert.equal(calls.filter(x=>x.method==='PUT').length,0);assert.equal(d.activeElement,pair.querySelector('button'));assert.equal(field.closest('details').open,true);
});
test('cash edits require both explicit checkbox and cash basis',async t=>{
    const {c,d,calls}=setup(t);await c.showGuaranteeSpecialForm(7);d.querySelector('#tgDepositAmount').value='110';d.querySelector('#tgAuditReason').value='不能代替误录确认';await c.save();assert.equal(calls.filter(x=>x.method==='PUT').length,0);d.querySelector('#tgCashCorrection').checked=true;await c.save();assert.equal(calls.filter(x=>x.method==='PUT').length,0);assert.equal(d.activeElement.id,'tgCashBasis');
});
test('no-lot opening has a project flow action without an empty package list',t=>{
    const {c,d,project}=setup(t);d.querySelector('main').innerHTML=c.renderLotResponseSection(project);assert.doesNotMatch(d.querySelector('main').textContent,/暂无采购包/);assert.equal(d.querySelector('.biz-body'),null);assert.ok(d.querySelector('[onclick="setCloseType(\'liubiao\')"]'));assert.match(d.querySelector('button').textContent,/项目流标/);
});
test('lot opening preserves separate manual package actions and saved counts',t=>{
    const {c,d,project}=setup(t);project.lots=[{id:2}];project.lot_supplier_state={items:[{lot_id:2,lot_name:'设备包',registration_count:2,required_count:3,status:'warning'}]};d.querySelector('main').innerHTML=c.renderLotResponseSection(project);assert.match(d.querySelector('main').textContent,/设备包.*2\/3家/);assert.ok(d.querySelector('[onclick="showManualLotFlowForm(2)"]'));
});
