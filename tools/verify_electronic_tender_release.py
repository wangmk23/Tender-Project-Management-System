"""Hash-pinned Windows EXE acceptance of the existing public-tender electronic flow."""
from __future__ import annotations
import argparse,json,sys,tempfile,traceback,shutil,platform
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tools.release_browser import require_windows_candidate,launch_browser
from tools.verify_packaged_browser_acceptance import owned_client
from tools.verify_local_files_release import compatible_client
from playwright.sync_api import sync_playwright

REQUIRED={'baseline hash','candidate hash','ordinary upgrade unchanged','create dropdown original flow','before cutoff blocked',
          'registration count without names','cutoff controls refresh after plan save','conflict reload without draft','shortage cancellation and liubiao','zero and one liubiao','opening original supplier form',
          'opening quotes required and preserved','repeat and foreign supplier rejected','opening completes normally','closed package history does not block active package','existing information mode correction preserves old records','existing information ordinary save and cancellation','existing information reversal preserves electronic ledger','viewer write denied','inputs unchanged'}


def verify(args):
    out=args.evidence.resolve();out.mkdir(parents=True,exist_ok=False);checks=[];errors=[];client=None
    result=dict(source_commit=args.source_commit,candidate_sha256=args.candidate_sha256,baseline_sha256=args.baseline_sha256,
                expected_version=args.expected_version,environment=platform.platform(),native_desktop_verified=False,
                production_data_modified=False,actual_phone_verified=False,real_mail_sent=0,complete_release_acceptance=False)
    def check(name,ok=True):
        checks.append(dict(name=name,passed=bool(ok)));assert ok,name
        print(json.dumps(dict(name=name,passed=bool(ok)),ensure_ascii=False),flush=True)
    def post_count(c,pid,value,confirm=False):
        e=c.request('GET',f'/api/projects/{pid}/electronic-tender')
        body=dict(revision=e['revision'],record_version=e['record_version'],counts=[dict(lot_id=None,count=value)],confirm_shortage=confirm)
        r=c.session.put(c.base_url+f'/api/projects/{pid}/electronic-tender/registration',json=body,headers={'X-CSRFToken':c.csrf_token},timeout=20)
        return r,body
    def stages(p):return [(s['key'],s.get('completed'),s.get('skipped'),s.get('planned_at')) for s in p['stages']]
    def select(page,pid,key):
        page.evaluate("async([pid,key])=>{await selectProject(pid);await refreshProject();currentProject.electronic_tender=null;await openStageSlide(key);}",[pid,key])
    try:
        check('baseline hash',bool(require_windows_candidate(args.baseline,args.baseline_sha256)))
        check('candidate hash',bool(require_windows_candidate(args.candidate,args.candidate_sha256)))
        with tempfile.TemporaryDirectory(prefix='pm-electronic-acceptance-',ignore_cleanup_errors=True) as directory:
            root=Path(directory);profile=root/'profile'
            factory=(lambda exe,label:compatible_client(exe,root,label,args.compatible_license_dir,profile)) if args.compatible_license_dir else (lambda exe,label:owned_client(exe,root,label,retained_profile=profile))
            with factory(args.baseline.resolve(),'baseline') as old:
                old.start();ordinary=old.create_project('公开招标','普通公开招标升级对照');oldpid=ordinary['id']
                historical=[old.request('POST',f'/api/projects/{oldpid}/registrations',dict(company_name='历史供应商'+n)) for n in ['甲','乙','丙']]
                upload=old.session.post(old.base_url+f'/api/projects/{oldpid}/attachments',data=dict(registration_id=historical[0]['id']),files={'files':('历史说明.txt',b'Historical attachment is retained.','text/plain')},headers={'X-CSRFToken':old.csrf_token},timeout=20);assert upload.status_code==200,upload.text
                guaranteed=old.request('GET',f'/api/projects/{oldpid}/tender-guarantee');data=guaranteed['data'];data.update(confirmed=True,records=[dict(registration_id=r['id'],participation='submitted',validity='valid',deposit_status='paid',deposit_amount='4000',refunded_amount='0',handling='rule') for r in historical])
                old.request('PUT',f'/api/projects/{oldpid}/tender-guarantee',dict(revision=guaranteed['revision'],data=data,confirm_roster=True,reason='隔离历史数据核对'))
                ordinary=old.get_project(oldpid);oldreg=next(s['key'] for s in ordinary['stages'] if 'registration' in s['modules'])
                old.request('PUT',f'/api/projects/{oldpid}/stages/{oldreg}',dict(planned_at='2000-01-01T10:00',completed=True,completed_at='2026-01-01T10:00',notes='保留原阶段记录'))
                ordinary=old.get_project(oldpid);before=stages(ordinary);cash_before=old.request('GET',f'/api/projects/{oldpid}/tender-guarantee')['data']['records'];password=old.password
            with factory(args.candidate.resolve(),'candidate') as c:
                client=c;c.password=password;c.start();assert c.request('GET','/api/system-info')['version']==args.expected_version
                upgraded=c.get_project(ordinary['id']);check('ordinary upgrade unchanged',before==stages(upgraded) and not upgraded.get('procurement',{}).get('electronic_tender'))
                with sync_playwright() as pw:
                    browser,browser_info=launch_browser(pw,args.browser_executable);result['browser']=browser_info
                    try:
                        context=browser.new_context(viewport=dict(width=1440,height=1000),locale='zh-CN',timezone_id='Asia/Shanghai')
                        context.add_cookies([dict(name=k.name,value=k.value,url=c.base_url) for k in c.session.cookies]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                        page.goto(c.base_url,wait_until='networkidle');page.wait_for_function("typeof showNewProjectModal==='function'")
                        page.evaluate('async(id)=>{await selectProject(id);switchProjectTab("info");}',oldpid)
                        choice=page.locator('#infoMethod');base_method=upgraded['procurement']['method_id'];choice.select_option('electronic:'+base_method)
                        save_info=page.locator('#infoContent button[onclick="saveProjectInfo()"]')
                        save_info.click();page.locator('#confirmOk').click()
                        page.wait_for_function('document.querySelector("#infoMethod")?.value.startsWith("electronic:")&&currentProject.procurement?.electronic_tender===true')
                        converted=c.get_project(oldpid);e=c.request('GET',f'/api/projects/{oldpid}/electronic-tender')
                        check('existing information mode correction preserves old records',stages(converted)==before and len(converted['registrations'])==3 and len(converted['registrations'][0]['attachments'])==1 and c.request('GET',f'/api/projects/{oldpid}/tender-guarantee')['data']['records']==cash_before and e['counts']==[])
                        accepted,_=post_count(c,oldpid,3);assert accepted.status_code==200
                        e=c.request('GET',f'/api/projects/{oldpid}/electronic-tender');saved_quotes=c.request('PUT',f'/api/projects/{oldpid}/electronic-tender/quotes',dict(revision=e['revision'],record_version=e['record_version'],quotes=[dict(registration_id=r['id'],amount=str(100+i)) for i,r in enumerate(historical)]))
                        page.evaluate('async()=>{await refreshProject();switchProjectTab("info");}')
                        page.locator('#infoNotes').fill('只更正备注，电子标继续保留')
                        with page.expect_response(lambda r:r.url.endswith(f'/api/projects/{oldpid}') and r.request.method=='PUT') as info_saved:save_info.click()
                        assert info_saved.value.status==200
                        page.wait_for_function('currentProject.notes==="只更正备注，电子标继续保留"')
                        choice.select_option(base_method);save_info.click();page.locator('#confirmCancel').click()
                        check('existing information ordinary save and cancellation',c.get_project(oldpid)['procurement']['electronic_tender'] and choice.input_value()==base_method)
                        for selected in [base_method,'electronic:'+base_method]:
                            choice.select_option(selected);save_info.click();page.locator('#confirmOk').click()
                            expected=selected.startswith('electronic:')
                            page.wait_for_function('(flag)=>!!currentProject.procurement?.electronic_tender===flag',arg=expected)
                        restored=c.request('GET',f'/api/projects/{oldpid}/electronic-tender')
                        check('existing information reversal preserves electronic ledger',restored['revision']==saved_quotes['revision'] and restored['quotes']==saved_quotes['quotes'] and restored['counts']==saved_quotes['counts'] and stages(c.get_project(oldpid))==before and c.request('GET',f'/api/projects/{oldpid}/tender-guarantee')['data']['records']==cash_before)
                        page.screenshot(path=str(out/'已有项目-信息页切换电子标.png'),full_page=True,animations='disabled')
                        page.evaluate('showNewProjectModal()');options=page.locator('#npMethod option').evaluate_all("rows=>rows.map(r=>({value:r.value,text:r.textContent}))")
                        electronic=next(r['value'] for r in options if r['text']=='公开招标-电子标')
                        page.locator('#npMethod').select_option(electronic);page.locator('#npName').fill('电子标成品验收');page.locator('#npNumber').fill('EXE-ELECTRONIC-001');page.locator('.new-project-guarantee .toggle-row').click()
                        page.screenshot(path=str(out/'原系统创建项目-电子标.png'),full_page=True,animations='disabled')
                        with page.expect_response(lambda r:r.url.endswith('/api/projects') and r.request.method=='POST') as created:page.locator('#npCreateBtn').click()
                        assert created.value.status==201;project=created.value.json();pid=project['id'];mid=project['procurement']['method_id']
                        reg=next(s['key'] for s in project['stages'] if 'registration' in s['modules']);opening=next(s['key'] for s in project['stages'] if 'bid_opening' in s['modules'])
                        check('create dropdown original flow',project['procurement']['electronic_tender'] and [s['key'] for s in project['stages']]==[s['key'] for s in upgraded['stages']])
                        c.request('PUT',f'/api/projects/{pid}/stages/{reg}',dict(planned_at='2999-01-01T10:00'))
                        r,_=post_count(c,pid,3)
                        direct=c.session.post(c.base_url+f'/api/projects/{pid}/registrations',json=dict(company_name='不应提前录入'),headers={'X-CSRFToken':c.csrf_token},timeout=20)
                        check('before cutoff blocked',r.status_code==409 and direct.status_code==409 and not c.get_project(pid)['registrations'])
                        select(page,pid,reg);page.locator('[data-electronic-count]').wait_for()
                        assert page.locator('[data-electronic-count]').get_attribute('readonly') is not None
                        assert page.evaluate("async()=>{document.getElementById('stagePlannedAt').value='2000-01-01';document.getElementById('stagePlannedTime').value='10:00';return await saveStageFromSlide();}")
                        check('cutoff controls refresh after plan save',not page.locator('[data-electronic-count]').evaluate('(e)=>e.readOnly') and page.locator('[data-electronic-count-save]').is_visible())
                        assert page.locator('#slideBody [onclick*=showRegistrationForm]').count()==0
                        for theme in ['default','dark','blue','green']:
                            page.evaluate('(t)=>setTheme(t)',theme)
                            for width in [1440,390]:
                                page.set_viewport_size(dict(width=width,height=1000 if width==1440 else 844))
                                assert not page.locator('#slidePanel').evaluate('(e)=>e.scrollWidth>e.clientWidth+2')
                                page.locator('#slidePanel').screenshot(path=str(out/f'原系统报名-{theme}-{width}.png'),animations='disabled')
                        page.set_viewport_size(dict(width=1440,height=1000));page.evaluate("setTheme('default')")
                        page.locator('[data-electronic-count]').fill('3')
                        with page.expect_response(lambda r:r.url.endswith('/electronic-tender/registration') and r.request.method=='PUT') as saved:page.locator('[data-electronic-count-save]').click()
                        assert saved.value.status==200
                        project=c.get_project(pid);check('registration count without names',not project['registrations'] and next(s for s in project['stages'] if s['key']==reg)['completed'] and not project['is_terminated'])
                        select(page,pid,reg);page.locator('[data-electronic-count]').wait_for()
                        old_token=page.locator('[data-electronic-registration]').evaluate('(e)=>e.electronicState.record_version')
                        c.request('PUT',f'/api/projects/{pid}',dict(purchaser='隔离第二窗口更正'))
                        with page.expect_response(lambda r:r.url.endswith('/electronic-tender/registration') and r.request.method=='PUT') as conflict:page.locator('[data-electronic-count-save]').click()
                        assert conflict.value.status==409
                        page.get_by_role('button',name='重新读取并核对草稿',exact=True).click()
                        page.wait_for_function('(old)=>document.querySelector("[data-electronic-registration]")?.electronicState?.record_version!==old',arg=old_token)
                        check('conflict reload without draft',page.locator('[data-electronic-count]').input_value()=='3')
                        def new_e(number):
                            p=c.request('POST','/api/projects',dict(number=number,name=number,procurement_method_id=mid,electronic_tender=True,no_deposit=True))
                            k=next(s['key'] for s in p['stages'] if 'registration' in s['modules']);c.request('PUT',f"/api/projects/{p['id']}/stages/{k}",dict(planned_at='2000-01-01T10:00'));return p,k
                        short,skey=new_e('ELECTRONIC-SHORT');select(page,short['id'],skey);page.locator('[data-electronic-count]').fill('2');page.locator('[data-electronic-count-save]').click();page.locator('#confirmCancel').click()
                        assert not c.get_project(short['id'])['is_terminated'] and not c.request('GET',f"/api/projects/{short['id']}/electronic-tender")['counts']
                        page.locator('[data-electronic-count-save]').click();page.locator('#confirmOk').click();page.wait_for_selector('#slidePanel.open',state='hidden')
                        failed=c.get_project(short['id']);check('shortage cancellation and liubiao',failed['is_terminated'] and failed['terminated_type']=='liubiao' and not failed['registrations'])
                        for n in [0,1]:
                            small,_=new_e('ELECTRONIC-SHORT-'+str(n));rejected,_=post_count(c,small['id'],n);assert rejected.status_code==409;accepted,_=post_count(c,small['id'],n,True);assert accepted.status_code==200 and c.get_project(small['id'])['terminated_type']=='liubiao'
                        check('zero and one liubiao')
                        select(page,pid,opening);page.get_by_role('button',name='登记供应商',exact=True).click();page.locator('#regCompany').fill('成品解密供应商甲')
                        with page.expect_response(lambda r:r.url.endswith('/registrations') and r.request.method=='POST') as registered:page.locator('#modalSaveBtn').click()
                        assert registered.value.status in [200,201];page.wait_for_selector('#modal.open',state='hidden')
                        # Closing the original form precedes its asynchronous project refresh.
                        page.wait_for_function("document.querySelectorAll('[data-electronic-quote]').length===1")
                        check('opening original supplier form',page.locator('[data-electronic-quote]').count()==1 and page.locator('[data-electronic-registration]').count()==0)
                        for name in ['成品解密供应商乙','成品解密供应商丙']:c.request('POST',f'/api/projects/{pid}/registrations',dict(company_name=name))
                        project=c.get_project(pid);regs=project['registrations'];l=c.request('GET',f'/api/projects/{pid}/tender-guarantee');data=l['data'];data.update(confirmed=True,records=[dict(registration_id=r['id'],participation='submitted',validity='valid',deposit_status='unknown',handling='review') for r in regs])
                        c.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(revision=l['revision'],data=data,confirm_roster=True,reason='隔离成品开标核对'))
                        refused=c.session.put(c.base_url+f'/api/projects/{pid}/stages/{opening}',json=dict(completed=True),headers={'X-CSRFToken':c.csrf_token},timeout=20)
                        assert refused.status_code==409 and refused.json().get('code')=='ELECTRONIC_QUOTES_PENDING'
                        select(page,pid,opening);fields=page.locator('[data-electronic-quote]');assert fields.count()==3
                        for i in range(3):fields.nth(i).fill(str(10000+i*1000))
                        page.evaluate('openStageSlide(editingStageKey)');fields=page.locator('[data-electronic-quote]');assert fields.nth(0).input_value()=='10000'
                        with page.expect_response(lambda r:r.url.endswith('/electronic-tender/quotes') and r.request.method=='PUT') as quoted:page.get_by_role('button',name='保存报价',exact=True).click()
                        assert quoted.value.status==200;quote_state=quoted.value.json();check('opening quotes required and preserved',len(quote_state['quotes'])==3 and all(quote_state['quotes'][str(r['id'])] for r in regs))
                        for theme in ['default','dark','blue','green']:
                            page.evaluate('(t)=>setTheme(t)',theme)
                            for width in [1440,390]:
                                page.set_viewport_size(dict(width=width,height=1000 if width==1440 else 844));assert not page.locator('#slidePanel').evaluate('(e)=>e.scrollWidth>e.clientWidth+2')
                                page.locator('#slidePanel').screenshot(path=str(out/f'原系统开标-{theme}-{width}.png'),animations='disabled')
                        bad=dict(revision=quote_state['revision'],record_version=quote_state['record_version'],quotes=[dict(registration_id=999999,amount='1')]);r=c.session.put(c.base_url+f'/api/projects/{pid}/electronic-tender/quotes',json=bad,headers={'X-CSRFToken':c.csrf_token},timeout=20);assert r.status_code==400
                        replay=dict(revision=quote_state['revision']-1,record_version=quote_state['record_version'],quotes=[]);r=c.session.put(c.base_url+f'/api/projects/{pid}/electronic-tender/quotes',json=replay,headers={'X-CSRFToken':c.csrf_token},timeout=20)
                        check('repeat and foreign supplier rejected',r.status_code==409 and c.request('GET',f'/api/projects/{pid}/electronic-tender')['quotes']==quote_state['quotes'])
                        c.request('PUT',f'/api/projects/{pid}/stages/{opening}',dict(completed=True));after=c.get_project(pid);check('opening completes normally',next(s for s in after['stages'] if s['key']==opening)['completed'] and not after['bid_results'])
                        packaged,pkey=new_e('ELECTRONIC-PACKAGES');ppid=packaged['id']
                        lots=[c.request('POST',f'/api/projects/{ppid}/lots',dict(lot_number=f'包{i}',lot_name=f'隔离采购包{i}')) for i in [1,2]]
                        e=c.request('GET',f'/api/projects/{ppid}/electronic-tender')
                        c.request('PUT',f'/api/projects/{ppid}/electronic-tender/registration',dict(revision=e['revision'],record_version=e['record_version'],counts=[dict(lot_id=l['id'],count=3) for l in lots]))
                        named=[c.request('POST',f'/api/projects/{ppid}/registrations',dict(company_name=f'包{i}解密供应商',lot_id=str(l['id']))) for i,l in enumerate(lots,1)]
                        c.request('PUT',f"/api/projects/{ppid}/lots/{lots[0]['id']}",dict(lot_action='manual_liubiao',response_count=1,reason='隔离验收：包1开标响应不足，保留历史'))
                        opkey=next(s['key'] for s in packaged['stages'] if 'bid_opening' in s['modules'])
                        select(page,ppid,opkey);page.locator('[data-electronic-quote]').wait_for()
                        assert page.locator('[data-electronic-quote]').count()==1 and page.locator(f"[data-electronic-quote='{named[0]['id']}']").count()==0
                        page.locator('[data-electronic-quote]').fill('888.00')
                        with page.expect_response(lambda r:r.url.endswith('/electronic-tender/quotes') and r.request.method=='PUT') as active_saved:page.get_by_role('button',name='保存报价',exact=True).click()
                        assert active_saved.value.status==200
                        page.locator('#slidePanel').screenshot(path=str(out/'流标包历史只读-有效包保存报价.png'),animations='disabled')
                        check('closed package history does not block active package',active_saved.value.json()['quotes'][str(named[1]['id'])]=='888.00' and c.get_project(ppid)['is_terminated'] is False)
                        from tools.verify_account_backup_release import login
                        c.request('POST','/api/users',dict(username='electronic_viewer',password='Synthetic-viewer-password',role='viewer'))
                        viewer=login(c.base_url,'electronic_viewer','Synthetic-viewer-password')
                        try:
                            e=c.request('GET',f'/api/projects/{pid}/electronic-tender');r=viewer.session.put(c.base_url+f'/api/projects/{pid}/electronic-tender/quotes',json=dict(revision=e['revision'],record_version=e['record_version'],quotes=[]),headers={'X-CSRFToken':viewer.csrf_token},timeout=20);check('viewer write denied',r.status_code==403)
                        finally:viewer.session.close()
                        assert not errors
                    finally:browser.close()
                shutil.copy2(c.root/'startup.log',out/'candidate-startup.log')
        check('inputs unchanged',bool(require_windows_candidate(args.candidate,args.candidate_sha256)) and bool(require_windows_candidate(args.baseline,args.baseline_sha256)))
    except Exception as error:
        result['error']=f'{type(error).__name__}: {error}';(out/'failure.txt').write_text(traceback.format_exc(),'utf-8')
    result.update(checks=checks,page_errors=errors,missing_required_checks=sorted(REQUIRED-{r['name'] for r in checks if r['passed']}),passed=False)
    result['passed']=not result.get('error') and not result['missing_required_checks'] and all(x['passed'] for x in checks)
    (out/'electronic-tender-exe-acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8');return result

if __name__=='__main__':
    p=argparse.ArgumentParser()
    for key in ['candidate','baseline','evidence']:p.add_argument('--'+key,type=Path,required=True)
    for key in ['candidate-sha256','baseline-sha256','source-commit','expected-version']:p.add_argument('--'+key,required=True)
    p.add_argument('--compatible-license-dir',type=Path);p.add_argument('--browser-executable',type=Path)
    result=verify(p.parse_args());print(json.dumps(dict(passed=result['passed'],checks=len(result['checks']),error=result.get('error')),ensure_ascii=False));raise SystemExit(0 if result['passed'] else 1)
