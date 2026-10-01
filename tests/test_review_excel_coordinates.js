'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const XLSX = require('../src/project_manager/static/libs/xlsx/xlsx.full.min.js');
const source = fs.readFileSync(path.join(__dirname, '../source/frontend/03-attachments.js'), 'utf8');
const start = source.indexOf('async function loadExcelPreview(');
let depth = 0, end;
for (let i = source.indexOf('{', source.indexOf(')', start)); i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}') depth--;
    if (!depth) { end = i + 1; break; }
}
async function preview(sheet) {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, '测试');
    const bytes = XLSX.write(book, {type: 'array', bookType: 'xlsx'});
    let options;
    const context = {
        XLSX, console, _previewState: {fileName: 'review.xlsx', sessionVersion: 1},
        isAttachmentPreviewSessionCurrent: () => true,
        document: {getElementById: () => ({innerHTML: '', style: {}})},
        localFetch: async () => ({ok: true, headers: {get: () => ''}, arrayBuffer: async () => bytes}),
        luckysheet: {create(value) { options = value; }}, escHtml: String,
    };
    vm.createContext(context);
    vm.runInContext(source.slice(start, end), context);
    await context.loadExcelPreview(1, 1);
    assert.ok(options, 'preview should parse and create the sheet');
    return options.data[0];
}
test('Excel merge coordinates follow data when used range starts at B3', async () => {
    const sheet = await preview({B3: {t: 's', v: 'Title'}, B4: {t: 's', v: 'Data'}, C6: {t: 'n', v: 8},
        '!ref': 'B3:C6', '!merges': [{s: {r: 2, c: 1}, e: {r: 2, c: 2}}]});
    assert.equal(sheet.celldata[0].r, 0);
    assert.equal(sheet.celldata[0].c, 0);
    assert.deepEqual(JSON.parse(JSON.stringify(sheet.config.merge)), {'0_0': {r: 0, c: 0, rs: 1, cs: 2}});
});
test('Excel merges starting at A1 and empty sheets still preview', async () => {
    const sheet = await preview({A1: {t: 's', v: 'Title'}, '!ref': 'A1:B1', '!merges': [{s: {r: 0, c: 0}, e: {r: 0, c: 1}}]});
    assert.equal(sheet.config.merge['0_0'].cs, 2);
    const empty = await preview({});
    assert.equal(empty.celldata.length, 0);
});
