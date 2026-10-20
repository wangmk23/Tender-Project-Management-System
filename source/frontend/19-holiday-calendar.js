// ── 国家节假日日历与保证金日程 ──
var hcSettingsRequest=0,hcSettingsState=null;
function hcLive(state){return state===hcSettingsState&&document.querySelector(`[data-hc-request="${state.ticket}"]`)&&document.getElementById('modal')?.classList.contains('open')&&document.getElementById('modalBody')?.contains(document.querySelector(`[data-hc-request="${state.ticket}"]`));}
function hcBind(id,action,event='click'){document.getElementById(id)?.addEventListener(event,action);}
function hcMessage(message){const el=document.getElementById('hcFeedback');if(el){el.textContent=message;el.hidden=!message;}}
function hcText(value){const labels={holidays:'放假日期数',workdays:'补班日期数',festivals:'节日当天数',festival_name:'当天节日',added:'新增',removed:'移除',changed:'变更',date:'日期',kind:'安排',name:'名称',before:'原安排',after:'新安排'};if(typeof value==='object'&&value!==null)return Object.entries(value).map(([key,val])=>`${labels[key]||''}${labels[key]?'：':''}${hcText(val)}`).join('；');return value==='holiday'?'放假':value==='workday'?'补班':value==='festival'?'节日当天':String(value??'');}
async function showHolidayCalendarSettings(year=calendarYear) {
    year=Number(year);if(!Number.isInteger(year)||year<2000||year>2100)year=new Date().getFullYear();
    const state=hcSettingsState={ticket:++hcSettingsRequest,year,data:null,busy:false,preview:null};
    showModal('放假调休 · 安排与更新',`<div data-hc-request="${state.ticket}" class="deadline-workspace"><p role="status">正在读取年度安排…</p></div>`);
    const footer=document.getElementById('modalFooter');footer.style.display='flex';footer.innerHTML='<button id="hcClose" class="btn btn-secondary">关闭</button>';hcBind('hcClose',closeModal);
    try{
        const data=await api('GET',`/api/holiday-calendar?year=${year}`);if(!hcLive(state))return;state.data=data;
        const editable=Boolean(window.CURRENT_USER?.is_admin),disabled=editable?'':'disabled';
        document.querySelector(`[data-hc-request="${state.ticket}"]`).innerHTML=`<div class="deadline-toolbar"><div class="form-group"><label for="holidaySettingsYear">查看年度</label><input id="holidaySettingsYear" type="number" min="2000" max="2100" value="${year}"></div><button id="hcYearGo" class="btn btn-secondary">查看年度</button></div><div id="hcFeedback" class="deadline-feedback" role="alert" hidden></div><section class="deadline-card"><h3>${year}年放假调休安排</h3><p>${data.confirmed?'年度安排已确认':'该年度安排尚未确认；工作日期限需先补充安排。'}</p><p class="deadline-muted">来源：${escHtml(({manual_import:'管理员导入并确认',builtin:'内置核验安排',legacy:'原有本地安排',unconfirmed:'待确认'})[data.origin]||data.document||'本地安排')} · 确认人：${escHtml(data.actor||data.confirmed_by||'未记录')} · 更新时间：${escHtml(data.updated_at||data.created_at||'未记录')}</p><div class="deadline-actions"><button id="hcTemplate" class="btn btn-secondary">下载空白模板</button><button id="hcExport" class="btn btn-secondary">导出当前安排</button></div></section><section class="deadline-card"><h3>导入年度完整安排</h3><p class="deadline-muted">放假管休息日期，节日当天管名称显示；普通周末无需单列。导入将替换本年度完整安排，上传和预览不生效。</p><details class="holiday-import-guide"><summary>怎么填写：以国庆安排为例</summary><ul><li>放假：10月1日至7日，日历逐日标记“休”。</li><li>节日当天：10月1日，名称填“国庆节”，只在当天显示。</li><li>补班：按当年通知填写单日，日历标记“班”。</li></ul><p class="deadline-muted">示例仅说明填法；节日行可以与放假行重叠，且不改变工作日计算。名称在放假、补班行可留空。新模板未填节日当天时不显示节名。旧四列模板仍可导入：2026年使用已核验的节日当天，其他年度请用新模板补充。</p></details><div class="form-group"><label for="hcFile">年度安排文件（.xlsx，最大2MB）</label><input id="hcFile" type="file" accept=".xlsx" ${disabled}></div><div class="form-group"><label for="hcDocument">公告名称（选填）</label><input id="hcDocument" maxlength="300" ${disabled}></div><div class="form-group"><label for="hcSourceUrl">来源链接（选填）</label><input id="hcSourceUrl" type="url" placeholder="https://" ${disabled}><small>填写链接不表示已完成官方真实性核验。</small></div><button id="hcPreviewButton" class="btn btn-primary" ${disabled}>上传并预览</button></section><div id="hcPreview"></div><details class="deadline-card" id="hcHistory"><summary>历史安排与恢复</summary><div id="hcHistoryBody"><p class="deadline-muted">展开后读取年度历史记录。</p></div></details><section class="deadline-card"><h3>邮件发送安排</h3><label class="inline-check"><input id="holidayUseWorkdays" type="checkbox" ${data.use_national_workdays?'checked':''} ${disabled}>仅在国家安排的工作日发送（含调休补班）</label><p class="deadline-muted">启用后代替星期筛选；未确认年度暂停此类发送。自然日业务期限仍保留原截止日期。</p><button id="hcSavePreferences" class="btn btn-secondary" ${disabled}>保存发送安排</button></section>`;
        hcBind('hcYearGo',()=>showHolidayCalendarSettings(Number(document.getElementById('holidaySettingsYear').value)));
        hcBind('hcTemplate',()=>hcDownload('template'));hcBind('hcExport',()=>hcDownload('export'));hcBind('hcPreviewButton',hcPreviewImport);hcBind('hcSavePreferences',hcSavePreferences);
        const invalidate=()=>{state.draftVersion=(state.draftVersion||0)+1;if(state.preview){state.preview=null;document.getElementById('hcPreview').innerHTML='<p class="deadline-muted">文件或来源说明已修改，请重新上传预览。</p>';}};
        hcBind('hcFile',invalidate,'change');hcBind('hcDocument',invalidate,'input');hcBind('hcSourceUrl',invalidate,'input');
        hcBind('hcHistory',()=>{if(document.getElementById('hcHistory').open&&!state.historyLoaded)hcLoadHistory();},'toggle');
    }catch(error){if(hcLive(state))document.querySelector(`[data-hc-request="${state.ticket}"]`).innerHTML=`<p role="alert">${escHtml(error.message||'年度安排读取失败，请重新进入。')}</p>`;}
}
async function hcDownload(kind){
    const state=hcSettingsState;if(!hcLive(state)||state.busy||state.downloading||!['template','export'].includes(kind))return;
    const desktop=isDesktopApp(),url=`/api/holiday-calendar/${kind}?year=${state.year}&${desktop?'save=1':'download=1'}`;
    state.downloading=true;for(const id of ['hcTemplate','hcExport'])document.getElementById(id).disabled=true;
    hcMessage(desktop?'正在保存到文件保存位置…':'正在准备下载…');
    try{
        let message;
        if(desktop){const result=await api('POST',url);if(!result.path)throw new Error('未收到文件保存结果，请重试。');message=`已保存：${result.path}`;}
        else{
            const response=await localFetch(url);if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error||'文件下载失败，请重试。');}
            const blob=await response.blob(),objectUrl=URL.createObjectURL(blob),header=response.headers.get('Content-Disposition')||'';
            let filename=`${state.year}年放假调休安排${kind==='template'?'模板':''}.xlsx`;
            const encoded=header.match(/filename\*=UTF-8''([^;]+)/i);if(encoded){try{filename=decodeURIComponent(encoded[1]);}catch(_){}}
            filename=filename.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').replace(/^\.+/,'').slice(0,200);
            const anchor=document.createElement('a');anchor.href=objectUrl;anchor.download=filename;document.body.appendChild(anchor);
            try{anchor.click();}finally{anchor.remove();setTimeout(()=>URL.revokeObjectURL(objectUrl),1000);}
            message='已交给浏览器下载，请查看浏览器的下载位置。';
        }
        if(hcLive(state))hcMessage(message);else toast(message,'success');
    }catch(error){const message=error.message||'文件下载失败，请重试。';if(hcLive(state))hcMessage(message);else toast(message,'error');}
    finally{state.downloading=false;if(hcLive(state))for(const id of ['hcTemplate','hcExport'])document.getElementById(id).disabled=false;}
}
async function hcPreviewImport(){
    const state=hcSettingsState;if(!hcLive(state)||state.busy)return;const file=document.getElementById('hcFile').files?.[0];
    if(!file||!/\.xlsx$/i.test(file.name)||file.size>2*1024*1024){hcMessage('请选择不超过2MB的.xlsx年度安排文件。');return;}
    const form=new FormData();form.append('file',file);form.append('year',state.year);form.append('base_revision',state.data.local_revision??0);form.append('document',document.getElementById('hcDocument').value);form.append('source_url',document.getElementById('hcSourceUrl').value);
    const draftVersion=state.draftVersion||0;state.busy=true;hcMessage('正在校验文件并核对业务影响…');document.getElementById('hcPreviewButton').disabled=true;
    try{const result=await apiForm('/api/holiday-calendar/import/preview',form);if(hcLive(state)){if(draftVersion!==(state.draftVersion||0)){hcMessage('文件或来源说明已修改，请重新上传预览。');return;}hcShowPreview(result);}}
    catch(error){if(hcLive(state)){if(Array.isArray(error.errors)&&error.errors.length)hcShowPreview({status:'invalid',errors:error.errors,message:error.message});else hcMessage(error.message||'预览失败，文件及填写内容已保留。');}}
    finally{state.busy=false;if(hcLive(state))document.getElementById('hcPreviewButton').disabled=false;}
}
function hcShowPreview(result){
    const state=hcSettingsState;if(!hcLive(state))return;state.preview=result;hcMessage('');
    const errors=Array.isArray(result.errors)?result.errors:result.errors?[result.errors]:[];
    const ready=Boolean(result.token)&&!errors.length&&['ready','unchanged','no_change',undefined].includes(result.status)&&result.impacts?.status!=='unavailable';
    if(result.impacts?.error)errors.push({message:result.impacts.error});
    document.getElementById('hcPreview').innerHTML=`<section class="deadline-card"><h3>更新预览</h3>${errors.length?`<ul class="deadline-feedback" role="alert">${errors.map(e=>`<li>${escHtml(typeof e==='string'?e:[e.sheet,e.row?`第${e.row}行`:'',e.field,e.message,e.hint].filter(Boolean).join(' · '))}</li>`).join('')}</ul>`:''}<p>${escHtml(result.message||hcText(result.summary)||'请核对日期变动及业务影响。')}</p><details><summary>查看新增、移除和变更日期</summary><pre class="deadline-diff">${escHtml(hcText(result.diff||{}))}</pre></details><div id="hcImpacts"></div>${ready?'<label class="inline-check"><input id="hcComplete" type="checkbox">我已核对所选年度的完整安排，确认替换该年度安排</label><div class="deadline-actions"><button id="hcCommit" class="btn btn-primary">确认更新</button><button id="hcCancelPreview" class="btn btn-secondary">取消预览</button></div>':'<p class="deadline-muted">请修正文件后重新上传；当前有效安排未改变。</p>'}</section>`;
    hcRenderImpacts(result);hcBind('hcCommit',hcCommitImport);hcBind('hcCancelPreview',()=>{if(state.busy)return;state.preview=null;document.getElementById('hcPreview').innerHTML='';});
}
function hcRenderImpacts(result){
    const impact=result.impacts,items=Array.isArray(impact)?impact:Array.isArray(impact?.items)?impact.items:[],page=Number(impact?.page||result.page||1),total=Number(impact?.total??result.impact_total??items.length),known=impact!==undefined&&impact!==null&&impact.status!=='unavailable'&&impact.total!==null;
    document.getElementById('hcImpacts').innerHTML=`<h4>业务影响${known?`（${total}项）`:''}</h4><p class="deadline-muted">${known?'原确认期限保留；生效后实际变化的事项进入复核。':'业务影响尚未完成核对，请确认服务端影响查询结果后更新。'}</p>${items.slice(0,50).map(x=>`<article class="deadline-impact"><strong>${escHtml(x.title||x.project_name||x.supplier_name||'业务事项')}</strong><p>${escHtml(x.project_name||'')} ${escHtml(x.lot_name||'')}</p><p>原确认：${escHtml(x.confirmed_deadline||x.old_deadline||x.previous_deadline||'未确认')} → 新建议：${escHtml(x.proposed_deadline||x.new_deadline||x.deadline||'待核对')}</p>${x.overdue?'<strong>新建议已过期，请及时复核</strong>':''}</article>`).join('')}${total>50?`<div class="deadline-actions"><button id="hcPrevPage" class="btn btn-secondary" ${page<=1?'disabled':''}>上一页</button><span>第${page}页 · 每页50项</span><button id="hcNextPage" class="btn btn-secondary" ${page*50>=total?'disabled':''}>下一页</button></div>`:''}`;
    hcBind('hcPrevPage',()=>hcImpactPage(page-1));hcBind('hcNextPage',()=>hcImpactPage(page+1));
}
async function hcImpactPage(page){const state=hcSettingsState;if(!hcLive(state)||!state.preview?.token||state.busy)return;state.busy=true;try{const data=await api('GET',`/api/holiday-calendar/import/previews/${encodeURIComponent(state.preview.token)}?page=${page}`);if(hcLive(state))hcRenderImpacts(data);}catch(e){if(hcLive(state))hcMessage(e.message);}finally{state.busy=false;}}
async function hcCommitImport(){
    const state=hcSettingsState;if(!hcLive(state)||state.busy||!state.preview?.token)return;if(!document.getElementById('hcComplete')?.checked){hcMessage('请先核对并确认所选年度的完整安排。');return;}
    state.busy=true;document.getElementById('hcCommit').disabled=true;document.getElementById('hcCancelPreview').disabled=true;hcMessage('正在保存年度安排…');
    try{const result=await api('POST','/api/holiday-calendar/import/commit',{token:state.preview.token,confirm_complete:true});if(!hcLive(state))return;state.preview=null;invalidateViewCache('calendar');await showHolidayCalendarSettings(state.year);hcMessage(result.message||(result.changed?'年度安排已更新，相关事项请复核。':'安排未变化'));}
    catch(error){if(hcLive(state)){hcMessage(error.message||'更新失败，请重新预览后重试。');if(document.getElementById('hcCommit'))document.getElementById('hcCommit').disabled=false;if(document.getElementById('hcCancelPreview'))document.getElementById('hcCancelPreview').disabled=false;}}
    finally{state.busy=false;}
}
async function hcLoadHistory(){const state=hcSettingsState;if(!hcLive(state))return;try{const data=await api('GET',`/api/holiday-calendar/history?year=${state.year}`);if(!hcLive(state))return;state.historyLoaded=true;const items=Array.isArray(data.items)?data.items:[];document.getElementById('hcHistoryBody').innerHTML=items.length?items.map((x,i)=>`<article class="deadline-impact"><strong>${escHtml(x.created_at||'历史安排')}</strong><p>${escHtml(x.actor||'')} · ${escHtml(x.operation==='restore'?'恢复安排':x.operation==='import'?'导入安排':x.operation||'')} · ${escHtml(hcText(x.summary))}</p><button class="btn btn-secondary" data-hc-restore="${i}" ${window.CURRENT_USER?.is_admin?'':'disabled'}>预览恢复此安排</button></article>`).join(''):'<p class="deadline-muted">暂无历史变更。</p>';document.querySelectorAll('[data-hc-restore]').forEach(el=>el.addEventListener('click',()=>hcRestorePreview(items[Number(el.dataset.hcRestore)].revision)));}catch(e){if(hcLive(state)){hcMessage(e.message);state.historyLoaded=false;}}}
async function hcRestorePreview(revision){const state=hcSettingsState;if(!hcLive(state)||state.busy)return;state.busy=true;try{const data=await api('POST','/api/holiday-calendar/restore/preview',{year:state.year,revision,base_revision:state.data.local_revision??0});if(hcLive(state))hcShowPreview(data);}catch(e){if(hcLive(state))hcMessage(e.message);}finally{state.busy=false;}}
async function hcSavePreferences(){const state=hcSettingsState;if(!hcLive(state)||state.busy)return;state.busy=true;try{await api('POST','/api/holiday-calendar/preferences',{use_national_workdays:document.getElementById('holidayUseWorkdays').checked});if(hcLive(state))hcMessage('邮件发送安排已保存。');}catch(e){if(hcLive(state))hcMessage(e.message);}finally{state.busy=false;}}
async function updateHolidayCalendar(year){return showHolidayCalendarSettings(year);}
var calendarGuaranteeRequest=0;
async function openCalendarGuarantee(pid,registrationId=null,action='review') {
    const ticket=++calendarGuaranteeRequest;
    const selection=typeof projectSelectionVersion==='undefined'?null:++projectSelectionVersion;
    let navigation=typeof projectNavigationVersion==='undefined'?null:projectNavigationVersion;
    if(typeof promoteProjectPrefetch==='function')promoteProjectPrefetch(Number(pid));
    showModal('保证金处理',`<div class="tg-open-feedback" data-guarantee-request="${ticket}" role="status"><span class="tg-loading-ring" aria-hidden="true"></span><strong>正在读取待处理记录</strong><p class="tg-muted">正在核对供应商、金额和最新处理状态。</p></div>`);
    const relevant=()=>ticket===calendarGuaranteeRequest && document.querySelector(`[data-guarantee-request="${ticket}"]`) && (!document.getElementById('modalOverlay')||document.getElementById('modalOverlay').classList.contains('open')) && (selection===null||selection===projectSelectionVersion) && (navigation===null||navigation===projectNavigationVersion);
    try {
        if(typeof requestProjectDetail==='function'){
            const result=await requestProjectDetail(pid);
            if(!relevant())return;
            if(!result.accepted)throw new Error('记录已更新，请重新加载');
            if(typeof renderProjectDetail==='function')renderProjectDetail(result.project,true);
            else currentProject=result.project;
            if(navigation!==null)navigation=projectNavigationVersion;
        }else{await selectProject(pid);if(!relevant())return;}
        const p=currentProject;if(String(p?.id)!==String(pid))return;
        if(!p.tender_guarantee)await loadTenderGuarantee(p);
        if(!relevant())return;
        if(typeof editingStageKey!=='undefined')editingStageKey=null;
        if(registrationId)return showGuaranteeCalendarTask(registrationId,action);
        showModal('保证金退还',renderGuaranteeSection(p)+renderParticipationSection(p,{}));
    }catch(error){
        if(!relevant())return;
        if(document.querySelector(`[data-guarantee-request="${ticket}"]`))showModal('暂时无法读取保证金记录',`<div class="modal-form"><p>记录未能加载，请检查连接后重试。未修改任何保证金数据。</p><button class="btn btn-primary" onclick="openCalendarGuarantee(${Number(pid)},${Number(registrationId)||null},'${action==='refund'?'refund':'review'}')">重新加载</button></div>`);
        toast(error.message||'暂时无法打开保证金记录','error');
    }
}
function refundCountdown(value,now=new Date()) {
    if(!value)return '';
    const deadline=new Date(value.includes('T')?value:value+'T23:59:59');
    if(!Number.isFinite(deadline.getTime()))return '';
    const minutes=Math.ceil((deadline-now)/60000);
    if(minutes<0)return `已逾期 ${Math.floor(-minutes/1440)} 天 ${Math.floor(-minutes%1440/60)} 小时`;
    return `剩余 ${Math.floor(minutes/1440)} 天 ${Math.floor(minutes%1440/60)} 小时 ${minutes%60} 分`;
}
setInterval(()=>{document.querySelectorAll('[data-refund-deadline]').forEach(el=>{el.textContent=refundCountdown(el.dataset.refundDeadline);});},60000);
