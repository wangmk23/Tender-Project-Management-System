const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('jsdom');
const tick = () => new Promise(resolve => setTimeout(resolve, 15));
function setup(handler, project = 1) {
    const dom = new JSDOM('<div id="attachmentsContent"></div>', {runScripts:'outside-only', url:'http://localhost'});
    const w = dom.window;
    w.currentProject = {id:project, attachments:[]}; w.projectNavigationVersion = 1;
    w.escHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    w.uiStateMarkup = (_, text) => `<p>${text}</p>`;
    const calls = [];
    w.api = async (method,url,body) => {calls.push({method,url,body}); return handler(method,url,body);};
    w.eval(fs.readFileSync('source/frontend/03-attachments.js','utf8'));
    if (fs.existsSync('source/frontend/24-local-project-files.js')) w.eval(fs.readFileSync('source/frontend/24-local-project-files.js','utf8'));
    w.renderAttachments();
    const click = text => { const b = [...w.document.querySelectorAll('button')].find(b=>b.textContent.trim()===text); assert.ok(b, `button ${text}`); b.click(); };
    return {w,dom,calls,click};
}
function state(overrides={}) {return {project_id:1,revision:0,linked:false,status:'unlinked',capabilities:{manage:true,open:true},scan:{state:'idle',complete:false},stage_summary:[],...overrides};}
test('indexed files preview read-only and only offer download with export permission', async () => {
    for (const download of [false, true]) {
        const file = {name:'报价 & 说明.pdf',path:'评审/报价 & 说明.pdf',type:'file',size:12,preview_kind:'pdf'};
        const c = setup((_method, url) => url.includes('/entries')
            ? {revision:3,binding:'indexed-binding',items:[file],total:1,has_more:false}
            : state({linked:true,revision:3,capabilities:{manage:false,open:false,download}}));
        let opened;
        c.w.openDocPreview = (...args) => { opened = args; };
        try {
            c.click('本地文件'); await tick(); c.click('预览');
            assert.equal(opened[1], 'pdf');
            const url = new URL(opened[3].contentUrl, c.w.location.href);
            assert.equal(url.pathname, '/api/projects/1/local-files/content');
            assert.equal(url.searchParams.get('path'), file.path);
            assert.equal(url.searchParams.get('revision'), '3');
            assert.equal(url.searchParams.get('binding'), 'indexed-binding');
            assert.equal(url.searchParams.get('mode'), 'preview');
            assert.equal(Boolean(opened[3].downloadUrl), download);
            assert.equal(Boolean(c.w.document.querySelector('.local-files-row a[download]')), download);
            assert.equal(c.w.document.querySelector('.local-files-row [contenteditable]'), null);
        } finally { c.dom.window.close(); }
    }
});
test('a denied download is reported in the current file list', async () => {
    const c = setup((_method, url) => url.includes('/entries')
        ? {revision:1,binding:'index-binding',items:[{name:'报告.pdf',path:'报告.pdf',type:'file',preview_kind:'pdf'}],total:1}
        : state({linked:true,revision:1,capabilities:{manage:false,open:false,download:true}}));
    const requests = [];
    c.w.localFetch = async (url, options) => { requests.push({url,options}); return {ok:false,status:403}; };
    try {
        c.click('本地文件'); await tick();
        c.w.document.querySelector('a[data-local-download]').click(); await tick();
        assert.equal(requests.length, 1);
        assert.equal(requests[0].options.method, 'HEAD');
        assert.match(c.w.document.querySelector('[role=alert]').textContent, /下载暂不可用/);
        assert.match(c.w.document.querySelector('.local-files-list').textContent, /报告.pdf/);
    } finally { c.dom.window.close(); }
});
test('attachment switch preserves upload DOM and selected subpage on repaint', async () => {
    const c = setup(()=>state());
    try { const upload = c.w.document.querySelector('#uploadArea'); c.click('本地文件'); await tick(); assert.ok(c.w.document.querySelector('#localProjectFiles')); assert.equal(c.w.document.querySelector('#uploadArea'),upload); assert.equal(upload.closest('[hidden]')?.id,'systemAttachmentsPanel'); c.w.renderAttachments(); await tick(); assert.equal(c.w.document.querySelector('#systemAttachmentsPanel').hidden,true); c.click('系统附件'); assert.equal(c.w.document.querySelector('#systemAttachmentsPanel').hidden,false); } finally {c.dom.window.close();}
});
test('unlinked host offers paste and explicit association; readonly never exposes path or mutation', async () => {
    for (const manage of [true,false]) {const c=setup(()=>state({path:'C:\\private',capabilities:{manage,open:manage}})); try {c.click('本地文件'); await tick(); assert.equal(!!c.w.document.querySelector('[name="association_path"]'),manage); if(!manage){assert.ok(!c.w.document.body.textContent.includes('C:\\private')); assert.ok(!c.w.document.body.textContent.includes('选择文件夹'));}} finally {c.dom.window.close();}}
});
test('index paging is 100 entries and failed refresh keeps existing filenames', async () => {
    let failed=false;
    const c=setup((m,u)=>{if(u.includes('/entries')) {if(failed) throw Error('离线'); return {revision:2,items:[{name:'资料.txt',path:'资料.txt',type:'file',size:3}],total:101,has_more:true};} return state({linked:true,revision:2,label:'项目资料'});});
    try {c.click('本地文件'); await tick(); assert.match(c.w.document.body.textContent,/资料.txt/); c.click('下一页'); await tick(); assert.ok(c.calls.some(c=>c.url.includes('offset=100')&&c.url.includes('limit=100'))); failed=true; c.click('刷新文件'); await tick(); assert.match(c.w.document.body.textContent,/资料.txt/); assert.match(c.w.document.body.textContent,/离线/);} finally {c.dom.window.close();}
});
test('project navigation ignores late state and entries', async()=>{
    let finish; const pending=new Promise(r=>finish=r); const c=setup((m,u)=>u.includes('/1/')?pending:state({project_id:2}));
    try {c.click('本地文件'); c.w.currentProject={id:2,attachments:[]}; c.w.projectNavigationVersion++; c.w.renderAttachments(); c.click('本地文件'); await tick(); finish(state({linked:true,label:'旧项目秘密'})); await tick(); assert.ok(!c.w.document.body.textContent.includes('旧项目秘密'));} finally {c.dom.window.close();}
});
test('409 retains pasted draft and reads fresh revision without replay',async()=>{
    let revision=0; const c=setup((m,u)=>{if(m==='PUT'){revision=4; throw Object.assign(Error('冲突'),{status:409});} return state({revision});});
    try {c.click('本地文件'); await tick(); const input=c.w.document.querySelector('[name="association_path"]'); input.value='D:\\归档'; input.dispatchEvent(new c.w.Event('input',{bubbles:true})); c.click('确认关联'); await tick(); assert.equal(c.w.document.querySelector('[name="association_path"]').value,'D:\\归档'); assert.equal(c.calls.filter(c=>c.method==='PUT').length,1); assert.match(c.w.document.body.textContent,/冲突/);} finally {c.dom.window.close();}
});
test('linked folder opens directly and supports nested browse and project-wide search', async () => {
    const folder = (name, path) => ({name, path, type:'directory'});
    const file = {name:'报价.pdf', path:'采购 & 评审/第二层/报价.pdf', type:'file', preview_kind:'pdf'};
    const c = setup((_method, url) => {
        if (!url.includes('/entries')) return state({
            linked:true, revision:1, label:'项目资料',
            capabilities:{manage:false, open:false},
            stage_summary:[{name:'评审', state:'unmatched'}],
        });
        const params = new URL(url, 'http://localhost').searchParams;
        const parent = params.get('parent');
        let items = [folder('采购 & 评审', '采购 & 评审')];
        if (params.get('q')) items = [file];
        else if (parent === '采购 & 评审') items = [folder('第二层', '采购 & 评审/第二层')];
        else if (parent === '采购 & 评审/第二层') items = [file];
        return {revision:1, items, total:items.length, scan:{state:'complete'}};
    });
    try {
        c.click('本地文件'); await tick();
        assert.ok(c.calls.some(call => call.url.includes('index=initial')));
        assert.doesNotMatch(c.w.document.querySelector('#localProjectFiles').textContent, /阶段资料概要|标准目录/);
        assert.equal(c.w.document.querySelectorAll('.local-files-list [data-parent]').length, 1);
        c.click('采购 & 评审'); await tick();
        c.click('第二层'); await tick();
        assert.match(c.w.document.querySelector('.local-files-list').textContent, /报价.pdf/);
        assert.equal(c.w.document.querySelector('[aria-current=location]').textContent, '第二层');
        c.click('上一级'); await tick();
        assert.match(c.w.document.querySelector('.local-files-list').textContent, /第二层/);
        const search = c.w.document.querySelector('[name=local_query]');
        search.value = '报价';
        search.dispatchEvent(new c.w.Event('input', {bubbles:true}));
        search.dispatchEvent(new c.w.KeyboardEvent('keydown', {key:'Enter', bubbles:true}));
        await tick();
        assert.match(c.w.document.querySelector('.local-files-list').textContent, /采购 & 评审 \/ 第二层/);
        assert.ok(c.calls.every(call => call.method === 'GET'));
    } finally { c.dom.window.close(); }
});
test('association timeout only reads state and requires explicit recovery before another write',async()=>{
    const c=setup((m)=>{if(m==='PUT')throw Error('timeout');return state();});
    try {c.click('本地文件'); await tick(); const path=c.w.document.querySelector('[name="association_path"]'); path.value='D:\\文件'; path.dispatchEvent(new c.w.Event('input',{bubbles:true})); c.click('确认关联'); await tick(); assert.equal(c.calls.filter(x=>x.method==='PUT').length,1); assert.equal(c.w.document.querySelector('[data-action="associate"]').disabled,true); c.click('已核对状态，恢复手动操作'); await tick(); assert.equal(c.w.document.querySelector('[data-action="associate"]').disabled,false); assert.equal(c.calls.filter(x=>x.method==='PUT').length,1);} finally {c.dom.window.close();}
});
test('scan cancellation carries project revision and task id and stops polling',async()=>{
    const scan={task_id:'task-1',state:'scanning',files:7,complete:false};
    const c=setup((m,u)=>u.endsWith('/scan/cancel')?{scan:{...scan,state:'cancelled'}}:u.includes('/entries')?{revision:2,items:[],total:0,has_more:false}:state({linked:true,revision:2,scan}));
    const timers=[]; c.w.setTimeout=(fn,ms)=>{timers.push(fn);return 123;}; const cleared=[]; c.w.clearTimeout=id=>cleared.push(id);
    try {c.click('本地文件'); await tick(); c.click('取消扫描'); await tick(); const call=c.calls.find(x=>x.url.endsWith('/scan/cancel')); assert.deepEqual(JSON.parse(JSON.stringify(call.body)),{expected_revision:2,task_id:'task-1'}); assert.match(c.w.document.body.textContent,/扫描已取消/); assert.ok(cleared.includes(123)); assert.equal(timers.length,1);} finally {c.dom.window.close();}
});
test('ordinary 403 keeps draft and never retries writes',async()=>{
    const c=setup(m=>{if(m==='PUT')throw Object.assign(Error('无权限'),{status:403});return state();});
    try {c.click('本地文件');await tick();const path=c.w.document.querySelector('[name="association_path"]');path.value='D:\\保留';path.dispatchEvent(new c.w.Event('input',{bubbles:true}));c.click('确认关联');await tick();assert.equal(c.calls.filter(x=>x.method==='PUT').length,1);assert.equal(c.w.document.querySelector('[name="association_path"]').value,'D:\\保留');assert.match(c.w.document.body.textContent,/无权限/);}finally{c.dom.window.close();}
});
test('late scan status cannot resume polling after cancellation',async()=>{
    let finish; const pending=new Promise(resolve=>finish=resolve);
    const scan={task_id:'t',state:'scanning',complete:false};
    const c=setup((m,u)=>u.endsWith('/scan/cancel')?{scan:{...scan,state:'cancelled'}}:u.endsWith('/scan')?pending:u.includes('/entries')?{revision:1,items:[],has_more:false}:state({linked:true,revision:1,scan}));
    const timers=[]; c.w.setTimeout=fn=>{timers.push(fn);return 1;}; c.w.clearTimeout=()=>{};
    try{c.click('本地文件');await tick();const poll=timers.shift();poll();await tick();c.click('取消扫描');await tick();finish({scan});await tick();assert.match(c.w.document.querySelector('.local-files-scan').textContent,/扫描已取消/);assert.equal(timers.length,0);}finally{c.dom.window.close();}
});
test('failed state read cannot unlock uncertain writes',async()=>{
    let failReads=false; const c=setup(m=>{if(m==='PUT'){failReads=true;throw Error('timeout');}if(failReads)throw Error('offline');return state();});
    try {c.click('本地文件');await tick();const path=c.w.document.querySelector('[name="association_path"]');path.value='D:\\资料';path.dispatchEvent(new c.w.Event('input',{bubbles:true}));c.click('确认关联');await tick();c.click('已核对状态，恢复手动操作');await tick();assert.equal(c.w.document.querySelector('[data-action="associate"]').disabled,true);assert.match(c.w.document.body.textContent,/offline/);}finally{c.dom.window.close();}
});
test('folder chooser cancellation preserves draft without binding, unlink is an explicit second action',async()=>{
    const c=setup((m,u)=>u.endsWith('/choose')?{cancelled:true}:m==='DELETE'?state():u.includes('/entries')?{revision:3,items:[],has_more:false}:state({linked:true,revision:3}));
    try{c.click('本地文件');await tick();const path=c.w.document.querySelector('[name="association_path"]');path.value='D:\\保留';path.dispatchEvent(new c.w.Event('input',{bubbles:true}));c.click('选择文件夹');await tick();assert.equal(c.w.document.querySelector('[name="association_path"]').value,'D:\\保留');assert.ok(!c.calls.some(x=>x.method==='PUT'));c.click('解除关联');assert.ok(!c.calls.some(x=>x.method==='DELETE'));assert.match(c.w.document.body.textContent,/磁盘上的所有资料均保留/);c.click('确认解除关联');await tick();assert.equal(c.calls.find(x=>x.method==='DELETE').body.expected_revision,3);assert.match(c.w.document.body.textContent,/尚未关联/);}finally{c.dom.window.close();}
});
