'use strict';
const test=require('node:test'), assert=require('node:assert/strict'), fs=require('node:fs'), path=require('node:path'), vm=require('node:vm');
const {JSDOM}=require(process.env.PM_JSDOM_MODULE || 'jsdom');
const root=path.resolve(__dirname,'..');
const source=name=>fs.readFileSync(path.join(root,'source/frontend',name),'utf8');
function setup(t){
    const dom=new JSDOM('<div id="slideBody"><div class="stage-editor"><input id="stageCompleted" type="checkbox"><input id="stageSkipped" type="checkbox"><input id="stageCompletedDate" value="2026-10-02"><input id="stageCompletedTime" value="12:01"><input id="stagePlannedAt"><input id="stagePlannedTime"><textarea id="stageNotes">阶段草稿</textarea><div id="ledger"></div></div></div><div id="modalBody"></div>',{url:'http://localhost',runScripts:'outside-only'});
    const w=dom.window, ctx=dom.getInternalVMContext(), calls=[], confirmations=[];
    t.after(()=>w.close());
    for(const name of ['01-core.js','02-projects.js','04-project-workflow.js','07-business.js','09-command-center.js','14-online-bidding.js','18-tender-guarantee.js','22-procurement-methods.js'])vm.runInContext(source(name),ctx);
    vm.runInContext(`currentProject={id:1,online_bidding_enabled:true,method:'网上竞价',stages:onlineBiddingTemplate().map(s=>({...s,key:s.id,record_version:'stage-v3'})),lots:[],registrations:[{id:7,company_name:'甲供应商',lot_id:null},{id:8,company_name:'乙供应商',lot_id:null}],tender_guarantee:{data:{confirmed:true,records:[]},policy:{strict_results:true}}};editingStageKey='online_quotation';document.querySelector('.stage-editor').recordVersion='stage-v3';document.getElementById('ledger').innerHTML=renderOnlineBiddingInline(currentProject.stages[5],currentProject);toast=()=>{};`,ctx);
    const data={roster_locked:true,registration_end:'2026-10-01T16:00',start_at:'2026-10-02T09:00:00',end_at:'2026-10-02T12:00:00',ended_at:'2026-10-02T12:00:00',end_reason:'deadline',evidence:'平台结果截图-001',records:[{registration_id:8,company_name:'乙供应商',lot_id:null,review:'approved',amount:'108.20',quoted_at:'2026-10-02T09:15:02'},{registration_id:7,company_name:'甲供应商',lot_id:null,review:'approved',amount:'98.10',quoted_at:'2026-10-02T09:12:03'}],resolutions:[]};
    w.api=async(method,url,body)=>{calls.push({method,url,body});return method==='POST'?{ok:true,revision:4,stage_key:'online_quotation'}:{revision:3,data:structuredClone(data),summary:{status:'待核对',eligible:2,quoted:2,lots:[]},history:[]};};
    w.confirmDialog=async(...args)=>{confirmations.push(args);return true;};
    const openStage=w.openStageSlide;
    w.refreshProject=async()=>{w.refreshes=(w.refreshes||0)+1;};w.openStageSlide=()=>{};
    const run=code=>vm.runInContext(code,ctx);
    return {w,d:w.document,calls,confirmations,data,run,openStage,load:()=>run('loadOnlineBiddingInline(currentProject.stages[5],currentProject)')};
}
test('one editable quote table follows registration order, preserves second precision and avoids duplicate quote summaries',async t=>{
    const f=setup(t);await f.load();
    assert.equal(f.d.querySelectorAll('.online-quote-table').length,1);
    assert.deepEqual([...f.d.querySelectorAll('[data-online-quote]')].map(el=>el.dataset.onlineQuote),['7','8']);
    assert.match(f.d.querySelector('#ob_quote_7').value,/^2026-10-02T09:12:03(?:\.000)?$/);
    assert.equal(f.d.querySelector('#ob_start_at').step,'1');
    assert.equal(f.d.querySelectorAll('[data-ob-amount]').length,2);
});
test('confirm sends one transaction with original revisions and a review of winner, amount and platform evidence',async t=>{
    const f=setup(t);await f.load();
    assert.equal(await f.run(`confirmOnlineBiddingInline({notes:'阶段草稿',completed_at:'2026-10-02T12:01',completed_date:'2026-10-02',record_version:'stage-v3'})`),true);
    const writes=f.calls.filter(c=>c.method!=='GET');assert.equal(writes.length,1);
    assert.equal(writes[0].url,'/api/projects/1/online-bidding/confirm');
    assert.equal(writes[0].body.revision,3);assert.equal(writes[0].body.stage_record_version,'stage-v3');
    assert.equal(writes[0].body.stage_key,'online_quotation');assert.equal(writes[0].body.data.verified,true);
    assert.equal(writes[0].body.data.records[0].company_name,'甲供应商');assert.equal(writes[0].body.data.records[0].lot_id,null);
    assert.deepEqual([...writes[0].body.data.lot_ids],[]);
    assert.equal(writes[0].body.stage_data.notes,'阶段草稿');
    assert.match(f.confirmations[0][1],/甲供应商.*98\.10/s);assert.match(f.confirmations[0][1],/平台结果截图-001/);
});
test('editing a form while its confirmation is open invalidates the reviewed snapshot without a write',async t=>{
    const f=setup(t);await f.load();
    f.w.confirmDialog=async()=>{f.d.querySelector('#ob_amount_7').value='97.00';return true;};
    await assert.rejects(f.run("confirmOnlineBiddingInline({record_version:'stage-v3'})"),/草稿.*变化/);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);assert.equal(f.d.querySelector('#ob_amount_7').value,'97.00');
});
test('confirmation cancellation and project switch during review cannot submit or refresh a different project',async t=>{
    const f=setup(t);await f.load();f.w.confirmDialog=async()=>false;
    assert.equal(await f.run(`confirmOnlineBiddingInline({record_version:'stage-v3'})`),false);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
    f.w.confirmDialog=async()=>{f.run('currentProject={id:2,stages:[]}');return true;};
    assert.equal(await f.run(`confirmOnlineBiddingInline({record_version:'stage-v3'})`),false);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);assert.equal(f.w.refreshes,undefined);
});
test('failed transaction preserves quote inputs and revisions and does not replay a write',async t=>{
    const f=setup(t);await f.load();f.d.querySelector('#ob_amount_7').value='97.30';
    f.w.api=async(method,url,body)=>{f.calls.push({method,url,body});throw new Error('阶段已更新，请重新核对');};
    await assert.rejects(f.run(`confirmOnlineBiddingInline({record_version:'stage-v3'})`),/已更新/);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,1);assert.equal(f.d.querySelector('#ob_amount_7').value,'97.30');
    assert.equal(f.d.querySelector('#ob_amount_7').disabled,false);assert.match(f.d.querySelector('[data-ob-save-error]').textContent,/已更新/);
    assert.equal(f.run("onlineBiddingDrafts.get('1:online_quotation').saved.revision"),3);
});
test('ties and a missing quote outcome stay pending without choosing a winner',async t=>{
    const f=setup(t);await f.load();f.d.querySelector('#ob_amount_8').value='98.10';
    await assert.rejects(f.run(`confirmOnlineBiddingInline({record_version:'stage-v3'})`),/并列/);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
    f.d.querySelector('#ob_amount_7').value='';f.d.querySelector('#ob_quote_7').value='';f.d.querySelector('#ob_amount_8').value='';f.d.querySelector('#ob_quote_8').value='';
    await assert.rejects(f.run(`confirmOnlineBiddingInline({record_version:'stage-v3'})`),/无.*报价/);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
});
test('ordinary draft save never revokes already verified quotation facts',async t=>{
    const f=setup(t);f.data.verified=true;await f.load();
    f.d.querySelector('#ob_evidence').value='补充平台依据';
    f.d.querySelector('#ob_correction_reason').value='补充平台依据说明';
    await f.run('saveOnlineBiddingInline({completed:false},{draft:true})');
    assert.equal(f.calls.find(c=>c.method==='PUT').body.data.verified,true);
});
test('a protected correction retains verified facts and entered evidence until a reason is accepted',async t=>{
    const f=setup(t);f.data.verified=true;await f.load();
    f.d.querySelector('#ob_evidence').value='补充平台凭证';
    f.w.api=async(method,url,body)=>{f.calls.push({method,url,body});if(!body.reason.includes('平台复核'))throw new Error('更正已核对资料必须填写原因');return {revision:4,data:body.data,summary:{},history:[]};};
    await assert.rejects(f.run('saveOnlineBiddingInline({completed:false},{draft:true})'),/更正原因/);
    assert.equal(f.d.querySelector('#ob_evidence').value,'补充平台凭证');
    assert.equal(f.calls.filter(c=>c.method==='PUT').length,0);
    assert.equal(f.run("document.getElementById('onlineBiddingInline').onlineState.saved.data.verified"),true);
    f.d.querySelector('#ob_correction_reason').value='平台复核补充凭证';
    await f.run('saveOnlineBiddingInline({completed:false},{draft:true})');
    assert.equal(f.calls.at(-1).body.reason,'平台复核补充凭证');assert.equal(f.calls.at(-1).body.data.verified,true);
    assert.equal(f.d.querySelector('[data-ob-save-error]'),null);
});
test('completing quotation through the existing stage save uses the transaction instead of a ledger and stage write pair',async t=>{
    const f=setup(t);await f.load();f.d.querySelector('#stageCompleted').checked=true;
    assert.equal(await f.run('saveStageFromSlide()'),true);
    assert.deepEqual(f.calls.filter(c=>c.method!=='GET').map(c=>c.url),['/api/projects/1/online-bidding/confirm']);
});
test('confirmed participation folds for online quotation while pending and other procurement remain expanded',t=>{
    const f=setup(t);
    let html=f.run('renderParticipationSection(currentProject,currentProject.stages[5])');f.d.querySelector('#ledger').innerHTML=html;
    assert.equal(f.d.querySelector('details.online-participation')?.open,false);
    html=f.run('currentProject.tender_guarantee.data.stale=true;renderParticipationSection(currentProject,currentProject.stages[5])');f.d.querySelector('#ledger').innerHTML=html;
    assert.equal(f.d.querySelector('details.online-participation'),null);
    html=f.run('currentProject.online_bidding_enabled=false;renderParticipationSection(currentProject,currentProject.stages[5])');f.d.querySelector('#ledger').innerHTML=html;
    assert.equal(f.d.querySelector('details.online-participation'),null);
});
test('seven online navigation groups preserve all nine stage entries and ordinary rails retain their original nodes',t=>{
    const f=setup(t);f.d.querySelector('#ledger').innerHTML=f.run('renderStageRail({project:currentProject,stages:currentProject.stages,currentStage:currentProject.stages[1]})');
    assert.equal(f.d.querySelectorAll('.online-stage-group').length,7);assert.equal(f.d.querySelectorAll('[data-stage-key]').length,9);
    assert.equal(f.d.querySelector('.online-stage-preparation').open,true);
    f.d.querySelector('#ledger').innerHTML=f.run('currentProject.online_bidding_enabled=false;renderStageRail({project:currentProject,stages:currentProject.stages,currentStage:currentProject.stages[1]})');
    assert.equal(f.d.querySelectorAll('.online-stage-group').length,0);assert.equal(f.d.querySelectorAll('.project-stage-node').length,9);
});
test('simple online result forms hide empty package discount and shortlist fields but retain existing values',t=>{
    const f=setup(t);f.w.showModal=(_title,html)=>{f.d.querySelector('#modalBody').innerHTML=html;};
    f.run(`currentProject.bid_results=[{id:1,winning_supplier:'甲供应商',winning_amount:98.1,discount_rate:'',is_shortlisted:false}];showBidResultForm(1);`);
    assert.equal(f.d.querySelector('#bidLotId').closest('.form-group').hidden,true);
    assert.equal(f.d.querySelector('#bidDiscount').closest('.form-group').hidden,true);
    assert.equal(f.d.querySelector('#bidShortlisted').closest('.form-group').hidden,true);
    f.run(`currentProject.bid_results[0].discount_rate='95%';currentProject.bid_results[0].is_shortlisted=true;showBidResultForm(1);`);
    assert.equal(f.d.querySelector('#bidDiscount').value,'95%');assert.equal(f.d.querySelector('#bidDiscount').closest('.form-group').hidden,false);
    assert.equal(f.d.querySelector('#bidShortlisted').checked,true);assert.equal(f.d.querySelector('#bidShortlisted').closest('.form-group').hidden,false);
});
test('online publication omits an empty package block while ordinary publication retains package management',t=>{
    const f=setup(t);
    f.w.openSlide=(_title,html)=>{f.d.querySelector('#slideBody').innerHTML=html;};f.w.loadOnlineBiddingInline=()=>{};
    f.openStage('result_announced');
    assert.doesNotMatch(f.d.querySelector('#slideBody').textContent,/暂无包|项目包\/标段/);
    f.run('currentProject.online_bidding_enabled=false');f.openStage('result_announced');
    assert.match(f.d.querySelector('#slideBody').textContent,/项目包\/标段/);
});

async function openCompletedQuotation(f){
    f.data.verified=true;
    f.run(`currentProject.stages[5].completed=true;currentProject.stages[5].completed_at='2026-10-02T12:01';currentProject.bid_results=[{id:31,winning_supplier:'甲供应商',winning_amount:98.1,lot_id:null}];`);
    f.w.PMIcons={label:(el,text)=>{el.textContent=text;}};
    f.w.openSlide=(_title,html)=>{f.d.querySelector('#slideBody').innerHTML=html;};
    f.openStage('online_quotation');await f.load();
}

test('completed quotation exposes its original completion control under a discoverable correction heading',async t=>{
    const f=setup(t);await openCompletedQuotation(f);
    assert.match(f.d.querySelector('.online-stage-general>summary').textContent,/阶段记录与更正.*撤销核对/);
    assert.equal(f.d.querySelector('#stageCompleted').closest('.form-group').hidden,false);
    assert.match(f.d.querySelector('.online-stage-general').textContent,/原成交记录.*保留/);
});

test('revoke confirmation can cancel without writes or revoke only the saved snapshot while quote drafts and results remain',async t=>{
    const f=setup(t);await openCompletedQuotation(f);
    f.d.querySelector('#ob_amount_7').value='97.30';f.d.querySelector('#ob_correction_reason').value='平台复核报价';
    f.w.confirmDialog=async()=>false;f.d.querySelector('#stageCompleted').checked=false;
    await f.run('syncStageCompleted()');
    assert.equal(f.d.querySelector('#stageCompleted').checked,true);assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
    f.w.confirmDialog=async()=>true;
    f.w.api=async(method,url,body)=>{f.calls.push({method,url,body});return method==='POST'?{ok:true,revision:4,stage_key:'online_quotation'}:{revision:5,data:body.data,summary:{},history:[]};};
    f.d.querySelector('#stageCompleted').checked=false;await f.run('syncStageCompleted()');
    const reopen=f.calls.find(c=>c.method==='POST');
    assert.equal(reopen.url,'/api/projects/1/online-bidding/reopen');assert.equal(reopen.body.revision,3);assert.equal(reopen.body.stage_record_version,'stage-v3');
    assert.equal(reopen.body.reason,'平台复核报价');assert.equal(Object.hasOwn(reopen.body,'data'),false);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,1);
    assert.equal(f.run("document.getElementById('onlineBiddingInline').onlineState.saved.data.records.find(r=>r.registration_id===7).amount"),'98.10');
    assert.equal(f.d.querySelector('#ob_amount_7').value,'97.30');assert.equal(f.run('currentProject.bid_results[0].id'),31);
    assert.equal(f.run('currentProject.stages[5].completed'),false);
    assert.equal(f.calls.some(c=>/bid-results/.test(c.url)),false);
    f.d.querySelector('#ob_correction_reason').value='';
    await assert.rejects(f.run('saveOnlineBiddingInline({completed:false},{draft:true})'),/更正原因/);
    f.d.querySelector('#ob_correction_reason').value='平台复核后的报价草稿';await f.run('saveOnlineBiddingInline({completed:false},{draft:true})');
    assert.equal(f.calls.at(-1).body.reason,'平台复核后的报价草稿');assert.equal(f.calls.at(-1).body.data.records.find(r=>r.registration_id===7).amount,'97.30');
});

test('published downstream facts refuse withdrawal and keep completed state, verified snapshot and quote draft',async t=>{
    const f=setup(t);await openCompletedQuotation(f);
    f.d.querySelector('#ob_amount_7').value='97.30';f.d.querySelector('#ob_correction_reason').value='平台复核';
    f.run(`document.getElementById('onlineBiddingInline').onlineState.saved.data.publication_done=true;currentProject.stages[6].completed=true;`);
    f.d.querySelector('#stageCompleted').checked=false;await f.run('syncStageCompleted()');
    assert.equal(f.d.querySelector('#stageCompleted').checked,true);
    assert.equal(f.run('currentProject.stages[5].completed'),true);
    assert.equal(f.run("document.getElementById('onlineBiddingInline').onlineState.saved.data.verified"),true);
    assert.equal(f.d.querySelector('#ob_amount_7').value,'97.30');assert.equal(f.run('currentProject.bid_results[0].id'),31);
    assert.match(f.d.querySelector('#stageSaveError').textContent,/先.*公示/);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
});

test('a newer downstream server refusal is displayed without changing completion or losing quotation inputs',async t=>{
    const f=setup(t);await openCompletedQuotation(f);
    f.d.querySelector('#ob_amount_7').value='97.30';f.d.querySelector('#ob_correction_reason').value='平台复核';
    f.w.api=async(method,url,body)=>{f.calls.push({method,url,body});throw new Error('“成交结果公示”阶段已完成，请先将该阶段改为待办后更正');};
    f.d.querySelector('#stageCompleted').checked=false;await f.run('syncStageCompleted()');
    assert.equal(f.d.querySelector('#stageCompleted').checked,true);assert.equal(f.d.querySelector('#ob_amount_7').value,'97.30');
    assert.equal(f.run("document.getElementById('onlineBiddingInline').onlineState.saved.data.verified"),true);
    assert.match(f.d.querySelector('#stageSaveError').textContent,/公示.*先/);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,1);
});

test('received service fee blocks withdrawal before fee-stage completion without a write',async t=>{
    const f=setup(t);await openCompletedQuotation(f);
    f.d.querySelector('#ob_correction_reason').value='复核平台时间';
    f.run("document.getElementById('onlineBiddingInline').onlineState.saved.data.fee_received=true");
    f.d.querySelector('#stageCompleted').checked=false;await f.run('syncStageCompleted()');
    assert.equal(f.d.querySelector('#stageCompleted').checked,true);
    assert.match(f.d.querySelector('#stageSaveError').textContent,/到账/);
    assert.equal(f.calls.filter(c=>c.method!=='GET').length,0);
});
