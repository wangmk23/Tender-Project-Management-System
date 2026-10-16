"""Verify account lifecycle guards in a hash-pinned, isolated headless EXE."""
from pathlib import Path
import argparse
import hashlib
import html
import json
import os
import re
import subprocess
import sys
import tempfile
from unittest.mock import patch
import requests

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
from tests.test_stage_template_packaged_e2e import PackagedClient, CsrfInputParser, unused_port


def verify(candidate, digest, licenses, output):
    assert hashlib.sha256(candidate.read_bytes()).hexdigest()==digest
    checks=[]
    original_spawn=subprocess.Popen
    with tempfile.TemporaryDirectory(prefix='account-lifecycle-',ignore_cleanup_errors=True) as folder:
        with patch.dict(os.environ,{'PM_TEST_LICENSE_DIR':str(licenses)}):
            client=PackagedClient(candidate,Path(folder),'accounts',unused_port())
        sessions=[]
        def login(username,password):
            session=requests.Session();session.trust_env=False;sessions.append(session)
            parser=CsrfInputParser();parser.feed(session.get(client.base_url+'/login',timeout=15).text)
            response=session.post(client.base_url+'/login',data=dict(username=username,password=password,csrf_token=html.unescape(parser.token)),timeout=15)
            parser=CsrfInputParser();parser.feed(response.text)
            script_token=re.search(r'window\.CSRF_TOKEN\s*=\s*["\']([^"\']+)',response.text)
            token=parser.meta_token or (script_token[1] if script_token else '')
            assert token,'isolated account did not reach workspace'
            return session,html.unescape(token)
        def request(actor,method,path,payload=None):
            session,token=actor
            return session.request(method,client.base_url+path,json=payload,headers={'X-CSRFToken':token},timeout=20)
        def expect(actor,method,path,payload,status):
            response=request(actor,method,path,payload)
            assert response.status_code==status,(method,path,response.status_code,response.text[:200])
            return response
        def create(username,admin=True):
            return client.request('POST','/api/users',dict(username=username,password='Isolated-Account-Pass-123!',is_admin=admin,is_active=True))
        try:
            with patch.object(subprocess,'Popen',side_effect=lambda args,**kw:original_spawn([args[0],'--headless'],**kw)):
                client.start()
                account=create('lifecycle_admin')
                actors=[login('lifecycle_admin','Isolated-Account-Pass-123!') for _ in range(3)]
                expect(actors[0],'GET','/api/users',None,200)
                client.request('PUT',f"/api/users/{account['id']}",{'is_active':False})
                expect(actors[0],'GET','/api/users',None,401)
                expect(actors[1],'POST','/api/users',dict(username='must_not_exist',password='Isolated-Account-Pass-123!',is_admin=True),401)
                expect(actors[2],'POST',f"/api/users/{account['id']}/reset-password",{'password':'Must-not-be-saved-123!'},401)
                assert not any(user['username']=='must_not_exist' for user in client.request('GET','/api/users'))
                checks.append('inactive administrator sessions cannot list, create, or reset accounts')
                account=create('lifecycle_deleted');actor=login('lifecycle_deleted','Isolated-Account-Pass-123!')
                client.request('DELETE',f"/api/users/{account['id']}")
                expect(actor,'GET','/api/users',None,401)
                checks.append('deleted administrator session is rejected')
                account=create('lifecycle_demoted');actor=login('lifecycle_demoted','Isolated-Account-Pass-123!')
                client.request('PUT',f"/api/users/{account['id']}",{'is_admin':False})
                expect(actor,'GET','/api/users',None,403)
                checks.append('current role overrides cached administrator flag')
                primary=(client.session,client.csrf_token)
                before=len(client.request('GET','/api/users'))
                for payload in ([],dict(username='bad_type_password',password=123456789),dict(username='bad_flags',password='Isolated-Account-Pass-123!',is_admin='false',is_active='true')):
                    expect(primary,'POST','/api/users',payload,400)
                expect(primary,'PUT',f"/api/users/{account['id']}",[],400)
                expect(primary,'PUT',f"/api/users/{account['id']}",{'is_active':'false'},400)
                expect(primary,'POST',f"/api/users/{account['id']}/reset-password",{'password':123456789},400)
                expect(primary,'POST','/api/me/change-password',{'old_password':[],'new_password':'Valid-But-Not-Saved-123!'},400)
                assert len(client.request('GET','/api/users'))==before
                checks.append('malformed account values return 400 without writes or server errors')
                actor=login('lifecycle_demoted','Isolated-Account-Pass-123!')
                expect(actor,'GET','/api/users',None,403)
                expect(actor,'GET','/api/projects',None,200)
                checks.append('active normal accounts retain business access without account management')
        finally:
            client.stop()
            for session in sessions:session.close()
    report=dict(passed=True,count=len(checks),checks=checks,sha256=digest,isolated_data=True,real_mail_sent=0,native_desktop_verified=False)
    output.parent.mkdir(parents=True,exist_ok=True)
    output.write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n','utf-8')
    return report


if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--candidate',type=Path,required=True);p.add_argument('--sha256',required=True)
    p.add_argument('--license-fixtures',type=Path,required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args()
    print(json.dumps(verify(args.candidate.resolve(),args.sha256,args.license_fixtures.resolve(),args.output),ensure_ascii=False))
