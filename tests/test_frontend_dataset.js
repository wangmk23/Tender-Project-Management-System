'use strict';

const assert = require('node:assert/strict');
const {createProjects} = require('./fixtures/frontend_dataset');

assert.throws(() => createProjects(-1), /non-negative integer/);
assert.throws(() => createProjects(1, 0), /positive integer/);
const first = createProjects(3, 4);
const second = createProjects(3, 4);
assert.deepEqual(first, second);
assert.equal(first.length, 3);
assert.equal(first[0].stages.length, 4);
assert.deepEqual(first.map(project => project.id), [1, 2, 3]);
assert.match(first[0].name, /^模拟项目-/);
assert.equal(JSON.stringify(first).includes('项目管理系统_桌面版_v5.7.0'), false);
console.log('frontend dataset tests passed');
