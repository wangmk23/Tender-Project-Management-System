import copy
import json
import unittest
from sqlalchemy import text
from tests.procurement_fixtures import CatalogDatabase, STAGES
from src.backend_patches import procurement_catalog as c

class NormalFlowUpgradeTests(unittest.TestCase):
    def test_old_personal_profile_is_ignored_without_reverting_later_template_edits(self):
        db=CatalogDatabase()
        try:
            c.migrate_legacy(db,{},STAGES);c.install_national_presets(db);db.session.commit()
            methods=c.load_catalog(db)['methods'];source=next(m for m in methods if not m['regime'])
            target=next(m for m in methods if m['regime'] and m['name']==source['name'])
            flow=copy.deepcopy(target['stages']);flow[0]['name']='启用专属版后仍需保留的修改'
            c.save_method(db,dict(stages=flow),target['revision'],'owner',target['id']);db.session.commit()
            db.session.execute(text('CREATE TABLE personal_flow_profiles(id INTEGER PRIMARY KEY,profile_json TEXT,before_json TEXT,created_at TEXT)'))
            db.session.execute(text('INSERT INTO personal_flow_profiles VALUES(1,:p,:b,:d)'),dict(p=json.dumps(dict(active=True,hidden_method_ids=[target['id']],visible_method_ids=[source['id']])),b=json.dumps(methods),d='2026-10-19'))
            db.session.commit()
            tables=['procurement_methods','personal_flow_profiles','projects','stages','bid_results','project_procurement_snapshots']
            before={t:db.session.execute(text('SELECT * FROM '+t)).all() for t in tables}
            catalog=c.load_catalog(db)
            self.assertNotIn('personal_profile',catalog)
            self.assertEqual(c.get_method(db,target['id'])['stages'],flow)
            self.assertEqual(c.resolve_method(db,source['id'])['id'],source['id'])
            self.assertEqual(c.resolve_method(db,target['id'])['id'],target['id'])
            self.assertEqual(c.resolve_method(db,source['id'],existing_project=db.project())['id'],source['id'])
            c.migrate_legacy(db,{},STAGES);c.install_national_presets(db);db.session.commit()
            for t in tables:self.assertEqual(db.session.execute(text('SELECT * FROM '+t)).all(),before[t],t)
        finally:db.close()
