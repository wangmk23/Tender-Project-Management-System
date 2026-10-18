const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');const setup=require('./procurement_ui_harness.cjs');
test('settings preference/filter and editor fields receive shared themed control dimensions',()=>{
 const w=setup();w.document.getElementById('catalogManagerHost').innerHTML=w.renderProcurementMethodManager();
 w.document.body.insertAdjacentHTML('beforeend','<section class="appearance-preferences"><label class="ui-preference-field">字号<select><option>标准</option></select></label></section><div class="shared-stage-fields"><label>名称<input></label></div>');
 const style=w.document.createElement('style');style.textContent=fs.readFileSync('src/static/style.css','utf8');w.document.head.append(style);
 for(const control of w.document.querySelectorAll('.procurement-filter select,.appearance-preferences select,.shared-stage-fields input')){
  assert.ok(parseFloat(w.getComputedStyle(control).minHeight)>=40,control.outerHTML);
  assert.notEqual(w.getComputedStyle(control).borderRadius,'');
 }
 w.close();
});
test('national preset provenance is visible without renaming historical methods',()=>{
 const w=setup();w.systemSettings.procurement_catalog.methods[0].reference_preset={kind:'national_reference',checked_on:'2026-10-18',scope:'适用于政府采购货物服务',sources:[{title:'官方依据',url:'https://www.mof.gov.cn/'}]};
 const html=w.renderProcurementMethodManager();assert.match(html,/国家参考预设/);assert.match(html,/适用于政府采购货物服务/);assert.match(html,/noopener/);assert.match(html,/https:\/\/www.mof.gov.cn\//);w.close();
});
test('all-regimes view groups ready methods first and keeps historical pending configs last',()=>{
 const w=setup();const cat=w.systemSettings.procurement_catalog;
 cat.methods.unshift({id:'pending-first',name:'保留原配置',regime:null,enabled:true,quantity_rule:{mode:'fixed',minimum:3},template_mode:'common'});
 cat.methods.push({id:'gov-last',name:'公开招标',regime:'government_procurement',enabled:true,quantity_rule:{mode:'fixed',minimum:3},template_mode:'common'});
 const host=w.document.getElementById('catalogManagerHost');host.innerHTML=w.renderProcurementMethodManager();
 assert.equal(host.querySelector('[data-method-id]').dataset.methodId,'gov-last');
 assert.equal(host.querySelectorAll('.procurement-regime-heading').length,4);
 w.close();
});
