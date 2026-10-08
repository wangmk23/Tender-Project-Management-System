'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'source/frontend',name),'utf8');
function context(){
    const ctx={systemSettings:{stage_templates:{'网上竞价':[{id:'online_quotation',name:'一次报价竞价',icon:'⏳'}],'公开招标':[{id:'custom',name:'当前名称',icon:'📄'}]}},projectById:new Map(),STAGES:[{key:'legacy',name:'旧节点',icon:'✅'}],STAGE_NAME_CN:{},currentProject:null,escHtml:String};
    vm.createContext(ctx);
    const core=read('01-core.js');vm.runInContext(core.slice(core.indexOf('function projectStageDefinition('),core.indexOf('function stageHasModule(')),ctx);
    vm.runInContext(read('14-online-bidding.js'),ctx);
    const views=read('05-views.js');vm.runInContext(views.slice(views.indexOf('function calendarEventMetadata('),views.indexOf('function selectCalendarDay(')),ctx);
    return ctx;
}
test('calendar resolves raw online key, project snapshots, method templates and legacy metadata',()=>{
    const ctx=context();
    assert.equal(typeof ctx.calendarEventMetadata,'function');
    ctx.projectById.set(1,{id:1,method:'网上竞价',stages:[{key:'online_quotation',name:'一次报价竞价',icon:'⏳'}]});
    let metadata=ctx.calendarEventMetadata({project_id:1,stage_name:'online_quotation',icon:'📌'});
    assert.equal(metadata.name,'一次报价竞价');assert.equal(metadata.icon,'⏳');
    ctx.projectById.set(2,{id:2,method:'公开招标',stages:[{key:'custom',name:'历史已完成名称',icon:'🏆',completed:true}]});
    metadata=ctx.calendarEventMetadata({project_id:2,stage_key:'custom',stage_name:'custom',icon:'📌'});
    assert.equal(metadata.name,'历史已完成名称');assert.equal(metadata.icon,'🏆');
    metadata=ctx.calendarEventMetadata({method:'公开招标',stage_key:'custom',stage_name:'custom'});
    assert.equal(metadata.name,'当前名称');assert.equal(metadata.icon,'📄');
    metadata=ctx.calendarEventMetadata({stage_key:'legacy',stage_name:'legacy'});
    assert.equal(metadata.name,'旧节点');assert.equal(metadata.icon,'✅');
    metadata=ctx.calendarEventMetadata({stage_key:'custom',stage_name:'独立历史事件名称',icon:'📮',method:'公开招标'});
    assert.equal(metadata.name,'独立历史事件名称');assert.equal(metadata.icon,'📮');
    metadata=ctx.calendarEventMetadata({stage_name:'online_quotation'});
    assert.equal(metadata.name,'一次报价竞价');assert.equal(metadata.icon,'⏳');
    ctx.systemSettings.stage_templates['竞争性磋商']=[{id:'unique_custom',name:'自定义审核',icon:'📋'}];
    metadata=ctx.calendarEventMetadata({stage_name:'unique_custom',icon:'📌'});
    assert.equal(metadata.name,'自定义审核');assert.equal(metadata.icon,'📋');
    ctx.systemSettings.stage_templates['公开招标'].push({id:'unique_custom',name:'不同项目流程',icon:'💼'});
    assert.equal(ctx.calendarEventMetadata({stage_name:'unique_custom'}).name,'unique_custom','ambiguous method metadata must not replace historical labels');
    ctx.allProjects=[{id:3,method:'公开招标',stages:[{key:'custom',name:'列表快照',icon:'📚'}]}];
    assert.equal(ctx.calendarEventMetadata({project_id:3,stage_name:'custom'}).name,'列表快照');
});

test('calendar month cells and selected day render the same Chinese name and icon in Chromium',async()=>{
    const {chromium}=require('playwright');const browser=await chromium.launch(fs.existsSync(chromium.executablePath())?{headless:true}:{headless:true,channel:'chrome'});
    try{
        const page=await browser.newPage();await page.setContent('<main id="calendarContent"></main>');
        await page.addScriptTag({content:read('05-views.js')});
        await page.evaluate(()=>{
            window.escHtml=String;window.todayISO=()=> '2026-10-08';window.calendarYear=2026;window.calendarMonth=10;window.calendarSelectedDate='';
            window.systemSettings={stage_templates:{'网上竞价':[{id:'online_quotation',name:'一次报价竞价',icon:'⏳'}]}};
            window.projectById=new Map([[1,{id:1,method:'网上竞价',stages:[{key:'online_quotation',name:'一次报价竞价',icon:'⏳'}]}]]);
            window.projectStageDefinition=(stage,project)=>typeof stage==='object'?stage:(project.stages||[]).find(row=>row.key===stage)||{key:stage};
            renderCalendar({weekday_names:['一','二','三','四','五','六','日'],cells:[{day:8,date_str:'2026-10-08',events:[{project_id:1,stage_key:'online_quotation',stage_name:'online_quotation',icon:'📌',planned_time:'09:00'}]}]});
        });
        assert.equal(await page.locator('.calendar-cell-event b').textContent(),'一次报价竞价');
        assert.equal(await page.locator('.calendar-cell-event [data-ui-icon]').getAttribute('data-ui-icon'),'⏳');
        await page.locator('[data-calendar-date="2026-10-08"]').click();
        assert.match(await page.locator('.calendar-agenda-copy strong').textContent(),/一次报价竞价/);
        assert.equal(await page.locator('.calendar-agenda-copy [data-ui-icon]').getAttribute('data-ui-icon'),'⏳');
    }finally{await browser.close();}
});
