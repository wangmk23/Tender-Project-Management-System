import shutil
import hashlib
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


class TestRunnerContractTests(unittest.TestCase):
    def test_runner_accepts_any_explicit_hash_pinned_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            normal_tools = Path(temporary) / "normal-checkout" / "tools"
            normal_tools.mkdir(parents=True)
            runner = normal_tools / "run_test_suite.ps1"
            shutil.copy2("tools/run_test_suite.ps1", runner)

            source = Path(temporary) / "portable-source.exe"
            source.write_bytes(b"portable source executable")
            source_hash = hashlib.sha256(source.read_bytes()).hexdigest()
            accepted_result = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(runner),
                    "-ValidateSourceOnly",
                    "-SourceExe",
                    str(source),
                    "-SourceSha256",
                    source_hash,
                    "-Python312",
                    sys.executable,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

            rejected_result = subprocess.run(
                [
                    "powershell.exe",
                    "-NoProfile",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-File",
                    str(runner),
                    "-ValidateSourceOnly",
                    "-SourceExe",
                    str(source),
                    "-SourceSha256",
                    "0" * 64,
                    "-Python312",
                    sys.executable,
                ],
                capture_output=True,
                text=True,
                encoding="utf-8",
            )

        self.assertEqual(accepted_result.returncode, 0, accepted_result.stderr)
        self.assertNotEqual(rejected_result.returncode, 0)
        self.assertIn("SHA-256 mismatch", rejected_result.stdout + rejected_result.stderr)

    def test_relative_candidate_resolves_from_callers_directory(self):
        with tempfile.TemporaryDirectory() as temporary:
            base=Path(temporary);repo=base/'checkout';tools=repo/'tools';tests=repo/'tests'
            tools.mkdir(parents=True);tests.mkdir()
            runner=tools/'run_test_suite.ps1';shutil.copy2('tools/run_test_suite.ps1',runner)
            (tools/'benchmark_system.py').write_text('print("isolated benchmark stub")',encoding='utf-8')
            (tests/'test_probe.py').write_text('import os, unittest\nfrom pathlib import Path\nclass Probe(unittest.TestCase):\n def test_path(self):\n  self.assertEqual(Path(os.environ["PM_TEST_CANDIDATE_EXE"]).resolve(),Path(os.environ["PM_EXPECTED_CANDIDATE"]).resolve())\n',encoding='utf-8')
            (tests/'test_probe.js').write_text("require('node:test')('isolated runner probe',()=>{});",encoding='utf-8')
            caller=base/'caller';caller.mkdir();source=caller/'source.exe';candidate=caller/'candidate.exe'
            source.write_bytes(b'source');candidate.write_bytes(b'candidate')
            import os
            environment={**os.environ,'PM_EXPECTED_CANDIDATE':str(candidate)}
            result=subprocess.run(['powershell.exe','-NoProfile','-ExecutionPolicy','Bypass','-File',str(runner),'-SourceExe','source.exe','-SourceSha256',hashlib.sha256(source.read_bytes()).hexdigest(),'-Python312',sys.executable,'-CandidateExe','candidate.exe','-CandidateSha256',hashlib.sha256(candidate.read_bytes()).hexdigest()],cwd=caller,env=environment,capture_output=True,text=True,encoding='utf-8',timeout=60)
            self.assertEqual(result.returncode,0,result.stdout+result.stderr)

    def test_runner_uses_one_explicit_candidate_for_packaged_tests(self):
        script = Path("tools/run_test_suite.ps1").read_text(encoding="utf-8")
        self.assertIn('$env:PM_TEST_CANDIDATE_EXE = $resolvedCandidate', script)
        self.assertIn('$env:PM_TEST_CANDIDATE_SHA256 = $candidateHash', script)
        self.assertIn('tools\\build_candidate.py', script)
        self.assertIn('CandidateExe', script)
        self.assertIn('CandidateSha256', script)

    def test_runner_pins_source_and_restores_environment(self):
        script = Path("tools/run_test_suite.ps1").read_text(encoding="utf-8")
        for marker in (
            "Get-FileHash -Algorithm SHA256",
            "$env:PM_SOURCE_EXE",
            "$env:PM_SOURCE_EXE_SHA256",
            "$env:PYTHON312",
            "node --test",
            "SourceExe changed during the test suite.",
            "finally",
        ):
            self.assertIn(marker, script)
        self.assertNotIn("Copy-Item", script)
        self.assertIn("SourceSha256", script)
        self.assertNotIn("_v5.8.6_", script)
        self.assertNotIn("formalSource", script)
        self.assertNotIn("项目管理系统_桌面版_v5.7.0", script)


if __name__ == "__main__":
    unittest.main()
