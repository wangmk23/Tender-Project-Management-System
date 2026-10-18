"""Hash-pinned isolated release checks; never starts or edits an existing deployment."""
from __future__ import annotations
import argparse, hashlib, io, json, os, shutil, sqlite3, statistics, subprocess, sys, tempfile, time, zipfile
from pathlib import Path
from unittest.mock import patch
from contextlib import closing
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright


def verify(candidate,sha,fixtures,output,old_exe=None):
    if hashlib.sha256(candidate.read_bytes()).hexdigest()!=sha:raise ValueError('candidate hash mismatch')
    output.mkdir(parents=True,exist_ok=True);checks=[];errors=[];shots=[];timings={}
    def check(name,value):
        checks.append(dict(name=name,passed=bool(value)))
        if not value:raise AssertionError(name)
    def connect_owned(path,key_path=None):
        path=Path(path)
        if not path.resolve().is_relative_to(Path(temp).resolve()):raise ValueError('only owned fixture database paths are allowed')
        if path.exists() and path.read_bytes()[:16]==b'SQLite format 3\0':return sqlite3.connect(path)
        import ctypes,ctypes.wintypes,sqlcipher3
        class Blob(ctypes.Structure):_fields_=[('size',ctypes.wintypes.DWORD),('data',ctypes.POINTER(ctypes.c_ubyte))]
        payload=(key_path or path.parent/'data_key.dpapi').read_bytes();buffer=ctypes.create_string_buffer(payload)
        src=Blob(len(payload),ctypes.cast(buffer,ctypes.POINTER(ctypes.c_ubyte)));dst=Blob()
        if not ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(src),None,None,None,None,0,ctypes.byref(dst)):raise OSError('owned fixture key cannot be read')
        try:key=ctypes.string_at(dst.data,dst.size)
        finally:ctypes.windll.kernel32.LocalFree(dst.data)
        connection=sqlcipher3.connect(str(path));connection.execute('PRAGMA key="x\''+key.hex()+'\'"');return connection
    def core_rows(path):
        with closing(connect_owned(path)) as connection:
            return {table:connection.execute('SELECT * FROM '+table+' ORDER BY id').fetchall() for table in ['projects','stages','supplier_registrations','bid_results','project_lots']}
    def report():
        result=dict(version='v'+json.loads((ROOT/'package.json').read_text('utf8'))['version'],sha256=sha,checks=checks,passed=sum(c['passed'] for c in checks),total=len(checks),page_errors=errors,screenshots=shots,timings=timings,real_mail_sent=0,native_desktop_verified=False)
        (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2,default=str)+'\n',encoding='utf8');return result
    with tempfile.TemporaryDirectory(prefix='procurement-release-') as temp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old_exe or candidate,Path(temp),'owned',unused_port())
        try:
            client.start()
            if old_exe:
                check('old runtime is healthy with valid fixture license',client.request('GET','/api/license/status')['status']=='valid')
                response=client.session.get(client.base_url+'/api/procurement-methods',timeout=10)
                check('old release rejects new capability (404)',response.status_code==404)
                client.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False,reminder_recipient_groups=[]))
                historical=client.create_project('公开招标','HISTORY');historical_id=historical['id']
                client.stop()
                with closing(connect_owned(client.data_root/'bidding.db')) as seed:seed.execute("UPDATE stages SET completed=1,completed_date='2026-01-02' WHERE project_id=? AND stage_key='plan_received'",(historical_id,));seed.commit()
                before=core_rows(client.data_root/'bidding.db')
                license_before={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in client.data_root.iterdir() if p.name in ['license.dat','data_key.dpapi']}
                shutil.copy2(candidate,client.executable);client.start()
                check('upgrade leaves original business rows byte-identical',core_rows(client.data_root/'bidding.db')==before)
                check('upgrade retains original license and data key files',all(hashlib.sha256((client.data_root/name).read_bytes()).hexdigest()==value for name,value in license_before.items()))
            check('runtime reports expected version',client.request('GET','/api/system-info')['version']=='v'+json.loads((ROOT/'package.json').read_text('utf8'))['version'])
            cat=client.request('GET','/api/procurement-methods');check('legacy regime remains pending',any(m['regime'] is None for m in cat['methods']))
            def add(name,regime='enterprise',**more):
                cat=client.request('GET','/api/procurement-methods');return client.request('POST','/api/procurement-methods',dict(name=name,regime=regime,revision=cat['revision'],**more))['method']
            stages=[dict(id='register',name='报名登记',icon='👥',modules=['common','registration']),dict(id='review',name='有效投标核对',icon='🔍',modules=['common','evaluation']),dict(id='result',name='结果登记',icon='🏆',modules=['common','bid_results'])]
            method=add('隔离验证询比采购',template_mode='independent',stages=stages,quantity_rule=dict(mode='fixed',minimum=3),exceptions=[dict(title='特殊情形',description='隔离测试人工核对说明',enabled=True,quantity_rule=dict(mode='fixed',minimum=2))])
            same=add('隔离验证询比采购','collective');check('same name in different regimes has separate id',method['id']!=same['id'])
            created=client.request('POST','/api/projects',dict(number='QA-2026-NEW',name='隔离验收项目',procurement_method_id=method['id'],year=2026,no_deposit=True));pid=created['id']
            check('new project uses independent stage snapshot',[s['key'] for s in created['stages']]==['register','review','result'])
            for i in range(2):client.request('POST',f'/api/projects/{pid}/registrations',dict(company_name='隔离供应商'+str(i+1),registration_method='offline'))
            q=client.request('GET',f'/api/projects/{pid}/supplier-quantity?stage_key=register')['items'][0]
            check('quantity uses registrations at registration phase',q['status']=='shortage' and q['actual_count']==2 and q['required_count']==3)
            response=client.session.put(client.base_url+f'/api/projects/{pid}/stages/register',json=dict(completed=True,force_complete=True),headers={'X-CSRFToken':client.csrf_token},timeout=10)
            check('force-complete cannot bypass quantity confirmation',response.status_code==409 and response.json().get('code')=='SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED')
            client.request('POST',f'/api/projects/{pid}/supplier-quantity/confirm',dict(stage_key='register',lot_id=None,fingerprint=q['fingerprint'],reason='核实后人工继续办理'))
            check('quantity decision persists',client.request('GET',f'/api/projects/{pid}/supplier-quantity?stage_key=register')['items'][0]['status']=='confirmed')
            changed=client.request('PATCH','/api/procurement-methods/'+method['id'],dict(revision=method['revision'],name='已更名的询比采购',enabled=False,quantity_rule=dict(mode='fixed',minimum=8)))['method']
            detail=client.get_project(pid);check('existing project retains name and quantity snapshot',detail['method']==method['name'] and detail['procurement']['quantity_rule']['minimum']==3)
            response=client.session.delete(client.base_url+'/api/procurement-methods/'+method['id'],json=dict(revision=changed['revision']),headers={'X-CSRFToken':client.csrf_token},timeout=10)
            check('referenced method cannot be deleted',response.status_code==409)
            detail=client.request('PUT',f'/api/projects/{pid}',dict(name='仅修改已有项目资料',procurement_method_id=method['id']));check('disabled method does not prevent ordinary old project edit',detail['procurement']['method_id']==method['id'])
            rows=[dict(id=s['key'],name=s['name'],icon=s['icon'],modules=s['modules']) for s in detail['stages']]+[dict(id='archive_extra',name='补充归档',icon='📦',modules=['common','archive'])]
            preview=client.request('POST',f'/api/projects/{pid}/workflow/preview',dict(stages=rows));(output/'preview-debug.json').write_text(json.dumps(dict(preview=preview,stages=client.get_project(pid)['stages']),ensure_ascii=False,indent=2),encoding='utf8');check('workflow preview explains impact without writing',len(preview['diff']['added'])==1 and len(client.get_project(pid)['stages'])==3)
            saved=client.request('POST',f'/api/projects/{pid}/workflow/commit',dict(stages=rows,base_fingerprint=preview['base_fingerprint']))
            check('workflow applies only explicit target',len(saved['project']['stages'])==4)
            response=client.session.post(client.base_url+f'/api/projects/{pid}/workflow/commit',json=dict(stages=rows,base_fingerprint=preview['base_fingerprint']),headers={'X-CSRFToken':client.csrf_token},timeout=10)
            check('stale preview cannot be replayed',response.status_code==409)
            # Template is generated by the actual packaged endpoint; read as safe text.
            template=client.session.get(client.base_url+'/api/import/templates?kind=projects',timeout=15)
            if template.status_code==404:template=client.session.get(client.base_url+'/api/import/projects/template',timeout=15)
            check('project import template endpoint succeeds',template.status_code==200 and template.content[:2]==b'PK')
            from src.backend_patches import data_import
            workbook=data_import._parse_xlsx_workbook(template.content)
            check('template includes identity and regime reference',all(x in workbook['项目'][0] for x in ['采购方式标识','适用制度']) and '采购方式目录' in workbook)
            raw=data_import._build_workbook_xlsx([dict(name='项目',title='项目导入',headers=['项目编号','项目名称','采购方式标识','适用制度'],required=['项目编号','项目名称'],example=['QA-IMPORT','安全文本 =1+1',same['id'],'集体经济组织采购'])])
            response=client.session.post(client.base_url+'/api/import/projects',files={'file':('项目.xlsx',raw,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},headers={'X-CSRFToken':client.csrf_token},timeout=15)
            check('actual multipart project import binds catalog identity',response.status_code==200 and response.json()['success']==1)
            response=client.session.get(client.base_url+'/api/export?download=1',timeout=15);check('actual export returns xlsx',response.status_code==200 and response.content[:2]==b'PK')
            export=data_import._parse_xlsx_workbook(response.content);headers,records=next(iter(export.values()))
            check('export preserves method id and scope regime',all(x in headers for x in ['采购方式标识','适用制度']) and any(r.get('采购方式标识')==same['id'] for r in records))
            started=time.perf_counter();calendar=client.request('GET','/api/calendar?year=2026&month=10');timings['calendar_api_ms']=(time.perf_counter()-started)*1000
            check('calendar still returns complete month',len([c for c in calendar['cells'] if not c['empty']])==31)
            with sync_playwright() as pw:
                context=pw.chromium.launch_persistent_context(str(Path(temp)/'browser-profile'),headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',locale='zh-CN',timezone_id='Asia/Shanghai',viewport={'width':1366,'height':900},reduced_motion='reduce');browser=context.browser
                try:
                    context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(client.base_url,wait_until='networkidle');page.wait_for_function('typeof readUiPreferences==="function" && typeof loadProcurementCatalog==="function"')
                    for theme in ['default','dark','blue','green']:
                        for width in [1366,1920,768,390]:
                            page.set_viewport_size({'width':width,'height':900});page.evaluate('(t)=>{updateUiPreference("theme",t);updateUiPreference("size","large");setCompactMode(true);}',theme)
                            page.evaluate('showNewProjectModal()');check(f'{theme}/{width} new project fits',page.locator('#modal').evaluate('(e)=>e.getBoundingClientRect().left>=-1&&e.getBoundingClientRect().right<=innerWidth+1'))
                            check(f'{theme}/{width} id based choices',page.locator('#npMethod option[value="'+same['id']+'"]').count()==1)
                            name=f'新建项目-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name);page.evaluate('closeModal()');page.wait_for_timeout(30)
                            page.evaluate('showProcurementMethodForm()');check(f'{theme}/{width} method modal fits',page.locator('#modal').evaluate('(e)=>e.scrollWidth<=e.clientWidth+2'))
                            check(f'{theme}/{width} quantity default unfixed',page.locator('#pmQuantityMode').input_value()=='unfixed');
                            if width in [1366,390]:
                                name=f'采购方式-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name)
                            page.evaluate('closeModal()');page.wait_for_timeout(30)
                    page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost');page.evaluate('setSettingsCategory("general")')
                    page.locator('#loginSubtitleInput').fill('未保存的验收草稿');page.evaluate('updateUiPreference("theme","dark")');check('preference changes preserve admin draft',page.locator('#loginSubtitleInput').input_value()=='未保存的验收草稿')
                    page.evaluate('updateUiPreference("motion","off")');check('animation off affects actual computed style',page.locator('#modal').evaluate('(e)=>getComputedStyle(e).animationName')=='none')
                    page.reload(wait_until='networkidle');check('account preference survives browser reload',page.evaluate('readUiPreferences().theme')=='dark')
                    latency=[]
                    for _ in range(7):
                        value=page.evaluate('''async (pid)=>{await selectProject(pid);const t=performance.now();openStageSlide('register');await new Promise(requestAnimationFrame);return performance.now()-t;}''',pid);latency.append(value);page.evaluate('closeSlide()')
                    timings['stage_panel_ms']={'median':statistics.median(latency),'p95':sorted(latency)[-1],'samples':latency}
                    check('stage panel responds within 500ms in warm view',max(latency)<500)
                    check('no browser script errors',not errors)
                    context.close()
                    persisted=pw.chromium.launch_persistent_context(str(Path(temp)/'browser-profile'),headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',locale='zh-CN',timezone_id='Asia/Shanghai')
                    try:
                        persisted.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);again=persisted.new_page();again.goto(client.base_url,wait_until='networkidle');check('personal preference survives browser process restart',again.evaluate('readUiPreferences().theme')=='dark')
                    finally:persisted.close()
                finally:
                    if browser and browser.is_connected():browser.close()
            client.restart();cat2=client.request('GET','/api/procurement-methods');check('method configuration persists after restart',any(m['id']==method['id'] and not m['enabled'] and m['name']==changed['name'] for m in cat2['methods']))
            check('project workflow persists after restart',len(client.get_project(pid)['stages'])==4)
            # Physical SQLite backup round-trip includes every new sidecar table.
            client.stop();backup=Path(temp)/'catalog-backup.db';restored=Path(temp)/'catalog-restored.db'
            with closing(connect_owned(client.data_root/'bidding.db')) as db,closing(connect_owned(backup,client.data_root/'data_key.dpapi')) as dest:db.backup(dest)
            shutil.copy2(backup,restored)
            with closing(connect_owned(restored,client.data_root/'data_key.dpapi')) as db:
                check('backup restore retains catalog and project references',db.execute('SELECT COUNT(*) FROM project_procurement_snapshots WHERE project_id=?',(pid,)).fetchone()[0]==1 and db.execute('PRAGMA integrity_check').fetchone()[0]=='ok')
            # Exercise the candidate's preserved encrypted archive implementation on the same fictional catalog.
            from PyInstaller.archive.readers import CArchiveReader
            from tools.compile_module_patches import _named_code_objects
            from tests import test_full_backup_regressions as backup_tests
            from src.backend_patches.app_replacements import create_full_backup
            archive=CArchiveReader(str(candidate)).open_embedded_archive('PYZ.pyz');app_code=archive.extract('app')
            fixture=backup_tests.FrozenBackupTests();fixture.backup_code=_named_code_objects(app_code,'_original_backup')[0];fixture.security_code=archive.extract('data_security')
            backup_root=Path(temp)/'encrypted-archive-check';backup_root.mkdir()
            original,connect,key,security=fixture.fixture(backup_root,encrypted=True)
            with closing(connect_owned(client.data_root/'bidding.db')) as src,closing(connect(backup_root/'isolated.db',key)) as dst:src.backup(dst)
            target=create_full_backup(original);payload=b''.join(security['iter_decrypted_file'](target,key,1024))
            with zipfile.ZipFile(io.BytesIO(payload)) as saved_archive:
                restored_archive=backup_root/'restored.db';restored_archive.write_bytes(saved_archive.read('bidding.db'))
                with closing(connect(restored_archive,key)) as db:check('candidate encrypted archive restores catalog identities',db.execute('SELECT COUNT(*) FROM project_procurement_snapshots WHERE project_id=?',(pid,)).fetchone()[0]==1)
                check('candidate encrypted archive retains generated attachments','uploads/nested/isolated.bin' in saved_archive.namelist())
        except Exception:
            log=client.root/'startup.log'
            if log.exists():(output/'startup-failure.log').write_text(log.read_text('utf8',errors='replace')[-10000:],encoding='utf8')
            report();raise
        finally:client.stop()
    return report()

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);p.add_argument('--old-exe',type=Path);args=p.parse_args()
    result=verify(args.candidate.resolve(),args.sha256,args.fixtures.resolve(),args.output.resolve(),args.old_exe.resolve() if args.old_exe else None)
    print(json.dumps({k:result[k] for k in ['passed','total','page_errors','timings']},ensure_ascii=False))
