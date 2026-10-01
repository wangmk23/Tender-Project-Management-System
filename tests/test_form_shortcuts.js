const fs=require('fs'),vm=require('vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync('source/frontend/08-bootstrap.js','utf8');
const code=source.slice(source.indexOf("document.addEventListener('keydown', e =>"),source.indexOf("window.addEventListener('pagehide'"));
test('numeric shortcuts do not navigate while typing or a dialog is open',()=>{
 let handler,changes=[],overlay=false;
 const ctx={topManagedDialog:()=>null,isApplicationTextInput:target=>Boolean(target?.closest?.('input,textarea,select,[contenteditable]')),currentProject:{id:1},switchProjectTab:n=>changes.push(n),document:{addEventListener:(_,h)=>handler=h,querySelector:()=>overlay?{}:null,getElementById:()=>({classList:{contains:()=>true}})}};
 vm.runInNewContext(code,ctx);
 const event={key:'1',target:{closest:()=>({})}};
 handler(event);assert.deepEqual(changes,[]);
 event.target.closest=()=>null;overlay=true;handler(event);assert.deepEqual(changes,[]);
 overlay=false;handler(event);assert.deepEqual(changes,['board']);
});
