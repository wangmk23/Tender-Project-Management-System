"""Fail-closed contracts for actual EXE method-flow synchronization acceptance."""
import contextlib
import copy
import io
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from tools import verify_method_flow_sync_release as gate


class MethodFlowSyncReleaseVerifierTests(unittest.TestCase):
    def arguments(self, root):
        return ['--baseline', str(root/'baseline.exe'), '--baseline-sha256', 'a'*64,
                '--candidate', str(root/'candidate.exe'), '--candidate-sha256', 'b'*64,
                '--expected-version', 'v5.8.58', '--evidence', str(root/'evidence')]

    def test_cli_requires_every_pinned_input_and_explicit_version(self):
        args = self.arguments(Path('owned'))
        for i in range(0, len(args), 2):
            with self.subTest(omitted=args[i]), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as error:
                gate.parser().parse_args(args[:i]+args[i+2:])
            self.assertEqual(error.exception.code, 2)
        self.assertEqual(gate.parser().parse_args(args).expected_version, 'v5.8.58')

    def test_malformed_digest_is_rejected_before_windows_or_file_access(self):
        for digest in ('', 'a'*63, 'g'*64, None):
            with self.subTest(digest=digest), self.assertRaisesRegex(ValueError, '64'):
                gate.validate_executable(Path('missing.exe'), digest)

    def test_non_windows_cannot_pass_even_with_matching_file_hash(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)/'fake.exe'; path.write_bytes(b'not executable')
            with patch('tools.release_browser.sys.platform', 'linux'), self.assertRaisesRegex(RuntimeError, 'Windows'):
                gate.validate_executable(path, gate.sha256(path))

    def test_hash_failure_writes_evidence_without_starting_owned_runtime(self):
        for failed in ('baseline', 'candidate'):
            with self.subTest(failed=failed), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                for name in ('baseline', 'candidate'): (root/(name+'.exe')).write_bytes(name.encode())
                args = gate.parser().parse_args(self.arguments(root))
                args.baseline_sha256 = gate.sha256(args.baseline)
                args.candidate_sha256 = gate.sha256(args.candidate)
                setattr(args, failed+'_sha256', '0'*64)
                with patch('tools.release_browser.sys.platform', 'win32'), patch('tools.verify_packaged_browser_acceptance.owned_client') as owned:
                    result = gate.run(args)
                owned.assert_not_called()
                self.assertFalse(result['passed'])
                self.assertIn('hash mismatch', result['error'])
                self.assertIn('UI confirm', result['missing_required_checks'])
                saved = json.loads((args.evidence/gate.REPORT_NAME).read_text('utf-8'))
                self.assertFalse(saved['passed'])
                self.assertEqual(saved['candidate_sha256'], args.candidate_sha256)
                self.assertEqual(saved['baseline_sha256'], args.baseline_sha256)

    def test_every_required_gate_must_be_present_and_passed(self):
        for omitted in gate.REQUIRED_CHECKS:
            with self.subTest(omitted=omitted):
                report = gate.Report()
                for name in gate.REQUIRED_CHECKS-{omitted}: report.check(name, lambda: {})
                result = report.result()
                self.assertFalse(result['passed'])
                self.assertEqual(result['missing_required_checks'], [omitted])
                self.assertEqual(next(x for x in result['required_gates'] if x['name']==omitted)['status'], 'missing')

    def test_failed_or_interrupted_gate_cannot_be_hidden_by_success(self):
        report = gate.Report()
        for name in gate.REQUIRED_CHECKS: report.check(name, lambda: {})
        self.assertTrue(report.result()['passed'])
        report.checks.append({'name': 'UI confirm', 'passed': False})
        self.assertFalse(report.result()['passed'])
        report.checks.pop(); report.metadata['error'] = 'interrupted after browser'
        result = report.result()
        self.assertFalse(result['passed'])
        for key in ('native_desktop_verified', 'actual_phone_verified', 'physical_print_verified', 'external_web_verified'):
            self.assertFalse(result[key])

    def fixture(self):
        before = {
            'shared': dict(id=1, stage_key='shared', name='Shared', icon='A', modules_json='["common", "checklist"]',
                           completed=1, skipped=0, completed_date='2026-10-20', completed_at='2026-10-20T09:15',
                           planned_datetime='2026-10-19T09:15', notes='original', template_removed=0, stage_position=0),
            'bid_opening': dict(id=2, stage_key='bid_opening', name='Opening', completed=1, skipped=1,
                                completed_date='2026-10-21', notes='manual', template_removed=0, stage_position=1),
            'evaluation': dict(id=3, stage_key='evaluation', name='Evaluation', completed=1, skipped=1,
                               completed_date='2026-10-21', notes='manual', template_removed=0, stage_position=2),
        }
        after = copy.deepcopy(before)
        for key in ('bid_opening', 'evaluation'): after[key]['template_removed'] = 1
        after['online_documents'] = dict(id=4, stage_key='online_documents', completed=0, skipped=0,
                                         completed_at=None, completed_date=None, template_removed=0, stage_position=1)
        return before, after

    def test_history_keeps_physical_ids_business_fields_and_manual_skips(self):
        before, after = self.fixture()
        gate.validate_history(before, after, ['shared', 'online_documents'])
        for key, field, value in (('shared','id',999), ('shared','modules_json','["archive"]'),
                                  ('shared','planned_datetime',None), ('shared','notes','lost'),
                                  ('bid_opening','skipped',0), ('evaluation','completed_date',None),
                                  ('evaluation','template_removed',0)):
            damaged = copy.deepcopy(after); damaged[key][field] = value
            with self.subTest(key=key, field=field), self.assertRaises(AssertionError):
                gate.validate_history(before, damaged, ['shared','online_documents'])

    def test_new_target_stages_are_pending_and_original_rows_are_never_deleted(self):
        before, after = self.fixture()
        for field, value in (('completed',1), ('skipped',1), ('completed_date','2026-10-20'), ('completed_at','2026-10-20T09:15')):
            damaged=copy.deepcopy(after); damaged['online_documents'][field]=value
            with self.subTest(field=field), self.assertRaises(AssertionError):
                gate.validate_history(before, damaged, ['shared','online_documents'])
        del after['evaluation']
        with self.assertRaises(AssertionError): gate.validate_history(before, after, ['shared','online_documents'])

    def test_stage_module_json_spacing_and_new_positions_do_not_change_business_facts(self):
        before, after = self.fixture()
        after['shared']['modules_json']='["common","checklist"]'
        after['shared']['stage_position']=7
        gate.validate_history(before, after, ['shared','online_documents'])

    def test_conflict_requires_exact_409_code_and_unchanged_snapshot(self):
        before={'stages':[{'id':1,'notes':'current'}]}
        gate.validate_conflict(409, {'code':'FLOW_CHANGED'}, before, before, 'FLOW_CHANGED')
        for status, body, after in ((200, {'code':'FLOW_CHANGED'}, before),
                                    (409, {'code':'RECORD_VERSION_CONFLICT'}, before),
                                    (409, {'code':'FLOW_CHANGED'}, {'stages':[]})):
            with self.subTest(status=status, body=body), self.assertRaises(AssertionError):
                gate.validate_conflict(status, body, before, after, 'FLOW_CHANGED')

    def test_cancel_requires_real_preview_no_project_put_and_no_data_change(self):
        trace=[{'method':'POST','path':'/api/projects/1/workflow/preview','status':200}]
        state={'id':1,'name':'saved'}
        gate.validate_cancel(trace, 1, state, state)
        for invalid, after in (([],state), (trace+[{'method':'PUT','path':'/api/projects/1','status':200}],state), (trace,{})):
            with self.subTest(trace=invalid, after=after), self.assertRaises(AssertionError):
                gate.validate_cancel(invalid, 1, state, after)

    def test_entrypoint_failure_returns_nonzero(self):
        with patch.object(gate, 'run', return_value={'passed':False}), patch('builtins.print'):
            self.assertEqual(gate.main(self.arguments(Path('owned'))), 1)

    def test_wrong_expected_version_fails_before_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            args=gate.parser().parse_args(self.arguments(Path(temp)))
            args.expected_version='v5.8.54'
            with patch('tools.verify_packaged_browser_acceptance.owned_client') as owned:
                result=gate.run(args)
            owned.assert_not_called()
            self.assertFalse(result['passed'])
            self.assertIn('v5.8.58',result['error'])

    def identity_client(self, root, external=False):
        client=SimpleNamespace(data_root=root)
        (root/'license.dat').write_bytes(b'synthetic-license')
        (root/'data_key.dpapi').write_bytes(b'synthetic-protected-key')
        if external: (root/'license_public_key.pem').write_bytes(b'synthetic-public-key')
        return client

    def test_optional_external_public_key_records_absence_and_detects_later_override(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);client=self.identity_client(root)
            original=gate.original_files(client)
            self.assertIsNone(original['license_public_key.pem'])
            self.assertEqual(original['public_key_source'],'pinned-executable-embedded')
            self.assertFalse((root/'license_public_key.pem').exists())
            self.assertEqual(gate.original_files(client),original)
            (root/'license_public_key.pem').write_bytes(b'new-override')
            self.assertNotEqual(gate.original_files(client),original)

    def test_external_public_key_hash_changes_or_removal_cannot_pass_identity_check(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);client=self.identity_client(root,external=True)
            original=gate.original_files(client)
            self.assertEqual(original['public_key_source'],'profile-file')
            self.assertEqual(original['license_public_key.pem'],gate.sha256(root/'license_public_key.pem'))
            (root/'license_public_key.pem').write_bytes(b'changed-key')
            self.assertNotEqual(gate.original_files(client),original)
            (root/'license_public_key.pem').unlink()
            self.assertNotEqual(gate.original_files(client),original)

    def test_license_and_data_key_remain_required_with_embedded_public_key(self):
        for missing in ('license.dat','data_key.dpapi'):
            with self.subTest(missing=missing),tempfile.TemporaryDirectory() as temp:
                root=Path(temp);client=self.identity_client(root)
                (root/missing).unlink()
                with self.assertRaises(FileNotFoundError):gate.original_files(client)

    def test_candidate_connectors_use_distinct_owned_directories_and_exact_exes(self):
        loads=[]
        def load(executable,directory):
            self.assertTrue(directory.is_dir())
            loads.append((executable,directory))
            return {'dll_handle':Mock()}
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);data=root/'data';data.mkdir()
            (data/'bidding.db').write_bytes(b'synthetic-ciphertext')
            (data/'data_key.dpapi').write_bytes(b'synthetic-protected-key')
            with patch('tools.benchmark_system._load_candidate_sqlcipher',side_effect=load),patch('src.backend_patches.signed_attachments._dpapi_transform',return_value=b'k'*32):
                first=gate.OwnedDatabase(root/'old.exe',data,root)
                second=gate.OwnedDatabase(root/'new.exe',data,root)
            self.assertEqual([r[0] for r in loads],[root/'old.exe',root/'new.exe'])
            self.assertNotEqual(loads[0][1],loads[1][1])
            self.assertTrue(all(directory.is_relative_to(root) for _,directory in loads))
            first.close();second.close()

    def test_connector_still_rejects_database_outside_owned_root_before_loading(self):
        with tempfile.TemporaryDirectory() as temp,tempfile.TemporaryDirectory() as other:
            root=Path(temp);data=Path(other)
            (data/'bidding.db').write_bytes(b'other')
            (data/'data_key.dpapi').write_bytes(b'other')
            with patch('tools.benchmark_system._load_candidate_sqlcipher') as loader,self.assertRaises(ValueError):
                gate.OwnedDatabase(root/'candidate.exe',data,root)
            loader.assert_not_called()

    def test_startup_failure_uses_dynamic_owned_adapter_and_uncreated_profile(self):
        observed=[]
        @contextlib.contextmanager
        def owned(candidate, root, label, retained_profile=None):
            observed.append(retained_profile)
            self.assertFalse(retained_profile.exists())
            def fail(): raise RuntimeError('synthetic startup failed')
            yield SimpleNamespace(start=fail,root=root/label)
        with tempfile.TemporaryDirectory() as temp:
            args=gate.parser().parse_args(self.arguments(Path(temp)))
            with patch.object(gate,'validate_executable',return_value='verified'), patch('tools.verify_packaged_browser_acceptance.owned_client',owned):
                result=gate.run(args)
            self.assertEqual(len(observed),1)
            self.assertFalse(result['passed'])
            self.assertIn('synthetic startup failed',result['error'])
            self.assertEqual(next(r for r in result['required_gates'] if r['name']=='baseline startup')['status'],'failed')
            self.assertTrue((args.evidence/'browser-console.json').is_file())


if __name__ == '__main__': unittest.main()
