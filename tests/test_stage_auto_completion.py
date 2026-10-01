import json
import os
import sqlite3
import sys
import tempfile
import types
import unittest
from contextlib import nullcontext
from datetime import datetime
from pathlib import Path
from unittest.mock import Mock
from unittest.mock import patch

from tests.test_app_replacements import load_replacements


class FakeQuery:
    def __init__(self, projects):
        self.projects = projects

    def options(self, *args):
        return self

    def filter_by(self, **values):
        return FakeQuery(
            [
                project
                for project in self.projects
                if all(getattr(project, key) == value for key, value in values.items())
            ]
        )

    def all(self):
        return list(self.projects)


class SQLiteAuditSession:
    def __init__(self, path):
        self.database = sqlite3.connect(path)
        self.database.row_factory = sqlite3.Row
        self.tracked_stages = []
        self.interrupt_next_commit = False
        self.commit = Mock(side_effect=self._commit)
        self.rollback = Mock(side_effect=self.database.rollback)

    def close(self):
        self.database.close()

    def connection(self):
        return self.database

    def track_stage(self, stage):
        self.database.execute(
            "CREATE TABLE IF NOT EXISTS stage_state ("
            "id TEXT PRIMARY KEY, completed INTEGER NOT NULL, completed_date TEXT)"
        )
        self.database.execute(
            "INSERT OR REPLACE INTO stage_state(id, completed, completed_date) VALUES (?, ?, ?)",
            (stage.id, int(bool(stage.completed)), stage.completed_date),
        )
        self.database.commit()
        self.tracked_stages.append(stage)

    def _commit(self):
        if self.interrupt_next_commit:
            self.interrupt_next_commit = False
            raise KeyboardInterrupt("synthetic process interruption")
        for stage in self.tracked_stages:
            completed_date = stage.completed_date
            if hasattr(completed_date, "isoformat"):
                completed_date = completed_date.isoformat()
            self.database.execute(
                "UPDATE stage_state SET completed=?, completed_date=? WHERE id=?",
                (int(bool(stage.completed)), completed_date, stage.id),
            )
        self.database.commit()

    def database_stage(self, stage_id):
        row = self.database.execute(
            "SELECT completed, completed_date FROM stage_state WHERE id=?", (stage_id,)
        ).fetchone()
        return tuple(row)

    def database_audit(self):
        try:
            rows = self.database.execute(
                "SELECT event_id, payload_json FROM stage_auto_completion_audit "
                "ORDER BY event_id"
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        return [(event_id, json.loads(payload)) for event_id, payload in rows]


class SQLiteAuditEngine:
    def __init__(self, path):
        self.path = path

    def raw_connection(self):
        return sqlite3.connect(self.path)


class StageAutoCompletionTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.module = load_replacements()
        self.module.SETTINGS_PATH = self.root / "app_settings.json"
        self.module.Path = Path
        self.module.datetime = datetime
        self.module.joinedload = lambda value: value
        self.module.app = types.SimpleNamespace(app_context=nullcontext)
        self.module.STAGES = [
            {"key": "registration_end", "name": "报名截止"},
            {"key": "bid_opening", "name": "开标"},
            {"key": "evaluation", "name": "评标"},
            {"key": "doc_review", "name": "文件审核"},
        ]
        audit_database = self.root / "stage-audit.db"
        self.session = SQLiteAuditSession(audit_database)
        self.session.database.execute(
            "CREATE TABLE stages("
            "id INTEGER PRIMARY KEY AUTOINCREMENT, project_id INTEGER NOT NULL, stage_key TEXT NOT NULL, "
            "modules_json TEXT, template_removed INTEGER NOT NULL DEFAULT 0)"
        )
        self.session.database.commit()
        self.module.db = types.SimpleNamespace(
            session=self.session,
            engine=SQLiteAuditEngine(audit_database),
        )
        self.projects = []
        self.module.Project = types.SimpleNamespace(
            query=FakeQuery(self.projects),
            stages="stages",
            lots="lots",
            registrations="registrations",
        )
        self.previous_risk_alias = sys.modules.get("lot_supplier_risk")
        sys.modules["lot_supplier_risk"] = types.SimpleNamespace(
            ensure_schema=lambda database, **kwargs: None,
            apply_registration_cutoff=lambda *args, **kwargs: [],
        )
        self.module.load_app_settings = lambda: {"supplier_minimums": {}}
        self.set_now(datetime(2026, 7, 21, 8, 0, 30))

    def tearDown(self):
        if self.previous_risk_alias is None:
            sys.modules.pop("lot_supplier_risk", None)
        else:
            sys.modules["lot_supplier_risk"] = self.previous_risk_alias
        self.session.close()
        self.temporary.cleanup()

    def set_now(self, value):
        self.now = value
        self.module._AUTO_COMPLETION_NOW = lambda: self.now

    @staticmethod
    def stage(key, planned, *, completed=False, skipped=False, completed_date=None):
        return types.SimpleNamespace(
            id=f"stage-{key}",
            stage_key=key,
            planned_datetime=planned,
            completed=completed,
            skipped=skipped,
            completed_date=completed_date,
        )

    @staticmethod
    def project(project_id, stages, *, terminated=False):
        project = types.SimpleNamespace(
            id=project_id,
            number=f"CG-{project_id:03d}",
            is_terminated=terminated,
            stages=stages,
        )
        project.get_stage = lambda key: next(
            (stage for stage in project.stages if stage.stage_key == key), None
        )
        return project

    def activate(self):
        self.module._auto_advance_stages()
        self.assertEqual(self.session.commit.call_count, 0)
        self.session.commit.reset_mock()
        self.session.rollback.reset_mock()

    def configure_snapshot(self, project_id, rows):
        self.session.database.executemany(
            "INSERT INTO stages(project_id,stage_key,modules_json,template_removed) "
            "VALUES(?,?,?,0)",
            [
                (project_id, stage_key, json.dumps(modules, ensure_ascii=False))
                for stage_key, modules in rows
            ],
        )
        self.session.database.commit()

    def state(self):
        return json.loads(
            (self.root / "stage_auto_completion_state.json").read_text(encoding="utf-8")
        )

    def audit(self):
        path = self.root / "stage_auto_completion_log.jsonl"
        if not path.exists():
            return []
        return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]

    def test_first_run_creates_next_minute_watermark_without_query_or_updates(self):
        due = self.stage("bid_opening", datetime(2026, 7, 20, 9, 0))
        self.projects.append(self.project(1, [due]))

        self.module._auto_advance_stages()

        self.assertFalse(due.completed)
        self.assertEqual(self.state()["enabled_at"], "2026-07-21T08:01:00")
        self.session.commit.assert_not_called()
        self.assertEqual(self.audit(), [])

    def test_due_time_stages_complete_and_append_minimal_audit(self):
        self.activate()
        stages = [
            self.stage("registration_end", datetime(2026, 7, 21, 8, 30)),
            self.stage("bid_opening", datetime(2026, 7, 21, 9, 0)),
            self.stage("evaluation", datetime(2026, 7, 21, 9, 15)),
        ]
        self.projects.append(self.project(7, stages))
        self.set_now(datetime(2026, 7, 21, 9, 15, 45))

        self.module._auto_advance_stages()

        self.assertTrue(all(stage.completed for stage in stages))
        self.assertTrue(all(str(stage.completed_date) == "2026-07-21" for stage in stages))
        self.session.commit.assert_called_once_with()
        records = self.audit()
        self.assertEqual([item["stage_key"] for item in records], [
            "registration_end", "bid_opening", "evaluation"
        ])
        self.assertTrue(all(item["project_id"] == 7 for item in records))
        self.assertTrue(all(set(item) == {
            "action", "completed_date", "executed_at", "planned_at", "project_id", "stage_key"
        } for item in records))

    def test_explicit_module_policy_completes_only_selected_custom_stage(self):
        self.activate()
        automatic = self.stage("custom-auto", datetime(2026, 7, 21, 9, 0))
        manual = self.stage("evaluation", datetime(2026, 7, 21, 9, 0))
        self.projects.append(self.project(17, [automatic, manual]))
        self.configure_snapshot(17, [
            ("custom-auto", ["common", "auto_completion", "_auto_completion_policy_v1"]),
            ("evaluation", ["common", "evaluation", "_auto_completion_policy_v1"]),
        ])
        self.set_now(datetime(2026, 7, 21, 9, 1))

        self.module._auto_advance_stages()

        self.assertTrue(automatic.completed)
        self.assertFalse(manual.completed)
        self.assertEqual(
            [item["stage_key"] for item in self.audit()],
            ["custom-auto"],
        )

    def test_due_stages_complete_in_configured_workflow_order(self):
        self.activate()
        stages = [
            self.stage("registration_end", datetime(2026, 7, 21, 9, 0)),
            self.stage("bid_opening", datetime(2026, 7, 21, 9, 0)),
            self.stage("evaluation", datetime(2026, 7, 21, 9, 0)),
        ]
        self.projects.append(self.project(8, stages))
        self.module.load_app_settings = lambda: {
            "supplier_minimums": {},
            "stage_order": [
                "evaluation",
                "bid_opening",
                "registration_end",
                "doc_review",
            ],
        }
        self.set_now(datetime(2026, 7, 21, 9, 1))

        self.module._auto_advance_stages()

        self.assertEqual(
            [item["stage_key"] for item in self.audit()],
            ["evaluation", "bid_opening", "registration_end"],
        )

    def test_registration_cutoff_runs_before_stage_is_completed(self):
        self.activate()
        stage = self.stage("registration_end", datetime(2026, 7, 21, 8, 30))
        project = self.project(9, [stage])
        project.lots = []
        project.registrations = []
        project.method = "公开招标"
        self.projects.append(project)
        self.set_now(datetime(2026, 7, 21, 8, 31))
        risk = types.SimpleNamespace(
            ensure_schema=Mock(),
            apply_registration_cutoff=Mock(side_effect=lambda *args: self.assertFalse(stage.completed)),
        )
        self.module.load_app_settings = lambda: {"supplier_minimums": {}}
        with patch.dict("sys.modules", {"lot_supplier_risk": risk}):
            self.module._auto_advance_stages()
        risk.ensure_schema.assert_called_once_with(self.module.db, commit=True)
        risk.apply_registration_cutoff.assert_called_once()
        self.assertTrue(stage.completed)

    def test_offline_catch_up_completes_after_restart(self):
        self.activate()
        stage = self.stage("bid_opening", datetime(2026, 7, 21, 10, 0))
        self.projects.append(self.project(2, [stage]))
        self.set_now(datetime(2026, 7, 22, 8, 5))

        self.module._auto_advance_stages()

        self.assertTrue(stage.completed)
        self.assertEqual(str(stage.completed_date), "2026-07-22")

    def test_future_historical_non_time_completed_skipped_and_terminated_are_ignored(self):
        self.activate()
        future = self.stage("registration_end", datetime(2026, 7, 21, 10, 1))
        historical = self.stage("bid_opening", datetime(2026, 7, 21, 8, 0))
        non_time = self.stage("doc_review", datetime(2026, 7, 21, 9, 0))
        manual = self.stage(
            "evaluation", datetime(2026, 7, 21, 9, 0), completed=True, completed_date="2026-07-21"
        )
        skipped = self.stage("bid_opening", datetime(2026, 7, 21, 9, 0), skipped=True)
        terminated = self.stage("registration_end", datetime(2026, 7, 21, 9, 0))
        self.projects.extend([
            self.project(1, [future, historical, non_time, manual, skipped]),
            self.project(2, [terminated], terminated=True),
        ])
        self.set_now(datetime(2026, 7, 21, 10, 0))

        self.module._auto_advance_stages()

        self.assertFalse(future.completed)
        self.assertFalse(historical.completed)
        self.assertFalse(non_time.completed)
        self.assertTrue(manual.completed)
        self.assertEqual(manual.completed_date, "2026-07-21")
        self.assertFalse(skipped.completed)
        self.assertFalse(terminated.completed)
        self.session.commit.assert_not_called()
        self.assertEqual(self.audit(), [])

    def test_commit_failure_rolls_back_and_writes_no_audit(self):
        self.activate()
        stage = self.stage("evaluation", datetime(2026, 7, 21, 9, 0))
        self.projects.append(self.project(3, [stage]))
        self.set_now(datetime(2026, 7, 21, 9, 1))
        self.session.commit.side_effect = OSError("synthetic commit failure")

        self.module._auto_advance_stages()

        self.session.rollback.assert_called_once_with()
        self.assertEqual(self.audit(), [])

    def test_jsonl_export_failure_keeps_database_truth_and_recovers_next_run(self):
        self.activate()
        stage = self.stage("evaluation", datetime(2026, 7, 21, 9, 0))
        self.projects.append(self.project(5, [stage]))
        self.session.track_stage(stage)
        self.set_now(datetime(2026, 7, 21, 9, 1))
        original_replace = os.replace
        audit_path = self.root / "stage_auto_completion_log.jsonl"

        def fail_audit_replace(source, destination):
            if Path(destination) == audit_path:
                raise OSError("synthetic audit export failure")
            return original_replace(source, destination)

        with patch("os.replace", side_effect=fail_audit_replace):
            self.module._auto_advance_stages()

        self.assertEqual(self.session.database_stage(stage.id), (1, "2026-07-21"))
        self.assertEqual(len(self.session.database_audit()), 1)
        self.assertEqual(self.audit(), [])

        self.module._auto_advance_stages()

        self.assertEqual(len(self.audit()), 1)

    def test_process_interrupt_rolls_back_stage_and_database_audit_together(self):
        self.activate()
        stage = self.stage("evaluation", datetime(2026, 7, 21, 9, 0))
        self.projects.append(self.project(6, [stage]))
        self.session.track_stage(stage)
        self.session.interrupt_next_commit = True
        self.set_now(datetime(2026, 7, 21, 9, 1))

        try:
            self.module._auto_advance_stages()
        except KeyboardInterrupt:
            self.fail("process interruption escaped without rolling back")

        self.assertFalse(stage.completed)
        self.assertIsNone(stage.completed_date)
        self.assertEqual(self.session.database_stage(stage.id), (0, None))
        self.assertEqual(self.session.database_audit(), [])
        self.assertEqual(self.audit(), [])
        self.session.rollback.assert_called_once_with()

    def test_repeated_jsonl_backfill_from_database_is_idempotent(self):
        self.activate()
        stage = self.stage("bid_opening", datetime(2026, 7, 21, 9, 0))
        self.projects.append(self.project(8, [stage]))
        self.session.track_stage(stage)
        self.set_now(datetime(2026, 7, 21, 9, 1))
        self.module._auto_advance_stages()
        (self.root / "stage_auto_completion_log.jsonl").unlink()

        self.module._auto_advance_stages()
        first_backfill = self.audit()
        self.module._auto_advance_stages()
        second_backfill = self.audit()

        self.assertEqual(len(self.session.database_audit()), 1)
        self.assertEqual(len(first_backfill), 1)
        self.assertEqual(second_backfill, first_backfill)

    def test_corrupt_state_fails_closed(self):
        state_path = self.root / "stage_auto_completion_state.json"
        state_path.write_text("not-json", encoding="utf-8")
        stage = self.stage("registration_end", datetime(2026, 7, 21, 9, 0))
        self.projects.append(self.project(4, [stage]))
        self.set_now(datetime(2026, 7, 21, 9, 1))

        self.module._auto_advance_stages()

        self.assertFalse(stage.completed)
        self.session.commit.assert_not_called()
        self.assertEqual(state_path.read_text(encoding="utf-8"), "not-json")


if __name__ == "__main__":
    unittest.main()
