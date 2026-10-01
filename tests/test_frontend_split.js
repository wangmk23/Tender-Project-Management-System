'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {splitSource} = require('../tools/split_frontend');

const ROOT = path.join(__dirname, '..');
const MODULE_ROOT = path.join(ROOT, 'source', 'frontend');
const MANIFEST_PATH = path.join(MODULE_ROOT, 'manifest.json');
const BUNDLE_PATH = path.join(ROOT, 'src', 'static', 'app.js');

test('manifest markers split the optimized bundle into byte-reproducible modules', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const source = fs.readFileSync(BUNDLE_PATH, 'utf8');
    const split = splitSource(source, manifest.sections);

    assert.equal(manifest.version, 1);
    assert.deepEqual(
        split.map(section => section.file),
        manifest.sections.map(section => section.file),
    );
    assert.equal(split.map(section => section.content).join(''), source);
    assert.equal(new Set(manifest.sections.map(section => section.marker)).size,
        manifest.sections.length);
});
