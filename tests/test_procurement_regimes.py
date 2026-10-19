import copy
import unittest
from sqlalchemy import text
from sqlalchemy.orm import Session
from tests.procurement_fixtures import CatalogDatabase, STAGES
from src.backend_patches import procurement_catalog as c

class ProcurementRegimeTests(unittest.TestCase):
    def setUp(self):
        self.db=CatalogDatabase();c.migrate_legacy(self.db,{},STAGES);c.install_national_presets(self.db);self.db.session.commit()
    def tearDown(self):self.db.close()
    def toggle(self,regime='government_procurement',enabled=False,revision=None):
        result=c.save_regime_enabled(self.db,regime,enabled,revision if revision is not None else c.load_catalog(self.db)['revision'],'admin');self.db.session.commit();return result
    def test_upgrade_defaults_keep_current_scope_and_persist_after_restart(self):
        self.assertEqual(c.load_catalog(self.db)['regime_enabled'],dict.fromkeys(c.REGIMES,True))
        self.toggle();self.db.session.close();self.db.session=Session(self.db.engine)
        c.migrate_legacy(self.db,{},STAGES);c.install_national_presets(self.db);self.db.session.commit()
        self.assertFalse(c.load_catalog(self.db)['regime_enabled']['government_procurement'])
    def test_toggle_changes_no_methods_templates_or_historical_business_rows(self):
        tables=['procurement_methods','projects','stages','project_procurement_snapshots','lot_procurement_snapshots','procurement_method_guarantee_defaults']
        before={t:self.db.session.execute(text('SELECT * FROM '+t+' ORDER BY 1')).all() for t in tables}
        self.toggle();self.toggle(enabled=True)
        for t in tables:self.assertEqual(self.db.session.execute(text('SELECT * FROM '+t+' ORDER BY 1')).all(),before[t],t)
    def test_new_selection_and_stale_binding_rejected_but_existing_project_allowed(self):
        target=next(m for m in c.load_catalog(self.db)['methods'] if m['regime']=='government_procurement')
        self.db.session.execute(text("INSERT INTO projects VALUES(2,'NEW','已有项目','')"));self.db.session.execute(text("INSERT INTO projects VALUES(3,'OTHER','新项目','')"));self.db.session.commit()
        c.bind_project(self.db,self.db.project(2),target);self.db.session.commit();before=c.project_snapshot(self.db,2)
        self.toggle()
        with self.assertRaises(c.CatalogError) as error:c.resolve_method(self.db,target['id'])
        self.assertEqual(error.exception.code,'REGIME_DISABLED')
        self.assertEqual(c.resolve_method(self.db,target['id'],existing_project=self.db.project(2))['id'],target['id'])
        with self.assertRaises(c.CatalogError):c.bind_project(self.db,self.db.project(3),target)
        self.assertEqual(c.project_snapshot(self.db,2),before)
    def test_strict_validation_conflict_and_idempotence(self):
        for regime,enabled in [('unknown',False),('enterprise',0),('enterprise','false'),('enterprise',None)]:
            with self.assertRaises(c.CatalogError):self.toggle(regime,enabled)
            self.db.session.rollback()
        revision=c.load_catalog(self.db)['revision'];self.toggle(revision=revision)
        with self.assertRaises(c.CatalogError) as error:self.toggle('enterprise',False,revision)
        self.assertEqual(error.exception.code,'REVISION_CONFLICT');self.db.session.rollback()
        before=copy.deepcopy(c.load_catalog(self.db));self.toggle();self.assertEqual(c.load_catalog(self.db),before)
    def test_reenable_does_not_reenable_individually_disabled_method(self):
        method=next(m for m in c.load_catalog(self.db)['methods'] if m['regime']=='government_procurement')
        c.save_method(self.db,dict(enabled=False),method['revision'],'admin',method['id']);self.db.session.commit()
        self.toggle();self.toggle(enabled=True);self.assertFalse(c.get_method(self.db,method['id'])['enabled'])

    def test_import_template_excludes_disabled_regime_from_directory_and_choices(self):
        from src.backend_patches import data_import
        self.toggle()
        catalog=c.load_catalog(self.db)
        workbook=data_import._parse_xlsx_workbook(data_import.build_import_template('projects',procurement_catalog=catalog))
        directory=str(workbook['采购方式目录'])
        self.assertNotIn('政府采购',directory)
        self.assertIn('企业及国有企业自主采购',directory)
