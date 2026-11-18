const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');const {JSDOM}=require('jsdom');
function setup(seed={},broken=false){const dom=new JSDOM('<input id="loginSubtitleInput" value="未保存的副标题"><div id="uiPreferenceStatus"></div>',{url:'http://localhost',runScripts:'outside-only'});const w=dom.window;w.CURRENT_USER={id:1};for(const [k,v] of Object.entries(seed))w.localStorage.setItem(k,v);const media={matches:false,addEventListener(type,fn){this.fn=fn;}};w.matchMedia=()=>media;w.toast=()=>{};w.renderSidebar=()=>{};if(broken)Object.defineProperty(w,'localStorage',{value:{getItem(){throw Error('disabled')},setItem(){throw Error('disabled')}}});w.eval(fs.readFileSync('source/frontend/24-ui-preferences.js','utf8'));return {w,dom,media};}
test('migrates legacy preferences only once without sharing work preferences between accounts',()=>{const {w}=setup({pm_theme:'dark',pm_compact_mode:'1',pm_preview_in_app:'0',projectSidebarSortDirection:'desc',pm_default_export_year:'2025'});assert.equal(w.readUiPreferences().theme,'dark');assert.equal(w.readUiPreferences().compact,true);assert.equal(w.readUiPreferences().sort,'number_desc');assert.equal(w.readUiPreferences(2).compact,false);w.CURRENT_USER.id=2;w.updateUiPreference('home','calendar');assert.equal(w.readUiPreferences(1).home,'dashboard');assert.equal(w.localStorage.getItem('pm_default_export_year'),'2025');});
test('stored preferences persist across readers and reset touches only personal preference record',async()=>{const {w}=setup({mail_secret:'leave',pm_default_export_year:'2025'});w.updateUiPreference('size','large');const stored=w.localStorage.getItem('pm_ui_preferences_v1:1');assert.equal(JSON.parse(stored).values.size,'large');w.confirmDialog=async()=>true;await w.resetUiPreferences();assert.equal(w.readUiPreferences().size,'standard');assert.equal(w.localStorage.getItem('mail_secret'),'leave');assert.equal(w.localStorage.getItem('pm_default_export_year'),'2025');});
test('auto theme follows OS while a fixed theme ignores changes; drafts survive',()=>{const {w,media}=setup();w.updateUiPreference('theme','auto');media.matches=true;media.fn();assert.equal(w.document.documentElement.dataset.theme,'dark');w.updateUiPreference('theme','green');media.matches=false;media.fn();assert.equal(w.document.documentElement.dataset.theme,'green');w.updateUiPreference('compact',true);assert.equal(w.document.getElementById('loginSubtitleInput').value,'未保存的副标题');});
test('storage errors keep session changes and report unsaved status',()=>{const {w}=setup({},true);w.updateUiPreference('size','large');assert.equal(w.readUiPreferences().size,'large');assert.match(w.document.getElementById('uiPreferenceStatus').textContent,/本次会话|未能保存/);});
test('motion respects system restrictions and updates shared root state',()=>{const {w}=setup();w.updateUiPreference('motion','off');assert.equal(w.effectiveMotionPreference(),'off');assert.equal(w.document.documentElement.dataset.motion,'off');});
test('date display keeps plain dates and minute precision without mutating source',()=>{const {w}=setup();w.updateUiPreference('dateFormat','chinese');assert.equal(w.formatDisplayDate('2026-01-02T17:30'),'2026年1月2日 17:30');assert.equal(w.formatDisplayDate('2026-01-02'),'2026年1月2日');w.updateUiPreference('dateFormat','slash');assert.equal(w.formatDisplayDate('2026-01-02'),'2026/01/02');assert.equal(w.formatDisplayDate('invalid'),'invalid');});
test('calendar layout rebuilds weekdays and blanks by date for leap months and year boundaries',()=>{const {w}=setup();for(const [ym,start] of [['2024-02',1],['2026-12',0],['2027-01',1]]){const day=ym+'-01',event={name:'same'};const data={cells:[{empty:false,date_str:day,day:1,events:[event]}]};const out=w.layoutCalendarCells(data,start);assert.equal(out.cells.length%7,0);assert.equal(out.weekday_names[0],start?'一':'日');assert.equal(out.cells.find(c=>c.date_str===day).events[0],event);assert.equal(data.cells.length,1);}});
test('sidebar fields retain mandatory name/status and sort missing values last',()=>{const {w}=setup();w.updateUiPreference('sidebarFields',[]);assert.equal(w.readUiPreferences().sidebarFields.length,0);const a={id:1,number:'A-1',progress:10,stages:[]},b={id:2,number:'A-2',progress:40,stages:[{planned_at:'2026-02-01',completed:false}]};assert.equal(w.sortUiProjects([a,b],'next_plan')[0].id,2);assert.equal(w.sortUiProjects([a,b],'progress_desc')[0].id,2);assert.match(w.renderAppearancePreferences(),/仅当前账户和设备/);});

test('default home loads only the selected existing view without a dashboard request',async()=>{const {w}=setup();const calls=[];w.switchView=(name,options)=>{calls.push('view:'+name);assert.equal(options.load,false);};w.loadCalendar=async()=>{calls.push('calendar');return {};};w.loadDashboard=async()=>{calls.push('dashboard');return {};};w.updateUiPreference('home','calendar');await w.loadPreferredHome();assert.deepEqual(calls,['view:calendar','calendar']);});
test('sidebar applies field presets and progress sorting while preserving status and original source order',()=>{const {w,dom}=setup();const workspace=fs.readFileSync('src/templates/workspace.html','utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');w.document.body.innerHTML=workspace;w.eval(['01-core.js','02-projects.js','22-procurement-methods.js'].map(file=>fs.readFileSync('source/frontend/'+file,'utf8')).join('\n')+"\nwindow.seedPrefsSidebar=()=>{allProjects=[{id:1,number:'A-1',name:'项目一',progress:10,stages:[]},{id:2,number:'A-2',name:'项目二',progress:80,stages:[]}];rebuildProjectIndexes(allProjects);systemSettings={procurement_catalog:{methods:[]}};};window.readSeedOrder=()=>allProjects[0].id;");w.seedPrefsSidebar();w.updateUiPreference('sort','progress_desc');w.updateUiPreference('sidebarFields',['method']);w.renderSidebar();const rows=w.document.querySelectorAll('.sidebar-project');assert.equal(rows[0].dataset.projectId,'2');assert.ok(rows[0].querySelector('.mini-status'));assert.ok(rows[0].querySelector('.project-name'));assert.equal(w.readSeedOrder(),1);dom.window.close();});

test('design token ladder, four-tier buttons, header more menu, readonly form greying and zero-value neutral status work together',()=>{
    const css=fs.readFileSync('src/static/style.css','utf8');
    for(const token of ['--font-size-2xs','--font-size-xs','--font-size-sm','--font-size-base','--font-size-md','--font-size-lg','--font-size-xl','--font-size-2xl','--radius-2xs','--radius-xs','--radius-sm','--radius-md','--radius-lg','--radius-xl','--radius-pill','--elevation-0','--elevation-1','--elevation-2','--elevation-3','--elevation-4','--z-base','--z-sticky','--z-dropdown','--z-navigation','--z-drawer','--z-modal','--z-popover','--z-toast','--bp-xs','--bp-sm','--bp-md','--bp-lg','--bp-xl','--control-readonly-bg','--control-readonly-text','--control-readonly-border']){
        assert.match(css,new RegExp(`${token}\\s*:`),`missing token ${token}`);
    }
    for(const btnClass of ['\\.btn-primary','\\.btn-secondary','\\.btn-ghost','\\.btn-danger','\\.project-more-menu','\\.command-metric\\.is-zero']){
        assert.match(css,new RegExp(btnClass),`missing selector ${btnClass}`);
    }
    const {w,dom}=setup();
    const workspace=fs.readFileSync('src/templates/workspace.html','utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
    w.document.body.innerHTML=workspace;
    w.eval(['01-core.js','02-projects.js','04-project-workflow.js','05-views.js','09-command-center.js','10-chart-board.js','11-stage-settings.js','20-form-accessibility.js','22-procurement-methods.js'].map(file=>fs.readFileSync('source/frontend/'+file,'utf8')).join('\n')+"\nwindow.seedUiTokens=()=>{currentProject={id:1,number:'A-1',name:'测试项目',purchaser:'测试采购人',method:'公开招标',budget:'100',year:2026,progress:0,lots:[],stages:[]};allProjects=[currentProject];systemSettings={procurement_catalog:{methods:[]}};};");
    w.seedUiTokens();
    const moreMenu=w.document.getElementById('projectMoreMenu');
    assert.ok(moreMenu,'project header must use a more menu for destructive actions');
    assert.ok(moreMenu.querySelector('.project-more-item[onclick*="deleteCurrentProject"]'),'delete action must live inside the more menu');
    moreMenu.setAttribute('open','');
    w.renderProjectTopbar();
    assert.equal(moreMenu.hasAttribute('open'),false,'switching or refreshing project header closes the more menu');
    w.renderInfo();
    w.syncAccountAccess({role:'viewer',permissions:{export_data:true}});
    assert.equal(w.document.querySelector('#infoContent .info-form').classList.contains('is-readonly-form'),true);
    assert.equal(w.document.getElementById('infoName').disabled,true);
    assert.equal(w.document.getElementById('infoMethod').disabled,true);
    assert.equal(w.document.getElementById('infoNotes').disabled,true);
    w.syncAccountAccess({role:'editor'});
    assert.equal(w.document.getElementById('infoName').disabled,false);
    w.syncApplicationAccess({mode:'read_only',message:'只读'});
    assert.equal(w.document.getElementById('infoName').disabled,true);
    w.syncApplicationAccess({mode:'full'});
    assert.equal(w.document.getElementById('infoName').disabled,false);
    const dashHtml=w.renderCommandCenterDashboard({metrics:{total:1,active:1,unopened:0,dueSoon:0,overdue:0,completed:0},actions:[],activeProjects:[{id:1,number:'A-1',name:'测试项目',purchaser:'测试采购人',method:'公开招标',budget:'100',year:2026,progress:0,lots:[],stages:[]}],insights:{methods:{公开招标:1},riskProjects:[]}});
    w.document.getElementById('dashboardContent').innerHTML=dashHtml;
    assert.equal(w.document.querySelector('[data-metric="overdue"]').dataset.metricZero,'true');
    assert.equal(w.document.querySelector('[data-metric="dueSoon"]').dataset.metricZero,'true');
    assert.equal(w.document.querySelector('[data-metric="active"]').dataset.metricZero,'false');
    const kpiHtml=w.renderChartKpis({total:1,active:1,overdue:0,completed:0});
    w.document.getElementById('dashboardContent').innerHTML=kpiHtml;
    assert.equal(w.document.querySelector('.cb-kpi-3').dataset.metricZero,'true');
    dom.window.close();
});
