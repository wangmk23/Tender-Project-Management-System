// ── Theme-aware combined date and minute picker; preserved fields own the values ──
(() => {
    const controls = new WeakMap();
    let active = null, sequence = 0, scheduled = false;
    const pad = value => String(value).padStart(2, '0');
    function localDate(year, month, day) {
        const value = new Date(0);
        value.setFullYear(year, month, day);
        value.setHours(12, 0, 0, 0);
        return value;
    }
    const dateText = date => `${String(date.getFullYear()).padStart(4,'0')}-${pad(date.getMonth()+1)}-${pad(date.getDate())}`;
    function parseDate(value) {
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value || '');
        if (!match || Number(match[1]) < 1) return null;
        const date = localDate(Number(match[1]), Number(match[2])-1, Number(match[3]));
        return dateText(date) === value ? date : null;
    }
    function button(text, label, action, className = '') {
        const element = document.createElement('button');
        element.type = 'button';
        element.textContent = text;
        element.className = className;
        if (label) element.setAttribute('aria-label', label);
        if (action) element.addEventListener('click', action);
        return element;
    }
    function update(control) {
        const value = control.date.value;
        const time = control.time.value;
        const text = value ? `${value}${time ? '  '+time : ' · 仅日期'}` : '选择日期和时间';
        if (control.caption.textContent !== text) control.caption.textContent = text;
        control.trigger.classList.toggle('empty', !value);
        const disabled = control.date.disabled || control.time.disabled;
        if (control.trigger.disabled !== disabled) control.trigger.disabled = disabled;
    }
    function close(restoreFocus = true) {
        if (!active) return;
        const previous = active;
        active = null;
        previous.popup.remove();
        if (typeof releaseDialogFocus === 'function') releaseDialogFocus(previous.popup);
        previous.control.trigger.setAttribute('aria-expanded', 'false');
        previous.control.trigger.removeAttribute('aria-controls');
        if (restoreFocus && previous.control.trigger.isConnected && !previous.control.trigger.disabled) {
            previous.control.trigger.focus({preventScroll:true});
        }
    }
    function position() {
        if (!active) return;
        const {popup, control} = active;
        if (!control.trigger.isConnected || !control.trigger.getClientRects().length || control.trigger.disabled) return close(false);
        const parentDialog = control.pair.closest('.modal,.slide-panel,#batchAdvanceDialog');
        if (parentDialog && !parentDialog.classList.contains('open')) return close(false);
        const rect = control.trigger.getBoundingClientRect();
        const width = Math.min(460, innerWidth - 16);
        popup.style.width = width + 'px';
        popup.style.maxHeight = Math.max(180, innerHeight - 16) + 'px';
        const height = popup.getBoundingClientRect().height;
        popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
        const below = rect.bottom + 6;
        const top = below + height <= innerHeight - 8 ? below : rect.top - height - 6;
        popup.style.top = Math.max(8, Math.min(top, innerHeight - height - 8)) + 'px';
    }
    function apply() {
        if (!active) return;
        const {control, date, time, originalDate, originalTime} = active;
        if (control.trigger.disabled) return close();
        // A background refresh must not be replaced with a stale picker draft.
        if (control.date.value !== originalDate || control.time.value !== originalTime) return close();
        if (time && !date) {
            active.message.textContent = '请先选择日期';
            return;
        }
        const changedDate = control.date.value !== date;
        const changedTime = control.time.value !== time;
        control.date.value = date;
        control.time.value = time;
        update(control);
        close();
        for (const field of [control.date, control.time]) {
            if ((field === control.date && changedDate) || (field === control.time && changedTime)) {
                field.dispatchEvent(new Event('input', {bubbles:true}));
            }
        }
        // Both values are already committed before the existing save handler runs.
        if (changedDate || changedTime) (changedDate ? control.date : control.time).dispatchEvent(new Event('change', {bubbles:true}));
    }
    function renderCalendar() {
        const state = active;
        if (!state) return;
        const {year, month, days, monthTitle} = state;
        monthTitle.textContent = `${year}年${month+1}月`;
        const first = localDate(year, month, 1);
        const offset = (first.getDay()+6)%7;
        const today = dateText(new Date());
        const elements = [];
        for (let index = 0; index < 42; index++) {
            const date = localDate(year, month, 1-offset+index);
            const text = dateText(date);
            const cell = button(String(date.getDate()), text, () => selectDate(text), 'pm-datetime-day');
            cell.dataset.date = text;
            cell.setAttribute('role', 'gridcell');
            cell.setAttribute('aria-selected', String(text === state.date));
            cell.classList.toggle('selected', text === state.date);
            cell.classList.toggle('outside', date.getMonth() !== month);
            cell.classList.toggle('today', text === today);
            cell.disabled = date.getFullYear() < 1 || date.getFullYear() > 9999;
            cell.tabIndex = text === (parseDate(state.date) && parseDate(state.date).getMonth()===month && parseDate(state.date).getFullYear()===year ? state.date : dateText(first)) ? 0 : -1;
            elements.push(cell);
        }
        days.replaceChildren(...elements);
    }
    function selectDate(value) {
        if (!active) return;
        const date = parseDate(value);
        if (!date) return;
        active.date = value;
        active.year = date.getFullYear();
        active.month = date.getMonth();
        renderCalendar();
        renderSelection();
        active.days.querySelector(`[data-date="${value}"]`)?.focus({preventScroll:true});
        position();
    }
    function shiftMonth(amount) {
        if (!active) return;
        const next = localDate(active.year, active.month + amount, 1);
        if (next.getFullYear() < 1 || next.getFullYear() > 9999) return;
        active.year = next.getFullYear();active.month = next.getMonth();
        renderCalendar();
    }
    function chooseTime(part, value) {
        if (!active) return;
        active[part] = value;
        active.time = `${active.hour}:${active.minute}`;
        renderSelection();
    }
    function renderSelection() {
        const state = active;
        if (!state) return;
        state.message.textContent = state.date ? `${state.date}${state.time ? '  '+state.time : ' · 仅日期'}` : '请选择日期，可同时选择时分';
        for (const part of ['hour','minute']) {
            state.popup.querySelectorAll(`[data-${part}]`).forEach(option => {
                const selected = !!state.time && option.dataset[part] === state[part];
                option.classList.toggle('selected', selected);
                option.setAttribute('aria-selected', String(selected));
                option.tabIndex = option.dataset[part] === state[part] ? 0 : -1;
            });
        }
    }
    function open(control) {
        if (control.trigger.disabled) return;
        if (active?.control === control) return close();
        close(false);
        const originalDate = control.date.value, originalTime = control.time.value;
        const now = new Date(), shown = parseDate(originalDate) || now;
        const popup = document.createElement('div');
        popup.className = 'pm-datetime-popup open';popup.id = 'pmDateTimePopup';
        popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','true');
        popup.setAttribute('aria-label', control.label);
        const header = document.createElement('div');header.className = 'pm-datetime-head';
        const title = document.createElement('strong');title.textContent = control.label;
        header.append(title,button('×','关闭日期时间选择',()=>close(),'pm-datetime-close'));
        const body = document.createElement('div');body.className = 'pm-datetime-body';
        const calendar = document.createElement('div');calendar.className = 'pm-datetime-calendar';
        const toolbar = document.createElement('div');toolbar.className = 'pm-datetime-month';
        const monthTitle = document.createElement('strong');
        toolbar.append(button('‹','上个月',()=>shiftMonth(-1)),monthTitle,button('›','下个月',()=>shiftMonth(1)));
        const weekdays = document.createElement('div');weekdays.className = 'pm-datetime-weekdays';weekdays.setAttribute('aria-hidden','true');
        for (const day of ['一','二','三','四','五','六','日']) {const span=document.createElement('span');span.textContent=day;weekdays.append(span);}
        const days = document.createElement('div');days.className = 'pm-datetime-days';days.setAttribute('role','grid');days.setAttribute('aria-label','选择日期');
        calendar.append(toolbar,weekdays,days);
        const timePanel = document.createElement('div');timePanel.className='pm-datetime-time';
        for (const [part,count,label] of [['hour',24,'小时'],['minute',60,'分钟']]) {
            const column=document.createElement('div');column.className='pm-datetime-time-column';
            const heading=document.createElement('span');heading.textContent=label;
            const list=document.createElement('div');list.className='pm-datetime-time-list';list.dataset.timePart=part;
            list.setAttribute('role','listbox');list.setAttribute('aria-label',label);
            for (let index=0;index<count;index++) {
                const value=pad(index);const option=button(value,`${value}${part==='hour'?'时':'分'}`,()=>chooseTime(part,value));
                option.dataset[part]=value;option.setAttribute('role','option');list.append(option);
            }
            column.append(heading,list);timePanel.append(column);
        }
        body.append(calendar,timePanel);
        const shortcuts=document.createElement('div');shortcuts.className='pm-datetime-shortcuts';
        shortcuts.append(button('现在',null,()=>{
            const now=new Date();active.hour=pad(now.getHours());active.minute=pad(now.getMinutes());
            active.time=`${active.hour}:${active.minute}`;selectDate(dateText(now));
        }),button('仅日期',null,()=>{active.time='';renderSelection();}),button('清除',null,()=>{active.date='';active.time='';renderCalendar();renderSelection();}));
        const message=document.createElement('div');message.className='pm-datetime-summary';message.setAttribute('aria-live','polite');
        const footer=document.createElement('div');footer.className='pm-datetime-footer';
        footer.append(button('取消',null,()=>close(),'btn btn-secondary'),button('确定',null,apply,'btn btn-primary'));
        popup.append(header,body,shortcuts,message,footer);
        active={control,popup,days,monthTitle,message,date:originalDate,time:originalTime,originalDate,originalTime,
            year:shown.getFullYear(),month:shown.getMonth(),hour:originalTime.slice(0,2)||pad(now.getHours()),minute:originalTime.slice(3,5)||pad(now.getMinutes())};
        control.trigger.setAttribute('aria-expanded','true');control.trigger.setAttribute('aria-controls',popup.id);
        document.body.append(popup);renderCalendar();renderSelection();position();
        if (typeof activateDialogFocus === 'function') activateDialogFocus(popup,()=>close());
        for (const part of ['hour','minute']) popup.querySelector(`[data-${part}="${active[part]}"]`)?.scrollIntoView({block:'nearest'});
        days.querySelector('[tabindex="0"]')?.focus({preventScroll:true});
    }
    function enhance(pair) {
        const known=controls.get(pair);
        if (known) return update(known);
        const date=pair.querySelector('input[type="date"]'),time=pair.querySelector('input[type="time"]');
        if (!date || !time) return;
        const label=date.labels?.[0];
        const name=label?.getAttribute('for')===date.id ? label.textContent.trim() : date.getAttribute('aria-label') || '日期时间';
        const trigger=button('',null,null,'pm-datetime-trigger');trigger.id='pmDateTimeControl'+(++sequence);
        trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',name);
        const caption=document.createElement('span');caption.className='pm-datetime-caption';
        const icon=document.createElement('span');icon.setAttribute('data-ui-icon','📅');icon.setAttribute('aria-hidden','true');
        trigger.append(caption,icon);pair.append(trigger);pair.dataset.datetimeEnhanced='true';
        date.tabIndex=-1;time.tabIndex=-1;
        if (label?.getAttribute('for')===date.id) label.htmlFor=trigger.id;
        const control={pair,date,time,trigger,caption,label:name};controls.set(pair,control);update(control);
        trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(control);});
        for (const field of [date,time]) for (const event of ['input','change']) field.addEventListener(event,()=>update(control));
    }
    function refresh() {
        document.querySelectorAll('.stage-minute-pair').forEach(enhance);
        if (active) position();
    }
    document.addEventListener('pointerdown',event=>{
        if (active && !active.popup.contains(event.target) && !active.control.pair.contains(event.target)) close(false);
    },true);
    window.addEventListener('keydown',event=>{
        if (!active) return;
        if (event.key==='Escape') {event.preventDefault();event.stopImmediatePropagation();close();return;}
        if (event.key==='Tab') {
            const fields=[...active.popup.querySelectorAll('button:not(:disabled)')].filter(field=>field.tabIndex>=0);
            const index=fields.indexOf(document.activeElement);
            if (index<0 || (!event.shiftKey && index===fields.length-1) || (event.shiftKey && index===0)) {
                event.preventDefault();fields[event.shiftKey?fields.length-1:0]?.focus();
            }
            event.stopImmediatePropagation();return;
        }
        const target=event.target;
        if (target.dataset.date && ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) {
            event.preventDefault();event.stopImmediatePropagation();
            const date=parseDate(target.dataset.date);const amount={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7}[event.key];
            selectDate(dateText(localDate(date.getFullYear(),date.getMonth(),date.getDate()+amount)));
        }
        const part=target.hasAttribute('data-hour')?'hour':target.hasAttribute('data-minute')?'minute':null;
        if (part && ['ArrowUp','ArrowDown','Home','End'].includes(event.key)) {
            event.preventDefault();event.stopImmediatePropagation();const max=part==='hour'?23:59;
            const value=event.key==='Home'?0:event.key==='End'?max:Math.max(0,Math.min(max,Number(target.dataset[part])+(event.key==='ArrowUp'?-1:1)));
            chooseTime(part,pad(value));active.popup.querySelector(`[data-${part}="${pad(value)}"]`)?.focus();
        }
    },true);
    window.addEventListener('resize',position);
    document.addEventListener('scroll',event=>{if(active && !active.popup.contains(event.target))position();},true);
    const observer=new MutationObserver(()=>{
        if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;refresh();});
    });
    function start(){refresh();observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','value','class','hidden']});}
    window.PMDateTime={refresh,close:()=>close()};
    if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
