'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {JSDOM}=require('jsdom');
const acorn=require('acorn');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'src/templates/workspace.html'),'utf8').replace(/<script\b[\s\S]*?<\/script>/g,'');
const source=['01-core.js','02-projects.js','04-project-workflow.js','05-views.js','08-bootstrap.js','09-command-center.js','10-chart-board.js','11-stage-settings.js','22-procurement-methods.js','24-ui-preferences.js'].map(file=>{
 const text=fs.readFileSync(path.join(root,'source/frontend',file),'utf8');
 if(file!=='08-bootstrap.js')return text;
 const init=acorn.parse(text,{ecmaVersion:'latest'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name==='init');
 return text.slice(init.start,init.end);
}).join('\n');
function setup(t){
 const dom=new JSDOM(html,{url:'http://localhost',runScripts:'outside-only'});t.after(()=>dom.window.close());
 const w=dom.window;w.matchMedia=()=>({matches:false,addEventListener(){}});
 w.eval(source+'\nwindow.seedTransportSelection=p=>{currentProject=p;};window.seedTransport=rows=>{allProjects=rows;rebuildProjectIndexes(rows);};window.readTransport=()=>allProjects;');
 return {w,d:w.document};
}
function response(body,{status=200,type='application/json',redirected=false,url='http://localhost/api/projects'}={}){
 return {ok:status>=200&&status<300,status,redirected,url,headers:{get:()=>type},json:async()=>body};
}
test('JSON APIs and multipart APIs reject a login page instead of returning an empty object',async t=>{
 const {w}=setup(t);w.fetch=async()=>response(null,{type:'text/html',redirected:true,url:'http://localhost/login'});
 await assert.rejects(w.api('GET','/api/projects'),/登录.*过期|重新登录/);
 await assert.rejects(w.apiForm('/api/projects/1/attachments',new w.FormData()),/登录.*过期|重新登录/);
});
test('malformed JSON and wrong project list shapes preserve the previous list',async t=>{
 const {w}=setup(t);const rows=[{id:1,name:'原项目',stages:[]}];w.seedTransport(rows);
 w.fetch=async()=>({...response(null),json:async()=>{throw new Error('Unexpected token');}});
 await assert.rejects(w.loadAllProjects(),/数据.*格式/);assert.equal(w.readTransport(),rows);
 w.fetch=async()=>response({});await assert.rejects(w.loadAllProjects(),/项目列表.*格式/);assert.equal(w.readTransport(),rows);
});
test('explicit CSRF 403 retries once with a new token; permission 403 never retries',async t=>{
 const {w}=setup(t);let calls=0,refreshes=0;w.CSRF_TOKEN='old';
 w.refreshAttachmentCsrfToken=async()=>{refreshes++;w.CSRF_TOKEN='new';return true;};
 const seen=[];w.fetch=async(_,opts)=>{seen.push(opts.headers['X-CSRFToken']);return ++calls===1?response({error:'请求已过期，请刷新后重试'},{status:403}):response({saved:true});};
 assert.equal((await w.api('PUT','/api/test',{name:'合成'})).saved,true);assert.equal(calls,2);assert.equal(refreshes,1);assert.deepEqual(seen,['old','new']);
 calls=0;refreshes=0;w.fetch=async()=>{calls++;return response({error:'无权操作'},{status:403});};
 await assert.rejects(w.api('PUT','/api/test',{}),/无权操作/);assert.equal(calls,1);assert.equal(refreshes,0);
});
test('a hung API request times out without automatically replaying a write',async t=>{
 const {w}=setup(t);let calls=0;const later=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>later(fn,ms===20000?1:ms,...args);
 w.fetch=(_,opts)=>{calls++;return new Promise((resolve,reject)=>opts.signal?.addEventListener('abort',()=>reject(new w.DOMException('aborted','AbortError'))));};
 await assert.rejects(w.api('POST','/api/test',{}),/超时.*核实/);assert.equal(calls,1);
});
test('initialization failure leaves a persistent retry, and a successful retry removes it',async t=>{
 const {w,d}=setup(t);let tries=0;
 Object.assign(w,{enhanceApplicationShell(){},installChartBoardShell(){},ensurePurchaserBoardWorkspace(){},showLoading(){},hideLoading(){},loadProcurementCatalog:async()=>{},loadPreferredHome:async()=>{},playViewEnter(){},startDeviceAdmissionSummaryPolling(){}});
 w.api=async()=>({license:{}});w.loadAllProjects=async()=>{if(!tries++)throw new Error('网络失败');};
 await w.init();const host=d.getElementById('appInitError');assert(host);assert.match(host.textContent,/重试/);
 host.querySelector('button').click();await new Promise(resolve=>setImmediate(resolve));assert.equal(tries,2);assert.equal(d.getElementById('appInitError'),null);
});
test('server read-only mode is persistent, blocks writes and can recover after a status refresh',async t=>{
 const {w,d}=setup(t);let calls=0;w.fetch=async()=>{calls++;return response({mode:'full',status:'valid'});};
 w.syncApplicationAccess({mode:'read_only',status:'expired',message:'授权已到期'});
 assert.match(d.getElementById('appAccessBanner').textContent,/只读/);assert.equal(d.getElementById('sidebarNewProjectBtn').disabled,true);
 await assert.rejects(w.api('POST','/api/test',{}),/只读/);assert.equal(calls,0);
 await w.api('GET','/api/test');assert.equal(calls,1);
 await w.refreshApplicationAccess();assert.equal(d.getElementById('appAccessBanner'),null);assert.equal(d.getElementById('sidebarNewProjectBtn').disabled,false);
});
for(const multipart of [false,true]) test(`request deadline covers a hanging ${multipart?'multipart':'JSON'} response body without replay`,async t=>{
 const {w}=setup(t);let calls=0;const later=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>later(fn,[20000,900000].includes(ms)?1:ms,...args);
 w.fetch=async()=>{calls++;return {...response(null),json:()=>new Promise(()=>{})};};
 const request=multipart?w.apiForm('/api/test',new w.FormData()):w.api('POST','/api/test',{});
 const outcome=await Promise.race([request.then(()=>null,error=>error),new Promise(resolve=>setTimeout(()=>resolve('pending'),40))]);
 assert.equal(outcome?.error_code,'REQUEST_TIMEOUT');assert.equal(calls,1);
});
test('saving A never gives a stale B draft or project metadata a newer token',async t=>{
 const {w}=setup(t);const project={id:1,name:'原名称',budget:'100',record_version:'P-old',stages:[{key:'a',notes:'A-old',record_version:'A-old'},{key:'b',notes:'B-old-draft',record_version:'B-old'}]};w.seedTransport([project]);w.seedTransportSelection(project);w.queueProjectDetailPrefetch=()=>{};
 const requests=[];w.fetch=async(url,opts)=>{
  const body=JSON.parse(opts.body);requests.push({url,body});
  if(url.endsWith('/stages/a'))return response({...project,name:'他人名称',budget:'200',record_version:'P-after-A',record_version_base:'P-after-others',stages:[{key:'a',notes:'A-saved',record_version:'A-new'},{key:'b',notes:'B-other-new',record_version:'B-new'}]});
  return response({error:'记录已更新',code:'RECORD_VERSION_CONFLICT'},{status:409});
 };
 await w.api('PUT','/api/projects/1/stages/a',{notes:'A-saved'});
 assert.equal(project.stages[1].record_version,'B-old');assert.equal(project.record_version,'P-old');assert.equal(project.budget,'100');
 await assert.rejects(w.api('PUT','/api/projects/1/stages/b',{notes:project.stages[1].notes}),/记录已更新/);
 await assert.rejects(w.api('PUT','/api/projects/1',{budget:'旧草稿预算'}),/记录已更新/);
 assert.equal(requests[1].body.record_version,'B-old');assert.equal(requests[2].body.record_version,'P-old');
});
test('serial writes can advance their own baseline when the server proves the previous project snapshot',async t=>{
 const {w}=setup(t);const project={id:1,name:'原名称',record_version:'P-old',stages:[{key:'a',notes:'old',record_version:'A-old'},{key:'b',notes:'B-old',record_version:'B-old'}]};w.seedTransport([project]);w.seedTransportSelection(project);w.queueProjectDetailPrefetch=()=>{};
 w.fetch=async()=>response({...project,record_version:'P-new',record_version_base:'P-old',stages:[{key:'a',notes:'saved',record_version:'A-new'},project.stages[1]]});
 await w.api('PUT','/api/projects/1/stages/a',{notes:'saved'});assert.equal(project.record_version,'P-new');assert.equal(project.stages[0].notes,'saved');assert.equal(project.stages[0].record_version,'A-new');assert.equal(project.stages[1].record_version,'B-old');
});
