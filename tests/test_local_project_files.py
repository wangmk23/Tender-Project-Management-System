import tempfile
import types
import unittest
from pathlib import Path
from urllib.parse import urlencode
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from src.backend_patches.local_project_files import register

class ApiTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name); self.folder=self.root/'资料'; self.folder.mkdir()
        self.app=Flask(__name__); self.app.config.update(SECRET_KEY='test',TESTING=True,IS_DESKTOP=True,SQLALCHEMY_DATABASE_URI='sqlite:///'+str(self.root/'test.db'))
        self.db=SQLAlchemy(self.app)
        class User(self.db.Model):
            id=self.db.Column(self.db.Integer,primary_key=True)
            is_admin=self.db.Column(self.db.Boolean,default=True)
            is_active=self.db.Column(self.db.Boolean,default=True)
        class Project(self.db.Model):
            id=self.db.Column(self.db.Integer,primary_key=True)
            name=self.db.Column(self.db.String,default='项目')
            stages=[]
        self.User=User
        self.context=self.app.app_context(); self.context.push(); self.addCleanup(self.context.pop)
        self.db.create_all(); self.db.session.add_all([User(id=1),Project(id=1),Project(id=2)]); self.db.session.commit()
        self.runtime=types.SimpleNamespace(app=self.app,db=self.db,User=User,Project=Project)
        register(self.runtime,choose_folder=lambda:None,open_folder=lambda p:None)
        self.addCleanup(self.db.engine.dispose)
        self.addCleanup(self.db.session.remove)
        self.addCleanup(self.app.extensions['local_project_files']['executor'].shutdown,wait=True)
        self.client=self.app.test_client()
        with self.client.session_transaction() as s: s.update(user_id=1,csrf_token='test')
    def call(self,method,suffix='',body=None,pid=1,**kw):
        return self.client.open(f'/api/projects/{pid}/local-files'+suffix,method=method,json=body,headers={'X-CSRFToken':'test'},**kw)
    def bind(self,revision=0,pid=1):
        return self.call('PUT','/association',{'path':str(self.folder),'expected_revision':revision},pid=pid)

    def scan_files(self):
        result = self.call('POST', '/scan', {'expected_revision': 1})
        self.assertEqual(result.status_code, 202, result.json)
        self.app.extensions['local_project_files']['jobs'][1]['future'].result(timeout=20)

    def content(self, path, *, mode='preview', pid=1, revision=1, binding=None, method='GET', **kwargs):
        if binding is None:
            binding = self.call('GET', pid=pid).json.get('binding', '')
        query = urlencode(dict(path=path, mode=mode, revision=revision, binding=binding))
        return self.client.open(f'/api/projects/{pid}/local-files/content?{query}', method=method, **kwargs)

    def test_local_file_preview_range_and_download_preserve_original(self):
        self.bind()
        path = self.folder / '项目说明.txt'
        original = '原始资料'.encode('utf-8')
        path.write_bytes(original)
        modified = path.stat().st_mtime_ns
        self.assertEqual(self.content(path.name).status_code, 404)
        self.scan_files()
        with self.content(path.name, headers={'Range': 'bytes=0-2'}) as response:
            self.assertEqual(response.status_code, 206)
            self.assertEqual(response.data, original[:3])
            self.assertEqual(response.headers['Content-Range'], f'bytes 0-2/{len(original)}')
            self.assertIn('inline', response.headers['Content-Disposition'])
        with self.content(path.name, mode='download') as response:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.data, original)
            self.assertIn('attachment', response.headers['Content-Disposition'])
        self.assertEqual(self.content(path.name, method='PUT', data=b'edited').status_code, 405)
        self.assertEqual(path.read_bytes(), original)
        self.assertEqual(path.stat().st_mtime_ns, modified)

    def test_content_uses_current_project_revision_and_export_permission(self):
        self.bind()
        (self.folder / 'note.txt').write_bytes(b'contents')
        (self.folder / 'active.html').write_bytes(b'<script>throw new Error()</script>')
        self.scan_files()
        self.assertEqual(self.content('../note.txt').status_code, 400)
        self.assertIn(self.content('note.txt', pid=2).status_code, (404, 409))
        self.assertEqual(self.content('note.txt', revision=0).status_code, 409)
        self.assertEqual(self.content('active.html').status_code, 415)
        self.db.session.add(self.User(id=2, is_admin=False)); self.db.session.commit()
        with self.client.session_transaction() as session:
            session['user_id'] = 2
        remote = {'REMOTE_ADDR': '192.0.2.1'}
        with self.content('note.txt', environ_overrides=remote) as response:
            self.assertEqual(response.data, b'contents')
        self.assertEqual(self.content('note.txt', mode='download', environ_overrides=remote).status_code, 403)

    def test_project_deletion_does_not_transfer_index_to_reused_id(self):
        self.bind()
        (self.folder / 'old.txt').write_bytes(b'old project')
        self.scan_files()
        old_binding = self.call('GET').json.get('binding')
        preview = self.call('POST', '/preview', {'expected_revision':1,'folders':[{'stage_id':None,'name':'旧计划'}]})
        project = self.db.session.get(self.runtime.Project, 1)
        self.db.session.delete(project); self.db.session.commit()
        self.db.session.add(self.runtime.Project(id=1)); self.db.session.commit()
        self.assertFalse(self.call('GET').json['linked'])
        self.assertEqual(self.call('GET', '/entries').json['total'], 0)
        self.assertTrue((self.folder / 'old.txt').is_file())
        self.bind(); self.scan_files()
        self.assertNotEqual(self.call('GET').json.get('binding'), old_binding)
        self.assertEqual(self.content('old.txt', binding=old_binding).status_code, 409)
        self.assertEqual(self.call('POST', '/directories', {'expected_revision':1,'plan_token':preview.json['plan_token']}).status_code,409)
        self.assertFalse((self.folder/'旧计划').exists())

    def test_project_access_hook_protects_index_and_file_bytes(self):
        self.bind(); (self.folder/'note.txt').write_bytes(b'confidential'); self.scan_files()
        binding = self.call('GET').json.get('binding', '')
        self.app.extensions['deadline_project_access'] = lambda _user, project: project.id != 1
        self.assertEqual(self.call('GET', '/entries').status_code, 403)
        self.assertEqual(self.content('note.txt', binding=binding).status_code, 403)
    def test_linked_remote_browser_initializes_index_and_browses_existing_subfolders(self):
        self.bind()
        nested = self.folder / '自定分类' / '深层资料'
        nested.mkdir(parents=True)
        existing = nested / '报价.txt'
        existing.write_bytes(b'quote')
        remote = {'REMOTE_ADDR': '192.0.2.1'}
        summary = self.call('GET', '?view=browser', environ_overrides=remote).json
        self.assertTrue(summary['linked'])
        self.assertNotIn('stage_summary', summary)
        self.assertIn('stage_summary', self.call('GET', environ_overrides=remote).json)
        self.assertEqual(self.call('GET', '/entries', environ_overrides=remote).json['total'], 0)
        self.app.extensions['deadline_project_access'] = lambda _user, _project: False
        self.assertEqual(self.call('GET', '/entries?index=initial', environ_overrides=remote).status_code, 403)
        jobs = self.app.extensions['local_project_files']['jobs']
        self.assertNotIn(1, jobs)
        self.app.extensions['deadline_project_access'] = lambda _user, _project: True
        self.assertEqual(self.call('HEAD', '/entries?index=initial', environ_overrides=remote).status_code, 200)
        self.assertNotIn(1, jobs)
        started = self.call('GET', '/entries?index=initial', environ_overrides=remote)
        self.assertEqual(started.status_code, 200)
        self.assertEqual(started.json['scan']['state'], 'queued')
        task = jobs[1]['task_id']
        jobs[1]['future'].result(timeout=20)
        result = self.call('GET', '/entries?index=refresh', environ_overrides=remote)
        self.assertEqual(result.json['scan']['state'], 'complete')
        self.assertEqual(jobs[1]['task_id'], task)
        self.assertEqual([row['name'] for row in result.json['items']], ['自定分类'])
        child = self.call('GET', '/entries?' + urlencode({'parent': '自定分类/深层资料'}), environ_overrides=remote)
        self.assertEqual([row['name'] for row in child.json['items']], ['报价.txt'])
        search = self.call('GET', '/entries?' + urlencode({'q': '深层'}), environ_overrides=remote)
        self.assertEqual(search.json['items'][0]['path'], '自定分类/深层资料')
        self.assertEqual(existing.read_bytes(), b'quote')
        self.assertEqual(list(self.folder.iterdir()), [nested.parent])

    def test_binding_idempotence_revision_and_cross_project_conflict(self):
        first=self.bind(); self.assertEqual(first.status_code,200,first.json)
        self.assertEqual(self.bind(1).json['revision'],1)
        self.assertEqual(self.bind(0).status_code,409)
        self.assertEqual(self.bind(0,2).status_code,409)
        self.assertEqual(self.call('DELETE','/association',{'expected_revision':1}).json['revision'],2)
        self.assertTrue(self.folder.is_dir())
    def test_security_and_remote_redaction(self):
        self.bind()
        remote=self.call('GET',environ_overrides={'REMOTE_ADDR':'192.0.2.1'})
        self.assertNotIn('path',remote.json); self.assertFalse(remote.json['capabilities']['manage'])
        self.assertEqual(self.call('POST','/scan',{'expected_revision':1},environ_overrides={'REMOTE_ADDR':'192.0.2.1'}).status_code,403)
        self.assertEqual(self.client.post('/api/projects/1/local-files/choose',json={}).status_code,400)
        user=self.db.session.get(self.User,1); user.is_active=False; self.db.session.commit()
        self.assertEqual(self.bind(1).status_code,403)
    def test_preview_creates_only_confirmed_directories_and_replay_is_idempotent(self):
        self.bind(); file=self.folder/'keep.txt'; file.write_bytes(b'original'); before=file.stat().st_mtime_ns
        preview=self.call('POST','/preview',{'expected_revision':1,'folders':[{'stage_id':None,'name':'01-资料'}]})
        self.assertEqual(preview.status_code,200,preview.json); self.assertFalse((self.folder/'01-资料').exists())
        body={'expected_revision':1,'plan_token':preview.json['plan_token']}
        result=self.call('POST','/directories',body); self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.call('POST','/directories',body).json,result.json)
        self.assertTrue((self.folder/'01-资料').is_dir()); self.assertEqual(file.read_bytes(),b'original'); self.assertEqual(file.stat().st_mtime_ns,before)
    def test_conflicts_and_traversal_do_not_mutate_disk(self):
        self.bind(); (self.folder/'file').write_text('keep')
        p=self.call('POST','/preview',{'expected_revision':1,'folders':[{'stage_id':None,'name':'file'}]})
        self.assertEqual(p.json['folders'][0]['status'],'conflict')
        self.assertEqual(self.call('POST','/directories',{'expected_revision':1,'plan_token':p.json['plan_token']}).status_code,409)
        self.assertEqual(self.call('GET','/entries?parent=../').status_code,400)
    def test_scan_cache_pagination_search_open_and_no_read_traversal(self):
        import time
        from unittest.mock import patch
        self.bind()
        for i in range(101): (self.folder/f'文档{i:03}.txt').write_bytes(b'abc')
        (self.folder/'child').mkdir()
        result=self.call('POST','/scan',{'expected_revision':1}); self.assertEqual(result.status_code,202)
        self.app.extensions['local_project_files']['jobs'][1]['future'].result(timeout=20)
        scan=self.call('GET','/scan').json['scan']; self.assertEqual(scan['files'],101); self.assertTrue(scan['complete'],scan)
        with patch('os.scandir',side_effect=AssertionError('GET must use cache')):
            start=time.perf_counter(); first=self.call('GET','/entries'); elapsed=time.perf_counter()-start
            self.assertEqual(len(first.json['items']),100); self.assertTrue(first.json['has_more']); self.assertLess(elapsed,.3)
            self.assertEqual(self.call('GET','/entries?offset=100').json['total'],102)
            self.assertEqual(self.call('GET','/entries?q=文档100').json['total'],1)
            self.assertEqual(self.call('GET').status_code,200)
        self.assertEqual(self.call('POST','/open',{'expected_revision':1,'relative_path':'文档000.txt'}).status_code,400)
        self.assertEqual(self.call('POST','/open',{'expected_revision':1,'relative_path':'child'}).status_code,200)
    def test_unlinked_creation_existing_root_expiry_and_rebind_invalidates_plan(self):
        data={'expected_revision':0,'parent_path':str(self.root),'root_name':'新项目','folders':[{'stage_id':None,'name':'阶段'}]}
        p=self.call('POST','/preview',data); self.assertEqual(p.status_code,200,p.json)
        token=p.json['plan_token']; self.app.extensions['local_project_files']['plans'][token]['expires']=0
        self.assertEqual(self.call('POST','/directories',{'expected_revision':0,'plan_token':token}).status_code,409)
        self.assertFalse((self.root/'新项目').exists())
        p=self.call('POST','/preview',data)
        result=self.call('POST','/directories',{'expected_revision':0,'plan_token':p.json['plan_token']})
        self.assertEqual(result.status_code,200,result.json); self.assertTrue((self.root/'新项目'/'阶段').is_dir())
        self.assertEqual(self.call('POST','/preview',data,pid=2).status_code,409)
        p=self.call('POST','/preview',{'expected_revision':1,'folders':[{'stage_id':None,'name':'后续'}]})
        self.bind(1)
        self.assertEqual(self.call('POST','/directories',{'expected_revision':1,'plan_token':p.json['plan_token']}).status_code,409)
        self.assertFalse((self.root/'新项目'/'后续').exists())
    def test_replaced_root_blocks_scan_open_creation(self):
        self.bind(); p=self.call('POST','/preview',{'expected_revision':1,'folders':[{'stage_id':None,'name':'新增'}]})
        self.folder.rename(self.root/'moved'); self.folder.mkdir(); (self.folder/'foreign').write_text('private')
        for suffix,body in [('/scan',{}),('/open',{'relative_path':''}),('/directories',{'plan_token':p.json['plan_token']})]:
            self.assertEqual(self.call('POST',suffix,{'expected_revision':1,**body}).status_code,409)
        self.assertFalse((self.folder/'新增').exists()); self.assertEqual(self.call('GET','/entries').json['total'],0)
    def test_platform_loopback_account_and_login_boundaries(self):
        self.app.config['IS_DESKTOP']=False; self.assertEqual(self.bind().status_code,403)
        self.app.config['IS_DESKTOP']=True
        self.assertEqual(self.call('PUT','/association',{'expected_revision':0,'path':str(self.folder)},environ_overrides={'REMOTE_ADDR':'192.0.2.2','HTTP_X_FORWARDED_FOR':'127.0.0.1'}).status_code,403)
        user=self.db.session.get(self.User,1); user.is_admin=False; self.db.session.commit()
        self.assertEqual(self.bind().status_code,403)
        with self.client.session_transaction() as s: s.clear()
        self.assertEqual(self.call('GET').status_code,403)
    def test_real_stage_template_and_mapping(self):
        from sqlalchemy import text
        self.db.session.execute(text('CREATE TABLE stages (project_id INTEGER, stage_key TEXT, stage_name TEXT, stage_position INTEGER, template_removed INTEGER)'))
        self.db.session.execute(text("INSERT INTO stages VALUES (1,'award','采购结果',2,0),(1,'start',NULL,1,0),(1,'old','删除阶段',3,1)")); self.db.session.commit()
        self.app.extensions['procurement_catalog'] = {'STAGES':[{'key':'start','name':'立项'}]}
        template=self.call('GET','/template').json
        self.assertEqual([x['stage_id'] for x in template['folders']],['start','award'])
        stage_folder = self.folder / '01-立项'
        stage_folder.mkdir()
        (stage_folder/'原资料.txt').write_bytes(b'original')
        self.bind(); self.scan_files()
        state = self.call('GET').json
        self.assertEqual(state['stage_summary'][0]['folder'], '01-立项')
        self.assertEqual(state['stage_summary'][0]['count'], 1)
        self.assertEqual(state['cache']['files'], 1)
        p=self.call('POST','/preview',{'expected_revision':1,'folders':[{'stage_id':'award','name':'归档结果'}]})
        r=self.call('POST','/directories',{'expected_revision':1,'plan_token':p.json['plan_token']})
        self.assertEqual(r.status_code,200,r.json); self.assertEqual(r.json['state']['revision'],2)
        self.assertEqual(self.call('GET','/template').json['folders'][1]['name'],'归档结果')
    def test_cancel_preserves_success_cache_and_rebind_discards_old_generation(self):
        import threading
        from unittest.mock import patch
        from src.backend_patches import local_project_files as feature
        self.bind(); (self.folder/'old.txt').write_text('old')
        self.call('POST','/scan',{'expected_revision':1})
        self.app.extensions['local_project_files']['jobs'][1]['future'].result(timeout=10)
        original=feature.scan_directory; entered=threading.Event(); release=threading.Event()
        def delayed(*args,**kwargs):
            entered.set(); release.wait(10); return original(*args,**kwargs)
        with patch.object(feature,'scan_directory',side_effect=delayed):
            scan=self.call('POST','/scan',{'expected_revision':1}).json['scan']
            self.assertTrue(entered.wait(5))
            again=self.call('POST','/scan',{'expected_revision':1}).json['scan']; self.assertEqual(scan['task_id'],again['task_id'])
            self.call('POST','/scan/cancel',{'expected_revision':1,'task_id':scan['task_id']}); release.set()
            self.app.extensions['local_project_files']['jobs'][1]['future'].result(timeout=10)
        self.assertEqual(self.call('GET','/entries').json['total'],1)
        self.assertEqual(self.call('GET','/scan').json['scan']['state'],'cancelled')
        entered.clear(); release.clear()
        with patch.object(feature,'scan_directory',side_effect=delayed):
            self.call('POST','/scan',{'expected_revision':1}); self.assertTrue(entered.wait(5))
            job=self.app.extensions['local_project_files']['jobs'][1]
            new=self.root/'other'; new.mkdir(); (new/'new.txt').write_text('new')
            self.assertEqual(self.call('PUT','/association',{'expected_revision':1,'path':str(new)}).status_code,200)
            release.set(); job['future'].result(timeout=10)
        self.assertEqual(self.call('GET','/entries').json['total'],0)
        self.assertEqual(self.call('GET').json['revision'],2)
        self.call('POST','/scan',{'expected_revision':2}); self.app.extensions['local_project_files']['jobs'][1]['future'].result(timeout=10)
        self.assertEqual(self.call('GET','/entries').json['items'][0]['name'],'new.txt')
