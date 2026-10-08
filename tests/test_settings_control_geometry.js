'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8').replace(/^\uFEFF/,'');
test('settings controls retain aligned geometry and icon-select keyboard behavior in Chromium',async()=>{
    const {chromium}=require('playwright');
    const browser=await chromium.launch(fs.existsSync(chromium.executablePath())?{headless:true,executablePath:chromium.executablePath()}:{headless:true,channel:'chrome'});
    try{
        const page=await browser.newPage({viewport:{width:1280,height:1100}});
        await page.setContent('<style>'+read('src/static/style.css')+'</style><main id="fixture" style="padding:20px;max-width:1000px;margin:auto"></main>');
        await page.addScriptTag({content:read('source/frontend/06-admin.js')});
        await page.evaluate(()=>{
            window.currentIsAdmin=true;window.isDesktopApp=()=>true;
            window.escHtml=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
            window.reminderStageDefinitions=()=>[];
            document.getElementById('fixture').innerHTML=renderLegacyReminderSettingsCard({})+
                '<div class="stage-template-editor"><label><span>名称</span><input value="隔离示例"></label><label><span>图标</span><select data-stage-template-field="icon"><option>📥</option><option>✅</option></select></label><div class="stage-template-module-picker"><div><label class="stage-template-module"><input type="checkbox"><span class="stage-template-module-copy"><span class="stage-template-module-name">采购文件确认</span><small>唯一</small></span></label></div></div></div>'+
                '<div class="setting-field"><select id="bulkFixture"><option value="a">📥 接收</option><option value="b">✅ 完成</option></select></div>';
        });
        await page.addScriptTag({content:read('source/frontend/00-icons.js')});
        await page.addScriptTag({content:read('source/frontend/15-select-popup.js')});
        for(const width of [1280,820,390]){
            await page.setViewportSize({width,height:1600});
            const geometry=await page.evaluate(()=>{
                const box=id=>document.getElementById(id).getBoundingClientRect().toJSON();
                const icon=document.querySelector('[data-stage-template-field="icon"]');
                const svg=icon.parentElement.querySelector('svg').getBoundingClientRect();
                const control=icon.getBoundingClientRect();
                const badge=document.querySelector('.stage-template-module small');
                return {account:['smtpProvider','smtpHost','smtpPort','smtpSecurity'].map(box),time:box('reminderTime'),days:box('reminderAdvanceDays'),recipients:box('reminderRecipients'),schedule:document.querySelector('.reminder-schedule-grid').getBoundingClientRect().toJSON(),icon:control.toJSON(),svg:svg.toJSON(),border:getComputedStyle(icon).borderTopWidth,badge:{height:badge.getBoundingClientRect().height,lineHeight:parseFloat(getComputedStyle(badge).lineHeight)},overflow:document.documentElement.scrollWidth>innerWidth};
            });
            assert.equal(geometry.overflow,false,'no page overflow at '+width);
            assert.equal(geometry.icon.height,38);
            assert.equal(geometry.border,'1px');
            assert.equal(geometry.svg.width,20);assert.equal(geometry.svg.height,20);
            assert.ok(geometry.svg.top>=geometry.icon.top && geometry.svg.bottom<=geometry.icon.bottom);
            assert.ok(geometry.badge.height<=geometry.badge.lineHeight+1,'badge stays on one line');
            assert.ok(Math.abs(geometry.recipients.width-geometry.schedule.width)<1,'recipient field spans group');
            if(width>600){assert.equal(geometry.time.top,geometry.days.top);assert.equal(geometry.time.height,geometry.days.height);}
            if(width>900){assert.ok(geometry.account.every(item=>item.top===geometry.account[0].top));assert.ok(geometry.account.every(item=>Math.abs(item.width-geometry.account[0].width)<1));}
        }
        await page.setViewportSize({width:1280,height:1800});
        await page.locator('#bulkFixture').scrollIntoViewIfNeeded();
        await page.waitForTimeout(100);
        await page.locator('#bulkFixture').focus();
        await page.keyboard.press('ArrowDown');
        assert.equal(await page.locator('.themed-select-option svg').count(),2);
        await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');
        assert.equal(await page.locator('#bulkFixture').inputValue(),'b');
        assert.equal(await page.locator('#bulkFixture + .pm-icon-select-preview svg').getAttribute('data-icon'),'check');
    }finally{await browser.close();}
});
