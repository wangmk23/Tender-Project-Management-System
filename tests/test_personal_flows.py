import copy
import marshal
import os
import json
from pathlib import Path
import unittest
from unittest.mock import patch
from sqlalchemy import text
from tests.procurement_fixtures import CatalogDatabase, STAGES
from src.backend_patches import procurement_catalog as c

ROOT=Path(__file__).resolve().parents[1]


class PersonalFlowTests(unittest.TestCase):
    def setUp(self):
        self.db=CatalogDatabase()
        c.migrate_legacy(self.db,{},STAGES);c.install_national_presets(self.db);self.db.session.commit()

    def tearDown(self):self.db.close()

    def activate(self):
        from src.backend_patches import personal_flows as p
        with patch.object(p,'BUNDLED_PERSONAL_FLOWS',True):p.activate(self.db)
        self.db.session.commit()
        return c.load_catalog(self.db)

    def legacy(self,name='公开招标'):
        return next(m for m in c.load_catalog(self.db)['methods'] if m['name']==name and m['regime'] is None)

    def test_special_upgrade_uses_saved_local_flow_and_preserves_project_snapshots(self):
        source=self.legacy();flow=copy.deepcopy(source['stages']);flow[0]['name']='实际电脑自定义第一步'
        c.save_method(self.db,dict(stages=flow),source['revision'],'owner',source['id']);self.db.session.commit()
        before={table:self.db.session.execute(text('SELECT * FROM '+table)).all() for table in ['projects','stages','bid_results','project_procurement_snapshots']}
        cat=self.activate();self.assertTrue(cat['personal_profile']['active'])
        for m in cat['methods']:
            if m['name']=='公开招标':self.assertEqual(c.method_stages(self.db,m),flow)
        for table,rows in before.items():self.assertEqual(self.db.session.execute(text('SELECT * FROM '+table)).all(),rows)
        self.assertNotIn(source['id'],cat['personal_profile']['hidden_method_ids'])

    def test_normal_build_does_not_activate_or_change_configuration(self):
        from src.backend_patches import personal_flows as p
        before=c.load_catalog(self.db)
        p.activate(self.db)
        self.assertEqual(c.load_catalog(self.db),before)

    def test_restart_never_reapplies_over_later_edits(self):
        self.activate();source=self.legacy();flow=copy.deepcopy(source['stages']);flow[0]['name']='升级后再次编辑'
        c.save_method(self.db,dict(stages=flow),source['revision'],'owner',source['id']);self.db.session.commit()
        self.activate();self.assertEqual(c.get_method(self.db,source['id'])['stages'],flow)

    def test_personal_pending_method_works_for_new_projects_without_reclassifying_history(self):
        source=self.legacy();self.activate()
        method=c.resolve_method(self.db,source['id'])
        snapshot=c.bind_project(self.db,self.db.project(),method)
        self.assertEqual(snapshot['method_id'],source['id']);self.assertIsNone(method['regime'])

    def test_ambiguous_custom_flows_are_reported_not_guessed(self):
        source=self.legacy();target=next(m for m in c.load_catalog(self.db)['methods'] if m['name']==source['name'] and m['regime'])
        flow=c.method_stages(self.db,target);flow[0]['name']='另一个已经编辑的流程'
        c.save_method(self.db,dict(stages=flow),target['revision'],'owner',target['id']);self.db.session.commit()
        before=c.get_method(self.db,target['id'])['stages'];cat=self.activate()
        self.assertTrue(any(i['name']==source['name'] for i in cat['personal_profile']['issues']))
        self.assertEqual(c.get_method(self.db,target['id'])['stages'],before)

    def test_original_templates_are_retained_for_audit(self):
        before={m['id']:m['stages'] for m in c.load_catalog(self.db)['methods']};self.activate()
        raw=self.db.session.execute(text('SELECT before_json FROM personal_flow_profiles WHERE id=1')).scalar_one()
        saved=json.loads(raw);self.assertEqual({m['id']:m['stages'] for m in saved},before)

    def test_build_flag_is_explicit_and_does_not_become_a_runtime_environment_switch(self):
        from tools.compile_module_patches import compile_personal_flows
        path=ROOT/'src/backend_patches/personal_flows.py'
        for enabled in ['0','1']:
            with patch.dict(os.environ,{'PM_BUILD_PERSONAL_FLOWS':enabled}):code=marshal.loads(compile_personal_flows(path))
            scope={};exec(code,scope)
            self.assertEqual(scope['BUNDLED_PERSONAL_FLOWS'],enabled=='1')

    def test_transaction_failure_does_not_leave_half_updated_defaults(self):
        from src.backend_patches import personal_flows as p
        before=c.load_catalog(self.db)
        real=c._audit
        def broken(db,action,*args):
            if action=='personal_flow_activation':raise RuntimeError('simulated interruption')
            return real(db,action,*args)
        with patch.object(p,'BUNDLED_PERSONAL_FLOWS',True),patch.object(c,'_audit',side_effect=broken):
            with self.assertRaises(RuntimeError):p.activate(self.db)
        self.db.session.rollback();self.assertEqual(c.load_catalog(self.db),before)

    def test_guarantee_anchor_conflict_keeps_target_default_and_its_rules(self):
        source=self.legacy();target=next(m for m in c.load_catalog(self.db)['methods'] if m['name']==source['name'] and m['regime'])
        rules=[dict(enabled=True,start_stage_key=target['stages'][0]['id'])]
        self.db.session.execute(text('INSERT INTO procurement_method_guarantee_defaults VALUES(:id,:r)'),dict(id=target['id'],r=json.dumps(rules)))
        self.db.session.commit();before=copy.deepcopy(target['stages']);cat=self.activate()
        self.assertEqual(c.get_method(self.db,target['id'])['stages'],before)
        self.assertEqual(c.guarantee_defaults(self.db,target['id']),rules)
        self.assertTrue(any('保证金' in i['reason'] for i in cat['personal_profile']['issues']))

if __name__=='__main__':unittest.main()
