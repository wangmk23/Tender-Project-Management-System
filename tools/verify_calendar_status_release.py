"""Hash-pinned calendar status acceptance on isolated, headless Windows EXEs."""
import argparse
from datetime import datetime,timedelta,timezone
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import traceback

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.release_browser import launch_browser,require_windows_candidate
from tools.verify_media_release import Report,require,sha256
from tools.verify_packaged_browser_acceptance import owned_client

REQUIRED={'baseline','candidate','baseline startup','candidate startup','version',
    'upgrade preserves calendar facts','real calendar status and clock','inputs unchanged'}
DAY='2026-11-10'


def seed(client):
    p=client.create_project('公开招标','calendar-status')
    pid=p['id'];stages=p['stages'][:4]
    for index,stage in enumerate(stages):
        body=dict(planned_at=DAY+['T08:00','T09:00','T10:01',''][index],
                  record_version=stage['record_version'])
        if index==0:body.update(completed=True,completed_at=DAY+'T08:30',completed_date=DAY)
        client.request('PUT',f'/api/projects/{pid}/stages/{stage["key"]}',body)
    client.request('PUT',f'/api/projects/{pid}/deadline-settings',dict(revision=0,enabled=True,regime='custom',custom_rules=[
        dict(id='custom:calendar-date',name='仅日期业务期限',days=1,day_kind='calendar',kind='maximum',include_start=False,end_policy='none',basis='合成验收')]))
    preview=client.request('POST',f'/api/projects/{pid}/deadlines/preview',dict(rule_id='custom:calendar-date',
        stage_key=stages[3]['key'],source_type='manual',source_id='calendar-date-only',start_at='2026-11-09'))
    confirmed=client.request('POST',f'/api/projects/{pid}/deadlines/confirm',dict(token=preview['token']))
    require(confirmed['item']['confirmed_deadline']==DAY,'date-only deadline fixture has unexpected precision')
    return pid,[s['key'] for s in stages]


def facts(project,keys):
    return [{k:s.get(k) for k in ('key','planned_at','completed','completed_at','skipped')}
            for s in project['stages'] if s['key'] in keys]


def start(client,evidence,label):
    try:client.start()
    except Exception:
        log=client.root/'startup.log'
        if log.is_file():(evidence/(label+'-startup.log')).write_bytes(log.read_bytes())
        raise


def browser_check(client,pid,keys,args,evidence):
    from playwright.sync_api import sync_playwright
    calendar=client.request('GET','/api/calendar?year=2026&month=11')
    (evidence/'calendar-input.json').write_text(json.dumps(calendar,ensure_ascii=False,indent=2),encoding='utf-8')
    events=next(c['events'] for c in calendar['cells'] if c.get('date_str')==DAY)
    require(sum(e.get('project_id')==pid for e in events)==5,'real calendar did not include four stages and the date-only obligation')
    with sync_playwright() as pw:
        browser,metadata=launch_browser(pw,args.browser_executable)
        try:
            context=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Shanghai',reduced_motion='reduce')
            context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
            page=context.new_page();errors=[];writes=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.on('request',lambda r:writes.append(r.url) if r.method in ('POST','PUT','DELETE','PATCH') and '/api/projects/' in r.url else None)
            page.clock.install(time=datetime(2026,11,10,10,tzinfo=timezone(timedelta(hours=8))))
            page.goto(client.base_url,wait_until='networkidle')
            page.evaluate("async()=>{switchView('calendar',{load:false});calendarYear=2026;calendarMonth=11;calendarSelectedDate='2026-11-10';await loadCalendar({force:true});}")
            page.locator('.calendar-agenda-item').first.wait_for()
            rows=[page.locator(f'.calendar-agenda-item[data-stage-key="{key}"][onclick^="openCalendarStage"]') for key in keys]
            date_only=page.locator('.calendar-agenda-item[onclick^="showBusinessDeadlines"]')
            labels=[row.locator('.calendar-node-status').inner_text() for row in rows]
            # Legacy stage storage normalizes a date-only request to explicit
            # 00:00. Preserve that fact; the independent obligation retains dates.
            require(labels==['已完成','逾期未完成','待办','逾期未完成'],'calendar status labels differ: '+str(labels))
            require(date_only.locator('.calendar-node-status').inner_text()=='待办','date-only obligation expired before day end')
            day=page.locator('[data-calendar-date="2026-11-10"]')
            require('2个逾期未完成' in day.get_attribute('aria-label'),'day status summary missing')
            day.focus();focused=page.evaluate('document.activeElement.dataset.calendarDate')
            page.clock.fast_forward(120000)
            page.wait_for_function('(key)=>document.querySelector(`.calendar-agenda-item[data-stage-key="${key}"][onclick^="openCalendarStage"] .calendar-node-status`)?.textContent==="逾期未完成"',arg=keys[2])
            require(page.evaluate('document.activeElement.dataset.calendarDate')==focused,'minute refresh stole keyboard focus')
            require(rows[0].locator('.calendar-node-status').inner_text()=='已完成','completed stage turned overdue')
            require(date_only.locator('.calendar-node-status').inner_text()=='待办','date-only obligation expired before day end')
            for theme in ('default','dark','blue','green'):
                page.evaluate('(theme)=>setTheme(theme)',theme)
                for width in (1440,390):
                    page.set_viewport_size({'width':width,'height':1000 if width==1440 else 844})
                    require(not page.locator('#calendarContent').evaluate('(e)=>e.scrollWidth>e.clientWidth+2'),'calendar overflows narrow layout')
                    require(rows[0].locator('.calendar-node-status').is_visible(),'agenda status hidden')
                    page.screenshot(path=str(evidence/f'calendar-{theme}-{width}.png'),full_page=True,animations='disabled')
            rows[1].click()
            page.wait_for_function('(key)=>editingStageKey===key&&document.querySelector("#slidePanel.open .stage-editor")',arg=keys[1])
            require(not writes,'calendar display or clock wrote project records: '+str(writes))
            require(not errors,'browser errors: '+'; '.join(errors))
            context.close()
            return dict(browser=metadata,screenshots=8,initial_statuses=labels,
                clock_advanced_ms=120000,minute_refresh_preserves_focus=True,
                date_only_waits_for_day_end=True,stage_opening_preserved=True,project_writes=writes,page_errors=errors)
        finally:browser.close()


def verify(args):
    evidence=args.evidence.resolve();evidence.mkdir(parents=True,exist_ok=False)
    report=Report(emit=True);fixtures=args.compatible_license_dir;required=REQUIRED|({'license inputs unchanged'} if fixtures else set())
    report.metadata.update(source_commit=args.source_commit,expected_version=args.expected_version,
        candidate_sha256=args.candidate_sha256,baseline_sha256=args.baseline_sha256,edition='compatible' if fixtures else 'public',
        harness_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        environment=platform.platform(),python=sys.version,complete_release_acceptance=False,
        manual_checks=['native desktop and display scaling','physical phones and deployment networks'])
    try:
        require(bool(re.fullmatch('[0-9a-f]{40}',args.source_commit)),'full immutable source SHA required')
        report.check('baseline',lambda:require_windows_candidate(args.baseline,args.baseline_sha256))
        report.check('candidate',lambda:require_windows_candidate(args.candidate,args.candidate_sha256))
        hashes={}
        if fixtures:
            from tools.verify_local_files_release import compatible_client
            fixtures=fixtures.resolve(strict=True);require((fixtures/'license.dat').is_file(),'compatible test license missing')
            hashes={p.name:sha256(p) for p in fixtures.iterdir() if p.is_file() and p.name in ('license.dat','.license_state.bin','license_public_key.pem')}
            factory=lambda exe,root,label,profile:compatible_client(exe,root,label,fixtures,profile)
        else:factory=lambda exe,root,label,profile:owned_client(exe,root,label,retained_profile=profile)
        with tempfile.TemporaryDirectory(prefix='pm-calendar-status-') as temp:
            root=Path(temp);profile=root/'profile'
            with factory(args.baseline.resolve(),root,'baseline',profile) as old:
                report.check('baseline startup',lambda:start(old,evidence,'baseline'))
                pid,keys=seed(old);before=facts(old.get_project(pid),keys);password=old.password
            with factory(args.candidate.resolve(),root,'candidate',profile) as client:
                client.password=password;report.check('candidate startup',lambda:start(client,evidence,'candidate'))
                report.check('version',lambda:require(client.request('GET','/api/system-info')['version']==args.expected_version,'candidate version mismatch'))
                report.check('upgrade preserves calendar facts',lambda:require(facts(client.get_project(pid),keys)==before,'upgrade changed planned or completed stage facts'))
                report.check('real calendar status and clock',lambda:browser_check(client,pid,keys,args,evidence))
                require(facts(client.get_project(pid),keys)==before,'calendar browser changed business records')
        if fixtures:report.check('license inputs unchanged',lambda:require(all(sha256(fixtures/name)==digest for name,digest in hashes.items()),'compatible authorization input changed'))
        report.check('inputs unchanged',lambda:require(sha256(args.candidate)==args.candidate_sha256 and sha256(args.baseline)==args.baseline_sha256,'frozen inputs changed'))
    except Exception as error:
        report.metadata['error']=f'{type(error).__name__}: {error}';(evidence/'failure.txt').write_text(traceback.format_exc(),encoding='utf-8')
    value=report.result();value['missing_required_checks']=sorted(required-{r['name'] for r in report.checks if r['passed']})
    value['passed']=value['passed'] and not value['missing_required_checks']
    (evidence/'calendar-status-exe-acceptance.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return value


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('candidate','baseline','evidence'):parser.add_argument('--'+name,type=Path,required=True)
    for name in ('candidate-sha256','baseline-sha256','source-commit','expected-version'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--browser-executable',type=Path);parser.add_argument('--compatible-license-dir',type=Path)
    result=verify(parser.parse_args());print(json.dumps({k:result[k] for k in ('passed','total','failed','missing_required_checks')}))
    raise SystemExit(0 if result['passed'] else 1)
