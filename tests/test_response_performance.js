const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const projects=fs.readFileSync('source/frontend/02-projects.js','utf8');
const bootstrap=fs.readFileSync('source/frontend/08-bootstrap.js','utf8');
test('startup starts project loading before system metadata resolves',async()=>{
 let resolveInfo,loaded=false;
 const s={document:{title:'',getElementById:()=>null,querySelector:()=>null},window:{CURRENT_USER:{}},systemInfo:null,
  enhanceApplicationShell(){},installChartBoardShell(){},ensurePurchaserBoardWorkspace(){},showLoading(){},hideLoading(){},toast(){},playViewEnter(){},prefetchCommonViews(){},
  api:()=>new Promise(resolve=>resolveInfo=resolve),loadAllProjects:async()=>{loaded=true;},loadDashboard:async()=>{},Math,Date};
 vm.runInNewContext(bootstrap.slice(0,bootstrap.indexOf('// ── 数据导出')),s);
 const result=s.init();assert.equal(loaded,true);resolveInfo({});await result;
});
test('project tabs render on demand once per revision and preserve active edits',()=>{
 const calls=[];const s={Set,currentProject:{id:1},document:{querySelector:()=>({dataset:{tab:'info'}})}};
 for(const [name,fn] of Object.entries({board:'renderBoard',timeline:'renderTimeline',tasks:'renderTasks',info:'renderInfo',attachments:'renderAttachments'}))s[fn]=()=>calls.push(name);
 vm.runInNewContext(projects.slice(projects.indexOf('let dirtyProjectTabs'),projects.indexOf('function renderProjectDetail')),s);
 s.ensureProjectTabRendered('board');s.ensureProjectTabRendered('board');assert.deepEqual(calls,['board']);
 s.ensureProjectTabRendered('info');s.invalidateProjectTabRenders('info');s.ensureProjectTabRendered('info');assert.deepEqual(calls,['board','info']);
 s.ensureProjectTabRendered('attachments');s.ensureProjectTabRendered('attachments');assert.deepEqual(calls,['board','info','attachments']);
 s.invalidateProjectTabRenders();s.ensureProjectTabRendered('info');assert.equal(calls.at(-1),'info');assert.equal(calls.length,4);
});
