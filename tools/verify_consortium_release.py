"""Synthetic packaged-runtime checks for consortium profiles and conditional validity."""
from playwright.sync_api import sync_playwright
from src.backend_patches.data_import import _parse_xlsx_workbook


def verify_consortium(client, output, checks):
    p=client.request('POST','/api/projects',dict(name='模拟联合体资料',number='CONSORTIUM-V31',method='公开招标'))
    pid=p['id']
    members=[dict(company_name='模拟成员甲',company_address='模拟成员地址',legal_representative='模拟法人',bid_manager='模拟联系人',manager_phone='010-12345678',manager_email='member@example.test',notes='模拟成员备注'),dict(company_name='模拟成员乙')]
    lead=client.request('POST',f'/api/projects/{pid}/registrations',dict(company_name='模拟牵头单位',bidder_type='consortium',consortium_members=members,registration_method='现场报名/线下报名'))
    rid=lead['id']
    assert lead['consortium_members']==members
    other=client.request('POST',f'/api/projects/{pid}/registrations',dict(company_name='模拟未参加',registration_method='现场报名/线下报名'))
    assert len(client.get_project(pid)['registrations'])==2
    checks.append('actual API persists six member profile fields; consortium remains one registration and attachments stay on parent')

    # An old name-only edit must not erase details written by the new client.
    kept=client.request('PUT',f'/api/projects/{pid}/registrations/{rid}',dict(consortium_members=[dict(company_name=m['company_name']) for m in members]))
    assert kept['consortium_members']==members
    ledger=client.request('GET',f'/api/projects/{pid}/tender-guarantee')
    ledger['data']['records']=[dict(registration_id=rid,participation='submitted',validity='valid',deposit_status='unpaid',deposit_amount='0',refunded_amount='0',handling='rule'),
                               dict(registration_id=other['id'],participation='absent',validity='pending',reason='未参加且未提交文件',deposit_status='unpaid',deposit_amount='0',refunded_amount='0',handling='rule')]
    ledger['data']['confirmed']=True
    client.request('PUT',f'/api/projects/{pid}/tender-guarantee',dict(revision=ledger['revision'],data=ledger['data'],confirm_roster=True))
    members[0]['manager_phone']='020-99999999'
    client.request('PUT',f'/api/projects/{pid}/registrations/{rid}',dict(consortium_members=members))
    after=client.request('GET',f'/api/projects/{pid}/tender-guarantee')
    assert not after['data'].get('stale') and after['data']['confirmed']
    checks.append('actual old name-only edit preserves details and contact-only update does not invalidate confirmed bidder identity')

    with sync_playwright() as pw:
        browser=pw.chromium.launch(headless=True,executable_path='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe')
        try:
            context=browser.new_context(viewport=dict(width=1366,height=900),locale='zh-CN',timezone_id='Asia/Shanghai',reduced_motion='reduce')
            context.add_cookies([dict(name=c.name,value=c.value,url=client.base_url) for c in client.session.cookies])
            page=context.new_page();errors=[];page.on('pageerror',lambda error:errors.append(str(error)))
            page.goto(client.base_url+'/',wait_until='domcontentloaded');page.wait_for_selector('.command-metric')
            page.evaluate('(pid)=>selectProject(pid)',pid);page.wait_for_function('(pid)=>currentProject?.id===pid',arg=pid)
            for theme in ('default','dark'):
                for width in (1366,390):
                    page.set_viewport_size(dict(width=width,height=900));page.evaluate('(theme)=>applyTheme(theme)',theme)
                    page.evaluate('(rid)=>showRegistrationForm(rid)',rid)
                    assert page.locator('[data-member-field="manager_email"]').first.input_value()=='member@example.test'
                    assert page.locator('#regConsortiumRows input[type="file"]').count()==0 and page.locator('#regFiles').count()==1
                    assert page.locator('.consortium-member-actions svg').count()==4
                    assert not page.locator('#modalBody').evaluate('(e)=>e.scrollWidth>e.clientWidth+1')
                    assert page.locator('[data-member-field="company_name"]').first.evaluate('(e)=>parseFloat(getComputedStyle(e).borderRadius)>0')
                    page.screenshot(path=str(output/f'成员资料真实成品-{theme}-{width}.png'));page.evaluate('closeModal()')
            checks.append('actual member cards render fields and SVG sort controls in both themes at 1366/390 without horizontal overflow')
            page.set_viewport_size(dict(width=1366,height=900));page.evaluate('(rid)=>showRegistrationForm(rid)',rid)
            page.locator('[data-member-field="bid_manager"]').first.fill('更新后的模拟联系人')
            page.locator('[data-consortium-action="down"][data-member-index="0"]').click()
            page.locator('[data-consortium-action="add"]').click()
            page.locator('[data-member-field="company_name"][data-member-index="2"]').fill('模拟成员丙')
            page.locator('[data-member-field="manager_email"][data-member-index="2"]').fill('third@example.test')
            page.locator('#modalSaveBtn').click()
            page.wait_for_function('currentProject?.registrations?.some(r=>r.consortium_members?.length===3)')
            value=client.get_project(pid);saved=next(r for r in value['registrations'] if r['id']==rid)
            assert saved['consortium_members'][1]['bid_manager']=='更新后的模拟联系人'
            assert saved['consortium_members'][1]['manager_email']=='member@example.test'
            assert saved['consortium_members'][2]['manager_email']=='third@example.test'
            assert len(value['registrations'])==2
            checks.append('actual member reorder/add/save preserves unsaved details and parent registration count')
            page.evaluate('(rid)=>showTenderSupplierForm(rid)',other['id'])
            assert not page.locator('#tgValidity').is_visible() and page.locator('#tgValidity').is_disabled()
            page.screenshot(path=str(output/'未参加无需评定有效性.png'))
            page.locator('#tgParticipation').select_option('submitted')
            assert page.locator('#tgValidity').is_visible() and page.locator('#tgValidity').is_enabled()
            page.locator('#tgParticipation').select_option('no_documents')
            assert not page.locator('#tgValidity').is_visible()
            page.evaluate('closeModal()')
            assert not errors,errors
            checks.append('actual absent/no-documents modal hides validity, submitted enables it; no browser errors')
        finally:
            browser.close()

    response=client.session.get(f'{client.base_url}/api/projects/{pid}/registrations?export=1&scope=current',timeout=20)
    response.raise_for_status();raw=response.content
    parsed=_parse_xlsx_workbook(raw)
    assert '联合体成员资料' in parsed
    _,rows=parsed['联合体成员资料'];assert len(rows)==3
    assert any(row.get('联系人')=='更新后的模拟联系人' and row.get('电子邮箱')=='member@example.test' for row in rows)
    before=next(r for r in client.get_project(pid)['registrations'] if r['id']==rid)['consortium_members']
    client.request('DELETE',f'/api/projects/{pid}/registrations/{rid}')
    result=client.session.post(f'{client.base_url}/api/projects/{pid}/registrations/import',files={'file':('synthetic.xlsx',raw,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')},headers={'X-CSRFToken':client.csrf_token},timeout=20)
    result.raise_for_status();assert result.json()['failed']==0,result.json()
    after=client.get_project(pid)['registrations'];assert len(after)==2
    assert next(r for r in after if r['company_name']=='模拟牵头单位')['consortium_members']==before
    checks.append('actual EXE XLSX export/delete/reimport round trip retains all member profiles, ordering and one parent; no real data used')
