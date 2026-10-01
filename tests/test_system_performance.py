import copy
import json
import os
import sqlite3
import subprocess
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path
from unittest.mock import patch


try:
    from tools import benchmark_system
except ImportError as exc:  # A missing benchmark is a contract failure, not a collection error.
    benchmark_system = None
    BENCHMARK_IMPORT_ERROR = exc
else:
    BENCHMARK_IMPORT_ERROR = None


class SystemPerformanceContractTests(unittest.TestCase):
    def require_benchmark(self):
        if benchmark_system is None:
            self.fail(f"tools.benchmark_system must be importable: {BENCHMARK_IMPORT_ERROR}")
        return benchmark_system

    def test_candidate_cleanup_waits_until_windows_releases_executable(self):
        benchmark = self.require_benchmark()
        self.assertTrue(
            hasattr(benchmark, "_wait_for_file_release"),
            "candidate cleanup wait helper is missing",
        )
        candidate = Path("candidate-sqlcipher-smoke.exe")
        release_states = iter((False, False, True))
        with (
            patch.object(
                benchmark,
                "_can_open_for_delete",
                side_effect=lambda path: next(release_states),
                create=True,
            ) as readiness,
            patch.object(benchmark.time, "sleep") as sleep,
        ):
            benchmark._wait_for_file_release(candidate, timeout_seconds=1)

        self.assertEqual(readiness.call_count, 3)
        self.assertEqual(sleep.call_count, 2)

    def test_candidate_cleanup_waits_for_every_runtime_binary(self):
        benchmark = self.require_benchmark()
        wait_for_paths = getattr(benchmark, "_wait_for_paths_release", None)
        self.assertIsNotNone(
            wait_for_paths,
            "candidate cleanup must wait for extracted runtime dependencies",
        )
        candidate = Path("candidate-sqlcipher-smoke.exe")
        sqlite_dll = Path("runtime/sqlite3.dll")
        calls = {candidate: 0, sqlite_dll: 0}

        def can_delete(path):
            calls[path] += 1
            return path == candidate or calls[path] >= 2

        with (
            patch.object(benchmark, "_can_open_for_delete", side_effect=can_delete),
            patch.object(benchmark.time, "sleep") as sleep,
        ):
            wait_for_paths((candidate, sqlite_dll), timeout_seconds=1)

        self.assertEqual(calls[candidate], 2)
        self.assertEqual(calls[sqlite_dll], 2)
        sleep.assert_called_once()

    def test_full_scale_reads_are_safe_and_reported(self):
        benchmark = self.require_benchmark()
        result = benchmark.run_benchmark(
            project_count=1_000,
            attachment_metadata_count=30_000,
            clients=20,
            samples=5,
        )

        for key in (
            "project_count",
            "attachment_metadata_count",
            "clients",
            "median_ms",
            "p95_ms",
            "failures",
        ):
            self.assertIn(key, result)
        self.assertEqual(result["project_count"], 1_000)
        self.assertEqual(result["attachment_metadata_count"], 30_000)
        self.assertEqual(result["clients"], 20)
        self.assertEqual(result["failures"], 0, result.get("failure_messages"))
        self.assertTrue(result["fingerprint_unchanged"])
        self.assertEqual(result["fingerprint_before"], result["fingerprint_after"])
        self.assertGreaterEqual(result["median_ms"], 0)
        self.assertGreaterEqual(result["p95_ms"], result["median_ms"])
        self.assertTrue(result["regression_enforced"])
        self.assertEqual(result["regression_limit"], 1.20)

        chart = result["chart_aggregation"]
        self.assertEqual(chart["project_count"], 1_000)
        self.assertEqual(chart["stages_per_project"], 14)
        self.assertEqual(chart["warmup_count"], 10)
        self.assertEqual(chart["sample_count"], 50)
        self.assertLess(chart["median_ms"], 20)
        self.assertLess(chart["p95_ms"], 50)
        self.assertTrue(chart["passed"])

        expected_scenarios = {
            "purchaser_board",
            "project_summary",
            "attachment_metadata_paging",
            "concurrent_reads",
        }
        self.assertEqual(set(result["scenarios"]), expected_scenarios)
        for name in expected_scenarios - {"concurrent_reads"}:
            scenario = result["scenarios"][name]
            self.assertTrue(scenario.get("results_equivalent"), name)
            self.assertLessEqual(scenario["regression_ratio"], 1.20, name)
            self.assertIn("shared_contract_median_ms", scenario, name)
            self.assertGreater(scenario["shared_contract_median_ms"], 0)
            self.assertGreaterEqual(scenario["optimized_median_ms"], 0)
            self.assertEqual(
                scenario["shared_contract_payload_sha256"],
                scenario["optimized_payload_sha256"],
                name,
            )
        self.assertNotIn("glm_baseline", json.dumps(result, ensure_ascii=False).lower())
        concurrent = result["scenarios"]["concurrent_reads"]
        self.assertEqual(concurrent["clients"], 20)
        self.assertEqual(concurrent["successful_reads"], 20)
        self.assertEqual(concurrent["failed_reads"], 0)

    def test_shared_business_contract_covers_full_board_and_complete_rows(self):
        benchmark = self.require_benchmark()
        for name in (
            "_shared_purchaser_board",
            "_optimized_purchaser_board",
            "_shared_project_summary",
            "_shared_attachment_page",
        ):
            self.assertTrue(hasattr(benchmark, name), name)
        with tempfile.TemporaryDirectory() as temporary:
            database = Path(temporary) / "contract.db"
            benchmark._create_fixture(database, 120, 360)
            shared_board = benchmark._shared_purchaser_board(database)
            with closing(benchmark._read_connection(database)) as connection:
                optimized_board = benchmark._optimized_purchaser_board(connection)
                shared_projects = benchmark._shared_project_summary(connection)
                optimized_projects = benchmark._optimized_project_summary(connection)
                shared_attachments = benchmark._shared_attachment_page(connection, 20)
                optimized_attachments = benchmark._optimized_attachment_page(connection, 20)
        self.assertEqual(shared_board, optimized_board)
        self.assertFalse(shared_board["is_admin"])
        self.assertEqual(shared_board["groups"][-1]["name"], "未分类")
        self.assertIsNone(shared_board["groups"][-1]["category"])
        groups = {group["name"]: group for group in shared_board["groups"]}

        education = {
            unit["name"]: unit for unit in groups["教育机构"]["units"]
        }
        trimmed = education["采购单位 010 学校"]
        self.assertGreaterEqual(trimmed["project_count"], 2)
        self.assertEqual(trimmed["classification_source"], "auto")
        self.assertEqual(trimmed["rule_version"], "1")
        self.assertEqual(trimmed["matched_keyword"], "学校")

        enterprise = {
            unit["name"]: unit for unit in groups["企业"]["units"]
        }
        manual = enterprise["采购单位 005 学校"]
        self.assertEqual(manual["classification_source"], "manual")
        self.assertIsNone(manual["rule_version"])
        self.assertIsNone(manual["matched_keyword"])

        inactive_group = groups["停用分类"]
        self.assertTrue(inactive_group["requires_attention"])
        inactive = inactive_group["units"][0]
        self.assertEqual(inactive["name"], "采购单位 006 医院")
        self.assertEqual(inactive["classification_source"], "manual")
        self.assertEqual(
            inactive["classification_status"], "inactive_manual_category"
        )
        self.assertTrue(inactive["requires_attention"])

        unclassified = {
            unit["name"]: unit for unit in groups["未分类"]["units"]
        }
        self.assertEqual(
            unclassified["未分类单位"]["classification_source"], "unclassified"
        )
        for group in shared_board["groups"]:
            self.assertEqual(
                [unit["name"] for unit in group["units"]],
                sorted(unit["name"] for unit in group["units"]),
            )
            for unit in group["units"]:
                self.assertEqual(unit["project_ids"], sorted(unit["project_ids"]))

        tampered = copy.deepcopy(optimized_board)
        tampered_groups = {group["name"]: group for group in tampered["groups"]}
        lost_manual = next(
            unit
            for unit in tampered_groups["企业"]["units"]
            if unit["name"] == "采购单位 005 学校"
        )
        tampered_groups["企业"]["units"].remove(lost_manual)
        lost_manual.update(
            classification_source="auto",
            rule_version="1",
            matched_keyword="学校",
        )
        tampered_groups["教育机构"]["units"].append(lost_manual)
        tampered_groups["教育机构"]["units"].sort(key=lambda unit: unit["name"])
        self.assertNotEqual(shared_board, tampered)
        self.assertNotEqual(
            benchmark._payload_sha256(shared_board),
            benchmark._payload_sha256(tampered),
        )

        self.assertEqual(shared_projects, optimized_projects)
        self.assertEqual(
            set(shared_projects[0]),
            {
                "id", "number", "name", "purchaser", "status", "year",
                "created_at", "updated_at",
            },
        )
        self.assertEqual(shared_attachments, optimized_attachments)
        self.assertEqual(
            set(shared_attachments[0]),
            {"id", "project_id", "filename", "size", "created_at"},
        )

    def test_regression_gate_rejects_more_than_twenty_percent(self):
        benchmark = self.require_benchmark()
        self.assertIsNone(benchmark.regression_failure("query", 10.0, 12.0))
        message = benchmark.regression_failure("query", 10.0, 12.01)
        self.assertIn("query", message)
        self.assertIn("20%", message)

    def test_cli_emits_machine_readable_json(self):
        self.require_benchmark()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "benchmark.json"
            completed = subprocess.run(
                [
                    sys.executable,
                    "tools/benchmark_system.py",
                    "--projects",
                    "40",
                    "--attachments",
                    "120",
                    "--clients",
                    "4",
                    "--samples",
                    "3",
                    "--output",
                    str(output),
                ],
                check=False,
                capture_output=True,
                text=True,
                encoding="utf-8",
            )
            self.assertEqual(completed.returncode, 0, completed.stderr or completed.stdout)
            from_stdout = json.loads(completed.stdout)
            from_file = json.loads(output.read_text(encoding="utf-8"))
            self.assertEqual(from_stdout, from_file)
            self.assertEqual(from_stdout["project_count"], 40)
            self.assertEqual(from_stdout["attachment_metadata_count"], 120)
            self.assertEqual(from_stdout["clients"], 4)
            self.assertEqual(from_stdout["failures"], 0)
            self.assertFalse(from_stdout["regression_enforced"])

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PM_SOURCE_EXE_SHA256"),
        "candidate SQLCipher smoke requires the runner's pinned source",
    )
    def test_isolated_candidate_uses_packaged_sqlcipher_and_preserves_fingerprint(self):
        benchmark = self.require_benchmark()
        report = benchmark.run_candidate_sqlcipher_smoke(
            source_exe=Path(os.environ["PM_SOURCE_EXE"]),
            source_sha256=os.environ["PM_SOURCE_EXE_SHA256"],
            python312=Path(os.environ["PYTHON312"]),
            candidate_exe=os.environ.get("PM_TEST_CANDIDATE_EXE"),
            candidate_sha256=os.environ.get("PM_TEST_CANDIDATE_SHA256"),
            project_count=40,
            attachment_metadata_count=120,
        )
        self.assertEqual(report["failures"], 0, report.get("failure_messages"))
        self.assertEqual(report["connector_module"], "sqlcipher3._sqlite3")
        self.assertEqual(
            report["connector_source"],
            "candidate:PYZ.pyz/data_security.connect_encrypted",
        )
        self.assertIn("SQLCipher", report["cipher_name"])
        self.assertTrue(report["cipher_version"])
        self.assertTrue(report["encrypted_header"])
        self.assertTrue(report["stdlib_sqlite_rejected"])
        self.assertTrue(report["write_blocked"])
        self.assertTrue(report["fingerprint_unchanged"])
        self.assertEqual(report["fingerprint_before"], report["fingerprint_after"])
        self.assertEqual(report["project_count"], 40)
        self.assertEqual(report["attachment_metadata_count"], 120)

    def test_runner_hashes_source_before_and_after_and_runs_benchmark(self):
        script = Path("tools/run_test_suite.ps1").read_text(encoding="utf-8")
        for marker in (
            "$sourceHashBefore",
            "$sourceHashAfter",
            "SourceExe changed during the test suite",
            "tools\\benchmark_system.py",
            "--candidate-sqlcipher-smoke",
            "Candidate SQLCipher smoke failed",
            "$previousEnvironment",
            "finally",
        ):
            self.assertIn(marker, script)
        self.assertNotIn("Start-Process", script)
        self.assertNotIn("& $resolvedSource", script)

    def run_runner_finally_failure_probe(
        self,
        injection_switch,
        *,
        include_body_failure=True,
    ):
        benchmark = self.require_benchmark()
        source = Path(os.environ["PM_SOURCE_EXE"]).resolve(strict=True)
        source_hash_before = benchmark.sha256_file(source)
        root = Path(__file__).resolve().parents[1]
        script = (root / "tools" / "run_test_suite.ps1").resolve()
        python312 = Path(os.environ["PYTHON312"]).resolve(strict=True)
        repository_temp = root / "temp"
        repository_temp.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.TemporaryDirectory(
                prefix="runner-finally-",
                dir=repository_temp,
            ) as temp_dir:
                temp_root = Path(temp_dir)
                wrapper = temp_root / "verify-runner-finally.ps1"
                result_path = temp_root / "runner-finally-result.json"
                wrapper.write_text(
                    "param([string]$Runner,[string]$Source,[string]$Python,[string]$Result,[string]$ExpectedHash,"
                    "[string]$Injection,[string]$ProbeDirectory,[int]$IncludeBodyFailure)\n"
                    "$wrapperLocation=Get-Location\n"
                    "Set-Location -LiteralPath $ProbeDirectory\n"
                    "$expectedLocation=(Get-Location).Path\n"
                    "$env:PM_SOURCE_EXE='caller-source'\n"
                    "Remove-Item Env:PM_SOURCE_EXE_SHA256 -ErrorAction SilentlyContinue\n"
                    "$env:PYTHON312='caller-python'\n"
                    "Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue\n"
                    "$env:PYTHONUTF8='caller-utf8'\n"
                    "Remove-Item Env:PYTHONIOENCODING -ErrorAction SilentlyContinue\n"
                    "$env:TEMP='caller-temp'\n"
                    "Remove-Item Env:TMP -ErrorAction SilentlyContinue\n"
                    "$repoRoot=(Resolve-Path -LiteralPath (Join-Path (Split-Path $Runner -Parent) '..')).Path\n"
                    "$beforeRunnerTemps=@(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'temp') "
                    "-Directory -ErrorAction SilentlyContinue | Where-Object { "
                    "$_.Name -match '^task8-runner-[0-9a-f]{32}$' } | "
                    "ForEach-Object { $_.Name })\n"
                    "$caught=''\n"
                    "$caughtRecord=$null\n"
                    "Remove-Variable Task8InjectedFinallyException -Scope Global "
                    "-ErrorAction SilentlyContinue\n"
                    "Remove-Variable Task8InjectedFinallyErrorRecord -Scope Global "
                    "-ErrorAction SilentlyContinue\n"
                    "$runnerParams=@{SourceExe=$Source; SourceSha256=$ExpectedHash; Python312=$Python}\n"
                    "if ($IncludeBodyFailure -eq 1) { "
                    "$runnerParams['InjectFailureAfterEnvironmentSetup']=$true } "
                    "else { $runnerParams['InjectFinallyOnly']=$true }\n"
                    "foreach ($name in $Injection.Split(',')) { $runnerParams[$name]=$true }\n"
                    "try { & $Runner @runnerParams } catch { "
                    "$caughtRecord=$_; $caught=$_.Exception.Message }\n"
                    "$runnerTempNames=@(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'temp') "
                    "-Directory -ErrorAction SilentlyContinue | Where-Object { "
                    "$_.Name -match '^task8-runner-[0-9a-f]{32}$' -and "
                    "$beforeRunnerTemps -notcontains $_.Name } | ForEach-Object { $_.Name })\n"
                    "$originalRecord=$global:Task8InjectedFinallyErrorRecord\n"
                    "$originalCategory=$null\n"
                    "$originalFullyQualifiedErrorId=$null\n"
                    "$originalStack=$null\n"
                    "if ($null -ne $originalRecord) { "
                    "$originalCategory=$originalRecord.CategoryInfo.Category.ToString(); "
                    "$originalFullyQualifiedErrorId=$originalRecord.FullyQualifiedErrorId; "
                    "$originalStack=$originalRecord.ScriptStackTrace }\n"
                    "$state=[ordered]@{caught=$caught; runner_temp_count=$runnerTempNames.Count; "
                    "cwd_restored=((Get-Location).Path -eq $expectedLocation); "
                    "exception_type=$caughtRecord.Exception.GetType().FullName; "
                    "error_record_type=$caughtRecord.GetType().FullName; "
                    "same_exception=[object]::ReferenceEquals("
                    "$caughtRecord.Exception,$global:Task8InjectedFinallyException); "
                    "same_error_record=[object]::ReferenceEquals("
                    "$caughtRecord,$global:Task8InjectedFinallyErrorRecord); "
                    "category=$caughtRecord.CategoryInfo.Category.ToString(); "
                    "original_category=$originalCategory; "
                    "fully_qualified_error_id=$caughtRecord.FullyQualifiedErrorId; "
                    "original_fully_qualified_error_id=$originalFullyQualifiedErrorId; "
                    "stack_preserved=($caughtRecord.ScriptStackTrace -eq $originalStack); "
                    "metadata=$caughtRecord.Exception.Data['task8_stage']; "
                    "PM_SOURCE_EXE=$env:PM_SOURCE_EXE; "
                    "PM_SOURCE_EXE_SHA256=[bool](Test-Path Env:PM_SOURCE_EXE_SHA256); "
                    "PYTHON312=$env:PYTHON312; PYTHONPATH=[bool](Test-Path Env:PYTHONPATH); "
                    "PYTHONUTF8=$env:PYTHONUTF8; PYTHONIOENCODING=[bool](Test-Path Env:PYTHONIOENCODING); "
                    "TEMP=$env:TEMP; TMP=[bool](Test-Path Env:TMP)}\n"
                    "try { $state | ConvertTo-Json -Compress | "
                    "Set-Content -LiteralPath $Result -Encoding UTF8 } "
                    "finally { Set-Location -LiteralPath $wrapperLocation; "
                    "foreach ($name in $runnerTempNames) { Remove-Item -LiteralPath "
                    "(Join-Path (Join-Path $repoRoot 'temp') $name) -Recurse -Force "
                    "-ErrorAction SilentlyContinue } }\n",
                    encoding="utf-8",
                )
                completed = subprocess.run(
                    [
                        "powershell.exe",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                        str(wrapper),
                        "-Runner",
                        str(script),
                        "-Source",
                        str(source),
                        "-ExpectedHash",
                        source_hash_before,
                        "-Python",
                        str(python312),
                        "-Result",
                        str(result_path),
                        "-Injection",
                        injection_switch,
                        "-ProbeDirectory",
                        str(temp_root),
                        "-IncludeBodyFailure",
                        "1" if include_body_failure else "0",
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )
                self.assertEqual(
                    completed.returncode,
                    0,
                    completed.stderr or completed.stdout,
                )
                state = json.loads(result_path.read_text(encoding="utf-8-sig"))
        finally:
            try:
                repository_temp.rmdir()
            except OSError:
                pass
        self.assertEqual(benchmark.sha256_file(source), source_hash_before)
        return state

    def assert_runner_single_failure_record_preserved(self, state, stage):
        self.assert_runner_caller_state_restored(state)
        self.assertEqual(state["caught"], f"Injected runner {stage} failure.")
        self.assertEqual(state["exception_type"], "System.IO.IOException")
        self.assertEqual(
            state["error_record_type"],
            "System.Management.Automation.ErrorRecord",
        )
        self.assertTrue(state["same_exception"])
        self.assertEqual(state["category"], state["original_category"])
        self.assertEqual(
            state["fully_qualified_error_id"],
            state["original_fully_qualified_error_id"],
        )
        self.assertTrue(state["stack_preserved"])
        self.assertEqual(state["metadata"], stage)

    def assert_runner_caller_state_restored(self, state):
        self.assertEqual(state["runner_temp_count"], 0)
        self.assertTrue(state["cwd_restored"])
        self.assertEqual(state["PM_SOURCE_EXE"], "caller-source")
        self.assertFalse(state["PM_SOURCE_EXE_SHA256"])
        self.assertEqual(state["PYTHON312"], "caller-python")
        self.assertFalse(state["PYTHONPATH"])
        self.assertEqual(state["PYTHONUTF8"], "caller-utf8")
        self.assertFalse(state["PYTHONIOENCODING"])
        self.assertEqual(state["TEMP"], "caller-temp")
        self.assertFalse(state["TMP"])

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PYTHON312"),
        "runner finally failure injection requires the pinned source",
    )
    def test_runner_rethrows_single_restore_failure_record_unchanged(self):
        state = self.run_runner_finally_failure_probe(
            "InjectRestoreFailure",
            include_body_failure=False,
        )

        self.assert_runner_single_failure_record_preserved(state, "restore")

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PYTHON312"),
        "runner finally failure injection requires the pinned source",
    )
    def test_runner_rethrows_single_cleanup_failure_record_unchanged(self):
        state = self.run_runner_finally_failure_probe(
            "InjectCleanupFailure",
            include_body_failure=False,
        )

        self.assert_runner_single_failure_record_preserved(state, "cleanup")

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PYTHON312"),
        "runner finally failure injection requires the pinned source",
    )
    def test_runner_rethrows_single_hash_failure_compatibly(self):
        state = self.run_runner_finally_failure_probe(
            "InjectAfterHashFailure",
            include_body_failure=False,
        )

        self.assert_runner_caller_state_restored(state)
        self.assertEqual(state["caught"], "Injected source after-hash failure.")
        self.assertEqual(
            state["exception_type"],
            "System.Management.Automation.RuntimeException",
        )
        self.assertEqual(state["category"], "OperationStopped")

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PYTHON312"),
        "runner finally failure injection requires the pinned source",
    )
    def test_runner_restores_state_and_preserves_body_when_after_hash_fails(self):
        state = self.run_runner_finally_failure_probe("InjectAfterHashFailure")

        self.assert_runner_caller_state_restored(state)
        self.assertEqual(
            state["caught"],
            "Runner failures: [body] Injected runner failure after environment setup. | "
            "[hash] Injected source after-hash failure.",
        )

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PYTHON312"),
        "runner finally failure injection requires the pinned source",
    )
    def test_runner_restores_state_and_preserves_body_when_cleanup_fails(self):
        state = self.run_runner_finally_failure_probe(
            "InjectAfterHashFailure,InjectCleanupFailure"
        )

        self.assert_runner_caller_state_restored(state)
        self.assertEqual(
            state["caught"],
            "Runner failures: [body] Injected runner failure after environment setup. | "
            "[hash] Injected source after-hash failure. | "
            "[cleanup] Injected runner cleanup failure.",
        )

    @unittest.skipUnless(
        os.environ.get("PM_SOURCE_EXE") and os.environ.get("PYTHON312"),
        "runner environment restoration requires the pinned source",
    )
    def test_runner_restores_set_and_unset_environment_after_injected_failure(self):
        benchmark = self.require_benchmark()
        source = Path(os.environ["PM_SOURCE_EXE"]).resolve(strict=True)
        source_hash_before = benchmark.sha256_file(source)
        root = Path(__file__).resolve().parents[1]
        script = (root / "tools" / "run_test_suite.ps1").resolve()
        python312 = Path(os.environ["PYTHON312"]).resolve(strict=True)
        repository_temp = root / "temp"
        repository_temp.mkdir(parents=True, exist_ok=True)
        try:
            with tempfile.TemporaryDirectory(
                prefix="runner-env-",
                dir=repository_temp,
            ) as temp_dir:
                temp_root = Path(temp_dir)
                wrapper = temp_root / "verify-runner-env.ps1"
                result_path = temp_root / "runner-env-result.json"
                wrapper.write_text(
                    "param([string]$Runner,[string]$Source,[string]$Python,[string]$Result,[string]$ExpectedHash)\n"
                    "$env:PM_SOURCE_EXE='caller-source'\n"
                    "Remove-Item Env:PM_SOURCE_EXE_SHA256 -ErrorAction SilentlyContinue\n"
                    "$env:PYTHON312='caller-python'\n"
                    "Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue\n"
                    "$env:PYTHONUTF8='caller-utf8'\n"
                    "Remove-Item Env:PYTHONIOENCODING -ErrorAction SilentlyContinue\n"
                    "$env:TEMP='caller-temp'\n"
                    "Remove-Item Env:TMP -ErrorAction SilentlyContinue\n"
                    "$repoRoot=(Resolve-Path -LiteralPath (Join-Path (Split-Path $Runner -Parent) '..')).Path\n"
                    "$beforeRunnerTemps=@(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'temp') "
                    "-Directory -ErrorAction SilentlyContinue | Where-Object { "
                    "$_.Name -match '^task8-runner-[0-9a-f]{32}$' } | "
                    "ForEach-Object { $_.Name })\n"
                    "$caught=''\n"
                    "try { & $Runner -SourceExe $Source -SourceSha256 $ExpectedHash -Python312 $Python -InjectFailureAfterEnvironmentSetup } "
                    "catch { $caught=$_.Exception.Message }\n"
                    "$runnerTemps=@(Get-ChildItem -LiteralPath (Join-Path $repoRoot 'temp') "
                    "-Directory -ErrorAction SilentlyContinue | Where-Object { "
                    "$_.Name -match '^task8-runner-[0-9a-f]{32}$' -and "
                    "$beforeRunnerTemps -notcontains $_.Name }).Count\n"
                    "$state=[ordered]@{caught=$caught; runner_temp_count=$runnerTemps; PM_SOURCE_EXE=$env:PM_SOURCE_EXE; "
                    "PM_SOURCE_EXE_SHA256=[bool](Test-Path Env:PM_SOURCE_EXE_SHA256); "
                    "PYTHON312=$env:PYTHON312; PYTHONPATH=[bool](Test-Path Env:PYTHONPATH); "
                    "PYTHONUTF8=$env:PYTHONUTF8; PYTHONIOENCODING=[bool](Test-Path Env:PYTHONIOENCODING); "
                    "TEMP=$env:TEMP; TMP=[bool](Test-Path Env:TMP)}\n"
                    "$state | ConvertTo-Json -Compress | Set-Content -LiteralPath $Result -Encoding UTF8\n",
                    encoding="utf-8",
                )
                completed = subprocess.run(
                    [
                        "powershell.exe",
                        "-NoProfile",
                        "-ExecutionPolicy",
                        "Bypass",
                        "-File",
                        str(wrapper),
                        "-Runner",
                        str(script),
                        "-Source",
                        str(source),
                        "-ExpectedHash",
                        source_hash_before,
                        "-Python",
                        str(python312),
                        "-Result",
                        str(result_path),
                    ],
                    check=False,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                )
                self.assertEqual(
                    completed.returncode,
                    0,
                    completed.stderr or completed.stdout,
                )
                state = json.loads(result_path.read_text(encoding="utf-8-sig"))
        finally:
            try:
                repository_temp.rmdir()
            except OSError:
                pass
        self.assertEqual(state["caught"], "Injected runner failure after environment setup.")
        self.assertEqual(state["runner_temp_count"], 0)
        self.assertEqual(state["PM_SOURCE_EXE"], "caller-source")
        self.assertFalse(state["PM_SOURCE_EXE_SHA256"])
        self.assertEqual(state["PYTHON312"], "caller-python")
        self.assertFalse(state["PYTHONPATH"])
        self.assertEqual(state["PYTHONUTF8"], "caller-utf8")
        self.assertFalse(state["PYTHONIOENCODING"])
        self.assertEqual(state["TEMP"], "caller-temp")
        self.assertFalse(state["TMP"])
        self.assertEqual(benchmark.sha256_file(source), source_hash_before)


if __name__ == "__main__":
    unittest.main()
