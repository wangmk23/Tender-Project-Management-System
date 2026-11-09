import unittest
import json
import tempfile
from pathlib import Path
from types import SimpleNamespace
from tools import verify_local_files_release as verifier

class VerifierTests(unittest.TestCase):
    def test_missing_checks_cannot_pass(self):
        report=verifier.Report()
        report.check('candidate',lambda:True)
        result=verifier.finalize(report)
        self.assertFalse(result['passed'])
        self.assertIn('restart identity recovery',result['missing_required_checks'])

    def test_fake_inputs_fail_before_launch(self):
        with self.assertRaises((AssertionError,ValueError,FileNotFoundError)):
            verifier.protected_modules('missing.exe','missing.exe')

    def test_no_false_complete_scan(self):
        with self.assertRaises(AssertionError):
            verifier.require_complete_scan({'scan':{'state':'partial','complete':False,'files':10000}},10000)
        verifier.require_complete_scan({'scan':{'state':'complete','complete':True,'files':10000}},10000)

    def test_performance_gate_rejects_slow_sample(self):
        with self.assertRaises(AssertionError):verifier.require_hot_timings({'summary':[301],'entries':[1],'search':[1]})
        verifier.require_hot_timings({'summary':[10],'entries':[20],'search':[30]})

    def test_cli_requires_pinned_inputs(self):
        with self.assertRaises(SystemExit):verifier.parser().parse_args([])

    def test_reference_performance_requires_matching_inputs_and_the_local_target(self):
        args = SimpleNamespace(candidate_sha256='a'*64, baseline_sha256='b'*64,
                               source_commit='c'*40, expected_version='v5.8.64')
        value = dict(vars(args), scope='local Windows reference', target_ms=300, files=10003,
                     environment=dict(system='Windows', platform='recorded Windows version', python='3.12'),
                     hot_timings_ms={name:[246]*5 for name in ('summary','entries','search')})
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary)/'reference.json'
            path.write_text(json.dumps(value))
            valid_hash = verifier.sha256(path)
            self.assertEqual(verifier.reference_performance(path, valid_hash, args), value)
            with self.assertRaises(AssertionError):
                verifier.reference_performance(path, 'd'*64, args)
            with self.assertRaises(AssertionError):
                verifier.reference_performance(path, valid_hash, SimpleNamespace(**{**vars(args), 'candidate_sha256':'e'*64}))
            value['hot_timings_ms']['search'][0] = 301
            path.write_text(json.dumps(value))
            with self.assertRaises(AssertionError):
                verifier.reference_performance(path, verifier.sha256(path), args)

    def test_hosted_timings_must_be_recorded_and_reference_still_cannot_be_missing(self):
        for sample in (float('nan'), -1, 0, True):
            with self.subTest(sample=sample), self.assertRaises(AssertionError):
                verifier.validate_timing_samples(dict(summary=[sample]*5, entries=[1]*5, search=[1]*5))
        report = verifier.Report()
        for check in verifier.REQUIRED - {'hot cache performance'}:
            report.check(check, lambda: True)
        report.check('hosted timing measurements', lambda: True)
        result = verifier.finalize(report, (verifier.REQUIRED - {'hot cache performance'}) |
                                   {'hosted timing measurements', 'reference performance'})
        self.assertFalse(result['passed'])
        self.assertIn('reference performance', result['missing_required_checks'])

if __name__=='__main__':unittest.main()
