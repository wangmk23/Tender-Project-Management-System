'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const acorn = require('acorn');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
function functions(file, names) {
    const source = fs.readFileSync(path.join(root, 'source/frontend', file), 'utf8');
    return acorn.parse(source, {ecmaVersion:'latest'}).body
        .filter(node => node.type === 'FunctionDeclaration' && names.includes(node.id.name))
        .map(node => source.slice(node.start, node.end)).join('\n');
}
test('daily work filters and creation controls remain usable across themes and sizes', async () => {
    const edge = process.env.PM_EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless:true, ...(fs.existsSync(edge)?{executablePath:edge}:{})});
    const output = process.env.PM_DAILY_QA_DIR || path.join(os.tmpdir(), 'pm-daily-operations-qa');
    fs.mkdirSync(output, {recursive:true});
    try {
        for (const theme of ['default','dark']) for (const viewport of [
            {width:1280,height:800},{width:390,height:844},
        ]) {
            const page = await browser.newPage({viewport,reducedMotion:'reduce'});
            const errors = [];page.on('pageerror',error=>errors.push(error.message));
            await page.route('**/*',route=>route.abort());
            await page.setContent(`<!doctype html><style>${fs.readFileSync(path.join(root,'src/static/style.css'),'utf8').replace(/^\uFEFF/,'')}</style>
                <main id="dashboardContent" style="height:100vh;overflow:auto"></main>
                <div id="modalOverlay" class="modal-overlay"></div><div id="modal" class="modal">
                <header class="modal-header"><h3 id="modalTitle"></h3><button class="btn-icon" onclick="closeModal()" aria-label="关闭">×</button></header>
                <div id="modalBody" class="modal-body"></div><div id="modalFooter" class="modal-footer"></div></div>`);
            await page.addScriptTag({content:'const dialogFocusStack=[];let dialogFocusListenersReady=false;\n'+functions('01-core.js',[
                'topManagedDialog','dialogControls','focusDialogStart','handleDialogFocus','activateDialogFocus',
                'releaseDialogFocus','resetModalState','showModal','closeModal',
            ])});
            for (const file of ['00-icons.js','22-procurement-methods.js','09-command-center.js']) await page.addScriptTag({content:fs.readFileSync(path.join(root,'source/frontend',file),'utf8')});
            await page.addScriptTag({content:functions('06-admin.js',['showNewProjectModal','toggleMultiPack'])});
            await page.evaluate(value=>{
                document.documentElement.dataset.theme=value;
                window.escHtml=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
                window.METHODS=['公开招标','网上竞价'];window.projectColor=()=> '#2563eb';
                window.currentProject=null;window.currentEditingProjectId=null;
                window.selectProject=id=>{window.selected=id;};window.switchView=()=>{throw Error('unexpected navigation');};
                window.allProjects=Array.from({length:12},(_,i)=>({id:i+1,number:`模拟-${i+1}`,name:`模拟项目 ${i+1}`,method:'公开招标',progress:30,stages:[
                    {key:'doc_review',name:'文件审核',planned_at:i?'2026-10-13T14:30':'2026-10-12T14:30',responsible_person:'模拟负责人'},
                ]}));
                document.getElementById('dashboardContent').innerHTML=renderCommandCenterDashboard(commandCenterModel(allProjects,null,new Date('2026-10-13T09:00:00')));
                installCommandActionDelegation(document);
            },theme);
            assert.ok(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--text').trim()),'root theme tokens loaded');
            assert.equal(await page.locator('.command-project-row').count(),5);
            assert.ok(await page.locator('.command-insight-row>span').first().evaluate(el=>el.scrollWidth<=el.clientWidth),'procurement label remains readable');
            assert.ok(await page.locator('.command-panel').first().evaluate(el=>el.classList.contains('command-action-queue')));
            if(viewport.width>1000) assert.ok(await page.locator('[data-command-filter="today"]').evaluate(el=>el.getBoundingClientRect().bottom<window.innerHeight),'pending controls appear in first screen');
            await page.locator('[data-command-filter="overdue"]').click();
            assert.equal(await page.locator('.command-action-row').count(),1);
            await page.locator('[data-command-filter="today"]').click();
            assert.equal(await page.locator('.command-action-row').count(),6);
            await page.locator('[data-metric="pending"]').click();
            assert.equal(await page.locator('.command-metric-result').count(),12);
            await page.keyboard.press('Escape');
            await page.locator('[data-command-action="new-project"]').click();
            assert.equal(await page.locator('.new-project-options').evaluate(el=>el.open),false);
            await page.locator('#npName').fill('模拟新建项目');
            await page.locator('.new-project-options summary').focus();
            assert.equal(await page.locator('.new-project-options').evaluate(el=>getComputedStyle(el).borderTopLeftRadius),'8px');
            await page.keyboard.press('Enter');
            await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(()=>document.activeElement.id),'npBudget','keyboard enters expanded optional fields');
            await page.locator('#npPrepareOwner').fill('模拟编制员');
            await page.locator('label[for="npMultiPack"]').click();
            assert.equal(await page.locator('#npMultiPack').isChecked(),true);
            assert.equal(await page.locator('#packEditor').isVisible(),true);
            const layout=await page.evaluate(()=>{
                const r=el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,top:b.top,bottom:b.bottom};};
                const modal=document.getElementById('modal'),body=document.getElementById('modalBody');
                body.scrollTop=body.scrollHeight;
                return {modal:r(modal),button:r(document.getElementById('npCreateBtn')),cancel:r(document.querySelector('[data-new-project-cancel]')),
                    overflow:body.scrollWidth>body.clientWidth+1,background:getComputedStyle(modal).backgroundColor};
            });
            assert.equal(layout.overflow,false,`${theme} ${viewport.width}: no horizontal form overflow`);
            for(const name of ['button','cancel']) {
                assert.ok(layout[name].top>=0&&layout[name].bottom<=viewport.height,`${name} remains visible`);
                assert.ok(layout[name].left>=layout.modal.left&&layout[name].right<=layout.modal.right);
            }
            if(theme==='dark') assert.notEqual(layout.background,'rgb(255, 255, 255)');
            await page.screenshot({path:path.join(output,`模拟新建项目-${theme}-${viewport.width}.png`)});
            await page.locator('[data-new-project-cancel]').click();
            assert.equal(await page.locator('#modal').isVisible(),false);
            assert.deepEqual(errors,[]);await page.close();
        }
    } finally {await browser.close();}
    console.log(`Isolated daily operations screenshots: ${output}`);
});
