'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appPath = path.join(__dirname, '..', 'src', 'static', 'app.js');
const source = fs.readFileSync(appPath, 'utf8');

assert.match(source, /<h2>数据与附件<\/h2>/);
assert.match(source, /<h2>局域网访问<\/h2>/);
assert.doesNotMatch(source, /搬到另一台电脑时需复制整个解压文件夹/);
assert.doesNotMatch(source, /主机电脑需要保持程序运行/);

console.log('settings info banner tests passed');
