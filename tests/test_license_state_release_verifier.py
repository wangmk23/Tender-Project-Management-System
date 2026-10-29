import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class LicenseStateVerifierContract(unittest.TestCase):
    def run_bad_input(self, content=None):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            candidate = root / 'candidate.exe'
            if content is not None:
                candidate.write_bytes(content)
            output = root / 'evidence'
            result = subprocess.run([sys.executable, str(ROOT/'tools/verify_license_states_release.py'),
                '--candidate', str(candidate), '--sha256', '0'*64, '--output', str(output)],
                capture_output=True, text=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue((output/'result.json').is_file(), result.stderr)
            report = json.loads((output/'result.json').read_text(encoding='utf-8'))
            self.assertFalse(report['automation_passed'])
            self.assertFalse(report['native_desktop_verified'])
            self.assertEqual(report['passed'], 0)
            self.assertGreater(report['total'], 0)
            self.assertTrue(any(not check['passed'] for check in report['checks']))
            return report

    def test_missing_candidate_is_required_failure_with_report(self):
        report = self.run_bad_input()
        self.assertIn('Candidate', report['checks'][-1]['detail'])

    def test_hash_mismatch_never_starts_executable_and_is_recorded(self):
        report = self.run_bad_input(b'MZ-synthetic-wrong-hash')
        self.assertIn('hash mismatch', report['checks'][-1]['detail'])


if __name__ == '__main__':
    unittest.main()
