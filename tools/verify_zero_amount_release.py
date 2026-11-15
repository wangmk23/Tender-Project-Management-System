"""Hash-pinned Windows upgrade acceptance for ordinary zero-value bid results."""
import argparse
from decimal import Decimal
import io
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import traceback
from xml.etree import ElementTree as ET
import zipfile

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.release_browser import launch_browser, require_windows_candidate
from tools.verify_media_release import Report, require, sha256
from tools.verify_packaged_browser_acceptance import owned_client
from tools.verify_calendar_status_release import start
from tools.verify_guarantee_release import fixture
from tools.verify_local_files_release import compatible_client, protected_modules

REQUIRED={'baseline','candidate','protected authorization modules','baseline startup',
          'baseline zero form and export reproduction','candidate startup','version',
          'upgrade preserves zero and business records','actual form saves zero',
          'actual export keeps zero','explicit clear and positive amount contracts',
          'unrelated financial and stage facts unchanged','inputs unchanged'}
NS={'x':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}


def facts(client,pid):
    project=client.get_project(pid)
    ledger=client.request('GET',f'/api/projects/{pid}/tender-guarantee')
    return dict(data=ledger['data'],revision=ledger['revision'],balance=ledger['summary']['balance'],
        stages=[{k:s.get(k) for k in ('key','completed','completed_at','skipped','planned_at')} for s in project['stages']])


def export_value(client,project,evidence,label):
    response=client.session.get(client.base_url+'/api/export',params={'download':'1','year':2026},timeout=30)
    response.raise_for_status();blob=response.content
    (evidence/(label+'.xlsx')).write_bytes(blob)
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        require(z.testzip() is None,'invalid export XLSX')
        root=ET.fromstring(z.read('xl/worksheets/sheet1.xml'))
    for row in root.findall('./x:sheetData/x:row',NS):
        cells={}
        for cell in row.findall('x:c',NS):
            inline=cell.find('x:is',NS)
            value=''.join(t.text or '' for t in inline.findall('.//x:t',NS)) if inline is not None else cell.findtext('x:v','',NS)
            cells[re.sub(r'\d+$','',cell.attrib['r'])]=value
        if cells.get('B')==project['number']:return cells.get('Q','')
    raise AssertionError('synthetic project not found in actual XLSX')


def browser(client,args,evidence,scenario):
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        instance,metadata=launch_browser(pw,args.browser_executable)
        try:
            context=instance.new_context(viewport={'width':1440,'height':1000},timezone_id='Asia/Shanghai',reduced_motion='reduce')
            context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
            page=context.new_page();errors=[]
            page.on('pageerror',lambda e:errors.append(str(e)))
            page.goto(client.base_url,wait_until='networkidle')
            result=scenario(page)
            require(not errors,'browser exceptions: '+str(errors))
            context.close()
            return dict(browser=metadata,scenario=result,page_errors=errors)
        finally:instance.close()


def edit(page,pid,bid_id):
    page.evaluate('(pid)=>selectProject(pid)',pid)
    page.wait_for_function('(pid)=>currentProject?.id===pid',arg=pid)
    page.evaluate('(id)=>showBidResultForm(id)',bid_id)
    page.locator('#bidAmount').wait_for()


def save_form(page,pid,bid_id):
    with page.expect_response(lambda r:r.request.method=='PUT' and r.url.endswith(f'/api/projects/{pid}/bid-results/{bid_id}')) as result:
        page.locator('#modalSaveBtn').click()
    response=result.value
    require(response.status==200,'bid result save rejected')
    page.wait_for_selector('#modalSaveBtn',state='hidden')
    return json.loads(response.request.post_data)


def verify(args):
    evidence=args.evidence.resolve();evidence.mkdir(parents=True,exist_ok=False)
    report=Report(emit=True);fixtures=args.compatible_license_dir
    required=REQUIRED|({'license inputs unchanged'} if fixtures else set())
    report.metadata.update(source_commit=args.source_commit,expected_version=args.expected_version,
        candidate_sha256=args.candidate_sha256,baseline_sha256=args.baseline_sha256,
        edition='compatible' if fixtures else 'public',environment=platform.platform(),python=sys.version,
        harness_commit=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip(),
        complete_release_acceptance=False,manual_checks=['physical phone/network','native desktop and scaling'])
    try:
        require(bool(re.fullmatch('[0-9a-f]{40}',args.source_commit)),'immutable source commit required')
        report.check('baseline',lambda:require_windows_candidate(args.baseline,args.baseline_sha256))
        report.check('candidate',lambda:require_windows_candidate(args.candidate,args.candidate_sha256))
        report.check('protected authorization modules',lambda:protected_modules(args.baseline,args.candidate,public=not bool(fixtures)))
        if fixtures:
            fixtures=fixtures.resolve(strict=True)
            hashes={p:sha256(p) for p in fixtures.iterdir() if p.name in ('license.dat','.license_state.bin','license_public_key.pem')}
            require((fixtures/'license.dat') in hashes,'test license input missing')
            factory=lambda exe,root,label,profile:compatible_client(exe,root,label,fixtures,profile)
        else:factory=lambda exe,root,label,profile:owned_client(exe,root,label,retained_profile=profile)
        with tempfile.TemporaryDirectory(prefix='pm-zero-result-') as directory:
            root=Path(directory);profile=root/'profile'
            with factory(args.baseline.resolve(),root,'baseline',profile) as old:
                report.check('baseline startup',lambda:start(old,evidence,'baseline'))
                seeded=fixture(old,[]);pid=seeded['pid'];bid_id=seeded['winner']['id']
                supplier=seeded['registrations'][0]['company_name']
                old.request('PUT',f'/api/projects/{pid}/bid-results/{bid_id}',dict(winning_supplier=supplier,winning_amount='0',discount_rate='95%'))
                project=old.get_project(pid)
                require(project['bid_results'][0]['winning_amount'] is None,'baseline lost-zero serializer not reproduced')
                before=facts(old,pid);password=old.password
                def reproduce():
                    require(export_value(old,project,evidence,'baseline-export')=='95%','baseline zero export not reproduced')
                    def form(page):
                        edit(page,pid,bid_id)
                        require(page.locator('#bidAmount').input_value()=='','baseline zero form not blank')
                        page.screenshot(path=str(evidence/'baseline-zero-empty.png'),full_page=True)
                        return dict(amount_input='',sent_zero='0',returned_amount=None,export='95%')
                    return browser(old,args,evidence,form)
                report.check('baseline zero form and export reproduction',reproduce)
            with factory(args.candidate.resolve(),root,'candidate',profile) as client:
                client.password=password
                report.check('candidate startup',lambda:start(client,evidence,'candidate'))
                report.check('version',lambda:require(client.request('GET','/api/system-info')['version']==args.expected_version,'version mismatch'))
                def preserved():
                    require(facts(client,pid)==before,'upgrade changed financial or stage facts')
                    rows=client.get_project(pid)['bid_results']
                    require(len(rows)==1 and rows[0]['id']==bid_id and rows[0]['winning_amount']==0,'upgrade lost result zero')
                report.check('upgrade preserves zero and business records',preserved)
                def zero_form():
                    def form(page):
                        edit(page,pid,bid_id)
                        value=page.locator('#bidAmount').input_value()
                        require(value!='' and Decimal(value)==0,'candidate zero not shown')
                        require(page.evaluate('formatBidInfo(currentProject.bid_results[0])')=='¥0元','candidate summary substituted zero with discount')
                        page.screenshot(path=str(evidence/'candidate-zero-preserved.png'),full_page=True)
                        payload=save_form(page,pid,bid_id)
                        require(payload['winning_amount'] is not None and Decimal(payload['winning_amount'])==0,'zero not sent on save')
                        require(client.get_project(pid)['bid_results'][0]['winning_amount']==0,'zero not persisted')
                        return dict(input_value=value,summary='¥0元',saved_payload=payload)
                    return browser(client,args,evidence,form)
                report.check('actual form saves zero',zero_form)
                report.check('actual export keeps zero',lambda:require(Decimal(export_value(client,project,evidence,'candidate-zero-export'))==0,'export substituted zero'))
                def boundaries():
                    def form(page):
                        edit(page,pid,bid_id);page.locator('#bidAmount').fill('');payload=save_form(page,pid,bid_id)
                        require(payload['winning_amount'] is None and client.get_project(pid)['bid_results'][0]['winning_amount'] is None,'explicit clear not preserved')
                        require(export_value(client,project,evidence,'candidate-empty-export')=='95%','missing amount lost discount fallback')
                        edit(page,pid,bid_id);page.locator('#bidAmount').fill('123.45');save_form(page,pid,bid_id)
                        require(Decimal(str(client.get_project(pid)['bid_results'][0]['winning_amount']))==Decimal('123.45'),'positive amount changed')
                        require(Decimal(export_value(client,project,evidence,'candidate-positive-export'))==Decimal('123.45'),'positive export changed')
                        return dict(explicit_clear=None,positive='123.45',discount_fallback='95%')
                    return browser(client,args,evidence,form)
                report.check('explicit clear and positive amount contracts',boundaries)
                client.request('PUT',f'/api/projects/{pid}/bid-results/{bid_id}',dict(winning_supplier=supplier,winning_amount=0,discount_rate='95%'))
                report.check('unrelated financial and stage facts unchanged',preserved)
        if fixtures:report.check('license inputs unchanged',lambda:require(all(sha256(p)==digest for p,digest in hashes.items()),'test license input changed'))
        report.check('inputs unchanged',lambda:require(sha256(args.candidate)==args.candidate_sha256 and sha256(args.baseline)==args.baseline_sha256,'frozen input changed'))
    except Exception as error:
        report.metadata['error']=f'{type(error).__name__}: {error}'
        (evidence/'failure.txt').write_text(traceback.format_exc(),'utf-8')
    value=report.result();value['missing_required_checks']=sorted(required-{r['name'] for r in report.checks if r['passed']})
    value['passed']=value['passed'] and not value['missing_required_checks']
    (evidence/'zero-amount-exe-acceptance.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8')
    return value


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    for name in ('candidate','baseline','evidence'):parser.add_argument('--'+name,type=Path,required=True)
    for name in ('candidate-sha256','baseline-sha256','source-commit','expected-version'):parser.add_argument('--'+name,required=True)
    parser.add_argument('--browser-executable',type=Path);parser.add_argument('--compatible-license-dir',type=Path)
    value=verify(parser.parse_args());print(json.dumps({k:value[k] for k in ('passed','total','failed','missing_required_checks')}))
    raise SystemExit(0 if value['passed'] else 1)
