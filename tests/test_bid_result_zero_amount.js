'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const test=require('node:test');
const {JSDOM}=require('jsdom');
const acorn=require('acorn');

function declaration(file,name) {
    const source=fs.readFileSync(path.join(__dirname,'../source/frontend',file),'utf8');
    const ast=acorn.parse(source,{ecmaVersion:'latest'});let found;
    function visit(node){
        if(!node||typeof node!=='object')return;
        if(node.type==='FunctionDeclaration'&&node.id?.name===name)found=node;
        for(const value of Object.values(node))if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);
    }
    visit(ast);assert.ok(found,name);
    return source.slice(found.start,found.end);
}

function form(amount, discount='') {
    const dom=new JSDOM('<!doctype html><body></body>');
    const calls=[];
    const context={console,window:dom.window,document:dom.window.document,
        currentProject:{id:1,lots:[],registrations:[{id:1,company_name:'模拟供应商'}],
            tender_guarantee:{policy:{strict_results:false}},
            bid_results:[{id:2,winning_supplier:'模拟供应商',winning_amount:amount,discount_rate:discount,notes:''}]},
        escHtml:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
        isOnlineProcurementProject:()=>false,hasInlineOnlineBidding:()=>false,
        showModal(title,html,save){dom.window.document.body.innerHTML=html;context.save=save;},
        api:async(method,url,data)=>{calls.push({method,url,data});return {};},
        closeModal(){},refreshProject:async()=>{},toast(){},reopenStageModule(){}};
    vm.createContext(context);
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../source/frontend/07-business.js'),'utf8'),context);
    context.reopenBidResultStage=()=>{};
    context.showBidResultForm(2);
    return {context,calls,input:dom.window.document.getElementById('bidAmount'),dom};
}

for (const value of [0,'0','0.00']) {
    test(`ordinary bid result preserves zero ${JSON.stringify(value)} when opened and saved`,async()=>{
        const {context,calls,input,dom}=form(value,'95%');
        assert.notEqual(input.value,'','saved zero must be visible');
        assert.equal(Number(input.value),0);
        await context.save();
        assert.equal(calls.length,1);
        assert.equal(calls[0].method,'PUT');
        assert.equal(calls[0].url,'/api/projects/1/bid-results/2');
        assert.notEqual(calls[0].data.winning_amount,null);
        assert.equal(Number(calls[0].data.winning_amount),0);
        assert.equal(calls[0].data.discount_rate,'95%');
        dom.window.close();
    });
}
test('missing amount remains blank and an explicit clear still saves null',async()=>{
    for (const value of [null,undefined,'',123.45]) {
        const {context,calls,input,dom}=form(value);
        assert.equal(input.value,value==null?'':String(value));
        input.value='';
        await context.save();
        assert.equal(calls[0].data.winning_amount,null);
        dom.window.close();
    }
});

test('project and stage-card amount summary retains zero before discount fallback',()=>{
    const context={};vm.createContext(context);
    vm.runInContext(declaration('01-core.js','formatMoneyShort')+'\n'+declaration('01-core.js','formatBidInfo'),context);
    assert.equal(context.formatBidInfo({winning_amount:0,discount_rate:'95%'}),'¥0元');
    assert.equal(context.formatBidInfo({winning_amount:0,discount_rate:''}),'¥0元');
    assert.equal(context.formatBidInfo({winning_amount:null,discount_rate:'95%'}),'95%');
    assert.equal(context.formatBidInfo({winning_amount:'',discount_rate:''}),'');
});

test('stage result list displays zero and keeps only missing amount as discount',()=>{
    const context={hasInlineOnlineBidding:()=>false,isOnlineProcurementProject:()=>false,
        escHtml:v=>String(v??''),winningSupplierLabel:(_p,b)=>b.winning_supplier};
    vm.createContext(context);vm.runInContext(declaration('04-project-workflow.js','renderStageBidResults'),context);
    const html=context.renderStageBidResults({lots:[],bid_results:[{id:1,winning_supplier:'模拟供应商',winning_amount:0,discount_rate:'95%'}]});
    assert.match(html,/¥0/);assert.doesNotMatch(html,/95%/);
    assert.match(context.renderStageBidResults({lots:[],bid_results:[{id:1,winning_amount:null,discount_rate:'95%'}]}),/95%/);
});
