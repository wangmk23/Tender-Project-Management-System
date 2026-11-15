'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const {chromium}=require('playwright');

test('semantic sidebar buttons retain transparent background, inherited text and navigation states',async()=>{
    const options={headless:true};
    if(process.env.PM_BROWSER_EXECUTABLE)options.executablePath=process.env.PM_BROWSER_EXECUTABLE;
    else if(!fs.existsSync(chromium.executablePath())&&process.platform==='win32')options.channel='msedge';
    const browser=await chromium.launch(options);
    try {
        const page=await browser.newPage({viewport:{width:1440,height:900},reducedMotion:'reduce'});
        // External stylesheet decoding consumes the UTF-8 BOM before CSS parsing.
        const css=fs.readFileSync(path.join(__dirname,'../src/project_manager/static/style.css'),'utf8').replace(/^\uFEFF/,'');
        await page.setContent(`<style>${css}</style><aside class="sidebar"><nav class="sidebar-nav"><div class="nav-item" id="old">导航对照</div><button type="button" class="nav-item" id="button">按钮导航</button><button type="button" class="nav-item active" id="active">当前导航</button></nav></aside>`);
        await page.evaluate(()=>document.documentElement.dataset.motion='off');
        const style=id=>page.locator(id).evaluate(e=>{const s=getComputedStyle(e);return {background:s.backgroundColor,color:s.color,appearance:s.appearance,width:e.getBoundingClientRect().width,align:s.textAlign};});
        for(const theme of ['default','dark','blue','green']) {
            await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
            await page.mouse.move(900,700);
            const old=await style('#old'),normal=await style('#button');
            assert.equal(normal.background,old.background,`${theme}: button must not use browser face`);
            assert.equal(normal.color,old.color,`${theme}: navigation text must inherit sidebar color`);
            assert.equal(normal.appearance,'none');
            assert.equal(normal.align,'left');
            assert.ok(Math.abs(normal.width-old.width)<2,'navigation fills the available row');
            const active=await style('#active');
            assert.notEqual(active.background,normal.background,`${theme}: selected navigation remains distinct`);
            await page.locator('#button').hover();
            assert.notEqual((await style('#button')).background,normal.background,`${theme}: hover remains visible`);
            await page.mouse.move(900,700);
            await page.keyboard.press('Tab');
            await page.locator('#button').focus();
            const focus=await page.locator('#button').evaluate(e=>({focused:e===document.activeElement,outline:getComputedStyle(e).outlineStyle}));
            assert.ok(focus.focused&&focus.outline!=='none','keyboard focus must remain visible');
        }
    } finally {await browser.close();}
});
