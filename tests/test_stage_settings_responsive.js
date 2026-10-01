'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const settingsSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '11-stage-settings.js'), 'utf8');
const adminSource = fs.readFileSync(path.join(__dirname, '..', 'source', 'frontend', '06-admin.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'static', 'style.css'), 'utf8');

test('stage template markup keeps original summary-card controls and actions', () => {
    assert.match(settingsSource, /class="stage-template-summary"/);
    assert.match(settingsSource, /class="stage-template-editor"/);
    assert.match(settingsSource, /data-stage-template-action="expand"/);
    assert.match(settingsSource, /function toggleStageTemplateExpanded/);
    assert.match(settingsSource, /onclick="saveStageTemplates\(this\)"/);
    assert.match(settingsSource, /onclick="syncCurrentStageTemplate\(this\)"/);
});

test('stage template cards and expanded editor retain original responsive layout', () => {
    assert.match(adminSource, /id="stageOrderCardHost" class="settings-card-host-wide"/);
    assert.match(css, /\.settings-card-host-wide\{[^}]*grid-column:1\s*\/\s*-1/);
    assert.match(css, /\.stage-template-methods\s*\{/);
    assert.match(css, /\.stage-template-row\.expanded\s*\{/);
    assert.match(css, /\.stage-template-summary\s*\{/);
    assert.match(css, /\.stage-template-editor\s*\{[^}]*grid-template-columns:minmax\(220px,\s*1fr\)\s+100px/);
    assert.match(css, /@media \(max-width:760px\)[\s\S]*?\.stage-template-editor\s*\{\s*grid-template-columns:1fr/);
});
