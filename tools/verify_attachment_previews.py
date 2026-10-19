"""Exercise actual encrypted attachment round trips and bundled preview libraries."""
from pathlib import Path
import argparse, hashlib, io, json, os, sys, tempfile, zipfile
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from PIL import Image
from playwright.sync_api import sync_playwright
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from src.backend_patches.data_import import _build_workbook_xlsx


def fixtures():
    image=io.BytesIO();Image.new('RGB',(12,12),'#2563eb').save(image,format='PNG')
    stream=b'BT /F1 12 Tf 20 50 Td (ISOLATED PDF PREVIEW) Tj ET'
    objects=[b'<< /Type /Catalog /Pages 2 0 R >>',b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
             b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
             b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
             b'<< /Length '+str(len(stream)).encode()+b' >>\nstream\n'+stream+b'\nendstream']
    pdf=b'%PDF-1.4\n';offsets=[0]
    for i,obj in enumerate(objects,1):offsets.append(len(pdf));pdf+=f'{i} 0 obj\n'.encode()+obj+b'\nendobj\n'
    start=len(pdf);pdf+=b'xref\n0 6\n0000000000 65535 f \n'+b''.join(f'{n:010} 00000 n \n'.encode() for n in offsets[1:])
    pdf+=f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{start}\n%%EOF\n'.encode()
    docx=io.BytesIO()
    with zipfile.ZipFile(docx,'w',zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        z.writestr('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr('word/document.xml','<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>隔离文档预览正文</w:t></w:r></w:p></w:body></w:document>')
    xlsx=_build_workbook_xlsx([dict(name='预览测试',title='隔离表格预览',headers=['测试字段'],required=[],example=['隔离表格值'])])
    return [('image','preview.png',image.getvalue()),('pdf','preview.pdf',pdf),('word','preview.docx',docx.getvalue()),('excel','preview.xlsx',xlsx)]


def verify(candidate,digest,licenses,output):
    assert hashlib.sha256(candidate.read_bytes()).hexdigest()==digest
    output.mkdir(parents=True,exist_ok=True);checks=[];page_errors=[]
    with tempfile.TemporaryDirectory(prefix='attachment-viewers-',ignore_cleanup_errors=True) as folder:
        with patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(licenses)}):
            client=PackagedClient(candidate,Path(folder),'previews',unused_port())
        try:
            client.start()
            catalog=client.request('GET','/api/procurement-methods')
            method=next(row for row in catalog['methods'] if row['name']=='公开招标' and row['regime']=='government_procurement')
            project=client.request('POST','/api/projects',dict(number='E2E-preview-formats',name='隔离附件预览验证',
                procurement_method_id=method['id'],year=2026));pid=project['id'];attachments=[]
            for kind,name,blob in fixtures():
                response=client.session.post(client.base_url+f'/api/projects/{pid}/attachments',files={'files':(name,blob,'application/octet-stream')},headers={'X-CSRFToken':client.csrf_token},timeout=25)
                assert response.status_code==200,response.text
                listed=client.request('GET',f'/api/projects/{pid}/attachments')
                attachment=next(a for a in listed if a['filename']==name)
                downloaded=client.session.get(client.base_url+f"/api/attachments/{attachment['id']}/download",timeout=25)
                assert downloaded.content==blob,name
                attachments.append((kind,attachment['id']))
                checks.append('actual encrypted upload/download round trip: '+kind)
            with sync_playwright() as playwright:
                edge=Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                browser=playwright.chromium.launch(headless=True,**({'executable_path':str(edge)} if edge.exists() else {}))
                try:
                    context=browser.new_context(viewport=dict(width=1366,height=900),reduced_motion='reduce')
                    context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
                    page=context.new_page();page.on('pageerror',lambda e:page_errors.append(str(e)))
                    page.goto(client.base_url,wait_until='networkidle')
                    page.evaluate('(id)=>selectProject(id)',pid)
                    for theme,width in [('default',1366),('dark',390)]:
                        page.set_viewport_size(dict(width=width,height=900));page.evaluate('(theme)=>applyTheme(theme)',theme)
                        for kind,aid in attachments:
                            page.evaluate('(id)=>viewAttachment(id)',aid)
                            expression={'image':"document.querySelector('#imageViewerContainer img')?.naturalWidth>0",
                                        'pdf':"document.querySelector('#pdfViewerContainer canvas')?.width>0",
                                        'word':"document.getElementById('docxViewerContainer').textContent.includes('隔离文档预览正文')",
                                        'excel':"_previewState.luckysheetCreated && JSON.stringify(luckysheet.getAllSheets()).includes('隔离表格值')"}[kind]
                            page.wait_for_function(expression,timeout=30000)
                            if kind=='excel':
                                page.wait_for_function("""() => ![...document.querySelectorAll('#luckysheet-cell-loading, .luckysheet-cell-loading, #luckysheetloadingdata')].some(
                                    node => node.getClientRects().length && getComputedStyle(node).opacity!=='0'
                                ) && document.querySelector('#luckysheetTableContent')?.width>0""",timeout=30000)
                            page.evaluate('() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))')
                            bounds=page.locator('#docPreviewOverlay .doc-preview-modal').bounding_box() if page.locator('#docPreviewOverlay .doc-preview-modal').count() else page.locator('#docPreviewOverlay').bounding_box()
                            assert bounds and bounds['x']>=-1 and bounds['x']+bounds['width']<=width+1,(kind,bounds,width)
                            page.screenshot(path=str(output/f'{kind}-{theme}-{width}.png'))
                            page.evaluate('closeDocPreview()')
                            assert page.locator('#docPreviewOverlay.open').count()==0
                            checks.append(f'bundled {kind} preview, close and layout: {theme}/{width}')
                    assert not page_errors,page_errors
                finally:browser.close()
        finally:client.stop()
    result=dict(passed=True,count=len(checks),checks=checks,page_errors=page_errors,sha256=digest,real_mail_sent=0,native_desktop_verified=False)
    (output/'附件格式实测.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True)
    p.add_argument('--license-fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    a=p.parse_args();print(json.dumps(verify(a.candidate.resolve(),a.sha256,a.license_fixtures.resolve(),a.output),ensure_ascii=False))
