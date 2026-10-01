'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {JSDOM}=require(process.env.PM_JSDOM_MODULE || 'jsdom');
function setup(admin=true){
    const dom=new JSDOM('<div id="purchaserBoardContent"></div>',{runScripts:'outside-only'}),w=dom.window;
    w.currentIsAdmin=admin;w.escHtml=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    w.projectStatusInfo=p=>({cls:p.is_terminated?'terminated':p.progress>=100?'done':'active',text:p.is_terminated?'终止':p.progress>=100?'完成':'进行中',icon:''});
    w.projectStageDefinition=()=>({name:'编制文件'});w.getProgressColor=()=> '#333';w.selectProject=id=>w.opened=id;w.toast=()=>{};
    vm.runInContext('const purchaserUnitByName=new Map();const projectById=new Map();const projectOrderById=new Map();',dom.getInternalVMContext());
    w.eval(fs.readFileSync('source/frontend/16-purchaser-workspace.js','utf8'));
    w.eval(`projectById.set(1,{id:1,number:'GD-2026-001',name:'设备采购',year:2026,progress:100});projectById.set(2,{id:2,number:'GD-2025-021',name:'服务采购',year:2025,progress:20});projectById.set(3,{id:3,number:'GD-2026-006',name:'网络采购',year:2026,progress:60,is_terminated:true,terminated_type:'liubiao',second_tender:{id:4,number:'GD-2026-006 (2)'}});`);
    w.data={is_admin:admin,unit_total:3,categories:[{id:1,name:'教育',color:'#2563eb'}],groups:[{name:'教育',category:{id:1,color:'#2563eb'},units:[{name:'第一学校<script>',project_count:3,project_ids:[1,2,3],recent_project:'2026-09-01 10:00:00.123456'},{name:'第二学校',project_count:0,project_ids:[]}]},{name:'未分类',category:null,units:[{name:'银行',project_count:1,project_ids:[2]}]}]};
    w.renderPurchaserBoard(w.data);return {w,d:w.document};
}
test('unit search and category selection never leave hidden-unit projects visible',()=>{
    const {w,d}=setup();w.setPurchaserDirectoryFilter('query','银行');assert.equal(d.querySelectorAll('.purchaser-unit-open').length,1);assert.match(d.querySelector('#purchaserProjectPane').textContent,/银行/);
    w.setPurchaserDirectoryFilter('category','1');assert.equal(d.querySelectorAll('.purchaser-unit-open').length,0);assert.equal(d.querySelectorAll('.purchaser-project-row').length,0);
    w.clearPurchaserDirectoryFilters();assert.equal(d.querySelectorAll('.purchaser-unit-open').length,3);
});
test('project search, status, year and sorting compose without mutating data',()=>{
    const {w,d}=setup();assert.equal(d.querySelector('.purchaser-project-row').dataset.projectId,'2');
    w.setPurchaserProjectFilter('query','2026-001');assert.equal(d.querySelectorAll('.purchaser-project-row').length,1);
    w.setPurchaserProjectFilter('status','active');assert.equal(d.querySelectorAll('.purchaser-project-row').length,0);
    w.clearPurchaserProjectFilters();w.setPurchaserProjectFilter('year','2026');assert.equal(d.querySelectorAll('.purchaser-project-row').length,2);
    w.setPurchaserProjectFilter('sort','number');assert.equal(d.querySelector('.purchaser-project-row').dataset.projectId,'3');
    assert.equal(w.data.groups[0].units[0].project_ids.join(','),'1,2,3');
});
test('switching units resets project filters while reopening board preserves current unit',()=>{
    const {w,d}=setup();w.setPurchaserProjectFilter('query','不存在');w.openPurchaserProjects('银行');assert.equal(d.querySelectorAll('.purchaser-project-row').length,1);
    w.setPurchaserProjectFilter('query','服务');w.renderPurchaserBoard(w.data);assert.equal(d.querySelector('#purchaserProjectQuery').value,'服务');assert.match(d.querySelector('#purchaserProjectPane').textContent,/银行/);
});
test('input nodes retain focus and composition text during local result updates',()=>{
    const {w,d}=setup();const input=d.querySelector('#purchaserUnitQuery');input.focus();input.value='学校';w.setPurchaserDirectoryFilter('query',input.value);assert.equal(d.activeElement,input);assert.equal(d.querySelector('#purchaserUnitQuery'),input);
    w.renderPurchaserBoard(w.data);assert.equal(d.activeElement,input);assert.equal(d.querySelector('#purchaserUnitQuery'),input);
    const projectInput=d.querySelector('#purchaserProjectQuery');projectInput.focus();projectInput.value='采购';w.setPurchaserProjectFilter('query',projectInput.value);w.renderPurchaserBoard(w.data);assert.equal(d.activeElement,projectInput);assert.equal(d.querySelector('#purchaserProjectQuery'),projectInput);
});
test('admin controls, escaped names, dates and retender links survive redesign',()=>{
    const {w,d}=setup();assert.equal(d.querySelectorAll('script').length,0);assert.match(d.querySelector('#purchaserUnitResults').textContent,/2026-09-01/);assert.doesNotMatch(d.querySelector('#purchaserUnitResults').textContent,/123456/);
    assert.ok(d.querySelector('#purchaserProjectPane .admin-control'));d.querySelector('.purchaser-retender-link').click();assert.equal(w.opened,4);
    assert.equal(setup(false).d.querySelectorAll('.admin-control').length,0);
});
test('refresh after selected unit removal chooses a visible unit and clears stale project filters',()=>{
    const {w,d}=setup();w.openPurchaserProjects('银行');w.setPurchaserProjectFilter('query','服务');w.data.groups.pop();w.renderPurchaserBoard(w.data);
    assert.match(d.querySelector('#purchaserProjectPane').textContent,/第一学校/);assert.equal(d.querySelector('#purchaserProjectQuery').value,'');
});
