'use strict';

const fs = require('node:fs');
const path = require('node:path');

function options(argv) {
    const result = {};
    for (let index = 0; index < argv.length; index += 2) {
        result[argv[index]] = argv[index + 1];
    }
    for (const name of ['--audit', '--benchmark', '--output']) {
        if (!result[name]) throw new Error(`missing required option ${name}`);
    }
    return result;
}

function render(audit, benchmark) {
    const duplicateLines = audit.duplicateFunctions.length
        ? audit.duplicateFunctions
            .map(item => `- \`${item.name}\`：${item.count} 次`)
            .join('\n')
        : '- 无重复命名函数';
    const riskLines = Object.entries(audit.riskCounts)
        .map(([name, value]) => `- \`${name}\`：${value}`)
        .join('\n');
    const scenarioLines = benchmark.scenarios
        .map(item => (
            `| ${item.projects} | ${item.medianMs} | ${item.p95Ms} | `
            + `${item.outputBytes} |`
        ))
        .join('\n');
    const telemetry = audit.telemetryMarkers.length
        ? `检测到：${audit.telemetryMarkers
            .map(value => `\`${value}\``)
            .join('、')}`
        : '未检测到遥测标记';
    return '# 前端静态审查与性能基线\n\n'
        + '## 范围\n\n'
        + `源文件：${audit.lines} 行，${audit.bytes} 字节，`
        + `${audit.namedFunctions} 个命名函数。`
        + '数据全部为合成数据；未访问正式业务数据或网络。\n\n'
        + `## 重复函数\n\n${duplicateLines}\n\n`
        + `## 静态风险计数\n\n${riskLines}\n\n`
        + `API 路径前缀：${audit.apiRoutePrefixes
            .map(value => `\`${value}\``)
            .join('、') || '无'}。\n\n`
        + `外部来源：${audit.externalOrigins
            .map(value => `\`${value}\``)
            .join('、') || '无'}。\n\n`
        + `遥测检查：${telemetry}。\n\n`
        + '## 侧边栏渲染基线\n\n'
        + `Node：${benchmark.runtime}；预热 ${benchmark.warmups} 次；`
        + `采样 ${benchmark.iterations} 次。\n\n`
        + '| 项目数 | 中位数 ms | P95 ms | 输出字节 |\n'
        + '|---:|---:|---:|---:|\n'
        + `${scenarioLines}\n`;
}

function main(argv = process.argv.slice(2)) {
    const args = options(argv);
    const audit = JSON.parse(fs.readFileSync(args['--audit'], 'utf8'));
    const benchmark = JSON.parse(
        fs.readFileSync(args['--benchmark'], 'utf8'),
    );
    const output = path.resolve(args['--output']);
    fs.mkdirSync(path.dirname(output), {recursive: true});
    fs.writeFileSync(output, render(audit, benchmark), 'utf8');
}

if (require.main === module) main();
module.exports = {render};
