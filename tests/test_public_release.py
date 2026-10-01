import marshal
import types
import unittest
from unittest.mock import Mock, patch
from pathlib import Path
from tools import build_public


class PublicReleaseTests(unittest.TestCase):
    def test_sanitize_nested_core_brand_defaults_and_paths(self):
        code = compile("password = 'hd123456'\nbrand = '旧机构'\ndef nested():\n return ('OLDP-2026-', 'hd-project-manager')", 'C:/Users/private-user/private/app.py', 'exec')
        with patch.dict(build_public.REPLACEMENTS, {'旧机构': '采购项目管理系统', 'OLDP': 'PRJ'}):
            sanitized = build_public.sanitize_code(code, first_party=True)
        scope = {}
        exec(sanitized, scope)
        self.assertEqual(scope['password'], '123456')
        self.assertEqual(scope['brand'], '采购项目管理系统')
        self.assertEqual(scope['nested'](), ('PRJ-2026-', 'procurement-project-manager'))
        self.assertNotIn('private-user', sanitized.co_filename)
        self.assertNotIn('private-user', scope['nested'].__code__.co_filename)

    def test_version_replacement_accepts_already_public_runtime(self):
        from tools.compile_module_patches import BACKEND_VERSION_TARGET, BACKEND_VERSION_TARGETS, replace_exact_version_targets
        source = '\n'.join(f"def {name}():\n return {BACKEND_VERSION_TARGET!r}" for name in BACKEND_VERSION_TARGETS)
        code = compile(source, 'version.py', 'exec')
        updated = replace_exact_version_targets(code)
        namespace = {}
        exec(updated, namespace)
        for name in BACKEND_VERSION_TARGETS:
            self.assertEqual(namespace[name](), BACKEND_VERSION_TARGET)

    def test_current_license_uses_external_public_key_directory(self):
        callback = Mock(return_value={'status': 'valid'})
        namespace = {'LICENSE_REQUIRED': True, 'DATA_DIR': Path('data'), 'verify_license': callback}
        fn = types.FunctionType(build_public.public_license_code(), namespace)
        fn(True)
        callback.assert_called_once_with(Path('data'), Path('data'), update_state=True)

    def test_upstream_strings_remain_attributed(self):
        code = compile("author = 'Upstream contributors'", '/private/build/vendor.py', 'exec')
        sanitized = build_public.sanitize_code(code, first_party=False)
        self.assertIn('Upstream contributors', sanitized.co_consts)

    def test_license_key_path_strips_packaged_static_directory(self):
        code = compile("def verify_license(data_dir, resource_dir, update_state=True):\n return resource_dir / 'static' / 'license_public_key.pem'", 'licensing.py', 'exec')
        patched = build_public.sanitize_code(code, first_party=True, module='licensing')
        namespace = {}
        exec(patched, namespace)
        self.assertEqual(namespace['verify_license'](Path('data'), Path('data')), Path('data/license_public_key.pem'))


if __name__ == '__main__':
    unittest.main()
