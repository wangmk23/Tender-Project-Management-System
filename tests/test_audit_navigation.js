'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const manifest=JSON.parse(read('source/frontend/manifest.json'));
const source=manifest.sections.filter(section=>!['00-icons.js','08-bootstrap.js','15-select-popup.js','17-datetime-picker.js','19-holiday-calendar.js'].includes(section.file))
    .map(section=>read('source/frontend/'+section.file)).join('\n');
function setup(){
    const dom=new JSDOM(read('src/templates/workspace.html').replace(/<script\b[\s\S]*?<\/script>/g,''),{
        url:'http://127.0.0.1:54321/',runScripts:'outside-only',pretendToBeVisual:true,
    });
    const w=dom.window;
    w.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
    w.HTMLElement.prototype.scrollIntoView=function(){};
    vm.runInContext(source,dom.getInternalVMContext());
    w.eval(`
        currentIsAdmin=true;
        systemInfo={is_desktop:true,license:{}};
        systemSettings={is_desktop:true,smtp_host:'smtp.saved.invalid',login_subtitle:'已保存副标题'};
        window.CURRENT_USER={id:1,is_admin:true};
        api=async(method,url)=>url==='/api/settings'?systemSettings:url==='/api/system-info'?systemInfo:[];
        window.originalStartDeviceAdmissionPanelPolling=startDeviceAdmissionPanelPolling;
        window.originalStopDeviceAdmissionPanelPolling=stopDeviceAdmissionPanelPolling;
        startDeviceAdmissionPanelPolling=()=>{};
        stopDeviceAdmissionPanelPolling=()=>{};
        writeViewCache('settings',{systemInfo,systemSettings});
        writeViewCache('dashboard',{stats:{},projects:[]});
        switchView('settings');
    `);
    return {dom,w,d:w.document};
}
test('email draft survives main-view navigation while category changes keep their existing guard',()=>{
    const {dom,w,d}=setup();
    try{
        w.setSettingsCategory('email');
        d.getElementById('smtpHost').value='smtp.unsaved.invalid';
        d.getElementById('smtpHost').dispatchEvent(new w.Event('input',{bubbles:true}));
        w.markSettingsFormDirty();
        assert.equal(w.setSettingsCategory('about'),false,'dirty email category must keep its existing guard');
        assert.equal(d.getElementById('smtpHost').value,'smtp.unsaved.invalid');
        w.switchView('dashboard');
        w.switchView('settings');
        assert.equal(d.getElementById('smtpHost').value,'smtp.unsaved.invalid','main navigation must retain the unsaved SMTP draft');
        w.eval('settingsFormDirty=false');
        assert.equal(w.setSettingsCategory('about'),true,'a clean form can still leave the email category');
    }finally{dom.window.close();}
});
test('switching theme preserves an unsaved login subtitle on the general settings page',()=>{
    const {dom,w,d}=setup();
    try{
        const input=d.getElementById('loginSubtitleInput');
        input.value='尚未保存的副标题';
        input.dispatchEvent(new w.Event('input',{bubbles:true}));
        w.markSettingsFormDirty();
        w.setTheme('dark');
        assert.equal(d.documentElement.dataset.theme,'dark');
        assert.equal(d.getElementById('loginSubtitleInput').value,'尚未保存的副标题');
        assert.equal(w.eval('systemSettings.login_subtitle'),'已保存副标题','changing theme must not save unrelated input');
    }finally{dom.window.close();}
});
test('simultaneous procurement-board loads coalesce an empty project-list request',async()=>{
    const {dom,w}=setup();
    try{
        let requests=0,renders=0,release;
        const gate=new Promise(resolve=>release=resolve);
        w.api=async(method,url)=>{
            assert.equal(method,'GET');assert.equal(url,'/api/projects');
            requests++;await gate;return [];
        };
        w.renderProcureBoard=()=>renders++;
        const pending=[w.loadProcureBoard(),w.loadProcureBoard(),w.loadProcureBoard()];
        const observedRequests=requests;
        release();await Promise.all(pending);
        assert.equal(observedRequests,1,'concurrent board loads share the in-flight list request');
        assert.equal(renders,1,'a shared response commits the board once');
    }finally{dom.window.close();}
});
test('saving reminder settings retains later edits and clears only the submitted password',async()=>{
    const {dom,w,d}=setup();
    try{
        w.setSettingsCategory('email');
        let release,payload;
        const gate=new Promise(resolve=>release=resolve);
        let stored={smtp_host:'smtp.saved.invalid',smtp_password_configured:true};
        w.api=async(method,_url,body)=>{
            if(method==='PATCH'){
                payload=structuredClone(body);await gate;
                stored={...stored,...body};delete stored.smtp_password;
                return {settings:stored};
            }
            return stored;
        };
        d.getElementById('smtpHost').value='smtp.submitted.invalid';
        d.getElementById('smtpPassword').value='isolated-submitted-password';
        const button=d.querySelector('[onclick="saveReminderSettings(this)"]');
        const pending=w.saveReminderSettings(button);
        d.getElementById('smtpHost').value='smtp.edited-during-save.invalid';w.markSettingsFormDirty();
        release();await pending;
        assert.equal(payload.smtp_host,'smtp.submitted.invalid');
        assert.equal(d.getElementById('smtpHost').value,'smtp.edited-during-save.invalid');
        assert.equal(w.eval('settingsFormDirty'),true);
        assert.equal(button.disabled,false,'a retained draft can be saved again');
        assert.equal(d.getElementById('smtpPassword').value,'','an accepted password is not resubmitted with later edits');
    }finally{dom.window.close();}
});
test('a failed uncached settings refresh preserves an email draft',async()=>{
    const {dom,w,d}=setup();
    try{
        w.setSettingsCategory('email');
        d.getElementById('smtpHost').value='smtp.unsaved.invalid';w.markSettingsFormDirty();
        w.invalidateViewCache('settings');
        w.api=async()=>{throw new Error('isolated offline refresh');};
        w.console.error=()=>{};
        await w.loadSettingsView({force:true});
        assert.equal(d.getElementById('smtpHost')?.value,'smtp.unsaved.invalid');
        assert.equal(w.eval('settingsFormDirty'),true);
    }finally{dom.window.close();}
});
test('device-panel polling stops on main navigation and restarts on return without stopping summary polling',()=>{
    const {dom,w}=setup();
    try{
        const timers=new Map();let nextId=1,loads=0;
        w.eval('startDeviceAdmissionPanelPolling=originalStartDeviceAdmissionPanelPolling;stopDeviceAdmissionPanelPolling=originalStopDeviceAdmissionPanelPolling;');
        w.setInterval=fn=>{const id=nextId++;timers.set(id,fn);return id;};
        w.clearInterval=id=>timers.delete(id);
        w.loadDeviceAdmissionPanel=()=>loads++;
        w.setSettingsCategory('device-access');
        assert.equal(timers.size,1);assert.equal(loads,1);
        w.eval('deviceAdmissionState.summaryTimer=9876');
        w.switchView('dashboard');
        assert.equal(timers.size,0,'hidden detail panel must stop its timer');
        assert.equal(w.eval('deviceAdmissionState.summaryTimer'),9876,'global pending-device summaries stay active');
        w.switchView('settings');
        assert.equal(timers.size,1);assert.equal(loads,2,'returning to the selected device category resumes its refresh');
    }finally{dom.window.close();}
});
test('a late device-panel response cannot replace its host after leaving settings',async()=>{
    const {dom,w,d}=setup();
    try{
        let release;const gate=new Promise(resolve=>release=resolve);
        w.api=async()=>{await gate;return {};};
        w.setSettingsCategory('device-access');
        const pending=w.loadDeviceAdmissionPanel();
        const host=d.getElementById('deviceAdmissionPanelHost');
        w.switchView('dashboard');host.innerHTML='<p>retained panel content</p>';
        release();await pending;
        assert.equal(host.textContent,'retained panel content');
    }finally{dom.window.close();}
});
test('an unsaved login subtitle blocks category changes without discarding input',()=>{
    const {dom,w,d}=setup();
    try{
        const input=d.getElementById('loginSubtitleInput');input.value='分类切换前的草稿';
        w.markSettingsFormDirty({target:input});
        assert.equal(w.setSettingsCategory('about'),false);
        assert.equal(d.getElementById('loginSubtitleInput').value,'分类切换前的草稿');
        assert.equal(w.getActiveSettingsCategory(),'general');
    }finally{dom.window.close();}
});
for(const [selector,apply] of [
    ['[onchange="setCompactMode(this.checked)"]',w=>w.setCompactMode(true)],
    ['[onchange="setPreviewMode(this.checked)"]',w=>w.setPreviewMode(false)],
    ['#defaultExportYear',w=>w.setDefaultExportYear('')],
]){
    test('an immediate local preference does not block category navigation: '+selector,()=>{
        const {dom,w,d}=setup();
        try{
            const input=d.querySelector(selector);apply(w);
            w.markSettingsFormDirty({target:input});
            assert.equal(w.eval('settingsFormDirty'),false);
            assert.equal(w.setSettingsCategory('about'),true);
        }finally{dom.window.close();}
    });
}
test('changing an immediate preference does not clear a previously edited subtitle',()=>{
    const {dom,w,d}=setup();
    try{
        const subtitle=d.getElementById('loginSubtitleInput');subtitle.value='仍需保存';w.markSettingsFormDirty({target:subtitle});
        const compact=d.querySelector('[onchange="setCompactMode(this.checked)"]');
        w.setCompactMode(true);w.markSettingsFormDirty({target:compact});
        assert.equal(w.eval('settingsFormDirty'),true);
        assert.equal(w.setSettingsCategory('about'),false);
        assert.equal(d.getElementById('loginSubtitleInput').value,'仍需保存');
    }finally{dom.window.close();}
});
for(const [category,selector] of [['files','#exportFolderInput'],['workflow','[data-supplier-minimum]']]){
    test('unsaved fields block navigation from '+category,()=>{
        const {dom,w,d}=setup();
        try{
            w.setSettingsCategory(category);
            const input=d.querySelector(selector);input.value=category==='files'?'E:/isolated-draft':'4';
            const expected=input.value;w.markSettingsFormDirty({target:input});
            assert.equal(w.setSettingsCategory('about'),false);
            assert.equal(d.querySelector(selector).value,expected);
        }finally{dom.window.close();}
    });
}
test('workflow template edits block navigation until their own save completes',async()=>{
    const {dom,w,d}=setup();
    try{
        w.eval('systemSettings.stage_templates=defaultClientStageTemplates()');
        w.setSettingsCategory('workflow');
        w.eval('toggleStageTemplateExpanded(getCurrentStageTemplateDraft()[0].id)');
        const input=d.querySelector('[data-stage-template-field="name"]');input.value='待保存阶段';
        w.handleStageTemplateField({currentTarget:input});w.markSettingsFormDirty({target:input});
        assert.equal(w.setSettingsCategory('about'),false);
        assert.equal(await w.saveStageTemplates(),true);
        assert.equal(w.setSettingsCategory('about'),true,'saving the tracked template draft releases navigation');
    }finally{dom.window.close();}
});
for(const mode of ['cached','refresh','offline']){
    test('workflow template draft survives main navigation and '+mode+' loading',async()=>{
        const {dom,w,d}=setup();
        try{
            w.eval('systemSettings.stage_templates=defaultClientStageTemplates()');
            w.setSettingsCategory('workflow');w.eval('toggleStageTemplateExpanded(getCurrentStageTemplateDraft()[0].id)');
            const input=d.querySelector('[data-stage-template-field="name"]');input.value='阶段草稿';
            w.handleStageTemplateField({currentTarget:input});w.markSettingsFormDirty({target:input});
            input.value='输入法仍在编辑的阶段草稿';
            w.switchView('dashboard');
            if(mode!=='cached')w.invalidateViewCache('settings');
            if(mode==='offline'){w.api=async()=>{throw Error('isolated offline');};w.console.error=()=>{};}
            w.switchView('settings');await w.loadSettingsView({force:mode!=='cached'});
            assert.equal(d.querySelector('[data-stage-template-field="name"]'),input,'a pending draft must keep its live editor');
            assert.equal(input.value,'输入法仍在编辑的阶段草稿');
            assert.equal(w.eval('stageTemplateDirty'),true);
        }finally{dom.window.close();}
    });
}
test('legacy workflow-order draft survives main navigation without remounting its editor',()=>{
    const {dom,w,d}=setup();
    try{
        w.setSettingsCategory('workflow');w.eval('moveStageOrder(STAGES[0].key,1)');
        const editor=d.getElementById('stageOrderCardHost').firstElementChild;
        w.switchView('dashboard');w.switchView('settings');
        assert.equal(d.getElementById('stageOrderCardHost').firstElementChild,editor);
        assert.equal(w.eval('stageOrderDirty'),true);
    }finally{dom.window.close();}
});
function mockSettingsStorage(w){
    const stored=JSON.parse(w.eval('JSON.stringify(systemSettings)'));
    w.api=async(method,url,body)=>{
        if(url==='/api/system-info')return {is_desktop:true,license:{}};
        if(url==='/api/settings/upload-limit'){stored.max_file_size_mb=body.max_file_size_mb;return {max_file_size_mb:body.max_file_size_mb};}
        if(method==='GET')return {...stored};
        Object.assign(stored,body);return {settings:{...stored}};
    };
    return stored;
}
for(const action of ['upload','folder','recovery']){
    test('saving one files card preserves unsaved sibling fields: '+action,async()=>{
        const {dom,w,d}=setup();
        try{
            w.setSettingsCategory('files');mockSettingsStorage(w);
            const folder=d.getElementById('exportFolderInput'),limit=d.getElementById('attachmentUploadLimitInput');
            folder.value='E:/isolated-folder-draft';limit.value='512';
            w.markSettingsFormDirty({target:folder});w.markSettingsFormDirty({target:limit});
            if(action==='upload')await w.saveAttachmentUploadLimit();
            if(action==='folder')await w.saveExportFolder();
            if(action==='recovery'){
                d.getElementById('dataRecoveryKeyInput').value='isolated-recovery-key';
                await w.bindDataRecoveryKey();
                assert.equal(d.getElementById('dataRecoveryKeyInput').value,'');
            }
            assert.equal(d.getElementById('exportFolderInput'),folder);
            assert.equal(folder.value,'E:/isolated-folder-draft');
            assert.equal(d.getElementById('attachmentUploadLimitInput'),limit);
            assert.equal(limit.value,'512');
            assert.equal(w.eval('settingsFormDirty'),true);
            assert.equal(w.setSettingsCategory('about'),false);
        }finally{dom.window.close();}
    });
}
test('saving a subtitle retains changes typed while that save is pending',async()=>{
    const {dom,w,d}=setup();
    try{
        let release;const gate=new Promise(resolve=>release=resolve);let stored;
        w.api=async(method,_url,body)=>{if(method==='PATCH'){stored=body;await gate;return {settings:stored};}return stored;};
        const input=d.getElementById('loginSubtitleInput');input.value='已提交副标题';w.markSettingsFormDirty({target:input});
        const pending=w.saveLoginSubtitle();input.value='保存期间的新副标题';w.markSettingsFormDirty({target:input});
        release();await pending;
        assert.equal(d.getElementById('loginSubtitleInput'),input);
        assert.equal(input.value,'保存期间的新副标题');
        assert.equal(w.eval('settingsFormDirty'),true);
    }finally{dom.window.close();}
});
test('saving supplier minimums retains an actively edited workflow template',async()=>{
    const {dom,w,d}=setup();
    try{
        w.eval('systemSettings.stage_templates=defaultClientStageTemplates()');w.setSettingsCategory('workflow');
        w.eval('toggleStageTemplateExpanded(getCurrentStageTemplateDraft()[0].id)');
        const input=d.querySelector('[data-stage-template-field="name"]');input.value='待保存阶段';w.handleStageTemplateField({currentTarget:input});
        input.value='仍在输入的阶段';
        const minimum=d.querySelector('[data-supplier-minimum]');minimum.value='4';w.markSettingsFormDirty({target:minimum});mockSettingsStorage(w);
        await w.saveSupplierMinimumSettings();
        assert.equal(d.querySelector('[data-stage-template-field="name"]'),input);
        assert.equal(input.value,'仍在输入的阶段');
        assert.equal(w.eval('stageTemplateDirty'),true);
        assert.equal(w.setSettingsCategory('about'),false);
    }finally{dom.window.close();}
});
test('saving legacy workflow order preserves an unsaved supplier minimum',async()=>{
    const {dom,w,d}=setup();
    try{
        w.setSettingsCategory('workflow');mockSettingsStorage(w);w.refreshStageOrderConsumers=async()=>{};
        w.eval('moveStageOrder(STAGES[0].key,1)');
        const input=d.querySelector('[data-supplier-minimum]');input.value='4';w.markSettingsFormDirty({target:input});
        await w.saveStageOrder();
        assert.equal(d.querySelector('[data-supplier-minimum]'),input);
        assert.equal(input.value,'4');
        assert.equal(w.setSettingsCategory('about'),false);
    }finally{dom.window.close();}
});
test('saving the remaining files draft clears its guard after a sibling was saved',async()=>{
    const {dom,w,d}=setup();
    try{
        w.setSettingsCategory('files');mockSettingsStorage(w);
        const folder=d.getElementById('exportFolderInput'),limit=d.getElementById('attachmentUploadLimitInput');
        folder.value='E:/isolated-folder-draft';limit.value='512';
        w.markSettingsFormDirty({target:folder});w.markSettingsFormDirty({target:limit});
        await w.saveAttachmentUploadLimit();await w.saveExportFolder();
        assert.equal(w.eval('settingsFormDirty'),false);
        assert.equal(w.setSettingsCategory('about'),true);
    }finally{dom.window.close();}
});
test('programmatic export-folder presets retain their draft across navigation',()=>{
    const {dom,w,d}=setup();
    try{
        w.eval("systemSettings.program_export_folder='E:/program-exports';systemSettings.export_folder='E:/existing-exports'");
        w.setSettingsCategory('files');w.setExportFolderPreset('program');
        const input=d.getElementById('exportFolderInput');
        assert.equal(input.value,'E:/program-exports');
        assert.equal(w.eval('settingsFormDirty'),true);
        assert.equal(w.setSettingsCategory('about'),false);
        assert.equal(w.setSettingsCategory('files'),true);
        w.switchView('dashboard');w.switchView('settings');
        assert.equal(d.getElementById('exportFolderInput'),input);
        assert.equal(input.value,'E:/program-exports');
    }finally{dom.window.close();}
});
test('legacy workflow-order save retains sorting changes made while it is pending',async()=>{
    const {dom,w}=setup();
    try{
        w.setSettingsCategory('workflow');w.refreshStageOrderConsumers=async()=>{};
        let release;const gate=new Promise(resolve=>release=resolve);
        w.api=async(_method,_url,body)=>{await gate;return {settings:{stage_order:body.stage_order}};};
        w.eval('moveStageOrder(STAGES[0].key,1)');const pending=w.saveStageOrder();
        w.eval('moveStageOrder(STAGES[1].key,1)');const draft=w.eval('JSON.stringify(stageOrderDraft)');
        release();await pending;
        assert.equal(w.eval('JSON.stringify(stageOrderDraft)'),draft);
        assert.equal(w.eval('stageOrderDirty'),true);
        assert.equal(w.setSettingsCategory('about'),false);
    }finally{dom.window.close();}
});
for(const [category,selector,value,nextValue,save] of [
    ['files','#attachmentUploadLimitInput','512','513',w=>w.saveAttachmentUploadLimit()],
    ['files','#exportFolderInput','E:/submitted','E:/new-draft',w=>w.saveExportFolder()],
    ['workflow','[data-supplier-minimum]','4','5',w=>w.saveSupplierMinimumSettings()],
]){
    test('save response retains newer input in '+selector,async()=>{
        const {dom,w,d}=setup();
        try{
            w.setSettingsCategory(category);mockSettingsStorage(w);
            let release;const gate=new Promise(resolve=>release=resolve),original=w.api;
            w.api=async(...args)=>{if(args[0]!=='GET')await gate;return original(...args);};
            const input=d.querySelector(selector);input.value=value;w.markSettingsFormDirty({target:input});
            const pending=save(w);input.value=nextValue;w.markSettingsFormDirty({target:input});
            release();await pending;
            assert.equal(d.querySelector(selector),input);assert.equal(input.value,nextValue);
            assert.equal(w.eval('settingsFormDirty'),true);
        }finally{dom.window.close();}
    });
}
for(const [category,selector,save] of [
    ['email','#smtpPassword',w=>w.saveReminderSettings()],
    ['files','#dataRecoveryKeyInput',w=>w.bindDataRecoveryKey()],
]){
    test('accepted secret submission does not clear a different secret typed while pending: '+selector,async()=>{
        const {dom,w,d}=setup();
        try{
            w.setSettingsCategory(category);mockSettingsStorage(w);
            let release;const gate=new Promise(resolve=>release=resolve),original=w.api;
            w.api=async(...args)=>{if(args[0]!=='GET')await gate;return original(...args);};
            const input=d.querySelector(selector);input.value='isolated-submitted-secret';w.markSettingsFormDirty({target:input});
            const pending=save(w);input.value='isolated-newer-secret';w.markSettingsFormDirty({target:input});
            release();await pending;
            assert.equal(d.querySelector(selector),input);assert.equal(input.value,'isolated-newer-secret');
            assert.equal(w.eval('settingsFormDirty'),true);
        }finally{dom.window.close();}
    });
}
