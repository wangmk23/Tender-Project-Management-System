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
    function icon(name) {
        const paths = {previous:'M15 6l-6 6 6 6',next:'M9 6l6 6-6 6',close:'M6 6l12 12M18 6 6 18',calendar:'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',time:'M12 7v5l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0'};
        const element = (name === 'calendar' || name === 'time') && window.PMIcons?.create(name === 'time' ? '⏰' : '📅')
            || document.createElementNS('http://www.w3.org/2000/svg','svg');
        element.classList.add('pm-temporal-icon');
        element.setAttribute('viewBox','0 0 24 24');element.setAttribute('aria-hidden','true');element.setAttribute('focusable','false');
        if (!element.childNodes.length) {
            element.setAttribute('fill','none');element.setAttribute('stroke','currentColor');element.setAttribute('stroke-width','1.7');
            element.setAttribute('stroke-linecap','round');element.setAttribute('stroke-linejoin','round');
            const path = document.createElementNS('http://www.w3.org/2000/svg','path');path.setAttribute('d',paths[name]);element.append(path);
        }
        return element;
    }
    function iconButton(name, label, action, className = '') {
        const element=button('',label,action,className);element.append(icon(name));return element;
    }
    function values(control) {
        if (control.kind === 'pair') return {date:control.date.value,time:control.time.value};
        const value=control.field.value;
        if (control.kind === 'date') return {date:value,time:''};
        if (control.kind === 'time') return {date:'',time:value};
        const [date='',time='']=value.split('T');return {date,time};
    }
    function fields(control) { return control.kind === 'pair' ? [control.date,control.time] : [control.field]; }
    function browserValue(value) {return String(value).replace(/(\.\d{3})\d+$/,'$1');}
    function preserveServerPrecision(field) {
        const raw=field.getAttribute('value') || '';
        if (field.value || !['time','datetime-local'].includes(field.type)
            || !/^(?:\d{4}-\d{2}-\d{2}T)?\d{2}:\d{2}:\d{2}\.\d{4,6}$/.test(raw)) return;
        const probe=field.cloneNode(false);probe.value=browserValue(raw);
        if (!probe.value) return;
        // HTML fields only accept milliseconds. Keep the server's original precision
        // for the existing JavaScript save handlers while native validation uses the
        // equivalent browser representation. IDs and input types stay unchanged.
        const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
        field.defaultValue=browserValue(raw);descriptor.set.call(field,browserValue(raw));
        const initialNative=descriptor.get.call(field);
        let precise=raw,native=initialNative;
        Object.defineProperty(field,'value',{configurable:true,
            get(){const actual=descriptor.get.call(this);return actual===native?precise:actual===initialNative?raw:actual;},
            set(value){descriptor.set.call(this,browserValue(value));native=descriptor.get.call(this);precise=native?String(value):'';},
        });
    }
    function dateAllowed(control,value) {
        if (!parseDate(value)) return false;
        const field=control.kind==='pair' ? control.date : control.field;
        const min=(field.min || '').slice(0,10),max=(field.max || '').slice(0,10);
        if (min && value<min || max && value>max) return false;
        if (field.type==='date') {const probe=field.cloneNode(false);probe.value=value;return probe.checkValidity();}
        return true;
    }
    function update(control) {
        const {date:value,time}=values(control);
        const text = control.kind === 'time' ? time || '选择时间' : value
            ? `${value}${time ? '  '+time : control.kind === 'pair' ? ' · 仅日期' : ''}`
            : control.kind === 'date' ? '选择日期' : '选择日期和时间';
        if (control.caption.textContent !== text) control.caption.textContent = text;
        control.trigger.classList.toggle('empty', !(value || time));
        const disabled = fields(control).some(field=>field.disabled || field.readOnly);
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
        const desired=control.kind==='date'?324:control.kind==='time'?(active.seconds?280:236):active.seconds?520:460;
        const width = Math.min(desired, innerWidth - 16);
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
        const current=values(control);
        if (current.date !== originalDate || current.time !== originalTime) return close();
        if (time && !date && control.kind !== 'time') {
            active.message.textContent = '请先选择日期';
            return;
        }
        const changedDate = current.date !== date, changedTime = current.time !== time;
        const edits = control.kind === 'pair' ? [[control.date,date],[control.time,time]]
            : [[control.field,control.kind === 'date' ? date : control.kind === 'time' ? time : date && time ? `${date}T${time}` : '']];
        for (const [field,value] of edits) {
            if (field.value === value) continue;
            const probe=field.cloneNode(false);probe.value=browserValue(value);
            if (!probe.checkValidity()) {active.message.textContent=probe.validationMessage || '请选择符合要求的日期时间';return;}
        }
        const changed=edits.filter(([field,value])=>field.value!==value).map(([field])=>field);
        for (const [field,value] of edits) field.value=value;
        update(control);
        close();
        for (const field of changed) field.dispatchEvent(new Event('input', {bubbles:true}));
        // Both values are already committed before the existing save handler runs.
        if (changedDate || changedTime) changed[0]?.dispatchEvent(new Event('change', {bubbles:true}));
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
            cell.disabled = !dateAllowed(state.control,text);
            cell.tabIndex = -1;
            elements.push(cell);
        }
        const currentMonth=elements.filter(cell=>!cell.disabled && !cell.classList.contains('outside'));
        const focus=currentMonth.find(cell=>cell.dataset.date===state.date) || currentMonth.find(cell=>cell.dataset.date===today)
            || currentMonth[0] || elements.find(cell=>!cell.disabled);
        if(focus)focus.tabIndex=0;
        days.replaceChildren(...elements);
    }
    function selectDate(value) {
        if (!active) return;
        const date = parseDate(value);
        if (!date || !dateAllowed(active.control,value)) return;
        active.date = value;
        if (active.control.kind === 'datetime-local' && !active.time) active.time=composeTime(active);
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
        if (part==='second' && active.second.slice(0,2)===value) value=active.second;
        active[part] = value;
        active.time = composeTime(active);
        renderSelection();
    }
    function composeTime(state) {return `${state.hour}:${state.minute}${state.seconds ? ':'+state.second : ''}`;}
    function renderSelection() {
        const state = active;
        if (!state) return;
        state.message.textContent = state.control.kind === 'time' ? state.time || '请选择时间'
            : state.date ? `${state.date}${state.time ? '  '+state.time : state.control.kind === 'pair' ? ' · 仅日期' : ''}`
            : state.control.kind === 'date' ? '请选择日期' : '请选择日期，可同时选择时分';
        for (const part of ['hour','minute','second']) {
            state.popup.querySelectorAll(`[data-${part}]`).forEach(option => {
                const selected = !!state.time && option.dataset[part] === state[part]?.slice(0,2);
                option.classList.toggle('selected', selected);
                option.setAttribute('aria-selected', String(selected));
                option.tabIndex = option.dataset[part] === state[part]?.slice(0,2) ? 0 : -1;
            });
        }
    }
    function open(control) {
        if (control.trigger.disabled) return;
        if (active?.control === control) return close();
        close(false);
        const {date:originalDate,time:originalTime}=values(control);
        const showDate=control.kind !== 'time',showTime=control.kind !== 'date';
        const timeField=control.kind === 'pair' ? control.time : control.field;
        const seconds=showTime && (originalTime.split(':').length>2
            || timeField.step !== 'any' && Number(timeField.step || 60)>0 && Number(timeField.step || 60)<60);
        const now = new Date(), shown = parseDate(originalDate) || now;
        const popup = document.createElement('div');
        popup.className = 'pm-datetime-popup open';popup.id = 'pmDateTimePopup';
        popup.dataset.temporalKind=control.kind;if(seconds)popup.dataset.seconds='true';
        popup.setAttribute('role','dialog');popup.setAttribute('aria-modal','true');
        popup.setAttribute('aria-label', control.label);
        const header = document.createElement('div');header.className = 'pm-datetime-head';
        const title = document.createElement('strong');title.textContent = control.label;
        header.append(title,iconButton('close','关闭日期时间选择',()=>close(),'pm-datetime-close'));
        const body = document.createElement('div');body.className = 'pm-datetime-body';
        const calendar = document.createElement('div');calendar.className = 'pm-datetime-calendar';
        const toolbar = document.createElement('div');toolbar.className = 'pm-datetime-month';
        const monthTitle = document.createElement('strong');
        toolbar.append(iconButton('previous','上个月',()=>shiftMonth(-1)),monthTitle,iconButton('next','下个月',()=>shiftMonth(1)));
        const weekdays = document.createElement('div');weekdays.className = 'pm-datetime-weekdays';weekdays.setAttribute('aria-hidden','true');
        for (const day of ['一','二','三','四','五','六','日']) {const span=document.createElement('span');span.textContent=day;weekdays.append(span);}
        const days = document.createElement('div');days.className = 'pm-datetime-days';days.setAttribute('role','grid');days.setAttribute('aria-label','选择日期');
        calendar.append(toolbar,weekdays,days);
        const timePanel = document.createElement('div');timePanel.className='pm-datetime-time';
        for (const [part,count,label] of [['hour',24,'小时'],['minute',60,'分钟'],...(seconds ? [['second',60,'秒']] : [])]) {
            const column=document.createElement('div');column.className='pm-datetime-time-column';
            const heading=document.createElement('span');heading.textContent=label;
            const list=document.createElement('div');list.className='pm-datetime-time-list';list.dataset.timePart=part;
            list.setAttribute('role','listbox');list.setAttribute('aria-label',label);
            for (let index=0;index<count;index++) {
                const value=pad(index);const option=button(value,`${value}${part==='hour'?'时':part==='second'?'秒':'分'}`,()=>chooseTime(part,value));
                option.dataset[part]=value;option.setAttribute('role','option');list.append(option);
            }
            column.append(heading,list);timePanel.append(column);
        }
        if(showDate)body.append(calendar);if(showTime)body.append(timePanel);
        const shortcuts=document.createElement('div');shortcuts.className='pm-datetime-shortcuts';
        shortcuts.append(button('现在',null,()=>{
            const now=new Date();active.hour=pad(now.getHours());active.minute=pad(now.getMinutes());
            active.second=pad(now.getSeconds());active.time=showTime?composeTime(active):'';
            if(showDate)selectDate(dateText(now));else renderSelection();
        }));
        if(control.kind === 'pair')shortcuts.append(button('仅日期',null,()=>{active.time='';renderSelection();}));
        shortcuts.append(button('清除',null,()=>{active.date='';active.time='';renderCalendar();renderSelection();}));
        const message=document.createElement('div');message.className='pm-datetime-summary';message.setAttribute('aria-live','polite');
        const footer=document.createElement('div');footer.className='pm-datetime-footer';
        footer.append(button('取消',null,()=>close(),'btn btn-secondary'),button('确定',null,apply,'btn btn-primary'));
        popup.append(header,body,shortcuts,message,footer);
        active={control,popup,days,monthTitle,message,date:originalDate,time:originalTime,originalDate,originalTime,
            year:shown.getFullYear(),month:shown.getMonth(),hour:originalTime.slice(0,2)||pad(now.getHours()),minute:originalTime.slice(3,5)||pad(now.getMinutes()),seconds,second:originalTime.slice(6)||'00'};
        control.trigger.setAttribute('aria-expanded','true');control.trigger.setAttribute('aria-controls',popup.id);
        document.body.append(popup);renderCalendar();renderSelection();position();
        if (typeof activateDialogFocus === 'function') activateDialogFocus(popup,()=>close());
        for (const part of ['hour','minute','second']) popup.querySelector(`[data-${part}="${active[part].slice(0,2)}"]`)?.scrollIntoView({block:'nearest'});
        (showDate ? days.querySelector('[tabindex="0"]') : popup.querySelector('[data-time-part="hour"] [tabindex="0"]'))?.focus({preventScroll:true});
    }
    function enhance(pair) {
        const known=controls.get(pair);
        if (known) return update(known);
        const date=pair.querySelector('input[type="date"]'),time=pair.querySelector('input[type="time"]');
        if (!date || !time) return;
        preserveServerPrecision(time);
        connect({pair,date,time,kind:'pair'},date);
    }
    function enhanceField(field) {
        const known=controls.get(field);
        if (known) return update(known);
        if (field.closest('.stage-minute-pair') || field.hidden || field.closest('[data-preserve-native-temporal],.luckysheet,.doc-preview-body')) return;
        preserveServerPrecision(field);
        const pair=document.createElement('div');pair.className='pm-temporal-field';
        field.before(pair);pair.append(field);
        connect({pair,field,kind:field.type},field);controls.set(field,controls.get(pair));
    }
    function connect(control,date) {
        const {pair}=control;
        const label=date.labels?.[0] || date.closest('.form-group,.setting-field')?.querySelector('label');
        const name=label?.textContent.trim() || date.getAttribute('aria-label') || date.title || (control.kind==='time' ? '时间' : control.kind==='date' ? '日期' : '日期时间');
        const trigger=button('',null,null,'pm-datetime-trigger');trigger.id='pmDateTimeControl'+(++sequence);
        trigger.setAttribute('aria-haspopup','dialog');trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-label',name);
        const caption=document.createElement('span');caption.className='pm-datetime-caption';
        trigger.append(caption,icon(control.kind==='time' ? 'time' : 'calendar'));pair.append(trigger);pair.dataset.datetimeEnhanced='true';
        fields(control).forEach(field=>{field.tabIndex=-1;field.hidden=true;});
        if (label && (!label.htmlFor || label.htmlFor===date.id)) label.htmlFor=trigger.id;
        Object.assign(control,{trigger,caption,label:name});controls.set(pair,control);update(control);
        trigger.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();open(control);});
        for (const field of fields(control)) for (const event of ['input','change']) field.addEventListener(event,()=>update(control));
    }
    function refresh() {
        document.querySelectorAll('.stage-minute-pair').forEach(enhance);
        document.querySelectorAll('input[type="date"],input[type="time"],input[type="datetime-local"]').forEach(enhanceField);
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
        const part=target.hasAttribute('data-hour')?'hour':target.hasAttribute('data-minute')?'minute':target.hasAttribute('data-second')?'second':null;
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
    function start(){refresh();observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','min','max','step','value','class','hidden']});}
    window.PMDateTime={refresh,close:()=>close()};
    if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
