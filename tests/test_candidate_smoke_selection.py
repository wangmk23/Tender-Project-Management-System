import hashlib
import json
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import tools.benchmark_system as benchmark


class CandidateSmokeSelectionTests(unittest.TestCase):
    def test_explicit_candidate_is_probed_without_another_build(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();source=root/'source.exe';candidate=root/'candidate.exe'
            source.write_bytes(b'source');candidate.write_bytes(b'candidate')
            sh=hashlib.sha256(source.read_bytes()).hexdigest();ch=hashlib.sha256(candidate.read_bytes()).hexdigest()
            with patch.object(benchmark,'build_candidate') as build, patch.object(benchmark.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=json.dumps({'failures':0,'candidate_sha256':ch}),stderr='')) as run, patch.object(benchmark,'_wait_for_paths_release'):
                report=benchmark.run_candidate_sqlcipher_smoke(source_exe=source,source_sha256=sh,python312=sys.executable,candidate_exe=candidate,candidate_sha256=ch)
            build.assert_not_called();command=run.call_args.args[0]
            self.assertEqual(command[command.index('--sqlcipher-probe')+1],str(candidate))
            self.assertEqual(report['candidate_sha256'],ch)

    def test_rejects_wrong_candidate_hash_before_probe(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp).resolve();source=root/'source.exe';candidate=root/'candidate.exe'
            source.write_bytes(b'source');candidate.write_bytes(b'candidate')
            with patch.object(benchmark.subprocess,'run') as run:
                with self.assertRaisesRegex(RuntimeError,'candidate SHA-256 mismatch'):
                    benchmark.run_candidate_sqlcipher_smoke(source_exe=source,source_sha256=hashlib.sha256(source.read_bytes()).hexdigest(),python312=sys.executable,candidate_exe=candidate,candidate_sha256='0'*64)
            run.assert_not_called()
