'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const src=fs.readFileSync(path.join(__dirname,'../source/frontend/27-special-results.js'),'utf8');

function fixture() {
    const dom=new JSDOM('<body></body>');
    const document=dom.window.document;
    const registrations=[{id:4,company_name:'甲行'},{id:8,company_name:'乙行'}];
    const writes=[],uploads=[],records=[],fileRows=new Map();
    const ctx={currentProject:{id:1,registrations,lots:[],tender_guarantee:{}},
        document,FormData:dom.window.FormData,escHtml:value=>String(value??'').replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),
        registrationSupplierLabel:reg=>reg.company_name,eligibleBidRegistrations:()=>registrations,
        hasInlineOnlineBidding:()=>false,isDesktopApp:()=>false,confirmDialog:async()=>true,toast(){},async refreshProject(){},reopenBidResultStage(){},
        showModal(title,html,save){ctx.modalCount=(ctx.modalCount||0)+1;document.body.innerHTML=html+'<button id="modalSaveBtn"></button>';ctx.save=save;},
        closeModal(){document.body.innerHTML='';},
        async api(method,url,payload){
            if(url.endsWith('/save-local')) return {path:`D:/exports/${url.split('/')[3]}.pdf`,filename:'saved.pdf'};
            if(url.includes('/attachments')) return {attachments:fileRows.get(url)||[]};
            assert.match(url,/lot_id=&format=mode/);
            const rev=Number(new URL('http://test'+url).searchParams.get('revision'));
            if(method==='GET') return structuredClone(records[(rev||records.length)-1] || {revision:0,mode:'pricing',entries:[],items:[],notes:''});
            const data=structuredClone(payload);
            writes.push(data);
            assert.equal(data.revision,records.length);
            data.revision++;
            data.history=[...records,data].map(row=>({revision:row.revision,mode:row.mode}));
            records.push(data);
            return structuredClone(data);
        },
        async apiForm(url,body){
            uploads.push(url);
            if(uploads.length===2) throw new Error('上传临时失败');
            const attachments=body.getAll('files').map((f,i)=>({filename:f.name,id:i+1}));
            fileRows.set(url,attachments);
            return {attachments};
        }};
    vm.createContext(ctx);vm.runInContext(src,ctx);
    const find=q=>{const node=document.querySelector(q);assert.ok(node,q);return node;};
    const change=(q,value)=>{
        const el=find(q);
        el.value=value;el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    };
    const addFile=(index,name)=>{
        const el=find(`[data-entry="${index}"] [data-files]`);
        Object.defineProperty(el,'files',{value:[new dom.window.File(['demo'],name)]});
        el.dispatchEvent(new dom.window.Event('change',{bubbles:true}));
    };
    return {ctx,find,change,addFile,dom,document,writes,uploads,records};
}

test('banking shortlist saves shared scope, independent supplier prices, zero and blank, and retries only pending files',async()=>{
    const {ctx,find,change,addFile,document,writes,uploads,records}=fixture();
    await ctx.showSpecialResultForm();
    assert.equal(document.querySelector('[data-supplier]'),null);
    change('[data-mode]','multi');
    assert.equal(document.querySelector('[data-action="add-item"]'),null);
    find('[data-supplier="4"]').click();
    for(let i=0;i<12;i++) {
        find('[data-action="add-item"]').click();
        change(`[data-item="${i}"] [data-key="name"]`,`卡片 ${i+1}`);
    }
    for(const [index,rid] of [4,8].entries()) {
        if(index) {
            find(`[data-supplier="${rid}"]`).click();
            find(`[data-entry="${index}"] [data-action="fill-prices"]`).click();
        }
        assert.equal(document.querySelectorAll(`[data-entry="${index}"] [data-price]`).length,12);
        change(`[data-entry="${index}"] [data-price="0"] [data-key="value"]`,index?'1.2':'0');
        addFile(index,`${rid}.pdf`);
    }
    await ctx.save();
    assert.equal(writes.length,1);
    assert.equal(writes[0].items.length,12);
    assert.equal(writes[0].entries[0].prices[0].value,'0');
    assert.equal(writes[0].entries[1].prices[0].value,'1.2');
    assert.equal(writes[0].entries[0].prices[1].value,null);
    assert.match(find('[role=status]').textContent,/结果已保存/);
    assert.match(find('[data-files-list="8"]').textContent,/待上传/);
    await ctx.save();
    assert.equal(writes.length,1);
    assert.match(uploads[0],/registrations\/4/);
    assert.equal(uploads[1],uploads[2]);
    await ctx.showSpecialResultForm();
    assert.equal(find('[data-entry="0"] [data-price="0"] [data-key="value"]').value,'0');
    assert.match(find('[data-files-list="4"]').textContent,/4.pdf/);
    assert.match(find('[data-files-list="8"]').textContent,/8.pdf/);
    ctx.isDesktopApp=()=>true;
    const modalsBefore=ctx.modalCount;
    find('[data-files-list="4"] [data-action="download"]').click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(ctx.modalCount,modalsBefore);
    assert.match(find('[role=status]').textContent,/已保存：/);
    assert.equal(records.length,1);
});
test('each shortlisted supplier can add private items and reuse another item with a separate fee',async()=>{
    const {ctx,find,change,document,writes}=fixture();
    await ctx.showSpecialResultForm();
    change('[data-mode]','framework');
    for(const [i,rid] of [4,8].entries()) {
        find(`[data-supplier="${rid}"]`).click();
        find(`[data-entry="${i}"] [data-action="add-item"]`).click();
        change(`[data-item="${i}"] [data-key="name"]`,i?'个性化制卡':'普通卡');
    }
    find('[data-entry="1"] [data-action="fill-prices"]').click();
    change('[data-entry="1"] [data-price="1"] [data-key="value"]','3.50');
    find('[data-entry="0"] [data-action="remove-price"]').click();
    assert.equal(document.querySelectorAll('[data-entry="1"] [data-price]').length,2);
    assert.equal(document.querySelector('[data-key="role"] option[value="candidate"]'),null);
    assert.equal(document.querySelector('[data-mode] option[value="candidates"]'),null);
    await ctx.save();
    assert.equal(writes[0].items.length,2);
    assert.equal(writes[0].entries[0].prices.length,0);
    assert.equal(writes[0].entries[1].prices[1].value,'3.50');
});
test('no-award requires reason and historical version is read-only',async()=>{
    const {ctx,find,change,document,records}=fixture();
    await ctx.showSpecialResultForm();
    change('[data-mode]','no_award');
    assert.equal(document.querySelector('[data-supplier]'),null);
    await ctx.save();
    assert.equal(records.length,0);
    change('[data-key="notes"]','有效响应不足');
    await ctx.save();
    await ctx.showSpecialResultForm();
    change('[data-key="notes"]','经复核，无有效响应');
    await ctx.save();
    await ctx.showSpecialResultForm();
    change('[data-history]','1');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(find('fieldset.special-body').disabled,true);
    assert.equal(find('[data-key="notes"]').value,'有效响应不足');
    assert.equal(find('#modalSaveBtn').hidden,true);
    change('[data-history]','');
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(find('[data-key="notes"]').value,'经复核，无有效响应');
});
