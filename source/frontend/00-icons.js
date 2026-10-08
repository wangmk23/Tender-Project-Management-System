// ── 自绘彩色界面图标：显示层保留业务字段中的原始图标值 ──
(() => {
    'use strict';
    const shapes = {
        inbox: '<path fill="var(--icon-soft)" d="M5 5h14l3 10v5H2v-5z"/><path d="M5 5h14l3 10v5H2v-5l3-10zM2 15h6l2 3h4l2-3h6"/><path d="M12 3v9m-3-3 3 3 3-3"/>',
        document: '<path fill="var(--icon-soft)" d="M5 2h9l5 5v15H5z"/><path d="M5 2h9l5 5v15H5zM14 2v6h5M8 12h8M8 16h6"/>',
        edit: '<path fill="var(--icon-soft)" d="M4 4h13v16H4z"/><path d="M10 4H4v16h15v-8"/><path fill="var(--icon-accent)" d="m10 12 9-9 3 3-9 9-4 1z"/><path d="m10 12 9-9 3 3-9 9-4 1z"/>',
        search: '<circle cx="10" cy="10" r="7" fill="var(--icon-soft)"/><circle cx="10" cy="10" r="7"/><path d="m15 15 6 6"/>',
        check: '<rect x="2" y="2" width="20" height="20" rx="6" fill="var(--icon-main)" stroke="none"/><path d="m7 12 3 3 7-7" stroke="var(--icon-contrast)"/>',
        clipboard: '<rect x="4" y="4" width="16" height="18" rx="3" fill="var(--icon-soft)"/><rect x="4" y="4" width="16" height="18" rx="3"/><rect x="8" y="2" width="8" height="5" rx="2" fill="var(--icon-accent)"/><path d="M8 12h8M8 17h5"/>',
        announcement: '<path fill="var(--icon-soft)" d="M3 9h5l12-5v16L8 15H3z"/><path d="M3 9h5l12-5v16L8 15H3zM8 9v6m1 1 2 6H7l-2-7"/><path d="M23 9v6" stroke="var(--icon-accent)"/>',
        clock: '<circle cx="12" cy="13" r="9" fill="var(--icon-soft)"/><circle cx="12" cy="13" r="9"/><path d="M12 8v5l4 2M4 2 1 5M20 2l3 3"/>',
        target: '<circle cx="11" cy="13" r="9" fill="var(--icon-soft)"/><circle cx="11" cy="13" r="9"/><circle cx="11" cy="13" r="5"/><path d="m11 13 9-9m-1-3v4h4" stroke="var(--icon-accent)"/>',
        chart: '<rect x="3" y="13" width="4" height="8" rx="1" fill="var(--icon-main)" stroke="none"/><rect x="10" y="8" width="4" height="13" rx="1" fill="var(--icon-accent)" stroke="none"/><rect x="17" y="3" width="4" height="18" rx="1" fill="var(--icon-soft)"/><path d="M2 22h20"/>',
        trophy: '<path fill="var(--icon-soft)" d="M6 3h12v8a6 6 0 0 1-12 0z"/><path d="M6 3h12v8a6 6 0 0 1-12 0zM6 5H2v3a5 5 0 0 0 5 5M18 5h4v3a5 5 0 0 1-5 5M12 17v4M7 22h10"/><path d="m12 6 1 2 3 .5-2 2 .5 2.5-2.5-1.5L9.5 13l.5-2.5-2-2 3-.5z" fill="var(--icon-accent)" stroke="none"/>',
        money: '<path fill="var(--icon-soft)" d="m9 3 3 1 3-1 2 4-2 3c7 6 7 12-3 12S2 16 9 10L7 7z"/><path d="m9 3 3 1 3-1 2 4-2 3c7 6 7 12-3 12S2 16 9 10L7 7zM9 10h6m-5 3 2 2 2-2m-2 2v4m-2-2h4"/>',
        card: '<rect x="2" y="5" width="20" height="15" rx="4" fill="var(--icon-soft)"/><rect x="2" y="5" width="20" height="15" rx="4"/><path d="M2 10h20M6 16h4"/><path d="M15 16h3" stroke="var(--icon-accent)"/>',
        archive: '<path fill="var(--icon-soft)" d="m3 7 9-5 9 5v13l-9 3-9-3z"/><path d="m3 7 9-5 9 5v13l-9 3-9-3zM3 7l9 5 9-5M12 12v11"/><path d="m7 4 9 5v5" stroke="var(--icon-accent)"/>',
        warning: '<path fill="var(--icon-soft)" d="M10 3a2 2 0 0 1 4 0l9 17H1z"/><path d="M10 3a2 2 0 0 1 4 0l9 17H1zM12 8v6m0 3v1"/>',
        stop: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="10"/><path d="m5 5 14 14"/>',
        close: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)" stroke="none"/><path d="m8 8 8 8m0-8-8 8"/>',
        dot: '<circle cx="12" cy="12" r="7" fill="var(--icon-main)" stroke="none"/><circle cx="10" cy="10" r="2" fill="var(--icon-accent)" stroke="none"/>',
        people: '<circle cx="9" cy="7" r="4" fill="var(--icon-soft)"/><path d="M2 21v-3a7 7 0 0 1 14 0v3z" fill="var(--icon-soft)"/><circle cx="9" cy="7" r="4"/><path d="M2 21v-3a7 7 0 0 1 14 0v3M18 4a4 4 0 0 1 0 8m1 3a5 5 0 0 1 3 5"/>',
        person: '<circle cx="12" cy="7" r="5" fill="var(--icon-soft)"/><path d="M3 22v-3a9 9 0 0 1 18 0v3z" fill="var(--icon-soft)"/><circle cx="12" cy="7" r="5"/><path d="M3 22v-3a9 9 0 0 1 18 0v3"/>',
        handshake: '<path fill="var(--icon-soft)" d="m2 8 5-3 5 2 5-2 5 3-3 10-6 4-9-6z"/><path d="m2 8 5-3 5 2 5-2 5 3-3 10-6 4-9-6zM12 7l-5 5 3 2 4-3 5 7m-7-4 4 4m-7-1 4 4"/>',
        help: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="10"/><path d="M9 8a3 3 0 1 1 5 2c-2 1-2 2-2 3m0 4v.1"/>',
        calendar: '<rect x="3" y="4" width="18" height="18" rx="3" fill="var(--icon-soft)"/><rect x="3" y="4" width="18" height="18" rx="3"/><path d="M3 10h18M8 2v5m8-5v5M8 14h2m4 0h2m-8 4h2"/>',
        folder: '<path fill="var(--icon-soft)" d="M2 5h8l3 3h9v13H2z"/><path d="M2 5h8l3 3h9v13H2z"/><path d="M2 11h20" stroke="var(--icon-accent)"/>',
        book: '<path fill="var(--icon-soft)" d="M5 2h15v20H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3z"/><path d="M5 2h15v20H5a3 3 0 0 1-3-3V5a3 3 0 0 1 3-3zM6 2v20M10 8h6m-6 4h5"/>',
        eye: '<path fill="var(--icon-soft)" d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z"/><circle cx="12" cy="12" r="3" fill="var(--icon-accent)"/>',
        trash: '<path fill="var(--icon-soft)" d="m5 7 1 15h12l1-15z"/><path d="M3 7h18M8 7V3h8v4m-11 0 1 15h12l1-15M10 11v7m4-7v7"/>',
        refresh: '<path d="M21 8a9 9 0 0 0-16-4L2 7m0-5v5h5M3 16a9 9 0 0 0 16 4l3-3m0 5v-5h-5"/><circle cx="12" cy="12" r="3" fill="var(--icon-accent)" stroke="none"/>',
        mail: '<rect x="2" y="5" width="20" height="15" rx="3" fill="var(--icon-soft)"/><rect x="2" y="5" width="20" height="15" rx="3"/><path d="m3 7 9 7 9-7"/>',
        bolt: '<path fill="var(--icon-accent)" d="M14 1 3 14h7L9 23l12-14h-8z"/><path d="M14 1 3 14h7L9 23l12-14h-8z"/>',
        lock: '<rect x="4" y="10" width="16" height="12" rx="4" fill="var(--icon-soft)"/><rect x="4" y="10" width="16" height="12" rx="4"/><path d="M7 10V7a5 5 0 0 1 10 0v3m-5 5v3"/>',
        image: '<rect x="2" y="3" width="20" height="18" rx="3" fill="var(--icon-soft)"/><rect x="2" y="3" width="20" height="18" rx="3"/><circle cx="8" cy="8" r="2" fill="var(--icon-accent)" stroke="none"/><path d="m3 18 6-6 4 4 4-6 5 8"/>',
        clip: '<path d="m8 14 8-8a3 3 0 0 1 4 4L9 21a5 5 0 0 1-7-7L13 3a7 7 0 0 1 10 10L12 24"/>',
        pin: '<path fill="var(--icon-soft)" d="M5 9a7 7 0 0 1 14 0c0 5-7 13-7 13S5 14 5 9z"/><path d="M5 9a7 7 0 0 1 14 0c0 5-7 13-7 13S5 14 5 9z"/><circle cx="12" cy="9" r="2" fill="var(--icon-accent)"/>',
        chat: '<path fill="var(--icon-soft)" d="M3 3h18v14H9l-6 5z"/><path d="M3 3h18v14H9l-6 5zM7 8h10m-10 4h7"/>',
        computer: '<rect x="2" y="3" width="20" height="14" rx="3" fill="var(--icon-soft)"/><rect x="2" y="3" width="20" height="14" rx="3"/><path d="M12 17v4m-5 1h10"/><path d="M6 7h12" stroke="var(--icon-accent)"/>',
        settings: '<path fill="var(--icon-soft)" d="m9 2-1 4-4 1-2 4 3 3v4l4 3 3-2 4 2 4-3v-4l2-3-2-4-4-1-1-4z"/><path d="m9 2-1 4-4 1-2 4 3 3v4l4 3 3-2 4 2 4-3v-4l2-3-2-4-4-1-1-4z"/><circle cx="12" cy="12" r="4" fill="var(--icon-accent)"/>',
        bell: '<path fill="var(--icon-soft)" d="M5 10a7 7 0 0 1 14 0v6l3 3H2l3-3z"/><path d="M5 10a7 7 0 0 1 14 0v6l3 3H2l3-3zM9 22h6M12 1v2"/>',
        shield: '<path fill="var(--icon-soft)" d="m12 2 9 4v7c0 5-9 10-9 10S3 18 3 13V6z"/><path d="m12 2 9 4v7c0 5-9 10-9 10S3 18 3 13V6z"/><path d="m8 12 3 3 5-6"/>',
        building: '<rect x="4" y="2" width="16" height="20" rx="2" fill="var(--icon-soft)"/><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h1m6 0h1M8 10h1m6 0h1M8 14h1m6 0h1M10 22v-4h4v4"/>',
        palette: '<path fill="var(--icon-soft)" d="M12 2a10 10 0 1 0 0 20h2c2 0 2-3 0-4-2-2 0-4 3-4h3c5-6-2-12-8-12z"/><path d="M12 2a10 10 0 1 0 0 20h2c2 0 2-3 0-4-2-2 0-4 3-4h3c5-6-2-12-8-12z"/><path d="M7 8h.1M12 6h.1M17 8h.1" stroke="var(--icon-accent)" stroke-width="3"/>',
        hourglass: '<path fill="var(--icon-soft)" d="M5 2h14v4l-7 6 7 6v4H5v-4l7-6-7-6z"/><path d="M5 2h14v4l-7 6 7 6v4H5v-4l7-6-7-6z"/><path d="m8 19 4-4 4 4" fill="var(--icon-accent)"/>',
        rocket: '<path fill="var(--icon-soft)" d="M8 16C7 7 14 2 22 2c0 8-5 15-14 14z"/><path d="M8 16C7 7 14 2 22 2c0 8-5 15-14 14zM8 10H3l-2 7h7m6-1v5l-7 2v-7M5 19l-3 3"/><circle cx="16" cy="8" r="2" fill="var(--icon-accent)"/>',
        compass: '<circle cx="12" cy="12" r="10" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="10"/><path fill="var(--icon-accent)" d="m16 8-2 6-6 2 2-6z"/><path d="m16 8-2 6-6 2 2-6z"/>',
        ruler: '<path fill="var(--icon-soft)" d="m2 16 14-14 6 6L8 22z"/><path d="m2 16 14-14 6 6L8 22zM13 5l3 3m-6 0 2 2m-5 1 3 3"/>',
        undo: '<path d="m8 4-6 6 6 6M2 10h12a7 7 0 0 1 0 14"/>',
        download: '<path fill="var(--icon-soft)" d="M3 15h18v7H3z"/><path d="M12 2v13m-5-5 5 5 5-5M3 15v7h18v-7"/>',
        circle: '<circle cx="12" cy="12" r="9" fill="var(--icon-soft)"/><circle cx="12" cy="12" r="9"/>',
        menu: '<path d="M3 6h18M3 12h18M3 18h18"/>',
        chevron: '<path d="m8 4 8 8-8 8"/>',
        plus: '<rect x="2" y="2" width="20" height="20" rx="6" fill="var(--icon-soft)" stroke="none"/><path d="M12 6v12M6 12h12"/>',
    };
    const entries = [
        ['📥','inbox','blue'],['📝✏','edit','blue'],['🔍','search','blue'],['✅✓','check','green'],['📋','clipboard','indigo'],['📢📣','announcement','rose'],['⏰','clock','amber'],['🎯','target','rose'],['📊📈','chart','blue'],['🏆🎉','trophy','amber'],['💰','money','amber'],['💳','card','teal'],['📦','archive','amber'],['⚠❗','warning','amber'],['🚫⛔','stop','rose'],['❌','close','rose'],['✕×','close','neutral'],['🔴','dot','rose'],['🟠','dot','amber'],['🔵','dot','blue'],['👥','people','indigo'],['👤','person','indigo'],['🤝','handshake','teal'],['❓ℹ','help','blue'],['📅','calendar','indigo'],['📁','folder','amber'],['📘📖','book','blue'],['📕','book','rose'],['📙','book','amber'],['📄','document','blue'],['👁','eye','teal'],['🗑','trash','rose'],['🔄🔁♻','refresh','teal'],['✉','mail','indigo'],['⚡','bolt','amber'],['🔒','lock','indigo'],['🖼','image','teal'],['📎','clip','blue'],['📌📍','pin','rose'],['🏷','document','amber'],['💬','chat','teal'],['💻🖥','computer','blue'],['🔧⚙','settings','indigo'],['🔔','bell','amber'],['🛡','shield','teal'],['🏢','building','blue'],['🎨','palette','rose'],['⏳','hourglass','amber'],['🚀','rocket','rose'],['🧭','compass','blue'],['📏','ruler','amber'],['↩↶','undo','neutral'],['☰','menu','neutral'],['▸▶','chevron','neutral'],['+','plus','inherit'],
    ];
    entries.push(['⬇','download','blue']);
    entries.push(['⭕','circle','neutral']);
    const icons = new Map();
    for (const [glyphs, name, tone] of entries) for (const glyph of glyphs) icons.set(glyph, {name, tone});
    function icon(glyph) {
        const found = icons.get(String(glyph).replace(/\uFE0F/g,''));
        if (!found) return null;
        const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('class', 'pm-icon pm-icon--' + found.tone);
        svg.setAttribute('viewBox','0 0 24 24');
        svg.setAttribute('aria-hidden','true');
        svg.setAttribute('focusable','false');
        svg.dataset.icon = found.name;
        svg.innerHTML = shapes[found.name];
        return svg;
    }
    function decorateSlot(slot) {
        if (slot.closest('svg,.logo,[data-ui-content],[data-preserve-text],.luckysheet,.doc-preview-body')) return;
        const value=slot.getAttribute('data-ui-icon');
        if(slot.dataset.pmRendered===value) return;
        slot.dataset.pmRendered=value;
        const image=icon(value);
        slot.replaceChildren();
        if(image) {slot.append(image);slot.setAttribute('aria-hidden','true');}
        else {slot.textContent=value;slot.removeAttribute('aria-hidden');}
    }
    function preview(select) {
        if (select.closest('.logo,[data-ui-content],[data-preserve-text],.luckysheet') || select.multiple || select.size>1 || !select.options.length) return;
        const iconOnly=select.matches('[data-stage-template-field="icon"]');
        if (!iconOnly && !Array.from(select.options).some(option=>leadingIcon(option.label))) {
            const existing=select.parentElement;
            if(existing.classList.contains('pm-icon-select-wrap')){existing.before(select);existing.remove();select.classList.remove('pm-icon-select');}
            return;
        }
        let wrap=select.parentElement;
        if (!wrap.classList.contains('pm-icon-select-wrap')) {
            wrap=document.createElement('span');wrap.className='pm-icon-select-wrap';select.before(wrap);wrap.append(select);
            const display=document.createElement('span');display.className='pm-icon-select-preview';display.setAttribute('aria-hidden','true');wrap.append(display);
            select.classList.add('pm-icon-select');
        }
        const display=wrap.querySelector('.pm-icon-select-preview');
        const value=select.options[select.selectedIndex]?.label || select.value;
        label(display,value,iconOnly?select.value:'');
    }
    function render(root) {
        if (!root || ![1,9,11].includes(root.nodeType)) return;
        if(root.nodeType===1 && root.closest('svg,input,textarea,select,option,.logo,[data-ui-content],[data-preserve-text]')) {if(root.tagName==='SELECT')preview(root);return;}
        if(root.nodeType===1 && root.hasAttribute('data-ui-icon'))decorateSlot(root);
        root.querySelectorAll?.('[data-ui-icon]').forEach(decorateSlot);
        root.querySelectorAll?.('select').forEach(preview);
    }
    const css = `
[data-ui-icon]{display:inline-flex;align-items:center;vertical-align:-3px}[data-ui-icon]>.pm-icon{display:block}
.pm-icon { --icon-main:#416da7;--icon-soft:#dce9fa;--icon-accent:#93b9e8;--icon-contrast:#fff;display:inline-block;width:18px;height:18px;min-width:18px;overflow:visible;vertical-align:-3px;fill:none;stroke:var(--icon-main);stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;pointer-events:none;flex-shrink:0; }
.pm-icon--blue{--icon-main:#3468b0;--icon-soft:#dceafe;--icon-accent:#91b9f2}
.pm-icon--indigo{--icon-main:#6b58ab;--icon-soft:#eae4fa;--icon-accent:#b9a8e6}
.pm-icon--teal{--icon-main:#237c76;--icon-soft:#d9f1ea;--icon-accent:#8acbb7}
.pm-icon--green{--icon-main:#278354;--icon-soft:#def3e5;--icon-accent:#99d8ad}
.pm-icon--amber{--icon-main:#a86b22;--icon-soft:#fff0cd;--icon-accent:#f2c362}
.pm-icon--rose{--icon-main:#ae526b;--icon-soft:#f9e0e8;--icon-accent:#e99db2}
.pm-icon--neutral,.pm-icon--inherit{--icon-main:currentColor;--icon-soft:transparent;--icon-accent:currentColor}
:root[data-theme="dark"] .pm-icon{--icon-contrast:#11241b}
:root[data-theme="dark"] .pm-icon--blue{--icon-main:#93b9f2;--icon-soft:#263f60;--icon-accent:#517fb8}
:root[data-theme="dark"] .pm-icon--indigo{--icon-main:#c4b6eb;--icon-soft:#3d3259;--icon-accent:#8f79c1}
:root[data-theme="dark"] .pm-icon--teal{--icon-main:#8dd7c1;--icon-soft:#1c4840;--icon-accent:#4e9e88}
:root[data-theme="dark"] .pm-icon--green{--icon-main:#8bd4a8;--icon-soft:#244834;--icon-accent:#51a171}
:root[data-theme="dark"] .pm-icon--amber{--icon-main:#efc26b;--icon-soft:#504022;--icon-accent:#b99345}
:root[data-theme="dark"] .pm-icon--rose{--icon-main:#efa9bf;--icon-soft:#52303e;--icon-accent:#b66e89}
.btn-primary .pm-icon--inherit{--icon-main:currentColor}
.current-title [data-ui-icon]>.pm-icon{width:22px;height:22px;min-width:22px;vertical-align:-4px}
.mini-status .pm-icon,.task-card .btn .pm-icon,.status-badge .pm-icon{width:14px;height:14px;min-width:14px;vertical-align:-2px}
.pm-icon-select-wrap{position:relative;display:block;min-width:0}.pm-icon-select-wrap:after{content:"";position:absolute;right:13px;top:calc(50% - 4px);width:6px;height:6px;border-right:1.6px solid var(--text2,#68768a);border-bottom:1.6px solid var(--text2,#68768a);transform:rotate(45deg);pointer-events:none}.pm-icon-select-wrap>select{display:block;width:100%;color:transparent!important;appearance:none}.pm-icon-select-preview{position:absolute;inset:0 30px 0 12px;display:flex;align-items:center;gap:6px;overflow:hidden;white-space:nowrap;color:var(--text);font:inherit;pointer-events:none}.pm-icon-select-preview .pm-icon{width:20px;height:20px;min-width:20px;max-width:20px;max-height:20px;overflow:hidden}.pm-icon-select-wrap:has(select:disabled){opacity:.65}
`;
    function start() {
        if (!document.getElementById('pm-icon-styles')) {const style=document.createElement('style');style.id='pm-icon-styles';style.textContent=css;document.head.append(style);}
        render(document.body);
        const pending=new Set();let scheduled=false;
        const observer=new MutationObserver(records=>{
            for (const record of records) {
                if(record.target.nodeType===1 && record.target.closest('svg.pm-icon,.pm-icon-select-preview,#pm-icon-styles'))continue;
                const select=record.target.nodeType===1?record.target.closest('select'):record.target.parentElement?.closest('select');
                if(select)pending.add(select);
                if(record.type==='attributes')pending.add(record.target);
                else record.addedNodes.forEach(node=>{if(node.nodeType===1 && node.matches('svg.pm-icon,.pm-icon-select-preview,#pm-icon-styles'))return;pending.add(node);});
            }
            if(!pending.size || scheduled)return;scheduled=true;
            queueMicrotask(()=>{scheduled=false;const roots=[...pending];pending.clear();roots.forEach(render);});
        });
        observer.observe(document.body,{childList:true,subtree:true,characterData:true,attributes:true,attributeFilter:['data-ui-icon','selected','label','value']});
        document.addEventListener('change',event=>{if(event.target.tagName==='SELECT')preview(event.target);});
        window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
    }
    function leadingIcon(text) {
        const match=/^([\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B00-\u2BFFℹ][\uFE0F]?)\s+/u.exec(String(text));
        return match && icon(match[1]) ? match : null;
    }
    function label(element,text,defaultGlyph='') {
        const value=String(text);const leading=leadingIcon(value);
        const image=icon(leading?.[1] || defaultGlyph);
        if(!image){element.textContent=value;return;}
        const suffix=leading?value.slice(leading[0].length):defaultGlyph===value?'':value;
        element.replaceChildren(image,document.createTextNode(suffix?' '+suffix:''));
    }
    window.PMIcons={render,create:icon,label,glyphs:[...icons.keys()],names:[...new Set(entries.map(e=>e[1]))]};
    if(document.body)start();else document.addEventListener('DOMContentLoaded',start,{once:true});
})();
