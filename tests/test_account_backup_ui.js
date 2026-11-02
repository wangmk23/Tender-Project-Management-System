'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {JSDOM} = require('jsdom');
const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, 'source/frontend', file), 'utf8');

function fixture(html = '') {
    const dom = new JSDOM(`<div id="app"><main class="main">${html}</main></div><div id="modalOverlay"></div><div id="modal"><h2 id="modalTitle"></h2><div id="modalBody"></div><div id="modalFooter"></div></div>`, {url: 'http://localhost/', runScripts: 'outside-only'});
    const context = dom.getInternalVMContext();
    vm.runInContext(read('01-core.js'), context);
    vm.runInContext(read('06-admin.js').replace(/initDisplayPreferences\(\);\s*initUserUI\(\);\s*$/, ''), context);
    vm.runInContext(`toast = () => {}; activateDialogFocus = () => {}; window.CURRENT_USER={id:1,username:'admin',is_admin:true}; currentIsAdmin=true; systemInfo={is_desktop:true};`, context);
    const close = dom.window.close.bind(dom.window);
    dom.window.close = () => {vm.runInContext('accountAccessObserver?.disconnect();applicationAccessObserver?.disconnect();', context);close();};
    return {dom, doc: dom.window.document, run: code => vm.runInContext(code, context)};
}

test('legacy roles retain baseline rights; viewer can export without gaining writes', () => {
    const f = fixture();
    try {
        assert.equal(f.run("normalizeAccountAccess({is_admin:false}).permissions.edit_projects"), true);
        assert.equal(f.run("normalizeAccountAccess({is_admin:false}).permissions.delete_projects"), false);
        assert.equal(f.run("normalizeAccountAccess({role:'admin',permissions:{export_data:false}}).permissions.export_data"), true);
        assert.equal(f.run("normalizeAccountAccess({role:'viewer',permissions:{edit_projects:true,export_data:true}}).permissions.edit_projects"), false);
        assert.equal(f.run("normalizeAccountAccess({role:'viewer',permissions:{export_data:true}}).permissions.export_data"), true);
    } finally {f.dom.window.close();}
});

test('independent capabilities target import, attachment rename, media download and exact action names', () => {
    const f = fixture(`<input type="file" id="projectImportFile"><input type="file" id="registrationImportFile"><input type="file" id="regFiles"><button id="renameOk">保存文件名</button><button id="lookalike" onclick="saveProjectInfoPreview()">预览</button><button id="media" data-media-action="download">下载原件</button>`);
    try {
        f.run("syncAccountAccess({role:'editor',permissions:{create_projects:true,edit_projects:false,manage_attachments:false,export_data:false}})");
        assert.equal(f.doc.querySelector('#projectImportFile').disabled, false);
        assert.equal(f.doc.querySelector('#registrationImportFile').disabled, true);
        assert.equal(f.doc.querySelector('#regFiles').disabled, true);
        assert.equal(f.doc.querySelector('#lookalike').disabled, false);
        assert.equal(f.doc.querySelector('#media').disabled, true);
        f.run(`document.getElementById('modalBody').innerHTML='<input id="projectImportFile">';document.getElementById('modalFooter').innerHTML='<button id="modalSaveBtn">导入</button>';refreshAccountAccessControls();`);
        assert.equal(f.doc.querySelector('#modalSaveBtn').disabled, false);
        f.run(`syncAccountAccess({role:'editor',permissions:{edit_projects:false,manage_attachments:true}});`);
        assert.equal(f.doc.querySelector('#renameOk').disabled, false);
    } finally {f.dom.window.close();}
});

test('finishing a busy operation while denied does not leave a permanent permission lock', () => {
    const f = fixture('<button id="save" onclick="saveProjectInfo()">保存</button>');
    try {
        f.run(`const button=document.getElementById('save');button.dataset.operationBusy='1';button.disabled=true;syncAccountAccess({role:'viewer'});delete button.dataset.operationBusy;syncAccountAccess({role:'editor'});`);
        assert.equal(f.doc.querySelector('#save').disabled, false);
    } finally {f.dom.window.close();}
});

test('shared modal save keeps permission restriction when pending save is rejected', async () => {
    const f = fixture();
    try {
        f.run(`window.finishSave=null;showModal('业务草稿','<input id="draft" value="保留草稿">',()=>new Promise(resolve=>{finishSave=resolve;}));window.pendingSave=document.getElementById('modalSaveBtn').onclick();syncAccountAccess({role:'viewer'});finishSave(false);`);
        await f.run('pendingSave');
        assert.equal(f.doc.querySelector('#modalSaveBtn').disabled, true);
        assert.equal(f.doc.querySelector('#draft').value, '保留草稿');
        f.run("syncAccountAccess({role:'editor'})");
        assert.equal(f.doc.querySelector('#modalSaveBtn').disabled, false);
    } finally {f.dom.window.close();}
});

test('permission rejection is never retried even when its human message mentions CSRF', async () => {
    const f = fixture();
    try {
        f.run(`window.calls=0;window.refreshes=0;refreshAttachmentCsrfToken=async()=>{refreshes++;return true;};localFetch=async()=>{calls++;return {response:{ok:false,status:403},result:{error:'权限不足，与CSRF无关',code:'PERMISSION_DENIED',account:{role:'viewer'}}};};`);
        await assert.rejects(f.run("api('PUT','/api/projects/8',{name:'草稿'})"), /权限/);
        assert.equal(f.run('calls'), 1);
        assert.equal(f.run('refreshes'), 0);
    } finally {f.dom.window.close();}
});

test('backup unavailable status and read retry retain a path draft and unrelated settings', async () => {
    const f = fixture('<section class="settings-page"><input id="otherDraft" value="其他草稿"><div id="backupDirectoryHost"></div></section>');
    try {
        f.run(`document.getElementById('backupDirectoryHost').innerHTML=renderBackupDirectoryCard();api=async()=>({path:'E:/offline',default_path:'E:/default',configured_path:'E:/offline',available:false,error:'目录暂时不可写'});`);
        await f.run('loadBackupDirectorySettings()');
        assert.match(f.doc.querySelector('#backupDirectoryStatus').textContent, /目录暂时不可写/);
        assert.equal(f.doc.querySelector('#backupDirectoryRetry').hidden, false);
        f.doc.querySelector('#backupFolderInput').value = 'E:/草稿';
        f.run(`api=async()=>{throw new Error('网络失败');};`);
        await f.run('loadBackupDirectorySettings(true)');
        assert.equal(f.doc.querySelector('#backupFolderInput').value, 'E:/草稿');
        f.run(`api=async()=>({path:'E:/server-current',default_path:'E:/default',configured_path:'E:/server-current',available:true,error:null});`);
        await f.run('loadBackupDirectorySettings(true)');
        assert.equal(f.doc.querySelector('#backupFolderInput').value, 'E:/草稿');
        assert.equal(f.doc.querySelector('#backupDirectorySavedPath').textContent, 'E:/server-current');
        assert.equal(f.doc.querySelector('#otherDraft').value, '其他草稿');
    } finally {f.dom.window.close();}
});

test('restoring backup default clears configured path only after save and manual edits cancel reset', async () => {
    const f = fixture('<div id="backupDirectoryHost"></div>');
    try {
        f.run(`backupDirectorySettings={path:'E:/custom',default_path:'E:/default',configured_path:'E:/custom'};document.getElementById('backupDirectoryHost').innerHTML=renderBackupDirectoryCard();window.sent=[];api=async(method,url,data)=>{sent.push(data);return {path:data.path||'E:/default',default_path:'E:/default',configured_path:data.path,available:true};};resetBackupDirectory();`);
        assert.equal(f.run('sent.length'), 0);
        assert.equal(f.doc.querySelector('#backupFolderInput').value, 'E:/default');
        await f.run('saveBackupDirectory()');
        assert.equal(f.run('sent[0].path'), '');
        f.run('resetBackupDirectory()');
        f.doc.querySelector('#backupFolderInput').value = 'E:/手工修改';
        // The outside-only DOM harness does not compile inline event attributes.
        f.run(`new Function(document.getElementById('backupFolderInput').getAttribute('oninput')).call(document.getElementById('backupFolderInput'));`);
        await f.run('saveBackupDirectory()');
        assert.equal(f.run('sent[1].path'), 'E:/手工修改');
    } finally {f.dom.window.close();}
});

test('backup initial read failure can retry independently and remote or ordinary accounts get host guidance', async () => {
    const f = fixture('<input id="otherDraft" value="其他设置草稿"><div id="backupDirectoryHost"></div>');
    try {
        f.run(`document.getElementById('backupDirectoryHost').innerHTML=renderBackupDirectoryCard();api=async()=>{throw new Error('连接失败');};`);
        await f.run('loadBackupDirectorySettings()');
        assert.equal(f.doc.querySelector('#backupDirectoryRetry').hidden, false);
        assert.equal(f.doc.querySelector('#backupFolderInput').disabled, true);
        f.run(`api=async()=>({path:'E:/backup',default_path:'E:/backup',configured_path:'',available:true});`);
        await f.run('loadBackupDirectorySettings(true)');
        assert.equal(f.doc.querySelector('#backupFolderInput').disabled, false);
        assert.equal(f.doc.querySelector('#otherDraft').value, '其他设置草稿');
        f.run(`systemInfo.is_desktop=false;document.getElementById('backupDirectoryHost').innerHTML=renderBackupDirectoryCard();`);
        assert.equal(f.doc.querySelector('#backupFolderInput'), null);
        assert.match(f.doc.querySelector('#backupDirectoryHost').textContent, /主机电脑的桌面客户端/);
        f.run(`systemInfo.is_desktop=true;syncAccountAccess({role:'editor'});document.getElementById('backupDirectoryHost').innerHTML=renderBackupDirectoryCard();`);
        assert.equal(f.doc.querySelector('#backupFolderInput'), null);
        assert.match(f.doc.querySelector('#backupDirectoryHost').textContent, /管理员/);
    } finally {f.dom.window.close();}
});

test('account refresh preserves draft, unrelated disabled state, preview and licence restrictions', () => {
    const f = fixture(`<input id="draft" value="未保存内容"><button id="save" onclick="saveProjectInfo()">保存</button><button id="busy" disabled onclick="saveProjectInfo()">处理中</button><button id="preview" onclick="viewAttachment(1)">预览</button><button id="export" onclick="exportData()">导出</button><button id="cancel" onclick="closeModal()">取消</button>`);
    try {
        f.run("syncAccountAccess({role:'viewer'});");
        assert.equal(f.doc.querySelector('#save').disabled, true);
        assert.equal(f.doc.querySelector('#export').disabled, true);
        assert.equal(f.doc.querySelector('#preview').disabled, false);
        assert.equal(f.doc.querySelector('#cancel').disabled, false);
        f.run("syncApplicationAccess({mode:'read_only'}); syncAccountAccess({role:'admin'});");
        assert.equal(f.doc.querySelector('#save').disabled, true);
        f.run("syncApplicationAccess({mode:'full'});");
        assert.equal(f.doc.querySelector('#save').disabled, false);
        assert.equal(f.doc.querySelector('#busy').disabled, true);
        assert.equal(f.doc.querySelector('#draft').value, '未保存内容');
    } finally {f.dom.window.close();}
});

test('permission denial updates account once without replaying writes or replacing fields', async () => {
    const f = fixture('<input id="draft" value="草稿">');
    try {
        f.run(`window.calls=0; localFetch=async()=>{calls++; return {response:{ok:false,status:403},result:{error:'账号权限已更新',code:'PERMISSION_DENIED',account:{role:'viewer'}}};};`);
        await assert.rejects(f.run("api('PUT','/api/projects/8',{name:'草稿'})"), /权限/);
        assert.equal(f.run('calls'), 1);
        assert.equal(f.run("hasAccountPermission('edit_projects')"), false);
        assert.equal(f.doc.querySelector('#draft').value, '草稿');
    } finally {f.dom.window.close();}
});

test('user form applies role presets and submits explicit permissions with draft retained on errors', async () => {
    const f = fixture();
    try {
        f.run('showUserForm(0)');
        f.doc.querySelector('#ufUsername').value = 'reader';
        f.doc.querySelector('#ufPassword').value = 'local-fixture-pass';
        f.doc.querySelector('#ufRole').value = 'viewer';
        f.run('applyUserRolePreset()');
        assert.equal(f.doc.querySelector('[data-user-permission="edit_projects"]').disabled, true);
        f.doc.querySelector('[data-user-permission="export_data"]').checked = true;
        f.run(`api=async(method,url,data)=>{window.sent=data;throw new Error('隔离保存失败');};`);
        await f.run('saveUser()');
        assert.equal(f.run('sent.role'), 'viewer');
        assert.equal(f.run('sent.permissions.export_data'), true);
        assert.equal(f.run('sent.permissions.edit_projects'), false);
        assert.equal(f.doc.querySelector('#ufUsername').value, 'reader');
        assert.match(f.doc.querySelector('#userFormStatus').textContent, /隔离保存失败/);
    } finally {f.dom.window.close();}
});

test('backup cancellation, failures and confirmed save preserve other settings drafts', async () => {
    const f = fixture('<section class="settings-page"><input id="otherDraft" value="其他草稿"><div id="backupDirectoryHost"></div></section>');
    try {
        f.run(`backupDirectorySettings={path:'E:\\old',default_path:'E:\\default',configured_path:''}; document.getElementById('backupDirectoryHost').innerHTML=renderBackupDirectoryCard(); window.calls=[]; api=async(method,url,data)=>{calls.push({method,url,data});return {cancelled:true};};`);
        const input = f.doc.querySelector('#backupFolderInput');
        input.value = 'E:/未保存';
        await f.run('chooseBackupDirectory()');
        assert.equal(input.value, 'E:/未保存');
        f.run(`api=async()=>{throw new Error('目录不可写');};`);
        await f.run('saveBackupDirectory()');
        assert.equal(input.value, 'E:/未保存');
        assert.match(f.doc.querySelector('#backupDirectoryStatus').textContent, /目录不可写/);
        f.run(`window.calls=[]; api=async(method,url,data)=>{calls.push({method,url,data});if(method==='GET')throw new Error('读取失败');return {path:data.path,default_path:'E:/default',configured_path:data.path};};`);
        await f.run('saveBackupDirectory()');
        assert.equal(f.run("calls.filter(x=>x.method==='PUT').length"), 1);
        assert.equal(f.doc.querySelector('#otherDraft').value, '其他草稿');
        assert.equal(f.run('backupDirectorySettings.path'), 'E:/未保存');
        assert.equal(f.doc.querySelector('#backupFolderInput').disabled, false);
        await f.run('openBackupDirectory()');
        assert.equal(f.run('calls.at(-1).data'), undefined, 'open must target the saved server configuration');
    } finally {f.dom.window.close();}
});
