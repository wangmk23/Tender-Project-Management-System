'use strict';

const fs = require('node:fs');
const path = require('node:path');

function splitSource(source, sections) {
    const starts = sections.map(section => {
        const first = source.indexOf(section.marker);
        if (first < 0) throw new Error(`missing marker: ${section.marker}`);
        if (source.indexOf(section.marker, first + section.marker.length) >= 0) {
            throw new Error(`marker must be unique: ${section.marker}`);
        }
        return first;
    });
    const hasByteOrderMark = source.codePointAt(0) === 0xFEFF;
    if (starts[0] !== 0 && !(hasByteOrderMark && starts[0] === 1)) {
        throw new Error('first section marker must start at byte zero');
    }
    for (let index = 1; index < starts.length; index += 1) {
        if (starts[index] <= starts[index - 1]) {
            throw new Error('section markers are out of order');
        }
    }
    return sections.map((section, index) => ({
        file: section.file,
        content: source.slice(index === 0 ? 0 : starts[index], starts[index + 1] ?? source.length),
    }));
}

function main(argv = process.argv.slice(2)) {
    if (argv.length !== 4 || argv[0] !== '--source' || argv[2] !== '--destination') {
        throw new Error('usage: split_frontend.js --source SOURCE_JS --destination MODULE_DIRECTORY');
    }
    const destination = path.resolve(argv[3]);
    const manifest = JSON.parse(
        fs.readFileSync(path.join(destination, 'manifest.json'), 'utf8'),
    );
    const source = fs.readFileSync(argv[1], 'utf8');
    for (const module of splitSource(source, manifest.sections)) {
        fs.writeFileSync(path.join(destination, module.file), module.content, 'utf8');
    }
}

if (require.main === module) main();
module.exports = {splitSource};
