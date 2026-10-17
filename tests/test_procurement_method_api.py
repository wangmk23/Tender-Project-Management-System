import tempfile
import unittest
from pathlib import Path
from flask import Flask
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import text
from src.backend_patches import procurement_api as api
from src.backend_patches import procurement_catalog as c
from tests.procurement_fixtures import STAGES


class ProcurementMethodApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.app=Flask(__name__);self.app.secret_key='test'
        self.app.config.update(SQLALCHEMY_DATABASE_URI='sqlite:///'+str(Path(self.tmp.name)/'api.db'),TESTING=True)
        db=self.db=SQLAlchemy(self.app)
        class User(db.Model):
            id=db.Column(db.Integer,primary_key=True)
            is_admin=db.Column(db.Boolean,default=False)
            is_active=db.Column(db.Boolean,default=True)
        class Project(db.Model):
            __tablename__='projects'
            id=db.Column(db.Integer,primary_key=True)
            number=db.Column(db.String,unique=True)
            name=db.Column(db.String)
            method=db.Column(db.String)
            purchaser=db.Column(db.String,default='')
            budget=db.Column(db.String,default='')
            notes=db.Column(db.String,default='')
            year=db.Column(db.Integer)
            no_deposit=db.Column(db.Boolean,default=False)
            prepare_owner=db.Column(db.String,default='')
            review_owner=db.Column(db.String,default='')
            is_terminated=db.Column(db.Boolean,default=False)
            terminated_type=db.Column(db.String,default='')
            terminated_reason=db.Column(db.String,default='')
            procurement_archive_sent=db.Column(db.Boolean,default=False)
            procurement_archive_sent_date=db.Column(db.Date)
            second_tender_id=db.Column(db.Integer)
            stages=db.relationship('Stage',backref='project',cascade='all,delete-orphan')
            stage_checklist_items=[]
            lots=[]
            registrations=[]
            def ensure_stages(self):pass
            def ensure_workflow_defaults(self):pass
            def to_dict(self):
                return dict(id=self.id,number=self.number,name=self.name,method=self.method,year=self.year,no_deposit=self.no_deposit,
                    stages=[dict(key=s.stage_key,completed=s.completed,completed_date=None,skipped=s.skipped) for s in self.stages])
        class Stage(db.Model):
            __tablename__='stages'
            id=db.Column(db.Integer,primary_key=True)
            project_id=db.Column(db.Integer,db.ForeignKey('projects.id'))
            stage_key=db.Column(db.String)
            completed=db.Column(db.Boolean,server_default=text('0'))
            skipped=db.Column(db.Boolean,server_default=text('0'))
            completed_date=db.Column(db.Date)
            planned_at=db.Column(db.DateTime)
            notes=db.Column(db.String,default='')
        self.Project=Project;self.User=User
        self.ctx=self.app.app_context();self.ctx.push();db.create_all()
        db.session.execute(text('CREATE TABLE project_lots(id INTEGER PRIMARY KEY,project_id INTEGER,lot_number TEXT)'))
        db.session.add_all([User(id=1,is_admin=True),User(id=2,is_admin=False),Project(id=1,number='OLD',name='原项目',method='公开招标',year=2026)])
        db.session.commit()
        self.models=dict(db=db,Project=Project,User=User,STAGES=STAGES,load_app_settings=lambda:{})
        api.register(self.app,db,self.models)
        self.app.add_url_rule('/api/projects','create_for_test',lambda:api.create_project(self.models),methods=['POST'])
        self.app.add_url_rule('/api/projects/<int:pid>','update_for_test',lambda pid:api.update_project(self.models,pid),methods=['PUT'])
        self.client=self.app.test_client();self.headers={'X-CSRFToken':'test-token'}
        self.login(1)

    def tearDown(self):
        self.db.session.remove();self.db.engine.dispose();self.ctx.pop();self.tmp.cleanup()

    def login(self,uid):
        with self.client.session_transaction() as s:s.update(user_id=uid,is_admin=uid==1,csrf_token='test-token')

    def catalog(self):return self.client.get('/api/procurement-methods').json
    def add(self,name='自主采购',regime='enterprise',**extra):
        response=self.client.post('/api/procurement-methods',json=dict(name=name,regime=regime,revision=self.catalog()['revision'],**extra),headers=self.headers)
        self.assertEqual(response.status_code,201,response.json)
        return response.json['method']
    def create(self,m,number='NEW',**extra):
        return self.client.post('/api/projects',json=dict(number=number,name='新项目',procurement_method_id=m['id'],year=2026,**extra),headers=self.headers)

    def test_directory_permissions_csrf_and_active_user(self):
        self.assertEqual(self.client.post('/api/procurement-methods',json={}).status_code,403)
        self.login(2);self.assertEqual(self.client.get('/api/procurement-methods').status_code,200)
        self.assertEqual(self.client.post('/api/procurement-methods',json={},headers=self.headers).status_code,403)
        self.db.session.get(self.User,2).is_active=False;self.db.session.commit()
        self.assertEqual(self.client.get('/api/procurement-methods').status_code,401)

    def test_create_project_uses_independent_flow_and_immutable_snapshot(self):
        rows=[dict(id='quote',name='询价登记',modules=['common','registration'])]
        m=self.add(template_mode='independent',stages=rows,quantity_rule=dict(mode='fixed',minimum=2))
        r=self.create(m);self.assertEqual(r.status_code,201,r.json)
        self.assertEqual(r.json['stages'][0]['key'],'quote')
        self.assertEqual(r.json['procurement']['quantity_rule']['minimum'],2)
        before=self.db.session.execute(text('SELECT * FROM stages WHERE project_id=:id'),{'id':r.json['id']}).all()
        changed=self.client.patch('/api/procurement-methods/'+m['id'],json=dict(revision=m['revision'],name='改名',enabled=False,quantity_rule=dict(mode='fixed',minimum=5)),headers=self.headers)
        self.assertEqual(changed.status_code,200,changed.json)
        project=self.db.session.get(self.Project,r.json['id'])
        self.assertEqual(project.method,'自主采购')
        self.assertEqual(c.project_snapshot(self.db,project.id)['quantity_rule']['minimum'],2)
        self.assertEqual(self.db.session.execute(text('SELECT * FROM stages WHERE project_id=:id'),{'id':project.id}).all(),before)
        self.assertEqual(self.create(m,'NO').status_code,400)
        updated=self.client.put(f'/api/projects/{project.id}',json=dict(name='仅改资料',procurement_method_id=m['id']),headers=self.headers)
        self.assertEqual(updated.status_code,200,updated.json)
        self.assertEqual(updated.json['procurement']['name_snapshot'],'自主采购')

    def test_common_template_only_affects_future_projects(self):
        m=self.add();p=self.create(m).json
        r=self.client.put('/api/procurement-common-flow',json=dict(revision=self.catalog()['revision'],stages=[dict(id='new',name='新通用阶段',modules=['common'])]),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        p2=self.create(m,'NEW2').json
        self.assertEqual(p2['stages'][0]['key'],'new')
        self.assertEqual(c.project_snapshot(self.db,p['id'])['workflow_revision'],1)
        self.assertEqual(self.db.session.execute(text('SELECT stage_key FROM stages WHERE project_id=:id ORDER BY id'),{'id':p['id']}).scalars().all(),['first','end'])

    def test_revision_conflict_and_reference_delete(self):
        m=self.add();self.create(m)
        delete=self.client.delete('/api/procurement-methods/'+m['id'],json={'revision':m['revision']},headers=self.headers)
        self.assertEqual(delete.status_code,409)
        self.assertEqual(delete.json['code'],'METHOD_IN_USE')
        self.assertEqual(self.client.patch('/api/procurement-methods/'+m['id'],json=dict(revision=999,name='过期'),headers=self.headers).status_code,409)

    def test_legacy_name_and_ambiguous_name_resolution(self):
        m=self.add('同名','enterprise');self.add('同名','collective')
        r=self.client.post('/api/projects',json=dict(number='A',name='项目',method='同名',year=2026),headers=self.headers)
        self.assertEqual(r.status_code,400)
        self.assertEqual(r.json['code'],'AMBIGUOUS_METHOD')
        self.assertEqual(self.client.post('/api/projects',json=dict(number='A',name='项目',method='同名',procurement_regime='enterprise',year=2026),headers=self.headers).status_code,201)

    def test_change_method_preserves_completed_stages_and_snapshots(self):
        m=self.add();p=self.create(m).json
        m2=self.add('第二方式',quantity_rule=dict(mode='fixed',minimum=7))
        self.db.session.execute(text("UPDATE stages SET completed=1,completed_date='2026-01-02' WHERE project_id=:id AND stage_key='first'"),{'id':p['id']});self.db.session.commit()
        before=self.db.session.execute(text('SELECT * FROM stages WHERE project_id=:id'),{'id':p['id']}).all()
        r=self.client.put(f"/api/projects/{p['id']}",json=dict(procurement_method_id=m2['id']),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(r.json['procurement']['quantity_rule']['minimum'],7)
        self.assertEqual(self.db.session.execute(text('SELECT * FROM stages WHERE project_id=:id'),{'id':p['id']}).all(),before)

    def test_invalid_creation_does_not_leave_partial_project(self):
        m=self.add()
        for extra in [dict(number=''),dict(year='bad'),dict(no_deposit='false')]:
            body=dict(number='BROKEN',name='项目',procurement_method_id=m['id'],year=2026);body.update(extra)
            r=self.client.post('/api/projects',json=body,headers=self.headers)
            self.assertEqual(r.status_code,400,r.json)
        self.assertEqual(self.Project.query.count(),1)

    def test_original_project_update_fields_and_failed_validation_rollback(self):
        m=self.add();p=self.create(m).json
        r=self.client.put(f"/api/projects/{p['id']}",json=dict(purchaser='采购单位',notes='备注',prepare_owner='甲',year=2027,second_tender_id=p['id']),headers=self.headers)
        self.assertEqual(r.status_code,400)
        project=self.db.session.get(self.Project,p['id']);self.assertEqual(project.year,2026)
        r=self.client.put(f"/api/projects/{p['id']}",json=dict(purchaser='采购单位',notes='备注',prepare_owner='甲',year=2027,procurement_archive_sent=True),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        self.assertEqual(project.purchaser,'采购单位');self.assertTrue(project.procurement_archive_sent)

    def test_renamed_builtin_online_bidding_retains_semantics(self):
        m=next(x for x in self.catalog()['methods'] if x['name']=='网上竞价')
        r=self.client.patch('/api/procurement-methods/'+m['id'],json=dict(revision=m['revision'],regime='enterprise',name='自主平台竞价'),headers=self.headers)
        self.assertEqual(r.status_code,200,r.json)
        p=self.create(r.json['method']).json
        self.assertEqual(p['procurement']['builtin_kind'],'网上竞价')

    def test_compiled_project_validation_defers_membership_to_catalog_handler(self):
        import types
        from flask import request,jsonify
        from tools.compile_module_patches import validated_business_handler
        from src.backend_patches.business_input_validation import validate_business_input
        root=compile('def api_update_project(pid):\n    return jsonify(id=pid)\n','<test-handler>','exec')
        original=next(v for v in root.co_consts if isinstance(v,types.CodeType))
        code=validated_business_handler(original,validate_business_input.__code__,'api_update_project')
        fn=types.FunctionType(code,dict(request=request,jsonify=jsonify,_PROCUREMENT_CATALOG_ENABLED=True,METHODS=['公开招标']))
        with self.app.test_request_context(method='PUT',json={'method':'新增自主采购'}):
            response=self.app.make_response(fn(1));self.assertEqual(response.status_code,200,response.json)

    def test_compiler_rejects_handler_closures_instead_of_building_invalid_bytecode(self):
        from tools.compile_module_patches import validated_business_handler
        from src.backend_patches.business_input_validation import validate_business_input
        value=3
        def handler(pid):return value+pid
        with self.assertRaisesRegex(ValueError,'closure'):
            validated_business_handler(handler.__code__,validate_business_input.__code__,'api_update_project')

    def test_deprecated_settings_cannot_bulk_rewrite_projects_or_mix_storage(self):
        r=self.client.patch('/api/settings',json=dict(stage_template_sync_method='公开招标'),headers=self.headers)
        self.assertEqual(r.status_code,409,r.json)
        r=self.client.patch('/api/settings',json=dict(stage_templates={},login_subtitle='不能混存'),headers=self.headers)
        self.assertEqual(r.status_code,400,r.json)
