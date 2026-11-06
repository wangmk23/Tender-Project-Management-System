import unittest
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

if __name__=='__main__':unittest.main()
