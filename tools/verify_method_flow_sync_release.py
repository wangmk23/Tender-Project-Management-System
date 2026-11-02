"""Hash-pinned old Windows EXE -> v5.8.58 method-flow synchronization gate.

Only freshly authorized, verifier-owned synthetic profiles are written. The old
EXE creates the legacy drift through its HTTP APIs; the new EXE serves the actual
information-page preview/confirmation UI. SQLCipher access is query-only.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import copy
import json
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import traceback
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.verify_media_release import Report as BaseReport, require, sha256, upload, download_matches
from tools.verify_method_correction_release import OwnedDatabase as BaseDatabase, active_keys, stage, read, method, create, save, save_stage

REPORT_NAME = 'method-flow-sync-exe-acceptance.json'
REQUIRED_CHECKS = frozenset((
    'baseline', 'candidate', 'baseline startup', 'baseline version',
    'legacy drift', 'baseline database', 'baseline encrypted attachment',
    'candidate startup', 'version', 'database connector', 'upgrade preservation',
    'browser', 'UI cancel', 'UI confirm', 'historical records', 'new stages pending',
    'history read only', 'stage preview conflict', 'template preview conflict',
    'archived undo rejected', 'archived notes rejected', 'attachments unchanged',
    'other project unchanged', 'protected identity unchanged', 'browser errors',
    'baseline unchanged', 'candidate unchanged',
))
ONLINE_KEYS = ('plan_received', 'online_documents', 'agreement_signed', 'announcement',
               'registration_end', 'online_quotation', 'result_announced', 'online_fee_notice', 'archived')
COMPLETED_KEYS = ('plan_received', 'agreement_signed', 'doc_prepare', 'doc_review',
                  'doc_finalized', 'announcement', 'registration_end')
MANUAL_SKIP_KEYS = ('bid_opening', 'evaluation')


class Report(BaseReport):
    def result(self):
        value = super().result()
        missing = sorted(REQUIRED_CHECKS - {r['name'] for r in self.checks if r['passed']})
        gates = []
        for name in sorted(REQUIRED_CHECKS):
            rows = [r for r in self.checks if r['name'] == name]
            gates.append({'name': name, 'status': 'missing' if not rows else
                          'passed' if all(r['passed'] for r in rows) else 'failed'})
        return {**value, 'passed': value['passed'] and not missing,
                'missing_required_checks': missing, 'required_gates': gates,
                'browser_ui_verified': all(any(r['name'] == name and r['passed'] for r in self.checks)
                                           for name in ('browser', 'UI cancel', 'UI confirm', 'history read only', 'browser errors')),
                'physical_print_verified': False,
                'scope': 'Owned SHA-pinned old Windows EXE upgrade to SHA-pinned candidate, real HTTP writes, query-only physical synthetic database reads, actual served information-page UI in headless Chromium. No native desktop, physical phone/printer, real external network or production-data acceptance.'}


def parser():
    result = argparse.ArgumentParser(description=__doc__)
    for name in ('baseline', 'candidate', 'evidence'):
        result.add_argument('--' + name, type=Path, required=True)
    for name in ('baseline-sha256', 'candidate-sha256', 'expected-version'):
        result.add_argument('--' + name, required=True)
    result.add_argument('--browser-executable', type=Path)
    return result


def validate_executable(path, digest):
    if not isinstance(digest, str) or not re.fullmatch(r'[a-fA-F0-9]{64}', digest):
        raise ValueError('EXE SHA256 must contain exactly 64 hexadecimal digits')
    from tools.release_browser import require_windows_candidate
    return require_windows_candidate(Path(path), digest)


def validate_conflict(status, body, before, after, code):
    require(status == 409, f'Expected HTTP 409 {code}, received {status}')
    require(body.get('code') == code, f'Expected {code}, received {body.get("code")}')
    require(before == after, 'Rejected operation changed physical project data')


def validate_cancel(trace, pid, before, after):
    endpoint = f'/api/projects/{pid}'
    require(any(r['method'] == 'POST' and r['path'] == endpoint + '/workflow/preview'
                and r.get('status') == 200 for r in trace), 'Cancellation did not follow a real successful preview')
    require(not any(r['method'] == 'PUT' and r['path'] == endpoint for r in trace),
            'Cancelling preview sent a project PUT')
    require(before == after, 'Cancelling preview changed physical project data')


def business_fields(row):
    value = {k: v for k, v in row.items() if k not in ('template_removed', 'stage_position')}
    if isinstance(value.get('modules_json'), str):
        value['modules_json'] = json.loads(value['modules_json'])
    return value


def validate_history(before, after, target_keys):
    require(set(before).issubset(after), 'Sync deleted original physical stage rows')
    for key, row in before.items():
        require(after[key]['id'] == row['id'], 'Sync recreated original stage ID: ' + key)
        if row.get('completed') or row.get('skipped'):
            require(business_fields(after[key]) == business_fields(row), 'Sync changed historical business fields: ' + key)
            require(bool(after[key].get('template_removed')) == (key not in target_keys),
                    'Historical stage is active/archived incorrectly: ' + key)
    for key in set(target_keys) - set(before):
        row = after.get(key)
        require(row is not None and not row.get('template_removed'), 'Missing new active target stage: ' + key)
        require(not row.get('completed') and not row.get('skipped')
                and not row.get('completed_at') and not row.get('completed_date'),
                'New target stage is falsely complete/skipped: ' + key)


class OwnedDatabase(BaseDatabase):
    def snapshot(self, pid):
        # Inspect project-scoped tables in this newly created synthetic profile.
        # Never write SQL or inspect a deployment database/key.
        with closing(self.runtime['connect_encrypted'](self.database, self._key, False)) as db:
            db.row_factory = self.runtime['extension'].Row
            db.execute('PRAGMA query_only=ON')
            result = {}
            tables = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")]
            for name in tables:
                if not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*', name):
                    continue
                columns = {r[1] for r in db.execute(f'PRAGMA table_info("{name}")')}
                column = 'id' if name == 'projects' else 'project_id' if 'project_id' in columns else None
                if column:
                    result[name] = [dict(r) for r in db.execute(f'SELECT * FROM "{name}" WHERE "{column}"=? ORDER BY rowid', (int(pid),))]
            return result


def runtime_version(client, expected):
    versions = {endpoint: client.request('GET', endpoint).get('version') for endpoint in ('/health', '/api/system-info')}
    require(all(value == expected for value in versions.values()), 'Runtime version mismatch: ' + repr(versions))
    return versions


def seed_legacy(client):
    from src.backend_patches.stage_templates import online_bidding_template
    catalog = client.request('GET', '/api/procurement-methods')
    legacy = next((m for m in catalog['methods'] if m.get('builtin_kind') == '公开招标'
                   and m.get('user_owned') and m.get('enabled') and len(m.get('stages', [])) == 14), None)
    require(legacy is not None, 'Old EXE has no enabled 14-stage legacy public-tender template')
    old_rows = copy.deepcopy(legacy['stages'])
    require(set(COMPLETED_KEYS + MANUAL_SKIP_KEYS).issubset({r['id'] for r in old_rows}),
            'Old public-tender template does not match the intended historical flow')
    online_rows = online_bidding_template()
    next(r for r in online_rows if r['id'] == 'online_quotation')['modules'].append('bid_results')
    old = method(client, '隔离验收旧14阶段方式', old_rows, quantity_rule={'mode': 'unfixed', 'minimum': None})
    online = method(client, '隔离验收网上竞价9阶段方式', online_rows, quantity_rule={'mode': 'unfixed', 'minimum': None})
    projects = {}
    for label in ('primary', 'stage-conflict', 'template-conflict'):
        created = create(client, old, 'SYNC-' + label.upper(), no_deposit=True)
        pid = created['id']
        for index, key in enumerate(COMPLETED_KEYS):
            save_stage(client, pid, key, {'completed': True, 'skipped': False,
                       'completed_at': f'2026-10-{10+index:02d}T09:15',
                       'planned_at': f'2026-10-{9+index:02d}T08:30', 'notes': '合成历史完成-' + key})
        # Confirm only this synthetic project's empty actual-participation roster.
        ledger = client.request('GET', f'/api/projects/{pid}/tender-guarantee')
        client.request('PUT', f'/api/projects/{pid}/tender-guarantee', {
            'revision': ledger['revision'], 'data': dict(ledger['data'], confirmed=True),
            'confirm_roster': True, 'reason': '隔离验收：合成空报名名单已核对'})
        for index, key in enumerate(MANUAL_SKIP_KEYS):
            save_stage(client, pid, key, {'completed': True, 'skipped': True,
                       'completed_at': f'2026-10-{20+index}T10:25', 'notes': '人工确认不适用-' + key})
        drift = save(client, pid, {'procurement_method_id': online['id']})
        require(drift['procurement']['method_id'] == online['id'], 'Old EXE did not save new method identity')
        require(active_keys(drift) == [r['id'] for r in old_rows], 'Old EXE did not reproduce 14-stage saved-method drift')
        require(bool(drift.get('no_deposit')), 'Synthetic no-deposit setting lost')
        for key in COMPLETED_KEYS:
            require(stage(drift, key)['completed'] and not stage(drift, key)['skipped'], 'Missing actual completed stage: ' + key)
        for key in MANUAL_SKIP_KEYS:
            require(stage(drift, key)['completed'] and stage(drift, key)['skipped'], 'Missing manual skipped stage: ' + key)
        projects[label] = pid
    projects['other'] = create(client, old, 'SYNC-UNRELATED', no_deposit=False)['id']
    return {'projects': projects, 'old_method': old, 'online_method': online,
            'old_active_keys': [r['id'] for r in old_rows], 'target_keys': list(ONLINE_KEYS),
            'seven_completed': list(COMPLETED_KEYS), 'manual_skips': list(MANUAL_SKIP_KEYS)}


def original_files(client):
    return {name: sha256(client.data_root / name) for name in ('license.dat', 'data_key.dpapi', 'license_public_key.pem')}


def copy_log(client, evidence, name):
    path = client.root / 'startup.log'
    if path.is_file(): shutil.copy2(path, evidence / (name + '-startup.log'))


def conflict_checks(client, database, seed, report):
    mid = seed['online_method']['id']
    for label in ('stage', 'template'):
        pid = seed['projects'][label + '-conflict']
        preview = client.request('POST', f'/api/projects/{pid}/workflow/preview', {'mode': 'method', 'procurement_method_id': mid})
        require(preview.get('base_fingerprint') and not preview.get('blocked'), 'Synthetic conflict preview failed')
        if label == 'stage':
            save_stage(client, pid, 'plan_received', {'notes': '预览后由另一请求修改，必须保留'})
        else:
            selected = next(m for m in client.request('GET', '/api/procurement-methods')['methods'] if m['id'] == mid)
            rows = copy.deepcopy(selected['stages']); rows[1]['name'] += '（预览后更新）'
            client.request('PATCH', f'/api/procurement-methods/{mid}', {'revision': selected['revision'], 'stages': rows})
        current = read(client, pid); before = database.snapshot(pid)
        response = client.session.put(client.base_url + f'/api/projects/{pid}', json={
            'procurement_method_id': mid, 'sync_method_flow': True,
            'method_flow_fingerprint': preview['base_fingerprint'], 'record_version': current['record_version'],
            'name': '禁止被过期预览覆盖的草稿'}, headers={'X-CSRFToken': client.csrf_token}, timeout=30)
        report.check(label + ' preview conflict', lambda: validate_conflict(
            response.status_code, response.json(), before, database.snapshot(pid), 'FLOW_CHANGED'))


def archived_write_checks(client, database, pid, report):
    for label, values in (('undo', {'completed': False, 'skipped': False}), ('notes', {'notes': '禁止修改历史备注'})):
        current = stage(read(client, pid), 'bid_opening'); before = database.snapshot(pid)
        response = client.session.put(client.base_url + f'/api/projects/{pid}/stages/bid_opening',
            json=dict(values, record_version=current['record_version']), headers={'X-CSRFToken': client.csrf_token}, timeout=30)
        report.check('archived ' + label + ' rejected', lambda: validate_conflict(
            response.status_code, response.json(), before, database.snapshot(pid), 'STAGE_ARCHIVED'))


def browser_checks(client, database, seed, report, evidence, executable):
    from playwright.sync_api import sync_playwright
    from tools.release_browser import launch_browser
    trace, errors, console, external = [], [], [], []
    pid = seed['projects']['primary']
    with sync_playwright() as playwright:
        browser, metadata = launch_browser(playwright, executable)
        report.metadata['browser_environment'] = metadata
        report.check('browser', lambda: metadata)
        page = None
        try:
            context = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                          timezone_id='Asia/Shanghai', reduced_motion='reduce')
            context.add_cookies([{'name': c.name, 'value': c.value, 'url': client.base_url} for c in client.session.cookies])
            page = context.new_page()
            page.on('pageerror', lambda error: errors.append(str(error)))
            page.on('console', lambda message: console.append({'type': message.type, 'text': message.text}))
            def request_observed(request):
                if '/api/' in request.url:
                    trace.append({'method': request.method, 'path': urlsplit(request.url).path, 'phase': 'request'})
                if urlsplit(request.url).scheme in ('http', 'https') and not request.url.startswith(client.base_url + '/'):
                    external.append(request.url)
            page.on('request', request_observed)
            page.on('response', lambda response: trace.append({'method': response.request.method,
                    'path': urlsplit(response.url).path, 'status': response.status}) if '/api/' in response.url else None)
            page.goto(client.base_url, wait_until='networkidle')
            page.wait_for_function('typeof selectProject === "function" && projectById.size >= 4')
            page.evaluate('async id => {await selectProject(id); switchProjectTab("info");}', pid)
            page.locator('#infoMethod').wait_for()
            require(page.locator('#infoMethod').input_value() == seed['online_method']['id'], 'Information page selected the wrong saved method')
            before = database.snapshot(pid); start = len(trace)
            page.get_by_role('button', name='同步所选方式流程', exact=True).click()
            page.locator('#confirmDialog.open').wait_for()
            message = page.locator('#confirmMsg').inner_text()
            require('新增' in message and '只读历史' in message and '跳过' in message, 'Real confirmation omits history/new-stage explanation')
            page.screenshot(path=str(evidence / 'preview-before-cancel.png'), animations='disabled')
            page.locator('#confirmCancel').click()
            page.wait_for_function('projectInfoSaveRequest === null')
            report.check('UI cancel', lambda: validate_cancel(trace[start:], pid, before, database.snapshot(pid)))
            require(page.locator('#infoMethod').input_value() == seed['online_method']['id'], 'Cancel lost the selected method draft')

            def confirm():
                page.get_by_role('button', name='同步所选方式流程', exact=True).click()
                page.locator('#confirmDialog.open').wait_for()
                with page.expect_response(lambda r: r.request.method == 'PUT' and urlsplit(r.url).path == f'/api/projects/{pid}') as saved:
                    page.locator('#confirmOk').click()
                response = saved.value
                require(response.status == 200, 'Actual UI confirmation failed: ' + str(response.status) + ' ' + response.text()[:600])
                request = response.request.post_data_json
                require(request.get('sync_method_flow') is True and request.get('method_flow_fingerprint'), 'UI did not submit explicit acknowledged synchronization')
                page.wait_for_function('projectInfoSaveRequest === null')
                page.screenshot(path=str(evidence / 'information-after-sync.png'), animations='disabled')
                return {'http_status': response.status, 'explicit_sync': True, 'preview_fingerprint_submitted': True}
            report.check('UI confirm', confirm)

            def history():
                results = []
                for tab in ('timeline', 'tasks'):
                    page.evaluate('tab => switchProjectTab(tab)', tab)
                    host = page.locator('[data-method-flow-history]:visible')
                    host.wait_for()
                    text = host.inner_text()
                    for key in MANUAL_SKIP_KEYS:
                        old = stage(read(client, pid), key)
                        require(old['name'] in text and old['notes'] in text, 'Manual skipped history is absent from visible UI: ' + key)
                        date = page.evaluate('value => stageDateTimeText(value)', old.get('completed_at') or old.get('completed_date'))
                        require(bool(date) and date in text, 'Manual skipped completion date/time missing from UI')
                    require(host.locator('button,input,select,textarea,a[onclick],[role="button"],[onclick]').count() == 0,
                            'Archived history contains an edit/complete/undo control')
                    require('只读' in text and '已跳过' in text, 'Archived history lacks read-only/manual-skip status')
                    page.screenshot(path=str(evidence / ('history-' + tab + '.png')), animations='disabled')
                    results.append({'tab': tab, 'manual_skips_visible': True, 'edit_controls': 0})
                return results
            report.check('history read only', history)
            report.check('browser errors', lambda: require(not errors and not external, 'Unhandled page errors or external browser requests: ' + repr({'page_errors': errors, 'external': external})))
        except Exception:
            if page is not None:
                try: page.screenshot(path=str(evidence / 'browser-failure.png'), animations='disabled')
                except Exception as error: console.append({'type': 'screenshot-error', 'text': str(error)})
            raise
        finally:
            (evidence / 'browser-console.json').write_text(json.dumps({'console': console, 'page_errors': errors,
                'external_requests': external, 'http_trace': trace}, ensure_ascii=False, indent=2) + '\n', 'utf-8')
            browser.close()


def run(args):
    evidence = args.evidence.resolve(); evidence.mkdir(parents=True, exist_ok=True)
    report = Report(emit=True)
    report.metadata.update(baseline=str(args.baseline.resolve()), baseline_sha256=args.baseline_sha256,
        candidate=str(args.candidate.resolve()), candidate_sha256=args.candidate_sha256,
        expected_version=args.expected_version, harness_tool_sha256=sha256(Path(__file__)),
        browser_environment={'verified': False, 'requested_executable': str(args.browser_executable) if args.browser_executable else None},
        execution_environment={'platform': sys.platform, 'python': sys.version, 'os': platform.platform()},
        existing_runtime_restarted=False, private_license_fixtures_used=False)
    (evidence / 'browser-console.json').write_text(json.dumps({'browser_started': False,
        'console': [], 'page_errors': [], 'http_trace': [], 'note': 'Browser checks have not started.'}, indent=2) + '\n', 'utf-8')
    try:
        report.metadata['harness_commit'] = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        require(args.expected_version == 'v5.8.58', 'This gate requires explicit --expected-version v5.8.58')
        report.check('baseline', lambda: validate_executable(args.baseline, args.baseline_sha256))
        report.check('candidate', lambda: validate_executable(args.candidate, args.candidate_sha256))
        # Access the module at call time so the main verifier can supply its
        # explicitly owned compatible-license adapter without replacing aliases.
        from tools import verify_packaged_browser_acceptance as common
        from tools.verify_pdf_reader_release import text_pdf
        with tempfile.TemporaryDirectory(prefix='pm-method-sync-exe-', ignore_cleanup_errors=True) as temp:
            root = Path(temp); profile = root / 'retained-profile'  # Must not pre-create profile/data.
            with common.owned_client(args.baseline.resolve(), root, 'baseline', retained_profile=profile) as baseline:
                try:
                    report.check('baseline startup', baseline.start)
                    report.check('baseline version', lambda: runtime_version(baseline, 'v5.8.54'))
                    seed = report.check('legacy drift', lambda: seed_legacy(baseline))
                    original = root / 'synthetic-history.pdf'; original.write_bytes(text_pdf(1))
                    attachment = report.check('baseline encrypted attachment', lambda: upload(baseline, seed['projects']['primary'], original))
                    old_db = OwnedDatabase(args.baseline.resolve(), baseline.data_root, root)
                    try:
                        snapshots = {label: old_db.snapshot(pid) for label, pid in seed['projects'].items()}
                        report.check('baseline database', old_db.metadata)
                    finally: old_db.close()
                    protected = original_files(baseline)
                    old_attachments = baseline.request('GET', f'/api/projects/{seed["projects"]["primary"]}/attachments')
                    password = baseline.password
                finally: copy_log(baseline, evidence, 'baseline')
            report.metadata['synthetic_fixture'] = seed
            with common.owned_client(args.candidate.resolve(), root, 'candidate', retained_profile=profile) as client:
                client.password = password
                try:
                    report.check('candidate startup', client.start)
                    report.check('version', lambda: runtime_version(client, args.expected_version))
                    database = OwnedDatabase(args.candidate.resolve(), client.data_root, root)
                    try:
                        report.check('database connector', database.metadata)
                        pid = seed['projects']['primary']
                        # Read once to settle ordinary old-profile workflow defaults before freezing.
                        for project_id in seed['projects'].values(): read(client, project_id)
                        def upgraded():
                            for label, project_id in seed['projects'].items():
                                current = database.snapshot(project_id)
                                require(current == snapshots[label], 'Upgrade changed old synthetic business facts: ' + label)
                            require(active_keys(read(client, pid)) == seed['old_active_keys'], 'Upgrade silently repaired saved-method drift')
                            return {'legacy_drift_retained_until_explicit_confirmation': True, 'physical_project_snapshots_unchanged': True}
                        report.check('upgrade preservation', upgraded)
                        other_api = read(client, seed['projects']['other']); other_db = database.snapshot(seed['projects']['other'])
                        browser_checks(client, database, seed, report, evidence, args.browser_executable)
                        before_stages = {r['stage_key']: r for r in snapshots['primary']['stages']}
                        after_stages = database.stages(pid)
                        report.check('historical records', lambda: validate_history(before_stages, after_stages, ONLINE_KEYS))
                        def pending():
                            current = read(client, pid)
                            require(active_keys(current) == list(ONLINE_KEYS), 'Confirmed workflow is not the nine configured online-bidding stages')
                            for key in ('online_documents', 'online_quotation', 'online_fee_notice'):
                                row = stage(current, key)
                                require(not row['completed'] and not row['skipped'], 'New online stage is not pending: ' + key)
                            require(bool(current.get('no_deposit')), 'Sync lost the no-deposit setting')
                            return {'active_keys': active_keys(current), 'new_online_stages_pending': True, 'no_deposit_preserved': True}
                        report.check('new stages pending', pending)
                        archived_write_checks(client, database, pid, report)
                        conflict_checks(client, database, seed, report)
                        def attachments():
                            current = client.request('GET', f'/api/projects/{pid}/attachments')
                            require(current == old_attachments, 'Sync changed original attachment IDs or metadata')
                            require(database.snapshot(pid).get('attachments') == snapshots['primary'].get('attachments'), 'Sync changed physical attachment records')
                            require(sha256(client.data_root / attachment['stored_relative_path']) == attachment['stored_sha256'], 'Sync changed encrypted attachment bytes')
                            download_matches(client, attachment['id'], original)
                            return dict(attachment, physical_records_unchanged=True, original_download_unchanged=True)
                        report.check('attachments unchanged', attachments)
                        def other():
                            require(database.snapshot(seed['projects']['other']) == other_db and read(client, seed['projects']['other']) == other_api,
                                    'Sync/conflict checks changed unrelated project')
                            return {'synthetic_project_id': seed['projects']['other'], 'physical_rows_and_api_unchanged': True}
                        report.check('other project unchanged', other)
                        report.check('protected identity unchanged', lambda: require(original_files(client) == protected,
                            'Upgrade or synchronization changed synthetic license/public-key/data-key identity'))
                    finally: database.close()
                finally: copy_log(client, evidence, 'candidate')
        report.check('baseline unchanged', lambda: validate_executable(args.baseline, args.baseline_sha256))
        report.check('candidate unchanged', lambda: validate_executable(args.candidate, args.candidate_sha256))
    except Exception as error:
        report.metadata.update(error=f'{type(error).__name__}: {error}', traceback=traceback.format_exc())
        if all(row['passed'] for row in report.checks):
            report.checks.append({'name': 'acceptance interrupted', 'passed': False, 'error': report.metadata['error']})
    result = report.result()
    (evidence / REPORT_NAME).write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', 'utf-8')
    return result


def main(argv=None):
    result = run(parser().parse_args(argv))
    print(json.dumps(result, ensure_ascii=True, indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__': raise SystemExit(main())
