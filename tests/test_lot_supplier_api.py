import sys
import unittest
from datetime import datetime
from types import SimpleNamespace
from unittest import mock

from src.backend_patches import app_replacements as subject
from src.backend_patches import lot_supplier_risk


class LotSupplierApiTests(unittest.TestCase):
    class Project:
        pass

    class Lot:
        pass

    def setUp(self):
        self.project = SimpleNamespace(id=7, is_terminated=False, lots=[])
        self.lot = SimpleNamespace(id=11, project_id=7, lot_number="01包", lot_name="办公设备")
        self.request = SimpleNamespace(payload={})
        self.request.get_json = lambda: self.request.payload
        self.session = SimpleNamespace(commit=mock.Mock(), rollback=mock.Mock())

        def get_or_404(model, identity):
            return self.project if model is self.Project else self.lot

        self.db = SimpleNamespace(session=self.session, get_or_404=get_or_404)
        self.old_alias = sys.modules.get("lot_supplier_risk")
        sys.modules["lot_supplier_risk"] = lot_supplier_risk
        subject.db = self.db
        subject.Project = self.Project
        subject.ProjectLot = self.Lot
        subject.request = self.request
        subject.session = {"user_id": 8, "is_admin": False}
        subject.jsonify = lambda value: value
        subject._ensure_project_resource = lambda resource, pid: resource

    def tearDown(self):
        if self.old_alias is None:
            sys.modules.pop("lot_supplier_risk", None)
        else:
            sys.modules["lot_supplier_risk"] = self.old_alias

    def test_manual_liubiao_dispatches_for_authenticated_handler(self):
        self.request.payload = {
            "lot_action": "manual_liubiao",
            "response_count": 2,
            "reason": "投标响应不足",
        }
        with mock.patch.object(lot_supplier_risk, "manual_liubiao", return_value={"status": "liubiao"}) as action:
            response = subject.api_update_lot(7, 11)
        self.assertEqual(response, {"status": "liubiao"})
        action.assert_called_once_with(self.db, self.project, self.lot, 2, "投标响应不足", 8)
        self.session.commit.assert_called_once()

    def test_project_list_enriches_each_summary_with_warning_state(self):
        project = SimpleNamespace(
            to_summary_dict=lambda: {"id": 7, "name": "测试项目"},
        )

        class Query:
            def options(self, *args):
                return self

            def order_by(self, *args):
                return self

            def all(self):
                return [project]

        subject.Project = SimpleNamespace(
            query=Query(),
            stages=object(),
            lots=object(),
            registrations=object(),
            year=SimpleNamespace(desc=lambda: object()),
            number=object(),
        )
        subject.selectinload = lambda value: value
        subject.datetime = datetime
        subject.load_app_settings = lambda: {"supplier_minimums": lot_supplier_risk.DEFAULT_MINIMUMS}
        with mock.patch.object(
            lot_supplier_risk,
            "enrich_project_payload",
            return_value={"id": 7, "lot_supplier_state": {"warning_count": 1}},
        ):
            response = subject.api_projects()

        self.assertEqual(
            response,
            [{"id": 7, "lot_supplier_state": {"warning_count": 1}}],
        )

    def test_restore_requires_admin(self):
        self.request.payload = {"lot_action": "restore", "reason": "批准恢复"}
        response, status = subject.api_update_lot(7, 11)
        self.assertEqual((response, status), ({"error": "只有管理员可以撤销流标"}, 403))
        self.session.commit.assert_not_called()

    def test_admin_can_reprocure_a_lot_after_whole_project_auto_flow(self):
        self.project.is_terminated = True
        subject.session = {"user_id": 8, "is_admin": True}
        self.request.payload = {
            "reprocurement_source_lot_id": 11,
            "procurement_method": "竞争性谈判",
        }
        with mock.patch.object(
            lot_supplier_risk,
            "create_reprocurement",
            return_value={"id": 12, "round_number": 2},
        ) as action:
            response, status = subject.api_create_lot(7)
        self.assertEqual(status, 201)
        self.assertEqual(response["id"], 12)
        self.assertFalse(self.project.is_terminated)
        action.assert_called_once_with(
            self.db, self.project, self.lot, self.request.payload, 8
        )
        self.session.commit.assert_called_once()


if __name__ == "__main__":
    unittest.main()
