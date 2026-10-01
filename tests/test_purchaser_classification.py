import sqlite3
import sys
import tempfile
import unittest
from contextlib import closing
from pathlib import Path


MODULE_DIR = Path(__file__).resolve().parents[1] / "src" / "backend_patches"
sys.path.insert(0, str(MODULE_DIR))

from purchaser_classification import (  # noqa: E402
    PurchaserClassificationError,
    classify_purchaser_nature,
    execute_purchaser_action,
    read_purchaser_board,
)


class PurchaserClassificationTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.root = Path(self.temp_dir.name)
        self.database = self.root / "data" / "projects.db"
        self.backups = self.root / "backups"
        self.database.parent.mkdir(parents=True)
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                """
                CREATE TABLE projects (
                    id INTEGER PRIMARY KEY,
                    number TEXT,
                    name TEXT,
                    purchaser TEXT,
                    year INTEGER,
                    created_at TEXT
                )
                """
            )
            connection.executemany(
                "INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (1, "P-1", "教学楼改造", " 第一中学 ", 2024, "2024-03-01 08:00:00"),
                    (2, "P-2", "操场改造", "第一中学", 2025, "2025-06-02 09:00:00"),
                    (3, "P-3", "设备采购", "市人民医院", 2026, ""),
                    (4, "P-4", "空采购人", "   ", 2026, "2026-01-01"),
                    (5, "P-5", "无采购人", None, 2026, "2026-01-02"),
                ],
            )
            connection.commit()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_board_groups_trimmed_exact_names_and_ignores_blanks(self):
        board = read_purchaser_board(self.database, self.backups, True)

        self.assertEqual(board["unit_total"], 2)
        self.assertTrue(board["is_admin"])
        # 预设性质分类自动初始化
        self.assertEqual(len(board["categories"]), 6)
        category_names = {cat["name"] for cat in board["categories"]}
        self.assertIn("教育机构", category_names)
        self.assertIn("医疗卫生", category_names)
        # "第一中学" 自动归入教育机构，"市人民医院" 自动归入医疗卫生
        groups_by_name = {group["name"]: group for group in board["groups"]}
        self.assertEqual(len(groups_by_name["教育机构"]["units"]), 1)
        school = groups_by_name["教育机构"]["units"][0]
        self.assertEqual(school["name"], "第一中学")
        self.assertEqual(school["project_ids"], [1, 2])
        self.assertEqual(school["project_count"], 2)
        self.assertEqual(school["recent_project"], "2025-06-02 09:00:00")
        hospital = groups_by_name["医疗卫生"]["units"][0]
        self.assertEqual(hospital["name"], "市人民医院")
        self.assertEqual(hospital["recent_project"], "2026")
        # 无不匹配单位时未分类为空
        self.assertEqual(len(groups_by_name["未分类"]["units"]), 0)

    def test_first_initialization_backs_up_once_and_is_idempotent(self):
        calls = []

        def encrypted_connect(path, master_key, readonly):
            calls.append((Path(path), master_key, readonly))
            return sqlite3.connect(path)

        read_purchaser_board(
            self.database, self.backups, False, encrypted_connect, b"secret"
        )
        first_backups = list(self.backups.glob("purchaser_classification_pre_migration_*.db"))
        self.assertEqual(len(first_backups), 1)
        self.assertTrue(any(path == first_backups[0] for path, _, _ in calls))
        self.assertTrue(all(key == b"secret" and readonly is False for _, key, readonly in calls))

        read_purchaser_board(
            self.database, self.backups, False, encrypted_connect, b"secret"
        )
        self.assertEqual(
            list(self.backups.glob("purchaser_classification_pre_migration_*.db")),
            first_backups,
        )
        with closing(sqlite3.connect(self.database)) as connection:
            version = connection.execute(
                "SELECT value FROM purchaser_schema_meta WHERE key='schema_version'"
            ).fetchone()[0]
        self.assertEqual(version, "2")

    def test_v1_upgrade_seeds_presets_without_overwriting_manual_data(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executescript(
                """
                CREATE TABLE purchaser_schema_meta (
                    key TEXT PRIMARY KEY,
                    value TEXT NOT NULL
                );
                CREATE TABLE purchaser_categories (
                    id INTEGER PRIMARY KEY,
                    name TEXT NOT NULL UNIQUE,
                    color TEXT NOT NULL,
                    sort_order INTEGER NOT NULL DEFAULT 0,
                    is_active INTEGER NOT NULL DEFAULT 1,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE purchaser_category_assignments (
                    purchaser_key TEXT PRIMARY KEY,
                    category_id INTEGER NOT NULL,
                    updated_at TEXT NOT NULL,
                    updated_by TEXT NOT NULL DEFAULT ''
                );
                """
            )
            connection.execute(
                "INSERT INTO purchaser_schema_meta(key, value) VALUES ('schema_version', '1')"
            )
            connection.execute(
                """
                INSERT INTO purchaser_categories
                (id, name, color, sort_order, is_active, created_at, updated_at)
                VALUES (41, '教育机构', '#112233', 88, 0, '2025-01-01', '2025-02-02')
                """
            )
            connection.execute(
                """
                INSERT INTO purchaser_categories
                (id, name, color, sort_order, is_active, created_at, updated_at)
                VALUES (42, '保留手工分类', '#445566', 77, 1, '2025-03-03', '2025-04-04')
                """
            )
            connection.execute(
                """
                INSERT INTO purchaser_category_assignments
                (purchaser_key, category_id, updated_at, updated_by)
                VALUES ('第一中学', 41, '2025-05-05', 'admin')
                """
            )
            connection.commit()

            original_categories = [
                tuple(row) for row in connection.execute(
                    "SELECT id, name, color, sort_order, is_active, created_at, updated_at "
                    "FROM purchaser_categories ORDER BY id"
                )
            ]
            original_assignments = [
                tuple(row) for row in connection.execute(
                    "SELECT purchaser_key, category_id, updated_at, updated_by "
                    "FROM purchaser_category_assignments ORDER BY purchaser_key"
                )
            ]

        read_purchaser_board(self.database, self.backups, True)
        read_purchaser_board(self.database, self.backups, True)

        with closing(sqlite3.connect(self.database)) as connection:
            connection.row_factory = sqlite3.Row
            categories = {
                row["name"]: tuple(row)
                for row in connection.execute(
                    "SELECT id, name, color, sort_order, is_active, created_at, updated_at "
                    "FROM purchaser_categories"
                )
            }
            assignment = connection.execute(
                "SELECT category_id, updated_at, updated_by "
                "FROM purchaser_category_assignments WHERE purchaser_key='第一中学'"
            ).fetchone()
            version = connection.execute(
                "SELECT value FROM purchaser_schema_meta WHERE key='schema_version'"
            ).fetchone()[0]
            migrated_original_categories = [
                tuple(row) for row in connection.execute(
                    "SELECT id, name, color, sort_order, is_active, created_at, updated_at "
                    "FROM purchaser_categories WHERE id IN (41, 42) ORDER BY id"
                )
            ]
            migrated_assignments = [
                tuple(row) for row in connection.execute(
                    "SELECT purchaser_key, category_id, updated_at, updated_by "
                    "FROM purchaser_category_assignments ORDER BY purchaser_key"
                )
            ]
            audit_table = connection.execute(
                "SELECT sql FROM sqlite_master "
                "WHERE type='table' AND name='purchaser_classification_audit'"
            ).fetchone()
            safe_version = connection.execute(
                "SELECT value FROM __safe_migration_versions "
                "WHERE namespace='purchaser_classification'"
            ).fetchone()[0]

        self.assertEqual(version, "2")
        self.assertTrue(
            {"教育机构", "医疗卫生", "行政机关", "金融机构", "基层自治组织", "企业"}
            <= set(categories)
        )
        self.assertEqual(
            categories["教育机构"],
            (41, "教育机构", "#112233", 88, 0, "2025-01-01", "2025-02-02"),
        )
        self.assertEqual(
            categories["保留手工分类"],
            (42, "保留手工分类", "#445566", 77, 1, "2025-03-03", "2025-04-04"),
        )
        self.assertEqual(tuple(assignment), (41, "2025-05-05", "admin"))
        self.assertEqual(migrated_original_categories, original_categories)
        self.assertEqual(migrated_assignments, original_assignments)
        self.assertIsNotNone(audit_table)
        self.assertEqual(safe_version, "2")
        self.assertEqual(len(list(self.backups.glob("purchaser_classification_pre_migration_*.db"))), 1)

    def test_admin_can_create_edit_and_assign_category(self):
        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "upsert_category",
            {"name": "教育单位", "color": "#3366CC", "sort_order": 2},
            True,
            "admin",
        )
        self.assertEqual(status, 200)
        category_id = result["category"]["id"]

        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "upsert_category",
            {
                "id": category_id,
                "name": "学校",
                "color": "#123ABC",
                "sort_order": 1,
            },
            True,
            "admin",
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["category"]["name"], "学校")

        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "move_purchaser",
            {"purchaser_name": " 第一中学 ", "category_id": category_id},
            True,
            "admin",
        )
        self.assertEqual(status, 200)
        self.assertEqual(result["purchaser_name"], "第一中学")
        board = read_purchaser_board(self.database, self.backups, False)
        classified = next(group for group in board["groups"] if group["category"])
        self.assertEqual(classified["category"]["id"], category_id)
        self.assertEqual(classified["units"][0]["project_ids"], [1, 2])

    def test_move_to_unclassified_deletes_assignment(self):
        category_id = self._create_category("医疗单位")
        self._move("市人民医院", category_id)

        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "move_purchaser",
            {"purchaser_name": "市人民医院", "category_id": None},
            True,
            "admin",
        )
        self.assertEqual(status, 200)
        self.assertIsNone(result["category_id"])
        with closing(sqlite3.connect(self.database)) as connection:
            count = connection.execute(
                "SELECT COUNT(*) FROM purchaser_category_assignments"
            ).fetchone()[0]
        self.assertEqual(count, 0)

    def test_non_admin_mutation_is_forbidden(self):
        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "upsert_category",
            {"name": "教育单位"},
            False,
            "reader",
        )
        self.assertEqual(status, 403)
        self.assertIn("管理员", result["error"])

    def test_duplicate_category_returns_conflict(self):
        self._create_category("教育单位")
        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "upsert_category",
            {"name": "教育单位", "color": "#112233"},
            True,
            "admin",
        )
        self.assertEqual(status, 409)
        self.assertIn("已存在", result["error"])

    def test_move_requires_current_purchaser_and_active_category(self):
        category_id = self._create_category("教育单位")
        missing, status = execute_purchaser_action(
            self.database,
            self.backups,
            "move_purchaser",
            {"purchaser_name": "不存在的单位", "category_id": category_id},
            True,
            "admin",
        )
        self.assertEqual(status, 404)
        self.assertIn("采购人", missing["error"])

        missing_category, status = execute_purchaser_action(
            self.database,
            self.backups,
            "move_purchaser",
            {"purchaser_name": "第一中学", "category_id": 9999},
            True,
            "admin",
        )
        self.assertEqual(status, 404)
        self.assertIn("分类", missing_category["error"])

    def test_category_with_assignments_cannot_be_deactivated(self):
        category_id = self._create_category("教育单位")
        self._move("第一中学", category_id)

        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "deactivate_category",
            {"id": category_id},
            True,
            "admin",
        )
        self.assertEqual(status, 409)
        self.assertIn("先移动", result["error"])

        self._move("第一中学", None)
        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "deactivate_category",
            {"id": category_id},
            True,
            "admin",
        )
        self.assertEqual(status, 200)
        self.assertTrue(result["deactivated"])

    def test_unknown_action_is_rejected(self):
        result, status = execute_purchaser_action(
            self.database, self.backups, "merge_customer", {}, True, "admin"
        )
        self.assertEqual(status, 400)
        self.assertIn("不支持", result["error"])

    def test_classify_purchaser_nature_matches_keywords(self):
        cases = {
            "示例农村商业银行股份有限公司": "金融机构",
            "示例市经济贸易学校": "教育机构",
            "广东医科大学": "教育机构",
            "示例市消防救援支队": "行政机关",
            "示例市沙田医院": "医疗卫生",
            "示例市桥头镇田新股份经济联合社": "基层自治组织",
            "示例市南城街道元美社区居民委员会": "基层自治组织",
            "某科技有限公司": "企业",
            "示例市文化服务中心": None,
            "": None,
        }
        for name, expected in cases.items():
            result = classify_purchaser_nature(name)
            self.assertEqual(result["category_name"], expected, f"failed: {name}")
            if expected is None:
                self.assertIsNone(result["rule_version"])
                self.assertIsNone(result["matched_keyword"])
            else:
                self.assertEqual(result["rule_version"], "1")
                self.assertTrue(result["matched_keyword"])

        bank = classify_purchaser_nature("示例农村商业银行股份有限公司")
        self.assertEqual(
            bank,
            {
                "category_name": "金融机构",
                "rule_version": "1",
                "matched_keyword": "银行",
            },
        )

    def test_board_exposes_auto_and_unclassified_provenance(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.executemany(
                "INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)",
                [
                    (6, "P-6", "金融项目", "示例农村商业银行股份有限公司", 2026, "2026-07-01"),
                    (7, "P-7", "文化项目", "示例市文化服务中心", 2026, "2026-07-02"),
                ],
            )
            connection.commit()

        board = read_purchaser_board(self.database, self.backups, False)
        financial = next(group for group in board["groups"] if group["name"] == "金融机构")
        bank = next(
            unit for unit in financial["units"]
            if unit["name"] == "示例农村商业银行股份有限公司"
        )
        self.assertEqual(bank["classification_source"], "auto")
        self.assertEqual(bank["rule_version"], "1")
        self.assertEqual(bank["matched_keyword"], "银行")

        unclassified = next(group for group in board["groups"] if group["category"] is None)
        cultural = next(
            unit for unit in unclassified["units"]
            if unit["name"] == "示例市文化服务中心"
        )
        self.assertEqual(cultural["classification_source"], "unclassified")
        self.assertIsNone(cultural["rule_version"])
        self.assertIsNone(cultural["matched_keyword"])

    def test_manual_assignment_overrides_auto_classification(self):
        # "第一中学" 默认自动归入"教育机构"，手动移动后应覆盖
        custom_id = self._create_category("重点客户")
        self._move("第一中学", custom_id)
        board = read_purchaser_board(self.database, self.backups, False)
        custom_group = next(
            g for g in board["groups"]
            if g["category"] and g["category"]["id"] == custom_id
        )
        self.assertEqual(len(custom_group["units"]), 1)
        manual_unit = custom_group["units"][0]
        self.assertEqual(manual_unit["name"], "第一中学")
        self.assertEqual(manual_unit["classification_source"], "manual")
        self.assertIsNone(manual_unit["rule_version"])
        self.assertIsNone(manual_unit["matched_keyword"])
        # "教育机构" 因无单位而不在看板分组中显示（空分类不显示）
        edu_group = next(
            (g for g in board["groups"] if g["name"] == "教育机构"), None
        )
        self.assertIsNone(edu_group)

    def test_manual_assignment_to_inactive_category_never_falls_back_to_auto(self):
        custom_id = self._create_category("已停用的手工分类")
        self._move("第一中学", custom_id)
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                "UPDATE purchaser_categories SET is_active=0 WHERE id=?",
                (custom_id,),
            )
            connection.commit()

        board = read_purchaser_board(self.database, self.backups, False)

        inactive_group = next(
            group for group in board["groups"]
            if group["category"] and group["category"]["id"] == custom_id
        )
        self.assertFalse(inactive_group["category"]["is_active"])
        self.assertTrue(inactive_group["requires_attention"])
        self.assertEqual(inactive_group["classification_status"], "inactive_manual_category")
        unit = inactive_group["units"][0]
        self.assertEqual(unit["name"], "第一中学")
        self.assertEqual(unit["classification_source"], "manual")
        self.assertEqual(unit["classification_status"], "inactive_manual_category")
        self.assertTrue(unit["requires_attention"])
        self.assertIsNone(unit["rule_version"])
        self.assertIsNone(unit["matched_keyword"])
        education = next(
            (group for group in board["groups"] if group["name"] == "教育机构"),
            None,
        )
        self.assertIsNone(education)

    def test_unmatched_name_goes_to_unclassified(self):
        with closing(sqlite3.connect(self.database)) as connection:
            connection.execute(
                "INSERT INTO projects VALUES (?, ?, ?, ?, ?, ?)",
                (6, "P-6", "文化项目", "示例市南城文化服务中心", 2026, "2026-07-01"),
            )
            connection.commit()
        board = read_purchaser_board(self.database, self.backups, False)
        unclassified = next(g for g in board["groups"] if g["category"] is None)
        names = [u["name"] for u in unclassified["units"]]
        self.assertIn("示例市南城文化服务中心", names)

    def test_preset_categories_seeded_with_colors(self):
        board = read_purchaser_board(self.database, self.backups, False)
        categories = {cat["name"]: cat for cat in board["categories"]}
        self.assertTrue(categories["教育机构"]["is_active"])
        self.assertEqual(categories["教育机构"]["color"], "#3B82F6")
        self.assertEqual(categories["金融机构"]["sort_order"], 4)

    def test_move_back_to_unclassified_re_enables_auto(self):
        # 手动移动到自定义分类后移回未分类，应重新触发自动识别
        custom_id = self._create_category("临时分类")
        self._move("第一中学", custom_id)
        self._move("第一中学", None)
        board = read_purchaser_board(self.database, self.backups, False)
        edu_group = next(g for g in board["groups"] if g["name"] == "教育机构")
        self.assertEqual(len(edu_group["units"]), 1)
        self.assertEqual(edu_group["units"][0]["name"], "第一中学")

    def test_restore_auto_removes_only_named_override_and_records_audit(self):
        custom_id = self._create_category("重点客户")
        self._move("第一中学", custom_id)
        self._move("市人民医院", custom_id)

        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "restore_auto_classification",
            {"purchaser_name": "第一中学"},
            True,
            "administrator-a",
        )

        self.assertEqual(status, 200)
        self.assertEqual(result["purchaser_name"], "第一中学")
        self.assertEqual(result["classification_source"], "auto")
        with closing(sqlite3.connect(self.database)) as connection:
            remaining = connection.execute(
                "SELECT purchaser_key, category_id FROM purchaser_category_assignments "
                "ORDER BY purchaser_key"
            ).fetchall()
            audit = connection.execute(
                "SELECT action, purchaser_key, old_category_id, old_category_name, "
                "new_category_id, new_category_name, actor "
                "FROM purchaser_classification_audit ORDER BY id DESC LIMIT 1"
            ).fetchone()

        self.assertEqual(remaining, [("市人民医院", custom_id)])
        self.assertEqual(
            audit,
            (
                "restore_auto_classification",
                "第一中学",
                custom_id,
                "重点客户",
                result["category_id"],
                "教育机构",
                "administrator-a",
            ),
        )
        board = read_purchaser_board(self.database, self.backups, False)
        education = next(group for group in board["groups"] if group["name"] == "教育机构")
        school = next(unit for unit in education["units"] if unit["name"] == "第一中学")
        self.assertEqual(school["classification_source"], "auto")
        self.assertEqual(school["rule_version"], "1")
        self.assertEqual(school["matched_keyword"], "中学")

    def test_restore_auto_locks_before_reading_assignment(self):
        custom_id = self._create_category("重点客户")
        self._move("第一中学", custom_id)
        concurrent_write_results = []
        attempted = False

        def encrypted_connect(path, master_key, readonly):
            connection = sqlite3.connect(path, timeout=0)

            def trace(statement):
                nonlocal attempted
                if attempted or not statement.lstrip().startswith("SELECT a.category_id"):
                    return
                attempted = True
                try:
                    with closing(sqlite3.connect(self.database, timeout=0)) as writer:
                        writer.execute(
                            "UPDATE purchaser_category_assignments "
                            "SET updated_by='concurrent-admin' WHERE purchaser_key='第一中学'"
                        )
                        writer.commit()
                except sqlite3.OperationalError as exc:
                    concurrent_write_results.append(str(exc))
                else:
                    concurrent_write_results.append("write succeeded")

            connection.set_trace_callback(trace)
            return connection

        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "restore_auto_classification",
            {"purchaser_name": "第一中学"},
            True,
            "administrator-a",
            encrypted_connect=encrypted_connect,
        )

        self.assertEqual(status, 200)
        self.assertEqual(result["classification_source"], "auto")
        self.assertEqual(len(concurrent_write_results), 1)
        self.assertIn("locked", concurrent_write_results[0].lower())

    def _create_category(self, name):
        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "upsert_category",
            {"name": name, "color": "#2563EB", "sort_order": 0},
            True,
            "admin",
        )
        self.assertEqual(status, 200)
        return result["category"]["id"]

    def _move(self, name, category_id):
        result, status = execute_purchaser_action(
            self.database,
            self.backups,
            "move_purchaser",
            {"purchaser_name": name, "category_id": category_id},
            True,
            "admin",
        )
        self.assertEqual(status, 200)
        return result


if __name__ == "__main__":
    unittest.main()
