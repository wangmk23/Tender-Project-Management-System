// ── Account and device scoped interface preferences ──
const UI_PREFERENCE_DEFAULTS=Object.freeze({theme:'default',compact:false,preview:true,size:'standard',motion:'normal',home:'dashboard',sort:'active_first',sidebarFields:['number','progress'],dateFormat:'iso',weekStart:0,holidayDisplay:true});
const UI_PREFERENCE_ENUMS={theme:['default','blue','green','dark','auto'],size:['small','standard','large'],motion:['normal','reduce','off'],home:['dashboard','calendar','procure'],sort:['active_first','number_asc','number_desc','progress_asc','progress_desc','next_plan'],dateFormat:['iso','chinese','slash']};
const uiPreferenceCache=new Map();
let uiPreferenceMessage='';
const uiThemeMedia=globalThis.matchMedia?.('(prefers-color-scheme: dark)');
const uiMotionMedia=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
function uiStorageGet(key){try{return localStorage.getItem(key);}catch(_){uiPreferenceMessage='本次会话有效，未能读取本地设置。';return null;}}
function uiStorageSet(key,value){try{localStorage.setItem(key,value);return true;}catch(_){uiPreferenceMessage='本次会话有效，未能保存；关闭后可能恢复原设置。';return false;}}
function uiPreferenceUserId(){return String(window.CURRENT_USER?.id??'anonymous');}
function uiPreferenceKey(id){return 'pm_ui_preferences_v1:'+String(id);}
function normalizeUiPreferences(value){
    const source=value&&typeof value==='object'?value:{};
    const result={...UI_PREFERENCE_DEFAULTS,sidebarFields:[...UI_PREFERENCE_DEFAULTS.sidebarFields]};
    for(const key of Object.keys(UI_PREFERENCE_DEFAULTS)){
        const v=source[key];
        if(UI_PREFERENCE_ENUMS[key]){if(UI_PREFERENCE_ENUMS[key].includes(v))result[key]=v;}
        else if(key==='sidebarFields'){if(Array.isArray(v))result[key]=[...new Set(v.filter(x=>['number','method','nextPlan','progress'].includes(x)))];}
        else if(key==='weekStart'){if(v===0||v===1)result[key]=v;}
        else if(typeof v==='boolean')result[key]=v;
    }
    return result;
}
function readUiPreferences(userId=uiPreferenceUserId()){
    const id=String(userId);if(uiPreferenceCache.has(id))return JSON.parse(JSON.stringify(uiPreferenceCache.get(id)));
    let values=normalizeUiPreferences(null);
    const raw=uiStorageGet(uiPreferenceKey(id));
    if(raw){try{const stored=JSON.parse(raw);if(stored.version!==1||!stored.values||typeof stored.values!=='object')throw Error('version');values=normalizeUiPreferences(stored.values);if(Object.keys(stored.values).some(k=>!Object.hasOwn(UI_PREFERENCE_DEFAULTS,k)||JSON.stringify(stored.values[k])!==JSON.stringify(values[k])))uiPreferenceMessage='部分界面设置无效，已按默认值显示；可重新选择后保存。';}catch(_){uiPreferenceMessage='部分界面设置无法读取，已使用默认值；原记录未删除。';}}
    else if(id!=='anonymous'&&!uiStorageGet('pm_ui_migration_v1')){
        const theme=uiStorageGet('pm_theme'),compact=uiStorageGet('pm_compact_mode'),preview=uiStorageGet('pm_preview_in_app'),sort=uiStorageGet('projectSidebarSortDirection');
        values=normalizeUiPreferences({theme,compact:compact==='1',preview:preview!=='0',sort:sort==='desc'?'number_desc':sort==='asc'?'number_asc':UI_PREFERENCE_DEFAULTS.sort});
        if(uiStorageSet(uiPreferenceKey(id),JSON.stringify({version:1,values,migrated_from:'device_legacy_v1'})))uiStorageSet('pm_ui_migration_v1',id);
    }
    uiPreferenceCache.set(id,values);return JSON.parse(JSON.stringify(values));
}
function effectiveMotionPreference(){const motion=readUiPreferences().motion;return motion==='off'?'off':uiMotionMedia?.matches?'reduce':motion;}
function applyUiPreferences(){
    const prefs=readUiPreferences();const root=document.documentElement;
    root.dataset.theme=prefs.theme==='auto'?(uiThemeMedia?.matches?'dark':'default'):prefs.theme;
    root.dataset.themeMode=prefs.theme;root.dataset.uiSize=prefs.size;root.dataset.motion=effectiveMotionPreference();root.classList.toggle('compact-mode',prefs.compact);
    if(effectiveMotionPreference()!=='normal'&&typeof cleanupCommandCenterMotion==='function')cleanupCommandCenterMotion();
    root.dataset.sidebarFields=prefs.sidebarFields.join(' ');root.dataset.holidayDisplay=String(prefs.holidayDisplay);
    document.querySelectorAll('[data-theme-option]').forEach(el=>{el.classList.toggle('active',el.dataset.themeOption===prefs.theme);el.setAttribute('aria-pressed',String(el.dataset.themeOption===prefs.theme));});
    document.querySelectorAll('[data-ui-preference]').forEach(el=>{el.value=String(prefs[el.dataset.uiPreference]);});
    const status=document.getElementById('uiPreferenceStatus');if(status)status.textContent=uiPreferenceMessage||'仅当前账户和设备；修改即时生效并保存在本地。';
    return prefs;
}
function updateUiPreference(key,value){
    if(!Object.hasOwn(UI_PREFERENCE_DEFAULTS,key))throw new Error('未知界面偏好');
    const current=readUiPreferences(),next=normalizeUiPreferences({...current,[key]:value});
    uiPreferenceCache.set(uiPreferenceUserId(),next);uiPreferenceMessage='';
    const saved=uiStorageSet(uiPreferenceKey(uiPreferenceUserId()),JSON.stringify({version:1,values:next}));
    if(key==='theme')uiStorageSet('pm_device_theme_v1',next.theme);
    applyUiPreferences();
    if(['sort','sidebarFields','dateFormat'].includes(key)&&typeof renderSidebar==='function'){
        if(typeof sidebarSortDirection!=='undefined')sidebarSortDirection=next.sort==='number_desc'?'desc':'asc';
        if(typeof sidebarRenderSignature!=='undefined')sidebarRenderSignature='';renderSidebar();
    }
    if(['weekStart','holidayDisplay','dateFormat'].includes(key)&&typeof readViewCache==='function'){
        const cached=readViewCache(calendarCacheKey(calendarYear,calendarMonth));if(cached&&document.getElementById('view-calendar')?.classList.contains('active'))renderCalendar(cached.value,calendarYear,calendarMonth);
    }
    return saved;
}
async function resetUiPreferences(){
    if(typeof confirmDialog==='function'&&!await confirmDialog('恢复界面默认','将恢复本账户在此设备的主题、显示、首页、侧栏和日历偏好。导出年份、系统配置及业务资料保持原值。','恢复默认'))return false;
    uiPreferenceCache.set(uiPreferenceUserId(),normalizeUiPreferences(null));uiPreferenceMessage='';
    const saved=uiStorageSet(uiPreferenceKey(uiPreferenceUserId()),JSON.stringify({version:1,values:readUiPreferences()}));
    uiStorageSet('pm_device_theme_v1','default');applyUiPreferences();
    if(typeof sidebarRenderSignature!=='undefined')sidebarRenderSignature='';if(typeof renderSidebar==='function')renderSidebar();
    if(typeof renderSettingsView==='function'){
        const host=document.getElementById('appearancePreferencesHost');if(host)host.innerHTML=renderAppearancePreferences();
    }
    return saved;
}
function formatDisplayDate(value){
    if(value==null||value==='')return '';let raw=String(value).trim();
    let m=raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);if(!m)return raw;
    let y=Number(m[1]),mo=Number(m[2]),d=Number(m[3]),time=m[4]?m[4]+':'+m[5]:'';
    const days=[31,y%4===0&&(y%100!==0||y%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
    if(mo<1||mo>12||d<1||d>days[mo-1])return raw;
    if(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)){
        const parsed=new Date(raw);if(Number.isNaN(parsed.getTime()))return raw;
        const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(parsed).map(p=>[p.type,p.value]));
        y=Number(parts.year);mo=Number(parts.month);d=Number(parts.day);time=parts.hour+':'+parts.minute;
    }
    const fmt=readUiPreferences().dateFormat;const date=fmt==='chinese'?`${y}年${mo}月${d}日`:`${String(y).padStart(4,'0')}${fmt==='slash'?'/':'-'}${String(mo).padStart(2,'0')}${fmt==='slash'?'/':'-'}${String(d).padStart(2,'0')}`;
    return date+(time?' '+time:'');
}
function layoutCalendarCells(data,weekStart=readUiPreferences().weekStart){
    const actual=(data.cells||[]).filter(c=>!c.empty&&/^\d{4}-\d{2}-\d{2}$/.test(c.date_str||''));
    if(!actual.length)return data;
    const [y,m]=actual[0].date_str.split('-').map(Number),prefix=actual[0].date_str.slice(0,7),byDate=new Map(actual.map(c=>[c.date_str,c]));
    const first=new Date(y,m-1,1),count=new Date(y,m,0).getDate(),offset=(first.getDay()-(weekStart===1?1:0)+7)%7;
    const cells=Array.from({length:offset},()=>({empty:true}));
    for(let d=1;d<=count;d++){const key=prefix+'-'+String(d).padStart(2,'0');cells.push(byDate.get(key)||{empty:false,date_str:key,day:d,events:[]});}
    while(cells.length%7)cells.push({empty:true});
    const weekdays=['日','一','二','三','四','五','六'];return {...data,cells,weekday_names:weekStart===1?[...weekdays.slice(1),weekdays[0]]:weekdays};
}
function nextUiProjectPlan(project){return (project.stages||[]).filter(s=>!s.completed&&!s.skipped&&!s.template_removed).map(s=>s.planned_at||s.planned_datetime||s.planned_date||'').filter(Boolean).sort()[0]||'';}
function sortUiProjects(projects,sort=readUiPreferences().sort){
    const collator=new Intl.Collator('zh-CN',{numeric:true,sensitivity:'base'});
    return [...projects].sort((a,b)=>{
        let cmp=0;
        if(sort==='active_first'){
            const rank=p=>p.is_terminated?2:Number(p.progress||0)>=100?1:0;
            const ar=rank(a),br=rank(b);if(ar!==br)return ar-br;
            if(ar===0){const av=nextUiProjectPlan(a),bv=nextUiProjectPlan(b);if(!av!==!bv)return av?-1:1;cmp=av.localeCompare(bv);}
            if(!cmp)cmp=collator.compare(String(b.number||''),String(a.number||''));
        }
        else if(sort==='next_plan'){const av=nextUiProjectPlan(a),bv=nextUiProjectPlan(b);if(!av!==!bv)return av?-1:1;cmp=av.localeCompare(bv);}
        else if(sort.startsWith('progress')){const av=Number(a.progress),bv=Number(b.progress),va=a.progress!=null&&Number.isFinite(av),vb=b.progress!=null&&Number.isFinite(bv);if(va!==vb)return va?-1:1;if(va)cmp=(av-bv)*(sort.endsWith('desc')?-1:1);}
        else{const av=String(a.number||''),bv=String(b.number||''),va=/\d/.test(av),vb=/\d/.test(bv);if(va!==vb)return va?-1:1;cmp=collator.compare(av,bv)*(sort==='number_desc'?-1:1);}
        return cmp||collator.compare(String(a.number||''),String(b.number||''))||Number(a.id||0)-Number(b.id||0);
    });
}
function uiPreferenceEscape(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function renderAppearancePreferences(){
    const p=readUiPreferences(),escape=uiPreferenceEscape;
    const select=(key,label,values)=>`<label class="ui-preference-field">${label}<select data-ui-preference="${key}" data-immediate-setting onchange="updateUiPreference('${key}',this.value)">${values.map(([v,n])=>`<option value="${v}" ${p[key]===v?'selected':''}>${n}</option>`).join('')}</select></label>`;
    return `<section class="settings-card settings-card-wide appearance-preferences"><div class="settings-card-head"><div><h2>主题与显示</h2><p>仅当前账户和设备。个人偏好即时生效，系统配置仍须单独保存。</p></div></div><p id="uiPreferenceStatus" role="status">${escape(uiPreferenceMessage||'设置保存在当前访问设备；不跨设备同步。')}</p><div class="theme-grid">${[['default','默认浅色'],['blue','清爽蓝'],['green','护眼绿'],['dark','暗色'],['auto','跟随系统']].map(([v,n])=>`<button type="button" class="theme-option ${p.theme===v?'active':''}" data-theme-option="${v}" aria-pressed="${p.theme===v}" onclick="updateUiPreference('theme','${v}')"><span class="ui-theme-preview" data-preview-theme="${v}"><i></i><b></b><em></em></span><strong>${n}</strong></button>`).join('')}</div><div class="ui-preference-grid">${select('size','字号',[['small','小'],['standard','标准'],['large','大']])}${select('motion','动画',[['normal','正常'],['reduce','减少'],['off','关闭']])}</div><label class="setting-toggle"><input data-immediate-setting type="checkbox" ${p.compact?'checked':''} onchange="setCompactMode(this.checked)"><span></span><div><strong>紧凑显示</strong><small>减少卡片和列表留白。</small></div></label><label class="setting-toggle"><input data-immediate-setting type="checkbox" ${p.preview?'checked':''} onchange="setPreviewMode(this.checked)"><span></span><div><strong>内置预览</strong><small>在系统中预览支持的附件格式。</small></div></label></section><section class="settings-card settings-card-wide appearance-preferences"><h2>默认工作方式</h2><div class="ui-preference-grid">${select('home','默认首页',[['dashboard','总览看板'],['calendar','日历视图'],['procure','采购方式看板']])}${select('sort','侧栏项目排序',[['active_first','进行中优先'],['number_asc','编号升序'],['number_desc','编号降序'],['progress_asc','进度升序'],['progress_desc','进度降序'],['next_plan','最近待办计划']])}</div><fieldset class="ui-preference-fields"><legend>侧栏显示字段（名称和状态始终保留）</legend>${[['number','项目编号'],['method','采购方式与制度'],['nextPlan','下一节点计划'],['progress','进度']].map(([v,n])=>`<label><input data-immediate-setting type="checkbox" ${p.sidebarFields.includes(v)?'checked':''} onchange="setUiSidebarField('${v}',this.checked)">${n}</label>`).join('')}</fieldset><div class="settings-actions"><button class="btn btn-secondary btn-sm" onclick="setUiSidebarPreset('standard')">标准</button><button class="btn btn-secondary btn-sm" onclick="setUiSidebarPreset('simple')">精简</button><button class="btn btn-secondary btn-sm" onclick="setUiSidebarPreset('full')">完整</button></div></section><section class="settings-card settings-card-wide appearance-preferences"><h2>日期与日历</h2><div class="ui-preference-grid">${select('dateFormat','日期显示格式',[['iso','2026-10-18'],['chinese','2026年10月18日'],['slash','2026/10/18']])}<label class="ui-preference-field">每周起始日<select data-immediate-setting onchange="updateUiPreference('weekStart',Number(this.value))"><option value="0" ${p.weekStart===0?'selected':''}>星期日</option><option value="1" ${p.weekStart===1?'selected':''}>星期一</option></select></label></div><label class="procurement-check"><input data-immediate-setting type="checkbox" ${p.holidayDisplay?'checked':''} onchange="updateUiPreference('holidayDisplay',this.checked)">显示国家放假、调休补班标记与底色</label><p class="settings-note">只改变显示；业务期限、工作日计算与邮件发送规则保持原配置。</p><button class="btn btn-secondary btn-sm" onclick="resetUiPreferences()">恢复界面默认</button></section>`;
}
function setUiSidebarField(key,checked){const fields=readUiPreferences().sidebarFields;updateUiPreference('sidebarFields',checked?[...fields,key]:fields.filter(v=>v!==key));}
function setUiSidebarPreset(preset){updateUiPreference('sidebarFields',preset==='simple'?[]:preset==='full'?['number','method','nextPlan','progress']:['number','progress']);const host=document.getElementById('appearancePreferencesHost');if(host)host.innerHTML=renderAppearancePreferences();}
window.PMUiPrefs={read:readUiPreferences,apply:applyUiPreferences,storageGet:uiStorageGet};
uiThemeMedia?.addEventListener?.('change',applyUiPreferences);if(uiMotionMedia!==uiThemeMedia)uiMotionMedia?.addEventListener?.('change',applyUiPreferences);
applyUiPreferences();

function renderUiSidebarExtras(project){
    const fields=readUiPreferences().sidebarFields;
    return (fields.includes('method')?'<div class="sidebar-detail">'+uiPreferenceEscape(typeof procurementProjectLabel==='function'?procurementProjectLabel(project):project.method||'')+'</div>':'')+(fields.includes('nextPlan')?'<div class="sidebar-detail">下一计划：'+uiPreferenceEscape(formatDisplayDate(nextUiProjectPlan(project))||'未设置')+'</div>':'');
}
async function loadPreferredHome(){
    const target=readUiPreferences().home;
    try{
        if(target==='calendar'){switchView('calendar',{load:false});if(await loadCalendar()===null)throw Error('load');}
        else if(target==='procure'){switchView('procure',{load:false});if(await loadProcureBoard()===null)throw Error('load');}
        else{switchView('dashboard',{load:false});await loadDashboard();}
    }catch(error){toast('默认首页暂时无法加载，已返回总览','warning');switchView('dashboard',{load:false});await loadDashboard();}
}

function getDefaultExportYear(){const value=uiStorageGet('pm_default_export_year')||'';return /^\d{4}$/.test(value)?value:'';}
