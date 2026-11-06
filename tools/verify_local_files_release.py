"""Hash-pinned local-folder acceptance against isolated, headless Windows EXEs.

Loopback HTTP simulates the host client. Non-loopback requests to a local NIC test the
remote policy, not a physical phone/network. Never invoke native dialogs/openers.
"""
from __future__ import annotations
import argparse
import base64
from contextlib import contextmanager
from datetime import date, timedelta
import json
import ipaddress
import io
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
import zipfile
from unittest.mock import patch
from urllib.parse import urlencode
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.verify_media_release import Report, require, sha256
from tools.release_browser import require_windows_candidate, launch_browser
from tools.verify_account_backup_release import response, login

REQUIRED=frozenset(('baseline','candidate','protected authorization modules','baseline startup','candidate startup',
    'version','association','revision and project isolation',
    'background scan and pagination','existing nested folders','hot cache performance','original files unchanged',
    'same volume move','restart identity recovery','same name replacement rejected',
    'viewer and CSRF denied','remote policy','disabled account and restored','actual license states',
    'read-only content and download','browser themes and narrow layout','inputs unchanged'))


def finalize(report, required=REQUIRED):
    value=report.result()
    value['missing_required_checks']=sorted(required-{r['name'] for r in report.checks if r['passed']})
    value['passed']=value['passed'] and not value['missing_required_checks']
    value['complete_release_acceptance']=False
    return value


def protected_modules(baseline,candidate,*,public=False):
    for path in (baseline,candidate):
        require(Path(path).is_file(), "EXE input missing")
    from PyInstaller.archive.readers import CArchiveReader
    from tools.compile_module_patches import _read_pyz,_pyz_entry
    archives=[CArchiveReader(str(p)) for p in (baseline,candidate)]
    pyzs=[a.extract('PYZ.pyz') for a in archives]
    tocs=[_read_pyz(p)[0] for p in pyzs]
    names=('licensing',) if public else ('licensing','data_security')
    for name in names:
        before = _pyz_entry(pyzs[0],tocs[0],name)
        after = _pyz_entry(pyzs[1],tocs[1],name)
        if public:
            import marshal
            from tools.build_public import sanitize_code
            expected = sanitize_code(marshal.loads(before),first_party=True,module=name)
            require(marshal.loads(after) == expected,f'public sanitizer differs for {name}')
        else:
            require(before == after,f'protected module changed: {name}')
    return {'modules':list(names),'comparison':'public sanitizer' if public else 'byte-for-byte'}


def seed_project(client, suffix):
    methods = client.request('GET','/api/procurement-methods')['methods']
    matches = [item for item in methods if item['name'] == '公开招标']
    require(matches,'synthetic project method unavailable')
    method = next((item for item in matches if item.get('regime') == 'government_procurement'), matches[0])
    return client.request('POST','/api/projects', {'number':f'LOCAL-FILES-{suffix}',
        'name':'隔离本地资料验收项目','year':2026,'procurement_method_id':method['id']})


def require_complete_scan(value,count):
    scan=value['scan']
    require(scan['state']=='complete' and scan['complete'] and scan['files']>=count,'scan incomplete or files missing')


def require_hot_timings(timings):
    require(set(timings)=={'summary','entries','search'},'missing performance measurements')
    for name,values in timings.items():
        require(values and max(values)<300,f'{name} hot responses exceed 300ms: {values}')


def wait_scan(client,path,count,timeout):
    start=time.perf_counter()
    while time.perf_counter()-start<timeout:
        value=response(client,'GET',path+'/scan')
        if value['scan']['state'] in ('complete','partial','error','cancelled'):
            require_complete_scan(value,count)
            return {'elapsed_seconds':time.perf_counter()-start,'scan':value['scan']}
        time.sleep(.15)
    raise AssertionError('background scan timed out')


def fingerprint(folder):
    return {str(p.relative_to(folder)):(sha256(p),p.stat().st_mtime_ns) for p in folder.rglob('*') if p.is_file()}


def content_path(path, revision, file, mode='preview', *, binding):
    return f'{path}/content?'+urlencode(dict(path=file, mode=mode, revision=revision, binding=binding))


def license_states(client, root, path, revision, binding):
    import license_issuer as issuer
    license_path = client.data_root / 'license.dat'
    valid = json.loads(license_path.read_text('utf-8'))
    fingerprint = issuer.machine_fingerprint()
    with patch.dict(os.environ, {'PROCUREMENT_ISSUER_HOME': str(root/'issuer-baseline')}):
        expired = issuer.sign_payload(issuer.build_payload(
            organization='Synthetic local files expired license',
            machine_hash=fingerprint['machine_hash'], device_code=fingerprint['device_code'],
            expires=date.today()-timedelta(days=1)),
            issuer.load_private_key('synthetic-acceptance-password'))
    invalid = json.loads(json.dumps(valid))
    signature = bytearray(base64.b64decode(invalid['signature']))
    signature[0] ^= 1
    invalid['signature'] = base64.b64encode(signature).decode('ascii')
    file = content_path(path, revision, '资料-10000.txt', binding=binding)
    results = {}
    try:
        for mode, fixture in [('read_only', expired), ('blocked', invalid)]:
            issuer.write_license(fixture, client.data_root)
            status = response(client, 'GET', '/api/license/status')
            require(status['mode'] == mode, f'expected actual {mode}, got {status["mode"]}')
            denied = client.session.post(client.base_url+path+'/scan', json={'expected_revision':revision},
                                         headers={'X-CSRFToken':client.csrf_token}, timeout=15)
            require(denied.status_code == 423, f'{mode} write returned {denied.status_code}')
            read = client.session.get(client.base_url+file, timeout=15, allow_redirects=False)
            require(read.status_code == (200 if mode == 'read_only' else 423),
                    f'{mode} preview returned {read.status_code}')
            results[mode] = {'write_http':denied.status_code,'preview_http':read.status_code}
    finally:
        issuer.write_license(valid, client.data_root)
    require(response(client, 'GET', '/api/license/status')['mode'] == 'full', 'valid license did not restore access')
    return results


@contextmanager
def compatible_client(executable, root, label, fixtures, retained_profile):
    from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
    with patch.dict(os.environ, {'PM_TEST_LICENSE_DIR': str(fixtures)}):
        client = PackagedClient(executable, root, label, unused_port())
    retained = retained_profile / 'data'
    if retained.is_dir():
        shutil.copytree(retained, client.data_root, dirs_exist_ok=True)
    settings_path = client.data_root / 'app_settings.json'
    settings = json.loads(settings_path.read_text('utf-8'))
    settings.update(backup_folder=str(client.data_root/'owned-backups'),
                    export_folder=str(client.data_root/'owned-exports'),
                    last_backup_date=date.today().isoformat(), reminder_enabled=False,
                    reminder_recipient_groups=[], event_reminder_create_enabled=False,
                    event_reminder_complete_enabled=False, supplier_shortage_email_enabled=False)
    settings_path.write_text(json.dumps(settings,ensure_ascii=False),encoding='utf-8')
    try:
        yield client
    finally:
        client.stop()
        shutil.copytree(client.data_root, retained, dirs_exist_ok=True)


def sample_docx():
    content_types = '''<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>'''
    relationships = '''<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>'''
    document = '''<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>第一章 隔离测试</w:t></w:r></w:p>
<w:p><w:r><w:t>项目系统 Word 打印验证第一页</w:t></w:r></w:p>
<w:p><w:r><w:br w:type="page"/></w:r></w:p>
<w:p><w:pPr><w:outlineLvl w:val="0"/></w:pPr><w:r><w:t>第二章 附件资料</w:t></w:r></w:p>
<w:p><w:r><w:t>项目系统 Word 打印验证第二页</w:t></w:r></w:p>
<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1200" w:bottom="1200" w:left="1200" w:right="1200"/></w:sectPr>
</w:body></w:document>'''
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as package:
        package.writestr('[Content_Types].xml', content_types)
        package.writestr('_rels/.rels', relationships)
        package.writestr('word/document.xml', document)
    return output.getvalue()


def browser_word_check(page, evidence):
    page.evaluate('closeDocPreview()')
    page.locator('[name=local_query]').fill('只读 Word 样本.docx')
    page.locator('[data-action=search]').click()
    page.get_by_role('button', name='预览 只读 Word 样本.docx', exact=True).click()
    navigation = page.get_by_role('navigation', name='Word 文档导航')
    heading = navigation.get_by_role('button', name='第二章 附件资料', exact=True)
    heading.click()
    document = page.get_by_role('region', name='Word 文档正文')
    page.wait_for_function('document.querySelector(".word-preview-document").scrollTop > 0')
    page.screenshot(path=str(evidence/'local-files-word-outline.png'))
    page.evaluate('() => { window.printCount = 0; window.print = () => window.printCount++; }')
    page.get_by_role('button', name='打印文档', exact=True).click()
    require(page.evaluate('window.printCount') == 1, 'Word print did not invoke the browser')
    page.emulate_media(media='print')
    require(not navigation.is_visible() and not page.locator('#app').is_visible(), 'app chrome appeared in Word print output')
    require(document.get_by_text('项目系统 Word 打印验证第二页').is_visible(), 'Word document missing from print output')
    printed = page.pdf(path=str(evidence/'local-files-word-print.pdf'), prefer_css_page_size=True)
    pages = len(re.findall(rb'/Type\s*/Page\b', printed))
    require(pages == 2, f'expected two printed pages, got {pages}')
    page.emulate_media(media='screen')
    return {'outline':True,'print_button':True,'pdf_pages':pages,'native_print_dialog':False}


def browser_check(client,pid,evidence,executable):
    from playwright.sync_api import sync_playwright
    errors=[]
    with sync_playwright() as pw:
        browser,metadata=launch_browser(pw,executable)
        try:
            context=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Shanghai',accept_downloads=True)
            context.add_cookies([{'name':c.name,'value':c.value,'url':client.base_url} for c in client.session.cookies])
            page=context.new_page()
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(client.base_url,wait_until='networkidle')
            page.wait_for_function('typeof selectProject === "function"')
            page.evaluate('async id => {await selectProject(id); switchProjectTab("attachments"); await selectLocalFilesSource("local");}',pid)
            page.wait_for_selector('.local-files-row')
            for theme in ('default','blue','green','dark'):
                page.evaluate('(theme) => updateUiPreference("theme",theme)',theme)
                require(page.evaluate('document.documentElement.dataset.theme') == theme, f'{theme} theme not applied')
                page.screenshot(path=str(evidence/f'local-files-{theme}.png'),full_page=True)
            page.set_viewport_size({'width':390,'height':844})
            page.screenshot(path=str(evidence/'local-files-narrow.png'),full_page=True)
            require(page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'),'narrow layout overflows')
            page.set_viewport_size({'width':1440,'height':1000})
            page.locator('[name=local_query]').fill('自定分类')
            page.locator('[data-action=search]').click()
            page.get_by_role('button', name='自定分类', exact=True).click()
            page.get_by_role('button', name='深层目录', exact=True).click()
            page.locator('.local-files-list').get_by_text('层级定位.txt').wait_for()
            require(page.locator('[aria-current=location]').inner_text() == '深层目录', 'breadcrumb missed current folder')
            page.screenshot(path=str(evidence/'local-files-nested.png'),full_page=True)
            page.get_by_role('button', name='上一级', exact=True).click()
            page.get_by_role('button', name='深层目录', exact=True).wait_for()
            require(not page.locator('.local-files-stage-overview,[data-action=template]').count(), 'standard folder UI remains')
            page.locator('[name=local_query]').fill('只读预览样本.pdf')
            page.locator('[data-action=search]').click()
            pdf_row = page.locator('.local-files-row').filter(has_text='只读预览样本.pdf')
            pdf_row.get_by_role('button', name='预览 只读预览样本.pdf').click()
            reader = page.frame_locator('#pdfReaderFrame')
            reader.locator('.page canvas').first.wait_for(timeout=30000)
            require(not reader.locator('#editorFreeTextButton').is_visible(), 'PDF editor is visible')
            page.screenshot(path=str(evidence/'local-files-pdf-read-only.png'), full_page=True)
            with page.expect_download() as download_info:
                page.locator('#docPreviewOverlay button[onclick*="downloadPreviewFile("]').click()
            download = download_info.value
            require(download.suggested_filename == '只读预览样本.pdf', 'download filename changed')
            require(download.failure() is None, 'browser download failed')
            word = browser_word_check(page, evidence)
            require(not errors,'browser errors: '+repr(errors))
            return {'environment':metadata,'page_errors':errors,'native_desktop_verified':False,
                    'pdf_preview_canvas':True,'browser_download':True,'word':word}
        finally:browser.close()


def verify(args):
    evidence=args.evidence.resolve()
    evidence.mkdir(parents=True,exist_ok=False)
    report=Report(emit=True)
    fixtures = getattr(args, 'compatible_license_dir', None)
    required = REQUIRED
    if fixtures:
        required = (REQUIRED - {'actual license states'}) | {'compatible test authorization', 'license inputs unchanged'}
        report.metadata['unexecuted_license_transitions'] = 'Uses a valid compatibility fixture. Signed expiry and invalid signature run on a public candidate with ephemeral keys.'
    report.metadata['edition'] = 'compatible' if fixtures else 'public'
    report.metadata.update(candidate_sha256=args.candidate_sha256,baseline_sha256=args.baseline_sha256,
        source_commit=args.source_commit,expected_version=args.expected_version,platform=platform.platform(),
        python=sys.version,host_transport='authenticated loopback HTTP',remote_transport='HTTP through an explicit local non-loopback IPv4 address',
        manual_checks=['原生目录选择器','真实资源管理器打开','物理跨盘移动','实际手机和外网'],
        candidate_name=args.candidate.name,baseline_name=args.baseline.name)
    try:
        require(re.fullmatch('[0-9a-f]{40}',args.source_commit),'explicit full source commit required')
        report.metadata['harness_commit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        report.check('baseline',lambda:require_windows_candidate(args.baseline,args.baseline_sha256))
        report.check('candidate',lambda:require_windows_candidate(args.candidate,args.candidate_sha256))
        report.check('protected authorization modules',lambda:protected_modules(args.baseline,args.candidate,public=not fixtures))
        from tools.verify_packaged_browser_acceptance import owned_client
        fixture_hashes = {}
        if fixtures:
            fixtures = fixtures.resolve(strict=True)
            require((fixtures/'license.dat').is_file(), 'compatible test license input missing')
            fixture_hashes = {name:sha256(fixtures/name) for name in ('license.dat','.license_state.bin','license_public_key.pem') if (fixtures/name).is_file()}
            client_factory = lambda executable,root,label,profile: compatible_client(executable,root,label,fixtures,profile)
        else:
            client_factory = lambda executable,root,label,profile: owned_client(executable,root,label,retained_profile=profile)
        with tempfile.TemporaryDirectory(prefix='pm-local-files-owned-') as temporary:
            root=Path(temporary).resolve(); profile=root/'retained'
            with client_factory(args.baseline,root,'baseline',profile) as old:
                report.check('baseline startup',old.start)
                project=seed_project(old,'BASE')
                password=old.password
            folder=root/'中文项目原资料'; folder.mkdir()
            for i in range(10000):(folder/f'资料-{i+1:05d}.txt').write_text(f'原始资料 {i+1}',encoding='utf-8')
            from tools.verify_pdf_reader_release import text_pdf
            (folder/'只读预览样本.pdf').write_bytes(text_pdf(2))
            (folder/'只读 Word 样本.docx').write_bytes(sample_docx())
            nested=folder/'自定分类'/'深层目录'
            nested.mkdir(parents=True)
            (nested/'层级定位.txt').write_text('隔离目录浏览验证',encoding='utf-8')
            original=fingerprint(folder)
            with client_factory(args.candidate,root,'candidate',profile) as client:
                client.password=password
                report.check('candidate startup',client.start)
                report.check('version',lambda:require(response(client,'GET','/api/system-info')['version']==args.expected_version,'version mismatch'))
                pid=project['id']; path=f'/api/projects/{pid}/local-files'
                state=report.check('association',lambda:response(client,'PUT',path+'/association',{'path':str(folder),'expected_revision':0}))
                revision=state['revision']
                binding=state['binding']
                def conflicts():
                    stale=response(client,'PUT',path+'/association',{'path':str(folder),'expected_revision':0},409)
                    require(stale['code']=='LOCAL_FILES_CONFLICT','stale revision contract')
                    other=seed_project(client,'OTHER')
                    otherpath=f'/api/projects/{other["id"]}/local-files'
                    response(client,'PUT',otherpath+'/association',{'path':str(folder),'expected_revision':0},409)
                    require(not response(client,'GET',otherpath)['linked'],'other project took ownership')
                    response(client,'GET',path+'/entries?parent=../',expected=400)
                report.check('revision and project isolation',conflicts)
                def scan():
                    begin=time.perf_counter()
                    import requests
                    remote_base=f'http://{args.remote_host}:{client.port}'
                    with requests.Session() as remote_session:
                        remote_session.trust_env=False
                        for cookie in client.session.cookies:
                            remote_session.cookies.set(cookie.name,cookie.value)
                        started=remote_session.get(remote_base+path+'/entries?index=initial',timeout=20)
                        require(started.status_code == 200, f'browser index request returned {started.status_code}')
                        require(started.json()['scan']['state'] == 'queued','read-only browser did not initialize the index')
                    elapsed=time.perf_counter()-begin
                    value=wait_scan(client,path,10000,args.scan_timeout)
                    value['launch_seconds']=elapsed
                    first=response(client,'GET',path+'/entries?offset=0&limit=100')
                    second=response(client,'GET',path+'/entries?offset=100&limit=100')
                    require(len(first['items'])==100 and first['has_more'],'first page invalid')
                    require(not ({x['path'] for x in first['items']}&{x['path'] for x in second['items']}),'pages overlap')
                    require(response(client,'GET',path+'/entries?q=资料-10000')['total']==1,'10000th file not indexed')
                    return value
                report.check('background scan and pagination',scan)
                def nested_folders():
                    folder_result=response(client,'GET',path+'/entries?'+urlencode({'parent':'自定分类/深层目录'}))
                    require([item['name'] for item in folder_result['items']]==['层级定位.txt'],'nested directory did not open')
                    result=response(client,'GET',path+'/entries?'+urlencode({'q':'深层目录'}))
                    require([item['path'] for item in result['items']]==['自定分类/深层目录'],'folder name search failed')
                    return {'path':result['items'][0]['path']}
                report.check('existing nested folders',nested_folders)
                def hot():
                    timings={}
                    for name,endpoint in [('summary',path+'?view=browser'),('entries',path+'/entries'),('search',path+'/entries?q=资料-10000')]:
                        response(client,'GET',endpoint)
                        values=[]
                        for _ in range(5):
                            start=time.perf_counter();response(client,'GET',endpoint);values.append((time.perf_counter()-start)*1000)
                        timings[name]=values
                    report.metadata['hot_timings_ms']=timings
                    require_hot_timings(timings)
                    return timings
                # A performance failure still fails the report, while browser and
                # directory integrity checks continue to collect independent evidence.
                try:
                    report.check('hot cache performance',hot)
                except AssertionError:
                    pass
                def read_only_files():
                    target = '资料-10000.txt'
                    preview = content_path(path, revision, target, binding=binding)
                    original = (folder/target).read_bytes()
                    sample = client.session.get(client.base_url+preview, headers={'Range':'bytes=0-2'}, timeout=15)
                    require(sample.status_code == 206 and sample.content == original[:3], 'file range preview failed')
                    download = client.session.get(client.base_url+content_path(path,revision,target,'download',binding=binding), timeout=15)
                    require(download.status_code == 200 and download.content == original, 'download bytes differ')
                    require(download.headers['Content-Disposition'].startswith('attachment'), 'download not served as attachment')
                    edit = client.session.put(client.base_url+preview, data=b'forbidden',
                                              headers={'X-CSRFToken':client.csrf_token}, timeout=15)
                    require(edit.status_code == 405, f'file edit route returned {edit.status_code}')
                    require((folder/target).read_bytes() == original, 'source file changed')
                    return {'preview_http':sample.status_code,'download_http':download.status_code,'edit_http':edit.status_code}
                report.check('read-only content and download', read_only_files)
                if fixtures:
                    report.check('compatible test authorization', lambda:require(
                        response(client,'GET','/api/license/status')['mode']=='full','valid compatibility fixture rejected'))
                else:
                    report.check('actual license states', lambda:license_states(client,root,path,revision,binding))
                def permissions():
                    viewer_account=client.request('POST','/api/users',{'username':'local_viewer','password':'Owned-viewer-62','role':'viewer'})
                    viewer=login(client.base_url,'local_viewer','Owned-viewer-62')
                    try:
                        view=response(viewer,'GET',path)
                        require('path' not in view and not view['capabilities']['manage'],'viewer leaks host path/capability')
                        for suffix in ('choose','scan','preview','directories','open'):
                            response(viewer,'POST',path+'/'+suffix,{'expected_revision':revision},403)
                        read = viewer.session.get(viewer.base_url+content_path(path,revision,'资料-10000.txt',binding=binding), timeout=15)
                        require(read.status_code == 200, 'viewer could not preview')
                        denied = viewer.session.get(viewer.base_url+content_path(path,revision,'资料-10000.txt','download',binding=binding), timeout=15)
                        require(denied.status_code == 403, 'viewer download bypassed export permission')
                        raw=client.session.post(client.base_url+path+'/scan',json={'expected_revision':revision},timeout=10)
                        require(raw.status_code in (400,403),'missing CSRF accepted')
                        require(response(client,'GET',path)['revision']==revision,'denied mutation changed revision')
                        def blocked():
                            client.request('PUT',f'/api/users/{viewer_account["id"]}',{'is_active':False})
                            raw=viewer.session.get(viewer.base_url+path,allow_redirects=False,timeout=10)
                            require(raw.status_code in (302,401,403),'disabled account retained access')
                            client.request('PUT',f'/api/users/{viewer_account["id"]}',{'is_active':True})
                            restored=login(client.base_url,'local_viewer','Owned-viewer-62')
                            try:response(restored,'GET',path)
                            finally:restored.session.close()
                        report.check('disabled account and restored',blocked)
                    finally:viewer.session.close()
                report.check('viewer and CSRF denied',permissions)
                def remote():
                    import requests
                    from types import SimpleNamespace
                    require(args.remote_host and not ipaddress.ip_address(args.remote_host).is_loopback,
                            '--remote-host must be this machine non-loopback IPv4 address')
                    # Same isolated EXE port, real non-loopback REMOTE_ADDR; no proxy headers.
                    remote_base=f'http://{args.remote_host}:{client.port}'
                    remote_session=requests.Session();remote_session.trust_env=False
                    for cookie in client.session.cookies:remote_session.cookies.set(cookie.name,cookie.value)
                    remote_client=SimpleNamespace(session=remote_session,base_url=remote_base,csrf_token=client.csrf_token)
                    try:
                        value=response(remote_client,'GET',path)
                        require('path' not in value and not value['capabilities']['manage'],'remote host path/capability leaked')
                        for suffix in ('choose','scan','open'):
                            response(remote_client,'POST',path+'/'+suffix,{'expected_revision':revision},403)
                        entries=response(remote_client,'GET',path+'/entries')
                        require(all(not Path(x['path']).is_absolute() for x in entries['items']),'remote absolute entry path')
                        return {'address':args.remote_host,'actual_phone_verified':False}
                    finally:remote_session.close()
                report.check('remote policy',remote)
                report.check('browser themes and narrow layout',lambda:browser_check(client,pid,evidence,args.browser_executable))
                moved=root/'同盘移动后的项目'
                folder.rename(moved)
                def recover_directory(target):
                    response(client,'POST',path+'/scan',{'expected_revision':revision},202)
                    wait_scan(client,path,10000,args.scan_timeout)
                    value=response(client,'GET',path)
                    require(value['linked'] and Path(value['path'])==target,'moved root identity not recovered')
                report.check('same volume move',lambda:recover_directory(moved))
                client.stop()
                moved_again=root/'关闭后归档的项目'
                moved.rename(moved_again); moved=moved_again
                client.start()
                report.check('restart identity recovery',lambda:recover_directory(moved))
                report.check('original files unchanged',lambda:require(
                    fingerprint(moved)==original and {x.relative_to(moved).as_posix() for x in moved.rglob('*') if x.is_dir()}
                    == {'自定分类','自定分类/深层目录'}, 'original file or directory layout changed'))
                # Preserve the original and replace its last-known path with a new identity.
                retained=root/'保留原目录';moved.rename(retained);moved.mkdir()
                def replaced():
                    response(client,'POST',path+'/scan',{'expected_revision':revision},409)
                    require(response(client,'GET',path)['status']=='replaced','same-name replacement silently accepted')
                    denied = client.session.get(client.base_url+content_path(path,revision,'资料-10000.txt',binding=binding), timeout=15)
                    require(denied.status_code == 409, 'replaced directory was readable')
                report.check('same name replacement rejected',replaced)
            report.check('inputs unchanged',lambda:require(sha256(args.candidate)==args.candidate_sha256 and sha256(args.baseline)==args.baseline_sha256,'input EXE changed'))
            if fixtures:
                report.check('license inputs unchanged', lambda:require(
                    all(sha256(fixtures/name)==digest for name,digest in fixture_hashes.items()), 'test license fixture changed'))
    except Exception:report.metadata['error']=traceback.format_exc()
    value=finalize(report, required)
    (evidence/'local-files-exe-acceptance.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8')
    return value


def parser():
    result=argparse.ArgumentParser(description=__doc__)
    for name in ('baseline','candidate','evidence'):result.add_argument('--'+name,type=Path,required=True)
    for name in ('baseline-sha256','candidate-sha256','expected-version','source-commit'):result.add_argument('--'+name,required=True)
    result.add_argument('--browser-executable',type=Path)
    result.add_argument('--compatible-license-dir',type=Path,help='Explicit valid compatibility test fixture directory')
    result.add_argument('--remote-host',required=True,help='This machine LAN IPv4 for real non-loopback HTTP against the isolated EXE')
    result.add_argument('--scan-timeout',type=float,default=180)
    return result

if __name__=='__main__':
    result=verify(parser().parse_args())
    print(json.dumps({key:result[key] for key in ('passed','total','failed','missing_required_checks')},ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
