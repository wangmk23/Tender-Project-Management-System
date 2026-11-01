'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {JSDOM} = require('jsdom');

test('project navigation closes the preview overlay and unlocks body scrolling immediately', t => {
    const root = path.join(__dirname, '..');
    const dom = new JSDOM('<body><div id="docPreviewOverlay" class="open"><div id="pdfViewerContainer"></div></div></body>',
        {url: 'http://localhost', runScripts: 'outside-only'});
    t.after(() => dom.window.close());
    const w = dom.window;
    w.matchMedia = () => ({matches: false, addEventListener() {}});
    const scripts = ['01-core.js', '02-projects.js', '03-attachments.js'].map(name =>
        fs.readFileSync(path.join(root, 'source/frontend', name), 'utf8')).join('\n');
    w.eval(scripts);
    w.showViewLoading = () => {};
    w.api = () => new Promise(() => {}); // Only the synchronous navigation cleanup is under test.
    w.document.body.style.overflow = 'hidden';
    w.selectProject(2);
    assert.equal(w.document.getElementById('docPreviewOverlay').classList.contains('open'), false);
    assert.equal(w.document.body.style.overflow, '');
});
