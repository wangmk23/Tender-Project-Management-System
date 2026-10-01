'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('source/frontend/06-admin.js','utf8');
const section=source.slice(source.indexOf('async function persistRecipientGroups('),source.indexOf('async function previewRecipientGroup('));
test('concurrent recipient toggles apply to latest saved groups',async()=>{
    let release; const gate=new Promise(r=>release=r); const calls=[];
    const context={systemSettings:{reminder_recipient_groups:[{id:'a',enabled:true},{id:'b',enabled:true}]},toast(){},cacheCurrentSettingsView(){},renderSettingsView(){},collectReminderSettings:()=>({}),validateRecipientGroupDraft:()=>''};
    let stored=structuredClone(context.systemSettings);
    context.currentRecipientGroups=()=>structuredClone(context.systemSettings.reminder_recipient_groups);
    context.api=async(method,url,data)=>{
        if(method==='GET')return structuredClone(stored);
        calls.push(data);if(calls.length===1)await gate;
        stored={reminder_recipient_groups:structuredClone(data.reminder_recipient_groups)};return {settings:stored};
    };
    vm.createContext(context);vm.runInContext(section,context);
    const first=context.toggleRecipientGroup('a'),second=context.toggleRecipientGroup('b');
    await new Promise(r=>setImmediate(r));assert.equal(calls.length,1);
    release();await Promise.all([first,second]);
    assert.deepEqual(stored.reminder_recipient_groups.map(g=>g.enabled),[false,false]);
});
