'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
function luminance(rgb){
    const values=rgb.match(/[\d.]+/g).slice(0,3).map(x=>{const value=Number(x)/255;return value<=0.04045?value/12.92:((value+0.055)/1.055)**2.4;});
    return values[0]*0.2126+values[1]*0.7152+values[2]*0.0722;
}
test('Excel formula text stays readable on the worksheet surface in every application theme',async()=>{
    const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
    const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
    try{
        const page=await browser.newPage();
        await page.setContent(`<style>${read('src/static/style.css')}</style><style>${read('src/project_manager/static/libs/luckysheet/css/luckysheet.css')}</style>
          <div id="excelViewerContainer"><div id="luckysheet"><div class="luckysheet-functionbox"><div id="luckysheet-functionbox-cell" class="luckysheet-functionbox-cell-input">预览公式栏</div></div><span id="sheetColor" style="color:rgb(220,38,38)">工作簿颜色</span></div></div>`);
        for(const theme of ['default','blue','green','dark']){
            await page.evaluate(value=>document.documentElement.dataset.theme=value,theme);
            const colors=await page.locator('#luckysheet-functionbox-cell').evaluate(node=>({foreground:getComputedStyle(node).color,background:getComputedStyle(node).backgroundColor}));
            // Luckysheet's formula editor is a light paper surface; translucent
            // or inherited backgrounds resolve to the viewer's white canvas.
            const foreground=luminance(colors.foreground);
            const ratio=(1.05)/(foreground+0.05);
            assert.ok(ratio>=4.5,`${theme}: formula text contrast ${ratio.toFixed(2)} against white`);
            assert.equal(await page.locator('#sheetColor').evaluate(node=>getComputedStyle(node).color),'rgb(220, 38, 38)','explicit workbook colors remain untouched');
        }
    }finally{await browser.close();}
});
