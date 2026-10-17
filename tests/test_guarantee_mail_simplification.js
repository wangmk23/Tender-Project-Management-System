'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require('jsdom');
function setup(){
 const dom=new JSDOM('<main></main>');const c=vm.createContext({document:dom.window.document,window:dom.window,currentIsAdmin:true,isDesktopApp:()=>true,escHtml:x=>String(x??''),getOrderedStages:()=>[{key:'registration',name:'报名'}],systemSettings:{reminder_recipient_groups:[{id:'legacy-default',name:'默认组',enabled:true,recipients:['test@example.test'],event_types:['daily_stage','deposit_refund'],content_fields:{project_name:true,stage_name:true,deposit_balance:true}}]},activateDialogFocus:()=>{},releaseDialogFocus:()=>{}});require('./install_procurement_contract.cjs')(c);
 const source=fs.readFileSync(__dirname+'/../source/frontend/06-admin.js','utf8');vm.runInContext(source.slice(0,source.lastIndexOf('\ninitDisplayPreferences();')),c);return {c,dom};
}
test('outer settings have only common delivery rules and no duplicate recipient/content switches',()=>{
 const {c,dom}=setup();dom.window.document.querySelector('main').innerHTML=c.renderReminderSettingsCard(c.systemSettings);
 assert.equal(dom.window.document.querySelector('#reminderRecipients'),null);
 assert.equal(dom.window.document.querySelector('[data-reminder-content]'),null);
 assert.equal(dom.window.document.querySelector('#eventReminderCreateEnabled'),null);
 const data=c.collectReminderSettings();assert.equal('reminder_recipients' in data,false);assert.equal('reminder_content' in data,false);assert.equal('event_reminder_create_enabled' in data,false);
 assert.ok(dom.window.document.querySelector('#reminderTime'));
});
test('group fields are categorized without duplicate shared-field checkboxes or lost selections',()=>{
 const {c,dom}=setup();c.openRecipientGroupDrawer('legacy-default');
 assert.ok(dom.window.document.querySelector('[data-recipient-category="common"]'));
 assert.ok(dom.window.document.querySelector('[data-recipient-category="daily_stage"]'));
 assert.ok(dom.window.document.querySelector('[data-recipient-category="deposit"]'));
 const fields=[...dom.window.document.querySelectorAll('[data-recipient-field]')].map(x=>x.value);assert.equal(new Set(fields).size,fields.length);
 assert.equal(dom.window.document.querySelector('[data-recipient-field][value="stage_name"]').checked,true);
});
test('no-deposit hides both amount sections and restores entered values on re-enable',()=>{
 const {c,dom}=setup();c.allProjects=[];c.METHODS=['公开招标'];c.showModal=(title,html)=>dom.window.document.querySelector('main').innerHTML=html;c.showNewProjectModal();
 const doc=dom.window.document,amount=doc.getElementById('npDepositAmount'),lot=doc.getElementById('packDepositAmount');
 assert.equal(amount.type,'text');assert.equal(lot.type,'text');amount.value='30000';lot.value='5000';doc.getElementById('npNoDeposit').checked=true;c.syncNewProjectGuarantee();
 assert.equal(amount.closest('.form-group').hidden,true);assert.equal(lot.parentElement.hidden,true);
 doc.getElementById('npNoDeposit').checked=false;c.syncNewProjectGuarantee();assert.equal(lot.parentElement.hidden,false);assert.equal(amount.value,'30000');assert.equal(lot.value,'5000');
});
