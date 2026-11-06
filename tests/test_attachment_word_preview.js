const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { composeStyles } = require('../tools/build_frontend');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const libs = 'src/project_manager/static/libs';
const JSZip = require(path.join(root, libs, 'jszip.min.js'));
const template = read('src/templates/workspace.html');
const preview = template.slice(template.indexOf('<div class="doc-preview-overlay"'), template.indexOf('<!-- ═══ 文档预览库'));
const manifest = JSON.parse(read('source/frontend/manifest.json'));
const styles = new Set([...manifest.styles.map(({file}) => file), 'src/project_manager/static/css/word-preview.css']);
const stylesheet = composeStyles(read('src/static/style.css'), [...styles]
    .filter(file => fs.existsSync(path.join(root, file))).map(read));

const w = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main';
const rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const packageRel = 'http://schemas.openxmlformats.org/package/2006/relationships';
const pageSize = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:bottom="1200" w:left="1200" w:right="1200"/></w:sectPr>';
const pageBreak = '<w:p><w:r><w:br w:type="page"/></w:r></w:p>';

function paragraph(text, props = '') {
    return `<w:p><w:pPr>${props}</w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function style(id, name, props = '') {
    return `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/>${props}</w:style>`;
}

function docx(body) {
    const zip = new JSZip();
    zip.file('[Content_Types].xml', '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
    zip.file('_rels/.rels', `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/styles" Target="styles.xml"/></Relationships>`);
    zip.file('word/styles.xml', `<w:styles xmlns:w="${w}">${style('Custom', 'Custom title', '<w:basedOn w:val="Base"/>')}${style('Base', 'Base title', '<w:pPr><w:outlineLvl w:val="1"/></w:pPr>')}${style('Heading1', 'heading 1')}</w:styles>`);
    zip.file('word/document.xml', `<w:document xmlns:w="${w}"><w:body>${body}${pageSize}</w:body></w:document>`);
    return zip.generateAsync({type: 'nodebuffer'});
}

let browser, headings, plain;
before(async () => {
    [browser, headings, plain] = await Promise.all([
        chromium.launch({headless: true}),
        docx([
            paragraph('第一章 采购范围', '<w:pStyle w:val="Heading1"/>'),
            paragraph('正文保留'),
            paragraph('正文样式覆盖', '<w:pStyle w:val="Custom"/><w:outlineLvl w:val="9"/>'),
            pageBreak,
            paragraph('特殊条款 &lt;示例&gt;', '<w:pStyle w:val="Custom"/>'),
            paragraph('三级标题', '<w:outlineLvl w:val="2"/>'),
        ].join('')),
        docx(paragraph('第一页正文') + pageBreak + paragraph('第二页正文')),
    ]);
});
after(async () => browser?.close());

async function openFixture(t, viewport = {width: 1280, height: 800}) {
    const page = await browser.newPage({viewport, reducedMotion: 'reduce'});
    t.after(() => page.close());
    await page.route('http://word-preview.test/**', route => {
        const {pathname} = new URL(route.request().url());
        const documents = {'/api/attachments/1/view': headings, '/files/plain.docx': plain, '/files/legacy.doc': Buffer.from('legacy')};
        if (pathname in documents) return route.fulfill({
            body: documents[pathname], contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        if (pathname === '/fixture.css') return route.fulfill({body: stylesheet, contentType: 'text/css'});
        if (pathname === '/fixture.js') return route.fulfill({
            body: `let currentProject = {attachments:[{id:1,filename:'章节测试.docx',extension:'docx'}]};
                function localFetch(url){return fetch(url);}
                function escHtml(value){return String(value || '').replaceAll('&','&amp;').replaceAll('<','&lt;');}
                window.printCalls = 0;
                window.print = () => { window.printCalls++; };
                ${read('source/frontend/03-attachments.js')}`,
            contentType: 'text/javascript',
        });
        if (pathname.startsWith('/libs/')) return route.fulfill({
            body: read('src/project_manager/static' + pathname), contentType: 'text/javascript',
        });
        return route.fulfill({
            contentType: 'text/html; charset=utf-8',
            body: `<!doctype html><html lang="zh-CN" data-theme="dark"><head><link rel="stylesheet" href="/fixture.css"></head>
            <body><main>APP CHROME MUST NOT PRINT</main><button onclick="viewAttachment(1)">打开附件</button>
            <button onclick="openDocPreview({filename:'只读.docx'},'word',null,{contentUrl:'/files/plain.docx'})">打开只读文件</button>
            <button onclick="openDocPreview({filename:'旧版.doc'},'word',null,{contentUrl:'/files/legacy.doc'})">打开旧版文件</button>
            ${preview}<script src="/libs/jszip.min.js"></script><script src="/libs/docx-preview/docx-preview.min.js"></script><script src="/fixture.js"></script></body></html>`,
        });
    });
    page.on('pageerror', error => console.error(error));
    page.on('console', message => console.error(message.text()));
    page.setDefaultTimeout(4000);
    await page.goto('http://word-preview.test/');
    return page;
}

test('Word attachment jumps to direct, built-in and inherited outline headings', async t => {
    const page = await openFixture(t);
    await page.getByRole('button', {name: '打开附件'}).click();
    await page.getByText('正文保留', {exact: true}).waitFor();
    const nav = page.getByRole('navigation', {name: 'Word 文档导航'});
    assert.equal(await nav.count(), 1);
    assert.deepEqual(await nav.getByRole('button').allTextContents(), ['第一章 采购范围', '特殊条款 <示例>', '三级标题']);
    const heading = nav.getByRole('button', {name: '特殊条款 <示例>'});
    await heading.focus();
    await page.keyboard.press('Enter');
    assert.equal(await heading.getAttribute('aria-current'), 'location');
    const top = await page.getByText('特殊条款 <示例>', {exact: true}).last().boundingBox();
    const documentRegion = await page.getByRole('region', {name: 'Word 文档正文'}).boundingBox();
    assert.ok(top.y >= documentRegion.y && top.y < documentRegion.y + 80);
});

test('read-only local Word files offer page navigation and print on a phone', async t => {
    const page = await openFixture(t, {width: 375, height: 680});
    await page.getByRole('button', {name: '打开只读文件'}).click();
    const print = page.getByRole('button', {name: '打印文档'});
    await page.getByText('第二页正文', {exact: true}).waitFor();
    assert.equal(await print.count(), 1);
    assert.equal(await page.getByRole('button', {name: '下载原始附件'}).isVisible(), false);
    const toggle = page.getByRole('button', {name: '页码'});
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    await page.getByRole('button', {name: '第 2 页'}).click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(await page.getByRole('region', {name: 'Word 文档正文'}).evaluate(node => node.scrollTop > 900));
    await print.click();
    assert.equal(await page.evaluate(() => window.printCalls), 1);

    await page.emulateMedia({media: 'print'});
    assert.equal(await page.getByText('APP CHROME MUST NOT PRINT').isVisible(), false);
    assert.equal(await print.isVisible(), false);
    assert.equal(await page.getByText('第一页正文', {exact: true}).isVisible(), true);
    assert.equal(await page.getByText('第二页正文', {exact: true}).isVisible(), true);
    const pdf = await page.pdf({preferCSSPageSize: true});
    assert.match(pdf.toString('latin1'), /\/Count 2\b/);
    assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 2);
});

test('a legacy local Word file shows a fallback without unavailable print or download actions', async t => {
    const page = await openFixture(t);
    await page.getByRole('button', {name: '打开旧版文件'}).click();
    await page.getByText('此文档无法在线预览').waitFor();
    assert.equal(await page.getByRole('button', {name: '下载文件查看'}).count(), 0);
    assert.equal(await page.getByRole('button', {name: '打印文档'}).count(), 0);
});
