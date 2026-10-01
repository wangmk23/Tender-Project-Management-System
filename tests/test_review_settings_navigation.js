'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const read = file => fs.readFileSync(path.join(__dirname, '../source/frontend', file), 'utf8');
const settings = read('11-stage-settings.js');
function settingsContext() {
    const calls = [];
    const context = vm.createContext({
        currentIsAdmin:true, stageTemplateSaving:false, stageTemplateDirty:true,
        stageTemplateDraft:{test:[{name:'submitted'}]}, stageTemplateMethod:'test', systemSettings:{},
        beginStageTemplateDraft(){}, stageTemplateValidationError(){return '';},
        normalizeClientStageTemplates:value=>value, refreshStageTemplateEditor(){},
        toast:(...args)=>calls.push(['toast', ...args]), confirmDialog:async()=>true,
        allProjects:[{id:1,method:'test'},{id:2,method:'other'}], currentProject:{id:1,method:'test'},
        invalidateProjectDerivedState:id=>calls.push(['invalidate',id]),
        loadAllProjects:async()=>calls.push(['list']), refreshProject:async()=>calls.push(['detail']),
    });
    vm.runInContext(settings.slice(settings.indexOf('async function saveStageTemplates('), settings.indexOf('function handleStageTemplateMethod(')), context);
    return {context,calls};
}
test('template response preserves edits made during save and sends an isolated snapshot', async()=>{
    const {context}=settingsContext();
    let release, body;
    context.api=async(_method,_url,payload)=>{body=payload;await new Promise(resolve=>release=resolve);return {settings:{stage_templates:payload.stage_templates}};};
    const pending=context.saveStageTemplates();
    context.stageTemplateDraft.test[0].name='new unsaved edit';
    assert.equal(body.stage_templates.test[0].name,'submitted');
    release();await pending;
    assert.equal(context.systemSettings.stage_templates.test[0].name,'submitted');
    assert.equal(context.stageTemplateDraft.test[0].name,'new unsaved edit');
    assert.equal(context.stageTemplateDirty,true);
});
test('unchanged template draft accepts server normalization and clears dirty state',async()=>{
    const {context}=settingsContext();
    context.api=async()=>({settings:{stage_templates:{test:[{name:'normalized'}]}}});
    await context.saveStageTemplates();
    assert.equal(context.stageTemplateDraft.test[0].name,'normalized');
    assert.equal(context.stageTemplateDirty,false);
});
test('template sync invalidates affected details then refreshes list and selected detail',async()=>{
    const {context,calls}=settingsContext();context.stageTemplateDirty=false;
    context.api=async(_method,_url,body)=>{calls.push(['sync',body.stage_template_sync_method]);return {};};
    context.confirmDialog=async()=>{context.stageTemplateMethod='other';return true;};
    assert.equal(await context.syncCurrentStageTemplate(),true);
    assert.deepEqual(calls.slice(0,4),[['sync','test'],['invalidate',1],['list'],['detail']]);
});
test('successful sync with failed refresh reports warning rather than failure or success toast',async()=>{
    const {context,calls}=settingsContext();context.stageTemplateDirty=false;
    context.api=async()=>({});context.loadAllProjects=async()=>{throw new Error('offline');};
    assert.equal(await context.syncCurrentStageTemplate(),true);
    assert.equal(calls.at(-1)[2],'warning');
});
function keyboardContext() {
    const active=new Set(['tab-info']);const calls=[];let handler;
    const context=vm.createContext({currentProject:{id:1},
        document:{addEventListener:(_name,fn)=>handler=fn,getElementById:id=>({classList:{contains:()=>active.has(id)}})},
        topManagedDialog:()=>null,saveProjectInfo:()=>calls.push('save'),toast:()=>calls.push('premature-toast'),
    });
    const bootstrap=read('08-bootstrap.js');
    vm.runInContext(bootstrap.slice(bootstrap.indexOf("document.addEventListener('keydown'"),bootstrap.indexOf("window.addEventListener('pagehide'")),context);
    return {active,calls,press:()=>handler({key:'s',ctrlKey:true,preventDefault(){}})};
}
test('Ctrl+S ignores hidden info tabs and stage panels and leaves outcome feedback to saveProjectInfo',()=>{
    const {active,calls,press}=keyboardContext();
    press();assert.deepEqual(calls,[]);
    active.add('view-project');active.add('slidePanel');press();assert.deepEqual(calls,[]);
    active.delete('slidePanel');press();assert.deepEqual(calls,['save']);
});
