const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const setup=require('./procurement_ui_harness.cjs');
function harness(){const w=setup();vm.runInContext(fs.readFileSync('source/frontend/26-electronic-tender.js','utf8'),vm.createContext(w));return w;}
test('new project offers public electronic variant without changing the underlying catalog',()=>{
 const w=setup();const m=w.systemSettings.procurement_catalog.methods[0];m.name='公开招标';m.builtin_kind='公开招标';
 const html=w.procurementSelectOptions();assert.match(html,/公开招标-电子标/);assert.match(html,/value="electronic:one"/);
 const p=w.procurementSelectionPayload('electronic:one');assert.equal(p.procurement_method_id,'one');assert.equal(p.electronic_tender,true);assert.equal(m.name,'公开招标');
});
test('electronic registration renders cutoff count only, while opening renders names and quotes',()=>{
 const w=harness();const p={id:5,procurement:{electronic_tender:true},lots:[],registrations:[{id:3,company_name:'解密公司甲'}],electronic_tender:{revision:0,after_cutoff:true,cutoff:'2000-01-01T10:00:00+08:00',counts:[],quotes:{}}};
 const reg=w.renderElectronicRegistration(p);assert.match(reg,/报名家数/);assert.doesNotMatch(reg,/showRegistrationForm|解密公司甲/);
 const opening=w.renderElectronicOpening(p);assert.match(opening,/showRegistrationForm/);assert.match(opening,/解密公司甲/);assert.match(opening,/报价/);assert.match(opening,/data-electronic-quote="3"/);
});
test('unknown registration count stays empty rather than zero',()=>{
 const w=harness();const p={id:1,procurement:{electronic_tender:true},lots:[],registrations:[],electronic_tender:{counts:[],quotes:{},after_cutoff:false,cutoff:null}};
 assert.match(w.renderElectronicRegistration(p),/value=""/);assert.doesNotMatch(w.renderElectronicRegistration(p),/value="0"/);
});

test('opening quote draft survives redraw and keeps its original conflict token',()=>{
 const w=harness();const p={id:5,procurement:{electronic_tender:true},lots:[],registrations:[{id:3,company_name:'解密公司甲'}],electronic_tender:{revision:7,record_version:'original',counts:[],quotes:{}}};
 w.currentProject=p;w.document.body.innerHTML='<section id="slidePanel" class="open"><div id="slideBody">'+w.renderElectronicOpening(p)+'</div></section>';
 w.initElectronicCutoff();let input=w.document.querySelector('[data-electronic-quote]');input.value='999.00';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 p.electronic_tender={revision:8,record_version:'new',counts:[],quotes:{3:'200.00'}};
 w.document.getElementById('slideBody').innerHTML=w.renderElectronicOpening(p);w.initElectronicCutoff();input=w.document.querySelector('[data-electronic-quote]');
 assert.equal(input.value,'999.00');assert.equal(w.document.querySelector('[data-electronic-opening]').electronicState.revision,7);
 w.close();
});
test('background model refresh does not lose bound quote state or write using a new token',async()=>{
 const w=harness();const p={id:5,procurement:{electronic_tender:true},lots:[],registrations:[{id:3,company_name:'解密公司甲'}],electronic_tender:{revision:7,record_version:'original',counts:[],quotes:{}}};
 w.currentProject=p;w.document.body.innerHTML='<section id="slidePanel" class="open"><div id="slideBody">'+w.renderElectronicOpening(p)+'</div></section>';w.initElectronicCutoff();const input=w.document.querySelector('[data-electronic-quote]');input.value='10.00';input.dispatchEvent(new w.Event('input',{bubbles:true}));
 w.currentProject={...p,electronic_tender:undefined};let captured;w.api=async(m,path,body)=>{captured=body;return {revision:8,record_version:'original',quotes:{3:'10.00'}}};
 assert.equal(await w.saveElectronicQuotes(),true);assert.equal(captured.revision,7);assert.equal(captured.record_version,'original');assert.equal(input.value,'10.00');w.close();
});

test('a closed package keeps its quote history read-only and leaves active package editable',()=>{
 const w=harness();const p={id:5,procurement:{electronic_tender:true},registrations:[{id:3,lot_id:31,company_name:'已流标包供应商'},{id:4,lot_id:32,company_name:'继续采购包供应商'}],electronic_tender:{closed_lot_ids:[31],quotes:{3:'100.00'}}};
 w.document.body.innerHTML=w.renderElectronicOpening(p);
 assert.equal(w.document.querySelector('[data-electronic-quote="3"]'),null);
 assert.equal(w.document.querySelector('[onclick="showRegistrationForm(3)"]'),null);
 assert.ok(w.document.querySelector('[data-electronic-quote="4"]'));
 assert.match(w.document.body.textContent,/已流标包供应商/);assert.match(w.document.body.textContent,/100.00/);w.close();
});

test('conflict reload without a dirty draft refreshes the original drawer instead of doing nothing',async()=>{
 const w=harness();w.currentProject={id:5,procurement:{electronic_tender:true},lots:[],electronic_tender:{revision:2,record_version:'old',counts:[{lot_id:null,count:3}]}};w.editingStageKey='reg';
 let refreshed=0,opened=0;w.api=async()=>({enabled:true,revision:3,record_version:'new',counts:[{lot_id:null,count:4}]});w.refreshProject=async()=>refreshed++;w.openStageSlide=key=>{assert.equal(key,'reg');opened++;};
 await w.reviewElectronicDraft(5,'registration');assert.equal(refreshed,1);assert.equal(opened,1);assert.equal(w.currentProject.electronic_tender.revision,3);w.close();
});

test('saving a registration cutoff enables count entry without losing the existing form tokens',async()=>{
 const w=harness();const p={id:5,procurement:{electronic_tender:true},lots:[],stages:[{key:'reg',modules:['registration']}],electronic_tender:{revision:2,record_version:'own-save',counts:[],cutoff:null}};w.currentProject=p;w.editingStageKey='reg';w.stageHasModule=(s,m)=>s.modules.includes(m);
 w.document.body.innerHTML='<section id="slidePanel" class="open">'+w.renderElectronicRegistration(p)+'</section>';w.initElectronicCutoff();
 w.api=async()=>({revision:3,record_version:'someone-else',cutoff:'2000-01-01T10:00:00+08:00',after_cutoff:true,counts:[]});
 await w.refreshElectronicCutoffAfterStageSave(p,'reg');assert.equal(w.document.querySelector('[data-electronic-count]').readOnly,false);assert.equal(w.document.querySelector('[data-electronic-count-save]').hidden,false);assert.match(w.document.querySelector('[data-electronic-cutoff]').textContent,/2000/);
 assert.equal(w.document.querySelector('[data-electronic-registration]').electronicState.record_version,'own-save');assert.equal(w.document.querySelector('[data-electronic-registration]').electronicState.revision,2);w.close();
});

test('existing project information distinguishes public tender and electronic choices in both directions',()=>{
 const w=setup();const m=w.systemSettings.procurement_catalog.methods[0];m.name='公开招标';m.builtin_kind='公开招标';
 const p={procurement:{method_id:m.id,electronic_tender:false},method:'公开招标'};
 w.document.body.innerHTML='<select id="choice">'+w.procurementSelectOptions(p,'change')+'</select>';let select=w.document.getElementById('choice');
 assert.ok(select.querySelector('option[value="electronic:one"]'));assert.equal(select.value,'one');
 p.procurement.electronic_tender=true;w.document.body.innerHTML='<select id="choice">'+w.procurementSelectOptions(p,'change')+'</select>';select=w.document.getElementById('choice');
 assert.equal(select.value,'electronic:one');assert.equal(select.querySelector('option[value="one"]').textContent,'公开招标');
 assert.equal(w.procurementSelectionPayload('one',p).electronic_tender,false);w.close();
});

test('package reprocurement keeps real catalog identities and does not offer a project-only electronic variant',()=>{
 const w=setup();const m=w.systemSettings.procurement_catalog.methods[0];m.name='公开招标';m.builtin_kind='公开招标';assert.doesNotMatch(w.procurementSelectOptions(null,'reprocure'),/electronic:/);w.close();
});
