"""Replay the auction blocker and first-round defects in an owned EXE workspace."""
from __future__ import annotations
import argparse
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from tools.verify_attachment_previews import fixtures as attachment_fixtures
from playwright.sync_api import sync_playwright


def verify(candidate, digest, old, licenses, output):
    assert hashlib.sha256(candidate.read_bytes()).hexdigest() == digest
    output.mkdir(parents=True, exist_ok=False)
    checks, errors, warnings, shots = [], [], [], []

    def check(name, passed):
        checks.append(dict(name=name, passed=bool(passed)))
        if not passed:
            raise AssertionError(name)

    def report():
        value = dict(total=len(checks), passed=sum(c['passed'] for c in checks),
                     checks=checks, page_errors=errors, console_warnings=warnings,
                     screenshots=shots, sha256=digest, real_mail_sent=0,
                     native_desktop_verified=False, original_business_data_accessed=False)
        (output / 'result.json').write_text(json.dumps(value, ensure_ascii=False, indent=2), 'utf8')
        return value

    with tempfile.TemporaryDirectory(prefix='quality-round1-owned-') as folder, patch.dict(
            os.environ, {'PM_TEST_LICENSE_DIR': str(licenses)}):
        c = PackagedClient(old, Path(folder), 'owned', unused_port())
        try:
            c.start()
            c.patch_settings(dict(reminder_enabled=False, event_reminder_create_enabled=False,
                                 event_reminder_complete_enabled=False, supplier_shortage_email_enabled=False,
                                 reminder_recipient_groups=[]))
            initial_catalog=c.request('GET','/api/procurement-methods')
            auction=next(m for m in initial_catalog['methods'] if m['name']=='网上竞价' and not m['regime'])
            c.request('PATCH','/api/procurement-methods/'+auction['id'],
                      dict(revision=auction['revision'],regime='other',template_mode='independent',
                           stages=[dict(row,modules=list(dict.fromkeys(row['modules']+['online_bidding'])))
                                   for row in auction['stages']]))
            p = c.request('POST', '/api/projects', dict(number='QUALITY-AUCTION', name='隔离竞价办理验证',
                          procurement_method_id=auction['id'], year=2026, no_deposit=True))
            pid = p['id']
            for name in ['隔离供应商甲', '隔离供应商乙', '隔离供应商丙']:
                c.request('POST', f'/api/projects/{pid}/registrations', dict(company_name=name,
                          registration_method='现场报名', contact_person='虚构联系人', phone='13800000000'))
            regs = c.get_project(pid)['registrations']
            ledger = dict(platform='隔离平台', announcement_url='https://example.com/owned',
                          announcement_done=True, registration_end='2026-09-19T18:00', roster_locked=True,
                          start_at='2026-09-20T09:00', end_at='2026-09-20T12:00',
                          records=[dict(registration_id=r['id'], review='approved') for r in regs])
            participation=c.request('GET',f'/api/projects/{pid}/tender-guarantee')
            participation_data=participation['data']
            participation_data.update(confirmed=True,records=[dict(registration_id=r['id'],
                participation='submitted',validity='valid',reason='',deposit_status='unknown',
                deposit_amount='0',refunded_amount='0') for r in regs])
            c.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(
                revision=participation['revision'],data=participation_data,confirm_roster=True,
                reason='隔离核对三家供应商均实际参与且文件有效'))
            # Seed normal business records via APIs, then reproduce the old
            # historical snapshot shape only in this newly-owned encrypted DB.
            seed=json.loads(json.dumps(ledger))
            for row in seed['records']:
                row.update(amount='100',quoted_at='2026-09-20T09:05')
            seed.update(verified=True,ended_at='2026-09-20T09:05',end_reason='all_quoted',evidence='隔离旧版平台记录')
            c.request('PUT', f'/api/projects/{pid}/online-bidding', dict(revision=0, data=seed))
            for key in ('plan_received','online_documents','agreement_signed','announcement','registration_end'):
                c.update_stage(pid,key,True)
            c.stop()
            import sqlcipher3, win32crypt
            assert c.data_root.resolve().is_relative_to(Path(folder).resolve())
            master_key=win32crypt.CryptUnprotectData((c.data_root/'data_key.dpapi').read_bytes(),None,None,None,0)[1]
            with closing(sqlcipher3.connect(str(c.data_root/'bidding.db'))) as db:
                db.execute('PRAGMA key = "x\''+master_key.hex()+'\'"')
                for key, raw in db.execute('SELECT stage_key,modules_json FROM stages WHERE project_id=?',(pid,)).fetchall():
                    modules=list(dict.fromkeys(json.loads(raw or '[]')+['online_bidding']))
                    db.execute('UPDATE stages SET modules_json=? WHERE project_id=? AND stage_key=?',
                               (json.dumps(modules),pid,key))
                db.commit()
            del master_key
            c.start()
            before = c.get_project(pid)
            response = c.session.put(c.base_url + f'/api/projects/{pid}/online-bidding',
                json=dict(revision=1, data=ledger, reason='保存竞价资料', stage_key='online_quotation'),
                headers={'X-CSRFToken': c.csrf_token}, timeout=10)
            (output/'old-reproduction.json').write_text(json.dumps(dict(status=response.status_code,response=response.json()),ensure_ascii=False,indent=2),'utf8')
            check('v5.8.40 reproduces redundant-module completed-stage blocker',
                  response.status_code == 400 and '已完成' in response.json().get('error', ''))
            c.stop()
            shutil.copy2(candidate, c.executable)
            c.start()
            check('upgrade leaves old workflow and completion history unchanged', c.get_project(pid) == before)
            c.request('PUT', f'/api/projects/{pid}/online-bidding', dict(revision=1, data=ledger,
                      reason='保存竞价资料', stage_key='online_quotation'))
            check('new candidate saves quotation draft without reopening previous stages', True)
            bad = c.session.post(c.base_url + f'/api/projects/{pid}/attachments',
                files={'files': ('fake.pdf', b'<html><script>alert(1)</script></html>', 'application/pdf')},
                headers={'X-CSRFToken': c.csrf_token}, timeout=10)
            check('fake PDF rejected before persistence', bad.status_code == 400 and
                  not c.request('GET', f'/api/projects/{pid}/attachments'))
            for kind, name, blob in attachment_fixtures():
                response = c.session.post(c.base_url + f'/api/projects/{pid}/attachments',
                    files={'files': (name, blob, 'application/octet-stream')},
                    headers={'X-CSRFToken': c.csrf_token}, timeout=20)
                check('valid attachment upload ' + kind, response.status_code == 200)
                att = next(a for a in c.request('GET', f'/api/projects/{pid}/attachments') if a['filename'] == name)
                downloaded = c.session.get(c.base_url + f'/api/attachments/{att["id"]}/download', timeout=20)
                check('encrypted attachment round trip ' + kind, downloaded.content == blob and
                      downloaded.headers.get('X-Content-Type-Options') == 'nosniff')
            cat = c.request('GET', '/api/procurement-methods')
            custom_key = 'quality_custom_register'
            c.request('POST', '/api/procurement-methods', dict(name='隔离邮件自定义流程', regime='other',
                      revision=cat['revision'], template_mode='independent', stages=[
                          dict(id=custom_key, name='隔离自定义登记', icon='📥', modules=['common', 'checklist'])]))
            c.patch_settings(dict(reminder_stage_keys=[custom_key]))
            check('custom catalog stage accepted as reminder subscription',
                  c.request('GET', '/api/settings')['reminder_stage_keys'] == [custom_key])
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True,
                          executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                ctx = browser.new_context(viewport=dict(width=1366, height=900), locale='zh-CN', timezone_id='Asia/Shanghai')
                ctx.add_cookies([dict(name=x.name, value=x.value, url=c.base_url) for x in c.session.cookies])
                page = ctx.new_page()
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.on('console', lambda m: warnings.append(m.text) if m.type == 'warning' else None)
                try:
                    page.goto(c.base_url, wait_until='networkidle')
                    page.evaluate('(pid)=>selectProject(pid)', pid)
                    page.evaluate('openStageSlide("online_quotation")')
                    page.wait_for_selector('#ob_ended_at', state='attached')
                    failed = page.evaluate('''async()=>{
                      document.getElementById('stageCompleted').checked=true;
                      document.getElementById('stageCompletedDate').value='2026-09-20';
                      document.getElementById('stageCompletedTime').value='12:01';
                      return await saveStageFromSlide();
                    }''')
                    check('missing fields prevent completion with visible exact guidance', not failed and
                          '平台实际结束时间' in page.locator('[data-ob-save-error]').inner_text())
                    check('missing enhanced date field receives visible trigger focus',
                          page.evaluate('document.activeElement.classList.contains("pm-datetime-trigger")'))
                    page.screenshot(path=str(output / '01-竞价缺项定位.png')); shots.append('01-竞价缺项定位.png')
                    page.evaluate('''()=>{
                      document.querySelectorAll('[data-online-quote]').forEach((row,i)=>{
                        row.querySelector('[data-ob-amount]').value=String(100+i*10);
                        row.querySelector('[data-ob-quoted-at]').value='2026-09-20T09:05';
                      });
                      document.getElementById('ob_ended_at').value='2026-09-20T09:05';
                      document.getElementById('ob_end_reason').value='all_quoted';
                      document.getElementById('ob_evidence').value='隔离平台结果001';
                    }''')
                    completed_ok=page.evaluate('saveStageFromSlide()')
                    if not completed_ok:
                        page.screenshot(path=str(output/'completion-failure.png'))
                        (output/'completion-failure.txt').write_text(page.locator('body').inner_text(),'utf8')
                    check('filled quotation and verified results complete successfully', completed_ok)
                    updated = c.get_project(pid)
                    check('quotation completed and previous completed stages preserved',
                          next(s for s in updated['stages'] if s['key'] == 'online_quotation')['completed'] and
                          all(next(s for s in updated['stages'] if s['key'] == prior['key'])['completed']
                              for prior in before['stages'] if prior['completed']))
                    check('three quote amounts saved without mixing supplier identities',
                          sorted(r['amount'] for r in c.request('GET', f'/api/projects/{pid}/online-bidding')['data']['records']) ==
                          ['100.00', '110.00', '120.00'])
                    page.evaluate('async()=>{closeSlide();await refreshProject();await openStageSlide("online_quotation");}')
                    page.wait_for_function('document.getElementById("onlineBiddingInline")?.textContent.includes("（已核对）")')
                    page.wait_for_selector('.toast.show',state='hidden',timeout=10000)
                    page.locator('#onlineBiddingInline').scroll_into_view_if_needed()
                    check('saved stage reopens with three quotations and verified result summary',
                          '已登记报价 3 / 3 家（已核对）' in page.locator('#onlineBiddingInline').inner_text())
                    page.screenshot(path=str(output / '02-竞价核对完成.png')); shots.append('02-竞价核对完成.png')
                    page.evaluate('closeSlide()')
                    for theme in ['default', 'dark', 'blue', 'green']:
                        for width in [1366, 390]:
                            page.set_viewport_size(dict(width=width, height=900))
                            page.evaluate('(t)=>{updateUiPreference("theme",t);updateUiPreference("motion","off");}', theme)
                            page.evaluate('openStageSlide("online_quotation")')
                            page.wait_for_selector('#ob_ended_at', state='attached')
                            check(f'{theme}/{width} initial focus inside stage panel',
                                  page.evaluate('document.getElementById("slidePanel").contains(document.activeElement)'))
                            check(f'{theme}/{width} no horizontal overflow',
                                  page.evaluate('document.documentElement.scrollWidth<=innerWidth+2'))
                            shot=f'03-竞价界面-{theme}-{width}.png';page.screenshot(path=str(output / shot));shots.append(shot)
                            page.keyboard.press('Escape')
                            page.wait_for_selector('#slidePanel.open', state='hidden')
                    page.set_viewport_size(dict(width=1366,height=900))
                    check('ordinary calendar route opens requested stage directly',
                          page.evaluate('(pid)=>openCalendarStage(pid,"online_quotation")', pid))
                    page.wait_for_selector('#ob_ended_at', state='attached')
                    check('calendar target identity matches rendered stage',
                          page.evaluate('editingStageKey==="online_quotation" && document.getElementById("onlineBiddingInline").dataset.stageKey==="online_quotation"'))
                    check('new pinned SheetJS version is loaded',
                          page.evaluate('XLSX.version') == '0.20.3')
                    check('normal empty planned dates do not warn',
                          not any('无法解析的计划时间: (空)' in w for w in warnings))
                    check('no browser script errors', not errors)
                finally:
                    ctx.close();browser.close()
            final = c.get_project(pid)
            c.restart()
            check('quotation completion and reminder configuration survive restart',
                  c.get_project(pid) == final and
                  c.request('GET', '/api/settings')['reminder_stage_keys'] == [custom_key])
        except Exception:
            report()
            raise
        finally:
            c.stop()
    return report()


if __name__ == '__main__':
    p=argparse.ArgumentParser()
    for name in ['candidate','old-exe','fixtures','output']:
        p.add_argument('--'+name, type=Path, required=True)
    p.add_argument('--sha256', required=True)
    a=p.parse_args()
    r=verify(a.candidate.resolve(),a.sha256,a.old_exe.resolve(),a.fixtures.resolve(),a.output.resolve())
    print(json.dumps(dict(passed=r['passed'],total=r['total'],page_errors=r['page_errors'])))
