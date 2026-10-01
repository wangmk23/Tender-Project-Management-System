'use strict';

const fs = require('node:fs');
const path = require('node:path');

function occurrences(source, expression) {
    return Array.from(source.matchAll(expression)).length;
}

function analyzeSource(source) {
    const functions = Array.from(
        source.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/gm),
        match => match[1],
    );
    const counts = new Map();
    functions.forEach(name => counts.set(name, (counts.get(name) || 0) + 1));
    const duplicateFunctions = Array.from(counts.entries())
        .filter(([, count]) => count > 1)
        .map(([name, count]) => ({name, count}))
        .sort((left, right) => left.name.localeCompare(right.name));
    const apiRoutePrefixes = Array.from(
        new Set(Array.from(
            source.matchAll(/["'`](\/api\/[A-Za-z0-9_./-]+)/g),
            match => match[1],
        )),
    ).sort();
    const externalOrigins = Array.from(
        new Set(Array.from(
            source.matchAll(/https?:\/\/[^\s"'`)<]+/g),
            match => {
                try {
                    return new URL(match[0]).origin;
                }
                catch {
                    return null;
                }
            },
        ).filter(Boolean)),
    ).sort();
    const telemetryTokens = [
        'sendBeacon',
        'google-analytics',
        'googletagmanager',
        'mixpanel',
        'segment.io',
        'sentry.io',
    ];
    return {
        bytes: Buffer.byteLength(source, 'utf8'),
        lines: source.length === 0 ? 0 : source.split(/\r?\n/).length,
        namedFunctions: functions.length,
        duplicateFunctions,
        apiRoutePrefixes,
        riskCounts: {
            innerHTMLAssignments: occurrences(source, /\.innerHTML\s*=/g),
            insertAdjacentHTMLCalls: occurrences(
                source,
                /\.insertAdjacentHTML\s*\(/g,
            ),
            directFetchCalls: occurrences(source, /\bfetch\s*\(/g),
            timeoutCalls: occurrences(source, /\bsetTimeout\s*\(/g),
            intervalCalls: occurrences(source, /\bsetInterval\s*\(/g),
            objectUrlCreates: occurrences(
                source,
                /URL\.createObjectURL\s*\(/g,
            ),
            objectUrlRevokes: occurrences(
                source,
                /URL\.revokeObjectURL\s*\(/g,
            ),
        },
        externalOrigins,
        telemetryMarkers: telemetryTokens.filter(token => source.includes(token)),
    };
}

function parseArgs(argv) {
    const options = {};
    for (let index = 0; index < argv.length; index += 2) {
        options[argv[index]] = argv[index + 1];
    }
    if (!options['--source'] || !options['--output']) {
        throw new Error(
            'usage: audit_frontend.js --source SOURCE_FILE --output OUTPUT_JSON',
        );
    }
    return options;
}

function main(argv = process.argv.slice(2)) {
    const options = parseArgs(argv);
    const result = analyzeSource(
        fs.readFileSync(options['--source'], 'utf8'),
    );
    const output = path.resolve(options['--output']);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
}

if (require.main === module) main();
module.exports = {analyzeSource};
