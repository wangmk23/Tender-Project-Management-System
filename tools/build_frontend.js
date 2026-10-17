'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const MODULE_ROOT = path.join(ROOT, 'source', 'frontend');
const MANIFEST_PATH = path.join(MODULE_ROOT, 'manifest.json');
const OUTPUT_PATHS = [
    path.join(ROOT, 'src', 'static', 'app.js'),
    path.join(ROOT, 'src', 'project_manager', 'static', 'app.js'),
];

function assemble(root, manifest) {
    return Buffer.concat(
        manifest.sections.map(section => fs.readFileSync(path.join(root, section.file))),
    );
}

const STYLE_BEGIN = '/* BEGIN GENERATED BUSINESS DEADLINE STYLES */';
const STYLE_END = '/* END GENERATED BUSINESS DEADLINE STYLES */';

function composeStyles(existing, components) {
    const region = `${STYLE_BEGIN}\n${components.join('\n')}\n${STYLE_END}`;
    const start = existing.indexOf(STYLE_BEGIN);
    if (start >= 0) {
        const end = existing.indexOf(STYLE_END, start);
        if (end < 0) throw new Error('generated component CSS region is incomplete');
        return existing.slice(0, start) + region + existing.slice(end + STYLE_END.length);
    }
    return existing + (existing.endsWith('\n') ? '' : '\n') + region + '\n';
}

function main(argv = process.argv.slice(2)) {
    const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    const bundle = assemble(MODULE_ROOT, manifest);
    if (argv.includes('--write')) {
        for (const outputPath of OUTPUT_PATHS) {
            fs.mkdirSync(path.dirname(outputPath), {recursive: true});
            fs.writeFileSync(outputPath, bundle);
        }
    }
    if (argv.includes('--check')) {
        for (const outputPath of OUTPUT_PATHS) {
            if (!fs.readFileSync(outputPath).equals(bundle)) {
                throw new Error(`generated ${path.relative(ROOT, outputPath)} is stale`);
            }
        }
        process.stdout.write('frontend bundle is current\n');
    }
    if (manifest.styles?.length) {
        const components = manifest.styles.map(entry => fs.readFileSync(path.join(ROOT, entry.file), 'utf8'));
        for (const output of ['src/static/style.css', 'src/project_manager/static/style.css']) {
            const file = path.join(ROOT, output);
            const current = fs.readFileSync(file, 'utf8');
            const expected = composeStyles(current, components);
            if (argv.includes('--write')) fs.writeFileSync(file, expected);
            if (argv.includes('--check') && current !== expected && !argv.includes('--write')) {
                throw new Error(`generated ${output} component styles are stale`);
            }
        }
    }
    if (!argv.includes('--write') && !argv.includes('--check')) {
        throw new Error('specify --check or --write');
    }
}

if (require.main === module) main();
module.exports = {assemble, composeStyles};
