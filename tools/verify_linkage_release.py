"""Hash-pinned EXE linkage acceptance using only owned synthetic data."""
from __future__ import annotations
import argparse
import copy
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch
import requests
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from tools.release_browser import launch_browser, require_windows_candidate


def verify(candidate, sha, fixtures, output, browser_executable=None):
    require_windows_candidate(candidate, sha)
    output.mkdir(parents=True,exist_ok=False)
    checks=[];page_errors=[];scale={};browser_metadata={}
    def check(name,passed,detail=None):checks.append(dict(name=name,passed=bool(passed),detail=detail))
    def raw_put(client,path,payload):
        return client.session.put(client.base_url+path,json=payload,headers={'X-CSRFToken':client.csrf_token},timeout=15)
    with tempfile.TemporaryDirectory(prefix='pm-linkage-owned-') as temp,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(candidate,Path(temp),'linkage',unused_port())
        public_key=fixtures/'license_public_key.pem'
        if public_key.is_file():shutil.copy2(public_key,client.data_root/public_key.name)
        try:
            client.start()
            client.patch_settings(dict(reminder_enabled=False,reminder_recipient_groups=[],event_reminder_create_enabled=False,event_reminder_complete_enabled=False,supplier_shortage_email_enabled=False))
            created=client.request('POST','/api/projects',dict(number='SIM-LINKAGE-001',name='隔离联动验证项目',method='公开招标',year=2026,budget='按实际结算',no_deposit=False))
            pid=created['id'];path=f'/api/projects/{pid}'
            check('new project supplies a first-edit snapshot',bool(re.fullmatch('[0-9a-f]{64}',created.get('record_version',''))))
            original=client.get_project(pid)
            check('every returned stage supplies a snapshot',all(re.fullmatch('[0-9a-f]{64}',stage.get('record_version','')) for stage in original['stages']))
            saved=client.request('PUT',path,dict(name='隔离联动验证项目-新名称',record_version=original['record_version']))
            check('write response proves its original project snapshot',saved.get('record_version_base')==original['record_version'])
            stale=raw_put(client,path,dict(name='不应覆盖的新名称',record_version=original['record_version']))
            check('stale project edit is a real HTTP409',stale.status_code==409)
            check('stale response identifies the conflict',stale.json().get('code')=='RECORD_VERSION_CONFLICT')
            check('rejected edit leaves the latest name',client.get_project(pid)['name']=='隔离联动验证项目-新名称')
            stage=saved['stages'][0];stage_path=path+'/stages/'+requests.utils.quote(stage['key'],safe='')
            changed=client.request('PUT',stage_path,dict(notes='最新阶段备注',record_version=stage['record_version']))
            stale=raw_put(client,stage_path,dict(notes='不应覆盖的备注',record_version=stage['record_version']))
            check('stale stage edit is a real HTTP409',stale.status_code==409)
            check('latest stage note survives',client.get_project(pid)['stages'][0]['notes']=='最新阶段备注')
            token=changed['record_version']
            def concurrent(name):
                with requests.Session() as other:
                    other.trust_env=False;other.cookies.update(client.session.cookies)
                    return other.put(client.base_url+path,json=dict(name=name,record_version=token),headers={'X-CSRFToken':client.csrf_token},timeout=15).status_code
            with ThreadPoolExecutor(max_workers=2) as pool:statuses=list(pool.map(concurrent,['隔离窗口一','隔离窗口二']))
            check('two windows have exactly one accepted write',sorted(statuses)==[200,409],statuses)
            before=client.get_project(pid)
            refund=next(stage for stage in before['stages'] if 'deposit_refund' in stage.get('modules',[]))
            enabled=client.request('PUT',path,dict(no_deposit=True,record_version=before['record_version']))
            check('no-deposit records automatic-stage provenance',refund['key'] in enabled['no_deposit_transition']['auto_skipped'])
            disabled=client.request('PUT',path,dict(no_deposit=False,record_version=enabled['record_version']))
            restored=next(stage for stage in disabled['stages'] if stage['key']==refund['key'])
            check('disabling restores the automatic pending stage',not restored['completed'] and not restored['skipped'])
            check('restoration does not fabricate a completion time',not restored.get('completed_date') and not restored.get('completed_at'))
            # A real/manual completion is deliberately left untouched by both toggles.
            for item in restored.get('checklist',[]):
                if item.get('required') and not item.get('completed'):client.request('PUT',path+f'/stage-checklist/{item["id"]}',{'completed':True})
            minute=datetime.now().replace(second=0,microsecond=0).isoformat(timespec='minutes')
            manual=client.request('PUT',path+'/stages/'+requests.utils.quote(refund['key'],safe=''),dict(completed=True,completed_at=minute,completed_date=minute[:10],record_version=restored['record_version']))
            enabled=client.request('PUT',path,dict(no_deposit=True,record_version=manual['record_version']))
            disabled=client.request('PUT',path,dict(no_deposit=False,record_version=enabled['record_version']))
            actual=next(stage for stage in disabled['stages'] if stage['key']==refund['key'])
            check('manual completion is preserved',actual['completed'] and not actual['skipped'])
            check('manual completion minute is preserved',str(actual.get('completed_at','')).replace(' ','T')[:16]==minute)
            confirmed=client.get_project(pid)
            plans=lambda project:[(s['key'],s.get('planned_date'),s.get('planned_at')) for s in project['stages']]
            check('GET returns deadline summary without changing node plans',isinstance(confirmed.get('business_deadline_summary'),dict) and plans(confirmed)==plans(disabled),dict(summary=confirmed.get('business_deadline_summary'),plans_unchanged=plans(confirmed)==plans(disabled)))
            check('free-text budget survives all operations',disabled['budget']=='按实际结算')
            with sync_playwright() as pw:
                browser,browser_metadata=launch_browser(pw,browser_executable)
                try:
                    context=browser.new_context(viewport=dict(width=1366,height=768),timezone_id='Asia/Shanghai',reduced_motion='reduce')
                    context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
                    page=context.new_page();page.on('pageerror',lambda error:page_errors.append(str(error)))
                    page.goto(client.base_url,wait_until='networkidle');page.wait_for_selector('.command-metric')
                    facts=client.get_project(pid)
                    page.evaluate('syncApplicationAccess({mode:"read_only",status:"expired",message:"合成只读状态验证"})')
                    check('server-mode UI has a persistent banner',page.locator('#appAccessBanner').is_visible())
                    check('read-only UI disables new-project entry',page.locator('#sidebarNewProjectBtn').is_disabled())
                    rejected=page.evaluate('''async (pid)=>{try{await api('PUT','/api/projects/'+pid,{name:'不应写入'});return '';}catch(error){return error.message;}}''',pid)
                    check('client rejects writes in read-only mode','只读' in rejected)
                    check('read-only rejection leaves project facts unchanged',client.get_project(pid)==facts)
                    page.evaluate('refreshApplicationAccess()');page.wait_for_function('!document.getElementById("appAccessBanner")')
                    check('refreshing actual full mode restores the entry',not page.locator('#sidebarNewProjectBtn').is_disabled())
                    sidebar=page.locator('#projectList').inner_text()
                    page.route('**/api/projects',lambda route:route.fulfill(status=200,content_type='text/html',body='<html><title>登录</title></html>'),times=1)
                    error=page.evaluate('''async()=>{try{await loadAllProjects();return '';}catch(error){return error.message;}}''')
                    check('HTML response requires a login check','登录' in error)
                    check('HTML response keeps the prior sidebar',page.locator('#projectList').inner_text()==sidebar)
                    page.screenshot(path=str(output/'linkage-recovery.png'),animations='disabled')
                    # Pressure scenario uses synthetic API replies inside the actual packaged shell.
                    shell=client.session.get(client.base_url,timeout=10).text;styles=client.session.get(client.base_url+'/static/style.css',timeout=10).text
                    script=client.session.get(client.base_url+'/static/app.js',timeout=10).text
                    stats=client.request('GET','/api/stats');stats.update(total=3000,in_progress=3000,completed=0)
                    settings=client.request('GET','/api/settings');catalog=client.request('GET','/api/procurement-methods')
                    sample=next(p for p in client.request('GET','/api/projects') if p['id']==pid)
                    rows=[];future=datetime.now()+timedelta(days=2)
                    for index in range(3000):
                        value=copy.deepcopy(sample);value.update(id=10000+index,number=f'SCALE-{index:05}',name=f'合成规模项目{index+1}')
                        for n,stage in enumerate(value['stages'][:3]):stage['planned_at']=(future+timedelta(days=n)).isoformat(timespec='minutes')
                        rows.append(value)
                    rows_json=json.dumps(rows,ensure_ascii=False,separators=(',',':'))
                    print(json.dumps(dict(scale_projects=3000,response_bytes=len(rows_json.encode('utf-8')))),flush=True)
                    # Serve the 45MB realistic list over loopback HTTP. Passing it through
                    # Playwright/CDP route.fulfill measures protocol marshalling overhead.
                    responses={
                        '/':('text/html',shell),'/static/app.js':('text/javascript',script),
                        '/static/style.css':('text/css',styles),'/api/projects':('application/json',rows_json),
                    }
                    for endpoint,value in {'stats':stats,'settings':settings,'procurement-methods':catalog,
                        'license/status':dict(mode='full',status='valid'),
                        'system-info':dict(is_admin=True,is_desktop=False,license=dict(mode='full'))}.items():
                        responses['/api/'+endpoint]=('application/json',json.dumps(value,ensure_ascii=False))
                    responses={key:(kind,body.encode('utf-8')) for key,(kind,body) in responses.items()}
                    class Handler(BaseHTTPRequestHandler):
                        def log_message(self,*args):pass
                        def do_GET(self):
                            pathname=self.path.split('?',1)[0]
                            match=re.fullmatch(r'/api/projects/(\d+)',pathname)
                            if match:
                                kind,body='application/json',json.dumps(rows[max(0,min(2999,int(match[1])-10000))],ensure_ascii=False).encode('utf-8')
                            else:kind,body=responses.get(pathname,('application/json',b'{"methods":[]}') if pathname.startswith('/api/') else ('text/plain',b''))
                            self.send_response(200);self.send_header('Content-Type',kind+'; charset=utf-8');self.send_header('Content-Length',str(len(body)));self.end_headers()
                            try:self.wfile.write(body)
                            except (BrokenPipeError,ConnectionResetError):pass
                    server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
                    worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
                    try:
                        scale_page=context.new_page();scale_page.on('pageerror',lambda error:page_errors.append(str(error)))
                        start=time.perf_counter();scale_page.goto(f'http://127.0.0.1:{server.server_port}/',wait_until='domcontentloaded')
                        try:scale_page.locator('.command-action-row').first.wait_for()
                        except Exception:
                            (output/'scale-diagnostic.txt').write_text(scale_page.locator('body').text_content(),encoding='utf-8')
                            raise
                        elapsed=time.perf_counter()-start
                        scale=scale_page.evaluate('''()=>({renderedProjects:document.querySelectorAll('.sidebar-project').length,totalIndexed:projectById.size,domNodes:document.querySelectorAll('*').length})''');scale.update(first_pending_seconds=round(elapsed,3),response_bytes=len(responses['/api/projects'][1]),transport='synthetic-loopback-http-not-candidate-server',actual_exe_3000_verified=False)
                        check('3000 project sidebar DOM is bounded',scale['renderedProjects']==100,scale)
                        check('all 3000 projects remain searchable',scale['totalIndexed']==3000,scale)
                        check('3000 project first pending is usable under three seconds',elapsed<3,scale)
                        scale_page.screenshot(path=str(output/'synthetic-3000.png'),animations='disabled')
                    finally:server.shutdown();server.server_close();worker.join(timeout=5)
                    check('no browser page errors',not page_errors,page_errors)
                finally:browser.close()
        except Exception as error:check('acceptance completed without exception',False,f'{type(error).__name__}: {error}')
        finally:client.stop()
    result=dict(candidate_sha256=sha,passed=sum(check['passed'] for check in checks),total=len(checks),checks=checks,scale=scale,browser=browser_metadata,page_errors=page_errors,synthetic_data_only=True,production_data_modified=False,native_desktop_verified=False,real_mail_messages_sent=0)
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return result


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',type=Path,required=True);parser.add_argument('--sha256',required=True)
    parser.add_argument('--license-fixtures',type=Path,required=True);parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--browser-executable')
    args=parser.parse_args();result=verify(args.candidate.resolve(),args.sha256.lower(),args.license_fixtures.resolve(),args.output.resolve(),args.browser_executable)
    print(json.dumps({key:result[key] for key in ['passed','total','scale','page_errors']},ensure_ascii=False))
    raise SystemExit(0 if result['passed']==result['total'] else 1)
