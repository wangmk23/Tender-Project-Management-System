// ── Theme-aware single-select popup; native fields remain the data source ──
(() => {
    let current = null;
    const eligible = el => el instanceof HTMLSelectElement && !el.matches(':disabled') && !el.multiple && el.size <= 1 && !el.closest('.luckysheet');
    function close() {
        if (!current) return;
        const {select, popup, observer, attributes} = current;
        current = null;
        observer.disconnect();
        popup.remove();
        for (const [name, value] of attributes) {
            if (value === null) select.removeAttribute(name);
            else select.setAttribute(name, value);
        }
    }
    function activate(index) {
        const s = current;
        if (!s || !s.items.length) return;
        s.active = Math.max(0, Math.min(index, s.items.length - 1));
        s.items.forEach((item, i) => item.element.classList.toggle('active', i === s.active));
        const item = s.items[s.active];
        s.select.setAttribute('aria-activedescendant', item.element.id);
        item.element.scrollIntoView({block:'nearest'});
    }
    function choose() {
        if (!current || !current.items.length) return close();
        const {select, items, active} = current;
        const index = items[active].index;
        const option = select.options[index];
        if (!eligible(select) || !option || option.disabled || option.parentElement.disabled || option.hidden) return close();
        const changed = select.selectedIndex !== index;
        close();
        select.selectedIndex = index;
        if (changed) {
            select.dispatchEvent(new Event('input', {bubbles:true}));
            select.dispatchEvent(new Event('change', {bubbles:true}));
        }
    }
    function open(select) {
        close();
        const popup = document.createElement('div');
        popup.className = 'themed-select-popup';
        popup.id = 'themedSelectPopup';
        popup.setAttribute('role', 'listbox');
        popup.setAttribute('aria-label', select.getAttribute('aria-label') || select.labels?.[0]?.textContent || '选项');
        const items = [];
        let group = null;
        Array.from(select.options).forEach((option, index) => {
            if (option.hidden || option.parentElement.hidden) return;
            const parent = option.parentElement;
            if (parent.tagName === 'OPTGROUP' && parent !== group) {
                group = parent;
                const heading = document.createElement('div');
                heading.className = 'themed-select-group';
                heading.textContent = parent.label;
                popup.appendChild(heading);
            }
            const el = document.createElement('div');
            el.className = 'themed-select-option';
            el.id = 'themedSelectOption' + index;
            el.setAttribute('role', 'option');
            el.setAttribute('aria-selected', String(option.selected));
            el.textContent = option.label;
            if (window.PMIcons && !select.closest('[data-ui-content],[data-preserve-text],.logo')) {
                window.PMIcons.label(el,option.label,select.matches('[data-stage-template-field="icon"]')?option.label.trim():'');
                el.setAttribute('aria-label',option.label);
            }
            if (option.disabled || parent.disabled) el.setAttribute('aria-disabled', 'true');
            else {
                const position = items.length;
                items.push({element:el, index, label:option.label});
                el.addEventListener('pointermove', () => activate(position));
                el.addEventListener('click', () => { activate(position); choose(); });
            }
            popup.appendChild(el);
        });
        popup.addEventListener('mousedown', event => event.preventDefault());
        document.body.appendChild(popup);
        const attributes = ['aria-expanded','aria-controls','aria-activedescendant'].map(name => [name,select.getAttribute(name)]);
        const observer = new MutationObserver(records => {
            if (!select.isConnected || !eligible(select) || !select.getClientRects().length || records.some(record => select.contains(record.target))) close();
        });
        current = {select, popup, items, active:0, observer, attributes, search:'', typedAt:0};
        select.focus({preventScroll:true});
        select.setAttribute('aria-expanded', 'true');
        select.setAttribute('aria-controls', popup.id);
        const rect = select.getBoundingClientRect();
        const width = Math.min(Math.max(rect.width, 160), innerWidth - 16);
        popup.style.width = width + 'px';
        popup.style.left = Math.max(8, Math.min(rect.left, innerWidth - width - 8)) + 'px';
        const below = innerHeight - rect.bottom - 12, above = rect.top - 12;
        const upwards = below < 220 && above > below;
        popup.style.maxHeight = Math.max(40, Math.min(320, upwards ? above : below)) + 'px';
        if (upwards) popup.style.bottom = (innerHeight - rect.top + 4) + 'px';
        else popup.style.top = (rect.bottom + 4) + 'px';
        activate(Math.max(0, items.findIndex(item => item.index === select.selectedIndex)));
        observer.observe(document.body, {childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['disabled','class','hidden','selected','label','value']});
    }
    document.addEventListener('mousedown', event => {
        if (event.button !== 0) return;
        if (eligible(event.target)) {
            event.preventDefault();
            const same = current?.select === event.target;
            close();
            if (!same) open(event.target);
        } else if (current && !current.popup.contains(event.target)) close();
    }, true);
    window.addEventListener('keydown', event => {
        const select = event.target;
        if (!current) {
            if (eligible(select) && ['ArrowDown','ArrowUp','Enter',' ','F4'].includes(event.key)) {
                event.preventDefault(); event.stopImmediatePropagation(); open(select);
            }
            return;
        }
        if (event.key === 'Tab') { choose(); return; }
        if (select !== current.select) { close(); return; }
        event.stopImmediatePropagation();
        if (event.key === 'Escape' || event.key === 'F4' || (event.altKey && event.key === 'ArrowUp')) { event.preventDefault(); close(); }
        else if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); choose(); }
        else if (['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','PageDown','PageUp'].includes(event.key)) {
            event.preventDefault();
            const step = event.key === 'PageDown' ? 8 : event.key === 'PageUp' ? -8 : ['ArrowDown','ArrowRight'].includes(event.key) ? 1 : -1;
            activate(event.key === 'Home' ? 0 : event.key === 'End' ? current.items.length - 1 : current.active + step);
        } else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
            event.preventDefault();
            const now = Date.now();
            current.search = (now - current.typedAt > 700 ? '' : current.search) + event.key.toLocaleLowerCase();
            current.typedAt = now;
            const index = current.items.findIndex(item => item.label.toLocaleLowerCase().startsWith(current.search));
            if (index >= 0) activate(index);
        }
    }, true);
    document.addEventListener('focusin', event => { if (current && event.target !== current.select) close(); });
    document.addEventListener('scroll', event => { if (current && !current.popup.contains(event.target)) close(); }, true);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
})();
