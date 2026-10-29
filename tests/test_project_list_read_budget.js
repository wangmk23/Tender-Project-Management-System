'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const acorn=require('acorn');
const source=fs.readFileSync('source/frontend/01-core.js','utf8');
const ast=acorn.parse(source,{ecmaVersion:'latest'});
const code=['localFetch','readApiJsonResponse','isCsrfFailure','api'].map(name=>{
 const node=ast.body.find(n=>n.type==='FunctionDeclaration'&&n.id.name===name);
 return source.slice(node.start,node.end);
}).join('\n');
function harness(hang=false){
 const deadlines=[],calls=[];
 const scope={window:{location:{origin:'http://127.0.0.1:5000'}},URL,AbortController,clearTimeout,
  currentProject:null,projectById:new Map(),invalidateProjectDerivedState(){},invalidateViewCache(){},
  setTimeout(fn,ms){deadlines.push(ms);return setTimeout(fn,hang?5:ms);},
  fetch:async(url,options)=>{calls.push({url,options});return{ok:true,status:200,headers:{get:()=> 'application/json'},json:()=>hang?new Promise(()=>{}):Promise.resolve([])};}};
 vm.runInNewContext(code,scope);return{scope,deadlines,calls};
}
for(const url of ['/api/projects','/api/projects?year=2026','http://127.0.0.1:5000/api/projects']){
 test('large complete-list read has a bounded 90-second body budget: '+url,async()=>{
  const {scope,deadlines}=harness();await scope.api('GET',url);assert.deepEqual(deadlines,[90000]);
 });
}
test('detail, other reads and writes retain their 20-second budget',async()=>{
 for(const [method,url] of [['GET','/api/projects/1'],['GET','/api/settings'],['PUT','/api/projects/1']]){
  const {scope,deadlines}=harness();await scope.api(method,url);assert.deepEqual(deadlines,[20000]);
 }
});
test('direct localFetch explicit budget remains authoritative',async()=>{
 const {scope,deadlines}=harness();await scope.localFetch('/api/projects',{timeoutMs:7});assert.deepEqual(deadlines,[7]);
});
test('complete-list JSON-body stall still ends and never replays the request',async()=>{
 const {scope,deadlines,calls}=harness(true);
 await assert.rejects(scope.api('GET','/api/projects'),e=>e.error_code==='REQUEST_TIMEOUT');
 assert.deepEqual(deadlines,[90000]);assert.equal(calls.length,1);
});
