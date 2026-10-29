"""Exercise genuine signed expiry, invalid-signature blocking and renewal in a pinned public EXE."""
from __future__ import annotations

import argparse
from datetime import date, timedelta, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path[:0] = [str(ROOT), str(ROOT/'authorization')]


def verify(candidate, sha256, output, browser_executable=None):
    from tools.release_browser import require_windows_candidate, launch_browser
    output = Path(output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    checks = []
    states = []
    browser_info = {}
    page_errors = []
    started = datetime.now(timezone.utc).isoformat()

    def check(name, passed, detail=None):
        checks.append({'name':name, 'passed':bool(passed), 'detail':detail, 'classification':'required'})
        if not passed:
            raise AssertionError(name)

    try:
        actual = require_windows_candidate(Path(candidate), sha256)
        check('candidate is the exact pinned Windows EXE', actual == sha256.lower())
        import license_issuer as issuer
        from playwright.sync_api import sync_playwright
        from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
        with tempfile.TemporaryDirectory(prefix='pm-license-states-owned-') as directory:
            root = Path(directory)
            with patch.dict(os.environ, {'PROCUREMENT_ISSUER_HOME':str(root/'ephemeral-keys'),
                                         'PM_TEST_LICENSE_DIR':str(root/'empty-fixtures')}):
                client = PackagedClient(Path(candidate), root, '中文授权验收', unused_port())
                secret = 'Synthetic-acceptance-key-password'
                issuer.initialize_keys(secret, client.data_root)
                issuer.issue(target_dir=client.data_root, organization='Synthetic acceptance', expires=None, password=secret)
                valid = json.loads((client.data_root/'license.dat').read_text(encoding='utf-8'))
                fingerprint = issuer.machine_fingerprint()
                expired_payload = issuer.build_payload(organization='Synthetic expired acceptance',
                    machine_hash=fingerprint['machine_hash'], device_code=fingerprint['device_code'],
                    expires=date.today()-timedelta(days=1))
                expired = issuer.sign_payload(expired_payload, issuer.load_private_key(secret))
                # Valid base64, wrong signature: exercises cryptographic rejection, not malformed JSON.
                invalid = json.loads(json.dumps(valid))
                import base64
                signature = bytearray(base64.b64decode(invalid['signature']))
                signature[0] ^= 1
                invalid['signature'] = base64.b64encode(signature).decode('ascii')
                try:
                    client.start()
                    check('initial actual license mode is full', client.request('GET','/api/license/status')['mode']=='full')
                    project = client.request('POST','/api/projects', {'number':'SIM-LICENSE-STATES',
                        'name':'隔离授权状态验证', 'method':'公开招标', 'year':2026, 'budget':'100'})
                    pid = project['id']
                    path = f'/api/projects/{pid}'
                    with sync_playwright() as pw:
                        browser, browser_info = launch_browser(pw, browser_executable)
                        try:
                            context = browser.new_context(viewport={'width':1366,'height':900}, timezone_id='Asia/Shanghai')
                            context.add_cookies([{'name':c.name,'value':c.value,'url':client.base_url} for c in client.session.cookies])
                            page = context.new_page()
                            page.on('pageerror', lambda error:page_errors.append(str(error)))
                            page.goto(client.base_url, wait_until='domcontentloaded')
                            page.wait_for_function('document.querySelector(".command-metric") && typeof allProjects !== "undefined" && allProjects.length > 0')
                            for expected_mode, expected_status, document in [('read_only','expired',expired),('blocked','invalid_signature',invalid)]:
                                page.evaluate('async id=>{await selectProject(id);switchProjectTab("info");}', pid)
                                budget = 'preserved-'+expected_mode
                                page.locator('#infoBudget').fill(budget)
                                before = client.get_project(pid)
                                issuer.write_license(document, client.data_root)
                                status = client.request('GET','/api/license/status')
                                states.append({'mode':status.get('mode'),'status':status.get('status'),
                                    'fixture':'genuine signed expired license' if expected_mode=='read_only' else 'invalid cryptographic signature'})
                                check(expected_mode+' comes from the real EXE verifier', status.get('mode')==expected_mode and status.get('status')==expected_status)
                                check(expected_mode+' actual status can refresh the existing UI', page.evaluate('async()=>{const s=await refreshApplicationAccess();return s.mode;}')==expected_mode)
                                page.wait_for_function('document.getElementById("sidebarNewProjectBtn").disabled')
                                check(expected_mode+' persistent banner is visible', page.locator('#appAccessBanner').is_visible())
                                check(expected_mode+' create entry disabled', page.locator('#sidebarNewProjectBtn').is_disabled())
                                check(expected_mode+' actual save entry disabled', page.locator('#infoContent button[onclick="saveProjectInfo()"]').is_disabled())
                                check(expected_mode+' unsaved draft retained', page.locator('#infoBudget').input_value()==budget)
                                requests = []
                                def capture(request):
                                    if request.method not in ('GET','HEAD','OPTIONS'):
                                        requests.append(request.method)
                                page.on('request',capture)
                                rejection = page.evaluate('''async pid=>{try{await api('PUT','/api/projects/'+pid,{name:'forbidden'});return null;}catch(e){return {status:e.status,message:e.message};}}''',pid)
                                page.remove_listener('request',capture)
                                check(expected_mode+' direct frontend write is blocked before transport', rejection and rejection.get('status')==423 and not requests)
                                stage = before['stages'][0]
                                from urllib.parse import quote
                                for endpoint, payload in [(path,{'name':'forbidden','record_version':before['record_version']}),
                                    (path+'/stages/'+quote(stage['key'],safe=''),{'notes':'forbidden','record_version':stage['record_version']})]:
                                    response = client.session.put(client.base_url+endpoint,json=payload,
                                        headers={'X-CSRFToken':client.csrf_token},timeout=15)
                                    check(expected_mode+' server rejects '+('project' if endpoint==path else 'stage')+' writes', response.status_code==423, {'http':response.status_code})
                                response = client.session.post(client.base_url+'/api/projects',json={'number':'FORBIDDEN','name':'forbidden'},headers={'X-CSRFToken':client.csrf_token},timeout=15)
                                check(expected_mode+' server rejects creation', response.status_code==423)
                                page.screenshot(path=str(output/(expected_mode+'.png')), full_page=True)
                                fresh = context.new_page()
                                fresh.goto(client.base_url,wait_until='domcontentloaded')
                                if expected_mode=='read_only':
                                    fresh.wait_for_selector('#appAccessBanner')
                                    check('expired initial page also disables create', fresh.locator('#sidebarNewProjectBtn').is_disabled())
                                else:
                                    check('blocked initial navigation cannot expose a usable editor', fresh.locator('#sidebarNewProjectBtn').count()==0 or not fresh.locator('#sidebarNewProjectBtn').is_visible() or fresh.locator('#sidebarNewProjectBtn').is_disabled(), {'path':fresh.url.split(client.base_url)[-1]})
                                fresh.close()
                                issuer.write_license(valid,client.data_root)
                                check(expected_mode+' valid renewal is accepted by real server', client.request('GET','/api/license/status')['mode']=='full')
                                after = client.get_project(pid)
                                check(expected_mode+' denied writes left persisted facts unchanged', after['name']==before['name'] and after['budget']==before['budget'] and after['stages'][0]['notes']==stage['notes'])
                                check(expected_mode+' renewal refresh restores existing UI', page.evaluate('async()=>{const s=await refreshApplicationAccess();return s.mode;}')=='full')
                                check(expected_mode+' banner removed and save restored', page.locator('#appAccessBanner').count()==0 and not page.locator('#infoContent button[onclick="saveProjectInfo()"]').is_disabled())
                                with page.expect_response(lambda r:r.request.method=='PUT' and r.url==client.base_url+path) as saved:
                                    page.locator('#infoContent button[onclick="saveProjectInfo()"]').click()
                                check(expected_mode+' preserved draft saves after renewal', saved.value.status==200 and client.get_project(pid)['budget']==budget)
                            check('no unhandled browser script errors', not page_errors, page_errors)
                        finally:
                            browser.close()
                finally:
                    client.stop()
    except Exception as error:
        checks.append({'name':'required license-state acceptance completed','passed':False,
                       'detail':f'{type(error).__name__}: {error}', 'classification':'required'})
    passed = sum(item['passed'] for item in checks)
    result = {'status':'passed' if checks and passed==len(checks) else 'failed',
        'automation_passed':bool(checks) and passed==len(checks), 'passed':passed, 'total':len(checks),
        'checks':checks, 'states':states, 'candidate_sha256':sha256.lower(),
        'started_at':started,'finished_at':datetime.now(timezone.utc).isoformat(),
        'environment':{'python':sys.version,'platform':platform.platform(),'browser':browser_info},
        'page_errors':page_errors,'native_desktop_verified':False,'production_data_modified':False,
        'license_fixture_method':'ephemeral test-owned signing key, no clock changes or mocked license status',
        'real_mail_messages_sent':0}
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',type=Path,required=True)
    parser.add_argument('--sha256',required=True)
    parser.add_argument('--output',type=Path,required=True)
    parser.add_argument('--browser-executable')
    args = parser.parse_args()
    result = verify(args.candidate.resolve(),args.sha256,args.output,args.browser_executable)
    print(json.dumps({'status':result['status'],'passed':result['passed'],'total':result['total']},ensure_ascii=False))
    raise SystemExit(0 if result['automation_passed'] else 1)
