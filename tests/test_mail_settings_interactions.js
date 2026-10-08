'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const root = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'source/frontend/06-admin.js'), 'utf8');

async function fixture(run) {
    const browser = await chromium.launch(fs.existsSync(chromium.executablePath()) ? {headless:true} : {headless:true,channel:'chrome'});
    try {
        const page = await browser.newPage();
        await page.setContent('<main id="fixture"></main>');
        await page.addScriptTag({content:source});
        await page.evaluate(() => {
            window.currentIsAdmin = true; window.isDesktopApp = () => true;
            window.escHtml = value => String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
            window.reminderStageDefinitions = () => [{key:'notice',name:'公告',icon:'•'}, {key:'award',name:'中标',icon:'•'}];
            window.systemSettings = {reminder_weekdays:[0,1,2,3,4,5,6],reminder_content:{},reminder_stage_keys:['notice','award'],reminder_recipient_groups:[{id:'a',name:'示例',enabled:true,recipients:['sample@example.test'],event_types:['daily_stage'],content_fields:{project_name:true,stage_name:true,planned_at:true},subject_prefix:''}]};
            window.storedSettings = structuredClone(systemSettings); window.requests = [];
            window.toast = () => {}; window.cacheCurrentSettingsView = () => {};
            window.activateDialogFocus = () => {}; window.releaseDialogFocus = () => {};
            window.renderSettingsView = () => {document.getElementById('fixture').innerHTML=renderReminderSettingsCard(systemSettings);};
            window.api = async (method,url,data) => {
                if(method==='GET') return structuredClone(storedSettings);
                requests.push(structuredClone(data));
                if(!data.reminder_action || data.reminder_action==='send_test') {
                    storedSettings={...storedSettings,...structuredClone(data)};
                    // Group writes derive compatibility options in the backend.
                    if(data.reminder_recipient_groups) {
                        const groups=data.reminder_recipient_groups.filter(group=>group.enabled);
                        const types=new Set(groups.flatMap(group=>group.event_types));
                        storedSettings.reminder_content=Object.fromEntries(['project_number','project_name','purchaser','stage_name','planned_at','registration_count'].map(key=>[key,groups.some(group=>group.content_fields[key])]));
                        storedSettings.event_reminder_create_enabled=types.has('project_create');
                        storedSettings.event_reminder_complete_enabled=types.has('project_complete');
                    }
                }
                return {settings:structuredClone(storedSettings),preview:{subject:'隔离预览',body:'隔离内容'}};
            };
            renderSettingsView();
        });
        await run(page);
    } finally {await browser.close();}
}

test('all seven weekdays and six content fields persist through browser save and reload', () => fixture(async page => {
    assert.equal(await page.locator('[data-reminder-weekday]:checked').count(),7);
    assert.deepEqual(await page.locator('[data-reminder-weekday]').evaluateAll(inputs=>inputs.map(input=>Number(input.value))),[0,1,2,3,4,5,6]);
    for(const input of await page.locator('[data-reminder-weekday]').all()){await input.uncheck();await input.check();}
    for(const input of await page.locator('[data-reminder-content]').all()) await input.uncheck();
    await page.locator('[data-reminder-content][value="registration_count"]').check();
    await page.locator('[data-reminder-stage][value="notice"]').uncheck();
    await page.locator('#eventReminderCreateEnabled').check();
    await page.evaluate(()=>saveReminderSettings());
    assert.deepEqual(await page.evaluate(()=>storedSettings.reminder_weekdays),[0,1,2,3,4,5,6]);
    assert.equal(await page.locator('[data-reminder-content]:checked').count(),1);
    assert.equal(await page.locator('[data-reminder-content][value="registration_count"]').isChecked(),true);
    assert.deepEqual(await page.evaluate(()=>storedSettings.reminder_stage_keys),['award']);
    assert.equal(await page.locator('#eventReminderCreateEnabled').isChecked(),true);
    assert.equal(await page.locator('#eventReminderCompleteEnabled').isChecked(),false);
    for(const input of await page.locator('[data-reminder-content]').all()) await input.check();
    await page.evaluate(()=>saveReminderSettings());
    assert.equal(await page.locator('[data-reminder-content]:checked').count(),6);
}));

test('group edits preserve type-specific selections and cancel keeps saved settings', () => fixture(async page => {
    await page.evaluate(()=>openRecipientGroupDrawer('a'));
    await page.locator('[data-recipient-event][value="project_create"]').check();
    await page.locator('[data-recipient-event][value="daily_stage"]').uncheck();
    await page.locator('[data-recipient-event][value="daily_stage"]').check();
    assert.equal(await page.locator('[data-recipient-field][value="stage_name"]').isChecked(),true);
    await page.locator('#recipientGroupName').fill('取消的草稿');
    await page.evaluate(()=>closeRecipientGroupDrawer());
    assert.equal(await page.evaluate(()=>storedSettings.reminder_recipient_groups[0].name),'示例');
    assert.equal(await page.evaluate(()=>requests.length),0);
}));

test('group writes and preview/test actions preserve unsaved main form and saved values', () => fixture(async page => {
    await page.locator('#reminderSubject').fill('未保存的主题');
    await page.locator('#smtpPassword').fill('isolated-draft-password');
    await page.evaluate(()=>toggleRecipientGroup('a'));
    assert.deepEqual(await page.evaluate(()=>Object.keys(requests[0])),['reminder_recipient_groups']);
    assert.equal(await page.locator('#reminderSubject').inputValue(),'未保存的主题');
    await page.evaluate(()=>previewReminderEmail());
    assert.equal(await page.evaluate(()=>storedSettings.smtp_password),undefined);
    await page.evaluate(()=>sendReminderTestEmail());
    assert.equal(await page.locator('#reminderSubject').inputValue(),'未保存的主题');
    assert.equal(await page.locator('#smtpPassword').inputValue(),'isolated-draft-password');
    assert.equal(await page.evaluate(()=>storedSettings.smtp_password),'isolated-draft-password');
    await page.evaluate(()=>openRecipientGroupDrawer('a'));
    await page.locator('#recipientGroupName').fill('预览草稿');
    await page.evaluate(()=>previewRecipientGroup('a'));
    await page.evaluate(()=>sendRecipientGroupTest('a'));
    assert.equal(await page.evaluate(()=>requests.filter(request=>['preview_group','send_group_test'].includes(request.reminder_action)).every(request=>!('reminder_subject' in request))),true);
    await page.evaluate(()=>closeRecipientGroupDrawer());
    assert.equal(await page.evaluate(()=>storedSettings.reminder_recipient_groups[0].name),'示例');
    await page.evaluate(()=>{openRecipientGroupDrawer('a');document.getElementById('fixture').remove();});
    await page.evaluate(()=>previewRecipientGroup('a'));
    await page.evaluate(()=>sendRecipientGroupTest('a'));
    assert.equal(await page.evaluate(()=>requests.slice(-2).every(request=>!Object.keys(request).some(key=>key.startsWith('smtp_')))),true);
}));

test('browser project batch picker excludes completed, skipped, removed, terminated and empty projects', () => fixture(async page => {
    const template=fs.readFileSync(path.join(root,'src/templates/workspace.html'),'utf8');
    const modalStart=template.indexOf('<div class="modal" id="batchAdvanceDialog"');
    const end=template.indexOf('<!-- User Menu',modalStart);
    assert.ok(modalStart>=0 && end>modalStart);
    await page.setContent('<div id="batchAdvanceOverlay"></div>'+template.slice(modalStart,end));
    await page.addScriptTag({content:fs.readFileSync(path.join(root,'source/frontend/02-projects.js'),'utf8')});
    await page.evaluate(()=>{
        const rows=[
            {id:1,number:'1',name:'可推进',method:'公开招标',progress:80,stages:[{key:'notice',completed:false}]},
            {id:2,number:'2',name:'已完成',method:'公开招标',progress:20,stages:[{key:'notice',completed:true}]},
            {id:3,number:'3',name:'不适用',method:'公开招标',progress:0,stages:[{key:'notice',skipped:true}]},
            {id:4,number:'4',name:'已移除',method:'公开招标',stages:[{key:'notice',template_removed:true}]},
            {id:5,number:'5',name:'已终止',method:'公开招标',is_terminated:true,stages:[{key:'notice'}]},
            {id:6,number:'6',name:'无阶段',method:'公开招标',stages:[]},
            {id:7,number:'7',name:'已完成进度',method:'公开招标',progress:100,stages:[{key:'notice',completed:false}]},
        ];
        window.allProjects=rows;window.projectById=new Map(rows.map(row=>[row.id,row]));
        window.clientProcurementMethods=()=>['公开招标'];
        window.normalizeClientStageTemplates=()=>({'公开招标':[{id:'notice',name:'公告'}]});
        window.orderProjectStages=stages=>stages;
        window.projectStageDefinition=()=>({name:'公告',icon:'•'});
        window.plannedDate=()=>'';
        openBatchAdvanceDialog();
    });
    await page.locator('#baModeProject').click();
    assert.deepEqual(await page.locator('#batchProjectSelect option').evaluateAll(options=>options.map(option=>option.value)),['','1']);
    await page.locator('#batchProjectSelect').selectOption('1');
    assert.equal(await page.locator('[data-stage="notice"]').count(),1);
    assert.equal(await page.locator('#batchAdvanceOk').isEnabled(),true);
    await page.evaluate(()=>batchAdvanceSelectNone());
    assert.equal(await page.locator('#batchAdvanceOk').isEnabled(),false);
    await page.evaluate(()=>batchAdvanceSelectAll());
    assert.equal(await page.locator('#batchAdvanceOk').isEnabled(),true);
}));
