"""Hash-pinned Windows EXE account/backup acceptance using owned synthetic data."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import time
import traceback

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.verify_media_release import Report, require, sha256
from tools.release_browser import require_windows_candidate, launch_browser

REQUIRED=frozenset(('baseline','candidate','baseline startup','candidate startup','version',
    'legacy account defaults','viewer direct write denied','editor granular permissions',
    'live revocation','admin protection','backup path validation','backup scheduled output',
    'restart persistence','browser UI','inputs unchanged','viewer reads preserve business rows'))


def owned_snapshot(candidate,digest,data_root,owner_root):
    """Load the candidate's native connector in a child that exits before cleanup."""
    result=subprocess.run([sys.executable,str(Path(__file__)), '--owned-snapshot',
        str(candidate),digest,str(data_root),str(owner_root)],check=True,capture_output=True,
        text=True,encoding='utf-8',timeout=40)
    return json.loads(result.stdout)


def snapshot_worker(candidate,digest,data_root,owner_root):
    from contextlib import closing
    from tools.verify_method_correction_release import OwnedDatabase
    require_windows_candidate(Path(candidate),digest)
    owner_root=Path(owner_root).resolve()
    require(owner_root.name.startswith('pm-account-backup-owned-'),'unexpected owner directory')
    database=OwnedDatabase(Path(candidate),Path(data_root),owner_root)
    try:
        tables=('projects','stages','tender_policies','tender_ledgers','business_deadline_items','business_deadline_audit')
        with closing(database.runtime['connect_encrypted'](database.database,database._key,False)) as connection:
            connection.execute('PRAGMA query_only=ON')
            value={table:[list(row) for row in connection.execute('SELECT * FROM '+table+' ORDER BY rowid').fetchall()]
                   for table in tables}
            print(json.dumps(value,ensure_ascii=False))
    finally:
        database.close()


def response(client,method,path,body=None,expected=200):
    result=client.session.request(method,client.base_url+path,json=body,
        headers={'X-CSRFToken':client.csrf_token},timeout=20)
    require(result.status_code==expected,f'{method} {path}: expected {expected}, got {result.status_code}: {result.text[:400]}')
    return result.json()


def login(base,username,password):
    import requests
    from tests.test_stage_template_packaged_e2e import CsrfInputParser
    session=requests.Session()
    session.trust_env=False
    parser=CsrfInputParser()
    parser.feed(session.get(base+'/login',timeout=10).text)
    result=session.post(base+'/login',data=dict(username=username,password=password,csrf_token=parser.token),timeout=10)
    require(result.status_code==200 and '/login' not in result.url,'synthetic account login failed')
    parser=CsrfInputParser()
    parser.feed(result.text)
    match=re.search(r'window\.CSRF_TOKEN\s*=\s*["\']([^"\']+)',result.text)
    token=parser.meta_token or (match.group(1) if match else '')
    require(token,'account workspace CSRF missing')
    from types import SimpleNamespace
    return SimpleNamespace(session=session,csrf_token=token,base_url=base)


def browser_check(client,viewer,evidence,executable):
    from playwright.sync_api import sync_playwright
    errors=[]
    with sync_playwright() as pw:
        browser,metadata=launch_browser(pw,executable)
        try:
            for label,account in [('admin',client),('viewer',viewer)]:
                context=browser.new_context(viewport={'width':1366,'height':1000},timezone_id='Asia/Shanghai')
                context.add_cookies([{'name':cookie.name,'value':cookie.value,'url':client.base_url}
                                    for cookie in account.session.cookies])
                page=context.new_page()
                page.on('pageerror',lambda error:errors.append(str(error)))
                page.goto(client.base_url,wait_until='networkidle')
                page.wait_for_function('typeof loadSettingsView === "function" && typeof hasAccountPermission === "function"')
                if label=='admin':
                    page.evaluate('async () => { switchView("settings"); await loadSettingsView(); setSettingsCategory("files"); }')
                    page.wait_for_selector('#backupFolderInput')
                    page.wait_for_function('!document.getElementById("backupFolderInput").disabled')
                    require(page.locator('#backupFolderInput').input_value(),'backup path absent from real served UI')
                    page.screenshot(path=str(evidence/'admin-backup.png'),full_page=True)
                    page.evaluate('openUserManagement()')
                    page.wait_for_function('document.body.innerText.includes("只读查看")')
                    page.screenshot(path=str(evidence/'admin-accounts.png'),full_page=True)
                else:
                    require(page.evaluate('!hasAccountPermission("create_projects") && !hasAccountPermission("edit_projects")'),
                            'real viewer UI does not apply permissions')
                    page.screenshot(path=str(evidence/'viewer-desktop.png'),full_page=True)
                    page.set_viewport_size({'width':375,'height':812})
                    page.screenshot(path=str(evidence/'viewer-mobile-layout.png'),full_page=True)
                    require(page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'),'viewer mobile horizontal overflow')
                context.close()
            require(not errors,'browser errors: '+repr(errors))
            return dict(environment=metadata,page_errors=errors,native_desktop_verified=False)
        finally:
            browser.close()


def verify(args):
    evidence=args.evidence.resolve()
    evidence.mkdir(parents=True,exist_ok=False)
    report=Report(emit=True)
    report.metadata.update(candidate_sha256=args.candidate_sha256,baseline_sha256=args.baseline_sha256,
        candidate_name=args.candidate.name,baseline_name=args.baseline.name,
        source_commit=args.source_commit,expected_version=args.expected_version,
        platform=platform.platform(),python=sys.version,
        manual_checks=['真实资源管理器窗口','原生桌面文件夹选择','物理显示缩放','实际手机及外网'])
    try:
        report.metadata['harness_commit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        require(re.fullmatch('[0-9a-f]{40}',args.source_commit),'explicit 40-character source commit required')
        report.check('baseline',lambda:require_windows_candidate(args.baseline,args.baseline_sha256))
        report.check('candidate',lambda:require_windows_candidate(args.candidate,args.candidate_sha256))
        from tools.verify_packaged_browser_acceptance import owned_client
        password='Owned-accounts-password-59'
        with tempfile.TemporaryDirectory(prefix='pm-account-backup-owned-') as temporary:
            root=Path(temporary).resolve()
            profile=root/'retained'
            with owned_client(args.baseline,root,'baseline',retained_profile=profile) as old:
                report.check('baseline startup',old.start)
                old.create_project('公开招标','legacy')
                old.request('POST','/api/users',dict(username='legacy_editor',display_name='原协作账号',password=password,is_admin=False))
                admin_password=old.password
            with owned_client(args.candidate,root,'candidate',retained_profile=profile) as client:
                client.password=admin_password
                report.check('candidate startup',client.start)
                report.check('version',lambda:require(client.request('GET','/api/system-info')['version']==args.expected_version,'runtime version mismatch'))
                legacy=next(row for row in client.request('GET','/api/users') if row['username']=='legacy_editor')
                report.check('legacy account defaults',lambda:require(legacy['role']=='editor' and
                    legacy['permissions']==dict(create_projects=True,edit_projects=True,delete_projects=False,manage_attachments=True,export_data=True),'old ordinary-user permissions changed'))
                viewer=client.request('POST','/api/users',dict(username='viewer59',password=password,display_name='只读验收',role='viewer'))
                viewer_client=login(client.base_url,'viewer59',password)
                editor_client=login(client.base_url,'legacy_editor',password)
                try:
                    def deny_viewer():
                        before=client.request('GET','/api/projects')
                        for method,path in [('POST','/api/projects'),('POST','/api/projects?save=1'),
                            ('PATCH','/api/settings'),('POST','/api/users'),('PUT','/api/settings/backup')]:
                            value=response(viewer_client,method,path,{},403)
                            require(value.get('code')=='PERMISSION_DENIED','wrong denial contract')
                        require(client.request('GET','/api/projects')==before,'denied writes changed projects')
                    report.check('viewer direct write denied',deny_viewer)
                    def viewer_reads():
                        def snapshot():
                            return owned_snapshot(args.candidate,args.candidate_sha256,client.data_root,root)
                        before=snapshot()
                        pid=client.request('GET','/api/projects')[0]['id']
                        for path in (f'/api/projects/{pid}',f'/api/projects/{pid}/deadlines',f'/api/projects/{pid}/tender-guarantee'):
                            response(viewer_client,'GET',path)
                        require(snapshot()==before,'viewer GET changed stored business rows')
                        return {'tables_compared':6,'query_only':True,'isolated_native_connector':True}
                    report.check('viewer reads preserve business rows',viewer_reads)
                    def editor_caps():
                        project=response(editor_client,'POST','/api/projects',dict(number='OWNED-EDITOR',name='协作编辑创建',method='公开招标',year=2026),201)
                        response(editor_client,'DELETE',f'/api/projects/{project["id"]}',expected=403)
                        client.request('PUT',f'/api/users/{legacy["id"]}',dict(permissions={'delete_projects':True}))
                        response(editor_client,'DELETE',f'/api/projects/{project["id"]}')
                    report.check('editor granular permissions',editor_caps)
                    def revoked():
                        client.request('PUT',f'/api/users/{legacy["id"]}',dict(role='viewer'))
                        response(editor_client,'POST','/api/projects',{},403)
                        require(response(editor_client,'GET','/api/account-permissions')['role']=='viewer','live role did not refresh')
                    report.check('live revocation',revoked)
                    def protect():
                        admin=next(row for row in client.request('GET','/api/users') if row['username']=='admin')
                        result=client.session.put(client.base_url+f'/api/users/{admin["id"]}',json={'role':'viewer'},headers={'X-CSRFToken':client.csrf_token},timeout=10)
                        require(result.status_code in (400,409),'self/last admin downgrade allowed')
                    report.check('admin protection',protect)
                    old_backups=list((client.data_root/'owned-backups').glob('*'))
                    old_hashes={p.name:sha256(p) for p in old_backups if p.is_file()}
                    target=client.data_root/'自定义备份 & [文件] # %'
                    def backup_path():
                        saved=response(client,'PUT','/api/settings/backup',dict(path=str(target)))
                        require(Path(saved['path'])==target and saved['available'],'saved backup path mismatch')
                        response(client,'PUT','/api/settings/backup',dict(path='relative/path'),400)
                        require(response(client,'GET','/api/settings/backup')['configured_path']==str(target),'invalid path replaced configuration')
                    report.check('backup path validation',backup_path)
                    def scheduled():
                        settings_file=client.data_root/'app_settings.json'
                        settings=json.loads(settings_file.read_text('utf-8'))
                        settings.update(backup_time='00:00',last_backup_date=(datetime.now()-timedelta(days=1)).date().isoformat())
                        pending=settings_file.with_suffix('.owned-pending')
                        pending.write_text(json.dumps(settings,ensure_ascii=False),'utf-8')
                        pending.replace(settings_file)
                        deadline=time.monotonic()+85
                        while time.monotonic()<deadline:
                            files=list(target.glob('*.pmbak'))
                            if files:
                                require(all(p.stat().st_size>0 for p in files),'empty full backup')
                                require(all(sha256(client.data_root/'owned-backups'/name)==digest for name,digest in old_hashes.items()),'old backup changed')
                                return {'files':[dict(name=p.name,sha256=sha256(p),bytes=p.stat().st_size) for p in files]}
                            time.sleep(.5)
                        raise AssertionError('scheduled EXE backup did not appear in chosen directory')
                    report.check('backup scheduled output',scheduled)
                    def restart():
                        client.restart()
                        require(Path(response(client,'GET','/api/settings/backup')['path'])==target,'backup path did not survive restart')
                        current=next(row for row in client.request('GET','/api/users') if row['id']==legacy['id'])
                        require(current['role']=='viewer','account policy did not survive restart')
                    report.check('restart persistence',restart)
                    # Restart changes session secret only if an existing deployment's contract does;
                    # log in afresh for an independently authenticated viewer browser.
                    viewer_client.session.close()
                    viewer_client=login(client.base_url,'viewer59',password)
                    report.check('browser UI',lambda:browser_check(client,viewer_client,evidence,args.browser_executable))
                finally:
                    viewer_client.session.close()
                    editor_client.session.close()
            report.check('inputs unchanged',lambda:require(sha256(args.candidate)==args.candidate_sha256 and
                sha256(args.baseline)==args.baseline_sha256,'input EXE changed'))
    except Exception:
        report.metadata['error']=traceback.format_exc()
    value=report.result()
    value['missing_required_checks']=sorted(REQUIRED-{r['name'] for r in report.checks if r['passed']})
    value['passed']=value['passed'] and not value['missing_required_checks']
    value['complete_release_acceptance']=False
    (evidence/'account-backup-exe-acceptance.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8')
    return value


def parser():
    result=argparse.ArgumentParser(description=__doc__)
    for name in ('baseline','candidate','evidence'):
        result.add_argument('--'+name,type=Path,required=True)
    for name in ('baseline-sha256','candidate-sha256','expected-version','source-commit'):
        result.add_argument('--'+name,required=True)
    result.add_argument('--browser-executable',type=Path)
    return result


if __name__=='__main__':
    if len(sys.argv)==6 and sys.argv[1]=='--owned-snapshot':
        snapshot_worker(*sys.argv[2:])
        raise SystemExit(0)
    result=verify(parser().parse_args())
    print(json.dumps({key:result[key] for key in ('passed','total','failed','missing_required_checks')},ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
