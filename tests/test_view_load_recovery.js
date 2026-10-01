'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
function extract(source,name){
    const start=source.indexOf('async function '+name+'(');
    const next=source.indexOf('\nfunction ',start+1), nextAsync=source.indexOf('\nasync function ',start+1);
    return source.slice(start,Math.min(...[next,nextAsync,source.length].filter(x=>x>=0)));
}
for(const [name,file,renderer] of [
    ['loadSettingsView','06-admin.js','renderSettingsView'],
    ['loadDashboard','05-views.js','renderDashboard'],
    ['loadCalendar','05-views.js','renderCalendar'],
    ['loadPurchaserBoard','16-purchaser-workspace.js','renderPurchaserBoard'],
]){
    const code=extract(fs.readFileSync(path.join(__dirname,'../source/frontend',file),'utf8'),name);
    function setup(cached,freshBad=false){
        let calls=0,renders=0,writes=0;
        const value={bad:freshBad,systemInfo:{},systemSettings:{bad:freshBad},stats:{bad:freshBad},projects:[]};
        const context={document:{getElementById:()=>({})},console:{error(){}},
            settingsCacheKey:()=> 'settings',calendarCacheKey:()=> 'calendar:2026:9',calendarYear:2026,calendarMonth:9,
            readViewCache:()=>cached,writeViewCache:()=>writes++,invalidateViewCache(){},
            systemInfo:null,systemSettings:null,settingsFormDirty:false,allProjects:[],purchaserBoardData:null,
            ensurePurchaserBoardWorkspace(){},renderViewSkeleton(){},renderViewLoadError(){},showViewLoading(){},toast(){},
            requestViewData:async()=>{calls++;return {accepted:true,value};},
        };
        context[renderer]=(data)=>{if((name==='loadSettingsView'?context.systemSettings:data)?.bad)throw Error('invalid cached data');renders++;};
        vm.createContext(context);vm.runInContext(code,context);
        return {context,run:()=>context[name](name==='loadPurchaserBoard'?true:{force:true}),counts:()=>({calls,renders,writes})};
    }
    test(name+' retries with fresh data even when cached render would fail',async()=>{
        const cached={fresh:true,value:{bad:true,systemInfo:{},systemSettings:{bad:true},stats:{bad:true},projects:[]}};
        const s=setup(cached);await s.run();assert.deepEqual(s.counts(),{calls:1,renders:1,writes:1});
    });
    test(name+' discards invalid cached data on ordinary navigation',async()=>{
        const s=setup({fresh:true,value:{bad:true,systemInfo:{},systemSettings:{bad:true},stats:{bad:true},projects:[]}});
        await s.context[name]();assert.deepEqual(s.counts(),{calls:1,renders:1,writes:1});
    });
    test(name+' does not cache data that failed to render',async()=>{
        const s=setup(null,true);await s.run();assert.equal(s.counts().writes,0);
    });
    if(name==='loadSettingsView')test('system-info failure does not block valid settings',async()=>{
        const s=setup(null);
        s.context.requestViewData=async(_key,loader)=>({accepted:true,value:await loader()});
        s.context.api=async(_method,url)=>{
            if(url==='/api/system-info')throw Error('system info unavailable');
            return {is_desktop:true};
        };
        await s.run();
        assert.equal(s.counts().renders,1);
        assert.equal(s.context.systemInfo.is_desktop,true);
        assert.equal(s.context.systemInfo._loadError,'system info unavailable');
    });
}
