'use strict';
const assert=require('node:assert/strict'),test=require('node:test'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'../source/frontend/06-admin.js'),'utf8');
function harness(overrides={}) {
 const fields=Object.fromEntries(Object.entries({npNumber:'PRJ-2026-017',npName:'测试项目',npPurchaser:'测试采购人',npMethod:'公开招标',npBudget:'',npPrepareOwner:'',npReviewOwner:'',npYear:'2026'}).map(([k,value])=>[k,{value}]));
 fields.npNoDeposit={checked:false};fields.npMultiPack={checked:true};fields.packEditor={style:{display:'none'}};
 const state={document:{getElementById:id=>fields[id]},window:{_newProjectLots:[{lot_number:'包1',lot_name:'设备'}]},allProjects:[],currentProject:null,METHODS:['公开招标'],toast(){},showModal(title,html){state.html=html;},storeProjectDetail(){},closeModal(){},renderSidebar(){},selectProject(){},initializeProjectChecklistDefaults:async()=>{},requestProjectDetail:async()=>({accepted:false}),api:async()=>({id:17}),...overrides};
 vm.createContext(state);vm.runInContext(source.slice(0,source.indexOf('function editCurrentProject(')),state);return {state,fields};
}
test('failed creation retains lots and retry sends them',async()=>{
 let fail=true;const calls=[];const {state}=harness({api:async(method,url,data)=>{calls.push(url);if(fail)throw Error('offline');return {id:17};}});
 await state.createProject();assert.equal(state.window._newProjectLots.length,1);fail=false;await state.createProject();assert.deepEqual(calls,['/api/projects','/api/projects','/api/projects/17/lots']);assert.equal(state.window._newProjectLots.length,0);
});
test('double submit cannot create two projects',async()=>{
 let release;const pending=new Promise(resolve=>release=resolve);let requests=0;const {state}=harness({api:async()=>{requests++;await pending;return {id:17};}});state.window._newProjectLots=[];
 const a=state.createProject(),b=state.createProject();release();await Promise.all([a,b]);assert.equal(requests,1);
});
test('new number uses highest current-year numeric suffix even with gaps',()=>{
 const year=new Date().getFullYear();const {state}=harness({allProjects:[{year,number:`PRJ-${year}-001`},{year,number:`PRJ-${year}-016`},{year,number:`PRJ-${year}-099`},{year:year-1,number:`PRJ-${year-1}-900`},{year,number:'CUSTOM-999'},{year,number:null}]});
 state.showNewProjectModal();assert.match(state.html,new RegExp(`value="PRJ-${year}-100"`));
});
test('checkbox change uses actual checked state without inverting it',()=>{
 const {state,fields}=harness();state.showNewProjectModal();assert.match(state.html,/id="npMultiPack"[^>]*onchange="toggleMultiPack\(\)"/);
 fields.npMultiPack.checked=true;state.toggleMultiPack();assert.equal(fields.packEditor.style.display,'block');assert.equal(fields.npMultiPack.checked,true);
 fields.npMultiPack.checked=false;state.toggleMultiPack();assert.equal(fields.packEditor.style.display,'none');
});
test('partial lot failure retains only pending lots and retry does not recreate project',async()=>{
 let fail=true,closed=0;const calls=[],messages=[];
 const {state}=harness({closeModal(){closed++;},toast(message){messages.push(message);},api:async(method,url,data)=>{calls.push([url,data?.lot_number]);if(url.endsWith('/lots')&&data.lot_number==='包2'&&fail)throw Error('disk full');return {id:17};}});
 state.window._newProjectLots.push({lot_number:'包2',lot_name:'服务'});
 await state.createProject();assert.equal(closed,0);assert.equal(state.window._newProjectLots.length,1);assert.equal(state.window._newProjectLots[0].lot_number,'包2');assert.ok(messages.some(m=>m.includes('重试')));
 fail=false;await state.createProject();assert.equal(closed,1);assert.equal(state.window._newProjectLots.length,0);assert.deepEqual(calls,[['/api/projects',undefined],['/api/projects/17/lots','包1'],['/api/projects/17/lots','包2'],['/api/projects/17/lots','包2']]);
});

