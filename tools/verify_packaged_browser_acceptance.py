"""Windows, hash-pinned EXE browser acceptance; owns all data, keys and processes.

Fault injection executes the candidate's served JavaScript. It is labelled separately
from real candidate writes and the 3000-row candidate database performance gate.
No private license fixture is needed and no generated key is retained in evidence.
"""
from __future__ import annotations

import argparse
from contextlib import contextmanager
from datetime import datetime, timedelta
from email.parser import BytesParser
from email.policy import default as email_policy
import hashlib
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import threading
import time
from unittest.mock import patch

import psutil
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'authorization'))
import license_issuer
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from tools.release_browser import launch_browser, require_windows_candidate

RELEASE_SOURCE = '00a1f6c6b6d2282ea5ef37d51255ca092f93b52b'
LEGACY52 = {'version': 'v5.8.52-public', 'exe_sha256': 'abfc4748dbd9a5d7c598837f4c5ba61c049c3115933cc8c5d9ebd16006f6d946',
    'source_commit': 'b48d6e1a3bdeb0cb278c16866fdf485b17d3f25a',
    'source_functions': 'source/frontend/04-project-workflow.js:saveProjectInfo/saveStageFromSlide',
    'scope': 'Replay of these two v5.8.52 public protocol request shapes only; not full old-UI acceptance or a claim about all historical clients. Missing record_version permits overwrite.'}


def legacy52_payloads(project):
    project_fields = ('number', 'name', 'purchaser', 'prepare_owner', 'review_owner', 'budget', 'year', 'notes', 'no_deposit')
    project_payload = {name: project.get(name, False if name == 'no_deposit' else '') for name in project_fields}
    method_id = project.get('procurement_method_id')
    project_payload.update({'procurement_method_id': method_id} if method_id else {'method': project['method']})
    # The v52 select is rendered only for a closed project. JSON.stringify omits
    # the undefined property in this ordinary open-project replay.
    if project.get('is_terminated'):
        project_payload['second_tender_id'] = project.get('second_tender_id') or 0
    stage = project['stages'][0]
    stage_payload = {'completed': False, 'planned_at': stage.get('planned_at'), 'skipped': False,
                     'notes': stage.get('notes', ''), 'completed_date': None, 'completed_at': None}
    return project_payload, stage_payload


def validated_profile(path):
    if path is None:
        return None
    path = Path(path).resolve()
    base = (ROOT / '.codex/module-state/browser-profiling').resolve()
    if not path.is_relative_to(base) or path == base:
        raise ValueError('--keep-data must name a dedicated profile below ' + str(base))
    marker = path / 'owned-profile.json'
    if path.exists() and any(path.iterdir()):
        if not marker.is_file() or json.loads(marker.read_text('utf-8')).get('owner') != 'verify_packaged_browser_acceptance':
            raise ValueError('Refusing to reuse an unmarked data directory')
    path.mkdir(parents=True, exist_ok=True)
    marker.write_text(json.dumps({'owner': 'verify_packaged_browser_acceptance', 'synthetic_data_only': True}), encoding='utf-8')
    return path


def measure_http(client, endpoint, browser_executable):
    """Real authenticated EXE HTTP, including full response drain; no route mocks."""
    measurements = {'endpoint': endpoint, 'transport': 'actual-candidate-exe-http', 'memory_before': memory_snapshot(client, browser_executable)}
    peak = {'exe_rss_bytes': 0, 'browser_rss_bytes': 0}
    stop = threading.Event()
    def sample():
        while not stop.wait(0.25):
            snapshot = memory_snapshot(client, browser_executable)
            for name in ('exe', 'browser'):
                peak[name + '_rss_bytes'] = max(peak[name + '_rss_bytes'], snapshot[name]['rss_bytes'])
    worker = threading.Thread(target=sample, daemon=True)
    worker.start()
    start = time.perf_counter()
    try:
        with client.session.get(client.base_url + endpoint, stream=True, timeout=(10, 600)) as response:
            measurements.update(status=response.status_code, headers_seconds=round(time.perf_counter() - start, 3),
                content_type=response.headers.get('Content-Type'), content_length=response.headers.get('Content-Length'))
            chunks = []
            for chunk in response.iter_content(1024 * 1024):
                chunks.append(chunk)
            body = b''.join(chunks)
            measurements.update(elapsed_seconds=round(time.perf_counter() - start, 3), response_bytes=len(body), response_sha256=hashlib.sha256(body).hexdigest())
            if not response.ok:
                measurements.update(error=f'HTTP {response.status_code}', error_body_preview=body[:1000].decode('utf-8', errors='replace'))
                return measurements, None
            value = json.loads(body)
            measurements['project_count'] = len(value) if isinstance(value, list) else value.get('total')
            return measurements, body
    except Exception as error:
        measurements.update(elapsed_seconds=round(time.perf_counter() - start, 3), error=f'{type(error).__name__}: {error}')
        return measurements, None
    finally:
        stop.set()
        worker.join(timeout=2)
        measurements['memory_peak_samples'] = peak
        measurements['memory_after'] = memory_snapshot(client, browser_executable)


def totals(checks):
    return {'passed': sum(row['passed'] for row in checks), 'total': len(checks),
            'failed': [row['name'] for row in checks if not row['passed']],
            'status': 'passed' if checks and all(row['passed'] for row in checks) else 'failed'}


def memory_snapshot(client, browser_executable):
    """Only this verifier's descendants; never inspect or stop a user's browser."""
    exe = client.executable.resolve()
    browser = Path(browser_executable).resolve()
    groups = {'exe': [], 'browser': []}
    for process in psutil.Process().children(recursive=True):
        try:
            path = Path(process.exe()).resolve()
            group = 'exe' if path == exe else 'browser' if path == browser else None
            if group:
                info = process.memory_info()
                groups[group].append({'pid': process.pid, 'rss_bytes': info.rss, 'vms_bytes': info.vms})
        except (psutil.Error, OSError):
            continue
    return {name: {'processes': rows, 'rss_bytes': sum(r['rss_bytes'] for r in rows),
                   'vms_bytes': sum(r['vms_bytes'] for r in rows)} for name, rows in groups.items()}


def seed_scale(client, count=3000):
    """The candidate EXE parses/imports the workbook and persists every project."""
    from openpyxl import Workbook
    workbook = Workbook()
    sheet = workbook.active
    sheet.title = '项目'
    sheet.append(['项目编号', '项目名称', '采购方式', '年度', '备注'])
    for number in range(1, count + 1):
        sheet.append([f'SCALE-{number:05d}', f'真实EXE合成项目{number:04d}', '公开招标', 2026, '仅隔离验收生成'])
    stream = io.BytesIO()
    workbook.save(stream)
    started = time.perf_counter()
    response = client.session.post(client.base_url + '/api/import/projects',
        files={'file': ('synthetic-projects.xlsx', stream.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},
        headers={'X-CSRFToken': client.csrf_token}, timeout=240)
    response.raise_for_status()
    result = response.json()
    if result.get('success') != count or result.get('failed'):
        raise AssertionError(f'Candidate import did not persist {count} rows: {result}')
    preparation = {}
    try:
        project = client.get_project(1)
        stage = project['stages'][0]
        client.request('PUT', '/api/projects/1/stages/' + requests.utils.quote(stage['key'], safe=''),
                       {'planned_at': (datetime.now() + timedelta(days=1)).isoformat(timespec='minutes'), 'record_version': stage['record_version']})
        preparation['planned_pending_created'] = True
    except Exception as error:
        preparation.update(planned_pending_created=False, error=f'{type(error).__name__}: {error}')
    return {'transport': 'candidate-exe-import-and-database', 'rows': count, 'pending_preparation': preparation,
            'workbook_bytes': len(stream.getvalue()), 'import_seconds': round(time.perf_counter() - started, 3), 'result': result}


@contextmanager
def owned_client(candidate, root, label, fixtures=None, retained_profile=None):
    # A fresh public verification identity is safer and reproducible on any Windows
    # runner. --license-fixtures is retained for CLI compatibility but never reads
    # original deployment keys or production data.
    with patch.dict(os.environ, {'PM_TEST_LICENSE_DIR': str(root / 'empty-fixtures'),
                                  'PROCUREMENT_ISSUER_HOME': str(root / ('issuer-' + label))}):
        client = PackagedClient(candidate, root, label, unused_port())
        retained_data = retained_profile / 'data' if retained_profile else None
        if retained_data and retained_data.is_dir():
            shutil.copytree(retained_data, client.data_root, dirs_exist_ok=True)
        else:
            license_issuer.initialize_keys('synthetic-acceptance-password', client.data_root)
            license_issuer.issue(target_dir=client.data_root, organization='合成浏览器验收', expires=None,
                                 password='synthetic-acceptance-password')
        settings_path = client.data_root / 'app_settings.json'
        settings = json.loads(settings_path.read_text('utf-8')) if settings_path.is_file() else {}
        settings.update(backup_folder=str(client.data_root / 'owned-backups'),
                        export_folder=str(client.data_root / 'owned-exports'),
                        backup_time='23:59', last_backup_date=datetime.now().date().isoformat(),
                        reminder_enabled=False, reminder_recipient_groups=[],
                        event_reminder_create_enabled=False, event_reminder_complete_enabled=False,
                        supplier_shortage_email_enabled=False)
        settings_path.write_text(json.dumps(settings, ensure_ascii=False, indent=2), encoding='utf-8')
        try:
            yield client
        finally:
            client.stop()
            if retained_data:
                shutil.copytree(client.data_root, retained_data, dirs_exist_ok=True)
                if (client.root / 'startup.log').is_file():
                    shutil.copy2(client.root / 'startup.log', retained_profile / 'startup.log')


def verify(candidate, sha256, output, browser_executable=None, license_fixtures=None, suite="all", keep_data=None, source_commit=RELEASE_SOURCE, expected_version='v5.8.53'):
    from playwright.sync_api import sync_playwright
    require_windows_candidate(candidate, sha256)
    profile = validated_profile(keep_data)
    output.mkdir(parents=True, exist_ok=False)
    checks, trace, page_errors = [], [], []
    result = {'candidate_sha256': sha256, 'release_source_commit': source_commit, 'suite': suite, 'expected_version': expected_version,
              'platform': sys.platform, 'scope': 'Windows headless browser against isolated candidate EXE',
              'synthetic_data_only': True, 'production_data_modified': False,
              'native_desktop_verified': False, 'real_mail_messages_sent': 0,
              'private_license_fixtures_used': False, 'checks': checks, 'request_trace': trace,
              'page_errors': page_errors, 'performance': {},
              'legacy_client_boundary': LEGACY52, 'retained_synthetic_profile': str(profile) if profile else None}

    def check(name, passed, detail=None):
        row = {'name': name, 'passed': bool(passed), 'detail': detail}
        checks.append(row)
        print(json.dumps(row, ensure_ascii=False), flush=True)
        checkpoint = {**result, **totals(checks), 'completed': False}
        (output / 'result.json').write_text(json.dumps(checkpoint, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')

    def scenario(name, function):
        try:
            function()
        except Exception as error:
            check(name + ': completed without exception', False, f'{type(error).__name__}: {error}')

    try:
        with tempfile.TemporaryDirectory(prefix='pm-browser-acceptance-owned-') as directory, sync_playwright() as pw:
            root = Path(directory)
            browser, metadata = launch_browser(pw, browser_executable)
            result['browser'] = metadata
            try:
                if suite in ('all', 'functional'):
                    with owned_client(candidate, root, 'functional', license_fixtures) as client:
                        start = time.perf_counter()
                        client.start()
                        health = client.request('GET', '/health')
                        info = client.request('GET', '/api/system-info')
                        check('candidate health and system-info report expected version', all(str(item.get('version', '')).removeprefix('v') == expected_version.removeprefix('v') for item in (health, info)), {'health_version': health.get('version'), 'system_info_version': info.get('version'), 'expected': expected_version})
                        result['functional_startup_seconds'] = round(time.perf_counter() - start, 3)
                        client.patch_settings({'reminder_enabled': False, 'reminder_recipient_groups': [],
                            'event_reminder_create_enabled': False, 'event_reminder_complete_enabled': False,
                            'supplier_shortage_email_enabled': False})
                        first = client.request('POST', '/api/projects', {'number': 'BROWSER-001', 'name': '隔离项目一', 'method': '公开招标', 'year': 2026})
                        second = client.request('POST', '/api/projects', {'number': 'BROWSER-002', 'name': '隔离项目二', 'method': '公开招标', 'year': 2026})
                        pid, other_id = first['id'], second['id']
                        context = browser.new_context(viewport={'width': 1366, 'height': 900}, timezone_id='Asia/Shanghai', reduced_motion='reduce')
                        context.add_cookies([{'name': c.name, 'value': c.value, 'url': client.base_url} for c in client.session.cookies])

                        def new_page(label):
                            page = context.new_page()
                            page.on('pageerror', lambda error: page_errors.append({'page': label, 'error': str(error)}))
                            page.on('response', lambda response: trace.append({'page': label, 'method': response.request.method,
                                'path': response.url.removeprefix(client.base_url), 'status': response.status}) if '/api/' in response.url else None)
                            page.goto(client.base_url, wait_until='networkidle')
                            page.locator('.command-metric').first.wait_for()
                            page.wait_for_function('projectById.size === 2 && typeof selectProject === "function"')
                            page.evaluate('async id => {await selectProject(id); switchProjectTab("info");}', pid)
                            return page

                        a, b = new_page('window-a'), new_page('window-b')

                        def two_windows():
                            a.locator('#infoName').fill('窗口A已保存名称')
                            a.evaluate('saveProjectInfo()')
                            b.locator('#infoName').fill('窗口B未保存草稿')
                            begin = len(trace)
                            b.evaluate('saveProjectInfo()')
                            check('real EXE two-window project stale write is HTTP 409', any(row['status'] == 409 for row in trace[begin:]))
                            check('project conflict preserves visible draft', b.locator('#infoName').input_value() == '窗口B未保存草稿')
                            check('project database retains window A accepted value', client.get_project(pid)['name'] == '窗口A已保存名称')
                            # Reload both editors onto the same persisted stage version.
                            for page in (a, b):
                                page.evaluate('async id => {currentProject=storeProjectDetail(await api("GET","/api/projects/"+id));openStageSlide(currentProject.stages[0].key);}', pid)
                                page.locator('.stage-optional-notes > summary').click()
                            a.locator('#stageNotes').fill('窗口A已保存阶段')
                            a.evaluate('saveStageFromSlide()')
                            b.locator('#stageNotes').fill('窗口B阶段草稿')
                            begin = len(trace)
                            saved = b.evaluate('saveStageFromSlide()')
                            check('real EXE two-window stage stale write is HTTP 409', saved is False and any(row['status'] == 409 for row in trace[begin:]))
                            check('stage conflict preserves notes draft and error', b.locator('#stageNotes').input_value() == '窗口B阶段草稿' and b.locator('#stageSaveError').count() == 1)
                            check('stage database retains window A accepted value', client.get_project(pid)['stages'][0]['notes'] == '窗口A已保存阶段')
                            b.screenshot(path=str(output / 'two-window-conflict.png'), animations='disabled')
                            # Explicitly characterize the old-client compatibility gap.
                            path = f'/api/projects/{pid}'
                            legacy_project, legacy_stage = legacy52_payloads(client.get_project(pid))
                            legacy_project['name'] = 'v5.8.52形状项目覆盖'
                            legacy = client.request('PUT', path, legacy_project)
                            stage_key = requests.utils.quote(legacy['stages'][0]['key'], safe='')
                            legacy_stage['notes'] = 'v5.8.52形状阶段覆盖'
                            client.request('PUT', path + '/stages/' + stage_key, legacy_stage)
                            latest = client.get_project(pid)
                            check('v5.8.52 public tokenless project and stage protocol replay accepted', latest['name'] == 'v5.8.52形状项目覆盖' and latest['stages'][0]['notes'] == 'v5.8.52形状阶段覆盖', {**LEGACY52, 'project_payload': legacy_project, 'stage_payload': legacy_stage})

                        scenario('two windows and legacy boundary', two_windows)

                        def csrf_and_timeouts():
                            # An invalid real token must be rejected before the candidate
                            # mutation, then refreshed once using the actual CSRF endpoint.
                            before = len(trace)
                            actual = a.evaluate('''async id=>{window.CSRF_TOKEN='invalid-synthetic-csrf';try {await api('PUT','/api/projects/'+id,{notes:'real CSRF retry accepted'});return {ok:true};}catch(e){return {error:e.message,status:e.status};}}''', other_id)
                            requests_seen = trace[before:]
                            writes = [row for row in requests_seen if row['method'] == 'PUT' and row['path'] == f'/api/projects/{other_id}']
                            check('real candidate rejects stale JSON CSRF then accepts exactly one refreshed replay', actual.get('ok') and len(writes) == 2 and writes[0]['status'] in (400, 403) and writes[1]['status'] == 200 and len([row for row in requests_seen if row['path'] == '/api/csrf-refresh']) == 1, requests_seen)
                            get_refresh = client.session.get(client.base_url + '/api/csrf-refresh', timeout=10)
                            post_refresh = client.session.post(client.base_url + '/api/csrf-refresh', headers={'X-CSRFToken': 'invalid-synthetic-csrf'}, timeout=10)
                            try:
                                post_payload = post_refresh.json()
                            except ValueError:
                                post_payload = {}
                            result['real_csrf_refresh_probe'] = {
                                'get': {'status': get_refresh.status_code, 'allow': get_refresh.headers.get('Allow'), 'content_type': get_refresh.headers.get('Content-Type'), 'body': get_refresh.text[:1000]},
                                'post_with_invalid_token': {'status': post_refresh.status_code, 'returns_csrf_token': bool(post_payload.get('csrf_token'))}}
                            if post_refresh.ok and post_payload.get('csrf_token'):
                                client.csrf_token = post_payload['csrf_token']
                                context.add_cookies([{'name': c.name, 'value': c.value, 'url': client.base_url} for c in client.session.cookies])
                            check('real candidate POST refresh permits recovery from invalid token', post_refresh.ok and bool(post_payload.get('csrf_token')), result['real_csrf_refresh_probe'])
                            # Intercept fetch only for dedicated non-business fault URLs.
                            # Candidate api/apiForm/localFetch functions remain untouched.
                            facts = a.evaluate('''async () => {
                                const originalFetch=window.fetch, originalTimer=window.setTimeout;
                                const counts={}, cases={}; let refreshes=0,shorten=false;
                                window.fetch=async (url,options={})=>{
                                    const key=String(url); if(!key.includes('/api/acceptance-fault/')) {
                                        if(key.includes('/api/csrf-refresh')) refreshes++;
                                        return originalFetch(url,options);
                                    }
                                    counts[key]=(counts[key]||0)+1;
                                    if(key.endsWith('/hang-fetch')) return new Promise(()=>{});
                                    if(key.endsWith('/hang-json')||key.endsWith('/hang-form')) return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:()=>new Promise(()=>{})};
                                    const ordinary=key.endsWith('forbidden'), forever=key.endsWith('csrf-always');
                                    const denied=ordinary||forever||counts[key]===1;
                                    return new Response(JSON.stringify(denied?{error:ordinary?'Permission denied':'CSRF expired',code:ordinary?'FORBIDDEN':'CSRF_EXPIRED'}:{ok:true}),{status:denied?403:200,headers:{'content-type':'application/json'}});
                                };
                                window.setTimeout=(fn,delay,...args)=>originalTimer(fn,shorten&&[20000,900000].includes(delay)?120:delay,...args);
                                const run=async(name,form=false)=>{shorten=name.startsWith('hang-');const key='/api/acceptance-fault/'+name;const before=refreshes;const start=performance.now();try{const value=form?await apiForm(key,new FormData()):await api('POST',key,{x:1});cases[name]={ok:!!value.ok};}catch(e){cases[name]={status:e.status,error_code:e.error_code,message:e.message};}Object.assign(cases[name],{attempts:counts[key],refreshes:refreshes-before,seconds:(performance.now()-start)/1000});};
                                try{await run('csrf');await run('csrf-always');await run('forbidden');await run('form-csrf',true);await run('form-csrf-always',true);await run('form-forbidden',true);await run('hang-fetch');await run('hang-json');await run('hang-form',true);return cases;}
                                finally{window.fetch=originalFetch;window.setTimeout=originalTimer;}
                            }''')
                            # Refresh probes rotate the signed session cookie. Reset
                            # the test context through native POST, then copy both
                            # cookie and token together for the later real-file cases.
                            reset = a.evaluate('''async()=>{const response=await fetch('/api/csrf-refresh',{method:'POST'});const data=await response.json();window.CSRF_TOKEN=data.csrf_token;return {status:response.status,token:data.csrf_token};}''')
                            if reset['status'] != 200 or not reset.get('token'):
                                raise AssertionError('Could not reset isolated fixture CSRF session after probes')
                            client.csrf_token = reset['token']
                            client.session.cookies.clear()
                            for cookie in context.cookies(client.base_url):
                                client.session.cookies.set(cookie['name'], cookie['value'])
                            result['network_fault_injection'] = {'scope': 'candidate JavaScript, injected fetch/JSON-body stalls, network deadline accelerated to 120ms', 'cases': facts}
                            check('CSRF refresh permits one JSON replay only', facts['csrf'].get('ok') and facts['csrf']['attempts'] == 2 and facts['csrf']['refreshes'] == 1, facts['csrf'])
                            check('repeated CSRF rejection stops after one refresh', facts['csrf-always']['status'] == 403 and facts['csrf-always']['attempts'] == 2 and facts['csrf-always']['refreshes'] == 1, facts['csrf-always'])
                            check('ordinary HTTP403 is never retried', facts['forbidden']['status'] == 403 and facts['forbidden']['attempts'] == 1 and facts['forbidden']['refreshes'] == 0, facts['forbidden'])
                            check('multipart CSRF refresh permits one replay only', facts['form-csrf'].get('ok') and facts['form-csrf']['attempts'] == 2 and facts['form-csrf']['refreshes'] == 1, facts['form-csrf'])
                            check('multipart repeated CSRF rejection stops after one refresh', facts['form-csrf-always'].get('status') == 403 and facts['form-csrf-always']['attempts'] == 2 and facts['form-csrf-always']['refreshes'] == 1, facts['form-csrf-always'])
                            check('multipart ordinary HTTP403 is never retried', facts['form-forbidden'].get('status') == 403 and facts['form-forbidden']['attempts'] == 1 and facts['form-forbidden']['refreshes'] == 0, facts['form-forbidden'])
                            for key in ('hang-fetch', 'hang-json', 'hang-form'):
                                check(key + ' times out without blind write replay', facts[key]['error_code'] == 'REQUEST_TIMEOUT' and facts[key]['attempts'] == 1 and facts[key]['seconds'] < 2, facts[key])

                        scenario('CSRF and suspended response bodies', csrf_and_timeouts)

                        def saved_response_stall():
                            before = len(trace)
                            uncertain = a.evaluate('''async id=>{
                                const originalFetch=window.fetch, originalTimer=window.setTimeout;let attempts=0,accepted=false;
                                const url='/api/projects/'+id;
                                window.fetch=async(input,options={})=>{const response=await originalFetch(input,options);if(String(input)===url&&options.method==='PUT'){attempts++;accepted=response.ok;await response.clone().json();return {ok:response.ok,status:response.status,headers:response.headers,json:()=>new Promise(()=>{})};}return response;};
                                window.setTimeout=(fn,delay,...args)=>originalTimer(fn,delay===20000?3000:delay,...args);
                                try{await api('PUT',url,{notes:'saved-before-response-stall'});return {attempts,accepted,unexpectedSuccess:true};}catch(e){return {attempts,accepted,error_code:e.error_code};}finally{window.fetch=originalFetch;window.setTimeout=originalTimer;}
                            }''', other_id)
                            persisted = client.get_project(other_id)
                            check('saved write with stalled response body times out without replay', uncertain.get('accepted') and uncertain.get('attempts') == 1 and uncertain.get('error_code') == 'REQUEST_TIMEOUT' and persisted['notes'] == 'saved-before-response-stall', {'scope': 'real candidate PUT accepted, injected JSON-body stall', **uncertain})
                            recovery_start = len(trace)
                            a.evaluate('id=>api("GET","/api/projects/"+id)', other_id)
                            check('uncertain saved write recovers through GET verification only', bool(trace[recovery_start:]) and all(row['method'] == 'GET' for row in trace[recovery_start:]), trace[before:])

                        scenario('accepted write response stall', saved_response_stall)

                        def recovery():
                            a.evaluate('closeSlide(); switchProjectTab("info")')
                            a.locator('#infoName').fill('初始化与列表恢复草稿')
                            baseline = a.locator('#projectList').inner_text()
                            a.route('**/api/projects', lambda route: route.fulfill(status=200, content_type='text/html', body='<html>login</html>'), times=1)
                            error = a.evaluate('async()=>{try{await loadAllProjects();return "";}catch(e){return e.message;}}')
                            check('failed list refresh retains sidebar and draft', '登录' in error and a.locator('#projectList').inner_text() == baseline and a.locator('#infoName').input_value() == '初始化与列表恢复草稿')
                            a.route('**/api/projects', lambda route: route.fulfill(status=503, json={'error': 'synthetic initialization outage'}), times=1)
                            a.evaluate('init()')
                            check('initialization failure presents retry and preserves old data', a.locator('#appInitError').count() == 1 and a.locator('#projectList').inner_text() == baseline and a.locator('#infoName').input_value() == '初始化与列表恢复草稿')
                            a.evaluate('init()')
                            check('initialization retry recovers without erasing draft', a.locator('#appInitError').count() == 0 and a.locator('#infoName').input_value() == '初始化与列表恢复草稿')

                        scenario('initialization and list recovery', recovery)

                        def attachments():
                            # Candidate preflight validates the entire request before writing.
                            # First characterize this real atomic rejection. Then save one
                            # actual file through the EXE and inject a labelled partial
                            # success response to exercise the otherwise rare writer failure.
                            file_ok = root / 'accepted.pdf'
                            file_ok.write_bytes(b'%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF\n')
                            file_bad = root / 'rejected.exe'
                            file_bad.write_bytes(b'synthetic-disallowed-file')
                            a.evaluate('async id=>{closeSlide();currentProject=storeProjectDetail(await api("GET","/api/projects/"+id));showRegistrationForm();}', pid)
                            a.locator('#regCompany').fill('真实附件重试报名')
                            # File chooser accepts programmatic files beyond accept=, as
                            # a user can choose all files; validation must remain server-side.
                            a.locator('#regFiles').set_input_files([str(file_ok), str(file_bad)])
                            begin = len(trace)
                            a.locator('#modalSaveBtn').click()
                            a.locator('#registrationUploadState').wait_for()
                            first_state = a.locator('#registrationUploadState').inner_text()
                            rows = client.get_project(pid)['registrations']
                            record = next(row for row in rows if row['company_name'] == '真实附件重试报名')
                            check('real mixed-validity upload is atomically rejected and keeps saved registration', len(rows) == 1 and len(record.get('attachments', [])) == 0, {'state': first_state, 'registration_id': record['id'], 'attachments': [x['filename'] for x in record.get('attachments', [])]})
                            a.locator('#modalSaveBtn').click()
                            a.wait_for_timeout(450)
                            rows = client.get_project(pid)['registrations']
                            writes = [row for row in trace[begin:] if row['method'] == 'POST' and row['path'] == f'/api/projects/{pid}/registrations']
                            check('rejected upload retry reuses persisted record', len(writes) == 1 and len(rows) == 1 and len(rows[0].get('attachments', [])) == 0, {'registration_posts': len(writes), 'uploads': [row for row in trace[begin:] if '/attachments' in row['path']]})
                            # Replace the failed file with a real PDF and interrupt only
                            # the post-save GET. Recovery is GET-only and cannot resubmit.
                            second_pdf = root / 'replacement.pdf'
                            second_pdf.write_bytes(file_ok.read_bytes())
                            a.locator('#regFiles').set_input_files([str(file_ok), str(second_pdf)])
                            adapter_facts = {'scope': 'labelled partial-success response injection after real candidate file persistence', 'real_successful_file': file_ok.name, 'injected_failed_file': second_pdf.name}

                            def partial_response(route):
                                content_type = route.request.headers['content-type']
                                message = BytesParser(policy=email_policy).parsebytes(('Content-Type: ' + content_type + '\r\n\r\n').encode() + route.request.post_data_buffer)
                                fields = {part.get_param('name', header='content-disposition'): part.get_payload(decode=True).decode() for part in message.iter_parts() if not part.get_filename()}
                                response = client.session.post(client.base_url + f'/api/projects/{pid}/attachments',
                                    data=fields, files={'files': (file_ok.name, file_ok.read_bytes(), 'application/pdf')},
                                    headers={'X-CSRFToken': client.csrf_token}, timeout=15)
                                response.raise_for_status()
                                payload = response.json()
                                payload['errors'] = [{'filename': second_pdf.name, 'error': 'synthetic single-file writer rejection'}]
                                adapter_facts['actual_candidate_status'] = response.status_code
                                route.fulfill(status=200, json=payload)

                            a.route(f'**/api/projects/{pid}/attachments', partial_response, times=1)
                            a.locator('#modalSaveBtn').click()
                            a.wait_for_timeout(350)
                            rows = client.get_project(pid)['registrations']
                            check('labelled partial response follows real file persistence and preserves failed-file draft', len(rows[0].get('attachments', [])) == 1 and second_pdf.name in a.locator('#registrationUploadState').inner_text(), adapter_facts)
                            result['attachment_partial_response_injection'] = adapter_facts
                            a.route(f'**/api/projects/{pid}', lambda route: route.fulfill(status=503, json={'error': 'synthetic post-save read outage'}) if route.request.method == 'GET' else route.continue_(), times=1)
                            a.locator('#modalSaveBtn').click()
                            a.wait_for_function('!document.getElementById("registrationForm")')
                            rows = client.get_project(pid)['registrations']
                            check('successful save with refresh failure retains both attachments', len(rows) == 1 and len(rows[0].get('attachments', [])) == 2)
                            check('partial success retry sends only failed file and preserves registration identity', len([row for row in trace[begin:] if row['method'] == 'POST' and row['path'] == f'/api/projects/{pid}/registrations']) == 1 and sorted(x['filename'] for x in rows[0].get('attachments', [])) == sorted([file_ok.name, second_pdf.name]))
                            before = len(trace)
                            a.evaluate('refreshProject()')
                            check('saved registration refresh recovery issues only GET', all(row['method'] == 'GET' for row in trace[before:]), trace[before:])
                            # Delay an actual upload, navigate to a second project, then
                            # let the original request reach the candidate server.
                            a.evaluate('showRegistrationForm()')
                            a.locator('#regCompany').fill('切换项目期间报名')
                            a.locator('#regFiles').set_input_files(str(file_ok))
                            held = []
                            a.route(f'**/api/projects/{pid}/attachments', lambda route: held.append(route), times=1)
                            a.locator('#modalSaveBtn').click()
                            deadline = time.monotonic() + 10
                            while not held and time.monotonic() < deadline:
                                a.wait_for_timeout(30)
                            if not held:
                                raise AssertionError('upload request did not reach interception')
                            a.evaluate('async id=>{closeModal();await selectProject(id);}', other_id)
                            held[0].continue_()
                            a.wait_for_timeout(700)
                            original = client.get_project(pid)
                            target = client.get_project(other_id)
                            record = next(row for row in original['registrations'] if row['company_name'] == '切换项目期间报名')
                            check('in-flight registration upload belongs to original project after navigation', len(record.get('attachments', [])) == 1 and not target['registrations'] and a.evaluate('currentProject.id') == other_id)
                            a.screenshot(path=str(output / 'attachment-recovery.png'), animations='disabled')

                        scenario('real registration files and navigation', attachments)
                        context.close()

                def scale():
                    with owned_client(candidate, root, 'scale', license_fixtures, profile) as client:
                        client.start()
                        versions = [client.request('GET', '/health').get('version'), client.request('GET', '/api/system-info').get('version')]
                        check('scale candidate reports expected version', all(str(version).removeprefix('v') == expected_version.removeprefix('v') for version in versions), versions)
                        perf = result['performance']
                        seed_file = profile / 'scale-seed.json' if profile else None
                        if seed_file and seed_file.is_file():
                            perf['seed'] = json.loads(seed_file.read_text('utf-8'))
                            perf['seed_reused'] = True
                        elif profile and (profile / 'data/bidding.db').is_file():
                            existing_stats = client.request('GET', '/api/stats')
                            if existing_stats.get('total') != 3000:
                                raise AssertionError('Retained profile is not a completed 3000-project fixture: ' + str(existing_stats.get('total')))
                            perf['seed'] = {'transport': 'retained-candidate-database-confirmed-by-actual-stats', 'rows': 3000, 'result': {'success': 3000, 'failed': 0}}
                            perf['seed_reused'] = True
                            seed_file.write_text(json.dumps(perf['seed'], ensure_ascii=False, indent=2), encoding='utf-8')
                        else:
                            perf['seed'] = seed_scale(client)
                            perf['seed_reused'] = False
                            if seed_file:
                                seed_file.write_text(json.dumps(perf['seed'], ensure_ascii=False, indent=2), encoding='utf-8')
                        check('candidate EXE import persisted exactly 3000 synthetic projects', perf['seed']['result']['success'] == 3000, perf['seed'])
                        client.stop()
                        started = time.perf_counter()
                        client.start()
                        perf['cold_exe_ready_seconds'] = round(time.perf_counter() - started, 3)
                        milestones_script = """window.__acceptanceMilestones={};new MutationObserver(()=>{try{const m=window.__acceptanceMilestones;if(!m.full_index_ms&&typeof projectById!=='undefined'&&projectById.size===3000)m.full_index_ms=performance.now();if(!m.sidebar_usable_ms&&document.querySelectorAll('.sidebar-project').length===100)m.sidebar_usable_ms=performance.now();if(!m.first_pending_ms&&document.querySelector('.command-action-row'))m.first_pending_ms=performance.now();}catch(_){}}).observe(document,{childList:true,subtree:true});"""

                        def scale_context():
                            context = browser.new_context(viewport={'width': 1366, 'height': 900}, timezone_id='Asia/Shanghai', reduced_motion='reduce')
                            context.add_cookies([{'name': c.name, 'value': c.value, 'url': client.base_url} for c in client.session.cookies])
                            page = context.new_page()
                            page.add_init_script(milestones_script)
                            page.on('pageerror', lambda error: page_errors.append({'page': 'scale', 'error': str(error)}))
                            page.on('response', lambda response: trace.append({'page': 'scale', 'method': response.request.method, 'path': response.url.removeprefix(client.base_url), 'status': response.status}) if '/api/' in response.url else None)
                            return context, page

                        context, page = scale_context()
                        page.goto(client.base_url, wait_until='domcontentloaded', timeout=60000)
                        try:
                            page.wait_for_function('window.__acceptanceMilestones.first_pending_ms || document.getElementById("appInitError")', timeout=120000)
                        except Exception as error:
                            perf['default_wait_error'] = str(error)
                        state = page.evaluate('({indexed:projectById.size,sidebar:document.querySelectorAll(".sidebar-project").length,initError:document.getElementById("appInitError")?.textContent||"",metrics:document.querySelectorAll(".command-metric").length,milestones:window.__acceptanceMilestones})')
                        perf['default_initialization'] = state
                        perf['default_memory'] = memory_snapshot(client, metadata['executable'])
                        perf['first_usable_after_navigation_seconds'] = round(state['milestones']['sidebar_usable_ms']/1000, 3) if state['milestones'].get('sidebar_usable_ms') else None
                        perf['first_pending_after_navigation_seconds'] = round(state['milestones']['first_pending_ms']/1000, 3) if state['milestones'].get('first_pending_ms') else None
                        perf['full_list_after_navigation_seconds'] = round(state['milestones']['full_index_ms']/1000, 3) if state['milestones'].get('full_index_ms') else None
                        perf['cold_start_to_first_usable_seconds'] = round(perf['cold_exe_ready_seconds'] + perf['first_usable_after_navigation_seconds'], 3) if perf['first_usable_after_navigation_seconds'] is not None else None
                        perf['cold_start_to_full_list_seconds'] = round(perf['cold_exe_ready_seconds'] + perf['full_list_after_navigation_seconds'], 3) if perf['full_list_after_navigation_seconds'] is not None else None
                        perf['cold_start_to_first_pending_seconds'] = round(perf['cold_exe_ready_seconds'] + perf['first_pending_after_navigation_seconds'], 3) if perf['first_pending_after_navigation_seconds'] is not None else None
                        check('actual 3000 default initialization completes', state['indexed'] == 3000 and not state['initError'] and state['metrics'] > 0, state)
                        check('actual EXE 3000 first usable satisfies three-second gate', perf['first_usable_after_navigation_seconds'] is not None and perf['first_usable_after_navigation_seconds'] < 3, {'seconds': perf['first_usable_after_navigation_seconds'], 'api_deadline': 'candidate default, unchanged by verifier'})
                        check('actual EXE 3000 first pending satisfies three-second gate', perf['first_pending_after_navigation_seconds'] is not None and perf['first_pending_after_navigation_seconds'] < 3, {'seconds': perf['first_pending_after_navigation_seconds']})
                        page.screenshot(path=str(output / 'actual-exe-3000-default.png'), animations='disabled')
                        context.close()

                        # A browser abort does not cancel Flask's server-side work.
                        # Restart only our owned EXE before the sequential HTTP profile
                        # so no abandoned initialization request competes for SQLite.
                        profile_restart = time.perf_counter()
                        client.restart()
                        perf['http_profile_isolation'] = {'fresh_owned_exe': True, 'prior_browser_requests_terminated': True,
                            'restart_ready_seconds': round(time.perf_counter() - profile_restart, 3)}
                        perf['actual_http'] = []
                        captured = {}
                        for endpoint in ('/api/projects', '/api/stats'):
                            print(json.dumps({'profiling_actual_candidate_http': endpoint}, ensure_ascii=False), flush=True)
                            measurement, body = measure_http(client, endpoint, metadata['executable'])
                            perf['actual_http'].append(measurement)
                            captured[endpoint] = body
                            check('real candidate HTTP complete ' + endpoint, measurement.get('status') == 200 and not measurement.get('error') and measurement.get('project_count') == 3000, measurement)
                        if not all(captured.values()):
                            for gate in ('3000-row sidebar bounded to 100', 'second-page navigation', '3000th item search', 'large-response corruption preserves old data', 'large-response recovery'):
                                check('diagnostic rendering prerequisite unavailable: ' + gate, False, 'The actual candidate /api/projects response failed. No synthetic response substituted and this UI gate is unverified.')
                            raise AssertionError('Real candidate response could not be captured for rendering diagnosis')
                        # Prepare a real planned task after the slow reader finishes,
                        # so later candidate runs reuse a fixture with a visible task.
                        # This is a candidate API mutation on owned synthetic data.
                        try:
                            task_project = json.loads(captured['/api/projects'])[0]
                            task_stage = task_project['stages'][0]
                            task_plan = (datetime.now() + timedelta(days=1)).isoformat(timespec='minutes')
                            client.request('PUT', f'/api/projects/{task_project["id"]}/stages/' + requests.utils.quote(task_stage['key'], safe=''), {'planned_at': task_plan, 'record_version': task_stage['record_version']})
                            perf['pending_fixture_for_next_run'] = {'prepared': True, 'project_id': task_project['id'], 'stage_key': task_stage['key'], 'planned_at': task_plan}
                        except Exception as error:
                            perf['pending_fixture_for_next_run'] = {'prepared': False, 'error': f'{type(error).__name__}: {error}'}

                        # Diagnostic rendering uses only bytes returned above by the
                        # actual EXE. This never replaces the default failures or the
                        # three-second gates, and CDP marshalling is not server latency.
                        context, page = scale_context()
                        for endpoint, body in captured.items():
                            page.route('**' + endpoint, lambda route, request, snapshot=body: route.fulfill(status=200, content_type='application/json', body=snapshot))
                        diagnostic_started = time.perf_counter()
                        page.goto(client.base_url, wait_until='domcontentloaded', timeout=60000)
                        page.wait_for_function('projectById.size === 3000 && document.querySelectorAll(".sidebar-project").length === 100', timeout=120000)
                        page.locator('.command-metric').first.wait_for(timeout=60000)
                        page.wait_for_load_state('networkidle', timeout=30000)
                        perf['diagnostic'] = {'scope': 'rendering captured actual-candidate HTTP response bytes via Playwright; default initialization failure and 3-second gates preserved', 'response_sha256': perf['actual_http'][0]['response_sha256'], 'render_seconds_including_cdp': round(time.perf_counter()-diagnostic_started, 3), 'memory_after_full_load': memory_snapshot(client, metadata['executable'])}
                        perf['actual_exe_3000_verified'] = True
                        check('actual candidate 3000 response indexes all rows in diagnostic rendering', page.evaluate('projectById.size') == 3000)
                        check('3000 project DOM renders only 100 sidebar rows', page.locator('.sidebar-project').count() == 100)
                        previous = page.locator('.sidebar-project').first.inner_text()
                        page.get_by_role('button', name='下一页项目').click()
                        pagination = page.evaluate('({page:sidebarPage,rows:document.querySelectorAll(".sidebar-project").length,pager:document.querySelector(".sidebar-list-pager")?.textContent})')
                        pagination['first_row_changed'] = page.locator('.sidebar-project').first.inner_text() != previous
                        check('real 3000 pagination reaches second page', pagination['rows'] == 100 and pagination['first_row_changed'] and pagination['page'] == 1, pagination)
                        if pagination['page'] != 1:
                            page.get_by_role('button', name='下一页项目').click()
                            retry_pagination = page.evaluate('({page:sidebarPage,rows:document.querySelectorAll(".sidebar-project").length,pager:document.querySelector(".sidebar-list-pager")?.textContent})')
                            check('pagination recovery through a second click reaches second page', retry_pagination['page'] == 1 and retry_pagination['rows'] == 100, retry_pagination)
                        page.locator('#searchInput').fill('真实EXE合成项目3000')
                        page.wait_for_function('document.querySelectorAll(".sidebar-project").length === 1')
                        check('the 3000th persisted item remains searchable', '真实EXE合成项目3000' in page.locator('.sidebar-project').inner_text())
                        sidebar = page.locator('#projectList').inner_text()
                        page.route('**/api/projects', lambda route: route.fulfill(status=200, content_type='application/json', body='[{"id":'), times=1)
                        error = page.evaluate('async()=>{try{await loadAllProjects();return "";}catch(e){return e.message;}}')
                        check('large-response corruption preserves prior 3000 index and search result', bool(error) and page.evaluate('projectById.size') == 3000 and page.locator('#projectList').inner_text() == sidebar)
                        page.evaluate('loadAllProjects()')
                        check('large-response diagnostic recovery reloads captured actual-server response', page.evaluate('projectById.size') == 3000 and '真实EXE合成项目3000' in page.locator('.sidebar-project').inner_text())
                        perf['diagnostic']['memory_after_recovery'] = memory_snapshot(client, metadata['executable'])
                        check('EXE and browser process memory was measured', perf['default_memory']['exe']['rss_bytes'] > 0 and perf['diagnostic']['memory_after_full_load']['browser']['rss_bytes'] > 0)
                        page.screenshot(path=str(output / 'actual-exe-3000-search.png'), animations='disabled')
                        context.close()

                if suite in ('all', 'performance'):
                    scenario('actual EXE 3000 projects', scale)
                check('no unhandled candidate browser page errors', not page_errors, page_errors)
            finally:
                browser.close()
    except Exception as error:
        check('acceptance completed without exception', False, f'{type(error).__name__}: {error}')
    result.update(totals(checks))
    result['completed'] = True
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--license-fixtures', type=Path, help='Compatibility argument; this verifier generates temporary synthetic public keys/licenses instead.')
    parser.add_argument('--browser-executable')
    parser.add_argument('--suite', choices=['all', 'functional', 'performance'], default='all')
    parser.add_argument('--keep-data', type=Path, help='Retain only owned synthetic profile under .codex/module-state/browser-profiling')
    parser.add_argument('--product-commit', '--source-commit', dest='product_commit', default=RELEASE_SOURCE)
    parser.add_argument('--expected-version', default='v5.8.53')
    args = parser.parse_args()
    result = verify(args.candidate.resolve(), args.sha256.lower(), args.output.resolve(), args.browser_executable, args.license_fixtures, args.suite, args.keep_data, args.product_commit, args.expected_version)
    print(json.dumps(totals(result['checks']), ensure_ascii=False))
    return 0 if result['passed'] == result['total'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
