'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {assemble, composeStyles} = require('../tools/build_frontend');
const root = path.resolve(__dirname, '..');
const appRoot = path.resolve(process.env.PM_UI_REVIEW_APP_ROOT || root);
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'source/frontend/manifest.json'), 'utf8'));
const bundle = assemble(path.join(appRoot, 'source/frontend'), manifest).toString('utf8');
const styles = composeStyles(fs.readFileSync(path.join(root, 'src/static/style.css'), 'utf8'), manifest.styles.map(({file}) => fs.readFileSync(file.endsWith('/ui-preferences.css') && process.env.PM_UI_REVIEW_STYLE_FILE ? process.env.PM_UI_REVIEW_STYLE_FILE : path.join(root, file), 'utf8')));
const html = fs.readFileSync(path.join(appRoot, 'src/templates/workspace.html'), 'utf8')
    .replace(/{{ current_user_id \| tojson }}/g, '1').replace(/{{ current_username \| tojson }}/g, '"视觉验证"')
    .replace(/{{ current_is_admin \| tojson }}/g, 'true').replace(/{{ csrf_token \| tojson }}/g, '"synthetic"');
const stages = [
    ['plan_received','计划接收'],['doc_prepare','文件编制'],['doc_review','文件审核'],['doc_finalized','文件定稿'],
    ['agreement_signed','委托协议签订'],['announcement','公告发布'],['registration_end','报名截止'],['bid_opening','开标'],
    ['evaluation','评标'],['result_announced','结果公示'],['winning_notice','中标通知书'],['service_fee','服务费到账'],['deposit_refund','保证金退还'],['archived','归档'],
];
const methods = ['公开招标','竞争性磋商','竞争性谈判','邀请招标','网上竞价','单一来源','遴选','直选'];
const dateAt = offset => {const d=new Date(); d.setDate(d.getDate()+offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}T09:30:00`;};
const projects = Array.from({length:12},(_,i)=>({
    id:i+1,number:`合成-2026-${String(i+1).padStart(3,'0')}`,year:2026,
    name:i===0?'中小学智慧教学设备、校园网络及多校区运行维护服务采购项目':'公共服务与设施改善采购项目 '+(i+1),
    method:methods[i%methods.length],purchaser:'合成教育服务中心',progress:i===11?100:46,current_stage_key:'registration_end',current_stage_name:'报名截止',
    stages:stages.map(([key,name],n)=>({key,name,completed:n<6||i===11,planned_at:dateAt(n-7),completed_at:n<6?dateAt(n-9):'',notes:n===6?'核对采购文件与参与名单后办理。':'',responsible_person:'李知明'})),
    lots:[],registrations:[],suppliers:[],activity:[],created_at:'2026-09-12T10:20:00',
    attachments:i===0?Array.from({length:5},(_,n)=>({id:n+1,filename:`采购文件与技术需求清单-${n+1}.pdf`,extension:'pdf',is_pdf:true,file_size:123456,uploaded_at:'2026-10-20T09:30:00',description:'经核对的项目工作资料'})):[],
}));
const settings = {units:[],categories:[],groups:[],reminder_recipient_groups:[],supplier_minimums:{},stage_module_catalog:[],procurement_catalog:{methods:[],common_stages:[],revision:1}};

test('reviewed visual paths remain readable, usable and compact in four themes at 1440 and 390 pixels', async () => {
    const edge = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser = await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
    const output = process.env.PM_UI_REVIEW_OUTPUT;
    if(output)fs.mkdirSync(output,{recursive:true});
    const failures=[],results=[];
    const check=(condition,label,metric)=>{results.push({label,passed:Boolean(condition),metric});if(!condition)failures.push({label,metric});};
    try {
        for(const theme of ['default','dark','blue','green'])for(const width of [1440,390]){
            const page=await browser.newPage({viewport:{width,height:width===390?844:900},reducedMotion:'reduce'});
            const errors=[];page.on('pageerror',error=>errors.push(String(error)));
            await page.route('**/*',route=>{
                const url=new URL(route.request().url()),p=url.pathname;
                assert.equal(url.hostname,'127.0.0.1','all requests are isolated and intercepted');assert.equal(route.request().method(),'GET');
                if(p==='/static/app.js')return route.fulfill({contentType:'text/javascript',body:bundle});
                if(p==='/static/style.css')return route.fulfill({contentType:'text/css',body:styles});
                const asset=path.join(root,'src/project_manager',p);
                if(p.startsWith('/static/'))return fs.existsSync(asset)?route.fulfill({path:asset}):route.fulfill({body:''});
                if(p==='/api/projects')return route.fulfill({json:projects});
                if(/^\/api\/projects\/\d+$/.test(p))return route.fulfill({json:projects[Number(p.split('/').pop())-1]});
                if(p==='/api/stats')return route.fulfill({json:{total:12,in_progress:11,completed:1}});
                if(p==='/api/system-info')return route.fulfill({json:{version:'v5.8.52',is_admin:true,is_desktop:false,license:{}}});
                if(p==='/api/procurement-methods')return route.fulfill({json:settings.procurement_catalog});
                if(p.startsWith('/api/'))return route.fulfill({json:settings});
                return route.fulfill({contentType:'text/html',body:html});
            });
            await page.goto('http://127.0.0.1:59995/',{waitUntil:'networkidle'});
            await page.evaluate(theme=>{updateUiPreference('theme',theme);updateUiPreference('motion','off');},theme);
            try {await page.locator('.command-action-row').first().waitFor({timeout:5000});}
            catch(error){console.log(await page.evaluate(()=>({title:document.title,toast:document.querySelector('.toast')?.textContent,dashboard:document.getElementById('dashboardContent')?.textContent.slice(0,400),projectCount:allProjects.length,model:typeof commandDashboardModel==='object'?commandDashboardModel?.actions?.length:null})));throw error;}
            await page.evaluate(()=>{
                window.visualSample=(selector)=>{
                    const element=document.querySelector(selector);if(!element)return null;
                    const rgba=value=>{const n=value.match(/[\d.]+/g)?.map(Number)||[0,0,0,0];const scale=value.startsWith('color(srgb ')?255:1;return[n[0]*scale,n[1]*scale,n[2]*scale,n[3]??1];};
                    const over=(a,b)=>[...a.slice(0,3).map((c,i)=>c*a[3]+b[i]*(1-a[3])),1];
                    const ancestors=[];let node=element;while(node){ancestors.push(node);node=node.parentElement;}
                    let bg=[255,255,255,1];for(const item of ancestors.reverse())bg=over(rgba(getComputedStyle(item).backgroundColor),bg);
                    const style=getComputedStyle(element),fg=over(rgba(style.color),bg);
                    const lum=c=>c.slice(0,3).map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,n,i)=>sum+n*[.2126,.7152,.0722][i],0);
                    const a=lum(fg),b=lum(bg),r=element.getBoundingClientRect();
                    return {font:parseFloat(style.fontSize),contrast:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),fg,bg,width:r.width,height:r.height,y:r.y,bottom:r.bottom,overflow:element.scrollWidth>element.clientWidth+1};
                };
            });
            const id=`${theme}/${width}`;
            const sample=selector=>page.evaluate(selector=>visualSample(selector),selector);
            const screenshot=async name=>{if(output)await page.screenshot({path:path.join(output,`${name}-${theme}-${width}.png`)});};
            for(const selector of ['.sidebar-project .sidebar-number-value','.sidebar-project .project-pct','.command-metric.warning strong','.command-metric.positive strong','.command-metric.danger strong']){
                const m=await sample(selector);check(m&&m.contrast>=4.5,`${id} ${selector} text contrast`,m);
            }
            const overview=await sample('.command-action-row');check(overview.bottom<=844||width!==390,`${id} first todo remains fully visible`,overview);
            if(width===390)check(overview.y<650,`${id} todo preview stays near the initial viewport`,overview);
            const metricRows=await page.locator('.command-metric').evaluateAll(elements=>elements.map(el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,right:r.right,width:r.width};}));
            if(width===390)check(Math.abs(metricRows.at(-1).right-metricRows[2].right)<2,`${id} mobile metrics use their final grid track`,metricRows);
            await screenshot('overview');
            if(width===390){
                await page.evaluate(()=>toggleSidebar());
                for(const selector of ['.hamburger','.sidebar-settings-btn','.sidebar-close','.filter-chip','.command-page-actions .btn','.command-node-next']){const m=await sample(selector);check(m&&m.width>=44&&m.height>=44,`${id} ${selector} touch target`,m);}
                await screenshot('sidebar');await page.evaluate(()=>closeSidebar());
            }
            await page.evaluate(()=>{switchView('calendar',{load:false});calendarYear=2026;calendarMonth=10;calendarSelectedDate='2026-10-21';const keys=['registration_end','bid_opening','evaluation','result_announced','winning_notice'];const names=['报名截止','开标','评标','结果公示','中标通知书'];renderCalendar({weekday_names:['日','一','二','三','四','五','六'],cells:Array.from({length:31},(_,i)=>({day:i+1,date_str:`2026-10-${String(i+1).padStart(2,'0')}`,events:i===20?Array.from({length:5},(_,n)=>({project_id:n+1,project_name:`合成校园设备与网络运维采购项目 ${n+1}`,number:`合成-00${n+1}`,stage_key:keys[n],stage_name:names[n],planned_time:['09:30','10:00','13:30','14:00','16:30'][n]})):[]}))},2026,10);});
            const selected=await sample('.calendar-cell.selected .day-num');check(selected.contrast>=4.5,`${id} selected calendar date contrast`,selected);
            const calendarSmall=await sample(width===390?'.calendar-event-dots small':'.calendar-cell-event');check(calendarSmall.font>=(width===390?11:12),`${id} calendar business text size`,calendarSmall);
            await screenshot('calendar');
            await page.evaluate(async()=>{await selectProject(1);switchProjectTab('board');});
            const heading=await sample('.task-title');check(heading.font>=14,`${id} stage title hierarchy`,heading);
            if(width===390){const m=await sample('.task-card');check(m.width>=340,`${id} mobile stage cards retain useful content width`,m);}
            if(width===390)for(const selector of ['.project-tabs .tab','.task-open-btn','.project-command-actions .btn']){
                const m=await sample(selector);if(m)check(m.height>=44,`${id} ${selector} touch height`,m);
            }
            await screenshot('board');
            await page.evaluate(()=>switchProjectTab('timeline'));
            const timeline=await sample('.tl-status');check(timeline.font>=12,`${id} timeline status readability`,timeline);
            await screenshot('timeline');
            await page.evaluate(()=>switchProjectTab('attachments'));
            const uploader=await sample('#uploadArea');check(uploader.height<=150,`${id} populated attachment upload density`,uploader);
            const attachmentMeta=await sample('.ac-meta');check(attachmentMeta.font>=12,`${id} attachment metadata size`,attachmentMeta);
            if(width===390){const m=await sample('.ac-actions .btn-icon');check(m.width>=44&&m.height>=44,`${id} attachment icon touch target`,m);}
            await screenshot('attachments');
            await page.evaluate(()=>{switchView('procure',{load:false});renderProcureBoard(allProjects);});
            const arrowOverlap=await page.evaluate(()=>{const clip=document.getElementById('procureBoardScroller').getBoundingClientRect();return [...document.querySelectorAll('.procure-scroll-button')].some(arrow=>{const a=arrow.getBoundingClientRect();return [...document.querySelectorAll('#procureBoardScroller .procure-card')].some(card=>{const b=card.getBoundingClientRect();const left=Math.max(b.left,clip.left),right=Math.min(b.right,clip.right),top=Math.max(b.top,clip.top),bottom=Math.min(b.bottom,clip.bottom);return left<right&&top<bottom&&a.left<right&&a.right>left&&a.top<bottom&&a.bottom>top;});});});
            check(!arrowOverlap,`${id} board arrows do not cover card content`,arrowOverlap);
            await screenshot('procure');
            await page.evaluate(()=>{switchView('chart-board',{load:false});chartActivityState.items=[];renderChartBoard(buildChartBoardData(allProjects,new Date()));});
            const trend=await sample('.cb-trend svg');check(Math.abs(trend.width/trend.height-16/6)<.1,`${id} trend aspect ratio`,trend);
            if(width===390){const m=await page.locator('.cb-trend svg text').first().evaluate(el=>parseFloat(getComputedStyle(el).fontSize)*el.getScreenCTM().a);check(m>=12,`${id} actual scaled trend label size`,m);}
            const empty=await sample('.cb-activity-state');check(empty.height<=140,`${id} empty activity panel follows content`,empty);
            await screenshot('charts');
            await page.evaluate(()=>{switchView('settings',{load:false});systemSettings={units:[],categories:[],groups:[],reminder_recipient_groups:[],supplier_minimums:{},stage_module_catalog:[]};renderSettingsView();});
            const nav=await sample('.settings-nav');if(width===1440)check(nav.width<=176,`${id} settings navigation width`,nav);
            await screenshot('settings');
            await page.evaluate(()=>{updateUiPreference('size','large');switchView('dashboard',{load:false});});
            const large=await sample('.command-project-row small');check(large&&large.font>=13,`${id} large preference covers project metadata`,large);
            check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${id} no page overflow`);
            check(!errors.length,`${id} no page errors`,errors);
            await page.close();
        }
        if(output)fs.writeFileSync(path.join(output,'visual-metrics.json'),JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,failures,results},null,2));
        console.log(JSON.stringify({passed:results.filter(r=>r.passed).length,total:results.length,failures:failures.map(item=>item.label)},null,2));
        assert.equal(failures.length,0,`${failures.length} visual criteria failed; see visual-metrics.json for measured values`);
    }finally{await browser.close();}
});
