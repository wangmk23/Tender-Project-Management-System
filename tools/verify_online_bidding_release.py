"""Hash-pinned Windows auction upgrade/API/browser acceptance with synthetic data."""
import argparse
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

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tools.release_browser import launch_browser, require_windows_candidate
from tools.verify_media_release import Report, require, sha256
from tools.verify_packaged_browser_acceptance import owned_client

REQUIRED = {'baseline', 'candidate', 'baseline startup', 'candidate startup', 'version',
    'upgrade retains draft', 'invalid confirmation leaves all records unchanged',
    'confirmation saves ledger result and stage', 'replayed request conflicts without duplicate',
    'reopen preserves original result', 'supplier quantity gate preserved',
    'viewer cannot confirm', 'browser confirmation and layouts', 'inputs unchanged'}


def seed(client, suffix):
    p = client.create_project('网上竞价', suffix)
    pid = p['id']
    client.request('PUT', f'/api/projects/{pid}', {'no_deposit': True})
    regs = [client.request('POST', f'/api/projects/{pid}/registrations', {'company_name': name})
            for name in ('验收甲供应商', '验收乙供应商', '验收丙供应商')]
    state = client.request('GET', f'/api/projects/{pid}/tender-guarantee')
    client.request('PUT', f'/api/projects/{pid}/tender-guarantee', dict(revision=state['revision'],
        reason='隔离验收实际参与',confirm_roster=True,data=dict(confirmed=True,rules=[],records=[
            dict(registration_id=r['id'],participation='submitted',validity='valid',deposit_status='unknown',handling='review') for r in regs])))
    data = dict(registration_end='2026-09-19T18:00',roster_locked=True,
        start_at='2026-09-20T09:00',end_at='2026-09-20T12:00',ended_at='2026-09-20T12:00',
        end_reason='deadline',evidence='https://example.test/synthetic-result',records=[
            dict(registration_id=r['id'],company_name=r['company_name'],lot_id=None,review='approved',
                 amount=amount,quoted_at=quoted) for r,amount,quoted in zip(regs,
                    ('110.01','120.02','130.03'),('2026-09-20T09:01:17','2026-09-20T09:02:09','2026-09-20T09:03:20'))])
    ledger = client.request('PUT', f'/api/projects/{pid}/online-bidding',dict(revision=0,data=data,stage_key='online_quotation'))
    return pid, ledger


def body(client, pid):
    p = client.get_project(pid)
    ledger = client.request('GET', f'/api/projects/{pid}/online-bidding')
    stage = next(s for s in p['stages'] if s['key'] == 'online_quotation')
    return dict(revision=ledger['revision'],stage_key='online_quotation',stage_record_version=stage['record_version'],
        data=ledger['data'],stage_data={'notes':'隔离成品验收'},reason='核对隔离平台结果')


def post(client, pid, data, expected, action='confirm'):
    response = client.session.post(client.base_url+f'/api/projects/{pid}/online-bidding/{action}',json=data,
        headers={'X-CSRFToken':client.csrf_token},timeout=15)
    require(response.status_code == expected, f'confirmation HTTP {response.status_code}: {response.text[:400]}')
    return response.json()


def verify(args):
    evidence = args.evidence.resolve()
    evidence.mkdir(parents=True, exist_ok=False)
    report = Report(emit=True)
    fixtures=getattr(args,'compatible_license_dir',None)
    required=REQUIRED | ({'license inputs unchanged'} if fixtures else set())
    report.metadata['edition']='compatible' if fixtures else 'public'
    report.metadata.update(source_commit=args.source_commit,expected_version=args.expected_version,
        candidate_sha256=args.candidate_sha256,baseline_sha256=args.baseline_sha256,
        environment=platform.platform(),python=sys.version,
        harness_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        complete_release_acceptance=False,manual_checks=['原生窗口及显示缩放','真实手机和外网'])
    try:
        require(re.fullmatch('[0-9a-f]{40}',args.source_commit),'full source SHA required')
        report.check('baseline',lambda:require_windows_candidate(args.baseline,args.baseline_sha256))
        report.check('candidate',lambda:require_windows_candidate(args.candidate,args.candidate_sha256))
        fixture_hashes={}
        if fixtures:
            from tools.verify_local_files_release import compatible_client
            fixtures=fixtures.resolve(strict=True)
            require((fixtures/'license.dat').is_file(),'compatible test authorization missing')
            fixture_hashes={p.name:sha256(p) for p in fixtures.iterdir() if p.is_file() and p.name in ('license.dat','.license_state.bin','license_public_key.pem')}
            factory=lambda executable,root,label,profile:compatible_client(executable,root,label,fixtures,profile)
        else:
            factory=lambda executable,root,label,profile:owned_client(executable,root,label,retained_profile=profile)
        with tempfile.TemporaryDirectory(prefix='pm-bidding-owned-') as directory:
            root = Path(directory).resolve()
            profile = root/'profile'
            with factory(args.baseline.resolve(),root,'baseline',profile) as old:
                report.check('baseline startup',lambda:start_recorded(old,evidence,'baseline'))
                pid, original = seed(old,'upgrade')
                password = old.password
            with factory(args.candidate.resolve(),root,'candidate',profile) as client:
                client.password = password
                report.check('candidate startup',lambda:start_recorded(client,evidence,'candidate'))
                report.check('version',lambda:require(client.request('GET','/api/system-info')['version']==args.expected_version,'candidate version mismatch'))
                current = client.request('GET',f'/api/projects/{pid}/online-bidding')
                report.check('upgrade retains draft',lambda:require(current['data']==original['data'] and current['revision']==original['revision'],'legacy auction changed during upgrade'))
                request = body(client,pid)
                invalid = copy.deepcopy(request);invalid['data']['evidence']=''
                def rejected():
                    post(client,pid,invalid,400)
                    after=client.request('GET',f'/api/projects/{pid}/online-bidding')
                    p=client.get_project(pid)
                    require(after==current and not p['bid_results'] and not next(s for s in p['stages'] if s['key']=='online_quotation')['completed'],'invalid submission partly saved')
                report.check('invalid confirmation leaves all records unchanged',rejected)
                def confirmed():
                    post(client,pid,request,200)
                    p=client.get_project(pid)
                    ledger=client.request('GET',f'/api/projects/{pid}/online-bidding')
                    require(ledger['data']['verified'] and len(p['bid_results'])==1 and p['bid_results'][0]['winning_supplier']=='验收甲供应商','canonical winner mismatch')
                    require(next(s for s in p['stages'] if s['key']=='online_quotation')['completed'],'stage incomplete')
                    require(not ledger['data']['publication_done'],'quotation advanced publication')
                report.check('confirmation saves ledger result and stage',confirmed)
                def replayed():
                    post(client,pid,request,409)
                    require(len(client.get_project(pid)['bid_results'])==1,'replay created duplicate')
                report.check('replayed request conflicts without duplicate',replayed)
                def reopened():
                    current_body=body(client,pid)
                    original_data=current_body.pop('data')
                    current_body.pop('stage_data')
                    post(client,pid,current_body,200,'reopen')
                    latest=client.get_project(pid)
                    ledger=client.request('GET',f'/api/projects/{pid}/online-bidding')
                    require(ledger['data']==dict(original_data,verified=False),'reopen changed source quotes')
                    require(len(latest['bid_results'])==1 and not next(s for s in latest['stages'] if s['key']=='online_quotation')['completed'],'reopen removed winner or kept completion')
                report.check('reopen preserves original result',reopened)
                def quantity_gate():
                    short_pid,_=seed(client,'quantity')
                    state=client.request('GET',f'/api/projects/{short_pid}/tender-guarantee')
                    state['data']['records'][-1].update(participation='absent',validity='invalid',reason='隔离验收未实际参与')
                    client.request('PUT',f'/api/projects/{short_pid}/tender-guarantee',dict(revision=state['revision'],data=state['data'],confirm_roster=True,reason='核对隔离缺席事实'))
                    state=client.request('GET',f'/api/projects/{short_pid}/online-bidding')
                    state['data']['records'][-1].update(amount='',quoted_at='')
                    client.request('PUT',f'/api/projects/{short_pid}/online-bidding',dict(revision=state['revision'],data=state['data'],stage_key='online_quotation',reason='隔离验收未报价'))
                    denial=post(client,short_pid,body(client,short_pid),409)
                    require(denial.get('code')=='SUPPLIER_QUANTITY_CONFIRMATION_REQUIRED','quantity gate not preserved')
                    require(not client.get_project(short_pid)['bid_results'],'shortage partly created result')
                report.check('supplier quantity gate preserved',quantity_gate)
                def viewer_denied():
                    from tools.verify_account_backup_release import login
                    client.request('POST','/api/users',dict(username='auction_viewer',password='Synthetic-viewer-password',role='viewer'))
                    viewer=login(client.base_url,'auction_viewer','Synthetic-viewer-password')
                    try:post(viewer,pid,body(client,pid),403)
                    finally:viewer.session.close()
                report.check('viewer cannot confirm',viewer_denied)
                report.check('browser confirmation and layouts',lambda:browser_checks(client,args,evidence))
        if fixtures:
            report.check('license inputs unchanged',lambda:require(all(sha256(fixtures/name)==digest for name,digest in fixture_hashes.items()),'compatible test license input changed'))
        report.check('inputs unchanged',lambda:require(sha256(args.candidate)==args.candidate_sha256 and sha256(args.baseline)==args.baseline_sha256,'build inputs changed'))
    except Exception as error:
        report.metadata['error']=f'{type(error).__name__}: {error}'
        (evidence/'failure.txt').write_text(traceback.format_exc(),'utf-8')
    result=report.result()
    result['missing_required_checks']=sorted(required-{row['name'] for row in report.checks if row['passed']})
    result['passed']=result['passed'] and not result['missing_required_checks']
    (evidence/'online-bidding-exe-acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8')
    return result


def start_recorded(client,evidence,label):
    try:
        client.start()
    except Exception:
        log=client.root/'startup.log'
        if log.is_file():shutil.copy2(log,evidence/(label+'-startup-failure.log'))
        raise


def browser_checks(client,args,evidence):
    from playwright.sync_api import sync_playwright
    pid,_=seed(client,'browser')
    with sync_playwright() as pw:
        browser,metadata=launch_browser(pw,args.browser_executable)
        try:
            context=browser.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Shanghai',reduced_motion='reduce')
            context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
            page=context.new_page();errors=[]
            page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(client.base_url,wait_until='networkidle')
            page.evaluate('(pid)=>selectProject(pid)',pid)
            page.wait_for_function('(pid)=>currentProject?.id===pid',arg=pid)
            require(page.locator('.online-stage-rail > .online-stage-group').count()==7,'seven navigation groups missing')
            page.evaluate("openStageSlide('online_quotation')")
            page.locator('#ob_evidence').wait_for(state='attached')
            action=page.get_by_role('button',name='核对平台结果并完成竞价',exact=True)
            action.click()
            page.get_by_role('button',name='取消',exact=True).last.click()
            require(not client.get_project(pid)['bid_results'],'cancelled dialog wrote results')
            action.click()
            with page.expect_response(lambda r:r.url.endswith('/online-bidding/confirm') and r.request.method=='POST') as captured:
                page.get_by_role('button',name='确认成交并完成',exact=True).click()
            require(captured.value.status==200,'browser confirmation rejected')
            require(len(client.get_project(pid)['bid_results'])==1,'browser result missing or duplicated')
            page.evaluate("openStageSlide('online_quotation')")
            page.locator('#ob_evidence').wait_for(state='attached')
            for theme in ('default','dark','blue','green'):
                page.evaluate('(theme)=>setTheme(theme)',theme)
                for width in (1440,390):
                    page.set_viewport_size({'width':width,'height':1000 if width==1440 else 844})
                    require(not page.locator('#slidePanel').evaluate('(e)=>e.scrollWidth>e.clientWidth+2'),'drawer overflows')
                    page.locator('#slidePanel').screenshot(path=str(evidence/f'{theme}-{width}.png'),animations='disabled',timeout=10000)
            fee_result=fee_notice_checks(page,client,pid,evidence)
            require(not errors,'browser exceptions: '+'; '.join(errors))
            context.close()
            return dict(browser=metadata,screenshots=16,confirmation_transport='real EXE POST',fee_notice=fee_result,page_errors=errors)
        finally:browser.close()


def fee_notice_checks(page,client,pid,evidence):
    """Exercise the formerly ambiguous fee/notice drawer through real frozen routes."""
    path=f'/api/projects/{pid}/online-bidding'
    ledger=client.request('GET',path)
    ledger['data'].update(publication_done=True,publication_date='2026-09-21',publication_url='https://example.test/synthetic-publication')
    client.request('PUT',path,dict(revision=ledger['revision'],data=ledger['data'],stage_key='result_announced',reason='隔离验收公示'))
    page.evaluate("async()=>{await refreshProject();openStageSlide('online_fee_notice');}")
    page.locator('[data-ob-fee-status]').wait_for(state='attached')
    choose_today(page,'ob_fee_date')
    page.locator('#ob_fee_reference').fill('隔离成品到账凭证001')
    with page.expect_response(lambda r:r.url.endswith(path) and r.request.method=='PUT') as saved:
        page.get_by_role('button',name='保存并确认到账',exact=True).click()
    require(saved.value.status==200,'fee-only save failed')
    ledger=client.request('GET',path)
    require(ledger['data']['fee_received'] and not ledger['data']['notice_delivered'],'fee save completed notice implicitly')
    require(not next(s for s in client.get_project(pid)['stages'] if s['key']=='online_fee_notice')['completed'],'fee-only save completed merged stage')
    page.wait_for_function("()=>document.querySelector('[data-ob-fee-status]').textContent.includes('已确认')")
    page.locator('#stageCompletedLabel').click()
    page.locator('#stageSaveError').wait_for(state='attached')
    require('通知书' in page.locator('#stageSaveError').inner_text(),'missing notice did not identify the actual missing record')
    require('请先确认服务费到账' not in page.locator('#stageSaveError').inner_text(),'received fee misreported as missing')
    require(client.request('GET',path)['revision']==ledger['revision'],'invalid completion wrote ledger')
    for theme in ('default','dark','blue','green'):
        page.evaluate('(theme)=>setTheme(theme)',theme)
        for width in (1440,390):
            page.set_viewport_size({'width':width,'height':1000 if width==1440 else 844})
            require(not page.locator('#slidePanel').evaluate('(e)=>e.scrollWidth>e.clientWidth+2'),'fee drawer overflows')
            require(page.locator('[data-ob-confirm-fee]').evaluate('(e)=>e.getBoundingClientRect().height>=44'),'fee button touch target too small')
            page.locator('#slidePanel').screenshot(path=str(evidence/f'fee-{theme}-{width}.png'),animations='disabled',timeout=10000)
    page.get_by_role('button',name='查看／登记通知书',exact=True).click()
    page.get_by_role('button',name='新增通知书领取记录',exact=True).click()
    choose_today(page,'noticePickupDate')
    with page.expect_response(lambda r:r.url.endswith('/notice-deliveries') and r.request.method=='POST') as notice:
        page.locator('#modalSaveBtn').click()
    require(notice.value.status in (200,201),'notice registration failed after saved fee')
    page.wait_for_function("()=>document.querySelector('[data-ob-fee-status]')?.textContent.includes('资料已齐备')")
    page.locator('#stageCompletedLabel').click()
    page.wait_for_function("()=>currentProject?.stages.find(s=>s.key==='online_fee_notice')?.completed===true")
    project=client.get_project(pid)
    require(len(project['notice_deliveries'])==1,'notice missing or duplicated')
    ledger=client.request('GET',path)
    require(ledger['data']['notice_delivered'] and next(s for s in project['stages'] if s['key']=='online_fee_notice')['completed'],'complete fee and notice did not advance stage')
    page.evaluate("syncAccountAccess({role:'viewer'})")
    require(page.locator('[data-ob-confirm-fee]').is_disabled(),'viewer sees enabled fee confirmation')
    page.evaluate("syncAccountAccess({role:'admin'});syncApplicationAccess({mode:'read_only'})")
    require(page.locator('[data-ob-confirm-fee]').is_disabled(),'read-only license sees enabled fee confirmation')
    page.evaluate("syncApplicationAccess({mode:'full'})")
    require(page.locator('[data-ob-confirm-fee]').is_enabled(),'fee action not restored with authorization')
    return dict(fee_saved_before_notice=True,missing_notice_rejected_without_write=True,
        actual_notice_registered=True,merged_stage_completed=True,viewer_and_read_only_ui_denied=True)


def choose_today(page,field_id):
    # The product hides the native input behind its accessible shared picker.
    page.locator('#'+field_id).locator('..').locator('.pm-datetime-trigger').click()
    popup=page.locator('#pmDateTimePopup')
    popup.get_by_role('button',name='现在',exact=True).click()
    popup.get_by_role('button',name='确定',exact=True).click()


def parser():
    value=argparse.ArgumentParser(description=__doc__)
    for name in ('candidate','baseline','evidence'):value.add_argument('--'+name,type=Path,required=True)
    for name in ('candidate-sha256','baseline-sha256','expected-version','source-commit'):value.add_argument('--'+name,required=True)
    value.add_argument('--browser-executable',type=Path)
    value.add_argument('--compatible-license-dir',type=Path,help='Explicit isolated compatibility authorization fixture; never published')
    return value


if __name__=='__main__':
    result=verify(parser().parse_args())
    print(json.dumps({k:result[k] for k in ('passed','total','failed','missing_required_checks')},ensure_ascii=False))
    raise SystemExit(0 if result['passed'] else 1)
