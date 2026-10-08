"""Exercise packaged project operations with temporary keys, database and files."""
from pathlib import Path
import argparse
import io
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / 'authorization'))
import license_issuer
from tests.test_stage_template_packaged_e2e import PackagedClient, METHODS, unused_port
from src.backend_patches.data_import import _build_workbook_xlsx, _parse_xlsx_workbook as read_workbook


def make_workbook(sheets):
    return _build_workbook_xlsx([{'name':name,'title':'隔离测试导入','headers':headers,
                                  'required':[], 'example':rows[0]} for name,headers,rows in sheets])


def verify(candidate, legacy_license_dir=None):
    checks = []
    original_spawn = subprocess.Popen
    with tempfile.TemporaryDirectory(prefix='project-functional-') as directory:
        temp = Path(directory)
        with patch.dict(os.environ, {'PM_TEST_LICENSE_DIR': str(legacy_license_dir or temp/'empty'),
                                    'PROCUREMENT_ISSUER_HOME': str(temp/'keys')}):
            client = PackagedClient(Path(candidate).resolve(), temp, 'functional', unused_port())
            if legacy_license_dir is None:
                license_issuer.initialize_keys('isolated-functional-password', client.data_root)
                license_issuer.issue(target_dir=client.data_root, organization='示例单位', expires=None,
                                     password='isolated-functional-password')

            def spawn(args, **kwargs):
                return original_spawn([args[0], '--headless'], **kwargs)

            def request(method, path, payload=None, *, expected=200, files=None, data=None):
                headers = {'X-CSRFToken': client.csrf_token} if method != 'GET' else {}
                response = client.session.request(method, client.base_url+path, json=payload if files is None else None,
                                                  files=files, data=data, headers=headers, timeout=30)
                if response.status_code != expected:
                    raise AssertionError(f'{method} {path}: expected {expected}, got {response.status_code}; {response.text[:350]}')
                return response

            def check(name):
                checks.append(name)
                print('PASS: '+name, file=sys.stderr)

            def created(path, payload):
                return request('POST', path, payload, expected=201).json()

            try:
                with patch.object(subprocess, 'Popen', side_effect=spawn):
                    client.start()
                    assert client.request('GET', '/api/license/status')['status'] == 'valid'
                    assert client.request('GET', '/api/projects') == []
                    client.patch_settings({'export_folder': str(temp/'exports')})
                    check('fresh isolated authorization, login and empty database')
                    settings = client.request('GET', '/api/settings')
                    projects = [client.create_project(method, f'method-{index}') for index, method in enumerate(METHODS)]
                    assert all(client.get_project(row['id'])['stages'] for row in projects)
                    check('create projects and stage workflows for all eight procurement methods')
                    online = projects[METHODS.index('网上竞价')]
                    opid = online['id']
                    bidders = [created(f'/api/projects/{opid}/registrations', {'company_name':f'竞价测试供应商{index}',
                                                                             'bidder_type':'standalone'}) for index in range(3)]
                    ledger = client.request('GET',f'/api/projects/{opid}/online-bidding')
                    ledger_data = {'start_at':'2026-09-20T09:00','end_at':'2026-09-20T12:00',
                                   'registration_end':'2026-09-19T18:00','roster_locked':True,
                                   'records':[{'registration_id':row['id'],'review':'approved','amount':str(10+index*10),
                                               'quoted_at':f'2026-09-20T09:0{index+1}'} for index,row in enumerate(bidders)],
                                   'verified':True,'ended_at':'2026-09-20T09:03','end_reason':'all_quoted','evidence':'隔离平台结果示例'}
                    saved = client.request('PUT',f'/api/projects/{opid}/online-bidding',
                                           {'revision':ledger['revision'],'data':ledger_data,'reason':'隔离结果登记','stage_key':'online_quotation'})
                    updated_ledger = client.request('GET',f'/api/projects/{opid}/online-bidding')
                    assert updated_ledger['revision'] > ledger['revision']
                    assert updated_ledger['summary']['verified'] is True
                    assert updated_ledger['summary']['lots'][0]['winner'] == '竞价测试供应商0'
                    assert float(updated_ledger['summary']['lots'][0]['amount']) == 10
                    request('PUT',f'/api/projects/{opid}/online-bidding',
                            {'revision':ledger['revision'],'data':ledger_data,'reason':'旧版本提交'},expected=409)
                    check('external-platform bidding register, lowest result and stale-revision protection')
                    project = projects[0]
                    pid = project['id']
                    prefix = f'/api/projects/{pid}'
                    request('PUT', prefix, {'budget': '100万元', 'notes': '隔离测试备注'})
                    assert client.get_project(pid)['budget'] == '100万元'
                    before = client.get_project(pid)
                    for bad in ({'method':'未支持方式'}, {'year':'invalid'}, {'name':None}, {'is_terminated':'false'}, []):
                        request('PUT', prefix, bad, expected=400)
                    after = client.get_project(pid)
                    assert after['method'] == before['method'] and after['name'] == before['name']
                    check('project editing retains text budgets and rejects invalid fields without saving')
                    lot = created(prefix+'/lots', {'lot_number':'包1','lot_name':'测试采购包','budget':'10000.25'})
                    lid = lot['id']
                    request('PUT', prefix+f'/lots/{lid}', {'lot_name':'更新采购包','budget':'12000.50'})
                    request('PUT', prefix+f'/lots/{lid}', {'budget':'NaN'}, expected=400)
                    assert len(client.request('GET', prefix+'/lots')) == 1
                    check('purchase lot create, update, list and finite amount validation')
                    registration = created(prefix+'/registrations', {'company_name':'示例供应商甲','lot_id':lid,
                                                                 'bidder_type':'standalone','acquisition_date':'2026-10-08'})
                    rid = registration['id']
                    created(prefix+'/registrations', {'company_name':'示例联合体','lot_id':lid,'bidder_type':'consortium',
                                                      'consortium_members':[{'company_name':'示例成员一'},{'company_name':'示例成员二'}]})
                    request('PUT', prefix+f'/registrations/{rid}', {'manager_phone':'00000000000'})
                    request('POST', prefix+'/registrations', {'company_name':'示例供应商甲','lot_id':lid}, expected=409)
                    registrations = client.request('GET', prefix+'/registrations')
                    assert len(registrations) == 2
                    check('standalone and consortium registration, edits and duplicate protection')
                    bid = created(prefix+'/bid-results', {'lot_id':lid,'winning_supplier':'示例供应商甲','winning_amount':'100.25','is_shortlisted':False})
                    for bad in (-1, 'NaN', 'Infinity', 'not-a-number'):
                        request('POST', prefix+'/bid-results', {'lot_id':lid,'winning_supplier':'无效结果','winning_amount':bad}, expected=400)
                    request('PUT', prefix+f"/bid-results/{bid['id']}", {'winning_amount':'120.75'})
                    check('bid results create and update reject invalid amounts')
                    notice = created(prefix+'/notice-deliveries', {'lot_id':lid,'supplier_name':'示例供应商甲','pickup_date':'2026-10-08'})
                    invoice = created(prefix+'/service-fee-invoices', {'lot_id':lid,'invoice_number':'TEST-01','invoice_date':'2026-10-08','amount':'50.25'})
                    archive = created(prefix+'/archive-deliveries', {'recipient':'示例采购人','sent_date':'2026-10-08'})
                    for section, row, field in (('notice-deliveries',notice,'pickup_date'),('service-fee-invoices',invoice,'invoice_date'),('archive-deliveries',archive,'sent_date')):
                        request('PUT', prefix+f"/{section}/{row['id']}", {field:'2026-02-30'}, expected=400)
                        listed = client.request('GET', prefix+'/'+section)
                        assert next(item for item in listed if item['id']==row['id'])[field] == '2026-10-08'
                    check('notice, invoice and archive delivery CRUD retain saved dates on validation failure')
                    complaint = created(prefix+'/complaints', {'challenger':'示例质疑方','submit_date':'2026-10-08',
                                                               'targets':[{'target_type':'采购人','target_name':'示例采购人','needs_statement':True,'response_deadline':'2026-10-10'}],
                                                               'issues':[{'title':'示例事项','affects_result':False}]})
                    cid = complaint['id']
                    event = created(prefix+f'/complaints/{cid}/events', {'event_type':'内部研究/法律审核','event_time':'2026-10-08T09:30','summary':'示例办理记录','deadline':'2026-10-10'})
                    request('PUT', prefix+f"/complaints/{cid}/events/{event['id']}", {'summary':'更新示例记录','deadline':'2026-13-10'}, expected=400)
                    request('PUT', prefix+f'/complaints/{cid}', {'reply_deadline':'2026-13-10','targets':[]}, expected=400)
                    request('POST', prefix+f'/complaints/{cid}/set-status', {'action':'resolve'})
                    check('complaints, nested targets/issues, process events and status transitions')
                    clarification = created(prefix+'/clarifications', {'title':'测试澄清','publish_date':'2026-10-08',
                                                                       'affects_deadline':True,'original_deadline':'2026-10-13T09:00','new_deadline':'2026-10-14T09:00'})
                    request('PUT', prefix+f"/clarifications/{clarification['id']}", {'new_deadline':'invalid'}, expected=400)
                    request('PUT', prefix+f"/clarifications/{clarification['id']}", {'notes':'澄清已更新'})
                    check('clarification create/update and deadline validation')
                    catalog = created(prefix+'/archive-catalog', {'category':'测试资料','document_name':'测试归档项'})
                    item_path = prefix+f"/archive-catalog/{catalog['id']}"
                    request('PUT', item_path, {'has_original':True,'agency_copies':'3','purchaser_copies':'2'})
                    request('PUT', prefix+'/archive-catalog/bulk', {'ids':[catalog['id']],'applicable':None,'has_original':None,'has_scan':True,'transferred':None,'agency_copies':'','purchaser_copies':''})
                    record = next(item for item in client.get_project(pid)['archive_catalog'] if item['id']==catalog['id'])
                    assert record['agency_copies'] == 3 and record['purchaser_copies'] == 2 and record['has_original']
                    check('archive item and bulk updates preserve no-change selections and copy counts')
                    upload = request('POST', prefix+'/attachments', files={'files':('sample.txt',b'isolated attachment','text/plain')},
                                     data={'description':'测试附件'}, expected=200).json()
                    attachment = client.request('GET', prefix+'/attachments')[0]
                    aid = attachment['id']
                    downloaded = request('GET', f'/api/attachments/{aid}/download')
                    assert downloaded.content == b'isolated attachment'
                    request('PUT', f'/api/attachments/{aid}', {'description':'更新附件说明'})
                    check('real attachment upload, encrypted storage download and metadata update')
                    exported = request('GET', '/api/export?year=2026')
                    workbook = read_workbook(exported.content)
                    assert workbook
                    with zipfile.ZipFile(io.BytesIO(exported.content)) as z:
                        assert z.testzip() is None
                    registration_export = request('GET', prefix+'/registrations?export=1&scope=current')
                    assert read_workbook(registration_export.content)
                    check('project and registration XLSX export structures and content')
                    imported_bytes = make_workbook([('项目', ['项目编号','项目名称','采购方式','年度'], [['IMPORT-NEW','导入示例项目','公开招标',2026]])])
                    imported = request('POST','/api/import/projects',files={'file':('test.xlsx',imported_bytes,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()
                    assert imported['success'] == 1
                    imported_reg = make_workbook([('供应商报名',['公司名称','所属包号'],[['导入供应商','包1']])])
                    result = request('POST', prefix+'/registrations/import',files={'file':('test.xlsx',imported_reg,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')}).json()
                    assert result['success'] == 1
                    check('real project and registration workbook import without overwriting existing records')
                    for route in ('/api/stats','/api/calendar?year=2026&month=10','/api/logs','/api/export-years',
                                  '/api/settings?project_activity_view=recent','/api/settings?purchaser_board_view=bootstrap'):
                        request('GET', route)
                    check('dashboard, calendar, logs, activity and purchaser data endpoints')
                    # Preserve completed historical stages when changing defaults.
                    original_snapshot = [(stage['key'],stage['name']) for stage in client.get_project(pid)['stages']]
                    custom = [{'id':'custom_review','name':'自定义审查','icon':'🔎','modules':['common','checklist']},
                              {'id':'custom_opening','name':'自定义开标','icon':'🎯','modules':['common','bid_opening','clarification']},
                              {'id':'custom_archive','name':'自定义归档','icon':'📦','modules':['common','archive']}]
                    templates = settings['stage_templates'] | {'公开招标':custom}
                    client.patch_settings({'stage_templates':templates})
                    assert [(stage['key'],stage['name']) for stage in client.get_project(pid)['stages']] == original_snapshot
                    custom_project = client.create_project('公开招标','custom')
                    cpid = custom_project['id']
                    item = created(f'/api/projects/{cpid}/stage-checklist', {'stage_key':'custom_review','title':'自定义必检','required':True})
                    request('PUT',f"/api/projects/{cpid}/stage-checklist/{item['id']}",{'completed':True})
                    client.update_stage(cpid,'custom_review',True)
                    client.update_stage(cpid,'custom_review',False)
                    batch_path = '/api/batch/advance-stage'
                    batch_payload = {'stage_key':'custom_review','project_ids':[cpid,cpid],
                                     'completed_date':'2026-10-08'}
                    request('POST',batch_path,batch_payload | {'completed_date':'invalid'},expected=400)
                    result = request('POST',batch_path,batch_payload).json()
                    assert result['advanced_count'] == 1, result
                    repeated = request('POST',batch_path,batch_payload).json()
                    assert repeated['advanced_count'] == 0, repeated
                    client.update_stage(cpid,'custom_review',False)
                    check('custom stage batch advancement validates dates, deduplicates and skips completed stages')
                    request('PUT',f'/api/projects/{cpid}/stages/custom_opening',{'planned_at':'2026-10-13T09:00'})
                    clar = created(f'/api/projects/{cpid}/clarifications',{'title':'自定义阶段澄清','affects_deadline':True,'original_deadline':'2026-10-13T09:00','new_deadline':'2026-10-15T10:00'})
                    opening = next(stage for stage in client.get_project(cpid)['stages'] if stage['key']=='custom_opening')
                    assert opening['planned_at'].startswith('2026-10-15T10:00')
                    request('DELETE',f"/api/projects/{cpid}/clarifications/{clar['id']}")
                    request('DELETE',f"/api/projects/{cpid}/stage-checklist/{item['id']}")
                    check('custom checklist and opening module work; template saves preserve historical snapshots')
                    for section, row in (('bid-results',bid),('notice-deliveries',notice),('service-fee-invoices',invoice),('archive-deliveries',archive)):
                        request('DELETE',prefix+f"/{section}/{row['id']}")
                    request('DELETE',prefix+f"/complaints/{cid}/events/{event['id']}")
                    request('DELETE',prefix+f'/complaints/{cid}')
                    request('DELETE',prefix+f"/clarifications/{clarification['id']}")
                    request('DELETE',item_path)
                    request('DELETE',f'/api/attachments/{aid}')
                    request('DELETE',prefix+f'/registrations/{rid}')
                    check('business record and file deletion endpoints complete successfully')
                    me = client.request('GET','/api/me')
                    uid = me['id']
                    request('PUT',f'/api/users/{uid}',{'is_admin':False},expected=400)
                    request('PUT',f'/api/users/{uid}',{'is_active':False},expected=400)
                    account = created('/api/users',{'username':'isolated_reader','display_name':'测试只读用户',
                                                    'password':'Isolated-reader-pass','is_admin':False,'is_active':True})
                    request('PUT',f"/api/users/{account['id']}",{'display_name':'更新用户名称'})
                    request('POST',f"/api/users/{account['id']}/reset-password",{'password':'Replacement-reader-pass'})
                    request('DELETE',f"/api/users/{account['id']}")
                    check('user CRUD/reset and administrator self-protection')
                    count_before = len(client.request('GET','/api/projects'))
                    client.restart()
                    assert len(client.request('GET','/api/projects')) == count_before
                    assert client.get_project(pid)['budget'] == '100万元'
                    request('DELETE',prefix)
                    request('GET',prefix,expected=404)
                    check('actual EXE restart preserves all saved data; project deletion removes record')
            finally:
                client.stop()
    return {'checks':checks,'count':len(checks),'isolated_data':True,'production_data_written':False,
            'native_desktop_verified':False,'real_mail_sent':0}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate',required=True)
    parser.add_argument('--report',required=True)
    parser.add_argument('--legacy-license-dir')
    args = parser.parse_args()
    report = verify(args.candidate,args.legacy_license_dir)
    Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf-8')
    print(json.dumps(report,ensure_ascii=True))
