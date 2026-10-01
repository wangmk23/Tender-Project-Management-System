import sqlite3
import sys
import tempfile
import unittest
from unittest import mock
from contextlib import closing
from datetime import date
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from src.backend_patches import consortium_registration as subject


class ConsortiumRegistrationValidationTests(unittest.TestCase):
    def test_legacy_payload_defaults_to_standalone(self):
        self.assertEqual(
            subject.validate_payload({"company_name": " 牵头单位 "}),
            {
                "bidder_type": "standalone",
                "company_name": "牵头单位",
                "consortium_members": [],
            },
        )

    def test_consortium_preserves_order_and_trimmed_display_names(self):
        actual = subject.validate_payload(
            {
                "bidder_type": "consortium",
                "company_name": " 牵头单位 ",
                "consortium_members": [
                    {"company_name": " 成员乙 "},
                    {"company_name": "成员甲"},
                ],
            }
        )
        self.assertEqual(
            actual["consortium_members"],
            [{"company_name": "成员乙"}, {"company_name": "成员甲"}],
        )

    def test_rejects_invalid_payloads_with_stable_messages(self):
        cases = (
            ({"bidder_type": "other", "company_name": "A"}, "投标主体类型无效"),
            ({"company_name": ""}, "请填写公司名称"),
            (
                {"bidder_type": "consortium", "company_name": "A", "consortium_members": []},
                "联合体至少需要一个成员单位",
            ),
            (
                {"bidder_type": "consortium", "company_name": "A", "consortium_members": [{"company_name": ""}]},
                "成员单位名称不能为空",
            ),
            (
                {"bidder_type": "consortium", "company_name": "A", "consortium_members": [{"company_name": "B"}, {"company_name": " b "}]},
                "成员单位名称不能重复",
            ),
            (
                {"bidder_type": "consortium", "company_name": "A", "consortium_members": [{"company_name": " a "}]},
                "成员单位不能与牵头单位相同",
            ),
            (
                {"bidder_type": "consortium", "company_name": "A", "consortium_members": [{"company_name": "B"}] * 21},
                "联合体成员不能超过20个",
            ),
            (
                {"bidder_type": "consortium", "company_name": "A", "consortium_members": [{"company_name": "B" * 201}]},
                "成员单位名称不能超过200个字符",
            ),
        )
        for payload, message in cases:
            with self.subTest(message=message):
                with self.assertRaisesRegex(subject.ValidationError, f"^{message}$"):
                    subject.validate_payload(payload)

    def test_standalone_discards_hidden_draft_members(self):
        actual = subject.validate_payload(
            {
                "bidder_type": "standalone",
                "company_name": "A",
                "consortium_members": [{"company_name": "hidden draft"}],
            }
        )
        self.assertEqual(actual["consortium_members"], [])


class ConsortiumRegistrationSchemaTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "legacy.db"
        with closing(sqlite3.connect(self.path)) as connection:
            connection.execute(
                "CREATE TABLE supplier_registrations (id INTEGER PRIMARY KEY, company_name VARCHAR(200) NOT NULL)"
            )
            connection.execute(
                "INSERT INTO supplier_registrations (id, company_name) VALUES (1, '旧单位')"
            )
            connection.commit()

    def tearDown(self):
        self.temp.cleanup()

    def test_incremental_schema_is_idempotent_and_defaults_legacy_rows(self):
        subject.ensure_schema(self.path)
        subject.ensure_schema(self.path)
        with closing(sqlite3.connect(self.path)) as connection:
            columns = {row[1]: row for row in connection.execute("PRAGMA table_info(supplier_registrations)")}
            self.assertIn("bidder_type", columns)
            self.assertEqual(
                connection.execute("SELECT bidder_type FROM supplier_registrations WHERE id=1").fetchone()[0],
                "standalone",
            )
            child_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(registration_consortium_members)")
            }
            self.assertEqual(child_columns, {"id", "registration_id", "company_name", "sort_order"})
            foreign_keys = list(connection.execute("PRAGMA foreign_key_list(registration_consortium_members)"))
            self.assertEqual(foreign_keys[0][2], "supplier_registrations")
            self.assertEqual(foreign_keys[0][6].upper(), "CASCADE")

    def test_failed_migration_rolls_back_without_partial_schema(self):
        def fail_after_column(connection):
            connection.execute("CREATE TABLE registration_consortium_members(id INTEGER)")
            raise RuntimeError("forced migration failure")

        with self.assertRaisesRegex(RuntimeError, "forced migration failure"):
            subject.ensure_schema(self.path, _create_members=fail_after_column)
        with closing(sqlite3.connect(self.path)) as connection:
            columns = {row[1] for row in connection.execute("PRAGMA table_info(supplier_registrations)")}
            tables = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertNotIn("bidder_type", columns)
        self.assertNotIn("registration_consortium_members", tables)


class ConsortiumRegistrationPersistenceTests(unittest.TestCase):
    class RawSession:
        _consortium_raw_sql = True

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
        self.path = Path(self.temp.name) / "registration.db"
        self.connection = sqlite3.connect(self.path)
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute(
            "CREATE TABLE supplier_registrations "
            "(id INTEGER PRIMARY KEY, company_name VARCHAR(200) NOT NULL)"
        )
        self.connection.execute(
            "INSERT INTO supplier_registrations(id, company_name) VALUES (1, '牵头单位')"
        )
        self.connection.commit()
        self.session = self.RawSession(self.connection)
        self.db = SimpleNamespace(session=self.session)
        subject.ensure_schema(self.db)

    def tearDown(self):
        self.connection.close()
        self.temp.cleanup()

    def test_replace_enrich_reorder_and_convert_to_standalone(self):
        subject.replace_members(
            self.db,
            1,
            "consortium",
            [{"company_name": "成员乙"}, {"company_name": "成员甲"}],
        )
        self.session.commit()
        payload = subject.enrich_registration(self.db, {"id": 1, "company_name": "牵头单位"})
        self.assertEqual(payload["bidder_type"], "consortium")
        self.assertEqual(
            payload["consortium_members"],
            [{"company_name": "成员乙"}, {"company_name": "成员甲"}],
        )

        subject.replace_members(
            self.db,
            1,
            "consortium",
            [{"company_name": "成员甲"}, {"company_name": "成员乙"}],
        )
        self.session.commit()
        self.assertEqual(
            subject.enrich_registration(self.db, {"id": 1})["consortium_members"],
            [{"company_name": "成员甲"}, {"company_name": "成员乙"}],
        )

        subject.replace_members(self.db, 1, "standalone", [])
        self.session.commit()
        self.assertEqual(
            subject.enrich_registration(self.db, {"id": 1}),
            {"id": 1, "bidder_type": "standalone", "consortium_members": []},
        )

    def test_schema_cache_does_not_confuse_distinct_sessions_with_reused_ids(self):
        subject._READY_DATABASES.clear()
        with tempfile.TemporaryDirectory() as temp:
            second_path = Path(temp) / "second.db"
            second_connection = sqlite3.connect(second_path)
            try:
                second_connection.execute(
                    "CREATE TABLE supplier_registrations "
                    "(id INTEGER PRIMARY KEY, company_name VARCHAR(200) NOT NULL)"
                )
                second_connection.commit()
                second_session = self.RawSession(second_connection)
                second_db = SimpleNamespace(session=second_session)
                with mock.patch.object(subject, "id", return_value=17, create=True):
                    subject.ensure_schema(self.db)
                    subject.ensure_schema(second_db)
                columns = {
                    row[1]
                    for row in second_connection.execute(
                        "PRAGMA table_info(supplier_registrations)"
                    )
                }
                self.assertIn("bidder_type", columns)
            finally:
                second_connection.close()
                subject._READY_DATABASES.clear()

    def test_failed_member_insert_rolls_back_type_and_previous_members(self):
        subject.replace_members(
            self.db, 1, "consortium", [{"company_name": "原成员"}]
        )
        self.session.commit()
        self.connection.execute(
            "CREATE TRIGGER reject_member BEFORE INSERT ON registration_consortium_members "
            "WHEN NEW.company_name='失败成员' BEGIN SELECT RAISE(ABORT, 'forced'); END"
        )
        self.connection.commit()
        with self.assertRaises(Exception):
            subject.replace_members(
                self.db, 1, "consortium", [{"company_name": "失败成员"}]
            )
            self.session.commit()
        self.session.rollback()
        self.assertEqual(
            subject.enrich_registration(self.db, {"id": 1})["consortium_members"],
            [{"company_name": "原成员"}],
        )

    def test_delete_members_uses_parent_registration_id(self):
        subject.replace_members(
            self.db, 1, "consortium", [{"company_name": "成员"}]
        )
        self.session.commit()
        subject.delete_members(self.db, 1)
        self.session.commit()
        self.assertEqual(
            subject.enrich_registration(self.db, {"id": 1})["consortium_members"],
            [],
        )


class ConsortiumRegistrationRouteTests(unittest.TestCase):
    class RawSession:
        _consortium_raw_sql = True

        def __init__(self, connection):
            self.connection = connection
            self.pending = []

        def execute(self, statement, parameters=None):
            return self.connection.execute(statement, parameters or {})

        def add(self, registration):
            self.pending.append(registration)

        def flush(self):
            for registration in self.pending:
                cursor = self.connection.execute(
                    "INSERT INTO supplier_registrations(company_name) VALUES (:company_name)",
                    {"company_name": registration.company_name},
                )
                registration.id = cursor.lastrowid
            self.pending.clear()

        def delete(self, registration):
            self.connection.execute(
                "DELETE FROM supplier_registrations WHERE id=:id",
                {"id": registration.id},
            )

        def commit(self):
            self.connection.commit()

        def rollback(self):
            self.connection.rollback()
            self.pending.clear()

    class Registration:
        def __init__(self, **values):
            self.__dict__.update(values)
            self.id = values.get("id")
            self.attachments = []
            self.lot = None

        def to_dict(self):
            return subject.enrich_registration(
                self._db,
                {"id": self.id, "company_name": self.company_name},
            )

    class Project:
        pass

    def setUp(self):
        subject._READY_DATABASES.clear()
        self.temp = tempfile.TemporaryDirectory()
        self.path = Path(self.temp.name) / "routes.db"
        self.connection = sqlite3.connect(self.path)
        self.connection.execute("PRAGMA foreign_keys=ON")
        self.connection.execute(
            "CREATE TABLE supplier_registrations "
            "(id INTEGER PRIMARY KEY, company_name VARCHAR(200) NOT NULL)"
        )
        self.connection.commit()
        self.session = self.RawSession(self.connection)
        self.project = SimpleNamespace(id=7, is_terminated=False, registrations=[], lots=[])
        self.registrations = {}
        self.session.query = lambda model: SimpleNamespace(filter_by=lambda **filters: SimpleNamespace(all=lambda: list(self.registrations.values())))

        def get_or_404(model, identity):
            if model is self.Project:
                return self.project
            return self.registrations[identity]

        self.db = SimpleNamespace(session=self.session, get_or_404=get_or_404)
        self.Registration._db = self.db
        self.request = SimpleNamespace(json={})
        self.request.get_json = lambda: self.request.json
        self.module = import_module("src.backend_patches.app_replacements")
        self.previous_alias = sys.modules.get("consortium_registration")
        sys.modules["consortium_registration"] = subject
        self.module.db = self.db
        self.module.Project = self.Project
        self.module.SupplierRegistration = self.Registration
        self.module.request = self.request
        self.module.jsonify = lambda value: value
        self.module.date = date
        self.module._normalize_project_lot_id = lambda lot_id, pid: lot_id
        self.module._ensure_project_resource = lambda registration, pid: registration
        self.module.app = SimpleNamespace(
            logger=SimpleNamespace(exception=lambda *args: None, warning=lambda *args: None)
        )
        self.module.UPLOAD_FOLDER = self.path.parent
        self.module._validate_file_path = lambda *args: None

    def tearDown(self):
        if self.previous_alias is None:
            sys.modules.pop("consortium_registration", None)
        else:
            sys.modules["consortium_registration"] = self.previous_alias
        self.connection.close()
        self.temp.cleanup()

    def create(self, payload):
        self.request.json = payload
        response, status = self.module.api_create_registration(7)
        if status == 201:
            registration = self.session.connection.execute(
                "SELECT id FROM supplier_registrations ORDER BY id DESC LIMIT 1"
            ).fetchone()[0]
            created = self.module.SupplierRegistration(
                id=registration,
                project_id=7,
                lot_id=None,
                company_name=payload.get("company_name", "").strip(),
            )
            self.registrations[registration] = created
            self.project.registrations.append(created)
        return response, status

    def test_duplicate_create_and_rename_are_rejected(self):
        first, status = self.create({"company_name":"供应商Ａ"})
        self.assertEqual(status,201)
        _, status = self.create({"company_name":" 供应商A "})
        self.assertEqual(status,409)
        other, status = self.create({"company_name":"另一个供应商"})
        self.assertEqual(status,201)
        self.request.json = {"company_name":"供应商A"}
        _, status = self.module.api_update_registration(7,other["id"])
        self.assertEqual(status,409)
        self.assertEqual(len(self.registrations),2)

    def test_create_consortium_is_one_registration_with_ordered_members(self):
        response, status = self.create(
            {
                "bidder_type": "consortium",
                "company_name": " 牵头单位 ",
                "consortium_members": [
                    {"company_name": "成员乙"},
                    {"company_name": "成员甲"},
                ],
            }
        )
        self.assertEqual(status, 201)
        self.assertEqual(response["bidder_type"], "consortium")
        self.assertEqual(len(self.project.registrations), 1)
        self.assertEqual(
            response["consortium_members"],
            [{"company_name": "成员乙"}, {"company_name": "成员甲"}],
        )

    def test_multi_lot_project_requires_registration_lot(self):
        self.project.lots = [SimpleNamespace(id=11), SimpleNamespace(id=12)]
        response, status = self.create({"company_name": "未分包单位", "lot_id": None})
        self.assertEqual((response, status), ({"error": "多包项目的报名必须选择所属包"}, 400))

    def test_validation_and_write_failures_roll_back_parent_creation(self):
        response, status = self.create(
            {
                "bidder_type": "consortium",
                "company_name": "牵头单位",
                "consortium_members": [],
            }
        )
        self.assertEqual((response, status), ({"error": "联合体至少需要一个成员单位"}, 400))
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) FROM supplier_registrations").fetchone()[0],
            0,
        )

        with patch.object(subject, "replace_members", side_effect=RuntimeError("forced")):
            response, status = self.create(
                {"company_name": "回滚单位", "bidder_type": "standalone"}
            )
        self.assertEqual((response, status), ({"error": "报名登记保存失败"}, 500))
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) FROM supplier_registrations").fetchone()[0],
            0,
        )

    def test_update_reorders_then_converts_to_standalone_atomically(self):
        _, status = self.create(
            {
                "bidder_type": "consortium",
                "company_name": "牵头单位",
                "consortium_members": [
                    {"company_name": "成员甲"},
                    {"company_name": "成员乙"},
                ],
            }
        )
        self.assertEqual(status, 201)
        registration_id = next(iter(self.registrations))
        self.request.json = {
            "bidder_type": "consortium",
            "company_name": "牵头单位",
            "consortium_members": [
                {"company_name": "成员乙"},
                {"company_name": "成员甲"},
            ],
        }
        reordered = self.module.api_update_registration(7, registration_id)
        self.assertEqual(
            reordered["consortium_members"],
            [{"company_name": "成员乙"}, {"company_name": "成员甲"}],
        )

        self.request.json = {
            "bidder_type": "standalone",
            "company_name": "牵头单位",
            "consortium_members": [{"company_name": "隐藏草稿"}],
        }
        standalone = self.module.api_update_registration(7, registration_id)
        self.assertEqual(standalone["bidder_type"], "standalone")
        self.assertEqual(standalone["consortium_members"], [])

    def test_delete_removes_parent_and_members(self):
        _, status = self.create(
            {
                "bidder_type": "consortium",
                "company_name": "牵头单位",
                "consortium_members": [{"company_name": "成员"}],
            }
        )
        self.assertEqual(status, 201)
        registration_id = next(iter(self.registrations))
        self.assertEqual(
            self.module.api_delete_registration(7, registration_id), {"ok": True}
        )
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) FROM supplier_registrations").fetchone()[0],
            0,
        )
        self.assertEqual(
            self.connection.execute("SELECT COUNT(*) FROM registration_consortium_members").fetchone()[0],
            0,
        )


if __name__ == "__main__":
    unittest.main()
