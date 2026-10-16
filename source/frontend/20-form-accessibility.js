// ── 表单标签与持久错误反馈 ──
// Called by renderers after inserting their content; no document-wide observer.
(function () {
    let sequence = 0;
    const feedback = new WeakMap();
    const controls = 'input:not([type="hidden"]),select,textarea';
    function ensureId(element) {
        if (!element.id) {
            let id;
            do { id = `pmFormField${++sequence}`; }
            while (element.ownerDocument.getElementById(id));
            element.id = id;
        }
        return element.id;
    }
    function enhance(root) {
        if (!root?.querySelectorAll) return;
        root.querySelectorAll('label').forEach(label => {
            if (label.control || label.hasAttribute('for')) return;
            const candidates = [...label.parentElement.querySelectorAll(controls)];
            const input = candidates[0];
            if (!input || input.labels?.length || input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby')) return;
            label.htmlFor = ensureId(input);
            // Date/time pairs share the visible field label, with the part named.
            candidates.slice(1).forEach(part => {
                if (!part.labels?.length && !part.hasAttribute('aria-label') && !part.hasAttribute('aria-labelledby') && ['date', 'time'].includes(part.type)) {
                    part.setAttribute('aria-label', `${label.textContent.trim()}（${part.type === 'time' ? '时间' : '日期'}）`);
                }
            });
        });
        root.querySelectorAll('.toggle-row input[type="checkbox"]').forEach(input => {
            if (input.labels?.length || input.hasAttribute('aria-label') || input.hasAttribute('aria-labelledby')) return;
            const row = input.closest('.toggle-row');
            const label = row.querySelector('.toggle-label');
            if (label?.textContent.trim()) input.setAttribute('aria-labelledby', ensureId(label));
            const hint = row.querySelector('small,.setting-hint,.stage-field-hint');
            if (hint && !input.hasAttribute('aria-describedby')) input.setAttribute('aria-describedby', ensureId(hint));
        });
    }
    function clearErrors(form) {
        const state = feedback.get(form);
        if (!state) return;
        state.fields.forEach(({input, error, invalid}) => {
            const descriptions = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(id => id && id !== error.id);
            if (descriptions.length) input.setAttribute('aria-describedby', descriptions.join(' '));
            else input.removeAttribute('aria-describedby');
            if (invalid === null) input.removeAttribute('aria-invalid');
            else input.setAttribute('aria-invalid', invalid);
            error.remove();
        });
        state.summary?.remove();
        feedback.delete(form);
    }
    function showErrors(form, fieldErrors, options = {}) {
        if (!form?.querySelectorAll) return 0;
        clearErrors(form);
        const fields = [];
        const doc = form.ownerDocument;
        for (const [id, message] of Object.entries(fieldErrors || {})) {
            const input = doc.getElementById(id);
            if (!message || !input || !form.contains(input)) continue;
            const error = doc.createElement('p');
            error.className = 'field-error';
            error.textContent = String(message);
            ensureId(error);
            const invalid = input.getAttribute('aria-invalid');
            input.setAttribute('aria-invalid', 'true');
            const descriptions = (input.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean);
            input.setAttribute('aria-describedby', [...descriptions, error.id].join(' '));
            input.insertAdjacentElement('afterend', error);
            fields.push({input, error, invalid});
        }
        if (!fields.length) return 0;
        const summary = doc.createElement('div');
        summary.className = 'form-error-summary';
        summary.setAttribute('role', 'alert');
        summary.textContent = `请检查以下${fields.length}项：${fields.map(field => field.error.textContent).join('；')}`;
        form.prepend(summary);
        feedback.set(form, {fields, summary});
        if (options.focus !== false) {
            const first = fields[0].input;
            let details = first.closest('details');
            while (details) { details.open = true; details = details.parentElement?.closest('details'); }
            first.focus({preventScroll: true});
            first.scrollIntoView?.({block: 'nearest'});
        }
        return fields.length;
    }
    window.PMForms = {enhance, showErrors, clearErrors};
})();
