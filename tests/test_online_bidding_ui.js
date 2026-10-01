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

test('nine stages preserve fee before notice and disable automatic completion', () => {
    const {context} = setup();
    const template = vm.runInContext('onlineBiddingTemplate()',context);
    assert.equal(template.length,9);
    assert.equal(template[5].id,'online_quotation');
    assert.deepEqual([...template[7].modules.slice(-2)],['service_fee','winning_notice']);
    assert.ok(template.every(row=>!row.modules.includes('auto_completion')));
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
