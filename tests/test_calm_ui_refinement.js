'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'src', 'static', 'style.css'), 'utf8');

function extractBlockAfter(marker) {
    const start = css.indexOf(marker);
    assert.notEqual(start, -1, `missing ${marker}`);
    const brace = css.indexOf('{', start);
    let depth = 0;
    for (let index = brace; index < css.length; index += 1) {
        if (css[index] === '{') depth += 1;
        if (css[index] === '}') depth -= 1;
        if (depth === 0) return css.slice(brace + 1, index);
    }
    throw new Error(`unterminated block: ${marker}`);
}

test('calm UI defines legacy aliases through semantic design tokens', () => {
    for (const [token, value] of Object.entries({
        '--card': 'var(--surface-raised)',
        '--surface1': 'var(--surface-raised)',
        '--bg1': 'var(--canvas)',
        '--bg2': 'var(--surface-subtle)',
        '--text1': 'var(--text)',
        '--shadow-sm': 'var(--elevation-1)',
        '--info': 'var(--status-info)',
        '--warning-bg': 'var(--status-warning-surface)',
    })) {
        assert.match(css, new RegExp(`${token}\\s*:\\s*${value.replace(/[()]/g, '\\$&')}`));
    }
});

test('calm UI keeps every major module on the shared surface language', () => {
    const marker = '/* ── Calm UI refinement:';
    const refinement = css.slice(css.indexOf(marker));
    for (const selector of [
        '.command-panel', '.settings-card', '.calendar-grid', '.tasks-table',
        '.attachment-card', '.biz-card', '.procure-card', '.purchaser-unit-card',
        '.cb-kpi', '.cb-panel', '.cb-activity', '.modal', '.slide-panel',
    ]) {
        assert.ok(refinement.includes(selector), `calm UI must cover ${selector}`);
    }
    assert.match(refinement, /background:\s*var\(--surface-raised\)/);
    assert.match(refinement, /border-color:\s*var\(--calm-divider\)/);
});

test('drawer and calm animations use compositor-friendly motion', () => {
    assert.match(css, /\.slide-panel\s*\{[^}]*transform:\s*translateX\(100%\)[^}]*transition:\s*transform/s);
    assert.match(css, /\.slide-panel\.open\s*\{[^}]*transform:\s*translateX\(0\)/s);
    assert.doesNotMatch(css, /\.slide-panel\s*\{[^}]*transition:\s*right/s);
    for (const name of [
        'calm-view-enter', 'calm-overlay-in', 'calm-modal-in',
        'calm-menu-in', 'calm-panel-shadow',
    ]) {
        const block = extractBlockAfter(`@keyframes ${name}`);
        assert.doesNotMatch(block, /(?:width|height|top|right|bottom|left|margin|padding)\s*:/);
        assert.match(block, /(?:opacity|transform)\s*:/);
    }
});

test('calm UI preserves reduced-motion and compact desktop behavior', () => {
    const refinement = css.slice(css.indexOf('/* ── Calm UI refinement:'));
    assert.match(refinement, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    assert.match(refinement, /\.modal\.open[^}]*animation:\s*none!important/s);
    assert.match(refinement, /\.slide-panel\.open[^}]*animation:\s*none!important/s);
    assert.match(refinement, /@media\s*\(min-width:\s*1181px\)\s*and\s*\(max-width:\s*1440px\)\s*and\s*\(max-height:\s*820px\)/);
    assert.match(refinement, /\.command-dashboard\s*\{[^}]*padding:\s*14px 22px 22px/s);
    assert.match(refinement, /@media\s*\(max-width:\s*768px\)[\s\S]*?#dashboardContent\s*\{[^}]*padding:\s*12px 16px/s);
    assert.match(refinement, /@media\s*\(max-width:\s*768px\)[\s\S]*?\.modal-body\s*\{[^}]*padding:\s*14px/s);
});

test('dark mode and document preview remain theme aware', () => {
    const dark = extractBlockAfter(':root[data-theme="dark"]');
    for (const token of ['--canvas', '--surface-raised', '--surface-subtle', '--text', '--text2', '--text3', '--status-info', '--status-warning', '--status-error', '--status-success']) {
        assert.match(dark, new RegExp(`${token}\\s*:`));
    }
    const refinement = css.slice(css.indexOf('/* ── Calm UI refinement:'));
    assert.match(refinement, /\.doc-preview-overlay[^}]*background:\s*var\(--canvas\)/s);
    assert.match(refinement, /\.doc-preview-toolbar\s*\{[^}]*background:\s*var\(--surface-raised\)/s);
    assert.match(css, /#globalLoader\s*\{[^}]*background:\s*var\(--canvas\);[^}]*background:\s*color-mix\(in srgb,var\(--canvas\)/s);
    assert.match(refinement, /--calm-divider:\s*var\(--border\)/);
    assert.match(refinement, /@supports\s*\(color:color-mix/);
});

console.log('calm UI refinement tests passed');
