'use strict';
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');

(async () => {
    const config = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    const browser = await chromium.launch({headless:true});
    try {
        const context = await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
        await context.addCookies(config.cookies.map(cookie=>({name:cookie.name,value:cookie.value,url:config.url})));
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror',error=>errors.push(error.message));
        await page.goto(config.url, {waitUntil:'networkidle'});
        await page.waitForFunction(()=>typeof showOnlineBiddingLedger === 'function');
        await page.evaluate(async pid=>{
            currentProject=await api('GET',`/api/projects/${pid}`);
            editingStageKey='online_quotation';
            await showOnlineBiddingLedger();
        },config.pid);
        await page.locator('#onlineBiddingForm').waitFor();
        await page.waitForTimeout(500);
        if (!(await page.locator('#onlineBiddingForm').innerText()).includes('平台结果已核对')) throw new Error('verified state missing');
        await page.screenshot({path:path.join(__dirname,'../_build/online-bidding-desktop.png')});
        await page.setViewportSize({width:390,height:844});
        await page.screenshot({path:path.join(__dirname,'../_build/online-bidding-mobile.png')});
        const overflow = await page.locator('#onlineBiddingForm').evaluate(el=>el.scrollWidth > el.clientWidth + 2);
        if (overflow) throw new Error('ledger form horizontally overflows mobile width');
        if (errors.length) throw new Error(errors.join('\n'));
        console.log('Browser passed: live EXE ledger, desktop/mobile, no overflow or JS exceptions');
    } finally { await browser.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
