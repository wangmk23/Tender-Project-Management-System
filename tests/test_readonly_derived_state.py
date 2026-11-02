"""A viewer may calculate derived status without persisting business changes."""
import unittest
from types import SimpleNamespace as NS
from unittest.mock import Mock, patch
from flask import Flask
from src.backend_patches import account_permissions as access, tender_guarantee as tg, business_deadlines as bd


class ReadonlyDerivedStateTests(unittest.TestCase):
    def setUp(self):
        self.app=Flask(__name__)
        self.app.extensions['account_permissions']={}
        self.project=NS(id=1,method='公开招标',stages=[],registrations=[],lots=[],no_deposit=True)

    def test_guarantee_get_does_not_enroll_policy_or_update_derived_ledger_for_viewer(self):
        for allowed in (False,True):
            with self.subTest(allowed=allowed), self.app.test_request_context('/api/projects/1'), \
                    patch.object(access,'request_can',return_value=allowed), \
                    patch.object(tg,'_load',return_value=(1,{'records':[],'rules':[],'confirmed':False},'', [{'registration_id':99}])), \
                    patch.object(tg,'_execute',return_value=Mock(first=lambda:None)) as execute:
                result=tg.get_payload(None,self.project,include_mail=False)
                self.assertEqual(result['items'],[])
                writes=[call.args[1] for call in execute.call_args_list if call.args[1].startswith(('INSERT','UPDATE','DELETE'))]
                self.assertEqual(bool(writes),allowed)
                if allowed:
                    self.assertTrue(any(sql.startswith('INSERT') for sql in writes))
                    self.assertTrue(any(sql.startswith('UPDATE') for sql in writes))

    def test_deadline_get_does_not_save_or_audit_review_refresh_for_viewer(self):
        for allowed in (False,True):
            item={'id':'item','project_id':1,'revision':1,'state':'confirmed','seen_fingerprint':'old',
                  'confirmed_deadline':'2026-11-03','needs_review':False}
            with self.subTest(allowed=allowed),self.app.test_request_context('/api/projects/1/deadlines'), \
                    patch.object(access,'request_can',return_value=allowed), \
                    patch.object(bd,'_rows',return_value=[item]), \
                    patch.object(bd,'_fresh',return_value=({'start_at':'2026-11-01'}, {'deadline':'2026-11-05'}, 'new')), \
                    patch.object(bd,'_public',side_effect=lambda value,now:value), \
                    patch.object(bd,'_save') as save,patch.object(bd,'_audit') as audit:
                result=bd.list_items(None,self.project)
                self.assertTrue(result[0]['needs_review'])
                self.assertEqual(save.called,allowed)
                self.assertEqual(audit.called,allowed)


if __name__=='__main__':unittest.main()
