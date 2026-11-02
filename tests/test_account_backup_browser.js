'use strict';
// SOURCE-UI FIXTURE: response simulation, no frozen EXE or native folder picker validation.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8').replace(/^\uFEFF/, '');
const captureDir = path.join(root, '_build/account-backup-v59/source-ui-fixture');
async function fixture(browser, theme, width) {
    const page = await browser.newPage({viewport:{width,height:1000}, reducedMotion:'reduce'});
    await page.route('http://127.0.0.1/**', route => route.fulfill({contentType:'text/html',body:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${read('src/static/style.css')}\n${read('src/project_manager/static/css/account-backup.css')} body{margin:0}.fixture-shell{padding:16px;max-width:1100px;margin:auto} #app>.main{margin:0;padding:0} </style>
      <div id="app"><main class="main"><div class="fixture-shell"><div id="settingsContent"></div></div></main></div>
      <div id="modalOverlay" class="modal-overlay"></div><div id="modal" class="modal"><div class="modal-header"><h2 id="modalTitle"></h2><button class="btn btn-icon" onclick="closeModal()" aria-label="关闭"><span data-ui-icon="✕"></span></button></div><div class="modal-body" id="modalBody"></div></div>`}));
    await page.goto('http://127.0.0.1/fixture');
    for (const file of ['01-core.js','12-settings-navigation.js','06-admin.js','00-icons.js','20-form-accessibility.js']) {
        await page.addScriptTag({content:read(`source/frontend/${file}`).replace(/initDisplayPreferences\(\);\s*initUserUI\(\);\s*$/, '')});
    }
    await page.evaluate(({theme}) => {
        document.documentElement.dataset.theme=theme;
        window.CURRENT_USER={id:1,username:'admin',is_admin:true};currentIsAdmin=true;
        systemInfo={is_desktop:true,version:'source fixture',backup_schedule:'每日13:00',license:{},data_dir:'E:/隔离演示/数据'};
        systemSettings={export_folder:'E:/隔离演示/导出',max_file_size_mb:1024};
        window.toast=()=>{};
        window.renderProcurementMethodManager=()=>'';
        window.renderDeviceAdmissionPanel=()=>'';
        window.renderReminderSettingsCard=()=>'';
        window.stopDeviceAdmissionPanelPolling=()=>{};
        window.backupFixtureRequests=[];
        window.api=async(method,url,body)=>{
            backupFixtureRequests.push({method,url,body});
            if (url==='/api/settings/backup') return {path:method==='PUT'?(body.path||'E:/隔离演示/backup'):'E:/隔离演示/自动备份（含中文）',default_path:'E:/隔离演示/backup',configured_path:method==='PUT'?body.path:'E:/隔离演示/自动备份（含中文）',available:true,error:null};
            if(url.endsWith('/choose'))return {cancelled:true};
            if(url.endsWith('/open'))return {message:'已打开'};
            throw new Error('Fixture has no real service');
        };
        activeSettingsCategory='files';
        syncAccountAccess({role:'admin'});
        renderSettingsView();
    }, {theme});
    return page;
}
function noOverflow(page) {return page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('.modal.open,.backup-directory-card')].every(el=>el.scrollWidth<=el.clientWidth+1));}
async function capture(page, name) {
    if(process.env.PM_ACCOUNT_BACKUP_CAPTURE==='1') {fs.mkdirSync(captureDir,{recursive:true});await page.screenshot({path:path.join(captureDir,name+'.png'),fullPage:true});}
}
test('actual backup settings, account list and role form fit four themes at desktop and 375px', async()=>{
    const edge=process.env.PM_EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
    try {
        for(const theme of ['default','blue','green','dark'])for(const width of [1366,375]) {
            const page=await fixture(browser,theme,width);
            try {
                await page.waitForFunction(()=>!document.querySelector('#backupFolderInput').disabled);
                assert.equal(await page.locator('#backupDirectoryTitle').textContent(),'数据备份目录');
                assert.equal(await noOverflow(page),true,`backup ${theme}/${width}`);
                await page.locator('#backupFolderInput').focus();
                await page.keyboard.press('Tab');
                assert.match(await page.locator(':focus').textContent(),/保存/);
                await capture(page,`${theme}-${width}-backup`);
                await page.getByRole('button',{name:'恢复默认',exact:true}).click();
                await page.locator('#backupFolderInput').focus();
                await page.keyboard.press('Tab');
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(()=>backupFixtureRequests.at(-1).body.path),'');
                await page.getByRole('button',{name:'恢复默认',exact:true}).click();
                await page.locator('#backupFolderInput').fill('E:/隔离演示/键盘修改');
                await page.keyboard.press('Tab');
                await page.keyboard.press('Enter');
                assert.equal(await page.evaluate(()=>backupFixtureRequests.at(-1).body.path),'E:/隔离演示/键盘修改');
                await page.evaluate(()=>{userManagementUsers=[{id:1,username:'admin',display_name:'系统管理员',is_admin:true,is_active:true},{id:2,username:'operator',display_name:'项目经办人',role:'editor',is_active:true},{id:3,username:'reader',display_name:'业务查阅账号',role:'viewer',permissions:{export_data:true},is_active:true}];showUserForm(3);document.getElementById('modalOverlay').classList.add('open');document.getElementById('modal').classList.add('open');});
                assert.equal(await noOverflow(page),true,`form ${theme}/${width}`);
                assert.equal(await page.locator('[data-user-permission="edit_projects"]').isDisabled(),true);
                assert.equal(await page.locator('[data-user-permission="export_data"]').isChecked(),true);
                await page.locator('#ufRole').selectOption('editor');
                assert.equal(await page.locator('[data-user-permission="delete_projects"]').isChecked(),false);
                await page.locator('#ufRole').selectOption('viewer');
                await page.locator('[data-user-permission="export_data"]').focus();
                await page.keyboard.press('Space');
                assert.equal(await page.locator('[data-user-permission="export_data"]').isChecked(),true);
                await page.locator('#ufRole').focus();
                assert.equal(await page.locator('#ufRole').evaluate(el=>el.getBoundingClientRect().width>0),true);
                await capture(page,`${theme}-${width}-user-form`);
                // Tab to the form actions and verify the scroll container reveals them.
                for (let step=0;step<12 && !(await page.locator('#userFormSave').evaluate(el=>el===document.activeElement));step++) await page.keyboard.press('Tab');
                assert.equal(await page.locator('#userFormSave').evaluate(el=>{
                    const rect=el.getBoundingClientRect(),body=document.getElementById('modalBody').getBoundingClientRect();
                    return el===document.activeElement && rect.top>=body.top && rect.bottom<=body.bottom+1 && rect.bottom<=innerHeight;
                }),true,`keyboard save visible ${theme}/${width}`);
                await capture(page,`${theme}-${width}-user-form-actions`);
                await page.evaluate(()=>{resetModalState({wide:true});document.getElementById('modalTitle').textContent='用户管理';renderUserList();document.getElementById('modal').classList.add('open');});
                assert.equal(await noOverflow(page),true,`list ${theme}/${width}`);
                assert.match(await page.locator('.user-list').textContent(),/只读查看/);
                await capture(page,`${theme}-${width}-user-list`);
            } finally {await page.close();}
        }
    } finally {await browser.close();}
});
