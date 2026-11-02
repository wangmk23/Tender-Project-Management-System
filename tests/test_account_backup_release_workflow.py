"""The v59 gate binds the tested EXEs to immutable public inputs."""
import json
from pathlib import Path
import unittest
from tools import verify_account_backup_release as gate

ROOT=Path(__file__).resolve().parents[1]


class AccountBackupReleaseWorkflowTests(unittest.TestCase):
    def test_candidate_and_upgrade_baseline_are_pinned_independently(self):
        manifest=json.loads((ROOT/'tools/preview_release_manifest_v5.8.59.json').read_text('utf-8'))
        release=json.loads((ROOT/'docs/releases/v5.8.59-public.json').read_text('utf-8'))
        self.assertEqual(manifest['version'],'v5.8.59')
        self.assertEqual(manifest['tag'],'v5.8.59-public')
        self.assertRegex(manifest['product_commit'],r'^[a-f0-9]{40}$')
        for key,name in [('system','procurement-project-manager.exe'),('issuer','license-issuer.exe'),('bound','license-bound.exe')]:
            self.assertEqual(manifest['assets'][key]['sha256'],release['assets'][name])
            self.assertEqual(manifest['assets'][key]['tag'],manifest['tag'])
        self.assertEqual(manifest['assets']['account_baseline']['tag'],'v5.8.58-public')
        self.assertEqual(manifest['assets']['account_baseline']['sha256'],
            '42f4d2999330037a2478598a71d17a3cea847efcb14bf4c9a6f76f186d7179ef')
        self.assertIn('viewer reads preserve business rows',gate.REQUIRED)
        self.assertIn('backup scheduled output',gate.REQUIRED)

    def test_account_gate_is_required_for_full_automated_acceptance(self):
        workflow=(ROOT/'.github/workflows/account-backup-release-windows.yml').read_text('utf-8')
        self.assertIn('runs-on: windows-2025',workflow)
        self.assertIn('--source-commit $m.product_commit',workflow)
        self.assertIn('--baseline-sha256 $m.assets.account_baseline.sha256',workflow)
        self.assertIn("throw 'Required account/backup EXE acceptance failed'",workflow)
        self.assertIn('account_backup=$env:ACCOUNT_BACKUP_OUTCOME',workflow)
        self.assertIn('complete_release_acceptance=$false',workflow)
        self.assertIn('if-no-files-found: error',workflow)


if __name__=='__main__':unittest.main()
