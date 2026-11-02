"""Explicit method reconciliation must preserve real historical stage rows."""
import unittest
from sqlalchemy import text
from tests import test_procurement_method_api as fixtures
from src.backend_patches import procurement_catalog as catalog


class MethodFlowSyncTests(unittest.TestCase):
    setUp = fixtures.ProcurementMethodApiTests.setUp
    tearDown = fixtures.ProcurementMethodApiTests.tearDown
    login = fixtures.ProcurementMethodApiTests.login
    catalog = fixtures.ProcurementMethodApiTests.catalog
    add = fixtures.ProcurementMethodApiTests.add
    create = fixtures.ProcurementMethodApiTests.create

    def pair(self, drift=True):
        self.pair_number = getattr(self, 'pair_number', 0) + 1
        old = [dict(id=k, name=n, modules=['common']) for k, n in (
            ('start', '原接收'), ('documents', '原文件编制'),
            ('opening', '开标'), ('evaluation', '评标'),
            ('result', '结果'), ('fee', '原服务费'), ('archive', '归档'))]
        new = [dict(id=k, name=n, modules=mods) for k, n, mods in (
            ('start', '新接收', ['common']),
            ('online_documents', '竞价文件确认', ['common']),
            ('quotation', '一次报价竞价', ['common', 'online_bidding']),
            ('result', '成交结果', ['common']),
            ('archive', '竞价归档', ['common']))]
        a = self.add('合成原方式' + str(self.pair_number), template_mode='independent', stages=old)
        b = self.add('合成网上竞价' + str(self.pair_number), template_mode='independent', stages=new)
        pid = self.create(a, number='SYNC-' + str(self.pair_number)).json['id']
        self.db.session.execute(text("UPDATE stages SET completed=1,completed_date='2026-10-20',notes='保留的实际完成记录' WHERE project_id=:p AND stage_key IN ('start','documents')"), {'p': pid})
        self.db.session.execute(text("UPDATE stages SET completed=1,skipped=1,completed_date='2026-10-21',notes='人工确认不适用' WHERE project_id=:p AND stage_key IN ('opening','evaluation')"), {'p': pid})
        if drift:
            project = self.db.session.get(self.Project, pid)
            catalog.bind_project(self.db, project, b)
            project.method = b['name']
        self.db.session.commit()
        return pid, a, b

    def physical(self, pid):
        return {r['stage_key']: dict(r) for r in self.db.session.execute(
            text('SELECT * FROM stages WHERE project_id=:p ORDER BY id'), {'p': pid}).mappings()}

    def preview(self, pid, method):
        response = self.client.post(f'/api/projects/{pid}/workflow/preview',
            json={'mode': 'method', 'procurement_method_id': method['id']}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        return response.json

    def commit(self, pid, method, preview, **extra):
        return self.client.put(f'/api/projects/{pid}', json=dict(
            procurement_method_id=method['id'], sync_method_flow=True,
            method_flow_fingerprint=preview['base_fingerprint'], **extra), headers=self.headers)

    def test_preview_is_read_only_and_distinguishes_preserved_completed_history(self):
        pid, a, b = self.pair()
        before = self.physical(pid)
        impact = self.preview(pid, b)
        self.assertEqual(self.physical(pid), before)
        self.assertEqual(impact['mode'], 'method')
        self.assertTrue(impact['requires_confirmation'])
        self.assertEqual(impact['blocked'], [])
        self.assertEqual({s['id'] for s in impact['archived_history']}, {'documents', 'opening', 'evaluation'})
        self.assertEqual([s['id'] for s in impact['preserved_completed']], ['start'])
        self.assertEqual(impact['stages'][0]['name'], '原接收')

    def test_explicit_sync_repairs_drift_without_resetting_completions_or_manual_skips(self):
        pid, a, b = self.pair()
        before = self.physical(pid)
        response = self.commit(pid, b, self.preview(pid, b))
        self.assertEqual(response.status_code, 200, response.json)
        active = [s for s in response.json['stages'] if not s['template_removed']]
        self.assertEqual([s['key'] for s in active], ['start', 'online_documents', 'quotation', 'result', 'archive'])
        after = self.physical(pid)
        for key in ('start', 'documents', 'opening', 'evaluation'):
            old = {k: v for k, v in before[key].items() if k not in ('template_removed', 'stage_position')}
            now = {k: v for k, v in after[key].items() if k not in ('template_removed', 'stage_position')}
            self.assertEqual(old, now, key)
        for key in ('documents', 'opening', 'evaluation'):
            self.assertTrue(after[key]['template_removed'])
        self.assertFalse(after['online_documents']['completed'])
        self.assertFalse(after['quotation']['completed'])
        self.assertTrue(response.json['online_bidding_enabled'])

    def test_missing_confirmation_cannot_silently_save_other_fields_or_switch_method(self):
        for drift in (True, False):
            with self.subTest(drift=drift):
                pid, a, b = self.pair(drift=drift)
                before = self.physical(pid)
                response = self.client.put(f'/api/projects/{pid}', json={
                    'procurement_method_id': b['id'], 'sync_method_flow': True,
                    'name': '不得部分保存'}, headers=self.headers)
                self.assertEqual(response.status_code, 409, response.json)
                self.assertEqual(response.json['code'], 'METHOD_FLOW_CONFIRMATION_REQUIRED')
                self.assertEqual(self.physical(pid), before)
                self.assertEqual(self.db.session.get(self.Project, pid).name, '新项目')
                self.assertEqual(catalog.project_snapshot(self.db, pid)['method_id'], b['id'] if drift else a['id'])

    def test_different_method_switch_can_preserve_history_after_explicit_preview(self):
        pid, a, b = self.pair(drift=False)
        response = self.commit(pid, b, self.preview(pid, b))
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(catalog.project_snapshot(self.db, pid)['method_id'], b['id'])

    def test_ordinary_same_method_save_still_preserves_custom_or_old_workflow(self):
        pid, a, b = self.pair()
        before = self.physical(pid)
        response = self.client.put(f'/api/projects/{pid}', json={
            'procurement_method_id': b['id'], 'budget': '仅修改资料'}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.physical(pid), before)

    def test_explicit_same_method_flow_sync_does_not_refresh_project_quantity_policy(self):
        pid, a, b = self.pair()
        snapshot = catalog.project_snapshot(self.db, pid)
        catalog.save_method(self.db, dict(quantity_rule=dict(mode='fixed', minimum=7)), b['revision'], 1, b['id'])
        self.db.session.commit()
        response = self.commit(pid, b, self.preview(pid, b))
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json['procurement']['quantity_rule'], snapshot['quantity_rule'])
        self.assertEqual(response.json['procurement']['exceptions'], snapshot['exceptions'])
        self.assertEqual(response.json['procurement']['method_revision'], snapshot['method_revision'])

    def test_unfinished_stage_with_notes_is_still_blocked_and_apply_is_atomic(self):
        pid, a, b = self.pair()
        self.db.session.execute(text("UPDATE stages SET notes='未完成服务费资料' WHERE project_id=:p AND stage_key='fee'"), {'p': pid})
        self.db.session.commit()
        before = self.physical(pid)
        impact = self.preview(pid, b)
        self.assertTrue(impact['blocked'])
        response = self.commit(pid, b, impact, name='不得保存')
        self.assertEqual(response.status_code, 409, response.json)
        self.assertEqual(response.json['code'], 'FLOW_DEPENDENCIES')
        self.assertEqual(self.physical(pid), before)
        self.assertEqual(self.db.session.get(self.Project, pid).name, '新项目')

    def test_changed_stage_or_target_template_invalidates_preview(self):
        for source in ('stage', 'template'):
            with self.subTest(source=source):
                pid, a, b = self.pair()
                impact = self.preview(pid, b)
                if source == 'stage':
                    self.db.session.execute(text("UPDATE stages SET notes='稍后修改' WHERE project_id=:p AND stage_key='result'"), {'p': pid})
                else:
                    catalog.save_method(self.db, dict(name=b['name'], notes='配置已更新'),
                                        b['revision'], 1, b['id'])
                self.db.session.commit()
                before = self.physical(pid)
                response = self.commit(pid, b, impact)
                self.assertEqual(response.status_code, 409, response.json)
                self.assertEqual(response.json['code'], 'FLOW_CHANGED')
                self.assertEqual(self.physical(pid), before)

    def test_returning_to_original_method_reuses_completed_history_ids(self):
        pid, a, b = self.pair()
        before = self.physical(pid)
        self.assertEqual(self.commit(pid, b, self.preview(pid, b)).status_code, 200)
        response = self.commit(pid, a, self.preview(pid, a))
        self.assertEqual(response.status_code, 200, response.json)
        after = self.physical(pid)
        for key in before:
            self.assertEqual(after[key]['id'], before[key]['id'])
            self.assertFalse(after[key]['template_removed'], key)
        self.assertTrue(after['opening']['skipped'])
        self.assertEqual(after['opening']['completed_date'], before['opening']['completed_date'])

    def test_manual_workflow_editor_cannot_use_method_history_bypass(self):
        pid, a, b = self.pair()
        response = self.client.post(f'/api/projects/{pid}/workflow/preview', json={
            'stages': b['stages'], 'preserve_completed_history': True}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertTrue(response.json['blocked'])

    def test_preview_does_not_trust_client_supplied_stages(self):
        pid, a, b = self.pair()
        response = self.client.post(f'/api/projects/{pid}/workflow/preview', json={
            'mode': 'method', 'procurement_method_id': b['id'],
            'stages': [dict(id='forged', name='不应采用', modules=['common'])]}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.json)
        self.assertNotIn('forged', [s['id'] for s in response.json['stages']])

    def test_sync_flag_must_be_a_boolean(self):
        pid, a, b = self.pair()
        response = self.client.put(f'/api/projects/{pid}', json={
            'procurement_method_id': b['id'], 'sync_method_flow': 'false'}, headers=self.headers)
        self.assertEqual(response.status_code, 400, response.json)

    def test_completed_attachment_references_survive_and_other_project_is_unchanged(self):
        pid, a, b = self.pair()
        other = self.create(a, number='OTHER-SYNC').json['id']
        other_before = self.physical(other)
        self.db.session.execute(text('CREATE TABLE attachments(id INTEGER PRIMARY KEY,project_id INTEGER,stage_key TEXT,stored_name TEXT)'))
        self.db.session.execute(text("INSERT INTO attachments VALUES(1,:p,'documents','owned-synthetic.txt')"), {'p': pid})
        self.db.session.commit()
        attachment = self.db.session.execute(text('SELECT * FROM attachments')).all()
        response = self.commit(pid, b, self.preview(pid, b))
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(self.db.session.execute(text('SELECT * FROM attachments')).all(), attachment)
        self.assertEqual(self.physical(other), other_before)

    def test_preview_requires_login_csrf_and_project_access(self):
        pid, a, b = self.pair()
        before = self.physical(pid)
        endpoint = f'/api/projects/{pid}/workflow/preview'
        payload = dict(mode='method', procurement_method_id=b['id'])
        self.assertEqual(self.client.post(endpoint, json=payload).status_code, 403)
        self.app.extensions['deadline_project_access'] = lambda user, project: False
        self.assertEqual(self.client.post(endpoint, json=payload, headers=self.headers).status_code, 403)
        with self.client.session_transaction() as session:
            session.clear()
        self.assertEqual(self.client.post(endpoint, json=payload, headers=self.headers).status_code, 401)
        self.assertEqual(self.physical(pid), before)

    def test_completed_online_history_does_not_enable_online_ui_after_returning_to_normal_method(self):
        pid, a, b = self.pair()
        self.assertEqual(self.commit(pid, b, self.preview(pid, b)).status_code, 200)
        self.db.session.execute(text("UPDATE stages SET completed=1,notes='保留历史报价' WHERE project_id=:p AND stage_key='quotation'"), {'p': pid})
        self.db.session.commit()
        before = self.physical(pid)['quotation']
        response = self.commit(pid, a, self.preview(pid, a))
        self.assertEqual(response.status_code, 200, response.json)
        self.assertFalse(response.json['online_bidding_enabled'])
        after = self.physical(pid)['quotation']
        self.assertTrue(after['template_removed'])
        self.assertEqual(after['id'], before['id'])
        self.assertEqual(after['notes'], before['notes'])
        self.assertTrue(after['completed'])

    def test_completed_custom_online_ledgers_cannot_be_hidden_by_method_sync(self):
        for table in ('online_bidding_ledgers', 'online_bidding_history'):
            with self.subTest(table=table):
                pid, a, b = self.pair()
                self.assertEqual(self.commit(pid, b, self.preview(pid, b)).status_code, 200)
                self.db.session.execute(text("UPDATE stages SET completed=1 WHERE project_id=:p AND stage_key='quotation'"), {'p': pid})
                self.db.session.execute(text(f'CREATE TABLE IF NOT EXISTS {table}(id INTEGER PRIMARY KEY,project_id INTEGER,payload TEXT)'))
                self.db.session.execute(text(f"INSERT INTO {table}(project_id,payload) VALUES(:p,'{{}}')"), {'p': pid})
                self.db.session.commit()
                before = self.physical(pid)
                response = self.commit(pid, a, self.preview(pid, a))
                self.assertEqual(response.status_code, 409, response.json)
                self.assertEqual(response.json['code'], 'FLOW_DEPENDENCIES')
                self.assertEqual(self.physical(pid), before)
                self.assertEqual(catalog.project_snapshot(self.db, pid)['method_id'], b['id'])


if __name__ == '__main__':
    unittest.main()
