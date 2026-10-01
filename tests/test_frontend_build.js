'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {spawnSync} = require('node:child_process');
const crypto = require('node:crypto');
const {assemble} = require('../tools/build_frontend');

const ROOT = path.join(__dirname, '..');
const MODULE_ROOT = path.join(ROOT, 'source', 'frontend');
const MANIFEST_PATH = path.join(MODULE_ROOT, 'manifest.json');
const BUNDLE_PATH = path.join(ROOT, 'src', 'static', 'app.js');

test('manifest assembly is byte-identical to the optimized bundle', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    assert.deepEqual(assemble(MODULE_ROOT, manifest), fs.readFileSync(BUNDLE_PATH));
});

test('build check accepts the optimized bundle assembled from modules', () => {
    const check = spawnSync(
        process.execPath,
        ['tools/build_frontend.js', '--check'],
        {cwd: ROOT, encoding: 'utf8'},
    );
    assert.equal(check.status, 0, check.stderr);
    assert.match(check.stdout, /frontend bundle is current/);
});

test('manifest compiles each frontend marker once and retains module hashes', () => {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const bundle = assemble(MODULE_ROOT, manifest).toString('utf8');
    const hashes = Object.fromEntries(manifest.sections.map(section => {
        const bytes = fs.readFileSync(path.join(MODULE_ROOT, section.file));
        assert.equal(bytes.toString('utf8').split(section.marker).length - 1, 1, section.file);
        assert.equal(bundle.split(section.marker).length - 1, 1, section.marker);
        return [section.file, crypto.createHash('sha256').update(bytes).digest('hex')];
    }));
    assert.equal(Object.keys(hashes).length, manifest.sections.length);
    assert.match(hashes['10-chart-board.js'], /^[0-9a-f]{64}$/);
    assert.match(hashes['11-stage-settings.js'], /^[0-9a-f]{64}$/);
});
