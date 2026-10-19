const test=require('node:test');const assert=require('node:assert/strict');const setup=require('./procurement_ui_harness.cjs');
test('personal catalog hides duplicate reference entries and makes the saved legacy method selectable',()=>{
 const w=setup(),cat=w.systemSettings.procurement_catalog;cat.personal_profile={active:true,hidden_method_ids:['one','two'],issues:[]};cat.methods[2].enabled=true;
 const rows=w.procurementMethodOptions();assert.equal(rows.length,1);assert.equal(rows[0].id,'old');
 const html=w.renderProcurementMethodManager(cat);assert.doesNotMatch(html,/待确认制度|待分配/);assert.match(html,/我的采购流程/);
 assert.match(html,/data-method-id="old"/);assert.doesNotMatch(html,/data-method-id="one"/);
});
test('manager has a compact selection list and a selected method flow overview',()=>{
 const w=setup(),html=w.renderProcurementMethodManager();w.document.getElementById('catalogManagerHost').innerHTML=html;
 assert.ok(w.document.querySelector('[data-procurement-workspace]'));assert.ok(w.document.querySelector('[data-procurement-overview]'));
 w.selectProcurementManagerMethod('two');assert.equal(w.document.querySelector('[data-procurement-overview]').dataset.methodIdDetail,'two');
 assert.match(w.document.querySelector('[data-procurement-overview]').textContent,/开始/);
});
