"""Hash-pinned v5.8.37 upgrade acceptance with owned, fictional runtime data."""
from __future__ import annotations
import argparse,hashlib,json,os,shutil,sys,tempfile,time
from pathlib import Path
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient,unused_port
from playwright.sync_api import sync_playwright


def verify(candidate,sha,old,fixtures,output):
    if hashlib.sha256(candidate.read_bytes()).hexdigest()!=sha:raise ValueError('Candidate checksum differs')
    output.mkdir(parents=True,exist_ok=False);checks=[];errors=[];shots=[]
    def check(name,value):
        checks.append(dict(name=name,passed=bool(value)))
        if not value:raise AssertionError(name)
    def report():
        value=dict(passed=sum(x['passed'] for x in checks),total=len(checks),checks=checks,page_errors=errors,screenshots=shots,sha256=sha,
            native_desktop_verified=False,real_mail_sent=0,original_business_data_accessed=False)
        (output/'result.json').write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding='utf8');return value
    with tempfile.TemporaryDirectory(prefix='national-presets-upgrade-') as folder,patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(fixtures)}):
        client=PackagedClient(old,Path(folder),'owned',unused_port());profile=Path(folder)/'browser'
        try:
            client.start();client.patch_settings(dict(reminder_enabled=False,event_reminder_create_enabled=False,event_reminder_complete_enabled=False,
                supplier_shortage_email_enabled=False,reminder_recipient_groups=[]))
            cat=client.request('GET','/api/procurement-methods')
            check('previous official release does not contain new reference presets',not any(m.get('reference_preset') for m in cat['methods']))
            method=client.request('POST','/api/procurement-methods',dict(name='存量隔离项目方式',regime='enterprise',revision=cat['revision'],
                template_mode='independent',stages=[dict(id='first',name='历史第一阶段',modules=['common']),dict(id='register',name='历史报名',modules=['common','registration']),dict(id='archive',name='历史归档',modules=['common','archive'])]))['method']
            original=client.request('POST','/api/projects',dict(number='HISTORY-KEEP',name='历史项目保持验证',procurement_method_id=method['id'],no_deposit=True,year=2026))
            pid=original['id'];client.request('POST',f'/api/projects/{pid}/registrations',dict(company_name='历史隔离供应商',registration_method='offline'))
            client.request('PUT',f'/api/projects/{pid}/stages/first',dict(completed=True,completed_at='2026-10-17T09:15',notes='旧记录必须保留'))
            client.request('PUT',f'/api/projects/{pid}/stages/register',dict(planned_at='2026-12-01T17:30',notes='原计划与备注'))
            before=client.get_project(pid);oldcat=client.request('GET','/api/procurement-methods')
            protected={name:hashlib.sha256((client.data_root/name).read_bytes()).hexdigest() for name in ['license.dat','data_key.dpapi']}
            with sync_playwright() as pw:
                browser=pw.chromium.launch_persistent_context(str(profile),headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',viewport={'width':1366,'height':900})
                browser.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=browser.new_page()
                page.goto(client.base_url,wait_until='networkidle');page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost')
                oldheight=page.locator('[data-ui-preference="size"]').evaluate('(e)=>e.getBoundingClientRect().height')
                check('previous release reproduces undersized native preference control',oldheight<30)
                page.evaluate('updateUiPreference("theme","green");updateUiPreference("motion","off")');browser.close()
            client.stop();shutil.copy2(candidate,client.executable);client.start()
            check('candidate reports expected version',client.request('GET','/api/system-info')['version']=='v'+json.loads((ROOT/'package.json').read_text('utf8'))['version'])
            check('historical project stage completion notes plans and roster unchanged',client.get_project(pid)==before)
            check('license and data-key files unchanged',all(hashlib.sha256((client.data_root/name).read_bytes()).hexdigest()==value for name,value in protected.items()))
            cat=client.request('GET','/api/procurement-methods');byid={m['id']:m for m in cat['methods']}
            check('all old method configurations unchanged',all(byid[m['id']]==m for m in oldcat['methods']))
            check('common default flow unchanged',cat['common_stages']==oldcat['common_stages'])
            presets=[m for m in cat['methods'] if m.get('reference_preset')]
            check('twenty references installed once',len(presets)==20)
            check('five regimes classified',len({m['regime'] for m in presets})==5)
            projects={}
            for index,m in enumerate(presets):
                project=client.request('POST','/api/projects',dict(number=f'REFERENCE-{index}',name='隔离参考流程'+str(index),procurement_method_id=m['id'],year=2026,no_deposit=True))
                check('snapshot stages match '+m['regime']+'/'+m['name'],[(s['key'],s['name']) for s in project['stages']]==[(s['id'],s['name']) for s in m['stages']])
                projects[m['id']]=project
            with sync_playwright() as pw:
                context=pw.chromium.launch_persistent_context(str(profile),headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',locale='zh-CN',timezone_id='Asia/Shanghai',viewport={'width':1366,'height':900})
                try:
                    context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies]);page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                    page.goto(client.base_url,wait_until='networkidle');check('old personal theme survives upgrade',page.evaluate('readUiPreferences().theme')=='green')
                    page.evaluate('switchView("settings")');page.wait_for_selector('#appearancePreferencesHost')
                    for theme in ['default','dark','blue','green']:
                        page.evaluate('(t)=>{updateUiPreference("theme",t);updateUiPreference("motion","off");updateUiPreference("size","large");}',theme)
                        for width in [1366,390]:
                            page.set_viewport_size(dict(width=width,height=900));page.evaluate('closeSidebar();setSettingsCategory("general")')
                            control=page.locator('[data-ui-preference="size"]')
                            check(f'{theme}/{width} preference control themed and comfortable',control.evaluate('(e)=>{const s=getComputedStyle(e);return e.getBoundingClientRect().height>=40&&parseFloat(s.borderTopLeftRadius)>=4&&s.backgroundColor!=="rgba(0, 0, 0, 0)"}'))
                            check(f'{theme}/{width} no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'))
                            name=f'常规外观-{theme}-{width}.png';page.screenshot(path=str(output/name),full_page=True);shots.append(name)
                            page.evaluate('setSettingsCategory("workflow")');page.locator('.procurement-filter select').select_option('government_procurement')
                            check(f'{theme}/{width} filter works and is themed',page.locator('[data-method-id]').count()==10 and page.locator('.procurement-filter select').evaluate('(e)=>e.getBoundingClientRect().height>=40&&parseFloat(getComputedStyle(e).borderTopLeftRadius)>=4'))
                            page.locator('.procurement-reference summary').first.click();check(f'{theme}/{width} source links safely available',page.locator('.procurement-reference[open] a[rel="noopener noreferrer"]').count()>0)
                            name=f'项目流程-{theme}-{width}.png';page.screenshot(path=str(output/name));shots.append(name)
                    page.locator('.procurement-filter select').focus();check('filter retains keyboard focus',page.locator('.procurement-filter select').evaluate('(e)=>document.activeElement===e'))
                    check('no browser script errors',not errors)
                finally:context.close()
            changed=presets[0];first_project=projects[changed['id']]
            client.request('PATCH','/api/procurement-methods/'+changed['id'],dict(revision=changed['revision'],name='管理员已更名',enabled=False))
            removed=presets[-1];client.request('DELETE',f"/api/projects/{projects[removed['id']]['id']}")
            client.request('DELETE','/api/procurement-methods/'+removed['id'],dict(revision=removed['revision']))
            client.restart();cat=client.request('GET','/api/procurement-methods');byid={m['id']:m for m in cat['methods']}
            check('edited disabled preset persists and is marked customized',byid[changed['id']]['name']=='管理员已更名' and not byid[changed['id']]['enabled'] and byid[changed['id']]['reference_preset']['customized'])
            check('deleted reference not resurrected',removed['id'] not in byid)
            check('new project keeps its snapshot after preset edit',client.get_project(first_project['id'])['method']==first_project['method'])
            check('historical project remains unchanged after restart',client.get_project(pid)==before)
        except Exception:
            startup=client.root/'startup.log'
            if startup.exists():(output/'startup-failure.log').write_text(startup.read_text('utf8',errors='replace')[-10000:],encoding='utf8')
            report();raise
        finally:client.stop()
    return report()


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True);p.add_argument('--old-exe',type=Path,required=True);p.add_argument('--fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    result=verify(a.candidate.resolve(),a.sha256,a.old_exe.resolve(),a.fixtures.resolve(),a.output.resolve());print(json.dumps(dict(passed=result['passed'],total=result['total'],page_errors=result['page_errors'])))
