'use strict';
// Source interface + synthetic API: covers keyboard actions, four themes and 375px.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PM_PLAYWRIGHT_MODULE||'playwright');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,'');
async function capture(page,name){if(process.env.PM_REUSE_CAPTURE_DIR){fs.mkdirSync(process.env.PM_REUSE_CAPTURE_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.PM_REUSE_CAPTURE_DIR,name+'.png'),fullPage:true});}}
test('reuse confirmation and special bases support four themes, desktop/phone layouts and keyboard operation',async()=>{
    const edge=process.env.PM_EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
    try{for(const theme of ['default','blue','green','dark'])for(const width of [1366,375]){
        const page=await browser.newPage({viewport:{width,height:960},reducedMotion:'reduce'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
        try{
            await page.route('http://127.0.0.1/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${read('src/static/style.css')}</style>${read('src/templates/workspace.html').replace(/<script\b[\s\S]*?<\/script>/g,'')}`}));
            await page.goto('http://127.0.0.1/reuse-ui-fixture');
            for(const file of ['01-core.js','00-icons.js','02-projects.js','04-project-workflow.js','07-business.js','09-command-center.js','11-stage-settings.js','14-online-bidding.js','17-datetime-picker.js','18-tender-guarantee.js','20-form-accessibility.js','22-procurement-methods.js','23-project-flow-editor.js'])await page.addScriptTag({content:read('source/frontend/'+file)});
            await page.evaluate(theme=>{
                document.documentElement.dataset.theme=theme;window.CURRENT_USER={id:1,is_admin:true};syncAccountAccess({role:'admin'});systemSettings={};
                currentProject={id:71,name:'合成两家供应商采购项目',method:'公开招标',no_deposit:true,lots:[],registrations:[{id:7,company_name:'华信设备供应有限公司',lot_id:null},{id:8,company_name:'远航商贸有限公司',lot_id:null}],stages:[{key:'opening',name:'开标',modules:['common','bid_opening']},{key:'evaluation',name:'评标',modules:['common','evaluation']},{key:'publication',name:'公示',modules:['common','evaluation']}].map(s=>({...s,notes:'',checklist:[]})),tender_guarantee:{revision:3,data:{confirmed:true,records:[7,8].map(id=>({registration_id:id,participation:'submitted',validity:'valid',deposit_status:'paid',deposit_amount:'100',refunded_amount:'0',handling:'rule',handling_reason:'',manual_start_at:'',manual_deadline:'',manual_basis:'',review_at:''})),rules:[]},summary:{},policy:{strict_results:true}}};
                window.fixtureRequests=[];window.fixtureNotices=[];window.toast=(...args)=>fixtureNotices.push(args);window.refreshProject=async()=>{};
                window.fixtureDecision={source_stage_key:'opening',phase:'submitted',reason:'采购人书面同意两家继续，仍须按本阶段有效性核验。',actor:'合成核对员',created_at:'2026-11-04T01:02:03+00:00'};
                window.fixtureQuantity={applicable:true,status:'shortage',phase:'valid',lot_id:null,actual_count:2,required_count:3,fingerprint:'current-valid-token',suggested_decision:fixtureDecision};
                window.api=async(method,url,body)=>{fixtureRequests.push({method,url,body});if(url.includes('/supplier-quantity')){if(method==='POST')fixtureQuantity={...fixtureQuantity,status:'confirmed',decision:{...fixtureDecision,reason:body.reason,source_stage_key:body.stage_key,phase:'valid'},suggested_decision:null};return {items:[fixtureQuantity]};}return {};};
                openStageSlide('evaluation');
            },theme);
            await page.locator('#quantityReason0').waitFor({state:'visible'});
            assert.equal(await page.locator('#quantityReason0').inputValue(),'采购人书面同意两家继续，仍须按本阶段有效性核验。');
            assert.match(await page.locator('#stageQuantityCard').textContent(),/开标.*已提交并接收/);
            assert.equal(await page.locator('.online-participation').evaluate(el=>el.open),false);
            assert.equal(await page.evaluate(()=>fixtureRequests.filter(x=>x.method!=='GET').length),0);
            const summary=page.locator('.online-participation>summary');await summary.focus();await page.keyboard.press('Enter');
            assert.equal(await page.locator('.online-participation').evaluate(el=>el.open),true);
            const recheck=page.getByRole('button',{name:'重新核对',exact:true});assert.match(await recheck.getAttribute('class'),/btn-secondary/);await recheck.focus();await page.keyboard.press('Enter');await page.locator('#modal.open').waitFor();
            assert.equal(await page.evaluate(()=>fixtureRequests.filter(x=>x.method==='PUT').length),0);await page.evaluate(()=>closeModal());
            await summary.focus();await page.keyboard.press('Enter');
            await capture(page,`${theme}-${width}-suggestion`);
            const reason=page.locator('#quantityReason0');await reason.fill('已核对两家有效投标，可按本次依据继续');await reason.focus();const focus=await reason.evaluate(el=>getComputedStyle(el).boxShadow);assert.notEqual(focus,'none',`${theme}/${width}: visible input focus`);
            const confirm=page.getByRole('button',{name:'确认本次数量并继续',exact:true});await confirm.focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>fixtureRequests.some(x=>x.method==='POST'));
            assert.equal(await page.evaluate(()=>fixtureRequests.find(x=>x.method==='POST').body.stage_key),'evaluation');
            await page.evaluate(()=>{fixtureQuantity.decision_reused=true;openStageSlide('publication');});await page.waitForFunction(()=>document.querySelector('#stageQuantityCard').textContent.includes('已沿用数量确认'));
            assert.match(await page.locator('#stageQuantityCard').textContent(),/来源：评标/);assert.equal(await page.locator('#quantityReason0').count(),0);assert.equal(await page.locator('#slideBody').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${theme}/${width}: no slide overflow`);
            await page.locator('#stageQuantityCard').scrollIntoViewIfNeeded();await capture(page,`${theme}-${width}-reused`);
            await page.evaluate(()=>showGuaranteeSpecialForm(7));await page.locator('#modal.open').waitFor();
            assert.equal(await page.locator('label[for="tgAuditReason"]').textContent(),'补充说明（选填）');
            const manual=page.locator('#modalBody details').filter({has:page.locator('#tgManualBasis')}).locator('summary');await manual.focus();await page.keyboard.press('Enter');await page.locator('#tgManualBasis').waitFor({state:'visible'});
            // Date inputs are replaced by visible themed triggers. A missing start date
            // must focus that trigger, rather than the hidden original input.
            await page.evaluate(()=>{document.querySelector('#tgManualDeadline').value='2026-11-08T17:00';PMDateTime.refresh();});
            await page.locator('#modalSaveBtn').click();
            assert.equal(await page.evaluate(()=>document.activeElement===document.querySelector('#tgManualStart').parentElement.querySelector('.pm-datetime-trigger')),true,'missing date focuses the visible temporal control');
            await page.evaluate(()=>{document.querySelector('#tgManualStart').value='2026-11-01';document.querySelector('#tgManualDeadline').value='2026-11-08T17:00';PMDateTime.refresh();});
            await page.locator('#tgManualBasis').fill('采购人书面通知改期，已核实通知日期');
            assert.equal(await page.locator('#modalBody').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`${theme}/${width}: no modal overflow`);
            await capture(page,`${theme}-${width}-special`);await page.locator('#tgAuditReason').scrollIntoViewIfNeeded();await capture(page,`${theme}-${width}-special-audit`);
            await page.locator('#modalSaveBtn').focus();await page.keyboard.press('Enter');await page.waitForFunction(()=>fixtureRequests.some(x=>x.method==='PUT'));
            const saved=await page.evaluate(()=>fixtureRequests.find(x=>x.method==='PUT').body);assert.equal(saved.reason,'调整退还期限：采购人书面通知改期，已核实通知日期');assert.equal(saved.confirm_cash_correction,false);assert.equal(saved.data.records[0].deposit_amount,'100');
            // Opening the no-lot failure action still asks for the existing explicit reason dialog.
            await page.evaluate(()=>openStageSlide('opening'));const before=await page.evaluate(()=>fixtureRequests.filter(x=>x.method==='PUT').length);const failProject=page.getByRole('button',{name:'投标响应不足，标记项目流标',exact:true});await failProject.focus();await page.keyboard.press('Enter');await page.locator('#reasonDialog.open').waitFor();assert.equal(await page.locator('#reasonInput').inputValue(),'');assert.equal(await page.evaluate(()=>fixtureRequests.filter(x=>x.method==='PUT').length),before);await page.locator('#reasonCancel').focus();await page.keyboard.press('Enter');await page.locator('#reasonDialog.open').waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>fixtureRequests.filter(x=>x.method==='PUT').length),before);
            await page.evaluate(()=>{window.CURRENT_USER={role:'viewer',permissions:{}};refreshAccountAccessControls();});assert.equal(await failProject.isDisabled(),true,'whole-project flow action preserves edit permission');
            assert.deepEqual(errors,[],`${theme}/${width}: browser errors`);
        }finally{await page.close();}
    }}finally{await browser.close();}
});
