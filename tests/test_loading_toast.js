'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const acorn=require('acorn');
const {JSDOM}=require('jsdom');
function harness(){
    const dom=new JSDOM('<div id="toast"></div>',{runScripts:'outside-only'});
    dom.window.eval(fs.readFileSync('source/frontend/00-icons.js','utf8'));
    const source=fs.readFileSync('source/frontend/01-core.js','utf8');
    const node=acorn.parse(source,{ecmaVersion:'latest'}).body.find(n=>n.type==='FunctionDeclaration'&&n.id.name==='toast');
    const timers=[];
    const context={document:dom.window.document,window:dom.window,
        setTimeout(fn,delay){const timer={fn,delay};timers.push(timer);return timer;},
        clearTimeout(timer){if(timer)timer.cancelled=true;}};
    vm.createContext(context);vm.runInContext(source.slice(node.start,node.end),context);
    return {dom,toast:context.toast,el:dom.window.document.getElementById('toast'),timers};
}
test('loading uses a drawn refresh icon and lasts until its request settles',()=>{
    const h=harness();try{
        const dismiss=h.toast('正在加载项目详情…','loading');
        assert.equal(h.el.querySelector('svg').dataset.icon,'refresh');
        assert(h.el.classList.contains('loading'));assert.equal(h.el.getAttribute('aria-busy'),'true');
        assert.equal(h.timers.length,0);dismiss();assert(!h.el.classList.contains('show'));
        assert.equal(h.el.getAttribute('aria-busy'),'false');
    }finally{h.dom.window.close();}
});
test('a stale loading callback cannot dismiss a newer error or loading request',()=>{
    const h=harness();try{
        const old=h.toast('加载项目一','loading');
        h.toast('加载失败','error');old();assert(h.el.classList.contains('show'));assert(h.el.classList.contains('error'));
        const next=h.toast('加载项目二','loading');old();assert(h.el.classList.contains('show'));
        next();assert(!h.el.classList.contains('show'));
    }finally{h.dom.window.close();}
});
test('informational notifications use an information icon rather than a question mark',()=>{
    const h=harness();try{
        h.toast('已更新列表','info');assert.equal(h.el.querySelector('svg').dataset.icon,'info');
        assert.equal(h.timers[0].delay,2500);h.timers[0].fn();assert(!h.el.classList.contains('show'));
        assert.equal(h.dom.window.PMIcons.create('❓').dataset.icon,'help');
    }finally{h.dom.window.close();}
});
