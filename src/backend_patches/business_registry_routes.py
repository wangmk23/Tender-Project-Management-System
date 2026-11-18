"""Business registration routes: bid results, notices, archive deliveries/catalog, invoices, complaints, clarifications, and checklist items (Stage 4B).

business-registry-routes-v1
"""
from __future__ import annotations

from collections.abc import Mapping
from datetime import date as _default_date, datetime as _default_datetime
import os
from pathlib import Path
from typing import Any
from urllib.parse import quote

BUSINESS_REGISTRY_ROUTES_SIGNATURE = "business-registry-routes-v1"

_DEFAULT_METHODS = (
    "公开招标",
    "竞争性磋商",
    "竞争性谈判",
    "邀请招标",
    "网上竞价",
    "单一来源",
    "遴选",
    "直选",
)

STAGE_4B_HELPER_NAMES: tuple[str, ...] = (
    "_ensure_project_resource",
    "_normalize_project_lot_id",
    "_parse_optional_date",
    "_parse_optional_datetime",
    "_replace_complaint_details",
    "_apply_clarification_data",
    "_sync_archive_checklist",
)

STAGE_4B_ROUTE_ENDPOINTS: tuple[str, ...] = (
    "api_get_bid_results",
    "api_create_bid_result",
    "api_update_bid_result",
    "api_delete_bid_result",
    "api_get_notice_deliveries",
    "api_create_notice_delivery",
    "api_update_notice_delivery",
    "api_delete_notice_delivery",
    "api_get_archive_deliveries",
    "api_create_archive_delivery",
    "api_update_archive_delivery",
    "api_delete_archive_delivery",
    "api_get_service_fee_invoices",
    "api_create_service_fee_invoice",
    "api_update_service_fee_invoice",
    "api_delete_service_fee_invoice",
    "api_get_complaints",
    "api_create_complaint",
    "api_update_complaint",
    "api_set_complaint_status",
    "api_create_complaint_event",
    "api_upload_complaint_attachments",
    "api_upload_complaint_event_attachments",
    "api_download_complaint_attachment",
    "api_create_clarification",
    "api_upload_clarification_attachments",
    "api_update_delete_stage_checklist_item",
    "api_create_archive_catalog_item",
    "api_bulk_update_archive_catalog",
    "api_update_delete_archive_catalog_item",
)


def _ctx(ctx: Any = None, *, depth: int = 2):
    try:
        import runtime_context
    except ModuleNotFoundError:
        from src.backend_patches import runtime_context
    if ctx is None:
        return runtime_context.current_context(depth=depth)
    return runtime_context.get_runtime_context(ctx)


def should_use_legacy_route(name: str, env: Mapping[str, str] | None = None) -> bool:
    source = env if env is not None else os.environ
    raw = str(source.get("PM_USE_LEGACY_CORE_ROUTES", "") or "").strip()
    if not raw:
        return False
    lowered = raw.lower()
    if lowered in {"1", "true", "yes", "all", "*"}:
        return True
    tokens = {item.strip() for item in raw.split(",") if item.strip()}
    return name in tokens


def _validate_business_payload(ctx: Any, endpoint: str) -> Any:
    request = ctx.get("request")
    jsonify = ctx.get("jsonify", lambda v: v)
    if getattr(request, "method", "POST") == "DELETE":
        return None
    payload = request.get_json(silent=True)
    try:
        import business_input_validation
    except ModuleNotFoundError:
        from src.backend_patches import business_input_validation
    methods = ctx.get("METHODS", _DEFAULT_METHODS)
    error = business_input_validation.validate_business_input(endpoint, payload, methods)
    if error:
        return jsonify({"error": error}), 400
    return None


def _default_abort(code: int, description: str | None = None):
    try:
        from flask import abort as flask_abort

        if description is not None:
            return flask_abort(code, description=description)
        return flask_abort(code)
    except Exception as exc:
        raise RuntimeError(f"HTTP {code}: {description or ''}") from exc


# ---------------------------------------------------------------------------
# 1. Core Business Helpers
# ---------------------------------------------------------------------------

def _ensure_project_resource(ctx_or_resource: Any, resource_or_pid: Any = None, pid: int | None = None):
    if pid is None:
        resource = ctx_or_resource
        pid = int(resource_or_pid)
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_resource, depth=2)
        resource = resource_or_pid
        pid = int(pid)
    abort = ctx.get("abort", _default_abort)
    if not resource or resource.project_id != pid:
        abort(404)
    return resource


def _normalize_project_lot_id(ctx_or_raw: Any, raw_or_pid: Any = None, pid: int | None = None):
    if pid is None:
        raw_lot_id = ctx_or_raw
        pid = int(raw_or_pid)
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_raw, depth=2)
        raw_lot_id = raw_or_pid
        pid = int(pid)
    if raw_lot_id in (None, "", 0):
        return None
    abort = ctx.get("abort", _default_abort)
    db = ctx.get("db")
    ProjectLot = ctx.get("ProjectLot")
    try:
        lot_id = int(raw_lot_id)
    except (TypeError, ValueError):
        abort(400, description="无效的包/标段")
        return None
    _ensure_project_resource(ctx, db.get_or_404(ProjectLot, lot_id), pid)
    return lot_id


_MISSING_VAL = object()


def _parse_optional_date(ctx_or_val: Any = None, value: Any = _MISSING_VAL):
    if value is _MISSING_VAL and not isinstance(ctx_or_val, Mapping) and not hasattr(ctx_or_val, "signature"):
        value = ctx_or_val
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_val, depth=2)
        if value is _MISSING_VAL:
            value = None
    date_cls = ctx.get("date", _default_date)
    try:
        return date_cls.fromisoformat(value) if value else None
    except (TypeError, ValueError):
        return None


def _parse_optional_datetime(ctx_or_val: Any = None, value: Any = _MISSING_VAL):
    if value is _MISSING_VAL and not isinstance(ctx_or_val, Mapping) and not hasattr(ctx_or_val, "signature"):
        value = ctx_or_val
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_val, depth=2)
        if value is _MISSING_VAL:
            value = None
    dt_cls = ctx.get("datetime", _default_datetime)
    try:
        return dt_cls.fromisoformat(value) if value else None
    except (TypeError, ValueError):
        return None


def _replace_complaint_details(ctx_or_comp: Any, comp_or_data: Any = None, data_or_pid: Any = None, pid: int | None = None) -> None:
    """Replace structured targets/issues supplied by the editor in one transaction."""
    if pid is None:
        comp = ctx_or_comp
        data = comp_or_data
        pid = int(data_or_pid)
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_comp, depth=2)
        comp = comp_or_data
        data = data_or_pid
        pid = int(pid)
    ComplaintTarget = ctx.get("ComplaintTarget")
    ComplaintIssue = ctx.get("ComplaintIssue")

    if "targets" in data:
        comp.targets.clear()
        for item in data.get("targets") or []:
            name = str(item.get("object_name") or "").strip()
            if not name and not item.get("matter"):
                continue
            comp.targets.append(
                ComplaintTarget(
                    object_type=str(item.get("object_type") or "其他")[:40],
                    object_name=name[:200],
                    lot_id=_normalize_project_lot_id(ctx, item.get("lot_id"), pid),
                    matter=str(item.get("matter") or "").strip(),
                    needs_statement=bool(item.get("needs_statement")),
                    response_deadline=_parse_optional_date(ctx, item.get("response_deadline")),
                )
            )
    if "issues" in data:
        comp.issues.clear()
        for index, item in enumerate(data.get("issues") or [], 1):
            if not str(item.get("title") or item.get("content") or "").strip():
                continue
            comp.issues.append(
                ComplaintIssue(
                    sequence=index,
                    title=str(item.get("title") or "").strip()[:200],
                    content=str(item.get("content") or "").strip(),
                    target_name=str(item.get("target_name") or "").strip()[:200],
                    lot_id=_normalize_project_lot_id(ctx, item.get("lot_id"), pid),
                    facts=str(item.get("facts") or "").strip(),
                    legal_basis=str(item.get("legal_basis") or "").strip(),
                    handling_opinion=str(item.get("handling_opinion") or "").strip(),
                    conclusion=str(item.get("conclusion") or "待认定")[:20],
                    affects_result=bool(item.get("affects_result")),
                )
            )


def _apply_clarification_data(ctx_or_item: Any, item_or_data: Any = None, data_or_pid: Any = None, pid: int | None = None) -> None:
    if pid is None:
        item = ctx_or_item
        data = item_or_data
        pid = int(data_or_pid)
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_item, depth=2)
        item = item_or_data
        data = data_or_pid
        pid = int(pid)
    if "lot_id" in data:
        item.lot_id = _normalize_project_lot_id(ctx, data.get("lot_id"), pid)
    for field in ("clarification_type", "title", "content", "notified_suppliers", "notes"):
        if field in data:
            setattr(item, field, str(data.get(field) or "").strip())
    if "publish_date" in data:
        item.publish_date = _parse_optional_date(ctx, data.get("publish_date"))
    if "affects_deadline" in data:
        item.affects_deadline = bool(data.get("affects_deadline"))
    if "original_deadline" in data:
        item.original_deadline = _parse_optional_datetime(ctx, data.get("original_deadline"))
    if "new_deadline" in data:
        item.new_deadline = _parse_optional_datetime(ctx, data.get("new_deadline"))


def _sync_archive_checklist(ctx_or_project: Any, project: Any = None) -> None:
    if project is None and not isinstance(ctx_or_project, Mapping) and not hasattr(ctx_or_project, "signature"):
        project = ctx_or_project
        ctx = _ctx(None, depth=2)
    else:
        ctx = _ctx(ctx_or_project, depth=2)
    dt_cls = ctx.get("datetime", _default_datetime)
    applicable = [item for item in project.archive_catalog_items if item.applicable]
    catalog_complete = bool(applicable) and all(item.to_dict()["complete"] for item in applicable)
    checks = {
        item.title: item
        for item in project.stage_checklist_items
        if item.stage_key == "archived"
    }
    mappings = {
        "归档目录已逐项核验": catalog_complete,
        "采购人存档资料移交情况已登记": bool(project.procurement_archive_sent),
    }
    for title, completed in mappings.items():
        item = checks.get(title)
        if not item:
            continue
        item.completed = completed
        item.completed_at = dt_cls.now() if completed else None


# ---------------------------------------------------------------------------
# 2. Bid Results Routes
# ---------------------------------------------------------------------------

def api_get_bid_results(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, jsonify = ctx.get("db"), ctx.get("Project"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    return jsonify([b.to_dict() for b in p.bid_results])


def api_create_bid_result(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    err = _validate_business_payload(ctx, "api_create_bid_result")
    if err is not None:
        return err
    db, Project, BidResult = ctx.get("db"), ctx.get("Project"), ctx.get("BidResult")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    if p.is_terminated:
        return jsonify({"error": "项目已关闭"}), 400
    data = request.get_json() or {}
    br = BidResult(
        project_id=pid,
        lot_id=_normalize_project_lot_id(ctx, data.get("lot_id"), pid),
        winning_supplier=data.get("winning_supplier", ""),
        winning_amount=data.get("winning_amount") if data.get("winning_amount") not in (None, "") else None,
        discount_rate=data.get("discount_rate", ""),
        is_shortlisted=data.get("is_shortlisted", False),
        notes=data.get("notes", ""),
    )
    db.session.add(br)
    db.session.commit()
    return jsonify(br.to_dict()), 201


def api_update_bid_result(ctx_or_pid: Any, pid_or_bid: int, bid: int | None = None):
    if bid is None and isinstance(ctx_or_pid, int):
        pid, bid, ctx = ctx_or_pid, int(pid_or_bid), _ctx(None, depth=2)
    else:
        ctx, pid, bid = _ctx(ctx_or_pid, depth=2), int(pid_or_bid), int(bid)
    err = _validate_business_payload(ctx, "api_update_bid_result")
    if err is not None:
        return err
    db, BidResult = ctx.get("db"), ctx.get("BidResult")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    br = _ensure_project_resource(ctx, db.get_or_404(BidResult, bid), pid)
    data = request.get_json() or {}
    if "lot_id" in data:
        br.lot_id = _normalize_project_lot_id(ctx, data.get("lot_id"), pid)
    for f in ("winning_supplier", "discount_rate", "is_shortlisted", "notes"):
        if f in data:
            setattr(br, f, data[f])
    if "winning_amount" in data:
        br.winning_amount = data["winning_amount"] if data["winning_amount"] not in (None, "") else None
    db.session.commit()
    return jsonify(br.to_dict())


def api_delete_bid_result(ctx_or_pid: Any, pid_or_bid: int, bid: int | None = None):
    if bid is None and isinstance(ctx_or_pid, int):
        pid, bid, ctx = ctx_or_pid, int(pid_or_bid), _ctx(None, depth=2)
    else:
        ctx, pid, bid = _ctx(ctx_or_pid, depth=2), int(pid_or_bid), int(bid)
    db, BidResult, jsonify = ctx.get("db"), ctx.get("BidResult"), ctx.get("jsonify", lambda v: v)
    br = _ensure_project_resource(ctx, db.get_or_404(BidResult, bid), pid)
    db.session.delete(br)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 3. Notice Deliveries Routes
# ---------------------------------------------------------------------------

def api_get_notice_deliveries(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, jsonify = ctx.get("db"), ctx.get("Project"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    return jsonify([n.to_dict() for n in p.notice_deliveries])


def api_create_notice_delivery(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    err = _validate_business_payload(ctx, "api_create_notice_delivery")
    if err is not None:
        return err
    db, Project, NoticeDelivery = ctx.get("db"), ctx.get("Project"), ctx.get("NoticeDelivery")
    request, jsonify, date_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("date", _default_date)
    p = db.get_or_404(Project, pid)
    if p.is_terminated:
        return jsonify({"error": "项目已关闭"}), 400
    data = request.get_json() or {}
    pd = data.get("pickup_date")
    try:
        pd = date_cls.fromisoformat(pd) if pd else None
    except Exception:
        pd = None
    nd = NoticeDelivery(
        project_id=pid,
        lot_id=_normalize_project_lot_id(ctx, data.get("lot_id"), pid),
        supplier_name=data.get("supplier_name", ""),
        delivery_method=data.get("delivery_method", "现场"),
        mailing_address=data.get("mailing_address", ""),
        contact_name=data.get("contact_name", ""),
        contact_phone=data.get("contact_phone", ""),
        pickup_date=pd,
        notes=data.get("notes", ""),
    )
    db.session.add(nd)
    db.session.commit()
    return jsonify(nd.to_dict()), 201


def api_update_notice_delivery(ctx_or_pid: Any, pid_or_nid: int, nid: int | None = None):
    if nid is None and isinstance(ctx_or_pid, int):
        pid, nid, ctx = ctx_or_pid, int(pid_or_nid), _ctx(None, depth=2)
    else:
        ctx, pid, nid = _ctx(ctx_or_pid, depth=2), int(pid_or_nid), int(nid)
    err = _validate_business_payload(ctx, "api_update_notice_delivery")
    if err is not None:
        return err
    db, NoticeDelivery = ctx.get("db"), ctx.get("NoticeDelivery")
    request, jsonify, date_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("date", _default_date)
    nd = _ensure_project_resource(ctx, db.get_or_404(NoticeDelivery, nid), pid)
    data = request.get_json() or {}
    if "lot_id" in data:
        nd.lot_id = _normalize_project_lot_id(ctx, data.get("lot_id"), pid)
    for f in ("supplier_name", "delivery_method", "mailing_address", "contact_name", "contact_phone", "notes"):
        if f in data:
            setattr(nd, f, data[f])
    if "pickup_date" in data:
        try:
            nd.pickup_date = date_cls.fromisoformat(data["pickup_date"]) if data["pickup_date"] else None
        except Exception:
            pass
    db.session.commit()
    return jsonify(nd.to_dict())


def api_delete_notice_delivery(ctx_or_pid: Any, pid_or_nid: int, nid: int | None = None):
    if nid is None and isinstance(ctx_or_pid, int):
        pid, nid, ctx = ctx_or_pid, int(pid_or_nid), _ctx(None, depth=2)
    else:
        ctx, pid, nid = _ctx(ctx_or_pid, depth=2), int(pid_or_nid), int(nid)
    db, NoticeDelivery, jsonify = ctx.get("db"), ctx.get("NoticeDelivery"), ctx.get("jsonify", lambda v: v)
    nd = _ensure_project_resource(ctx, db.get_or_404(NoticeDelivery, nid), pid)
    db.session.delete(nd)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 4. Archive Deliveries & Service Fee Invoices Routes
# ---------------------------------------------------------------------------

def api_get_archive_deliveries(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, jsonify = ctx.get("db"), ctx.get("Project"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    return jsonify([a.to_dict() for a in p.archive_deliveries])


def api_create_archive_delivery(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    err = _validate_business_payload(ctx, "api_create_archive_delivery")
    if err is not None:
        return err
    db, Project, ArchiveDelivery = ctx.get("db"), ctx.get("Project"), ctx.get("ArchiveDelivery")
    request, jsonify, date_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("date", _default_date)
    p = db.get_or_404(Project, pid)
    if p.is_terminated:
        return jsonify({"error": "项目已关闭"}), 400
    data = request.get_json() or {}
    sd = data.get("sent_date")
    try:
        sd = date_cls.fromisoformat(sd) if sd else None
    except Exception:
        sd = None
    ad = ArchiveDelivery(
        project_id=pid,
        recipient=data.get("recipient", ""),
        address=data.get("address", ""),
        contact=data.get("contact", ""),
        phone=data.get("phone", ""),
        sent_date=sd,
        tracking_number=data.get("tracking_number", ""),
        notes=data.get("notes", ""),
    )
    db.session.add(ad)
    db.session.commit()
    return jsonify(ad.to_dict()), 201


def api_update_archive_delivery(ctx_or_pid: Any, pid_or_aid: int, aid: int | None = None):
    if aid is None and isinstance(ctx_or_pid, int):
        pid, aid, ctx = ctx_or_pid, int(pid_or_aid), _ctx(None, depth=2)
    else:
        ctx, pid, aid = _ctx(ctx_or_pid, depth=2), int(pid_or_aid), int(aid)
    err = _validate_business_payload(ctx, "api_update_archive_delivery")
    if err is not None:
        return err
    db, ArchiveDelivery = ctx.get("db"), ctx.get("ArchiveDelivery")
    request, jsonify, date_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("date", _default_date)
    ad = _ensure_project_resource(ctx, db.get_or_404(ArchiveDelivery, aid), pid)
    data = request.get_json() or {}
    for f in ("recipient", "address", "contact", "phone", "tracking_number", "notes"):
        if f in data:
            setattr(ad, f, data[f])
    if "sent_date" in data:
        try:
            ad.sent_date = date_cls.fromisoformat(data["sent_date"]) if data["sent_date"] else None
        except Exception:
            pass
    db.session.commit()
    return jsonify(ad.to_dict())


def api_delete_archive_delivery(ctx_or_pid: Any, pid_or_aid: int, aid: int | None = None):
    if aid is None and isinstance(ctx_or_pid, int):
        pid, aid, ctx = ctx_or_pid, int(pid_or_aid), _ctx(None, depth=2)
    else:
        ctx, pid, aid = _ctx(ctx_or_pid, depth=2), int(pid_or_aid), int(aid)
    db, ArchiveDelivery, jsonify = ctx.get("db"), ctx.get("ArchiveDelivery"), ctx.get("jsonify", lambda v: v)
    ad = _ensure_project_resource(ctx, db.get_or_404(ArchiveDelivery, aid), pid)
    db.session.delete(ad)
    db.session.commit()
    return jsonify({"ok": True})


def api_get_service_fee_invoices(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, jsonify = ctx.get("db"), ctx.get("Project"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    return jsonify([i.to_dict() for i in p.service_fee_invoices])


def api_create_service_fee_invoice(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    err = _validate_business_payload(ctx, "api_create_service_fee_invoice")
    if err is not None:
        return err
    db, Project, ServiceFeeInvoice = ctx.get("db"), ctx.get("Project"), ctx.get("ServiceFeeInvoice")
    request, jsonify, date_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("date", _default_date)
    p = db.get_or_404(Project, pid)
    if p.is_terminated:
        return jsonify({"error": "项目已关闭"}), 400
    data = request.get_json() or {}
    inv_date = data.get("invoice_date")
    try:
        inv_date = date_cls.fromisoformat(inv_date) if inv_date else None
    except Exception:
        inv_date = None
    inv = ServiceFeeInvoice(
        project_id=pid,
        lot_id=_normalize_project_lot_id(ctx, data.get("lot_id"), pid),
        invoice_number=data.get("invoice_number", ""),
        invoice_date=inv_date,
        amount=data.get("amount") if data.get("amount") not in (None, "") else None,
        notes=data.get("notes", ""),
    )
    db.session.add(inv)
    db.session.commit()
    return jsonify(inv.to_dict()), 201


def api_update_service_fee_invoice(ctx_or_pid: Any, pid_or_iid: int, iid: int | None = None):
    if iid is None and isinstance(ctx_or_pid, int):
        pid, iid, ctx = ctx_or_pid, int(pid_or_iid), _ctx(None, depth=2)
    else:
        ctx, pid, iid = _ctx(ctx_or_pid, depth=2), int(pid_or_iid), int(iid)
    err = _validate_business_payload(ctx, "api_update_service_fee_invoice")
    if err is not None:
        return err
    db, ServiceFeeInvoice = ctx.get("db"), ctx.get("ServiceFeeInvoice")
    request, jsonify, date_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("date", _default_date)
    inv = _ensure_project_resource(ctx, db.get_or_404(ServiceFeeInvoice, iid), pid)
    data = request.get_json() or {}
    if "lot_id" in data:
        inv.lot_id = _normalize_project_lot_id(ctx, data.get("lot_id"), pid)
    for f in ("invoice_number", "notes"):
        if f in data:
            setattr(inv, f, data[f])
    if "amount" in data:
        inv.amount = data["amount"] if data["amount"] not in (None, "") else None
    if "invoice_date" in data:
        try:
            inv.invoice_date = date_cls.fromisoformat(data["invoice_date"]) if data["invoice_date"] else None
        except Exception:
            pass
    db.session.commit()
    return jsonify(inv.to_dict())


def api_delete_service_fee_invoice(ctx_or_pid: Any, pid_or_iid: int, iid: int | None = None):
    if iid is None and isinstance(ctx_or_pid, int):
        pid, iid, ctx = ctx_or_pid, int(pid_or_iid), _ctx(None, depth=2)
    else:
        ctx, pid, iid = _ctx(ctx_or_pid, depth=2), int(pid_or_iid), int(iid)
    db, ServiceFeeInvoice, jsonify = ctx.get("db"), ctx.get("ServiceFeeInvoice"), ctx.get("jsonify", lambda v: v)
    inv = _ensure_project_resource(ctx, db.get_or_404(ServiceFeeInvoice, iid), pid)
    db.session.delete(inv)
    db.session.commit()
    return jsonify({"ok": True})


# ---------------------------------------------------------------------------
# 5. Complaints, Events & Clarifications Routes
# ---------------------------------------------------------------------------

def api_get_complaints(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, jsonify = ctx.get("db"), ctx.get("Project"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    return jsonify([c.to_dict() for c in p.complaints])


def api_create_complaint(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    err = _validate_business_payload(ctx, "api_create_complaint")
    if err is not None:
        return err
    db, Project, Complaint = ctx.get("db"), ctx.get("Project"), ctx.get("Complaint")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    if p.is_terminated:
        return jsonify({"error": "项目已关闭"}), 400
    data = request.get_json() or {}
    sd = _parse_optional_date(ctx, data.get("submit_date"))
    rd = _parse_optional_date(ctx, data.get("reply_date"))
    comp = Complaint(
        project_id=pid,
        complaint_type=data.get("complaint_type", "质疑"),
        lot_id=_normalize_project_lot_id(ctx, data.get("lot_id"), pid),
        challenger=data.get("challenger", ""),
        challenged_party=data.get("challenged_party", ""),
        company_name=data.get("challenger", "") or data.get("company_name", ""),
        content=data.get("content", ""),
        submit_date=sd,
        reply_content=data.get("reply_content", ""),
        reply_date=rd,
        status=data.get("status", "待处理"),
        challenge_category=data.get("challenge_category", "采购结果质疑"),
        contact_name=data.get("contact_name", ""),
        contact_info=data.get("contact_info", ""),
        reply_deadline=_parse_optional_date(ctx, data.get("reply_deadline")),
        requests=data.get("requests", ""),
        notes=data.get("notes", ""),
    )
    db.session.add(comp)
    _replace_complaint_details(ctx, comp, data, pid)
    db.session.commit()
    return jsonify(comp.to_dict()), 201


def api_update_complaint(ctx_or_pid: Any, pid_or_cid: int, cid: int | None = None):
    if cid is None and isinstance(ctx_or_pid, int):
        pid, cid, ctx = ctx_or_pid, int(pid_or_cid), _ctx(None, depth=2)
    else:
        ctx, pid, cid = _ctx(ctx_or_pid, depth=2), int(pid_or_cid), int(cid)
    err = _validate_business_payload(ctx, "api_update_complaint")
    if err is not None:
        return err
    db, Complaint = ctx.get("db"), ctx.get("Complaint")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    comp = _ensure_project_resource(ctx, db.get_or_404(Complaint, cid), pid)
    data = request.get_json() or {}
    if "lot_id" in data:
        comp.lot_id = _normalize_project_lot_id(ctx, data.get("lot_id"), pid)
    for f in (
        "complaint_type",
        "challenger",
        "challenged_party",
        "company_name",
        "content",
        "reply_content",
        "status",
        "challenge_category",
        "contact_name",
        "contact_info",
        "requests",
        "notes",
    ):
        if f in data:
            setattr(comp, f, data[f] if data[f] is not None else "")
    for df in ("submit_date", "reply_date", "reply_deadline"):
        if df in data:
            try:
                setattr(comp, df, _parse_optional_date(ctx, data[df]))
            except Exception:
                pass
    _replace_complaint_details(ctx, comp, data, pid)
    db.session.commit()
    return jsonify(comp.to_dict())


def api_set_complaint_status(ctx_or_pid: Any, pid_or_cid: int, cid: int | None = None):
    if cid is None and isinstance(ctx_or_pid, int):
        pid, cid, ctx = ctx_or_pid, int(pid_or_cid), _ctx(None, depth=2)
    else:
        ctx, pid, cid = _ctx(ctx_or_pid, depth=2), int(pid_or_cid), int(cid)
    db, Complaint = ctx.get("db"), ctx.get("Complaint")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    comp = _ensure_project_resource(ctx, db.get_or_404(Complaint, cid), pid)
    data = request.get_json() or {}
    action = data.get("action")
    if action == "resolve":
        comp.status = "已解决"
        comp.complaint_type = "质疑"
    elif action == "escalate":
        comp.status = "已转投诉"
        comp.complaint_type = "投诉"
    else:
        return jsonify({"error": "未知操作"}), 400
    db.session.commit()
    return jsonify(comp.to_dict())


def api_create_complaint_event(ctx_or_pid: Any, pid_or_cid: int, cid: int | None = None):
    if cid is None and isinstance(ctx_or_pid, int):
        pid, cid, ctx = ctx_or_pid, int(pid_or_cid), _ctx(None, depth=2)
    else:
        ctx, pid, cid = _ctx(ctx_or_pid, depth=2), int(pid_or_cid), int(cid)
    err = _validate_business_payload(ctx, "api_create_complaint_event")
    if err is not None:
        return err
    db, Complaint, ComplaintEvent = ctx.get("db"), ctx.get("Complaint"), ctx.get("ComplaintEvent")
    request, jsonify, dt_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("datetime", _default_datetime)
    comp = _ensure_project_resource(ctx, db.get_or_404(Complaint, cid), pid)
    data = request.get_json() or {}
    try:
        event_time = dt_cls.fromisoformat(data.get("event_time")) if data.get("event_time") else dt_cls.now()
    except (TypeError, ValueError):
        return jsonify({"error": "发生时间格式不正确"}), 400
    event = ComplaintEvent(
        complaint_id=comp.id,
        event_time=event_time,
        event_type=str(data.get("event_type") or "其他")[:40],
        sender=str(data.get("sender") or "").strip()[:200],
        recipient=str(data.get("recipient") or "").strip()[:200],
        handler=str(data.get("handler") or "").strip()[:100],
        summary=str(data.get("summary") or "").strip(),
        deadline=_parse_optional_date(ctx, data.get("deadline")),
        status=str(data.get("status") or "已完成")[:20],
    )
    db.session.add(event)
    db.session.commit()
    return jsonify(event.to_dict()), 201


def api_upload_complaint_attachments(ctx_or_pid: Any, pid_or_cid: int, cid: int | None = None):
    if cid is None and isinstance(ctx_or_pid, int):
        pid, cid, ctx = ctx_or_pid, int(pid_or_cid), _ctx(None, depth=2)
    else:
        ctx, pid, cid = _ctx(ctx_or_pid, depth=2), int(pid_or_cid), int(cid)
    db, Complaint, Project, Attachment = ctx.get("db"), ctx.get("Complaint"), ctx.get("Project"), ctx.get("Attachment")
    request, session, jsonify = ctx.get("request"), ctx.get("session", {}), ctx.get("jsonify", lambda v: v)
    _ensure_project_resource(ctx, db.get_or_404(Complaint, cid), pid)
    p = db.get_or_404(Project, pid)
    if p.is_terminated:
        return jsonify({"error": "项目已关闭"}), 400
    if "files" not in request.files:
        return jsonify({"error": "未选择文件"}), 400
    files = request.files.getlist("files")
    if not files or not files[0].filename:
        return jsonify({"error": "文件名为空"}), 400

    saved: list[str] = []
    errors: list[str] = []
    MAX = ctx.get("MAX_FILE_SIZE", 1024 * 1024 * 1024)
    upload_dir = ctx.get("get_upload_path")(pid)
    allowed_file = ctx.get("allowed_file")
    sanitize_display_filename = ctx.get("sanitize_display_filename")
    generate_stored_filename = ctx.get("generate_stored_filename")
    _sha256_file = ctx.get("_sha256_file")
    _encrypt_uploaded_file = ctx.get("_encrypt_uploaded_file")

    for file in files:
        filepath = None
        if not file.filename:
            continue
        try:
            if file.content_length and file.content_length > MAX:
                errors.append(f"{file.filename} 超过1GB限制")
                continue
            if not allowed_file(file.filename):
                errors.append(f"{file.filename}: 不支持的文件格式")
                continue
            original_name = sanitize_display_filename(file.filename)
            stored = generate_stored_filename(file.filename)
            filepath = upload_dir / stored
            file.save(filepath)
            original_size = filepath.stat().st_size
            content_sha256 = _sha256_file(filepath)
            _encrypt_uploaded_file(filepath)
            att = Attachment(
                project_id=pid,
                filename=original_name,
                stored_name=stored,
                file_path=f"{pid}/{stored}",
                file_size=original_size,
                mime_type=file.mimetype or "",
                uploaded_by=session.get("user_id") or 0,
                description="质疑/投诉材料",
                complaint_id=cid,
                sha256=content_sha256,
            )
            db.session.add(att)
            saved.append(original_name)
        except Exception as e:
            if filepath and filepath.exists():
                filepath.unlink()
            errors.append(f"{file.filename}: {str(e)}")
    db.session.commit()
    if errors:
        return jsonify({"ok": len(saved) > 0, "saved": saved, "errors": errors}), 207
    return jsonify({"ok": True, "saved": saved})


def api_upload_complaint_event_attachments(ctx_or_pid: Any, pid_or_cid: int, cid_or_eid: int, eid: int | None = None):
    if eid is None and isinstance(ctx_or_pid, int):
        pid, cid, eid, ctx = ctx_or_pid, int(pid_or_cid), int(cid_or_eid), _ctx(None, depth=2)
    else:
        ctx, pid, cid, eid = _ctx(ctx_or_pid, depth=2), int(pid_or_cid), int(cid_or_eid), int(eid)
    db, Complaint, ComplaintEvent, Attachment = (
        ctx.get("db"),
        ctx.get("Complaint"),
        ctx.get("ComplaintEvent"),
        ctx.get("Attachment"),
    )
    request, session, jsonify = ctx.get("request"), ctx.get("session", {}), ctx.get("jsonify", lambda v: v)
    comp = _ensure_project_resource(ctx, db.get_or_404(Complaint, cid), pid)
    event = ComplaintEvent.query.filter_by(id=eid, complaint_id=comp.id).first_or_404()
    files = request.files.getlist("files")
    if not files or not files[0].filename:
        return jsonify({"error": "未选择文件"}), 400
    saved: list[str] = []
    errors: list[str] = []
    upload_dir = ctx.get("get_upload_path")(pid)
    MAX = ctx.get("MAX_FILE_SIZE", 1024 * 1024 * 1024)
    allowed_file = ctx.get("allowed_file")
    sanitize_display_filename = ctx.get("sanitize_display_filename")
    generate_stored_filename = ctx.get("generate_stored_filename")
    _sha256_file = ctx.get("_sha256_file")
    _encrypt_uploaded_file = ctx.get("_encrypt_uploaded_file")

    for file in files:
        filepath = None
        try:
            if not allowed_file(file.filename):
                errors.append(f"{file.filename}: 不支持的文件格式")
                continue
            original_name = sanitize_display_filename(file.filename)
            stored = generate_stored_filename(file.filename)
            filepath = upload_dir / stored
            file.save(filepath)
            if filepath.stat().st_size > MAX:
                filepath.unlink()
                errors.append(f"{original_name}: 超过1GB限制")
                continue
            original_size = filepath.stat().st_size
            content_sha256 = _sha256_file(filepath)
            _encrypt_uploaded_file(filepath)
            db.session.add(
                Attachment(
                    project_id=pid,
                    filename=original_name,
                    stored_name=stored,
                    file_path=f"{pid}/{stored}",
                    file_size=original_size,
                    mime_type=file.mimetype or "",
                    uploaded_by=session.get("user_id") or 0,
                    description=f"质疑过程：{event.event_type}",
                    complaint_id=cid,
                    complaint_event_id=eid,
                    sha256=content_sha256,
                )
            )
            saved.append(original_name)
        except Exception as exc:
            if filepath and filepath.exists():
                filepath.unlink()
            errors.append(f"{file.filename}: {exc}")
    db.session.commit()
    return (
        jsonify({"ok": bool(saved), "saved": saved, "errors": errors}),
        207 if errors else 200,
    )


def api_download_complaint_attachment(ctx_or_cid: Any, cid: int | None = None):
    if cid is None and isinstance(ctx_or_cid, int):
        cid, ctx = ctx_or_cid, _ctx(None, depth=2)
    else:
        ctx, cid = _ctx(ctx_or_cid, depth=2), int(cid)
    db, Complaint = ctx.get("db"), ctx.get("Complaint")
    abort = ctx.get("abort", _default_abort)
    comp = db.get_or_404(Complaint, cid)
    if not comp.attachment_path:
        abort(404)
    filepath = Path(ctx.get("UPLOAD_FOLDER")) / comp.attachment_path
    if not filepath.exists():
        abort(404)
    if ctx.get("DATA_ENCRYPTION_ENABLED") and ctx.get("is_encrypted_file")(filepath):
        Response = ctx.get("Response")
        stream_with_context = ctx.get("stream_with_context")
        iter_decrypted_file = ctx.get("iter_decrypted_file")
        encrypted_file_size = ctx.get("encrypted_file_size")
        response = Response(
            stream_with_context(iter_decrypted_file(filepath, ctx.get("ATTACHMENT_KEY"))),
            mimetype="application/octet-stream",
            direct_passthrough=True,
        )
        response.content_length = encrypted_file_size(filepath)
        name = comp.attachment_name or Path(comp.attachment_path).name
        response.headers["Content-Disposition"] = (
            f"attachment; filename=attachment; filename*=UTF-8''{quote(name)}"
        )
        return response
    send_file = ctx.get("send_file")
    return send_file(
        filepath,
        download_name=comp.attachment_name or comp.attachment_path,
        as_attachment=True,
    )


def api_create_clarification(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    err = _validate_business_payload(ctx, "api_create_clarification")
    if err is not None:
        return err
    db, Project, AnnouncementClarification = (
        ctx.get("db"),
        ctx.get("Project"),
        ctx.get("AnnouncementClarification"),
    )
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    p = db.get_or_404(Project, pid)
    data = request.get_json() or {}
    if not str(data.get("title") or "").strip():
        return jsonify({"error": "请填写澄清/更正标题"}), 400
    item = AnnouncementClarification(project_id=pid)
    _apply_clarification_data(ctx, item, data, pid)
    db.session.add(item)
    db.session.flush()
    recalc = ctx.get("_recalculate_clarification_deadline")
    if callable(recalc):
        recalc(p)
    db.session.commit()
    return jsonify(item.to_dict()), 201


def api_upload_clarification_attachments(ctx_or_pid: Any, pid_or_item_id: int, item_id: int | None = None):
    if item_id is None and isinstance(ctx_or_pid, int):
        pid, item_id, ctx = ctx_or_pid, int(pid_or_item_id), _ctx(None, depth=2)
    else:
        ctx, pid, item_id = _ctx(ctx_or_pid, depth=2), int(pid_or_item_id), int(item_id)
    db, AnnouncementClarification, Attachment = (
        ctx.get("db"),
        ctx.get("AnnouncementClarification"),
        ctx.get("Attachment"),
    )
    request, session, jsonify = ctx.get("request"), ctx.get("session", {}), ctx.get("jsonify", lambda v: v)
    item = AnnouncementClarification.query.filter_by(id=item_id, project_id=pid).first_or_404()
    files = request.files.getlist("files")
    if not files or not files[0].filename:
        return jsonify({"error": "未选择文件"}), 400
    saved: list[str] = []
    errors: list[str] = []
    upload_dir = ctx.get("get_upload_path")(pid)
    MAX = ctx.get("MAX_FILE_SIZE", 1024 * 1024 * 1024)
    allowed_file = ctx.get("allowed_file")
    sanitize_display_filename = ctx.get("sanitize_display_filename")
    generate_stored_filename = ctx.get("generate_stored_filename")
    _sha256_file = ctx.get("_sha256_file")
    _encrypt_uploaded_file = ctx.get("_encrypt_uploaded_file")

    for file in files:
        filepath = None
        try:
            if not allowed_file(file.filename):
                errors.append(f"{file.filename}: 不支持的文件格式")
                continue
            name = sanitize_display_filename(file.filename)
            stored = generate_stored_filename(file.filename)
            filepath = upload_dir / stored
            file.save(filepath)
            if filepath.stat().st_size > MAX:
                filepath.unlink()
                errors.append(f"{name}: 超过1GB限制")
                continue
            original_size = filepath.stat().st_size
            content_sha256 = _sha256_file(filepath)
            _encrypt_uploaded_file(filepath)
            db.session.add(
                Attachment(
                    project_id=pid,
                    filename=name,
                    stored_name=stored,
                    file_path=f"{pid}/{stored}",
                    file_size=original_size,
                    mime_type=file.mimetype or "",
                    uploaded_by=session.get("user_id") or 0,
                    description="公告澄清/更正材料",
                    clarification_id=item.id,
                    sha256=content_sha256,
                )
            )
            saved.append(name)
        except Exception as exc:
            if filepath and filepath.exists():
                filepath.unlink()
            errors.append(f"{file.filename}: {exc}")
    db.session.commit()
    return (
        jsonify({"ok": bool(saved), "saved": saved, "errors": errors}),
        207 if errors else 200,
    )


# ---------------------------------------------------------------------------
# 6. Stage Checklist & Archive Catalog Routes
# ---------------------------------------------------------------------------

def api_update_delete_stage_checklist_item(ctx_or_pid: Any, pid_or_item_id: int, item_id: int | None = None):
    if item_id is None and isinstance(ctx_or_pid, int):
        pid, item_id, ctx = ctx_or_pid, int(pid_or_item_id), _ctx(None, depth=2)
    else:
        ctx, pid, item_id = _ctx(ctx_or_pid, depth=2), int(pid_or_item_id), int(item_id)
    err = _validate_business_payload(ctx, "api_update_delete_stage_checklist_item")
    if err is not None:
        return err
    db, StageChecklistItem = ctx.get("db"), ctx.get("StageChecklistItem")
    request, jsonify, dt_cls = ctx.get("request"), ctx.get("jsonify", lambda v: v), ctx.get("datetime", _default_datetime)
    item = StageChecklistItem.query.filter_by(id=item_id, project_id=pid).first_or_404()
    if request.method == "DELETE":
        if not item.is_custom:
            return jsonify({"error": "默认检查项不能删除，可设为非必检项"}), 400
        db.session.delete(item)
        db.session.commit()
        return jsonify({"ok": True})
    data = request.get_json() or {}
    if "title" in data and item.is_custom:
        title = str(data.get("title") or "").strip()
        if not title:
            return jsonify({"error": "检查项不能为空"}), 400
        item.title = title[:250]
    if "required" in data:
        item.required = bool(data["required"])
    if "completed" in data:
        item.completed = bool(data["completed"])
        item.completed_at = dt_cls.now() if item.completed else None
    if "notes" in data:
        item.notes = str(data.get("notes") or "").strip()
    db.session.commit()
    return jsonify(item.to_dict())


def api_create_archive_catalog_item(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    db, Project, ArchiveCatalogItem = ctx.get("db"), ctx.get("Project"), ctx.get("ArchiveCatalogItem")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    project = db.get_or_404(Project, pid)
    data = request.get_json() or {}
    name = str(data.get("document_name") or "").strip()
    if not name:
        return jsonify({"error": "资料名称不能为空"}), 400
    order = (
        db.session.query(db.func.max(ArchiveCatalogItem.sort_order))
        .filter_by(project_id=pid)
        .scalar()
        or 0
    )
    item = ArchiveCatalogItem(
        project_id=pid,
        category=str(data.get("category") or "其他资料")[:60],
        document_name=name[:250],
        sort_order=order + 1,
        is_custom=True,
    )
    db.session.add(item)
    db.session.flush()
    _sync_archive_checklist(ctx, project)
    db.session.commit()
    return jsonify(item.to_dict()), 201


def api_bulk_update_archive_catalog(ctx_or_pid: Any, pid: int | None = None):
    if pid is None and isinstance(ctx_or_pid, int):
        pid, ctx = ctx_or_pid, _ctx(None, depth=2)
    else:
        ctx, pid = _ctx(ctx_or_pid, depth=2), int(pid)
    err = _validate_business_payload(ctx, "api_bulk_update_archive_catalog")
    if err is not None:
        return err
    db, Project, ArchiveCatalogItem = ctx.get("db"), ctx.get("Project"), ctx.get("ArchiveCatalogItem")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    db.get_or_404(Project, pid)
    data = request.get_json() or {}
    raw_ids = data.get("ids") or []
    if not isinstance(raw_ids, list) or not raw_ids:
        return jsonify({"error": "请至少选择一项归档资料"}), 400
    try:
        ids = {int(value) for value in raw_ids}
    except (TypeError, ValueError):
        return jsonify({"error": "归档资料编号格式不正确"}), 400
    items = ArchiveCatalogItem.query.filter(
        ArchiveCatalogItem.project_id == pid,
        ArchiveCatalogItem.id.in_(ids),
    ).all()
    if len(items) != len(ids):
        return jsonify({"error": "部分归档资料不存在或不属于当前项目"}), 400
    changed_fields: set[str] = set()
    for field in ("applicable", "has_original", "has_scan", "transferred"):
        if field in data and data[field] is not None:
            changed_fields.add(field)
            for item in items:
                setattr(item, field, bool(data[field]))
    for field in ("agency_copies", "purchaser_copies"):
        if field in data and data[field] not in (None, ""):
            try:
                value = max(0, int(data[field]))
            except (TypeError, ValueError):
                return jsonify({"error": "留存份数必须为非负整数"}), 400
            changed_fields.add(field)
            for item in items:
                setattr(item, field, value)
    if "missing_reason" in data and data["missing_reason"] is not None:
        changed_fields.add("missing_reason")
        for item in items:
            item.missing_reason = str(data["missing_reason"]).strip()
    if not changed_fields:
        return jsonify({"error": "请选择至少一个需要批量修改的字段"}), 400
    _sync_archive_checklist(ctx, items[0].project)
    db.session.commit()
    return jsonify({"ok": True, "updated": len(items), "fields": sorted(changed_fields)})


def api_update_delete_archive_catalog_item(ctx_or_pid: Any, pid_or_item_id: int, item_id: int | None = None):
    if item_id is None and isinstance(ctx_or_pid, int):
        pid, item_id, ctx = ctx_or_pid, int(pid_or_item_id), _ctx(None, depth=2)
    else:
        ctx, pid, item_id = _ctx(ctx_or_pid, depth=2), int(pid_or_item_id), int(item_id)
    err = _validate_business_payload(ctx, "api_update_delete_archive_catalog_item")
    if err is not None:
        return err
    db, ArchiveCatalogItem = ctx.get("db"), ctx.get("ArchiveCatalogItem")
    request, jsonify = ctx.get("request"), ctx.get("jsonify", lambda v: v)
    item = ArchiveCatalogItem.query.filter_by(id=item_id, project_id=pid).first_or_404()
    if request.method == "DELETE":
        if not item.is_custom:
            return jsonify({"error": "默认归档项不能删除，可设为不适用"}), 400
        project = item.project
        db.session.delete(item)
        db.session.flush()
        _sync_archive_checklist(ctx, project)
        db.session.commit()
        return jsonify({"ok": True})
    data = request.get_json() or {}
    for field in ("applicable", "has_original", "has_scan", "transferred"):
        if field in data:
            setattr(item, field, bool(data[field]))
    for field in ("agency_copies", "purchaser_copies"):
        if field in data:
            try:
                setattr(item, field, max(0, int(data[field] or 0)))
            except (TypeError, ValueError):
                pass
    for field in ("missing_reason", "notes"):
        if field in data:
            setattr(item, field, str(data.get(field) or "").strip())
    if item.is_custom:
        if "category" in data:
            item.category = str(data.get("category") or "其他资料")[:60]
        if "document_name" in data and str(data.get("document_name") or "").strip():
            item.document_name = str(data["document_name"]).strip()[:250]
    _sync_archive_checklist(ctx, item.project)
    db.session.commit()
    return jsonify(item.to_dict())


# ---------------------------------------------------------------------------
# 7. Dual-Track Runtime Registration
# ---------------------------------------------------------------------------

def register(host_or_ctx: Any, app: Any = None) -> dict[str, Any]:
    """Install Stage 4B open-source business registry routes and helpers with legacy fallback."""
    ctx = _ctx(host_or_ctx, depth=2)
    flask_app = app or ctx.get("app")
    host = ctx.host_module

    legacy_helpers: dict[str, Any] = {}
    legacy_views: dict[str, Any] = {}

    if host is not None:
        for name in STAGE_4B_HELPER_NAMES:
            existing = ctx.get(name)
            if existing is not None:
                legacy_helpers[name] = existing

    if flask_app is not None and hasattr(flask_app, "view_functions"):
        for endpoint in STAGE_4B_ROUTE_ENDPOINTS:
            if endpoint in flask_app.view_functions:
                legacy_views[endpoint] = flask_app.view_functions[endpoint]

    helper_map = {
        "_ensure_project_resource": _ensure_project_resource,
        "_normalize_project_lot_id": _normalize_project_lot_id,
        "_parse_optional_date": _parse_optional_date,
        "_parse_optional_datetime": _parse_optional_datetime,
        "_replace_complaint_details": _replace_complaint_details,
        "_apply_clarification_data": _apply_clarification_data,
        "_sync_archive_checklist": _sync_archive_checklist,
    }

    for name, open_fn in helper_map.items():
        def _make_helper(h_name: str, h_fn: Any):
            def _bound(*args: Any, **kwargs: Any):
                if should_use_legacy_route(h_name) and h_name in legacy_helpers:
                    return legacy_helpers[h_name](*args, **kwargs)
                return h_fn(ctx, *args, **kwargs)

            _bound.__name__ = h_name
            _bound._is_stage_4b_bound = True
            return _bound

        ctx.set_symbol(name, _make_helper(name, open_fn), write_host=True)

    route_map = {
        "api_get_bid_results": lambda pid: api_get_bid_results(ctx, pid),
        "api_create_bid_result": lambda pid: api_create_bid_result(ctx, pid),
        "api_update_bid_result": lambda pid, bid: api_update_bid_result(ctx, pid, bid),
        "api_delete_bid_result": lambda pid, bid: api_delete_bid_result(ctx, pid, bid),
        "api_get_notice_deliveries": lambda pid: api_get_notice_deliveries(ctx, pid),
        "api_create_notice_delivery": lambda pid: api_create_notice_delivery(ctx, pid),
        "api_update_notice_delivery": lambda pid, nid: api_update_notice_delivery(ctx, pid, nid),
        "api_delete_notice_delivery": lambda pid, nid: api_delete_notice_delivery(ctx, pid, nid),
        "api_get_archive_deliveries": lambda pid: api_get_archive_deliveries(ctx, pid),
        "api_create_archive_delivery": lambda pid: api_create_archive_delivery(ctx, pid),
        "api_update_archive_delivery": lambda pid, aid: api_update_archive_delivery(ctx, pid, aid),
        "api_delete_archive_delivery": lambda pid, aid: api_delete_archive_delivery(ctx, pid, aid),
        "api_get_service_fee_invoices": lambda pid: api_get_service_fee_invoices(ctx, pid),
        "api_create_service_fee_invoice": lambda pid: api_create_service_fee_invoice(ctx, pid),
        "api_update_service_fee_invoice": lambda pid, iid: api_update_service_fee_invoice(ctx, pid, iid),
        "api_delete_service_fee_invoice": lambda pid, iid: api_delete_service_fee_invoice(ctx, pid, iid),
        "api_get_complaints": lambda pid: api_get_complaints(ctx, pid),
        "api_create_complaint": lambda pid: api_create_complaint(ctx, pid),
        "api_update_complaint": lambda pid, cid: api_update_complaint(ctx, pid, cid),
        "api_set_complaint_status": lambda pid, cid: api_set_complaint_status(ctx, pid, cid),
        "api_create_complaint_event": lambda pid, cid: api_create_complaint_event(ctx, pid, cid),
        "api_upload_complaint_attachments": lambda pid, cid: api_upload_complaint_attachments(ctx, pid, cid),
        "api_upload_complaint_event_attachments": lambda pid, cid, eid: api_upload_complaint_event_attachments(ctx, pid, cid, eid),
        "api_download_complaint_attachment": lambda cid: api_download_complaint_attachment(ctx, cid),
        "api_create_clarification": lambda pid: api_create_clarification(ctx, pid),
        "api_upload_clarification_attachments": lambda pid, item_id: api_upload_clarification_attachments(ctx, pid, item_id),
        "api_update_delete_stage_checklist_item": lambda pid, item_id: api_update_delete_stage_checklist_item(ctx, pid, item_id),
        "api_create_archive_catalog_item": lambda pid: api_create_archive_catalog_item(ctx, pid),
        "api_bulk_update_archive_catalog": lambda pid: api_bulk_update_archive_catalog(ctx, pid),
        "api_update_delete_archive_catalog_item": lambda pid, item_id: api_update_delete_archive_catalog_item(ctx, pid, item_id),
    }

    installed_views: list[str] = []
    if flask_app is not None and hasattr(flask_app, "view_functions"):
        login_dec = ctx.get("login_required") or (lambda f: f)
        for endpoint, raw_fn in route_map.items():
            raw_fn.__name__ = endpoint
            guarded = login_dec(raw_fn)

            def _make_dual(ep: str, open_handler: Any):
                def _dual(*args: Any, **kwargs: Any):
                    if should_use_legacy_route(ep) and ep in legacy_views:
                        return legacy_views[ep](*args, **kwargs)
                    return open_handler(*args, **kwargs)

                _dual.__name__ = ep
                _dual._is_stage_4b_bound = True
                return _dual

            dual_fn = _make_dual(endpoint, guarded)
            flask_app.view_functions[endpoint] = dual_fn
            ctx.set_symbol(endpoint, dual_fn, write_host=True)
            installed_views.append(endpoint)

    info = {
        "signature": BUSINESS_REGISTRY_ROUTES_SIGNATURE,
        "installed_helpers": list(helper_map.keys()),
        "installed_views": installed_views,
    }
    if flask_app is not None and hasattr(flask_app, "extensions"):
        flask_app.extensions["stage_4b_business"] = info
    return info
