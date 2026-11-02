"""Contracts for the hash-pinned Windows preview acceptance workflow.

These inspect release configuration and the real gate parser; they do not claim
that any frozen executable, native desktop or external network was tested.
"""
import json
from pathlib import Path
import re
import shlex
import unittest

from tools import verify_method_flow_sync_release as sync_gate


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / '.github/workflows/preview-release-windows.yml'
MANIFEST = ROOT / 'tools/preview_release_manifest_v5.8.58.json'


def step(text, name):
    """Read one named step without adding a YAML dependency to source tests."""
    marker = '      - name: ' + name + '\n'
    start = text.find(marker)
    if start < 0:
        raise AssertionError('Missing required workflow step: ' + name)
    start += len(marker)
    following = re.search(r'^      - ', text[start:], re.M)
    return text[start:start + following.start()] if following else text[start:]


class PreviewReleaseWorkflowTests(unittest.TestCase):
    def test_v58_manifest_has_all_fixed_public_inputs_including_old54(self):
        self.assertTrue(MANIFEST.is_file(), 'The v5.8.58 input manifest is required')
        manifest = json.loads(MANIFEST.read_text('utf-8'))
        self.assertEqual(manifest['version'], 'v5.8.58')
        self.assertEqual(manifest['tag'], 'v5.8.58-public')
        self.assertIs(manifest['public_inputs_only'], True)
        self.assertEqual(manifest['repository'], 'wangmk23/Tender-Project-Management-System')
        expected = {
            'system': ('v5.8.58-public', '49a70e5ca361885356a9c331d4792c59a1183f4129723284a9bb01a611728466'),
            'issuer': ('v5.8.58-public', '21a13ec1604a5e4d40d11124a2863c2ef0ce5629e1bf3c9612b694494c01ac0f'),
            'bound': ('v5.8.58-public', '51186a1dc7075ce2c5a338b5af45074b3db017756621b68c241e00e9707ade09'),
            'baseline': ('v5.8.40-public', '62f9f93083d6039f50198021886c01a1fbce49b16b5edd7fc5e7c3669721787a'),
            'method_sync_baseline': ('v5.8.54-public', '116e0ba128ded0a2232d708442488a76af52b5d0ec332a98009905d5568957c6'),
        }
        self.assertEqual(set(manifest['assets']), set(expected))
        for name, (tag, digest) in expected.items():
            with self.subTest(asset=name):
                self.assertEqual(manifest['assets'][name]['tag'], tag)
                self.assertEqual(manifest['assets'][name]['sha256'], digest)
                self.assertRegex(manifest['assets'][name]['sha256'], r'^[0-9a-f]{64}$')
        self.assertEqual(manifest['assets']['method_sync_baseline']['name'], 'procurement-project-manager.exe')

    def test_missing_product_commit_and_required_asset_cannot_pass_preflight(self):
        inputs = step(WORKFLOW.read_text('utf-8'), 'Read fixed release inputs')
        self.assertIn('preview_release_manifest_v5.8.58.json', inputs)
        self.assertIn("$manifest.product_commit -notmatch '^[0-9a-f]{40}$'", inputs)
        self.assertIn("$manifest.version -ne 'v5.8.58'", inputs)
        self.assertIn("$manifest.tag -ne 'v5.8.58-public'", inputs)
        self.assertIn('method_sync_baseline', inputs)
        self.assertIn('Missing required asset input', inputs)
        self.assertIn('Missing fixed asset hash', inputs)
        self.assertIn("throw 'Invalid fixed product/tag'", inputs)

    def test_asset_download_verifies_the_tag_commit_and_every_asset_digest(self):
        download = step(WORKFLOW.read_text('utf-8'), 'Download and verify fixed public assets')
        self.assertIn('gh api "repos/$($manifest.repository)/commits/$($manifest.tag)" --jq .sha', download)
        self.assertIn('$tagCommit -ne $manifest.product_commit', download)
        self.assertIn('foreach ($property in $manifest.assets.PSObject.Properties)', download)
        self.assertIn('Get-FileHash "assets/$($property.Name).exe" -Algorithm SHA256', download)
        self.assertIn('$actual -ne $asset.sha256', download)
        self.assertIn('throw "Missing required asset:', download)
        self.assertIn('throw "Asset hash mismatch:', download)

    def test_method_sync_command_matches_the_real_required_cli_and_fails_closed(self):
        sync = step(WORKFLOW.read_text('utf-8'), 'Method flow synchronization actual EXE')
        self.assertIn("inputs.suite != 'pdf'", sync)
        self.assertIn("steps.assets.outcome == 'success'", sync)
        command = next(line.strip() for line in sync.splitlines()
                       if line.strip().startswith('python verification/tools/verify_method_flow_sync_release.py '))
        arguments = shlex.split(command.split(' *> ', 1)[0])[2:]
        parsed = sync_gate.parser().parse_args(arguments)
        self.assertEqual(parsed.baseline, Path('assets/method_sync_baseline.exe'))
        self.assertEqual(parsed.candidate, Path('assets/system.exe'))
        self.assertEqual(parsed.baseline_sha256, '$m.assets.method_sync_baseline.sha256')
        self.assertEqual(parsed.candidate_sha256, '$m.assets.system.sha256')
        self.assertEqual(parsed.expected_version, 'v5.8.58')
        self.assertEqual(parsed.evidence, Path('evidence/method-sync'))
        self.assertIn('*> evidence/method-sync.log', command)
        self.assertIn("if ($LASTEXITCODE -ne 0) { throw 'Required method flow synchronization EXE acceptance failed' }", sync)

    def test_existing_required_gates_are_preserved_and_counted_in_all_scope(self):
        workflow = WORKFLOW.read_text('utf-8')
        names = {
            'required_python': 'Required Python tests with frozen candidate and baseline',
            'pdf': 'PDF reader actual EXE',
            'media': 'Audio and video actual EXE',
            'method': 'Procurement correction actual EXE',
            'method_sync': 'Method flow synchronization actual EXE',
            'issuers': 'Both frozen authorization tools',
        }
        boundary = step(workflow, 'Record acceptance boundary')
        for identifier, name in names.items():
            with self.subTest(gate=name):
                self.assertIn('id: ' + identifier + '\n', step(workflow, name))
                self.assertIn('steps.' + identifier + '.outcome', boundary)
        self.assertIn('verify_method_correction_release.py', step(workflow, names['method']))
        self.assertIn('--expected-version v5.8.58', step(workflow, names['method']))
        self.assertIn('product/docs/releases/v5.8.58-public.json', step(workflow, names['issuers']))
        self.assertIn('$allGatesPassed', boundary)
        self.assertIn('complete_release_acceptance=$false', boundary)
        self.assertIn('manual_pending=', boundary)
        self.assertIn('performance_3000_remeasured=$false', boundary)

    def test_failure_evidence_is_always_uploaded_and_scope_stays_limited(self):
        workflow = WORKFLOW.read_text('utf-8')
        boundary = step(workflow, 'Record acceptance boundary')
        self.assertIn('if: always()', boundary)
        self.assertIn('remaining: media/method/method-sync/issuers only', boundary)
        upload = workflow.split('- uses: actions/upload-artifact@v4', 1)[1]
        self.assertIn('if: always()', upload)
        self.assertIn('name: v58-windows-', upload)
        self.assertIn('path: evidence', upload)
        self.assertIn('if-no-files-found: error', upload)


if __name__ == '__main__':
    unittest.main()
