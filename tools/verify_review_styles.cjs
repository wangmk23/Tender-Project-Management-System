/* Render representative production component markup with the production CSS.
 * Reverting semantic pairs, hit areas, or focused typography makes this fail. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PM_PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(process.env.PM_REVIEW_STYLE_OUTPUT || '_build/ui-review-styles');
const checks = [], measures = [];
const css = fs.readFileSync('src/static/style.css', 'utf8');
const fixture = `<div id="app"><main style="width:100%;overflow:auto;background:var(--bg)">
<section id="view-project" class="view active">
<header class="project-topbar"><div class="topbar-left"><h2>市公共卫生服务中心医疗设备及配套信息系统采购项目</h2><div class="project-meta">PRJ-2026-1001 · 预算 1,280,000.00 元</div></div></header>
<div class="project-command-workspace"><div class="project-command-summary"><div class="project-command-now"><span>当前行动</span><strong>文件审核</strong><small>负责人：项目经办人 · 计划 2026-10-16 09:30</small></div></div></div>
<div class="project-tabs"><button class="tab active" role="tab">看板</button><button class="tab" role="tab">进度</button></div>
<div class="project-tab active"><div class="board-columns"><div class="board-col"><h3>进行中</h3><div class="task-card"><div class="task-title">文件审核</div><div class="task-detail">计划：2026-10-16 09:30</div><div class="stage-card-summary">采购金额 1,280,000.00 元</div></div></div></div></div>
</section>
<section style="padding:16px;background:var(--surface-raised)"><button class="stage-template-method">竞争性磋商</button><button class="stage-template-method active">公开招标</button><span class="timing-badge today">今天到期</span><span class="timing-badge soon">即将到期</span><span class="timing-badge overdue">逾期1天</span><span class="timing-badge planned">计划时间</span>
<button class="btn-icon" aria-label="关闭">×</button><div class="biz-mini-actions"><a href="#edit">编辑</a><a href="#delete" class="text-danger">删除</a></div>
<div class="command-panel-head"><div><span>待办节点</span><small>按紧急程度排序</small></div><button>全部待办 9</button></div><button class="command-node-next">下一个 →</button>
<div class="form-group"><label>供应商名称<input value="长中文供应商名称"></label></div></section></main></div>`;
async function check(name, fn) {try {await fn(); checks.push({name, passed:true});} catch(e) {checks.push({name, passed:false, error:e.message});}}
async function contrast(locator) {
  return locator.evaluate(el => {
    const canvas=document.createElement('canvas');canvas.width=canvas.height=1;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const parse = s => {ctx.clearRect(0,0,1,1);ctx.fillStyle=s;ctx.fillRect(0,0,1,1);const p=Array.from(ctx.getImageData(0,0,1,1).data);return [p[0],p[1],p[2],p[3]/255];};
    const blend = (fg,bg) => fg.slice(0,3).map((v,i)=>v*(fg[3]??1)+bg[i]*(1-(fg[3]??1)));
    let chain=[];for(let n=el;n;n=n.parentElement)chain.unshift(n);
    let bg=[255,255,255];for(const n of chain)bg=blend(parse(getComputedStyle(n).backgroundColor),bg);
    const fg=blend(parse(getComputedStyle(el).color),bg);
    const lum = c=>c.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);
    const a=lum(fg),b=lum(bg);return {ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05),fg,bg};
  });
}
(async()=>{
  fs.mkdirSync(out,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:process.env.PM_EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'});
  try {
    const page=await browser.newPage({viewport:{width:1366,height:768}});
    await page.setContent('<style>'+css+'</style>'+fixture);
    for(const theme of ['default','blue','green','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      for(const selector of ['.stage-template-method:not(.active)','.stage-template-method.active','.project-tabs .tab:not(.active)','.project-tabs .tab.active','.timing-badge.today','.timing-badge.soon','.timing-badge.overdue','.timing-badge.planned']) {
        const el=page.locator(selector);
        for(const state of ['default','hover','focus']) await check(`${theme} ${selector} ${state} contrast`,async()=>{
          await page.mouse.move(0,0);await el.evaluate(e=>e.blur());
          if(state==='hover')await el.hover();if(state==='focus')await el.focus();
          await page.waitForTimeout(210);
          const colors=await contrast(el);measures.push({theme,selector,state,...colors});assert.ok(colors.ratio>=4.5,JSON.stringify(colors));
        });
      }
      for(const selector of ['.project-command-now>span','.project-command-now small','.task-detail','.stage-card-summary','.timing-badge','.project-meta','.command-panel-head small'])await check(`${theme} ${selector} readable metadata`,async()=>{
        const size=await page.locator(selector).first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize));assert.ok(size>=12,`font-size ${size}`);
      });
      for(const selector of ['.project-topbar','.project-tabs','.project-command-summary'])await check(`${theme} ${selector} static surface`,async()=>{
        assert.equal(await page.locator(selector).evaluate(e=>getComputedStyle(e).backdropFilter),'none');
      });
    }
    for(const width of [1366,375,390]) {
      await page.setViewportSize({width,height:844});
      for(const selector of ['.btn-icon','.biz-mini-actions a','.command-panel-head button','.command-node-next'])await check(`${width} ${selector} hit area`,async()=>{
        const rect=await page.locator(selector).first().boundingBox();const minimum=width<768?44:32;assert.ok(rect.width>=minimum&&rect.height>=minimum,JSON.stringify(rect));measures.push({width,selector,rect});
      });
      if(width<768)await check(`${width} form input readable`,async()=>assert.ok(await page.locator('input').evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=16));
    }
    await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(out,'components-dark-390.png'),fullPage:true});
    const login=fs.readFileSync('src/templates/login.html','utf8');
    await page.setContent(login);
    for(const theme of ['default','blue','green','dark']) {
      await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);
      const button=page.locator('.btn-login');
      for(const state of ['default','hover','focus'])await check(`login ${theme} ${state} contrast`,async()=>{
        await page.mouse.move(0,0);await button.evaluate(e=>e.blur());if(state==='hover')await button.hover();if(state==='focus')await button.focus();await page.waitForTimeout(210);
        const colors=await contrast(button);measures.push({theme,selector:'.btn-login',state,...colors});assert.ok(colors.ratio>=4.5,JSON.stringify(colors));
      });
      await check(`login ${theme} mobile input font`,async()=>assert.ok(await page.locator('input').first().evaluate(e=>parseFloat(getComputedStyle(e).fontSize))>=16));
    }
    await page.screenshot({path:path.join(out,'login-dark-390.png'),fullPage:true});
  } finally {await browser.close();}
  const report={checks,measures,passed:checks.filter(c=>c.passed).length,failed:checks.filter(c=>!c.passed)};
  fs.writeFileSync(path.join(out,'styles.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed}));if(report.failed.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
