import json
import unittest
from datetime import datetime

from src.backend_patches.project_activity import (
    ActivityCapture,
    build_activity_detail,
    capture_before_write,
    classify_project_write,
    diff_fields,
    read_activity,
    record_activity,
    sanitize_value,
)


class _Field:
    def __init__(self, name):
        self.name = name

    def __eq__(self, value):
        return ("eq", self.name, value)

    def __lt__(self, value):
        return ("lt", self.name, value)

    def desc(self):
        return ("desc", self.name)

    def in_(self, values):
        return ("in", self.name, tuple(values))


class _Query:
    def __init__(self, rows):
        self.rows = list(rows)
        self.limit_value = None

    def filter(self, condition):
        operation, name, value = condition
        if operation == "eq":
            self.rows = [row for row in self.rows if getattr(row, name) == value]
        elif operation == "lt":
            self.rows = [row for row in self.rows if getattr(row, name) < value]
        elif operation == "in":
            self.rows = [row for row in self.rows if getattr(row, name) in value]
        return self

    def order_by(self, ordering):
        _, name = ordering
        self.rows.sort(key=lambda row: getattr(row, name), reverse=True)
        return self

    def limit(self, value):
        self.limit_value = value
        return self

    def all(self):
        if self.limit_value is None:
            return list(self.rows)
        return self.rows[: self.limit_value]


class _Session:
    def __init__(self, logs=None, users=None):
        self.logs = list(logs or [])
        self.users = list(users or [])
        self.added = []
        self.commits = 0
        self.rollbacks = 0

    def add(self, row):
        self.added.append(row)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1

    def query(self, model):
        return _Query(self.users if model is _User else self.logs)


class _DB:
    def __init__(self, logs=None, users=None):
        self.session = _Session(logs, users)


class _OperationLog:
    id = _Field("id")
    user_id = _Field("user_id")
    action_type = _Field("action_type")
    target_type = _Field("target_type")
    target_id = _Field("target_id")

    def __init__(self, **values):
        self.__dict__.update(values)


class _User:
    id = _Field("id")

    def __init__(self, id, username, display_name=""):
        self.id = id
        self.username = username
        self.display_name = display_name


class ProjectActivityClassificationTests(unittest.TestCase):
    def test_classifies_project_business_writes(self):
        cases = [
            ("POST", "/api/projects", {}, "project.create", None),
            ("PUT", "/api/projects/34", {"name": "新名称"}, "project.update", 34),
            ("PUT", "/api/projects/34", {"is_terminated": True}, "project.terminate", 34),
            ("PUT", "/api/projects/34", {"is_terminated": False}, "project.restore", 34),
            ("DELETE", "/api/projects/34", {}, "project.delete", 34),
            ("PUT", "/api/projects/34/stages/7", {"completed": True}, "stage.complete", 34),
            ("PUT", "/api/projects/34/stages/7", {"completed": False}, "stage.undo", 34),
            ("PUT", "/api/projects/34/stages/7", {"planned_at": "2026-08-01"}, "stage.schedule", 34),
            ("POST", "/api/projects/34/registrations", {}, "registration.create", 34),
            ("PUT", "/api/projects/34/registrations/8", {}, "registration.update", 34),
            ("DELETE", "/api/projects/34/registrations/8", {}, "registration.delete", 34),
            ("POST", "/api/projects/34/attachments", {}, "attachment.upload", 34),
            ("POST", "/api/projects/34/clarifications", {}, "clarification.create", 34),
            ("POST", "/api/projects/34/complaints", {}, "complaint.create", 34),
            ("PUT", "/api/projects/34/archive-catalog/bulk", {}, "archive.bulk_update", 34),
            ("POST", "/api/batch/advance-stage", {"project_ids": [34, 35]}, "stage.batch_advance", None),
            ("PUT", "/api/attachments/91", {}, "attachment.update", None),
            ("DELETE", "/api/attachments/91", {}, "attachment.delete", None),
        ]

        for method, path, payload, action, project_id in cases:
            with self.subTest(method=method, path=path, action=action):
                descriptor = classify_project_write(method, path, payload)
                self.assertIsNotNone(descriptor)
                self.assertEqual(descriptor.action, action)
                self.assertEqual(descriptor.project_id, project_id)

    def test_ignores_reads_exports_failed_statuses_and_non_project_writes(self):
        for method, path in [
            ("GET", "/api/projects/34"),
            ("POST", "/api/export"),
            ("PATCH", "/api/settings"),
            ("POST", "/api/attachments/91/save-local"),
            ("POST", "/api/login"),
        ]:
            with self.subTest(method=method, path=path):
                self.assertIsNone(classify_project_write(method, path, {}))

    def test_classifies_each_nested_project_resource_with_a_stable_action(self):
        resources = {
            "stage-checklist": "checklist",
            "lots": "lot",
            "bid-results": "bid_result",
            "notice-deliveries": "notice_delivery",
            "service-fee-invoices": "service_fee_invoice",
            "clarifications": "clarification",
            "complaints": "complaint",
            "archive-catalog": "archive",
            "archive-deliveries": "archive_delivery",
        }
        suffix_by_method = {"POST": "create", "PUT": "update", "DELETE": "delete"}
        for resource, prefix in resources.items():
            for method, suffix in suffix_by_method.items():
                item = "" if method == "POST" else "/9"
                descriptor = classify_project_write(
                    method, f"/api/projects/12/{resource}{item}", {}
                )
                with self.subTest(resource=resource, method=method):
                    self.assertEqual(descriptor.action, f"{prefix}.{suffix}")
                    self.assertEqual(descriptor.project_id, 12)


class ProjectActivitySanitizationTests(unittest.TestCase):
    def test_removes_sensitive_values_and_bounds_free_text(self):
        cleaned = sanitize_value(
            {
                "name": "公开名称",
                "password": "secret",
                "csrf_token": "token",
                "license_key": "key",
                "nested": {"cookie": "session", "notes": "x" * 700},
                "binary": b"payload",
            }
        )

        self.assertEqual(cleaned["name"], "公开名称")
        self.assertNotIn("password", cleaned)
        self.assertNotIn("csrf_token", cleaned)
        self.assertNotIn("license_key", cleaned)
        self.assertNotIn("cookie", cleaned["nested"])
        self.assertEqual(len(cleaned["nested"]["notes"]), 500)
        self.assertEqual(cleaned["binary"], "[binary omitted]")

    def test_diff_contains_only_changed_allowlisted_business_fields(self):
        changes = diff_fields(
            {"name": "旧项目", "budget": 100, "password": "old", "unchanged": "same"},
            {"name": "新项目", "budget": 120, "password": "new", "unchanged": "same"},
        )

        self.assertEqual(
            changes,
            [
                {"field": "name", "before": "旧项目", "after": "新项目"},
                {"field": "budget", "before": 100, "after": 120},
            ],
        )

    def test_deleted_project_uses_the_before_snapshot(self):
        descriptor = classify_project_write("DELETE", "/api/projects/34", {})
        capture = capture_before_write(
            descriptor,
            {},
            {"id": 34, "number": "PRJ-2026-034", "name": "移动应用安全监测"},
        )
        detail = build_activity_detail(capture, {}, None)

        self.assertEqual(
            detail["project"],
            {"id": 34, "number": "PRJ-2026-034", "name": "移动应用安全监测"},
        )
        self.assertEqual(detail["action"], "project.delete")


class ProjectActivityPersistenceTests(unittest.TestCase):
    def test_record_activity_persists_one_sanitized_row(self):
        db = _DB()
        capture = ActivityCapture(
            descriptor=classify_project_write("PUT", "/api/projects/34", {"name": "新名称"}),
            payload={"name": "新名称", "password": "secret"},
            project_before={"id": 34, "number": "PRJ-2026-034", "name": "旧名称"},
        )

        row = record_activity(
            db,
            _OperationLog,
            actor={"id": 7, "username": "zhangsan"},
            request_meta={"ip_address": "127.0.0.1"},
            capture=capture,
            response_payload={"id": 34, "number": "PRJ-2026-034", "name": "新名称"},
        )

        self.assertIs(row, db.session.added[0])
        self.assertEqual(db.session.commits, 1)
        self.assertEqual(row.action_type, "project.update")
        self.assertEqual(row.target_type, "project_activity")
        self.assertEqual(row.target_id, "34")
        detail = json.loads(row.detail_json)
        self.assertEqual(detail["schema"], 1)
        self.assertEqual(detail["project"]["name"], "新名称")
        self.assertNotIn("password", row.detail_json)

    def test_read_activity_paginates_filters_and_formats_actor_label(self):
        logs = []
        for row_id in range(1, 36):
            logs.append(
                _OperationLog(
                    id=row_id,
                    user_id=7 if row_id % 2 else 8,
                    username="zhangsan" if row_id % 2 else "lisi",
                    action_type="project.update" if row_id % 3 else "stage.complete",
                    target_type="project_activity",
                    target_id="34" if row_id < 33 else "35",
                    description="修改项目",
                    detail_json=json.dumps(
                        {
                            "schema": 1,
                            "action": "project.update",
                            "label": "修改项目",
                            "project": {"id": 34, "number": "PRJ-034", "name": "测试项目"},
                            "changes": [],
                        },
                        ensure_ascii=False,
                    ),
                    ip_address="127.0.0.1",
                    created_at="2026-07-29 10:00:00",
                )
            )
        users = [_User(7, "zhangsan", "张三"), _User(8, "lisi", "")]
        db = _DB(logs, users)

        # 非管理员：强制只看自己(user_id=7)的记录，跨主体过滤参数被忽略
        first = read_activity(
            db,
            _OperationLog,
            _User,
            viewer={"id": 7, "is_admin": False},
            limit=30,
        )
        filtered = read_activity(
            db,
            _OperationLog,
            _User,
            viewer={"id": 7, "is_admin": False},
            limit=30,
            before_id=first["next_cursor"],
            user_id=8,
            project_id=34,
            action="project.update",
        )
        admin = read_activity(
            db,
            _OperationLog,
            _User,
            viewer={"id": 1, "is_admin": True},
            limit=30,
            user_id=8,
            project_id=34,
        )

        self.assertEqual(len(first["items"]), 18)  # 35 条中 user_id=7 的奇数行共 18 条
        self.assertEqual(first["items"][0]["id"], 35)
        self.assertEqual(first["items"][0]["actor_label"], "张三 (zhangsan)")
        self.assertEqual(first["items"][1]["actor_label"], "张三 (zhangsan)")
        self.assertEqual(first["next_cursor"], None)  # 仅 18 条自己的记录，无更多分页
        # action=project.update 且 user_id=7：奇数行中非 3 倍数者（1,5,7,11,13,17,19,23,25,29,31,35）
        self.assertEqual(len(filtered["items"]), 12)
        self.assertTrue(all(item["user_id"] == 7 for item in filtered["items"]))
        self.assertEqual(filtered["filters"]["user_id"], None)
        self.assertEqual(filtered["filters"]["project_id"], None)
        # 管理员可跨主体过滤
        self.assertTrue(all(item["user_id"] == 8 for item in admin["items"]))
        self.assertTrue(all(item["project"] == {"id": 34, "number": "PRJ-034", "name": "测试项目"} for item in admin["items"]))
        self.assertEqual(admin["filters"]["user_id"], 8)
        self.assertEqual(admin["filters"]["project_id"], 34)

    def test_read_activity_marks_naive_sqlite_timestamp_as_utc(self):
        log = _OperationLog(
            id=1,
            user_id=7,
            username="zhangsan",
            action_type="project.update",
            target_type="project_activity",
            target_id="34",
            description="修改项目",
            detail_json=json.dumps(
                {
                    "project": {"id": 34, "number": "PRJ-034", "name": "测试项目"},
                    "changes": [],
                },
                ensure_ascii=False,
            ),
            ip_address="127.0.0.1",
            created_at=datetime(2026, 8, 2, 5, 54, 8),
        )
        result = read_activity(
            _DB([log], [_User(7, "zhangsan", "张三")]),
            _OperationLog,
            _User,
            viewer={"id": 1, "is_admin": True},
            limit=30,
        )

        self.assertEqual(result["items"][0]["created_at"], "2026-08-02T05:54:08Z")

    def test_read_activity_rejects_invalid_limits_and_filters(self):
        db = _DB()
        for kwargs in (
            {"limit": 0},
            {"limit": 101},
            {"before_id": "bad"},
            {"action": "drop table"},
        ):
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                read_activity(
                    db,
                    _OperationLog,
                    _User,
                    viewer={"id": 1, "is_admin": False},
                    **kwargs,
                )


if __name__ == "__main__":
    unittest.main()
