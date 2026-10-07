const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const assets=path.resolve(process.env.PM_UI_ASSETS || '_build/ui-assets'),out=path.resolve(process.env.PM_UI_OUTPUT || '_build/ui-improvements');fs.mkdirSync(out,{recursive:true});
let html=fs.readFileSync(path.join(assets,'templates/workspace.html'),'utf8').replace(/{{ current_user_id \| tojson }}/g,'1').replace(/{{ current_username \| tojson }}/g,'"review"').replace(/{{ current_is_admin \| tojson }}/g,'true').replace(/{{ csrf_token \| tojson }}/g,'"review"');
const keys=['plan_received','doc_prepare','doc_review','doc_finalized','agreement_signed','announcement','registration_end','bid_opening','evaluation','result_announced','winning_notice','service_fee','deposit_refund','archived'];
const names=['计划接收','文件编制','文件审核','文件定稿','委托协议签定','公告发布','报名截止','开标','评标','结果公示','中标通知书','服务费到账','保证金退还','资料整理归档'];
const methods=['公开招标','竞争性磋商','竞争性谈判','邀请招标','网上竞价','单一来源','遴选','直选'];
const projects=Array.from({length:16},(_,i)=>({id:i+1,number:`PRJ-2026-${String(i+1).padStart(3,'0')}`,name:['市民服务中心办公设备与配套设施采购项目','社区公共卫生服务能力提升项目','学校智慧教学平台及网络改造服务项目'][i%3],year:2026,purchaser:'实验学校',method:methods[i%8],budget:'100万元',progress:Math.round((i%5)/14*100),current_stage_key:keys[i%5],current_stage_name:names[i%5],stages:keys.map((k,n)=>({key:k,name:names[n],completed:n<i%5,skipped:false,planned_at:`2026-09-${String(10+n).padStart(2,'0')}T09:30:00`,checklist:[]})),lots:[],suppliers:[],attachments:[],activity:[]}));
(async()=>{
const b=await chromium.launch({headless:true,executablePath:process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});try{
const p=await b.newPage({viewport:{width:1366,height:768}});const errors=[],requests=[];p.on('pageerror',e=>errors.push(String(e)));
await p.route('**/*',async r=>{const u=new URL(r.request().url()),q=u.pathname;requests.push(q);if(q.startsWith('/static/')){let f=path.join(assets,q);return fs.existsSync(f)?r.fulfill({path:f}):r.fulfill({status:404,body:''});}if(!q.startsWith('/api/'))return r.fulfill({contentType:'text/html',body:html});let data={};if(q==='/api/projects')data=projects;else if(/^\/api\/projects\/\d+$/.test(q))data=projects[+q.split('/').pop()-1];else if(q==='/api/stats')data={total:16,in_progress:16,completed:0,liubiao:0,feibiao:0};else if(q==='/api/system-info')data={version:'v5.8.12',license:{},is_admin:true,is_desktop:true,export_dir:'C:/ProcurementProjectManager/exports',data_dir:'C:/ProcurementProjectManager',backup_dir:'C:/ProcurementProjectManager/backups'};else if(q==='/api/settings')data={categories:[],units:[],groups:[{name:'教育单位',color:'#2563eb',units:[{name:'实验学校',project_count:16,project_ids:projects.map(p=>p.id),recent_project:projects[0].name}]}],is_admin:true,reminder_recipient_groups:[],supplier_minimums:{}};else if(q==='/api/calendar')data={weekday_names:['一','二','三','四','五','六','日'],cells:Array.from({length:35},(_,i)=>i===0||i>new Date(+u.searchParams.get('year'),+u.searchParams.get('month'),0).getDate()?{empty:true}:{day:i,date_str:u.searchParams.get('year')+'-'+u.searchParams.get('month').padStart(2,'0')+'-'+String(i).padStart(2,'0'),events:i%3?[]:[{project_id:1,project_name:projects[0].name,stage_name:'开标评标',planned_time:'09:30',icon:'📌'}]})};return r.fulfill({json:data});});
projects[0].lots=[{id:1,lot_number:'包1',lot_name:'信息设备采购',budget:120000},{id:2,lot_number:'包2',lot_name:'运行维护服务',budget:80000}];projects[0].registrations=[{id:1,lot_id:1,company_name:'示例供应商',bidder_type:'standalone',registration_method:'线上报名',manager_phone:'13800000000'}];
await p.goto('http://127.0.0.1:59998/',{waitUntil:'networkidle'});await p.waitForTimeout(600);

const checks=[];
let failVenueSave=false;
await p.route('**/api/projects/1/stages/*',async route=>{
    if(route.request().method()!=='PUT')return route.fallback();
    if(failVenueSave)return route.fulfill({status:500,json:{error:'模拟保存失败'}});
    const key=decodeURIComponent(new URL(route.request().url()).pathname.split('/').pop());
    const stage=projects[0].stages.find(s=>s.key===key);
    Object.assign(stage,route.request().postDataJSON());
    return route.fulfill({json:projects[0]});
});
async function check(name,fn){try{await fn();checks.push({name,passed:true});}catch(e){checks.push({name,passed:false,error:String(e)});}finally{await p.evaluate(()=>{closeCommandPalette();closeModal();closeRecipientGroupDrawer();});}}
await p.evaluate(()=>selectProject(1));
await check('fresh dialog resets scroll',async()=>{await p.evaluate(()=>showNewProjectModal());await p.waitForTimeout(350);await p.locator('#modalBody').evaluate(e=>e.scrollTop=e.scrollHeight);await p.evaluate(()=>closeModal());await p.waitForTimeout(350);await p.evaluate(()=>showRegistrationForm());await p.waitForTimeout(350);assert.equal(await p.locator('#modalBody').evaluate(e=>e.scrollTop),0);});
await check('keyboard enters dialog and Tab remains inside',async()=>{await p.locator('#sidebarNewProjectBtn').focus();await p.keyboard.press('Enter');await p.waitForTimeout(350);assert.equal(await p.evaluate(()=>document.activeElement.id),'npNumber');for(let i=0;i<28;i++){await p.keyboard.press(i%2?'Shift+Tab':'Tab');assert.ok(await p.evaluate(()=>!!document.activeElement.closest('#modal')));}await p.locator('#sidebarNewProjectBtn').evaluate(e=>e.focus());assert.ok(await p.evaluate(()=>!!document.activeElement.closest('#modal')));});
await check('closing restores trigger focus',async()=>{await p.locator('#sidebarNewProjectBtn').focus();await p.keyboard.press('Enter');await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>document.activeElement.id),'sidebarNewProjectBtn');});
await check('visible keyboard focus on toggle',async()=>{await p.evaluate(()=>showNewProjectModal());await p.locator('#npYear').focus();await p.keyboard.press('Tab');const v=await p.locator('#npNoDeposit').evaluate(e=>({focused:e.matches(':focus-visible'),style:getComputedStyle(e.nextElementSibling).outlineStyle,width:getComputedStyle(e.nextElementSibling).outlineWidth}));assert.ok(v.focused);assert.equal(v.style,'solid');assert.ok(parseFloat(v.width)>=2);});
await check('Escape closes only recipient drawer above modal',async()=>{await p.evaluate(()=>{showNewProjectModal();openRecipientGroupDrawer(null);});await p.keyboard.press('Escape');assert.equal(await p.locator('#recipientGroupDrawerOverlay').count(),0);assert.equal(await p.locator('#modal.open').count(),1);assert.ok(await p.evaluate(()=>!!document.activeElement.closest('#modal')));});
await check('command palette closes before underlying form',async()=>{await p.evaluate(()=>showNewProjectModal());await p.keyboard.press('Control+k');assert.equal(await p.evaluate(()=>document.activeElement.id),'commandPaletteInput');await p.keyboard.press('Escape');assert.equal(await p.locator('#modal.open').count(),1);assert.ok(await p.evaluate(()=>!!document.activeElement.closest('#modal')));});
await check('nested confirmation cancels without closing underlying modal',async()=>{await p.evaluate(()=>{showNewProjectModal();window.confirmResult=null;confirmDialog('测试确认','仅测试').then(r=>window.confirmResult=r);});await p.waitForTimeout(300);assert.ok(await p.evaluate(()=>!!document.activeElement.closest('#confirmDialog')));await p.keyboard.press('Escape');assert.equal(await p.evaluate(()=>window.confirmResult),false);assert.equal(await p.locator('#modal.open').count(),1);assert.ok(await p.evaluate(()=>!!document.activeElement.closest('#modal')));});
await check('nested reason dialog accepts typing and restores form focus',async()=>{await p.evaluate(()=>{showNewProjectModal();window.reasonResult=null;reasonDialog('测试原因','原因','请输入').then(r=>window.reasonResult=r);});await p.waitForTimeout(300);assert.equal(await p.evaluate(()=>document.activeElement.id),'reasonInput');await p.keyboard.type('review reason');await p.locator('#reasonOk').click();assert.deepEqual(await p.evaluate(()=>window.reasonResult),{ok:true,value:'review reason'});assert.equal(await p.locator('#modal.open').count(),1);assert.ok(await p.evaluate(()=>!!document.activeElement.closest('#modal')));});
await check('global shortcuts cannot save background or replace a dialog draft',async()=>{await p.setViewportSize({width:1366,height:768});await p.evaluate(()=>{switchProjectTab('info');showNewProjectModal();window.backgroundSaves=0;window.saveProjectInfo=()=>window.backgroundSaves++;});await p.locator('#npName').fill('未保存草稿');await p.keyboard.press('Control+s');assert.equal(await p.evaluate(()=>window.backgroundSaves),0);await p.keyboard.press('Control+n');assert.equal(await p.locator('#npName').inputValue(),'未保存草稿');});
await check('Ctrl+E retains explicit inline form submit actions',async()=>{for(const spec of [{open:'editCurrentProject',save:'saveEditProject',args:[]},{open:'batchSetPlannedDate',save:'doBatchSetDateV2',args:[]},{open:'completeStage',save:'doCompleteStage',args:['plan_received']},{open:'openChangePassword',save:'submitChangePassword',args:[]},{open:'showUserForm',save:'saveUser',args:[0]}]){await p.evaluate(spec=>{showNewProjectModal();window.inlineSubmits=[];window[spec.save]=()=>window.inlineSubmits.push(spec.save);window[spec.open](...spec.args);},spec);await p.keyboard.press('Control+e');assert.deepEqual(await p.evaluate(()=>window.inlineSubmits),[spec.save],spec.open);await p.evaluate(()=>closeModal());}});
await check('action summary readable at all responsive breakpoints',async()=>{for(const width of [1366,1120,1024,900,768,760,390]){await p.setViewportSize({width,height:844});const v=await p.locator('.project-command-now strong').evaluate(e=>({width:e.clientWidth,content:e.scrollWidth}));assert.ok(v.width>=v.content && v.width>40,JSON.stringify({width,...v}));}});
await check('dark procurement draft uses themed surface',async()=>{await p.evaluate(()=>{applyTheme('dark');showNewProjectModal();document.getElementById('npMultiPack').checked=true;toggleMultiPack();document.getElementById('packName').value='信息设备采购';addPackItem();});const v=await p.locator('#packList > div').evaluate(e=>({bg:getComputedStyle(e).backgroundColor,color:getComputedStyle(e).color}));assert.notEqual(v.bg,'rgb(255, 255, 255)');assert.notEqual(v.bg,v.color);await p.locator('#modalBody').evaluate(e=>e.scrollTop=e.scrollHeight);await p.screenshot({path:path.join(out,'dark-pack.png')});});
await check('information form adapts from two columns to one',async()=>{await p.evaluate(()=>{applyTheme('default');switchProjectTab('info');});for(const width of [1366,390]){await p.setViewportSize({width,height:844});const v=await p.evaluate(()=>{const a=document.getElementById('infoNumber').getBoundingClientRect(),b=document.getElementById('infoPurchaser').getBoundingClientRect();return {a:{x:a.x,y:a.y},b:{x:b.x,y:b.y},overflow:document.documentElement.scrollWidth>innerWidth};});assert.equal(v.overflow,false);if(width===1366){assert.equal(v.a.y,v.b.y);assert.ok(v.b.x>v.a.x);}else{assert.equal(v.a.x,v.b.x);assert.ok(v.b.y>v.a.y);}await p.screenshot({path:path.join(out,'info-'+width+'.png')});}});
await check('calendar Today restores selected date and agenda from another day',async()=>{await p.evaluate(()=>{closeModal();switchView('calendar');});await p.waitForSelector('.calendar-cell.today');const today=await p.locator('.calendar-cell.today').getAttribute('data-calendar-date');await p.locator('button.calendar-cell:not(.today)').first().click();assert.notEqual(await p.locator('.calendar-cell.selected').getAttribute('data-calendar-date'),today);await p.locator('[onclick="goToday()"]').click();assert.equal(await p.locator('.calendar-cell.selected').getAttribute('data-calendar-date'),today);assert.equal(await p.locator('.calendar-cell.today').getAttribute('aria-pressed'),'true');assert.match(await p.locator('#calendarAgenda').innerText(),new RegExp(Number(today.slice(5,7))+'月'+Number(today.slice(8))+'日'));});
await check('calendar Today returns from another year with a cold cache',async()=>{await p.evaluate(()=>{calendarYear=2025;calendarMonth=12;calendarSelectedDate='2025-12-31';invalidateViewCache('calendar:');});await p.locator('[onclick="goToday()"]').click();await p.waitForSelector('.calendar-cell.today.selected');assert.equal(await p.locator('.calendar-cell.selected').count(),1);});
await check('opening and evaluation venues persist independently when reopened',async()=>{
    await p.setViewportSize({width:1366,height:768});
    await p.evaluate(async()=>{closeSlide();await selectProject(1);openStageSlide('bid_opening');});
    await p.locator('#stageOpeningLocation').fill('一楼开标室 <东侧>');
    await p.evaluate(()=>saveStageAndClose());
    await p.evaluate(()=>openStageSlide('evaluation'));
    assert.equal(await p.locator('#stageOpeningLocation').count(),0);
    await p.locator('#stageEvaluationLocation').fill('二楼评标室');
    await p.evaluate(()=>saveStageAndClose());
    await p.evaluate(()=>openStageSlide('bid_opening'));
    assert.equal(await p.locator('#stageOpeningLocation').inputValue(),'一楼开标室 <东侧>');
    await p.locator('#stageOpeningLocation').scrollIntoViewIfNeeded();
    await p.waitForTimeout(350);
    await p.screenshot({path:path.join(out,'opening-location.png')});
    await p.evaluate(()=>{closeSlide();openStageSlide('evaluation');});
    assert.equal(await p.locator('#stageEvaluationLocation').inputValue(),'二楼评标室');
    await p.setViewportSize({width:390,height:844});
    await p.locator('#stageEvaluationLocation').scrollIntoViewIfNeeded();
    await p.waitForTimeout(350);
    await p.screenshot({path:path.join(out,'evaluation-location-mobile.png')});
    await p.locator('#stageEvaluationLocation').fill('');
    await p.evaluate(()=>saveStageAndClose());
    await p.evaluate(()=>openStageSlide('evaluation'));
    assert.equal(await p.locator('#stageEvaluationLocation').inputValue(),'');
});
await check('failed venue save keeps the editor and draft',async()=>{
    await p.locator('#stageEvaluationLocation').fill('未保存地点');
    failVenueSave=true;
    try {await p.evaluate(()=>saveStageAndClose());assert.equal(await p.locator('#stageEvaluationLocation').inputValue(),'未保存地点');}
    finally {failVenueSave=false;await p.evaluate(()=>closeSlide());}
});
await check('online auction has separate result and notice modules at desktop and mobile widths',async()=>{
    projects[0].method='网上竞价';
    projects[0].stages.push({key:'after-quote',name:'中标结果',modules:['common','bid_results']});
    await p.evaluate(()=>{closeModal();currentProject.method='网上竞价';currentProject.stages.push({key:'after-quote',name:'中标结果',modules:['common','bid_results']});});
    for(const width of [1366,390]){
        await p.setViewportSize({width,height:844});
        await p.evaluate(()=>openStageSlide('after-quote'));
        assert.equal(await p.locator('[onclick="showBidResultForm()"]').count(),1);
        assert.equal(await p.locator('[onclick="showNoticeForm()"]').count(),0);
        assert.equal(await p.getByText('暂无成交结果',{exact:true}).count(),1);
        await p.locator('[onclick="showBidResultForm()"]').click();
        assert.equal(await p.locator('#bidSupplier').count(),1);
        await p.evaluate(()=>closeModal());
        assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
        await p.screenshot({path:path.join(out,'auction-result-'+width+'.png')});
    }
    await p.evaluate(()=>openStageSlide('winning_notice'));
    assert.equal(await p.locator('[onclick="showNoticeForm()"]').count(),1);
    assert.equal(await p.locator('[onclick="showBidResultForm()"]').count(),0);
    await p.evaluate(()=>closeSlide());
});
await check('stage settings expose a selectable standalone result module',async()=>{
    const catalog=JSON.parse(fs.readFileSync(path.join(assets,'stage-module-catalog.json'),'utf8'));
    await p.evaluate(catalog=>{
        systemSettings.stage_module_catalog=catalog;
        stageTemplateDirty=false;
        stageTemplateMethod='网上竞价';
        beginStageTemplateDraft(systemSettings);
        const row=stageTemplateDraft['网上竞价'][0];
        expandedStageTemplateIds.add(row.id);
        showModal('阶段模板',renderStageTemplateCard(systemSettings,true));
    },catalog);
    const checkbox=p.locator('[data-stage-template-module="bid_results"]').first();
    assert.match(await checkbox.locator('..').innerText(),/中标\/成交结果/);
    await checkbox.check();
    assert.equal(await p.evaluate(()=>stageTemplateDraft['网上竞价'][0].modules.includes('bid_results')),true);
    await p.evaluate(()=>closeModal());
});
await check('all procurement methods and configured modules render without template fragments',async()=>{
    const catalog=JSON.parse(fs.readFileSync(path.join(assets,'stage-module-catalog.json'),'utf8'));
    for(const method of methods){
        for(const module of catalog){
            await p.evaluate(({method,module})=>{
                currentProject.method=method;
                currentProject.stages=currentProject.stages.filter(s=>s.key!=='audit-custom');
                currentProject.stages.push({key:'audit-custom',name:'自定义阶段',modules:['common',module.id],checklist:[]});
                openStageSlide('audit-custom');
            },{method,module});
            const text=await p.locator('#slidePanel').innerText();
            assert.ok(!text.includes('${'),method+'/'+module.id);
            if(module.id==='winning_notice')assert.ok(text.includes(method==='网上竞价'?'暂无成交通知书':'暂无中标通知书'));
            if(module.id!=='deposit_refund')assert.ok(!text.includes('无需保证金'),method+'/'+module.id);
        }
    }
    await p.evaluate(()=>closeSlide());
});
await check('stage editor hides empty extras and keeps existing notes visible',async()=>{
    await p.evaluate(()=>{closeModal();closeSlide();currentProject.stages[0].notes='';openStageSlide(currentProject.stages[0].key);});
    assert.equal(await p.locator('.stage-editor-heading').count(),0);
    assert.equal(await p.locator('.stage-optional-notes').getAttribute('open'),null);
    await p.locator('.stage-optional-notes summary').click();
    assert.equal(await p.locator('#stageNotes').isVisible(),true);
    await p.evaluate(()=>{currentProject.stages[0].notes='已有备注保留';openStageSlide(currentProject.stages[0].key);});
    assert.equal(await p.locator('#stageNotes').isVisible(),true);
    assert.equal(await p.locator('#stageNotes').inputValue(),'已有备注保留');
    await p.evaluate(()=>closeSlide());
});
await check('publication links apply across methods and custom publication stages',async()=>{
    await p.evaluate(()=>{closeModal();closeSlide();currentProject.stages=currentProject.stages.filter(s=>s.key!=='audit-custom');currentProject.stages.push({key:'custom-publication',name:'候选人公示',modules:['common'],publication_url:'https://example.com/candidate'});});
    for(const method of methods){
        await p.evaluate(method=>{currentProject.method=method;openStageSlide('result_announced');},method);
        assert.equal(await p.locator('#stagePublicationUrl').count(),1,method);
        await p.evaluate(()=>openStageSlide('announcement'));
        assert.equal(await p.locator('#stagePublicationUrl').count(),1,method);
    }
    await p.evaluate(()=>openStageSlide('custom-publication'));
    assert.equal(await p.locator('#stagePublicationUrl').inputValue(),'https://example.com/candidate');
    await p.evaluate(()=>openStageSlide('plan_received'));
    assert.equal(await p.locator('#stagePublicationUrl').count(),0);
    await p.evaluate(()=>closeSlide());
});
await check('bidding fields live in original stage panels without duplicate workflow',async()=>{
    await p.evaluate(()=>document.querySelectorAll('.toast').forEach(el=>el.classList.remove('show')));
    const ledger={revision:1,data:{received:true,start_at:'2026-09-20T09:00',end_at:'2026-09-20T12:00',records:[{registration_id:1,review:'approved',amount:'123.45',quoted_at:'2026-09-20T10:00'}]},summary:{status:'待核对平台结果',verified:false,eligible:1,quoted:1,lots:[]},history:[]};
    await p.route('**/api/projects/1/online-bidding',r=>r.fulfill({json:ledger}));
    await p.evaluate(()=>{closeModal();closeSlide();currentProject.method='网上竞价';currentProject.online_bidding_enabled=true;currentProject.stages.push({key:'online_quotation',name:'一次报价竞价',modules:['common','online_bidding'],checklist:[]});});
    for(const theme of ['light','dark'])for(const width of [1366,390]){
        await p.setViewportSize({width,height:844});
        await p.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
        await p.evaluate(()=>openStageSlide('online_quotation'));
        await p.locator('[data-ob-amount]').waitFor();
        assert.equal(await p.locator('[data-ob-amount]').inputValue(),'123.45');
        assert.equal(await p.locator('#onlineBiddingForm').count(),0);
        assert.equal(await p.locator('[data-ob-review]').count(),0);
        assert.equal(await p.locator('#onlineBiddingInline').evaluate(el=>el.scrollWidth>el.clientWidth+2),false);
        await p.locator('#onlineBiddingInline').scrollIntoViewIfNeeded();
        assert.equal(await p.locator('#onlineBiddingInline .stage-business-card').count(),3);
        const bounds=await p.locator('#onlineBiddingInline input').evaluateAll(inputs=>inputs.map(el=>({width:el.getBoundingClientRect().width,parent:el.closest('.form-group').getBoundingClientRect().width})));
        assert.ok(bounds.every(b=>b.width<=b.parent+1));
        await p.screenshot({path:path.join(out,`inline-quotation-${theme}-${width}.png`)});
        await p.evaluate(()=>openStageSlide('registration_end'));
        await p.locator('[data-ob-review]').waitFor();
        assert.equal(await p.locator('[data-ob-amount]').count(),0);
        await p.screenshot({path:path.join(out,`inline-registration-${theme}-${width}.png`)});
        await p.evaluate(()=>closeSlide());
    }
    await p.evaluate(()=>openStageSlide('plan_received'));
    assert.equal(await p.locator('#onlineBiddingInline').count(),0);
    assert.equal(await p.evaluate(()=>typeof showOnlineBiddingLedger),'undefined');
    await p.evaluate(()=>{closeSlide();stageTemplateMethod='网上竞价';showModal('阶段模板',renderStageTemplateCard(systemSettings,true));});
    assert.equal(await p.getByRole('button',{name:'使用网上竞价九阶段方案',exact:true}).count(),0);
    assert.equal(await p.getByRole('button',{name:'恢复当前方式默认',exact:true}).count(),1);
    await p.evaluate(()=>closeModal());
});
await check('legacy synced bidding projects show no new required ledger fields',async()=>{
    await p.evaluate(()=>{closeModal();closeSlide();currentProject.online_bidding_enabled=false;currentProject.stages.forEach(s=>s.completed=true);});
    for(const key of ['online_quotation','registration_end','result_announced']){
        await p.evaluate(key=>openStageSlide(key),key);
        assert.equal(await p.locator('#onlineBiddingInline').count(),0);
        assert.equal(await p.locator('[data-ob-review]').count(),0);
    }
    await p.screenshot({path:path.join(out,'legacy-completed-no-new-fields.png')});
    await p.evaluate(()=>closeSlide());
});
await check('all settings categories fit desktop and narrow screens in both themes',async()=>{
    await p.evaluate(async()=>{closeSlide();closeModal();closeSidebar();currentIsAdmin=true;settingsFormDirty=false;switchView('settings');await loadSettingsView();systemSettings.stage_templates=defaultClientStageTemplates();});
    for(const theme of ['light','dark'])for(const width of [1366,390]){
        await p.setViewportSize({width,height:844});
        await p.evaluate(theme=>document.documentElement.setAttribute('data-theme',theme),theme);
        for(const category of ['general','workflow','email','files','system','device-access','about']){
            await p.evaluate(category=>{closeSidebar();setSettingsCategory(category);},category);
            assert.equal(await p.evaluate(()=>getActiveSettingsCategory()),category);
            assert.equal(await p.locator('#settingsContent').evaluate(el=>el.scrollWidth>el.clientWidth+2),false,`${theme}/${width}/${category}`);
            assert.ok(!(await p.locator('#settingsContent').innerText()).includes('${'));
        }
        await p.evaluate(()=>setSettingsCategory('workflow'));
        await p.screenshot({path:path.join(out,`audit-settings-${theme}-${width}.png`)});
    }
    await p.evaluate(()=>{setSettingsCategory('general');switchView('project');});
});
await check('settings API failure can be retried and exposes safe error details',async()=>{
    const fail=r=>r.fulfill({status:503,json:{error:'模拟设置不可用 <script>probe</script>'}});
    await p.route('**/api/settings',fail);
    await p.evaluate(async()=>{settingsFormDirty=false;invalidateViewCache('settings');switchView('settings');await loadSettingsView({force:true});});
    assert.equal(await p.locator('#settingsContent .ui-state-error').count(),1);
    await p.locator('#settingsContent summary').click();
    assert.match(await p.locator('#settingsContent').innerText(),/HTTP 503/);
    assert.equal(await p.locator('#settingsContent script').count(),0);
    await p.unroute('**/api/settings',fail);
    await p.locator('#settingsContent .ui-state-action').click();
    await p.locator('#settingsContent .ui-state-error').waitFor({state:'detached'});
    await p.locator('.settings-nav').waitFor({state:'attached'});
    assert.equal(await p.locator('#settingsContent .ui-state-error').count(),0);
});
await check('system-info failure leaves settings usable and retry recovers',async()=>{
    const fail=r=>r.fulfill({status:503,json:{error:'模拟本机信息读取失败'}});
    await p.route('**/api/system-info',fail);
    await p.evaluate(async()=>{systemInfo=null;invalidateViewCache('settings');await loadSettingsView({force:true});});
    assert.equal(await p.locator('#settingsContent .ui-state-warning').count(),1);
    await p.evaluate(()=>setSettingsCategory('workflow'));
    assert.ok((await p.locator('#settingsContent').innerText()).includes('项目流程'));
    await p.unroute('**/api/system-info',fail);
    await p.locator('#settingsContent .ui-state-action').click();
    await p.waitForFunction(()=>!systemInfo?._loadError);
    assert.equal(await p.locator('#settingsContent .ui-state-warning').count(),0);
});
await check('Excel preview stylesheet does not override error state colors',async()=>{
    await p.evaluate(()=>{const el=document.createElement('div');el.id='errorStyleProbe';el.innerHTML=uiStateMarkup('error','错误提示与重试');document.body.appendChild(el);});
    for(const theme of ['default','dark']){
        await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
        const colors=()=>p.locator('#errorStyleProbe .ui-state-error').evaluate(el=>({background:getComputedStyle(el).backgroundColor,color:getComputedStyle(el).color}));
        const before=await colors();
        const plugin=await p.addStyleTag({path:path.join(assets,'static/libs/luckysheet/plugins/plugins.css')});
        assert.deepEqual(await colors(),before);
        assert.equal(await p.locator('#errorStyleProbe p').evaluate(el=>getComputedStyle(el).color),before.color);
        await plugin.evaluate(el=>el.remove());
    }
    await p.evaluate(()=>document.getElementById('errorStyleProbe').remove());
});
await check('expanded stage notes and settings details adapt to every theme and width',async()=>{
    for(const theme of ['default','blue','green','dark'])for(const width of [390,1024,1366]){
        await p.setViewportSize({width,height:844});
        await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;closeModal();closeSlide();closeSidebar();switchView('project');currentProject.stages.find(s=>s.key==='plan_received').notes='';openStageSlide('plan_received');},theme);
        const detail=p.locator('.stage-optional-notes'),summary=detail.locator('summary');
        await summary.focus();await p.keyboard.press('Enter');
        assert.equal(await detail.evaluate(el=>el.open),true);
        assert.equal(await summary.evaluate(el=>getComputedStyle(el).outlineStyle),'solid');
        assert.equal(await detail.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        assert.ok(!(await p.locator('#slidePanel').evaluate(el=>getComputedStyle(el).backgroundColor)).startsWith('rgba'), 'editor background must be opaque');
        const box=await summary.boundingBox();assert.ok(box.height>=40);
        if(width===1024)await p.locator('#slidePanel').screenshot({path:path.join(out,`expanded-notes-${theme}.png`)});
        await summary.focus();await p.keyboard.press('Space');assert.equal(await detail.evaluate(el=>el.open),false);
        await p.evaluate(async()=>{closeSlide();settingsFormDirty=false;switchView('settings');await loadSettingsView();setSettingsCategory('files');});
        const technical=p.locator('.settings-details');await technical.locator('summary').click();
        assert.equal(await technical.evaluate(el=>el.open),true);
        assert.equal(await technical.evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        assert.equal(await p.locator('#settingsContent').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        if(width===1024)await technical.screenshot({path:path.join(out,`expanded-settings-${theme}.png`)});
    }
});
await check('nested migration and complaint expansions fit narrow layouts',async()=>{
    for(const theme of ['default','dark'])for(const width of [390,1024]){
        await p.setViewportSize({width,height:844});
        await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;deviceAdmissionState.keyring={ready:true};showModal('设备准入',renderDeviceAdmissionPanel());},theme);
        await p.locator('.device-migration-heading').click();
        await p.locator('.device-migration-advanced summary').click();
        assert.equal(await p.locator('.device-migration-advanced').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        assert.equal(await p.locator('#modalBody').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        await p.evaluate(()=>{closeModal();showModal('质疑事项','<div id="compIssues"></div>');addComplaintIssueRow({});});
        await p.locator('.complaint-editor-row summary').click();
        assert.equal(await p.locator('.complaint-editor-row details').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        assert.equal(await p.locator('#modalBody').evaluate(el=>el.scrollWidth>el.clientWidth+1),false);
        await p.evaluate(()=>closeModal());
    }
});
await check('native select options use theme colors and retain selection',async()=>{
    for(const theme of ['default','blue','green','dark']){
        await p.evaluate(theme=>{document.documentElement.dataset.theme=theme;showNewProjectModal();},theme);
        const select=p.locator('#modalBody select').first();
        const colors=await select.evaluate(el=>({option:getComputedStyle(el.options[0]).color,text:getComputedStyle(el).color,background:getComputedStyle(el.options[0]).backgroundColor,scheme:getComputedStyle(el).colorScheme}));
        assert.equal(colors.option,colors.text);assert.notEqual(colors.background,'rgba(0, 0, 0, 0)');
        assert.ok(!colors.background.startsWith('rgba'), 'native popup options must have opaque surfaces');
        assert.equal(colors.scheme,theme==='dark'?'dark':'light');
        const sidebarOption=await p.locator('.sidebar-method-filter option').first().evaluate(el=>getComputedStyle(el).backgroundColor);
        assert.ok(!sidebarOption.startsWith('rgba'), 'sidebar select options must also use solid surfaces');
        const value=await select.evaluate(el=>el.options[1]?.value || el.options[0].value);
        await select.selectOption(value);assert.equal(await select.inputValue(),value);
        await p.evaluate(()=>closeModal());
    }
});
await check('themed dropdown renders actual open options in four themes and narrow screens',async()=>{
    for(const theme of ['default','blue','green','dark'])for(const width of [390,1366]){
        await p.setViewportSize({width,height:844});
        await p.evaluate(theme=>{closeModal();closeSlide();applyTheme(theme);showNewProjectModal();},theme);
        const select=p.locator('#modal select').first();await select.click();
        const popup=p.locator('.themed-select-popup');await popup.waitFor();
        const state=await popup.evaluate(el=>{const r=el.getBoundingClientRect(),s=getComputedStyle(el);return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,radius:s.borderRadius,bg:s.backgroundColor};});
        assert.ok(state.left>=0 && state.right<=width && state.top>=0 && state.bottom<=844,JSON.stringify(state));assert.equal(state.radius,'10px');assert.ok(!state.bg.startsWith('rgba'));
        await p.screenshot({path:path.join(out,`select-popup-${theme}-${width}.png`)});
        await p.keyboard.press('Escape');assert.equal(await popup.count(),0);assert.equal(await p.locator('#modal.open').count(),1);
        await p.evaluate(()=>closeModal());
    }
});
await check('themed dropdown preserves events, disabled choices, keyboard and dynamic removal',async()=>{
    await p.evaluate(()=>{showModal('下拉检查','<label for="popupTest">采购方式</label><select id="popupTest"><option value="a">A</option><optgroup label="方式"><option disabled value="b">B</option><option value="c">C</option></optgroup></select><button id="popupNext">后续操作</button>');window.popupEvents=[];const s=document.getElementById('popupTest');for(const t of ['input','change'])s.addEventListener(t,()=>window.popupEvents.push(t));});
    const select=p.locator('#popupTest');await select.click();await p.keyboard.press('ArrowDown');await p.keyboard.press('Enter');
    assert.equal(await select.inputValue(),'c');assert.deepEqual(await p.evaluate(()=>window.popupEvents),['input','change']);
    await select.click();await p.locator('.themed-select-option[aria-selected="true"]').click();assert.deepEqual(await p.evaluate(()=>window.popupEvents),['input','change']);
    await select.focus();await p.keyboard.press('Space');await p.keyboard.press('Home');await p.keyboard.press('Escape');assert.equal(await select.inputValue(),'c');
    await select.click();await p.keyboard.press('PageUp');await p.keyboard.press('ArrowRight');assert.equal(await select.inputValue(),'c');await p.keyboard.press('Escape');assert.equal(await select.inputValue(),'c');
    await select.click();await p.keyboard.press('Home');await p.keyboard.press('Tab');assert.equal(await select.inputValue(),'a');
    await select.click();await p.keyboard.press('End');await p.keyboard.press('Tab');assert.equal(await select.inputValue(),'c');
    await select.click();await p.evaluate(()=>document.querySelector('#popupTest option[value="a"]').disabled=true);await p.waitForFunction(()=>!document.querySelector('.themed-select-popup'));assert.equal(await select.inputValue(),'c');
    await select.click();await p.keyboard.press('Tab');assert.equal(await p.locator('.themed-select-popup').count(),0);assert.equal(await p.evaluate(()=>document.activeElement.id),'popupNext');
    await select.click();await p.evaluate(()=>document.getElementById('popupTest').remove());await p.waitForFunction(()=>!document.querySelector('.themed-select-popup'));
    await p.evaluate(()=>closeModal());
});
await check('sidebar filter opens a themed popup and migration outer heading matches inner details',async()=>{
    await p.setViewportSize({width:1366,height:844});await p.evaluate(()=>{closeModal();applyTheme('dark');});
    await p.locator('.sidebar-method-filter').click();await p.locator('.themed-select-popup').waitFor();await p.screenshot({path:path.join(out,'sidebar-popup-dark.png')});await p.keyboard.press('Escape');
    await p.evaluate(async()=>{switchView('settings');await loadSettingsView();setSettingsCategory('device-access');});
    await p.locator('.device-migration-heading').waitFor();
    const heading=p.locator('.device-migration-heading');await heading.click();
    const expanded=await p.locator('.device-access-migration').getAttribute('open');if(expanded===null)await heading.click();
    assert.equal(await heading.evaluate(el=>getComputedStyle(el).borderBottomStyle),'solid');await p.locator('.device-migration-grid').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,'migration-expanded-dark.png')});
});
await check('procurement year popup fits right screen edge and changes filter',async()=>{
    await p.evaluate(()=>switchView('procure'));await p.locator('#procureBoardYearSelect').waitFor();
    await p.locator('#procureBoardYearSelect').click();await p.locator('.themed-select-popup').waitFor();
    const bounds=await p.locator('.themed-select-popup').boundingBox();assert.ok(bounds.x+bounds.width<=1366);
    await p.screenshot({path:path.join(out,'year-popup-dark.png')});
    await p.locator('.themed-select-option').last().click();assert.equal(await p.locator('.themed-select-popup').count(),0);
    assert.notEqual(await p.locator('#procureBoardYearSelect').inputValue(),'');
});
await check('purchaser workspace searches units and projects without losing focus or hiding counts',async()=>{
    await p.setViewportSize({width:1366,height:844});
    await p.evaluate(async()=>{
        closeSlide();switchView('purchasers');await loadPurchaserBoard(true);
        const education=Array.from({length:50},(_,i)=>({name:i===0?'东莞实验学校':'东莞市第'+String(i).padStart(2,'0')+'学校',project_count:16,project_ids:allProjects.map(p=>p.id),recent_project:'2026-09-30 12:00:00.123456'}));
        window.purchaserFixture={is_admin:true,unit_total:51,categories:[{id:1,name:'教育机构',color:'#2563eb'},{id:2,name:'金融机构',color:'#eab308'}],groups:[{name:'教育机构',category:{id:1,color:'#2563eb'},units:education},{name:'金融机构',category:{id:2,color:'#eab308'},units:[{name:'东莞农村商业银行股份有限公司',project_count:16,project_ids:allProjects.map(p=>p.id),recent_project:'2026-09-29'}]}]};
        renderPurchaserBoard(purchaserFixture);writeViewCache('purchaser-board',purchaserFixture);
    });
    await p.locator('#purchaserUnitQuery').fill('银行');assert.equal(await p.locator('.purchaser-directory-item').count(),1);assert.match(await p.locator('.purchaser-project-heading').innerText(),/商业银行/);
    assert.equal(await p.evaluate(()=>document.activeElement.id),'purchaserUnitQuery');
    await p.locator('#purchaserProjectQuery').fill('2026-003');assert.equal(await p.locator('.purchaser-project-row').count(),1);assert.equal(await p.evaluate(()=>document.activeElement.id),'purchaserProjectQuery');
    await p.locator('#purchaserProjectQuery').fill('找不到的项目');assert.equal(await p.locator('.purchaser-project-row').count(),0);
    await p.locator('#purchaserProjectResults button').click();assert.equal(await p.locator('.purchaser-project-row').count(),16);
    await p.locator('#purchaserUnitCategory').selectOption('1');assert.equal(await p.locator('.purchaser-directory-item').count(),0);assert.equal(await p.locator('.purchaser-project-row').count(),0);
    await p.locator('#purchaserUnitResults button').click();assert.equal(await p.locator('.purchaser-directory-item').count(),51);
});
await check('purchaser workspace keeps unit, conditions and both scroll positions on return',async()=>{
    await p.locator('#purchaserUnitQuery').fill('学校');
    const unit=p.locator('.purchaser-directory-item').nth(12);await unit.scrollIntoViewIfNeeded();const name=await unit.getAttribute('data-purchaser-name');await unit.click();
    await p.locator('#purchaserProjectQuery').fill('2026');await p.locator('#purchaserProjectResults').evaluate(el=>el.scrollTop=300);
    await p.waitForFunction(()=>purchaserWorkspace.projectScroll>0);
    const before=await p.evaluate(()=>({unit:purchaserWorkspace.selected,directory:purchaserWorkspace.directoryScroll,projects:purchaserWorkspace.projectScroll}));assert.ok(before.directory>0);assert.ok(before.projects>0);
    await p.locator('.purchaser-project-open').nth(5).click();await p.locator('#view-project.active').waitFor();
    await p.evaluate(async()=>{switchView('purchasers');await loadPurchaserBoard();});
    assert.equal(await p.locator('#purchaserUnitQuery').inputValue(),'学校');assert.equal(await p.locator('#purchaserProjectQuery').inputValue(),'2026');assert.match(await p.locator('.purchaser-project-heading').innerText(),new RegExp(name));
    const after=await p.evaluate(()=>({directory:document.getElementById('purchaserUnitResults').scrollTop,projects:document.getElementById('purchaserProjectResults').scrollTop}));assert.equal(after.directory,before.directory);assert.equal(after.projects,before.projects);
});
await check('purchaser workspace fits four themes at desktop and mobile widths',async()=>{
    await p.evaluate(()=>{clearPurchaserDirectoryFilters();clearPurchaserProjectFilters();});await p.waitForTimeout(3500);
    for(const theme of ['default','blue','green','dark'])for(const width of [1366,1024,390]){
        await p.setViewportSize({width,height:844});await p.evaluate(theme=>{applyTheme(theme);renderPurchaserBoard(purchaserFixture);},theme);
        const dimensions=await p.evaluate(()=>{const content=document.getElementById('purchaserBoardContent'),rows=document.querySelectorAll('.purchaser-project-row');return {page:document.documentElement.scrollWidth,view:content.scrollWidth,client:content.clientWidth,rowsFit:[...rows].every(el=>el.scrollWidth<=el.clientWidth+1),dirScroll:document.getElementById('purchaserUnitResults').scrollHeight>document.getElementById('purchaserUnitResults').clientHeight};});
        assert.ok(dimensions.page<=width && dimensions.view<=dimensions.client+1 && dimensions.rowsFit,JSON.stringify({width,...dimensions}));assert.ok(dimensions.dirScroll);
        await p.screenshot({path:path.join(out,`purchaser-workspace-${theme}-${width}.png`)});
        if(width===390){await p.locator('.purchaser-project-heading').scrollIntoViewIfNeeded();await p.screenshot({path:path.join(out,`purchaser-projects-${theme}-${width}.png`)});}
    }
});
await check('purchaser input composition and category management retain current selection',async()=>{
    await p.setViewportSize({width:1366,height:844});await p.evaluate(()=>{applyTheme('dark');clearPurchaserDirectoryFilters();});
    const input=p.locator('#purchaserUnitQuery');await input.focus();await input.evaluate(el=>{el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true}));el.value='银行';el.dispatchEvent(new InputEvent('input',{bubbles:true,isComposing:true}));el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'银行'}));});assert.equal(await input.inputValue(),'银行');assert.equal(await p.evaluate(()=>document.activeElement.id),'purchaserUnitQuery');
    await p.locator('#purchaserMoveCurrent').click();assert.match(await p.locator('#modalBody').innerText(),/商业银行/);await p.evaluate(()=>closeModal());
    await p.locator('.purchaser-directory-header .admin-control').click();assert.match(await p.locator('#modal').innerText(),/分类管理/);await p.evaluate(()=>closeModal());
});
await check('batch advance follows all themes and fits narrow screens',async()=>{
    await p.evaluate(()=>openBatchAdvanceDialog());
    for(const theme of ['default','blue','green','dark'])for(const width of [1366,1024,390]){
        await p.setViewportSize({width,height:768});await p.evaluate(theme=>applyTheme(theme),theme);
        const box=await p.locator('#batchAdvanceDialog').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=width && box.y+box.height<=768);
        assert.equal(await p.locator('#baModeStage').evaluate(el=>getComputedStyle(el).borderRadius),'7px');
        assert.equal(await p.locator('#batchAdvanceDialog > .batch-advance-footer').count(),1);
        await p.screenshot({path:path.join(out,`batch-advance-${theme}-${width}.png`)});
    }
});
await check('batch advance preserves selection, modes, focus and single footer on reopen',async()=>{
    await p.setViewportSize({width:1366,height:768});
    await p.locator('#baModeProject').click();assert.equal(await p.locator('#baModeProject').getAttribute('aria-pressed'),'true');
    await p.locator('#batchProjectSelect').selectOption('1');assert.ok(await p.locator('.ba-cb').count()>0);
    await p.evaluate(()=>batchAdvanceSelectNone());assert.equal(await p.locator('.ba-cb:checked').count(),0);
    await p.evaluate(()=>batchAdvanceSelectAll());assert.equal(await p.locator('.ba-cb:checked').count(),await p.locator('.ba-cb').count());
    await p.locator('#batchAdvanceOk').focus();await p.keyboard.press('Tab');assert.ok(await p.evaluate(()=>document.getElementById('batchAdvanceDialog').contains(document.activeElement)));
    await p.keyboard.press('Escape');assert.equal(await p.locator('#batchAdvanceDialog.open').count(),0);
    await p.evaluate(()=>{openBatchAdvanceDialog();closeBatchAdvanceDialog();openBatchAdvanceDialog();});
    assert.equal(await p.locator('.batch-advance-footer').count(),1);assert.equal(await p.locator('.batch-advance-close').count(),1);
    await p.locator('.batch-advance-close').click();assert.equal(await p.locator('#batchAdvanceDialog.open').count(),0);
});
await check('project information drafts survive project navigation and explicit discard',async()=>{
    await p.evaluate(async()=>{await selectProject(1);switchProjectTab('info');});
    const original=await p.locator('#infoName').inputValue();
    await p.locator('#infoName').fill('未保存草稿-统一验收');
    await p.evaluate(async()=>{await selectProject(2);switchProjectTab('info');});
    assert.notEqual(await p.locator('#infoName').inputValue(),'未保存草稿-统一验收');
    await p.evaluate(async()=>{await selectProject(1);switchProjectTab('info');});
    assert.equal(await p.locator('#infoName').inputValue(),'未保存草稿-统一验收');
    assert.equal(await p.locator('#infoDraftNotice').isVisible(),true);
    await p.locator('#infoDraftNotice button').click();assert.equal(await p.locator('#infoName').inputValue(),original);
    assert.equal(await p.locator('#infoDraftNotice').isVisible(),false);
});
await check('batch date filling keeps real datetime controls valid and preserves hours',async()=>{
    await p.evaluate(()=>batchSetPlannedDate());
    const timed=p.locator('#batchDateList input[type="datetime-local"]').first();assert.ok(await timed.count());
    await timed.fill('2026-10-01T10:45');await p.locator('#batchStartDate').fill('2026-10-03');
    await p.evaluate(()=>fillBatchDates());assert.match(await timed.inputValue(),/T10:45/);
    assert.equal(await p.locator('.bd-at').evaluateAll(items=>items.every(el=>el.value && el.checkValidity())),true);
    await p.evaluate(()=>closeModal());
});
await check('attachment preview traps keyboard and Escape preserves the underlying form',async()=>{
    await p.route('**/api/attachments/990/file*',r=>r.fulfill({contentType:'image/svg+xml',body:'<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="blue"/></svg>'}));
    await p.evaluate(()=>{showModal('下层草稿','<button id="previewFromModal">预览附件</button><input id="underlyingDraft" value="保留">');});
    await p.locator('#previewFromModal').focus();
    await p.evaluate(()=>openDocPreview({id:990,filename:'验收.svg'},'image',990));
    await p.waitForTimeout(400);assert.equal(await p.evaluate(()=>document.getElementById('docPreviewOverlay').contains(document.activeElement)),true);
    await p.keyboard.press('Tab');assert.equal(await p.evaluate(()=>document.getElementById('docPreviewOverlay').contains(document.activeElement)),true);
    await p.keyboard.press('Escape');assert.equal(await p.locator('#docPreviewOverlay.open').count(),0);
    assert.equal(await p.locator('#modal.open').count(),1);assert.equal(await p.locator('#underlyingDraft').inputValue(),'保留');assert.equal(await p.evaluate(()=>document.activeElement.id),'previewFromModal');
    await p.keyboard.press('Escape');assert.equal(await p.locator('#modal.open').count(),0);
});
fs.writeFileSync(path.join(out,'regression.json'),JSON.stringify({checks,errors},null,2));console.log(JSON.stringify({checks,errors}));if(checks.some(c=>!c.passed)||errors.length)process.exitCode=1;
}finally{await b.close();}})().catch(e=>{console.error(e);process.exitCode=1});
