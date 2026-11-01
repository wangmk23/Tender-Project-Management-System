"""Hash-pinned Windows EXE procurement-method correction acceptance.

All mutations use actual HTTP APIs in an owned, newly authorized temporary
profile. The candidate's SQLCipher connector is used only for query-only reads
of that profile, to prove stage identities, hidden history and final state.
This is an API/database gate, not native desktop or two-window UI acceptance.
"""
from __future__ import annotations

import argparse
from contextlib import closing
import json
from pathlib import Path
import platform
import re
import subprocess
import sys
import tempfile
import traceback

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tools.verify_media_release import Report as BaseReport,require,sha256

REQUIRED_CHECKS=frozenset(('candidate','startup','version','database connector',
    'round trip','notes dependency','planned dependency','same-name conflict',
    'automatic skip reorder','manual skip preservation','same-method custom flow',
    'protected identity unchanged','candidate unchanged'))


class Report(BaseReport):
    def result(self):
        value=super().result()
        missing=sorted(REQUIRED_CHECKS-{r['name'] for r in self.checks if r['passed']})
        return {**value,'passed':value['passed'] and not missing,'missing_required_checks':missing,
            'browser_ui_verified':False,'scope':'Owned SHA-pinned Windows EXE, real HTTP APIs and query-only reads of its synthetic encrypted database; stale requests use independent HTTP sessions. No native desktop, actual dual-window UI, production data, or external-network acceptance.'}


def parser():
    result=argparse.ArgumentParser(description=__doc__)
    result.add_argument('--candidate',type=Path,required=True)
    result.add_argument('--candidate-sha256',required=True)
    result.add_argument('--evidence',type=Path,required=True)
    result.add_argument('--expected-version',default='v5.8.56')
    result.add_argument('--source-commit',help='Product build commit associated with this candidate, if supplied by its build report')
    return result


def validate_candidate(path,digest):
    if not isinstance(digest,str) or not re.fullmatch('[a-fA-F0-9]{64}',digest):
        raise ValueError('--candidate-sha256 must contain exactly 64 hexadecimal digits')
    from tools.release_browser import require_windows_candidate
    return require_windows_candidate(Path(path),digest)


def owned_database_paths(data_root,temporary_root):
    data=Path(data_root);root=Path(temporary_root).resolve(strict=True)
    if data.is_symlink() or not data.resolve(strict=True).is_relative_to(root):
        raise ValueError('Database inspection is limited to the owned temporary profile')
    paths=tuple(data/name for name in ('bidding.db','data_key.dpapi'))
    if any(p.is_symlink() or not p.resolve(strict=True).is_relative_to(root) for p in paths):
        raise ValueError('Owned database or key path is a symlink or leaves the temporary profile')
    return tuple(p.resolve(strict=True) for p in paths)


class OwnedDatabase:
    def __init__(self,candidate,data_root,temporary_root):
        from tools.benchmark_system import _load_candidate_sqlcipher
        from src.backend_patches.signed_attachments import _dpapi_transform
        self.database,key=owned_database_paths(data_root,temporary_root)
        self.runtime=_load_candidate_sqlcipher(candidate,Path(temporary_root)/'query-only-connector')
        self._key=_dpapi_transform(key.read_bytes(),False)
        require(len(self._key)==32,'Owned database key has an unexpected length')

    def snapshot(self,pid):
        # The native connector and exact connection code come from this candidate.
        # Never expose its DPAPI-protected synthetic key in evidence.
        with closing(self.runtime['connect_encrypted'](self.database,self._key,False)) as db:
            db.row_factory=self.runtime['extension'].Row
            db.execute('PRAGMA query_only=ON')
            result={}
            for name,column in (('projects','id'),('stages','project_id'),('project_procurement_snapshots','project_id')):
                result[name]=[dict(row) for row in db.execute(f'SELECT * FROM {name} WHERE {column}=? ORDER BY rowid',(int(pid),))]
            return result

    def stages(self,pid):
        return {row['stage_key']:row for row in self.snapshot(pid)['stages']}

    def metadata(self):
        return {'extension_sha256':self.runtime['extension_sha256'],
            'connection_code_sha256':self.runtime['connect_code_sha256'],
            'query_only':True,'synthetic_key_recorded':False}

    def close(self):
        self._key=b''
        self.runtime['dll_handle'].close()


def validate_rejection(status,body,before,after):
    require(status==409,'Dependency change must return HTTP 409, received '+str(status))
    require(body.get('code')=='FLOW_DEPENDENCIES','Dependency conflict must be explicitly identified')
    require(after==before,'Rejected change altered physical project, procurement or stage rows')


def validate_roundtrip(original,restored,keys):
    active=[r['stage_key'] for r in sorted(restored.values(),key=lambda r:r.get('stage_position') or 0) if not r.get('template_removed')]
    require(active==keys,'Returned procurement method has incorrect active stages: '+repr(active))
    format_only=[]
    for key,row in original.items():
        before=dict(row);after=dict(restored.get(key) or {})
        # json.dumps with/without separators changes storage bytes, not the
        # saved business modules. Compare that one JSON value semantically;
        # preserve strict equality for stage IDs and every other physical field.
        if 'modules_json' in before and 'modules_json' in after:
            raw_before=before['modules_json'];raw_after=after['modules_json']
            before['modules_json']=json.loads(raw_before) if isinstance(raw_before,str) else raw_before
            after['modules_json']=json.loads(raw_after) if isinstance(raw_after,str) else raw_after
            if raw_before!=raw_after and before['modules_json']==after['modules_json']:
                format_only.append(key+'.modules_json')
        require(after==before,'Switching back changed or recreated original stage '+key)
    require(all(row.get('template_removed') for key,row in restored.items() if key not in original),
            'Unused switched-away stages were not retained as hidden history')
    return format_only


def validate_skip_transition(transition,stage,manual):
    expected='preserved' if manual else 'restored'
    require(transition.get(expected)==['refund'],'Automatic-skip provenance classified incorrectly: '+repr(transition))
    require(transition.get('restored' if manual else 'preserved')==[],'Automatic and manually edited stages were mixed')
    require(bool(stage.get('completed'))==manual and bool(stage.get('skipped'))==manual,
            'Automatic-skip completion state was not restored/preserved as required')
    if manual:require(stage.get('notes')=='manual','Manual stage notes were lost')


def active_keys(project):
    return [r['key'] for r in project['stages'] if not r.get('template_removed')]


def stage(project,key):
    return next(r for r in project['stages'] if r['key']==key)


def read(client,pid):
    return client.request('GET',f'/api/projects/{pid}')


def method(client,name,rows,**extra):
    catalog=client.request('GET','/api/procurement-methods')
    return client.request('POST','/api/procurement-methods',dict(name=name,revision=catalog['revision'],
        template_mode='independent',stages=rows,**extra))['method']


def create(client,selection,number,**extra):
    return client.request('POST','/api/projects',dict(number=number,name='隔离采购方式更正验收-'+number,
        procurement_method_id=selection['id'],year=2026,**extra))


def save(client,pid,values):
    current=read(client,pid)
    return client.request('PUT',f'/api/projects/{pid}',dict(values,record_version=current['record_version']))


def save_stage(client,pid,key,values):
    current=stage(read(client,pid),key)
    return client.request('PUT',f'/api/projects/{pid}/stages/{key}',dict(values,record_version=current['record_version']))


def round_trip(client,database,a,b):
    project=create(client,a,'METHOD-ROUNDTRIP');pid=project['id']
    save_stage(client,pid,'shared',{'completed':True,'completed_at':'2026-10-20T09:15','notes':'shared history stays'})
    before=database.stages(pid)
    changed=save(client,pid,{'procurement_method_id':b['id']})
    require(active_keys(changed)==['shared','new'],'Switching procurement method did not synchronize target workflow')
    middle=database.stages(pid)
    require(middle['shared']==before['shared'],'Shared completed stage was modified')
    require(middle['old']['id']==before['old']['id'] and middle['old']['template_removed'],
            'Switched-away unused stage must retain its identity as hidden history')
    returned=save(client,pid,{'procurement_method_id':a['id']})
    restored=database.stages(pid)
    format_only=validate_roundtrip(before,restored,['shared','old'])
    require(returned['procurement']['method_id']==a['id'],'Returned method identity differs')
    return {'project_id':pid,'active_before':['shared','old'],'active_switched':active_keys(changed),
        'active_returned':active_keys(returned),'original_stage_ids':{k:r['id'] for k,r in before.items()},
        'returned_stage_ids':{k:r['id'] for k,r in restored.items()},'shared_record_preserved':True,
        'switched_away_rows_retained':True,'format_only_json_fields':format_only}


def dependency(client,database,a,b,field):
    project=create(client,a,'DEPENDENCY-'+field);pid=project['id']
    value='2026-12-01T09:00' if field=='planned_at' else 'old stage notes stay'
    save_stage(client,pid,'old',{field:value})
    original=read(client,pid);before=database.snapshot(pid)
    if field=='planned_at':require(database.stages(pid)['old'].get('planned_datetime'),'Actual core planned_datetime was not populated')
    response=client.session.put(client.base_url+f'/api/projects/{pid}',json={
        'procurement_method_id':b['id'],'name':'rejected name','record_version':original['record_version']},
        headers={'X-CSRFToken':client.csrf_token},timeout=20)
    body=response.json();after=database.snapshot(pid)
    validate_rejection(response.status_code,body,before,after)
    require(read(client,pid)==original,'Rejected change altered the API project payload')
    return {'project_id':pid,'dependency_field':field,'physical_field':'planned_datetime' if field=='planned_at' else field,
        'http_status':response.status_code,'response':body,'physical_rows_unchanged':True,'api_payload_unchanged':True}


def same_name_conflict(client,database,rows):
    import requests
    a=method(client,'同名冲突验收方式',rows,regime='enterprise',quantity_rule={'mode':'fixed','minimum':2})
    b=method(client,'同名冲突验收方式',rows,regime='collective',quantity_rule={'mode':'fixed','minimum':5})
    original=create(client,a,'SAME-NAME');pid=original['id'];old_token=original['record_version']
    with requests.Session() as stale:
        stale.trust_env=False;stale.cookies.update(client.session.cookies)
        changed=save(client,pid,{'procurement_method_id':b['id']})
        require(changed['record_version']!=old_token,'Same-name method change did not invalidate the old project token')
        before=database.snapshot(pid)
        response=stale.put(client.base_url+f'/api/projects/{pid}',json={
            'procurement_method_id':a['id'],'record_version':old_token,'budget':'stale draft'},
            headers={'X-CSRFToken':client.csrf_token},timeout=20)
    require(response.status_code==409 and response.json().get('code')=='RECORD_VERSION_CONFLICT',
        'Independent stale HTTP session must receive version-conflict 409')
    require(database.snapshot(pid)==before,'Stale request changed committed project data')
    final=read(client,pid)
    require(final['procurement']['method_id']==b['id'] and final.get('budget')!='stale draft',
            'Stale request overwrote the latest procurement selection')
    return {'project_id':pid,'old_token':old_token,'new_token':changed['record_version'],
        'http_status':response.status_code,'code':response.json()['code'],'database_unchanged_after_rejection':True,
        'independent_http_session':True,'actual_two_window_ui_verified':False}


def skip_reorder(client,a,b,manual):
    project=create(client,a,'SKIP-'+str(manual),no_deposit=True);pid=project['id']
    require(stage(project,'refund')['skipped'],'Creation did not automatically skip refund')
    if manual:save_stage(client,pid,'refund',{'notes':'manual'})
    reordered=save(client,pid,{'procurement_method_id':b['id']})
    require(active_keys(reordered)==['refund','start'],'Refund flow was not reordered')
    saved=save(client,pid,{'no_deposit':False})
    final=read(client,pid)
    validate_skip_transition(saved['no_deposit_transition'],stage(final,'refund'),manual)
    return {'project_id':pid,'manual_edit':manual,'transition':saved['no_deposit_transition'],
        'final_refund':stage(final,'refund'),'system_reorder_did_not_hide_manual_edit':True}


def same_method_custom(client,database,a,rows):
    project=create(client,a,'SAME-METHOD');pid=project['id']
    changed=[dict(row) for row in rows];changed[0]['name']='本项目自定义阶段名称'
    preview=client.request('POST',f'/api/projects/{pid}/workflow/preview',{'stages':changed})
    require(not preview['blocked'],'Synthetic project customization unexpectedly blocked')
    client.request('POST',f'/api/projects/{pid}/workflow/commit',{'stages':changed,'base_fingerprint':preview['base_fingerprint']})
    before=database.stages(pid)
    saved=save(client,pid,{'procurement_method_id':a['id'],'notes':'ordinary metadata correction'})
    require(database.stages(pid)==before,'Saving the same method overwrote its project-specific workflow')
    require(stage(saved,'shared')['name']==changed[0]['name'],'Custom stage name was lost')
    return {'project_id':pid,'stage_rows_unchanged':True,'custom_stage_name':changed[0]['name']}


def run(args):
    evidence=args.evidence.resolve();evidence.mkdir(parents=True,exist_ok=True)
    report=Report(emit=True)
    report.metadata.update(candidate=str(args.candidate.resolve()),candidate_sha256=args.candidate_sha256,
        expected_version=args.expected_version,product_build_source_commit=args.source_commit,
        harness_tool_sha256=sha256(Path(__file__)),
        execution_environment={'platform':sys.platform,'python':sys.version,'os':platform.platform()})
    try:
        report.metadata['harness_commit']=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
        report.check('candidate',lambda:validate_candidate(args.candidate,args.candidate_sha256))
        from tools.verify_packaged_browser_acceptance import owned_client
        with tempfile.TemporaryDirectory(prefix='pm-method-exe-',ignore_cleanup_errors=True) as temp:
            root=Path(temp)
            with owned_client(args.candidate.resolve(),root,'method-correction') as client:
                try:
                    report.check('startup',client.start)
                    def version():
                        actual=client.request('GET','/api/system-info')['version']
                        require(actual==args.expected_version,'Runtime version mismatch: '+repr(actual))
                        return {'actual_version':actual}
                    report.check('version',version)
                    database=OwnedDatabase(args.candidate.resolve(),client.data_root,root)
                    try:
                        report.check('database connector',database.metadata)
                        protected={name:sha256(client.data_root/name) for name in ('license.dat','data_key.dpapi','license_public_key.pem')}
                        shared={'id':'shared','name':'Shared','modules':['common']}
                        old={'id':'old','name':'Old','modules':['common']}
                        new={'id':'new','name':'New','modules':['common']}
                        a=method(client,'更正流程A',[shared,old]);b=method(client,'更正流程B',[shared,new])
                        report.check('round trip',lambda:round_trip(client,database,a,b))
                        report.check('notes dependency',lambda:dependency(client,database,a,b,'notes'))
                        report.check('planned dependency',lambda:dependency(client,database,a,b,'planned_at'))
                        report.check('same-name conflict',lambda:same_name_conflict(client,database,[shared,old]))
                        start={'id':'start','name':'Start','modules':['common']}
                        refund={'id':'refund','name':'Refund','modules':['common','deposit_refund']}
                        skip_a=method(client,'退还顺序A',[start,refund]);skip_b=method(client,'退还顺序B',[refund,start])
                        report.check('automatic skip reorder',lambda:skip_reorder(client,skip_a,skip_b,False))
                        report.check('manual skip preservation',lambda:skip_reorder(client,skip_a,skip_b,True))
                        report.check('same-method custom flow',lambda:same_method_custom(client,database,a,[shared,old]))
                        def unchanged():
                            require(all(sha256(client.data_root/name)==digest for name,digest in protected.items()),
                                    'Acceptance changed a test identity/license/data-key file')
                            return {'protected_files':protected,'unchanged':True}
                        report.check('protected identity unchanged',unchanged)
                    finally:database.close()
                finally:
                    startup=client.root/'startup.log'
                    if startup.is_file():
                        (evidence/'startup.log').write_bytes(startup.read_bytes())
        report.check('candidate unchanged',lambda:validate_candidate(args.candidate,args.candidate_sha256))
    except Exception as error:
        report.metadata.update(error=f'{type(error).__name__}: {error}',traceback=traceback.format_exc())
        if all(row['passed'] for row in report.checks):
            report.checks.append({'name':'acceptance interrupted','passed':False,'error':report.metadata['error']})
    result=report.result()
    (evidence/'method-correction-exe-acceptance.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n','utf-8')
    return result


if __name__=='__main__':
    result=run(parser().parse_args())
    print(json.dumps(result,ensure_ascii=True,indent=2))
    raise SystemExit(0 if result['passed'] else 1)
