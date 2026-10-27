"""Verify the experience fixes in a hash-pinned EXE with synthetic local data."""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import tempfile
from unittest.mock import patch
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from playwright.sync_api import sync_playwright
from tests.test_stage_template_packaged_e2e import PackagedClient, unused_port
from tools.verify_ui_review_release import COLORS


def verify(candidate: Path, sha: str, fixtures: Path, output: Path) -> dict:
    if hashlib.sha256(candidate.read_bytes()).hexdigest() != sha:
        raise ValueError('Candidate SHA256 mismatch')
    output.mkdir(parents=True, exist_ok=False)
    checks, layouts, errors = [], [], []

    def check(name, passed, detail=None):
        checks.append(dict(name=name, passed=bool(passed), detail=detail))

    version = 'v' + json.loads((ROOT / 'package.json').read_text('utf-8'))['version']
    future = datetime.now(ZoneInfo('Asia/Shanghai')).replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=13)
    methods = ['公开招标', '竞争性磋商', '遴选', '邀请招标', '网上竞价', '单一来源', '直选']
    browser = None
    with tempfile.TemporaryDirectory(prefix='pm-experience-owned-') as temp, patch.dict(os.environ, {'PM_TEST_LICENSE_DIR': str(fixtures)}):
        client = PackagedClient(candidate, Path(temp), 'experience', unused_port())
        try:
            client.start()
            client.patch_settings(dict(reminder_enabled=False, reminder_recipient_groups=[],
                event_reminder_create_enabled=False, event_reminder_complete_enabled=False,
                supplier_shortage_email_enabled=False))
            for i, method in enumerate(methods):
                value = client.request('POST', '/api/projects', dict(number=f'SIM-2026-{i + 1:03}',
                    name='隔离模拟公共服务中心办公设备与配套信息系统采购及维护项目（第二次采购）' if i == 0 else f'隔离体验模拟项目{i}',
                    purchaser='隔离模拟采购人', method=method, year=2026, no_deposit=True,
                    prepare_owner='模拟经办人', budget='308259.21'))
                if i == 0:
                    pid = value['id']
            closed = client.request('POST', '/api/projects', dict(number='SIM-2025-001',
                name='隔离模拟已关闭历史项目', purchaser='隔离模拟采购人', method='公开招标', year=2025, no_deposit=True))
            client.request('PUT', f'/api/projects/{closed["id"]}',
                {'is_terminated': True, 'terminated_type': 'terminated', 'terminated_reason': '隔离验证关闭'})
            detail = client.get_project(pid)
            first = detail['stages'][0]
            for item in first.get('checklist', []):
                client.request('PUT', f'/api/projects/{pid}/stage-checklist/{item["id"]}', {'completed': True})
            client.request('PUT', f'/api/projects/{pid}/stages/{first["key"]}', {'completed': True})
            for i, stage in enumerate(detail['stages'][1:8]):
                client.request('PUT', f'/api/projects/{pid}/stages/{stage["key"]}',
                    {'planned_at': (future + timedelta(days=i)).strftime('%Y-%m-%dT%H:%M:%S')})
            before = client.get_project(pid)
            source = client.request('GET', '/api/projects')
            check('runtime version', client.request('GET', '/api/system-info')['version'] == version)
            with sync_playwright() as pw:
                browser = pw.chromium.launch(headless=True, executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
                ctx = browser.new_context(viewport=dict(width=1366, height=768), timezone_id='Asia/Shanghai', reduced_motion='reduce')
                ctx.add_cookies([dict(name=c.name, value=c.value, url=client.base_url) for c in client.session.cookies])
                page = ctx.new_page()
                page.set_default_timeout(10000)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto(client.base_url, wait_until='networkidle')
                page.wait_for_selector('.command-insight-row')
                check('fresh account active-first sort', page.evaluate('readUiPreferences().sort') == 'active_first')
                check('active project comes before closed history', page.locator('.sidebar-project').first.get_attribute('data-project-id') == str(pid))
                total = int(page.locator('.command-insight-panel .command-panel-head b').inner_text())
                counts = page.locator('.command-insight-count').all_text_contents()
                check('distribution total includes closed projects', total == len(source), dict(total=total, source=len(source)))
                check('distribution entries sum to the same total', sum(map(int, counts)) == total, counts)
                check('all procurement methods remain visible', len(counts) == 7)
                check('dashboard has one named main heading', page.locator('#view-dashboard h1').count() == 1 and page.locator('#view-dashboard h1').inner_text() == '总览看板')
                check('metric cards disclose project and node units', page.locator('.command-metric-unit').all_text_contents() == ['个项目', '个项目', '个节点', '个节点', '个项目'])
                check('next node card explains its future-only scope', '仅展示尚未到期的计划节点' in page.locator('.command-node-context').inner_text())
                page.evaluate('openCommandPalette()')
                page.keyboard.press('ArrowDown')
                check('palette arrows select the next command', page.locator('[data-command-entry].active').get_attribute('data-command-value') == 'procure')
                active_id = page.locator('#commandPaletteInput').get_attribute('aria-activedescendant')
                check('palette exposes active result to assistive technology', bool(active_id) and page.locator('#' + active_id).get_attribute('aria-selected') == 'true')
                page.keyboard.press('ArrowUp')
                page.keyboard.press('Enter')
                check('palette Enter opens the selected page', page.locator('#commandPalette').get_attribute('aria-hidden') == 'true' and page.locator('#view-dashboard').get_attribute('class').find('active') >= 0)
                page.evaluate('openCommandPalette("没有匹配的模拟命令")')
                check('palette announces zero matches', '0 个搜索结果' in page.locator('#commandPaletteStatus').inner_text())
                page.keyboard.press('Escape')
                page.evaluate('void confirmDialog("隔离确认", "隔离说明")')
                check('confirm dialog has an accessible name', page.get_by_role('dialog', name='隔离确认', exact=True).count() == 1)
                page.keyboard.press('Escape')
                check('preview explains the first six of seven', bool(re.search(r'显示前\s*6\s*条[，,]?\s*共\s*7\s*个节点', page.locator('#commandTaskArea').inner_text())))
                check('future status has no raw ISO separator', 'T' not in ''.join(page.locator('.command-action-time').all_text_contents()))
                page.get_by_role('button', name=re.compile('全部待办')).click()
                check('full node list retains all seven nodes', page.locator('.command-metric-result').count() == 7)
                page.get_by_role('button', name='关闭列表', exact=True).click()
                for theme in ['default', 'blue', 'green', 'dark']:
                    for width, height in [(1366, 768), (390, 844)]:
                        prefix = f'{theme}/{width}'
                        page.set_viewport_size(dict(width=width, height=height))
                        page.evaluate('(t)=>updateUiPreference("theme",t)', theme)
                        page.evaluate('switchView("dashboard")')
                        page.wait_for_selector('.command-action-row')
                        geometry = page.evaluate('''()=>{
                            const nav=document.querySelector('.sidebar-nav'),nr=nav.getBoundingClientRect();
                            const task=document.querySelector('.command-action-row').getBoundingClientRect();
                            return {navHeight:nav.clientHeight,navScrollHeight:nav.scrollHeight,
                                navItems:[...nav.querySelectorAll('.nav-item')].every(e=>{const r=e.getBoundingClientRect();return r.top>=nr.top-1&&r.bottom<=nr.bottom+1}),
                                taskY:task.top,taskBottom:task.bottom,overflow:document.documentElement.scrollWidth>innerWidth,
                                font:parseFloat(getComputedStyle(document.querySelector('.command-action-meta')).fontSize)};
                        }''')
                        layouts.append(dict(view=prefix, **geometry))
                        check(prefix + ' all five nav items fit without a nested scroll', geometry['navItems'] and geometry['navScrollHeight'] <= geometry['navHeight'] + 1, geometry)
                        check(prefix + ' key metadata is readable', geometry['font'] >= 12)
                        check(prefix + ' no page overflow', not geometry['overflow'])
                        if width == 390:
                            check(prefix + ' first pending row fits on the first screen', geometry['taskY'] < 700 and geometry['taskBottom'] <= height)
                            page.wait_for_function('document.getElementById("sidebar").inert')
                            check(prefix + ' closed sidebar excludes hidden controls', page.locator('#sidebar').evaluate('(el)=>el.inert'))
                            page.locator('#hamburger').click()
                            check(prefix + ' opened sidebar takes keyboard focus', page.locator('#sidebar').evaluate('(el)=>el.contains(document.activeElement)') and page.locator('#hamburger').get_attribute('aria-expanded') == 'true')
                            page.keyboard.press('Escape')
                            check(prefix + ' Escape restores sidebar trigger', page.locator('#hamburger').evaluate('(el)=>document.activeElement===el') and page.locator('#hamburger').get_attribute('aria-expanded') == 'false')
                        contrast = page.locator('.command-action-meta').first.evaluate(COLORS)
                        check(prefix + ' task metadata contrast', contrast['ratio'] >= 4.5, contrast)
                        page.screenshot(path=str(output / f'dashboard-{theme}-{width}.png'), animations='disabled')
                        page.evaluate('(id)=>selectProject(id)', pid)
                        page.wait_for_function('(id)=>currentProject?.id===id', arg=pid)
                        check(prefix + ' readable budget units', '预算：308,259.21 元' in page.locator('#projectMeta').inner_text())
                        page.evaluate('switchProjectTab("tasks")')
                        current = before['current_stage_key']
                        stage_name = next(s['name'] for s in before['stages'] if s['key'] == current)
                        row = page.locator('#tasksContent tbody tr').filter(has_text=stage_name).first
                        check(prefix + ' current stage matches the board status', row.locator('td').nth(1).inner_text().strip() == '进行中')
                        check(prefix + ' task table supports keyboard scrolling', page.locator('.task-table-scroll[role=region][tabindex="0"]').count() == 1)
                        if width == 390:
                            check(prefix + ' horizontal table hint', page.locator('.task-table-scroll-hint').is_visible())
                        page.screenshot(path=str(output / f'tasks-{theme}-{width}.png'), animations='disabled')
                page.set_viewport_size(dict(width=1366, height=768))
                page.evaluate('switchView("calendar")')
                page.wait_for_selector('button.calendar-cell[data-calendar-date]')
                check('calendar day cells are native buttons', page.locator('button.calendar-cell[data-calendar-date]').count() >= 28)
                check('calendar has one roving tab stop', page.locator('button.calendar-cell[tabindex="0"]').count() == 1)
                check('month controls have clear names', page.get_by_role('button', name='上个月', exact=True).count() == 1 and page.get_by_role('button', name='下个月', exact=True).count() == 1)
                selected = page.locator('button.calendar-cell[tabindex="0"]').first
                selected.focus()
                selected.press('ArrowRight')
                check('calendar arrow focus remains on a date', page.evaluate('document.activeElement.matches("button.calendar-cell[data-calendar-date]")'))
                page.screenshot(path=str(output / 'calendar-keyboard.png'), animations='disabled')
                check('viewing leaves project facts unchanged', client.get_project(pid) == before)
                check('no browser page errors', not errors, errors)
                browser.close()
                browser = None
        except Exception as exc:
            check('verification completed without exception', False, f'{type(exc).__name__}: {exc}')
        finally:
            try:
                if browser is not None and browser.is_connected():
                    browser.close()
            except Exception:
                # The Playwright context may already have closed its driver.
                pass
            finally:
                client.stop()
    result = dict(version=version, candidate_sha256=sha, checks=checks, passed=sum(c['passed'] for c in checks),
        total=len(checks), layouts=layouts, page_errors=errors, synthetic_data_only=True,
        production_data_modified=False, native_desktop_verified=False, real_mail_messages_sent=0)
    (output / 'result.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--sha256', required=True)
    parser.add_argument('--license-fixtures', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    result = verify(args.candidate.resolve(), args.sha256.lower(), args.license_fixtures.resolve(), args.output.resolve())
    print(json.dumps({k: result[k] for k in ['version', 'passed', 'total', 'page_errors']}, ensure_ascii=False))
    sys.exit(0 if result['passed'] == result['total'] else 1)
