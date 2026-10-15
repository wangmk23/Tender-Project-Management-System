'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
test('unrelated stage updates do not rescan all temporal fields; dynamic controls still synchronize',async()=>{
 const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
 const browser=await chromium.launch({headless:true,...(fs.existsSync(edge)?{executablePath:edge}:{})});
 try{
  const page=await browser.newPage();await page.setContent('<main><div id="unrelated"></div><input id="initial" type="date" value="2026-10-15"></main>');
  await page.addScriptTag({content:fs.readFileSync(__dirname+'/../source/frontend/17-datetime-picker.js','utf8')});await page.waitForTimeout(50);
  await page.evaluate(()=>{const original=document.querySelectorAll.bind(document);window.fullScans=0;document.querySelectorAll=(s)=>{fullScans++;return original(s);};document.getElementById('unrelated').className='active';document.getElementById('unrelated').textContent='倒计时变化';});
  await page.waitForTimeout(50);assert.equal(await page.evaluate(()=>fullScans),0);
  await page.evaluate(()=>document.getElementById('unrelated').innerHTML='<input id="dynamic" type="datetime-local" value="2026-10-16T17:30">');
  await page.waitForFunction(()=>document.getElementById('dynamic').hidden);assert.equal(await page.locator('.pm-datetime-trigger').count(),2);
  await page.evaluate(()=>document.getElementById('dynamic').disabled=true);
  await page.waitForFunction(()=>document.getElementById('dynamic').parentElement.querySelector('button').disabled);
 }finally{await browser.close();}
});
