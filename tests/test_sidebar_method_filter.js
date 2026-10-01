'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '02-projects.js'), 'utf8');

test('sidebar exposes a procurement-method select and applies it in filtering', () => {
    assert.match(source, /sidebarMethodFilter/);
    assert.match(source, /sidebarMethodSelect/);
    assert.match(source, /采购方式筛选/);
    assert.match(source, /matchesMethod/);
});
