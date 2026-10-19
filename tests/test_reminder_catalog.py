"""Reminder choices, settings validation and delivery share catalog identities."""
import unittest
from datetime import datetime
from types import SimpleNamespace
from sqlalchemy import text

from src.backend_patches import procurement_catalog as catalog, stage_templates
from tests import test_reminder_settings as settings_tests, test_reminder_scheduler as scheduler_tests
from tests.procurement_fixtures import CatalogDatabase, STAGES


class ReminderCatalogTests(unittest.TestCase):
    def setUp(self):
        self.database = CatalogDatabase()
        self.addCleanup(self.database.close)
        catalog.migrate_legacy(self.database, {}, STAGES)
        self.database.session.execute(text('ALTER TABLE stages ADD COLUMN stage_name TEXT'))
        self.database.session.execute(text('ALTER TABLE stages ADD COLUMN template_removed INTEGER DEFAULT 0'))
        for name, key in [('同名采购', 'custom_first'), ('同名采购', 'custom_second')]:
            cat = catalog.load_catalog(self.database)
            catalog.save_method(self.database, dict(name=name, regime='enterprise' if key.endswith('first') else 'collective',
                template_mode='independent', stages=[dict(id=key, name='独立流程' + key, icon='📥', modules=['common'])]),
                cat['revision'], 'test')
        self.database.session.execute(text("INSERT INTO stages(id,project_id,stage_key,completed,stage_name) VALUES(2,1,'snapshot_only',0,'历史项目专用节点')"))
        self.database.session.commit()

    def settings_case(self):
        case = settings_tests.ReminderSettingsTests()
        case.setUp()
        self.addCleanup(case.tearDown)
        case.module.db = self.database
        case.module.STAGES = STAGES
        case.module.app.extensions = {'procurement_catalog': {'db': self.database}}
        return case

    def test_fresh_frozen_stage_schema_can_load_settings_without_snapshot_columns(self):
        from src.backend_patches import reminder_routing
        fresh=CatalogDatabase()
        try:
            catalog.migrate_legacy(fresh,{},STAGES)
            before=[row[1] for row in fresh.session.execute(text('PRAGMA table_info(stages)')).all()]
            definitions=reminder_routing.reminder_stage_definitions({},STAGES,database=fresh)
            self.assertTrue(definitions)
            after=[row[1] for row in fresh.session.execute(text('PRAGMA table_info(stages)')).all()]
            self.assertEqual(before,after,'reading reminder choices does not migrate project data')
        finally:
            fresh.close()

    def test_settings_save_accepts_same_name_independent_and_snapshot_keys(self):
        case = self.settings_case()
        case.request.json = {'reminder_stage_keys': ['custom_first', 'custom_second', 'snapshot_only']}
        response = case.module.api_update_settings()
        self.assertIsInstance(response, dict, response)
        self.assertEqual(case.settings['reminder_stage_keys'], case.request.json['reminder_stage_keys'])

    def test_get_exposes_snapshot_and_catalog_options_and_defaults_without_writing(self):
        case = self.settings_case()
        before = dict(case.settings)
        response = case.module.api_get_settings()
        choices = {row['key']: row for row in response['reminder_stage_definitions']}
        self.assertTrue({'custom_first', 'custom_second', 'snapshot_only'} <= choices.keys())
        self.assertEqual(choices['snapshot_only']['name'], '历史项目专用节点')
        self.assertRegex(choices['custom_first']['methods'][0],r'^同名采购（配置 [12]）$')
        self.assertTrue({'custom_first', 'custom_second', 'snapshot_only'} <= set(response['reminder_stage_keys']))
        self.assertEqual(before, case.settings)

    def test_same_name_labels_keep_their_identity_after_sorting(self):
        from src.backend_patches import reminder_routing
        def labels():return {r['key']:r['methods'] for r in reminder_routing.reminder_stage_definitions({},STAGES,database=self.database)}
        before=labels();cat=catalog.load_catalog(self.database)
        catalog.reorder_methods(self.database,[m['id'] for m in reversed(cat['methods'])],cat['revision'],'test');self.database.session.commit()
        after=labels()
        for key in ['custom_first','custom_second']:self.assertEqual(after[key],before[key])

    def test_existing_subscription_survives_catalog_deletion_but_new_unknown_is_rejected(self):
        case = self.settings_case()
        case.settings['reminder_stage_keys'] = ['retired_stage']
        case.request.json = {'reminder_stage_keys': ['retired_stage']}
        self.assertIsInstance(case.module.api_update_settings(), dict)
        case.request.json = {'reminder_stage_keys': ['unrecognized_new_key']}
        response, status = case.module.api_update_settings()
        self.assertEqual(status, 400)

    def test_preview_uses_custom_catalog_stage_name(self):
        case = self.settings_case()
        case.request.json = {'reminder_action': 'preview', 'reminder_stage_keys': ['custom_first']}
        response = case.module.api_update_settings()
        self.assertIsInstance(response, dict, response)
        self.assertIn('独立流程custom_first', response['preview']['body'])

    def test_scheduler_defaults_include_snapshot_only_keys_for_both_delivery_modes(self):
        for grouped in (False, True):
            with self.subTest(grouped=grouped):
                case = scheduler_tests.ReminderSchedulerTests()
                case.setUp()
                try:
                    case.module.app = SimpleNamespace(extensions={'procurement_catalog': {'db': self.database}})
                    case.module.db = self.database
                    case.module.text = text
                    case.settings.pop('reminder_stage_keys')
                    case.projects[:] = [case.project(1, 'CG-001', '项目', [case.stage('snapshot_only', '', '2026-07-20T09:00:00')])]
                    if grouped:
                        case.configure_recipient_groups()
                    case.run_digest(datetime(2026, 7, 20, 9))
                    bodies = [message.get_body(preferencelist=('plain',)).get_content()
                              for smtp in case.smtp_instances for message in smtp.messages]
                    self.assertTrue(bodies, 'snapshot-only stage must be delivered without an explicit subscription list')
                    self.assertTrue(all('历史项目专用节点' in body for body in bodies))
                finally:
                    case.tearDown()
