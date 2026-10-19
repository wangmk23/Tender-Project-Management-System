'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const XLSX = require('../src/project_manager/static/libs/xlsx/xlsx.full.min.js');
const source = fs.readFileSync(require('node:path').join(__dirname, '../source/frontend/03-attachments.js'), 'utf8');
const loader = source.slice(source.indexOf('async function loadExcelPreview('), source.indexOf('function downloadPreviewFile('));
async function run(bytes, advertisedSize = '') {
    const loading = {innerHTML: '', style: {}};
    let options;
    const context = {XLSX, console: {error() {}}, Uint8Array, DataView, ArrayBuffer,
        _previewState: {fileName: 'isolated.xlsx'}, isAttachmentPreviewSessionCurrent: () => true,
        document: {getElementById: () => loading}, escHtml: String,
        localFetch: async () => ({ok: true, headers: {get: key => key === 'content-length' ? advertisedSize : ''}, arrayBuffer: async () => bytes}),
        luckysheet: {create(value) { options = value; }}};
    vm.createContext(context); vm.runInContext(loader, context);
    await context.loadExcelPreview(1, 1);
    return {options, message: loading.innerHTML};
}
function workbook(sheet = {A1: {t: 's', v: '正常资料'}, '!ref': 'A1'}) {
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, '隔离表');
    return XLSX.write(book, {type: 'array', bookType: 'xlsx'});
}
test('vendored parser has the official fixes and still round trips Unicode and merges', () => {
    assert.equal(XLSX.version, '0.20.3');
    const restored = XLSX.read(workbook(), {type: 'array'});
    assert.equal(restored.Sheets['隔离表'].A1.v, '正常资料');
});
test('oversized preview fails with download fallback before creating a grid', async () => {
    const result = await run(workbook(), String(17 * 1024 * 1024));
    assert.equal(result.options, undefined);
    assert.match(result.message, /下载/);
});
test('huge worksheet dimensions cannot allocate the preview grid', async () => {
    const archive = XLSX.CFB.read(new Uint8Array(workbook()), {type: 'array'});
    const entry = archive.FileIndex.find(item => item.name === 'sheet1.xml');
    entry.content = Buffer.from(Buffer.from(entry.content).toString().replace('ref="A1"', 'ref="A1:GS3"'));
    entry.size = entry.content.length;
    const result = await run(XLSX.CFB.write(archive, {type: 'array', fileType: 'zip'}));
    assert.equal(result.options, undefined);
    assert.match(result.message, /下载/);
});
test('ordinary XLSX previews without evaluating workbook formulas', async () => {
    const result = await run(workbook());
    assert.ok(result.options);
    assert.equal(result.options.forceCalculation, false);
    assert.equal(result.options.data[0].celldata[0].v.v, '正常资料');
});
test('a distant sparse row offers download instead of silently losing its value', async () => {
    const result = await run(workbook({A5000: {t: 's', v: '远处数据'}, '!ref': 'A5000'}));
    assert.equal(result.options, undefined);
    assert.match(result.message, /下载/);
});
