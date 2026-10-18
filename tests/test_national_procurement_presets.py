import copy,json,unittest
from sqlalchemy import text
from tests.procurement_fixtures import CatalogDatabase,STAGES
from src.backend_patches import procurement_catalog as c


class NationalProcurementPresetTests(unittest.TestCase):
    def setUp(self):
        self.db=CatalogDatabase();c.migrate_legacy(self.db,{},STAGES);self.db.session.commit()
    def tearDown(self):self.db.close()
    def install(self):
        result=c.install_national_presets(self.db);self.db.session.commit();return result
    def test_adds_classified_independent_presets_without_changing_any_old_rows(self):
        tables=['projects','stages','bid_results','procurement_methods','project_procurement_snapshots','lot_procurement_snapshots']
        before={t:self.db.session.execute(text('SELECT * FROM '+t+' ORDER BY 1')).all() for t in tables}
        old_ids=[m['id'] for m in c.load_catalog(self.db)['methods']]
        self.install();cat=c.load_catalog(self.db)
        self.assertEqual(len(cat['methods']),28)
        for t in tables:
            rows=self.db.session.execute(text('SELECT * FROM '+t+' ORDER BY 1')).all()
            if t=='procurement_methods':rows=[row for row in rows if row[0] in old_ids]
            self.assertEqual(rows,before[t],t)
        seeded=[m for m in cat['methods'] if m.get('reference_preset')]
        self.assertEqual(len(seeded),20)
        self.assertEqual({m['regime'] for m in seeded},set(c.REGIMES))
        self.assertTrue(all(m['enabled'] and m['template_mode']=='independent' for m in seeded))
        self.assertTrue(all(m['reference_preset']['checked_on']=='2026-10-18' for m in seeded))
    def test_restart_does_not_overwrite_admin_edits_reenable_or_resurrect_deleted_presets(self):
        self.install();methods=[m for m in c.load_catalog(self.db)['methods'] if m.get('reference_preset')]
        changed=c.save_method(self.db,dict(name='管理员改名',enabled=False,stages=[dict(id='custom',name='我的流程',modules=['common'])]),methods[0]['revision'],'admin',methods[0]['id'])
        c.delete_method(self.db,methods[1]['id'],methods[1]['revision'],'admin');self.db.session.commit()
        before=copy.deepcopy(c.load_catalog(self.db));self.install()
        self.assertEqual(c.load_catalog(self.db),before)
        self.assertFalse(c.get_method(self.db,changed['id'])['enabled'])
    def test_existing_same_regime_name_is_kept_and_not_claimed_as_national_preset(self):
        old=c.save_method(self.db,dict(name='公开招标',regime='government_procurement',notes='已自定义',quantity_rule=dict(mode='fixed',minimum=7)),c.load_catalog(self.db)['revision'],'admin');self.db.session.commit()
        self.install();self.assertEqual(c.get_method(self.db,old['id'])['notes'],'已自定义')
        method=next(m for m in c.load_catalog(self.db)['methods'] if m['id']==old['id'])
        self.assertNotIn('reference_preset',method)
        self.assertEqual(c.load_catalog(self.db)['preset_summary']['conflicts'],1)
    def test_definitions_are_valid_distinct_and_national_only(self):
        from src.backend_patches.procurement_presets import definitions
        rows=definitions();self.assertEqual(len(rows),20)
        self.assertEqual(len({r['key'] for r in rows}),len(rows))
        for row in rows:
            self.assertEqual(c.normalize_stages(row['method']['stages']),row['method']['stages'])
            self.assertNotIn('auto_completion',{v for s in row['method']['stages'] for v in s['modules']})
            self.assertTrue(all(s['url'].startswith('https://') for s in row['reference']['sources']))
            self.assertNotIn('东莞',json.dumps(row,ensure_ascii=False))
        govt={r['method']['name']:r['method'] for r in rows if r['method']['regime']=='government_procurement'}
        self.assertIn('询价',govt);self.assertIn('合作创新采购',govt)
        self.assertIn('框架协议采购（第二阶段）',govt)
        self.assertNotEqual([s['name'] for s in govt['竞争性磋商']['stages']],[s['name'] for s in govt['竞争性谈判']['stages']])
        bidding=[r['method']['name'] for r in rows if r['method']['regime']=='mandatory_construction_bidding']
        self.assertEqual(bidding,['公开招标','邀请招标'])
    def test_installation_is_in_callers_transaction(self):
        c.install_national_presets(self.db);self.db.session.rollback()
        self.assertEqual(len(c.load_catalog(self.db)['methods']),8)
    def test_full_catalog_does_not_break_startup_or_modify_existing_methods(self):
        for n in range(192):
            c.save_method(self.db,dict(name='自定义'+str(n),regime='other'),c.load_catalog(self.db)['revision'],'admin')
        self.db.session.commit();before=c.load_catalog(self.db)['methods'];self.install()
        self.assertEqual(c.load_catalog(self.db)['methods'],before)
        self.assertEqual(c.load_catalog(self.db)['preset_summary']['capacity_pending'],20)
