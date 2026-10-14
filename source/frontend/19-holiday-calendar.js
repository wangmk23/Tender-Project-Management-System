// ── 国家节假日日历与保证金日程 ──
async function showHolidayCalendarSettings(year=calendarYear) {
    try {
        const data=await api('GET',`/api/holiday-calendar?year=${Number(year)}`);
        const editable=Boolean(window.CURRENT_USER?.is_admin);
        showModal('放假调休安排',`<div class="modal-form"><div class="form-group"><label for="holidaySettingsYear">查看年度</label><select id="holidaySettingsYear" onchange="showHolidayCalendarSettings(Number(this.value))">${[year-1,year,year+1].map(y=>`<option ${y===year?'selected':''}>${Number(y)}</option>`).join('')}</select></div><div class="settings-note ${data.confirmed?'':'warning'}">${data.confirmed?`${Number(year)}年安排已核验 · 数据版本 ${Number(data.version)} · 公布日期 ${escHtml(data.updated_at||'')}`:'该年度安排尚未确认，不会按普通周末估算保证金工作日期限。'}</div>${data.confirmed?`<p class="tg-muted">${escHtml(data.document||'')} · <a href="${escHtml(data.source_url)}" target="_blank" rel="noopener noreferrer">官方来源</a></p><div class="holiday-settings-list">${(data.holidays||[]).filter((x,i,list)=>i===0||list[i-1].name!==x.name).map(x=>`<p><strong>${escHtml(x.name)}</strong><span>${(data.holidays||[]).filter(d=>d.name===x.name).map(d=>escHtml(d.date.slice(5))).join('、')}</span></p>`).join('')}<p><strong>调休补班</strong><span>${(data.workdays||[]).map(d=>escHtml(d.slice(5))).join('、')}</span></p></div>`:''}<p class="tg-muted">程序每周检查经官方核验的数据更新，离线继续使用本地安排。更新影响既有保证金截止日期时，须复核后调整。</p><button class="btn btn-secondary" ${editable?'':'disabled'} onclick="updateHolidayCalendar(${Number(year)})">检查该年度更新</button><hr><label class="inline-check"><input id="holidayUseWorkdays" type="checkbox" ${data.use_national_workdays?'checked':''} ${editable?'':'disabled'}> 邮件仅在国家安排的工作日发送（含调休补班）</label><p class="tg-muted">启用后代替邮件设置中的星期筛选；未确认年度暂停此类发送。保证金工作日期限始终使用国家放假调休安排。</p></div>`,editable?async()=>{
            await api('POST','/api/holiday-calendar/preferences',{use_national_workdays:document.getElementById('holidayUseWorkdays').checked});
            closeModal();toast('提醒日历设置已保存','success');
        }:null);
    } catch(error){toast(error.message,'error');}
}
async function updateHolidayCalendar(year) {
    const dismiss=toast('正在核对年度安排…','loading');
    try{const result=await api('POST','/api/holiday-calendar/update',{year});toast(result.message||'年度安排已核对','success');invalidateViewCache('calendar');await showHolidayCalendarSettings(year);}
    catch(error){toast(error.message,'error');}
    finally{if(typeof dismiss==='function')dismiss();}
}
async function openCalendarGuarantee(pid) {
    if(!await selectProject(pid))return;
    const p=currentProject;await loadTenderGuarantee(p);
    const stage=(p.stages||[]).find(s=>!s.template_removed&&stageHasModule(s,'deposit_refund',p));
    if(stage)openStageSlide(stage.key);
    else showModal('保证金退还',renderGuaranteeSection(p)+renderParticipationSection(p,{}));
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
