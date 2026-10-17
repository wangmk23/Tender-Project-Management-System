"use strict";
const test=require('node:test'), assert=require('node:assert/strict');
const build=require('../tools/build_frontend.js');
test('component CSS is composed into existing runtime style without a second network dependency',()=>{
 const base=':root{--text:#123;}\n';
 const result=build.composeStyles(base,['.deadline{color:var(--text)}']);
 assert.ok(result.startsWith(base));
 assert.match(result,/\.deadline\{color:var\(--text\)\}/);
 assert.equal(build.composeStyles(result,['.deadline{color:var(--text)}']),result);
});
test('new component CSS replaces only its generated region and preserves later hand-maintained rules',()=>{
 const first=build.composeStyles('body{margin:0}\n',['.old{}']);
 const next=build.composeStyles(first+'\n.keep{}',['.new{}']);
 assert.ok(!next.includes('.old{}'));
 assert.ok(next.includes('.new{}'));
 assert.ok(next.includes('.keep{}'));
});
