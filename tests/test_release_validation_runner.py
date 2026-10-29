import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import release_validation as validation


class ReleaseValidationRunnerTests(unittest.TestCase):
    def test_unpublished_tag_override_is_only_allowed_for_preflight(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            code = validation.main(['--product-root', str(root), '--inputs-dir', str(root / 'inputs'),
                                    '--output', str(root / 'output'), '--allow-unpublished-tag'])
            self.assertEqual(code, 1)
            report = json.loads((root / 'output/release-validation.json').read_text('utf-8'))
            self.assertIn('preflight', ' '.join(report['errors']))
            self.assertFalse(report['automated_acceptance_passed'])

    def test_harness_must_match_immutable_commit_and_be_clean(self):
        expected = '3e40617236e8ec892c3e60fb85f34dcc7eabc979'
        with patch.object(validation, 'git_value', side_effect=['0' * 40]):
            with self.assertRaisesRegex(ValueError, 'harness.*commit'):
                validation.verify_test_harness(Path('.'), expected)
        with patch.object(validation, 'git_value', side_effect=[expected, ' M tests/test_fake.py']):
            with self.assertRaisesRegex(ValueError, 'harness.*modifications'):
                validation.verify_test_harness(Path('.'), expected)
        with patch.object(validation, 'git_value', side_effect=[expected, '']):
            self.assertEqual(validation.verify_test_harness(Path('.'), expected), expected)

    def test_release_selection_pins_product_and_asset_hashes_for_both_versions(self):
        for tag, path in (('v5.8.53-public', 'release_validation_manifest.json'),
                          ('v5.8.54-public', 'release_validation_manifest_v5.8.54.json')):
            manifest = json.loads((validation.ROOT / 'tools' / path).read_text('utf-8'))
            self.assertEqual(validation.validate_manifest(manifest)['product_tag'], tag)
            manifest['assets']['system']['sha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'pinned asset'):
                validation.validate_manifest(manifest)

    def test_timeout_partial_logs_keep_bytes_text_and_empty_streams(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            validation.preserve_process_output(root, 'hung', 'before timeout'.encode(), b'\xff failure')
            self.assertEqual((root/'hung.stdout.txt').read_text('utf-8'), 'before timeout')
            self.assertIn('failure', (root/'hung.stderr.txt').read_text('utf-8'))
            validation.preserve_process_output(root, 'empty', None, '')
            self.assertEqual((root/'empty.stdout.txt').read_bytes(), b'')

    def test_missing_required_input_fails_before_any_suite(self):
        with tempfile.TemporaryDirectory() as directory:
            manifest = {'assets': {'system': {'filename': 'missing.exe', 'sha256': '0' * 64}}}
            with self.assertRaisesRegex(ValueError, 'missing required input'):
                validation.verify_inputs(manifest, Path(directory))

    def test_wrong_hash_and_unexpected_private_inputs_fail(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'system.exe').write_bytes(b'public asset')
            manifest = {'assets': {'system': {'filename': 'system.exe', 'sha256': '0' * 64}}}
            with self.assertRaisesRegex(ValueError, 'SHA-256 mismatch'):
                validation.verify_inputs(manifest, root)
            manifest['assets']['system']['sha256'] = hashlib.sha256(b'public asset').hexdigest()
            (root / 'license_private_key.pem').write_bytes(b'never-upload')
            with self.assertRaisesRegex(ValueError, 'unexpected input'):
                validation.verify_inputs(manifest, root)

    def test_exit_code_cannot_be_overruled_by_json_pass(self):
        self.assertFalse(validation.validate_suite_result(1, {'status': 'passed', 'checks': [True]})[0])

    def test_false_zero_empty_pending_and_skipped_cannot_claim_pass(self):
        for result in ({'status': 'passed', 'failures': 1},
                       {'status': 'passed', 'checks': []},
                       {'status': 'passed', 'checks': [{'ok': False}]},
                       {'status': 'passed', 'checks': [{'status': 'failed'}]},
                       {'status': 'passed', 'checks': [True], 'outcomes': [{'outcome': 'skipped'}]},
                       {'status': 'manual_pending', 'checks': [True]},
                       {'status': 'passed', 'skipped': 1, 'checks': [True]},
                       {'status': 'passed', 'checks': [True], 'mode': 'observe'},
                       {'status': 'passed', 'checks': [True], 'selected_test_ids': ['one']},
                       {'status': 'passed', 'checks': [True], 'completed': False},
                       {'status': 'passed', 'checks': [True], 'test_harness_changed_during_run': True},
                       {'status': 'passed', 'checks': [True], 'total': 4}):
            with self.subTest(result=result):
                self.assertFalse(validation.validate_suite_result(0, result)[0])

    def test_real_checks_with_zero_failures_pass_and_scoped_optional_skips_allowed(self):
        self.assertTrue(validation.validate_suite_result(0, {
            'status': 'passed', 'checks': [{'ok': True}], 'failures': 0})[0])
        self.assertTrue(validation.validate_suite_result(0, {
            'status': 'passed', 'checks': [{'passed': True}], 'native_desktop_verified': False})[0])
        self.assertTrue(validation.validate_suite_result(0, {
            'status': 'passed', 'tests_run': 4, 'failures': 0,
            'skipped': [{'id': 'test_build_input.BuildInputTests.test_symlink_input_is_rejected',
                         'reason': 'symlink creation is not permitted',
                         'classification': 'optional', 'status': 'skipped'}]})[0])
        self.assertFalse(validation.validate_suite_result(0, {
            'status': 'passed', 'tests_run': 4,
            'skipped': [{'id': 'unknown.test', 'reason': 'unknown', 'classification': 'optional'}]})[0])

    def test_unknown_skip_is_required_and_optional_policy_is_exact(self):
        from tools.audit_release_skips import classify_skip
        self.assertEqual(classify_skip('unknown.test', 'new skip')['classification'], 'required')
        self.assertEqual(classify_skip(
            'test_build_input.BuildInputTests.test_symlink_input_is_rejected',
            'symlink creation is not permitted')['classification'], 'optional')
        self.assertEqual(classify_skip(
            'test_build_input.BuildInputTests.test_symlink_input_is_rejected',
            'unexpected missing dependency')['classification'], 'required')

    def test_suite_list_must_include_every_mandatory_domain(self):
        with self.assertRaisesRegex(ValueError, 'mandatory suites'):
            validation.validate_suite_plan([{'id': 'one', 'command': ['echo'], 'report': 'one.json'}])

    def test_product_source_identity_rejects_a_modified_harness_business_file(self):
        from tools.audit_release_skips import verify_source_identity
        with tempfile.TemporaryDirectory() as folder:
            product = Path(folder) / 'product'
            harness = Path(folder) / 'harness'
            for root in (product, harness):
                (root / 'source').mkdir(parents=True)
                (root / 'source/business.js').write_bytes(b'original business')
            identity = verify_source_identity(product, harness, ['source/business.js'])
            self.assertEqual(identity['compared_files'], 1)
            (harness / 'source/business.js').write_bytes(b'changed business')
            with self.assertRaisesRegex(ValueError, 'product source differs'):
                verify_source_identity(product, harness, ['source/business.js'])


if __name__ == '__main__':
    unittest.main()
