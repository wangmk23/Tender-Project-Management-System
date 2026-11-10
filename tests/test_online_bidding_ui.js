'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require(process.env.PM_JSDOM_MODULE || 'jsdom');
const source = fs.readFileSync(path.join(__dirname, '../source/frontend/14-online-bidding.js'), 'utf8');

function setup() {
    const dom = new JSDOM('<div id="body"></div>');
    const calls = [];
    const context = vm.createContext({document:dom.window.document,
        currentProject:{id:1, method:'网上竞价', online_bidding_enabled:true, stages:[{key:'online_quotation'}], registrations:[{id:7,company_name:'<script>测试</script>'}], lots:[]},
        editingStageKey:'online_quotation',
        escHtml:value => String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
        api:async(method,url,payload) => { calls.push({method,url,payload}); return {revision:1, data:{}, summary:{status:'待设置竞价时段'}, history:[]}; },
        showModal:(_title,html,save) => { dom.window.document.getElementById('body').innerHTML=html; context.save=save; },
        closeModal:()=>{}, refreshProject:async()=>{}, toast:()=>{},
    });
    vm.runInContext(source, context);
    return {context,dom,calls};
}

async function feeFixture({key='online_fee_notice',received=true,notices=[]}={}) {
    const fixture=setup(),{context,dom,calls}=fixture;
    context.editingStageKey=key;
    context.currentProject.stages.push({key,completed:false,record_version:'fee-stage-1'});
    context.currentProject.notice_deliveries=notices;
    context.currentProject.bid_results=[{lot_id:null,winning_supplier:'合成成交供应商'}];
    let saved={revision:13,data:{publication_done:true,verified:true,fee_received:received,fee_date:received?'2026-11-09':'',fee_reference:received?'合成到账凭证':'',notice_delivered:false,notice_date:'',notice_reference:'',records:[]},summary:{lots:[]},history:[]};
    context.api=async(method,url,payload)=>{
        calls.push({method,url,payload});
        if(method==='PUT')saved={...saved,revision:saved.revision+1,data:payload.data};
        return structuredClone(saved);
    };
    dom.window.document.getElementById('body').innerHTML=context.renderOnlineBiddingInline({key},context.currentProject);
    await context.loadOnlineBiddingInline({key},context.currentProject);
    return fixture;
}

test('received fee with missing notice shows the actual missing step and rejects completion before writing',async()=>{
    const {context,dom,calls}=await feeFixture();
    assert.match(dom.window.document.querySelector('[data-ob-fee-status]').textContent,/服务费到账.*已确认/s);
    assert.match(dom.window.document.querySelector('[data-ob-fee-status]').textContent,/通知书.*未登记/s);
    await assert.rejects(context.saveOnlineBiddingInline({completed:true,skipped:false}),/通知书领取.*日期/);
    assert.equal(calls.filter(c=>c.method==='PUT').length,0);
    assert.equal(dom.window.document.getElementById('ob_fee_reference').value,'合成到账凭证');
});

test('explicit fee confirmation saves only the ledger, keeping stage and notice completion pending',async()=>{
    const {context,dom,calls}=await feeFixture({received:false});
    dom.window.document.getElementById('ob_fee_date').value='2026-11-09';
    dom.window.document.getElementById('ob_fee_reference').value='合成到账凭证';
    await context.saveOnlineBiddingFee();
    const writes=calls.filter(c=>c.method==='PUT');
    assert.equal(writes.length,1);
    assert.equal(writes[0].url,'/api/projects/1/online-bidding');
    assert.equal(writes[0].payload.revision,13);
    assert.equal(writes[0].payload.data.fee_received,true);
    assert.equal(writes[0].payload.data.notice_delivered,false);
    assert.equal(context.currentProject.stages.at(-1).completed,false);
    assert.match(dom.window.document.querySelector('[data-ob-fee-status]').textContent,/服务费到账.*已确认/s);
});

test('fee confirmation rejects missing information and preserves the saved status after a conflict',async()=>{
    const {context,dom,calls}=await feeFixture({received:false});
    await context.saveOnlineBiddingFee();
    assert.equal(calls.filter(c=>c.method==='PUT').length,0);
    dom.window.document.getElementById('ob_fee_date').value='2026-11-09';
    dom.window.document.getElementById('ob_fee_reference').value='未保存草稿';
    context.api=async()=>{throw Object.assign(new Error('记录已更新'),{status:409});};
    await context.saveOnlineBiddingFee();
    assert.equal(dom.window.document.getElementById('ob_fee_reference').value,'未保存草稿');
    assert.match(dom.window.document.querySelector('[data-ob-fee-status]').textContent,/服务费到账.*待确认/s);
    assert.match(dom.window.document.querySelector('[data-ob-save-error]').textContent,/记录已更新/);
});

test('notice status checks each procurement lot and its pickup date without requiring notices for legacy fee stage',async()=>{
    const {context,dom,calls}=await feeFixture({key:'service_fee'});
    await context.saveOnlineBiddingInline({completed:true,skipped:false});
    assert.equal(calls.filter(c=>c.method==='PUT').at(-1).payload.data.fee_received,true);
    assert.equal(calls.filter(c=>c.method==='PUT').at(-1).payload.data.notice_delivered,false);
    context.currentProject.lots=[{id:10,lot_name:'甲包'},{id:20,lot_name:'乙包'}];
    context.currentProject.bid_results=[{lot_id:10,winning_supplier:'甲供应商'},{lot_id:20,winning_supplier:'乙供应商'}];
    context.currentProject.notice_deliveries=[{lot_id:10,supplier_name:'甲供应商',pickup_date:'2026-11-09'},{lot_id:20,supplier_name:'乙供应商',pickup_date:null}];
    assert.match(context.onlineBiddingNoticeIssues(context.currentProject).join('；'),/乙包.*日期/);
    context.currentProject.notice_deliveries[1].pickup_date='2026-11-10';
    assert.equal(context.onlineBiddingNoticeIssues(context.currentProject).length,0);
    context.currentProject.notice_deliveries[1].supplier_name='错误供应商';
    assert.match(context.onlineBiddingNoticeIssues(context.currentProject).join('；'),/乙包.*供应商/);
    assert.equal(dom.window.document.getElementById('ob_fee_reference').value,'合成到账凭证');
});

test('archived online stages do not enable inline controls on ordinary active stages', () => {
    const {context}=setup();
    context.currentProject.stages=[{key:'registration_end',modules:['registration']},{key:'online_quotation',modules:['online_bidding'],template_removed:true}];
    assert.equal(vm.runInContext('hasInlineOnlineBidding(currentProject)',context),false);
    assert.equal(vm.runInContext('onlineBiddingStageKind(currentProject.stages[0],currentProject)',context),'');
    context.currentProject.stages.push({key:'custom_quote',modules:['online_bidding']});
    assert.equal(vm.runInContext('hasInlineOnlineBidding(currentProject)',context),true);
});

test('nine stages preserve fee before notice and disable automatic completion', () => {
    const {context} = setup();
    const template = vm.runInContext('onlineBiddingTemplate()',context);
    assert.equal(template.length,9);
    assert.equal(template[5].id,'online_quotation');
    assert.deepEqual([...template[7].modules.slice(-2)],['service_fee','winning_notice']);
    assert.ok(template.every(row=>!row.modules.includes('auto_completion')));
});

test('renamed and custom module auctions retain inline UI after reload and stage saves', () => {
    const {context}=setup();
    for(const method of ['自主平台竞价','自定义询价']) {
        context.currentProject.method=method;
        context.currentProject.stages=[{key:'custom_quote',modules:['common','online_bidding']}];
        assert.equal(vm.runInContext('hasInlineOnlineBidding(currentProject)',context),true);
        assert.ok(vm.runInContext("renderOnlineBiddingInline(currentProject.stages[0],currentProject)",context).includes('onlineBiddingInline'));
    }
    context.currentProject.online_bidding_enabled=false;
    assert.equal(vm.runInContext('hasInlineOnlineBidding(currentProject)',context),false);
});

test('business fields render inside only the matching stage, with no duplicate flow', async () => {
    const {context,dom} = setup();
    const html = vm.runInContext("renderOnlineBiddingInline({key:'online_quotation'}, currentProject)",context);
    dom.window.document.getElementById('body').innerHTML=html;
    await vm.runInContext("loadOnlineBiddingInline({key:'online_quotation'}, currentProject)",context);
    assert.equal(dom.window.document.querySelectorAll('[data-ob-amount]').length,1);
    assert.equal(dom.window.document.querySelectorAll('[data-ob-review]').length,0);
    assert.equal(dom.window.document.querySelectorAll('script').length,0);
    assert.ok(!dom.window.document.body.textContent.includes('接收项目'));
    assert.equal(vm.runInContext("renderOnlineBiddingInline({key:'plan_received'}, currentProject)",context),'');
    assert.equal(vm.runInContext("typeof showOnlineBiddingLedger",context),'undefined');
});

test('saving a stage preserves unrelated ledger fields and uses its original completion', async () => {
    const {context,dom,calls} = setup();
    dom.window.document.getElementById('body').innerHTML=vm.runInContext("renderOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    await vm.runInContext("loadOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    dom.window.document.querySelector('[data-ob-amount]').value='10.01';
    await vm.runInContext("saveOnlineBiddingInline({completed:false})",context);
    const call=calls.find(c=>c.method==='PUT');
    assert.equal(call.payload.data.records[0].amount,'10.01');
    assert.equal(call.payload.stage_key,'online_quotation');
    assert.equal(call.payload.data.verified,false);
});

test('default template has no repeated ledger module and only one reset action', () => {
    const {context}=setup();
    const template=vm.runInContext('onlineBiddingTemplate()',context);
    assert.equal(template.filter(s=>s.modules.includes('online_bidding')).length,1);
    const settings=fs.readFileSync(path.join(__dirname,'../source/frontend/11-stage-settings.js'),'utf8');
    assert.ok(!settings.includes('useOnlineBiddingTemplate'));
});

test('legacy projects keep their original result workflow', () => {
    const {context}=setup();
    context.currentProject.stages=[{key:'result_announced'}];
    assert.equal(vm.runInContext("renderOnlineBiddingInline({key:'result_announced'},currentProject)",context),'');
    assert.equal(vm.runInContext("renderOnlineRegistrationSlot({id:7},currentProject)",context),'');
});

test('legacy completed projects with synced quotation stages are not enrolled', async () => {
    const {context,calls}=setup();
    delete context.currentProject.online_bidding_enabled;
    context.currentProject.stages[0].completed=true;
    for (const key of ['online_quotation','registration_end','result_announced','online_fee_notice']) {
        assert.equal(vm.runInContext(`renderOnlineBiddingInline({key:'${key}'},currentProject)`,context),'');
        await vm.runInContext(`loadOnlineBiddingInline({key:'${key}'},currentProject)`,context);
    }
    assert.equal(vm.runInContext('renderOnlineRegistrationSlot({id:7},currentProject)',context),'');
    assert.equal(calls.length,0);
});

test('inline draft survives business module refresh and retains conflict revision', async () => {
    const {context,dom,calls}=setup();
    const render=async()=>{
        dom.window.document.getElementById('body').innerHTML=vm.runInContext("renderOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
        await vm.runInContext("loadOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    };
    await render();
    const amount=dom.window.document.querySelector('[data-ob-amount]');
    amount.value='123.45';amount.dispatchEvent(new dom.window.Event('input'));
    context.api=async(method,url,payload)=>{calls.push({method,url,payload});return {revision:9,data:{},summary:{status:'changed'},history:[]};};
    await render();
    assert.equal(dom.window.document.querySelector('[data-ob-amount]').value,'123.45');
    await vm.runInContext('saveOnlineBiddingInline({completed:false})',context);
    assert.equal(calls.find(c=>c.method==='PUT').payload.revision,1);
    context.currentProject.id=2;
    await render();
    assert.equal(dom.window.document.querySelector('[data-ob-amount]').value,'');
});


test('unchanged ledger saves do not add redundant history revisions',async()=>{
    const {context,dom,calls}=setup();
    context.api=async(method,url,payload)=>{calls.push({method,url,payload});return {revision:1,data:payload?.data || {},summary:{status:'pending'},history:[]};};
    dom.window.document.getElementById('body').innerHTML=vm.runInContext("renderOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    await vm.runInContext("loadOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    await vm.runInContext('saveOnlineBiddingInline({completed:false})',context);
    await vm.runInContext('saveOnlineBiddingInline({completed:false})',context);
    assert.equal(calls.filter(c=>c.method==='PUT').length,1);
});


test('quotation completion points to exact missing field and preserves entered quote',async()=>{
    const {context,dom,calls}=setup();
    context.api=async()=>({revision:1,data:{roster_locked:true,start_at:'2026-09-01T09:00',end_at:'2026-09-01T12:00',records:[{registration_id:7,review:'approved'}]},summary:{status:'待核对'},history:[]});
    dom.window.document.getElementById('body').innerHTML=vm.runInContext("renderOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    await vm.runInContext("loadOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    const amount=dom.window.document.querySelector('[data-ob-amount]');amount.value='19.99';
    await assert.rejects(vm.runInContext('saveOnlineBiddingInline({completed:true})',context),/平台实际结束时间/);
    assert.equal(amount.value,'19.99');
    assert.ok(dom.window.document.querySelector('[data-ob-save-error]').textContent.includes('平台结果凭证'));
    assert.equal(dom.window.document.activeElement.id,'ob_ended_at');
    assert.equal(calls.filter(c=>c.method==='PUT').length,0);
});

test('server refusal stays visible beside unchanged quotation draft and retry clears it',async()=>{
    const {context,dom}=setup();
    let fail=true;
    context.api=async(method,_url,payload)=>{
        if(method==='PUT' && fail)throw new Error('记录已更新，请重新打开后编辑');
        return {revision:2,data:payload?.data || {},summary:{status:'待核对'},history:[]};
    };
    dom.window.document.getElementById('body').innerHTML=vm.runInContext("renderOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    await vm.runInContext("loadOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    dom.window.document.querySelector('[data-ob-amount]').value='12';
    await assert.rejects(vm.runInContext('saveOnlineBiddingInline({completed:false})',context),/已更新/);
    assert.match(dom.window.document.querySelector('[data-ob-save-error]').textContent,/已更新/);
    assert.equal(dom.window.document.querySelector('[data-ob-amount]').disabled,false);
    fail=false;
    await vm.runInContext('saveOnlineBiddingInline({completed:false})',context);
    assert.equal(dom.window.document.querySelector('[data-ob-save-error]'),null);
});

test('quotation roster guidance distinguishes registration review from actual participation',async()=>{
    const {context,dom}=setup();
    context.currentProject.stages.push({key:'registration_end'});
    dom.window.document.getElementById('body').innerHTML=vm.runInContext("renderOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    await vm.runInContext("loadOnlineBiddingInline({key:'online_quotation'},currentProject)",context);
    assert.match(dom.window.document.getElementById('onlineBiddingInline').textContent,/报名审核.*参竞名单/);
    assert.match(dom.window.document.getElementById('onlineBiddingInline').textContent,/实际参与名单/);
});
