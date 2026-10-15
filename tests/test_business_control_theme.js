'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
const captureDir = path.join(root, '_build/consortium-v31/theme-review');

async function fixture(browser, theme, width) {
    const page = await browser.newPage({viewport: {width, height: 1100}, reducedMotion: 'reduce'});
    await page.setContent(`<style>${read('src/static/style.css')}</style><main style="box-sizing:border-box;padding:20px;max-width:760px;margin:auto;height:100vh;overflow:auto">
        <h2>业务表单主题检查</h2><div class="modal-form">
        <div class="form-group"><label>标准输入</label><input id="standard" value="主题参考"></div>
        <div class="consortium-members"><div id="members"></div></div>
        <h3>质疑对象与事项</h3><div id="compTargets"></div><div id="compIssues"></div>
        <div class="boundary-controls"><input id="boundaryCheck" type="checkbox"><input id="boundaryRadio" type="radio"><input id="boundaryFile" type="file"><input id="boundaryDate" type="date" hidden><div class="luckysheet"><input id="pluginInput" value="插件保留原控件"></div></div>
        </div><textarea id="outsideTextarea" rows="2">普通文本区保留原尺寸</textarea></main>`);
    await page.evaluate(themeValue => {
        document.documentElement.dataset.theme = themeValue;
        window.escHtml = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
        window.currentProject = {id: 1, lots: []};
    }, theme);
    await page.addScriptTag({content: read('source/frontend/07-business.js')});
    await page.evaluate(() => {
        document.querySelector('#members').innerHTML = renderConsortiumMemberRows([{company_name: '成员甲'}, {company_name: '成员乙'}]);
        addComplaintTargetRow({object_name: '隔离采购人'});
        addComplaintIssueRow({title: '隔离业务事项'});
    });
    await page.addScriptTag({content: read('source/frontend/00-icons.js')});
    await page.addScriptTag({content: read('source/frontend/17-datetime-picker.js')});
    return page;
}

test('nested business inputs and complaint controls share themed surfaces, focus, and disabled states', async () => {
    const edge = process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    try {
        for (const theme of ['default', 'dark']) for (const width of [1366, 390]) {
            const page = await fixture(browser, theme, width);
            try {
                if (process.env.PM_THEME_REVIEW_CAPTURE === '1') {
                    fs.mkdirSync(captureDir, {recursive: true});
                    await page.screenshot({path: path.join(captureDir, `${theme}-${width}.png`), fullPage: true});
                    await page.locator('#compTargets').evaluate(el => el.previousElementSibling.scrollIntoView({block: 'start'}));
                    await page.screenshot({path: path.join(captureDir, `complaint-${theme}-${width}.png`), fullPage: true});
                    await page.locator('main').evaluate(el => { el.scrollTop = 0; });
                }
                const controls = await page.evaluate(() => {
                    const style = el => {
                        const s = getComputedStyle(el);
                        return {background: s.backgroundColor, color: s.color, borderStyle: s.borderTopStyle, borderWidth: s.borderTopWidth, radius: parseFloat(s.borderTopLeftRadius), padding: parseFloat(s.paddingLeft), height: el.getBoundingClientRect().height};
                    };
                    return {reference: style(document.querySelector('#standard')), nested: [...document.querySelectorAll('.consortium-member-row input:not([type=file]),.complaint-editor-row input:not([type=checkbox]):not([type=date]),.complaint-editor-row select,.complaint-editor-row textarea')].map(style)};
                });
                const deleteButtonsClearFields = await page.locator('.complaint-editor-row').evaluateAll(rows => rows.every(row => row.querySelector('.row-remove').getBoundingClientRect().bottom <= row.querySelector('input,select').getBoundingClientRect().top));
                assert.equal(deleteButtonsClearFields, true, 'row deletion buttons must not cover the first input or select');
                assert.ok(controls.nested.length >= 8);
                for (const control of controls.nested) {
                    assert.equal(control.background, controls.reference.background, `${theme}/${width}: nested surface`);
                    assert.equal(control.color, controls.reference.color, `${theme}/${width}: nested text`);
                    assert.equal(control.borderStyle, 'solid');
                    assert.equal(control.borderWidth, '1px');
                    assert.ok(control.radius >= 6, `${theme}/${width}: rounded business control`);
                    assert.ok(control.padding >= 8, `${theme}/${width}: readable input padding`);
                }
                const target = page.locator('.target-name');
                await target.focus();
                const focused = await target.evaluate(el => ({border: getComputedStyle(el).borderColor, shadow: getComputedStyle(el).boxShadow}));
                assert.notEqual(focused.shadow, 'none', 'nested input has the shared focus cue');
                await target.evaluate(el => { el.disabled = true; document.querySelector('#standard').disabled = true; });
                assert.deepEqual(await target.evaluate(el => ({cursor: getComputedStyle(el).cursor, opacity: getComputedStyle(el).opacity})), {cursor: 'not-allowed', opacity: '0.62'});
                assert.equal(await page.locator('#standard').evaluate(el => getComputedStyle(el).opacity), '0.62', 'wrapped and nested disabled fields use the same opacity');
                assert.equal(await page.locator('#boundaryDate').isVisible(), false);
                const boundaries = await page.evaluate(() => ['boundaryCheck', 'boundaryRadio', 'boundaryFile', 'pluginInput', 'outsideTextarea'].map(id => {
                    const el = document.getElementById(id), s = getComputedStyle(el);
                    return {id, width: el.getBoundingClientRect().width, radius: s.borderTopLeftRadius, padding: s.paddingLeft};
                }));
                for (const control of boundaries.slice(0, 2)) assert.ok(control.width < 24, control.id + ' retains native width');
                for (const control of boundaries.slice(2)) assert.equal(control.radius, '0px', control.id + ' retains its own styling');
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth || document.querySelector('main').scrollWidth > document.querySelector('main').clientWidth), false, 'no horizontal page or form overflow');
            } finally { await page.close(); }
        }
    } finally { await browser.close(); }
});

test('business reordering glyphs create neutral SVG icons without changing source values', async () => {
    const {JSDOM} = require('jsdom');
    const dom = new JSDOM('<button title="上移"><span data-ui-icon="↑"></span></button><button title="下移"><span data-ui-icon="↓"></span></button><input value="↑ 保留业务值">', {runScripts: 'outside-only'});
    try {
        dom.window.eval(read('source/frontend/00-icons.js'));
        const document = dom.window.document;
        assert.equal(document.querySelectorAll('button svg.pm-icon--neutral').length, 2);
        const arrows = document.querySelectorAll('button svg');
        assert.notEqual(arrows[0].innerHTML, arrows[1].innerHTML);
        assert.equal(document.querySelector('input').value, '↑ 保留业务值');
    } finally { dom.window.close(); }
});

test('member cards keep full-width identity fields and long headings clear of actions on narrow screens', async () => {
    const edge = process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless: true, ...(fs.existsSync(edge) ? {executablePath: edge} : {})});
    try {
        for (const theme of ['default', 'dark']) for (const width of [1366, 390, 380]) {
            const page = await fixture(browser, theme, width);
            try {
                await page.evaluate(() => {
                    document.querySelector('#members').innerHTML = renderConsortiumMemberRows([{company_name: '联合体成员单位（长名称）' + 'LONG_MEMBER_COMPANY_NAME_'.repeat(6)}, {company_name: '成员乙'}]);
                    PMIcons.render(document.querySelector('#members'));
                });
                const geometry = await page.locator('.consortium-member-card').first().evaluate(card => {
                    const title = card.querySelector('[data-member-title]').getBoundingClientRect(), actions = card.querySelector('.consortium-member-actions').getBoundingClientRect();
                    const fields = card.querySelector('.consortium-member-fields').getBoundingClientRect(), company = card.querySelector('[data-member-field="company_name"]').getBoundingClientRect();
                    return {overlap: title.right > actions.left && title.bottom > actions.top && title.top < actions.bottom, titleWidth: title.width, overflow: card.scrollWidth > card.clientWidth, companyWidth: company.width, fieldsWidth: fields.width};
                });
                assert.equal(geometry.overlap, false, `${theme}/${width}: heading clear of member buttons`);
                assert.equal(geometry.overflow, false, `${theme}/${width}: long member name wraps inside card`);
                assert.ok(geometry.titleWidth >= 200, 'member heading keeps enough width to read a full company name');
                assert.ok(Math.abs(geometry.companyWidth - geometry.fieldsWidth) < 1, 'company name spans the member form');
                assert.equal(await page.locator('.consortium-member-card').first().locator('.consortium-member-actions svg').count(), 2);
                if (process.env.PM_THEME_REVIEW_CAPTURE === '1') {
                    fs.mkdirSync(captureDir, {recursive: true});
                    await page.screenshot({path: path.join(captureDir, `member-card-${theme}-${width}.png`), fullPage: true});
                }
            } finally { await page.close(); }
        }
    } finally { await browser.close(); }
});
