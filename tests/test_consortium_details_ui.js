'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{JSDOM}=require('jsdom');
function fixture(){
 const dom=new JSDOM('<main></main>');const calls=[];
 const member={company_name:'模拟成员',company_address:'模拟地址',legal_representative:'模拟法人',bid_manager:'模拟联系人',manager_phone:'123',manager_email:'member@example.test',notes:'模拟备注'};
 const c=vm.createContext({document:dom.window.document,window:dom.window,currentProject:{id:1,lots:[],registrations:[{id:1,company_name:'模拟牵头',bidder_type:'consortium',consortium_members:[member,{company_name:'成员二'}],attachments:[]}]},escHtml:x=>String(x??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;'),showModal:(title,html,save)=>{dom.window.document.querySelector('main').innerHTML=html;c.save=save;},toast:()=>{},closeModal:()=>{},refreshProject:async()=>{},reopenStageModule:()=>{},api:async(method,url,data)=>{calls.push({method,url,data});return {id:1};}});
 vm.runInContext(fs.readFileSync(__dirname+'/../source/frontend/07-business.js','utf8'),c);c.showRegistrationForm(1);return {c,dom,calls,member};
}
test('member details display and save to their own member; files remain on the parent',async()=>{
 const {c,dom,calls}=fixture();const doc=dom.window.document;
 assert.equal(doc.querySelector('[data-member-field="manager_email"]').value,'member@example.test');
 const phone=doc.querySelector('[data-member-field="manager_phone"]');phone.value='999';phone.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 await c.save();const row=calls[0].data.consortium_members[0];assert.equal(row.manager_phone,'999');assert.equal(row.company_address,'模拟地址');
 assert.equal(doc.querySelectorAll('input[type="file"]').length,1);assert.equal(doc.querySelector('#regConsortiumRows input[type="file"]'),null);
});
test('reordering and adding members preserve unsaved fields and exact member ownership',async()=>{
 const {c,dom,calls}=fixture();const doc=dom.window.document;const note=doc.querySelector('[data-member-field="notes"]');note.value='未保存备注';note.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 doc.querySelector('[data-consortium-action="down"]').click();doc.querySelector('[data-consortium-action="add"]').click();
 const name=doc.querySelectorAll('[data-member-field="company_name"]')[2];name.value='成员三';name.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 await c.save();const rows=calls[0].data.consortium_members;assert.equal(rows[1].notes,'未保存备注');assert.equal(rows[1].manager_email,'member@example.test');assert.equal(rows[2].company_name,'成员三');
});
test('invalid member email keeps draft and blocks request',async()=>{
 const {c,dom,calls}=fixture();const email=dom.window.document.querySelector('[data-member-field="manager_email"]');email.value='invalid';email.dispatchEvent(new dom.window.Event('input',{bubbles:true}));
 assert.equal(await c.save(),false);assert.equal(calls.length,0);assert.equal(email.value,'invalid');
});
