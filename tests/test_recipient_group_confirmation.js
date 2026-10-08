'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname,'../source/frontend/06-admin.js'),'utf8');

test('recipient group deletion waits for themed confirmation and preserves groups on cancel', async () => {
    let decide;
    const writes = [];
    const groups = [{id:'keep'}, {id:'remove'}];
    const context = vm.createContext({
        confirm:()=>true,
        confirmDialog:()=>new Promise(resolve=>{decide=resolve;}),
        persistRecipientGroups:async change=>writes.push(change(groups)),
        toast:()=>{},
    });
    vm.runInContext(source.slice(source.indexOf('async function deleteRecipientGroup('),source.indexOf('async function previewRecipientGroup(')),context);
    let pending = context.deleteRecipientGroup('remove');
    await Promise.resolve();
    assert.equal(writes.length,0);
    decide(false);await pending;
    assert.equal(writes.length,0);
    pending = context.deleteRecipientGroup('remove');
    decide(true);await pending;
    assert.deepEqual(writes[0].map(group=>group.id),['keep']);
});
