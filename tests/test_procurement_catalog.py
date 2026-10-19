import copy
import unittest
from sqlalchemy import text
from sqlalchemy.orm import Session
from tests.procurement_fixtures import CatalogDatabase, STAGES
from src.backend_patches import procurement_catalog as c


class ProcurementCatalogTests(unittest.TestCase):
    def setUp(self):
        self.db = CatalogDatabase()
        c.migrate_legacy(self.db, {}, STAGES)
        self.db.session.commit()

    def tearDown(self):
        self.db.close()

    def create(self, name='自主采购', regime='enterprise', **extra):
        payload = dict(name=name, regime=regime, **extra)
        row = c.save_method(self.db, payload, c.load_catalog(self.db)['revision'], 'admin')
        self.db.session.commit()
        return row

    def test_migration_keeps_business_rows_and_is_idempotent(self):
        before = self.db.session.execute(text('SELECT * FROM stages')).all()
        cat = c.load_catalog(self.db)
        self.assertEqual(len(cat['methods']), 8)
        self.assertTrue(all(m['regime'] is None for m in cat['methods']))
        self.assertEqual(next(m for m in cat['methods'] if m['name']=='单一来源')['quantity_rule'], {'mode':'fixed','minimum':1})
        c.migrate_legacy(self.db, {'supplier_minimums':{'公开招标':9}}, STAGES)
        self.assertEqual(c.load_catalog(self.db), cat)
        self.assertEqual(self.db.session.execute(text('SELECT * FROM stages')).all(), before)
        self.assertEqual(self.db.session.execute(text('SELECT supplier_name FROM bid_results')).scalar(), '历史供应商')

    def test_new_method_unfixed_common_and_persists_new_session(self):
        m = self.create()
        self.assertEqual(m['quantity_rule'], {'mode':'unfixed','minimum':None})
        self.assertEqual(m['template_mode'], 'common')
        self.assertTrue(m['enabled'])
        self.db.session.close();self.db.session=Session(self.db.engine)
        self.assertIn(m['id'], [x['id'] for x in c.load_catalog(self.db)['methods']])

    def test_name_uniqueness_scoped_to_regime_and_identity_survives_rename(self):
        m = self.create('询价')
        self.create('询价','collective')
        with self.assertRaises(c.CatalogError) as err:self.create('询价')
        self.assertEqual(err.exception.code,'DUPLICATE_METHOD')
        self.db.session.rollback()
        renamed=c.save_method(self.db,dict(name='询价采购'),m['revision'],'admin',m['id'])
        self.assertEqual(renamed['id'],m['id'])

    def test_fixed_quantity_rejects_bool_zero_and_fraction(self):
        for bad in [True,0,100,2.5,'3']:
            with self.subTest(bad=bad),self.assertRaises(c.CatalogError):
                self.create(quantity_rule=dict(mode='fixed',minimum=bad))
            self.db.session.rollback()

    def test_unfixed_cannot_hide_numeric_minimum(self):
        with self.assertRaises(c.CatalogError):self.create(quantity_rule=dict(mode='unfixed',minimum=3))

    def test_regime_and_bool_validated_not_coerced(self):
        for extra in [dict(regime='government'),dict(enabled='false')]:
            payload=dict(name='自定义',regime='enterprise');payload.update(extra)
            with self.assertRaises(c.CatalogError):c.save_method(self.db,payload,c.load_catalog(self.db)['revision'],'admin')
            self.db.session.rollback()

    def test_stale_revision_does_not_overwrite(self):
        m=self.create()
        saved=c.save_method(self.db,dict(notes='先保存'),m['revision'],'a',m['id']);self.db.session.commit()
        with self.assertRaises(c.CatalogError) as err:c.save_method(self.db,dict(name='不应覆盖'),m['revision'],'b',m['id'])
        self.assertEqual(err.exception.status,409)
        self.assertEqual(next(x for x in c.load_catalog(self.db)['methods'] if x['id']==m['id'])['notes'],'先保存')

    def test_reorder_requires_complete_unique_ids_and_version(self):
        cat=c.load_catalog(self.db);ids=[m['id'] for m in cat['methods']]
        for bad in [ids[:-1],ids+ids[:1]]:
            with self.assertRaises(c.CatalogError):c.reorder_methods(self.db,bad,cat['revision'],'a')
            self.db.session.rollback()
        c.reorder_methods(self.db,list(reversed(ids)),cat['revision'],'a');self.db.session.commit()
        self.assertEqual([m['id'] for m in c.load_catalog(self.db)['methods']],list(reversed(ids)))

    def test_project_reference_blocks_deletion_and_disabling_keeps_snapshot(self):
        m=next(x for x in c.load_catalog(self.db)['methods'] if x['name']=='公开招标')
        with self.assertRaises(c.CatalogError) as err:c.delete_method(self.db,m['id'],m['revision'],'a')
        self.assertEqual(err.exception.code,'METHOD_IN_USE')
        before=c.enrich_project(self.db,self.db.project(),{})['procurement']
        c.save_method(self.db,dict(name='新名称',enabled=False,regime='enterprise'),m['revision'],'a',m['id']);self.db.session.commit()
        after=c.enrich_project(self.db,self.db.project(),{})['procurement']
        self.assertEqual(after['name_snapshot'],before['name_snapshot'])
        self.assertEqual(after['regime'],before['regime'])
        self.assertFalse(after['current_enabled'])

    def test_delete_unreferenced_and_caller_rollback(self):
        m=self.create()
        c.delete_method(self.db,m['id'],m['revision'],'a');self.db.session.rollback()
        self.assertIn(m['id'],[r['id'] for r in c.load_catalog(self.db)['methods']])
        c.delete_method(self.db,m['id'],m['revision'],'a');self.db.session.commit()
        self.assertNotIn(m['id'],[r['id'] for r in c.load_catalog(self.db)['methods']])

    def test_common_and_independent_templates_use_validated_stages(self):
        rows=[dict(id='custom',name='自定义阶段',icon='📋',modules=['common','registration'])]
        m=self.create(template_mode='independent',stages=rows)
        self.assertEqual(c.method_stages(self.db,m)[0]['id'],'custom')
        cat=c.load_catalog(self.db)
        c.save_common_flow(self.db,[dict(id='shared',name='通用新阶段',modules=['common'])],cat['revision'],'a')
        self.assertEqual(c.method_stages(self.db,m)[0]['id'],'custom')
        with self.assertRaises(c.CatalogError):self.create(template_mode='independent',stages=[])

    def test_exceptions_validated_and_text_is_not_executed(self):
        m=self.create(notes='<b>纯文本</b>',exceptions=[dict(title='特殊情形',description='人工核实',enabled=True,quantity_rule=dict(mode='fixed',minimum=2))])
        self.assertEqual(m['notes'],'<b>纯文本</b>')
        self.assertTrue(m['exceptions'][0]['id'])
        with self.assertRaises(c.CatalogError):self.create(exceptions=[dict(title='无说明',description='',quantity_rule=dict(mode='unfixed',minimum=None))])

    def test_invalid_legacy_settings_roll_back_whole_migration(self):
        db=CatalogDatabase()
        try:
            with self.assertRaises(c.CatalogError):c.migrate_legacy(db,{'supplier_minimums':{'公开招标':False}},STAGES)
            db.session.rollback()
            self.assertEqual(db.session.execute(text('SELECT COUNT(*) FROM projects')).scalar(),1)
        finally:db.close()

    def test_duplicate_name_resolver_rejects_ambiguous_old_clients(self):
        self.create('同名','enterprise');self.create('同名','collective')
        with self.assertRaises(c.CatalogError) as err:c.resolve_method(self.db,None,'同名',None)
        self.assertEqual(err.exception.code,'AMBIGUOUS_METHOD')
        self.assertEqual(c.resolve_method(self.db,None,'同名','collective')['regime'],'collective')

    def test_legacy_pending_regime_requires_classification_only_for_new_projects(self):
        self.assertEqual(c.resolve_method(self.db,None,'公开招标',None)['name'],'公开招标')
        self.assertEqual(c.resolve_method(self.db,None,'公开招标',None,existing_project=self.db.project())['name'],'公开招标')

    def test_stale_resolve_cannot_bind_deleted_method_and_reverse_order_blocks_delete(self):
        from types import SimpleNamespace
        m=self.create()
        self.db.session.execute(text("INSERT INTO projects VALUES(2,'NEW','新项目','')"));self.db.session.commit()
        other=SimpleNamespace(engine=self.db.engine,session=Session(self.db.engine))
        try:
            resolved=c.resolve_method(self.db,m['id'])
            c.delete_method(other,m['id'],m['revision'],'b');other.session.commit()
            with self.assertRaises(c.CatalogError):c.bind_project(self.db,self.db.project(2),resolved)
            self.db.session.rollback()
            self.assertIsNone(c.project_snapshot(self.db,2))
            m=self.create('另一个')
            c.bind_project(self.db,self.db.project(2),m);self.db.session.commit()
            with self.assertRaises(c.CatalogError) as err:c.delete_method(other,m['id'],m['revision'],'b')
            self.assertEqual(err.exception.code,'METHOD_IN_USE')
        finally:other.session.rollback();other.session.close()

    def test_database_backup_copy_restores_catalog_and_references(self):
        import sqlite3
        from sqlalchemy import create_engine
        from types import SimpleNamespace
        self.create('备份测试',exceptions=[dict(title='人工例外',description='按文件核对',quantity_rule=dict(mode='unfixed',minimum=None))])
        before=c.load_catalog(self.db);self.db.session.commit()
        backup=self.db.path.with_name('backup.db')
        from contextlib import closing
        with closing(sqlite3.connect(self.db.path)) as source,closing(sqlite3.connect(backup)) as target:source.backup(target)
        engine=create_engine('sqlite:///'+str(backup));session=Session(engine)
        try:
            restored=SimpleNamespace(session=session,engine=engine)
            self.assertEqual(c.load_catalog(restored),before)
            self.assertEqual(c.project_snapshot(restored,1)['name_snapshot'],'公开招标')
        finally:session.close();engine.dispose()
