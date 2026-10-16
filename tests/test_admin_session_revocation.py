"""Account state is checked for every administrator operation."""
import types
import unittest
from src.backend_patches import app_replacements
from src.backend_patches.business_input_validation import validate_business_input


class AdminSessionRevocationTests(unittest.TestCase):
    def run_guard(self, user, *, path='/api/users', logged_in=True):
        session={'user_id':7,'is_admin':True,'username':'old'} if logged_in else {}
        called=[]
        environment=dict(session=session,request=types.SimpleNamespace(path=path),
                         db=types.SimpleNamespace(session=types.SimpleNamespace(get=lambda *_:user)),
                         User=object,jsonify=lambda value:value,redirect=lambda value:('redirect',value))
        function=getattr(app_replacements,'admin_required',None)
        self.assertIsNotNone(function,'admin routes must independently reject inactive accounts')
        guard=types.FunctionType(function.__code__,environment)
        result=guard(lambda *a,**kw:called.append((a,kw)) or 'allowed')(3,changed=True)
        return result,session,called

    def test_inactive_administrator_is_rejected_before_any_handler_runs(self):
        result,session,called=self.run_guard(types.SimpleNamespace(is_active=False,is_admin=True))
        self.assertEqual(result[1],401)
        self.assertEqual(session,{})
        self.assertEqual(called,[])

    def test_deleted_account_clears_stale_session(self):
        result,session,called=self.run_guard(None)
        self.assertEqual(result[1],401)
        self.assertEqual(session,{})
        self.assertEqual(called,[])

    def test_inactive_page_request_redirects_to_login(self):
        result,session,called=self.run_guard(types.SimpleNamespace(is_active=False,is_admin=True),path='/users')
        self.assertEqual(result,('redirect','/login'))
        self.assertEqual(session,{})
        self.assertEqual(called,[])

    def test_current_nonadmin_is_denied_despite_cached_admin_flag(self):
        result,session,called=self.run_guard(types.SimpleNamespace(is_active=True,is_admin=False,username='reader'))
        self.assertEqual(result[1],403)
        self.assertFalse(session['is_admin'])
        self.assertEqual(called,[])

    def test_active_admin_preserves_handler_arguments_and_refreshes_session(self):
        result,session,called=self.run_guard(types.SimpleNamespace(is_active=True,is_admin=True,username='admin'))
        self.assertEqual(result,'allowed')
        self.assertEqual(called,[((3,),{'changed':True})])
        self.assertEqual(session['username'],'admin')

    def test_anonymous_admin_request_stays_unauthorized(self):
        result,session,called=self.run_guard(None,logged_in=False)
        self.assertEqual(result[1],401)
        self.assertEqual(called,[])


class AccountInputValidationTests(unittest.TestCase):
    def test_user_flags_require_real_booleans(self):
        for endpoint in ('api_create_user','api_update_user'):
            for field in ('is_admin','is_active'):
                for value in ('false','true',0,1,None,[]):
                    with self.subTest(endpoint=endpoint,field=field,value=value):
                        self.assertIsNotNone(validate_business_input(endpoint,{field:value},[]))
            self.assertIsNone(validate_business_input(endpoint,{'is_admin':False,'is_active':True},[]))

    def test_password_and_account_fields_reject_wrong_types_without_server_error(self):
        for endpoint in ('api_create_user','api_update_user','api_reset_password','api_change_password'):
            for field in ('password',) if endpoint!='api_change_password' else ('old_password','new_password'):
                for value in (123456789,True,[],{},None):
                    with self.subTest(endpoint=endpoint,field=field,value=value):
                        self.assertIsNotNone(validate_business_input(endpoint,{field:value},[]))
        for endpoint in ('api_create_user','api_update_user'):
            for field in ('username','display_name'):
                self.assertIsNotNone(validate_business_input(endpoint,{field:123},[]))

    def test_user_updates_reject_array_payload(self):
        for endpoint in ('api_create_user','api_update_user','api_reset_password','api_change_password'):
            self.assertIsNotNone(validate_business_input(endpoint,[],[]))


if __name__=='__main__':
    unittest.main()
