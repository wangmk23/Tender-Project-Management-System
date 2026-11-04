"""Owned actual EXE upgrade acceptance; caller pins repository, EXEs and source SHA."""
import argparse,copy,json,os,platform,re,shutil,subprocess,sys,tempfile,traceback
from pathlib import Path
ROOT=Path(os.environ.get('PM_REUSE_SOURCE_ROOT',Path(__file__).resolve().parents[1])).resolve();sys.path.insert(0,str(ROOT))
from tools.verify_media_release import Report,require,sha256
from tools.release_browser import require_windows_candidate,launch_browser
from tools.verify_packaged_browser_acceptance import owned_client
REQUIRED={'baseline','candidate','baseline startup','legacy seed','candidate startup','version','legacy reason preserved','cross-phase remains explicit','browser prefill and confirmation','same-phase reuse','irrelevant amount keeps confirmation','real eligibility change invalidates','reminder change retains deadline','same-day correction retains deadline','input hashes unchanged'}
class Gate(Report):
 def result(self):
  value=super().result();missing=sorted(REQUIRED-{x['name'] for x in self.checks if x['passed']})
  value.update(missing_required_checks=missing,passed=value['passed'] and not missing,complete_release_acceptance=False)
  return value

def quantity(c,pid,key):return c.request('GET',f'/api/projects/{pid}/supplier-quantity?stage_key={key}')['items'][0]
def confirm(c,pid,key,reason):
 q=quantity(c,pid,key)
 return c.request('POST',f'/api/projects/{pid}/supplier-quantity/confirm',dict(stage_key=key,lot_id=None,fingerprint=q['fingerprint'],reason=reason))['item']
def ledger(c,pid):return c.request('GET',f'/api/projects/{pid}/tender-guarantee')
def put_ledger(c,pid,data,reason):
 l=ledger(c,pid)
 return c.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(revision=l['revision'],data=data,reason=reason,confirm_roster=True))
def seed(c):
 catalog=c.request('GET','/api/procurement-methods')
 method=c.request('POST','/api/procurement-methods',dict(revision=catalog['revision'],name='合成重复确认验收',regime='enterprise',template_mode='independent',quantity_rule=dict(mode='fixed',minimum=3),stages=[dict(id=k,name=n,modules=['common',m]) for k,n,m in [('opening','开标','bid_opening'),('evaluating','评标','evaluation'),('publishing','结果公示','result_publication')]]))['method']
 p=c.request('POST','/api/projects',dict(number='REUSE-UPGRADE',name='合成两家供应商项目',year=2026,procurement_method_id=method['id'],no_deposit=False))
 pid=p['id'];regs=[c.request('POST',f'/api/projects/{pid}/registrations',dict(company_name=n)) for n in ['合成甲供应商','合成乙供应商']]
 put_ledger(c,pid,dict(confirmed=True,rules=[],amounts=[dict(lot_id=None,amount='100.00')],records=[dict(registration_id=r['id'],participation='submitted',validity='valid',deposit_status='paid',deposit_amount='100.00',handling='rule') for r in regs]),'隔离验收已核对文件与到账')
 reason='采购人确认按现有两家继续办理（合成验收）'
 require(confirm(c,pid,'opening',reason)['status']=='confirmed','v60 legacy decision was not saved')
 stage=next(s for s in c.get_project(pid)['stages'] if s['key']=='opening')
 c.request('PUT',f'/api/projects/{pid}/stages/opening',dict(record_version=stage['record_version'],completed=True,completed_date='2026-10-01',completed_at='2026-10-01T09:00'))
 return dict(pid=pid,reason=reason,registrations=regs)

def browser_check(c,s,evidence):
 from playwright.sync_api import sync_playwright
 with sync_playwright() as pw:
  b,meta=launch_browser(pw);context=b.new_context(viewport={'width':1440,'height':1000},reduced_motion='reduce')
  context.add_cookies([dict(name=x.name,value=x.value,url=c.base_url) for x in c.session.cookies]);page=context.new_page();errors=[];failures=[]
  page.on('pageerror',lambda e:errors.append(str(e)))
  def response(r):
   if '/api/projects/' in r.url and r.status>=500:failures.append(dict(path=r.url.split(c.base_url)[-1],status=r.status,body=r.text()[:4000]))
  page.on('response',response)
  try:
   page.goto(c.base_url,wait_until='networkidle');page.evaluate('(id)=>selectProject(id)',s['pid']);page.wait_for_function('(id)=>Number(currentProject?.id)===id',arg=s['pid'])
   page.evaluate("openStageSlide('evaluating')");field=page.locator('#quantityReason0');field.wait_for(state='visible')
   require(field.input_value()==s['reason'],'prior reason was not prefilled')
   require(quantity(c,s['pid'],'evaluating')['status']=='shortage','merely opening the UI silently confirmed validity')
   button=page.locator('[data-quantity-index="0"]');button.focus();page.keyboard.press('Enter')
   page.wait_for_function("()=>!document.getElementById('quantityReason0') && !!document.querySelector('.quantity-review-card')")
   require(quantity(c,s['pid'],'evaluating')['status']=='confirmed','explicit keyboard confirmation failed')
   require(not next(x for x in c.get_project(s['pid'])['stages'] if x['key']=='evaluating')['completed'],'quantity acknowledgment automatically completed the stage')
   for theme in ['default','blue','green','dark']:
    for width in [1440,390]:
     page.set_viewport_size(dict(width=width,height=1000));page.evaluate('(v)=>document.documentElement.dataset.theme=v',theme)
     require(page.locator('#slideBody').evaluate('(el)=>el.scrollWidth<=el.clientWidth+1'),'quantity section overflow')
     page.screenshot(path=str(evidence/f'quantity-{theme}-{width}.png'),full_page=True)
   require(not errors and not failures,'browser errors: '+json.dumps(dict(errors=errors,api=failures),ensure_ascii=False))
   return dict(browser=meta,screenshots=8,page_errors=errors,explicit_keyboard_confirm=True)
  except Exception:
   page.screenshot(path=str(evidence/'browser-failure.png'),full_page=True)
   (evidence/'browser-failure.json').write_text(json.dumps(dict(errors=errors,api_failures=failures),ensure_ascii=False,indent=2),'utf-8');raise
  finally:context.close();b.close()

def verify(args):
 e=args.evidence.resolve();e.mkdir(parents=True,exist_ok=False);r=Gate(emit=True)
 r.metadata.update(source_commit=args.source_commit,harness_sha256=sha256(Path(__file__)),candidate_sha256=args.candidate_sha256,baseline_sha256=args.baseline_sha256,expected_version=args.expected_version,environment=platform.platform(),python=sys.version,manual_pending=['原生窗口及显示缩放','实际手机和外链网络'])
 try:
  require(re.fullmatch('[0-9a-f]{40}',args.source_commit),'full source SHA required')
  r.check('baseline',lambda:require_windows_candidate(args.baseline,args.baseline_sha256));r.check('candidate',lambda:require_windows_candidate(args.candidate,args.candidate_sha256))
  with tempfile.TemporaryDirectory(prefix='pm-reuse-owned-') as tmp:
   root=Path(tmp);profile=root/'retained'
   with owned_client(args.baseline.resolve(),root,'baseline',retained_profile=profile) as old:
    r.check('baseline startup',old.start);s=r.check('legacy seed',lambda:seed(old));password=old.password
   with owned_client(args.candidate.resolve(),root,'candidate',retained_profile=profile) as c:
    c.password=password
    try:
     r.check('candidate startup',c.start);r.check('version',lambda:require(c.request('GET','/api/system-info')['version']==args.expected_version,'running version differs'))
     def legacy():
      q=quantity(c,s['pid'],'opening');require(q['status']=='confirmed' and q['decision']['reason']==s['reason'],'original saved reason lost');return q
     r.check('legacy reason preserved',legacy)
     def cross():
      q=quantity(c,s['pid'],'evaluating');require(q['status']=='shortage' and q['suggested_decision']['reason']==s['reason'],'cross-phase auto-approved or old reason unavailable');return q
     r.check('cross-phase remains explicit',cross)
     r.check('browser prefill and confirmation',lambda:browser_check(c,s,e))
     r.check('same-phase reuse',lambda:require(quantity(c,s['pid'],'publishing')['status']=='confirmed','same valid roster asks again'))
     data=copy.deepcopy(ledger(c,s['pid'])['data']);data.pop('stale',None);data['amounts'][0]['amount']='90.00';put_ledger(c,s['pid'],data,'只改足额范围内的要求，人数不变')
     r.check('irrelevant amount keeps confirmation',lambda:require(quantity(c,s['pid'],'evaluating')['status']=='confirmed','irrelevant amount clears approval'))
     data=copy.deepcopy(ledger(c,s['pid'])['data']);data.pop('stale',None);data['records'][0].update(validity='invalid',reason='合成资格不符');data['rules']=[dict(id='refund',lot_id=None,scope='exception',enabled=True,start_stage_key='opening',manual_start_at='',days=5,day_kind='calendar',cutoff='17:00',remind_days=1)];put_ledger(c,s['pid'],data,'合成资格变化与退还规则')
     r.check('real eligibility change invalidates',lambda:require(quantity(c,s['pid'],'evaluating')['status']=='shortage','real validity change reused approval'))
     before=next(x for x in ledger(c,s['pid'])['items'] if x['registration_id']==s['registrations'][0]['id']);require(before['deadline'] and not before['needs_recheck'],'deadline fixture failed')
     data=copy.deepcopy(ledger(c,s['pid'])['data']);data.pop('stale',None);data['rules'][0]['remind_days']=2;put_ledger(c,s['pid'],data,'仅修改提醒天数')
     def deadline_same():
      current=next(x for x in ledger(c,s['pid'])['items'] if x['registration_id']==s['registrations'][0]['id']);require(current['deadline']==before['deadline'] and not current['needs_recheck'],'unchanged deadline asks for recheck');return current
     r.check('reminder change retains deadline',deadline_same)
     stage=next(x for x in c.get_project(s['pid'])['stages'] if x['key']=='opening');c.request('PUT',f'/api/projects/{s["pid"]}/stages/opening',dict(record_version=stage['record_version'],completed=True,completed_date='2026-10-01',completed_at='2026-10-01T10:00'))
     r.check('same-day correction retains deadline',deadline_same)
    finally:
     c.stop();log=c.root/'startup.log'
     if log.is_file():shutil.copy2(log,e/'startup.log')
  r.check('input hashes unchanged',lambda:require(sha256(args.baseline)==args.baseline_sha256 and sha256(args.candidate)==args.candidate_sha256,'EXE input changed'))
 except Exception as err:r.metadata.update(error=f'{type(err).__name__}: {err}',traceback=traceback.format_exc())
 value=r.result();(e/'reuse-confirmation-exe-acceptance.json').write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n','utf-8');return value

def parser():
 p=argparse.ArgumentParser()
 for name in ['candidate','baseline','evidence']:p.add_argument('--'+name,type=Path,required=True)
 for name in ['candidate-sha256','baseline-sha256','source-commit','expected-version']:p.add_argument('--'+name,required=True)
 return p
if __name__=='__main__':
 out=verify(parser().parse_args());print(json.dumps({k:out[k] for k in ['passed','total','failed','missing_required_checks']},ensure_ascii=False));raise SystemExit(0 if out['passed'] else 1)
