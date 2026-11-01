"""Fail-closed contracts for the hash-pinned procurement correction EXE gate."""
import contextlib
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from tools import verify_method_correction_release as gate


class MethodCorrectionReleaseVerifierTests(unittest.TestCase):
    def test_cli_requires_candidate_hash_and_evidence(self):
        for arguments in ([], ['--candidate','missing.exe'],
                          ['--candidate','missing.exe','--candidate-sha256','a'*64]):
            with self.subTest(arguments=arguments), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit) as raised:
                gate.parser().parse_args(arguments)
            self.assertEqual(raised.exception.code,2)

    def test_malformed_candidate_digest_is_rejected_before_startup(self):
        for digest in ('','a'*63,'g'*64):
            with self.subTest(digest=digest),self.assertRaisesRegex(ValueError,'64'):
                gate.validate_candidate(Path('missing.exe'),digest)

    def test_hash_mismatch_writes_failure_and_never_starts_runtime(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);candidate=root/'not-real.exe';candidate.write_bytes(b'never execute this file')
            arguments=gate.parser().parse_args(['--candidate',str(candidate),'--candidate-sha256','a'*64,
                                               '--evidence',str(root/'evidence')])
            with patch('tools.release_browser.sys.platform','win32'),patch('tools.verify_packaged_browser_acceptance.owned_client') as startup:
                result=gate.run(arguments)
            startup.assert_not_called()
            self.assertFalse(result['passed']);self.assertIn('hash mismatch',result['error'])
            self.assertIn('round trip',result['missing_required_checks'])
            self.assertFalse(json.loads((arguments.evidence/'method-correction-exe-acceptance.json').read_text('utf-8'))['passed'])

    def test_missing_required_gate_cannot_report_complete_acceptance(self):
        report=gate.Report();report.check('candidate',lambda:True)
        result=report.result()
        self.assertFalse(result['passed']);self.assertIn('same-name conflict',result['missing_required_checks'])
        self.assertFalse(result['native_desktop_verified']);self.assertFalse(result['browser_ui_verified'])
        for name in gate.REQUIRED_CHECKS-{'candidate'}:report.check(name,lambda:True)
        self.assertTrue(report.result()['passed'])

    def test_owned_database_path_requires_exact_profile_and_rejects_symlink(self):
        with tempfile.TemporaryDirectory() as temp,tempfile.TemporaryDirectory() as other:
            root=Path(temp);data=root/'data';data.mkdir();db=data/'bidding.db';key=data/'data_key.dpapi'
            db.write_bytes(b'owned');key.write_bytes(b'owned')
            self.assertEqual(gate.owned_database_paths(data,root),(db.resolve(),key.resolve()))
            outside=Path(other)
            with self.assertRaises(ValueError):gate.owned_database_paths(outside,root)
            with patch.object(Path,'is_symlink',return_value=True),self.assertRaises(ValueError):
                gate.owned_database_paths(data,root)

    def test_dependency_rejection_requires_409_code_and_unchanged_physical_rows(self):
        snapshot={'project':{'id':1,'method_id':'A'},'stages':[{'id':2,'notes':'kept'}]}
        gate.validate_rejection(409,{'code':'FLOW_DEPENDENCIES'},snapshot,snapshot)
        for status,body,after in ((200,{'code':'FLOW_DEPENDENCIES'},snapshot),
                                  (409,{'code':'RECORD_VERSION_CONFLICT'},snapshot),
                                  (409,{'code':'FLOW_DEPENDENCIES'},{'project':{'id':1,'method_id':'B'}})):
            with self.subTest(status=status,body=body,after=after),self.assertRaises(AssertionError):
                gate.validate_rejection(status,body,snapshot,after)

    def test_roundtrip_rejects_recreated_ids_or_changed_shared_records(self):
        original={'shared':{'id':1,'stage_key':'shared','completed':1,'notes':'kept','stage_position':0,'template_removed':0},
                  'old':{'id':2,'stage_key':'old','completed':0,'notes':'','stage_position':1,'template_removed':0}}
        restored={**original,'new':{'id':3,'stage_key':'new','template_removed':1}}
        gate.validate_roundtrip(original,restored,['shared','old'])
        for key,field,value in (('old','id',9),('shared','notes','lost'),('old','template_removed',1)):
            altered={k:dict(v) for k,v in restored.items()};altered[key][field]=value
            with self.subTest(key=key,field=field),self.assertRaises(AssertionError):
                gate.validate_roundtrip(original,altered,['shared','old'])

    def test_auto_skip_result_distinguishes_unchanged_and_manually_edited_stages(self):
        gate.validate_skip_transition({'restored':['refund'],'preserved':[]},{'completed':False,'skipped':False,'notes':''},False)
        gate.validate_skip_transition({'restored':[],'preserved':['refund']},{'completed':True,'skipped':True,'notes':'manual'},True)
        for manual in (False,True):
            with self.subTest(manual=manual),self.assertRaises(AssertionError):
                gate.validate_skip_transition({'restored':[],'preserved':[]},{'completed':True,'skipped':True,'notes':'manual'},manual)

    def test_roundtrip_allows_json_spacing_only_and_rejects_changed_module_values(self):
        original={'old':{'id':2,'stage_key':'old','template_removed':0,'stage_position':0,
                         'modules_json':'["common", "checklist"]','notes':'original'}}
        reformatted={'old':dict(original['old'],modules_json='["common","checklist"]')}
        self.assertEqual(gate.validate_roundtrip(original,reformatted,['old']),['old.modules_json'])
        changed={'old':dict(original['old'],modules_json='["common","archive"]')}
        with self.assertRaises(AssertionError):gate.validate_roundtrip(original,changed,['old'])


if __name__=='__main__':unittest.main()
