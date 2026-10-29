"""Release report gates must fail closed; real EXE scenarios run via the CLI."""
import unittest

from pathlib import Path
import tempfile
import subprocess
import sys

from tools.verify_packaged_browser_acceptance import totals, validated_profile, legacy52_payloads


class PackagedBrowserReportTests(unittest.TestCase):
    def test_empty_matrix_cannot_report_pass(self):
        self.assertEqual(totals([])['status'], 'failed')

    def test_one_failed_gate_keeps_overall_report_failed(self):
        report = totals([{'name': 'database loaded', 'passed': True},
                         {'name': 'three second requirement', 'passed': False}])
        self.assertEqual(report, {'passed': 1, 'total': 2,
            'failed': ['three second requirement'], 'status': 'failed'})

    def test_completed_nonempty_matrix_passes_only_when_every_gate_passes(self):
        self.assertEqual(totals([{'name': 'all checked', 'passed': True}])['status'], 'passed')

    def test_retained_profile_cannot_target_arbitrary_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'dedicated profile'):
                validated_profile(Path(directory))

    def test_legacy52_replay_omits_new_token_and_keeps_old_save_fields(self):
        project, stage = legacy52_payloads({'number': 'test', 'name': 'test', 'method': '公开招标',
            'record_version': 'new-client-token', 'stages': [{'record_version': 'new-stage-token'}]})
        self.assertNotIn('record_version', project)
        self.assertNotIn('record_version', stage)
        self.assertEqual(set(stage), {'completed', 'planned_at', 'skipped', 'notes', 'completed_date', 'completed_at'})
        self.assertNotIn('second_tender_id', project)

    def test_report_helpers_import_without_optional_playwright(self):
        program = '''
import importlib.abc, sys
class RejectPlaywright(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path, target=None):
        if fullname == "playwright" or fullname.startswith("playwright."):
            raise ModuleNotFoundError("Playwright deliberately unavailable")
sys.meta_path.insert(0, RejectPlaywright())
from tools.verify_packaged_browser_acceptance import totals
assert totals([{"name": "source-only", "passed": True}])["status"] == "passed"
'''
        from tools.verify_packaged_browser_acceptance import ROOT
        completed = subprocess.run([sys.executable, '-c', program], cwd=ROOT, capture_output=True, text=True, timeout=30)
        self.assertEqual(completed.returncode, 0, completed.stderr)


if __name__ == '__main__':
    unittest.main()
