"""Stage 4B tests: Shadow-mode bytecode parity & dual-track fallback for business registry routes."""
from __future__ import annotations

import copy
from datetime import date, datetime
import marshal
import os
from pathlib import Path
import sqlite3
import tempfile
import types
import unittest
from unittest.mock import patch

from src.backend_patches import (
    business_input_validation,
    business_registry_routes,
    data_safety,
    runtime_context,
)
from tools import build_candidate, compile_module_patches


BASELINE_EXE = Path(os.environ.get("PM_TEST_LEGACY_BASELINE_EXE", ""))


def _load_core_4b_code_objects() -> dict[str, types.CodeType]:
    if not BASELINE_EXE.is_file():
        return {}
    reader = build_candidate.CArchiveReader(BASELINE_EXE)
    pyz_raw = reader.extract("PYZ.pyz")
    toc, _ = compile_module_patches._read_pyz(pyz_raw)
    app_root = marshal.loads(compile_module_patches._pyz_entry(pyz_raw, toc, "app"))
    code_map: dict[str, types.CodeType] = {}
    for const in app_root.co_consts:
        if isinstance(const, types.CodeType):
            code_map[const.co_name] = const
            for sub in const.co_consts:
                if isinstance(sub, types.CodeType) and sub.co_name == "_business_impl":
                    code_map[f"{const.co_name}._business_impl"] = sub
    return code_map


CORE_CODES = _load_core_4b_code_objects()


class FakeColumn:
    def __init__(self, name: str) -> None:
        self.name = name

    def __eq__(self, other):  # type: ignore[override]
        return ("eq", self.name, other)

    def in_(self, values):
        return ("in", self.name, set(values))

    def asc(self):
        return ("asc", self.name)

    def desc(self):
        return ("desc", self.name)


class FakeEntity:
    def __init__(self, **kwargs) -> None:
        for k, v in kwargs.items():
            setattr(self, k, v)

    def to_dict(self) -> dict:
        out = {}
        for k, v in sorted(self.__dict__.items()):
            if k.startswith("_") or k == "project":
                continue
            if isinstance(v, (date, datetime)):
                out[k] = v.isoformat()
            elif hasattr(v, "to_dict"):
                out[k] = v.to_dict()
            elif isinstance(v, list):
                out[k] = [x.to_dict() if hasattr(x, "to_dict") else x for x in v]
            else:
                out[k] = v
        if getattr(self, "_table_name", None) == "ArchiveCatalogItem" or "document_name" in out:
            out["complete"] = bool(
                not out.get("applicable", True)
                or out.get("has_original")
                or out.get("has_scan")
                or out.get("missing_reason")
            )
        return out


class FakeQuery:
    def __init__(self, items: list[FakeEntity]) -> None:
        self._items = list(items)

    def filter_by(self, **kwargs) -> FakeQuery:
        matched = [
            it
            for it in self._items
            if all(getattr(it, k, None) == v for k, v in kwargs.items())
        ]
        return FakeQuery(matched)

    def filter(self, *conds) -> FakeQuery:
        matched = list(self._items)
        for cond in conds:
            if isinstance(cond, tuple):
                op, col, val = cond
                if op == "eq":
                    matched = [it for it in matched if getattr(it, col, None) == val]
                elif op == "in":
                    matched = [it for it in matched if getattr(it, col, None) in val]
        return FakeQuery(matched)

    def order_by(self, *_args) -> FakeQuery:
        return FakeQuery(list(self._items))

    def all(self) -> list[FakeEntity]:
        return list(self._items)

    def first(self) -> FakeEntity | None:
        return self._items[0] if self._items else None

    def first_or_404(self) -> FakeEntity:
        if not self._items:
            raise LookupError("404")
        return self._items[0]

    def delete(self, synchronize_session: bool = False) -> int:
        count = len(self._items)
        for it in list(self._items):
            if hasattr(it, "_backing_list") and it in it._backing_list:
                it._backing_list.remove(it)
        self._items.clear()
        return count


def _make_model_class(name: str, backing: list[FakeEntity], defaults: dict | None = None):
    defaults = defaults or {}

    class _Model(FakeEntity):
        _table_name = name
        _backing_list = backing
        id = FakeColumn("id")
        project_id = FakeColumn("project_id")
        complaint_id = FakeColumn("complaint_id")
        sort_order = FakeColumn("sort_order")
        created_at = FakeColumn("created_at")
        delivery_date = FakeColumn("delivery_date")
        invoice_date = FakeColumn("invoice_date")
        received_date = FakeColumn("received_date")

        def __init__(self, **kwargs) -> None:
            merged = {"id": None, **defaults}
            merged.update(kwargs)
            super().__init__(**merged)

    _Model.__name__ = name
    return _Model


class FakeRequest:
    def __init__(
        self,
        method: str = "POST",
        json_data: dict | None = None,
        args: dict | None = None,
        files: dict | None = None,
    ) -> None:
        self.method = method
        self._json = json_data
        self.args = args or {}
        self.files = files or {}

    def get_json(self, silent: bool = False):
        return copy.deepcopy(self._json)


def _build_shadow_env(db_path: Path):
    conn = sqlite3.connect(str(db_path))
    conn.execute(
        "CREATE TABLE IF NOT EXISTS shadow_entities ("
        "table_name TEXT NOT NULL, "
        "id INTEGER NOT NULL, "
        "project_id INTEGER, "
        "payload_json TEXT NOT NULL, "
        "PRIMARY KEY (table_name, id))"
    )
    conn.commit()

    store: dict[str, list[FakeEntity]] = {
        "Project": [],
        "ProjectLot": [],
        "SupplierRegistration": [],
        "BidResult": [],
        "NoticeDelivery": [],
        "ArchiveDelivery": [],
        "ServiceFeeInvoice": [],
        "Complaint": [],
        "ComplaintTarget": [],
        "ComplaintIssue": [],
        "ComplaintEvent": [],
        "AnnouncementClarification": [],
        "StageChecklistItem": [],
        "ArchiveCatalogItem": [],
        "Attachment": [],
    }

    p1 = FakeEntity(
        id=1,
        project_name="测试采购项目",
        project_number="PRJ-2026-001",
        is_terminated=False,
        procurement_archive_sent=False,
        stage_checklist_items=[],
        archive_catalog_items=[],
        bid_results=[],
        lots=[],
    )
    lot1 = FakeEntity(id=10, project_id=1, lot_number=1, lot_name="第一包")
    p1.lots.append(lot1)
    reg1 = FakeEntity(id=20, project_id=1, lot_id=10, company_name="甲供应商", review_status="通过")
    store["Project"].append(p1)
    store["ProjectLot"].append(lot1)
    store["SupplierRegistration"].append(reg1)

    chk1 = FakeEntity(
        id=100,
        project_id=1,
        stage_key="archived",
        stage_name="项目归档",
        item_key="archive_catalog_complete",
        title="归档目录已逐项核验",
        required=True,
        completed=False,
        completed_at=None,
        notes="",
        is_custom=False,
    )
    chk2 = FakeEntity(
        id=101,
        project_id=1,
        stage_key="announcement",
        stage_name="采购公告",
        item_key="custom_1",
        title="自定义检查项",
        required=True,
        completed=False,
        completed_at=None,
        notes="",
        is_custom=True,
    )
    p1.stage_checklist_items.extend([chk1, chk2])
    store["StageChecklistItem"].extend([chk1, chk2])

    cat1 = FakeEntity(
        id=200,
        project_id=1,
        category="立项资料",
        document_name="采购委托代理协议",
        sort_order=1,
        applicable=True,
        has_original=True,
        has_scan=False,
        agency_copies=1,
        purchaser_copies=1,
        transferred=False,
        missing_reason="",
        notes="",
        is_custom=False,
        project=p1,
    )
    p1.archive_catalog_items.append(cat1)
    store["ArchiveCatalogItem"].append(cat1)

    models = {}
    for name, items in store.items():
        cls = _make_model_class(name, items)

        class _QueryDesc:
            def __init__(self, backing_items: list[FakeEntity]) -> None:
                self._backing = backing_items

            def __get__(self, obj, owner):
                return FakeQuery(self._backing)

        cls.query = _QueryDesc(items)
        models[name] = cls

    for item in store["StageChecklistItem"]:
        item._backing_list = store["StageChecklistItem"]
    for item in store["ArchiveCatalogItem"]:
        item._backing_list = store["ArchiveCatalogItem"]

    next_ids = {k: 500 for k in store}

    class FakeSession:
        def add(self, obj: FakeEntity) -> None:
            tname = getattr(obj, "_table_name", obj.__class__.__name__)
            backing = store.setdefault(tname, [])
            if getattr(obj, "id", None) is None:
                next_ids[tname] = next_ids.get(tname, 500) + 1
                obj.id = next_ids[tname]
            obj._backing_list = backing
            if obj not in backing:
                backing.append(obj)
            if tname == "ArchiveCatalogItem":
                obj.project = p1
                if obj not in p1.archive_catalog_items:
                    p1.archive_catalog_items.append(obj)
            elif tname == "Complaint":
                if not hasattr(obj, "targets"):
                    obj.targets = []
                if not hasattr(obj, "issues"):
                    obj.issues = []

        def delete(self, obj: FakeEntity) -> None:
            tname = getattr(obj, "_table_name", obj.__class__.__name__)
            backing = store.get(tname, [])
            if obj in backing:
                backing.remove(obj)
            if tname == "ArchiveCatalogItem" and obj in p1.archive_catalog_items:
                p1.archive_catalog_items.remove(obj)

        def flush(self) -> None:
            for tname, items in store.items():
                for obj in items:
                    if getattr(obj, "id", None) is None:
                        next_ids[tname] = next_ids.get(tname, 500) + 1
                        obj.id = next_ids[tname]
            if store["Complaint"]:
                for comp in store["Complaint"]:
                    comp.targets = [
                        t for t in store["ComplaintTarget"] if getattr(t, "complaint_id", None) == comp.id
                    ]
                    comp.issues = [
                        i for i in store["ComplaintIssue"] if getattr(i, "complaint_id", None) == comp.id
                    ]

        def commit(self) -> None:
            self.flush()
            import json
            conn.execute("DELETE FROM shadow_entities")
            for tname, items in sorted(store.items()):
                for obj in sorted(items, key=lambda x: getattr(x, "id", 0)):
                    d = obj.to_dict()
                    d.pop("project", None)
                    conn.execute(
                        "INSERT INTO shadow_entities (table_name, id, project_id, payload_json) VALUES (?, ?, ?, ?)",
                        (
                            tname,
                            int(getattr(obj, "id", 0)),
                            getattr(obj, "project_id", None),
                            json.dumps(d, ensure_ascii=False, sort_keys=True),
                        ),
                    )
            conn.commit()

        def query(self, _expr):
            class _ScalarQuery:
                def filter_by(self, **kwargs):
                    return self

                def scalar(self):
                    return max((getattr(x, "sort_order", 0) for x in store["ArchiveCatalogItem"]), default=0)

            return _ScalarQuery()

    class FakeFunc:
        @staticmethod
        def max(col):
            return ("max", col)

    class FakeDB:
        session = FakeSession()
        func = FakeFunc()

        @staticmethod
        def get_or_404(model_cls, pk: int):
            tname = getattr(model_cls, "_table_name", model_cls.__name__)
            for it in store.get(tname, []):
                if getattr(it, "id", None) == int(pk):
                    return it
            raise LookupError(f"{tname}:{pk} not found")

    fixed_now = datetime(2026, 11, 16, 12, 0, 0)

    class FixedDatetime(datetime):
        @classmethod
        def now(cls, tz=None):
            return fixed_now

    env = {
        "db": FakeDB(),
        **models,
        "request": FakeRequest("GET"),
        "session": {"user_id": 1},
        "jsonify": lambda payload: payload,
        "abort": lambda code: (_ for _ in ()).throw(LookupError(f"HTTP {code}")),
        "date": date,
        "datetime": FixedDatetime,
        "validate_business_input": business_input_validation.validate_business_input,
        "log_operation": lambda *_a, **_kw: None,
        "_recalculate_clarification_deadline": lambda _p: None,
    }
    env["_ensure_project_resource"] = lambda res, pid: business_registry_routes._ensure_project_resource(env, res, pid)
    env["_normalize_project_lot_id"] = lambda raw, pid: business_registry_routes._normalize_project_lot_id(env, raw, pid)
    env["_parse_optional_date"] = lambda val=None: business_registry_routes._parse_optional_date(env, val)
    env["_parse_optional_datetime"] = lambda val=None: business_registry_routes._parse_optional_datetime(env, val)
    env["_replace_complaint_details"] = lambda comp, data, pid: business_registry_routes._replace_complaint_details(env, comp, data, pid)
    env["_apply_clarification_data"] = lambda item, data, pid=None: business_registry_routes._apply_clarification_data(env, item, data, pid)
    env["_sync_archive_checklist"] = lambda proj: business_registry_routes._sync_archive_checklist(env, proj)
    FakeDB.session.commit()
    return env, conn


class Stage4BBusinessRoutesParityTests(unittest.TestCase):
    def setUp(self) -> None:
        self._tmp = tempfile.TemporaryDirectory()
        self.tmp_path = Path(self._tmp.name)

    def tearDown(self) -> None:
        self._tmp.cleanup()

    def _run_core(self, env: dict, func_name: str, *args):
        code = CORE_CODES.get(f"{func_name}._business_impl") or CORE_CODES[func_name]
        fn = types.FunctionType(code, env)
        return fn(*args)

    @unittest.skipUnless(CORE_CODES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_bid_results_and_notice_deliveries(self) -> None:
        env_core, conn_core = _build_shadow_env(self.tmp_path / "core_bid.db")
        env_open, conn_open = _build_shadow_env(self.tmp_path / "open_bid.db")
        try:
            payload = {
                "lot_id": 10,
                "winner_supplier": "甲供应商",
                "win_amount": 98.5,
                "bid_Announcement_date": "2026-11-10",
                "result_announcement_date": "2026-11-15",
                "contract_Date": "2026-11-20",
                "notes": "顺利成交",
            }
            env_core["request"] = FakeRequest("POST", payload)
            env_open["request"] = FakeRequest("POST", payload)
            res_core = self._run_core(env_core, "api_create_bid_result", 1)
            res_open = business_registry_routes.api_create_bid_result(env_open, 1)
            self.assertEqual(res_core, res_open)

            bid_id = res_open[0]["id"]
            upd_payload = {"win_amount": 96.0, "notes": "二次核对"}
            env_core["request"] = FakeRequest("PUT", upd_payload)
            env_open["request"] = FakeRequest("PUT", upd_payload)
            self.assertEqual(
                self._run_core(env_core, "api_update_bid_result", 1, bid_id),
                business_registry_routes.api_update_bid_result(env_open, 1, bid_id),
            )

            notice_payload = {
                "lot_id": 10,
                "notice_type": "成交通知书",
                "recipient_name": "甲供应商",
                "delivery_method": "电子送达",
                "delivery_date": "2026-11-16",
                "tracking_number": "EMS-001",
            }
            env_core["request"] = FakeRequest("POST", notice_payload)
            env_open["request"] = FakeRequest("POST", notice_payload)
            self.assertEqual(
                self._run_core(env_core, "api_create_notice_delivery", 1),
                business_registry_routes.api_create_notice_delivery(env_open, 1),
            )

            self.assertEqual(
                data_safety.database_fingerprint(conn_core),
                data_safety.database_fingerprint(conn_open),
            )
        finally:
            conn_core.close()
            conn_open.close()

    @unittest.skipUnless(CORE_CODES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_archive_delivery_and_service_fee_invoice(self) -> None:
        env_core, conn_core = _build_shadow_env(self.tmp_path / "core_inv.db")
        env_open, conn_open = _build_shadow_env(self.tmp_path / "open_inv.db")
        try:
            arc_payload = {
                "lot_id": 10,
                "recipient_unit": "某采购人",
                "recipient_person": "张工",
                "delivery_method": "当面移交",
                "delivery_date": "2026-11-16",
                "box_count": 3,
                "content_summary": "全套归档卷宗",
            }
            env_core["request"] = FakeRequest("POST", arc_payload)
            env_open["request"] = FakeRequest("POST", arc_payload)
            self.assertEqual(
                self._run_core(env_core, "api_create_archive_delivery", 1),
                business_registry_routes.api_create_archive_delivery(env_open, 1),
            )

            inv_payload = {
                "lot_id": 10,
                "payer_name": "甲供应商",
                "invoice_type": "增值税专用发票",
                "invoice_number": "INV-20261116",
                "invoice_amount": 1.5,
                "received_amount": 1.5,
                "payment_status": "已到账",
            }
            env_core["request"] = FakeRequest("POST", inv_payload)
            env_open["request"] = FakeRequest("POST", inv_payload)
            self.assertEqual(
                self._run_core(env_core, "api_create_service_fee_invoice", 1),
                business_registry_routes.api_create_service_fee_invoice(env_open, 1),
            )

            self.assertEqual(
                data_safety.database_fingerprint(conn_core),
                data_safety.database_fingerprint(conn_open),
            )
        finally:
            conn_core.close()
            conn_open.close()

    @unittest.skipUnless(CORE_CODES, "Baseline v5.8.40 EXE not present")
    def test_shadow_parity_complaints_clarifications_and_archive_catalog(self) -> None:
        env_core, conn_core = _build_shadow_env(self.tmp_path / "core_comp.db")
        env_open, conn_open = _build_shadow_env(self.tmp_path / "open_comp.db")
        try:
            comp_payload = {
                "lot_id": 10,
                "category": "质疑",
                "complainant": "乙供应商",
                "contact_person": "李四",
                "contact_phone": "13800138000",
                "summary": "评分标准质疑",
                "targets": [{"target_type": "评审结果", "target_name": "综合评分项"}],
                "issues": [{"issue_no": 1, "issue_type": "评分标准", "summary": "分值设置偏高"}],
            }
            env_core["request"] = FakeRequest("POST", comp_payload)
            env_open["request"] = FakeRequest("POST", comp_payload)
            res_core = self._run_core(env_core, "api_create_complaint", 1)
            res_open = business_registry_routes.api_create_complaint(env_open, 1)
            self.assertEqual(res_core, res_open)

            cid = res_open[0]["id"]
            status_payload = {"status": "已答复"}
            env_core["request"] = FakeRequest("POST", status_payload)
            env_open["request"] = FakeRequest("POST", status_payload)
            self.assertEqual(
                self._run_core(env_core, "api_set_complaint_status", 1, cid),
                business_registry_routes.api_set_complaint_status(env_open, 1, cid),
            )

            clar_payload = {
                "lot_id": 10,
                "clarification_type": "更正公告",
                "title": "关于开标时间顺延的更正",
                "reason": "专家抽取调整",
                "content": "顺延3日",
                "affects_deadline": True,
                "extended_deadline": "2026-11-25T09:30:00",
            }
            env_core["request"] = FakeRequest("POST", clar_payload)
            env_open["request"] = FakeRequest("POST", clar_payload)
            self.assertEqual(
                self._run_core(env_core, "api_create_clarification", 1),
                business_registry_routes.api_create_clarification(env_open, 1),
            )

            bulk_payload = {
                "ids": [200],
                "has_scan": True,
                "transferred": True,
                "agency_copies": 2,
            }
            env_core["request"] = FakeRequest("POST", bulk_payload)
            env_open["request"] = FakeRequest("POST", bulk_payload)
            self.assertEqual(
                self._run_core(env_core, "api_bulk_update_archive_catalog", 1),
                business_registry_routes.api_bulk_update_archive_catalog(env_open, 1),
            )
            self.assertTrue(env_open["StageChecklistItem"].query.filter_by(id=100).first().completed)

            self.assertEqual(
                data_safety.database_fingerprint(conn_core),
                data_safety.database_fingerprint(conn_open),
            )
        finally:
            conn_core.close()
            conn_open.close()

    def test_dual_track_fallback_switch_for_stage_4b(self) -> None:
        env, conn = _build_shadow_env(self.tmp_path / "dual_4b.db")
        try:
            class FakeFlaskApp:
                def __init__(self) -> None:
                    self.view_functions = {
                        "api_get_bid_results": lambda pid: ({"legacy": True, "pid": pid}, 200)
                    }
                    self.extensions = {}

            fake_app = FakeFlaskApp()
            env["app"] = fake_app
            env["login_required"] = lambda f: f
            ctx = runtime_context.register_runtime_context(env, app=fake_app, db=env["db"])
            info = business_registry_routes.register(ctx, fake_app)
            self.assertEqual(info["signature"], "business-registry-routes-v1")
            self.assertIn("api_get_bid_results", info["installed_views"])

            # Default open-source route active
            self.assertEqual(fake_app.view_functions["api_get_bid_results"](1), [])

            # Legacy fallback active when PM_USE_LEGACY_CORE_ROUTES=all
            with patch.dict(os.environ, {"PM_USE_LEGACY_CORE_ROUTES": "all"}):
                self.assertEqual(
                    fake_app.view_functions["api_get_bid_results"](1),
                    ({"legacy": True, "pid": 1}, 200),
                )
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
