'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'app.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'style.css'), 'utf8');

function extractFunction(name) {
    const starts = [
        source.indexOf(`function ${name}(`),
        source.indexOf(`async function ${name}(`),
    ].filter(index => index >= 0);
    assert.notEqual(starts.length, 0, `app.js must define ${name}()`);
    const start = Math.min(...starts);
    const braceStart = source.indexOf('{', start);
    let depth = 0;
    for (let index = braceStart; index < source.length; index += 1) {
        if (source[index] === '{') depth += 1;
        if (source[index] === '}') depth -= 1;
        if (depth === 0) return source.slice(start, index + 1);
    }
    throw new Error(`Unable to parse ${name}()`);
}

assert.match(extractFunction('ensurePurchaserBoardWorkspace'), /按采购人分类/);
assert.match(extractFunction('loadPurchaserBoard'), /purchaser_board_view=bootstrap/);
assert.match(extractFunction('renderPurchaserBoard'), /purchaser-search-workspace/);
assert.match(extractFunction('purchaserUnitProjects'), /projectById\.get/);
assert.match(extractFunction('showPurchaserCategoryManager'), /currentIsAdmin/);
assert.match(extractFunction('showMovePurchaser'), /currentIsAdmin/);
assert.match(extractFunction('showMovePurchaser'), /move_purchaser/);
assert.doesNotMatch(source, /view-customers|customer_action|mergeCustomer|customer-tag|customer-drawer|purchaser-drawer/);
const sandbox={};
vm.runInNewContext(`const purchaserUnitByName=new Map();${extractFunction('rebuildPurchaserUnitIndex')};rebuildPurchaserUnitIndex({groups:[{units:[{name:'学校',classification_source:'manual'},{name:'银行',classification_source:'auto'}]}]});result=Array.from(purchaserUnitByName.values(),u=>u.classification_source);`,sandbox);
assert.deepEqual(Array.from(sandbox.result),['manual','auto']);
console.log('purchaser board integration tests passed');
