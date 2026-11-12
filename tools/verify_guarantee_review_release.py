"""Hash-pinned Windows EXE upgrade acceptance for resolved guarantee reviews.

Only disposable synthetic data is written; no production server or mail is used.
The baseline reproduces the stale review date using the original special form.
"""
import argparse
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import traceback

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.release_browser import launch_browser, require_windows_candidate
from tools.verify_media_release import Report, require, sha256
from tools.verify_packaged_browser_acceptance import owned_client
from tools.verify_calendar_status_release import start
from tools.verify_guarantee_release import fixture

REQUIRED = {'baseline', 'candidate', 'baseline startup', 'candidate startup',
            'version', 'baseline original form reproduces stale review',
            'upgrade preserves ledger and stages', 'resolved review and unpaid refund',
            'calendar browser statuses', 'new deadline still requires review',
            'protected authorization modules', 'inputs unchanged'}


def save(client, pid, ledger, **options):
    return client.request('PUT', f'/api/projects/{pid}/tender-guarantee',
                          dict(revision=ledger['revision'], data=ledger['data'],
                               reason='合成保证金复核验收', **options))


def calendar(client, pid):
    value = client.request('GET', '/api/calendar?year=2026&month=11')
    return [e for c in value['cells'] for e in c.get('events', [])
            if e.get('project_id') == pid and e.get('kind') == 'deposit_refund']


def review(events, rid):
    return next(e for e in events if e.get('registration_id') == rid
                and e['guarantee_action'] == 'review')


def facts(client, pid):
    ledger = client.request('GET', f'/api/projects/{pid}/tender-guarantee')
    stages = [{k: s.get(k) for k in ('key', 'completed', 'completed_at', 'planned_at', 'skipped')}
              for s in client.get_project(pid)['stages']]
    return dict(data=ledger['data'], revision=ledger['revision'],
                balance=ledger['summary']['balance'], stages=stages)


def browser_context(browser, client):
    context = browser.new_context(viewport={'width': 1440, 'height': 1000},
                                  timezone_id='Asia/Shanghai', reduced_motion='reduce')
    context.add_cookies([dict(name=c.name, value=c.value, url=client.base_url)
                        for c in client.session.cookies])
    return context


def seed(client, args, evidence):
    from playwright.sync_api import sync_playwright
    seeded = fixture(client, [])
    pid = seeded['pid']; ids = [r['id'] for r in seeded['registrations']]
    ledger = client.request('GET', f'/api/projects/{pid}/tender-guarantee')
    for row in ledger['data']['records'][:2]:
        row.update(handling='rule', handling_reason='模拟暂缓后复核', review_at='2026-11-09',
                   manual_start_at='2026-11-09', manual_deadline='2026-11-23T18:00',
                   manual_basis='模拟已核对期限')
    ledger = save(client, pid, ledger, accept_recalculation=True)
    # Hold retains the previous deadline even with accept_recalculation. First
    # establish the confirmed deadline, then enter hold as an ordinary user would.
    for row in ledger['data']['records'][:2]:
        row['handling'] = 'hold'
    save(client, pid, ledger)
    with sync_playwright() as pw:
        browser, metadata = launch_browser(pw, args.browser_executable)
        try:
            context = browser_context(browser, client); page = context.new_page()
            page.goto(client.base_url, wait_until='networkidle')
            page.evaluate('(pid)=>selectProject(pid)', pid)
            page.wait_for_function('(pid)=>currentProject?.id===pid', arg=pid)
            page.evaluate('(rid)=>showGuaranteeSpecialForm(rid)', ids[0])
            page.locator('#tgHandling').select_option('rule')
            page.locator('#tgAuditReason').fill('模拟复核：核对后恢复按规则办理')
            page.locator('#modalSaveBtn').click()
            page.wait_for_selector('#modalSaveBtn', state='hidden')
            ledger = client.request('GET', f'/api/projects/{pid}/tender-guarantee')
            item = next(x for x in ledger['items'] if x['registration_id'] == ids[0])
            require(item['status'] == 'pending' and not item['needs_recheck'], 'baseline review not resolved')
            require(item['review_at'] == '2026-11-09', 'original form did not retain historical date')
            require(not review(calendar(client, pid), ids[0])['completed'], 'baseline did not reproduce stale status')
            page.screenshot(path=str(evidence/'baseline-original-form.png'), full_page=True)
            context.close()
        except Exception:
            if 'page' in locals():
                page.screenshot(path=str(evidence/'baseline-failure.png'), full_page=True)
                (evidence/'baseline-failure-form.txt').write_text(page.locator('#modalBody').inner_text(), 'utf-8')
            raise
        finally:
            browser.close()
    return pid, ids, dict(browser=metadata, baseline_review_completed=False,
                         historical_review_date_retained=True)


def browser_check(client, pid, ids, args, evidence):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser, metadata = launch_browser(pw, args.browser_executable)
        try:
            context = browser_context(browser, client); page = context.new_page()
            errors = []; writes = []
            page.on('pageerror', lambda e: errors.append(str(e)))
            page.on('request', lambda r: writes.append(r.url) if r.method in ('POST', 'PUT', 'DELETE', 'PATCH')
                    and '/api/projects/' in r.url else None)
            page.clock.install(time=datetime(2026, 11, 11, 12, tzinfo=timezone(timedelta(hours=8))))
            page.goto(client.base_url, wait_until='networkidle')
            page.evaluate("async()=>{switchView('calendar',{load:false});calendarYear=2026;calendarMonth=11;calendarSelectedDate='2026-11-09';await loadCalendar({force:true});}")
            rows = [page.locator('.calendar-agenda-item').filter(has_text=name)
                    for name in ('模拟有效中标人', '模拟有效未中标人')]
            require([r.locator('.calendar-node-status').inner_text() for r in rows] ==
                    ['已完成', '逾期未完成'], 'resolved and held review badges differ')
            for theme in ('default', 'dark', 'blue', 'green'):
                page.evaluate('(theme)=>setTheme(theme)', theme)
                for width in (1440, 390):
                    page.set_viewport_size({'width': width, 'height': 1000 if width == 1440 else 844})
                    require(rows[0].locator('.calendar-node-status').is_visible(), 'completed badge hidden')
                    require(not page.locator('#calendarContent').evaluate('(e)=>e.scrollWidth>e.clientWidth+2'), 'calendar overflow')
                    page.screenshot(path=str(evidence/f'review-{theme}-{width}.png'), full_page=True, animations='disabled')
            page.evaluate("selectCalendarDay('2026-11-23')")
            refund = page.locator('.calendar-agenda-item').filter(has_text='模拟有效中标人')
            require(refund.locator('.calendar-node-status').inner_text() == '待办', 'unpaid refund marked done')
            require('保证金退还截止' in refund.inner_text(), 'real refund deadline missing')
            require(not errors and not writes, f'errors/writes: {errors}/{writes}')
            context.close()
            return dict(browser=metadata, review_statuses=['已完成', '逾期未完成'],
                        refund_status='待办', screenshots=8, project_writes=writes, page_errors=errors)
        finally:
            browser.close()


def verify(args):
    evidence = args.evidence.resolve(); evidence.mkdir(parents=True, exist_ok=False)
    report = Report(emit=True); fixtures = args.compatible_license_dir
    required = REQUIRED | ({'license inputs unchanged'} if fixtures else set())
    report.metadata.update(source_commit=args.source_commit, expected_version=args.expected_version,
        candidate_sha256=args.candidate_sha256, baseline_sha256=args.baseline_sha256,
        edition='compatible' if fixtures else 'public', environment=platform.platform(), python=sys.version,
        harness_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        complete_release_acceptance=False, manual_checks=['native desktop/display scaling', 'physical phone/deployment network'])
    try:
        require(bool(re.fullmatch('[0-9a-f]{40}', args.source_commit)), 'immutable source SHA required')
        report.check('baseline', lambda: require_windows_candidate(args.baseline, args.baseline_sha256))
        report.check('candidate', lambda: require_windows_candidate(args.candidate, args.candidate_sha256))
        from tools.verify_local_files_release import compatible_client, protected_modules
        report.check('protected authorization modules', lambda: protected_modules(args.baseline,args.candidate,public=not bool(fixtures)))
        if fixtures:
            fixtures = fixtures.resolve(strict=True)
            hashes = {p:sha256(p) for p in fixtures.iterdir() if p.is_file()
                      and p.name in ('license.dat', '.license_state.bin', 'license_public_key.pem')}
            require((fixtures/'license.dat') in hashes, 'compatible test license missing')
            factory = lambda exe, root, label, profile: compatible_client(exe, root, label, fixtures, profile)
        else:
            factory = lambda exe, root, label, profile: owned_client(exe, root, label, retained_profile=profile)
        with tempfile.TemporaryDirectory(prefix='pm-guarantee-review-') as directory:
            root = Path(directory); profile = root/'profile'
            with factory(args.baseline.resolve(), root, 'baseline', profile) as old:
                report.check('baseline startup', lambda: start(old, evidence, 'baseline'))
                pid, ids, detail = seed(old, args, evidence)
                report.check('baseline original form reproduces stale review', lambda: detail)
                before = facts(old, pid); password = old.password
                (evidence/'baseline-synthetic-facts.json').write_text(json.dumps(before, ensure_ascii=False, indent=2), 'utf-8')
            with factory(args.candidate.resolve(), root, 'candidate', profile) as client:
                client.password = password
                report.check('candidate startup', lambda: start(client, evidence, 'candidate'))
                report.check('version', lambda: require(client.request('GET','/api/system-info')['version']==args.expected_version,'version mismatch'))
                report.check('upgrade preserves ledger and stages', lambda: require(facts(client,pid)==before,'upgrade changed ledger/stages'))
                events = calendar(client, pid)
                (evidence/'candidate-calendar.json').write_text(json.dumps(events,ensure_ascii=False,indent=2),'utf-8')
                def statuses():
                    require(review(events,ids[0])['completed'], 'resolved review still incomplete')
                    require(not review(events,ids[1])['completed'], 'active hold was completed')
                    refund = next(e for e in events if e['registration_id']==ids[0] and e['guarantee_action']=='refund')
                    require(not refund['completed'] and refund['planned_at']=='2026-11-23T18:00' and refund['balance']=='100.00','unpaid refund changed')
                report.check('resolved review and unpaid refund', statuses)
                report.check('calendar browser statuses',lambda:browser_check(client,pid,ids,args,evidence))
                require(facts(client,pid)==before,'calendar display changed business facts')
                def recheck():
                    ledger=client.request('GET',f'/api/projects/{pid}/tender-guarantee')
                    next(r for r in ledger['data']['records'] if r['registration_id']==ids[0])['manual_deadline']='2026-11-24T18:00'
                    changed=save(client,pid,ledger)
                    require(next(i for i in changed['items'] if i['registration_id']==ids[0])['needs_recheck'],'deadline change did not require review')
                    require(not review(calendar(client,pid),ids[0])['completed'],'new review marked complete')
                    accepted=save(client,pid,changed,accept_recalculation=True)
                    require(not next(i for i in accepted['items'] if i['registration_id']==ids[0])['needs_recheck'],'explicit review not accepted')
                    require(review(calendar(client,pid),ids[0])['completed'],'accepted review still incomplete')
                    require(accepted['summary']['balance']==before['balance'],'review changed money')
                report.check('new deadline still requires review',recheck)
        if fixtures:
            report.check('license inputs unchanged',lambda:require(all(sha256(p)==h for p,h in hashes.items()),'test license input changed'))
        report.check('inputs unchanged',lambda:require(sha256(args.candidate)==args.candidate_sha256 and sha256(args.baseline)==args.baseline_sha256,'EXE input changed'))
    except Exception as error:
        report.metadata['error']=f'{type(error).__name__}: {error}'
        (evidence/'failure.txt').write_text(traceback.format_exc(),'utf-8')
    value=report.result()
    value['missing_required_checks']=sorted(required-{r['name'] for r in report.checks if r['passed']})
    value['passed']=value['passed'] and not value['missing_required_checks']
    (evidence/'guarantee-review-exe-acceptance.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8')
    return value


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('candidate','baseline','evidence'):parser.add_argument('--'+name,type=Path,required=True)
    for name in ('candidate-sha256','baseline-sha256','source-commit','expected-version'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--browser-executable',type=Path)
    parser.add_argument('--compatible-license-dir',type=Path)
    result=verify(parser.parse_args());print(json.dumps({k:result[k] for k in ('passed','total','failed','missing_required_checks')}))
    raise SystemExit(0 if result['passed'] else 1)
