import copy
import json
import unittest
from sqlalchemy import text
from tests.procurement_fixtures import CatalogDatabase,STAGES
from src.backend_patches import procurement_catalog as c

class CustomProcurementTests(unittest.TestCase):
    def setUp(self):
        self.db=CatalogDatabase();c.migrate_legacy(self.db,{},STAGES);self.db.session.commit()
    def tearDown(self):self.db.close()
    def test_new_method_needs_no_regime_and_is_selectable(self):
        method=c.save_method(self.db,dict(name='我的采购方式'),c.load_catalog(self.db)['revision'],'admin');self.db.session.commit()
        self.assertIsNone(method['regime']);self.assertEqual(c.resolve_method(self.db,method['id'])['id'],method['id'])
        self.assertEqual(c.load_catalog(self.db)['management_mode'],'custom')
    def test_legacy_methods_no_longer_need_regime_confirmation(self):
        method=c.resolve_method(self.db,name='公开招标');self.assertIsNone(method['regime'])
    def test_presets_not_modified_or_used_are_excluded_but_all_data_stays(self):
        c.install_national_presets(self.db);self.db.session.commit()
        tables=['procurement_methods','project_procurement_snapshots','projects','stages','procurement_reference_presets']
        before={t:self.db.session.execute(text('SELECT * FROM '+t+' ORDER BY 1')).all() for t in tables}
        cat=c.load_catalog(self.db);owned=[m for m in cat['methods'] if m['user_owned']]
        self.assertEqual(len(owned),8)
        preset=next(m for m in cat['methods'] if m.get('reference_preset'))
        with self.assertRaises(c.CatalogError):c.resolve_method(self.db,preset['id'])
        self.assertEqual(c.resolve_method(self.db,name='公开招标')['id'],next(m['id'] for m in owned if m['name']=='公开招标'))
        for t in tables:self.assertEqual(self.db.session.execute(text('SELECT * FROM '+t+' ORDER BY 1')).all(),before[t])
    def test_hand_edited_preset_and_in_use_preset_are_kept(self):
        c.install_national_presets(self.db);self.db.session.commit()
        rows=[m for m in c.load_catalog(self.db)['methods'] if m.get('reference_preset')]
        a,b=rows[:2];flow=copy.deepcopy(a['stages']);flow[0]['name']='手动改过的阶段'
        c.save_method(self.db,dict(stages=flow),a['revision'],'admin',a['id']);self.db.session.commit()
        self.db.session.execute(text("INSERT INTO project_lots VALUES(5,1,'包5')"))
        self.db.session.execute(text('INSERT INTO lot_procurement_snapshots VALUES(5,:mid,:s)'),dict(mid=b['id'],s='{}'));self.db.session.commit()
        ids={m['id'] for m in c.load_catalog(self.db)['methods'] if m['user_owned']}
        self.assertIn(a['id'],ids);self.assertIn(b['id'],ids)
    def test_disabled_old_regime_does_not_hide_own_custom_method(self):
        method=c.save_method(self.db,dict(name='现有自建',regime='enterprise'),c.load_catalog(self.db)['revision'],'admin');self.db.session.commit()
        self.db.session.execute(text('CREATE TABLE IF NOT EXISTS procurement_regime_preferences(regime TEXT PRIMARY KEY,enabled INTEGER)'));self.db.session.execute(text("INSERT INTO procurement_regime_preferences VALUES('enterprise',0)"));self.db.session.commit()
        self.assertEqual(c.resolve_method(self.db,method['id'])['id'],method['id'])
    def test_new_custom_names_are_unique_without_merging_existing_records(self):
        c.save_method(self.db,dict(name='自定义',regime='enterprise'),c.load_catalog(self.db)['revision'],'admin');self.db.session.commit()
        with self.assertRaises(c.CatalogError) as error:c.save_method(self.db,dict(name='自定义'),c.load_catalog(self.db)['revision'],'admin')
        self.assertEqual(error.exception.code,'DUPLICATE_METHOD')

    def test_automatic_special_edition_copy_is_not_mistaken_for_manual_work(self):
        c.install_national_presets(self.db);self.db.session.commit()
        method=next(m for m in c.load_catalog(self.db)['methods'] if m.get('reference_preset'))
        self.db.session.execute(text("UPDATE procurement_methods SET notes='旧自动副本' WHERE id=:id"),dict(id=method['id']))
        self.db.session.execute(text('CREATE TABLE personal_flow_profiles(id INTEGER PRIMARY KEY,profile_json TEXT)'))
        self.db.session.execute(text('INSERT INTO personal_flow_profiles VALUES(1,:p)'),dict(p=json.dumps(dict(updated=[dict(target_id=method['id'])]))))
        self.db.session.commit()
        self.assertFalse(next(m for m in c.load_catalog(self.db)['methods'] if m['id']==method['id'])['user_owned'])
        c.save_method(self.db,dict(notes='之后手动保存'),method['revision'],'owner',method['id']);self.db.session.commit()
        self.assertTrue(next(m for m in c.load_catalog(self.db)['methods'] if m['id']==method['id'])['user_owned'])

    def test_preset_with_manually_saved_guarantee_rules_is_kept(self):
        c.install_national_presets(self.db);self.db.session.commit()
        method=next(m for m in c.load_catalog(self.db)['methods'] if m.get('reference_preset'))
        c.save_guarantee_defaults(self.db,method['id'],[],method['revision'],'owner');self.db.session.commit()
        self.assertTrue(next(m for m in c.load_catalog(self.db)['methods'] if m['id']==method['id'])['user_owned'])
