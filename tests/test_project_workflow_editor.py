import json
import unittest
from sqlalchemy import text
from tests.procurement_fixtures import CatalogDatabase,STAGES
from src.backend_patches import procurement_catalog as c,stage_templates as st,tender_guarantee as tg
from src.backend_patches import project_workflow_editor as editor


class ProjectWorkflowEditorTests(unittest.TestCase):
    def setUp(self):
        self.db=CatalogDatabase();c.migrate_legacy(self.db,{},STAGES)
        st.ensure_v5_snapshot_schema(self.db.session,text)
        self.db.session.execute(text('ALTER TABLE stages ADD COLUMN skipped INTEGER DEFAULT 0'))
        self.db.session.execute(text("UPDATE stages SET stage_name='历史完成',stage_icon='📥',modules_json='[\"common\"]',stage_position=0"))
        self.db.session.execute(text("INSERT INTO stages(project_id,stage_key,completed,stage_name,stage_icon,modules_json,stage_position) VALUES(1,'future',0,'待办阶段','📋','[\"common\"]',1)"))
        self.db.session.execute(text('ALTER TABLE stages ADD COLUMN notes TEXT'))
        self.db.session.commit();self.project=self.db.project()
        self.rows=[dict(id='first',name='历史完成',icon='📥',modules=['common']),dict(id='future',name='待办阶段',icon='📋',modules=['common'])]

    def tearDown(self):self.db.close()
    def preview(self,rows=None):return editor.preview_project_flow(self.db,self.project,rows or self.rows)
    def stage_rows(self):return self.db.session.execute(text('SELECT * FROM stages WHERE project_id=1 ORDER BY id')).all()

    def test_preview_is_read_only_and_apply_only_changes_target_project(self):
        self.db.session.execute(text("INSERT INTO projects VALUES(2,'OTHER','另一个','公开招标')"))
        self.db.session.execute(text("INSERT INTO stages(project_id,stage_key,completed,stage_name) VALUES(2,'old',1,'其他历史')"));self.db.session.commit()
        other=self.db.session.execute(text('SELECT * FROM stages WHERE project_id=2')).all()
        before=self.stage_rows();rows=self.rows+[dict(id='extra',name='新增检查',modules=['common','checklist'])]
        preview=self.preview(rows);self.assertEqual(self.stage_rows(),before)
        self.assertEqual([r['id'] for r in preview['diff']['added']],['extra'])
        editor.apply_project_flow(self.db,self.project,rows,preview['base_fingerprint'],'a');self.db.session.commit()
        self.assertEqual(self.db.session.execute(text('SELECT * FROM stages WHERE project_id=2')).all(),other)
        self.assertEqual(self.stage_rows()[0],before[0])
        self.assertEqual(c.project_snapshot(self.db,1)['workflow_revision'],1)

    def test_completed_stage_cannot_be_deleted_renamed_or_change_modules(self):
        for rows in [self.rows[1:],[{**self.rows[0],'name':'不能改'},self.rows[1]],[{**self.rows[0],'modules':['common','registration']},self.rows[1]]]:
            with self.subTest(rows=rows):
                preview=self.preview(rows);self.assertTrue(preview['blocked'])
                with self.assertRaises(c.CatalogError):editor.apply_project_flow(self.db,self.project,rows,preview['base_fingerprint'],'a')
                self.db.session.rollback()

    def test_remove_unused_future_stage_retains_row_as_hidden_audit(self):
        preview=self.preview(self.rows[:1]);self.assertEqual(preview['blocked'],[])
        editor.apply_project_flow(self.db,self.project,self.rows[:1],preview['base_fingerprint'],'a')
        self.assertEqual(self.db.session.execute(text("SELECT template_removed FROM stages WHERE stage_key='future'")).scalar(),1)

    def test_checklist_attachment_and_stage_notes_block_removal(self):
        self.db.session.execute(text('CREATE TABLE stage_checklist_items(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT)'))
        self.db.session.execute(text("INSERT INTO stage_checklist_items VALUES(1,1,'future')"))
        blocked=self.preview(self.rows[:1])['blocked'];self.assertTrue(any('检查' in str(x) for x in blocked))
        self.db.session.execute(text('DELETE FROM stage_checklist_items'))
        self.db.session.execute(text("UPDATE stages SET notes='保留资料' WHERE stage_key='future'"))
        self.assertTrue(self.preview(self.rows[:1])['blocked'])
        self.db.session.execute(text("UPDATE stages SET notes='' WHERE stage_key='future'"))
        self.db.session.execute(text('CREATE TABLE attachments(id INTEGER,project_id INTEGER,stage_key TEXT)'))
        self.db.session.execute(text("INSERT INTO attachments VALUES(1,1,'future')"))
        self.assertTrue(any('附件' in str(x) for x in self.preview(self.rows[:1])['blocked']))

    def test_guarantee_start_and_deadline_references_block_removal(self):
        tg.ensure_schema(self.db)
        data=dict(rules=[dict(enabled=True,start_stage_key='future')],records=[],confirmed=False)
        self.db.session.execute(text("INSERT INTO tender_ledgers VALUES(1,1,:p,'','[]')"),{'p':json.dumps(data)})
        self.assertTrue(any('保证金' in str(x) for x in self.preview(self.rows[:1])['blocked']))
        self.db.session.execute(text('DELETE FROM tender_ledgers'))
        self.db.session.execute(text('CREATE TABLE business_deadline_items(id TEXT,project_id INTEGER,state TEXT,payload TEXT)'))
        self.db.session.execute(text('INSERT INTO business_deadline_items VALUES(\'1\',1,\'confirmed\',:p)'),{'p':json.dumps(dict(stage_key='future'))})
        self.assertTrue(any('期限' in str(x) for x in self.preview(self.rows[:1])['blocked']))

    def test_preview_becomes_stale_after_stage_changes_and_rolls_back(self):
        preview=self.preview();self.db.session.execute(text("UPDATE stages SET notes='新的资料' WHERE stage_key='future'"));self.db.session.commit()
        before=self.stage_rows()
        with self.assertRaises(c.CatalogError) as err:editor.apply_project_flow(self.db,self.project,self.rows,preview['base_fingerprint'],'a')
        self.assertEqual(err.exception.status,409);self.assertEqual(self.stage_rows(),before)

    def test_business_records_prevent_removing_module_from_stage(self):
        self.db.session.execute(text("UPDATE stages SET modules_json='[\"common\",\"registration\"]' WHERE stage_key='future'"))
        self.db.session.execute(text('CREATE TABLE supplier_registrations(id INTEGER,project_id INTEGER)'))
        self.db.session.execute(text('INSERT INTO supplier_registrations VALUES(1,1)'))
        preview=self.preview()
        self.assertTrue(any('报名' in str(x) for x in preview['blocked']))

    def test_legacy_completed_stage_without_snapshot_name_uses_preserved_definitions(self):
        from flask import Flask
        app=Flask(__name__);app.extensions['procurement_catalog']={'STAGES':[dict(key='first',name='历史完成',icon='📥')]}
        self.db.session.execute(text("UPDATE stages SET stage_name=NULL,stage_icon=NULL WHERE stage_key='first'"))
        with app.app_context():self.assertEqual(self.preview()['blocked'],[])

    def test_internal_policy_marker_is_not_a_removed_business_module_and_survives_save(self):
        self.db.session.execute(text('UPDATE stages SET modules_json=:m'),dict(m=json.dumps(['common',st.AUTO_COMPLETION_POLICY_MARKER])))
        preview=self.preview();self.assertEqual(preview['blocked'],[]);self.assertEqual(preview['diff']['updated'],[])
        rows=[self.rows[0],{**self.rows[1],'name':'调整后待办'}]
        preview=self.preview(rows);editor.apply_project_flow(self.db,self.project,rows,preview['base_fingerprint'],'a')
        raw=self.db.session.execute(text("SELECT modules_json FROM stages WHERE stage_key='future'")).scalar()
        self.assertIn(st.AUTO_COMPLETION_POLICY_MARKER,json.loads(raw))


class ProjectWorkflowEditorApiTests(unittest.TestCase):
    from tests import test_procurement_method_api as fixtures
    setUp=fixtures.ProcurementMethodApiTests.setUp
    tearDown=fixtures.ProcurementMethodApiTests.tearDown
    login=fixtures.ProcurementMethodApiTests.login
    catalog=fixtures.ProcurementMethodApiTests.catalog
    add=fixtures.ProcurementMethodApiTests.add
    create=fixtures.ProcurementMethodApiTests.create

    def test_preview_commit_permissions_and_stale_preview(self):
        m=self.add();p=self.create(m).json;pid=p['id']
        rows=[dict(id='first',name='开始',icon='📥',modules=['common','checklist']),dict(id='end',name='完成',icon='📦',modules=['common','checklist']),dict(id='extra',name='新增',modules=['common'])]
        url=f'/api/projects/{pid}/workflow/'
        self.assertEqual(self.client.post(url+'preview',json=dict(stages=rows)).status_code,403)
        preview=self.client.post(url+'preview',json=dict(stages=rows),headers=self.headers)
        self.assertEqual(preview.status_code,200,preview.json)
        result=self.client.post(url+'commit',json=dict(stages=rows,base_fingerprint=preview.json['base_fingerprint']),headers=self.headers)
        self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(result.json['project']['stages'][-1]['key'],'extra')
        stale=self.client.post(url+'commit',json=dict(stages=rows,base_fingerprint=preview.json['base_fingerprint']),headers=self.headers)
        self.assertEqual(stale.status_code,409,stale.json)
