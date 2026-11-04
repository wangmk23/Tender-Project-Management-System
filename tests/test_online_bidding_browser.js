'use strict';
// Source UI + simulated service responses: no frozen EXE or production data.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const root=path.resolve(__dirname,'..'),read=file=>fs.readFileSync(path.join(root,file),'utf8').replace(/^\uFEFF/,'');
const captureDir=path.join(root,'_build/bidding-v60/source-ui-fixture');
async function capture(page,name){if(process.env.PM_BIDDING_CAPTURE==='1'){fs.mkdirSync(captureDir,{recursive:true});await page.screenshot({path:path.join(captureDir,name+'.png'),fullPage:true});}}
test('online quotation table, confirmation and seven step rail fit four themes and phone widths with keyboard actions',async()=>{
    const edge=process.env.PM_EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
    try{for(const theme of ['default','blue','green','dark'])for(const width of [1366,375]){
        const page=await browser.newPage({viewport:{width,height:960},reducedMotion:'reduce'}),errors=[];
        page.on('pageerror',error=>errors.push(error.message));
        try{
            await page.route('http://127.0.0.1/**',route=>route.fulfill({contentType:'text/html; charset=utf-8',body:`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${read('src/static/style.css')}\n${read('src/project_manager/static/css/online-bidding.css')}#app>.main,#sidebar{display:none}#fixtureRail{max-width:1000px;margin:16px;padding:8px}</style>${read('src/templates/workspace.html').replace(/<script\b[\s\S]*?<\/script>/g,'')}<div id="fixtureRail"></div>`}));
            await page.goto('http://127.0.0.1/fixture');
            for(const file of ['01-core.js','00-icons.js','02-projects.js','04-project-workflow.js','07-business.js','09-command-center.js','11-stage-settings.js','14-online-bidding.js','17-datetime-picker.js','18-tender-guarantee.js','20-form-accessibility.js','22-procurement-methods.js'])await page.addScriptTag({content:read('source/frontend/'+file)});
            await page.evaluate(theme=>{
                document.documentElement.dataset.theme=theme;window.CURRENT_USER={id:1,is_admin:true};syncAccountAccess({role:'admin'});
                currentProject={id:1,name:'合成网上竞价项目',method:'网上竞价',online_bidding_enabled:true,no_deposit:true,lots:[],bid_results:[],registrations:[{id:7,company_name:'华信设备供应有限公司',lot_id:null},{id:8,company_name:'远航商贸有限公司',lot_id:null}],stages:onlineBiddingTemplate().map(s=>({...s,key:s.id,record_version:'stage-v3',notes:'',checklist:[]})),tender_guarantee:{data:{confirmed:true,records:[{registration_id:7,participation:'submitted',validity:'valid'},{registration_id:8,participation:'submitted',validity:'valid'}]},policy:{strict_results:true}}};
                systemSettings={};window.biddingRequests=[];window.toast=()=>{};window.loadStageQuantityCard=()=>{};
                window.api=async(method,url,body)=>{
                    biddingRequests.push({method,url,body});
                    if(method==='POST')return {ok:true,revision:4,stage_key:'online_quotation'};
                    return {revision:3,data:{roster_locked:true,registration_end:'2026-10-01T16:00',start_at:'2026-10-02T09:00:00',end_at:'2026-10-02T12:00:00',ended_at:'2026-10-02T12:00:00',end_reason:'deadline',evidence:'平台结果截图-001',records:[{registration_id:7,company_name:'华信设备供应有限公司',lot_id:null,review:'approved',amount:'98.10',quoted_at:'2026-10-02T09:12:03'},{registration_id:8,company_name:'远航商贸有限公司',lot_id:null,review:'approved',amount:'108.20',quoted_at:'2026-10-02T09:15:02'}]},summary:{status:'待核对平台结果',eligible:2,quoted:2,lots:[]},history:[]};
                };
                window.refreshProject=async()=>{};openStageSlide('online_quotation');
            },theme);
            await page.waitForSelector('#ob_amount_7');
            assert.equal(await page.locator('.online-participation').evaluate(el=>el.open),false);
            assert.equal(await page.locator('.online-quote-table').count(),1);
            assert.equal(await page.locator('#slideBody').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true,`slide overflow ${theme}/${width}`);
            // The slide visibility transition may finish after the amount input is mounted.
            // Wait for the enhanced time control before checking the keyboard tab order.
            await page.locator('[data-online-quote="7"] .pm-datetime-trigger').waitFor({state:'visible'});
            await page.locator('#ob_amount_7').fill('97.30');
            await page.locator('#ob_amount_7').focus();await page.keyboard.press('Tab');
            assert.equal(await page.evaluate(()=>document.activeElement.closest('[data-online-quote]')?.dataset.onlineQuote),'7');
            await capture(page,`${theme}-${width}-quotation`);
            const primary=page.getByRole('button',{name:'核对平台结果并完成竞价',exact:true});
            await primary.focus();await page.keyboard.press('Enter');
            await page.waitForSelector('#confirmDialog.open');
            assert.match(await page.locator('#confirmMsg').textContent(),/华信设备供应有限公司.*97\.30/s);
            assert.match(await page.locator('#confirmMsg').textContent(),/平台结果截图-001/);
            await capture(page,`${theme}-${width}-confirmation`);
            await page.keyboard.press('Escape');
            assert.equal(await page.locator('#ob_amount_7').inputValue(),'97.30');
            assert.equal(await page.evaluate(()=>biddingRequests.filter(x=>x.method==='POST').length),0);
            await primary.click();await page.locator('#confirmOk').focus();await page.keyboard.press('Enter');
            await page.waitForFunction(()=>biddingRequests.some(x=>x.method==='POST'));
            assert.deepEqual(await page.evaluate(()=>biddingRequests.filter(x=>x.method!=='GET').map(x=>x.url)),['/api/projects/1/online-bidding/confirm']);
            await page.evaluate(()=>{closeSlide();document.getElementById('fixtureRail').style.cssText='position:fixed;inset:16px 0 auto;max-width:1000px;margin:16px;padding:8px;z-index:1';document.getElementById('fixtureRail').innerHTML=renderStageRail({project:currentProject,stages:currentProject.stages,currentStage:currentProject.stages[1]});});
            await page.locator('#fixtureRail').waitFor({state:'visible'});
            assert.equal(await page.locator('.online-stage-group').count(),7);
            assert.equal(await page.locator('#fixtureRail').evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
            await page.locator('.online-stage-preparation>summary').focus();await page.keyboard.press('Enter');
            assert.equal(await page.locator('.online-stage-preparation').evaluate(el=>el.open),false);
            await page.keyboard.press('Enter');assert.equal(await page.locator('.online-stage-preparation').evaluate(el=>el.open),true);
            await capture(page,`${theme}-${width}-stage-rail`);
            await page.evaluate(()=>{
                document.getElementById('fixtureRail').innerHTML='';biddingRequests=[];
                currentProject.stages[5].completed=true;currentProject.stages[5].completed_at='2026-10-02T12:01';
                currentProject.bid_results=[{id:31,winning_supplier:'华信设备供应有限公司',winning_amount:98.1,lot_id:null}];
                const originalApi=api;window.reopenFixtureVerified=true;
                window.api=async(method,url,body)=>{
                    if(url.endsWith('/reopen')){biddingRequests.push({method,url,body});reopenFixtureVerified=false;return {ok:true,revision:4,stage_key:'online_quotation'};}
                    const result=await originalApi(method,url,body);
                    if(method==='GET'){result.data.verified=reopenFixtureVerified;result.revision=reopenFixtureVerified?3:4;}
                    return result;
                };
                openStageSlide('online_quotation');
            });
            await page.waitForSelector('#ob_correction_reason');
            await page.locator('#ob_amount_7').fill('96.20');await page.locator('#ob_correction_reason').fill('平台复核报价');
            await page.locator('.online-stage-general>summary').focus();await page.keyboard.press('Enter');
            assert.match(await page.locator('.online-stage-general>summary').textContent(),/阶段记录与更正.*撤销核对/);
            await capture(page,`${theme}-${width}-correction-entry`);
            await page.locator('#stageCompletedLabel').click();await page.waitForSelector('#confirmDialog.open');await page.keyboard.press('Escape');
            assert.equal(await page.locator('#stageCompleted').isChecked(),true);
            assert.equal(await page.evaluate(()=>biddingRequests.filter(x=>x.method!=='GET').length),0);
            await page.locator('#stageCompletedLabel').click();await page.locator('#confirmOk').focus();await page.keyboard.press('Enter');
            await page.waitForFunction(()=>document.getElementById('onlineBiddingInline')?.onlineState?.saved?.revision===4);
            assert.equal(await page.locator('#stageCompleted').isChecked(),false);assert.equal(await page.locator('#ob_amount_7').inputValue(),'96.20');
            assert.equal(await page.evaluate(()=>currentProject.bid_results[0].id),31);
            assert.deepEqual(await page.evaluate(()=>biddingRequests.filter(x=>x.method!=='GET').map(x=>x.url)),['/api/projects/1/online-bidding/reopen']);
            assert.equal(await page.evaluate(()=>Object.hasOwn(biddingRequests.find(x=>x.method==='POST').body,'data')),false);
            assert.deepEqual(errors,[]);
        }finally{await page.close();}
    }}finally{await browser.close();}
});
