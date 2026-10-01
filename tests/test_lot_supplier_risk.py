import sqlite3
import tempfile
import unittest
from contextlib import closing
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

from src.backend_patches import lot_supplier_risk as subject


class LotSupplierRuleTests(unittest.TestCase):
    def test_defaults_cover_exact_existing_methods(self):
        self.assertEqual(subject.DEFAULT_MINIMUMS, {
            "公开招标": 3,
            "竞争性磋商": 3,
            "竞争性谈判": 3,
            "邀请招标": 3,
            "网上竞价": 3,
            "单一来源": 1,
            "遴选": 3,
            "直选": 1,
        })

    def test_minimum_validation_is_strict_and_complete(self):
        valid = dict(subject.DEFAULT_MINIMUMS)
        valid["网上竞价"] = 4
        self.assertEqual(subject.normalize_minimums(valid)["网上竞价"], 4)
        for invalid in (
            {**valid, "询价": 3},
            {key: value for key, value in valid.items() if key != "直选"},
            {**valid, "直选": True},
            {**valid, "直选": 0},
            {**valid, "直选": 100},
        ):
            with self.subTest(invalid=invalid):
                with self.assertRaises(subject.ValidationError):
                    subject.normalize_minimums(invalid)

    def test_package_override_requires_basis(self):
        settings = {"supplier_minimums": subject.DEFAULT_MINIMUMS}
        control = SimpleNamespace(minimum_supplier_override=2, override_basis=" 批准文件 ")
        self.assertEqual(subject.effective_minimum(settings, "竞争性磋商", control), (2, "lot"))
        control.override_basis = ""
        with self.assertRaisesRegex(subject.ValidationError, "调整依据"):
            subject.effective_minimum(settings, "竞争性磋商", control)

    def test_historical_unknown_method_uses_safe_three_supplier_fallback(self):
        settings = {"supplier_minimums": subject.DEFAULT_MINIMUMS}
        self.assertEqual(
            subject.effective_minimum(settings, "简易工程"),
            (3, "fallback"),
        )


class LotSupplierSchemaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "legacy.db"
        with closing(sqlite3.connect(self.path)) as connection:
            connection.executescript(
                "CREATE TABLE projects(id INTEGER PRIMARY KEY);"
                "CREATE TABLE project_lots(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, "
                "lot_number TEXT, lot_name TEXT, budget NUMERIC, notes TEXT);"
                "CREATE TABLE supplier_registrations(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, lot_id INTEGER);"
            )
            connection.commit()

    def tearDown(self):
        self.temp.cleanup()

    def test_schema_is_additive_idempotent_and_auditable(self):
        subject.ensure_schema(self.path)
        subject.ensure_schema(self.path)
        with closing(sqlite3.connect(self.path)) as connection:
            controls = {row[1] for row in connection.execute("PRAGMA table_info(lot_procurement_controls)")}
            events = {row[1] for row in connection.execute("PRAGMA table_info(lot_supplier_events)")}
            deliveries = {
                row[1]
                for row in connection.execute(
                    "PRAGMA table_info(lot_supplier_mail_deliveries)"
                )
            }
            self.assertTrue({
                "lot_id", "status", "procurement_method", "minimum_supplier_override",
                "override_basis", "terminated_source", "terminated_reason", "terminated_at",
                "required_count_snapshot", "actual_count_snapshot", "response_count_snapshot",
                "deadline_snapshot", "root_lot_id", "previous_lot_id", "round_number",
            } <= controls)
            self.assertTrue({
                "event_key", "project_id", "lot_id", "event_type", "payload_json",
                "mail_status", "mail_attempts", "mail_last_error", "sent_at", "created_at",
            } <= events)
            self.assertTrue({
                "delivery_key", "event_id", "event_key", "recipient",
                "rules_fingerprint", "event_json", "delivery_json", "status",
                "attempts", "last_attempt_at", "next_attempt_at", "error_code",
                "sent_at", "created_at",
            } <= deliveries)
            indexes = list(connection.execute("PRAGMA index_list(lot_supplier_events)"))
            self.assertTrue(any(row[2] for row in indexes), indexes)

    def test_database_session_schema_helper_never_commits_caller_transaction(self):
        session = SimpleNamespace(
            _lot_risk_raw_sql=True,
            execute=Mock(return_value=SimpleNamespace()),
            commit=Mock(),
            rollback=Mock(),
        )

        subject.ensure_schema(SimpleNamespace(session=session))

        statements = "\n".join(
            str(call.args[0]) for call in session.execute.call_args_list
        )
        self.assertIn("lot_procurement_controls", statements)
        self.assertIn("lot_supplier_events", statements)
        self.assertIn("lot_supplier_mail_deliveries", statements)
        session.commit.assert_not_called()
        session.rollback.assert_not_called()


class LotSupplierSnapshotTests(unittest.TestCase):
    def test_custom_registration_deadline_uses_modules_and_ignores_removed_or_skipped_stages(self):
        old=datetime(2026,8,1,17)
        current=datetime(2026,8,5,17)
        project=SimpleNamespace(stages=[
            SimpleNamespace(stage_key='registration_end',modules=['common'],planned_datetime=old),
            SimpleNamespace(stage_key='removed',modules=['registration'],template_removed=True,planned_datetime=old),
            SimpleNamespace(stage_key='skipped',modules=['registration'],skipped=True,planned_datetime=old),
            SimpleNamespace(stage_key='custom-registration',modules=['registration'],planned_datetime=current),
        ])
        self.assertEqual(subject._deadline(project),current)

    def test_persisted_snapshot_controls_deadline_when_legacy_orm_has_no_module_fields(self):
        with sqlite3.connect(':memory:') as connection:
            connection.execute('CREATE TABLE stages(project_id INTEGER,stage_key TEXT,modules_json TEXT,template_removed INTEGER)')
            connection.executemany('INSERT INTO stages VALUES (7,?,?,?)',[
                ('registration_end','["common"]',0),('custom','["registration"]',0)])
            session=SimpleNamespace(_lot_risk_raw_sql=True,execute=connection.execute)
            project=SimpleNamespace(id=7,stages=[
                SimpleNamespace(stage_key='registration_end',planned_datetime=datetime(2026,8,1)),
                SimpleNamespace(stage_key='custom',planned_datetime=datetime(2026,8,5))])
            self.assertEqual(subject._deadline(project,SimpleNamespace(session=session)),datetime(2026,8,5))

    @staticmethod
    def lot(lot_id, number, name):
        return SimpleNamespace(id=lot_id, lot_number=number, lot_name=name, supplier_control=None)

    @staticmethod
    def registration(registration_id, lot_id):
        return SimpleNamespace(id=registration_id, lot_id=lot_id)

    def project(self, lots, registrations, method="公开招标"):
        stage = SimpleNamespace(stage_key="registration_end", planned_datetime=datetime(2026, 8, 5, 17, 0))
        return SimpleNamespace(
            id=7, method=method, lots=lots, registrations=registrations, stages=[stage],
            is_terminated=False,
        )

    def test_snapshot_counts_registration_rows_per_lot_and_names_risks(self):
        project = self.project(
            [self.lot(11, "01包", "办公设备采购"), self.lot(12, "02包", "网络设备")],
            [self.registration(1, 11), self.registration(2, 11), self.registration(3, 12),
             self.registration(4, 12), self.registration(5, 12), self.registration(6, 12)],
        )
        snapshot = subject.build_project_snapshot(
            None, project, datetime(2026, 8, 4, 9, 0),
            {"supplier_minimums": subject.DEFAULT_MINIMUMS},
        )
        self.assertEqual(snapshot["warning_count"], 1)
        self.assertEqual(snapshot["days_remaining"], 1)
        self.assertEqual(snapshot["items"][0], {
            "lot_id": 11,
            "lot_number": "01包",
            "lot_name": "办公设备采购",
            "status": "warning",
            "registration_count": 2,
            "required_count": 3,
            "missing_count": 1,
            "method": "公开招标",
            "rule_source": "method",
            "minimum_supplier_override": None,
            "override_basis": None,
            "terminated_source": None,
            "terminated_reason": None,
            "terminated_at": None,
            "round_number": 1,
        })

    def test_unassigned_multi_lot_registration_blocks_automation(self):
        project = self.project(
            [self.lot(11, "01包", "甲"), self.lot(12, "02包", "乙")],
            [self.registration(1, None)],
        )
        snapshot = subject.build_project_snapshot(
            None, project, datetime(2026, 8, 4, 9, 0),
            {"supplier_minimums": subject.DEFAULT_MINIMUMS},
        )
        self.assertEqual(snapshot["blocked_reason"], "存在未关联采购包的报名记录")
        self.assertEqual(snapshot["unassigned_registration_ids"], [1])
        self.assertEqual(snapshot["warning_count"], 0)

    def test_enrichment_attaches_snapshot_without_mutating_serializer_payload(self):
        project = self.project([self.lot(11, "01包", "办公设备")], [self.registration(1, 11)])
        payload = {"id": 7, "name": "测试项目"}
        enriched = subject.enrich_project_payload(
            None, payload, project, datetime(2026, 8, 4, 9, 0),
            {"supplier_minimums": subject.DEFAULT_MINIMUMS},
        )
        self.assertNotIn("lot_supplier_state", payload)
        self.assertEqual(enriched["lot_supplier_state"]["warning_count"], 1)

    def test_no_lot_project_uses_project_overall_virtual_item(self):
        project = self.project([], [self.registration(1, None)], method="单一来源")
        snapshot = subject.build_project_snapshot(
            None, project, datetime(2026, 8, 4, 9, 0),
            {"supplier_minimums": subject.DEFAULT_MINIMUMS},
        )
        self.assertEqual(snapshot["items"][0]["lot_name"], "项目整体")
        self.assertEqual(snapshot["items"][0]["status"], "active")


class LotSupplierStateChangeTests(unittest.TestCase):
    class RawSession:
        _lot_risk_raw_sql = True

        def __init__(self, connection):
            self.connection = connection

        def execute(self, statement, parameters=None):
            return self.connection.execute(statement, parameters or {})

        def commit(self):
            self.connection.commit()

        def rollback(self):
            self.connection.rollback()

    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "state.db"
        self.connection = sqlite3.connect(self.path)
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.executescript(
            "CREATE TABLE projects(id INTEGER PRIMARY KEY);"
            "CREATE TABLE project_lots(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, "
            "lot_number TEXT, lot_name TEXT, budget NUMERIC, notes TEXT);"
            "CREATE TABLE supplier_registrations(id INTEGER PRIMARY KEY, project_id INTEGER NOT NULL, lot_id INTEGER);"
            "INSERT INTO projects(id) VALUES (7);"
            "INSERT INTO project_lots VALUES (11,7,'01包','办公设备',100,'原备注');"
            "INSERT INTO project_lots VALUES (12,7,'02包','网络设备',200,'');"
            "INSERT INTO supplier_registrations VALUES (1,7,11);"
            "INSERT INTO supplier_registrations VALUES (2,7,11);"
            "INSERT INTO supplier_registrations VALUES (3,7,12);"
            "INSERT INTO supplier_registrations VALUES (4,7,12);"
            "INSERT INTO supplier_registrations VALUES (5,7,12);"
        )
        self.connection.commit()
        self.db = SimpleNamespace(session=self.RawSession(self.connection))
        subject.ensure_schema(self.db)
        self.lots = [
            SimpleNamespace(id=11, project_id=7, lot_number="01包", lot_name="办公设备", budget=100, notes="原备注", supplier_control=None),
            SimpleNamespace(id=12, project_id=7, lot_number="02包", lot_name="网络设备", budget=200, notes="", supplier_control=None),
        ]
        self.project = SimpleNamespace(
            id=7, method="公开招标", lots=self.lots,
            registrations=[SimpleNamespace(id=i, lot_id=11 if i < 3 else 12) for i in range(1, 6)],
            stages=[SimpleNamespace(stage_key="registration_end", planned_datetime=datetime(2026, 8, 5, 17, 0))],
            is_terminated=False, terminated_type=None, terminated_reason="",
        )
        self.settings = {"supplier_minimums": subject.DEFAULT_MINIMUMS}

    def tearDown(self):
        self.connection.close()
        self.temp.cleanup()

    def test_cutoff_flows_only_insufficient_lot_and_is_idempotent(self):
        first = subject.apply_registration_cutoff(
            self.db, self.project, datetime(2026, 8, 5, 17, 0), self.settings
        )
        second = subject.apply_registration_cutoff(
            self.db, self.project, datetime(2026, 8, 5, 17, 1), self.settings
        )
        self.db.session.commit()
        self.assertEqual([item["lot_id"] for item in first], [11])
        self.assertEqual(second, [])
        status = self.connection.execute(
            "SELECT status, terminated_source, actual_count_snapshot, required_count_snapshot "
            "FROM lot_procurement_controls WHERE lot_id=11"
        ).fetchone()
        self.assertEqual(status, ("liubiao", "registration_shortage_auto", 2, 3))
        events = self.connection.execute(
            "SELECT event_type, mail_status FROM lot_supplier_events ORDER BY id"
        ).fetchall()
        self.assertEqual(
            events,
            [
                ("registration_shortage_auto", "none"),
                ("registration_cutoff_result", "pending"),
            ],
        )
        self.assertFalse(self.project.is_terminated)

    def test_custom_stage_cutoff_respects_persisted_deadline_and_removed_snapshot(self):
        self.connection.execute('CREATE TABLE stages(project_id INTEGER,stage_key TEXT,modules_json TEXT,template_removed INTEGER)')
        self.connection.execute('INSERT INTO stages VALUES (7,\'custom-cutoff\',\'["registration"]\',0)')
        self.project.stages[0].stage_key='custom-cutoff'
        self.assertEqual(subject.apply_registration_cutoff(self.db,self.project,datetime(2026,8,5,16),self.settings),[])
        self.connection.execute('UPDATE stages SET template_removed=1')
        self.assertEqual(subject.apply_registration_cutoff(self.db,self.project,datetime(2026,8,5,18),self.settings),[])
        self.connection.execute('UPDATE stages SET template_removed=0')
        result=subject.apply_registration_cutoff(self.db,self.project,datetime(2026,8,5,18),self.settings)
        self.assertEqual([item['lot_id'] for item in result],[11])

    def test_manual_flow_restore_and_validation_are_audited(self):
        with self.assertRaises(subject.ValidationError):
            subject.manual_liubiao(self.db, self.project, self.lots[1], -1, "不足", 8)
        with self.assertRaises(subject.ValidationError):
            subject.manual_liubiao(self.db, self.project, self.lots[1], 2, "", 8)
        flowed = subject.manual_liubiao(self.db, self.project, self.lots[1], 2, "投标响应不足", 8)
        self.assertEqual(flowed["source"], "response_shortage_manual")
        restored = subject.restore_lot(self.db, self.project, self.lots[1], "批准恢复", 1)
        self.db.session.commit()
        self.assertEqual(restored["status"], "active")
        row = self.connection.execute(
            "SELECT status, response_count_snapshot FROM lot_procurement_controls WHERE lot_id=12"
        ).fetchone()
        self.assertEqual(row, ("active", None))
        self.assertEqual(self.connection.execute("SELECT COUNT(*) FROM lot_supplier_events").fetchone()[0], 2)

    def test_reprocurement_creates_linked_round_without_registrations(self):
        subject.manual_liubiao(self.db, self.project, self.lots[0], 1, "响应不足", 8)
        created = subject.create_reprocurement(
            self.db,
            self.project,
            self.lots[0],
            {"lot_number": "01包-2", "lot_name": "办公设备（二次）", "budget": 100, "notes": "重采", "procurement_method": "竞争性谈判"},
            1,
        )
        self.db.session.commit()
        self.assertEqual(created["round_number"], 2)
        self.assertEqual(created["procurement_method"], "竞争性谈判")
        control = self.connection.execute(
            "SELECT root_lot_id, previous_lot_id, round_number, status FROM lot_procurement_controls WHERE lot_id=?",
            (created["id"],),
        ).fetchone()
        self.assertEqual(control, (11, 11, 2, "active"))
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) FROM supplier_registrations WHERE lot_id=?", (created["id"],)).fetchone()[0],
            0,
        )

    def test_admin_can_save_and_clear_lot_override_with_basis(self):
        saved = subject.save_lot_rule(self.db, self.project, self.lots[0], 2, "批准文件", 1)
        self.assertEqual(saved["minimum_supplier_override"], 2)
        with self.assertRaisesRegex(subject.ValidationError, "调整依据"):
            subject.save_lot_rule(self.db, self.project, self.lots[0], 2, "", 1)
        cleared = subject.save_lot_rule(self.db, self.project, self.lots[0], None, "", 1)
        self.db.session.commit()
        self.assertIsNone(cleared["minimum_supplier_override"])

    def test_no_lot_project_is_terminated_when_overall_count_is_insufficient(self):
        self.project.lots = []
        self.project.registrations = []
        changed = subject.apply_registration_cutoff(
            self.db, self.project, datetime(2026, 8, 5, 17, 0), self.settings
        )
        self.db.session.commit()
        self.assertEqual(changed[0]["lot_name"], "项目整体")
        self.assertTrue(self.project.is_terminated)
        self.assertEqual(self.project.terminated_type, "liubiao")


if __name__ == "__main__":
    unittest.main()
