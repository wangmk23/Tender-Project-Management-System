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
    if (!argv.includes('--write') && !argv.includes('--check')) {
        throw new Error('specify --check or --write');
    }
}

if (require.main === module) main();
module.exports = {assemble};
