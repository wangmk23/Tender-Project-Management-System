import io, unittest
from types import SimpleNamespace
from sqlalchemy import text
from src.backend_patches import procurement_catalog as c, data_import, lot_supplier_risk as risk, tender_guarantee as guarantee
from tests import test_procurement_method_api as fixtures
class ProcurementIntegrationTests(unittest.TestCase):
    def setUp(self):
        fixtures.ProcurementMethodApiTests.setUp(self)
        data_import._build_import_routes(self.app,self.db,self.models)
    tearDown=fixtures.ProcurementMethodApiTests.tearDown
    login=fixtures.ProcurementMethodApiTests.login
    catalog=fixtures.ProcurementMethodApiTests.catalog
    add=fixtures.ProcurementMethodApiTests.add
    create=fixtures.ProcurementMethodApiTests.create
    def test_reference_semantics_use_saved_kind_not_new_display_name(self):
        m=self.add('公开招标','other');p=self.create(m).json
        project=self.db.session.get(self.Project,p['id'])
        self.assertIsNone(c.reference_method_key(project,self.db))
        legacy=next(x for x in self.catalog()['methods'] if x['builtin_kind']=='网上竞价')
        c.save_method(self.db,dict(name='线上报价',regime='enterprise'),legacy['revision'],1,legacy['id']);self.db.session.commit()
        method=c.get_method(self.db,legacy['id']);new=self.create(method,'ONLINE').json
        self.assertEqual(c.reference_method_key(self.db.session.get(self.Project,new['id']),self.db),'网上竞价')
        self.assertEqual(c.deadline_regime_for_management('collective'),'custom')
        self.assertEqual(c.deadline_regime_for_management('mandatory_construction_bidding'),'bidding')
    def test_import_resolution_unique_ambiguous_disabled_and_explicit_regime(self):
        a=self.add('询价');b=self.add('询价','collective')
        with self.assertRaisesRegex(ValueError,'制度|唯一|同名'):data_import.resolve_import_method(self.db,{'采购方式':'询价'},{'method':'采购方式'})
        result=data_import.resolve_import_method(self.db,{'采购方式':'询价','适用制度':'集体经济组织采购'},{'method':'采购方式','regime':'适用制度'})
        self.assertEqual(result['id'],b['id'])
        c.save_method(self.db,dict(enabled=False),a['revision'],1,a['id']);self.db.session.commit()
        with self.assertRaisesRegex(ValueError,'停用'):data_import.resolve_import_method(self.db,{'采购方式标识':a['id']},{'method_id':'采购方式标识'})
    def test_current_template_contains_ids_and_regimes_as_safe_text(self):
        m=self.add('=1+1')
        raw=data_import.build_import_template('projects',procurement_catalog=self.catalog())
        workbook=data_import._parse_xlsx_workbook(raw)
        self.assertIn('采购方式标识',workbook['项目'][0]);self.assertIn('适用制度',workbook['项目'][0])
        self.assertIn('=1+1',str(workbook))
        self.assertIn(m['id'],[row['采购方式标识'] for row in workbook['采购方式目录'][1]])
    def test_reprocurement_custom_method_creates_reference_and_quantity_snapshot(self):
        self.db.session.execute(text('ALTER TABLE project_lots ADD COLUMN lot_name TEXT'));self.db.session.execute(text('ALTER TABLE project_lots ADD COLUMN budget TEXT'));self.db.session.execute(text('ALTER TABLE project_lots ADD COLUMN notes TEXT'))
        self.db.session.execute(text("INSERT INTO project_lots VALUES(1,1,'包1','设备','','')"));risk.ensure_schema(self.db)
        risk._set_control(self.db,1,__import__('datetime').datetime.now(),status='liubiao');self.db.session.commit()
        m=self.add('独立询比采购');p=self.db.session.get(self.Project,1)
        made=risk.create_reprocurement(self.db,p,SimpleNamespace(id=1,lot_number='包1',lot_name='设备',budget=''),dict(procurement_method_id=m['id'],lot_number='包2'),1);self.db.session.commit()
        snap=self.db.session.execute(text('SELECT snapshot_json FROM lot_procurement_snapshots WHERE lot_id=:id'),{'id':made['id']}).scalar()
        self.assertIn(m['id'],snap)
        with self.assertRaisesRegex(ValueError,'引用'):c.delete_method(self.db,m['id'],m['revision'],1)
    def test_guarantee_default_rules_survive_rename_and_guard_anchors(self):
        m=self.add('退还测试',template_mode='independent',stages=[dict(id='notice',name='通知书',modules=['common','winning_notice'])])
        rules=[dict(id='r',enabled=True,scope='nonwinner',start_stage_key='notice',days=5,day_kind='calendar',include_start=False)]
        # Use validated existing-shaped rules from the service rather than inventing financial fields.
        c.save_guarantee_defaults(self.db,m['id'],rules,m['revision'],1);self.db.session.commit()
        m=c.get_method(self.db,m['id'])
        with self.assertRaisesRegex(ValueError,'保证金|起算'):c.save_method(self.db,dict(stages=[dict(id='other',name='其他',modules=['common'])]),m['revision'],1,m['id'])
        self.db.session.rollback();c.save_method(self.db,dict(name='更名'),m['revision'],1,m['id']);self.db.session.commit()
        self.assertEqual(c.guarantee_defaults(self.db,m['id'])[0]['start_stage_key'],'notice')

    def test_real_import_endpoint_binds_flow_and_reports_ambiguous_row_without_partial_insert(self):
        a=self.add('询价',template_mode='independent',stages=[dict(id='inquiry',name='询价',modules=['common'])]);b=self.add('询价','collective')
        raw=data_import._build_workbook_xlsx([dict(name='项目',title='项目',headers=['项目编号','项目名称','采购方式','适用制度'],required=['项目编号','项目名称'],example=['IMPORT','导入项目','询价','企业及国有企业自主采购'])])
        result=self.client.post('/api/import/projects',data={'file':(io.BytesIO(raw),'项目.xlsx')},headers=self.headers)
        self.assertEqual(result.status_code,200,result.json);self.assertEqual(result.json['success'],1,result.json)
        p=self.Project.query.filter_by(number='IMPORT').one();self.assertEqual(c.project_snapshot(self.db,p.id)['method_id'],a['id'])
        self.assertEqual(p.stages[0].stage_key,'inquiry')
        raw=data_import._build_workbook_xlsx([dict(name='项目',title='项目',headers=['项目编号','项目名称','采购方式'],required=['项目编号','项目名称'],example=['BAD','不能猜制度','询价'])])
        result=self.client.post('/api/import/projects',data={'file':(io.BytesIO(raw),'项目.xlsx')},headers=self.headers)
        self.assertEqual(result.json['failed'],1,result.json);self.assertIsNone(self.Project.query.filter_by(number='BAD').first())

    def test_new_deadline_suggestion_is_read_only_and_explicit_config_wins(self):
        from src.backend_patches import business_deadlines as bd
        bd.ensure_schema(self.db);self.db.session.commit()
        m=self.add();p=self.create(m).json
        config=bd.settings_for(self.db,p['id']);self.assertEqual(config['suggested_regime'],'enterprise');self.assertFalse(config['enabled']);self.assertEqual(config['regime'],'')
        self.assertEqual(self.db.session.execute(text('SELECT COUNT(*) FROM business_deadline_settings')).scalar(),0)
        self.db.session.execute(text('INSERT INTO business_deadline_settings VALUES(:p,1,:v)'),dict(p=p['id'],v=c._json(dict(enabled=False,regime='custom',custom_rules=[]))))
        self.assertEqual(bd.settings_for(self.db,p['id'])['regime'],'custom')
