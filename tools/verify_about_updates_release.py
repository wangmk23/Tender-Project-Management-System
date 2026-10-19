"""Verify About in an owned EXE workspace; simulate failures without touching user data."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import sys
import tempfile
from urllib.parse import urlsplit
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from playwright.sync_api import sync_playwright


def verify(candidate, digest, licenses, output):
    assert hashlib.sha256(candidate.read_bytes()).hexdigest()==digest
    output.mkdir(parents=True,exist_ok=True)
    checks=[];errors=[];shots=[];live={}
    def check(name,passed):
        checks.append({'name':name,'passed':bool(passed)})
        if not passed:raise AssertionError(name)
    with tempfile.TemporaryDirectory(prefix='about-owned-') as tmp, patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(licenses)}):
        client=PackagedClient(candidate,Path(tmp),'about',unused_port())
        try:
            client.start()
            client.patch_settings({'reminder_enabled':False,'event_reminder_create_enabled':False,'event_reminder_complete_enabled':False,'supplier_shortage_email_enabled':False})
            settings_before=client.request('GET','/api/settings');projects_before=client.request('GET','/api/projects')
            info=client.request('GET','/api/system-info');health=client.request('GET','/health')
            version='v'+json.loads((ROOT/'package.json').read_text('utf-8'))['version']
            check('running version matches package and health',info['version']==version and health['version']==version)
            config=client.request('GET','/api/software-updates/source')
            expected=json.loads((ROOT/'package.json').read_text('utf-8'))['softwareUpdates']
            check('configuration embedded in EXE',config['configured'] and config['owner']==expected['owner'] and config['repository']==expected['repository'])
            with sync_playwright() as pw:
                edge=Path('C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                browser=pw.chromium.launch(headless=True,**({'executable_path':str(edge)} if edge.exists() else {}))
                try:
                    context=browser.new_context(viewport={'width':1366,'height':900},locale='zh-CN',timezone_id='Asia/Shanghai',reduced_motion='reduce')
                    context.add_cookies([{'name':c.name,'value':c.value,'url':client.base_url} for c in client.session.cookies])
                    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
                    remote_requests=[]
                    page.on('request',lambda request:remote_requests.append(request.url) if request.url.startswith('https://api.github.com/') else None)
                    page.goto(client.base_url,wait_until='networkidle');page.wait_for_selector('.command-metric')
                    page.evaluate("switchView('settings')");page.wait_for_selector('[data-settings-category=about]')
                    page.locator('.settings-nav [data-settings-category=about]').click()
                    page.wait_for_function("document.getElementById('aboutUpdateStatus')?.textContent==='尚未检查更新'")
                    check('opening About does not contact GitHub',not remote_requests)
                    check('About-specific heading',page.locator('.settings-category-heading p').inner_text()=='查看系统版本、更新记录及相关信息')
                    check('three existing-page sections',page.locator('.settings-about-layout>section').count()==3)
                    for theme in ['dark','default','blue','green']:
                        for width in [1366,390]:
                            page.set_viewport_size({'width':width,'height':900});page.evaluate('(theme)=>applyTheme(theme)',theme)
                            check(f'About fits {theme}/{width}',page.evaluate('document.documentElement.scrollWidth<=innerWidth+1'))
                            check(f'empty check date hidden {theme}/{width}',not page.locator('#aboutLastChecked').is_visible())
                            if width>1100:
                                check(f'log card spans content width {theme}',page.locator('.about-changelog-card').bounding_box()['width']>=page.locator('.settings-about-layout').bounding_box()['width']-1)
                            filename=f'关于页面-{theme}-{width}.png';page.screenshot(path=str(output/filename),full_page=True);shots.append(filename)
                    page.set_viewport_size({'width':1366,'height':900});page.evaluate("applyTheme('dark')")

                    def wait_check():
                        page.wait_for_function("!aboutUpdates.checking && document.getElementById('aboutUpdateStatus').getAttribute('aria-busy')==='false'",timeout=16000)
                    page.locator('#aboutCheckUpdate').click();wait_check()
                    live['check_message']=page.locator('#aboutUpdateStatus').inner_text()
                    live['tag']=page.evaluate('aboutUpdates.result?.release.tag || null')
                    live['check_succeeded']=bool(live['tag'])
                    page.locator('#aboutViewChangelog').click();page.wait_for_function('!aboutUpdates.logLoading',timeout=16000)
                    live['changelog_count']=page.locator('#aboutChangelog article').count()
                    live['changelog_error']=page.evaluate('aboutUpdates.logError')

                    scenario={'name':'new'};held=[]
                    release={'tag_name':'v5.8.43-public','draft':False,'prerelease':False,'published_at':'2026-10-19T07:00:00Z','body':'## 新增\n- 版本检查\n<img src=x onerror=alert(1)>','html_url':'https://evil.invalid/'}
                    def route_remote(route):
                        name=scenario['name'];path=urlsplit(route.request.url).path
                        if name in {'pending','timeout'}:held.append(route);return
                        if name=='offline':route.abort('internetdisconnected');return
                        code=200;data=release
                        if name=='empty':code,data=(404,{}) if path.endswith('/latest') else (200,{'private':False})
                        elif name=='private':code,data=404,{}
                        elif name=='server':code,data=503,{}
                        elif name=='current':data={**release,'tag_name':version+'-public'}
                        if path.endswith('/releases') and name=='new':data=[release]
                        route.fulfill(status=code,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(data))
                    page.route('https://api.github.com/**',route_remote)
                    def run_case(name,text):
                        scenario['name']=name;page.locator('#aboutCheckUpdate').click();wait_check()
                        check('check state '+name,text in page.locator('#aboutUpdateStatus').inner_text())
                        check('button restored '+name,page.locator('#aboutCheckUpdate').is_enabled())
                        if name=='timeout':
                            for pending in held:
                                try:pending.abort('timedout')
                                except Exception:pass
                            held.clear()
                    run_case('new','发现新版本')
                    check('untrusted release HTML remains text',page.locator('#aboutUpdateDetail img').count()==0 and '<img' in page.locator('#aboutUpdateDetail').inner_text())
                    link=page.locator('#aboutUpdateDetail a');expected_url=config['releases_url']+'/tag/v5.8.43-public'
                    check('download is configured GitHub page',link.get_attribute('href')==expected_url and link.get_attribute('rel')=='noopener noreferrer')
                    page.screenshot(path=str(output/'模拟新版检查-dark-1366.png'),full_page=True);shots.append('模拟新版检查-dark-1366.png')
                    page.locator('#aboutViewChangelog').click();page.wait_for_function('!aboutUpdates.logLoading')
                    check('release log contains version date and notes',page.locator('#aboutChangelog article').count()==1 and '2026' in page.locator('#aboutChangelog time').inner_text())
                    for name,text in [('current','当前已是最新版本'),('empty','没有可用的正式发布版本'),('private','仓库不存在或为私有仓库'),('server','暂时不可用'),('offline','无法连接 GitHub'),('timeout','请求超时')]:run_case(name,text)
                    scenario['name']='offline';page.locator('#aboutViewChangelog').click();page.wait_for_function('!aboutUpdates.logLoading')
                    check('failed log load keeps previous notes',page.locator('#aboutChangelog article').count()==1 and bool(page.evaluate('aboutUpdates.logError')))
                    scenario['name']='pending';held.clear();page.locator('#aboutCheckUpdate').click()
                    page.wait_for_function('aboutUpdates.checking')
                    check('checking disables duplicate clicks',page.locator('#aboutCheckUpdate').is_disabled())
                    page.evaluate("setSettingsCategory('general')")
                    check('other settings responsive while check pending',page.locator('.settings-category-heading h2').inner_text()=='常规与外观')
                    page.wait_for_timeout(100)
                    for pending in held:pending.fulfill(status=200,content_type='application/json',headers={'Access-Control-Allow-Origin':'*'},body=json.dumps(release))
                    page.wait_for_function('!aboutUpdates.checking');page.evaluate("setSettingsCategory('about')")
                    page.route('**/api/software-updates/source',lambda route:route.fulfill(status=200,content_type='application/json',body='{"configured":false}'))
                    page.evaluate('aboutUpdates.source=null;initializeAboutPanel(systemInfo)')
                    page.wait_for_function("document.getElementById('aboutUpdateStatus').textContent==='尚未配置更新源'")
                    check('missing source is explicit',page.locator('#aboutCheckUpdate').is_disabled())
                    for category in ['general','workflow','email','files','system']:
                        page.evaluate('(category)=>setSettingsCategory(category)',category)
                        check('unchanged category heading '+category,page.locator('.settings-category-heading p').inner_text()=='按分类集中管理相关设置。')
                    check('no browser script errors',not errors)
                    page.unroute_all(behavior='ignoreErrors')
                    context.close()
                finally:browser.close()
            check('existing settings unchanged',client.request('GET','/api/settings')==settings_before)
            check('project data unchanged',client.request('GET','/api/projects')==projects_before)
        finally:client.stop()
    result={'total':len(checks),'passed':sum(c['passed'] for c in checks),'checks':checks,'page_errors':errors,
            'live_github':live,'screenshots':shots,'real_mail_sent':0,'real_default_browser_opened':False,'original_data_accessed':False}
    (output/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return result


if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True)
    p.add_argument('--license-fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True);a=p.parse_args()
    r=verify(a.candidate.resolve(),a.sha256,a.license_fixtures.resolve(),a.output.resolve())
    print(json.dumps({k:r[k] for k in ['total','passed','live_github','page_errors']},ensure_ascii=False))
