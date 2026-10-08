import types
import unittest

from src.backend_patches.business_input_validation import validate_business_input
from tools.compile_module_patches import validated_business_handler, unique_backup_handler
from src.backend_patches.app_replacements import create_full_backup


class BusinessHandlerWrapperTests(unittest.TestCase):
    def make_handler(self, payload, method='PUT', previous=None):
        scope = {'events': [], 'METHODS': ['公开招标'],
                 'request': types.SimpleNamespace(method=method, get_json=lambda **kwargs: payload),
                 'jsonify': lambda result: result}
        exec("def api_update_project(pid):\n    events.append(pid)\n    return ('preserved', pid)\n", scope)
        code = previous or scope['api_update_project'].__code__
        wrapped = validated_business_handler(code, validate_business_input.__code__, 'api_update_project')
        return types.FunctionType(wrapped, scope), scope, wrapped

    def test_valid_data_preserves_original_handler_and_signature(self):
        handler, scope, _ = self.make_handler({'method': '公开招标', 'budget': '1.25'})
        self.assertEqual(handler(7), ('preserved', 7))
        self.assertEqual(scope['events'], [7])

    def test_runtime_without_methods_global_uses_supported_defaults(self):
        handler, scope, _ = self.make_handler({'method': '公开招标'})
        del scope['METHODS']
        self.assertEqual(handler(7), ('preserved', 7))

    def test_invalid_input_never_invokes_original_or_mutates(self):
        for payload in ([], None, {'method': '无效方式'}, {'budget': []}, {'is_terminated': 'false'}):
            with self.subTest(payload=payload):
                handler, scope, _ = self.make_handler(payload)
                self.assertEqual(handler(7)[1], 400)
                self.assertEqual(scope['events'], [])

    def test_repeated_build_keeps_one_validation_layer(self):
        _, _, first = self.make_handler({})
        handler, scope, second = self.make_handler({}, previous=first)
        self.assertEqual(handler(7), ('preserved', 7))
        original = next(code for code in second.co_consts if isinstance(code, types.CodeType) and code.co_name == '_business_impl')
        self.assertNotIn('validated-business-input-v1', original.co_consts)

    def test_delete_keeps_bodyless_original_behavior(self):
        handler, scope, _ = self.make_handler(None, method='DELETE')
        self.assertEqual(handler(7), ('preserved', 7))

    def test_bulk_archive_keeps_unchanged_fields_and_counts(self):
        payload = {'ids': [1], 'has_scan': True, 'has_original': None, 'applicable': None,
                   'transferred': None, 'agency_copies': '', 'purchaser_copies': ''}
        original = dict(payload)
        self.assertIsNone(validate_business_input('api_bulk_update_archive_catalog', payload, []))
        self.assertEqual(payload, original)

    def test_backup_wrapper_preserves_original_once_across_rebuild(self):
        scope = {}
        exec("def create_full_backup():\n    return 'original'\n", scope)
        first = unique_backup_handler(scope['create_full_backup'].__code__, create_full_backup.__code__)
        second = unique_backup_handler(first, create_full_backup.__code__)
        original = next(code for code in second.co_consts if isinstance(code, types.CodeType) and code.co_name == '_original_backup')
        self.assertNotIn('unique-backup-runtime-v1', original.co_consts)
